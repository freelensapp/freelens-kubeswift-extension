/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The workload sections of the Create Sandbox form that KubeSwift v0.18.0 added
// (SPEC-0019 T4, decisions D1 and D2): the readiness and liveness probes, the
// termination drain period, the OCI artifacts mounted into the guest, the
// Secret files written into it, and the launcher pod's labels. A pool has none
// of them: they belong to the workload, so they are offered on a checkout too.
//
// Every rule the admission webhook would enforce is enforced here, because the
// webhook ships disabled. What only the renderer knows - the namespace's
// Secrets, the network the sandbox will run under, the ports it declares - is
// handed in as a context. Nothing here reads a store or emits JSX.

import { parseGoDurationMs } from "./go-duration";
import { nextRowId } from "./guest-create";
import { addKeyValueRow, keyValuePayload, keyValueRowErrors, removeKeyValueRow, updateKeyValueRow } from "./label-rows";
import { isIanaServiceName, portNumber, portNumberMessage } from "./sandbox-network-create";

import type {
  SwiftSandboxArtifact,
  SwiftSandboxPodMetadata,
  SwiftSandboxProbe,
  SwiftSandboxSecretFile,
  SwiftSandboxSecretFileItem,
  SwiftSandboxTermination,
} from "../api/kubeswift/swiftsandbox-v1alpha1";
import type { KeyValueMessages, KeyValueRow } from "./label-rows";

/** `spec.artifacts`, at most (the schema's maxItems). */
export const maxSandboxArtifacts = 8;

/** The claims of one artifact, at most: the schema sets no cap, so this is the form's. */
export const maxArtifactClaims = 16;

/** `spec.secretFiles`, at most (the schema's maxItems). */
export const maxSandboxSecretFiles = 16;

/** The items of one Secret file entry, at most (the schema's maxItems; minItems is 1). */
export const maxSecretFileItems = 32;

/** The launcher pod's labels, at most: the schema sets no cap, so this is the form's. */
export const maxSandboxPodLabels = 32;

/** An artifact's name is a DNS label of at most this many characters. */
export const maxArtifactNameLength = 40;

/** `termination.drainPeriod`, at most, in milliseconds (10m). */
export const maxDrainPeriodMs = 600_000;

/** An optional artifact's `fetchTimeout`, at most, in milliseconds (5m). */
export const maxFetchTimeoutMs = 300_000;

/** What an empty `fetchTimeout` is. */
export const defaultFetchTimeout = "10s";

/** What an empty drain period is, by whether the sandbox exposes ports. */
export const defaultDrainWithPorts = "5s";
export const defaultDrainWithoutPorts = "0s";

/** An entry's file mode when it sets none: 0400. */
export const defaultSecretFileMode = 0o400;

/** The highest file mode the schema accepts: 0777. */
export const maxFileMode = 0o777;

/** The largest value of an int32 field. */
const maxInt32 = 2_147_483_647;

/** The guest paths no artifact may be mounted at or under, and no Secret file written under. */
export const reservedGuestPaths: string[] = ["/proc", "/sys", "/dev"];

/** The two artifact layouts, the schema's default first. */
export const artifactLayouts: string[] = ["oci", "unpacked"];

/** The label domains the launcher pod's metadata may not use, besides `kubeswift.io` and its subdomains. */
export const podNetworkKeyPrefixes: string[] = ["k8s.v1.cni.cncf.io/", "v1.multus-cni.io/", "k8s.ovn.org/"];

// ---------------------------------------------------------------------------
// The values.
// ---------------------------------------------------------------------------

export type SandboxProbeKind = "readiness" | "liveness";

export const sandboxProbeKinds: SandboxProbeKind[] = ["readiness", "liveness"];

export const sandboxProbeLabels: Record<SandboxProbeKind, string> = {
  readiness: "Readiness probe",
  liveness: "Liveness probe",
};

/** The two probe actions KubeSwift supports: an HTTP GET and a TCP connect. */
export type SandboxProbeAction = "http" | "tcp";

export const sandboxProbeActions: SandboxProbeAction[] = ["http", "tcp"];

export const sandboxProbeActionLabels: Record<SandboxProbeAction, string> = {
  http: "HTTP GET",
  tcp: "TCP connect",
};

/** One probe, off until it is turned on. Every number is empty for its default. */
export interface SandboxProbeValues {
  enabled: boolean;
  action: SandboxProbeAction;
  /** `httpGet.path`; read only for an HTTP probe. */
  path: string;
  /** A number, or the name of a declared `spec.network.ports` entry. */
  port: string;
  periodSeconds: string;
  timeoutSeconds: string;
  failureThreshold: string;
  initialDelaySeconds: string;
}

/** One entry of `spec.artifacts`. */
export interface SandboxArtifactRow {
  id: string;
  name: string;
  ref: string;
  mountPath: string;
  /** Empty is the schema's `oci`. */
  layout: string;
  optional: boolean;
  /** Only read while `optional` is set. */
  fetchTimeout: string;
  pullSecret: string;
  verifyKeySecret: string;
  requirePlatformVerification: boolean;
  claims: KeyValueRow[];
}

/** One item of a Secret file entry: a key, the file it becomes, and its own mode. */
export interface SandboxSecretFileItemRow {
  id: string;
  key: string;
  path: string;
  mode: string;
}

/** One entry of `spec.secretFiles`. */
export interface SandboxSecretFileRow {
  id: string;
  secretName: string;
  /** Octal, as typed; empty is 0400. */
  mode: string;
  optional: boolean;
  items: SandboxSecretFileItemRow[];
}

/** Everything the five workload sections hold. */
export interface SandboxWorkloadValues {
  readiness: SandboxProbeValues;
  liveness: SandboxProbeValues;
  drainPeriod: string;
  artifacts: SandboxArtifactRow[];
  secretFiles: SandboxSecretFileRow[];
  podLabels: KeyValueRow[];
}

export function defaultSandboxProbe(): SandboxProbeValues {
  return {
    enabled: false,
    action: "http",
    path: "",
    port: "",
    periodSeconds: "",
    timeoutSeconds: "",
    failureThreshold: "",
    initialDelaySeconds: "",
  };
}

export function defaultSandboxWorkload(): SandboxWorkloadValues {
  return {
    readiness: defaultSandboxProbe(),
    liveness: defaultSandboxProbe(),
    drainPeriod: "",
    artifacts: [],
    secretFiles: [],
    podLabels: [],
  };
}

/**
 * What the workload's rules need to know that the workload does not hold.
 *
 * On the cold path the network is the form's own; on a checkout it is the
 * pool's, read from the pool when that read answered (D2).
 */
export interface SandboxWorkloadContext {
  /** True when the sandbox checks a slot out of a pool, which decides the network. */
  checkout: boolean;
  /** The network mode in force, or `undefined` when a checkout's pool could not be read. */
  networkMode: string | undefined;
  /** The names of the sandbox's own `spec.network.ports`; always empty on a checkout. */
  portNames: string[];
  /** The namespace's Secret names, and whether that read was refused. */
  secrets: string[];
  secretsUnverified: boolean;
  /** `spec.model.mountPath` when a model is mounted, for the overlap warning. */
  modelMountPath?: string;
}

// ---------------------------------------------------------------------------
// The rows.
// ---------------------------------------------------------------------------

export function updateSandboxProbe(
  workload: SandboxWorkloadValues,
  kind: SandboxProbeKind,
  patch: Partial<SandboxProbeValues>,
): SandboxWorkloadValues {
  return { ...workload, [kind]: { ...workload[kind], ...patch } };
}

/** Turns a probe on or off; off empties it, so nothing is left behind that the payload would not send. */
export function setSandboxProbeEnabled(
  workload: SandboxWorkloadValues,
  kind: SandboxProbeKind,
  enabled: boolean,
): SandboxWorkloadValues {
  return { ...workload, [kind]: enabled ? { ...workload[kind], enabled } : defaultSandboxProbe() };
}

export function addSandboxArtifact(workload: SandboxWorkloadValues): SandboxWorkloadValues {
  const row: SandboxArtifactRow = {
    id: nextRowId("artifact", workload.artifacts),
    name: "",
    ref: "",
    mountPath: "",
    layout: "",
    optional: false,
    fetchTimeout: "",
    pullSecret: "",
    verifyKeySecret: "",
    requirePlatformVerification: false,
    claims: [],
  };

  return { ...workload, artifacts: [...workload.artifacts, row] };
}

export function removeSandboxArtifact(workload: SandboxWorkloadValues, id: string): SandboxWorkloadValues {
  return { ...workload, artifacts: workload.artifacts.filter((row) => row.id !== id) };
}

/** Changes one artifact; clearing `optional` empties the fetch timeout, which only an optional one has. */
export function updateSandboxArtifact(
  workload: SandboxWorkloadValues,
  id: string,
  patch: Partial<SandboxArtifactRow>,
): SandboxWorkloadValues {
  return {
    ...workload,
    artifacts: workload.artifacts.map((row) => {
      if (row.id !== id) {
        return row;
      }

      const next = { ...row, ...patch };

      return next.optional ? next : { ...next, fetchTimeout: "" };
    }),
  };
}

export function addArtifactClaim(workload: SandboxWorkloadValues, id: string): SandboxWorkloadValues {
  const row = workload.artifacts.find((candidate) => candidate.id === id);

  return row ? updateSandboxArtifact(workload, id, { claims: addKeyValueRow(row.claims, "claim") }) : workload;
}

export function removeArtifactClaim(
  workload: SandboxWorkloadValues,
  id: string,
  claimId: string,
): SandboxWorkloadValues {
  const row = workload.artifacts.find((candidate) => candidate.id === id);

  return row ? updateSandboxArtifact(workload, id, { claims: removeKeyValueRow(row.claims, claimId) }) : workload;
}

export function updateArtifactClaim(
  workload: SandboxWorkloadValues,
  id: string,
  claimId: string,
  patch: Partial<KeyValueRow>,
): SandboxWorkloadValues {
  const row = workload.artifacts.find((candidate) => candidate.id === id);

  return row
    ? updateSandboxArtifact(workload, id, { claims: updateKeyValueRow(row.claims, claimId, patch) })
    : workload;
}

/** A new entry comes with its one required item, since the schema needs at least one. */
export function addSandboxSecretFile(workload: SandboxWorkloadValues): SandboxWorkloadValues {
  const row: SandboxSecretFileRow = {
    id: nextRowId("secret-file", workload.secretFiles),
    secretName: "",
    mode: "",
    optional: false,
    items: [{ id: "secret-item-1", key: "", path: "", mode: "" }],
  };

  return { ...workload, secretFiles: [...workload.secretFiles, row] };
}

export function removeSandboxSecretFile(workload: SandboxWorkloadValues, id: string): SandboxWorkloadValues {
  return { ...workload, secretFiles: workload.secretFiles.filter((row) => row.id !== id) };
}

export function updateSandboxSecretFile(
  workload: SandboxWorkloadValues,
  id: string,
  patch: Partial<SandboxSecretFileRow>,
): SandboxWorkloadValues {
  return {
    ...workload,
    secretFiles: workload.secretFiles.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  };
}

export function addSecretFileItem(workload: SandboxWorkloadValues, id: string): SandboxWorkloadValues {
  const row = workload.secretFiles.find((candidate) => candidate.id === id);

  return row
    ? updateSandboxSecretFile(workload, id, {
        items: [...row.items, { id: nextRowId("secret-item", row.items), key: "", path: "", mode: "" }],
      })
    : workload;
}

export function removeSecretFileItem(
  workload: SandboxWorkloadValues,
  id: string,
  itemId: string,
): SandboxWorkloadValues {
  const row = workload.secretFiles.find((candidate) => candidate.id === id);

  return row
    ? updateSandboxSecretFile(workload, id, { items: row.items.filter((item) => item.id !== itemId) })
    : workload;
}

export function updateSecretFileItem(
  workload: SandboxWorkloadValues,
  id: string,
  itemId: string,
  patch: Partial<SandboxSecretFileItemRow>,
): SandboxWorkloadValues {
  const row = workload.secretFiles.find((candidate) => candidate.id === id);

  return row
    ? updateSandboxSecretFile(workload, id, {
        items: row.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
      })
    : workload;
}

export function addSandboxPodLabel(workload: SandboxWorkloadValues): SandboxWorkloadValues {
  return { ...workload, podLabels: addKeyValueRow(workload.podLabels, "pod-label") };
}

export function removeSandboxPodLabel(workload: SandboxWorkloadValues, id: string): SandboxWorkloadValues {
  return { ...workload, podLabels: removeKeyValueRow(workload.podLabels, id) };
}

export function updateSandboxPodLabel(
  workload: SandboxWorkloadValues,
  id: string,
  patch: Partial<KeyValueRow>,
): SandboxWorkloadValues {
  return { ...workload, podLabels: updateKeyValueRow(workload.podLabels, id, patch) };
}

/**
 * Empties every Secret name, for a move to another namespace: each named a
 * Secret of the namespace the form left and names nothing in the new one.
 */
export function clearWorkloadSecrets(workload: SandboxWorkloadValues): SandboxWorkloadValues {
  return {
    ...workload,
    artifacts: workload.artifacts.map((row) => ({ ...row, pullSecret: "", verifyKeySecret: "" })),
    secretFiles: workload.secretFiles.map((row) => ({ ...row, secretName: "" })),
  };
}

// ---------------------------------------------------------------------------
// The add controls: disabled with their reason, never hidden (W4).
// ---------------------------------------------------------------------------

function capReason(count: number, max: number, what: string, schema: boolean): string | undefined {
  return count >= max
    ? `${schema ? "The schema allows" : "This form offers"} at most ${max} ${what}, and all ${max} are set.`
    : undefined;
}

export function addArtifactBlockedReason(workload: SandboxWorkloadValues): string | undefined {
  return capReason(workload.artifacts.length, maxSandboxArtifacts, "artifacts", true);
}

export function addArtifactClaimBlockedReason(row: SandboxArtifactRow): string | undefined {
  return capReason(row.claims.length, maxArtifactClaims, "claims per artifact", false);
}

export function addSecretFileBlockedReason(workload: SandboxWorkloadValues): string | undefined {
  return capReason(workload.secretFiles.length, maxSandboxSecretFiles, "Secret file entries", true);
}

export function addSecretFileItemBlockedReason(row: SandboxSecretFileRow): string | undefined {
  return capReason(row.items.length, maxSecretFileItems, "items per Secret", true);
}

export function addPodLabelBlockedReason(workload: SandboxWorkloadValues): string | undefined {
  return capReason(workload.podLabels.length, maxSandboxPodLabels, "pod labels", false);
}

/** What a probe is refused with when the sandbox has no network. */
export const probeWithModeNoneMessage =
  "A probe is not valid with network mode none: it reaches the workload over the guest's network, and a sandbox " +
  "with mode none has none, so the probe could never pass. Choose restricted or open, or turn the probe off.";

/** What a probe is refused with on a checkout of a pool whose mode is none. */
export const probeWithPoolModeNoneMessage =
  "A probe is not valid here: the pool this sandbox checks a slot out of runs its slots with network mode none, " +
  "so the probe could never reach the workload. Turn the probe off, or use a pool with a network.";

/** Why a probe cannot be turned on, or `undefined` when it can. */
export function probeBlockedReason(context: SandboxWorkloadContext): string | undefined {
  if (context.networkMode !== "none") {
    return undefined;
  }

  return context.checkout ? probeWithPoolModeNoneMessage : probeWithModeNoneMessage;
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

/** A whole number from `min` up to an int32, or `undefined`. */
function wholeNumber(value: string, min: number): number | undefined {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);

  return parsed >= min && parsed <= maxInt32 ? parsed : undefined;
}

/** A file mode in octal (`0400`, `400`, `0o400`), or `undefined` when it is not one up to 0777. */
export function parseFileMode(value: string): number | undefined {
  const match = /^(?:0o|0)?([0-7]+)$/i.exec(value.trim());

  if (!match) {
    return undefined;
  }

  const mode = Number.parseInt(match[1], 8);

  return mode <= maxFileMode ? mode : undefined;
}

/** A mode as it is written, `0` and three octal digits. */
export function formatFileMode(mode: number): string {
  return `0${mode.toString(8).padStart(3, "0")}`;
}

export const fileModeMessage =
  "A file mode is octal, from 0 to 0777, such as 0400 (owner read) or 0644; it is sent as the number it stands for.";

/** The path with `.` and `..` resolved and no trailing slash, as a mount table would compare it. */
export function cleanGuestPath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return `/${parts.join("/")}`;
}

/** True when `path` is `root` or lies under it. Both are cleaned paths. */
export function isUnderPath(path: string, root: string): boolean {
  return root === "/" || path === root || path.startsWith(`${root}/`);
}

/** The reserved root a cleaned path is at or under, if any. */
function reservedRootOf(path: string): string | undefined {
  return reservedGuestPaths.find((root) => isUnderPath(path, root));
}

const dnsLabelPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

const dnsSubdomainPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

const secretKeyPattern = /^[-._a-zA-Z0-9]+$/;

export interface SandboxProbeMessages {
  probe?: string;
  path?: string;
  port?: string;
  periodSeconds?: string;
  timeoutSeconds?: string;
  failureThreshold?: string;
  initialDelaySeconds?: string;
}

export type SandboxProbeNumberField = "periodSeconds" | "timeoutSeconds" | "failureThreshold" | "initialDelaySeconds";

export const sandboxProbeNumberFields: SandboxProbeNumberField[] = [
  "periodSeconds",
  "timeoutSeconds",
  "failureThreshold",
  "initialDelaySeconds",
];

export const sandboxProbeNumberLabels: Record<SandboxProbeNumberField, string> = {
  periodSeconds: "period",
  timeoutSeconds: "timeout",
  failureThreshold: "failure threshold",
  initialDelaySeconds: "initial delay",
};

/** What Kubernetes' own probe defaults are, for the placeholders and the summary. */
export const sandboxProbeNumberDefaults: Record<SandboxProbeNumberField, string> = {
  periodSeconds: "10",
  timeoutSeconds: "1",
  failureThreshold: "3",
  initialDelaySeconds: "0",
};

/** Every refusal of one probe. A probe that is off has none. */
export function sandboxProbeErrors(probe: SandboxProbeValues, context: SandboxWorkloadContext): SandboxProbeMessages {
  const messages: SandboxProbeMessages = {};

  if (!probe.enabled) {
    return messages;
  }

  const blocked = probeBlockedReason(context);

  if (blocked) {
    messages.probe = blocked;
  }

  const path = probe.path.trim();

  if (probe.action === "http" && path && (!path.startsWith("/") || /\s/.test(path))) {
    messages.path = "An HTTP path starts with '/' and holds no whitespace, such as /healthz.";
  }

  const port = probe.port.trim();

  if (!port) {
    messages.port = "A port is required: a number, or the name of one of this sandbox's ports.";
  } else if (/^\d+$/.test(port)) {
    if (portNumber(port) === undefined) {
      messages.port = portNumberMessage;
    }
  } else if (context.checkout) {
    messages.port =
      "On a checkout the pool decides the network, so this sandbox declares no port of its own for a name to " +
      "refer to. Give the port as a number.";
  } else if (!isIanaServiceName(port)) {
    messages.port = "A port is a number from 1 to 65535, or the name of one of this sandbox's ports.";
  } else if (!context.portNames.includes(port)) {
    messages.port =
      context.portNames.length > 0
        ? `No port of this sandbox is named ${port}; the declared ones are ${context.portNames.join(", ")}. Use one of them, or a number.`
        : `No port of this sandbox is named ${port}, and none is declared in the Network section. Declare it there, or use a number.`;
  }

  for (const field of sandboxProbeNumberFields) {
    const text = probe[field].trim();
    const min = field === "initialDelaySeconds" ? 0 : 1;

    if (text && wholeNumber(text, min) === undefined) {
      messages[field] =
        min === 0 ? "A whole number of seconds, 0 or more." : "A whole number, 1 or more: the schema's minimum.";
    }
  }

  return messages;
}

/** Why a drain period would be refused, or `undefined` when it is acceptable or empty. */
export function drainPeriodError(value: string): string | undefined {
  const text = value.trim();

  if (!text) {
    return undefined;
  }

  const ms = parseGoDurationMs(text);

  if (ms === undefined) {
    return "A drain period is a Go duration, such as 5s, 30s or 1m30s.";
  }

  return ms < 0 || ms > maxDrainPeriodMs ? "A drain period is between 0s and 10m." : undefined;
}

export type SandboxArtifactField =
  | "name"
  | "ref"
  | "mountPath"
  | "fetchTimeout"
  | "pullSecret"
  | "verifyKeySecret"
  | "claims";

export const sandboxArtifactFieldOrder: SandboxArtifactField[] = [
  "name",
  "ref",
  "mountPath",
  "fetchTimeout",
  "pullSecret",
  "verifyKeySecret",
  "claims",
];

export const sandboxArtifactFieldLabels: Record<SandboxArtifactField, string> = {
  name: "name",
  ref: "reference",
  mountPath: "mount path",
  fetchTimeout: "fetch timeout",
  pullSecret: "pull secret",
  verifyKeySecret: "verification key",
  claims: "claims",
};

export interface SandboxArtifactMessages extends Partial<Record<SandboxArtifactField, string>> {
  claimRows: KeyValueMessages[];
}

/** Every refusal of the artifacts: one for the list, then one set per row. */
export interface SandboxArtifactErrors {
  artifacts?: string;
  rows: SandboxArtifactMessages[];
}

/** Why a guest mount path would be refused, or `undefined`. */
export function artifactMountPathError(value: string): string | undefined {
  const path = value.trim();

  if (!path) {
    return "A mount path is required: it is where the artifact appears, read-only, in the guest.";
  }

  if (!path.startsWith("/")) {
    return "A mount path is absolute, such as /opt/plugins.";
  }

  const clean = cleanGuestPath(path);

  if (clean === "/") {
    return "An artifact cannot be mounted at /, which is the guest's own root filesystem.";
  }

  const reserved = reservedRootOf(clean);

  return reserved ? `An artifact cannot be mounted at or under ${reserved}, which the guest kernel owns.` : undefined;
}

/** Everything that would make the artifacts refuse the create. */
export function sandboxArtifactErrors(workload: SandboxWorkloadValues): SandboxArtifactErrors {
  const errors: SandboxArtifactErrors = { rows: [] };
  const rows = workload.artifacts;

  if (rows.length > maxSandboxArtifacts) {
    errors.artifacts = `The schema allows at most ${maxSandboxArtifacts} artifacts. Remove ${rows.length - maxSandboxArtifacts}.`;
  }

  errors.rows = rows.map((row, index) => {
    const messages: SandboxArtifactMessages = { claimRows: [] };
    const name = row.name.trim();
    const ref = row.ref.trim();

    if (!name) {
      messages.name = "A name is required: it identifies the artifact in the sandbox's status.";
    } else if (name.length > maxArtifactNameLength || !dnsLabelPattern.test(name)) {
      messages.name = `A name is a DNS label of at most ${maxArtifactNameLength} lowercase letters, digits and '-', starting and ending with a letter or a digit.`;
    } else if (rows.some((other, otherIndex) => otherIndex < index && other.name.trim() === name)) {
      messages.name = `Another artifact is already named ${name}. The names are the list's keys, so the API server refuses the second one.`;
    }

    if (!ref) {
      messages.ref =
        "A reference is required, such as ghcr.io/example/plugins@sha256:... or ghcr.io/example/plugins:1.0.";
    } else if (/\s/.test(ref)) {
      messages.ref = "A reference holds no whitespace.";
    }

    const mountError = artifactMountPathError(row.mountPath);

    if (mountError) {
      messages.mountPath = mountError;
    } else {
      const clean = cleanGuestPath(row.mountPath.trim());
      // The inner mount carries the message, wherever its row is; of two at one
      // path, the later row does.
      const outer = rows.find((candidate, otherIndex) => {
        if (otherIndex === index || artifactMountPathError(candidate.mountPath)) {
          return false;
        }

        const path = cleanGuestPath(candidate.mountPath.trim());

        return path === clean ? otherIndex < index : isUnderPath(clean, path);
      });

      if (outer) {
        const outerPath = cleanGuestPath(outer.mountPath.trim());

        messages.mountPath =
          outerPath === clean
            ? `${outer.name.trim() || "Another artifact"} is already mounted at ${clean}. Two artifacts cannot share a mount point.`
            : `${clean} is inside ${outerPath}, where ${outer.name.trim() || "another artifact"} is mounted. An artifact cannot be mounted inside another mount.`;
      }
    }

    if (row.optional) {
      const timeout = row.fetchTimeout.trim();

      if (timeout) {
        const ms = parseGoDurationMs(timeout);

        if (ms === undefined) {
          messages.fetchTimeout = "A fetch timeout is a Go duration, such as 10s or 2m.";
        } else if (ms < 0 || ms > maxFetchTimeoutMs) {
          messages.fetchTimeout = "A fetch timeout is between 0s and 5m.";
        }
      }
    }

    for (const field of ["pullSecret", "verifyKeySecret"] as const) {
      const secret = row[field].trim();

      if (secret && (secret.length > 253 || !dnsSubdomainPattern.test(secret))) {
        messages[field] =
          "A Secret name is at most 253 lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit.";
      }
    }

    messages.claimRows = keyValueRowErrors(row.claims, { syntax: "free", what: "the claims" });

    if (row.claims.length > maxArtifactClaims) {
      messages.claims = `This form offers at most ${maxArtifactClaims} claims per artifact. Remove ${row.claims.length - maxArtifactClaims}.`;
    }

    return messages;
  });

  return errors;
}

export type SandboxSecretFileField = "secretName" | "mode" | "items";

export interface SandboxSecretFileItemMessages {
  key?: string;
  path?: string;
  mode?: string;
}

export interface SandboxSecretFileMessages extends Partial<Record<SandboxSecretFileField, string>> {
  itemRows: SandboxSecretFileItemMessages[];
}

export interface SandboxSecretFileErrors {
  secretFiles?: string;
  rows: SandboxSecretFileMessages[];
}

/** Why a Secret file's guest path would be refused, or `undefined`. */
export function secretFilePathError(value: string): string | undefined {
  const path = value.trim();

  if (!path) {
    return "A path is required: it is the file the key is written to in the guest.";
  }

  if (!path.startsWith("/") || path === "/") {
    return "A path is an absolute file path, such as /etc/app/token.";
  }

  if (path.endsWith("/")) {
    return "A path names a file, so it does not end with '/'.";
  }

  if (path.split("/").some((part) => part === "." || part === "..")) {
    return "A path has no '.' or '..' component: it is written exactly where it reads.";
  }

  const reserved = reservedRootOf(cleanGuestPath(path));

  return reserved ? `A file cannot be written under ${reserved}, which the guest kernel owns.` : undefined;
}

/** Everything that would make the Secret files refuse the create. */
export function sandboxSecretFileErrors(workload: SandboxWorkloadValues): SandboxSecretFileErrors {
  const errors: SandboxSecretFileErrors = { rows: [] };
  const rows = workload.secretFiles;
  const seenPaths = new Set<string>();

  if (rows.length > maxSandboxSecretFiles) {
    errors.secretFiles = `The schema allows at most ${maxSandboxSecretFiles} Secret file entries. Remove ${rows.length - maxSandboxSecretFiles}.`;
  }

  errors.rows = rows.map((row) => {
    const messages: SandboxSecretFileMessages = { itemRows: [] };
    const secretName = row.secretName.trim();

    if (!secretName) {
      messages.secretName = "A Secret is required: its keys are what become files.";
    } else if (secretName.length > 253 || !dnsSubdomainPattern.test(secretName)) {
      messages.secretName =
        "A Secret name is at most 253 lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit.";
    }

    if (row.mode.trim() && parseFileMode(row.mode) === undefined) {
      messages.mode = fileModeMessage;
    }

    if (row.items.length === 0) {
      messages.items = "At least one item is required: the schema needs a key to write, or there is no file.";
    } else if (row.items.length > maxSecretFileItems) {
      messages.items = `The schema allows at most ${maxSecretFileItems} items per Secret. Remove ${row.items.length - maxSecretFileItems}.`;
    }

    messages.itemRows = row.items.map((item) => {
      const itemMessages: SandboxSecretFileItemMessages = {};
      const key = item.key.trim();
      const pathError = secretFilePathError(item.path);

      if (!key) {
        itemMessages.key = "A key is required: it names the entry of the Secret whose value becomes the file.";
      } else if (key.length > 253 || !secretKeyPattern.test(key)) {
        itemMessages.key = "A Secret key is at most 253 letters, digits, '-', '_' and '.'.";
      }

      if (pathError) {
        itemMessages.path = pathError;
      } else {
        const path = cleanGuestPath(item.path.trim());

        if (seenPaths.has(path)) {
          itemMessages.path = `Another item already writes ${path}: one file would silently replace the other.`;
        }

        seenPaths.add(path);
      }

      if (item.mode.trim() && parseFileMode(item.mode) === undefined) {
        itemMessages.mode = fileModeMessage;
      }

      return itemMessages;
    });

    return messages;
  });

  return errors;
}

/** What a label key in a domain KubeSwift keeps for itself is refused with. */
export function podLabelKeyRule(key: string): string | undefined {
  const slash = key.indexOf("/");
  const prefix = slash < 0 ? "" : key.slice(0, slash);

  if (prefix === "kubeswift.io" || prefix.endsWith(".kubeswift.io")) {
    return "Keys under kubeswift.io or any *.kubeswift.io domain are KubeSwift's own on the launcher pod, and the schema refuses them here.";
  }

  const network = podNetworkKeyPrefixes.find((candidate) => key.startsWith(candidate));

  return network
    ? `Keys under ${network} belong to the pod network KubeSwift wires itself, and are refused on the launcher pod's metadata.`
    : undefined;
}

export interface SandboxPodLabelErrors {
  podLabels?: string;
  rows: KeyValueMessages[];
}

export function sandboxPodLabelErrors(workload: SandboxWorkloadValues): SandboxPodLabelErrors {
  const errors: SandboxPodLabelErrors = {
    rows: keyValueRowErrors(workload.podLabels, {
      syntax: "label",
      what: "the pod labels",
      keyRule: podLabelKeyRule,
    }),
  };

  if (workload.podLabels.length > maxSandboxPodLabels) {
    errors.podLabels = `This form offers at most ${maxSandboxPodLabels} pod labels. Remove ${workload.podLabels.length - maxSandboxPodLabels}.`;
  }

  return errors;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface SandboxWorkloadIssue {
  label: string;
  message: string;
}

export function sandboxProbesIssues(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): SandboxWorkloadIssue[] {
  const issues: SandboxWorkloadIssue[] = [];

  for (const kind of sandboxProbeKinds) {
    const messages = sandboxProbeErrors(workload[kind], context);
    const label = sandboxProbeLabels[kind];
    const entries: [string, string | undefined][] = [
      [label, messages.probe],
      [`${label} path`, messages.path],
      [`${label} port`, messages.port],
      ...sandboxProbeNumberFields.map((field): [string, string | undefined] => [
        `${label} ${sandboxProbeNumberLabels[field]}`,
        messages[field],
      ]),
    ];

    for (const [name, text] of entries) {
      if (text) {
        issues.push({ label: name, message: text });
      }
    }
  }

  return issues;
}

export function sandboxTerminationIssues(workload: SandboxWorkloadValues): SandboxWorkloadIssue[] {
  const error = drainPeriodError(workload.drainPeriod);

  return error ? [{ label: "Drain period", message: error }] : [];
}

export function sandboxArtifactIssues(workload: SandboxWorkloadValues): SandboxWorkloadIssue[] {
  const errors = sandboxArtifactErrors(workload);
  const issues: SandboxWorkloadIssue[] = errors.artifacts ? [{ label: "Artifacts", message: errors.artifacts }] : [];

  errors.rows.forEach((messages, index) => {
    for (const field of sandboxArtifactFieldOrder) {
      const text = messages[field];

      if (text) {
        issues.push({ label: `Artifact ${index + 1} ${sandboxArtifactFieldLabels[field]}`, message: text });
      }
    }

    messages.claimRows.forEach((claim, claimIndex) => {
      for (const field of ["key", "value"] as const) {
        const text = claim[field];

        if (text) {
          issues.push({ label: `Artifact ${index + 1} claim ${claimIndex + 1} ${field}`, message: text });
        }
      }
    });
  });

  return issues;
}

export function sandboxSecretFileIssues(workload: SandboxWorkloadValues): SandboxWorkloadIssue[] {
  const errors = sandboxSecretFileErrors(workload);
  const issues: SandboxWorkloadIssue[] = errors.secretFiles
    ? [{ label: "Secret files", message: errors.secretFiles }]
    : [];

  errors.rows.forEach((messages, index) => {
    const label = `Secret file ${index + 1}`;

    for (const [field, text] of [
      ["Secret", messages.secretName],
      ["mode", messages.mode],
      ["items", messages.items],
    ] as const) {
      if (text) {
        issues.push({ label: `${label} ${field}`, message: text });
      }
    }

    messages.itemRows.forEach((item, itemIndex) => {
      for (const field of ["key", "path", "mode"] as const) {
        const text = item[field];

        if (text) {
          issues.push({ label: `${label} item ${itemIndex + 1} ${field}`, message: text });
        }
      }
    });
  });

  return issues;
}

export function sandboxPodLabelIssues(workload: SandboxWorkloadValues): SandboxWorkloadIssue[] {
  const errors = sandboxPodLabelErrors(workload);
  const issues: SandboxWorkloadIssue[] = errors.podLabels ? [{ label: "Pod labels", message: errors.podLabels }] : [];

  errors.rows.forEach((messages, index) => {
    for (const field of ["key", "value"] as const) {
      const text = messages[field];

      if (text) {
        issues.push({ label: `Pod label ${index + 1} ${field}`, message: text });
      }
    }
  });

  return issues;
}

/** Every reason the five sections block the submit, in their reading order. */
export function sandboxWorkloadBlockingIssues(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): SandboxWorkloadIssue[] {
  return [
    ...sandboxProbesIssues(workload, context),
    ...sandboxTerminationIssues(workload),
    ...sandboxArtifactIssues(workload),
    ...sandboxSecretFileIssues(workload),
    ...sandboxPodLabelIssues(workload),
  ];
}

// ---------------------------------------------------------------------------
// The warnings, which never block (W12).
// ---------------------------------------------------------------------------

function secretWarning(
  name: string,
  context: SandboxWorkloadContext,
  consequence: string,
  unverified: string,
): string | undefined {
  if (!name) {
    return undefined;
  }

  if (context.secretsUnverified) {
    return `The Secrets of this namespace could not be listed from here, so ${name} is unverified. ${unverified}`;
  }

  return context.secrets.includes(name) ? undefined : `No Secret named ${name} is in this namespace. ${consequence}`;
}

export interface SandboxArtifactWarnings {
  pullSecret?: string;
  verifyKeySecret?: string;
  mountPath?: string;
}

/** Per artifact: a Secret the read did not return, and a mount that overlaps the model's. */
export function sandboxArtifactWarnings(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): SandboxArtifactWarnings[] {
  return workload.artifacts.map((row) => {
    const warnings: SandboxArtifactWarnings = {};
    const consequence = row.optional
      ? "Nothing refuses the sandbox for it: the artifact cannot be pulled or verified, so the workload starts without it."
      : "Nothing refuses the sandbox for it: the artifact cannot be pulled or verified, which fails the sandbox.";
    const unverified = "A Secret that does not exist is not refused at admission.";
    const pull = secretWarning(row.pullSecret.trim(), context, consequence, unverified);
    const verify = secretWarning(row.verifyKeySecret.trim(), context, consequence, unverified);

    if (pull) {
      warnings.pullSecret = pull;
    }

    if (verify) {
      warnings.verifyKeySecret = verify;
    }

    const mountPath = row.mountPath.trim();
    const model = context.modelMountPath ? cleanGuestPath(context.modelMountPath) : undefined;

    if (model && mountPath.startsWith("/") && !artifactMountPathError(mountPath)) {
      const clean = cleanGuestPath(mountPath);

      if (isUnderPath(clean, model) || isUnderPath(model, clean)) {
        warnings.mountPath = `${clean} overlaps the model's mount at ${model}. An artifact is not meant to be mounted inside another mount, so this one may be refused when the sandbox starts.`;
      }
    }

    return warnings;
  });
}

/** Per Secret file entry: a Secret the read did not return. */
export function sandboxSecretFileWarnings(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): (string | undefined)[] {
  return workload.secretFiles.map((row) =>
    secretWarning(
      row.secretName.trim(),
      context,
      row.optional
        ? "The entry is optional, so its files are simply left out."
        : "Nothing refuses the sandbox for it: it waits Pending until the Secret exists, or until the entry is made optional.",
      row.optional
        ? "The entry is optional, so a missing Secret only leaves its files out."
        : "A missing Secret or key keeps the sandbox Pending.",
    ),
  );
}

/** A probe on a checkout of a pool the form could not read: its mode is unknown. */
export function sandboxProbeWarning(probe: SandboxProbeValues, context: SandboxWorkloadContext): string | undefined {
  return probe.enabled && context.checkout && context.networkMode === undefined
    ? "The pool's network mode could not be read from here. If its slots run with mode none, this probe can never reach the workload."
    : undefined;
}

/** Every warning of the five sections, for the summary. */
export function sandboxWorkloadWarnings(workload: SandboxWorkloadValues, context: SandboxWorkloadContext): string[] {
  const warnings: string[] = [];
  const probe = sandboxProbeKinds.map((kind) => sandboxProbeWarning(workload[kind], context)).find(Boolean);

  if (probe) {
    warnings.push(probe);
  }

  for (const row of sandboxArtifactWarnings(workload, context)) {
    for (const text of [row.pullSecret, row.verifyKeySecret, row.mountPath]) {
      if (text && !warnings.includes(text)) {
        warnings.push(text);
      }
    }
  }

  for (const text of sandboxSecretFileWarnings(workload, context)) {
    if (text && !warnings.includes(text)) {
      warnings.push(text);
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// The section-has-error questions, so a collapsed section opens itself (W4).
// ---------------------------------------------------------------------------

export function sandboxProbesSectionHasError(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): boolean {
  return sandboxProbesIssues(workload, context).length > 0;
}

export function sandboxTerminationSectionHasError(workload: SandboxWorkloadValues): boolean {
  return sandboxTerminationIssues(workload).length > 0;
}

export function sandboxArtifactsSectionHasError(workload: SandboxWorkloadValues): boolean {
  return sandboxArtifactIssues(workload).length > 0;
}

export function sandboxSecretFilesSectionHasError(workload: SandboxWorkloadValues): boolean {
  return sandboxSecretFileIssues(workload).length > 0;
}

export function sandboxPodLabelsSectionHasError(workload: SandboxWorkloadValues): boolean {
  return sandboxPodLabelIssues(workload).length > 0;
}

// ---------------------------------------------------------------------------
// The payload.
// ---------------------------------------------------------------------------

/** A probe's port as the CRD takes it: a number, or a name. */
function probePort(value: string): number | string {
  const text = value.trim();

  return /^\d+$/.test(text) ? Number.parseInt(text, 10) : text;
}

/** One probe as the CRD declares it, or `undefined` while it is off or has no port. */
export function sandboxProbePayload(probe: SandboxProbeValues): SwiftSandboxProbe | undefined {
  if (!probe.enabled || !probe.port.trim()) {
    return undefined;
  }

  const port = probePort(probe.port);
  const path = probe.path.trim();
  // The scheme is never sent: HTTP is the only one supported, and the default.
  const payload: SwiftSandboxProbe =
    probe.action === "http" ? { httpGet: path ? { path, port } : { port } } : { tcpSocket: { port } };

  for (const field of sandboxProbeNumberFields) {
    const value = wholeNumber(probe[field], field === "initialDelaySeconds" ? 0 : 1);

    if (value !== undefined && probe[field].trim()) {
      payload[field] = value;
    }
  }

  return payload;
}

/** One artifact as the CRD declares it, or `undefined` while it lacks a required field. */
export function sandboxArtifactPayload(row: SandboxArtifactRow): SwiftSandboxArtifact | undefined {
  const name = row.name.trim();
  const ref = row.ref.trim();
  const mountPath = row.mountPath.trim();

  if (!name || !ref || !mountPath) {
    return undefined;
  }

  const artifact: SwiftSandboxArtifact = { name, ref, mountPath };
  const layout = row.layout.trim();
  const fetchTimeout = row.fetchTimeout.trim();
  const pullSecret = row.pullSecret.trim();
  const verifyKey = row.verifyKeySecret.trim();
  const claims = keyValuePayload(row.claims);

  if (layout && layout !== artifactLayouts[0]) {
    artifact.layout = layout;
  }

  if (row.optional) {
    artifact.optional = true;

    if (fetchTimeout) {
      artifact.fetchTimeout = fetchTimeout;
    }
  }

  if (pullSecret) {
    artifact.pullSecretRef = { name: pullSecret };
  }

  if (verifyKey) {
    artifact.verifyKeySecretRef = { name: verifyKey };
  }

  if (row.requirePlatformVerification) {
    artifact.requirePlatformVerification = true;
  }

  if (claims) {
    artifact.claims = claims;
  }

  return artifact;
}

/** One Secret file entry as the CRD declares it, or `undefined` while it has no Secret or no complete item. */
export function sandboxSecretFilePayload(row: SandboxSecretFileRow): SwiftSandboxSecretFile | undefined {
  const secretName = row.secretName.trim();
  const items = row.items
    .filter((item) => item.key.trim() && item.path.trim())
    .map((item) => {
      const entry: SwiftSandboxSecretFileItem = { key: item.key.trim(), path: item.path.trim() };
      const mode = item.mode.trim() ? parseFileMode(item.mode) : undefined;

      if (mode !== undefined) {
        entry.mode = mode;
      }

      return entry;
    });

  if (!secretName || items.length === 0) {
    return undefined;
  }

  const entry: SwiftSandboxSecretFile = { secretName, items };
  const mode = row.mode.trim() ? parseFileMode(row.mode) : undefined;

  // 0400 is what an entry without a mode gets, so it is not re-sent.
  if (mode !== undefined && mode !== defaultSecretFileMode) {
    entry.mode = mode;
  }

  if (row.optional) {
    entry.optional = true;
  }

  return entry;
}

/** The workload keys of `spec`, each only when set. An untouched set of sections adds no key at all. */
export interface SandboxWorkloadPayload {
  readinessProbe?: SwiftSandboxProbe;
  livenessProbe?: SwiftSandboxProbe;
  termination?: SwiftSandboxTermination;
  artifacts?: SwiftSandboxArtifact[];
  secretFiles?: SwiftSandboxSecretFile[];
  podMetadata?: SwiftSandboxPodMetadata;
}

export function sandboxWorkloadPayload(workload: SandboxWorkloadValues): SandboxWorkloadPayload {
  const payload: SandboxWorkloadPayload = {};
  const readiness = sandboxProbePayload(workload.readiness);
  const liveness = sandboxProbePayload(workload.liveness);
  const drainPeriod = workload.drainPeriod.trim();
  const artifacts = workload.artifacts
    .map(sandboxArtifactPayload)
    .filter((artifact): artifact is SwiftSandboxArtifact => artifact !== undefined);
  const secretFiles = workload.secretFiles
    .map(sandboxSecretFilePayload)
    .filter((entry): entry is SwiftSandboxSecretFile => entry !== undefined);
  const labels = keyValuePayload(workload.podLabels);

  if (readiness) {
    payload.readinessProbe = readiness;
  }

  if (liveness) {
    payload.livenessProbe = liveness;
  }

  if (drainPeriod) {
    payload.termination = { drainPeriod };
  }

  if (artifacts.length > 0) {
    payload.artifacts = artifacts;
  }

  if (secretFiles.length > 0) {
    payload.secretFiles = secretFiles;
  }

  if (labels) {
    payload.podMetadata = { labels };
  }

  return payload;
}

// ---------------------------------------------------------------------------
// What the sections say: their header lines and their summary lines.
// ---------------------------------------------------------------------------

/** The default drain period in words, for the placeholder and the summary. */
export function defaultDrainPeriodText(context: SandboxWorkloadContext): string {
  if (context.checkout) {
    return `${defaultDrainWithPorts} when the sandbox exposes ports, else ${defaultDrainWithoutPorts}`;
  }

  return context.portNames.length > 0 ? defaultDrainWithPorts : defaultDrainWithoutPorts;
}

function describeProbe(probe: SandboxProbeValues): string {
  const port = probe.port.trim() || "<port>";

  return probe.action === "http"
    ? `GET ${probe.path.trim() || "(no path)"} on port ${port}`
    : `a TCP connect to port ${port}`;
}

export function sandboxProbesSectionHint(workload: SandboxWorkloadValues): string {
  const parts = sandboxProbeKinds
    .filter((kind) => workload[kind].enabled)
    .map((kind) => `${kind === "readiness" ? "Readiness" : "Liveness"}: ${describeProbe(workload[kind])}`);

  return parts.length > 0
    ? `${parts.join("; ")}.`
    : "None. The workload counts as ready once the guest runs, and nothing checks that it stays alive.";
}

export function sandboxTerminationSectionHint(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): string {
  const drain = workload.drainPeriod.trim();

  return drain
    ? `On delete, the workload keeps running for ${drain} after it leaves the Service endpoints.`
    : `The default drain period: ${defaultDrainPeriodText(context)}.`;
}

export function sandboxArtifactsSectionHint(workload: SandboxWorkloadValues): string {
  const names = workload.artifacts.map((row) => row.name.trim() || "<name>");

  return names.length > 0
    ? `${names.length} ${names.length === 1 ? "artifact" : "artifacts"} mounted read-only: ${names.join(", ")}.`
    : "None. No OCI artifact is mounted into the guest.";
}

export function sandboxSecretFilesSectionHint(workload: SandboxWorkloadValues): string {
  const files = workload.secretFiles.reduce((total, row) => total + row.items.length, 0);

  return workload.secretFiles.length > 0
    ? `${files} ${files === 1 ? "file" : "files"} from ${workload.secretFiles.map((row) => row.secretName.trim() || "<secret>").join(", ")}.`
    : "None. No Secret is written into the guest.";
}

export function sandboxPodLabelsSectionHint(workload: SandboxWorkloadValues): string {
  const labels = Object.entries(keyValuePayload(workload.podLabels) ?? {}).map(([key, value]) => `${key}=${value}`);

  return labels.length > 0
    ? `The launcher pod is labelled ${labels.join(", ")}.`
    : "None. The launcher pod carries only KubeSwift's own labels, so no Service of yours selects it.";
}

/** What a turned-on probe does, in one sentence per probe. */
export function sandboxProbeFacts(workload: SandboxWorkloadValues, context: SandboxWorkloadContext): string[] {
  const facts: string[] = [];
  const timing = (probe: SandboxProbeValues) =>
    `every ${probe.periodSeconds.trim() || sandboxProbeNumberDefaults.periodSeconds}s, from inside the launcher, ` +
    "so the port need not be exposed";

  if (workload.readiness.enabled) {
    facts.push(
      `The readiness probe runs ${describeProbe(workload.readiness)} ${timing(workload.readiness)}. Its result is the ` +
        "WorkloadReady condition" +
        (context.checkout || context.portNames.length > 0
          ? " and, with ports, the launcher pod's readiness: a Service routes to the sandbox only while it passes."
          : "."),
    );
  }

  if (workload.liveness.enabled) {
    facts.push(
      `The liveness probe runs ${describeProbe(workload.liveness)} ${timing(workload.liveness)}. After ` +
        `${workload.liveness.failureThreshold.trim() || sandboxProbeNumberDefaults.failureThreshold} failures in a row ` +
        "the workload is stopped and the sandbox ends Failed (LivenessProbeFailed). Nothing restarts it.",
    );
  }

  return facts;
}

/** What the drain period does, only when it is set. */
export function sandboxTerminationFact(workload: SandboxWorkloadValues): string | undefined {
  const drain = workload.drainPeriod.trim();

  return drain
    ? `On delete, the sandbox is first taken out of Service endpoints, then the workload keeps running for ${drain} ` +
        "(or until it exits) before the microVM is stopped: open connections keep working, new ones go elsewhere."
    : undefined;
}

/** What the artifacts are and what they need. */
export function sandboxArtifactFacts(workload: SandboxWorkloadValues, context: SandboxWorkloadContext): string[] {
  const artifacts = workload.artifacts
    .map(sandboxArtifactPayload)
    .filter((artifact): artifact is SwiftSandboxArtifact => artifact !== undefined);

  if (artifacts.length === 0) {
    return [];
  }

  const facts = artifacts.map((artifact) => {
    const parts = [
      `The artifact ${artifact.name} (${artifact.ref}) is mounted read-only at ${artifact.mountPath} as ` +
        `${artifact.layout === "unpacked" ? "an unpacked filesystem tree" : "an OCI image layout"}.`,
    ];

    parts.push(
      artifact.ref.includes("@")
        ? "Its digest pins exactly what is mounted."
        : "Its tag is resolved to a digest when the sandbox starts, and status.artifacts records which one.",
    );

    if (artifact.optional) {
      parts.push(
        `It is optional: if it cannot be resolved, fetched or verified within ${artifact.fetchTimeout ?? defaultFetchTimeout} ` +
          "of the sandbox's creation, the workload starts without it and nothing is mounted there. Verification is never skipped.",
      );
    } else {
      parts.push("It is required: if it cannot be resolved, fetched or verified, the sandbox fails.");
    }

    if (artifact.verifyKeySecretRef) {
      parts.push(
        `It is cosign-verified against ${artifact.verifyKeySecretRef.name} at its digest before it is mounted.`,
      );
    }

    if (artifact.claims) {
      parts.push(
        `It carries ${Object.keys(artifact.claims).length === 1 ? "a claim" : "claims"} a SwiftArtifactVerificationPolicy ` +
          "must find: claims that no policy of this namespace governs make the artifact refused, since nothing would check them.",
      );
    }

    if (artifact.requirePlatformVerification) {
      parts.push(
        "Platform verification is required: without a SwiftArtifactVerificationPolicy governing it in this namespace, " +
          `the artifact is refused${artifact.optional ? " (skipped, as it is optional)" : ""}.`,
      );
    }

    return parts.join(" ");
  });

  facts.push(
    "Artifacts need the sandbox kernel 6.6.14 or later, whose bridge can mount them; each is pulled on the node, " +
      "cached by digest and shared with the node's other sandboxes, and its pull Secret never enters the guest." +
      (context.checkout
        ? " On a checkout, a warm slot on kernel 6.6.15 or later takes them without a reboot; an older slot is not " +
          "claimed and the sandbox boots cold."
        : ""),
  );

  return facts;
}

/** What the Secret files are and what they need. */
export function sandboxSecretFileFacts(workload: SandboxWorkloadValues): string[] {
  const entries = workload.secretFiles
    .map(sandboxSecretFilePayload)
    .filter((entry): entry is SwiftSandboxSecretFile => entry !== undefined);

  if (entries.length === 0) {
    return [];
  }

  const facts = entries.map(
    (entry) =>
      `From the Secret ${entry.secretName}, ${entry.items.map((item) => `${item.key} is written to ${item.path}`).join(", ")}, ` +
      `mode ${formatFileMode(entry.mode ?? defaultSecretFileMode)} unless an item sets its own, before the workload starts.` +
      (entry.optional ? " The entry is optional: a missing Secret or key leaves its files out." : ""),
  );

  facts.push(
    "Secret files need the sandbox kernel 6.6.14 or later; an older one fails the sandbox rather than run without " +
      "them. The launcher reads the Secrets with its own account, and the files live only in the guest's in-memory " +
      "writable layer. A missing Secret or key keeps the sandbox Pending unless its entry is optional.",
  );

  return facts;
}

/** What the pod labels do, only when set. */
export function sandboxPodLabelFact(
  workload: SandboxWorkloadValues,
  context: SandboxWorkloadContext,
): string | undefined {
  const labels = keyValuePayload(workload.podLabels);

  if (!labels) {
    return undefined;
  }

  return (
    `${context.checkout ? "The claimed slot's pod" : "The launcher pod"} is labelled ` +
    `${Object.entries(labels)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ")}, which is what a Service of yours selects it by. The pod is privileged: labels that make another ` +
    "controller change it, such as a mesh's sidecar injection, are not supported."
  );
}

/** Every summary line of the five sections, in their reading order. */
export function sandboxWorkloadFacts(workload: SandboxWorkloadValues, context: SandboxWorkloadContext): string[] {
  const termination = sandboxTerminationFact(workload);
  const labels = sandboxPodLabelFact(workload, context);

  return [
    ...sandboxProbeFacts(workload, context),
    ...(termination ? [termination] : []),
    ...sandboxArtifactFacts(workload, context),
    ...sandboxSecretFileFacts(workload),
    ...(labels ? [labels] : []),
  ];
}

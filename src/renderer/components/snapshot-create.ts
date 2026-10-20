/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Take Snapshot dialog decides, as pure functions over
// structurally declared inputs (SPEC-0011, "Where the code lives"): the guard,
// the per-backend gating and its reasons, the field validation that replaces the
// admission webhook, the payload the create sends, the live write summary, and
// the sentences the outcome and failure notifications carry.
//
// Nothing here emits JSX, reads a store, or touches a host global. A fact only
// the renderer can know - which snapshots the store happens to hold, what time
// it is when the item is clicked - is taken as an argument, which is what keeps
// the interesting half of this dialog unit-testable without a cluster.
//
// What creating a SwiftSnapshot mechanically IS is the reason this module
// exists, and almost none of it is in the schema:
//
// - The backend decides what is captured; `includeMemory` is a documented no-op
//   and is never sent. `includeDisk` is a different verb (it force-stops the
//   source guest) and is never sent either.
// - A memory capture pauses the VM for the whole write, and with
//   `resumeAfterSnapshot: false` nothing in the cluster ever resumes it.
// - A memory capture of a guest that is not running does not fail: it parks in
//   `Pending` and requeues forever. That is why the gating below exists.
// - Every cross-field rule lives in a validating webhook that ships DISABLED by
//   default, so the same rules are enforced here, at the field, before submit.

import { writeFailurePrefix } from "./guest-actions";
import { guestRunningPhase, guestStoppedPhase } from "./guest-status";

import type {
  SwiftSnapshotBackendType,
  SwiftSnapshotDeletionPolicy,
  SwiftSnapshotSpec,
  SwiftStorageLocationKind,
} from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type { ActionGuard, ApiFailureFacts } from "./guest-actions";

/** The four backends the schema's enum allows, in the order the dialog offers them. */
export const snapshotBackendTypes: SwiftSnapshotBackendType[] = ["csi-volume-snapshot", "local", "s3", "oci"];

/** The three backends that capture memory, and therefore pause the VM. */
export const memoryBackendTypes: SwiftSnapshotBackendType[] = ["local", "s3", "oci"];

/** `swiftctl`'s own default, and the only backend that neither pauses the VM nor needs credentials. */
export const defaultBackendType: SwiftSnapshotBackendType = "csi-volume-snapshot";

/** The directory under which KubeSwift keeps `local` captures. */
export const hostPathPrefix = "/var/lib/kubeswift/snapshots/";

/**
 * The directory of a `local` capture, which KubeSwift derives from the
 * snapshot's namespace and name since v0.15.0: `spec.backend.local.hostPath`
 * must be omitted or be exactly this. The form writes it rather than omitting
 * it, because a cluster before v0.15.0 requires a directory under the prefix,
 * and this one is accepted by both.
 */
export function localSnapshotDirectory(namespace: string, name: string): string {
  return `${hostPathPrefix}${namespace}_${name}`;
}

/** The tag KubeSwift gives an `oci` snapshot whose spec names none. */
export function defaultOciTag(namespace: string, name: string): string {
  return `${namespace}-${name}`;
}

/**
 * Where an `oci` or csi snapshot goes (SPEC-0019 T4): the default storage
 * location (the namespace's, else the cluster's), a location picked by name,
 * or the backend's own fields (a registry, a VolumeSnapshotClass).
 */
export type SnapshotDestination = "default" | "location" | "explicit";

/** The two backends a storage location serves. */
export function usesDestination(backend: SwiftSnapshotBackendType): boolean {
  return backend === "oci" || backend === "csi-volume-snapshot";
}

/** A storage location, as the picker and the checks read it. */
export interface StorageLocationChoice {
  kind: SwiftStorageLocationKind;
  name: string;
  /** Whether it sets a registry, and whether it sets a VolumeSnapshotClass. */
  hasOci: boolean;
  hasCsi: boolean;
  isDefault: boolean;
  /** The Ready condition: `false` with its message when the controller refused the location. */
  ready?: boolean;
  readyMessage?: string;
  /** The Secret the registry is reached with in the snapshot's namespace, `undefined` when anonymous. */
  credentialsSecretName?: string;
  signingKeySecretName?: string;
  repository?: string;
}

/** What the reads on open found about storage locations. */
export interface StorageLocationFacts {
  /** `unavailable`: the lists were refused, or the cluster has no storage locations (KubeSwift before v0.16.0). */
  state: "loading" | "ready" | "unavailable";
  choices: StorageLocationChoice[];
}

/** The picker value of a location. */
export function storageLocationValue(kind: SwiftStorageLocationKind, name: string): string {
  return `${kind}/${name}`;
}

export function parseStorageLocationValue(value: string): { kind: SwiftStorageLocationKind; name: string } | undefined {
  const match = /^(SwiftStorageLocation|SwiftClusterStorageLocation)\/(.+)$/.exec(value);

  return match ? { kind: match[1] as SwiftStorageLocationKind, name: match[2] } : undefined;
}

/** How a location reads in the form and in the summary: a cluster one as `cluster/<name>`, as swiftctl writes it. */
export function storageLocationLabel(choice: { kind: SwiftStorageLocationKind; name: string }): string {
  return choice.kind === "SwiftClusterStorageLocation" ? `cluster/${choice.name}` : choice.name;
}

/** Why a location cannot serve a backend, or `undefined` when it can. */
export function storageLocationRefusal(
  choice: StorageLocationChoice,
  backend: SwiftSnapshotBackendType,
): string | undefined {
  if (backend === "oci" && !choice.hasOci) {
    return "it sets no registry";
  }

  if (backend === "csi-volume-snapshot" && !choice.hasCsi) {
    return "it sets no VolumeSnapshotClass";
  }

  return undefined;
}

/**
 * The location KubeSwift would resolve for a snapshot that names none: the
 * namespace's default, else the cluster's. `ambiguous` when a level has two
 * defaults, which KubeSwift refuses rather than pick one.
 */
export function defaultStorageLocation(choices: StorageLocationChoice[]): {
  choice?: StorageLocationChoice;
  ambiguous: boolean;
} {
  for (const kind of ["SwiftStorageLocation", "SwiftClusterStorageLocation"] as const) {
    const defaults = choices.filter((choice) => choice.kind === kind && choice.isDefault);

    if (defaults.length > 1) {
      return { ambiguous: true };
    }

    if (defaults.length === 1) {
      return { choice: defaults[0], ambiguous: false };
    }
  }

  return { ambiguous: false };
}

/** The location the form's destination resolves to, when it resolves to one the lists hold. */
export function resolvedStorageLocation(
  values: SnapshotFormValues,
  locations: StorageLocationFacts,
): StorageLocationChoice | undefined {
  if (!usesDestination(values.backend) || locations.state !== "ready") {
    return undefined;
  }

  if (values.destination === "default") {
    return defaultStorageLocation(locations.choices).choice;
  }

  if (values.destination === "location") {
    const picked = parseStorageLocationValue(values.location);

    return locations.choices.find((choice) => choice.kind === picked?.kind && choice.name === picked?.name);
  }

  return undefined;
}

/**
 * What a storage-location destination would still be accepted with, and wait
 * or fail on (SPEC-0019 T4). Never blocks: the lists can be stale, and the
 * snapshot reports the same reason on its own.
 */
export function storageLocationWarning(
  values: SnapshotFormValues,
  locations: StorageLocationFacts,
  secretNames: string[] | undefined,
): string | undefined {
  if (!usesDestination(values.backend) || values.destination === "explicit") {
    return undefined;
  }

  if (locations.state === "unavailable" && values.backend === "oci" && values.destination === "default") {
    return (
      "The storage locations could not be listed. If this cluster has none (KubeSwift before v0.16.0), an oci " +
      "snapshot needs a registry: choose the Registry destination."
    );
  }

  if (locations.state !== "ready") {
    return undefined;
  }

  if (values.destination === "default") {
    const resolved = defaultStorageLocation(locations.choices);

    if (resolved.ambiguous) {
      return (
        "Two storage locations are marked default at the same level, so KubeSwift resolves neither and the " +
        "snapshot waits Pending (AmbiguousStorageLocation)."
      );
    }

    if (!resolved.choice) {
      return values.backend === "oci"
        ? "No storage location is marked default here or for the cluster, so the snapshot waits Pending " +
            "(NoStorageLocation). Pick a location or a registry."
        : undefined;
    }
  }

  const choice = resolvedStorageLocation(values, locations);

  if (!choice) {
    return undefined;
  }

  const refusal = storageLocationRefusal(choice, values.backend);

  if (refusal) {
    return values.destination === "default" && values.backend === "csi-volume-snapshot"
      ? undefined
      : `The storage location ${storageLocationLabel(choice)} cannot serve this backend: ${refusal}.`;
  }

  if (choice.ready === false) {
    return `The storage location ${storageLocationLabel(choice)} is not ready${choice.readyMessage ? `: ${choice.readyMessage}` : "."}`;
  }

  if (values.backend === "oci" && secretNames) {
    if (choice.credentialsSecretName && !secretNames.includes(choice.credentialsSecretName)) {
      return (
        `The location reaches its registry with the Secret ${choice.credentialsSecretName}, which this ` +
        "namespace does not have: the snapshot waits Pending (RegistryCredentialsMissing) until it exists."
      );
    }

    if (choice.signingKeySecretName && !secretNames.includes(choice.signingKeySecretName)) {
      return (
        `The location signs with the Secret ${choice.signingKeySecretName}, which this namespace does not ` +
        "have: the snapshot waits Pending (SigningKeyMissing) until it exists."
      );
    }
  }

  return undefined;
}

/** The annotation that switches a guest to a hypervisor upstream cannot pause for a capture. */
export const hypervisorOverrideAnnotation = "kubeswift.io/hypervisor-override";
export const qemuHypervisorOverride = "qemu";

/** The interface type upstream's admission rule refuses to pause. */
export const sriovInterfaceType = "sriov";

/** The phases in which a csi capture proceeds instead of waiting. */
export const settledGuestPhases: string[] = [guestRunningPhase, guestStoppedPhase];

/** The two deletion policies, in the order the dialog offers them. */
export const deletionPolicies: SwiftSnapshotDeletionPolicy[] = ["Delete", "Retain"];

/** What a SwiftGuest's spec must look like for these functions to read it. */
export interface SnapshotGuestSpecFacts {
  gpuProfileRef?: { name?: string };
  interfaces?: { name?: string; type?: string }[];
}

/** What a SwiftGuest's status must look like for these functions to read it. */
export interface SnapshotGuestStatusFacts {
  phase?: string;
  podRef?: { name?: string };
}

/**
 * The slice of a SwiftGuest this dialog works on, built from the live object at
 * click time so the gating and the summary quote the same facts (W1).
 */
export interface SnapshotGuestFacts {
  name: string;
  namespace: string;
  /** The metadata annotations, as the host's own optional-valued map hands them over. */
  annotations?: Record<string, string | undefined>;
  spec?: SnapshotGuestSpecFacts;
  status?: SnapshotGuestStatusFacts;
}

const enabledGuard: ActionGuard = { enabled: true };

function disabled(reason: string): ActionGuard {
  return { enabled: false, reason };
}

/**
 * Whether the item offers to snapshot this guest at all.
 *
 * Always yes: there is a valid snapshot for every settled guest state (csi
 * accepts `Running` and `Stopped`), and for the unsettled ones creating early is
 * safe - the object waits in `Pending` and the summary says so. The gating that
 * matters is per-backend and lives inside the dialog, where the backend choice
 * exists; a menu-item guard cannot see a field the user has not chosen yet.
 *
 * The function exists anyway, and returns the same `{ enabled, reason }` shape
 * as every other guard, so the click handler re-evaluates one thing rather than
 * two and the unit-test shape stays uniform (W4). The `deletionTimestamp`
 * exception is the component's, as in SPEC-0010: a terminating object gets no
 * action item at all.
 */
export function canTakeSnapshot(_guest: SnapshotGuestFacts): ActionGuard {
  return enabledGuard;
}

/** What a backend captures, the same derivation the Contents column uses (SPEC-0004). */
export function backendContents(type: SwiftSnapshotBackendType): string {
  switch (type) {
    case "csi-volume-snapshot":
      return "Disk";
    case "oci":
      return "Memory";
    default:
      return "Memory + disk";
  }
}

/**
 * A backend's name behind the indefinite article English gives it, for the
 * sentences that put one in front of it.
 *
 * `s3` and `oci` are read out letter by letter and start on a vowel sound, so
 * they take "an" - interpolating the raw name produced "a s3 capture" in every
 * sentence that named a tier. The article is a property of the name rather than
 * of the sentence, so every sentence that needs one asks here.
 */
export function backendWithArticle(type: SwiftSnapshotBackendType): string {
  return type === "s3" || type === "oci" ? `an ${type}` : `a ${type}`;
}

/** Whether this backend captures memory, and therefore pauses the VM. */
export function isMemoryBackend(type: SwiftSnapshotBackendType): boolean {
  return memoryBackendTypes.includes(type);
}

/** The SR-IOV interfaces of a guest, by name, for the reason a memory capture is refused. */
function sriovInterfaceNames(guest: SnapshotGuestFacts): string[] {
  return (guest.spec?.interfaces ?? [])
    .filter((networkInterface) => networkInterface.type === sriovInterfaceType)
    .map((networkInterface, index) => networkInterface.name || `interface ${index + 1}`);
}

/**
 * Whether a memory capture of this guest can be offered, and why not when it
 * cannot (W4).
 *
 * The live-state rule is checked FIRST, deliberately: it is the one the operator
 * can act on (start the guest, then take the snapshot), while the three
 * admission rules below it are properties of the guest's own shape that starting
 * it would not change. A refusal a user can fix is worth more than a refusal
 * that is merely earlier.
 *
 * All four refusals describe upstream behaviour rather than our own preference:
 * the first is the controller's requeue-forever loop, and the other three are
 * the validating webhook's own rules - enforced here because that webhook ships
 * disabled, so on a default install nobody else would ever produce them.
 */
export function memoryCaptureGuard(guest: SnapshotGuestFacts): ActionGuard {
  const phase = guest.status?.phase;
  const podRecorded = Boolean(guest.status?.podRef?.name);

  if (phase !== guestRunningPhase || !podRecorded) {
    const phaseText = phase ? `is ${phase}` : "has no phase yet";
    const podText = podRecorded ? "" : " and no launcher pod is recorded";

    return disabled(
      `A memory capture needs the running VM. This guest ${phaseText}${podText}, so upstream would park the ` +
        "snapshot in Pending forever rather than fail it.",
    );
  }

  const gpuProfile = guest.spec?.gpuProfileRef?.name;

  if (gpuProfile) {
    return disabled(
      `Upstream cannot pause a guest that holds a GPU safely, and its own admission rule refuses a memory capture ` +
        `of one: this guest uses the GPU profile ${gpuProfile}.`,
    );
  }

  const sriov = sriovInterfaceNames(guest);

  if (sriov.length > 0) {
    return disabled(
      "Upstream cannot pause a guest with an SR-IOV interface safely, and its own admission rule refuses a memory " +
        `capture of one: this guest has ${sriov.join(", ")}.`,
    );
  }

  if (guest.annotations?.[hypervisorOverrideAnnotation] === qemuHypervisorOverride) {
    return disabled(
      `This guest carries the annotation ${hypervisorOverrideAnnotation}: ${qemuHypervisorOverride}, and upstream's ` +
        "admission rule refuses a memory capture of a guest it does not drive through Cloud Hypervisor.",
    );
  }

  return enabledGuard;
}

/** One backend option of the dialog's select, with what it captures and whether it can be chosen. */
export interface BackendChoice {
  type: SwiftSnapshotBackendType;
  /** What this backend captures, from the Contents derivation. */
  contents: string;
  guard: ActionGuard;
}

/**
 * The four backend options, each carrying its Contents reading and its verdict.
 *
 * csi is never gated: the controller accepts `Running` and `Stopped`, and every
 * other phase waits in `Pending` until the guest settles, which the summary says
 * out loud instead of refusing.
 */
export function backendChoices(guest: SnapshotGuestFacts): BackendChoice[] {
  const memory = memoryCaptureGuard(guest);

  return snapshotBackendTypes.map((type) => ({
    type,
    contents: backendContents(type),
    guard: isMemoryBackend(type) ? memory : enabledGuard,
  }));
}

/** Whether a csi capture of this guest would wait rather than start. */
export function csiCaptureWaits(guest: SnapshotGuestFacts): boolean {
  return !settledGuestPhases.includes(guest.status?.phase ?? "");
}

/** Every field the form holds, in one flat object so the model is one observable. */
export interface SnapshotFormValues {
  name: string;
  backend: SwiftSnapshotBackendType;
  /** csi: empty means the cluster's default VolumeSnapshotClass. */
  volumeSnapshotClassName: string;
  bucket: string;
  region: string;
  endpoint: string;
  prefix: string;
  s3CredentialsSecret: string;
  forcePathStyle: boolean;
  s3Insecure: boolean;
  repository: string;
  tag: string;
  ociCredentialsSecret: string;
  signingKeySecret: string;
  ociInsecure: boolean;
  /** oci and csi: where the snapshot goes (SPEC-0019 T4). */
  destination: SnapshotDestination;
  /** The picked location, as `<kind>/<name>` (see `storageLocationValue`). */
  location: string;
  resumeAfterSnapshot: boolean;
  deletionPolicy: SwiftSnapshotDeletionPolicy;
  ttl: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The default name: the guest's, plus the local wall-clock instant of the click.
 *
 * Local rather than UTC because the operator reads it against their own clock,
 * and to the second because that is the resolution at which a human takes two
 * snapshots of one guest. Upstream's default collides on the second snapshot of
 * the same guest, which is the failure this shape removes (C6).
 */
export function defaultSnapshotName(guestName: string, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `${guestName}-${stamp}`;
}

/** The form the dialog opens with. Every default is the one the spec's field table names. */
export function defaultSnapshotForm(guest: SnapshotGuestFacts, now: Date): SnapshotFormValues {
  return {
    name: defaultSnapshotName(guest.name, now),
    backend: defaultBackendType,
    volumeSnapshotClassName: "",
    bucket: "",
    region: "",
    endpoint: "",
    prefix: "",
    s3CredentialsSecret: "",
    forcePathStyle: false,
    s3Insecure: false,
    repository: "",
    tag: "",
    ociCredentialsSecret: "",
    signingKeySecret: "",
    ociInsecure: false,
    destination: "default",
    location: "",
    resumeAfterSnapshot: true,
    deletionPolicy: "Delete",
    ttl: "",
  };
}

/** The fields validation and the warnings are keyed on, so a message renders next to its input. */
export type SnapshotField =
  | "name"
  | "volumeSnapshotClassName"
  | "bucket"
  | "region"
  | "endpoint"
  | "prefix"
  | "s3CredentialsSecret"
  | "repository"
  | "tag"
  | "ociCredentialsSecret"
  | "signingKeySecret"
  | "location"
  | "ttl";

/** One message per field, absent when the field has nothing to say. */
export type SnapshotFieldMessages = Partial<Record<SnapshotField, string>>;

/** How the submit-disabled sentence names each field (W4: it always names the field AND the reason). */
export const snapshotFieldLabels: Record<SnapshotField, string> = {
  name: "Name",
  volumeSnapshotClassName: "VolumeSnapshotClass",
  bucket: "Bucket",
  region: "Region",
  endpoint: "Endpoint",
  prefix: "Prefix",
  s3CredentialsSecret: "Credentials secret",
  repository: "Repository",
  tag: "Tag",
  ociCredentialsSecret: "Credentials secret",
  signingKeySecret: "Signing key secret",
  location: "Storage location",
  ttl: "TTL",
};

/** The order the submit-disabled sentence reports the first offending field in. */
const fieldOrder: SnapshotField[] = [
  "name",
  "bucket",
  "s3CredentialsSecret",
  "region",
  "location",
  "volumeSnapshotClassName",
  "repository",
  "tag",
  "ttl",
];

/** The Kubernetes object-name rule (RFC 1123 subdomain), which the API server would enforce afterwards. */
const objectNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/**
 * Why a typed object name would be refused, or `undefined` when it is legal.
 *
 * Shared with the Restore dialog, which creates an object of a different kind
 * under exactly the same rule: this is the API server's, not KubeSwift's, and it
 * is the one validation in these forms that has nothing to do with the CRD.
 */
export function objectNameError(name: string): string | undefined {
  if (!name) {
    return "A name is required.";
  }

  if (name.length > 253 || !objectNamePattern.test(name)) {
    return (
      "A name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit, at most " +
      "253 characters."
    );
  }

  return undefined;
}

/**
 * A Go duration, which is what `ttl` really is.
 *
 * The schema declares a bare string, but the field deserializes to
 * `metav1.Duration`, so the API server's own decoder parses it with
 * `time.ParseDuration`: `30m`, `72h` and `1h30m` are fine and `7d` is not,
 * because days are not one of the units. The rejection would otherwise arrive as
 * a decoder error no user should have to read (C8).
 */
const goDurationPattern = /^[+-]?(\d+(\.\d+)?(ns|us|µs|μs|ms|s|m|h))+$/;

/** The message the TTL field carries when it does not parse, naming the units and the missing one. */
export const ttlFormatMessage =
  "TTL must be a Go duration, like 30m, 12h or 1h30m. The units are ns, us, ms, s, m and h - days are not one of " +
  "them, so a week is 168h rather than 7d.";

/**
 * Everything that would make this create fail, keyed by field.
 *
 * These are the admission webhook's own rules. Upstream ships that webhook
 * disabled by default (`webhook.enabled: false`), so on a normal install nobody
 * produces these messages at all and the mistake surfaces much later as a
 * `Failed` phase or a permanent `Pending` (C2).
 */
export function snapshotErrors(values: SnapshotFormValues): SnapshotFieldMessages {
  const errors: SnapshotFieldMessages = {};
  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  if (values.backend === "s3") {
    if (!values.bucket.trim()) {
      errors.bucket = "A bucket is required.";
    }

    if (!values.s3CredentialsSecret.trim()) {
      errors.s3CredentialsSecret =
        "A Secret holding accessKeyId and secretAccessKey is required. Create it with the host's own editor if it " +
        "does not exist yet.";
    }

    if (!values.region.trim() && !values.endpoint.trim()) {
      errors.region = "A region is required unless an endpoint is set.";
    }
  }

  if (usesDestination(values.backend) && values.destination === "location" && !values.location) {
    errors.location = "Choose a storage location, or another destination.";
  }

  if (values.backend === "csi-volume-snapshot" && values.destination === "explicit") {
    if (!values.volumeSnapshotClassName.trim()) {
      errors.volumeSnapshotClassName = "A VolumeSnapshotClass is required for this destination.";
    }
  }

  if (values.backend === "oci" && values.destination === "explicit") {
    if (!values.repository.trim()) {
      errors.repository = "A repository is required, without a tag.";
    }

    const tag = values.tag.trim();

    if (tag && /[:@/]/.test(tag)) {
      errors.tag = "The tag must be a bare tag: no ':', '@' or '/'. The repository field carries the rest.";
    }
  }

  const ttl = values.ttl.trim();

  if (ttl && !goDurationPattern.test(ttl)) {
    errors.ttl = ttlFormatMessage;
  }

  return errors;
}

/** A SwiftSnapshot the store or a list call already holds, as the collision checks read it. */
export interface ExistingSnapshotFacts {
  name: string;
  namespace: string;
  /** The registry reference of an `oci` snapshot, with the tag KubeSwift gives it when the spec names none. */
  ociReference?: string;
}

/** The `repository:tag` an `oci` snapshot pushes to, or `undefined` for another backend or no repository yet. */
export function ociReference(
  namespace: string,
  name: string,
  backend: { type?: string; oci?: { repository?: string; tag?: string } } | undefined,
): string | undefined {
  const repository = backend?.oci?.repository?.trim();

  if (backend?.type !== "oci" || !repository) {
    return undefined;
  }

  return `${repository}:${backend.oci?.tag?.trim() || defaultOciTag(namespace, name)}`;
}

/**
 * Everything worth saying about a field that would still be accepted, keyed by
 * field.
 *
 * Warnings never block (the rejected-candidates table is explicit about it): the
 * store can be stale, the API server is the authority, and a warned submit that
 * 409s is honest where a blocked one is a client-side heuristic in the driver's
 * seat. A store that holds nothing - a cold Snapshots page - simply produces no
 * warnings, and the 409 path stays as the backstop.
 */
export function snapshotWarnings(
  guest: SnapshotGuestFacts,
  values: SnapshotFormValues,
  existing: ExistingSnapshotFacts[],
): SnapshotFieldMessages {
  const warnings: SnapshotFieldMessages = {};
  const name = values.name.trim();

  if (name && existing.some((snapshot) => snapshot.namespace === guest.namespace && snapshot.name === name)) {
    warnings.name =
      "A SwiftSnapshot with this name already exists in this namespace. Submitting will be refused by the API " +
      "server; the fix is a different name.";
  }

  // Since KubeSwift v0.16.0 two oci snapshots may not share a repository:tag:
  // the second is created, and then fails with TagInUse. Only a client that
  // already holds the cluster's snapshots can see it coming.
  const reference =
    name && values.destination === "explicit"
      ? ociReference(guest.namespace, name, {
          type: values.backend,
          oci: { repository: values.repository, tag: values.tag },
        })
      : undefined;
  const holder = reference
    ? existing.find(
        (snapshot) =>
          snapshot.ociReference === reference && !(snapshot.namespace === guest.namespace && snapshot.name === name),
      )
    : undefined;

  if (holder) {
    warnings.tag =
      `The snapshot ${holder.namespace}/${holder.name} already pushes to ${reference}. KubeSwift v0.16.0 and later ` +
      "fail a second snapshot on the same repository and tag (TagInUse); the fix is another tag.";
  }

  return warnings;
}

/**
 * Why the submit button is disabled, naming the field and the reason (W4 applied
 * to submit buttons), or `undefined` when the form can be sent.
 *
 * A mute grey button is the thing this exists to prevent: the reason is rendered
 * next to the offending field as well, and this sentence is what the button
 * itself carries.
 */
export function submitBlockReason(values: SnapshotFormValues): string | undefined {
  const errors = snapshotErrors(values);
  const field = fieldOrder.find((candidate) => errors[candidate]);

  return field ? `${snapshotFieldLabels[field]}: ${errors[field]}` : undefined;
}

/**
 * Whether the OK button takes the accent styling Stop uses.
 *
 * Exactly one combination earns it: a memory capture with Resume after capture
 * unchecked terminates service until a human intervenes, which is the same class
 * of consequence as stopping a guest. A snapshot is otherwise not destructive
 * and does not get a red button.
 */
export function submitIsAccented(values: SnapshotFormValues): boolean {
  return isMemoryBackend(values.backend) && !values.resumeAfterSnapshot;
}

/**
 * The spec the create sends: exactly the fields the form owns, and never
 * `includeMemory` or `includeDisk`.
 *
 * `includeMemory` is a documented no-op the backend overrides, and upstream's
 * own forms contradict each other about it; `includeDisk` is a different verb
 * (it force-stops the source guest to release its root PVC) which this spec puts
 * out of scope. Carrier exclusivity is not validated here because this shape
 * cannot express it: the backend type picks exactly one carrier object.
 *
 * The API server fills the schema defaults (`deletionPolicy`, `includeMemory`,
 * `resumeAfterSnapshot`) into whatever this omits.
 */
export function snapshotCreatePayload(
  guest: SnapshotGuestFacts,
  values: SnapshotFormValues,
): { spec: SwiftSnapshotSpec } {
  const spec: SwiftSnapshotSpec = {
    guestRef: { name: guest.name },
    backend: { type: values.backend },
    deletionPolicy: values.deletionPolicy,
  };

  const ttl = values.ttl.trim();

  if (ttl) {
    spec.ttl = ttl;
  }

  if (isMemoryBackend(values.backend)) {
    spec.resumeAfterSnapshot = values.resumeAfterSnapshot;
  }

  const location = usesDestination(values.backend) ? parseStorageLocationValue(values.location) : undefined;

  // A location is not valid next to backend.oci or a csi class, which say it
  // themselves; "default" writes neither, and KubeSwift resolves the
  // namespace's default location, else the cluster's (SPEC-0019 T4).
  if (location && values.destination === "location") {
    spec.backend.locationRef = { kind: location.kind, name: location.name };
  }

  if (values.backend === "csi-volume-snapshot" && values.destination === "explicit") {
    const volumeSnapshotClassName = values.volumeSnapshotClassName.trim();

    if (volumeSnapshotClassName) {
      spec.backend.csiVolumeSnapshot = { volumeSnapshotClassName };
    }
  }

  if (values.backend === "local") {
    spec.backend.local = { hostPath: localSnapshotDirectory(guest.namespace, values.name.trim()) };
  }

  if (values.backend === "s3") {
    spec.backend.s3 = {
      bucket: values.bucket.trim(),
      credentialsSecretRef: { name: values.s3CredentialsSecret.trim() },
    };

    const region = values.region.trim();
    const endpoint = values.endpoint.trim();
    const prefix = values.prefix.trim();

    if (region) {
      spec.backend.s3.region = region;
    }

    if (endpoint) {
      spec.backend.s3.endpoint = endpoint;
    }

    if (prefix) {
      spec.backend.s3.prefix = prefix;
    }

    if (values.forcePathStyle) {
      spec.backend.s3.forcePathStyle = true;
    }

    if (values.s3Insecure) {
      spec.backend.s3.insecure = true;
    }
  }

  if (values.backend === "oci" && values.destination === "explicit") {
    spec.backend.oci = { repository: values.repository.trim() };

    const tag = values.tag.trim();
    const credentials = values.ociCredentialsSecret.trim();
    const signingKey = values.signingKeySecret.trim();

    if (tag) {
      spec.backend.oci.tag = tag;
    }

    if (credentials) {
      spec.backend.oci.credentialsSecretRef = { name: credentials };
    }

    if (signingKey) {
      spec.backend.oci.signingKeySecretRef = { name: signingKey };
    }

    if (values.ociInsecure) {
      spec.backend.oci.insecure = true;
    }
  }

  return { spec };
}

/**
 * What `resumeAfterSnapshot: false` costs, in the words the summary and the
 * checkbox both use.
 *
 * swiftletd skips the resume and returns; the snapshot still reaches `Ready`;
 * nothing anywhere ever resumes the guest, whose phase stays `Running` while its
 * vCPUs are frozen. It is the single most dangerous control in this dialog,
 * which is why the sentence is rendered twice: next to the checkbox, at the
 * moment the cost is chosen, and in the summary, which has to enumerate the
 * whole write on its own.
 */
export const frozenVmWarning =
  "Resume after capture is off: nothing in the cluster ever resumes this VM. It stays paused indefinitely - with " +
  "the guest still reporting Running and the snapshot reading Ready - until someone intervenes.";

/** The facts the live write summary is built from. The component owns the JSX. */
export interface SnapshotSummaryFacts {
  /** The one API call this dialog makes (W1). */
  write: string;
  /** What the create means, each line rendered only when it is true of this object. */
  notes: string[];
  /** What it costs, in the warning style. */
  warnings: string[];
}

/** Where the artifacts land, when the form names a destination. */
/** Where a storage-location destination sends the snapshot. */
function locationDestinationNote(
  guest: SnapshotGuestFacts,
  values: SnapshotFormValues,
  locations: StorageLocationFacts | undefined,
): string {
  const resolved = locations ? resolvedStorageLocation(values, locations) : undefined;
  const picked = values.destination === "location" ? parseStorageLocationValue(values.location) : undefined;
  const named = resolved ?? picked;
  const which = named
    ? `the storage location ${storageLocationLabel(named)}${values.destination === "default" ? " (the default)" : ""}`
    : "the default storage location (the namespace's, else the cluster's)";

  if (values.backend === "csi-volume-snapshot") {
    return values.destination === "default"
      ? `The VolumeSnapshot takes its class from ${which}, else the cluster's default VolumeSnapshotClass.`
      : `The VolumeSnapshot takes its class from ${which}.`;
  }

  const repository = resolved?.repository
    ? resolved.kind === "SwiftClusterStorageLocation"
      ? `${resolved.repository}/${guest.namespace}/snapshots`
      : `${resolved.repository}/snapshots`
    : undefined;

  return (
    `The artifact is pushed through ${which}` +
    (repository ? `, to ${repository}` : "") +
    ", tagged with the snapshot's name and a part of its uid, so no other snapshot can hold the tag."
  );
}

function destinationNote(
  guest: SnapshotGuestFacts,
  values: SnapshotFormValues,
  locations?: StorageLocationFacts,
): string | undefined {
  if (usesDestination(values.backend) && values.destination !== "explicit") {
    return locationDestinationNote(guest, values, locations);
  }

  switch (values.backend) {
    case "csi-volume-snapshot": {
      const className = values.volumeSnapshotClassName.trim();

      return className
        ? `The VolumeSnapshot is created with the class ${className}.`
        : "The VolumeSnapshot is created with the cluster's default VolumeSnapshotClass.";
    }
    case "local": {
      const name = values.name.trim();

      return name
        ? `The artifacts are written to ${localSnapshotDirectory(guest.namespace, name)} on the guest's node, the ` +
            "directory KubeSwift derives from the snapshot's namespace and name."
        : undefined;
    }
    case "s3": {
      const bucket = values.bucket.trim();
      const prefix = values.prefix.trim();

      if (!bucket) {
        return undefined;
      }

      return prefix
        ? `The artifacts are uploaded to the bucket ${bucket}, under ${prefix}.`
        : `The artifacts are uploaded to the bucket ${bucket}.`;
    }
    default: {
      const repository = values.repository.trim();

      if (!repository) {
        return undefined;
      }

      const tag = values.tag.trim();

      return tag
        ? `The artifact is pushed to ${repository}:${tag}.`
        : `The artifact is pushed to ${repository}, tagged <namespace>-<name> by the server.`;
    }
  }
}

/** What the chosen backend captures, in a sentence rather than a column value. */
function contentsNote(values: SnapshotFormValues): string {
  switch (values.backend) {
    case "csi-volume-snapshot":
      return "This captures the root disk only, crash-consistent, and never pauses the VM.";
    case "oci":
      return "This captures the guest's memory and pushes it to the registry; the disk is not copied.";
    default:
      return "This captures the guest's memory and device state on top of its existing disk; the disk is not copied.";
  }
}

/**
 * What the chosen deletion policy will really do, said only where the field does
 * not mean what its name says (C9).
 *
 * On `local` and `s3` the policy works as advertised and needs no note. On csi
 * the artifact belongs to the VolumeSnapshotClass, and on oci there is no
 * cleanup path at all - the finalizer dispatcher covers `local` and `s3` only -
 * so registry artifacts survive deletion under BOTH policies, silently, and
 * upstream documents this nowhere.
 */
function deletionPolicyNote(values: SnapshotFormValues): string | undefined {
  if (values.backend === "csi-volume-snapshot") {
    return (
      `Deletion policy ${values.deletionPolicy} does not decide the artifact's fate here: deleting the snapshot ` +
      "deletes its VolumeSnapshot, and what happens to the content underneath follows the VolumeSnapshotClass."
    );
  }

  if (values.backend === "oci") {
    return values.deletionPolicy === "Delete"
      ? "Deleting the snapshot deletes its registry artifacts by the digest recorded at push time; a registry that " +
          "refuses deletes keeps them."
      : "Deleting the snapshot keeps its registry artifacts, and nothing removes them later.";
  }

  return undefined;
}

/**
 * The live write summary: the one create line, plus the consequence lines that
 * are true of this object in this state (W1, rebuilt on every change).
 */
export function snapshotSummary(
  guest: SnapshotGuestFacts,
  values: SnapshotFormValues,
  locations?: StorageLocationFacts,
): SnapshotSummaryFacts {
  const name = values.name.trim() || "<name>";
  const notes: string[] = [contentsNote(values)];
  const warnings: string[] = [];
  const destination = destinationNote(guest, values, locations);

  if (destination) {
    notes.push(destination);
  }

  if (isMemoryBackend(values.backend)) {
    // Upstream's own three published figures for the pause window disagree by an
    // order of magnitude, so the shape of the window is stated and no number is
    // promised. The measurement lands in the drawer's pause-window row.
    notes.push(
      `The VM ${guest.name} is paused for the whole capture and is unresponsive on the network; the window grows ` +
        "with the guest's memory, and the snapshot records the measured value once it is done.",
    );

    if (!values.resumeAfterSnapshot) {
      warnings.push(frozenVmWarning);
    }
  } else if (csiCaptureWaits(guest)) {
    notes.push(
      "The snapshot is created now and captured when the guest reaches Running or Stopped; until then it waits in " +
        "Pending.",
    );
  }

  const deletionNote = deletionPolicyNote(values);

  if (deletionNote) {
    notes.push(deletionNote);
  }

  return {
    write: `Create SwiftSnapshot ${guest.namespace}/${name}`,
    notes,
    warnings,
  };
}

/** The success sentence: the fact that was written, from a page that does not show the new row (W9). */
export function snapshotSuccessMessage(name: string): string {
  return `SwiftSnapshot ${name} created`;
}

/** The status code an ignored collision warning comes back as. */
export const conflictStatusCode = 409;

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface SnapshotCreateFailureContext {
  namespace: string;
  name: string;
}

/**
 * The actionable sentence alone, for the three failures this dialog can predict.
 *
 * A 409 is the one this dialog produces on purpose: the collision warning does
 * not block, so an ignored warning arrives here as the API server's own
 * AlreadyExists, and the fix is a rename in the form that is still open. The 403
 * sentence is SPEC-0010's, reused verbatim.
 */
export function createFailurePrefix(
  code: number | undefined,
  context: SnapshotCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftSnapshot named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === 404) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftSnapshot CRD is gone.`;
  }

  return writeFailurePrefix(code, { verb: "create", resource: "swiftsnapshots", namespace: context.namespace });
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function createFailureMessage(
  failure: ApiFailureFacts,
  context: SnapshotCreateFailureContext,
): string | undefined {
  const prefix = createFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/**
 * What deleting a SwiftSnapshot does and does not destroy, computed from the
 * object's own backend and policy rather than stated in the abstract.
 *
 * The drawer says this permanently, because the host owns the Delete
 * confirmation and has no hook for a per-kind consequence (the SPEC-0010
 * stance). The last sentence is the one nobody can guess: an operator delete is
 * never blocked, even mid-restore - upstream's reference guard protects TTL and
 * keep-N reaping only - so deleting a snapshot a restore is using makes that
 * restore fail on its next reconcile.
 */
export function snapshotDeleteConsequences(
  backend: SwiftSnapshotBackendType | undefined,
  policy: SwiftSnapshotDeletionPolicy,
): string[] {
  const consequences: string[] = [];

  switch (backend) {
    case "csi-volume-snapshot":
      consequences.push(
        "The VolumeSnapshot goes with this object, and what happens to the content underneath follows the " +
          `VolumeSnapshotClass, not the ${policy} policy.`,
      );
      break;
    case "local":
      consequences.push(
        policy === "Delete"
          ? "The snapshot directory on the node is purged with this object."
          : "The snapshot directory on the node is kept, and nothing removes it later.",
      );
      break;
    case "s3":
      consequences.push(
        policy === "Delete"
          ? "The uploaded objects under the S3 prefix are purged with this object."
          : "The uploaded objects under the S3 prefix are kept, and nothing removes them later.",
      );
      break;
    // KubeSwift v0.14.1 gave oci a cleanup, and v0.16.0 made it delete by the
    // recorded digest, never by a tag another snapshot may hold (SPEC-0019 T1).
    case "oci":
      consequences.push(
        policy === "Delete"
          ? "The registry artifacts are deleted with this object, by the digest recorded at push time; one with no " +
              "recorded digest, or in a registry that refuses deletes, is left in place."
          : "The registry artifacts are kept, and nothing removes them later.",
      );
      break;
    default:
      consequences.push("The backend is unknown to this version of the extension, so what it purges is unverified.");
      break;
  }

  consequences.push(
    "A delete is never blocked, not even while a restore is using this snapshot: that restore fails on its next " +
      "reconcile.",
  );

  return consequences;
}

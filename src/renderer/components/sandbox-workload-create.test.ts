/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  addArtifactBlockedReason,
  addArtifactClaim,
  addArtifactClaimBlockedReason,
  addPodLabelBlockedReason,
  addSandboxArtifact,
  addSandboxPodLabel,
  addSandboxSecretFile,
  addSecretFileBlockedReason,
  addSecretFileItem,
  addSecretFileItemBlockedReason,
  artifactMountPathError,
  cleanGuestPath,
  clearWorkloadSecrets,
  defaultSandboxProbe,
  defaultSandboxWorkload,
  drainPeriodError,
  fileModeMessage,
  formatFileMode,
  isUnderPath,
  maxArtifactClaims,
  maxSandboxArtifacts,
  maxSandboxPodLabels,
  maxSandboxSecretFiles,
  maxSecretFileItems,
  parseFileMode,
  podLabelKeyRule,
  probeBlockedReason,
  probeWithModeNoneMessage,
  probeWithPoolModeNoneMessage,
  removeArtifactClaim,
  removeSandboxArtifact,
  removeSandboxPodLabel,
  removeSandboxSecretFile,
  removeSecretFileItem,
  sandboxArtifactErrors,
  sandboxArtifactFacts,
  sandboxArtifactPayload,
  sandboxArtifactsSectionHasError,
  sandboxArtifactsSectionHint,
  sandboxArtifactWarnings,
  sandboxPodLabelErrors,
  sandboxPodLabelFact,
  sandboxPodLabelsSectionHasError,
  sandboxPodLabelsSectionHint,
  sandboxProbeErrors,
  sandboxProbeFacts,
  sandboxProbePayload,
  sandboxProbesSectionHasError,
  sandboxProbesSectionHint,
  sandboxProbeWarning,
  sandboxSecretFileErrors,
  sandboxSecretFileFacts,
  sandboxSecretFilePayload,
  sandboxSecretFilesSectionHasError,
  sandboxSecretFilesSectionHint,
  sandboxSecretFileWarnings,
  sandboxTerminationFact,
  sandboxTerminationSectionHasError,
  sandboxTerminationSectionHint,
  sandboxWorkloadBlockingIssues,
  sandboxWorkloadFacts,
  sandboxWorkloadPayload,
  sandboxWorkloadWarnings,
  secretFilePathError,
  setSandboxProbeEnabled,
  updateArtifactClaim,
  updateSandboxArtifact,
  updateSandboxPodLabel,
  updateSandboxProbe,
  updateSandboxSecretFile,
  updateSecretFileItem,
} from "./sandbox-workload-create";

import type {
  SandboxArtifactRow,
  SandboxProbeValues,
  SandboxSecretFileRow,
  SandboxWorkloadContext,
  SandboxWorkloadValues,
} from "./sandbox-workload-create";

function context(overrides: Partial<SandboxWorkloadContext> = {}): SandboxWorkloadContext {
  return {
    checkout: false,
    networkMode: "restricted",
    portNames: ["http"],
    secrets: ["e2e-registry", "e2e-cosign", "e2e-files"],
    secretsUnverified: false,
    ...overrides,
  };
}

function probe(overrides: Partial<SandboxProbeValues> = {}): SandboxProbeValues {
  return { ...defaultSandboxProbe(), enabled: true, port: "8080", ...overrides };
}

function artifact(overrides: Partial<SandboxArtifactRow> = {}): SandboxArtifactRow {
  return {
    id: "artifact-1",
    name: "plugins",
    ref: "ghcr.io/example/plugins:1.0",
    mountPath: "/opt/plugins",
    layout: "",
    optional: false,
    fetchTimeout: "",
    pullSecret: "",
    verifyKeySecret: "",
    requirePlatformVerification: false,
    claims: [],
    ...overrides,
  };
}

function secretFile(overrides: Partial<SandboxSecretFileRow> = {}): SandboxSecretFileRow {
  return {
    id: "secret-file-1",
    secretName: "e2e-files",
    mode: "",
    optional: false,
    items: [{ id: "secret-item-1", key: "token", path: "/etc/app/token", mode: "" }],
    ...overrides,
  };
}

function workload(overrides: Partial<SandboxWorkloadValues> = {}): SandboxWorkloadValues {
  return { ...defaultSandboxWorkload(), ...overrides };
}

describe("defaults", () => {
  it("opens with both probes off and every list empty", () => {
    expect(defaultSandboxWorkload()).toEqual({
      readiness: defaultSandboxProbe(),
      liveness: defaultSandboxProbe(),
      drainPeriod: "",
      artifacts: [],
      secretFiles: [],
      podLabels: [],
    });
    expect(defaultSandboxProbe()).toMatchObject({ enabled: false, action: "http" });
  });

  it("has nothing to say about an untouched set of sections", () => {
    expect(sandboxWorkloadBlockingIssues(workload(), context())).toEqual([]);
    expect(sandboxWorkloadPayload(workload())).toEqual({});
    expect(sandboxWorkloadFacts(workload(), context())).toEqual([]);
    expect(sandboxWorkloadWarnings(workload(), context())).toEqual([]);
  });
});

describe("the row helpers", () => {
  it("turns a probe on and off, emptying it when off", () => {
    let values = setSandboxProbeEnabled(workload(), "readiness", true);

    values = updateSandboxProbe(values, "readiness", { port: "8080", path: "/healthz" });
    expect(values.readiness).toMatchObject({ enabled: true, port: "8080" });
    expect(setSandboxProbeEnabled(values, "readiness", false).readiness).toEqual(defaultSandboxProbe());
  });

  it("adds, updates and removes artifacts and their claims, clearing the fetch timeout off optional", () => {
    let values = addSandboxArtifact(addSandboxArtifact(workload()));

    expect(values.artifacts.map((row) => row.id)).toEqual(["artifact-1", "artifact-2"]);
    values = updateSandboxArtifact(values, "artifact-1", { optional: true, fetchTimeout: "30s" });
    expect(values.artifacts[0].fetchTimeout).toBe("30s");
    expect(updateSandboxArtifact(values, "artifact-1", { optional: false }).artifacts[0].fetchTimeout).toBe("");
    values = addArtifactClaim(values, "artifact-1");
    values = updateArtifactClaim(values, "artifact-1", "claim-1", { key: "team", value: "a" });
    expect(values.artifacts[0].claims).toEqual([{ id: "claim-1", key: "team", value: "a" }]);
    expect(removeArtifactClaim(values, "artifact-1", "claim-1").artifacts[0].claims).toEqual([]);
    expect(removeSandboxArtifact(values, "artifact-2").artifacts).toHaveLength(1);
    expect(addArtifactClaim(values, "nope")).toBe(values);
    expect(removeArtifactClaim(values, "nope", "x")).toBe(values);
    expect(updateArtifactClaim(values, "nope", "x", {})).toBe(values);
  });

  it("adds a Secret file with its one required item, and edits the items", () => {
    let values = addSandboxSecretFile(workload());

    expect(values.secretFiles[0].items).toHaveLength(1);
    values = addSecretFileItem(values, "secret-file-1");
    expect(values.secretFiles[0].items.map((item) => item.id)).toEqual(["secret-item-1", "secret-item-2"]);
    values = updateSecretFileItem(values, "secret-file-1", "secret-item-2", { key: "ca" });
    expect(values.secretFiles[0].items[1].key).toBe("ca");
    values = updateSandboxSecretFile(values, "secret-file-1", { secretName: "s" });
    expect(removeSecretFileItem(values, "secret-file-1", "secret-item-1").secretFiles[0].items).toHaveLength(1);
    expect(removeSandboxSecretFile(values, "secret-file-1").secretFiles).toEqual([]);
    expect(addSecretFileItem(values, "nope")).toBe(values);
    expect(removeSecretFileItem(values, "nope", "x")).toBe(values);
    expect(updateSecretFileItem(values, "nope", "x", {})).toBe(values);
  });

  it("adds, updates and removes pod labels", () => {
    let values = addSandboxPodLabel(workload());

    values = updateSandboxPodLabel(values, "pod-label-1", { key: "app" });
    expect(values.podLabels).toEqual([{ id: "pod-label-1", key: "app", value: "" }]);
    expect(removeSandboxPodLabel(values, "pod-label-1").podLabels).toEqual([]);
  });

  it("empties every Secret name on a namespace move", () => {
    const values = clearWorkloadSecrets(
      workload({
        artifacts: [artifact({ pullSecret: "e2e-registry", verifyKeySecret: "e2e-cosign" })],
        secretFiles: [secretFile()],
      }),
    );

    expect(values.artifacts[0]).toMatchObject({ pullSecret: "", verifyKeySecret: "" });
    expect(values.secretFiles[0].secretName).toBe("");
    expect(values.secretFiles[0].items).toHaveLength(1);
  });
});

describe("the add controls (W4)", () => {
  it("names each cap when it is reached", () => {
    const full = workload({
      artifacts: Array.from({ length: maxSandboxArtifacts }, (_, i) => artifact({ id: `a-${i}` })),
      secretFiles: Array.from({ length: maxSandboxSecretFiles }, (_, i) => secretFile({ id: `s-${i}` })),
      podLabels: Array.from({ length: maxSandboxPodLabels }, (_, i) => ({ id: `l-${i}`, key: `k${i}`, value: "" })),
    });

    expect(addArtifactBlockedReason(workload())).toBeUndefined();
    expect(addArtifactBlockedReason(full)).toContain(`The schema allows at most ${maxSandboxArtifacts} artifacts`);
    expect(addSecretFileBlockedReason(full)).toContain(`at most ${maxSandboxSecretFiles} Secret file entries`);
    expect(addPodLabelBlockedReason(full)).toContain(`This form offers at most ${maxSandboxPodLabels} pod labels`);
    expect(
      addArtifactClaimBlockedReason(
        artifact({
          claims: Array.from({ length: maxArtifactClaims }, (_, i) => ({ id: `c-${i}`, key: "k", value: "" })),
        }),
      ),
    ).toContain(`at most ${maxArtifactClaims} claims`);
    expect(
      addSecretFileItemBlockedReason(
        secretFile({
          items: Array.from({ length: maxSecretFileItems }, (_, i) => ({
            id: `i-${i}`,
            key: "k",
            path: "/a",
            mode: "",
          })),
        }),
      ),
    ).toContain(`at most ${maxSecretFileItems} items per Secret`);
  });

  it("refuses a probe without a network, in the words of each mode", () => {
    expect(probeBlockedReason(context())).toBeUndefined();
    expect(probeBlockedReason(context({ networkMode: undefined, checkout: true }))).toBeUndefined();
    expect(probeBlockedReason(context({ networkMode: "none" }))).toBe(probeWithModeNoneMessage);
    expect(probeBlockedReason(context({ networkMode: "none", checkout: true }))).toBe(probeWithPoolModeNoneMessage);
  });
});

describe("the probes", () => {
  it("says nothing about a probe that is off, whatever it holds", () => {
    expect(
      sandboxProbeErrors({ ...defaultSandboxProbe(), port: "nonsense" }, context({ networkMode: "none" })),
    ).toEqual({});
  });

  it("accepts a number or a declared port name", () => {
    expect(sandboxProbeErrors(probe(), context())).toEqual({});
    expect(sandboxProbeErrors(probe({ port: "http" }), context())).toEqual({});
  });

  it("refuses a missing, out-of-range, undeclared or malformed port", () => {
    expect(sandboxProbeErrors(probe({ port: "" }), context()).port).toContain("required");
    expect(sandboxProbeErrors(probe({ port: "70000" }), context()).port).toContain("1 to 65535");
    expect(sandboxProbeErrors(probe({ port: "grpc" }), context()).port).toContain("the declared ones are http");
    expect(sandboxProbeErrors(probe({ port: "grpc" }), context({ portNames: [] })).port).toContain("none is declared");
    expect(sandboxProbeErrors(probe({ port: "Bad_Name" }), context()).port).toContain("or the name of one");
  });

  it("refuses a port name on a checkout, where the pool decides the network", () => {
    expect(sandboxProbeErrors(probe({ port: "http" }), context({ checkout: true, portNames: [] })).port).toContain(
      "the pool decides the network",
    );
    expect(sandboxProbeErrors(probe(), context({ checkout: true, portNames: [] }))).toEqual({});
  });

  it("refuses a probe under mode none, at the probe", () => {
    expect(sandboxProbeErrors(probe(), context({ networkMode: "none" })).probe).toBe(probeWithModeNoneMessage);
  });

  it("checks the HTTP path, and ignores it on a TCP probe", () => {
    expect(sandboxProbeErrors(probe({ path: "healthz" }), context()).path).toContain("starts with '/'");
    expect(sandboxProbeErrors(probe({ path: "/a b" }), context()).path).toBeDefined();
    expect(sandboxProbeErrors(probe({ action: "tcp", path: "healthz" }), context()).path).toBeUndefined();
  });

  it("checks the four numbers against their minimums", () => {
    const errors = sandboxProbeErrors(
      probe({ periodSeconds: "0", timeoutSeconds: "x", failureThreshold: "1.5", initialDelaySeconds: "0" }),
      context(),
    );

    expect(errors.periodSeconds).toContain("1 or more");
    expect(errors.timeoutSeconds).toContain("1 or more");
    expect(errors.failureThreshold).toContain("1 or more");
    expect(errors.initialDelaySeconds).toBeUndefined();
    expect(sandboxProbeErrors(probe({ initialDelaySeconds: "-1" }), context()).initialDelaySeconds).toContain(
      "0 or more",
    );
    expect(sandboxProbeErrors(probe({ periodSeconds: "2147483648" }), context()).periodSeconds).toBeDefined();
  });

  it("names each refusal with its probe and field", () => {
    const issues = sandboxWorkloadBlockingIssues(
      workload({ readiness: probe({ port: "" }), liveness: probe({ periodSeconds: "0" }) }),
      context(),
    );

    expect(issues.map((issue) => issue.label)).toEqual(["Readiness probe port", "Liveness probe period"]);
    expect(sandboxProbesSectionHasError(workload({ readiness: probe({ port: "" }) }), context())).toBe(true);
    expect(sandboxProbesSectionHasError(workload(), context())).toBe(false);
  });

  it("writes an HTTP or a TCP probe, numbers only when set", () => {
    expect(sandboxProbePayload(defaultSandboxProbe())).toBeUndefined();
    expect(sandboxProbePayload(probe({ port: "" }))).toBeUndefined();
    expect(sandboxProbePayload(probe())).toEqual({ httpGet: { port: 8080 } });
    expect(sandboxProbePayload(probe({ path: " /healthz ", port: "http", periodSeconds: "5" }))).toEqual({
      httpGet: { path: "/healthz", port: "http" },
      periodSeconds: 5,
    });
    expect(
      sandboxProbePayload(
        probe({
          action: "tcp",
          path: "/ignored",
          timeoutSeconds: "2",
          failureThreshold: "4",
          initialDelaySeconds: "0",
        }),
      ),
    ).toEqual({ tcpSocket: { port: 8080 }, timeoutSeconds: 2, failureThreshold: 4, initialDelaySeconds: 0 });
  });

  it("warns on a checkout whose pool's network is unknown", () => {
    expect(sandboxProbeWarning(probe(), context({ checkout: true, networkMode: undefined }))).toContain(
      "could not be read",
    );
    expect(sandboxProbeWarning(probe(), context({ checkout: true }))).toBeUndefined();
    expect(sandboxProbeWarning(defaultSandboxProbe(), context({ checkout: true, networkMode: undefined }))).toBe(
      undefined,
    );
  });

  it("carries a header line and states what each probe does", () => {
    expect(sandboxProbesSectionHint(workload())).toContain("None.");
    expect(
      sandboxProbesSectionHint(workload({ readiness: probe({ path: "/ready" }), liveness: probe({ action: "tcp" }) })),
    ).toBe("Readiness: GET /ready on port 8080; Liveness: a TCP connect to port 8080.");
    const [readiness, liveness] = sandboxProbeFacts(
      workload({ readiness: probe(), liveness: probe({ failureThreshold: "5" }) }),
      context(),
    );

    expect(readiness).toContain("WorkloadReady condition and, with ports, the launcher pod's readiness");
    expect(liveness).toContain("After 5 failures in a row");
    expect(liveness).toContain("Nothing restarts it.");
    expect(sandboxProbeFacts(workload({ readiness: probe() }), context({ portNames: [] }))[0]).toMatch(
      /WorkloadReady condition\.$/,
    );
  });
});

describe("the drain period", () => {
  it.each(["", "0s", "5s", "10m", "1m30s"])("accepts %j", (value) => {
    expect(drainPeriodError(value)).toBeUndefined();
  });

  it.each(["5", "soon", "-1s", "10m1s", "1h"])("refuses %s", (value) => {
    expect(drainPeriodError(value)).toBeDefined();
  });

  it("is written only when set, and says its default otherwise", () => {
    expect(sandboxWorkloadPayload(workload({ drainPeriod: " 0s " }))).toEqual({ termination: { drainPeriod: "0s" } });
    expect(sandboxTerminationSectionHint(workload(), context())).toContain("5s");
    expect(sandboxTerminationSectionHint(workload(), context({ portNames: [] }))).toContain("0s");
    expect(sandboxTerminationSectionHint(workload(), context({ checkout: true }))).toContain(
      "when the sandbox exposes",
    );
    expect(sandboxTerminationSectionHint(workload({ drainPeriod: "30s" }), context())).toContain("for 30s");
    expect(sandboxTerminationFact(workload())).toBeUndefined();
    expect(sandboxTerminationFact(workload({ drainPeriod: "30s" }))).toContain("keeps running for 30s");
    expect(sandboxTerminationSectionHasError(workload({ drainPeriod: "x" }))).toBe(true);
  });
});

describe("guest paths", () => {
  it("cleans and compares paths", () => {
    expect(cleanGuestPath("/a/./b/../c/")).toBe("/a/c");
    expect(cleanGuestPath("/..")).toBe("/");
    expect(isUnderPath("/a/b", "/a")).toBe(true);
    expect(isUnderPath("/a", "/a")).toBe(true);
    expect(isUnderPath("/ab", "/a")).toBe(false);
  });

  it("refuses an artifact mount that is relative, the root, or reserved", () => {
    expect(artifactMountPathError("/opt/plugins")).toBeUndefined();
    expect(artifactMountPathError("")).toContain("required");
    expect(artifactMountPathError("opt")).toContain("absolute");
    expect(artifactMountPathError("/")).toContain("at /");
    expect(artifactMountPathError("/x/..")).toContain("at /");
    expect(artifactMountPathError("/proc")).toContain("/proc");
    expect(artifactMountPathError("/sys/fs")).toContain("/sys");
    expect(artifactMountPathError("/opt/../dev/x")).toContain("/dev");
    expect(artifactMountPathError("/devices")).toBeUndefined();
  });

  it("refuses a Secret file path that is not a plain absolute file path", () => {
    expect(secretFilePathError("/etc/app/token")).toBeUndefined();
    expect(secretFilePathError("")).toContain("required");
    expect(secretFilePathError("etc/token")).toContain("absolute");
    expect(secretFilePathError("/")).toContain("absolute");
    expect(secretFilePathError("/etc/app/")).toContain("names a file");
    expect(secretFilePathError("/etc/./token")).toContain("'.' or '..'");
    expect(secretFilePathError("/etc/../token")).toContain("'.' or '..'");
    expect(secretFilePathError("/proc/x")).toContain("/proc");
  });

  it("reads and writes octal modes", () => {
    expect(parseFileMode("0400")).toBe(0o400);
    expect(parseFileMode("644")).toBe(0o644);
    expect(parseFileMode("0o600")).toBe(0o600);
    expect(parseFileMode("0")).toBe(0);
    expect(parseFileMode("0777")).toBe(0o777);
    expect(parseFileMode("1000")).toBeUndefined();
    expect(parseFileMode("0800")).toBeUndefined();
    expect(parseFileMode("rw")).toBeUndefined();
    expect(formatFileMode(0o400)).toBe("0400");
    expect(formatFileMode(0)).toBe("0000");
  });
});

describe("the artifacts", () => {
  it("accepts a complete artifact", () => {
    expect(sandboxArtifactErrors(workload({ artifacts: [artifact()] }))).toEqual({ rows: [{ claimRows: [] }] });
  });

  it("refuses a missing, malformed or repeated name", () => {
    const { rows } = sandboxArtifactErrors(
      workload({
        artifacts: [
          artifact({ name: "" }),
          artifact({ name: "Bad_Name", mountPath: "/b" }),
          artifact({ name: "x".repeat(41), mountPath: "/c" }),
          artifact({ mountPath: "/d" }),
          artifact({ name: "plugins", mountPath: "/e" }),
        ],
      }),
    );

    expect(rows[0].name).toContain("required");
    expect(rows[1].name).toContain("DNS label of at most 40");
    expect(rows[2].name).toContain("DNS label");
    expect(rows[3].name).toBeUndefined();
    expect(rows[4].name).toContain("already named plugins");
  });

  it("refuses a missing reference or one with whitespace", () => {
    expect(sandboxArtifactErrors(workload({ artifacts: [artifact({ ref: "" })] })).rows[0].ref).toContain("required");
    expect(sandboxArtifactErrors(workload({ artifacts: [artifact({ ref: "a b" })] })).rows[0].ref).toContain(
      "whitespace",
    );
  });

  it("refuses a mount inside another artifact's, or at the same path, on the inner or later row", () => {
    const { rows } = sandboxArtifactErrors(
      workload({
        artifacts: [
          artifact({ name: "inner", mountPath: "/opt/plugins/extra" }),
          artifact({ name: "outer", mountPath: "/opt/plugins" }),
          artifact({ name: "twin", mountPath: "/opt/plugins/" }),
          artifact({ name: "apart", mountPath: "/opt/pluginsx" }),
        ],
      }),
    );

    expect(rows[0].mountPath).toContain("inside /opt/plugins, where outer is mounted");
    expect(rows[1].mountPath).toBeUndefined();
    expect(rows[2].mountPath).toContain("outer is already mounted at /opt/plugins");
    expect(rows[3].mountPath).toBeUndefined();
  });

  it("checks the fetch timeout of an optional artifact only", () => {
    const check = (row: Partial<SandboxArtifactRow>) =>
      sandboxArtifactErrors(workload({ artifacts: [artifact(row)] })).rows[0].fetchTimeout;

    expect(check({ optional: true, fetchTimeout: "0s" })).toBeUndefined();
    expect(check({ optional: true, fetchTimeout: "5m" })).toBeUndefined();
    expect(check({ optional: true, fetchTimeout: "6m" })).toContain("between 0s and 5m");
    expect(check({ optional: true, fetchTimeout: "-1s" })).toContain("between 0s and 5m");
    expect(check({ optional: true, fetchTimeout: "soon" })).toContain("Go duration");
    expect(check({ optional: false, fetchTimeout: "soon" })).toBeUndefined();
  });

  it("checks Secret names and claim rows, and the claims cap", () => {
    const { rows } = sandboxArtifactErrors(
      workload({
        artifacts: [
          artifact({
            pullSecret: "Bad Secret",
            verifyKeySecret: "e2e-cosign",
            claims: [
              { id: "claim-1", key: "", value: "orphan" },
              ...Array.from({ length: maxArtifactClaims }, (_, i) => ({ id: `c-${i}`, key: `k${i}`, value: "" })),
            ],
          }),
        ],
      }),
    );

    expect(rows[0].pullSecret).toContain("A Secret name");
    expect(rows[0].verifyKeySecret).toBeUndefined();
    expect(rows[0].claimRows[0].key).toContain("A key is required");
    expect(rows[0].claims).toContain(`at most ${maxArtifactClaims} claims`);
  });

  it("refuses more artifacts than the schema allows, and names each field", () => {
    const many = Array.from({ length: maxSandboxArtifacts + 1 }, (_, i) =>
      artifact({ id: `a-${i}`, name: `a${i}`, mountPath: `/m${i}` }),
    );

    expect(sandboxArtifactErrors(workload({ artifacts: many })).artifacts).toContain("Remove 1");
    const issues = sandboxWorkloadBlockingIssues(
      workload({
        artifacts: [artifact({ name: "", claims: [{ id: "claim-1", key: "", value: "v" }] })],
      }),
      context(),
    );

    expect(issues.map((issue) => issue.label)).toEqual(["Artifact 1 name", "Artifact 1 claim 1 key"]);
    expect(sandboxArtifactsSectionHasError(workload({ artifacts: [artifact({ ref: "" })] }))).toBe(true);
  });

  it("writes only what differs from the defaults", () => {
    expect(sandboxArtifactPayload(artifact({ name: "" }))).toBeUndefined();
    expect(sandboxArtifactPayload(artifact())).toEqual({
      name: "plugins",
      ref: "ghcr.io/example/plugins:1.0",
      mountPath: "/opt/plugins",
    });
    expect(sandboxArtifactPayload(artifact({ layout: "oci", fetchTimeout: "30s" }))).not.toHaveProperty("layout");
    expect(sandboxArtifactPayload(artifact({ layout: "oci", fetchTimeout: "30s" }))).not.toHaveProperty("fetchTimeout");
    expect(
      sandboxArtifactPayload(
        artifact({
          layout: "unpacked",
          optional: true,
          fetchTimeout: "30s",
          pullSecret: "e2e-registry",
          verifyKeySecret: "e2e-cosign",
          requirePlatformVerification: true,
          claims: [{ id: "claim-1", key: "team", value: "a" }],
        }),
      ),
    ).toEqual({
      name: "plugins",
      ref: "ghcr.io/example/plugins:1.0",
      mountPath: "/opt/plugins",
      layout: "unpacked",
      optional: true,
      fetchTimeout: "30s",
      pullSecretRef: { name: "e2e-registry" },
      verifyKeySecretRef: { name: "e2e-cosign" },
      requirePlatformVerification: true,
      claims: { team: "a" },
    });
  });

  it("warns about a Secret the read did not return, and a mount over the model's", () => {
    const [missing] = sandboxArtifactWarnings(
      workload({ artifacts: [artifact({ pullSecret: "nope", verifyKeySecret: "e2e-cosign" })] }),
      context(),
    );

    expect(missing.pullSecret).toContain("No Secret named nope");
    expect(missing.pullSecret).toContain("fails the sandbox");
    expect(missing.verifyKeySecret).toBeUndefined();
    const [optional] = sandboxArtifactWarnings(
      workload({ artifacts: [artifact({ optional: true, verifyKeySecret: "nope" })] }),
      context({ secretsUnverified: true }),
    );

    expect(optional.verifyKeySecret).toContain("could not be listed");
    const [overlap] = sandboxArtifactWarnings(
      workload({ artifacts: [artifact({ mountPath: "/model/extra" })] }),
      context({ modelMountPath: "/model" }),
    );

    expect(overlap.mountPath).toContain("overlaps the model's mount at /model");
    expect(
      sandboxArtifactWarnings(workload({ artifacts: [artifact()] }), context({ modelMountPath: "/model" })),
    ).toEqual([{}]);
  });

  it("carries a header line and states what each artifact is and needs", () => {
    expect(sandboxArtifactsSectionHint(workload())).toContain("None.");
    expect(sandboxArtifactsSectionHint(workload({ artifacts: [artifact(), artifact({ name: "" })] }))).toBe(
      "2 artifacts mounted read-only: plugins, <name>.",
    );
    const facts = sandboxArtifactFacts(
      workload({
        artifacts: [
          artifact(),
          artifact({
            name: "data",
            ref: "ghcr.io/example/data@sha256:abc",
            mountPath: "/data",
            layout: "unpacked",
            optional: true,
            verifyKeySecret: "e2e-cosign",
            requirePlatformVerification: true,
            claims: [{ id: "claim-1", key: "team", value: "a" }],
          }),
        ],
      }),
      context(),
    );

    expect(facts[0]).toContain("as an OCI image layout");
    expect(facts[0]).toContain("Its tag is resolved to a digest when the sandbox starts");
    expect(facts[0]).toContain("It is required");
    expect(facts[1]).toContain("an unpacked filesystem tree");
    expect(facts[1]).toContain("Its digest pins exactly what is mounted");
    expect(facts[1]).toContain("within 10s");
    expect(facts[1]).toContain("cosign-verified against e2e-cosign");
    expect(facts[1]).toContain("claims that no policy of this namespace governs make the artifact refused");
    expect(facts[1]).toContain("skipped, as it is optional");
    expect(facts[2]).toContain("kernel 6.6.14 or later");
    expect(facts[2]).not.toContain("6.6.15");
    expect(sandboxArtifactFacts(workload({ artifacts: [artifact()] }), context({ checkout: true })).at(-1)).toContain(
      "6.6.15",
    );
  });
});

describe("the Secret files", () => {
  it("accepts a complete entry", () => {
    expect(sandboxSecretFileErrors(workload({ secretFiles: [secretFile()] }))).toEqual({
      rows: [{ itemRows: [{}] }],
    });
  });

  it("refuses a missing Secret, a bad mode, no items, and bad items", () => {
    const { rows } = sandboxSecretFileErrors(
      workload({
        secretFiles: [
          secretFile({ secretName: "", mode: "0800", items: [] }),
          secretFile({
            secretName: "Bad Name",
            items: [
              { id: "i-1", key: "", path: "", mode: "9" },
              { id: "i-2", key: "bad key", path: "/etc/app/token", mode: "" },
            ],
          }),
        ],
      }),
    );

    expect(rows[0].secretName).toContain("required");
    expect(rows[0].mode).toBe(fileModeMessage);
    expect(rows[0].items).toContain("At least one item");
    expect(rows[1].secretName).toContain("A Secret name");
    expect(rows[1].itemRows[0]).toEqual({
      key: expect.stringContaining("required"),
      path: expect.stringContaining("required"),
      mode: fileModeMessage,
    });
    expect(rows[1].itemRows[1].key).toContain("A Secret key");
  });

  it("refuses two items writing one file, across entries", () => {
    const { rows } = sandboxSecretFileErrors(
      workload({
        secretFiles: [
          secretFile(),
          secretFile({ id: "secret-file-2", items: [{ id: "i-1", key: "other", path: "/etc//app/token", mode: "" }] }),
        ],
      }),
    );

    expect(rows[0].itemRows[0]).toEqual({});
    expect(rows[1].itemRows[0].path).toContain("Another item already writes /etc/app/token");
  });

  it("refuses more entries or items than the schema allows, and names each field", () => {
    expect(
      sandboxSecretFileErrors(
        workload({ secretFiles: Array.from({ length: maxSandboxSecretFiles + 1 }, () => secretFile({ items: [] })) }),
      ).secretFiles,
    ).toContain("Remove 1");
    expect(
      sandboxSecretFileErrors(
        workload({
          secretFiles: [
            secretFile({
              items: Array.from({ length: maxSecretFileItems + 1 }, (_, i) => ({
                id: `i-${i}`,
                key: "k",
                path: `/f${i}`,
                mode: "",
              })),
            }),
          ],
        }),
      ).rows[0].items,
    ).toContain("Remove 1");
    const issues = sandboxWorkloadBlockingIssues(
      workload({
        secretFiles: [secretFile({ secretName: "", items: [{ id: "i-1", key: "k", path: "x", mode: "" }] })],
      }),
      context(),
    );

    expect(issues.map((issue) => issue.label)).toEqual(["Secret file 1 Secret", "Secret file 1 item 1 path"]);
    expect(sandboxSecretFilesSectionHasError(workload({ secretFiles: [secretFile({ items: [] })] }))).toBe(true);
  });

  it("writes modes as numbers, never re-sending 0400", () => {
    expect(sandboxSecretFilePayload(secretFile({ secretName: "" }))).toBeUndefined();
    expect(sandboxSecretFilePayload(secretFile({ items: [{ id: "i", key: "k", path: "", mode: "" }] }))).toBe(
      undefined,
    );
    expect(sandboxSecretFilePayload(secretFile({ mode: "0400" }))).toEqual({
      secretName: "e2e-files",
      items: [{ key: "token", path: "/etc/app/token" }],
    });
    expect(
      sandboxSecretFilePayload(
        secretFile({
          mode: "0440",
          optional: true,
          items: [
            { id: "i-1", key: "token", path: "/etc/app/token", mode: "0400" },
            { id: "i-2", key: "ca.crt", path: "/etc/app/ca.crt", mode: "" },
          ],
        }),
      ),
    ).toEqual({
      secretName: "e2e-files",
      mode: 0o440,
      optional: true,
      items: [
        { key: "token", path: "/etc/app/token", mode: 0o400 },
        { key: "ca.crt", path: "/etc/app/ca.crt" },
      ],
    });
  });

  it("warns about a Secret the read did not return, by whether the entry is optional", () => {
    expect(sandboxSecretFileWarnings(workload({ secretFiles: [secretFile()] }), context())).toEqual([undefined]);
    expect(
      sandboxSecretFileWarnings(workload({ secretFiles: [secretFile({ secretName: "nope" })] }), context())[0],
    ).toContain("waits Pending");
    expect(
      sandboxSecretFileWarnings(
        workload({ secretFiles: [secretFile({ secretName: "nope", optional: true })] }),
        context(),
      )[0],
    ).toContain("simply left out");
    expect(
      sandboxSecretFileWarnings(workload({ secretFiles: [secretFile()] }), context({ secretsUnverified: true }))[0],
    ).toContain("keeps the sandbox Pending");
  });

  it("carries a header line and states what is written and what it needs", () => {
    expect(sandboxSecretFilesSectionHint(workload())).toContain("None.");
    expect(sandboxSecretFilesSectionHint(workload({ secretFiles: [secretFile()] }))).toBe("1 file from e2e-files.");
    const facts = sandboxSecretFileFacts(workload({ secretFiles: [secretFile({ optional: true })] }));

    expect(facts[0]).toContain("token is written to /etc/app/token, mode 0400");
    expect(facts[0]).toContain("optional");
    expect(facts[1]).toContain("kernel 6.6.14 or later");
    expect(facts[1]).toContain("keeps the sandbox Pending unless its entry is optional");
    expect(sandboxSecretFileFacts(workload({ secretFiles: [secretFile({ secretName: "" })] }))).toEqual([]);
  });
});

describe("the pod labels (D1)", () => {
  it.each([
    "kubeswift.io/role",
    "sandbox.kubeswift.io/x",
    "k8s.ovn.org/x",
    "v1.multus-cni.io/x",
    "k8s.v1.cni.cncf.io/x",
  ])("refuses %s", (key) => {
    expect(podLabelKeyRule(key)).toBeDefined();
    expect(sandboxPodLabelErrors(workload({ podLabels: [{ id: "l", key, value: "" }] })).rows[0].key).toBe(
      podLabelKeyRule(key),
    );
  });

  it.each(["app", "app.kubernetes.io/name", "notkubeswift.io/x", "kubeswift.io"])("accepts %s", (key) => {
    expect(podLabelKeyRule(key)).toBeUndefined();
  });

  it("applies the label syntax and the cap", () => {
    expect(
      sandboxPodLabelErrors(workload({ podLabels: [{ id: "l", key: "Bad Key", value: "" }] })).rows[0].key,
    ).toContain("A label key");
    expect(
      sandboxPodLabelErrors(
        workload({
          podLabels: Array.from({ length: maxSandboxPodLabels + 1 }, (_, i) => ({
            id: `l-${i}`,
            key: `k${i}`,
            value: "",
          })),
        }),
      ).podLabels,
    ).toContain("Remove 1");
    expect(sandboxPodLabelsSectionHasError(workload({ podLabels: [{ id: "l", key: "", value: "x" }] }))).toBe(true);
    expect(
      sandboxWorkloadBlockingIssues(
        workload({ podLabels: [{ id: "l", key: "kubeswift.io/x", value: "" }] }),
        context(),
      ),
    ).toEqual([{ label: "Pod label 1 key", message: podLabelKeyRule("kubeswift.io/x") }]);
  });

  it("writes the labels as podMetadata.labels, and says where they land", () => {
    const values = workload({ podLabels: [{ id: "l", key: "app", value: "web" }] });

    expect(sandboxWorkloadPayload(values)).toEqual({ podMetadata: { labels: { app: "web" } } });
    expect(sandboxPodLabelsSectionHint(workload())).toContain("None.");
    expect(sandboxPodLabelsSectionHint(values)).toBe("The launcher pod is labelled app=web.");
    expect(sandboxPodLabelFact(workload(), context())).toBeUndefined();
    expect(sandboxPodLabelFact(values, context())).toMatch(/^The launcher pod is labelled app=web/);
    expect(sandboxPodLabelFact(values, context({ checkout: true }))).toMatch(/^The claimed slot's pod/);
  });
});

describe("the whole set", () => {
  it("writes every section at once", () => {
    expect(
      Object.keys(
        sandboxWorkloadPayload(
          workload({
            readiness: probe(),
            liveness: probe({ action: "tcp" }),
            drainPeriod: "10s",
            artifacts: [artifact()],
            secretFiles: [secretFile()],
            podLabels: [{ id: "l", key: "app", value: "web" }],
          }),
        ),
      ),
    ).toEqual(["readinessProbe", "livenessProbe", "termination", "artifacts", "secretFiles", "podMetadata"]);
  });

  it("orders the blocking issues as the sections read", () => {
    const issues = sandboxWorkloadBlockingIssues(
      workload({
        readiness: probe({ port: "" }),
        drainPeriod: "x",
        artifacts: [artifact({ ref: "" })],
        secretFiles: [secretFile({ secretName: "" })],
        podLabels: [{ id: "l", key: "kubeswift.io/x", value: "" }],
      }),
      context(),
    );

    expect(issues.map((issue) => issue.label)).toEqual([
      "Readiness probe port",
      "Drain period",
      "Artifact 1 reference",
      "Secret file 1 Secret",
      "Pod label 1 key",
    ]);
  });

  it("collects each warning once", () => {
    const warnings = sandboxWorkloadWarnings(
      workload({
        readiness: probe(),
        liveness: probe(),
        artifacts: [artifact({ pullSecret: "nope", verifyKeySecret: "nope" })],
        secretFiles: [secretFile({ secretName: "gone" })],
      }),
      context({ checkout: true, networkMode: undefined }),
    );

    expect(warnings).toHaveLength(3);
  });
});

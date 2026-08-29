import { describe, expect, it } from "vitest";
import {
  blankScratchDiskLabel,
  describeEnvSource,
  draGpuBackendLabel,
  existingScratchDiskLabel,
  nativeGpuBackendLabel,
  noNetworkLabel,
  noNetworkTooltip,
  SwiftSandbox,
} from "./swiftsandbox-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftSandbox (v1alpha1)", () => {
  const buildSwiftSandbox = (
    spec: SwiftSandbox["spec"],
    status?: SwiftSandbox["status"],
    name = "build-42",
    namespace = "ci",
  ) =>
    new SwiftSandbox({
      apiVersion: "sandbox.kubeswift.io/v1alpha1",
      kind: "SwiftSandbox",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/sandbox.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftsandboxes/${name}`,
      },
      spec,
      status,
    });

  // Only `image` and `memory` are required, and `memory` is defaulted by the
  // API server, so this is what a sandbox authored with nothing but an image
  // reads back as.
  const minimalSpec: SwiftSandbox["spec"] = {
    image: "ghcr.io/example/runner:1",
    memory: "512Mi",
  };

  const fullSpec: SwiftSandbox["spec"] = {
    image: "ghcr.io/example/runner@sha256:5f0d2c1a",
    memory: "1Gi",
    cpu: 2,
    command: ["/usr/bin/python3"],
    args: ["-c", "print(1)"],
    workingDir: "/workspace",
    timeout: "30m",
    ttl: "1h",
    rootfsMode: "block",
    network: { mode: "restricted" },
    nodeSelector: { "kubeswift.io/kernel": "true" },
    kernelProfileRef: { name: "sandbox-6-12" },
    imagePullSecret: "registry-pull",
    verifyKeySecretRef: { name: "cosign-key" },
    poolRef: { name: "warm-runners" },
    model: { imageRef: "ghcr.io/example/model@sha256:aa", mountPath: "/model" },
    scratchDisk: { blank: { size: "100Gi", storageClassName: "standard", volumeMode: "Block" } },
    gpuProfileRef: { name: "gpu-1" },
    env: [
      { name: "MODE", value: "interpreter" },
      { name: "TOKEN", valueFrom: { secretKeyRef: { name: "api-token", key: "token" } } },
      { name: "MODEL", valueFrom: { configMapKeyRef: { name: "runner-config", key: "model" } } },
    ],
  };

  const fullStatus: SwiftSandbox["status"] = {
    phase: "Running",
    message: "The sandbox is running.",
    nodeName: "node-1",
    podRef: "build-42-launcher",
    startedAt: "2026-08-28T10:00:00Z",
    network: { primaryIP: "10.244.2.31" },
    runtime: { hypervisor: "cloud-hypervisor", pid: 8123 },
    rootfs: { digest: "sha256:5f0d2c1a", sizeBytes: 1610612736, cachePath: "/var/lib/kubeswift/rootfs/5f0d2c1a" },
    model: { digest: "sha256:aa", mountPath: "/model", cachePath: "/var/lib/kubeswift/models/aa" },
    scratchDisk: { bound: true, pvcName: "build-42-scratch", devicePath: "/dev/kubeswift-data-scratch" },
    gpu: {
      devices: ["0000:41:00.0"],
      hypervisor: "cloud-hypervisor",
      nodeName: "node-1",
      numaNodes: [0],
      partitionId: -1,
    },
    conditions: [
      {
        type: "RootfsReady",
        status: "True",
        reason: "Materialized",
        message: "The rootfs is ready.",
        lastTransitionTime: "2026-08-28T09:59:00Z",
      },
    ],
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftSandbox.kind).toBe("SwiftSandbox");
      expect(SwiftSandbox.namespaced).toBe(true);
      expect(SwiftSandbox.apiBase).toBe("/apis/sandbox.kubeswift.io/v1alpha1/swiftsandboxes");
      expect(SwiftSandbox.crd).toMatchObject({
        apiVersions: ["sandbox.kubeswift.io/v1alpha1"],
        plural: "swiftsandboxes",
        singular: "swiftsandbox",
        shortNames: ["sbox"],
        title: "Sandboxes",
      });
    });
  });

  describe("resource readers", () => {
    it("reads every block of a fully populated sandbox", () => {
      const object = buildSwiftSandbox(fullSpec, fullStatus);

      expect(object.getName()).toBe("build-42");
      expect(object.getNs()).toBe("ci");
      expect(SwiftSandbox.getPhase(object)).toBe("Running");
      expect(SwiftSandbox.getImage(object)).toBe("ghcr.io/example/runner@sha256:5f0d2c1a");
      expect(SwiftSandbox.getNodeName(object)).toBe("node-1");
      expect(SwiftSandbox.getPrimaryIP(object)).toBe("10.244.2.31");
      expect(SwiftSandbox.getHypervisor(object)).toBe("cloud-hypervisor");
      expect(SwiftSandbox.getPid(object)).toBe(8123);
      // An int64 byte count, humanized: 1.5Gi, never the raw digit run.
      expect(SwiftSandbox.getRootfsSize(object)).toBe("1.5Gi");
      expect(SwiftSandbox.getScratchDiskSource(object)).toBe(blankScratchDiskLabel);
      expect(SwiftSandbox.getScratchDiskPvcName(object)).toBe("build-42-scratch");
      expect(SwiftSandbox.getGpuBackend(object)).toBe(nativeGpuBackendLabel);
      expect(SwiftSandbox.hasGpu(object)).toBe(true);
    });

    it("reads the launcher pod reference as the plain string the schema declares", () => {
      // The near-miss this model exists to avoid: SwiftGuest's status.podRef is
      // a full ObjectReference, this one is a bare name, and reading `.name`
      // off it would be `undefined` at runtime.
      const object = buildSwiftSandbox(fullSpec, fullStatus);

      expect(SwiftSandbox.getPodName(object)).toBe("build-42-launcher");
      expect(typeof object.status?.podRef).toBe("string");
    });

    it("reads a sandbox that carries only the two required fields", () => {
      const object = buildSwiftSandbox(minimalSpec);

      expect(SwiftSandbox.getImage(object)).toBe("ghcr.io/example/runner:1");
      expect(SwiftSandbox.getPhase(object)).toBeUndefined();
      expect(SwiftSandbox.getNodeName(object)).toBeUndefined();
      expect(SwiftSandbox.getPodName(object)).toBeUndefined();
      expect(SwiftSandbox.getRootfsSize(object)).toBeUndefined();
      expect(SwiftSandbox.getScratchDiskSource(object)).toBeUndefined();
      expect(SwiftSandbox.getScratchDiskPvcName(object)).toBeUndefined();
      expect(SwiftSandbox.getGpuBackend(object)).toBeUndefined();
      expect(SwiftSandbox.hasGpu(object)).toBe(false);
      expect(SwiftSandbox.getEnv(object)).toEqual([]);
      expect(SwiftSandbox.getSecretNames(object)).toEqual([]);
      expect(SwiftSandbox.getConfigMapNames(object)).toEqual([]);
      expect(SwiftSandbox.getPvcNames(object)).toEqual([]);
    });

    it("reads an object with no status at all", () => {
      const object = buildSwiftSandbox(fullSpec);

      expect(SwiftSandbox.getPhase(object)).toBeUndefined();
      expect(SwiftSandbox.isTerminal(object)).toBe(false);
      expect(SwiftSandbox.getExitCode(object)).toBeUndefined();
      expect(SwiftSandbox.getRunDurationMs(object)).toBeUndefined();
      expect(SwiftSandbox.getGpuPartitionId(object)).toBeUndefined();
      // The spec half of every reference is still readable without a status.
      expect(SwiftSandbox.getScratchDiskSource(object)).toBe(blankScratchDiskLabel);
      expect(SwiftSandbox.getSecretNames(object)).toEqual(["api-token", "cosign-key", "registry-pull"]);
    });
  });

  describe("command", () => {
    it("reads the command and its args as the string arrays they are", () => {
      const object = buildSwiftSandbox(fullSpec);

      expect(SwiftSandbox.getCommand(object)).toEqual(["/usr/bin/python3"]);
      expect(SwiftSandbox.getArgs(object)).toEqual(["-c", "print(1)"]);
      expect(SwiftSandbox.usesImageEntrypoint(object)).toBe(false);
    });

    it("reports an absent command as the image's own entrypoint, not as a missing value", () => {
      // The schema says the image config's Entrypoint+Cmd are used when
      // `command` is empty, so this is a fact about the sandbox rather than a
      // gap for the view to render as "N/A".
      const object = buildSwiftSandbox(minimalSpec);

      expect(SwiftSandbox.getCommand(object)).toEqual([]);
      expect(SwiftSandbox.usesImageEntrypoint(object)).toBe(true);
    });
  });

  describe("address", () => {
    it("shows the address when the guest has one", () => {
      const object = buildSwiftSandbox(fullSpec, fullStatus);

      expect(SwiftSandbox.getAddressLabel(object)).toBe("10.244.2.31");
      expect(SwiftSandbox.getAddressTooltip(object)).toBeUndefined();
    });

    it("says None, not N/A, for a sandbox that deliberately has no network", () => {
      const object = buildSwiftSandbox({ ...minimalSpec, network: { mode: "none" } }, { phase: "Failed" });

      expect(SwiftSandbox.getAddressLabel(object)).toBe(noNetworkLabel);
      expect(SwiftSandbox.getAddressTooltip(object)).toBe(noNetworkTooltip);
    });

    it("leaves the cell to its N/A fallback when an address is expected but absent", () => {
      const object = buildSwiftSandbox({ ...minimalSpec, network: { mode: "restricted" } }, { phase: "Materializing" });

      expect(SwiftSandbox.getAddressLabel(object)).toBeUndefined();
      expect(SwiftSandbox.getAddressTooltip(object)).toBeUndefined();
    });
  });

  describe("exit code and duration", () => {
    it("keeps a zero exit code on a completed sandbox", () => {
      const object = buildSwiftSandbox(minimalSpec, {
        phase: "Completed",
        exitCode: 0,
        startedAt: "2026-08-28T10:00:00Z",
        terminalAt: "2026-08-28T10:00:48Z",
      });

      expect(SwiftSandbox.isTerminal(object)).toBe(true);
      expect(SwiftSandbox.getExitCode(object)).toBe(0);
      expect(SwiftSandbox.getRunDurationMs(object)).toBe(48_000);
    });

    it("hides the exit code while the sandbox is not terminal", () => {
      const object = buildSwiftSandbox(minimalSpec, { phase: "Running", exitCode: 0 });

      expect(SwiftSandbox.isTerminal(object)).toBe(false);
      expect(SwiftSandbox.getExitCode(object)).toBeUndefined();
    });

    it("reports no derived duration for a running sandbox, which the view counts itself", () => {
      const object = buildSwiftSandbox(minimalSpec, { phase: "Running", startedAt: "2026-08-28T10:00:00Z" });

      expect(SwiftSandbox.getStartedAt(object)).toBe("2026-08-28T10:00:00Z");
      expect(SwiftSandbox.getTerminalAt(object)).toBeUndefined();
      expect(SwiftSandbox.getRunDurationMs(object)).toBeUndefined();
    });

    it("refuses a terminal timestamp that precedes the start one", () => {
      const object = buildSwiftSandbox(minimalSpec, {
        phase: "Failed",
        startedAt: "2026-08-28T10:00:00Z",
        terminalAt: "2026-08-28T09:00:00Z",
      });

      expect(SwiftSandbox.getRunDurationMs(object)).toBeUndefined();
    });
  });

  describe("GPU", () => {
    it("names the DRA backend, which no E2E fixture can carry", () => {
      // gpuResourceClaim is mutually exclusive with gpuProfileRef and with
      // poolRef by webhook, so a fixture cannot combine them: this branch is
      // covered here on purpose (SPEC-0008).
      const object = buildSwiftSandbox({
        ...minimalSpec,
        gpuResourceClaim: { resourceClaimTemplateName: "gpu-template", requestName: "gpu", tier: "pcie" },
      });

      expect(SwiftSandbox.getGpuBackend(object)).toBe(draGpuBackendLabel);
      expect(SwiftSandbox.hasGpu(object)).toBe(true);
    });

    it("reports both backends when both are set, since no CEL rule forbids it", () => {
      const object = buildSwiftSandbox({
        ...minimalSpec,
        gpuProfileRef: { name: "gpu-1" },
        gpuResourceClaim: { resourceClaimName: "shared-gpu" },
      });

      expect(SwiftSandbox.getGpuBackend(object)).toBe(`${nativeGpuBackendLabel}, ${draGpuBackendLabel}`);
    });

    it("drops the -1 partition sentinel and keeps a real partition id", () => {
      const isolated = buildSwiftSandbox(fullSpec, fullStatus);
      const shared = buildSwiftSandbox(fullSpec, { ...fullStatus, gpu: { partitionId: 3 } });

      expect(SwiftSandbox.getGpuPartitionId(isolated)).toBeUndefined();
      expect(SwiftSandbox.getGpuPartitionId(shared)).toBe(3);
    });
  });

  describe("scratch disk", () => {
    it("names an existing PVC as its own source", () => {
      const object = buildSwiftSandbox({ ...minimalSpec, scratchDisk: { pvcRef: { name: "durable-cache" } } });

      expect(SwiftSandbox.getScratchDiskSource(object)).toBe(existingScratchDiskLabel);
      expect(SwiftSandbox.getScratchDiskPvcName(object)).toBe("durable-cache");
      expect(SwiftSandbox.getPvcNames(object)).toEqual(["durable-cache"]);
    });

    it("prefers the bound PVC the status reports over the one the spec asked for", () => {
      const object = buildSwiftSandbox(
        { ...minimalSpec, scratchDisk: { pvcRef: { name: "durable-cache" } } },
        { scratchDisk: { bound: true, pvcName: "durable-cache" } },
      );

      expect(SwiftSandbox.getScratchDiskPvcName(object)).toBe("durable-cache");
      expect(SwiftSandbox.getPvcNames(object)).toEqual(["durable-cache"]);
    });
  });

  describe("reference collections", () => {
    it("collects every Secret, ConfigMap and PVC the object names, deduplicated", () => {
      const object = buildSwiftSandbox(fullSpec, fullStatus);

      expect(SwiftSandbox.getSecretNames(object)).toEqual(["api-token", "cosign-key", "registry-pull"]);
      expect(SwiftSandbox.getConfigMapNames(object)).toEqual(["runner-config"]);
      expect(SwiftSandbox.getPvcNames(object)).toEqual(["build-42-scratch"]);
    });

    it("drops the empty name a core key selector defaults to", () => {
      const object = buildSwiftSandbox({
        ...minimalSpec,
        env: [{ name: "TOKEN", valueFrom: { secretKeyRef: { name: "", key: "token" } } }],
      });

      expect(SwiftSandbox.getSecretNames(object)).toEqual([]);
    });
  });

  describe("describeEnvSource", () => {
    it("has no source for a literal value", () => {
      expect(describeEnvSource({ name: "MODE", value: "interpreter" })).toBeUndefined();
    });

    it("names the Secret and the key it reads", () => {
      expect(
        describeEnvSource({ name: "TOKEN", valueFrom: { secretKeyRef: { name: "api-token", key: "token" } } }),
      ).toEqual({ kind: "Secret", name: "api-token", key: "token", text: "Secret api-token/token" });
    });

    it("names the ConfigMap and the key it reads", () => {
      expect(
        describeEnvSource({ name: "MODEL", valueFrom: { configMapKeyRef: { name: "runner-config", key: "model" } } }),
      ).toEqual({ kind: "ConfigMap", name: "runner-config", key: "model", text: "ConfigMap runner-config/model" });
    });

    it("reads the downward API sources without naming a linkable object", () => {
      expect(describeEnvSource({ name: "NODE", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } })).toEqual({
        kind: "field",
        key: "spec.nodeName",
        text: "field spec.nodeName",
      });
      expect(
        describeEnvSource({ name: "LIMIT", valueFrom: { resourceFieldRef: { resource: "limits.memory" } } }),
      ).toEqual({ kind: "resource", key: "limits.memory", text: "resource limits.memory" });
    });

    it("reads an env-file key", () => {
      expect(
        describeEnvSource({
          name: "FROM_FILE",
          valueFrom: { fileKeyRef: { volumeName: "config", path: "app.env", key: "MODE" } },
        }),
      ).toEqual({ kind: "file", key: "MODE", text: "file config/app.env (MODE)" });
    });
  });
});

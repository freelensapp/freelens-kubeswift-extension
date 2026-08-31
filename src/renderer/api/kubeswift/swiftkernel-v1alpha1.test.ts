import { describe, expect, it } from "vitest";
import { SwiftKernel } from "./swiftkernel-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftKernel (v1alpha1)", () => {
  const buildSwiftKernel = (spec: SwiftKernel["spec"], status?: SwiftKernel["status"]) =>
    new SwiftKernel({
      apiVersion: "kernel.kubeswift.io/v1alpha1",
      kind: "SwiftKernel",
      metadata: {
        name: "faas",
        namespace: "default",
        selfLink: "/apis/kernel.kubeswift.io/v1alpha1/namespaces/default/swiftkernels/faas",
      },
      spec,
      status,
    });

  const ociRef = { image: "ghcr.io/example/kernels/faas:6.6.1" };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftKernel.kind).toBe("SwiftKernel");
      expect(SwiftKernel.namespaced).toBe(true);
      expect(SwiftKernel.apiBase).toBe("/apis/kernel.kubeswift.io/v1alpha1/swiftkernels");
      expect(SwiftKernel.crd).toMatchObject({
        apiVersions: ["kernel.kubeswift.io/v1alpha1"],
        plural: "swiftkernels",
        singular: "swiftkernel",
        shortNames: ["sk"],
      });
    });
  });

  describe("spec readers", () => {
    it("reads the artifact and the profile from the spec", () => {
      const object = buildSwiftKernel({ ociRef, profile: "faas-minimal", kernelCmdline: "console=ttyS0" });

      expect(SwiftKernel.getArtifact(object)).toBe("ghcr.io/example/kernels/faas:6.6.1");
      expect(SwiftKernel.getProfile(object)).toBe("faas-minimal");
      expect(object.spec.kernelCmdline).toBe("console=ttyS0");
    });

    it("returns undefined for the optional profile", () => {
      expect(SwiftKernel.getProfile(buildSwiftKernel({ ociRef }))).toBeUndefined();
    });

    it("reads the command line a guest's own kernelCmdline would replace", () => {
      expect(SwiftKernel.getKernelCmdline(buildSwiftKernel({ ociRef, kernelCmdline: "console=ttyS0" }))).toBe(
        "console=ttyS0",
      );
    });

    it("reads an absent and an empty command line as the same thing", () => {
      expect(SwiftKernel.getKernelCmdline(buildSwiftKernel({ ociRef }))).toBeUndefined();
      expect(SwiftKernel.getKernelCmdline(buildSwiftKernel({ ociRef, kernelCmdline: "" }))).toBeUndefined();
    });
  });

  describe("getReadyNodeCount", () => {
    it("counts the nodes that already hold the artifact", () => {
      const object = buildSwiftKernel(
        { ociRef },
        {
          phase: "Pulling",
          nodeStatuses: [
            { nodeName: "node-1", phase: "Ready" },
            { nodeName: "node-2", phase: "Pulling" },
            { nodeName: "node-3", phase: "Ready" },
            { nodeName: "node-4", phase: "Failed" },
          ],
        },
      );

      expect(SwiftKernel.getReadyNodeCount(object)).toEqual({ ready: 2, total: 4 });
    });

    it("reports no node when the controller has not labelled any", () => {
      const object = buildSwiftKernel({ ociRef }, { phase: "Pending" });

      expect(SwiftKernel.getNodeStatuses(object)).toEqual([]);
      expect(SwiftKernel.getReadyNodeCount(object)).toEqual({ ready: 0, total: 0 });
    });

    it("reports no node on a kernel without status", () => {
      expect(SwiftKernel.getReadyNodeCount(buildSwiftKernel({ ociRef }))).toEqual({ ready: 0, total: 0 });
    });
  });

  describe("status readers", () => {
    it("reads phase and both digests from the status", () => {
      const object = buildSwiftKernel(
        { ociRef },
        { phase: "Ready", kernelDigest: "sha256:kernel", initramfsDigest: "sha256:initramfs" },
      );

      expect(SwiftKernel.getPhase(object)).toBe("Ready");
      expect(object.status?.kernelDigest).toBe("sha256:kernel");
      expect(object.status?.initramfsDigest).toBe("sha256:initramfs");
    });

    it("returns undefined for the phase of a kernel without status", () => {
      expect(SwiftKernel.getPhase(buildSwiftKernel({ ociRef }))).toBeUndefined();
    });
  });
});

import { describe, expect, it } from "vitest";
import { SwiftGuest } from "./swiftguest-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
//
// `@freelensapp/extensions` is stubbed for tests (see `test/freelens-extensions.ts`),
// which lets us construct a real `SwiftGuest` instance from plain resource data.
describe("SwiftGuest (v1alpha1)", () => {
  const buildSwiftGuest = (spec: SwiftGuest["spec"], status?: SwiftGuest["status"]) =>
    new SwiftGuest({
      apiVersion: "swift.kubeswift.io/v1alpha1",
      kind: "SwiftGuest",
      metadata: {
        name: "demo",
        namespace: "default",
        selfLink: "/apis/swift.kubeswift.io/v1alpha1/namespaces/default/swiftguests/demo",
      },
      spec,
      status,
    });

  const guestClassRef = { name: "small" };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftGuest.kind).toBe("SwiftGuest");
      expect(SwiftGuest.namespaced).toBe(true);
      expect(SwiftGuest.apiBase).toBe("/apis/swift.kubeswift.io/v1alpha1/swiftguests");
      expect(SwiftGuest.crd).toMatchObject({
        apiVersions: ["swift.kubeswift.io/v1alpha1"],
        plural: "swiftguests",
        singular: "swiftguest",
        shortNames: ["sg"],
      });
    });
  });

  describe("getOsType", () => {
    it("returns the value set in the spec", () => {
      expect(SwiftGuest.getOsType(buildSwiftGuest({ guestClassRef, osType: "windows" }))).toBe("windows");
    });

    it("falls back to the CRD default when the field is not set", () => {
      expect(SwiftGuest.getOsType(buildSwiftGuest({ guestClassRef }))).toBe("linux");
    });
  });

  describe("getBootSource", () => {
    it("reports a disk boot when an image is referenced", () => {
      const object = buildSwiftGuest({ guestClassRef, imageRef: { name: "ubuntu" } });

      expect(SwiftGuest.getBootSource(object)).toEqual({ kind: "image", name: "ubuntu" });
    });

    it("reports a kernel boot when only a kernel is referenced", () => {
      const object = buildSwiftGuest({ guestClassRef, kernelRef: { name: "vmlinux" } });

      expect(SwiftGuest.getBootSource(object)).toEqual({ kind: "kernel", name: "vmlinux" });
    });

    it("returns undefined when neither reference is set", () => {
      expect(SwiftGuest.getBootSource(buildSwiftGuest({ guestClassRef }))).toBeUndefined();
    });
  });

  describe("getGpuPartitionId", () => {
    it("returns the partition when the guest belongs to one", () => {
      const object = buildSwiftGuest({ guestClassRef }, { gpu: { partitionId: 3 } });

      expect(SwiftGuest.getGpuPartitionId(object)).toBe(3);
    });

    it("treats the negative sentinel as no partition", () => {
      const object = buildSwiftGuest({ guestClassRef }, { gpu: { partitionId: -1 } });

      expect(SwiftGuest.getGpuPartitionId(object)).toBeUndefined();
    });

    it("returns undefined when the status reports no GPU", () => {
      expect(SwiftGuest.getGpuPartitionId(buildSwiftGuest({ guestClassRef }))).toBeUndefined();
    });
  });

  describe("status readers", () => {
    it("reads phase, node, primary IP and restart count from the status", () => {
      const object = buildSwiftGuest(
        { guestClassRef },
        {
          phase: "Running",
          nodeName: "node-1",
          network: { primaryIP: "10.0.0.5" },
          restartCount: 2,
          runtime: { hypervisor: "cloud-hypervisor", pid: 4242 },
        },
      );

      expect(SwiftGuest.getPhase(object)).toBe("Running");
      expect(SwiftGuest.getNodeName(object)).toBe("node-1");
      expect(SwiftGuest.getPrimaryIP(object)).toBe("10.0.0.5");
      expect(SwiftGuest.getRestartCount(object)).toBe(2);
      expect(SwiftGuest.getHypervisor(object)).toBe("cloud-hypervisor");
    });

    it("defaults the restart count to zero on a guest without status", () => {
      expect(SwiftGuest.getRestartCount(buildSwiftGuest({ guestClassRef }))).toBe(0);
    });
  });
});

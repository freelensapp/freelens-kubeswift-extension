import { describe, expect, it } from "vitest";
import { SwiftGuestClass } from "./swiftguestclass-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`.
describe("SwiftGuestClass (v1alpha1)", () => {
  const buildSwiftGuestClass = (spec: SwiftGuestClass["spec"]) =>
    new SwiftGuestClass({
      apiVersion: "swift.kubeswift.io/v1alpha1",
      kind: "SwiftGuestClass",
      metadata: {
        name: "small",
        selfLink: "/apis/swift.kubeswift.io/v1alpha1/swiftguestclasses/small",
      },
      spec,
    });

  const rootDisk = { format: "raw", size: "40Gi" } as const;

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftGuestClass.kind).toBe("SwiftGuestClass");
      expect(SwiftGuestClass.namespaced).toBe(false);
      expect(SwiftGuestClass.apiBase).toBe("/apis/swift.kubeswift.io/v1alpha1/swiftguestclasses");
      expect(SwiftGuestClass.crd).toMatchObject({
        apiVersions: ["swift.kubeswift.io/v1alpha1"],
        plural: "swiftguestclasses",
        singular: "swiftguestclass",
        shortNames: ["sgc"],
      });
    });
  });

  describe("resource readers", () => {
    it("reads cpu, memory and root disk from the spec", () => {
      const object = buildSwiftGuestClass({ cpu: "2", memory: "2Gi", rootDisk });

      expect(SwiftGuestClass.getCpu(object)).toBe("2");
      expect(SwiftGuestClass.getMemory(object)).toBe("2Gi");
      expect(SwiftGuestClass.getRootDiskSize(object)).toBe("40Gi");
      expect(SwiftGuestClass.getRootDiskFormat(object)).toBe("raw");
    });

    it("renders quantities sent as numbers", () => {
      const object = buildSwiftGuestClass({ cpu: 4, memory: 2147483648, rootDisk: { format: "raw", size: 42 } });

      expect(SwiftGuestClass.getCpu(object)).toBe("4");
      expect(SwiftGuestClass.getMemory(object)).toBe("2147483648");
      expect(SwiftGuestClass.getRootDiskSize(object)).toBe("42");
    });

    it("returns undefined when the spec fields are missing", () => {
      const object = buildSwiftGuestClass({} as SwiftGuestClass["spec"]);

      expect(SwiftGuestClass.getCpu(object)).toBeUndefined();
      expect(SwiftGuestClass.getMemory(object)).toBeUndefined();
      expect(SwiftGuestClass.getRootDiskSize(object)).toBeUndefined();
      expect(SwiftGuestClass.getRootDiskFormat(object)).toBeUndefined();
    });
  });

  describe("getCoreScheduling", () => {
    it("returns the value set in the spec", () => {
      const object = buildSwiftGuestClass({ cpu: "2", memory: "2Gi", rootDisk, coreScheduling: "vm" });

      expect(SwiftGuestClass.getCoreScheduling(object)).toBe("vm");
    });

    it("falls back to the CRD default when the field is not set", () => {
      expect(SwiftGuestClass.getCoreScheduling(buildSwiftGuestClass({ cpu: "2", memory: "2Gi", rootDisk }))).toBe(
        "off",
      );
    });

    it("treats an empty value as off, as the schema documents", () => {
      const object = buildSwiftGuestClass({
        cpu: "2",
        memory: "2Gi",
        rootDisk,
        coreScheduling: "" as SwiftGuestClass["spec"]["coreScheduling"],
      });

      expect(SwiftGuestClass.getCoreScheduling(object)).toBe("off");
    });
  });

  describe("storage defaults", () => {
    it("exposes the cluster storage defaults when the spec sets them", () => {
      const object = buildSwiftGuestClass({
        cpu: "2",
        memory: "2Gi",
        rootDisk,
        storage: { accessMode: "ReadWriteMany", volumeMode: "Block", storageClassName: "longhorn" },
      });

      expect(object.spec.storage).toEqual({
        accessMode: "ReadWriteMany",
        volumeMode: "Block",
        storageClassName: "longhorn",
      });
    });

    it("leaves storage unset when the spec omits it", () => {
      expect(buildSwiftGuestClass({ cpu: "2", memory: "2Gi", rootDisk }).spec.storage).toBeUndefined();
    });
  });

  // KubeSwift v0.14.0 placement fields (SPEC-0019 T2).
  describe("placement", () => {
    it("reports the CRD's defaults for a class that sets none", () => {
      const object = buildSwiftGuestClass({ cpu: "2", memory: "2Gi", rootDisk });

      expect(SwiftGuestClass.getCpuPinning(object)).toBe("none");
      expect(SwiftGuestClass.getSmtPolicy(object)).toBeUndefined();
      expect(SwiftGuestClass.getHugepages(object)).toBeUndefined();
      expect(SwiftGuestClass.isSharedBaseDisk(object)).toBe(false);
    });

    it("reads the SMT policy only under static pinning, defaulting it to spread", () => {
      const statik = buildSwiftGuestClass({ cpu: "4", memory: "4Gi", rootDisk, cpuPinning: "static" });
      const ignored = buildSwiftGuestClass({ cpu: "4", memory: "4Gi", rootDisk, smtPolicy: "pack" });

      expect(SwiftGuestClass.getSmtPolicy(statik)).toBe("spread");
      expect(SwiftGuestClass.getSmtPolicy(ignored)).toBeUndefined();
    });

    it("reads hugepages and the shared base disk", () => {
      const object = buildSwiftGuestClass({
        cpu: "4",
        memory: "4Gi",
        rootDisk,
        hugepages: "1Gi",
        sharedBaseDisk: true,
      });

      expect(SwiftGuestClass.getHugepages(object)).toBe("1Gi");
      expect(SwiftGuestClass.isSharedBaseDisk(object)).toBe(true);
    });
  });
});

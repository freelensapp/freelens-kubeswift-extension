import { describe, expect, it } from "vitest";
import {
  anyModelLabel,
  describePartitionMode,
  describeTier,
  noHugepagesLabel,
  SwiftGPUProfile,
} from "./swiftgpuprofile-v1alpha1";
import { SwiftGuest } from "./swiftguest-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`. There is
// no status to read: the CRD declares `subresources: {}`.
describe("SwiftGPUProfile (v1alpha1)", () => {
  const buildSwiftGPUProfile = (spec: SwiftGPUProfile["spec"], name = "gpu-4", namespace = "gpu-lab") =>
    new SwiftGPUProfile({
      apiVersion: "gpu.kubeswift.io/v1alpha1",
      kind: "SwiftGPUProfile",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/gpu.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftgpuprofiles/${name}`,
      },
      spec,
    });

  // Everything the API server fills in by itself, so this is what a profile
  // authored with nothing but `count` reads back as.
  const minimalSpec: SwiftGPUProfile["spec"] = {
    count: 1,
    partitionMode: "isolated",
    tier: "pcie",
    vcpuPinning: false,
  };

  const fullSpec: SwiftGPUProfile["spec"] = {
    count: 4,
    partitionMode: "shared",
    tier: "hgx-shared",
    vcpuPinning: true,
    model: "H200-SXM",
    hugepages: "1Gi",
    pcieTopology: { gpuDirectClique: 1, noMmap: true, rootPortPerDevice: true },
    numaTopology: { sockets: 2, coresPerSocket: 24, threadsPerCore: 1, memoryPerSocketMi: 262144 },
    fabricManager: { runInGuest: false, requiredVersion: "560.35.03" },
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftGPUProfile.kind).toBe("SwiftGPUProfile");
      expect(SwiftGPUProfile.namespaced).toBe(true);
      expect(SwiftGPUProfile.apiBase).toBe("/apis/gpu.kubeswift.io/v1alpha1/swiftgpuprofiles");
      expect(SwiftGPUProfile.crd).toMatchObject({
        apiVersions: ["gpu.kubeswift.io/v1alpha1"],
        plural: "swiftgpuprofiles",
        singular: "swiftgpuprofile",
        shortNames: ["sgp"],
        title: "GPU Profiles",
      });
    });
  });

  describe("resource readers", () => {
    it("reads every block of a fully populated profile", () => {
      const object = buildSwiftGPUProfile(fullSpec);

      expect(SwiftGPUProfile.getCount(object)).toBe(4);
      expect(SwiftGPUProfile.getModelLabel(object)).toBe("H200-SXM");
      expect(SwiftGPUProfile.getTier(object)).toBe("hgx-shared");
      expect(SwiftGPUProfile.getPartitionMode(object)).toBe("shared");
      expect(SwiftGPUProfile.getHugepagesLabel(object)).toBe("1Gi");
      expect(SwiftGPUProfile.getVcpuPinning(object)).toBe(true);
      expect(object.spec.pcieTopology).toEqual({ gpuDirectClique: 1, noMmap: true, rootPortPerDevice: true });
      expect(SwiftGPUProfile.getFabricManagerLocation(object)).toBe("Host");
    });

    it("leaves every optional block unset on a profile that only carries the defaults", () => {
      const object = buildSwiftGPUProfile(minimalSpec);

      expect(SwiftGPUProfile.getCount(object)).toBe(1);
      expect(SwiftGPUProfile.getModelLabel(object)).toBeUndefined();
      expect(SwiftGPUProfile.getHugepagesLabel(object)).toBeUndefined();
      expect(SwiftGPUProfile.getMemoryPerSocket(object)).toBeUndefined();
      expect(SwiftGPUProfile.getFabricManagerLocation(object)).toBeUndefined();
      expect(object.spec.pcieTopology).toBeUndefined();
      expect(object.spec.numaTopology).toBeUndefined();
    });

    it("returns undefined for every reader when the spec itself is empty", () => {
      const object = buildSwiftGPUProfile({} as SwiftGPUProfile["spec"]);

      expect(SwiftGPUProfile.getCount(object)).toBeUndefined();
      expect(SwiftGPUProfile.getTier(object)).toBeUndefined();
      expect(SwiftGPUProfile.getPartitionMode(object)).toBeUndefined();
      expect(SwiftGPUProfile.getVcpuPinning(object)).toBeUndefined();
    });
  });

  describe("getModelLabel", () => {
    it("reads an empty model filter as matching any model", () => {
      expect(SwiftGPUProfile.getModelLabel(buildSwiftGPUProfile({ ...minimalSpec, model: "" }))).toBe(anyModelLabel);
    });

    it("keeps an absent model distinct from an empty one", () => {
      // The schema declares no default for `model`, so a profile can arrive
      // without the field at all; the views render that as "N/A", not "Any".
      expect(SwiftGPUProfile.getModelLabel(buildSwiftGPUProfile(minimalSpec))).toBeUndefined();
    });
  });

  describe("getHugepagesLabel", () => {
    it("reads an empty hugepage size as no hugepages", () => {
      expect(SwiftGPUProfile.getHugepagesLabel(buildSwiftGPUProfile({ ...minimalSpec, hugepages: "" }))).toBe(
        noHugepagesLabel,
      );
    });

    it("keeps an absent hugepage size distinct from an empty one", () => {
      expect(SwiftGPUProfile.getHugepagesLabel(buildSwiftGPUProfile(minimalSpec))).toBeUndefined();
    });
  });

  describe("getMemoryPerSocket", () => {
    it("humanizes the per-socket memory, which the schema counts in MiB", () => {
      expect(SwiftGPUProfile.getMemoryPerSocket(buildSwiftGPUProfile(fullSpec))).toBe("256Gi");
    });

    it("keeps a fractional result to one decimal", () => {
      const object = buildSwiftGPUProfile({
        ...fullSpec,
        numaTopology: { ...fullSpec.numaTopology, memoryPerSocketMi: 1536 } as SwiftGPUProfile["spec"]["numaTopology"],
      });

      expect(SwiftGPUProfile.getMemoryPerSocket(object)).toBe("1.5Gi");
    });

    it("keeps a zero distinct from an absent value", () => {
      const object = buildSwiftGPUProfile({
        ...fullSpec,
        numaTopology: { ...fullSpec.numaTopology, memoryPerSocketMi: 0 } as SwiftGPUProfile["spec"]["numaTopology"],
      });

      expect(SwiftGPUProfile.getMemoryPerSocket(object)).toBe("0");
      expect(SwiftGPUProfile.getMemoryPerSocket(buildSwiftGPUProfile(minimalSpec))).toBeUndefined();
    });
  });

  describe("getFabricManagerLocation", () => {
    it("phrases the boolean as the location it decides", () => {
      const inGuest = buildSwiftGPUProfile({ ...fullSpec, fabricManager: { runInGuest: true } });

      expect(SwiftGPUProfile.getFabricManagerLocation(inGuest)).toBe("Guest");
      expect(SwiftGPUProfile.getFabricManagerLocation(buildSwiftGPUProfile(fullSpec))).toBe("Host");
    });
  });

  describe("describeTier and describePartitionMode", () => {
    it("reads every value the schema enumerates", () => {
      expect(describeTier("pcie")).toContain("Cloud Hypervisor");
      expect(describeTier("hgx-shared")).toContain("QEMU");
      expect(describeTier("hgx-full")).toContain("QEMU");
      expect(describePartitionMode("isolated")).toContain("no NVLink");
      expect(describePartitionMode("shared")).toContain("NVSwitch");
      expect(describePartitionMode("full")).toContain("single guest");
    });

    it("has no reading for a value it does not know, so the view shows it as it arrives", () => {
      expect(describeTier("hgx-quantum")).toBeUndefined();
      expect(describePartitionMode("split")).toBeUndefined();
      expect(describeTier(undefined)).toBeUndefined();
      expect(describePartitionMode(undefined)).toBeUndefined();
    });
  });

  describe("getGuestsUsing", () => {
    const buildSwiftGuest = (name: string, namespace: string, gpuProfileName?: string) =>
      new SwiftGuest({
        apiVersion: "swift.kubeswift.io/v1alpha1",
        kind: "SwiftGuest",
        metadata: {
          name,
          namespace,
          selfLink: `/apis/swift.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftguests/${name}`,
        },
        spec: {
          guestClassRef: { name: "small" },
          ...(gpuProfileName === undefined ? {} : { gpuProfileRef: { name: gpuProfileName } }),
        },
      });

    it("keeps the guests of this namespace that name this profile", () => {
      const object = buildSwiftGPUProfile(fullSpec, "gpu-4", "gpu-lab");
      const guests = [
        buildSwiftGuest("trainer-1", "gpu-lab", "gpu-4"),
        buildSwiftGuest("trainer-2", "gpu-lab", "gpu-8"),
        buildSwiftGuest("web-1", "gpu-lab"),
        // Same profile name, another namespace: `gpuProfileRef` is a
        // LocalObjectReference, so this guest uses another profile entirely.
        buildSwiftGuest("trainer-3", "other", "gpu-4"),
      ];

      expect(SwiftGPUProfile.getGuestsUsing(object, guests).map((guest) => guest.getName())).toEqual(["trainer-1"]);
    });

    it("returns nothing when no guest references the profile", () => {
      const object = buildSwiftGPUProfile(fullSpec);

      expect(SwiftGPUProfile.getGuestsUsing(object, [])).toEqual([]);
      expect(SwiftGPUProfile.getGuestsUsing(object, [buildSwiftGuest("web-1", "gpu-lab")])).toEqual([]);
    });
  });
});

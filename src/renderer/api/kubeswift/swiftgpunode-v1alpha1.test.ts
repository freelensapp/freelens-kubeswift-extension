import { describe, expect, it } from "vitest";
import { parseAllocatedTo, SwiftGPUNode, type SwiftGPUNodeGpuDevice } from "./swiftgpunode-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `status`. There is
// no spec to read: the schema declares none ("the spec is intentionally
// empty"), everything comes from the discovery DaemonSet and the controller.
describe("SwiftGPUNode (v1alpha1)", () => {
  const buildSwiftGPUNode = (status?: SwiftGPUNode["status"], name = "gpu-node-1") =>
    new SwiftGPUNode({
      apiVersion: "gpu.kubeswift.io/v1alpha1",
      kind: "SwiftGPUNode",
      metadata: {
        name,
        selfLink: `/apis/gpu.kubeswift.io/v1alpha1/swiftgpunodes/${name}`,
      },
      ...(status === undefined ? {} : { status }),
    });

  const device = (overrides: Partial<SwiftGPUNodeGpuDevice> = {}): SwiftGPUNodeGpuDevice => ({
    allocated: false,
    deviceId: "10de:2335",
    driver: "vfio-pci",
    index: 0,
    iommuGroup: 42,
    model: "H200-SXM",
    numaNode: 0,
    pciAddress: "0000:41:00.0",
    vendor: "NVIDIA",
    ...overrides,
  });

  const fullStatus: SwiftGPUNode["status"] = {
    phase: "Ready",
    lastDiscovery: "2026-08-28T09:15:00Z",
    gpuCount: 8,
    freeGPUs: 3,
    gpuModel: "H200-SXM",
    gpuVendor: "NVIDIA",
    vfioReady: true,
    gpus: [
      device({
        index: 0,
        barSizes: [
          { region: 0, sizeMi: 16 },
          { region: 1, sizeMi: 131072 },
        ],
      }),
      device({ index: 1, allocated: true, allocatedTo: "gpu-lab/trainer-1", pciAddress: "0000:42:00.0" }),
      device({ index: 2, allocated: true, allocatedTo: "other-lab/trainer-2", pciAddress: "0000:51:00.0" }),
      // A holder that is not a "namespace/name" pair at all: the controller
      // wrote something this extension cannot resolve.
      device({ index: 3, allocated: true, allocatedTo: "trainer-3", pciAddress: "0000:52:00.0" }),
    ],
    host: {
      iommuEnabled: true,
      cpuTopology: { sockets: 2, coresPerSocket: 48, threadsPerCore: 2, totalCPUs: 192 },
      hugepages1Gi: { free: 12, total: 64 },
      numaNodes: [
        { id: 0, cpus: "0-47,96-143", memoryMi: 524288 },
        { id: 1, cpus: "48-95,144-191", memoryMi: 524288 },
      ],
    },
    nvSwitches: [{ deviceId: "10de:22a3", numaNode: 0, pciAddress: "0000:06:00.0" }],
    fabricManager: {
      installed: true,
      running: true,
      version: "560.35.03",
      partitions: [
        { id: 1, active: true, gpuIndices: [1, 2], allocatedTo: "gpu-lab/trainer-1" },
        { id: 2, active: false, gpuIndices: [4, 5, 6, 7] },
      ],
    },
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftGPUNode.kind).toBe("SwiftGPUNode");
      expect(SwiftGPUNode.namespaced).toBe(false);
      expect(SwiftGPUNode.apiBase).toBe("/apis/gpu.kubeswift.io/v1alpha1/swiftgpunodes");
      expect(SwiftGPUNode.crd).toMatchObject({
        apiVersions: ["gpu.kubeswift.io/v1alpha1"],
        plural: "swiftgpunodes",
        singular: "swiftgpunode",
        shortNames: ["sgn"],
        title: "GPU Nodes",
      });
    });
  });

  describe("status readers", () => {
    it("reads every block of a fully populated node", () => {
      const object = buildSwiftGPUNode(fullStatus);

      expect(SwiftGPUNode.getPhase(object)).toBe("Ready");
      expect(SwiftGPUNode.getGpuCount(object)).toBe(8);
      expect(SwiftGPUNode.getFreeGPUs(object)).toBe(3);
      expect(SwiftGPUNode.getGpuModel(object)).toBe("H200-SXM");
      expect(SwiftGPUNode.getGpuVendor(object)).toBe("NVIDIA");
      expect(SwiftGPUNode.getVfioReady(object)).toBe(true);
      expect(SwiftGPUNode.getLastDiscovery(object)).toBe("2026-08-28T09:15:00Z");
      expect(SwiftGPUNode.getGpus(object)).toHaveLength(4);
      expect(SwiftGPUNode.getNvSwitches(object)).toHaveLength(1);
      expect(SwiftGPUNode.getPartitions(object)).toHaveLength(2);
      expect(SwiftGPUNode.getNumaNodes(object)).toHaveLength(2);
    });

    it("returns nothing at all for a node whose status was never written", () => {
      const object = buildSwiftGPUNode();

      expect(SwiftGPUNode.getPhase(object)).toBeUndefined();
      expect(SwiftGPUNode.getGpuCount(object)).toBeUndefined();
      expect(SwiftGPUNode.getVfioReady(object)).toBeUndefined();
      expect(SwiftGPUNode.getLastDiscovery(object)).toBeUndefined();
      expect(SwiftGPUNode.getHugepages1Gi(object)).toBeUndefined();
      // The list helpers return arrays, so a view can map over them without a
      // guard of its own.
      expect(SwiftGPUNode.getGpus(object)).toEqual([]);
      expect(SwiftGPUNode.getNvSwitches(object)).toEqual([]);
      expect(SwiftGPUNode.getPartitions(object)).toEqual([]);
      expect(SwiftGPUNode.getNumaNodes(object)).toEqual([]);
    });

    it("keeps an inventory without a host, NVSwitches or Fabric Manager readable", () => {
      // The DaemonSet and the controller own different fields of the same
      // status, so a node can legitimately report devices before (or without)
      // the rest of the topology.
      const object = buildSwiftGPUNode({
        phase: "Ready",
        vfioReady: true,
        gpus: [device()],
      });

      expect(SwiftGPUNode.getGpus(object)).toHaveLength(1);
      expect(SwiftGPUNode.getNumaNodes(object)).toEqual([]);
      expect(SwiftGPUNode.getNvSwitches(object)).toEqual([]);
      expect(SwiftGPUNode.getPartitions(object)).toEqual([]);
      expect(SwiftGPUNode.getHugepages1Gi(object)).toBeUndefined();
    });
  });

  describe("getAllocatedCount", () => {
    it("derives how many GPUs are handed out", () => {
      expect(SwiftGPUNode.getAllocatedCount(buildSwiftGPUNode(fullStatus))).toBe(5);
    });

    it("keeps a fully free node's zero, which is a fact", () => {
      expect(SwiftGPUNode.getAllocatedCount(buildSwiftGPUNode({ gpuCount: 8, freeGPUs: 8 }))).toBe(0);
    });

    it("reports nothing rather than a misleading zero when either count is absent", () => {
      expect(SwiftGPUNode.getAllocatedCount(buildSwiftGPUNode({ gpuCount: 8 }))).toBeUndefined();
      expect(SwiftGPUNode.getAllocatedCount(buildSwiftGPUNode({ freeGPUs: 3 }))).toBeUndefined();
      expect(SwiftGPUNode.getAllocatedCount(buildSwiftGPUNode())).toBeUndefined();
    });
  });

  describe("parseAllocatedTo", () => {
    it("splits the namespace and the name the schema documents", () => {
      expect(parseAllocatedTo("gpu-lab/trainer-1")).toEqual({ namespace: "gpu-lab", name: "trainer-1" });
    });

    it("refuses anything that is not exactly one namespace and one name", () => {
      // `allocatedTo` is a plain string in the schema, so a malformed value has
      // to render as it arrived instead of becoming a reference to an object
      // nobody ever named.
      expect(parseAllocatedTo("trainer-1")).toBeUndefined();
      expect(parseAllocatedTo("gpu-lab/team/trainer-1")).toBeUndefined();
      expect(parseAllocatedTo("/trainer-1")).toBeUndefined();
      expect(parseAllocatedTo("gpu-lab/")).toBeUndefined();
      expect(parseAllocatedTo("")).toBeUndefined();
      expect(parseAllocatedTo(undefined)).toBeUndefined();
    });
  });

  describe("getAllocatedToReferences and getAllocatedToNamespaces", () => {
    it("collects every guest named anywhere in the status, once", () => {
      const object = buildSwiftGPUNode(fullStatus);

      // trainer-1 is named twice (by a device and by a partition) and counted
      // once; the malformed "trainer-3" is not a reference at all.
      expect(SwiftGPUNode.getAllocatedToReferences(object)).toEqual([
        { namespace: "gpu-lab", name: "trainer-1" },
        { namespace: "other-lab", name: "trainer-2" },
      ]);
      expect(SwiftGPUNode.getAllocatedToNamespaces(object)).toEqual(["gpu-lab", "other-lab"]);
    });

    it("asks for nothing when no GPU is allocated", () => {
      const object = buildSwiftGPUNode({ gpus: [device()] });

      expect(SwiftGPUNode.getAllocatedToReferences(object)).toEqual([]);
      expect(SwiftGPUNode.getAllocatedToNamespaces(object)).toEqual([]);
    });
  });

  describe("getLargestBar and getBarSizesReading", () => {
    it("humanizes the largest region, which the schema counts in MiB", () => {
      const bars = device({
        barSizes: [
          { region: 0, sizeMi: 16 },
          { region: 1, sizeMi: 131072 },
        ],
      });

      // 131072 MiB is 128Gi, never the raw digit run.
      expect(SwiftGPUNode.getLargestBar(bars)).toBe("128Gi");
      expect(SwiftGPUNode.getBarSizesReading(bars)).toBe("0: 16Mi, 1: 128Gi");
    });

    it("reports nothing for a device whose BAR sizes were not discovered", () => {
      expect(SwiftGPUNode.getLargestBar(device())).toBeUndefined();
      expect(SwiftGPUNode.getLargestBar(device({ barSizes: [] }))).toBeUndefined();
      expect(SwiftGPUNode.getBarSizesReading(device())).toBeUndefined();
    });
  });

  describe("getHugepages1Gi and getNumaNodeMemory", () => {
    it("reads the hugepages as a free-of-total pair", () => {
      expect(SwiftGPUNode.getHugepages1Gi(buildSwiftGPUNode(fullStatus))).toBe("12 of 64");
    });

    it("keeps a half-reported hugepage block readable", () => {
      const object = buildSwiftGPUNode({ host: { hugepages1Gi: { total: 64 } } });

      expect(SwiftGPUNode.getHugepages1Gi(object)).toBe("? of 64");
      expect(SwiftGPUNode.getHugepages1Gi(buildSwiftGPUNode({ host: { hugepages1Gi: {} } }))).toBeUndefined();
    });

    it("humanizes a NUMA node's memory, which the schema counts in MiB", () => {
      expect(SwiftGPUNode.getNumaNodeMemory({ id: 0, cpus: "0-47", memoryMi: 524288 })).toBe("512Gi");
      expect(SwiftGPUNode.getNumaNodeMemory({ id: 0, cpus: "0-47", memoryMi: 0 })).toBe("0");
    });
  });
});

import { Renderer } from "@freelensapp/extensions";
import { formatMebibytes, type KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftgpunodes.gpu.kubeswift.io/v1alpha1`.
 *
 * A SwiftGPUNode is the GPU inventory of one Kubernetes node: how many devices
 * it carries, which of them are free, whether the host has loaded `vfio-pci`,
 * and which guest holds each device. One object exists per node labelled for
 * GPU work and it is named after that node.
 *
 * The interfaces below are written from the published CustomResourceDefinition
 * schema. That schema declares `subresources: {status: {}}` and has no `spec`
 * property at all ("the spec is intentionally empty"): everything an operator
 * reads is written by the GPU discovery DaemonSet and by the SwiftGPU
 * controller, which own different fields of the same status. Fields the schema
 * declares without an `enum` (`phase`) are typed as plain strings, so an
 * unexpected value coming from a cluster never breaks a view.
 */

/** One PCI Base Address Register region of a device. `sizeMi` is a count of MiB. */
export interface SwiftGPUNodeBarSize {
  region: number;
  /** Size of the region, counted in MiB (not in bytes). */
  sizeMi: number;
}

/** One GPU on the node. Everything but `allocatedTo` and `barSizes` is required. */
export interface SwiftGPUNodeGpuDevice {
  allocated: boolean;
  /** PCI `vendor:device` id, for example `10de:2336`. */
  deviceId: string;
  /** Bound kernel driver: `vfio-pci` when the device is ready for passthrough. */
  driver: string;
  index: number;
  iommuGroup: number;
  model: string;
  numaNode: number;
  pciAddress: string;
  vendor: string;
  /** `"namespace/name"` of the SwiftGuest holding the device, not an object reference. */
  allocatedTo?: string;
  barSizes?: SwiftGPUNodeBarSize[];
}

/** Host CPU topology, as `lscpu` reports it. */
export interface SwiftGPUNodeCpuTopology {
  coresPerSocket?: number;
  sockets?: number;
  threadsPerCore?: number;
  totalCPUs?: number;
}

export interface SwiftGPUNodeHugepages1Gi {
  free?: number;
  total?: number;
}

export interface SwiftGPUNodeNumaNodeInfo {
  /** CPU mask of the node, as the kernel spells it, for example `0-23,48-71`. */
  cpus: string;
  id: number;
  /** Memory of the node, counted in MiB (not in bytes). */
  memoryMi: number;
}

export interface SwiftGPUNodeHost {
  cpuTopology?: SwiftGPUNodeCpuTopology;
  hugepages1Gi?: SwiftGPUNodeHugepages1Gi;
  iommuEnabled?: boolean;
  numaNodes?: SwiftGPUNodeNumaNodeInfo[];
}

/** One NVSwitch device. Only HGX nodes carry any. */
export interface SwiftGPUNodeNvSwitch {
  deviceId: string;
  numaNode: number;
  pciAddress: string;
}

export interface SwiftGPUNodeFabricManagerPartition {
  active: boolean;
  gpuIndices: number[];
  id: number;
  /** `"namespace/name"` of the SwiftGuest using the partition. */
  allocatedTo?: string;
}

export interface SwiftGPUNodeFabricManager {
  installed: boolean;
  running: boolean;
  partitions?: SwiftGPUNodeFabricManagerPartition[];
  version?: string;
}

export interface SwiftGPUNodeStatus {
  fabricManager?: SwiftGPUNodeFabricManager;
  freeGPUs?: number;
  gpuCount?: number;
  gpuModel?: string;
  gpuVendor?: string;
  gpus?: SwiftGPUNodeGpuDevice[];
  host?: SwiftGPUNodeHost;
  /** Timestamp of the last successful discovery run. */
  lastDiscovery?: string;
  nvSwitches?: SwiftGPUNodeNvSwitch[];
  /** `Discovering`, `Ready` or `Error` in the documented deployments; the schema declares no enum. */
  phase?: string;
  vfioReady?: boolean;
}

/** The schema declares no spec: a GPU node is nothing but what discovery reports. */
export type SwiftGPUNodeSpec = Record<string, never>;

/** The two halves of an `allocatedTo` value, once it has been split. */
export interface SwiftGPUNodeGuestReference {
  name: string;
  namespace: string;
}

/**
 * Splits an `allocatedTo` value, which the schema documents as
 * `"namespace/name"` and declares as a plain string, into its two halves.
 *
 * Returns `undefined` for anything that is not exactly one non-empty namespace
 * and one non-empty name, so a malformed value (no slash, an empty half, more
 * than one slash) is rendered as it arrived instead of being turned into a
 * reference to an object that was never named.
 */
export function parseAllocatedTo(allocatedTo?: string): SwiftGPUNodeGuestReference | undefined {
  if (!allocatedTo) {
    return undefined;
  }

  const parts = allocatedTo.split("/");

  if (parts.length !== 2) {
    return undefined;
  }

  const [namespace, name] = parts;

  if (!namespace || !name) {
    return undefined;
  }

  return { name, namespace };
}

// The metadata is declared cluster-scoped rather than with the generic
// `KubeObjectMetadata` the M1/M2 models use: it makes `getNs()` an `undefined`,
// which is what a cluster-scoped kind actually reports, and it says in the type
// what `namespaced = false` says just below (the same reasoning as the
// `NamespaceScopedMetadata` of SwiftGPUProfile).
export class SwiftGPUNode extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.ClusterScopedMetadata,
  SwiftGPUNodeStatus,
  SwiftGPUNodeSpec
> {
  static readonly kind = "SwiftGPUNode";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/gpu.kubeswift.io/v1alpha1/swiftgpunodes";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["gpu.kubeswift.io/v1alpha1"],
    plural: "swiftgpunodes",
    singular: "swiftgpunode",
    shortNames: ["sgn"],
    title: "GPU Nodes",
  };

  static getPhase(object: SwiftGPUNode): string | undefined {
    return object.status?.phase;
  }

  static getGpuCount(object: SwiftGPUNode): number | undefined {
    return object.status?.gpuCount;
  }

  static getFreeGPUs(object: SwiftGPUNode): number | undefined {
    return object.status?.freeGPUs;
  }

  static getGpuModel(object: SwiftGPUNode): string | undefined {
    return object.status?.gpuModel;
  }

  static getGpuVendor(object: SwiftGPUNode): string | undefined {
    return object.status?.gpuVendor;
  }

  static getVfioReady(object: SwiftGPUNode): boolean | undefined {
    return object.status?.vfioReady;
  }

  static getLastDiscovery(object: SwiftGPUNode): string | undefined {
    return object.status?.lastDiscovery;
  }

  /**
   * How many GPUs are handed out. The two counts are written by the controller
   * while `gpus[]` is written by the DaemonSet, so the difference is only
   * meaningful when both are there: an absent count yields `undefined` rather
   * than a misleading zero.
   */
  static getAllocatedCount(object: SwiftGPUNode): number | undefined {
    const { gpuCount, freeGPUs } = object.status ?? {};

    if (gpuCount === undefined || freeGPUs === undefined) {
      return undefined;
    }

    return gpuCount - freeGPUs;
  }

  static getGpus(object: SwiftGPUNode): SwiftGPUNodeGpuDevice[] {
    return object.status?.gpus ?? [];
  }

  static getNvSwitches(object: SwiftGPUNode): SwiftGPUNodeNvSwitch[] {
    return object.status?.nvSwitches ?? [];
  }

  static getPartitions(object: SwiftGPUNode): SwiftGPUNodeFabricManagerPartition[] {
    return object.status?.fabricManager?.partitions ?? [];
  }

  static getNumaNodes(object: SwiftGPUNode): SwiftGPUNodeNumaNodeInfo[] {
    return object.status?.host?.numaNodes ?? [];
  }

  /** 1GiB hugepages as "free of total", or `undefined` when the block is absent. */
  static getHugepages1Gi(object: SwiftGPUNode): string | undefined {
    const hugepages = object.status?.host?.hugepages1Gi;

    if (!hugepages || (hugepages.free === undefined && hugepages.total === undefined)) {
      return undefined;
    }

    return `${hugepages.free ?? "?"} of ${hugepages.total ?? "?"}`;
  }

  /**
   * The largest BAR region of a device, humanized. It is the number that
   * decides whether the guest needs `noMmap`, so it is the one the drawer
   * shows; the full per-region list stays in the tooltip.
   */
  static getLargestBar(device: SwiftGPUNodeGpuDevice): string | undefined {
    const sizes = (device.barSizes ?? [])
      .map((bar) => bar.sizeMi)
      .filter((sizeMi): sizeMi is number => typeof sizeMi === "number" && Number.isFinite(sizeMi));

    if (sizes.length === 0) {
      return undefined;
    }

    return formatMebibytes(Math.max(...sizes));
  }

  /** Every BAR region of a device as `0: 16Gi`, for the cell tooltip. */
  static getBarSizesReading(device: SwiftGPUNodeGpuDevice): string | undefined {
    const bars = device.barSizes ?? [];

    if (bars.length === 0) {
      return undefined;
    }

    return bars.map((bar) => `${bar.region}: ${formatMebibytes(bar.sizeMi) ?? "N/A"}`).join(", ");
  }

  /** Memory of one NUMA node, humanized from the MiB the schema counts in. */
  static getNumaNodeMemory(numaNode: SwiftGPUNodeNumaNodeInfo): string | undefined {
    return formatMebibytes(numaNode.memoryMi);
  }

  /**
   * Every guest named by an `allocatedTo` value anywhere in the status, both on
   * the devices and on the Fabric Manager partitions, deduplicated. It is what
   * the drawer declares to `useReferenceStores`, so the SwiftGuest store is
   * asked for exactly the namespaces the references live in rather than for
   * whatever the namespace filter happens to hold (DESIGN.md section 3).
   */
  static getAllocatedToReferences(object: SwiftGPUNode): SwiftGPUNodeGuestReference[] {
    const values = [
      ...SwiftGPUNode.getGpus(object).map((device) => device.allocatedTo),
      ...SwiftGPUNode.getPartitions(object).map((partition) => partition.allocatedTo),
    ];
    const seen = new Map<string, SwiftGPUNodeGuestReference>();

    for (const value of values) {
      const reference = parseAllocatedTo(value);

      if (reference) {
        seen.set(`${reference.namespace}/${reference.name}`, reference);
      }
    }

    return [...seen.values()];
  }

  /** The distinct namespaces of those references, for the store request. */
  static getAllocatedToNamespaces(object: SwiftGPUNode): string[] {
    return [...new Set(SwiftGPUNode.getAllocatedToReferences(object).map((reference) => reference.namespace))].sort();
  }
}

export class SwiftGPUNodeApi extends Renderer.K8sApi.KubeApi<SwiftGPUNode> {}
export class SwiftGPUNodeStore extends Renderer.K8sApi.KubeObjectStore<SwiftGPUNode, SwiftGPUNodeApi> {}

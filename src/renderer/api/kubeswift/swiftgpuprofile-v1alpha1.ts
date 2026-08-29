import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest } from "./swiftguest-v1alpha1";
import { formatMebibytes, type KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftgpuprofiles.gpu.kubeswift.io/v1alpha1`.
 *
 * A GPU profile is the namespaced passthrough request a SwiftGuest points at
 * through `spec.gpuProfileRef`: how many GPUs it wants, of which model, in
 * which tier, and how the virtual PCIe and NUMA topologies handed to the guest
 * are shaped. The interfaces below are written from the published
 * CustomResourceDefinition schema; that schema declares `subresources: {}` and
 * no `status` property at all, so a profile is a request and nothing ever
 * writes back to it (the same shape as SwiftGuestClass and SwiftSeedProfile).
 */

export type SwiftGPUProfileTier = "pcie" | "hgx-shared" | "hgx-full";

export type SwiftGPUProfilePartitionMode = "isolated" | "shared" | "full";

/** Virtual PCIe hierarchy built for the guest. All three fields are defaulted. */
export interface SwiftGPUProfilePcieTopology {
  gpuDirectClique: number;
  noMmap: boolean;
  rootPortPerDevice: boolean;
}

/** Virtual NUMA layout inside the guest. Absent means a flat, single-node one. */
export interface SwiftGPUProfileNumaTopology {
  coresPerSocket: number;
  /** Memory per NUMA node, counted in MiB (not in bytes). */
  memoryPerSocketMi: number;
  sockets: number;
  threadsPerCore: number;
}

export interface SwiftGPUProfileFabricManager {
  /** True when the NVSwitches and Fabric Manager go to the guest, false when it stays on the host. */
  runInGuest: boolean;
  requiredVersion?: string;
}

export interface SwiftGPUProfileSpec {
  /** Number of GPUs requested. The schema restricts it to 1, 2, 4 or 8. */
  count: number;
  partitionMode: SwiftGPUProfilePartitionMode;
  tier: SwiftGPUProfileTier;
  vcpuPinning: boolean;
  fabricManager?: SwiftGPUProfileFabricManager;
  /** Hugepage size for GPU memory. The empty string means no hugepages. */
  hugepages?: string;
  /** Model filter. The empty string matches any model. */
  model?: string;
  numaTopology?: SwiftGPUProfileNumaTopology;
  pcieTopology?: SwiftGPUProfilePcieTopology;
}

/** The CRD declares no status subresource: a GPU profile never reports one. */
export type SwiftGPUProfileStatus = Record<string, never>;

/** What an empty `spec.model` means: the profile accepts whatever the node carries. */
export const anyModelLabel = "Any";

/** What an empty `spec.hugepages` means: the guest gets no hugepages. */
export const noHugepagesLabel = "None";

// Humanized readings of the two enums, written from the schema's own field
// descriptions. They live next to the values so the list can put them in a
// cell tooltip and the drawer can show them inline, without either view
// spelling the domain out again.
const tierReadings = new Map<string, string>([
  ["pcie", "tier 1: Cloud Hypervisor, flat PCI topology, no NVSwitch"],
  ["hgx-shared", "tier 2: QEMU, one PCIe root port per GPU, Fabric Manager on the host"],
  ["hgx-full", "tier 3: QEMU, full PCIe hierarchy, NVSwitches in the guest"],
]);

const partitionModeReadings = new Map<string, string>([
  ["isolated", "one GPU per guest, no NVLink and no Fabric Manager"],
  ["shared", "the GPUs share the NVSwitch fabric through a host Fabric Manager partition"],
  ["full", "every GPU and NVSwitch goes to a single guest, with Fabric Manager running in it"],
]);

/**
 * The reading of a tier, or `undefined` for a value this extension does not
 * know. The schema constrains `tier` with an enum today, but an unknown value
 * is displayed as it arrives rather than forced into one of the three.
 */
export function describeTier(tier?: string): string | undefined {
  return tier === undefined ? undefined : tierReadings.get(tier);
}

/** The reading of a partition mode, or `undefined` for an unknown value. */
export function describePartitionMode(partitionMode?: string): string | undefined {
  return partitionMode === undefined ? undefined : partitionModeReadings.get(partitionMode);
}

// The metadata is declared namespace-scoped rather than with the generic
// `KubeObjectMetadata` the earlier models use: it makes `getNs()` a `string`,
// which is what the `NamespaceSelectBadge` of the list cell needs, and it says
// in the type what `namespaced = true` says just below.
export class SwiftGPUProfile extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftGPUProfileStatus,
  SwiftGPUProfileSpec
> {
  static readonly kind = "SwiftGPUProfile";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gpu.kubeswift.io/v1alpha1/swiftgpuprofiles";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["gpu.kubeswift.io/v1alpha1"],
    plural: "swiftgpuprofiles",
    singular: "swiftgpuprofile",
    shortNames: ["sgp"],
    title: "GPU Profiles",
  };

  static getCount(object: SwiftGPUProfile): number | undefined {
    return object.spec?.count;
  }

  /**
   * The model filter as it should read: the schema uses the empty string for
   * "any model matches", which is a fact rather than a missing value, so it
   * becomes "Any". A genuinely absent field stays `undefined` and the views
   * apply their own "N/A".
   */
  static getModelLabel(object: SwiftGPUProfile): string | undefined {
    const model = object.spec?.model;

    if (model === undefined) {
      return undefined;
    }

    return model === "" ? anyModelLabel : model;
  }

  static getTier(object: SwiftGPUProfile): string | undefined {
    return object.spec?.tier;
  }

  static getTierReading(object: SwiftGPUProfile): string | undefined {
    return describeTier(object.spec?.tier);
  }

  static getPartitionMode(object: SwiftGPUProfile): string | undefined {
    return object.spec?.partitionMode;
  }

  static getPartitionModeReading(object: SwiftGPUProfile): string | undefined {
    return describePartitionMode(object.spec?.partitionMode);
  }

  /** Same distinction as the model: the empty string means "no hugepages". */
  static getHugepagesLabel(object: SwiftGPUProfile): string | undefined {
    const hugepages = object.spec?.hugepages;

    if (hugepages === undefined) {
      return undefined;
    }

    return hugepages === "" ? noHugepagesLabel : hugepages;
  }

  static getVcpuPinning(object: SwiftGPUProfile): boolean | undefined {
    return object.spec?.vcpuPinning;
  }

  /** The per-socket memory of the virtual NUMA topology, humanized from MiB. */
  static getMemoryPerSocket(object: SwiftGPUProfile): string | undefined {
    return formatMebibytes(object.spec?.numaTopology?.memoryPerSocketMi);
  }

  /**
   * Where Fabric Manager runs. The field is a boolean, but what it decides is
   * a location, so that is what the drawer shows.
   */
  static getFabricManagerLocation(object: SwiftGPUProfile): "Guest" | "Host" | undefined {
    const runInGuest = object.spec?.fabricManager?.runInGuest;

    if (runInGuest === undefined) {
      return undefined;
    }

    return runInGuest ? "Guest" : "Host";
  }

  /**
   * The guests that reference this profile. `spec.gpuProfileRef` is a
   * `LocalObjectReference`, so the match is namespace-local by construction
   * and the caller only ever needs to hold this profile's own namespace.
   */
  static getGuestsUsing(object: SwiftGPUProfile, guests: readonly SwiftGuest[]): SwiftGuest[] {
    const name = object.getName();
    const namespace = object.getNs();

    return guests.filter((guest) => guest.getNs() === namespace && guest.spec?.gpuProfileRef?.name === name);
  }
}

export class SwiftGPUProfileApi extends Renderer.K8sApi.KubeApi<SwiftGPUProfile> {}
export class SwiftGPUProfileStore extends Renderer.K8sApi.KubeObjectStore<SwiftGPUProfile, SwiftGPUProfileApi> {}

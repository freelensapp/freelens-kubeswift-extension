import { Renderer } from "@freelensapp/extensions";

import type {
  Condition,
  KubeSwiftKubeObjectCRD,
  LocalObjectReference,
  NamespacedObjectReference,
  ObjectReference,
} from "./types";

/**
 * Model for `swiftguests.swift.kubeswift.io/v1alpha1`.
 *
 * The interfaces below are written from the published CustomResourceDefinition
 * schema. Fields that the CRD declares without an `enum` are typed as plain
 * strings even when the documentation lists the values in use, so that an
 * unexpected value coming from the cluster never breaks the views.
 */

export type SwiftGuestOsType = "linux" | "windows";

export type SwiftGuestRunPolicy = "Running" | "Stopped" | "RestartOnFailure" | "Always";

export type SwiftGuestPhase = "Pending" | "Scheduling" | "Running" | "Stopped" | "Failed";

export type SwiftGuestVolumeMode = "Block" | "Filesystem";

export type SwiftGuestAccessMode = "ReadWriteOnce" | "ReadWriteMany";

export type SwiftGuestInterfaceType = "bridge" | "sriov" | "vhost-user";

export type SwiftGuestNetworkBinding = "nat" | "bridge";

export type SwiftGuestServiceExposure = "ClusterIP" | "NodePort" | "LoadBalancer";

export type SwiftGuestProtocol = "TCP" | "UDP" | "SCTP";

export type SwiftGuestGpuTier = "pcie" | "hgx-shared" | "hgx-full";

export type SwiftGuestSeedIdentityField = "hostname" | "machineId" | "sshHostKeys" | "macAddresses";

export type SwiftGuestDrainPolicy = "Migrate" | "LiveMigrate" | "Block";

export type SwiftGuestMigrationMode = "auto" | "live" | "offline";

export type SwiftGuestVhostUserDeviceType = "blk" | "generic";

export interface SwiftGuestCloneFromSnapshot {
  snapshotRef: LocalObjectReference;
  /** Guest identity fields to regenerate on the clone. */
  regenerate?: SwiftGuestSeedIdentityField[];
  targetNode?: string;
}

export interface SwiftGuestBlankDisk {
  /** Kubernetes quantity, for example `20Gi`. */
  size: number | string;
  storageClassName?: string;
  volumeMode?: SwiftGuestVolumeMode;
}

export interface SwiftGuestDataDisk {
  name: string;
  attachAsDisk?: boolean;
  blank?: SwiftGuestBlankDisk;
  imageRef?: LocalObjectReference;
  pvcRef?: LocalObjectReference;
}

export interface SwiftGuestFilesystemSource {
  hostPath?: string;
  pvcRef?: LocalObjectReference;
}

export interface SwiftGuestFilesystem {
  name: string;
  source: SwiftGuestFilesystemSource;
  readOnly?: boolean;
  tag?: string;
}

export interface SwiftGuestGpuResourceClaim {
  hugepages?: string;
  requestName?: string;
  resourceClaimName?: string;
  resourceClaimTemplateName?: string;
  tier?: SwiftGuestGpuTier;
}

export interface SwiftGuestGuestAgent {
  enabled?: boolean;
}

export interface SwiftGuestInterface {
  name: string;
  mac?: string;
  networkRef?: NamespacedObjectReference;
  primary?: boolean;
  resourceName?: string;
  socket?: string;
  type?: SwiftGuestInterfaceType;
}

export interface SwiftGuestMigration {
  drainPolicy?: SwiftGuestDrainPolicy;
  enabled?: boolean;
  preferredMode?: SwiftGuestMigrationMode;
}

export interface SwiftGuestPort {
  port: number;
  expose?: SwiftGuestServiceExposure;
  name?: string;
  protocol?: SwiftGuestProtocol;
  targetPort?: number;
}

export interface SwiftGuestNetwork {
  binding?: SwiftGuestNetworkBinding;
  loadBalancerClass?: string;
  ports?: SwiftGuestPort[];
  serviceAnnotations?: Record<string, string>;
}

export interface SwiftGuestStorage {
  accessMode?: SwiftGuestAccessMode;
  storageClassName?: string;
  volumeMode?: SwiftGuestVolumeMode;
}

export interface SwiftGuestLabelSelectorRequirement {
  key: string;
  operator: string;
  values?: string[];
}

export interface SwiftGuestLabelSelector {
  matchExpressions?: SwiftGuestLabelSelectorRequirement[];
  matchLabels?: Record<string, string>;
}

export interface SwiftGuestTopologySpreadConstraint {
  maxSkew: number;
  topologyKey: string;
  whenUnsatisfiable: string;
  labelSelector?: SwiftGuestLabelSelector;
  matchLabelKeys?: string[];
  minDomains?: number;
  nodeAffinityPolicy?: string;
  nodeTaintsPolicy?: string;
}

export interface SwiftGuestVhostUserDevice {
  name: string;
  socket: string;
  type: SwiftGuestVhostUserDeviceType;
  queueSizes?: number[];
  virtioId?: string;
}

export interface SwiftGuestSpec {
  /** The only required field of the spec: sizing of the guest. */
  guestClassRef: LocalObjectReference;
  cloneFromSnapshot?: SwiftGuestCloneFromSnapshot;
  dataDiskRef?: LocalObjectReference;
  dataDiskRefs?: SwiftGuestDataDisk[];
  filesystems?: SwiftGuestFilesystem[];
  gpuProfileRef?: LocalObjectReference;
  gpuResourceClaim?: SwiftGuestGpuResourceClaim;
  guestAgent?: SwiftGuestGuestAgent;
  /** Disk boot: the guest image to start from. Alternative to `kernelRef`. */
  imageRef?: LocalObjectReference;
  interfaces?: SwiftGuestInterface[];
  /** Kernel boot: per guest kernel parameters. */
  kernelCmdline?: string;
  /** Kernel boot: the kernel to start. Alternative to `imageRef`. */
  kernelRef?: LocalObjectReference;
  migration?: SwiftGuestMigration;
  network?: SwiftGuestNetwork;
  nodeName?: string;
  osType?: SwiftGuestOsType;
  runPolicy?: SwiftGuestRunPolicy;
  schedulerName?: string;
  /** Cloud-init profile, disk boot only. */
  seedProfileRef?: LocalObjectReference;
  storage?: SwiftGuestStorage;
  topologySpreadConstraints?: SwiftGuestTopologySpreadConstraint[];
  vhostUserDevices?: SwiftGuestVhostUserDevice[];
}

export interface SwiftGuestConsoleStatus {
  serialSocket?: string;
}

export interface SwiftGuestDataDiskStatus {
  name: string;
  bound: boolean;
  devicePath?: string;
  pvcName?: string;
  volumeMode?: string;
}

export interface SwiftGuestGpuStatus {
  /** PCI addresses of the devices assigned to the guest. */
  devices?: string[];
  hypervisor?: string;
  nodeName?: string;
  numaNodes?: number[];
  /** Fabric manager partition, `-1` when the guest has no partition. */
  partitionId?: number;
}

export interface SwiftGuestExposedPortStatus {
  port: number;
  targetPort: number;
  name?: string;
  protocol?: string;
}

export interface SwiftGuestInterfaceStatus {
  ip?: string;
  mac?: string;
  name?: string;
}

export interface SwiftGuestNetworkStatus {
  egress?: string;
  exposedPorts?: SwiftGuestExposedPortStatus[];
  interface?: string;
  interfaces?: SwiftGuestInterfaceStatus[];
  primaryIP?: string;
  ready?: boolean;
  serviceRef?: LocalObjectReference;
}

export interface SwiftGuestRuntimeStatus {
  /** `cloud-hypervisor` or `qemu` in the documented deployments. */
  hypervisor?: string;
  /** Process id of the hypervisor on the node. */
  pid?: number;
}

export interface SwiftGuestStorageStatus {
  accessMode?: string;
  storageClassName?: string;
  volumeMode?: string;
}

export interface SwiftGuestStatus {
  conditions?: Condition[];
  console?: SwiftGuestConsoleStatus;
  dataDisks?: SwiftGuestDataDiskStatus[];
  gpu?: SwiftGuestGpuStatus;
  lastRestartTime?: string;
  network?: SwiftGuestNetworkStatus;
  nodeName?: string;
  phase?: SwiftGuestPhase;
  podRef?: ObjectReference;
  restartCount?: number;
  runtime?: SwiftGuestRuntimeStatus;
  storage?: SwiftGuestStorageStatus;
}

// `NamespaceScopedMetadata` rather than the generic `KubeObjectMetadata` this
// model was written with, matching every model since M3: a SwiftGuest is always
// namespaced, so `getNs()` returns a string rather than `string | undefined`,
// and the views stop carrying a fallback for a case the API cannot produce.
export class SwiftGuest extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftGuestStatus,
  SwiftGuestSpec
> {
  static readonly kind = "SwiftGuest";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/swift.kubeswift.io/v1alpha1/swiftguests";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["swift.kubeswift.io/v1alpha1"],
    plural: "swiftguests",
    singular: "swiftguest",
    shortNames: ["sg"],
    title: "Guests",
  };

  static getPhase(object: SwiftGuest): SwiftGuestPhase | undefined {
    return object.status?.phase;
  }

  static getNodeName(object: SwiftGuest): string | undefined {
    return object.status?.nodeName;
  }

  static getPrimaryIP(object: SwiftGuest): string | undefined {
    return object.status?.network?.primaryIP;
  }

  static getRestartCount(object: SwiftGuest): number {
    return object.status?.restartCount ?? 0;
  }

  static getOsType(object: SwiftGuest): SwiftGuestOsType {
    // The CRD defaults `osType` to `linux`, but the field is only defaulted
    // once the API server has admitted the object.
    return object.spec?.osType ?? "linux";
  }

  static getRunPolicy(object: SwiftGuest): SwiftGuestRunPolicy | undefined {
    return object.spec?.runPolicy;
  }

  static getHypervisor(object: SwiftGuest): string | undefined {
    return object.status?.runtime?.hypervisor;
  }

  /**
   * The launcher pod the controller published for this guest.
   *
   * `status.podRef` and never the `swift.kubeswift.io/guest` label: the field is
   * the controller's own pointer to the pod it created, and it is nil'd when the
   * pod is not scheduled, which a label selection could not tell (SPEC-0010,
   * spike S6).
   */
  static getPodName(object: SwiftGuest): string | undefined {
    return object.status?.podRef?.name;
  }

  /**
   * The serial socket the cluster published for this guest, if any.
   *
   * It answers **where**, never **whether**: the controller sets it from a pod
   * annotation and never clears it, so a stopped guest can still carry it
   * (SPEC-0017). Nothing guards on it; the console command prefers it over the
   * derived convention, after validating it (`components/console-commands.ts`).
   */
  static getSerialSocket(object: SwiftGuest): string | undefined {
    return object.status?.console?.serialSocket;
  }

  /**
   * A guest boots either from a disk image or from a kernel, never from both.
   * Returns the kind of boot the spec asks for, or `undefined` when neither
   * reference is set.
   */
  static getBootSource(object: SwiftGuest): { kind: "image" | "kernel"; name: string } | undefined {
    const imageName = object.spec?.imageRef?.name;

    if (imageName) {
      return { kind: "image", name: imageName };
    }

    const kernelName = object.spec?.kernelRef?.name;

    if (kernelName) {
      return { kind: "kernel", name: kernelName };
    }

    return undefined;
  }

  /**
   * The SwiftGuestPool that owns this guest, when one does.
   *
   * A pool sets a CONTROLLER reference on the guests it creates, and recreates
   * any of them that is deleted on its own, which is the one thing about
   * deleting a guest that only KubeSwift's ownership model knows (SPEC-0010,
   * the Managed By row). A plain (non-controller) owner reference is ignored:
   * it expresses a cascade, not the management relationship this row is about.
   *
   * The kind is matched together with its API group, the same rule the detail
   * and menu registrations use, so an unrelated `SwiftGuestPool` from another
   * project could never be reported as this guest's manager.
   */
  static getOwningPool(object: SwiftGuest): { name: string; namespace: string } | undefined {
    const owner = object.metadata?.ownerReferences?.find(
      (reference) =>
        reference.controller === true &&
        reference.kind === "SwiftGuestPool" &&
        reference.apiVersion?.startsWith("swift.kubeswift.io/"),
    );

    return owner?.name ? { name: owner.name, namespace: object.getNs() } : undefined;
  }

  /**
   * GPU partitions are reported as `-1` when the guest is not part of a fabric
   * manager partition, which is not worth showing.
   */
  static getGpuPartitionId(object: SwiftGuest): number | undefined {
    const partitionId = object.status?.gpu?.partitionId;

    return partitionId === undefined || partitionId < 0 ? undefined : partitionId;
  }
}

export class SwiftGuestApi extends Renderer.K8sApi.KubeApi<SwiftGuest> {}
export class SwiftGuestStore extends Renderer.K8sApi.KubeObjectStore<SwiftGuest, SwiftGuestApi> {}

import { Renderer } from "@freelensapp/extensions";
import { type Condition, formatBytes, type KubeSwiftKubeObjectCRD, type LocalObjectReference } from "./types";

/**
 * Model for `swiftsnapshots.snapshot.kubeswift.io/v1alpha1`.
 *
 * A SwiftSnapshot is a point-in-time capture of a SwiftGuest's disk, and
 * depending on the backend of its memory too. The interfaces below are written
 * from the published CustomResourceDefinition schema.
 */

export type SwiftSnapshotBackendType = "csi-volume-snapshot" | "local" | "s3" | "oci";

export type SwiftSnapshotDeletionPolicy = "Delete" | "Retain";

export type SwiftSnapshotPhase = "Pending" | "Capturing" | "Uploading" | "Ready" | "Failed";

export interface SwiftSnapshotCsiVolumeSnapshotBackend {
  /** Empty means the cluster's default VolumeSnapshotClass. */
  volumeSnapshotClassName?: string;
}

export interface SwiftSnapshotLocalBackend {
  /** Directory on the node the snapshot is written to. */
  hostPath?: string;
}

export interface SwiftSnapshotOciBackend {
  /** Target repository without a tag, the artifact is pushed to `repository:tag`. */
  repository?: string;
  /** `kubernetes.io/dockerconfigjson` Secret, empty means anonymous access. */
  credentialsSecretRef?: LocalObjectReference;
  /** Allows a plaintext registry. Unsafe, for in-cluster test registries only. */
  insecure?: boolean;
  /** Secret holding the cosign keypair the push signs the artifact with. */
  signingKeySecretRef?: LocalObjectReference;
  /** Empty defaults to `<namespace>-<snapshot>`. */
  tag?: string;
}

export interface SwiftSnapshotS3Backend {
  bucket?: string;
  /** Secret with `accessKeyId`, `secretAccessKey` and an optional `sessionToken`. */
  credentialsSecretRef?: LocalObjectReference;
  /** S3-compatible endpoint. Empty targets AWS S3. */
  endpoint?: string;
  /** Path-style addressing, typically required by MinIO and Ceph RGW. */
  forcePathStyle?: boolean;
  insecure?: boolean;
  prefix?: string;
  region?: string;
}

export interface SwiftSnapshotBackend {
  type: SwiftSnapshotBackendType;
  csiVolumeSnapshot?: SwiftSnapshotCsiVolumeSnapshotBackend;
  local?: SwiftSnapshotLocalBackend;
  oci?: SwiftSnapshotOciBackend;
  s3?: SwiftSnapshotS3Backend;
}

export interface SwiftSnapshotSpec {
  backend: SwiftSnapshotBackend;
  /** The SwiftGuest in the same namespace to snapshot. */
  guestRef: LocalObjectReference;
  /** Whether deleting the snapshot also purges its backend artifacts. */
  deletionPolicy?: SwiftSnapshotDeletionPolicy;
  /** Captures the disk alongside memory, for a full-state capture. `oci` only. */
  includeDisk?: boolean;
  /** Kept for forward compatibility: the captured set is backend-determined. */
  includeMemory?: boolean;
  resumeAfterSnapshot?: boolean;
  /** Age-based retention, measured from `status.capturedAt`. */
  ttl?: string;
}

/** One captured disk, by role and backend-specific handle. */
export interface SwiftSnapshotDiskRef {
  /** `root` or `data`. */
  role: string;
  /** Set for `data` disks, to tell several of them apart. */
  diskName?: string;
  /** Backend-specific identifier: a VolumeSnapshot, a path or an object key. */
  handle?: string;
  sizeBytes?: number;
}

/** One secondary VM data disk frozen at capture time. */
export interface SwiftSnapshotCapturedDataDisk {
  name: string;
  /** True for a raw block disk, false for a filesystem-backed image. */
  block?: boolean;
  /** Source-cluster PVC, meaningless to the import side. */
  pvcName?: string;
  size?: string;
}

export interface SwiftSnapshotCapturedStorage {
  accessMode?: string;
  storageClassName?: string;
  volumeMode?: string;
}

/** The source guest's spec at capture time, used to validate a restore. */
export interface SwiftSnapshotCapturedGuestSpec {
  cpu?: string;
  dataDisks?: SwiftSnapshotCapturedDataDisk[];
  guestAgent?: boolean;
  hasDataDisks?: boolean;
  hasSeed?: boolean;
  imageName?: string;
  /** NIC names, used to seed deterministic per-clone MAC rewrites. */
  interfaceNames?: string[];
  memoryMi?: number;
  network?: boolean;
  osType?: string;
  rootDiskSize?: string;
  storage?: SwiftSnapshotCapturedStorage;
}

export interface SwiftSnapshotMemorySnapshotRef {
  handle?: string;
  sizeBytes?: number;
}

/** One secondary data disk's chunked OCI artifact. */
export interface SwiftSnapshotOciDataDiskArtifact {
  name: string;
  manifestDigest?: string;
  pushedBytes?: number;
  reference?: string;
}

export interface SwiftSnapshotOciDiskArtifact {
  manifestDigest?: string;
  pushedBytes?: number;
  reference?: string;
}

export interface SwiftSnapshotOciStatus {
  dataDisks?: SwiftSnapshotOciDataDiskArtifact[];
  /** Only set for a full-state capture, when `spec.includeDisk` is true. */
  disk?: SwiftSnapshotOciDiskArtifact;
  /** A restore pulls `repository@manifestDigest`, so the artifact is pinned. */
  manifestDigest?: string;
  pushedAt?: string;
  pushedBytes?: number;
  reference?: string;
  /** True when the push cosign-signed the artifact as an OCI referrer. */
  signed?: boolean;
}

export interface SwiftSnapshotS3Status {
  /** S3 URI of the snapshot prefix. */
  location?: string;
  manifestDigest?: string;
  uploadedAt?: string;
  uploadedBytes?: number;
}

export interface SwiftSnapshotStatus {
  capturedAt?: string;
  conditions?: Condition[];
  disks?: SwiftSnapshotDiskRef[];
  guestSpec?: SwiftSnapshotCapturedGuestSpec;
  hypervisor?: string;
  hypervisorVersion?: string;
  /** Unset when the backend captures no memory. */
  memorySnapshot?: SwiftSnapshotMemorySnapshotRef;
  /** Only set for the `local` backend, whose artifacts live on one node. */
  nodeName?: string;
  /** How long the source VM was paused during a `local` capture. */
  observedPauseWindowMs?: number;
  oci?: SwiftSnapshotOciStatus;
  phase?: SwiftSnapshotPhase;
  s3?: SwiftSnapshotS3Status;
  /** On-disk format version of the snapshot directory. */
  snapshotDirVersion?: string;
  totalSizeBytes?: number;
}

/** What a backend actually captures, for the list's Contents column. */
export type SwiftSnapshotContents = "Disk" | "Memory" | "Memory + disk";

/** Where the captured artifacts ended up, for the detail panel. */
export interface SwiftSnapshotArtifactLocation {
  title: string;
  reference: string;
}

export class SwiftSnapshot extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftSnapshotStatus,
  SwiftSnapshotSpec
> {
  static readonly kind = "SwiftSnapshot";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/snapshot.kubeswift.io/v1alpha1/swiftsnapshots";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
    plural: "swiftsnapshots",
    singular: "swiftsnapshot",
    shortNames: ["ssnap"],
    title: "SwiftSnapshots",
  };

  static getPhase(object: SwiftSnapshot): SwiftSnapshotPhase | undefined {
    return object.status?.phase;
  }

  /** The guest the snapshot was taken from. Always in the same namespace. */
  static getGuestName(object: SwiftSnapshot): string | undefined {
    return object.spec?.guestRef?.name || undefined;
  }

  static getBackendType(object: SwiftSnapshot): SwiftSnapshotBackendType | undefined {
    return object.spec?.backend?.type;
  }

  /**
   * What the snapshot holds. The schema documents the captured set as
   * backend-determined rather than driven by `spec.includeMemory`:
   * `csi-volume-snapshot` is disk-only, `local` and `s3` always take memory
   * along with the disk state, and `oci` captures memory plus, when
   * `spec.includeDisk` is set, the disk as well.
   *
   * Unknown backends are treated as opaque, the way the schema asks phase
   * consumers to treat unknown phases.
   */
  static getContents(object: SwiftSnapshot): SwiftSnapshotContents | undefined {
    switch (SwiftSnapshot.getBackendType(object)) {
      case "csi-volume-snapshot":
        return "Disk";
      case "local":
      case "s3":
        return "Memory + disk";
      case "oci":
        return object.spec?.includeDisk ? "Memory + disk" : "Memory";
      default:
        return undefined;
    }
  }

  /** Total captured size, rendered as a Kubernetes-style quantity. */
  static getTotalSize(object: SwiftSnapshot): string | undefined {
    return formatBytes(object.status?.totalSizeBytes);
  }

  static getMemorySnapshotSize(object: SwiftSnapshot): string | undefined {
    return formatBytes(object.status?.memorySnapshot?.sizeBytes);
  }

  static getDisks(object: SwiftSnapshot): SwiftSnapshotDiskRef[] {
    return object.status?.disks ?? [];
  }

  /**
   * Where the artifacts landed. Only one of the backend status blocks is ever
   * populated, and only once the capture has been uploaded.
   */
  static getArtifactLocation(object: SwiftSnapshot): SwiftSnapshotArtifactLocation | undefined {
    const status = object.status;
    const ociReference = status?.oci?.reference || status?.oci?.manifestDigest;

    if (ociReference) {
      return { title: "OCI artifact", reference: ociReference };
    }

    if (status?.s3?.location) {
      return { title: "S3 location", reference: status.s3.location };
    }

    const hostPath = object.spec?.backend?.local?.hostPath;

    if (hostPath) {
      return { title: "Host path", reference: hostPath };
    }

    return undefined;
  }

  /** The CRD defaults the deletion policy to purging the backend artifacts. */
  static getDeletionPolicy(object: SwiftSnapshot): SwiftSnapshotDeletionPolicy {
    return object.spec?.deletionPolicy ?? "Delete";
  }

  /** The CRD defaults `includeMemory` to true. */
  static getIncludeMemory(object: SwiftSnapshot): boolean {
    return object.spec?.includeMemory ?? true;
  }

  /** The CRD defaults `resumeAfterSnapshot` to true. */
  static getResumeAfterSnapshot(object: SwiftSnapshot): boolean {
    return object.spec?.resumeAfterSnapshot ?? true;
  }
}

export class SwiftSnapshotApi extends Renderer.K8sApi.KubeApi<SwiftSnapshot> {}
export class SwiftSnapshotStore extends Renderer.K8sApi.KubeObjectStore<SwiftSnapshot, SwiftSnapshotApi> {}

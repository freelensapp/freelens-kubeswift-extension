import { Renderer } from "@freelensapp/extensions";
import {
  type Condition,
  formatQuantity,
  type KubeSwiftKubeObjectCRD,
  type LocalObjectReference,
  type NamespacedObjectReference,
  type Quantity,
} from "./types";

/**
 * Model for `swiftimages.image.kubeswift.io/v1alpha1`.
 *
 * A SwiftImage is a guest disk image the controller imports, converts and
 * prepares into a PVC. The interfaces below are written from the published
 * CustomResourceDefinition schema.
 */

export type SwiftImageDiskFormat = "raw" | "qcow2";

export type SwiftImageCloneStrategy = "copy" | "snapshot";

export type SwiftImageOsType = "linux" | "windows";

export type SwiftImagePhase =
  | "Pending"
  | "Importing"
  | "Validating"
  | "Preparing"
  | "Snapshotting"
  | "Ready"
  | "Failed";

export interface SwiftImageHttpSource {
  url: string;
}

export interface SwiftImageOciSource {
  /** Repository without a tag, for example `ghcr.io/org/golden-ubuntu`. */
  repository: string;
  /** Registry credentials, a `kubernetes.io/dockerconfigjson` Secret. */
  credentialsSecretRef?: LocalObjectReference;
  /** Pins the artifact by manifest digest. Mutually exclusive with `tag`. */
  digest?: string;
  insecure?: boolean;
  tag?: string;
  /** Secret holding the cosign public key the import verifies against. */
  verifyKeySecretRef?: LocalObjectReference;
}

/** Placeholder for the upload flow, which the CRD declares but does not implement. */
export type SwiftImageUploadSource = Record<string, never>;

export interface SwiftImageSource {
  http?: SwiftImageHttpSource;
  oci?: SwiftImageOciSource;
  pvcClone?: NamespacedObjectReference;
  upload?: SwiftImageUploadSource;
}

export interface SwiftImageRootDisk {
  /** Import PVC size. Defaults to 10Gi in the controller when unset. */
  size?: Quantity;
}

export interface SwiftImageSpec {
  format: SwiftImageDiskFormat;
  source: SwiftImageSource;
  cloneStorageClassName?: string;
  cloneStrategy?: SwiftImageCloneStrategy;
  importStorageClassName?: string;
  osType?: SwiftImageOsType;
  rootDisk?: SwiftImageRootDisk;
  volumeSnapshotClassName?: string;
}

/** Resource per-guest cloning references when the strategy is `snapshot`. */
export interface SwiftImageCloneSeed {
  kind: "VolumeSnapshot";
  name: string;
  namespace: string;
  sourceSizeBytes?: number;
}

export interface SwiftImagePreparedArtifact {
  format: SwiftImageDiskFormat;
  pvcRef?: NamespacedObjectReference;
  size?: Quantity;
}

export interface SwiftImageStatus {
  cloneSeed?: SwiftImageCloneSeed;
  conditions?: Condition[];
  phase?: SwiftImagePhase;
  preparedArtifact?: SwiftImagePreparedArtifact;
  preparedFormat?: SwiftImageDiskFormat;
  /** Internal hand-off between the Validating and Preparing phases. */
  sizeHint?: number;
  sourceFormat?: SwiftImageDiskFormat;
}

export type SwiftImageSourceKind = "http" | "oci" | "pvcClone" | "upload";

export interface SwiftImageSourceSummary {
  kind: SwiftImageSourceKind;
  /** Label of the source kind, for the detail panel. */
  title: string;
  /** Concise reference: the URL, the OCI reference or the source PVC. */
  reference?: string;
}

export class SwiftImage extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftImageStatus,
  SwiftImageSpec
> {
  static readonly kind = "SwiftImage";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/image.kubeswift.io/v1alpha1/swiftimages";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["image.kubeswift.io/v1alpha1"],
    plural: "swiftimages",
    singular: "swiftimage",
    shortNames: ["si"],
    title: "SwiftImages",
  };

  static getPhase(object: SwiftImage): SwiftImagePhase | undefined {
    return object.status?.phase;
  }

  /**
   * Exactly one source is set on an admitted image. Returns the one in use,
   * with a reference short enough for a table cell.
   */
  static getSourceSummary(object: SwiftImage): SwiftImageSourceSummary | undefined {
    const source = object.spec?.source;

    if (source?.http) {
      return { kind: "http", title: "HTTP", reference: source.http.url };
    }

    if (source?.oci) {
      const { repository, tag, digest } = source.oci;
      const reference = tag ? `${repository}:${tag}` : digest ? `${repository}@${digest}` : repository;

      return { kind: "oci", title: "OCI", reference };
    }

    if (source?.pvcClone) {
      const { name, namespace } = source.pvcClone;

      return { kind: "pvcClone", title: "PVC clone", reference: namespace ? `${namespace}/${name}` : name };
    }

    if (source?.upload) {
      return { kind: "upload", title: "Upload" };
    }

    return undefined;
  }

  /** The CRD defaults `cloneStrategy` to `copy` for backward compatibility. */
  static getCloneStrategy(object: SwiftImage): SwiftImageCloneStrategy {
    return object.spec?.cloneStrategy ?? "copy";
  }

  /** The CRD defaults `osType` to `linux`. */
  static getOsType(object: SwiftImage): SwiftImageOsType {
    return object.spec?.osType ?? "linux";
  }

  /** The status reports the measured source format; the spec declares it. */
  static getSourceFormat(object: SwiftImage): SwiftImageDiskFormat | undefined {
    return object.status?.sourceFormat ?? object.spec?.format;
  }

  static getPreparedFormat(object: SwiftImage): SwiftImageDiskFormat | undefined {
    return object.status?.preparedFormat ?? object.status?.preparedArtifact?.format;
  }

  static getPreparedSize(object: SwiftImage): string | undefined {
    return formatQuantity(object.status?.preparedArtifact?.size);
  }

  static getPreparedPvc(object: SwiftImage): NamespacedObjectReference | undefined {
    return object.status?.preparedArtifact?.pvcRef;
  }

  static getRootDiskSize(object: SwiftImage): string | undefined {
    return formatQuantity(object.spec?.rootDisk?.size);
  }
}

export class SwiftImageApi extends Renderer.K8sApi.KubeApi<SwiftImage> {}
export class SwiftImageStore extends Renderer.K8sApi.KubeObjectStore<SwiftImage, SwiftImageApi> {}

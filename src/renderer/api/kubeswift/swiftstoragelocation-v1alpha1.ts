import { Renderer } from "@freelensapp/extensions";

import type { Condition, KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftstoragelocations.storage.kubeswift.io/v1alpha1`.
 *
 * A SwiftStorageLocation is a namespace's own place to keep artifacts: an OCI
 * registry snapshots are pushed to and pulled from, a VolumeSnapshotClass for
 * the csi-volume-snapshot ones, or both. One location per namespace may be the
 * namespace default, which wins over the cluster default (a
 * SwiftClusterStorageLocation, whose model shares the spec and status types
 * declared here: the two CRDs have the same schema).
 *
 * The interfaces are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.18.0). The kind arrived after v0.13.12 (SPEC-0019, T3)
 * and is read-only in this extension.
 */

/** The registry half of a location. `repository` is the one required field. */
export interface StorageLocationOci {
  /** The repository prefix, without a tag or digest. */
  repository: string;
  /** Mutually exclusive with `credentialsSecretName` (a CEL rule of the CRD). */
  anonymous?: boolean;
  /** PEM CA certificates trusted for this registry, next to the system roots. */
  caBundle?: string;
  /** A dockerconfigjson Secret; unset (and not anonymous) means `kubeswift-registry`. */
  credentialsSecretName?: string;
  /** A plaintext (http) registry. Unsafe. */
  insecure?: boolean;
  /** A Secret with a cosign key pair, which signs every artifact pushed through the location. */
  signingKeySecretName?: string;
  /** A PEM cosign public key every artifact pulled through the location must be signed for. */
  verifyKey?: string;
}

/** The CSI half of a location. */
export interface StorageLocationCsi {
  volumeSnapshotClassName: string;
}

/** The spec of both storage location kinds. A location sets `oci`, `csi` or both. */
export interface StorageLocationSpec {
  default?: boolean;
  oci?: StorageLocationOci;
  csi?: StorageLocationCsi;
}

/** The status of both storage location kinds: conditions only. */
export interface StorageLocationStatus {
  conditions?: Condition[];
  observedGeneration?: number;
}

/** The credentials Secret the controller looks up when a registry names none and is not anonymous. */
export const defaultCredentialsSecretName = "kubeswift-registry";

/** The two readings of the Default column: a location is the default at its level, or it is not. */
export const defaultLocationLabel = "Yes";
export const notDefaultLocationLabel = "No";

/** What `insecure: true` means, in this extension's words. */
export const insecureRegistryTooltip =
  "Off when the location allows a plaintext (http) registry: credentials and artifacts then cross the network " +
  "unencrypted, which is only acceptable for a test registry on a trusted network";

/** The backends a spec sets, as one word or two, or `undefined` when it sets neither. */
export function storageLocationBackends(spec?: StorageLocationSpec): string | undefined {
  const backends = [spec?.oci ? "OCI" : undefined, spec?.csi ? "CSI" : undefined].filter(Boolean);

  return backends.length > 0 ? backends.join(" and ") : undefined;
}

/**
 * The credentials Secret the controller will look up for the registry, or
 * `undefined` when there is no registry or it is anonymous. An unset name is
 * not a missing value: the controller then looks up `kubeswift-registry`.
 */
export function storageLocationCredentialsSecret(spec?: StorageLocationSpec): string | undefined {
  const oci = spec?.oci;

  if (!oci || oci.anonymous) {
    return undefined;
  }

  return oci.credentialsSecretName || defaultCredentialsSecretName;
}

/** Whether the credentials Secret is the default name rather than one the spec gives. */
export function usesDefaultCredentialsSecret(spec?: StorageLocationSpec): boolean {
  return Boolean(spec?.oci && !spec.oci.anonymous && !spec.oci.credentialsSecretName);
}

/** The Secrets a location names, deduplicated and sorted: the registry credentials and the signing key. */
export function storageLocationSecretNames(spec?: StorageLocationSpec): string[] {
  const names = [storageLocationCredentialsSecret(spec), spec?.oci?.signingKeySecretName];

  return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
}

/** The status of the condition of `type`, as a boolean, or `undefined` when it is absent or `Unknown`. */
export function storageLocationConditionValue(
  status: StorageLocationStatus | undefined,
  type: string,
): boolean | undefined {
  const value = status?.conditions?.find((condition) => condition.type === type)?.status;

  return value === "True" ? true : value === "False" ? false : undefined;
}

export class SwiftStorageLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  StorageLocationStatus,
  StorageLocationSpec
> {
  declare kind: "SwiftStorageLocation";
  declare apiVersion: "storage.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftStorageLocation";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/storage.kubeswift.io/v1alpha1/swiftstoragelocations";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["storage.kubeswift.io/v1alpha1"],
    plural: "swiftstoragelocations",
    singular: "swiftstoragelocation",
    shortNames: ["sloc"],
    title: "Storage Locations",
  };

  /** Whether this is the namespace default. An unset flag is `false`, as the controller reads it. */
  static isDefault(object: SwiftStorageLocation): boolean {
    return object.spec?.default === true;
  }

  static getDefaultLabel(object: SwiftStorageLocation): string {
    return SwiftStorageLocation.isDefault(object) ? defaultLocationLabel : notDefaultLocationLabel;
  }

  static getRepository(object: SwiftStorageLocation): string | undefined {
    return object.spec?.oci?.repository;
  }

  static getVolumeSnapshotClassName(object: SwiftStorageLocation): string | undefined {
    return object.spec?.csi?.volumeSnapshotClassName;
  }

  static getBackends(object: SwiftStorageLocation): string | undefined {
    return storageLocationBackends(object.spec);
  }

  static getCredentialsSecretName(object: SwiftStorageLocation): string | undefined {
    return storageLocationCredentialsSecret(object.spec);
  }

  /** The Secrets the drawer resolves in the location's own namespace. */
  static getSecretNames(object: SwiftStorageLocation): string[] {
    return storageLocationSecretNames(object.spec);
  }

  static getObservedGeneration(object: SwiftStorageLocation): number | undefined {
    return object.status?.observedGeneration;
  }
}

export class SwiftStorageLocationApi extends Renderer.K8sApi.KubeApi<SwiftStorageLocation> {}
export class SwiftStorageLocationStore extends Renderer.K8sApi.KubeObjectStore<
  SwiftStorageLocation,
  SwiftStorageLocationApi
> {}

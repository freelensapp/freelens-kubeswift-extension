import { Renderer } from "@freelensapp/extensions";
import {
  defaultLocationLabel,
  notDefaultLocationLabel,
  type StorageLocationSpec,
  type StorageLocationStatus,
  storageLocationBackends,
  storageLocationConditionValue,
  storageLocationCredentialsSecret,
} from "./swiftstoragelocation-v1alpha1";

import type { KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftclusterstoragelocations.storage.kubeswift.io/v1alpha1`.
 *
 * The cluster-wide storage location, managed by the cluster admin; one may be
 * the cluster default, which a namespace default overrides. Its spec and
 * status are the SwiftStorageLocation ones (the CRDs share the schema), and
 * the controller also reports whether the registry answers (`Reachable`).
 *
 * The Secrets a cluster location names are not objects of its own: the
 * controller looks each one up in the namespace of the object that uses the
 * location, so a drawer cannot resolve them to one Secret.
 */

/** The condition, next to `Ready`, that the CRD publishes as a printer column of this kind. */
export const reachableConditionType = "Reachable";

/** Why the Secrets of a cluster location are names and never links. */
export const clusterLocationSecretTooltip =
  "Looked up in the namespace of each object that uses this location, so it names a Secret per namespace rather " +
  "than one object";

export class SwiftClusterStorageLocation extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.ClusterScopedMetadata,
  StorageLocationStatus,
  StorageLocationSpec
> {
  declare kind: "SwiftClusterStorageLocation";
  declare apiVersion: "storage.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftClusterStorageLocation";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/storage.kubeswift.io/v1alpha1/swiftclusterstoragelocations";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["storage.kubeswift.io/v1alpha1"],
    plural: "swiftclusterstoragelocations",
    singular: "swiftclusterstoragelocation",
    shortNames: ["csloc"],
    title: "Cluster Storage Locations",
  };

  /** Whether this is the cluster default. An unset flag is `false`, as the controller reads it. */
  static isDefault(object: SwiftClusterStorageLocation): boolean {
    return object.spec?.default === true;
  }

  static getDefaultLabel(object: SwiftClusterStorageLocation): string {
    return SwiftClusterStorageLocation.isDefault(object) ? defaultLocationLabel : notDefaultLocationLabel;
  }

  static getRepository(object: SwiftClusterStorageLocation): string | undefined {
    return object.spec?.oci?.repository;
  }

  static getVolumeSnapshotClassName(object: SwiftClusterStorageLocation): string | undefined {
    return object.spec?.csi?.volumeSnapshotClassName;
  }

  static getBackends(object: SwiftClusterStorageLocation): string | undefined {
    return storageLocationBackends(object.spec);
  }

  static getCredentialsSecretName(object: SwiftClusterStorageLocation): string | undefined {
    return storageLocationCredentialsSecret(object.spec);
  }

  /** The `Reachable` condition as a boolean; `undefined` until the controller has probed the registry. */
  static getReachable(object: SwiftClusterStorageLocation): boolean | undefined {
    return storageLocationConditionValue(object.status, reachableConditionType);
  }

  static getObservedGeneration(object: SwiftClusterStorageLocation): number | undefined {
    return object.status?.observedGeneration;
  }
}

export class SwiftClusterStorageLocationApi extends Renderer.K8sApi.KubeApi<SwiftClusterStorageLocation> {}
export class SwiftClusterStorageLocationStore extends Renderer.K8sApi.KubeObjectStore<
  SwiftClusterStorageLocation,
  SwiftClusterStorageLocationApi
> {}

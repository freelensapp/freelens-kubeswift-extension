import { Renderer } from "@freelensapp/extensions";
import { formatQuantity, type KubeSwiftKubeObjectCRD, type Quantity } from "./types";

/**
 * Model for `swiftguestclasses.swift.kubeswift.io/v1alpha1`.
 *
 * A guest class is the cluster-scoped sizing template a SwiftGuest points at
 * through `spec.guestClassRef`. The interfaces below are written from the
 * published CustomResourceDefinition schema; the CRD declares no status
 * subresource, so a guest class has a spec and nothing else.
 */

export type SwiftGuestClassDiskFormat = "raw" | "qcow2";

export type SwiftGuestClassCoreScheduling = "off" | "vm" | "vcpu";

export type SwiftGuestClassAccessMode = "ReadWriteOnce" | "ReadWriteMany";

export type SwiftGuestClassVolumeMode = "Filesystem" | "Block";

export interface SwiftGuestClassRootDisk {
  format: SwiftGuestClassDiskFormat;
  size: Quantity;
}

/** Cluster default for the PVCs the SwiftGuest controller creates. */
export interface SwiftGuestClassStorage {
  accessMode?: SwiftGuestClassAccessMode;
  storageClassName?: string;
  volumeMode?: SwiftGuestClassVolumeMode;
}

export interface SwiftGuestClassSpec {
  cpu: Quantity;
  memory: Quantity;
  rootDisk: SwiftGuestClassRootDisk;
  coreScheduling?: SwiftGuestClassCoreScheduling;
  storage?: SwiftGuestClassStorage;
}

/** The CRD declares no status subresource: a guest class never reports one. */
export type SwiftGuestClassStatus = Record<string, never>;

export class SwiftGuestClass extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftGuestClassStatus,
  SwiftGuestClassSpec
> {
  static readonly kind = "SwiftGuestClass";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/swift.kubeswift.io/v1alpha1/swiftguestclasses";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["swift.kubeswift.io/v1alpha1"],
    plural: "swiftguestclasses",
    singular: "swiftguestclass",
    shortNames: ["sgc"],
    title: "SwiftGuestClasses",
  };

  static getCpu(object: SwiftGuestClass): string | undefined {
    return formatQuantity(object.spec?.cpu);
  }

  static getMemory(object: SwiftGuestClass): string | undefined {
    return formatQuantity(object.spec?.memory);
  }

  static getRootDiskSize(object: SwiftGuestClass): string | undefined {
    return formatQuantity(object.spec?.rootDisk?.size);
  }

  static getRootDiskFormat(object: SwiftGuestClass): SwiftGuestClassDiskFormat | undefined {
    return object.spec?.rootDisk?.format;
  }

  /**
   * The CRD defaults `coreScheduling` to `off` and documents that an empty
   * value means the same thing, so both are reported as `off`.
   */
  static getCoreScheduling(object: SwiftGuestClass): SwiftGuestClassCoreScheduling {
    return object.spec?.coreScheduling || "off";
  }
}

export class SwiftGuestClassApi extends Renderer.K8sApi.KubeApi<SwiftGuestClass> {}
export class SwiftGuestClassStore extends Renderer.K8sApi.KubeObjectStore<SwiftGuestClass, SwiftGuestClassApi> {}

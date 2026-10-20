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

/** `none` lets the host scheduler place the vCPUs; `static` pins each to its own host CPU (KubeSwift v0.14.0+). */
export type SwiftGuestClassCpuPinning = "none" | "static";

/** Sibling placement under `static` pinning. */
export type SwiftGuestClassSmtPolicy = "spread" | "pack";

/** The hugepage size backing the guest's memory; empty keeps ordinary pages. */
export type SwiftGuestClassHugepages = "" | "2Mi" | "1Gi";

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
  /** Default `none`. */
  cpuPinning?: SwiftGuestClassCpuPinning;
  /** Default `spread`; read only with `static` pinning. */
  smtPolicy?: SwiftGuestClassSmtPolicy;
  hugepages?: SwiftGuestClassHugepages;
  /** Default `false`; immutable. A node-local copy-on-write root disk. */
  sharedBaseDisk?: boolean;
}

/** The CRD declares no status subresource: a guest class never reports one. */
export type SwiftGuestClassStatus = Record<string, never>;

export class SwiftGuestClass extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftGuestClassStatus,
  SwiftGuestClassSpec
> {
  declare kind: "SwiftGuestClass";
  declare apiVersion: "swift.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftGuestClass";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/swift.kubeswift.io/v1alpha1/swiftguestclasses";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["swift.kubeswift.io/v1alpha1"],
    plural: "swiftguestclasses",
    singular: "swiftguestclass",
    shortNames: ["sgc"],
    title: "Guest Classes",
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

  /** The CRD defaults CPU pinning to `none` (KubeSwift v0.14.0+). */
  static getCpuPinning(object: SwiftGuestClass): SwiftGuestClassCpuPinning {
    return object.spec?.cpuPinning ?? "none";
  }

  /** The SMT policy, which the controller reads only under `static` pinning; `undefined` otherwise. */
  static getSmtPolicy(object: SwiftGuestClass): SwiftGuestClassSmtPolicy | undefined {
    return SwiftGuestClass.getCpuPinning(object) === "static" ? (object.spec?.smtPolicy ?? "spread") : undefined;
  }

  /** The hugepage size backing the memory, `undefined` for ordinary pages. */
  static getHugepages(object: SwiftGuestClass): SwiftGuestClassHugepages | undefined {
    return object.spec?.hugepages || undefined;
  }

  static isSharedBaseDisk(object: SwiftGuestClass): boolean {
    return object.spec?.sharedBaseDisk === true;
  }
}

export class SwiftGuestClassApi extends Renderer.K8sApi.KubeApi<SwiftGuestClass> {}
export class SwiftGuestClassStore extends Renderer.K8sApi.KubeObjectStore<SwiftGuestClass, SwiftGuestClassApi> {}

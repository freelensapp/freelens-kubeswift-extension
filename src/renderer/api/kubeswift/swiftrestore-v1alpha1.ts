import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest } from "./swiftguest-v1alpha1";
import { SwiftSnapshot } from "./swiftsnapshot-v1alpha1";
import {
  type Condition,
  formatBytes,
  type KubeObjectRef,
  type KubeSwiftKubeObjectCRD,
  type LocalObjectReference,
  toKubeObjectRef,
} from "./types";

/**
 * Model for `swiftrestores.snapshot.kubeswift.io/v1alpha1`.
 *
 * A SwiftRestore turns a SwiftSnapshot back into a SwiftGuest, either over the
 * guest it was taken from or into a new one. The interfaces below are written
 * from the published CustomResourceDefinition schema.
 */

export type SwiftRestoreIdentityItem = "hostname" | "machineId" | "sshHostKeys" | "macAddresses";

export type SwiftRestoreMemoryRestoreMode = "copy" | "ondemand";

export type SwiftRestorePhase = "Pending" | "Downloading" | "Restoring" | "Resuming" | "Ready" | "Failed";

/** Whether the restore lands on the existing guest or creates a new one. */
export type SwiftRestoreTargetMode = "In-place" | "Clone";

export interface SwiftRestoreIdentity {
  /** Guest identity attributes the controller resets on the restored guest. */
  regenerate?: SwiftRestoreIdentityItem[];
}

export interface SwiftRestoreTarget {
  /** Name of the resulting SwiftGuest. */
  name: string;
  /** Required to restore over a SwiftGuest that already exists at `name`. */
  overwriteExisting?: boolean;
}

export interface SwiftRestoreSpec {
  /** The SwiftSnapshot to restore, in the same namespace. */
  snapshotRef: LocalObjectReference;
  targetGuest: SwiftRestoreTarget;
  identity?: SwiftRestoreIdentity;
  /** Cloud Hypervisor's memory restore mode. Memory snapshots only. */
  memoryRestoreMode?: SwiftRestoreMemoryRestoreMode;
  resumeAfterRestore?: boolean;
  /** Only consulted for the `s3` backend, whose artifacts must be downloaded. */
  targetNode?: string;
}

export interface SwiftRestoreStatus {
  completedAt?: string;
  conditions?: Condition[];
  /** Artifact footprint materialized on the target node, `s3` restores only. */
  downloadedBytes?: number;
  /** The SwiftGuest the restore produced or updated. */
  guestRef?: LocalObjectReference;
  phase?: SwiftRestorePhase;
  startedAt?: string;
}

export class SwiftRestore extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftRestoreStatus,
  SwiftRestoreSpec
> {
  static readonly kind = "SwiftRestore";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/snapshot.kubeswift.io/v1alpha1/swiftrestores";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
    plural: "swiftrestores",
    singular: "swiftrestore",
    shortNames: ["srst"],
    title: "Restores",
  };

  static getPhase(object: SwiftRestore): SwiftRestorePhase | undefined {
    return object.status?.phase;
  }

  /** The snapshot being restored. Always in the same namespace. */
  static getSnapshotName(object: SwiftRestore): string | undefined {
    return object.spec?.snapshotRef?.name || undefined;
  }

  /** Link target for the snapshot being restored. */
  static getSnapshotRef(object: SwiftRestore): KubeObjectRef | undefined {
    return toKubeObjectRef(
      SwiftSnapshot.kind,
      SwiftSnapshot.crd.apiVersions[0],
      SwiftRestore.getSnapshotName(object),
      object.getNs(),
    );
  }

  /** The guest the restore is asked to produce. */
  static getTargetGuestName(object: SwiftRestore): string | undefined {
    return object.spec?.targetGuest?.name || undefined;
  }

  /** Link target for the guest the restore is asked to produce. */
  static getTargetGuestRef(object: SwiftRestore): KubeObjectRef | undefined {
    return toKubeObjectRef(
      SwiftGuest.kind,
      SwiftGuest.crd.apiVersions[0],
      SwiftRestore.getTargetGuestName(object),
      object.getNs(),
    );
  }

  /**
   * The schema defines the two shapes of a restore by `overwriteExisting`:
   * it must be true to restore over a SwiftGuest that already exists at the
   * target name, which stops it gracefully first. Anything else creates a new
   * guest from the snapshot.
   */
  static getTargetMode(object: SwiftRestore): SwiftRestoreTargetMode {
    return object.spec?.targetGuest?.overwriteExisting ? "In-place" : "Clone";
  }

  /** The guest the restore actually produced, once it got that far. */
  static getRestoredGuestName(object: SwiftRestore): string | undefined {
    return object.status?.guestRef?.name || undefined;
  }

  /** Link target for the guest the restore actually produced. */
  static getRestoredGuestRef(object: SwiftRestore): KubeObjectRef | undefined {
    return toKubeObjectRef(
      SwiftGuest.kind,
      SwiftGuest.crd.apiVersions[0],
      SwiftRestore.getRestoredGuestName(object),
      object.getNs(),
    );
  }

  static getDownloadedSize(object: SwiftRestore): string | undefined {
    return formatBytes(object.status?.downloadedBytes);
  }

  /** Identity attributes the restore regenerates on the restored guest. */
  static getRegeneratedIdentity(object: SwiftRestore): SwiftRestoreIdentityItem[] {
    return object.spec?.identity?.regenerate ?? [];
  }

  /** The CRD defaults the memory restore mode to the eager `copy`. */
  static getMemoryRestoreMode(object: SwiftRestore): SwiftRestoreMemoryRestoreMode {
    return object.spec?.memoryRestoreMode ?? "copy";
  }

  /** The CRD defaults `resumeAfterRestore` to true. */
  static getResumeAfterRestore(object: SwiftRestore): boolean {
    return object.spec?.resumeAfterRestore ?? true;
  }
}

export class SwiftRestoreApi extends Renderer.K8sApi.KubeApi<SwiftRestore> {}
export class SwiftRestoreStore extends Renderer.K8sApi.KubeObjectStore<SwiftRestore, SwiftRestoreApi> {}

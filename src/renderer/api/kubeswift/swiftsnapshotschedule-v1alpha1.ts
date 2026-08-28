import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest } from "./swiftguest-v1alpha1";
import { type Condition, type KubeObjectRef, type KubeSwiftKubeObjectCRD, toKubeObjectRef } from "./types";

import type { SwiftSnapshotSpec } from "./swiftsnapshot-v1alpha1";

/**
 * Model for `swiftsnapshotschedules.snapshot.kubeswift.io/v1alpha1`.
 *
 * A schedule creates SwiftSnapshots of one guest on a cron tick and prunes the
 * older ones. The interfaces below are written from the published
 * CustomResourceDefinition schema, whose `spec.template.spec` is the
 * SwiftSnapshot spec schema verbatim, so the template reuses
 * `SwiftSnapshotSpec` rather than restating it.
 */

export type SwiftSnapshotScheduleConcurrencyPolicy = "Forbid" | "Allow";

/** The subset of `ObjectMeta` the CRD merges onto each created snapshot. */
export interface SwiftSnapshotScheduleTemplateMetadata {
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface SwiftSnapshotScheduleTemplate {
  spec: SwiftSnapshotSpec;
  metadata?: SwiftSnapshotScheduleTemplateMetadata;
}

export interface SwiftSnapshotScheduleRetention {
  /**
   * Keeps the most recent N Ready snapshots of this schedule. Unset keeps all
   * of them, leaving retention to each snapshot's own `spec.ttl`.
   */
  keepLast?: number;
}

export interface SwiftSnapshotScheduleSpec {
  /** Standard 5-field cron expression, evaluated in UTC. */
  schedule: string;
  template: SwiftSnapshotScheduleTemplate;
  /** How overlapping runs are handled. */
  concurrencyPolicy?: SwiftSnapshotScheduleConcurrencyPolicy;
  retention?: SwiftSnapshotScheduleRetention;
  /** Bounds how late a missed tick may still fire. Unset means no deadline. */
  startingDeadlineSeconds?: number;
  /** Pauses the schedule without deleting it or its existing snapshots. */
  suspend?: boolean;
}

export interface SwiftSnapshotScheduleStatus {
  /** Names of the in-flight, non-terminal snapshots of this schedule. */
  active?: string[];
  conditions?: Condition[];
  /** When the controller last fired a tick. */
  lastScheduleTime?: string;
  /** When a scheduled snapshot last reached Ready. */
  lastSuccessfulTime?: string;
}

export class SwiftSnapshotSchedule extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftSnapshotScheduleStatus,
  SwiftSnapshotScheduleSpec
> {
  static readonly kind = "SwiftSnapshotSchedule";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/snapshot.kubeswift.io/v1alpha1/swiftsnapshotschedules";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
    plural: "swiftsnapshotschedules",
    singular: "swiftsnapshotschedule",
    shortNames: ["sss"],
    title: "SwiftSnapshotSchedules",
  };

  static getSchedule(object: SwiftSnapshotSchedule): string | undefined {
    return object.spec?.schedule || undefined;
  }

  /** The snapshot spec every tick instantiates. */
  static getSnapshotTemplateSpec(object: SwiftSnapshotSchedule): SwiftSnapshotSpec | undefined {
    return object.spec?.template?.spec;
  }

  /** The guest the schedule snapshots, read through the snapshot template. */
  static getGuestName(object: SwiftSnapshotSchedule): string | undefined {
    return object.spec?.template?.spec?.guestRef?.name || undefined;
  }

  /** Link target for the guest the schedule snapshots. */
  static getGuestRef(object: SwiftSnapshotSchedule): KubeObjectRef | undefined {
    return toKubeObjectRef(
      SwiftGuest.kind,
      SwiftGuest.crd.apiVersions[0],
      SwiftSnapshotSchedule.getGuestName(object),
      object.getNs(),
    );
  }

  /** Unset means keep every Ready snapshot, so it has no numeric answer. */
  static getKeepLast(object: SwiftSnapshotSchedule): number | undefined {
    return object.spec?.retention?.keepLast;
  }

  /** The CRD leaves `suspend` unset, which runs the schedule. */
  static isSuspended(object: SwiftSnapshotSchedule): boolean {
    return object.spec?.suspend ?? false;
  }

  /** The CRD defaults the concurrency policy to skipping overlapping ticks. */
  static getConcurrencyPolicy(object: SwiftSnapshotSchedule): SwiftSnapshotScheduleConcurrencyPolicy {
    return object.spec?.concurrencyPolicy ?? "Forbid";
  }

  static getLastScheduleTime(object: SwiftSnapshotSchedule): string | undefined {
    return object.status?.lastScheduleTime || undefined;
  }

  static getLastSuccessfulTime(object: SwiftSnapshotSchedule): string | undefined {
    return object.status?.lastSuccessfulTime || undefined;
  }

  static getActiveSnapshots(object: SwiftSnapshotSchedule): string[] {
    return object.status?.active ?? [];
  }
}

export class SwiftSnapshotScheduleApi extends Renderer.K8sApi.KubeApi<SwiftSnapshotSchedule> {}
export class SwiftSnapshotScheduleStore extends Renderer.K8sApi.KubeObjectStore<
  SwiftSnapshotSchedule,
  SwiftSnapshotScheduleApi
> {}

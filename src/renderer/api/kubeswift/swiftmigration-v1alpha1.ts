import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest } from "./swiftguest-v1alpha1";
import {
  type Condition,
  type KubeObjectRef,
  type KubeSwiftKubeObjectCRD,
  type LocalObjectReference,
  toKubeObjectRef,
} from "./types";

/**
 * Model for `swiftmigrations.migration.kubeswift.io/v1alpha1`.
 *
 * A SwiftMigration moves one SwiftGuest from one node to another, either
 * offline (the guest is stopped and restarted on the destination) or live (its
 * memory is pre-copied while it keeps running). The interfaces below are
 * written from the published CustomResourceDefinition schema.
 *
 * This is the only KubeSwift CRD of this milestone outside the
 * `snapshot.kubeswift.io` group.
 */

export type SwiftMigrationMode = "auto" | "live" | "offline";

export type SwiftMigrationTimeoutStrategy = "cancel" | "ignore";

export type SwiftMigrationPhase =
  | "Pending"
  | "Validating"
  | "Preparing"
  | "StopAndCopy"
  | "Resuming"
  | "Completed"
  | "Failed"
  | "Cancelled";

/** Stable taxonomy the controller classifies terminal failures with. */
export type SwiftMigrationFailureReason =
  | "Cancelled"
  | "PodTerminated"
  | "SourcePodReplaced"
  | "Timeout"
  | "Other"
  | "EligibilityMismatch"
  | "DstScheduleFailed"
  | "DstNeverReady"
  | "ReceiveDisconnect"
  | "RpcError"
  | "ImageTagMismatch"
  | "DstPodConflict"
  | "MigrationIdentityNotReady"
  | "SourceSidecarNotReady";

export interface SwiftMigrationTarget {
  /** Pins the migration to a node by name. */
  nodeName?: string;
  /** Constrains the candidate node set. Reserved for a later KubeSwift phase. */
  nodeSelector?: Record<string, string>;
}

export interface SwiftMigrationSpec {
  /** The SwiftGuest to migrate, in the same namespace. */
  guestRef: LocalObjectReference;
  target: SwiftMigrationTarget;
  /** Opts into a migration that gives the guest a fresh IP on the destination. */
  allowIPChange?: boolean;
  /** Cancels an in-flight migration without deleting the record. */
  cancelRequested?: boolean;
  /** Cloud Hypervisor's `downtime_ms` target. `live` mode only. */
  downtimeTarget?: string;
  mode?: SwiftMigrationMode;
  /** Parallel TCP connections for the live-migration memory stream. */
  parallelConnections?: number;
  /** Free-form informational string, for the audit trail. */
  reason?: string;
  /** Runaway backstop bounding the whole operation, not a tight SLA. */
  timeout?: string;
  timeoutStrategy?: SwiftMigrationTimeoutStrategy;
  /** Retention once the migration has been terminal for this long. */
  ttl?: string;
}

/** The launcher pod on one side of the migration. */
export interface SwiftMigrationPodRef {
  name?: string;
}

export interface SwiftMigrationStatus {
  /** The `downtime_ms` ceiling actually sent. A bound, not a measurement. */
  appliedDowntimeMs?: number;
  completedAt?: string;
  conditions?: Condition[];
  /** When cutover step 1, the guest's pod reference patch, succeeded. */
  cutoverStep1At?: string;
  /** When cutover step 2, the source pod deletion, was dispatched. */
  cutoverStep2DispatchedAt?: string;
  destinationNode?: string;
  destinationPodRef?: SwiftMigrationPodRef;
  failureMessage?: string;
  failureReason?: SwiftMigrationFailureReason;
  /** The resolved mode, which may differ from the one the spec asked for. */
  mode?: SwiftMigrationMode;
  /** How long the guest was unresponsive on cluster. */
  observedDowntime?: string;
  /** Elapsed time of the memory transfer. `live` mode only. */
  observedTransferDuration?: string;
  phase?: SwiftMigrationPhase;
  /** Short description of the current sub-state. */
  phaseDetail?: string;
  preparingStartedAt?: string;
  /** Counts the receive dispatches issued on the destination. */
  recvAttempts?: number;
  resumingStartedAt?: string;
  /** Counts the send dispatches issued on the source. */
  sendAttempts?: number;
  sourceNode?: string;
  sourcePodRef?: SwiftMigrationPodRef;
  sourcePodUID?: string;
  startedAt?: string;
  /** The destination guest's primary IP. `live` mode only. */
  targetIP?: string;
  terminalAt?: string;
  /** Pre-copy progress estimate, 0-100. A heuristic, not a byte-exact counter. */
  transferProgress?: number;
}

/** A terminal failure, as the detail panel shows it. */
export interface SwiftMigrationFailure {
  reason?: SwiftMigrationFailureReason;
  message?: string;
}

export class SwiftMigration extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.KubeObjectMetadata,
  SwiftMigrationStatus,
  SwiftMigrationSpec
> {
  static readonly kind = "SwiftMigration";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/migration.kubeswift.io/v1alpha1/swiftmigrations";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["migration.kubeswift.io/v1alpha1"],
    plural: "swiftmigrations",
    singular: "swiftmigration",
    shortNames: ["smig"],
    title: "Migrations",
  };

  static getPhase(object: SwiftMigration): SwiftMigrationPhase | undefined {
    return object.status?.phase;
  }

  /** The guest being moved. Always in the same namespace. */
  static getGuestName(object: SwiftMigration): string | undefined {
    return object.spec?.guestRef?.name || undefined;
  }

  /** Link target for the guest being moved. */
  static getGuestRef(object: SwiftMigration): KubeObjectRef | undefined {
    return toKubeObjectRef(
      SwiftGuest.kind,
      SwiftGuest.crd.apiVersions[0],
      SwiftMigration.getGuestName(object),
      object.getNs(),
    );
  }

  /**
   * The mode the migration is actually running in. The controller resolves
   * `auto` and writes the outcome to the status, so that is what an operator
   * needs to see; before the first reconciliation only the request exists.
   */
  static getMode(object: SwiftMigration): SwiftMigrationMode {
    return object.status?.mode ?? SwiftMigration.getRequestedMode(object);
  }

  /** The CRD defaults the requested mode to `auto`. */
  static getRequestedMode(object: SwiftMigration): SwiftMigrationMode {
    return object.spec?.mode ?? "auto";
  }

  /** The node the guest was running on when the migration started. */
  static getSourceNode(object: SwiftMigration): string | undefined {
    return object.status?.sourceNode || undefined;
  }

  /** The resolved destination node, which the webhook validated. */
  static getDestinationNode(object: SwiftMigration): string | undefined {
    return object.status?.destinationNode || object.spec?.target?.nodeName || undefined;
  }

  /**
   * Pre-copy progress as a percentage. Only `live` migrations report it: an
   * offline migration has no memory stream to make progress through.
   */
  static getTransferProgress(object: SwiftMigration): number | undefined {
    return object.status?.transferProgress;
  }

  /** The progress column, already rendered. */
  static getProgressLabel(object: SwiftMigration): string | undefined {
    const progress = SwiftMigration.getTransferProgress(object);

    return progress === undefined ? undefined : `${progress}%`;
  }

  /** Set on the Failed and Cancelled phases, unset on every other one. */
  static getFailure(object: SwiftMigration): SwiftMigrationFailure | undefined {
    const { failureReason, failureMessage } = object.status ?? {};

    if (!failureReason && !failureMessage) {
      return undefined;
    }

    return { reason: failureReason, message: failureMessage || undefined };
  }

  /** The CRD defaults the backstop to 30 minutes. */
  static getTimeout(object: SwiftMigration): string {
    return object.spec?.timeout ?? "30m0s";
  }

  /** The CRD defaults the timeout strategy to cancelling the migration. */
  static getTimeoutStrategy(object: SwiftMigration): SwiftMigrationTimeoutStrategy {
    return object.spec?.timeoutStrategy ?? "cancel";
  }
}

export class SwiftMigrationApi extends Renderer.K8sApi.KubeApi<SwiftMigration> {}
export class SwiftMigrationStore extends Renderer.K8sApi.KubeObjectStore<SwiftMigration, SwiftMigrationApi> {}

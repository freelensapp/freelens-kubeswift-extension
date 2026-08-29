/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifier of the guest views, and the fifth of this repository
// (after `gpu-status`, the two in `sandbox-status` and `fleet-status`). It is
// the first written for a CRD whose views shipped before the classifier
// convention existed, which is why it arrives with M6 rather than with M1:
// SPEC-0010 needs it, because a stop is a policy change that a controller
// resolves later and the API has no phase for that interval.
//
// Like the other four it is a pure function from structurally declared inputs to
// `{ state, className, explanation }`, with no JSX, no colours and no date
// formatting inside, so it stays unit-testable with plain objects and without
// stubbing the host global.
//
// Nothing here keys on a condition TYPE. SwiftGuest reports several
// (`Resolved`, `PodScheduled`, `GuestRunning`, `StorageReady`, `NetworkReady`,
// `GPUAllocated` and others), but they live in Go constants and prose rather
// than in the CRD manifest, so a selector keyed on them would go silently blank
// the day a controller adds one more. The one exception SPEC-0009 allowed - a
// condition type the manifest publishes as a printer column - does not exist
// here: SwiftGuest's printer columns key on `status.phase`, so this classifier
// does too.

import { conditionMessage } from "./condition-message";

import type { ConditionFacts } from "./condition-message";

/** The host's global status classes, defined in core's `app.scss`. */
export type GuestStatusClass = "success" | "warning" | "error" | "info";

/** The phases the SwiftGuest schema's enum allows today. */
export const guestPendingPhase = "Pending";
export const guestSchedulingPhase = "Scheduling";
export const guestRunningPhase = "Running";
export const guestStoppedPhase = "Stopped";
export const guestFailedPhase = "Failed";

/**
 * The one `runPolicy` value the controller reads as "do not run this guest".
 *
 * Every guard in this milestone tests for it explicitly and never for
 * `!== "Running"`: the CRD declares no `default:` for `spec.runPolicy` (the
 * mutating webhook supplies it), so on a cluster installed with
 * `webhook.enabled=false` the field can legitimately be absent, and the
 * controller's own predicate is `runPolicy == "Stopped"` with everything else,
 * absent included, meaning "run".
 */
export const stoppedRunPolicy = "Stopped";

/** The phases from which a `Stopped` policy is still on its way to taking effect. */
const notYetStoppedPhases: string[] = [guestRunningPhase, guestSchedulingPhase, guestPendingPhase];

/** The state names the classifier can produce. */
export const guestStates = {
  stopping: "Stopping",
  running: "Running",
  scheduling: "Scheduling",
  pending: "Pending",
  failed: "Failed",
  stopped: "Stopped",
  unknown: "Unknown",
} as const;

/** What a SwiftGuest's spec must look like for the classifier to read it. */
export interface GuestSpecFacts {
  runPolicy?: string;
}

/** What a SwiftGuest's status must look like for these functions to read it. */
export interface GuestStatusFacts {
  phase?: string;
  conditions?: ConditionFacts[];
}

export interface GuestCondition {
  /** Short scannable word for the `Condition` badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: GuestStatusClass;
  /** One line saying how that state was reached, the last resort of the Status column. */
  explanation: string;
}

/**
 * Classifies a SwiftGuest from the disagreement between its spec and its status.
 *
 * Four decisions live in here, all approved with SPEC-0010:
 *
 * - **`Stopping` is the only invented state, and it is invented from a
 *   disagreement rather than from a click.** `status.phase` has no transitional
 *   value, so between the moment a stop patches `spec.runPolicy` and the moment
 *   the controller reconciles, the API says `Running` about a guest that is
 *   being stopped. Deriving the state from the object alone makes it identical
 *   in every window, survive a reload, and appear for a guest stopped by
 *   `kubectl` or by `swiftctl` exactly as for one stopped from Freelens. An
 *   in-flight flag kept in a component would have none of those properties and
 *   would be the optimistic UI SPEC-0010's W2 forbids.
 * - **There is no `Starting`.** The API already has `Scheduling` for that
 *   interval, and a start is a single patch whose effect the controller produces
 *   by creating a pod, so there is no window where spec and status disagree in a
 *   way the phase does not already describe.
 * - **`Stopped` while the policy still says run is still `Stopped`**, with the
 *   nuance in the explanation rather than in a sixth state: the guest exited on
 *   its own and the policy has not asked for it back. That sentence is what the
 *   Start guard's second reason says too, in the one place a user is looking
 *   when they wonder why Start is greyed.
 * - **`Stopped` is `info`, not `error` or `terminated`.** A stopped guest is a
 *   resting state an operator chose. `Failed` is the only `error`.
 */
export function classifyGuest(spec?: GuestSpecFacts, status?: GuestStatusFacts): GuestCondition {
  const phase = status?.phase;
  const stopRequested = spec?.runPolicy === stoppedRunPolicy;

  if (stopRequested && phase && notYetStoppedPhases.includes(phase)) {
    return {
      state: guestStates.stopping,
      className: "warning",
      explanation:
        "The run policy asks for this guest to be stopped, and the controller has not reported the new phase yet: " +
        `the API still reports ${phase}`,
    };
  }

  switch (phase) {
    case guestRunningPhase:
      return {
        state: guestStates.running,
        className: "success",
        explanation: "The launcher pod is running the guest",
      };
    case guestSchedulingPhase:
      return {
        state: guestStates.scheduling,
        className: "warning",
        explanation: "The launcher pod is being scheduled onto a node",
      };
    case guestPendingPhase:
      return {
        state: guestStates.pending,
        className: "warning",
        explanation: "The controller has accepted the guest and is preparing what it needs to boot",
      };
    case guestFailedPhase:
      return {
        state: guestStates.failed,
        className: "error",
        explanation: "The guest ended in a failure",
      };
    case guestStoppedPhase:
      return {
        state: guestStates.stopped,
        className: "info",
        explanation: stopRequested
          ? "The run policy asks for this guest to be stopped, and it is"
          : "The guest exited on its own, and the run policy has not asked for it back: starting it again means " +
            "recreating its launcher pod",
      };
    default:
      break;
  }

  // A phase the schema's enum does not allow today, which a future controller
  // could still write: it stays opaque rather than being forced into one of the
  // buckets, the same stance every classifier in this repository takes.
  if (phase) {
    return {
      state: guestStates.unknown,
      className: "info",
      explanation: `The guest reports the phase "${phase}", which this extension does not know`,
    };
  }

  return {
    state: guestStates.unknown,
    className: "info",
    explanation: "No controller has reported on this guest yet",
  };
}

/**
 * What the SwiftGuest `Status` column shows: the controller's own words when
 * there are any, and the classifier's generated explanation otherwise, so the
 * column is never blank on a guest nothing has reconciled yet.
 *
 * SwiftGuest reports `metav1.Condition`s and has no top-level `status.message`,
 * which is the fleet Cluster's shape exactly, so the shared ladder simply starts
 * at its second rung with no code change (SPEC-0010).
 */
export function guestMessage(spec?: GuestSpecFacts, status?: GuestStatusFacts): string {
  return conditionMessage(status) ?? classifyGuest(spec, status).explanation;
}

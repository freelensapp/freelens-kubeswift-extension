/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifier of the sandbox views, and the second one of this
// repository (DESIGN.md section 2, gap #1): a pure function from what a
// resource reports to a small closed set of display states and to one of the
// host's global status classes. No JSX and no colours live here, and no date is
// formatted either - a timestamp is returned as it arrived so the view can put
// it through `LocaleDate`/`ReactiveDuration`.
//
// The inputs are declared structurally rather than imported from the models, so
// the logic stays unit-testable with plain objects and without stubbing the
// host global (the same shape as `gpu-status.ts` and `object-existence.ts`).
//
// Unlike SwiftGPUNode, both sandbox CRDs report real `metav1.Condition`s and a
// top-level `status.message`, so M4 was the first milestone in which the Status
// column could carry the controller's own words instead of an explanation this
// extension generates. That selector is `conditionMessage`, which M5 moved into
// `condition-message.ts` once a second CRD family needed it (SPEC-0009); the
// generated explanation survives only as its last resort, for an object whose
// controller has not written anything yet.
//
// The module holds two classifiers because the two M4 CRDs have different phase
// vocabularies, and both message selectors are the shared ladder with their own
// classifier's explanation as the last resort.

import { conditionMessage } from "./condition-message";

import type { ConditionFacts } from "./condition-message";

/** The host's global status classes, defined in core's `app.scss`. */
export type SandboxStatusClass = "success" | "warning" | "error" | "info";

/** The phases the SwiftSandbox schema's enum allows today. */
export const sandboxPendingPhase = "Pending";
export const sandboxMaterializingPhase = "Materializing";
export const sandboxRunningPhase = "Running";
export const sandboxCompletedPhase = "Completed";
export const sandboxFailedPhase = "Failed";

/** The state names the classifier can produce on its own (a raw phase passes through as it is). */
export const sandboxStates = {
  pending: "Pending",
  materializing: "Materializing",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  unknown: "Unknown",
} as const;

/** The phases the SwiftSandboxPool schema's enum allows today. */
export const sandboxPoolPendingPhase = "Pending";
export const sandboxPoolWarmingPhase = "Warming";
export const sandboxPoolReadyPhase = "Ready";
export const sandboxPoolDegradedPhase = "Degraded";

/** The state names the pool classifier can produce on its own. */
export const sandboxPoolStates = {
  pending: "Pending",
  warming: "Warming",
  ready: "Ready",
  degraded: "Degraded",
  unknown: "Unknown",
} as const;

/** What a SwiftSandbox's status must look like for these functions to read it. */
export interface SandboxStatusFacts {
  phase?: string;
  message?: string;
  exitCode?: number;
  conditions?: ConditionFacts[];
}

/**
 * What a SwiftSandboxPool's status must look like. The counts are deliberately
 * not read by the classifier - see `classifySandboxPool` for why the phase is
 * the only input to the verdict - so the shape is the message ladder's plus the
 * phase.
 */
export interface SandboxPoolStatusFacts {
  phase?: string;
  message?: string;
  conditions?: ConditionFacts[];
}

export interface SandboxCondition {
  /** Short scannable word for the `Condition` badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: SandboxStatusClass;
  /** One line saying how that state was reached, the last resort of the Status column. */
  explanation: string;
}

/** `with exit code 3` when there is one, so the two facts are never merged into a verdict. */
function withExitCode(sentence: string, exitCode?: number): string {
  return exitCode === undefined ? sentence : `${sentence} with exit code ${exitCode}`;
}

/**
 * Classifies a SwiftSandbox.
 *
 * Two judgement calls, both approved with SPEC-0008 and both recorded there:
 *
 * - `Completed` is `success`, the same class as `Running`. A sandbox that did
 *   its job and finished is not a warning, and DESIGN.md's colour table maps
 *   both "healthy/running" and "completed/succeeded" to green tokens. The badge
 *   word carries the difference between the two, which is what the word is for.
 * - The exit code deliberately does not enter the verdict. A `Completed`
 *   sandbox with a non-zero exit code would contradict the documented rule that
 *   a non-zero exit is what makes a sandbox `Failed`, and the honest response to
 *   a contradiction is to show both facts rather than invent a third state. The
 *   code goes into the explanation and into the drawer.
 *
 * A phase this extension does not know is displayed as it arrived rather than
 * forced into one of the buckets. The schema does constrain `phase` with an
 * enum, but an enum says what the API server accepts today, not what a future
 * controller writes, and the SPEC-0001/SPEC-0004/SPEC-0007 stance on unknown
 * phases is unchanged.
 */
export function classifySandbox(status?: SandboxStatusFacts): SandboxCondition {
  const phase = status?.phase;
  const exitCode = status?.exitCode;

  if (!phase) {
    return {
      state: sandboxStates.unknown,
      className: "info",
      explanation: "The controller has not reported a phase for this sandbox yet",
    };
  }

  if (phase === sandboxRunningPhase) {
    return {
      state: sandboxStates.running,
      className: "success",
      explanation: "The guest is up and the workload is running",
    };
  }

  if (phase === sandboxCompletedPhase) {
    return {
      state: sandboxStates.completed,
      className: "success",
      explanation: withExitCode("The workload ran to completion", exitCode),
    };
  }

  if (phase === sandboxMaterializingPhase) {
    return {
      state: sandboxStates.materializing,
      className: "warning",
      explanation: "The OCI rootfs is being pulled, verified and unpacked on the node",
    };
  }

  if (phase === sandboxPendingPhase) {
    return {
      state: sandboxStates.pending,
      className: "warning",
      explanation: "The sandbox has been accepted and is waiting for a node",
    };
  }

  if (phase === sandboxFailedPhase) {
    return {
      state: sandboxStates.failed,
      className: "error",
      explanation: withExitCode("The sandbox failed", exitCode),
    };
  }

  return {
    state: phase,
    className: "info",
    explanation: `The controller reported the phase "${phase}", which this extension does not know`,
  };
}

/**
 * Classifies a SwiftSandboxPool.
 *
 * One judgement call, approved with SPEC-0008 and recorded there: **`Degraded`
 * is `error`, not `warning`**. A degraded pool still works, because a checkout
 * that finds no free slot falls back to the cold materialize and boot path
 * automatically, so the case for `warning` is real. It is rejected because the
 * pool's entire purpose is the sub-second checkout, and a pool that is not
 * holding its warm buffer is not delivering it. The consequence is named in the
 * explanation, so the colour can never be read as an outage.
 *
 * The counts stay out of the verdict for the same reason the sandbox
 * classifier keeps the exit code out of its own: `warmReplicas` below `minWarm`
 * is what the controller weighs when it writes `Degraded` rather than `Warming`,
 * and re-deriving that verdict here would produce a second opinion that
 * contradicts the controller's on every pool that is mid-warm. The numbers are
 * side by side in the list, which is where the gap between them is meant to be
 * read.
 *
 * A phase this extension does not know is displayed as it arrived, the same
 * stance every classifier in this repository takes.
 */
export function classifySandboxPool(status?: SandboxPoolStatusFacts): SandboxCondition {
  const phase = status?.phase;

  if (!phase) {
    return {
      state: sandboxPoolStates.unknown,
      className: "info",
      explanation: "The controller has not reported a phase for this pool yet",
    };
  }

  if (phase === sandboxPoolReadyPhase) {
    return {
      state: sandboxPoolStates.ready,
      className: "success",
      explanation: "The pool is holding its warm buffer, so a checkout gets a pre-booted slot",
    };
  }

  if (phase === sandboxPoolWarmingPhase) {
    return {
      state: sandboxPoolStates.warming,
      className: "warning",
      explanation: "The pool is booting slots to reach its warm buffer",
    };
  }

  if (phase === sandboxPoolPendingPhase) {
    return {
      state: sandboxPoolStates.pending,
      className: "warning",
      explanation: "The pool has been accepted and no slot has been warmed yet",
    };
  }

  if (phase === sandboxPoolDegradedPhase) {
    return {
      state: sandboxPoolStates.degraded,
      className: "error",
      explanation:
        "The pool is not holding its warm buffer: a checkout that finds no free slot still runs, on the cold path",
    };
  }

  return {
    state: phase,
    className: "info",
    explanation: `The controller reported the phase "${phase}", which this extension does not know`,
  };
}

/**
 * What the SwiftSandbox `Status` column shows: the controller's own words when
 * there are any, and the classifier's generated explanation otherwise, so the
 * column is never blank on an object nothing has reconciled yet.
 */
export function sandboxMessage(status?: SandboxStatusFacts): string {
  return conditionMessage(status) ?? classifySandbox(status).explanation;
}

/**
 * What the SwiftSandboxPool `Status` column shows. The same two lines as
 * `sandboxMessage` over the other classifier: the ladder that reads the
 * controller's words is shared, only its last resort differs.
 */
export function sandboxPoolMessage(status?: SandboxPoolStatusFacts): string {
  return conditionMessage(status) ?? classifySandboxPool(status).explanation;
}

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
// top-level `status.message`, so this is the first module in which the Status
// column can carry the controller's own words instead of an explanation this
// extension generates. `conditionMessage` below is that selector; the generated
// explanation survives only as its last resort, for an object whose controller
// has not written anything yet.
//
// SwiftSandboxPool is the second half of M4 and lands in the next slice: its
// classifier joins this module, and its message selector is `conditionMessage`
// with the pool classifier's explanation as the fallback, exactly as
// `sandboxMessage` is below.

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

/** What one condition must look like for the message selector to read it. */
export interface SandboxConditionFacts {
  type?: string;
  status?: string;
  message?: string;
  lastTransitionTime?: string;
}

/** What a SwiftSandbox's status must look like for these functions to read it. */
export interface SandboxStatusFacts {
  phase?: string;
  message?: string;
  exitCode?: number;
  conditions?: SandboxConditionFacts[];
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

/** The condition status that means "this aspect is fine". */
const trueConditionStatus = "True";

/** Sorting key of a condition: an unparseable timestamp sorts oldest. */
function transitionTime(condition: SandboxConditionFacts): number {
  const parsed = Date.parse(condition.lastTransitionTime ?? "");

  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The newest condition that carries a message and satisfies `accept`, or
 * `undefined`. Conditions with an empty message are skipped whatever their
 * timestamp: `metav1.Condition` allows one, and picking it would leave the
 * Status column blank, which is the one outcome this selector exists to avoid.
 */
function newestCondition(
  conditions: SandboxConditionFacts[],
  accept: (condition: SandboxConditionFacts) => boolean,
): SandboxConditionFacts | undefined {
  const candidates = conditions.filter((condition) => Boolean(condition.message) && accept(condition));

  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.reduce((newest, condition) =>
    transitionTime(condition) >= transitionTime(newest) ? condition : newest,
  );
}

/**
 * The controller's own words about an object, in order: its `status.message`,
 * then the newest condition that is reporting a problem, then the newest
 * condition of any kind. `undefined` when the controller has written nothing,
 * which is where each kind's own classifier explanation takes over.
 *
 * It deliberately hardcodes no condition type. The schema constrains conditions
 * only to the `metav1.Condition` shape; the type names (`Resolved`,
 * `RootfsReady`, `GuestRunning`, `GPUAllocated`, `ScratchDiskReady` on a
 * sandbox, `Resolved` and `Warm` on a pool) come from the upstream
 * documentation, not from the API, so a selector keyed on them would silently
 * fall through the day the controller adds a sixth. Ordering by transition time
 * and by "not True" is derived from the shape the API does guarantee.
 *
 * A problem being reported outranks a success being reported: that is the whole
 * reason for the second rung. Shared by both M4 kinds.
 */
export function conditionMessage(status?: {
  message?: string;
  conditions?: SandboxConditionFacts[];
}): string | undefined {
  const message = status?.message;

  if (message) {
    return message;
  }

  const conditions = status?.conditions ?? [];
  const problem = newestCondition(conditions, (condition) => condition.status !== trueConditionStatus);

  if (problem) {
    return problem.message;
  }

  return newestCondition(conditions, () => true)?.message;
}

/**
 * What the SwiftSandbox `Status` column shows: the controller's own words when
 * there are any, and the classifier's generated explanation otherwise, so the
 * column is never blank on an object nothing has reconciled yet.
 */
export function sandboxMessage(status?: SandboxStatusFacts): string {
  return conditionMessage(status) ?? classifySandbox(status).explanation;
}

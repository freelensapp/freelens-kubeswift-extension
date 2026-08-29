/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The shared "controller's own words" selector: given a status that carries
// `metav1.Condition`s (and, on the CRDs that have one, a top-level
// `status.message`), it picks the one line the `Status` column of a list should
// show (DESIGN.md section 2's two-column pattern).
//
// It was introduced by M4 inside `sandbox-status.ts` and extracted here by M5
// (SPEC-0009), for two reasons. The ladder is now proven across two CRD
// families with different shapes, and importing a function called
// `conditionMessage` from a module called `sandbox-status` into a fleet drawer
// would be the kind of name that outlives its excuse.
//
// The extraction also validates the M4 design rather than amending it: the
// fleet Cluster status has no top-level `message` field at all, so the ladder's
// first rung is structurally absent and the selector degrades to the rungs
// below it with no code change, because it was written keyed on no condition
// type and with an optional `message`.
//
// The input is declared structurally rather than imported from the models, so
// the logic stays unit-testable with plain objects and without stubbing the
// host global (the same shape as `object-existence.ts` and the classifiers of
// DESIGN.md section 2). Nothing here formats a date or emits JSX.

/** What one condition must look like for the message selector to read it. */
export interface ConditionFacts {
  type?: string;
  status?: string;
  message?: string;
  lastTransitionTime?: string;
}

/** The condition status that means "this aspect is fine". */
const trueConditionStatus = "True";

/** Sorting key of a condition: an unparseable timestamp sorts oldest. */
function transitionTime(condition: ConditionFacts): number {
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
  conditions: ConditionFacts[],
  accept: (condition: ConditionFacts) => boolean,
): ConditionFacts | undefined {
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
 * `message` is optional on the input on purpose: a CRD whose status has no such
 * field (the fleet Cluster) simply starts at the second rung.
 *
 * It deliberately hardcodes no condition type. The schemas constrain conditions
 * only to the `metav1.Condition` shape; most type names (`Resolved`,
 * `RootfsReady`, `GuestRunning` on a sandbox, `Reachable` and
 * `PrometheusEndpointResolved` on a fleet Cluster) come from the upstream
 * documentation rather than from the API, so a selector keyed on them would
 * silently fall through the day a controller adds one more. Ordering by
 * transition time and by "not True" is derived from the shape the API does
 * guarantee.
 *
 * A problem being reported outranks a success being reported: that is the whole
 * reason for the second rung.
 */
export function conditionMessage(status?: { message?: string; conditions?: ConditionFacts[] }): string | undefined {
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

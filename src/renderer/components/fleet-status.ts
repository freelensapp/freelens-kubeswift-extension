/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifier of the fleet views, the fourth of this repository
// (after `gpu-status.ts`, `classifySandbox` and `classifySandboxPool`) and the
// first that reads conditions instead of a phase string: the fleet Cluster CRD
// reports no `phase` and no top-level `message` at all.
//
// Like the other three it is a pure function from a structurally declared
// status to `{ state, className, explanation }`, with no JSX, no colours and no
// date formatting inside, so it stays unit-testable with plain objects and
// without stubbing the host global.
//
// Keying on condition TYPES is something SPEC-0008 deliberately refused to do,
// and this is not a reversal of that refusal (SPEC-0009 argues it in full).
// The sandbox condition types exist only in upstream prose, so a selector keyed
// on them would have gone silently blank the day a sixth was added. `Ready`
// here is embedded in the CRD MANIFEST, as the jsonPath of a printer column
// that `kubectl get clusters` prints for every user: a type the API publishes
// as a column is a contract. `Reachable` sits between the two - a documented Go
// constant with no manifest standing - so it is read only to refine a failure
// that `Ready` has already established, never to produce a verdict on its own.
// Nothing here depends on `PrometheusEndpointResolved`.

import { conditionMessage } from "./condition-message";

import type { ConditionFacts } from "./condition-message";

/** The host's global status classes, defined in core's `app.scss`. */
export type FleetStatusClass = "success" | "warning" | "error" | "info";

/** The one condition type the CRD manifest itself publishes, as a printer column. */
export const readyConditionType = "Ready";

/** Documented Go constant: read only to refine a failure `Ready` already reported. */
export const reachableConditionType = "Reachable";

const trueConditionStatus = "True";
const falseConditionStatus = "False";

/** The state names the classifier can produce. */
export const fleetClusterStates = {
  ready: "Ready",
  unreachable: "Unreachable",
  notReady: "Not Ready",
  unknown: "Unknown",
} as const;

/**
 * What a fleet Cluster's status must look like for these functions to read it:
 * conditions and nothing else. There is no phase to fall back on and no
 * top-level message to prefer, which is the whole point.
 */
export interface FleetClusterStatusFacts {
  conditions?: ConditionFacts[];
}

export interface FleetClusterCondition {
  /** Short scannable word for the `Condition` badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: FleetStatusClass;
  /** One line saying how that state was reached, the last resort of the Status column. */
  explanation: string;
}

function findCondition(status: FleetClusterStatusFacts | undefined, type: string): ConditionFacts | undefined {
  return status?.conditions?.find((condition) => condition.type === type);
}

/**
 * Classifies a fleet Cluster, in this order: Ready, then Unreachable, then Not
 * Ready, then Unknown.
 *
 * Three judgement calls, all approved with SPEC-0009 and recorded there:
 *
 * - **A `Ready: True` next to a `Reachable: False` is shown as Ready.** The two
 *   conditions can contradict each other, and the honest response to a
 *   contradiction is to show both facts rather than invent a third state (the
 *   SPEC-0008 exit-code stance). The badge follows the condition the API
 *   publishes as a column; the Status column then carries the `Reachable: False`
 *   message, because the message ladder's second rung prefers a condition that
 *   is reporting a problem. Two columns disagreeing is the correct rendering of
 *   an object that disagrees with itself.
 * - **`Not Ready` is `warning` while `Unreachable` is `error`.** Unreachable
 *   means the member's API server did not answer a probe: an operator has to
 *   act and the cause is outside the gateway. `Ready: False` on a member that
 *   *is* reachable covers both the ordinary few seconds while the gateway
 *   builds its client and a permanent credential or RBAC problem, and the API
 *   gives no vocabulary to tell them apart (the condition `reason` strings are
 *   not in the schema). The ambiguous case takes the ambiguous colour, and the
 *   condition's own message carries the detail.
 * - **`Unknown` is the resting state, and its explanation says so.** With no
 *   conditions at all, no gateway has reported on this member - which on any
 *   cluster where KubeSwift is installed without a gateway (the chart default)
 *   is permanent and correct, so a word like "pending" would promise a
 *   transition that will never come.
 */
export function classifyFleetCluster(status?: FleetClusterStatusFacts): FleetClusterCondition {
  const ready = findCondition(status, readyConditionType);

  if (ready?.status === trueConditionStatus) {
    return {
      state: fleetClusterStates.ready,
      className: "success",
      explanation: "The gateway holds a healthy client for this member and its API server answers",
    };
  }

  if (findCondition(status, reachableConditionType)?.status === falseConditionStatus) {
    return {
      state: fleetClusterStates.unreachable,
      className: "error",
      explanation: "The gateway could not reach this member's API server",
    };
  }

  if (ready?.status === falseConditionStatus) {
    return {
      state: fleetClusterStates.notReady,
      className: "warning",
      explanation:
        "The member answers, but the gateway has no healthy client for it: it may still be syncing, or the " +
        "credential may not authorize it",
    };
  }

  // `metav1.Condition` allows `Unknown`, and a future controller could write
  // something else again: an unrecognized value stays opaque, the same stance
  // every classifier in this repository takes.
  if (ready?.status) {
    return {
      state: fleetClusterStates.unknown,
      className: "info",
      explanation: `The Ready condition reports the status "${ready.status}", which this extension does not know`,
    };
  }

  return {
    state: fleetClusterStates.unknown,
    className: "info",
    explanation:
      "No gateway has reported on this member yet: the kubeswift-gateway, not the controller-manager, is what " +
      "reconciles a fleet Cluster",
  };
}

/**
 * What the fleet Cluster `Status` column shows: the gateway's own words when
 * there are any, and the classifier's generated explanation otherwise, so the
 * column is never blank on an object nothing has reconciled yet.
 *
 * This CRD's status has no top-level `message` field at all, so the shared
 * ladder simply starts at its second rung - which is the M4 design working as
 * written rather than being amended (SPEC-0009).
 */
export function fleetClusterMessage(status?: FleetClusterStatusFacts): string {
  return conditionMessage(status) ?? classifyFleetCluster(status).explanation;
}

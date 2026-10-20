/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifier of the two storage location kinds (SPEC-0019, T3),
// which share one schema: a pure function from the conditions to a display
// state and one of the host's global status classes, with no JSX, no colours
// and no date formatting inside (DESIGN.md section 2).
//
// It reads condition TYPES, as the fleet classifier does and for the same
// reason: `Ready` (both kinds) and `Reachable` (the cluster kind) are the
// jsonPaths of the CRDs' own printer columns, so the API publishes them. A
// namespaced location never reports `Reachable`, and the classifier then
// simply never reaches that branch.

import { conditionMessage } from "./condition-message";

import type { ConditionFacts } from "./condition-message";

/** The host's global status classes, defined in core's `app.scss`. */
export type StorageStatusClass = "success" | "warning" | "error" | "info";

const readyConditionType = "Ready";
const reachableConditionType = "Reachable";

/** The state names the classifier can produce. */
export const storageLocationStates = {
  ready: "Ready",
  unreachable: "Unreachable",
  notReady: "Not Ready",
  unknown: "Unknown",
} as const;

/** What a storage location's status must look like for these functions to read it. */
export interface StorageLocationStatusFacts {
  conditions?: ConditionFacts[];
}

export interface StorageLocationCondition {
  /** Short scannable word for the `Condition` badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: StorageStatusClass;
  /** One line saying how that state was reached, the last resort of the Status column. */
  explanation: string;
}

function conditionStatus(status: StorageLocationStatusFacts | undefined, type: string): string | undefined {
  return status?.conditions?.find((condition) => condition.type === type)?.status;
}

/**
 * Classifies a storage location: Ready, then Unreachable, then Not Ready, then
 * Unknown.
 *
 * `Ready: True` wins over a `Reachable: False` next to it, as in the fleet
 * classifier: the badge follows `Ready`, and the Status column then quotes the
 * `Reachable` message, since the message ladder prefers a condition that
 * reports a problem. Both failures are errors: a location that is not usable
 * stops every object that names it, or falls back to it as a default, and
 * nothing in the extension's reading suggests it resolves on its own.
 */
export function classifyStorageLocation(status?: StorageLocationStatusFacts): StorageLocationCondition {
  const ready = conditionStatus(status, readyConditionType);

  if (ready === "True") {
    return {
      state: storageLocationStates.ready,
      className: "success",
      explanation: "The controller validated this location, and objects can use it",
    };
  }

  if (conditionStatus(status, reachableConditionType) === "False") {
    return {
      state: storageLocationStates.unreachable,
      className: "error",
      explanation: "The controller could not reach this location's registry",
    };
  }

  if (ready === "False") {
    return {
      state: storageLocationStates.notReady,
      className: "error",
      explanation: "The controller reports this location as not usable",
    };
  }

  if (ready) {
    return {
      state: storageLocationStates.unknown,
      className: "info",
      explanation: `The Ready condition reports the status "${ready}", which this extension does not know`,
    };
  }

  return {
    state: storageLocationStates.unknown,
    className: "info",
    explanation: "No controller has reported on this location yet",
  };
}

/** The Status column: the controller's own words when there are any, else the classifier's explanation. */
export function storageLocationMessage(status?: StorageLocationStatusFacts): string {
  return conditionMessage(status) ?? classifyStorageLocation(status).explanation;
}

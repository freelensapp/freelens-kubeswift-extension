/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifiers of the two artifact kinds of `sandbox.kubeswift.io`
// (SPEC-0019, T3): SwiftArtifactPlacement, with the per-artifact and per-node
// entries of its status, and SwiftArtifactVerificationPolicy. Pure functions
// from what a status reports to a display state and one of the host's global
// status classes; no JSX, no colours, no date formatting (DESIGN.md section 2).
//
// The condition types read here are the ones the CRDs publish as printer
// columns: `Prepared` (whose reason is the placement's Status column) and
// `Ready` (the policy's). The reasons are the ones the schema documents for
// each field; a reason this extension does not know is shown as it arrived,
// with the informational class, never forced into a bucket.

import { conditionMessage } from "./condition-message";

import type { ConditionFacts } from "./condition-message";

/** The host's global status classes, defined in core's `app.scss`. */
export type ArtifactStatusClass = "success" | "warning" | "error" | "info";

export interface ArtifactCondition {
  /** Short scannable word for a badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: ArtifactStatusClass;
  /** One line saying how that state was reached. */
  explanation: string;
}

/** A condition as the classifiers read it: its type, status and reason. */
interface ReasonedConditionFacts extends ConditionFacts {
  reason?: string;
}

/** What a placement's or a policy's status must look like for these functions to read it. */
export interface ArtifactKindStatusFacts {
  conditions?: ReasonedConditionFacts[];
}

function findCondition(status: ArtifactKindStatusFacts | undefined, type: string) {
  return status?.conditions?.find((condition) => condition.type === type);
}

function unknownReason(reason: string, subject: string): ArtifactCondition {
  return {
    state: reason,
    className: "info",
    explanation: `The controller reports the reason "${reason}" for ${subject}, which this extension does not know`,
  };
}

// The reasons of the placement's Prepared condition, as the CRD documents them.
const placementReasons: Record<string, ArtifactCondition> = {
  Preparing: {
    state: "Preparing",
    className: "warning",
    explanation: "The artifacts are being prepared on the pool's nodes",
  },
  PrepareFailed: {
    state: "Prepare Failed",
    className: "error",
    explanation: "Preparing the artifacts failed on at least one node; the controller retries with a backoff",
  },
  ArtifactRefused: {
    state: "Refused",
    className: "error",
    explanation: "The registry or a verification policy refused an artifact, so it is prepared on no node",
  },
  PoolNotFound: {
    state: "Pool Not Found",
    className: "error",
    explanation: "The SwiftSandboxPool this placement names does not exist in its namespace",
  },
  NoTargetNodes: {
    state: "No Target Nodes",
    className: "info",
    explanation: "No node runs a slot of the pool yet, so there is nowhere to prepare the artifacts",
  },
};

/** The type of the placement's one condition, whose reason the CRD prints as its Status column. */
export const preparedConditionType = "Prepared";

/**
 * Classifies a placement by its `Prepared` condition: True is Prepared, and
 * anything else reads the condition's reason.
 */
export function classifyArtifactPlacement(status?: ArtifactKindStatusFacts): ArtifactCondition {
  const prepared = findCondition(status, preparedConditionType);

  if (!prepared) {
    return {
      state: "Unknown",
      className: "info",
      explanation: "No controller has reported on this placement yet",
    };
  }

  if (prepared.status === "True") {
    return {
      state: "Prepared",
      className: "success",
      explanation: "Every target node holds every artifact",
    };
  }

  if (!prepared.reason) {
    return {
      state: "Not Prepared",
      className: "warning",
      explanation: "The artifacts are not prepared on every target node yet",
    };
  }

  return placementReasons[prepared.reason] ?? unknownReason(prepared.reason, "this placement");
}

/** The Status column of a placement: the controller's own words, else the classifier's explanation. */
export function artifactPlacementMessage(status?: ArtifactKindStatusFacts): string {
  return conditionMessage(status) ?? classifyArtifactPlacement(status).explanation;
}

// The reasons of one entry of `status.artifacts`.
const artifactReasons: Record<string, ArtifactCondition> = {
  Authorized: {
    state: "Authorized",
    className: "success",
    explanation: "The registry authorized the artifact and resolved its digest",
  },
  Resolving: {
    state: "Resolving",
    className: "warning",
    explanation: "The controller is still asking the registry for the artifact",
  },
  ArtifactRefused: {
    state: "Refused",
    className: "error",
    explanation: "The registry refused the artifact",
  },
  PolicyDenied: {
    state: "Policy Denied",
    className: "error",
    explanation: "A verification policy refused the artifact",
  },
};

/** Classifies one artifact of a placement by the reason its status entry reports. */
export function classifyPlacementArtifact(reason?: string): ArtifactCondition {
  if (!reason) {
    return {
      state: "Unknown",
      className: "info",
      explanation: "The controller has not reported on this artifact yet",
    };
  }

  return artifactReasons[reason] ?? unknownReason(reason, "this artifact");
}

// The reasons of one entry of `status.nodes`.
const nodeReasons: Record<string, ArtifactCondition> = {
  Prepared: {
    state: "Prepared",
    className: "success",
    explanation: "The node holds every artifact",
  },
  Preparing: {
    state: "Preparing",
    className: "warning",
    explanation: "The node is fetching and verifying the artifacts",
  },
  VerificationFailed: {
    state: "Verification Failed",
    className: "error",
    explanation: "An artifact did not verify on this node",
  },
  ClaimMismatch: {
    state: "Claim Mismatch",
    className: "error",
    explanation: "An artifact's signature does not carry the claims asked for",
  },
  PrepareFailed: {
    state: "Prepare Failed",
    className: "error",
    explanation: "Preparing the artifacts failed on this node",
  },
};

/** What one entry of `status.nodes` must look like for the classifier to read it. */
export interface PlacementNodeFacts {
  prepared?: boolean;
  reason?: string;
}

/**
 * Classifies one target node. `prepared: true` wins, since it is the fact the
 * schema makes required; the reason then only refines a node that is not.
 */
export function classifyPlacementNode(node: PlacementNodeFacts): ArtifactCondition {
  if (node.prepared) {
    return nodeReasons.Prepared;
  }

  if (!node.reason || node.reason === "Prepared") {
    return {
      state: "Not Prepared",
      className: "warning",
      explanation: "The node does not hold every artifact yet",
    };
  }

  return nodeReasons[node.reason] ?? unknownReason(node.reason, "this node");
}

/** The policy's one condition, published by the CRD as its Ready printer column. */
const readyConditionType = "Ready";

/**
 * Classifies a verification policy by its `Ready` condition. Not Ready is an
 * error, not a warning: while a policy is not valid, the controller refuses
 * every artifact it governs.
 */
export function classifyVerificationPolicy(status?: ArtifactKindStatusFacts): ArtifactCondition {
  const ready = findCondition(status, readyConditionType)?.status;

  if (ready === "True") {
    return {
      state: "Ready",
      className: "success",
      explanation: "The policy is valid and enforced in the namespaces it selects",
    };
  }

  if (ready === "False") {
    return {
      state: "Not Ready",
      className: "error",
      explanation: "The policy is not valid, so every artifact it governs is refused",
    };
  }

  if (ready) {
    return {
      state: "Unknown",
      className: "info",
      explanation: `The Ready condition reports the status "${ready}", which this extension does not know`,
    };
  }

  return {
    state: "Unknown",
    className: "info",
    explanation: "No controller has validated this policy yet",
  };
}

/** The Status column of a policy: the controller's own words, else the classifier's explanation. */
export function verificationPolicyMessage(status?: ArtifactKindStatusFacts): string {
  return conditionMessage(status) ?? classifyVerificationPolicy(status).explanation;
}

import { Renderer } from "@freelensapp/extensions";

import type { Condition, KubeSwiftKubeObjectCRD, LocalObjectReference } from "./types";

/**
 * Model for `swiftartifactplacements.sandbox.kubeswift.io/v1alpha1`.
 *
 * A SwiftArtifactPlacement prepares digest-pinned OCI artifacts in the node
 * cache of every node that runs a slot of one SwiftSandboxPool, so that a
 * checkout mounting the same artifact (same repository and digest, layout,
 * verification key and claims) does not fetch it first. It changes nothing in
 * the pool or its slots.
 *
 * The interfaces are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.18.0). The kind arrived after v0.13.12 (SPEC-0019, T3)
 * and is read-only in this extension. Enum values (`layout`, the reasons) are
 * typed as plain strings, as everywhere in this extension.
 */

/** One artifact to prepare. */
export interface SwiftArtifactPlacementArtifact {
  /** A DNS label, unique within the placement. */
  name: string;
  /** The artifact's reference, pinned by digest (`repo@sha256:...`). */
  ref: string;
  /** Per-artifact claims a checkout must ask for to use the prepared entry. */
  claims?: Record<string, string>;
  /** `oci` (the default) or `unpacked`. */
  layout?: string;
  /** A docker-registry Secret in the placement's namespace. */
  pullSecretRef?: LocalObjectReference;
  requirePlatformVerification?: boolean;
  /** A Secret holding a cosign public key, in the placement's namespace. */
  verifyKeySecretRef?: { name: string };
}

export interface SwiftArtifactPlacementSpec {
  /** The SwiftSandboxPool, in the placement's namespace, whose slots' nodes receive the artifacts. */
  poolRef: LocalObjectReference;
  artifacts: SwiftArtifactPlacementArtifact[];
}

/** A SwiftArtifactVerificationPolicy that governs an artifact, at a generation. */
export interface SwiftArtifactPolicyReference {
  name: string;
  generation?: number;
}

/** The state of one artifact. */
export interface SwiftArtifactPlacementArtifactStatus {
  name: string;
  /** Set once the registry has authorized the artifact. */
  digest?: string;
  message?: string;
  policies?: SwiftArtifactPolicyReference[];
  preparedNodes?: number;
  /** `Authorized`, `Resolving`, `ArtifactRefused` or `PolicyDenied`. */
  reason?: string;
}

/** The state of one target node. */
export interface SwiftArtifactPlacementNodeStatus {
  name: string;
  prepared: boolean;
  failures?: number;
  lastFailureTime?: string;
  message?: string;
  observedGeneration?: number;
  preparedAt?: string;
  /** `Prepared`, `Preparing`, `VerificationFailed`, `ClaimMismatch` or `PrepareFailed`. */
  reason?: string;
  /** An opaque identity of the verification the node was prepared under. */
  requirements?: string;
}

export interface SwiftArtifactPlacementStatus {
  artifacts?: SwiftArtifactPlacementArtifactStatus[];
  conditions?: Condition[];
  nodes?: SwiftArtifactPlacementNodeStatus[];
  observedGeneration?: number;
  preparedNodes?: number;
  targetNodes?: number;
}

/** One artifact as the drawer shows it: what the spec asks for and what the status reports, joined by name. */
export interface SwiftArtifactPlacementArtifactView {
  name: string;
  spec?: SwiftArtifactPlacementArtifact;
  status?: SwiftArtifactPlacementArtifactStatus;
}

/** The layout an artifact gets when its spec names none (the CRD default). */
export const defaultArtifactLayout = "oci";

/**
 * The artifacts of a placement, in spec order, each joined with its status
 * entry by name. A status entry whose artifact the spec no longer names (a
 * status the controller has not caught up on yet) is kept, after the others,
 * rather than dropped.
 */
export function placementArtifactViews(
  spec?: Partial<SwiftArtifactPlacementSpec>,
  status?: SwiftArtifactPlacementStatus,
): SwiftArtifactPlacementArtifactView[] {
  const statuses = new Map((status?.artifacts ?? []).map((entry) => [entry.name, entry]));
  const views: SwiftArtifactPlacementArtifactView[] = (spec?.artifacts ?? []).map((artifact) => ({
    name: artifact.name,
    spec: artifact,
    status: statuses.get(artifact.name),
  }));
  const named = new Set(views.map((view) => view.name));

  for (const entry of status?.artifacts ?? []) {
    if (!named.has(entry.name)) {
      views.push({ name: entry.name, status: entry });
    }
  }

  return views;
}

/** The claims of an artifact as `key=value` strings, sorted by key. */
export function formatClaims(claims?: Record<string, string>): string[] {
  return Object.entries(claims ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
}

function uniqueSorted(names: (string | undefined)[]): string[] {
  return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
}

export class SwiftArtifactPlacement extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftArtifactPlacementStatus,
  SwiftArtifactPlacementSpec
> {
  declare kind: "SwiftArtifactPlacement";
  declare apiVersion: "sandbox.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftArtifactPlacement";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/sandbox.kubeswift.io/v1alpha1/swiftartifactplacements";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["sandbox.kubeswift.io/v1alpha1"],
    plural: "swiftartifactplacements",
    singular: "swiftartifactplacement",
    shortNames: ["sap"],
    title: "Artifact Placements",
  };

  static getPoolName(object: SwiftArtifactPlacement): string | undefined {
    return object.spec?.poolRef?.name || undefined;
  }

  /** How many nodes run a slot of the pool. `0` is a fact and is kept. */
  static getTargetNodes(object: SwiftArtifactPlacement): number | undefined {
    return object.status?.targetNodes;
  }

  /** How many target nodes hold every artifact. */
  static getPreparedNodes(object: SwiftArtifactPlacement): number | undefined {
    return object.status?.preparedNodes;
  }

  static getArtifacts(object: SwiftArtifactPlacement): SwiftArtifactPlacementArtifactView[] {
    return placementArtifactViews(object.spec, object.status);
  }

  static getNodes(object: SwiftArtifactPlacement): SwiftArtifactPlacementNodeStatus[] {
    return object.status?.nodes ?? [];
  }

  static getObservedGeneration(object: SwiftArtifactPlacement): number | undefined {
    return object.status?.observedGeneration;
  }

  /** The Secrets the artifacts name, in the placement's namespace: pull secrets and verification keys. */
  static getSecretNames(object: SwiftArtifactPlacement): string[] {
    return uniqueSorted(
      (object.spec?.artifacts ?? []).flatMap((artifact) => [
        artifact.pullSecretRef?.name,
        artifact.verifyKeySecretRef?.name,
      ]),
    );
  }

  /** The SwiftArtifactVerificationPolicies the status says govern at least one artifact. */
  static getPolicyNames(object: SwiftArtifactPlacement): string[] {
    return uniqueSorted(
      (object.status?.artifacts ?? []).flatMap((artifact) => (artifact.policies ?? []).map((policy) => policy.name)),
    );
  }

  static getNodeNames(object: SwiftArtifactPlacement): string[] {
    return uniqueSorted(SwiftArtifactPlacement.getNodes(object).map((node) => node.name));
  }
}

export class SwiftArtifactPlacementApi extends Renderer.K8sApi.KubeApi<SwiftArtifactPlacement> {}
export class SwiftArtifactPlacementStore extends Renderer.K8sApi.KubeObjectStore<
  SwiftArtifactPlacement,
  SwiftArtifactPlacementApi
> {}

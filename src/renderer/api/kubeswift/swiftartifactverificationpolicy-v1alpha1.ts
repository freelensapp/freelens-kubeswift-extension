import { Renderer } from "@freelensapp/extensions";

import type { SwiftGuestLabelSelector } from "./swiftguest-v1alpha1";
import type { Condition, KubeSwiftKubeObjectCRD } from "./types";

/**
 * Model for `swiftartifactverificationpolicies.sandbox.kubeswift.io/v1alpha1`.
 *
 * A cluster-wide rule, owned by the administrator, for the OCI artifacts that
 * sandboxes and artifact placements mount: in the namespaces its selector
 * matches, an artifact from a repository it governs must carry a signature by
 * one of its authorities, with every claim it requires, before it is
 * materialized. While the policy is not valid, every artifact it governs is
 * refused.
 *
 * The interfaces are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.18.0). The kind arrived after v0.13.12 (SPEC-0019, T3)
 * and is read-only in this extension.
 */

/** A signer the policy trusts. `key` is the only kind of authority in v1alpha1. */
export interface SwiftArtifactAuthority {
  name: string;
  key?: {
    /** One PEM "PUBLIC KEY" block. */
    publicKey: string;
  };
}

/** One signed annotation the signature must carry. Exactly one of the four sources is set. */
export interface SwiftArtifactClaimRequirement {
  key: string;
  fromArtifact?: string;
  fromNamespace?: boolean;
  value?: string;
  values?: string[];
}

export interface SwiftArtifactVerificationPolicySpec {
  authorities: SwiftArtifactAuthority[];
  /** `{}` selects every namespace. */
  namespaceSelector: SwiftGuestLabelSelector;
  /** Globs over the canonical repository: `*` within a path segment, `**` across segments. */
  repositories: string[];
  claims?: SwiftArtifactClaimRequirement[];
  /** `Required` (the default) or `Optional`. */
  digestPinning?: string;
  /** `Allow` (the default) or `Deny`. */
  otherRepositories?: string;
}

/** The identity of an authority's key, as the controller parsed it. */
export interface SwiftArtifactAuthorityStatus {
  name: string;
  /** `ECDSA-P256`, `ECDSA-P384`, `Ed25519` or `RSA-<bits>`. */
  algorithm?: string;
  /** The hex sha256 of the key's SubjectPublicKeyInfo. */
  keyID?: string;
}

export interface SwiftArtifactVerificationPolicyStatus {
  authorities?: SwiftArtifactAuthorityStatus[];
  conditions?: Condition[];
  /** How many namespaces the selector matches. */
  namespaces?: number;
  observedGeneration?: number;
}

/** An authority as the drawer shows it: the spec's key joined with the status's identity of it, by name. */
export interface SwiftArtifactAuthorityView {
  name: string;
  algorithm?: string;
  keyID?: string;
  publicKey?: string;
}

/** What an empty namespace selector means. */
export const everyNamespaceLabel = "Every namespace";

/** The readings of the two enums, in this extension's words. */
export function describeDigestPinning(value?: string): string | undefined {
  switch (value) {
    case "Required":
      return "A governed artifact must be referenced by digest; a tag is refused";
    case "Optional":
      return "A governed artifact may be referenced by tag, which is resolved to a digest and verified there";
    default:
      return undefined;
  }
}

export function describeOtherRepositories(value?: string): string | undefined {
  switch (value) {
    case "Allow":
      return "In the selected namespaces, an artifact no policy governs is mounted with only the workload's own verification";
    case "Deny":
      return "In the selected namespaces, an artifact no policy governs is refused";
    default:
      return undefined;
  }
}

/** One claim requirement in words: the key, then what its value must be. */
export function describeClaimRequirement(claim: SwiftArtifactClaimRequirement): string {
  if (claim.value !== undefined) {
    return `equals "${claim.value}"`;
  }

  if (claim.values?.length) {
    return `one of ${claim.values.map((value) => `"${value}"`).join(", ")}`;
  }

  if (claim.fromArtifact) {
    return `equals the artifact's own "${claim.fromArtifact}" claim`;
  }

  if (claim.fromNamespace) {
    return "equals the name of the namespace the artifact is mounted in";
  }

  return "no requirement set";
}

/**
 * The requirements of a label selector, one per entry, in the syntax
 * `kubectl` accepts for `--selector`: `key=value`, `key in (a, b)`,
 * `key notin (a, b)`, `key` and `!key`. An operator this extension does not
 * know is written as it arrived. An empty selector yields no entry.
 */
export function describeLabelSelector(selector?: SwiftGuestLabelSelector): string[] {
  const labels = Object.entries(selector?.matchLabels ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
  const expressions = (selector?.matchExpressions ?? []).map(({ key, operator, values = [] }) => {
    switch (operator) {
      case "In":
        return `${key} in (${values.join(", ")})`;
      case "NotIn":
        return `${key} notin (${values.join(", ")})`;
      case "Exists":
        return key;
      case "DoesNotExist":
        return `!${key}`;
      default:
        return `${key} ${operator} (${values.join(", ")})`;
    }
  });

  return [...labels, ...expressions];
}

/** The authorities of a policy, in spec order, with the identity the status reports for each. */
export function authorityViews(
  spec?: Partial<SwiftArtifactVerificationPolicySpec>,
  status?: SwiftArtifactVerificationPolicyStatus,
): SwiftArtifactAuthorityView[] {
  const statuses = new Map((status?.authorities ?? []).map((entry) => [entry.name, entry]));

  return (spec?.authorities ?? []).map((authority) => ({
    name: authority.name,
    algorithm: statuses.get(authority.name)?.algorithm,
    keyID: statuses.get(authority.name)?.keyID,
    publicKey: authority.key?.publicKey,
  }));
}

export class SwiftArtifactVerificationPolicy extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.ClusterScopedMetadata,
  SwiftArtifactVerificationPolicyStatus,
  SwiftArtifactVerificationPolicySpec
> {
  declare kind: "SwiftArtifactVerificationPolicy";
  declare apiVersion: "sandbox.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftArtifactVerificationPolicy";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/sandbox.kubeswift.io/v1alpha1/swiftartifactverificationpolicies";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["sandbox.kubeswift.io/v1alpha1"],
    plural: "swiftartifactverificationpolicies",
    singular: "swiftartifactverificationpolicy",
    shortNames: ["savp"],
    title: "Verification Policies",
  };

  static getRepositories(object: SwiftArtifactVerificationPolicy): string[] {
    return object.spec?.repositories ?? [];
  }

  /** How many namespaces the selector matches. `0` is a fact and is kept. */
  static getNamespaceCount(object: SwiftArtifactVerificationPolicy): number | undefined {
    return object.status?.namespaces;
  }

  static getDigestPinning(object: SwiftArtifactVerificationPolicy): string | undefined {
    return object.spec?.digestPinning;
  }

  static getOtherRepositories(object: SwiftArtifactVerificationPolicy): string | undefined {
    return object.spec?.otherRepositories;
  }

  static getSelectorRequirements(object: SwiftArtifactVerificationPolicy): string[] {
    return describeLabelSelector(object.spec?.namespaceSelector);
  }

  static getAuthorities(object: SwiftArtifactVerificationPolicy): SwiftArtifactAuthorityView[] {
    return authorityViews(object.spec, object.status);
  }

  static getClaims(object: SwiftArtifactVerificationPolicy): SwiftArtifactClaimRequirement[] {
    return object.spec?.claims ?? [];
  }

  static getObservedGeneration(object: SwiftArtifactVerificationPolicy): number | undefined {
    return object.status?.observedGeneration;
  }
}

export class SwiftArtifactVerificationPolicyApi extends Renderer.K8sApi.KubeApi<SwiftArtifactVerificationPolicy> {}
export class SwiftArtifactVerificationPolicyStore extends Renderer.K8sApi.KubeObjectStore<
  SwiftArtifactVerificationPolicy,
  SwiftArtifactVerificationPolicyApi
> {}

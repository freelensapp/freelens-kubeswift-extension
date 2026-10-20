import { describe, expect, it } from "vitest";
import {
  authorityViews,
  describeClaimRequirement,
  describeDigestPinning,
  describeLabelSelector,
  describeOtherRepositories,
  SwiftArtifactVerificationPolicy,
} from "./swiftartifactverificationpolicy-v1alpha1";

const publicKey = ["-----BEGIN PUBLIC KEY-----", "bm90LWEtcmVhbC1rZXk=", "-----END PUBLIC KEY-----"].join("\n");

describe("SwiftArtifactVerificationPolicy (v1alpha1)", () => {
  const buildPolicy = (
    spec: SwiftArtifactVerificationPolicy["spec"],
    status?: SwiftArtifactVerificationPolicy["status"],
    name = "signed-models",
  ) =>
    new SwiftArtifactVerificationPolicy({
      apiVersion: "sandbox.kubeswift.io/v1alpha1",
      kind: "SwiftArtifactVerificationPolicy",
      metadata: {
        name,
        selfLink: `/apis/sandbox.kubeswift.io/v1alpha1/swiftartifactverificationpolicies/${name}`,
      },
      spec,
      ...(status === undefined ? {} : { status }),
    });

  const spec: SwiftArtifactVerificationPolicy["spec"] = {
    repositories: ["registry.example.com/models/**"],
    namespaceSelector: {
      matchLabels: { "kubeswift.io/tenant": "ml" },
      matchExpressions: [{ key: "env", operator: "In", values: ["prod", "staging"] }],
    },
    authorities: [
      { name: "release", key: { publicKey } },
      { name: "rotation", key: { publicKey } },
    ],
    claims: [
      { key: "tier", values: ["prod", "staging"] },
      { key: "consumer", fromNamespace: true },
    ],
    digestPinning: "Required",
    otherRepositories: "Deny",
  };

  const status: SwiftArtifactVerificationPolicy["status"] = {
    namespaces: 3,
    observedGeneration: 2,
    authorities: [{ name: "release", algorithm: "ECDSA-P256", keyID: "ab12" }],
  };

  it("declares its kind, scope and API", () => {
    expect(SwiftArtifactVerificationPolicy.kind).toBe("SwiftArtifactVerificationPolicy");
    expect(SwiftArtifactVerificationPolicy.namespaced).toBe(false);
    expect(SwiftArtifactVerificationPolicy.apiBase).toBe(
      "/apis/sandbox.kubeswift.io/v1alpha1/swiftartifactverificationpolicies",
    );
    expect(SwiftArtifactVerificationPolicy.crd).toMatchObject({
      plural: "swiftartifactverificationpolicies",
      shortNames: ["savp"],
      title: "Verification Policies",
    });
  });

  it("reads the policy's scope and enums", () => {
    const policy = buildPolicy(spec, status);

    expect(policy.getNs()).toBeUndefined();
    expect(SwiftArtifactVerificationPolicy.getRepositories(policy)).toEqual(["registry.example.com/models/**"]);
    expect(SwiftArtifactVerificationPolicy.getNamespaceCount(policy)).toBe(3);
    expect(SwiftArtifactVerificationPolicy.getDigestPinning(policy)).toBe("Required");
    expect(SwiftArtifactVerificationPolicy.getOtherRepositories(policy)).toBe("Deny");
    expect(SwiftArtifactVerificationPolicy.getSelectorRequirements(policy)).toEqual([
      "kubeswift.io/tenant=ml",
      "env in (prod, staging)",
    ]);
    expect(SwiftArtifactVerificationPolicy.getClaims(policy)).toHaveLength(2);
    expect(SwiftArtifactVerificationPolicy.getObservedGeneration(policy)).toBe(2);
  });

  it("joins each authority with the key identity the status reports for it", () => {
    expect(SwiftArtifactVerificationPolicy.getAuthorities(buildPolicy(spec, status))).toEqual([
      { name: "release", algorithm: "ECDSA-P256", keyID: "ab12", publicKey },
      // Not parsed yet: the identity is missing, the key is still the spec's.
      { name: "rotation", algorithm: undefined, keyID: undefined, publicKey },
    ]);
  });

  it("keeps a zero namespace count, and survives a policy with no status", () => {
    expect(SwiftArtifactVerificationPolicy.getNamespaceCount(buildPolicy(spec, { namespaces: 0 }))).toBe(0);

    const unreconciled = buildPolicy({ ...spec, claims: undefined });

    expect(SwiftArtifactVerificationPolicy.getNamespaceCount(unreconciled)).toBeUndefined();
    expect(SwiftArtifactVerificationPolicy.getClaims(unreconciled)).toEqual([]);
    expect(authorityViews(undefined, undefined)).toEqual([]);
  });
});

describe("verification policy helpers", () => {
  it("describes each of the four claim sources", () => {
    expect(describeClaimRequirement({ key: "tier", value: "prod" })).toBe('equals "prod"');
    expect(describeClaimRequirement({ key: "tier", values: ["prod", "staging"] })).toBe('one of "prod", "staging"');
    expect(describeClaimRequirement({ key: "model", fromArtifact: "model-id" })).toBe(
      'equals the artifact\'s own "model-id" claim',
    );
    expect(describeClaimRequirement({ key: "consumer", fromNamespace: true })).toBe(
      "equals the name of the namespace the artifact is mounted in",
    );
    expect(describeClaimRequirement({ key: "broken" })).toBe("no requirement set");
  });

  it("writes a label selector in kubectl's syntax", () => {
    expect(
      describeLabelSelector({
        matchLabels: { b: "2", a: "1" },
        matchExpressions: [
          { key: "env", operator: "NotIn", values: ["dev"] },
          { key: "managed", operator: "Exists" },
          { key: "legacy", operator: "DoesNotExist" },
          { key: "odd", operator: "Near", values: ["x"] },
        ],
      }),
    ).toEqual(["a=1", "b=2", "env notin (dev)", "managed", "!legacy", "odd Near (x)"]);
  });

  it("reads an empty selector as no requirement at all", () => {
    expect(describeLabelSelector({})).toEqual([]);
    expect(describeLabelSelector()).toEqual([]);
  });

  it("explains the two enums, and nothing for a value it does not know", () => {
    expect(describeDigestPinning("Required")).toContain("by digest");
    expect(describeDigestPinning("Optional")).toContain("tag");
    expect(describeDigestPinning("Sometimes")).toBeUndefined();
    expect(describeOtherRepositories("Allow")).toContain("mounted");
    expect(describeOtherRepositories("Deny")).toContain("refused");
    expect(describeOtherRepositories()).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { formatClaims, placementArtifactViews, SwiftArtifactPlacement } from "./swiftartifactplacement-v1alpha1";

const digest = "sha256:3f7a9c1e5b2d8f40a6c3e9b1d7f2a5c8e0b4d6f1a3c5e7b9d2f4a6c8e0b1d3f5";

describe("SwiftArtifactPlacement (v1alpha1)", () => {
  const buildPlacement = (
    spec: SwiftArtifactPlacement["spec"],
    status?: SwiftArtifactPlacement["status"],
    name = "model-cache",
    namespace = "ml",
  ) =>
    new SwiftArtifactPlacement({
      apiVersion: "sandbox.kubeswift.io/v1alpha1",
      kind: "SwiftArtifactPlacement",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/sandbox.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftartifactplacements/${name}`,
      },
      spec,
      ...(status === undefined ? {} : { status }),
    });

  const spec: SwiftArtifactPlacement["spec"] = {
    poolRef: { name: "warm-runners" },
    artifacts: [
      {
        name: "weights",
        ref: `registry.example.com/models/weights@${digest}`,
        layout: "unpacked",
        pullSecretRef: { name: "registry-pull" },
        verifyKeySecretRef: { name: "cosign-pub" },
        claims: { tier: "prod", owner: "ml" },
        requirePlatformVerification: true,
      },
      { name: "tokenizer", ref: `registry.example.com/models/tokenizer@${digest}`, layout: "oci" },
    ],
  };

  const status: SwiftArtifactPlacement["status"] = {
    targetNodes: 2,
    preparedNodes: 1,
    observedGeneration: 4,
    artifacts: [
      {
        name: "weights",
        digest,
        reason: "Authorized",
        preparedNodes: 1,
        policies: [
          { name: "signed-models", generation: 3 },
          { name: "baseline", generation: 1 },
        ],
      },
      {
        name: "tokenizer",
        reason: "PolicyDenied",
        message: "no authority signed it",
        policies: [{ name: "baseline" }],
      },
    ],
    nodes: [
      { name: "worker-b", prepared: false, reason: "VerificationFailed", failures: 2 },
      { name: "worker-a", prepared: true, reason: "Prepared", preparedAt: "2026-10-19T10:00:00Z" },
    ],
    conditions: [
      {
        type: "Prepared",
        status: "False",
        reason: "ArtifactRefused",
        message: "tokenizer: no authority signed it",
        lastTransitionTime: "2026-10-19T10:05:00Z",
      },
    ],
  };

  it("declares its kind, scope and API", () => {
    expect(SwiftArtifactPlacement.kind).toBe("SwiftArtifactPlacement");
    expect(SwiftArtifactPlacement.namespaced).toBe(true);
    expect(SwiftArtifactPlacement.apiBase).toBe("/apis/sandbox.kubeswift.io/v1alpha1/swiftartifactplacements");
    expect(SwiftArtifactPlacement.crd).toMatchObject({
      plural: "swiftartifactplacements",
      shortNames: ["sap"],
      title: "Artifact Placements",
    });
  });

  it("reads the pool, the counts and the references", () => {
    const placement = buildPlacement(spec, status);

    expect(placement.getNs()).toBe("ml");
    expect(SwiftArtifactPlacement.getPoolName(placement)).toBe("warm-runners");
    expect(SwiftArtifactPlacement.getTargetNodes(placement)).toBe(2);
    expect(SwiftArtifactPlacement.getPreparedNodes(placement)).toBe(1);
    expect(SwiftArtifactPlacement.getObservedGeneration(placement)).toBe(4);
    expect(SwiftArtifactPlacement.getSecretNames(placement)).toEqual(["cosign-pub", "registry-pull"]);
    expect(SwiftArtifactPlacement.getPolicyNames(placement)).toEqual(["baseline", "signed-models"]);
    expect(SwiftArtifactPlacement.getNodeNames(placement)).toEqual(["worker-a", "worker-b"]);
  });

  it("joins each artifact with its status entry, in spec order", () => {
    const artifacts = SwiftArtifactPlacement.getArtifacts(buildPlacement(spec, status));

    expect(artifacts.map((artifact) => artifact.name)).toEqual(["weights", "tokenizer"]);
    expect(artifacts[0].spec?.layout).toBe("unpacked");
    expect(artifacts[0].status?.digest).toBe(digest);
    expect(artifacts[1].status?.reason).toBe("PolicyDenied");
  });

  it("keeps a status entry the spec no longer names, after the others", () => {
    const views = placementArtifactViews(
      { artifacts: [spec.artifacts[0]] },
      {
        artifacts: [
          { name: "removed", reason: "Authorized" },
          { name: "weights", reason: "Resolving" },
        ],
      },
    );

    expect(views.map((view) => [view.name, Boolean(view.spec), view.status?.reason])).toEqual([
      ["weights", true, "Resolving"],
      ["removed", false, "Authorized"],
    ]);
  });

  it("keeps a zero count, which is a fact", () => {
    const placement = buildPlacement(spec, { targetNodes: 0, preparedNodes: 0 });

    expect(SwiftArtifactPlacement.getTargetNodes(placement)).toBe(0);
    expect(SwiftArtifactPlacement.getPreparedNodes(placement)).toBe(0);
  });

  it("survives a placement nothing has reconciled yet", () => {
    const placement = buildPlacement({ poolRef: { name: "" }, artifacts: [spec.artifacts[1]] });

    // An empty poolRef name is "almost certainly wrong" by the schema's own
    // words, and is shown as missing rather than as a blank link.
    expect(SwiftArtifactPlacement.getPoolName(placement)).toBeUndefined();
    expect(SwiftArtifactPlacement.getTargetNodes(placement)).toBeUndefined();
    expect(SwiftArtifactPlacement.getNodes(placement)).toEqual([]);
    expect(SwiftArtifactPlacement.getPolicyNames(placement)).toEqual([]);
    expect(SwiftArtifactPlacement.getSecretNames(placement)).toEqual([]);
    expect(SwiftArtifactPlacement.getArtifacts(placement)).toEqual([
      { name: "tokenizer", spec: spec.artifacts[1], status: undefined },
    ]);
  });

  it("formats claims sorted by key", () => {
    expect(formatClaims({ tier: "prod", owner: "ml" })).toEqual(["owner=ml", "tier=prod"]);
    expect(formatClaims()).toEqual([]);
  });
});

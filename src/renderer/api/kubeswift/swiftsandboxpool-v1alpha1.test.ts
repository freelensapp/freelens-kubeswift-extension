import { describe, expect, it } from "vitest";
import { SwiftSandbox } from "./swiftsandbox-v1alpha1";
import { noWarmCapLabel, parseImageEnv, SwiftSandboxPool } from "./swiftsandboxpool-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftSandboxPool (v1alpha1)", () => {
  const buildSwiftSandboxPool = (
    spec: SwiftSandboxPool["spec"],
    status?: SwiftSandboxPool["status"],
    name = "warm-runners",
    namespace = "ci",
  ) =>
    new SwiftSandboxPool({
      apiVersion: "sandbox.kubeswift.io/v1alpha1",
      kind: "SwiftSandboxPool",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/sandbox.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftsandboxpools/${name}`,
      },
      spec,
      status,
    });

  const buildSwiftSandbox = (spec: SwiftSandbox["spec"], name: string, namespace = "ci") =>
    new SwiftSandbox({
      apiVersion: "sandbox.kubeswift.io/v1alpha1",
      kind: "SwiftSandbox",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/sandbox.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftsandboxes/${name}`,
      },
      spec,
    });

  // Only `image` and `memory` are required, and `memory` is defaulted by the
  // API server, so this is what a pool authored with nothing but an image reads
  // back as.
  const minimalSpec: SwiftSandboxPool["spec"] = {
    image: "ghcr.io/example/runner:warm",
    memory: "512Mi",
  };

  const fullSpec: SwiftSandboxPool["spec"] = {
    image: "ghcr.io/example/runner@sha256:5f0d2c1a",
    memory: "1Gi",
    cpu: 2,
    minWarm: 2,
    maxWarm: 4,
    rootfsMode: "block",
    network: { mode: "restricted" },
    nodeSelector: { "kubeswift.io/kernel": "true" },
    kernelProfileRef: { name: "sandbox-6-12" },
    imagePullSecret: "registry-pull",
    verifyKeySecretRef: { name: "cosign-key" },
    model: { imageRef: "ghcr.io/example/model@sha256:aa", mountPath: "/model" },
    gpuProfileRef: { name: "gpu-1" },
  };

  const fullStatus: SwiftSandboxPool["status"] = {
    phase: "Ready",
    message: "The warm buffer is full.",
    warmReplicas: 2,
    claimedReplicas: 1,
    observedGeneration: 3,
    selector: "sandbox.kubeswift.io/pool=warm-runners",
    rootfs: { digest: "sha256:5f0d2c1a", sizeBytes: 805306368, cachePath: "/var/lib/kubeswift/rootfs/5f0d2c1a" },
    imageEnv: ["PATH=/usr/local/bin:/usr/bin", "SANDBOX_OPTS=--flag=value", "BARE_NAME"],
    conditions: [
      {
        type: "Warm",
        status: "True",
        reason: "BufferFull",
        message: "The warm buffer is full.",
        lastTransitionTime: "2026-08-28T10:00:00Z",
      },
    ],
  };

  it("is constructed from a realistic object", () => {
    const pool = buildSwiftSandboxPool(fullSpec, fullStatus);

    expect(pool.getName()).toBe("warm-runners");
    expect(pool.getNs()).toBe("ci");
    expect(SwiftSandboxPool.getImage(pool)).toBe("ghcr.io/example/runner@sha256:5f0d2c1a");
    expect(SwiftSandboxPool.getPhase(pool)).toBe("Ready");
    expect(SwiftSandboxPool.getMinWarm(pool)).toBe(2);
    expect(SwiftSandboxPool.getWarmReplicas(pool)).toBe(2);
    expect(SwiftSandboxPool.getClaimedReplicas(pool)).toBe(1);
    expect(SwiftSandboxPool.getObservedGeneration(pool)).toBe(3);
    expect(SwiftSandboxPool.getSelector(pool)).toBe("sandbox.kubeswift.io/pool=warm-runners");
    expect(SwiftSandboxPool.getNetworkMode(pool)).toBe("restricted");
  });

  it("reads the CRD statics the sidebar, the page and the table id are built from", () => {
    expect(SwiftSandboxPool.kind).toBe("SwiftSandboxPool");
    expect(SwiftSandboxPool.namespaced).toBe(true);
    expect(SwiftSandboxPool.apiBase).toBe("/apis/sandbox.kubeswift.io/v1alpha1/swiftsandboxpools");
    expect(SwiftSandboxPool.crd.plural).toBe("swiftsandboxpools");
    expect(SwiftSandboxPool.crd.shortNames).toEqual(["sboxpool"]);
    // Humanized Title Case without the "Swift" prefix (DESIGN.md section 4).
    expect(SwiftSandboxPool.crd.title).toBe("Sandbox Pools");
  });

  it("humanizes the shared rootfs size from the int64 byte count the schema uses", () => {
    expect(SwiftSandboxPool.getRootfsSize(buildSwiftSandboxPool(fullSpec, fullStatus))).toBe("768Mi");
  });

  it("renders an absent or zero maxWarm as the no-cap sentinel it is", () => {
    // `0` is not a count here: the schema says it means "no cap beyond
    // minWarm", and a bare `0` next to `Min Warm: 2` would read as a
    // contradiction (SPEC-0008).
    expect(SwiftSandboxPool.getMaxWarmLabel(buildSwiftSandboxPool({ ...fullSpec, maxWarm: 0 }))).toBe(noWarmCapLabel);
    expect(SwiftSandboxPool.getMaxWarmLabel(buildSwiftSandboxPool(minimalSpec))).toBe(noWarmCapLabel);
    expect(SwiftSandboxPool.getMaxWarmLabel(buildSwiftSandboxPool(fullSpec))).toBe("4");
  });

  it("splits the image environment on the first `=`, even when the value contains one", () => {
    expect(SwiftSandboxPool.getImageEnv(buildSwiftSandboxPool(fullSpec, fullStatus))).toEqual([
      { name: "PATH", value: "/usr/local/bin:/usr/bin" },
      // Splitting on the last `=` would corrupt this one, and splitting on all
      // of them would drop everything past the second.
      { name: "SANDBOX_OPTS", value: "--flag=value" },
      // An entry with no `=` is a name with no value, not something to drop.
      { name: "BARE_NAME" },
    ]);
  });

  it("keeps an empty value distinct from an absent one when splitting", () => {
    expect(parseImageEnv(["EMPTY=", "BARE"])).toEqual([{ name: "EMPTY", value: "" }, { name: "BARE" }]);
    expect(parseImageEnv()).toEqual([]);
  });

  it("collects the Secrets the pool names, deduplicated and sorted", () => {
    expect(SwiftSandboxPool.getSecretNames(buildSwiftSandboxPool(fullSpec))).toEqual(["cosign-key", "registry-pull"]);
    expect(SwiftSandboxPool.getSecretNames(buildSwiftSandboxPool(minimalSpec))).toEqual([]);
    expect(
      SwiftSandboxPool.getSecretNames(
        buildSwiftSandboxPool({ ...minimalSpec, imagePullSecret: "shared", verifyKeySecretRef: { name: "shared" } }),
      ),
    ).toEqual(["shared"]);
  });

  it("reports whether the pool is a warm GPU pool", () => {
    expect(SwiftSandboxPool.hasGpu(buildSwiftSandboxPool(fullSpec))).toBe(true);
    expect(SwiftSandboxPool.hasGpu(buildSwiftSandboxPool(minimalSpec))).toBe(false);
    // A `LocalObjectReference` carries a `""` default for its name, which is
    // "not named" rather than a name to look up.
    expect(SwiftSandboxPool.hasGpu(buildSwiftSandboxPool({ ...minimalSpec, gpuProfileRef: { name: "" } }))).toBe(false);
  });

  it("finds the sandboxes checked out of the pool, and only those", () => {
    const pool = buildSwiftSandboxPool(fullSpec, fullStatus);
    const sandboxes = [
      buildSwiftSandbox(
        { image: "ghcr.io/example/runner:warm", memory: "512Mi", poolRef: { name: "warm-runners" } },
        "pooled",
      ),
      buildSwiftSandbox(
        { image: "ghcr.io/example/runner:warm", memory: "512Mi", poolRef: { name: "other-pool" } },
        "elsewhere",
      ),
      buildSwiftSandbox({ image: "ghcr.io/example/runner:cold", memory: "512Mi" }, "cold"),
      // Same pool name, different namespace: `poolRef` is a
      // `LocalObjectReference`, so this one is not a match.
      buildSwiftSandbox(
        { image: "ghcr.io/example/runner:warm", memory: "512Mi", poolRef: { name: "warm-runners" } },
        "other-namespace",
        "staging",
      ),
    ];

    expect(SwiftSandboxPool.getSandboxesUsing(pool, sandboxes).map((sandbox) => sandbox.getName())).toEqual(["pooled"]);
    expect(SwiftSandboxPool.getSandboxesUsing(pool, [])).toEqual([]);
  });

  it("reports every optional value as absent on a pool with no status at all", () => {
    const pool = buildSwiftSandboxPool(minimalSpec);

    expect(SwiftSandboxPool.getPhase(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getMinWarm(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getWarmReplicas(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getClaimedReplicas(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getObservedGeneration(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getSelector(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getRootfsSize(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getImageEnv(pool)).toEqual([]);
    expect(SwiftSandboxPool.getNetworkMode(pool)).toBeUndefined();
  });

  it("reports the counts a controller wrote without a rootfs, an imageEnv or a selector", () => {
    // The shape of a pool the controller has counted but not yet materialized:
    // every block of the status is independently optional in the schema, so a
    // view may not assume that one implies another.
    const pool = buildSwiftSandboxPool(minimalSpec, { phase: "Warming", warmReplicas: 0, claimedReplicas: 0 });

    expect(SwiftSandboxPool.getWarmReplicas(pool)).toBe(0);
    expect(SwiftSandboxPool.getClaimedReplicas(pool)).toBe(0);
    expect(SwiftSandboxPool.getRootfsSize(pool)).toBeUndefined();
    expect(SwiftSandboxPool.getImageEnv(pool)).toEqual([]);
    expect(SwiftSandboxPool.getSelector(pool)).toBeUndefined();
  });
});

import { Renderer } from "@freelensapp/extensions";
import { formatBytes, type KubeSwiftKubeObjectCRD } from "./types";

import type { SwiftSandbox, SwiftSandboxModel, SwiftSandboxNetwork } from "./swiftsandbox-v1alpha1";
import type { Condition, LocalObjectReference, Quantity } from "./types";

/**
 * Model for `swiftsandboxpools.sandbox.kubeswift.io/v1alpha1`.
 *
 * A SwiftSandboxPool keeps a buffer of pre-booted, workload-less sandbox
 * microVMs of one OCI image, so that a SwiftSandbox naming it through
 * `spec.poolRef` checks a slot out in sub-second time instead of paying the
 * cold materialize and boot. Warming is node-local: a checkout that finds no
 * free slot on its target node falls back to the cold path, which costs the
 * speedup and is never a failure.
 *
 * The interfaces below are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.13.12). As in every model of this extension, values the
 * schema constrains with an `enum` are still typed as plain strings, so a
 * future controller writing a fifth phase cannot break a view (SPEC-0008).
 *
 * The spec fields are the SLOT SHAPE - the shape of every warm slot, which a
 * claiming sandbox must match - and not the pool's own resources. The workload
 * (command, args, env, timeout, ttl) is deliberately absent from this schema:
 * it belongs to the SwiftSandbox that checks a slot out and is injected
 * post-boot.
 *
 * This is the first KubeSwift CRD this extension models that declares a
 * **`scale` subresource** (`specReplicasPath: .spec.minWarm`,
 * `statusReplicasPath: .status.warmReplicas`,
 * `labelSelectorPath: .status.selector`). It changes nothing here: `scale` is
 * an API-server-side projection of three fields this model already types, it
 * adds no field of its own, and the read-only views of M4 never write. What it
 * makes possible - `kubectl scale`, an HPA, and the inline stepper upstream's
 * drawer has - belongs to M6's actions spec.
 */

/** The four phases the schema's enum allows today. Not a type: see the note above. */
export type SwiftSandboxPoolPhase = "Pending" | "Warming" | "Ready" | "Degraded";

export interface SwiftSandboxPoolSpec {
  /** Required. A claiming SwiftSandbox must request the same image. */
  image: string;
  /** Required and defaulted to `512Mi`, held per warm slot rather than per pool. */
  memory: Quantity;
  cpu?: number;
  gpuProfileRef?: LocalObjectReference;
  imagePullSecret?: string;
  kernelProfileRef?: LocalObjectReference;
  /** `0` (or absent) is the "no cap beyond minWarm" sentinel, not a count. */
  maxWarm?: number;
  minWarm?: number;
  model?: SwiftSandboxModel;
  network?: SwiftSandboxNetwork;
  nodeSelector?: Record<string, string>;
  rootfsMode?: string;
  verifyKeySecretRef?: { name: string };
}

/** The materialized image every slot of the pool shares on a node. */
export interface SwiftSandboxPoolRootfsStatus {
  cachePath?: string;
  digest?: string;
  /** A plain `int64` byte count, not a quantity. */
  sizeBytes?: number;
}

export interface SwiftSandboxPoolStatus {
  claimedReplicas?: number;
  conditions?: Condition[];
  /** The pool image's own config environment, as `KEY=VAL` strings. */
  imageEnv?: string[];
  /** The controller's own one-line summary; the first rung of the message ladder. */
  message?: string;
  observedGeneration?: number;
  phase?: string;
  rootfs?: SwiftSandboxPoolRootfsStatus;
  /** The warm-slot label selector, serialized as a string by the scale subresource. */
  selector?: string;
  warmReplicas?: number;
}

/** What `maxWarm: 0` (or an absent `maxWarm`) means: a sentinel, not a count. */
export const noWarmCapLabel = "No cap";

/** The schema's own wording for that sentinel, carried in the row tooltip. */
export const noWarmCapTooltip =
  "maxWarm caps the total warm slots the pool will hold as back-pressure. 0 means no cap beyond minWarm";

/** One entry of `status.imageEnv`, split into the two halves the drawer shows. */
export interface SwiftSandboxPoolImageEnvVar {
  name: string;
  value?: string;
}

/**
 * Splits the image config's environment entries on their **first** `=`.
 *
 * A value may itself contain `=` (`SANDBOX_OPTS=--flag=value` is ordinary), so
 * splitting on the last one would corrupt it, and splitting on all of them
 * would drop everything past the second. An entry with no `=` at all is a name
 * with no value rather than something to discard: the image config is free to
 * carry one, and hiding it would under-report what a checkout inherits.
 *
 * Declared as a free function rather than as a static so it stays usable on a
 * plain array in the tests and in the nested table's own row loop.
 */
export function parseImageEnv(entries: readonly string[] = []): SwiftSandboxPoolImageEnvVar[] {
  return entries.map((entry) => {
    const separator = entry.indexOf("=");

    if (separator < 0) {
      return { name: entry };
    }

    return { name: entry.slice(0, separator), value: entry.slice(separator + 1) };
  });
}

// The metadata is declared namespace-scoped rather than with the generic
// `KubeObjectMetadata` the M1/M2 models use: it makes `getNs()` a `string`,
// which is what the `NamespaceSelectBadge` of the list cell and the explicit
// namespaces of `useReferenceStores` both need (the SPEC-0007 slice-1 rule for
// every new namespaced model).
export class SwiftSandboxPool extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftSandboxPoolStatus,
  SwiftSandboxPoolSpec
> {
  static readonly kind = "SwiftSandboxPool";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/sandbox.kubeswift.io/v1alpha1/swiftsandboxpools";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["sandbox.kubeswift.io/v1alpha1"],
    plural: "swiftsandboxpools",
    singular: "swiftsandboxpool",
    shortNames: ["sboxpool"],
    title: "Sandbox Pools",
  };

  static getPhase(object: SwiftSandboxPool): string | undefined {
    return object.status?.phase;
  }

  static getImage(object: SwiftSandboxPool): string | undefined {
    return object.spec?.image;
  }

  /**
   * The desired number of warm slots. The schema defaults it to `1`, but the
   * default is only applied once the API server has admitted the object, so an
   * absent value is reported as absent rather than invented here (the rule the
   * SwiftSandbox model follows for its own defaulted fields).
   */
  static getMinWarm(object: SwiftSandboxPool): number | undefined {
    return object.spec?.minWarm;
  }

  static getMaxWarm(object: SwiftSandboxPool): number | undefined {
    return object.spec?.maxWarm;
  }

  /**
   * The cap as a reader should see it. `0` here is not a count, it is the
   * schema's sentinel for "no cap beyond minWarm", and rendering a bare `0`
   * next to `Min Warm: 2` would read as a contradiction. An absent value means
   * the same thing, so both collapse to the same label.
   */
  static getMaxWarmLabel(object: SwiftSandboxPool): string {
    const maxWarm = SwiftSandboxPool.getMaxWarm(object);

    return maxWarm ? String(maxWarm) : noWarmCapLabel;
  }

  /** The actual number of Ready, pre-booted, unclaimed slots. */
  static getWarmReplicas(object: SwiftSandboxPool): number | undefined {
    return object.status?.warmReplicas;
  }

  /** How many slots are currently checked out to a sandbox. */
  static getClaimedReplicas(object: SwiftSandboxPool): number | undefined {
    return object.status?.claimedReplicas;
  }

  static getObservedGeneration(object: SwiftSandboxPool): number | undefined {
    return object.status?.observedGeneration;
  }

  /**
   * The warm-slot label selector, as the controller serialized it. It is shown
   * and never parsed: the schema promises only "serialized as a string", so a
   * parser keyed on the documented `sandbox.kubeswift.io/pool=<name>` form
   * would be guessing at a contract (SPEC-0008, the warm-slot table decision).
   */
  static getSelector(object: SwiftSandboxPool): string | undefined {
    return object.status?.selector;
  }

  static getNetworkMode(object: SwiftSandboxPool): string | undefined {
    return object.spec?.network?.mode;
  }

  /** The shared rootfs size, humanized from the byte count the schema uses. */
  static getRootfsSize(object: SwiftSandboxPool): string | undefined {
    return formatBytes(object.status?.rootfs?.sizeBytes);
  }

  /** The image config's environment, split on the first `=` of each entry. */
  static getImageEnv(object: SwiftSandboxPool): SwiftSandboxPoolImageEnvVar[] {
    return parseImageEnv(object.status?.imageEnv);
  }

  /** True when the pool is a warm GPU pool, so the drawer's GPU section guards itself. */
  static hasGpu(object: SwiftSandboxPool): boolean {
    return Boolean(object.spec?.gpuProfileRef?.name);
  }

  /**
   * Every Secret this object names, deduplicated: the image pull secret and the
   * cosign verification key. It is what the drawer declares to
   * `useReferenceStores`, so a pool that names no Secret contributes no request.
   */
  static getSecretNames(object: SwiftSandboxPool): string[] {
    const names = [object.spec?.imagePullSecret, object.spec?.verifyKeySecretRef?.name];

    return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
  }

  /**
   * The sandboxes checked out of this pool. `spec.poolRef` is a
   * `LocalObjectReference`, so the match is namespace-local by construction and
   * the caller only ever needs to hold this pool's own namespace (the
   * SPEC-0007 "Guests Using This Profile" pattern, reused rather than
   * reinvented).
   */
  static getSandboxesUsing(object: SwiftSandboxPool, sandboxes: readonly SwiftSandbox[]): SwiftSandbox[] {
    const name = object.getName();
    const namespace = object.getNs();

    return sandboxes.filter((sandbox) => sandbox.getNs() === namespace && sandbox.spec?.poolRef?.name === name);
  }
}

export class SwiftSandboxPoolApi extends Renderer.K8sApi.KubeApi<SwiftSandboxPool> {}
export class SwiftSandboxPoolStore extends Renderer.K8sApi.KubeObjectStore<SwiftSandboxPool, SwiftSandboxPoolApi> {}

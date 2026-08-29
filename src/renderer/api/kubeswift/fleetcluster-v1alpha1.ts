import { Renderer } from "@freelensapp/extensions";

import type { Condition, KubeSwiftKubeObjectCRD, LocalObjectReference } from "./types";

/**
 * Model for `clusters.fleet.kubeswift.io/v1alpha1`.
 *
 * A fleet Cluster is a member cluster federated by the kubeswift-gateway hub:
 * the hub watches these objects, builds an impersonation-capable client and
 * informer cache per member, and writes back what it learned. The objects live
 * in the hub cluster next to their credential Secret (the Cluster API model),
 * which is why a CRD describing something as un-namespaced as a cluster is
 * itself namespaced.
 *
 * Three properties of this schema are unlike every other model in this
 * extension, and they are the reason SPEC-0009 exists:
 *
 * - **The class is `FleetCluster` and the kind is `Cluster`.** The kind is what
 *   the API says; the identifier is ours. An import named `Cluster` in
 *   `src/renderer/index.tsx` would shadow the most overloaded noun in the
 *   host's vocabulary for every future reader. `crd.plural` and
 *   `crd.shortNames` stay the API's own words, because they feed `apiBase`.
 * - **There is no `phase` and no top-level `message`.** The status reports
 *   conditions only, which is what makes `fleet-status.ts` the first classifier
 *   of this repository that reads conditions rather than a phase string.
 * - **The reconciler is the kubeswift-gateway, not the controller-manager.**
 *   The schema says so in as many words, while the chart installs this CRD on
 *   every KubeSwift cluster. So an object whose status is permanently empty is
 *   an expected reading of this view, not an edge case.
 *
 * The interfaces below are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.13.12, verified against `config/crd/bases` at that tag
 * while implementing this milestone). Every field of the spec is optional and
 * the file carries no `x-kubernetes-validations` rule at all, so an object with
 * an entirely empty spec is valid and every helper here guards itself.
 */

/** Core `LocalObjectReference`: an optional `name` and, deliberately, no namespace. */
export type FleetClusterCredentialSecretRef = LocalObjectReference;

export interface FleetClusterSpec {
  /**
   * A Secret in the SAME namespace holding the hub's credential for this
   * member. Required for a remote member and omitted, together with
   * `local: true`, for the hub's own cluster - which `docs/crds.md` still calls
   * "Required" and types as a `SecretReference` (SPEC-0009 records both).
   */
  credentialSecretRef?: FleetClusterCredentialSecretRef;
  /** Human-friendly label for the gateway UI's own cluster selector. */
  displayName?: string;
  /** UNSAFE, in the schema's own word: the member's API server certificate is not verified. */
  insecureSkipTLSVerify?: boolean;
  /** The hub federating its OWN cluster through its in-cluster ServiceAccount. */
  local?: boolean;
  /** Base URL of this member's Prometheus, for the gateway's per-VM telemetry. */
  prometheusEndpoint?: string;
  /** The member's API server URL. Optional when the credential Secret carries a full kubeconfig. */
  server?: string;
}

export interface FleetClusterStatus {
  /** `Ready`, `Reachable` and `PrometheusEndpointResolved`; only the first is in the manifest. */
  conditions?: Condition[];
  /** SwiftGuests observed on the member at the last sync. Omitted until the first one. */
  guestCount?: number;
  kubernetesVersion?: string;
  lastConnected?: string;
  observedGeneration?: number;
  /** The endpoint the gateway resolved: the spec's when set, else a discovered one, else empty. */
  prometheusEndpoint?: string;
}

/**
 * Documented Go constant: how the effective telemetry endpoint was derived.
 *
 * The other two condition types this CRD writes, `Ready` and `Reachable`, are
 * the classifier's business and live in `components/fleet-status.ts`, so each
 * one is spelled in exactly one place.
 */
export const prometheusResolvedConditionType = "PrometheusEndpointResolved";

/**
 * What an absent `spec.server` means when the entry federates the hub's own
 * cluster: there is no server URL to hold, not a missing one.
 */
export const inClusterServerLabel = "In-cluster";
export const inClusterServerTooltip =
  "The gateway federates its own cluster through its in-cluster ServiceAccount, so this entry holds no API server " +
  "URL and no credential";

/**
 * What an absent `spec.server` means when a credential Secret is named: the URL
 * is inside that Secret's kubeconfig, which this extension deliberately does
 * not read.
 */
export const fromKubeconfigServerLabel = "From kubeconfig";
export const fromKubeconfigServerTooltip =
  "The server URL is in the current-context of the kubeconfig held by the credential Secret. This extension names " +
  "that Secret and never reads it";

/** What a `spec.local` entry has instead of a credential Secret row. */
export const inClusterCredentialLabel = "In-cluster ServiceAccount (no credential stored)";

/** The two federation roles, named rather than left as a boolean neither value of which is healthier. */
export const localFederationLabel = "Local (the hub's own cluster)";
export const remoteFederationLabel = "Remote member";

/** Why a display name is not a column and what the gateway does without one. */
export const displayNameTooltip =
  "The label the gateway's own cluster selector shows for this member. The gateway falls back to metadata.name " +
  "when it is empty";

/** The schema's own warning about the setting the Certificate Verification row reports. */
export const certificateVerificationTooltip =
  "Verification of the member API server's certificate. Turning it off is UNSAFE and is meant only for a " +
  "trusted-network member whose CA is not wired yet; ship a ca.crt key in the credential Secret instead";

/**
 * The two facts a guest count needs next to it: an absent one means the gateway
 * has never synced the member, and the VMs it counts are not the ones this
 * Freelens window is showing.
 */
export const guestCountTooltip =
  "SwiftGuests observed on the MEMBER cluster at the last sync, omitted until the gateway has synced it at least " +
  "once. They are not the guests this Freelens window lists: to see them, connect Freelens to the member";

/**
 * Whose endpoint the Telemetry section is showing, said as a row rather than as
 * a tooltip (the DESIGN.md section 7 rule SPEC-0008 applied to the pool's GPU
 * sizing): without that sentence an empty Telemetry section reads as a Freelens
 * metrics problem, which is a different subsystem entirely.
 */
export const telemetryConsumerLabel = "The kubeswift-gateway, for its own UI (never Freelens)";
export const telemetryConsumerTooltip =
  "The gateway queries this endpoint for the per-VM telemetry of its own UI, joining series on the " +
  "swift.kubeswift.io/guest label. Neither this extension nor Freelens ever reads it: Freelens has its own metrics " +
  "stack";

// The four reasons the gateway documents for PrometheusEndpointResolved,
// humanized here so the drawer can show what happened rather than a CamelCase
// identifier. They live in prose upstream and not in the schema, so anything
// else is passed through raw (the SPEC-0007 treatment of tier and partition
// mode).
const prometheusResolutionReadings = new Map<string, string>([
  ["Explicit", "Explicit (the endpoint spec.prometheusEndpoint configured)"],
  ["Discovered", "Discovered (the gateway found an in-cluster Prometheus)"],
  ["NotFound", "Not found (the gateway discovered no Prometheus for this member)"],
  ["DiscoveryError", "Discovery error (the gateway's scan failed)"],
]);

// The metadata is declared namespace-scoped rather than with the generic
// `KubeObjectMetadata` the M1/M2 models use: it makes `getNs()` a `string`,
// which is what the `NamespaceSelectBadge` of the list cell and the explicit
// namespaces of `useReferenceStores` both need (the SPEC-0007 slice-1 rule for
// every new namespaced model).
export class FleetCluster extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  FleetClusterStatus,
  FleetClusterSpec
> {
  static readonly kind = "Cluster";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/fleet.kubeswift.io/v1alpha1/clusters";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["fleet.kubeswift.io/v1alpha1"],
    plural: "clusters",
    singular: "cluster",
    shortNames: ["ksc"],
    // Not the plain humanization of the kind: the host's own sidebar already
    // holds an item titled "Cluster" one level up, so "Clusters" would produce
    // the very ambiguity the DESIGN.md section 4 rule exists to prevent. The
    // qualifier is the schema's own first words (declared deviation, SPEC-0009).
    title: "Member Clusters",
  };

  static isLocal(object: FleetCluster): boolean {
    return object.spec?.local === true;
  }

  static getServer(object: FleetCluster): string | undefined {
    return object.spec?.server;
  }

  static getDisplayName(object: FleetCluster): string | undefined {
    return object.spec?.displayName;
  }

  /** The `name` of a core `LocalObjectReference` carries a `""` default, so empty means "not named". */
  static getCredentialSecretName(object: FleetCluster): string | undefined {
    return object.spec?.credentialSecretRef?.name || undefined;
  }

  /**
   * The Server cell in its four states, because `spec.server` is optional by
   * design and each reason it can be absent is a different fact:
   *
   * 1. a value: the URL itself;
   * 2. absent with `local: true`: the hub's own cluster, which holds no URL;
   * 3. absent with a credential Secret: the URL lives in that Secret's
   *    kubeconfig, which this extension does not read;
   * 4. absent with neither: `undefined`, which the views render as "N/A" and
   *    which is the only one of the four that really is a missing value.
   *
   * Rendering "N/A" for cases 2 and 3 would report a correctly configured
   * member as incomplete.
   */
  static getServerLabel(object: FleetCluster): string | undefined {
    const server = FleetCluster.getServer(object);

    if (server) {
      return server;
    }

    if (FleetCluster.isLocal(object)) {
      return inClusterServerLabel;
    }

    return FleetCluster.getCredentialSecretName(object) ? fromKubeconfigServerLabel : undefined;
  }

  /** Only the two named readings need a tooltip; a URL tooltips itself. */
  static getServerTooltip(object: FleetCluster): string | undefined {
    const label = FleetCluster.getServerLabel(object);

    if (label === inClusterServerLabel) {
      return inClusterServerTooltip;
    }

    return label === fromKubeconfigServerLabel ? fromKubeconfigServerTooltip : undefined;
  }

  /** Which side of the federation this entry describes. Neither value is healthier than the other. */
  static getFederationLabel(object: FleetCluster): string {
    return FleetCluster.isLocal(object) ? localFederationLabel : remoteFederationLabel;
  }

  /**
   * Green means the member's API server certificate is verified: the positive
   * phrasing DESIGN.md section 2 prescribes, over the schema's negative field.
   */
  static verifiesCertificate(object: FleetCluster): boolean {
    return object.spec?.insecureSkipTLSVerify !== true;
  }

  static getKubernetesVersion(object: FleetCluster): string | undefined {
    return object.status?.kubernetesVersion;
  }

  /**
   * The guest count, with `0` kept: the schema omits this field until the
   * gateway has synced the member at least once, so `0` is a synced member
   * running no VMs and absent is one that has never been reached. Collapsing
   * them would hide the one number that says whether the gateway has ever
   * talked to this member (the `formatBytes` zero rule, applied to a count).
   */
  static getGuestCount(object: FleetCluster): number | undefined {
    return object.status?.guestCount;
  }

  static getLastConnected(object: FleetCluster): string | undefined {
    return object.status?.lastConnected;
  }

  static getObservedGeneration(object: FleetCluster): number | undefined {
    return object.status?.observedGeneration;
  }

  /** The effective endpoint the gateway resolved, whichever way it got there. */
  static getPrometheusEndpoint(object: FleetCluster): string | undefined {
    return object.status?.prometheusEndpoint;
  }

  /** What the spec asked for, so an operator can see whether the effective value was theirs. */
  static getConfiguredPrometheusEndpoint(object: FleetCluster): string | undefined {
    return object.spec?.prometheusEndpoint;
  }

  static getCondition(object: FleetCluster, type: string): Condition | undefined {
    return object.status?.conditions?.find((condition) => condition.type === type);
  }

  /**
   * True when there is anything to say about telemetry at all, so the section
   * guards itself: an endpoint asked for, an endpoint resolved, or a gateway
   * that reported on the attempt.
   */
  static hasTelemetry(object: FleetCluster): boolean {
    return Boolean(
      FleetCluster.getConfiguredPrometheusEndpoint(object) ||
        FleetCluster.getPrometheusEndpoint(object) ||
        FleetCluster.getCondition(object, prometheusResolvedConditionType),
    );
  }

  /**
   * How the effective endpoint was derived, humanized for the four documented
   * reasons and passed through raw for anything else - the reasons live in
   * prose upstream, not in the schema, so a value this extension does not know
   * is displayed as it arrived rather than dropped.
   */
  static getPrometheusResolution(object: FleetCluster): string | undefined {
    const reason = FleetCluster.getCondition(object, prometheusResolvedConditionType)?.reason;

    if (!reason) {
      return undefined;
    }

    return prometheusResolutionReadings.get(reason) ?? reason;
  }

  /** The gateway's own words about the resolution, for the row's tooltip. */
  static getPrometheusResolutionTooltip(object: FleetCluster): string | undefined {
    return FleetCluster.getCondition(object, prometheusResolvedConditionType)?.message || undefined;
  }
}

export class FleetClusterApi extends Renderer.K8sApi.KubeApi<FleetCluster> {}
export class FleetClusterStore extends Renderer.K8sApi.KubeObjectStore<FleetCluster, FleetClusterApi> {}

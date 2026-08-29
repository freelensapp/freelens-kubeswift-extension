import { describe, expect, it } from "vitest";
import {
  FleetCluster,
  fromKubeconfigServerLabel,
  fromKubeconfigServerTooltip,
  inClusterServerLabel,
  inClusterServerTooltip,
  localFederationLabel,
  remoteFederationLabel,
} from "./fleetcluster-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("FleetCluster (v1alpha1)", () => {
  const buildFleetCluster = (
    spec?: FleetCluster["spec"],
    status?: FleetCluster["status"],
    name = "edge-1",
    namespace = "kubeswift-system",
  ) =>
    new FleetCluster({
      apiVersion: "fleet.kubeswift.io/v1alpha1",
      kind: "Cluster",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/fleet.kubeswift.io/v1alpha1/namespaces/${namespace}/clusters/${name}`,
      },
      spec,
      status,
    });

  // A remote member joined the documented way: a server URL, a credential
  // Secret next to the object, and an explicitly configured telemetry endpoint.
  const remoteSpec: FleetCluster["spec"] = {
    server: "https://edge-1.example.internal:6443",
    displayName: "Edge 1 (Milan)",
    credentialSecretRef: { name: "edge-1-credential" },
    prometheusEndpoint: "https://prometheus.edge-1.example.internal",
  };

  const remoteStatus: FleetCluster["status"] = {
    kubernetesVersion: "v1.34.3",
    guestCount: 7,
    lastConnected: "2026-08-29T09:12:00Z",
    observedGeneration: 2,
    prometheusEndpoint: "https://prometheus.edge-1.example.internal",
    conditions: [
      {
        type: "Ready",
        status: "True",
        reason: "ClientHealthy",
        message: "The gateway holds a healthy client for this member.",
        lastTransitionTime: "2026-08-29T09:12:00Z",
      },
      {
        type: "Reachable",
        status: "True",
        reason: "APIServerReachable",
        message: "The member's API server answered.",
        lastTransitionTime: "2026-08-29T09:12:00Z",
      },
      {
        type: "PrometheusEndpointResolved",
        status: "True",
        reason: "Explicit",
        message: "spec.prometheusEndpoint was used verbatim.",
        lastTransitionTime: "2026-08-29T09:12:00Z",
      },
    ],
  };

  it("constructs from a realistic member cluster and reads every field", () => {
    const cluster = buildFleetCluster(remoteSpec, remoteStatus);

    expect(cluster.getName()).toBe("edge-1");
    expect(cluster.getNs()).toBe("kubeswift-system");
    expect(FleetCluster.kind).toBe("Cluster");
    expect(FleetCluster.namespaced).toBe(true);
    expect(FleetCluster.apiBase).toBe("/apis/fleet.kubeswift.io/v1alpha1/clusters");
    // The API's own words for the plural and the short name (they feed
    // `apiBase` and `kubectl`); only the display title is qualified, because
    // the host's sidebar already holds an item called "Cluster" (SPEC-0009).
    expect(FleetCluster.crd.plural).toBe("clusters");
    expect(FleetCluster.crd.shortNames).toEqual(["ksc"]);
    expect(FleetCluster.crd.title).toBe("Member Clusters");

    expect(FleetCluster.isLocal(cluster)).toBe(false);
    expect(FleetCluster.getServer(cluster)).toBe("https://edge-1.example.internal:6443");
    expect(FleetCluster.getDisplayName(cluster)).toBe("Edge 1 (Milan)");
    expect(FleetCluster.getCredentialSecretName(cluster)).toBe("edge-1-credential");
    expect(FleetCluster.getFederationLabel(cluster)).toBe(remoteFederationLabel);
    expect(FleetCluster.verifiesCertificate(cluster)).toBe(true);
    expect(FleetCluster.getKubernetesVersion(cluster)).toBe("v1.34.3");
    expect(FleetCluster.getGuestCount(cluster)).toBe(7);
    expect(FleetCluster.getLastConnected(cluster)).toBe("2026-08-29T09:12:00Z");
    expect(FleetCluster.getObservedGeneration(cluster)).toBe(2);
    expect(FleetCluster.getPrometheusEndpoint(cluster)).toBe("https://prometheus.edge-1.example.internal");
    expect(FleetCluster.getConfiguredPrometheusEndpoint(cluster)).toBe("https://prometheus.edge-1.example.internal");
    expect(FleetCluster.getCondition(cluster, "Ready")?.status).toBe("True");
    expect(FleetCluster.hasTelemetry(cluster)).toBe(true);
    expect(FleetCluster.getPrometheusResolution(cluster)).toContain("Explicit");
    expect(FleetCluster.getPrometheusResolutionTooltip(cluster)).toBe("spec.prometheusEndpoint was used verbatim.");
  });

  // The Server cell reads four ways, not two: `spec.server` is optional by
  // design and each reason it can be absent is a different fact (SPEC-0009).
  describe("the four readings of the Server value", () => {
    it("shows the URL when there is one", () => {
      const cluster = buildFleetCluster(remoteSpec);

      expect(FleetCluster.getServerLabel(cluster)).toBe("https://edge-1.example.internal:6443");
      // A URL tooltips itself through `WithTooltip`; only the named readings
      // need one of their own.
      expect(FleetCluster.getServerTooltip(cluster)).toBeUndefined();
    });

    it("names the in-cluster reading for the hub's own entry", () => {
      const cluster = buildFleetCluster({ local: true, displayName: "Hub" });

      expect(FleetCluster.getServerLabel(cluster)).toBe(inClusterServerLabel);
      expect(FleetCluster.getServerTooltip(cluster)).toBe(inClusterServerTooltip);
    });

    it("names the kubeconfig reading when only a credential Secret is there", () => {
      const cluster = buildFleetCluster({ credentialSecretRef: { name: "edge-down-credential" } });

      expect(FleetCluster.getServerLabel(cluster)).toBe(fromKubeconfigServerLabel);
      expect(FleetCluster.getServerTooltip(cluster)).toBe(fromKubeconfigServerTooltip);
    });

    it("reports a genuinely missing value when neither is there", () => {
      const cluster = buildFleetCluster({ displayName: "Half-configured" });

      expect(FleetCluster.getServerLabel(cluster)).toBeUndefined();
      expect(FleetCluster.getServerTooltip(cluster)).toBeUndefined();
    });

    it("keeps the URL even on a local entry, since no CEL rule enforces the exclusivity", () => {
      // `local` and `credentialSecretRef` are documented as mutually exclusive
      // and nothing in the schema enforces it, so an object that breaks the
      // rule is rendered rather than assumed away: a server that is there wins.
      const cluster = buildFleetCluster({
        local: true,
        server: "https://hub.example.internal:6443",
        credentialSecretRef: { name: "unexpected" },
      });

      expect(FleetCluster.getServerLabel(cluster)).toBe("https://hub.example.internal:6443");
    });

    it("treats the empty credential name the core default writes as no name at all", () => {
      // A core `LocalObjectReference` carries a `""` default on `name`, so an
      // empty string is "not named" and must not upgrade the cell to the
      // kubeconfig reading.
      const cluster = buildFleetCluster({ credentialSecretRef: { name: "" } });

      expect(FleetCluster.getCredentialSecretName(cluster)).toBeUndefined();
      expect(FleetCluster.getServerLabel(cluster)).toBeUndefined();
    });
  });

  it("keeps a guest count of 0 distinct from an absent one", () => {
    // The schema omits `guestCount` until the gateway has synced the member at
    // least once, so `0` is a synced member running no VMs and absent is one
    // that has never been reached.
    const synced = buildFleetCluster({ local: true }, { guestCount: 0 });
    const neverSynced = buildFleetCluster({ local: true }, {});

    expect(FleetCluster.getGuestCount(synced)).toBe(0);
    expect(FleetCluster.getGuestCount(neverSynced)).toBeUndefined();
  });

  it("reads a local entry that names no credential Secret", () => {
    const cluster = buildFleetCluster({ local: true, displayName: "Hub" }, { guestCount: 0 }, "hub");

    expect(FleetCluster.isLocal(cluster)).toBe(true);
    expect(FleetCluster.getFederationLabel(cluster)).toBe(localFederationLabel);
    expect(FleetCluster.getCredentialSecretName(cluster)).toBeUndefined();
    expect(FleetCluster.getServerLabel(cluster)).toBe(inClusterServerLabel);
  });

  it("reports an unverified certificate through the positive phrasing", () => {
    const unsafe = buildFleetCluster({ insecureSkipTLSVerify: true });
    const safe = buildFleetCluster({ insecureSkipTLSVerify: false });

    expect(FleetCluster.verifiesCertificate(unsafe)).toBe(false);
    expect(FleetCluster.verifiesCertificate(safe)).toBe(true);
  });

  it("guards the Telemetry section on each of its three triggers", () => {
    expect(FleetCluster.hasTelemetry(buildFleetCluster({ prometheusEndpoint: "https://p" }))).toBe(true);
    expect(FleetCluster.hasTelemetry(buildFleetCluster({}, { prometheusEndpoint: "https://p" }))).toBe(true);
    expect(
      FleetCluster.hasTelemetry(
        buildFleetCluster(
          {},
          {
            conditions: [
              {
                type: "PrometheusEndpointResolved",
                status: "False",
                reason: "NotFound",
                message: "No Prometheus was discovered in the configured namespaces.",
                lastTransitionTime: "2026-08-29T09:12:00Z",
              },
            ],
          },
        ),
      ),
    ).toBe(true);
    expect(FleetCluster.hasTelemetry(buildFleetCluster({ local: true }, { guestCount: 0 }))).toBe(false);
  });

  it("humanizes the documented resolution reasons and passes an unknown one through", () => {
    const withReason = (reason: string) =>
      FleetCluster.getPrometheusResolution(
        buildFleetCluster(
          {},
          {
            conditions: [
              {
                type: "PrometheusEndpointResolved",
                status: "True",
                reason,
                message: "",
                lastTransitionTime: "2026-08-29T09:12:00Z",
              },
            ],
          },
        ),
      );

    expect(withReason("Explicit")).toContain("Explicit");
    expect(withReason("Discovered")).toContain("Discovered");
    expect(withReason("NotFound")).toContain("Not found");
    expect(withReason("DiscoveryError")).toContain("Discovery error");
    // The reasons live in prose upstream and not in the schema, so anything
    // else is displayed as it arrived rather than dropped.
    expect(withReason("QuietlyAddedInV1")).toBe("QuietlyAddedInV1");
  });

  it("reads an object with no spec at all", () => {
    // Every field of the spec is optional and the schema carries no validation
    // rule, so the API server accepts an object with no spec whatsoever.
    const cluster = buildFleetCluster(undefined, remoteStatus, "spec-less");

    expect(FleetCluster.isLocal(cluster)).toBe(false);
    expect(FleetCluster.getServer(cluster)).toBeUndefined();
    expect(FleetCluster.getServerLabel(cluster)).toBeUndefined();
    expect(FleetCluster.getServerTooltip(cluster)).toBeUndefined();
    expect(FleetCluster.getDisplayName(cluster)).toBeUndefined();
    expect(FleetCluster.getCredentialSecretName(cluster)).toBeUndefined();
    expect(FleetCluster.getFederationLabel(cluster)).toBe(remoteFederationLabel);
    expect(FleetCluster.verifiesCertificate(cluster)).toBe(true);
    expect(FleetCluster.getConfiguredPrometheusEndpoint(cluster)).toBeUndefined();
  });

  it("reads an object with no status at all", () => {
    const cluster = buildFleetCluster(remoteSpec, undefined, "pending");

    expect(FleetCluster.getKubernetesVersion(cluster)).toBeUndefined();
    expect(FleetCluster.getGuestCount(cluster)).toBeUndefined();
    expect(FleetCluster.getLastConnected(cluster)).toBeUndefined();
    expect(FleetCluster.getObservedGeneration(cluster)).toBeUndefined();
    expect(FleetCluster.getPrometheusEndpoint(cluster)).toBeUndefined();
    expect(FleetCluster.getCondition(cluster, "Ready")).toBeUndefined();
    expect(FleetCluster.getPrometheusResolution(cluster)).toBeUndefined();
    expect(FleetCluster.getPrometheusResolutionTooltip(cluster)).toBeUndefined();
    // The spec still asks for an endpoint, so the section is rendered and says
    // that nothing resolved it - which is not the same as having none.
    expect(FleetCluster.hasTelemetry(cluster)).toBe(true);
  });
});

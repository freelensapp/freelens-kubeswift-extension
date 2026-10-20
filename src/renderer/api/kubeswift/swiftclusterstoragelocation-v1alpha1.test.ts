import { describe, expect, it } from "vitest";
import { SwiftClusterStorageLocation } from "./swiftclusterstoragelocation-v1alpha1";
import { defaultCredentialsSecretName, defaultLocationLabel } from "./swiftstoragelocation-v1alpha1";

describe("SwiftClusterStorageLocation (v1alpha1)", () => {
  const buildLocation = (
    spec: SwiftClusterStorageLocation["spec"],
    status?: SwiftClusterStorageLocation["status"],
    name = "cluster-registry",
  ) =>
    new SwiftClusterStorageLocation({
      apiVersion: "storage.kubeswift.io/v1alpha1",
      kind: "SwiftClusterStorageLocation",
      metadata: {
        name,
        selfLink: `/apis/storage.kubeswift.io/v1alpha1/swiftclusterstoragelocations/${name}`,
      },
      spec,
      ...(status === undefined ? {} : { status }),
    });

  const condition = (type: string, status: "True" | "False" | "Unknown", message = "") => ({
    type,
    status,
    reason: "Reported",
    message,
    lastTransitionTime: "2026-10-19T10:00:00Z",
  });

  it("declares its kind, scope and API", () => {
    expect(SwiftClusterStorageLocation.kind).toBe("SwiftClusterStorageLocation");
    expect(SwiftClusterStorageLocation.namespaced).toBe(false);
    expect(SwiftClusterStorageLocation.apiBase).toBe(
      "/apis/storage.kubeswift.io/v1alpha1/swiftclusterstoragelocations",
    );
    expect(SwiftClusterStorageLocation.crd).toMatchObject({
      plural: "swiftclusterstoragelocations",
      shortNames: ["csloc"],
      title: "Cluster Storage Locations",
    });
  });

  it("reads the cluster default with its Reachable condition", () => {
    const location = buildLocation(
      { default: true, oci: { repository: "registry.example.com/kubeswift" } },
      { observedGeneration: 1, conditions: [condition("Ready", "True"), condition("Reachable", "True")] },
    );

    expect(location.getNs()).toBeUndefined();
    expect(SwiftClusterStorageLocation.isDefault(location)).toBe(true);
    expect(SwiftClusterStorageLocation.getDefaultLabel(location)).toBe(defaultLocationLabel);
    expect(SwiftClusterStorageLocation.getRepository(location)).toBe("registry.example.com/kubeswift");
    expect(SwiftClusterStorageLocation.getBackends(location)).toBe("OCI");
    expect(SwiftClusterStorageLocation.getCredentialsSecretName(location)).toBe(defaultCredentialsSecretName);
    expect(SwiftClusterStorageLocation.getReachable(location)).toBe(true);
    expect(SwiftClusterStorageLocation.getObservedGeneration(location)).toBe(1);
  });

  it("reads an unreachable registry as false", () => {
    const location = buildLocation(
      { oci: { repository: "registry.example.com/kubeswift", anonymous: true } },
      { conditions: [condition("Ready", "False"), condition("Reachable", "False", "dial tcp: i/o timeout")] },
    );

    expect(SwiftClusterStorageLocation.getReachable(location)).toBe(false);
    expect(SwiftClusterStorageLocation.getCredentialsSecretName(location)).toBeUndefined();
  });

  it("has no Reachable reading before the controller has probed the registry", () => {
    const location = buildLocation({ csi: { volumeSnapshotClassName: "csi-snapclass" } });

    expect(SwiftClusterStorageLocation.getReachable(location)).toBeUndefined();
    expect(SwiftClusterStorageLocation.getRepository(location)).toBeUndefined();
    expect(SwiftClusterStorageLocation.getVolumeSnapshotClassName(location)).toBe("csi-snapclass");
    expect(SwiftClusterStorageLocation.getObservedGeneration(location)).toBeUndefined();
  });
});

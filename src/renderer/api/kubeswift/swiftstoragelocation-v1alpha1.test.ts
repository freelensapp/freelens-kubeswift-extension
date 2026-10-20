import { describe, expect, it } from "vitest";
import {
  defaultCredentialsSecretName,
  defaultLocationLabel,
  notDefaultLocationLabel,
  SwiftStorageLocation,
  storageLocationBackends,
  storageLocationConditionValue,
  storageLocationCredentialsSecret,
  storageLocationSecretNames,
  usesDefaultCredentialsSecret,
} from "./swiftstoragelocation-v1alpha1";
import { summarizePem } from "./types";

const publicKey = ["-----BEGIN PUBLIC KEY-----", "bm90LWEtcmVhbC1rZXk=", "-----END PUBLIC KEY-----"].join("\n");
const certificate = ["-----BEGIN CERTIFICATE-----", "bm90LWEtcmVhbC1jZXJ0", "-----END CERTIFICATE-----"].join("\n");

// The model only exposes `static` helpers: the host passes plain object copies
// around, so the helpers take the object as their first argument.
describe("SwiftStorageLocation (v1alpha1)", () => {
  const buildLocation = (
    spec: SwiftStorageLocation["spec"],
    status?: SwiftStorageLocation["status"],
    name = "team-registry",
    namespace = "team-a",
  ) =>
    new SwiftStorageLocation({
      apiVersion: "storage.kubeswift.io/v1alpha1",
      kind: "SwiftStorageLocation",
      metadata: {
        name,
        namespace,
        selfLink: `/apis/storage.kubeswift.io/v1alpha1/namespaces/${namespace}/swiftstoragelocations/${name}`,
      },
      spec,
      ...(status === undefined ? {} : { status }),
    });

  const fullSpec: SwiftStorageLocation["spec"] = {
    default: true,
    oci: {
      repository: "registry.example.com/team-a",
      credentialsSecretName: "team-a-registry",
      signingKeySecretName: "team-a-cosign",
      verifyKey: publicKey,
      caBundle: `${certificate}\n${certificate}`,
    },
    csi: { volumeSnapshotClassName: "csi-snapclass" },
  };

  const readyStatus: SwiftStorageLocation["status"] = {
    observedGeneration: 2,
    conditions: [
      {
        type: "Ready",
        status: "True",
        reason: "Validated",
        message: "The location can be used.",
        lastTransitionTime: "2026-10-19T10:00:00Z",
      },
    ],
  };

  it("declares its kind, scope and API", () => {
    expect(SwiftStorageLocation.kind).toBe("SwiftStorageLocation");
    expect(SwiftStorageLocation.namespaced).toBe(true);
    expect(SwiftStorageLocation.apiBase).toBe("/apis/storage.kubeswift.io/v1alpha1/swiftstoragelocations");
    expect(SwiftStorageLocation.crd).toMatchObject({
      apiVersions: ["storage.kubeswift.io/v1alpha1"],
      plural: "swiftstoragelocations",
      singular: "swiftstoragelocation",
      shortNames: ["sloc"],
      title: "Storage Locations",
    });
  });

  it("reads a location with both backends", () => {
    const location = buildLocation(fullSpec, readyStatus);

    expect(location.getNs()).toBe("team-a");
    expect(SwiftStorageLocation.isDefault(location)).toBe(true);
    expect(SwiftStorageLocation.getDefaultLabel(location)).toBe(defaultLocationLabel);
    expect(SwiftStorageLocation.getRepository(location)).toBe("registry.example.com/team-a");
    expect(SwiftStorageLocation.getVolumeSnapshotClassName(location)).toBe("csi-snapclass");
    expect(SwiftStorageLocation.getBackends(location)).toBe("OCI and CSI");
    expect(SwiftStorageLocation.getCredentialsSecretName(location)).toBe("team-a-registry");
    expect(SwiftStorageLocation.getSecretNames(location)).toEqual(["team-a-cosign", "team-a-registry"]);
    expect(SwiftStorageLocation.getObservedGeneration(location)).toBe(2);
  });

  it("reads a CSI-only location, which names no repository and no Secret", () => {
    const location = buildLocation({ csi: { volumeSnapshotClassName: "csi-snapclass" } });

    expect(SwiftStorageLocation.isDefault(location)).toBe(false);
    expect(SwiftStorageLocation.getDefaultLabel(location)).toBe(notDefaultLocationLabel);
    expect(SwiftStorageLocation.getRepository(location)).toBeUndefined();
    expect(SwiftStorageLocation.getBackends(location)).toBe("CSI");
    expect(SwiftStorageLocation.getCredentialsSecretName(location)).toBeUndefined();
    expect(SwiftStorageLocation.getSecretNames(location)).toEqual([]);
    expect(SwiftStorageLocation.getObservedGeneration(location)).toBeUndefined();
  });

  it("survives an object with neither spec nor status", () => {
    const location = buildLocation(undefined as unknown as SwiftStorageLocation["spec"]);

    expect(SwiftStorageLocation.isDefault(location)).toBe(false);
    expect(SwiftStorageLocation.getBackends(location)).toBeUndefined();
    expect(SwiftStorageLocation.getSecretNames(location)).toEqual([]);
  });
});

describe("storage location helpers", () => {
  it("names the backends a spec sets", () => {
    expect(storageLocationBackends({ oci: { repository: "r" } })).toBe("OCI");
    expect(storageLocationBackends({ csi: { volumeSnapshotClassName: "c" } })).toBe("CSI");
    expect(storageLocationBackends({ oci: { repository: "r" }, csi: { volumeSnapshotClassName: "c" } })).toBe(
      "OCI and CSI",
    );
    expect(storageLocationBackends({})).toBeUndefined();
    expect(storageLocationBackends()).toBeUndefined();
  });

  it("reads an unset credentials name as the controller's default Secret", () => {
    const spec = { oci: { repository: "registry.example.com/kubeswift" } };

    expect(storageLocationCredentialsSecret(spec)).toBe(defaultCredentialsSecretName);
    expect(usesDefaultCredentialsSecret(spec)).toBe(true);
    expect(storageLocationSecretNames(spec)).toEqual([defaultCredentialsSecretName]);
  });

  it("looks up no credentials Secret for an anonymous registry", () => {
    const spec = { oci: { repository: "registry.example.com/public", anonymous: true } };

    expect(storageLocationCredentialsSecret(spec)).toBeUndefined();
    expect(usesDefaultCredentialsSecret(spec)).toBe(false);
    expect(storageLocationSecretNames(spec)).toEqual([]);
  });

  it("deduplicates a Secret named twice", () => {
    expect(
      storageLocationSecretNames({
        oci: { repository: "r", credentialsSecretName: "shared", signingKeySecretName: "shared" },
      }),
    ).toEqual(["shared"]);
  });

  it("reads a condition as a boolean, and Unknown or absent as undefined", () => {
    const condition = (type: string, status: "True" | "False" | "Unknown") => ({
      type,
      status,
      reason: "R",
      message: "",
      lastTransitionTime: "2026-10-19T10:00:00Z",
    });
    const status = { conditions: [condition("Ready", "True"), condition("Reachable", "False")] };

    expect(storageLocationConditionValue(status, "Ready")).toBe(true);
    expect(storageLocationConditionValue(status, "Reachable")).toBe(false);
    expect(storageLocationConditionValue({ conditions: [condition("Ready", "Unknown")] }, "Ready")).toBeUndefined();
    expect(storageLocationConditionValue(undefined, "Ready")).toBeUndefined();
  });
});

describe("summarizePem", () => {
  it("counts the blocks of each kind", () => {
    expect(summarizePem(publicKey)).toBe("1 public key");
    expect(summarizePem(`${certificate}\n${certificate}`)).toBe("2 certificates");
    expect(summarizePem(`${certificate}\n${publicKey}`)).toBe("1 certificate, 1 public key");
  });

  it("says when a text holds no PEM block, and maps an empty one to undefined", () => {
    expect(summarizePem("not a key")).toBe("No PEM block");
    expect(summarizePem("  \n")).toBeUndefined();
    expect(summarizePem()).toBeUndefined();
  });
});

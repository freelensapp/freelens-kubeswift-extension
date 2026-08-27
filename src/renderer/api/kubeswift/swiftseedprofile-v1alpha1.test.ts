import { describe, expect, it } from "vitest";
import { SwiftSeedProfile } from "./swiftseedprofile-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`.
describe("SwiftSeedProfile (v1alpha1)", () => {
  const buildSwiftSeedProfile = (spec: SwiftSeedProfile["spec"]) =>
    new SwiftSeedProfile({
      apiVersion: "seed.kubeswift.io/v1alpha1",
      kind: "SwiftSeedProfile",
      metadata: {
        name: "demo",
        namespace: "default",
        selfLink: "/apis/seed.kubeswift.io/v1alpha1/namespaces/default/swiftseedprofiles/demo",
      },
      spec,
    });

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftSeedProfile.kind).toBe("SwiftSeedProfile");
      expect(SwiftSeedProfile.namespaced).toBe(true);
      expect(SwiftSeedProfile.apiBase).toBe("/apis/seed.kubeswift.io/v1alpha1/swiftseedprofiles");
      expect(SwiftSeedProfile.crd).toMatchObject({
        apiVersions: ["seed.kubeswift.io/v1alpha1"],
        plural: "swiftseedprofiles",
        singular: "swiftseedprofile",
        shortNames: ["ssp"],
      });
    });
  });

  describe("getDatasource", () => {
    it("returns the datasource of the spec", () => {
      expect(SwiftSeedProfile.getDatasource(buildSwiftSeedProfile({ datasource: "NoCloud" }))).toBe("NoCloud");
    });
  });

  describe("getUserDataSource", () => {
    it("reports inline user-data without exposing its content", () => {
      const object = buildSwiftSeedProfile({ datasource: "NoCloud", userData: "#cloud-config\npassword: hunter2\n" });

      expect(SwiftSeedProfile.getUserDataSource(object)).toEqual({ origin: "inline", title: "Inline" });
    });

    it("reports a Secret-backed reference with its key", () => {
      const object = buildSwiftSeedProfile({
        datasource: "NoCloud",
        userDataFrom: { secretKeyRef: { name: "seed", key: "user-data", optional: false } },
      });

      expect(SwiftSeedProfile.getUserDataSource(object)).toEqual({
        origin: "secret",
        title: "Secret",
        name: "seed",
        key: "user-data",
        optional: false,
      });
    });

    it("reports a ConfigMap-backed reference with its key", () => {
      const object = buildSwiftSeedProfile({
        datasource: "NoCloud",
        userDataFrom: { configMapKeyRef: { name: "seed", key: "user-data" } },
      });

      expect(SwiftSeedProfile.getUserDataSource(object)).toMatchObject({
        origin: "configMap",
        title: "ConfigMap",
        name: "seed",
        key: "user-data",
      });
    });

    it("prefers the Secret when a profile sets both references", () => {
      const object = buildSwiftSeedProfile({
        datasource: "NoCloud",
        userDataFrom: {
          secretKeyRef: { name: "seed", key: "user-data" },
          configMapKeyRef: { name: "public", key: "user-data" },
        },
      });

      expect(SwiftSeedProfile.getUserDataSource(object)?.origin).toBe("secret");
    });

    it("returns undefined when neither variant is set", () => {
      expect(SwiftSeedProfile.getUserDataSource(buildSwiftSeedProfile({ datasource: "NoCloud" }))).toBeUndefined();
    });

    it("treats an empty inline document as not set", () => {
      const object = buildSwiftSeedProfile({ datasource: "NoCloud", userData: "" });

      expect(SwiftSeedProfile.getUserDataSource(object)).toBeUndefined();
    });
  });

  describe("meta-data and network-data sources", () => {
    it("describes each document independently of the others", () => {
      const object = buildSwiftSeedProfile({
        datasource: "NoCloud",
        userData: "#cloud-config\n",
        metaDataFrom: { configMapKeyRef: { name: "meta", key: "meta-data" } },
        networkData: "version: 2\n",
      });

      expect(SwiftSeedProfile.getUserDataSource(object)?.origin).toBe("inline");
      expect(SwiftSeedProfile.getMetaDataSource(object)?.origin).toBe("configMap");
      expect(SwiftSeedProfile.getNetworkDataSource(object)?.origin).toBe("inline");
    });

    it("reports no meta-data when the controller is left to default it", () => {
      const object = buildSwiftSeedProfile({ datasource: "NoCloud", userData: "#cloud-config\n" });

      expect(SwiftSeedProfile.getMetaDataSource(object)).toBeUndefined();
      expect(SwiftSeedProfile.getNetworkDataSource(object)).toBeUndefined();
    });
  });
});

import { describe, expect, it } from "vitest";
import { SwiftImage } from "./swiftimage-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftImage (v1alpha1)", () => {
  const buildSwiftImage = (spec: SwiftImage["spec"], status?: SwiftImage["status"]) =>
    new SwiftImage({
      apiVersion: "image.kubeswift.io/v1alpha1",
      kind: "SwiftImage",
      metadata: {
        name: "ubuntu-noble",
        namespace: "default",
        selfLink: "/apis/image.kubeswift.io/v1alpha1/namespaces/default/swiftimages/ubuntu-noble",
      },
      spec,
      status,
    });

  const httpSource = { http: { url: "https://example.test/noble.img" } };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftImage.kind).toBe("SwiftImage");
      expect(SwiftImage.namespaced).toBe(true);
      expect(SwiftImage.apiBase).toBe("/apis/image.kubeswift.io/v1alpha1/swiftimages");
      expect(SwiftImage.crd).toMatchObject({
        apiVersions: ["image.kubeswift.io/v1alpha1"],
        plural: "swiftimages",
        singular: "swiftimage",
        shortNames: ["si"],
      });
    });
  });

  describe("getSourceSummary", () => {
    it("describes an HTTP source by its URL", () => {
      const object = buildSwiftImage({ format: "qcow2", source: httpSource });

      expect(SwiftImage.getSourceSummary(object)).toEqual({
        kind: "http",
        title: "HTTP",
        reference: "https://example.test/noble.img",
      });
    });

    it("describes an OCI source pinned by tag", () => {
      const object = buildSwiftImage({
        format: "raw",
        source: { oci: { repository: "ghcr.io/org/golden", tag: "v1" } },
      });

      expect(SwiftImage.getSourceSummary(object)?.reference).toBe("ghcr.io/org/golden:v1");
    });

    it("describes an OCI source pinned by digest", () => {
      const object = buildSwiftImage({
        format: "raw",
        source: { oci: { repository: "ghcr.io/org/golden", digest: "sha256:abc" } },
      });

      expect(SwiftImage.getSourceSummary(object)?.reference).toBe("ghcr.io/org/golden@sha256:abc");
    });

    it("keeps the bare repository when neither tag nor digest is set", () => {
      const object = buildSwiftImage({ format: "raw", source: { oci: { repository: "ghcr.io/org/golden" } } });

      expect(SwiftImage.getSourceSummary(object)?.reference).toBe("ghcr.io/org/golden");
    });

    it("qualifies a PVC clone with its namespace only when it has one", () => {
      const sameNamespace = buildSwiftImage({ format: "raw", source: { pvcClone: { name: "golden" } } });
      const otherNamespace = buildSwiftImage({
        format: "raw",
        source: { pvcClone: { name: "golden", namespace: "images" } },
      });

      expect(SwiftImage.getSourceSummary(sameNamespace)?.reference).toBe("golden");
      expect(SwiftImage.getSourceSummary(otherNamespace)?.reference).toBe("images/golden");
    });

    it("reports the upload placeholder without a reference", () => {
      const object = buildSwiftImage({ format: "raw", source: { upload: {} } });

      expect(SwiftImage.getSourceSummary(object)).toEqual({ kind: "upload", title: "Upload" });
    });

    it("returns undefined when no source is set", () => {
      expect(SwiftImage.getSourceSummary(buildSwiftImage({ format: "raw", source: {} }))).toBeUndefined();
    });
  });

  describe("spec defaults", () => {
    it("returns the values set in the spec", () => {
      const object = buildSwiftImage({
        format: "qcow2",
        source: httpSource,
        cloneStrategy: "snapshot",
        osType: "windows",
      });

      expect(SwiftImage.getCloneStrategy(object)).toBe("snapshot");
      expect(SwiftImage.getOsType(object)).toBe("windows");
    });

    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftImage({ format: "qcow2", source: httpSource });

      expect(SwiftImage.getCloneStrategy(object)).toBe("copy");
      expect(SwiftImage.getOsType(object)).toBe("linux");
    });
  });

  describe("format readers", () => {
    it("prefers the measured formats from the status", () => {
      const object = buildSwiftImage(
        { format: "qcow2", source: httpSource },
        { sourceFormat: "raw", preparedFormat: "raw" },
      );

      expect(SwiftImage.getSourceFormat(object)).toBe("raw");
      expect(SwiftImage.getPreparedFormat(object)).toBe("raw");
    });

    it("falls back to the spec format and to the prepared artifact", () => {
      const object = buildSwiftImage({ format: "qcow2", source: httpSource }, { preparedArtifact: { format: "raw" } });

      expect(SwiftImage.getSourceFormat(object)).toBe("qcow2");
      expect(SwiftImage.getPreparedFormat(object)).toBe("raw");
    });
  });

  describe("status readers", () => {
    it("reads phase, prepared size and prepared PVC from the status", () => {
      const object = buildSwiftImage(
        { format: "qcow2", source: httpSource, rootDisk: { size: "40Gi" } },
        {
          phase: "Ready",
          preparedArtifact: { format: "raw", size: "38Gi", pvcRef: { name: "ubuntu-noble-import" } },
        },
      );

      expect(SwiftImage.getPhase(object)).toBe("Ready");
      expect(SwiftImage.getPreparedSize(object)).toBe("38Gi");
      expect(SwiftImage.getPreparedPvc(object)).toEqual({ name: "ubuntu-noble-import" });
      expect(SwiftImage.getRootDiskSize(object)).toBe("40Gi");
    });

    it("returns undefined on an image without status or root disk", () => {
      const object = buildSwiftImage({ format: "qcow2", source: httpSource });

      expect(SwiftImage.getPhase(object)).toBeUndefined();
      expect(SwiftImage.getPreparedSize(object)).toBeUndefined();
      expect(SwiftImage.getPreparedPvc(object)).toBeUndefined();
      expect(SwiftImage.getRootDiskSize(object)).toBeUndefined();
    });
  });

  describe("getCloneSeedSourceSize", () => {
    it("humanizes the clone seed's raw byte count", () => {
      const object = buildSwiftImage(
        { format: "qcow2", source: httpSource, cloneStrategy: "snapshot" },
        { cloneSeed: { kind: "VolumeSnapshot", name: "seed", namespace: "default", sourceSizeBytes: 10737418240 } },
      );

      expect(SwiftImage.getCloneSeedSourceSize(object)).toBe("10Gi");
    });

    it("returns undefined when there is no clone seed", () => {
      const object = buildSwiftImage({ format: "qcow2", source: httpSource });

      expect(SwiftImage.getCloneSeedSourceSize(object)).toBeUndefined();
    });
  });
});

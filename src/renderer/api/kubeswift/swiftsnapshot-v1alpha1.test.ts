import { describe, expect, it } from "vitest";
import { SwiftSnapshot } from "./swiftsnapshot-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftSnapshot (v1alpha1)", () => {
  const buildSwiftSnapshot = (spec: SwiftSnapshot["spec"], status?: SwiftSnapshot["status"]) =>
    new SwiftSnapshot({
      apiVersion: "snapshot.kubeswift.io/v1alpha1",
      kind: "SwiftSnapshot",
      metadata: {
        name: "nightly",
        namespace: "default",
        selfLink: "/apis/snapshot.kubeswift.io/v1alpha1/namespaces/default/swiftsnapshots/nightly",
      },
      spec,
      status,
    });

  const csiSpec: SwiftSnapshot["spec"] = {
    backend: { type: "csi-volume-snapshot" },
    guestRef: { name: "web-1" },
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftSnapshot.kind).toBe("SwiftSnapshot");
      expect(SwiftSnapshot.namespaced).toBe(true);
      expect(SwiftSnapshot.apiBase).toBe("/apis/snapshot.kubeswift.io/v1alpha1/swiftsnapshots");
      expect(SwiftSnapshot.crd).toMatchObject({
        apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
        plural: "swiftsnapshots",
        singular: "swiftsnapshot",
        shortNames: ["ssnap"],
      });
    });
  });

  describe("getPhase and getGuestName", () => {
    it("reads the phase from the status and the guest from the spec", () => {
      const object = buildSwiftSnapshot(csiSpec, { phase: "Ready" });

      expect(SwiftSnapshot.getPhase(object)).toBe("Ready");
      expect(SwiftSnapshot.getGuestName(object)).toBe("web-1");
    });

    it("returns undefined for a snapshot the controller has not seen yet", () => {
      expect(SwiftSnapshot.getPhase(buildSwiftSnapshot(csiSpec))).toBeUndefined();
    });

    it("treats an empty guest reference as unset", () => {
      const object = buildSwiftSnapshot({ ...csiSpec, guestRef: { name: "" } });

      expect(SwiftSnapshot.getGuestName(object)).toBeUndefined();
    });
  });

  describe("getContents", () => {
    // The schema documents the captured set as backend-determined rather than
    // driven by spec.includeMemory, which it calls a no-op on every backend.
    it("reports the CSI backend as disk-only, even with includeMemory set", () => {
      const object = buildSwiftSnapshot({ ...csiSpec, includeMemory: true });

      expect(SwiftSnapshot.getContents(object)).toBe("Disk");
    });

    it("reports the local and s3 backends as memory and disk", () => {
      const local = buildSwiftSnapshot({
        backend: { type: "local", local: { hostPath: "/var/lib/kubeswift" } },
        guestRef: { name: "web-1" },
        includeMemory: false,
      });
      const s3 = buildSwiftSnapshot({
        backend: { type: "s3", s3: { bucket: "snapshots" } },
        guestRef: { name: "web-1" },
      });

      expect(SwiftSnapshot.getContents(local)).toBe("Memory + disk");
      expect(SwiftSnapshot.getContents(s3)).toBe("Memory + disk");
    });

    it("reports the oci backend by whether the disk was captured alongside memory", () => {
      const memoryOnly = buildSwiftSnapshot({
        backend: { type: "oci", oci: { repository: "ghcr.io/org/snapshots" } },
        guestRef: { name: "web-1" },
      });
      const fullState = buildSwiftSnapshot({
        backend: { type: "oci", oci: { repository: "ghcr.io/org/snapshots" } },
        guestRef: { name: "web-1" },
        includeDisk: true,
      });

      expect(SwiftSnapshot.getContents(memoryOnly)).toBe("Memory");
      expect(SwiftSnapshot.getContents(fullState)).toBe("Memory + disk");
    });

    it("treats an unknown or missing backend as opaque", () => {
      const object = buildSwiftSnapshot({ guestRef: { name: "web-1" } } as SwiftSnapshot["spec"]);

      expect(SwiftSnapshot.getContents(object)).toBeUndefined();
      expect(SwiftSnapshot.getBackendType(object)).toBeUndefined();
    });
  });

  describe("sizes", () => {
    it("renders the byte counts of the status as Kubernetes quantities", () => {
      const object = buildSwiftSnapshot(csiSpec, {
        totalSizeBytes: 22548578304,
        memorySnapshot: { handle: "memory.bin", sizeBytes: 4294967296 },
      });

      expect(SwiftSnapshot.getTotalSize(object)).toBe("21Gi");
      expect(SwiftSnapshot.getMemorySnapshotSize(object)).toBe("4Gi");
    });

    it("keeps a zero size and leaves an unset one undefined", () => {
      expect(SwiftSnapshot.getTotalSize(buildSwiftSnapshot(csiSpec, { totalSizeBytes: 0 }))).toBe("0");
      expect(SwiftSnapshot.getTotalSize(buildSwiftSnapshot(csiSpec))).toBeUndefined();
      expect(SwiftSnapshot.getMemorySnapshotSize(buildSwiftSnapshot(csiSpec))).toBeUndefined();
    });
  });

  describe("getArtifactLocation", () => {
    it("prefers the OCI reference the push recorded", () => {
      const object = buildSwiftSnapshot(
        { backend: { type: "oci", oci: { repository: "ghcr.io/org/snapshots" } }, guestRef: { name: "web-1" } },
        { oci: { reference: "ghcr.io/org/snapshots:default-nightly", manifestDigest: "sha256:abc" } },
      );

      expect(SwiftSnapshot.getArtifactLocation(object)).toEqual({
        title: "OCI artifact",
        reference: "ghcr.io/org/snapshots:default-nightly",
      });
    });

    it("falls back to the S3 location and to the local host path", () => {
      const s3 = buildSwiftSnapshot(
        { backend: { type: "s3", s3: { bucket: "snapshots" } }, guestRef: { name: "web-1" } },
        { s3: { location: "s3://snapshots/default/nightly/" } },
      );
      const local = buildSwiftSnapshot({
        backend: { type: "local", local: { hostPath: "/var/lib/kubeswift/snapshots" } },
        guestRef: { name: "web-1" },
      });

      expect(SwiftSnapshot.getArtifactLocation(s3)).toEqual({
        title: "S3 location",
        reference: "s3://snapshots/default/nightly/",
      });
      expect(SwiftSnapshot.getArtifactLocation(local)).toEqual({
        title: "Host path",
        reference: "/var/lib/kubeswift/snapshots",
      });
    });

    it("returns undefined for a CSI snapshot, whose artifacts are VolumeSnapshots", () => {
      expect(SwiftSnapshot.getArtifactLocation(buildSwiftSnapshot(csiSpec))).toBeUndefined();
    });
  });

  describe("getDisks", () => {
    it("returns the captured disks of the status", () => {
      const object = buildSwiftSnapshot(csiSpec, {
        disks: [{ role: "root", handle: "default/snap-root", sizeBytes: 21474836480 }],
      });

      expect(SwiftSnapshot.getDisks(object)).toHaveLength(1);
    });

    it("returns an empty list when nothing was captured yet", () => {
      expect(SwiftSnapshot.getDisks(buildSwiftSnapshot(csiSpec))).toEqual([]);
    });
  });

  describe("spec defaults", () => {
    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftSnapshot(csiSpec);

      expect(SwiftSnapshot.getDeletionPolicy(object)).toBe("Delete");
      expect(SwiftSnapshot.getIncludeMemory(object)).toBe(true);
      expect(SwiftSnapshot.getResumeAfterSnapshot(object)).toBe(true);
    });

    it("returns the values set in the spec", () => {
      const object = buildSwiftSnapshot({
        ...csiSpec,
        deletionPolicy: "Retain",
        includeMemory: false,
        resumeAfterSnapshot: false,
      });

      expect(SwiftSnapshot.getDeletionPolicy(object)).toBe("Retain");
      expect(SwiftSnapshot.getIncludeMemory(object)).toBe(false);
      expect(SwiftSnapshot.getResumeAfterSnapshot(object)).toBe(false);
    });
  });
});

import { describe, expect, it } from "vitest";
import { SwiftRestore } from "./swiftrestore-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftRestore (v1alpha1)", () => {
  const buildSwiftRestore = (spec: SwiftRestore["spec"], status?: SwiftRestore["status"]) =>
    new SwiftRestore({
      apiVersion: "snapshot.kubeswift.io/v1alpha1",
      kind: "SwiftRestore",
      metadata: {
        name: "restore-web-1",
        namespace: "default",
        selfLink: "/apis/snapshot.kubeswift.io/v1alpha1/namespaces/default/swiftrestores/restore-web-1",
      },
      spec,
      status,
    });

  const cloneSpec: SwiftRestore["spec"] = {
    snapshotRef: { name: "nightly" },
    targetGuest: { name: "web-2" },
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftRestore.kind).toBe("SwiftRestore");
      expect(SwiftRestore.namespaced).toBe(true);
      expect(SwiftRestore.apiBase).toBe("/apis/snapshot.kubeswift.io/v1alpha1/swiftrestores");
      expect(SwiftRestore.crd).toMatchObject({
        apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
        plural: "swiftrestores",
        singular: "swiftrestore",
        shortNames: ["srst"],
      });
    });
  });

  describe("references", () => {
    it("reads the snapshot and the target guest from the spec", () => {
      const object = buildSwiftRestore(cloneSpec, { phase: "Restoring" });

      expect(SwiftRestore.getPhase(object)).toBe("Restoring");
      expect(SwiftRestore.getSnapshotName(object)).toBe("nightly");
      expect(SwiftRestore.getTargetGuestName(object)).toBe("web-2");
    });

    it("treats empty references as unset", () => {
      const object = buildSwiftRestore({ snapshotRef: { name: "" }, targetGuest: { name: "" } });

      expect(SwiftRestore.getSnapshotName(object)).toBeUndefined();
      expect(SwiftRestore.getTargetGuestName(object)).toBeUndefined();
    });

    it("returns undefined for a restore the controller has not seen yet", () => {
      const object = buildSwiftRestore(cloneSpec);

      expect(SwiftRestore.getPhase(object)).toBeUndefined();
      expect(SwiftRestore.getRestoredGuestName(object)).toBeUndefined();
    });

    it("reads the guest the restore produced from the status", () => {
      const object = buildSwiftRestore(cloneSpec, { phase: "Ready", guestRef: { name: "web-2" } });

      expect(SwiftRestore.getRestoredGuestName(object)).toBe("web-2");
    });
  });

  describe("link targets", () => {
    it("builds same-namespace link targets for the snapshot and the target guest", () => {
      const object = buildSwiftRestore(cloneSpec);

      expect(SwiftRestore.getSnapshotRef(object)).toEqual({
        apiVersion: "snapshot.kubeswift.io/v1alpha1",
        kind: "SwiftSnapshot",
        name: "nightly",
        namespace: "default",
      });
      expect(SwiftRestore.getTargetGuestRef(object)).toEqual({
        apiVersion: "swift.kubeswift.io/v1alpha1",
        kind: "SwiftGuest",
        name: "web-2",
        namespace: "default",
      });
    });

    it("builds a link target for the restored guest once the status reports one", () => {
      const object = buildSwiftRestore(cloneSpec, { phase: "Ready", guestRef: { name: "web-2" } });

      expect(SwiftRestore.getRestoredGuestRef(object)).toEqual({
        apiVersion: "swift.kubeswift.io/v1alpha1",
        kind: "SwiftGuest",
        name: "web-2",
        namespace: "default",
      });
    });

    it("returns undefined for absent references", () => {
      const object = buildSwiftRestore({ snapshotRef: { name: "" }, targetGuest: { name: "" } });

      expect(SwiftRestore.getSnapshotRef(object)).toBeUndefined();
      expect(SwiftRestore.getTargetGuestRef(object)).toBeUndefined();
      expect(SwiftRestore.getRestoredGuestRef(object)).toBeUndefined();
    });
  });

  describe("getTargetMode", () => {
    // The schema requires overwriteExisting to restore over a guest that
    // already exists at the target name; anything else creates a new guest.
    it("reports a restore over an existing guest as in-place", () => {
      const object = buildSwiftRestore({
        snapshotRef: { name: "nightly" },
        targetGuest: { name: "web-1", overwriteExisting: true },
      });

      expect(SwiftRestore.getTargetMode(object)).toBe("In-place");
    });

    it("reports a restore into a new guest as a clone", () => {
      expect(SwiftRestore.getTargetMode(buildSwiftRestore(cloneSpec))).toBe("Clone");
      expect(
        SwiftRestore.getTargetMode(
          buildSwiftRestore({
            snapshotRef: { name: "nightly" },
            targetGuest: { name: "web-2", overwriteExisting: false },
          }),
        ),
      ).toBe("Clone");
    });
  });

  describe("getDownloadedSize", () => {
    it("renders the downloaded byte count as a Kubernetes quantity", () => {
      const object = buildSwiftRestore(cloneSpec, { downloadedBytes: 5368709120 });

      expect(SwiftRestore.getDownloadedSize(object)).toBe("5Gi");
    });

    it("returns undefined for the backends that download nothing", () => {
      expect(SwiftRestore.getDownloadedSize(buildSwiftRestore(cloneSpec))).toBeUndefined();
    });
  });

  describe("getRegeneratedIdentity", () => {
    it("returns the identity attributes the restore resets", () => {
      const object = buildSwiftRestore({
        ...cloneSpec,
        identity: { regenerate: ["hostname", "machineId"] },
      });

      expect(SwiftRestore.getRegeneratedIdentity(object)).toEqual(["hostname", "machineId"]);
    });

    it("returns an empty list when the restore inherits the source identity", () => {
      expect(SwiftRestore.getRegeneratedIdentity(buildSwiftRestore(cloneSpec))).toEqual([]);
    });
  });

  describe("spec defaults", () => {
    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftRestore(cloneSpec);

      expect(SwiftRestore.getMemoryRestoreMode(object)).toBe("copy");
      expect(SwiftRestore.getResumeAfterRestore(object)).toBe(true);
    });

    it("returns the values set in the spec", () => {
      const object = buildSwiftRestore({
        ...cloneSpec,
        memoryRestoreMode: "ondemand",
        resumeAfterRestore: false,
      });

      expect(SwiftRestore.getMemoryRestoreMode(object)).toBe("ondemand");
      expect(SwiftRestore.getResumeAfterRestore(object)).toBe(false);
    });
  });
});

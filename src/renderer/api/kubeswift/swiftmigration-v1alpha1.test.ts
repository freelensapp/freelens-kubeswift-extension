import { describe, expect, it } from "vitest";
import { SwiftMigration } from "./swiftmigration-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftMigration (v1alpha1)", () => {
  const buildSwiftMigration = (spec: SwiftMigration["spec"], status?: SwiftMigration["status"]) =>
    new SwiftMigration({
      apiVersion: "migration.kubeswift.io/v1alpha1",
      kind: "SwiftMigration",
      metadata: {
        name: "move-web-1",
        namespace: "default",
        selfLink: "/apis/migration.kubeswift.io/v1alpha1/namespaces/default/swiftmigrations/move-web-1",
      },
      spec,
      status,
    });

  const baseSpec: SwiftMigration["spec"] = {
    guestRef: { name: "web-1" },
    target: { nodeName: "node-b" },
  };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftMigration.kind).toBe("SwiftMigration");
      expect(SwiftMigration.namespaced).toBe(true);
      expect(SwiftMigration.apiBase).toBe("/apis/migration.kubeswift.io/v1alpha1/swiftmigrations");
      expect(SwiftMigration.crd).toMatchObject({
        apiVersions: ["migration.kubeswift.io/v1alpha1"],
        plural: "swiftmigrations",
        singular: "swiftmigration",
        shortNames: ["smig"],
      });
    });

    it("is the only model of this milestone outside the snapshot group", () => {
      expect(SwiftMigration.crd.apiVersions[0]).toMatch(/^migration\.kubeswift\.io\//);
    });
  });

  describe("getPhase and getGuestName", () => {
    it("reads the phase from the status and the guest from the spec", () => {
      const object = buildSwiftMigration(baseSpec, { phase: "Completed" });

      expect(SwiftMigration.getPhase(object)).toBe("Completed");
      expect(SwiftMigration.getGuestName(object)).toBe("web-1");
    });

    it("returns undefined for a migration the controller has not seen yet", () => {
      expect(SwiftMigration.getPhase(buildSwiftMigration(baseSpec))).toBeUndefined();
    });

    it("treats an empty guest reference as unset", () => {
      const object = buildSwiftMigration({ guestRef: { name: "" }, target: {} });

      expect(SwiftMigration.getGuestName(object)).toBeUndefined();
    });
  });

  describe("getMode", () => {
    // The controller resolves `auto` and writes the outcome to the status, so
    // the resolved mode is what an operator needs to see.
    it("prefers the mode the controller resolved", () => {
      const object = buildSwiftMigration({ ...baseSpec, mode: "auto" }, { mode: "offline" });

      expect(SwiftMigration.getMode(object)).toBe("offline");
      expect(SwiftMigration.getRequestedMode(object)).toBe("auto");
    });

    it("falls back to the requested mode before the first reconciliation", () => {
      const object = buildSwiftMigration({ ...baseSpec, mode: "live" });

      expect(SwiftMigration.getMode(object)).toBe("live");
    });

    it("falls back to the CRD default when neither is set", () => {
      const object = buildSwiftMigration(baseSpec);

      expect(SwiftMigration.getMode(object)).toBe("auto");
      expect(SwiftMigration.getRequestedMode(object)).toBe("auto");
    });
  });

  describe("nodes", () => {
    it("reads the source and destination nodes from the status", () => {
      const object = buildSwiftMigration(baseSpec, { sourceNode: "node-a", destinationNode: "node-b" });

      expect(SwiftMigration.getSourceNode(object)).toBe("node-a");
      expect(SwiftMigration.getDestinationNode(object)).toBe("node-b");
    });

    // Before the webhook resolves it, the requested target is all there is.
    it("falls back to the requested target node for the destination", () => {
      const object = buildSwiftMigration(baseSpec);

      expect(SwiftMigration.getDestinationNode(object)).toBe("node-b");
      expect(SwiftMigration.getSourceNode(object)).toBeUndefined();
    });

    it("returns undefined when the target is a node selector", () => {
      const object = buildSwiftMigration({
        guestRef: { name: "web-1" },
        target: { nodeSelector: { "topology.kubernetes.io/zone": "eu-west-1a" } },
      });

      expect(SwiftMigration.getDestinationNode(object)).toBeUndefined();
    });
  });

  describe("progress", () => {
    it("renders the pre-copy estimate as a percentage", () => {
      const object = buildSwiftMigration(baseSpec, { phase: "StopAndCopy", transferProgress: 64 });

      expect(SwiftMigration.getTransferProgress(object)).toBe(64);
      expect(SwiftMigration.getProgressLabel(object)).toBe("64%");
    });

    it("keeps a zero estimate, which is not the same as no estimate", () => {
      expect(SwiftMigration.getProgressLabel(buildSwiftMigration(baseSpec, { transferProgress: 0 }))).toBe("0%");
    });

    // Offline migrations have no memory stream, so they never report progress.
    it("returns undefined when the migration reports no progress", () => {
      const object = buildSwiftMigration(baseSpec, { phase: "Completed", mode: "offline" });

      expect(SwiftMigration.getTransferProgress(object)).toBeUndefined();
      expect(SwiftMigration.getProgressLabel(object)).toBeUndefined();
    });
  });

  describe("getFailure", () => {
    it("returns the reason and the message of a terminal failure", () => {
      const object = buildSwiftMigration(baseSpec, {
        phase: "Failed",
        failureReason: "DstNeverReady",
        failureMessage: "The destination pod never reached receive-ready.",
      });

      expect(SwiftMigration.getFailure(object)).toEqual({
        reason: "DstNeverReady",
        message: "The destination pod never reached receive-ready.",
      });
    });

    it("returns the reason alone when the offline path sets no message", () => {
      const object = buildSwiftMigration(baseSpec, { phase: "Cancelled", failureReason: "Cancelled" });

      expect(SwiftMigration.getFailure(object)).toEqual({ reason: "Cancelled", message: undefined });
    });

    it("returns undefined for a migration that did not fail", () => {
      expect(SwiftMigration.getFailure(buildSwiftMigration(baseSpec, { phase: "Completed" }))).toBeUndefined();
      expect(SwiftMigration.getFailure(buildSwiftMigration(baseSpec))).toBeUndefined();
    });
  });

  describe("spec defaults", () => {
    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftMigration(baseSpec);

      expect(SwiftMigration.getTimeout(object)).toBe("30m0s");
      expect(SwiftMigration.getTimeoutStrategy(object)).toBe("cancel");
    });

    it("returns the values set in the spec", () => {
      const object = buildSwiftMigration({ ...baseSpec, timeout: "5m0s", timeoutStrategy: "ignore" });

      expect(SwiftMigration.getTimeout(object)).toBe("5m0s");
      expect(SwiftMigration.getTimeoutStrategy(object)).toBe("ignore");
    });
  });
});

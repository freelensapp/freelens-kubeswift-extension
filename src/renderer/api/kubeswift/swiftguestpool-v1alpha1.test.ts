import { describe, expect, it } from "vitest";
import { SwiftGuestPool } from "./swiftguestpool-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftGuestPool (v1alpha1)", () => {
  const buildSwiftGuestPool = (spec: SwiftGuestPool["spec"], status?: SwiftGuestPool["status"]) =>
    new SwiftGuestPool({
      apiVersion: "swift.kubeswift.io/v1alpha1",
      kind: "SwiftGuestPool",
      metadata: {
        name: "web",
        namespace: "default",
        selfLink: "/apis/swift.kubeswift.io/v1alpha1/namespaces/default/swiftguestpools/web",
      },
      spec,
      status,
    });

  const template = { spec: { guestClassRef: { name: "small" }, imageRef: { name: "ubuntu" } } };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftGuestPool.kind).toBe("SwiftGuestPool");
      expect(SwiftGuestPool.namespaced).toBe(true);
      expect(SwiftGuestPool.apiBase).toBe("/apis/swift.kubeswift.io/v1alpha1/swiftguestpools");
      expect(SwiftGuestPool.crd).toMatchObject({
        apiVersions: ["swift.kubeswift.io/v1alpha1"],
        plural: "swiftguestpools",
        singular: "swiftguestpool",
        shortNames: ["sgpool"],
      });
    });
  });

  describe("replica counters", () => {
    it("reads every replica count from the status", () => {
      const object = buildSwiftGuestPool(
        { replicas: 5, template },
        { replicas: 4, readyReplicas: 3, updatedReplicas: 2, availableReplicas: 3, failedReplicas: 1 },
      );

      expect(SwiftGuestPool.getDesiredReplicas(object)).toBe(5);
      expect(SwiftGuestPool.getCurrentReplicas(object)).toBe(4);
      expect(SwiftGuestPool.getReadyReplicas(object)).toBe(3);
      expect(SwiftGuestPool.getUpdatedReplicas(object)).toBe(2);
      expect(SwiftGuestPool.getAvailableReplicas(object)).toBe(3);
      expect(SwiftGuestPool.getFailedReplicas(object)).toBe(1);
    });

    it("reports zero for every counter on a pool without status", () => {
      const object = buildSwiftGuestPool({ replicas: 2, template });

      expect(SwiftGuestPool.getCurrentReplicas(object)).toBe(0);
      expect(SwiftGuestPool.getReadyReplicas(object)).toBe(0);
      expect(SwiftGuestPool.getUpdatedReplicas(object)).toBe(0);
      expect(SwiftGuestPool.getAvailableReplicas(object)).toBe(0);
      expect(SwiftGuestPool.getFailedReplicas(object)).toBe(0);
    });

    it("falls back to the CRD default when the desired count is not set", () => {
      const object = buildSwiftGuestPool({ template } as SwiftGuestPool["spec"]);

      expect(SwiftGuestPool.getDesiredReplicas(object)).toBe(1);
    });
  });

  describe("rollout settings", () => {
    it("returns the values set in the spec", () => {
      const object = buildSwiftGuestPool({
        replicas: 3,
        template,
        spreadPolicy: "Spread",
        updateStrategy: { type: "Recreate" },
      });

      expect(SwiftGuestPool.getUpdateStrategyType(object)).toBe("Recreate");
      expect(SwiftGuestPool.getSpreadPolicy(object)).toBe("Spread");
    });

    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftGuestPool({ replicas: 3, template });

      expect(SwiftGuestPool.getUpdateStrategyType(object)).toBe("RollingUpdate");
      expect(SwiftGuestPool.getSpreadPolicy(object)).toBe("Pack");
    });
  });

  describe("getGuestTemplateSpec", () => {
    it("returns the SwiftGuest spec every replica is created from", () => {
      const object = buildSwiftGuestPool({ replicas: 1, template });

      expect(SwiftGuestPool.getGuestTemplateSpec(object)).toEqual({
        guestClassRef: { name: "small" },
        imageRef: { name: "ubuntu" },
      });
    });

    it("returns undefined when the pool carries no template", () => {
      const object = buildSwiftGuestPool({ replicas: 1 } as SwiftGuestPool["spec"]);

      expect(SwiftGuestPool.getGuestTemplateSpec(object)).toBeUndefined();
    });
  });

  describe("getServiceName", () => {
    it("returns the name of the Service the pool created", () => {
      const object = buildSwiftGuestPool({ replicas: 1, template }, { serviceRef: "web-pool" });

      expect(SwiftGuestPool.getServiceName(object)).toBe("web-pool");
    });

    it("treats the empty reference as no Service", () => {
      const object = buildSwiftGuestPool({ replicas: 1, template }, { serviceRef: "" });

      expect(SwiftGuestPool.getServiceName(object)).toBeUndefined();
    });

    it("returns undefined when the pool has no status", () => {
      expect(SwiftGuestPool.getServiceName(buildSwiftGuestPool({ replicas: 1, template }))).toBeUndefined();
    });
  });

  describe("collection readers", () => {
    it("returns the service ports and the volume claim templates of the spec", () => {
      const object = buildSwiftGuestPool({
        replicas: 1,
        template,
        service: { ports: [{ port: 80, protocol: "TCP" }] },
        volumeClaimTemplates: [{ metadata: { name: "data" }, spec: { resources: { requests: { storage: "10Gi" } } } }],
      });

      expect(SwiftGuestPool.getServicePorts(object)).toEqual([{ port: 80, protocol: "TCP" }]);
      expect(SwiftGuestPool.getVolumeClaimTemplates(object)).toHaveLength(1);
    });

    it("returns empty collections when the spec sets neither", () => {
      const object = buildSwiftGuestPool({ replicas: 1, template });

      expect(SwiftGuestPool.getServicePorts(object)).toEqual([]);
      expect(SwiftGuestPool.getVolumeClaimTemplates(object)).toEqual([]);
    });
  });
});

import { describe, expect, it } from "vitest";
import { SwiftSnapshotSchedule } from "./swiftsnapshotschedule-v1alpha1";

// The model only exposes `static` helpers: instance methods are not available
// at runtime because the host passes plain object copies around, so the helpers
// take the object as their first argument and read the typed `spec`/`status`.
describe("SwiftSnapshotSchedule (v1alpha1)", () => {
  const buildSwiftSnapshotSchedule = (spec: SwiftSnapshotSchedule["spec"], status?: SwiftSnapshotSchedule["status"]) =>
    new SwiftSnapshotSchedule({
      apiVersion: "snapshot.kubeswift.io/v1alpha1",
      kind: "SwiftSnapshotSchedule",
      metadata: {
        name: "nightly",
        namespace: "default",
        selfLink: "/apis/snapshot.kubeswift.io/v1alpha1/namespaces/default/swiftsnapshotschedules/nightly",
      },
      spec,
      status,
    });

  const template = {
    spec: {
      backend: { type: "csi-volume-snapshot" as const },
      guestRef: { name: "web-1" },
    },
  };

  const dailySpec: SwiftSnapshotSchedule["spec"] = { schedule: "0 2 * * *", template };

  describe("crd", () => {
    it("matches the published CustomResourceDefinition names", () => {
      expect(SwiftSnapshotSchedule.kind).toBe("SwiftSnapshotSchedule");
      expect(SwiftSnapshotSchedule.namespaced).toBe(true);
      expect(SwiftSnapshotSchedule.apiBase).toBe("/apis/snapshot.kubeswift.io/v1alpha1/swiftsnapshotschedules");
      expect(SwiftSnapshotSchedule.crd).toMatchObject({
        apiVersions: ["snapshot.kubeswift.io/v1alpha1"],
        plural: "swiftsnapshotschedules",
        singular: "swiftsnapshotschedule",
        shortNames: ["sss"],
      });
    });
  });

  describe("getSchedule and getGuestName", () => {
    it("reads the cron expression and the guest of the snapshot template", () => {
      const object = buildSwiftSnapshotSchedule(dailySpec);

      expect(SwiftSnapshotSchedule.getSchedule(object)).toBe("0 2 * * *");
      expect(SwiftSnapshotSchedule.getGuestName(object)).toBe("web-1");
    });

    it("returns undefined when the schedule carries no template", () => {
      const object = buildSwiftSnapshotSchedule({ schedule: "0 2 * * *" } as SwiftSnapshotSchedule["spec"]);

      expect(SwiftSnapshotSchedule.getGuestName(object)).toBeUndefined();
      expect(SwiftSnapshotSchedule.getSnapshotTemplateSpec(object)).toBeUndefined();
    });

    it("treats an empty cron expression as unset", () => {
      const object = buildSwiftSnapshotSchedule({ schedule: "", template });

      expect(SwiftSnapshotSchedule.getSchedule(object)).toBeUndefined();
    });
  });

  describe("getSnapshotTemplateSpec", () => {
    it("returns the SwiftSnapshot spec every tick instantiates", () => {
      const object = buildSwiftSnapshotSchedule(dailySpec);

      expect(SwiftSnapshotSchedule.getSnapshotTemplateSpec(object)).toEqual({
        backend: { type: "csi-volume-snapshot" },
        guestRef: { name: "web-1" },
      });
    });
  });

  describe("getKeepLast", () => {
    it("returns the retention budget when the schedule sets one", () => {
      const object = buildSwiftSnapshotSchedule({ ...dailySpec, retention: { keepLast: 7 } });

      expect(SwiftSnapshotSchedule.getKeepLast(object)).toBe(7);
    });

    // Unset means keep every Ready snapshot, which has no numeric answer: the
    // page renders it as "All".
    it("returns undefined when the schedule keeps every snapshot", () => {
      expect(SwiftSnapshotSchedule.getKeepLast(buildSwiftSnapshotSchedule(dailySpec))).toBeUndefined();
      expect(
        SwiftSnapshotSchedule.getKeepLast(buildSwiftSnapshotSchedule({ ...dailySpec, retention: {} })),
      ).toBeUndefined();
    });
  });

  describe("spec defaults", () => {
    it("falls back to the CRD defaults when the fields are not set", () => {
      const object = buildSwiftSnapshotSchedule(dailySpec);

      expect(SwiftSnapshotSchedule.isSuspended(object)).toBe(false);
      expect(SwiftSnapshotSchedule.getConcurrencyPolicy(object)).toBe("Forbid");
    });

    it("returns the values set in the spec", () => {
      const object = buildSwiftSnapshotSchedule({ ...dailySpec, suspend: true, concurrencyPolicy: "Allow" });

      expect(SwiftSnapshotSchedule.isSuspended(object)).toBe(true);
      expect(SwiftSnapshotSchedule.getConcurrencyPolicy(object)).toBe("Allow");
    });
  });

  describe("status readers", () => {
    it("reads the tick times and the in-flight snapshots from the status", () => {
      const object = buildSwiftSnapshotSchedule(dailySpec, {
        lastScheduleTime: "2026-08-27T02:00:00Z",
        lastSuccessfulTime: "2026-08-26T02:04:12Z",
        active: ["nightly-28160520"],
      });

      expect(SwiftSnapshotSchedule.getLastScheduleTime(object)).toBe("2026-08-27T02:00:00Z");
      expect(SwiftSnapshotSchedule.getLastSuccessfulTime(object)).toBe("2026-08-26T02:04:12Z");
      expect(SwiftSnapshotSchedule.getActiveSnapshots(object)).toEqual(["nightly-28160520"]);
    });

    it("reports nothing for a schedule that has not ticked yet", () => {
      const object = buildSwiftSnapshotSchedule(dailySpec);

      expect(SwiftSnapshotSchedule.getLastScheduleTime(object)).toBeUndefined();
      expect(SwiftSnapshotSchedule.getLastSuccessfulTime(object)).toBeUndefined();
      expect(SwiftSnapshotSchedule.getActiveSnapshots(object)).toEqual([]);
    });
  });
});

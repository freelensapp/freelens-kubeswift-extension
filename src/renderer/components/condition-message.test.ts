import { describe, expect, it } from "vitest";
import { conditionMessage } from "./condition-message";

// The ladder itself, moved here from `sandbox-status.test.ts` when M5 extracted
// the selector into its own module (SPEC-0009). The cases are the M4 ones,
// rewritten to call `conditionMessage` directly rather than through
// `sandboxMessage`, since the module they now live in knows nothing about a
// sandbox; that they still pass unchanged is half of the non-regression proof
// of the extraction, and `sandbox-status.test.ts` staying green is the other.
//
// The rungs, in order: the controller's own `status.message`, then the newest
// condition reporting a problem, then the newest condition of any kind, then
// `undefined` so each caller's classifier explanation can take over.
describe("conditionMessage", () => {
  it("prefers the controller's own status message", () => {
    expect(
      conditionMessage({
        message: "Claimed a warm slot from pool warm-runners.",
        conditions: [
          {
            type: "GuestRunning",
            status: "True",
            message: "The guest is running.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("Claimed a warm slot from pool warm-runners.");
  });

  it("lets a problem being reported outrank a more recent success", () => {
    // The second rung: the newest condition is the True one, but the False one
    // is what the operator needs to read.
    expect(
      conditionMessage({
        conditions: [
          {
            type: "RootfsReady",
            status: "False",
            message: "Pulling the image failed: unauthorized.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
          {
            type: "Resolved",
            status: "True",
            message: "The kernel profile was resolved.",
            lastTransitionTime: "2026-08-28T10:05:00Z",
          },
        ],
      }),
    ).toBe("Pulling the image failed: unauthorized.");
  });

  it("picks the newest of several conditions that are all reporting a problem", () => {
    expect(
      conditionMessage({
        conditions: [
          {
            type: "Resolved",
            status: "False",
            message: "The kernel profile is missing.",
            lastTransitionTime: "2026-08-28T09:00:00Z",
          },
          {
            type: "ScratchDiskReady",
            status: "Unknown",
            message: "The scratch PVC is still pending.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("The scratch PVC is still pending.");
  });

  it("falls back to the newest condition when every one of them is True", () => {
    expect(
      conditionMessage({
        conditions: [
          {
            type: "Resolved",
            status: "True",
            message: "The kernel profile was resolved.",
            lastTransitionTime: "2026-08-28T09:00:00Z",
          },
          {
            type: "GuestRunning",
            status: "True",
            message: "The guest is running.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("The guest is running.");
  });

  it("selects a condition type this extension has never heard of on its merits", () => {
    // The selector hardcodes no condition type on purpose: most of the
    // documented ones are documentation, not API, so one more must work with no
    // code change.
    expect(
      conditionMessage({
        conditions: [
          {
            type: "SnapshotRestored",
            status: "False",
            message: "A brand new condition nobody has seen before.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("A brand new condition nobody has seen before.");
  });

  it("returns undefined when the controller has written nothing", () => {
    for (const status of [undefined, {}, { conditions: [] }]) {
      expect(conditionMessage(status)).toBeUndefined();
    }
  });

  it("skips a condition whose message is empty", () => {
    // `metav1.Condition` allows an empty message, and a blank Status column is
    // the one outcome this ladder exists to avoid: the caller falls back to its
    // classifier's explanation instead.
    expect(
      conditionMessage({
        message: "",
        conditions: [
          { type: "GuestRunning", status: "False", message: "", lastTransitionTime: "2026-08-28T10:00:00Z" },
        ],
      }),
    ).toBeUndefined();
  });

  it("treats a condition with an unparseable timestamp as the oldest one", () => {
    expect(
      conditionMessage({
        conditions: [
          { type: "Resolved", status: "False", message: "No timestamp at all.", lastTransitionTime: "" },
          {
            type: "RootfsReady",
            status: "False",
            message: "Dated, and therefore newer.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("Dated, and therefore newer.");
  });

  it("reads a status that has no message property at all", () => {
    // The shape the fleet Cluster CRD gives it, and the reason the extraction
    // is safe: that status declares conditions and no top-level message, so the
    // ladder's first rung is structurally absent and the selector starts at the
    // second one with no code change (SPEC-0009).
    const status: { conditions: { type: string; status: string; message: string; lastTransitionTime: string }[] } = {
      conditions: [
        {
          type: "Reachable",
          status: "False",
          message: "dial tcp 10.10.0.9:6443: i/o timeout",
          lastTransitionTime: "2026-08-29T08:40:00Z",
        },
        {
          type: "Ready",
          status: "False",
          message: "The gateway has no healthy client for this member.",
          lastTransitionTime: "2026-08-29T08:20:00Z",
        },
      ],
    };

    expect(conditionMessage(status)).toBe("dial tcp 10.10.0.9:6443: i/o timeout");
  });
});

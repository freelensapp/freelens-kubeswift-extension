import { describe, expect, it } from "vitest";
import { classifySandbox, conditionMessage, sandboxMessage, sandboxStates } from "./sandbox-status";

// One case per row of the SPEC-0008 classifier table, plus the two cases that
// keep an unexpected cluster from breaking a view: a phase this extension does
// not know, and a sandbox with no status at all.
describe("classifySandbox", () => {
  it("reports a running sandbox as healthy", () => {
    const condition = classifySandbox({ phase: "Running" });

    expect(condition.state).toBe(sandboxStates.running);
    expect(condition.className).toBe("success");
  });

  it("reports a completed sandbox as a success, the same class as a running one", () => {
    // The judgement call recorded in SPEC-0008: a sandbox that did its job and
    // finished is not a warning, and the badge word carries the difference.
    const condition = classifySandbox({ phase: "Completed", exitCode: 0 });

    expect(condition.state).toBe(sandboxStates.completed);
    expect(condition.className).toBe("success");
    expect(condition.explanation).toContain("exit code 0");
  });

  it("reports a materializing sandbox as a warning", () => {
    const condition = classifySandbox({ phase: "Materializing" });

    expect(condition.state).toBe(sandboxStates.materializing);
    expect(condition.className).toBe("warning");
  });

  it("reports a pending sandbox as a warning", () => {
    const condition = classifySandbox({ phase: "Pending" });

    expect(condition.state).toBe(sandboxStates.pending);
    expect(condition.className).toBe("warning");
  });

  it("reports a failed sandbox as an error, with the exit code in the explanation", () => {
    const condition = classifySandbox({ phase: "Failed", exitCode: 137 });

    expect(condition.state).toBe(sandboxStates.failed);
    expect(condition.className).toBe("error");
    expect(condition.explanation).toContain("exit code 137");
  });

  it("reports a sandbox with no phase at all as unknown", () => {
    for (const status of [undefined, {}]) {
      const condition = classifySandbox(status);

      expect(condition.state).toBe(sandboxStates.unknown);
      expect(condition.className).toBe("info");
    }
  });

  it("passes an unrecognized phase through opaquely", () => {
    const condition = classifySandbox({ phase: "Evicted" });

    expect(condition.state).toBe("Evicted");
    expect(condition.className).toBe("info");
    expect(condition.explanation).toContain("Evicted");
  });

  it("keeps the exit code out of the verdict, even when the two contradict each other", () => {
    // A Completed sandbox with a non-zero exit contradicts the documented rule
    // that a non-zero exit is what makes a sandbox Failed. Both facts are shown;
    // no third state is invented (SPEC-0008).
    const condition = classifySandbox({ phase: "Completed", exitCode: 3 });

    expect(condition.state).toBe(sandboxStates.completed);
    expect(condition.className).toBe("success");
    expect(condition.explanation).toContain("exit code 3");
  });
});

describe("sandboxMessage", () => {
  it("prefers the controller's own status message", () => {
    expect(
      sandboxMessage({
        phase: "Running",
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
      sandboxMessage({
        phase: "Materializing",
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
      sandboxMessage({
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
      sandboxMessage({
        phase: "Running",
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
    // The selector hardcodes no condition type on purpose: the documented ones
    // are documentation, not API, so a sixth one must work with no code change.
    expect(
      sandboxMessage({
        phase: "Running",
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

  it("falls back to the classifier's explanation when the controller has written nothing", () => {
    expect(sandboxMessage({ phase: "Pending" })).toBe(classifySandbox({ phase: "Pending" }).explanation);
    expect(sandboxMessage(undefined)).toBe(classifySandbox(undefined).explanation);
  });

  it("never returns an empty string, whatever the conditions carry", () => {
    // `metav1.Condition` allows an empty message, and a blank Status column is
    // the one outcome this ladder exists to avoid.
    const status = {
      phase: "Running",
      message: "",
      conditions: [{ type: "GuestRunning", status: "False", message: "", lastTransitionTime: "2026-08-28T10:00:00Z" }],
    };

    expect(conditionMessage(status)).toBeUndefined();
    expect(sandboxMessage(status)).toBe(classifySandbox(status).explanation);
  });

  it("treats a condition with an unparseable timestamp as the oldest one", () => {
    expect(
      sandboxMessage({
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
});

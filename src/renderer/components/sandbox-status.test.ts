import { describe, expect, it } from "vitest";
import {
  classifySandbox,
  classifySandboxPool,
  sandboxMessage,
  sandboxPoolMessage,
  sandboxPoolStates,
  sandboxStates,
} from "./sandbox-status";

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

// One case per row of the SPEC-0008 pool classifier table, plus the same two
// cases that keep an unexpected cluster from breaking a view.
describe("classifySandboxPool", () => {
  it("reports a ready pool as healthy", () => {
    const condition = classifySandboxPool({ phase: "Ready" });

    expect(condition.state).toBe(sandboxPoolStates.ready);
    expect(condition.className).toBe("success");
  });

  it("reports a warming pool as a warning", () => {
    const condition = classifySandboxPool({ phase: "Warming" });

    expect(condition.state).toBe(sandboxPoolStates.warming);
    expect(condition.className).toBe("warning");
  });

  it("reports a pending pool as a warning", () => {
    const condition = classifySandboxPool({ phase: "Pending" });

    expect(condition.state).toBe(sandboxPoolStates.pending);
    expect(condition.className).toBe("warning");
  });

  it("reports a degraded pool as an error, naming the cold fallback in the explanation", () => {
    // The judgement call recorded in SPEC-0008: a pool that is not holding its
    // warm buffer is not delivering the one thing it exists for, so the class
    // is `error`. The explanation says a checkout still runs, so the colour is
    // never read as an outage.
    const condition = classifySandboxPool({ phase: "Degraded" });

    expect(condition.state).toBe(sandboxPoolStates.degraded);
    expect(condition.className).toBe("error");
    expect(condition.explanation).toContain("cold path");
  });

  it("reports a pool with no phase at all as unknown", () => {
    for (const status of [undefined, {}]) {
      const condition = classifySandboxPool(status);

      expect(condition.state).toBe(sandboxPoolStates.unknown);
      expect(condition.className).toBe("info");
    }
  });

  it("passes an unrecognized phase through opaquely", () => {
    const condition = classifySandboxPool({ phase: "Draining" });

    expect(condition.state).toBe("Draining");
    expect(condition.className).toBe("info");
    expect(condition.explanation).toContain("Draining");
  });

  it("does not re-derive the verdict from the warm and claimed counts", () => {
    // The counts are not an input: a pool the controller calls Warming while it
    // boots its slots is a warning, whatever the gap between the numbers, and a
    // second opinion computed here would contradict the controller on every
    // pool that is mid-warm (SPEC-0008).
    const condition = classifySandboxPool({ phase: "Warming" });

    expect(condition.state).toBe(sandboxPoolStates.warming);
    expect(condition.className).toBe("warning");
  });
});

// Both selectors are the shared `conditionMessage` ladder (tested on its own in
// `condition-message.test.ts` since M5 extracted it) with their own
// classifier's explanation as the last resort. What is worth testing here is
// therefore only what is specific to this module: that each one reads the
// controller's words when there are any, and that each one falls back to the
// right classifier when there are none.
describe("sandboxMessage", () => {
  it("prefers the controller's own words", () => {
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

    expect(sandboxMessage(status)).toBe(classifySandbox(status).explanation);
  });
});

describe("sandboxPoolMessage", () => {
  it("prefers the controller's own words", () => {
    expect(
      sandboxPoolMessage({
        phase: "Ready",
        message: "Two warm slots are ready on one node.",
        conditions: [
          {
            type: "Warm",
            status: "True",
            message: "The warm buffer is full.",
            lastTransitionTime: "2026-08-28T10:00:00Z",
          },
        ],
      }),
    ).toBe("Two warm slots are ready on one node.");
  });

  it("falls back to the pool classifier's explanation, not to the sandbox one", () => {
    // The two selectors differ only in their last rung, and this is the assert
    // that keeps them from being wired to the wrong classifier.
    expect(sandboxPoolMessage({ phase: "Warming" })).toBe(classifySandboxPool({ phase: "Warming" }).explanation);
    expect(sandboxPoolMessage(undefined)).toBe(classifySandboxPool(undefined).explanation);
    expect(sandboxPoolMessage({ phase: "Pending" })).not.toBe(classifySandbox({ phase: "Pending" }).explanation);
  });

  it("never returns an empty string, whatever the conditions carry", () => {
    const status = {
      phase: "Ready",
      message: "",
      conditions: [{ type: "Warm", status: "False", message: "", lastTransitionTime: "2026-08-28T10:00:00Z" }],
    };

    expect(sandboxPoolMessage(status)).toBe(classifySandboxPool(status).explanation);
  });
});

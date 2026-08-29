import { describe, expect, it } from "vitest";
import { classifyGuest, guestMessage, guestStates } from "./guest-status";

const condition = (type: string, status: string, message = "", lastTransitionTime = "2026-08-29T09:00:00Z") => ({
  type,
  status,
  message,
  lastTransitionTime,
});

// One case per row of the SPEC-0010 classifier table, plus the cases that keep
// a guest nothing has reconciled - or one whose controller writes a phase this
// extension has never heard of - from breaking the view.
describe("classifyGuest", () => {
  describe("Stopping", () => {
    // The one invented state, and the reason this classifier exists: patching
    // `spec.runPolicy` to `Stopped` does not move `status.phase`, and the API
    // has no transitional value, so without this the list would say `Running`
    // about a guest the user has just stopped.
    it.each(["Running", "Scheduling", "Pending"])("derives Stopping from a Stopped policy over phase %s", (phase) => {
      const verdict = classifyGuest({ runPolicy: "Stopped" }, { phase });

      expect(verdict.state).toBe(guestStates.stopping);
      expect(verdict.className).toBe("warning");
      expect(verdict.explanation).toContain(phase);
    });

    it("does not derive Stopping when the policy is absent", () => {
      // The webhook-disabled cluster: an absent policy means "run", and a naive
      // `!== "Running"` test would report a running guest as stopping.
      expect(classifyGuest({}, { phase: "Running" }).state).toBe(guestStates.running);
      expect(classifyGuest(undefined, { phase: "Running" }).state).toBe(guestStates.running);
    });

    it("does not derive Stopping once the phase has caught up", () => {
      expect(classifyGuest({ runPolicy: "Stopped" }, { phase: "Stopped" }).state).toBe(guestStates.stopped);
    });
  });

  it("reports a running guest as healthy", () => {
    const verdict = classifyGuest({ runPolicy: "Running" }, { phase: "Running" });

    expect(verdict.state).toBe(guestStates.running);
    expect(verdict.className).toBe("success");
  });

  it.each([
    ["Scheduling", guestStates.scheduling],
    ["Pending", guestStates.pending],
  ])("reports the intermediate phase %s as a warning", (phase, state) => {
    const verdict = classifyGuest({ runPolicy: "Running" }, { phase });

    expect(verdict.state).toBe(state);
    expect(verdict.className).toBe("warning");
  });

  it("reports a failed guest as an error", () => {
    const verdict = classifyGuest({ runPolicy: "Running" }, { phase: "Failed" });

    expect(verdict.state).toBe(guestStates.failed);
    expect(verdict.className).toBe("error");
  });

  it("reports a stopped guest as information, not as a fault", () => {
    // A stopped guest is a resting state an operator chose. `Failed` is the
    // only `error` this classifier produces (SPEC-0010).
    const verdict = classifyGuest({ runPolicy: "Stopped" }, { phase: "Stopped" });

    expect(verdict.state).toBe(guestStates.stopped);
    expect(verdict.className).toBe("info");
  });

  it("keeps a guest that exited on its own Stopped, and says so in the explanation", () => {
    // The nuance lives in the explanation rather than in a sixth state, and it
    // is the same sentence the Start guard gives when it refuses: the guest
    // exited on its own and the policy has not asked for it back.
    const verdict = classifyGuest({ runPolicy: "Always" }, { phase: "Stopped" });

    expect(verdict.state).toBe(guestStates.stopped);
    expect(verdict.explanation).toContain("exited on its own");
    expect(verdict.explanation).toContain("recreating its launcher pod");
  });

  it("keeps a phase it does not know opaque rather than forcing it into a bucket", () => {
    const verdict = classifyGuest({ runPolicy: "Running" }, { phase: "Hibernating" });

    expect(verdict.state).toBe(guestStates.unknown);
    expect(verdict.className).toBe("info");
    expect(verdict.explanation).toContain("Hibernating");
  });

  it("reports a guest with no status at all as Unknown", () => {
    const verdict = classifyGuest({ runPolicy: "Running" });

    expect(verdict.state).toBe(guestStates.unknown);
    expect(verdict.explanation).toContain("No controller has reported");
  });
});

describe("guestMessage", () => {
  it("prefers the controller's own words over the generated explanation", () => {
    const message = guestMessage(
      { runPolicy: "Running" },
      { phase: "Failed", conditions: [condition("GuestRunning", "False", "The launcher pod could not be scheduled")] },
    );

    expect(message).toBe("The launcher pod could not be scheduled");
  });

  it("falls back to the classifier explanation when no condition carries one", () => {
    // SwiftGuest has no top-level `status.message` at all, which is the fleet
    // Cluster's shape exactly: the shared ladder simply starts at its second
    // rung, and its last rung is what keeps the Status column from being blank.
    const message = guestMessage({ runPolicy: "Stopped" }, { phase: "Running", conditions: [] });

    expect(message).toBe(classifyGuest({ runPolicy: "Stopped" }, { phase: "Running" }).explanation);
  });
});

import { describe, expect, it } from "vitest";
import { classifyFleetCluster, fleetClusterMessage, fleetClusterStates } from "./fleet-status";

const condition = (type: string, status: string, message = "", lastTransitionTime = "2026-08-29T09:00:00Z") => ({
  type,
  status,
  message,
  lastTransitionTime,
});

// One case per row of the SPEC-0009 classifier table, plus the cases that keep
// an unexpected cluster - or a cluster with no gateway at all - from breaking
// the view.
describe("classifyFleetCluster", () => {
  it("reports a Ready member as healthy", () => {
    const verdict = classifyFleetCluster({ conditions: [condition("Ready", "True")] });

    expect(verdict.state).toBe(fleetClusterStates.ready);
    expect(verdict.className).toBe("success");
  });

  it("reports a member whose API server did not answer as an error", () => {
    const verdict = classifyFleetCluster({
      conditions: [condition("Ready", "False"), condition("Reachable", "False")],
    });

    expect(verdict.state).toBe(fleetClusterStates.unreachable);
    expect(verdict.className).toBe("error");
  });

  it("reports a reachable member that is not Ready as a warning", () => {
    // The judgement call recorded in SPEC-0009: `Ready: False` on a member that
    // answers covers both an ordinary post-registration window and a permanent
    // credential problem, and the API gives no vocabulary to tell them apart,
    // so the ambiguous case takes the ambiguous colour.
    const verdict = classifyFleetCluster({
      conditions: [condition("Ready", "False"), condition("Reachable", "True")],
    });

    expect(verdict.state).toBe(fleetClusterStates.notReady);
    expect(verdict.className).toBe("warning");
  });

  it("keeps a Ready member Ready even when Reachable contradicts it", () => {
    // The two conditions can disagree, and the honest response is to show both
    // facts rather than invent a third state: the badge follows the condition
    // the API publishes as a printer column, and the Status column carries the
    // Reachable message (SPEC-0009).
    const status = {
      conditions: [
        condition("Ready", "True", "The gateway holds a healthy client.", "2026-08-29T09:00:00Z"),
        condition("Reachable", "False", "dial tcp 10.10.0.9:6443: i/o timeout", "2026-08-29T08:40:00Z"),
      ],
    };
    const verdict = classifyFleetCluster(status);

    expect(verdict.state).toBe(fleetClusterStates.ready);
    expect(verdict.className).toBe("success");
    // Ready is newer here, and the message ladder still prefers the condition
    // that is reporting a problem.
    expect(fleetClusterMessage(status)).toBe("dial tcp 10.10.0.9:6443: i/o timeout");
  });

  it("treats a Ready condition whose status is Unknown as unknown, opaquely", () => {
    const verdict = classifyFleetCluster({ conditions: [condition("Ready", "Unknown")] });

    expect(verdict.state).toBe(fleetClusterStates.unknown);
    expect(verdict.className).toBe("info");
    expect(verdict.explanation).toContain("Unknown");
  });

  it("still reports Unreachable when Ready is neither True nor False", () => {
    // "not Ready" is the condition for the second row of the table, and a
    // `Ready: Unknown` is not Ready: the Reachable failure still refines it.
    const verdict = classifyFleetCluster({
      conditions: [condition("Ready", "Unknown"), condition("Reachable", "False")],
    });

    expect(verdict.state).toBe(fleetClusterStates.unreachable);
    expect(verdict.className).toBe("error");
  });

  it("ignores condition types this extension has never heard of", () => {
    const verdict = classifyFleetCluster({
      conditions: [condition("PrometheusEndpointResolved", "False"), condition("QuietlyAddedInV1", "True")],
    });

    expect(verdict.state).toBe(fleetClusterStates.unknown);
    expect(verdict.className).toBe("info");
    expect(verdict.explanation).toContain("No gateway has reported on this member");
  });

  it("reports a member no gateway has reported on as the resting state", () => {
    // Not "pending": on a cluster where KubeSwift is installed and the gateway
    // is not (the chart default), this is permanent and correct, and a word
    // promising a transition would be wrong (SPEC-0009).
    for (const status of [undefined, {}, { conditions: [] }]) {
      const verdict = classifyFleetCluster(status);

      expect(verdict.state).toBe(fleetClusterStates.unknown);
      expect(verdict.className).toBe("info");
      expect(verdict.explanation).toContain("No gateway has reported on this member");
    }
  });
});

describe("fleetClusterMessage", () => {
  it("prefers the gateway's own words", () => {
    expect(
      fleetClusterMessage({
        conditions: [
          condition("Reachable", "False", "dial tcp 10.10.0.9:6443: i/o timeout", "2026-08-29T08:40:00Z"),
          condition("Ready", "False", "The gateway has no healthy client.", "2026-08-29T08:20:00Z"),
        ],
      }),
    ).toBe("dial tcp 10.10.0.9:6443: i/o timeout");
  });

  it("falls back to the classifier's explanation when no condition carries a message", () => {
    // This CRD's status has no top-level `message` field at all, so the shared
    // ladder starts at its second rung and lands here whenever the conditions
    // are silent - the state most real users see first.
    expect(fleetClusterMessage(undefined)).toBe(classifyFleetCluster(undefined).explanation);
    expect(fleetClusterMessage({ conditions: [condition("Ready", "True")] })).toBe(
      classifyFleetCluster({ conditions: [condition("Ready", "True")] }).explanation,
    );
  });

  it("never returns an empty string, whatever the conditions carry", () => {
    const status = { conditions: [condition("Ready", "False", "")] };

    expect(fleetClusterMessage(status)).toBe(classifyFleetCluster(status).explanation);
  });
});

import { describe, expect, it } from "vitest";
import { classifyStorageLocation, storageLocationMessage, storageLocationStates } from "./storage-status";

const condition = (type: string, status: string, message = "", lastTransitionTime = "2026-10-19T09:00:00Z") => ({
  type,
  status,
  message,
  lastTransitionTime,
});

describe("classifyStorageLocation", () => {
  it("reports a Ready location as healthy", () => {
    const verdict = classifyStorageLocation({ conditions: [condition("Ready", "True")] });

    expect(verdict.state).toBe(storageLocationStates.ready);
    expect(verdict.className).toBe("success");
  });

  it("reports an unreachable registry as an error", () => {
    const verdict = classifyStorageLocation({
      conditions: [condition("Ready", "False"), condition("Reachable", "False")],
    });

    expect(verdict.state).toBe(storageLocationStates.unreachable);
    expect(verdict.className).toBe("error");
  });

  it("reports a location that is not Ready as an error", () => {
    // A namespaced location never reports Reachable, so this is its only
    // failure state.
    const verdict = classifyStorageLocation({ conditions: [condition("Ready", "False")] });

    expect(verdict.state).toBe(storageLocationStates.notReady);
    expect(verdict.className).toBe("error");
  });

  it("keeps a Ready location Ready even when Reachable contradicts it", () => {
    const status = {
      conditions: [
        condition("Ready", "True", "The location can be used.", "2026-10-19T09:00:00Z"),
        condition("Reachable", "False", "dial tcp: i/o timeout", "2026-10-19T09:05:00Z"),
      ],
    };

    expect(classifyStorageLocation(status).state).toBe(storageLocationStates.ready);
    // The Status column carries the problem, the second rung of the ladder.
    expect(storageLocationMessage(status)).toBe("dial tcp: i/o timeout");
  });

  it("keeps an unrecognized Ready status opaque", () => {
    const verdict = classifyStorageLocation({ conditions: [condition("Ready", "Unknown")] });

    expect(verdict.state).toBe(storageLocationStates.unknown);
    expect(verdict.className).toBe("info");
    expect(verdict.explanation).toContain('"Unknown"');
  });

  it("reads a location nothing has reported on as Unknown, and says so in the Status column", () => {
    expect(classifyStorageLocation().state).toBe(storageLocationStates.unknown);
    expect(classifyStorageLocation({}).className).toBe("info");
    expect(storageLocationMessage({ conditions: [] })).toBe("No controller has reported on this location yet");
  });

  it("prefers the controller's own words in the Status column", () => {
    expect(storageLocationMessage({ conditions: [condition("Ready", "False", "Secret team-a/x is missing.")] })).toBe(
      "Secret team-a/x is missing.",
    );
  });
});

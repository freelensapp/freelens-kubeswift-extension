import { describe, expect, it } from "vitest";
import {
  artifactPlacementMessage,
  classifyArtifactPlacement,
  classifyPlacementArtifact,
  classifyPlacementNode,
  classifyVerificationPolicy,
  verificationPolicyMessage,
} from "./artifact-status";

const condition = (type: string, status: string, reason = "", message = "") => ({
  type,
  status,
  reason,
  message,
  lastTransitionTime: "2026-10-19T09:00:00Z",
});

describe("classifyArtifactPlacement", () => {
  it("reports a Prepared placement as healthy, whatever its reason", () => {
    const verdict = classifyArtifactPlacement({ conditions: [condition("Prepared", "True", "Prepared")] });

    expect(verdict).toMatchObject({ state: "Prepared", className: "success" });
  });

  it.each([
    ["Preparing", "Preparing", "warning"],
    ["PrepareFailed", "Prepare Failed", "error"],
    ["ArtifactRefused", "Refused", "error"],
    ["PoolNotFound", "Pool Not Found", "error"],
    ["NoTargetNodes", "No Target Nodes", "info"],
  ])("reads the reason %s as %s (%s)", (reason, state, className) => {
    expect(classifyArtifactPlacement({ conditions: [condition("Prepared", "False", reason)] })).toMatchObject({
      state,
      className,
    });
  });

  it("keeps a reason it does not know opaque", () => {
    const verdict = classifyArtifactPlacement({ conditions: [condition("Prepared", "False", "SomethingNew")] });

    expect(verdict).toMatchObject({ state: "SomethingNew", className: "info" });
    expect(verdict.explanation).toContain('"SomethingNew"');
  });

  it("reads a False condition without a reason as not prepared", () => {
    expect(classifyArtifactPlacement({ conditions: [condition("Prepared", "False")] })).toMatchObject({
      state: "Not Prepared",
      className: "warning",
    });
  });

  it("reads a placement nothing has reported on as Unknown", () => {
    expect(classifyArtifactPlacement()).toMatchObject({ state: "Unknown", className: "info" });
    expect(artifactPlacementMessage({})).toBe("No controller has reported on this placement yet");
  });

  it("prefers the controller's own words in the Status column", () => {
    expect(
      artifactPlacementMessage({
        conditions: [condition("Prepared", "False", "ArtifactRefused", "tokenizer: no authority signed it")],
      }),
    ).toBe("tokenizer: no authority signed it");
  });
});

describe("classifyPlacementArtifact", () => {
  it.each([
    ["Authorized", "Authorized", "success"],
    ["Resolving", "Resolving", "warning"],
    ["ArtifactRefused", "Refused", "error"],
    ["PolicyDenied", "Policy Denied", "error"],
    ["Elsewhere", "Elsewhere", "info"],
  ])("reads the reason %s as %s (%s)", (reason, state, className) => {
    expect(classifyPlacementArtifact(reason)).toMatchObject({ state, className });
  });

  it("reads an artifact without a reason as Unknown", () => {
    expect(classifyPlacementArtifact()).toMatchObject({ state: "Unknown", className: "info" });
  });
});

describe("classifyPlacementNode", () => {
  it("lets prepared win over the reason", () => {
    expect(classifyPlacementNode({ prepared: true, reason: "Preparing" })).toMatchObject({
      state: "Prepared",
      className: "success",
    });
  });

  it.each([
    ["Preparing", "Preparing", "warning"],
    ["VerificationFailed", "Verification Failed", "error"],
    ["ClaimMismatch", "Claim Mismatch", "error"],
    ["PrepareFailed", "Prepare Failed", "error"],
    ["Unheard", "Unheard", "info"],
  ])("reads an unprepared node with the reason %s as %s (%s)", (reason, state, className) => {
    expect(classifyPlacementNode({ prepared: false, reason })).toMatchObject({ state, className });
  });

  it("does not call a node prepared on its reason alone", () => {
    expect(classifyPlacementNode({ prepared: false, reason: "Prepared" })).toMatchObject({
      state: "Not Prepared",
      className: "warning",
    });
    expect(classifyPlacementNode({ prepared: false })).toMatchObject({ state: "Not Prepared" });
  });
});

describe("classifyVerificationPolicy", () => {
  it("reports a Ready policy as healthy", () => {
    expect(classifyVerificationPolicy({ conditions: [condition("Ready", "True")] })).toMatchObject({
      state: "Ready",
      className: "success",
    });
  });

  it("reports a policy that is not Ready as an error, since it refuses everything it governs", () => {
    const verdict = classifyVerificationPolicy({ conditions: [condition("Ready", "False", "InvalidKey")] });

    expect(verdict).toMatchObject({ state: "Not Ready", className: "error" });
    expect(verdict.explanation).toContain("refused");
  });

  it("keeps an unrecognized status opaque, and reads a missing condition as Unknown", () => {
    expect(classifyVerificationPolicy({ conditions: [condition("Ready", "Unknown")] })).toMatchObject({
      state: "Unknown",
      className: "info",
    });
    expect(classifyVerificationPolicy()).toMatchObject({ state: "Unknown", className: "info" });
    expect(verificationPolicyMessage()).toBe("No controller has validated this policy yet");
  });

  it("prefers the controller's own words in the Status column", () => {
    expect(
      verificationPolicyMessage({
        conditions: [condition("Ready", "False", "InvalidKey", 'authority "old": not a PEM public key')],
      }),
    ).toBe('authority "old": not a PEM public key');
  });
});

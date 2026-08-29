import { describe, expect, it } from "vitest";
import {
  apiFailureFacts,
  canStart,
  canStop,
  deleteCascade,
  launcherPodSentence,
  launcherPodTarget,
  startDialogFacts,
  startPatch,
  startSuccessMessage,
  stopDialogFacts,
  stopPartialFailureMessage,
  stopPatch,
  stopSuccessMessage,
  stopWrites,
  writeFailureMessage,
} from "./guest-actions";

import type { GuestActionFacts, GuestActionSpecFacts, GuestActionStatusFacts } from "./guest-actions";

const guest = (spec?: GuestActionSpecFacts, status?: GuestActionStatusFacts): GuestActionFacts => ({
  name: "demo",
  namespace: "vms",
  spec,
  status,
});

const guestClassRef = { name: "small" };
const podRef = { name: "demo-launcher" };

const dialogText = (facts: { notes: string[]; warnings: string[] }) => [...facts.notes, ...facts.warnings].join(" ");

describe("canStart", () => {
  it("is enabled only for a guest whose policy says Stopped", () => {
    expect(canStart(guest({ guestClassRef, runPolicy: "Stopped" })).enabled).toBe(true);
  });

  // The webhook-disabled cluster is the case a naive `!== "Running"` gets
  // wrong: the CRD declares no default, so an absent policy can be stored, and
  // the controller reads everything that is not `Stopped` as "run".
  it.each(["Running", "Always", "RestartOnFailure", undefined])("is disabled for the policy %s", (runPolicy) => {
    expect(canStart(guest({ guestClassRef, runPolicy: runPolicy as never })).enabled).toBe(false);
  });

  it("names the two-click path for a guest that is set to run but has exited", () => {
    // The gap in the API's shape: with the policy already at `Running`, no
    // patch changes anything, because what blocks the boot is a terminal pod
    // the controller will not replace.
    const verdict = canStart(guest({ guestClassRef, runPolicy: "Running" }, { phase: "Stopped" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("stop it, then start it");
  });

  it("gives the plain reason for a guest that is set to run and running", () => {
    const verdict = canStart(guest({ guestClassRef, runPolicy: "Always" }, { phase: "Running" }));

    expect(verdict.reason).toBe("The guest is already set to run.");
  });

  it("survives an object with no spec and one with no status", () => {
    expect(canStart(guest(undefined, { phase: "Running" })).enabled).toBe(false);
    expect(canStart(guest({ guestClassRef, runPolicy: "Stopped" }, undefined)).enabled).toBe(true);
  });
});

describe("canStop", () => {
  it.each(["Running", "Always", "RestartOnFailure", undefined])("is enabled for the policy %s", (runPolicy) => {
    expect(canStop(guest({ guestClassRef, runPolicy: runPolicy as never })).enabled).toBe(true);
  });

  it("stays enabled for a half-stopped guest, so the promised retry is reachable", () => {
    // A stop whose second write failed, or a `kubectl patch` somebody else ran.
    // If this were disabled, the partial-failure message's "run it again" would
    // be a promise the UI cannot keep.
    expect(canStop(guest({ guestClassRef, runPolicy: "Stopped" }, { podRef })).enabled).toBe(true);
  });

  it("is disabled only when the policy is Stopped and no pod is recorded", () => {
    const verdict = canStop(guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Stopped" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toBe("The guest is already stopped, and no launcher pod is recorded.");
  });

  it("survives an object with no spec and one with no status", () => {
    expect(canStop(guest(undefined, { phase: "Running" })).enabled).toBe(true);
    expect(canStop(guest({ guestClassRef, runPolicy: "Stopped" }, undefined)).enabled).toBe(false);
  });
});

// B5, written as a loop over a table rather than as one assertion per case, so
// that a future guard branch cannot be added without a reason: a disabled
// outcome with an empty reason must be impossible to produce.
describe("the guard invariant", () => {
  const cases: GuestActionFacts[] = [
    guest(),
    guest({ guestClassRef }),
    guest({ guestClassRef }, {}),
    guest({ guestClassRef, runPolicy: "Running" }, { phase: "Running" }),
    guest({ guestClassRef, runPolicy: "Running" }, { phase: "Scheduling" }),
    guest({ guestClassRef, runPolicy: "Running" }, { phase: "Pending" }),
    guest({ guestClassRef, runPolicy: "Running" }, { phase: "Stopped" }),
    guest({ guestClassRef, runPolicy: "Running" }, { phase: "Failed" }),
    guest({ guestClassRef, runPolicy: "Always" }, { phase: "Running" }),
    guest({ guestClassRef, runPolicy: "RestartOnFailure" }, { phase: "Failed" }),
    guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Stopped" }),
    guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Running", podRef }),
    guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Hibernating" as never }),
  ];

  it.each(cases)("never disables an action without saying why (%#)", (subject) => {
    for (const verdict of [canStart(subject), canStop(subject)]) {
      if (!verdict.enabled) {
        expect(verdict.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the patch payloads", () => {
  // The assert that keeps a read-modify-write from creeping in: a patch that
  // carried the whole spec would clobber a field a controller or another user
  // wrote between the read and the write.
  it("writes exactly the one field each verb changes, and nothing else", () => {
    expect(startPatch()).toEqual({ spec: { runPolicy: "Running" } });
    expect(stopPatch()).toEqual({ spec: { runPolicy: "Stopped" } });
  });
});

describe("launcherPodTarget", () => {
  it("reads the pod named by the status, in the namespace the reference gives", () => {
    expect(launcherPodTarget(guest({ guestClassRef }, { podRef: { name: "p", namespace: "other" } }))).toEqual({
      name: "p",
      namespace: "other",
    });
  });

  it("falls back to the guest's own namespace", () => {
    expect(launcherPodTarget(guest({ guestClassRef }, { podRef }))).toEqual({
      name: "demo-launcher",
      namespace: "vms",
    });
  });

  it("returns undefined when the status names no pod", () => {
    expect(launcherPodTarget(guest({ guestClassRef }, { phase: "Running" }))).toBeUndefined();
    expect(launcherPodTarget(guest({ guestClassRef }))).toBeUndefined();
  });
});

// B3: the four readings of the click-time pod read, as a pure function from the
// outcome to the sentence. The read itself is the component's job; what is
// asserted here is that each outcome produces its own wording, and that only
// "absent" drops the delete from the sequence.
describe("the launcher pod readings", () => {
  const target = { name: "demo-launcher", namespace: "vms" };

  it("says a running pod will be deleted and take the guest with it", () => {
    expect(launcherPodSentence(target, { outcome: "present", phase: "Running" })).toContain("will be deleted");
  });

  it.each(["Succeeded", "Failed"])("says a %s pod is only being cleared away", (phase) => {
    const sentence = launcherPodSentence(target, { outcome: "present", phase });

    expect(sentence).toContain("already exited");
    expect(sentence).toContain("keeps it from coming back");
  });

  it("says an absent pod is already gone", () => {
    expect(launcherPodSentence(target, { outcome: "absent" })).toContain("already gone");
  });

  it("says an unverifiable pod could not be verified, without refusing the action", () => {
    expect(launcherPodSentence(target, { outcome: "unreadable" })).toContain("could not be verified");
  });

  it("drops the delete only for the pod that is really gone", () => {
    const subject = guest({ guestClassRef, runPolicy: "Running" }, { podRef });

    expect(stopWrites(subject, { outcome: "present", phase: "Running" }).deletePod).toBeDefined();
    expect(stopWrites(subject, { outcome: "unreadable" }).deletePod).toBeDefined();
    expect(stopWrites(subject, { outcome: "absent" }).deletePod).toBeUndefined();
  });
});

describe("the Start dialog", () => {
  it("shows the transition the patch performs", () => {
    const facts = startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped" }));

    expect(facts.subject).toBe("SwiftGuest vms/demo");
    expect(facts.writes).toEqual([{ kind: "patch", text: "spec.runPolicy: Stopped -> Running" }]);
  });

  // B8: starting a guest commits real capacity on a shared cluster, and every
  // fact needed to say so is already in the spec the drawer renders.
  it("names the guest class, and its sizing only when the class is loaded", () => {
    const subject = guest({ guestClassRef, runPolicy: "Stopped" });

    expect(dialogText(startDialogFacts(subject))).toContain("guest class small.");
    expect(dialogText(startDialogFacts(subject, "2 vCPU, 4Gi"))).toContain("guest class small (2 vCPU, 4Gi)");
  });

  it("says a GPU will be claimed only when the guest asks for one", () => {
    expect(dialogText(startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped" })))).not.toContain("GPU");
    expect(
      dialogText(startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped", gpuProfileRef: { name: "hgx" } }))),
    ).toContain("claim a GPU through the profile hgx");
    expect(
      dialogText(startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped", gpuResourceClaim: { tier: "pcie" } }))),
    ).toContain("claim a GPU");
  });

  it("names a pinned node only when the user pinned one", () => {
    expect(dialogText(startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped" })))).not.toContain("pinned");
    expect(dialogText(startDialogFacts(guest({ guestClassRef, runPolicy: "Stopped", nodeName: "node-1" })))).toContain(
      "pinned to the node node-1",
    );
  });
});

describe("the Stop dialog", () => {
  const runningSubject = guest(
    { guestClassRef, runPolicy: "Always", network: { binding: "nat" } },
    { phase: "Running", podRef, network: { primaryIP: "10.0.0.5" } },
  );

  it("lists both writes, in the order they are performed", () => {
    const facts = stopDialogFacts(runningSubject, { outcome: "present", phase: "Running" });

    expect(facts.writes).toEqual([
      { kind: "patch", text: "spec.runPolicy: Always -> Stopped" },
      { kind: "delete", text: "Delete Pod vms/demo-launcher" },
    ]);
  });

  it("shows one line when the status names no pod, and says which situation that is", () => {
    const facts = stopDialogFacts(guest({ guestClassRef, runPolicy: "Running" }, { phase: "Running" }));

    expect(facts.writes).toEqual([{ kind: "patch", text: "spec.runPolicy: Running -> Stopped" }]);
    expect(dialogText(facts)).toContain("No launcher pod is recorded");
    expect(dialogText(facts)).toContain("this action will not stop it");
  });

  // B4: re-stopping a half-stopped guest patches nothing and deletes the pod,
  // which is what makes the retry the partial-failure message promises real.
  it("drops the no-op patch of a guest whose policy is already Stopped", () => {
    const halfStopped = guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Running", podRef });
    const facts = stopDialogFacts(halfStopped, { outcome: "present", phase: "Running" });

    expect(facts.writes).toEqual([{ kind: "delete", text: "Delete Pod vms/demo-launcher" }]);
    expect(stopWrites(halfStopped, { outcome: "present" })).toEqual({
      patchRunPolicy: false,
      deletePod: { name: "demo-launcher", namespace: "vms" },
    });
  });

  it("has nothing to write for a guest that is stopped with no pod, which is why the guard refuses", () => {
    const stopped = guest({ guestClassRef, runPolicy: "Stopped" }, { phase: "Stopped" });

    expect(stopWrites(stopped)).toEqual({ patchRunPolicy: false, deletePod: undefined });
    expect(stopDialogFacts(stopped).writes).toEqual([]);
    expect(canStop(stopped).enabled).toBe(false);
  });

  // B6: the one piece of information a stop destroys irreversibly, stated at
  // the moment it is lost rather than explained afterwards.
  it.each(["Always", "RestartOnFailure"])("warns that the %s policy is replaced", (runPolicy) => {
    const subject = guest({ guestClassRef, runPolicy: runPolicy as never }, { phase: "Running", podRef });

    expect(dialogText(stopDialogFacts(subject, { outcome: "present" }))).toContain(
      `run policy ${runPolicy} is replaced`,
    );
  });

  it("does not warn about a replaced policy for a guest that was only Running", () => {
    const subject = guest({ guestClassRef, runPolicy: "Running" }, { phase: "Running", podRef });

    expect(dialogText(stopDialogFacts(subject, { outcome: "present" }))).not.toContain("is replaced");
  });

  // B7: true for a `nat`-bound guest, and deliberately not claimed for a
  // `bridge`-bound one, whose address comes from a network attachment and may
  // well be stable - the case an unconditional version would get wrong.
  it("says the address is released for a nat-bound guest, and for one with no binding set", () => {
    expect(dialogText(stopDialogFacts(runningSubject, { outcome: "present" }))).toContain("10.0.0.5 goes with the pod");

    const noBinding = guest({ guestClassRef, runPolicy: "Running" }, { podRef, network: { primaryIP: "10.0.0.6" } });

    expect(dialogText(stopDialogFacts(noBinding, { outcome: "present" }))).toContain("10.0.0.6 goes with the pod");
  });

  it("does not say the address is released for a bridge-bound guest", () => {
    const bridged = guest(
      { guestClassRef, runPolicy: "Running", network: { binding: "bridge" } },
      { podRef, network: { primaryIP: "10.0.0.7" } },
    );

    expect(dialogText(stopDialogFacts(bridged, { outcome: "present" }))).not.toContain("goes with the pod");
  });

  it("always says the disks are kept", () => {
    expect(dialogText(stopDialogFacts(runningSubject, { outcome: "present" }))).toContain("stopping is not deleting");
    expect(dialogText(stopDialogFacts(guest({ guestClassRef, runPolicy: "Running" })))).toContain(
      "stopping is not deleting",
    );
  });

  // B14: the recon found no evidence of a clean in-guest shutdown, so the
  // dialog describes a termination. Saying less is the improvement.
  it("promises a termination rather than a graceful shutdown", () => {
    const text = dialogText(stopDialogFacts(runningSubject, { outcome: "present" }));

    expect(text).toContain("not asked to shut down cleanly");
    expect(text).toContain("30-second grace period");
  });
});

// B13: the cascade computed from the guest's own spec rather than stated in the
// abstract. What a user is most likely to guess wrong is that a snapshot
// survives, and that an explicitly referenced PVC does too.
describe("deleteCascade", () => {
  it("removes the blank data disks and keeps the ones attached through a PVC reference", () => {
    const cascade = deleteCascade(
      guest({
        guestClassRef,
        imageRef: { name: "ubuntu" },
        dataDiskRefs: [
          { name: "scratch", blank: { size: "20Gi" } },
          { name: "archive", pvcRef: { name: "archive-pvc" } },
        ],
      }),
    );

    expect(cascade.removed.join(" ")).toContain("blank data disks");
    expect(cascade.retained.join(" ")).toContain("archive-pvc");
    expect(cascade.retained.join(" ")).toContain("the shared image ubuntu");
    expect(cascade.retained.join(" ")).toContain("every snapshot");
  });

  it("says nothing about blank disks or a Service for a guest that has neither", () => {
    const cascade = deleteCascade(guest({ guestClassRef, dataDiskRefs: [{ name: "archive", pvcRef: { name: "a" } }] }));

    expect(cascade.removed.join(" ")).not.toContain("blank data disks");
    expect(cascade.removed.join(" ")).not.toContain("Service");
    expect(cascade.removed.join(" ")).toContain("the launcher pod");
  });

  it("names the per-guest Service only for a guest that exposes ports", () => {
    const cascade = deleteCascade(guest({ guestClassRef, network: { ports: [{ port: 22 }] } }));

    expect(cascade.removed.join(" ")).toContain("the per-guest Service");
  });
});

// W9: the outcome and failure messages, which are the whole of what a user sees
// when an action succeeds without changing anything visible, or fails.
describe("the outcome messages", () => {
  it("names what a start wrote", () => {
    expect(startSuccessMessage()).toBe("Run policy set to Running");
  });

  it("names both halves of a stop, or just the half that ran", () => {
    expect(stopSuccessMessage({ patchRunPolicy: true, deletePod: { name: "p", namespace: "vms" } })).toBe(
      "Run policy set to Stopped and launcher pod p deleted",
    );
    expect(stopSuccessMessage({ patchRunPolicy: false, deletePod: { name: "p", namespace: "vms" } })).toBe(
      "Launcher pod p deleted",
    );
    expect(stopSuccessMessage({ patchRunPolicy: true })).toBe("Run policy set to Stopped");
  });

  it("turns a half-applied stop into a recovery instruction", () => {
    const message = stopPartialFailureMessage("demo-launcher");

    expect(message).toContain("run policy is now Stopped");
    expect(message).toContain("still there");
    expect(message).toContain("Running Stop again retries just the deletion");
  });
});

describe("the failure messages", () => {
  const context = { verb: "patch", resource: "swiftguests", namespace: "vms" };
  const forbidden = 'swiftguests.swift.kubeswift.io "demo" is forbidden: User "dev" cannot patch resource';

  it("prefixes a 403 with the verb, the resource and the namespace, without replacing the API server's words", () => {
    const message = writeFailureMessage({ code: 403, message: forbidden, alreadyNotified: false }, context);

    expect(message).toContain("not allowed to patch swiftguests in the namespace vms");
    expect(message).toContain(forbidden);
  });

  it("prefixes a 404 with what is about to happen, without replacing the API server's words", () => {
    const notFound = 'swiftguests.swift.kubeswift.io "demo" not found';
    const message = writeFailureMessage({ code: 404, message: notFound, alreadyNotified: false }, context);

    expect(message).toContain("gone from the cluster");
    expect(message).toContain(notFound);
  });

  it("passes anything else through exactly as it arrived", () => {
    const webhook = "admission webhook denied the request: guests may not be stopped during a migration";

    expect(writeFailureMessage({ code: 422, message: webhook, alreadyNotified: false }, context)).toBe(webhook);
  });
});

// The error reader, written against the shape the host's `JsonApiErrorParsed`
// really has: a private `error` holding the parsed `Status`, a `toString()` that
// is the API server's own message, and the public flag the host sets when it has
// already toasted the error itself.
describe("apiFailureFacts", () => {
  const hostApiError = (code: number, message: string) => ({
    error: { code },
    isUsedForNotification: false,
    toString: () => message,
  });

  it("reads the status code and the message of a host API error", () => {
    const facts = apiFailureFacts(hostApiError(404, 'pods "p" not found'));

    expect(facts).toEqual({ code: 404, message: 'pods "p" not found', alreadyNotified: false });
  });

  it("reports an error the host has already toasted, so we do not duplicate it", () => {
    const error = { ...hostApiError(403, "denied"), isUsedForNotification: true };

    expect(apiFailureFacts(error).alreadyNotified).toBe(true);
  });

  it("reports nothing rather than throwing for an error of another shape", () => {
    expect(apiFailureFacts(undefined)).toEqual({ message: undefined, alreadyNotified: false });
    expect(apiFailureFacts("plain string")).toEqual({ message: "plain string", alreadyNotified: false });
    expect(apiFailureFacts(new Error("boom")).message).toBe("Error: boom");
  });
});

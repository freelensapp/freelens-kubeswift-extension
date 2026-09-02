import { describe, expect, it } from "vitest";
import {
  canRestore,
  defaultRestoreForm,
  defaultRestoreName,
  defaultTargetGuestName,
  inPlaceGuard,
  inPlaceWedges,
  inPlaceWedgeWarning,
  macAddressLock,
  macAddressLockRule,
  memoryTailHangWarning,
  restoreCreateFailureMessage,
  restoreCreatePayload,
  restoreDeleteRow,
  restoreErrors,
  restoreIdentityItems,
  restoreIsAccented,
  restoreModeChoices,
  restoreSubmitBlockReason,
  restoreSuccessMessage,
  restoreSummary,
  restoreTargetName,
  restoreWarnings,
  snapshotCapturesMemory,
  targetNodeApplies,
  targetNodeFacts,
} from "./restore-create";

import type { SwiftSnapshotBackendType } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type { ExistingGuestFacts, RestoreFormValues, RestoreSnapshotFacts, SourceGuestReading } from "./restore-create";

const clickedAt = new Date(2026, 7, 30, 14, 5, 9);

/** The subject of most of these cases: a Ready memory snapshot of a guest that still exists. */
const snapshot = (patch: Partial<RestoreSnapshotFacts> = {}): RestoreSnapshotFacts => ({
  name: "demo-snap",
  namespace: "vms",
  sourceGuestName: "demo",
  backend: "local",
  phase: "Ready",
  ...patch,
});

const csiSnapshot = snapshot({ backend: "csi-volume-snapshot" });

/** The click-time read of the source guest, in the shape the dialog hands over (B3, T4). */
const present = (patch: Partial<SourceGuestReading> = {}): SourceGuestReading => ({
  outcome: "present",
  phase: "Running",
  runPolicy: "Running",
  podName: "demo-launcher",
  ...patch,
});

const absent: SourceGuestReading = { outcome: "absent" };
const unreadable: SourceGuestReading = { outcome: "unreadable" };

/** The form as the dialog opens it, at a fixed instant. */
const form = (patch: Partial<RestoreFormValues> = {}): RestoreFormValues => ({
  ...defaultRestoreForm(snapshot(), clickedAt),
  ...patch,
});

const summaryText = (facts: { notes: string[]; warnings: string[] }) => [...facts.notes, ...facts.warnings].join(" ");

const guests: ExistingGuestFacts[] = [{ name: "demo", nodeName: "node-a" }, { name: "demo-nodeless" }];

describe("canRestore", () => {
  // Upstream requeues a restore of a not-Ready snapshot every ten seconds
  // forever, so the only phase that is worth refusing is the one that will never
  // become Ready.
  it("refuses a Failed snapshot, and says the phase is terminal", () => {
    const verdict = canRestore(snapshot({ phase: "Failed" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("terminal");
    expect(verdict.reason).toContain("never become Ready");
    expect(verdict.reason).toContain("Pending forever");
  });

  it.each(["Ready", "Pending", "Capturing", "Uploading", "Hibernating", undefined])(
    "offers the action for the phase %s",
    (phase) => {
      expect(canRestore(snapshot({ phase })).enabled).toBe(true);
    },
  );
});

// W4, written as a loop over a table rather than one assertion per case, so a
// future branch cannot be added without a reason.
describe("the guard invariant", () => {
  const readings: SourceGuestReading[] = [present(), present({ runPolicy: "Stopped" }), absent, unreadable];
  const snapshots: RestoreSnapshotFacts[] = [
    snapshot(),
    snapshot({ phase: "Failed" }),
    snapshot({ phase: "Pending" }),
    snapshot({ phase: undefined }),
    snapshot({ backend: undefined }),
    snapshot({ backend: "s3" }),
    snapshot({ backend: "oci" }),
    csiSnapshot,
    snapshot({ sourceGuestName: undefined }),
  ];

  it.each(snapshots)("never disables anything without saying why (%#)", (subject) => {
    const verdict = canRestore(subject);

    if (!verdict.enabled) {
      expect(verdict.reason.length).toBeGreaterThan(0);
    }

    for (const reading of readings) {
      for (const choice of restoreModeChoices(subject, reading)) {
        if (!choice.guard.enabled) {
          expect(choice.guard.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("names both modes, in the order the dialog offers them", () => {
    expect(restoreModeChoices(snapshot(), present()).map((choice) => choice.mode)).toEqual(["in-place", "clone"]);
    expect(restoreModeChoices(snapshot(), present()).map((choice) => choice.label)).toEqual([
      "Restore in place",
      "Clone",
    ]);
  });
});

describe("the mode availability", () => {
  const modes = (subject: RestoreSnapshotFacts, reading: SourceGuestReading) =>
    Object.fromEntries(restoreModeChoices(subject, reading).map((choice) => [choice.mode, choice.guard.enabled]));

  it("offers both modes for a memory snapshot whose source guest is there", () => {
    expect(modes(snapshot(), present())).toEqual({ "in-place": true, clone: true });
  });

  // The verb that succeeds while doing nothing: the csi path returns early when
  // the PVC and the guest already exist, and the restore marches to Ready.
  it("refuses the in-place mode on a csi snapshot, with the no-op reason", () => {
    const verdict = inPlaceGuard(csiSnapshot, present());

    expect(modes(csiSnapshot, present())).toEqual({ "in-place": false, clone: true });
    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("restores nothing");
    expect(verdict.reason).toContain("marches the restore to Ready");
    expect(verdict.reason).toContain("Clone it into a new guest instead");
  });

  it("refuses the in-place mode when the source guest is gone", () => {
    const verdict = inPlaceGuard(snapshot(), absent);

    expect(modes(snapshot(), absent)).toEqual({ "in-place": false, clone: true });
    expect(verdict.reason).toContain("demo no longer exists");
    expect(verdict.reason).toContain("nothing to restore");
  });

  it("refuses the in-place mode when the snapshot names no source guest at all", () => {
    expect(inPlaceGuard(snapshot({ sourceGuestName: undefined }), present()).reason).toContain("names no source guest");
  });

  // A read that failed is not a fact: it degrades the sentences, never the action
  // (the SPEC-0010 B3 stance, and spike T4's whole point).
  it("keeps the in-place mode when the source guest could not be read", () => {
    expect(inPlaceGuard(snapshot(), unreadable).enabled).toBe(true);
  });

  // A certain refusal outranks an uncertain one: the csi no-op is a property of
  // the object, the missing guest is read from a store that may be stale.
  it("reports the csi no-op before the missing guest when both apply", () => {
    expect(inPlaceGuard(csiSnapshot, absent).reason).toContain("restores nothing");
  });

  it("reports the missing source guest name before everything else", () => {
    expect(inPlaceGuard(snapshot({ backend: "csi-volume-snapshot", sourceGuestName: "" }), absent).reason).toContain(
      "names no source guest",
    );
  });
});

describe("the defaults", () => {
  it("names the restore after the snapshot and the local wall clock, to the second", () => {
    expect(defaultRestoreName("demo-snap", clickedAt)).toBe("demo-snap-restore-20260830-140509");
  });

  it("names the clone after the source guest and the time of day", () => {
    expect(defaultTargetGuestName("demo", clickedAt)).toBe("demo-restore-140509");
  });

  // The mode that destroys nothing is the one the dialog opens on: an in-place
  // restore kills a running VM with no grace period, and a default answer that
  // does that is a trap however well it is labelled.
  it("opens on the clone mode, regenerating everything, resuming, in copy mode", () => {
    const values = defaultRestoreForm(snapshot(), clickedAt);

    expect(values.mode).toBe("clone");
    expect(values.regenerateMachineIdentity).toBe(true);
    expect(values.rewriteMacAddresses).toBe(true);
    expect(values.memoryRestoreMode).toBe("copy");
    expect(values.resumeAfterRestore).toBe(true);
    expect(values.targetNode).toBe("");
    expect(restoreSubmitBlockReason(snapshot(), values, guests)).toBeUndefined();
  });

  it("falls back to the snapshot's own name when it records no source guest", () => {
    expect(defaultRestoreForm(snapshot({ sourceGuestName: undefined }), clickedAt).targetName).toBe(
      "demo-snap-restore-140509",
    );
  });
});

describe("the target guest", () => {
  it("is the typed name in the clone mode", () => {
    expect(restoreTargetName(snapshot(), form({ targetName: " demo-clone " }))).toBe("demo-clone");
  });

  // Upstream reads the mode off the name match, so in place the name IS the mode
  // and the field cannot be a text input without reintroducing the typo class the
  // explicit radio exists to remove (C10).
  it("is fixed to the source guest in the in-place mode, whatever the field holds", () => {
    expect(restoreTargetName(snapshot(), form({ mode: "in-place", targetName: "something-else" }))).toBe("demo");
  });
});

describe("what counts as a memory snapshot", () => {
  it.each(["local", "s3", "oci"] as const)("counts the %s backend", (backend) => {
    expect(snapshotCapturesMemory(snapshot({ backend }))).toBe(true);
  });

  it("does not count csi, which captures the root disk only", () => {
    expect(snapshotCapturesMemory(csiSnapshot)).toBe(false);
  });

  // The controller's own record that a memory image exists, which outranks any
  // derivation from the backend name.
  it("counts a recorded memory snapshot whatever the backend says", () => {
    expect(snapshotCapturesMemory(snapshot({ backend: "csi-volume-snapshot", hasMemorySnapshot: true }))).toBe(true);
    expect(snapshotCapturesMemory(snapshot({ backend: undefined, hasMemorySnapshot: true }))).toBe(true);
  });

  it("says no when there is nothing to go on", () => {
    expect(snapshotCapturesMemory(snapshot({ backend: undefined }))).toBe(false);
  });
});

describe("the MAC lock", () => {
  it.each(["local", "s3", "oci"] as const)("locks the rewrite for a %s clone", (backend) => {
    expect(macAddressLock(snapshot({ backend }), form())).toBe(true);
  });

  it("leaves the rewrite free for a csi clone", () => {
    expect(macAddressLock(csiSnapshot, form())).toBe(false);
  });

  // Nothing to lock: an in-place restore carries no identity block at all.
  it.each(["local", "csi-volume-snapshot"] as const)("locks nothing in the in-place mode (%s)", (backend) => {
    expect(macAddressLock(snapshot({ backend }), form({ mode: "in-place" }))).toBe(false);
  });

  it("explains the lock with the rule that produces it", () => {
    expect(macAddressLockRule).toContain("same MAC addresses");
    expect(macAddressLockRule).toContain("admission webhook");
  });
});

describe("the validation that replaces the absent webhook", () => {
  const errors = (values: Partial<RestoreFormValues>, subject = snapshot(), existing = guests) =>
    restoreErrors(subject, form(values), existing);

  it("requires a name, and requires it to be a legal object name", () => {
    expect(errors({ name: "" }).name).toContain("required");
    expect(errors({ name: "Demo Restore" }).name).toContain("lowercase");
    expect(errors({ name: "demo-snap-restore-1" }).name).toBeUndefined();
  });

  it("requires a target guest name in the clone mode, and requires it to be legal", () => {
    expect(errors({ targetName: "" }).targetName).toContain("required");
    expect(errors({ targetName: "Demo Clone" }).targetName).toContain("lowercase");
    expect(errors({ targetName: "demo-clone" }).targetName).toBeUndefined();
  });

  // The webhook's own typo rule: a target guest named after the snapshot is never
  // what anyone meant, and with the webhook off nobody would ever say so.
  it("refuses a clone named after the snapshot, as the typo it is", () => {
    const message = errors({ targetName: "demo-snap" }).targetName;

    expect(message).toContain("cannot be named after the snapshot");
    expect(message).toContain("demo-snap");
  });

  it("says nothing about the target name in the in-place mode, where it is not a field", () => {
    expect(errors({ mode: "in-place", targetName: "" }).targetName).toBeUndefined();
    expect(errors({ mode: "in-place", targetName: "demo-snap" }).targetName).toBeUndefined();
  });
});

describe("the target node rule", () => {
  it.each(["s3", "oci"] as const)("renders the field for a %s snapshot", (backend) => {
    expect(targetNodeApplies(snapshot({ backend }))).toBe(true);
  });

  // Option dropping (W12): `local` is pinned to the capture node and `csi`
  // ignores the field, so it is not rendered rather than rendered and ignored.
  it.each(["local", "csi-volume-snapshot", undefined] as const)("drops the field for %s", (backend) => {
    const facts = targetNodeFacts(snapshot({ backend }), form(), guests);

    expect(targetNodeApplies(snapshot({ backend }))).toBe(false);
    expect(facts).toEqual({ applies: false, required: false });
  });

  it("requires a node when the target guest does not exist yet", () => {
    const facts = targetNodeFacts(snapshot({ backend: "s3" }), form({ targetName: "brand-new" }), guests);

    expect(facts).toEqual({ applies: true, required: true });
  });

  it("makes the node optional, and names the default, when the target exists on one", () => {
    const facts = targetNodeFacts(snapshot({ backend: "s3" }), form({ targetName: "demo" }), guests);

    expect(facts.required).toBe(false);
    expect(facts.note).toContain("defaults to node-a");
  });

  it("makes the node optional without naming one when the target exists on no recorded node", () => {
    const facts = targetNodeFacts(snapshot({ backend: "oci" }), form({ targetName: "demo-nodeless" }), guests);

    expect(facts.required).toBe(false);
    expect(facts.note).toContain("resolves the node from it");
  });

  // The in-place target always exists by construction, so the field is optional
  // there whenever the read found the guest.
  it("makes the node optional for an in-place restore over a guest the store holds", () => {
    expect(targetNodeFacts(snapshot({ backend: "s3" }), form({ mode: "in-place" }), guests).required).toBe(false);
  });

  it("blocks the submit when the node is required and empty, naming the field and the reason", () => {
    const reason = restoreSubmitBlockReason(snapshot({ backend: "s3" }), form({ targetName: "brand-new" }), guests);

    expect(reason).toContain("Target node");
    expect(reason).toContain("does not exist yet");
    expect(reason).toContain("s3 restore that names no node");
  });

  it("unblocks the submit once a node is typed", () => {
    expect(
      restoreSubmitBlockReason(
        snapshot({ backend: "s3" }),
        form({ targetName: "brand-new", targetNode: "node-b" }),
        guests,
      ),
    ).toBeUndefined();
  });
});

describe("the submit verdict", () => {
  it("reports the first offending field in a stable order", () => {
    expect(restoreSubmitBlockReason(snapshot(), form({ name: "", targetName: "" }), guests)).toContain("Name");
    expect(restoreSubmitBlockReason(snapshot(), form({ targetName: "" }), guests)).toContain("Target guest");
  });

  it("is silent when the form is valid", () => {
    expect(restoreSubmitBlockReason(snapshot(), form(), guests)).toBeUndefined();
    expect(restoreSubmitBlockReason(snapshot(), form({ mode: "in-place" }), guests)).toBeUndefined();
  });

  // The accent styling Stop uses, for the one mode that kills a running workload.
  it("accents the button in the in-place mode only", () => {
    expect(restoreIsAccented(form({ mode: "in-place" }))).toBe(true);
    expect(restoreIsAccented(form())).toBe(false);
  });
});

// Warnings never block: the store can be stale, the API server is the authority,
// and the 409 path is what a warned submit runs into.
describe("the collision warnings", () => {
  const existingRestores = ["demo-snap-restore-20260830-120000"];

  it("warns about a restore name the store already holds, without making it an error", () => {
    const values = form({ name: "demo-snap-restore-20260830-120000" });

    expect(restoreWarnings(values, existingRestores, guests).name).toContain("already exists");
    expect(restoreErrors(snapshot(), values, guests).name).toBeUndefined();
    expect(restoreSubmitBlockReason(snapshot(), values, guests)).toBeUndefined();
  });

  it("says nothing about a name nothing holds, or when the store answered with nothing", () => {
    expect(restoreWarnings(form(), existingRestores, guests).name).toBeUndefined();
    expect(restoreWarnings(form({ name: "demo-snap-restore-20260830-120000" }), [], guests).name).toBeUndefined();
  });

  it("warns that a clone would collide with a guest that already exists, and names the way out", () => {
    const values = form({ targetName: "demo" });
    const warning = restoreWarnings(values, existingRestores, guests).targetName;

    expect(warning).toContain("demo already exists");
    expect(warning).toContain("overwriteExisting");
    expect(warning).toContain("Restore in place");
    expect(restoreErrors(snapshot(), values, guests).targetName).toBeUndefined();
  });

  it("does not warn about the target in the in-place mode, where the collision is the point", () => {
    expect(restoreWarnings(form({ mode: "in-place", targetName: "demo" }), [], guests).targetName).toBeUndefined();
  });
});

describe("the identity payload", () => {
  const items = (values: Partial<RestoreFormValues>, subject = snapshot()) =>
    restoreIdentityItems(subject, form(values));

  it("sends the trio and the MAC when both checkboxes are on", () => {
    expect(items({})).toEqual(["hostname", "machineId", "sshHostKeys", "macAddresses"]);
  });

  it("sends the MAC alone when the machine identity checkbox is off", () => {
    expect(items({ regenerateMachineIdentity: false })).toEqual(["macAddresses"]);
  });

  it("sends the trio alone when the MAC is free and unchecked", () => {
    expect(items({ rewriteMacAddresses: false }, csiSnapshot)).toEqual(["hostname", "machineId", "sshHostKeys"]);
  });

  it("sends nothing at all when both are off and the MAC is free", () => {
    expect(items({ regenerateMachineIdentity: false, rewriteMacAddresses: false }, csiSnapshot)).toEqual([]);
  });

  // The lock is not decoration: with a memory snapshot the MAC value is forced
  // even if the model somehow holds false, so `regenerate` can never come out
  // empty while the rule binds.
  it("never produces an empty list while the MAC lock is on", () => {
    expect(items({ regenerateMachineIdentity: false, rewriteMacAddresses: false })).toEqual(["macAddresses"]);
  });

  // Upstream DEFINES in-place as a matching name plus an empty regenerate, so an
  // identity block would turn the write into something it does not classify as
  // in-place at all.
  it.each([
    { regenerateMachineIdentity: true, rewriteMacAddresses: true },
    { regenerateMachineIdentity: false, rewriteMacAddresses: true },
    { regenerateMachineIdentity: true, rewriteMacAddresses: false },
    { regenerateMachineIdentity: false, rewriteMacAddresses: false },
  ])("produces nothing in the in-place mode (%o)", (patch) => {
    expect(items({ mode: "in-place", ...patch })).toEqual([]);
  });
});

describe("the payload", () => {
  const spec = (values: Partial<RestoreFormValues>, subject = snapshot()) =>
    restoreCreatePayload(subject, form(values)).spec;

  it("sends the snapshot, the target and the identity of a default clone, and nothing else", () => {
    expect(spec({ targetName: "demo-clone" })).toEqual({
      snapshotRef: { name: "demo-snap" },
      targetGuest: { name: "demo-clone" },
      identity: { regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"] },
    });
  });

  it("omits the identity block entirely when nothing is regenerated", () => {
    expect(
      spec({ regenerateMachineIdentity: false, rewriteMacAddresses: false, targetName: "c" }, csiSnapshot),
    ).not.toHaveProperty("identity");
  });

  // The consent field, on the only path that overwrites anything.
  it("sets overwriteExisting exactly in the in-place mode", () => {
    expect(spec({ mode: "in-place" }).targetGuest).toEqual({ name: "demo", overwriteExisting: true });
    expect(spec({}).targetGuest).not.toHaveProperty("overwriteExisting");
  });

  it("sends no identity with an in-place restore, whatever the checkboxes hold", () => {
    expect(spec({ mode: "in-place", regenerateMachineIdentity: true, rewriteMacAddresses: true })).toEqual({
      snapshotRef: { name: "demo-snap" },
      targetGuest: { name: "demo", overwriteExisting: true },
    });
  });

  // `copy` is the hypervisor default and upstream never propagates it, so sending
  // it would put a field in the object that changes nothing.
  it("sends memoryRestoreMode only for ondemand, and only on a memory snapshot", () => {
    expect(spec({ memoryRestoreMode: "copy" })).not.toHaveProperty("memoryRestoreMode");
    expect(spec({ memoryRestoreMode: "ondemand" }).memoryRestoreMode).toBe("ondemand");
    expect(spec({ memoryRestoreMode: "ondemand" }, csiSnapshot)).not.toHaveProperty("memoryRestoreMode");
  });

  it("sends resumeAfterRestore only when it is off, because true is the schema default", () => {
    expect(spec({})).not.toHaveProperty("resumeAfterRestore");
    expect(spec({ resumeAfterRestore: false }).resumeAfterRestore).toBe(false);
  });

  it("sends the target node only where the controller consults it, and trims it", () => {
    expect(spec({ targetNode: " node-b " }, snapshot({ backend: "s3" })).targetNode).toBe("node-b");
    expect(spec({ targetNode: "node-b" }, snapshot({ backend: "oci" })).targetNode).toBe("node-b");
    expect(spec({ targetNode: "node-b" })).not.toHaveProperty("targetNode");
    expect(spec({ targetNode: "node-b" }, csiSnapshot)).not.toHaveProperty("targetNode");
    expect(spec({ targetNode: "  " }, snapshot({ backend: "s3" }))).not.toHaveProperty("targetNode");
  });

  it("trims the target guest name", () => {
    expect(spec({ targetName: "  demo-clone  " }).targetGuest.name).toBe("demo-clone");
  });

  it("never sends anything the form does not own", () => {
    for (const backend of ["csi-volume-snapshot", "local", "s3", "oci"] as const) {
      const keys = Object.keys(spec({ targetNode: "node-b", memoryRestoreMode: "ondemand" }, snapshot({ backend })));

      for (const key of keys) {
        expect([
          "snapshotRef",
          "targetGuest",
          "identity",
          "memoryRestoreMode",
          "resumeAfterRestore",
          "targetNode",
        ]).toContain(key);
      }
    }
  });
});

describe("the write summary", () => {
  const text = (values: Partial<RestoreFormValues>, source = present(), subject = snapshot()) =>
    summaryText(restoreSummary(subject, form(values), source));

  it("names the one API call it makes, with the namespace and the name", () => {
    expect(restoreSummary(snapshot(), form({ name: "demo-restore" }), present()).write).toBe(
      "Create SwiftRestore vms/demo-restore",
    );
  });

  describe("in place", () => {
    const inPlace = (values: Partial<RestoreFormValues> = {}, source = present()) =>
      text({ mode: "in-place", ...values }, source);

    it("says the pod dies with no grace period and the memory is replaced", () => {
      const summary = inPlace();

      expect(summary).toContain("deleted with no grace period");
      expect(summary).toContain("no graceful shutdown");
      expect(summary).toContain("everything that happened since the capture is lost");
    });

    it("says the disks survive, because that is the half nobody guesses", () => {
      expect(inPlace()).toContain("disks are untouched");
    });

    // The consent field is named in the summary, on the path that overwrites.
    it("names overwriteExisting and calls the dialog the consent", () => {
      expect(inPlace()).toContain("spec.targetGuest.overwriteExisting: true");
      expect(inPlace()).toContain("this dialog is that consent");
    });

    // The one cheap read on open (B3): the summary describes the cluster rather
    // than the object the row was rendered from.
    it("quotes the live phase and launcher pod from the read", () => {
      expect(inPlace()).toContain("The guest is Running and its launcher pod is demo-launcher");
    });

    it("says which facts are missing when the guest could not be read", () => {
      expect(inPlace({}, unreadable)).toContain("could not be read from here");
    });

    it("says a guest with no recorded pod has none, rather than inventing one", () => {
      expect(inPlace({}, present({ podName: undefined }))).toContain("no launcher pod is recorded");
    });

    // The wedge: the restore never touches the policy, and upstream then waits in
    // Restoring with no timeout.
    it("warns that a stopped guest wedges the restore, and names the fix", () => {
      const warnings = restoreSummary(
        snapshot(),
        form({ mode: "in-place" }),
        present({ runPolicy: "Stopped" }),
      ).warnings;

      // The mode control renders the same sentence from the same constant: the
      // summary sits below the fold of a form this tall, and a cost has to be
      // visible where it is chosen.
      expect(warnings).toContain(inPlaceWedgeWarning("demo"));
      expect(warnings.join(" ")).toContain("will wedge");
      expect(warnings.join(" ")).toContain("no timeout");
      expect(warnings.join(" ")).toContain("Start the guest first");
    });

    it("decides the wedge from the mode and the live policy, and from nothing else", () => {
      expect(inPlaceWedges(form({ mode: "in-place" }), present({ runPolicy: "Stopped" }))).toBe(true);
      expect(inPlaceWedges(form({ mode: "in-place" }), present())).toBe(false);
      expect(inPlaceWedges(form({ mode: "in-place" }), present({ runPolicy: undefined }))).toBe(false);
      expect(inPlaceWedges(form({ mode: "in-place" }), unreadable)).toBe(false);
      expect(inPlaceWedges(form({ mode: "in-place" }), absent)).toBe(false);
      expect(inPlaceWedges(form(), present({ runPolicy: "Stopped" }))).toBe(false);
    });

    it("does not warn about the wedge for a guest that is set to run", () => {
      expect(inPlace()).not.toContain("will wedge");
      expect(inPlace({}, present({ runPolicy: undefined }))).not.toContain("will wedge");
    });

    it("does not claim a wedge it could not verify", () => {
      expect(inPlace({}, unreadable)).not.toContain("will wedge");
    });

    it("says none of the clone sentences", () => {
      const summary = inPlace();

      expect(summary).not.toContain("current spec");
      expect(summary).not.toContain("fresh disk");
      expect(summary).not.toContain("deleting the restore");
    });
  });

  describe("clone", () => {
    it("says the clone is built from the source guest's current spec, not the captured one", () => {
      expect(text({})).toContain("created from demo's current spec");
      expect(text({})).toContain("not the spec captured in the snapshot");
    });

    it("says the disk is a fresh clone of the image, on the memory backends only", () => {
      expect(text({})).toContain("fresh disk cloned from the image");
      expect(text({}, present(), csiSnapshot)).not.toContain("fresh disk cloned from the image");
    });

    // The fact upstream documents nowhere, said once here and permanently in the
    // drawer.
    it("discloses that deleting this restore deletes the clone", () => {
      expect(text({ targetName: "demo-clone" })).toContain("deleting the restore later deletes the guest demo-clone");
    });

    it("adds the restored PVC to the ownership sentence on csi, and only there", () => {
      expect(text({}, present(), csiSnapshot)).toContain("restored root PVC too");
      expect(text({})).not.toContain("restored root PVC");
    });

    it("says which run policy the clone starts with", () => {
      expect(text({})).toContain("The clone starts Running");
      expect(text({ resumeAfterRestore: false })).toContain("The clone starts Stopped");
      expect(text({})).toContain("run policy is not inherited");
    });

    it("says the source guest by name when there is one, and stays vague when there is not", () => {
      expect(text({}, present(), snapshot({ sourceGuestName: undefined }))).toContain("the source guest's current");
    });
  });

  describe("both modes", () => {
    it("says a restore of a not-Ready snapshot waits, and says nothing of a Ready one", () => {
      expect(text({}, present(), snapshot({ phase: "Capturing" }))).toContain("Capturing, not Ready");
      expect(text({}, present(), snapshot({ phase: "Capturing" }))).toContain("waits in Pending");
      expect(text({})).not.toContain("waits in Pending");
      expect(text({}, present(), snapshot({ phase: undefined }))).toContain("in no reported phase, not Ready");
    });

    it("warns when the source guest is already gone, on either mode", () => {
      for (const mode of ["in-place", "clone"] as const) {
        const warnings = restoreSummary(snapshot(), form({ mode }), absent).warnings.join(" ");

        expect(warnings).toContain("demo is gone from vms");
        expect(warnings).toContain("warning and not a block");
      }
    });

    it("does not warn about a gone source it could not verify, or one that is there", () => {
      expect(text({}, unreadable)).not.toContain("is gone from");
      expect(text({})).not.toContain("is gone from");
    });

    // The suspected upstream bug, offered anyway because a stopped clone is a real
    // DR shape, but never silently.
    it("warns about the memory-tail hang exactly when resume is off on a memory snapshot", () => {
      expect(restoreSummary(snapshot(), form({ resumeAfterRestore: false }), present()).warnings).toContain(
        memoryTailHangWarning,
      );
      expect(memoryTailHangWarning).toContain("never leaves Restoring");
      expect(restoreSummary(snapshot(), form(), present()).warnings).not.toContain(memoryTailHangWarning);
      expect(restoreSummary(csiSnapshot, form({ resumeAfterRestore: false }), present()).warnings).not.toContain(
        memoryTailHangWarning,
      );
    });
  });
});

describe("the outcome and failure messages", () => {
  it("names the object that was created", () => {
    expect(restoreSuccessMessage("demo-snap-restore-20260830-140509")).toBe(
      "SwiftRestore demo-snap-restore-20260830-140509 created",
    );
  });

  const context = { namespace: "vms", name: "demo-restore" };

  it("turns the 409 of an ignored collision warning into a rename instruction", () => {
    const alreadyExists = 'swiftrestores.snapshot.kubeswift.io "demo-restore" already exists';
    const message = restoreCreateFailureMessage({ code: 409, message: alreadyExists, alreadyNotified: false }, context);

    expect(message).toContain("already exists in the namespace vms");
    expect(message).toContain("Change the name");
    expect(message).toContain(alreadyExists);
  });

  it("prefixes a 403 with the verb, the resource and the namespace", () => {
    const message = restoreCreateFailureMessage(
      { code: 403, message: "is forbidden", alreadyNotified: false },
      context,
    );

    expect(message).toContain("not allowed to create swiftrestores in the namespace vms");
  });

  it("says what a 404 on a create really means", () => {
    const message = restoreCreateFailureMessage({ code: 404, message: "not found", alreadyNotified: false }, context);

    expect(message).toContain("the namespace vms or the SwiftRestore CRD is gone");
  });

  it("passes anything else through exactly as the API server said it", () => {
    const webhook = "admission webhook denied the request: targetGuest.name must not equal snapshotRef.name";

    expect(restoreCreateFailureMessage({ code: 422, message: webhook, alreadyNotified: false }, context)).toBe(webhook);
  });
});

// The drawer's On Delete row: what deleting THIS restore destroys, computed from
// its own mode rather than stated in the abstract.
describe("the delete consequences", () => {
  it("says an in-place restore owns nothing", () => {
    const row = restoreDeleteRow({ mode: "In-place", guestName: "demo", snapshotBackend: "local" });

    expect(row.deletedGuest).toBeUndefined();
    expect(row.sentences.join(" ")).toContain("deletes nothing else");
    expect(row.sentences.join(" ")).toContain("wrote over a guest that already existed");
  });

  // The claim upstream documents nowhere: the controller makes the restored guest
  // a child of the SwiftRestore.
  it("names the guest a clone restore takes with it, for the drawer to link", () => {
    const row = restoreDeleteRow({ mode: "Clone", guestName: "demo-clone", snapshotBackend: "local" });

    expect(row.deletedGuest).toBe("demo-clone");
    expect(row.sentences.join(" ")).toContain("is deleted with this SwiftRestore");
    expect(row.sentences.join(" ")).toContain("garbage collector");
  });

  it("adds the restored PVC on a csi restore, and only there", () => {
    expect(
      restoreDeleteRow({
        mode: "Clone",
        guestName: "demo-clone",
        snapshotBackend: "csi-volume-snapshot",
      }).sentences.join(" "),
    ).toContain("restored root PVC goes with it");

    for (const backend of ["local", "s3", "oci"] as SwiftSnapshotBackendType[]) {
      expect(
        restoreDeleteRow({ mode: "Clone", guestName: "demo-clone", snapshotBackend: backend }).sentences.join(" "),
      ).not.toContain("PVC");
    }
  });

  it("admits when the snapshot could not be read rather than guessing the disk", () => {
    const row = restoreDeleteRow({ mode: "Clone", guestName: "demo-clone" });

    expect(row.sentences.join(" ")).toContain("could not be read from here");
  });

  it("says what it can when the restore names no guest at all", () => {
    const row = restoreDeleteRow({ mode: "Clone", snapshotBackend: "local" });

    expect(row.deletedGuest).toBeUndefined();
    expect(row.sentences.join(" ")).toContain("names no guest");
  });
});

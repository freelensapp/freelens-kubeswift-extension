import { describe, expect, it } from "vitest";
import {
  autoPrediction,
  autoPredictionLine,
  canMigrate,
  defaultMigrationForm,
  defaultMigrationName,
  effectiveMigrationMode,
  freshIpFact,
  inFlightMigrations,
  inFlightWarning,
  ipConsentApplies,
  liveFieldsApply,
  liveModeGuard,
  migrationCreateFailureMessage,
  migrationCreatePayload,
  migrationDeleteRow,
  migrationErrors,
  migrationIsAccented,
  migrationModeChoices,
  migrationStage,
  migrationSubmitBlockReason,
  migrationSuccessMessage,
  migrationSummary,
  migrationWarnings,
  nodeChoices,
  noNodeReason,
  parseGoDuration,
  storageCapability,
} from "./migration-create";

import type { SwiftMigrationMode } from "../api/kubeswift/swiftmigration-v1alpha1";
import type {
  MigrationFormValues,
  MigrationGuestFacts,
  MigrationGuestSpecFacts,
  MigrationGuestStatusFacts,
  MigrationInputs,
  NodeFacts,
} from "./migration-create";

const clickedAt = new Date(2026, 7, 30, 14, 5, 9);

/** The status of a guest that is running with a launcher pod, on node-a. */
const running: MigrationGuestStatusFacts = {
  phase: "Running",
  podRef: { name: "demo-launcher" },
  nodeName: "node-a",
};

/** The status of a guest that is stopped, with no pod and no node. */
const stopped: MigrationGuestStatusFacts = { phase: "Stopped" };

const guest = (
  spec: MigrationGuestSpecFacts = {},
  status: MigrationGuestStatusFacts = running,
): MigrationGuestFacts => ({
  name: "demo",
  namespace: "vms",
  spec: { guestClassRef: { name: "small" }, imageRef: { name: "ubuntu" }, ...spec } as MigrationGuestSpecFacts,
  status,
});

/** Storage two launcher pods can share, which is what the live path needs. */
const sharedStorage = { accessMode: "ReadWriteMany", volumeMode: "Block" };

/** The storage most clusters actually have, and the one drift D1 walks into. */
const rwoStorage = { accessMode: "ReadWriteOnce", volumeMode: "Filesystem" };

const nodes: NodeFacts[] = [
  { name: "node-a", ready: true, schedulable: true },
  { name: "node-b", ready: true, schedulable: true },
];

const inputs = (patch: Partial<MigrationInputs> = {}): MigrationInputs => ({
  guest: guest(),
  guestClass: { name: "small", storage: sharedStorage },
  nodes,
  nodesUnverified: false,
  inFlight: [],
  existingNames: [],
  ...patch,
});

/** The form as the dialog opens it, at a fixed instant, with a node chosen. */
const form = (patch: Partial<MigrationFormValues> = {}): MigrationFormValues => ({
  ...defaultMigrationForm(guest(), clickedAt),
  targetNode: "node-b",
  ...patch,
});

const summaryText = (facts: { notes: string[]; warnings: string[] }) => [...facts.notes, ...facts.warnings].join(" ");

const modeGuards = (subject: MigrationInputs) =>
  Object.fromEntries(migrationModeChoices(subject).map((choice) => [choice.mode, choice.guard.enabled]));

describe("canMigrate", () => {
  // The one precondition that fails cleanly everywhere: the webhook refuses it
  // and the controller refuses it again.
  it("refuses a guest whose migration is disabled, naming both refusals", () => {
    const verdict = canMigrate(guest({ migration: { enabled: false } }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("spec.migration.enabled is false");
    expect(verdict.reason).toContain("admission");
    expect(verdict.reason).toContain("controller");
  });

  // The webhook-only rule, which nothing re-checks: with the webhook off - the
  // default - this guard is the only thing between an operator and a migration
  // that cannot work.
  it("refuses an SR-IOV guest, naming the interface and the missing re-check", () => {
    const verdict = canMigrate(guest({ interfaces: [{ name: "vf0", type: "sriov" }] }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("SR-IOV");
    expect(verdict.reason).toContain("every mode");
    expect(verdict.reason).toContain("vf0");
    expect(verdict.reason).toContain("webhook is off");
  });

  it("names an unnamed SR-IOV interface by its position", () => {
    expect(canMigrate(guest({ interfaces: [{ type: "sriov" }] })).reason).toContain("interface 1");
  });

  it.each([
    ["a plain running guest", guest()],
    ["a stopped guest", guest({}, stopped)],
    ["a guest with no phase at all", guest({}, {})],
    ["a guest with migration.enabled true", guest({ migration: { enabled: true } })],
    ["a guest with a drain policy but no enabled flag", guest({ migration: {} })],
    ["a GPU guest", guest({ gpuProfileRef: { name: "hgx" } })],
    ["a guest with a node-local filesystem", guest({ filesystems: [{ name: "share" }] })],
    ["a guest with a bridge interface", guest({ interfaces: [{ name: "eth0", type: "bridge" }] })],
  ])("offers the action for %s", (_label, subject) => {
    expect(canMigrate(subject).enabled).toBe(true);
  });
});

// W4, written as a loop over a table rather than one assertion per case, so a
// future branch cannot be added without a reason.
describe("the guard invariant", () => {
  const subjects: MigrationInputs[] = [
    inputs(),
    inputs({ guest: guest({}, stopped) }),
    inputs({ guest: guest({}, { phase: "Running" }) }),
    inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }) }),
    inputs({ guest: guest({ gpuResourceClaim: { requestName: "gpu" } }) }),
    inputs({ guest: guest({ filesystems: [{ name: "share" }] }) }),
    inputs({ guest: guest({ vhostUserDevices: [{ name: "vblk" }] }) }),
    inputs({ guestClass: { name: "small", storage: rwoStorage } }),
    inputs({ guestClass: undefined }),
    inputs({ guest: guest({ kernelRef: { name: "6.12" } }), guestClass: { name: "small", storage: rwoStorage } }),
    inputs({ guest: guest({ migration: { enabled: false } }) }),
    inputs({ guest: guest({ interfaces: [{ name: "vf0", type: "sriov" }] }) }),
  ];

  it.each(subjects)("never disables anything without saying why (%#)", (subject) => {
    const verdict = canMigrate(subject.guest);

    if (!verdict.enabled) {
      expect(verdict.reason.length).toBeGreaterThan(0);
    }

    for (const choice of migrationModeChoices(subject)) {
      expect(choice.note.length).toBeGreaterThan(0);

      if (!choice.guard.enabled) {
        expect(choice.guard.reason.length).toBeGreaterThan(0);
      }
    }

    for (const choice of nodeChoices(subject)) {
      if (!choice.guard.enabled) {
        expect(choice.guard.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("names the three modes, in the order the dialog offers them", () => {
    expect(migrationModeChoices(inputs()).map((choice) => choice.mode)).toEqual(["auto", "live", "offline"]);
  });
});

describe("the storage capability", () => {
  it("reads ReadWriteMany and Block off the class as live-capable", () => {
    const capability = storageCapability(inputs());

    expect(capability).toMatchObject({ resolved: true, liveCapable: true, exempt: false });
    expect(capability.accessMode).toBe("ReadWriteMany");
  });

  it("refuses ReadWriteOnce storage, resolved and certain", () => {
    const capability = storageCapability(inputs({ guestClass: { name: "small", storage: rwoStorage } }));

    expect(capability).toMatchObject({ resolved: true, liveCapable: false });
    expect(capability.volumeMode).toBe("Filesystem");
  });

  it("refuses ReadWriteMany on a Filesystem volume: both halves are required", () => {
    const capability = storageCapability(
      inputs({ guestClass: { name: "small", storage: { accessMode: "ReadWriteMany", volumeMode: "Filesystem" } } }),
    );

    expect(capability).toMatchObject({ resolved: true, liveCapable: false });
  });

  // The merge the guest controller itself performs: the guest wins per field.
  it("lets the guest's own spec override the class, field by field", () => {
    const capability = storageCapability(
      inputs({
        guest: guest({ storage: { accessMode: "ReadWriteOnce" } }),
        guestClass: { name: "small", storage: sharedStorage },
      }),
    );

    expect(capability).toMatchObject({ accessMode: "ReadWriteOnce", volumeMode: "Block", liveCapable: false });
  });

  it("resolves from the guest alone when the class carries no storage", () => {
    const capability = storageCapability(
      inputs({ guest: guest({ storage: sharedStorage }), guestClass: { name: "small" } }),
    );

    expect(capability).toMatchObject({ resolved: true, liveCapable: true });
  });

  it("stays unresolved when the class could not be read", () => {
    expect(storageCapability(inputs({ guestClass: undefined }))).toMatchObject({ resolved: false, liveCapable: false });
  });

  it("stays unresolved when only one of the two fields is known", () => {
    expect(
      storageCapability(inputs({ guestClass: { name: "small", storage: { accessMode: "ReadWriteMany" } } })),
    ).toMatchObject({ resolved: false, liveCapable: false });
  });

  // Upstream exempts kernel-boot guests: they do not boot from a cloned root
  // disk, so there is no volume for two launcher pods to contend for.
  it("exempts a kernel-boot guest, whatever the storage says", () => {
    const capability = storageCapability(
      inputs({ guest: guest({ kernelRef: { name: "6.12" } }), guestClass: { name: "small", storage: rwoStorage } }),
    );

    expect(capability).toMatchObject({ exempt: true, resolved: true, liveCapable: true });
  });
});

describe("the mode availability", () => {
  it("offers all three modes for a running guest on shared storage", () => {
    expect(modeGuards(inputs())).toEqual({ auto: true, live: true, offline: true });
  });

  it("refuses live for a stopped guest, and says it can only move offline", () => {
    const verdict = liveModeGuard(inputs({ guest: guest({}, stopped) }));

    expect(modeGuards(inputs({ guest: guest({}, stopped) }))).toEqual({ auto: true, live: false, offline: true });
    expect(verdict.reason).toContain("is Stopped");
    expect(verdict.reason).toContain("non-running guest");
    expect(verdict.reason).toContain("only move offline");
  });

  it("refuses live when no launcher pod is recorded, even in the Running phase", () => {
    const verdict = liveModeGuard(inputs({ guest: guest({}, { phase: "Running", nodeName: "node-a" }) }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("no launcher pod is recorded");
  });

  it("says the guest has no phase yet when it has none", () => {
    expect(liveModeGuard(inputs({ guest: guest({}, {}) })).reason).toContain("has no phase yet");
  });

  it("refuses live for a VFIO guest, naming the profile and the offline path", () => {
    const verdict = liveModeGuard(inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }) }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("VFIO device");
    expect(verdict.reason).toContain("hgx");
    expect(verdict.reason).toContain("released on the source and re-reserved");
  });

  it("refuses live for a guest holding a GPU through a resource claim", () => {
    expect(liveModeGuard(inputs({ guest: guest({ gpuResourceClaim: { requestName: "gpu" } }) })).reason).toContain(
      "resource claim",
    );
  });

  it("refuses live for a node-local filesystem, naming it", () => {
    const verdict = liveModeGuard(inputs({ guest: guest({ filesystems: [{ name: "share" }] }) }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("node-local virtio backend");
    expect(verdict.reason).toContain("the filesystem share");
  });

  it("refuses live for a vhost-user device, naming it", () => {
    expect(liveModeGuard(inputs({ guest: guest({ vhostUserDevices: [{ name: "vblk" }] }) })).reason).toContain(
      "the vhost-user device vblk",
    );
  });

  // The rule upstream applies only at admission, to an explicit live mode, in a
  // webhook that ships disabled.
  it("refuses live on storage no two nodes can hold, and says who enforces it", () => {
    const subject = inputs({ guestClass: { name: "small", storage: rwoStorage } });
    const verdict = liveModeGuard(subject);

    expect(modeGuards(subject)).toEqual({ auto: true, live: false, offline: true });
    expect(verdict.reason).toContain("ReadWriteMany and Block");
    expect(verdict.reason).toContain("ReadWriteOnce/Filesystem");
    expect(verdict.reason).toContain("ships disabled");
  });

  it("keeps live enabled when the storage cannot be resolved at all", () => {
    expect(modeGuards(inputs({ guestClass: undefined }))).toEqual({ auto: true, live: true, offline: true });
  });

  it("keeps live enabled for a kernel-boot guest on ReadWriteOnce storage", () => {
    expect(
      modeGuards(
        inputs({ guest: guest({ kernelRef: { name: "6.12" } }), guestClass: { name: "small", storage: rwoStorage } }),
      ),
    ).toEqual({ auto: true, live: true, offline: true });
  });

  // The order is the one an operator can act on first.
  it("reports the live-state refusal before the shape refusals", () => {
    const verdict = liveModeGuard(inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }, stopped) }));

    expect(verdict.reason).toContain("non-running guest");
    expect(verdict.reason).not.toContain("VFIO");
  });

  it("reports the VFIO refusal before the storage one", () => {
    const verdict = liveModeGuard(
      inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }), guestClass: { name: "small", storage: rwoStorage } }),
    );

    expect(verdict.reason).toContain("VFIO");
    expect(verdict.reason).not.toContain("ReadWriteMany and Block");
  });

  // The control stays short and the sentence goes under it: an option label
  // that is a paragraph is unreadable in every theme.
  it("labels auto with what it resolves to, and the other two with themselves", () => {
    expect(migrationModeChoices(inputs()).map((choice) => choice.label)).toEqual([
      "auto (resolves to: live)",
      "live",
      "offline",
    ]);
    expect(migrationModeChoices(inputs({ guest: guest({}, stopped) }))[0].label).toBe("auto (resolves to: offline)");
  });

  it("names what each mode means for this guest rather than what the enum means", () => {
    const choices = migrationModeChoices(inputs(), "node-b");

    expect(choices.find((choice) => choice.mode === "offline")?.note).toContain("reattached on node-b");
    expect(choices.find((choice) => choice.mode === "live")?.note).toContain("pre-copied to node-b");
    expect(choices.find((choice) => choice.mode === "auto")?.note).toContain("auto will resolve to: live");
  });

  it("tells a stopped guest that offline means booting it on the target", () => {
    const choices = migrationModeChoices(inputs({ guest: guest({}, stopped) }), "node-b");

    expect(choices.find((choice) => choice.mode === "offline")?.note).toContain("already stopped");
    expect(choices.find((choice) => choice.mode === "offline")?.note).toContain("starts it there");
  });
});

describe("the auto prediction", () => {
  it("predicts live for an eligible guest, and states the assumption it rests on", () => {
    const resolution = autoPrediction(inputs());

    expect(resolution.mode).toBe("live");
    expect(resolution.assumesNoUdn).toBe(true);
    expect(autoPredictionLine(resolution)).toContain("auto will resolve to: live");
    expect(autoPredictionLine(resolution)).toContain("user-defined network");
  });

  it("predicts offline for a stopped guest", () => {
    const resolution = autoPrediction(inputs({ guest: guest({}, stopped) }));

    expect(resolution.mode).toBe("offline");
    expect(resolution.because).toContain("is Stopped");
    expect(resolution.assumesNoUdn).toBe(false);
  });

  it("predicts offline for a VFIO guest", () => {
    expect(autoPrediction(inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }) }))).toMatchObject({
      mode: "offline",
      because: "this guest holds a VFIO device",
    });
  });

  it("predicts offline for a node-local virtio backend, naming it", () => {
    const resolution = autoPrediction(inputs({ guest: guest({ vhostUserDevices: [{ name: "vblk" }] }) }));

    expect(resolution.mode).toBe("offline");
    expect(resolution.because).toContain("the vhost-user device vblk");
  });

  // The resolver reads the field, not the dialog: this is what upstream does for
  // a client that does not consent - `swiftctl`, or a hand-written manifest.
  it("predicts offline for a default-networking guest whose migration does not consent", () => {
    const resolution = autoPrediction(inputs(), false);

    expect(resolution.mode).toBe("offline");
    expect(resolution.because).toContain("does not consent");
  });

  it("predicts live for a guest whose address survives, with or without consent", () => {
    const attached = guest({ interfaces: [{ name: "eth0", primary: true, networkRef: { name: "blue" } }] });

    expect(autoPrediction(inputs({ guest: attached }), false).mode).toBe("live");
  });

  it("keeps upstream's own order: VFIO outranks the virtio backends", () => {
    const resolution = autoPrediction(
      inputs({ guest: guest({ gpuProfileRef: { name: "hgx" }, filesystems: [{ name: "share" }] }) }),
    );

    expect(resolution.because).toBe("this guest holds a VFIO device");
  });

  // Upstream's resolver never consults storage, so a prediction that did would
  // be a prediction of something other than what the controller will do.
  it("predicts live on ReadWriteOnce storage, which is exactly the drift", () => {
    expect(autoPrediction(inputs({ guestClass: { name: "small", storage: rwoStorage } })).mode).toBe("live");
  });

  it("resolves the effective mode from the prediction, and from the selection otherwise", () => {
    expect(effectiveMigrationMode(inputs(), "auto")).toBe("live");
    expect(effectiveMigrationMode(inputs({ guest: guest({}, stopped) }), "auto")).toBe("offline");
    expect(effectiveMigrationMode(inputs(), "offline")).toBe("offline");
    expect(effectiveMigrationMode(inputs({ guest: guest({}, stopped) }), "live")).toBe("live");
  });

  // The D1 closure: the one place this dialog blocks a submit upstream accepts.
  it("blocks the submit when auto resolves to live and the storage cannot carry it", () => {
    const subject = inputs({ guestClass: { name: "small", storage: rwoStorage } });
    const errors = migrationErrors(subject, form({ mode: "auto" }));

    expect(errors.mode).toContain("auto will resolve to live");
    expect(errors.mode).toContain("two launcher pods would contend for this guest's ReadWriteOnce/Filesystem volume");
    expect(errors.mode).toContain("Pick offline, or fix the storage");
    expect(migrationSubmitBlockReason(subject, form({ mode: "auto" }))).toContain("Mode: auto will resolve to live");
    // The prediction line itself is rendered under the control, and the whole
    // storage rule travels with the refused live option: the block says neither
    // again, it says the one thing they do not - and the choice.
    expect(errors.mode).not.toContain("user-defined network");
    expect(errors.mode).not.toContain("ships disabled");
  });

  // A freshly opened dialog on this guest has no node either, and picking one
  // would not fix the mode: the message that names the choice comes first.
  it("names the mode before the required node when both are wrong at once", () => {
    const subject = inputs({ guestClass: { name: "small", storage: rwoStorage } });

    expect(migrationSubmitBlockReason(subject, form({ mode: "auto", targetNode: "" }))).toContain(
      "Mode: auto will resolve to live",
    );
  });

  it("does not block auto when the prediction is offline, whatever the storage", () => {
    const subject = inputs({ guest: guest({}, stopped), guestClass: { name: "small", storage: rwoStorage } });

    expect(migrationErrors(subject, form({ mode: "auto" })).mode).toBeUndefined();
    expect(migrationSubmitBlockReason(subject, form({ mode: "auto" }))).toBeUndefined();
  });

  it("does not block auto when the storage is unresolvable: a failed read never blocks", () => {
    expect(migrationErrors(inputs({ guestClass: undefined }), form({ mode: "auto" })).mode).toBeUndefined();
  });

  it("does not block auto on storage a live migration can use", () => {
    expect(migrationErrors(inputs(), form({ mode: "auto" })).mode).toBeUndefined();
  });

  it("reports the live guard's own reason when live is selected and refused", () => {
    const subject = inputs({ guest: guest({}, stopped) });

    expect(migrationErrors(subject, form({ mode: "live" })).mode).toContain("non-running guest");
  });
});

describe("the IP consent", () => {
  it("applies to a guest with no interfaces at all: that is default networking", () => {
    expect(ipConsentApplies(guest())).toBe(true);
  });

  it("applies to a primary interface with no networkRef", () => {
    expect(ipConsentApplies(guest({ interfaces: [{ name: "eth0", primary: true }] }))).toBe(true);
  });

  it("does not apply when the primary interface has a networkRef", () => {
    expect(
      ipConsentApplies(guest({ interfaces: [{ name: "eth0", primary: true, networkRef: { name: "blue" } }] })),
    ).toBe(false);
  });

  it("reads the first interface when none is marked primary", () => {
    expect(
      ipConsentApplies(guest({ interfaces: [{ name: "eth0" }, { name: "eth1", networkRef: { name: "blue" } }] })),
    ).toBe(true);
  });

  it("reads the marked primary rather than the first", () => {
    expect(
      ipConsentApplies(
        guest({ interfaces: [{ name: "eth0" }, { name: "eth1", primary: true, networkRef: { name: "blue" } }] }),
      ),
    ).toBe(false);
  });
});

describe("the node options", () => {
  const cluster: NodeFacts[] = [
    { name: "node-a", ready: true, schedulable: true },
    { name: "node-b", ready: true, schedulable: true },
    { name: "node-c", ready: false, schedulable: true },
    { name: "node-d", ready: true, schedulable: false },
  ];

  it("offers the Ready, schedulable nodes that are not this guest's own", () => {
    expect(nodeChoices(inputs({ nodes: cluster })).map((choice) => choice.name)).toEqual(["node-b"]);
  });

  it("excludes the node pinned in the spec when the status reports none", () => {
    const subject = inputs({
      guest: guest({ nodeName: "node-b" }, { phase: "Running", podRef: { name: "p" } }),
      nodes: cluster,
    });

    expect(nodeChoices(subject).map((choice) => choice.name)).toEqual(["node-a"]);
  });

  it("offers every Ready node when the guest is on none of them", () => {
    expect(nodeChoices(inputs({ guest: guest({}, stopped), nodes: cluster })).map((choice) => choice.name)).toEqual([
      "node-a",
      "node-b",
    ]);
  });

  it("disables a node that cannot run a kernel-boot guest, with the label in the reason", () => {
    const subject = inputs({
      guest: guest({ kernelRef: { name: "6.12" } }, stopped),
      nodes: [
        { name: "node-a", ready: true, schedulable: true },
        { name: "node-b", ready: true, schedulable: true, labels: { "kubeswift.io/kernel-node": "true" } },
      ],
    });
    const choices = nodeChoices(subject);

    expect(choices.find((choice) => choice.name === "node-b")?.guard.enabled).toBe(true);

    const refused = choices.find((choice) => choice.name === "node-a");

    expect(refused?.guard.enabled).toBe(false);
    expect(refused?.guard.reason).toContain("kubeswift.io/kernel-node: true");
    expect(refused?.guard.reason).toContain("6.12");
  });

  it("does not apply the kernel-node rule to a disk-boot guest", () => {
    expect(nodeChoices(inputs({ nodes: cluster })).every((choice) => choice.guard.enabled)).toBe(true);
  });

  it("counts what it dropped when nothing is left, rather than showing an empty control", () => {
    const reason = noNodeReason(inputs({ nodes: [{ name: "node-a", ready: true, schedulable: true }] }));

    expect(reason).toContain("1 node");
    expect(reason).toContain("node-a is the node this guest is already on");
  });

  it("names the not-Ready and cordoned counts too", () => {
    const reason = noNodeReason(
      inputs({
        nodes: [
          { name: "node-a", ready: true, schedulable: true },
          { name: "node-c", ready: false, schedulable: true },
          { name: "node-d", ready: true, schedulable: false },
        ],
      }),
    );

    expect(reason).toContain("3 nodes");
    expect(reason).toContain("1 is not Ready");
    expect(reason).toContain("1 is cordoned");
  });

  it("requires a target node, and says why the picker is empty when it is", () => {
    const empty = inputs({ nodes: [{ name: "node-a", ready: true, schedulable: true }] });

    expect(migrationErrors(inputs(), form({ targetNode: "" })).targetNode).toContain("A target node is required");
    expect(migrationErrors(empty, form({ targetNode: "" })).targetNode).toContain("already on");
    expect(migrationSubmitBlockReason(inputs(), form({ targetNode: "" }))).toContain("Target node:");
  });

  it("rejects a chosen node that cannot run this guest's kernel", () => {
    const subject = inputs({
      guest: guest({ kernelRef: { name: "6.12" } }, stopped),
      nodes: [{ name: "node-b", ready: true, schedulable: true }],
    });

    expect(migrationErrors(subject, form({ targetNode: "node-b" })).targetNode).toContain("kubeswift.io/kernel-node");
  });

  it("accepts a typed node the list does not contain: a refused read never blocks", () => {
    expect(
      migrationErrors(inputs({ nodes: [], nodesUnverified: true }), form({ targetNode: "node-z" })).targetNode,
    ).toBeUndefined();
  });
});

describe("the webhook bounds, mirrored inline", () => {
  const live = form({ mode: "live" });

  it.each([
    ["59s", "at least 60s"],
    ["1s", "at least 60s"],
    ["24h1m", "at most 24h"],
    ["48h", "at most 24h"],
  ])("refuses the timeout %s", (timeout, expected) => {
    expect(migrationErrors(inputs(), { ...live, timeout })?.timeout).toContain(expected);
  });

  it.each(["60s", "1m", "30m", "1h30m", "24h", ""])("accepts the timeout %s", (timeout) => {
    expect(migrationErrors(inputs(), { ...live, timeout }).timeout).toBeUndefined();
  });

  it.each(["7d", "30", "abc", "1h 30m"])("reports the format of the timeout %s", (timeout) => {
    expect(migrationErrors(inputs(), { ...live, timeout }).timeout).toContain("Go duration");
  });

  // Option dropping applied to validation: the field does not exist in offline
  // mode, so a value left behind by a mode switch is not a submit blocker.
  it("ignores the timeout entirely in offline mode, where upstream never reads it", () => {
    const offline = form({ mode: "offline", timeout: "1s" });

    expect(migrationErrors(inputs(), offline).timeout).toBeUndefined();
    expect(migrationSubmitBlockReason(inputs(), offline)).toBeUndefined();
  });

  it("validates the timeout of an auto migration that will resolve to live", () => {
    expect(migrationErrors(inputs(), form({ mode: "auto", timeout: "1s" })).timeout).toContain("at least 60s");
  });

  it("ignores the timeout of an auto migration that will resolve to offline", () => {
    expect(
      migrationErrors(inputs({ guest: guest({}, stopped) }), form({ mode: "auto", timeout: "1s" })).timeout,
    ).toBeUndefined();
  });

  it.each(["9ms", "1ms", "10s1ms", "30s"])("refuses the downtime target %s", (downtimeTarget) => {
    expect(migrationErrors(inputs(), { ...live, downtimeTarget }).downtimeTarget).toContain("10ms and 10s");
  });

  it.each(["10ms", "500ms", "1s", "10s", ""])("accepts the downtime target %s", (downtimeTarget) => {
    expect(migrationErrors(inputs(), { ...live, downtimeTarget }).downtimeTarget).toBeUndefined();
  });

  it("reports the format of an unparseable downtime target", () => {
    expect(migrationErrors(inputs(), { ...live, downtimeTarget: "500" }).downtimeTarget).toContain("Go duration");
  });

  it.each(["0", "1", "16", ""])("accepts %s parallel connections", (parallelConnections) => {
    expect(migrationErrors(inputs(), { ...live, parallelConnections }).parallelConnections).toBeUndefined();
  });

  it.each(["17", "-1", "2.5", "two", "1e2"])("refuses %s parallel connections", (parallelConnections) => {
    expect(migrationErrors(inputs(), { ...live, parallelConnections }).parallelConnections).toContain(
      "between 0 and 16",
    );
  });

  it("does not validate the live-only numbers in offline mode", () => {
    const offline = form({ mode: "offline", downtimeTarget: "1ms", parallelConnections: "99" });

    expect(migrationErrors(inputs(), offline)).toEqual({});
  });

  it("accepts a reason of exactly 256 characters and refuses 257", () => {
    expect(migrationErrors(inputs(), form({ reason: "a".repeat(256) })).reason).toBeUndefined();
    expect(migrationErrors(inputs(), form({ reason: "a".repeat(257) })).reason).toContain("at most 256");
  });

  it("refuses control characters in the reason, and allows spaces and tabs", () => {
    expect(migrationErrors(inputs(), form({ reason: "node\u0000maintenance" })).reason).toContain("control characters");
    expect(migrationErrors(inputs(), form({ reason: "line\u000abreak" })).reason).toContain("control characters");
    expect(migrationErrors(inputs(), form({ reason: "node maintenance\tplanned" })).reason).toBeUndefined();
  });

  it.each(["0s", "-1h", "0ms"])("refuses the TTL %s as not positive", (ttl) => {
    expect(migrationErrors(inputs(), form({ ttl })).ttl).toContain("must be positive");
  });

  it.each(["1s", "24h", "168h", ""])("accepts the TTL %s", (ttl) => {
    expect(migrationErrors(inputs(), form({ ttl })).ttl).toBeUndefined();
  });

  it("reports the format of a TTL in days, and says days are not a unit", () => {
    expect(migrationErrors(inputs(), form({ ttl: "7d" })).ttl).toContain("days are not one of");
  });

  it("refuses a name the API server would refuse", () => {
    expect(migrationErrors(inputs(), form({ name: "" })).name).toContain("required");
    expect(migrationErrors(inputs(), form({ name: "Demo-Migrate" })).name).toContain("lowercase");
  });

  it("names the field and the reason on the submit button, in the dialog's own order", () => {
    const broken = form({ targetNode: "", name: "", ttl: "7d" });

    expect(migrationSubmitBlockReason(inputs(), broken)).toContain("Target node:");
    expect(migrationSubmitBlockReason(inputs(), { ...broken, targetNode: "node-b" })).toContain("Name:");
    expect(migrationSubmitBlockReason(inputs(), form({ ttl: "7d" }))).toContain("TTL:");
  });

  it("sends the form when nothing is wrong with it", () => {
    expect(migrationSubmitBlockReason(inputs(), form())).toBeUndefined();
  });
});

describe("parseGoDuration", () => {
  it.each([
    ["30m", 1_800_000],
    ["1h30m", 5_400_000],
    ["500ms", 500],
    ["1s", 1000],
    ["1500us", 1.5],
    ["1000000ns", 1],
    ["-1h", -3_600_000],
    ["+2h", 7_200_000],
    ["1.5s", 1500],
  ])("parses %s", (value, expected) => {
    expect(parseGoDuration(value)).toBeCloseTo(expected, 6);
  });

  it.each(["", "7d", "30", "h", "1 h", "1hh", "abc"])("refuses %s", (value) => {
    expect(parseGoDuration(value)).toBeUndefined();
  });
});

describe("the name and the collision warning", () => {
  it("defaults to the guest's name plus the wall-clock time of the click", () => {
    expect(defaultMigrationName("demo", clickedAt)).toBe("demo-migrate-140509");
    expect(defaultMigrationForm(guest(), clickedAt)).toMatchObject({ name: "demo-migrate-140509", mode: "auto" });
  });

  it("opens with no node, no reason and no ttl", () => {
    expect(defaultMigrationForm(guest(), clickedAt)).toMatchObject({
      targetNode: "",
      timeout: "",
      downtimeTarget: "",
      parallelConnections: "",
      reason: "",
      ttl: "",
    });
  });

  it("warns on a name the store already holds, and does not block", () => {
    const subject = inputs({ existingNames: ["demo-migrate-140509"] });

    expect(migrationWarnings(subject, form()).name).toContain("already exists");
    expect(migrationSubmitBlockReason(subject, form())).toBeUndefined();
  });

  it("says nothing about a name nothing holds", () => {
    expect(migrationWarnings(inputs(), form())).toEqual({});
  });
});

describe("the in-flight warning", () => {
  const stored = [
    { name: "demo-migrate-090000", guestName: "demo", phase: "Preparing", mode: "offline" as SwiftMigrationMode },
    { name: "demo-migrate-080000", guestName: "demo", phase: "Completed", mode: "offline" as SwiftMigrationMode },
    { name: "other-migrate-090000", guestName: "other", phase: "Preparing", mode: "live" as SwiftMigrationMode },
  ];

  it("matches the unfinished migrations of this guest only", () => {
    expect(inFlightMigrations("demo", stored).map((migration) => migration.name)).toEqual(["demo-migrate-090000"]);
  });

  it.each(["Completed", "Failed", "Cancelled"])("ignores a %s migration", (phase) => {
    expect(inFlightMigrations("demo", [{ name: "m", guestName: "demo", phase }])).toEqual([]);
  });

  it.each(["Pending", "Validating", "Preparing", "StopAndCopy", "Resuming", undefined])(
    "matches a %s migration",
    (phase) => {
      expect(inFlightMigrations("demo", [{ name: "m", guestName: "demo", phase }])).toHaveLength(1);
    },
  );

  it("says the offline conflict is a claim conflict at Preparing", () => {
    const warning = inFlightWarning({ name: "m", phase: "Preparing", mode: "offline" });

    expect(warning).toContain("is Preparing");
    expect(warning).toContain("claim conflict");
    expect(warning).toContain("warning and not a block");
  });

  it("says a live migration is guarded by nothing at all", () => {
    const warning = inFlightWarning({ name: "m", phase: "StopAndCopy", mode: "live" });

    expect(warning).toContain("no admission guard");
    expect(warning).toContain("not refused anywhere");
  });

  it("handles a migration that has not reported a phase yet", () => {
    expect(inFlightWarning({ name: "m" })).toContain("has not reported a phase yet");
  });

  it("carries the warning into the summary, and never into the submit verdict", () => {
    const subject = inputs({ inFlight: [{ name: "demo-migrate-090000", phase: "Preparing", mode: "offline" }] });

    expect(summaryText(migrationSummary(subject, form()))).toContain("demo-migrate-090000");
    expect(migrationSubmitBlockReason(subject, form())).toBeUndefined();
  });
});

describe("the payload", () => {
  it("sends the guest, the target, the mode and the consent, and nothing else", () => {
    const { spec } = migrationCreatePayload(inputs(), form({ mode: "offline" }));

    expect(Object.keys(spec).sort()).toEqual(["allowIPChange", "guestRef", "mode", "target"]);
    expect(spec.guestRef).toEqual({ name: "demo" });
    expect(spec.target).toEqual({ nodeName: "node-b" });
    expect(spec.mode).toBe("offline");
    expect(spec.allowIPChange).toBe(true);
  });

  it("never sends a node selector, a timeout strategy or a cancellation", () => {
    const { spec } = migrationCreatePayload(
      inputs(),
      form({
        mode: "live",
        timeout: "30m",
        downtimeTarget: "500ms",
        parallelConnections: "4",
        reason: "x",
        ttl: "24h",
      }),
    );

    expect(spec.target.nodeSelector).toBeUndefined();
    expect(spec.timeoutStrategy).toBeUndefined();
    expect(spec.cancelRequested).toBeUndefined();
  });

  it("omits the consent for a guest whose address survives", () => {
    const attached = guest({ interfaces: [{ name: "eth0", primary: true, networkRef: { name: "blue" } }] });
    const { spec } = migrationCreatePayload(inputs({ guest: attached }), form({ mode: "offline" }));

    expect("allowIPChange" in spec).toBe(false);
  });

  it("sends the live-only fields when the mode is live", () => {
    const { spec } = migrationCreatePayload(
      inputs(),
      form({ mode: "live", timeout: "45m", downtimeTarget: "300ms", parallelConnections: "4" }),
    );

    expect(spec.timeout).toBe("45m");
    expect(spec.downtimeTarget).toBe("300ms");
    expect(spec.parallelConnections).toBe(4);
  });

  it("sends the live-only fields when auto will resolve to live", () => {
    const { spec } = migrationCreatePayload(inputs(), form({ mode: "auto", timeout: "45m" }));

    expect(spec.mode).toBe("auto");
    expect(spec.timeout).toBe("45m");
  });

  it("omits the live-only fields in offline mode, even when they were typed", () => {
    const { spec } = migrationCreatePayload(
      inputs(),
      form({ mode: "offline", timeout: "45m", downtimeTarget: "300ms", parallelConnections: "4" }),
    );

    expect(spec.timeout).toBeUndefined();
    expect(spec.downtimeTarget).toBeUndefined();
    expect(spec.parallelConnections).toBeUndefined();
  });

  it("omits the live-only fields when auto will resolve to offline", () => {
    const { spec } = migrationCreatePayload(
      inputs({ guest: guest({}, stopped) }),
      form({ mode: "auto", timeout: "45m" }),
    );

    expect(spec.timeout).toBeUndefined();
  });

  it("sends the reason and the ttl only when they carry something, trimmed", () => {
    const bare = migrationCreatePayload(inputs(), form({ mode: "offline", reason: "  ", ttl: "  " })).spec;
    const filled = migrationCreatePayload(
      inputs(),
      form({ mode: "offline", reason: " node maintenance ", ttl: " 24h " }),
    ).spec;

    expect(bare.reason).toBeUndefined();
    expect(bare.ttl).toBeUndefined();
    expect(filled.reason).toBe("node maintenance");
    expect(filled.ttl).toBe("24h");
  });

  it("trims the target node", () => {
    expect(migrationCreatePayload(inputs(), form({ targetNode: " node-b " })).spec.target.nodeName).toBe("node-b");
  });

  it("knows when the live-only fields exist at all", () => {
    expect(liveFieldsApply(inputs(), form({ mode: "live" }))).toBe(true);
    expect(liveFieldsApply(inputs(), form({ mode: "auto" }))).toBe(true);
    expect(liveFieldsApply(inputs(), form({ mode: "offline" }))).toBe(false);
    expect(liveFieldsApply(inputs({ guest: guest({}, stopped) }), form({ mode: "auto" }))).toBe(false);
  });
});

describe("the write summary", () => {
  it("names the one object it creates", () => {
    expect(migrationSummary(inputs(), form()).write).toBe("Create SwiftMigration vms/demo-migrate-140509");
  });

  it("falls back to placeholders while the form is incomplete", () => {
    const facts = migrationSummary(inputs(), form({ name: "", targetNode: "", mode: "offline" }));

    expect(facts.write).toContain("vms/<name>");
    expect(summaryText(facts)).toContain("<target>");
  });

  it("opens with the mode line, carrying auto's prediction and its because-clause", () => {
    expect(migrationSummary(inputs(), form()).notes[0]).toContain("Mode auto: auto will resolve to: live, because");
  });

  it("states a chosen mode in the same first line", () => {
    expect(migrationSummary(inputs(), form({ mode: "offline" })).notes[0]).toContain("Mode offline:");
  });

  it("discloses the stop, the reattach and the missing timeout for an offline move of a running guest", () => {
    const text = summaryText(migrationSummary(inputs(), form({ mode: "offline" })));

    expect(text).toContain("is stopped for the move");
    expect(text).toContain("30-second grace period");
    expect(text).toContain("reattached, not copied");
    expect(text).toContain("nothing upstream verifies it");
    expect(text).toContain("no timeout in offline mode");
    expect(text).toContain("waits forever");
  });

  it("discloses that migrating a stopped guest boots it", () => {
    const text = summaryText(migrationSummary(inputs({ guest: guest({}, stopped) }), form({ mode: "offline" })));

    expect(text).toContain("will start the guest on node-b");
    expect(text).toContain("moving a stopped guest means booting it");
    expect(text).not.toContain("is stopped for the move");
  });

  it("discloses the two pods, the measured downtime and the post-cutover risk of a live move", () => {
    const text = summaryText(migrationSummary(inputs(), form({ mode: "live" })));

    expect(text).toContain("second launcher pod runs on node-b");
    expect(text).toContain("two pods on two nodes");
    expect(text).toContain("keeps serving until the cutover");
    expect(text).toContain("operator intervention");
    expect(text).not.toContain("is stopped for the move");
  });

  it("states the fresh IP once, and only where it is true", () => {
    const attached = guest({ interfaces: [{ name: "eth0", primary: true, networkRef: { name: "blue" } }] });
    const text = summaryText(migrationSummary(inputs(), form({ mode: "offline" })));

    expect(text).toContain(freshIpFact);
    expect(summaryText(migrationSummary(inputs({ guest: attached }), form({ mode: "offline" })))).not.toContain(
      "fresh IP",
    );
  });

  it("adds the kernel-node constraint only for a kernel-boot guest", () => {
    const kernel = inputs({ guest: guest({ kernelRef: { name: "6.12" } }) });

    expect(summaryText(migrationSummary(kernel, form({ mode: "offline" })))).toContain("kubeswift.io/kernel-node");
    expect(summaryText(migrationSummary(inputs(), form({ mode: "offline" })))).not.toContain("kernel-node");
  });

  it("marks the storage unverified for a live move whose class could not be read", () => {
    const unreadable = inputs({ guestClass: undefined });

    expect(summaryText(migrationSummary(unreadable, form({ mode: "live" })))).toContain("unverified");
    expect(summaryText(migrationSummary(unreadable, form({ mode: "offline" })))).not.toContain("unverified");
  });

  it("marks the node unverified when the cluster's nodes could not be listed", () => {
    const text = summaryText(migrationSummary(inputs({ nodesUnverified: true }), form({ mode: "offline" })));

    expect(text).toContain("nodes could not be listed");
    expect(text).toContain("node-b is not verified");
  });

  it("adds the ttl line with the scoped-RBAC caveat when a ttl is set", () => {
    const text = summaryText(migrationSummary(inputs(), form({ mode: "offline", ttl: "24h" })));

    expect(text).toContain("self-deletes 24h");
    expect(text).toContain("scoped launcher RBAC");
  });

  it("says nothing about a ttl that is not set", () => {
    expect(summaryText(migrationSummary(inputs(), form({ mode: "offline" })))).not.toContain("self-deletes");
  });
});

describe("the accent styling", () => {
  it("accents an offline move of a running guest, which stops it", () => {
    expect(migrationIsAccented(inputs(), form({ mode: "offline" }))).toBe(true);
  });

  it("accents auto when auto will stop the guest", () => {
    const vfio = inputs({ guest: guest({ gpuProfileRef: { name: "hgx" } }) });

    expect(migrationIsAccented(vfio, form({ mode: "auto" }))).toBe(true);
  });

  it.each([
    ["a live move", inputs(), form({ mode: "live" })],
    ["an auto move that resolves to live", inputs(), form({ mode: "auto" })],
    ["an offline move of a stopped guest", inputs({ guest: guest({}, stopped) }), form({ mode: "offline" })],
  ])("does not accent %s", (_label, subject, values) => {
    expect(migrationIsAccented(subject, values)).toBe(false);
  });
});

describe("the outcome sentences", () => {
  it("names the created object", () => {
    expect(migrationSuccessMessage("demo-migrate-140509")).toBe("SwiftMigration demo-migrate-140509 created");
  });

  it("prefixes a 409 with the rename that fixes it", () => {
    const message = migrationCreateFailureMessage(
      { code: 409, message: "already exists", alreadyNotified: false },
      { namespace: "vms", name: "demo-migrate-140509" },
    );

    expect(message).toContain("already exists in the namespace vms");
    expect(message).toContain("Change the name");
    expect(message).toContain("already exists");
  });

  it("prefixes a 404 with what is gone", () => {
    expect(
      migrationCreateFailureMessage({ code: 404, alreadyNotified: false }, { namespace: "vms", name: "m" }),
    ).toContain("the SwiftMigration CRD is gone");
  });

  it("prefixes a 403 with the verb, the resource and the namespace", () => {
    expect(
      migrationCreateFailureMessage(
        { code: 403, message: "forbidden", alreadyNotified: true },
        { namespace: "vms", name: "m" },
      ),
    ).toContain("not allowed to create swiftmigrations in the namespace vms");
  });

  it("passes an unrecognized failure through exactly as it arrived", () => {
    expect(
      migrationCreateFailureMessage(
        { code: 500, message: "boom", alreadyNotified: false },
        { namespace: "vms", name: "m" },
      ),
    ).toBe("boom");
  });

  it("reports the prefix alone when the API server said nothing", () => {
    expect(migrationCreateFailureMessage({ alreadyNotified: false }, { namespace: "vms", name: "m" })).toBeUndefined();
  });
});

describe("the On Delete row", () => {
  const sentences = (facts: Parameters<typeof migrationDeleteRow>[0]) => migrationDeleteRow(facts).sentences.join(" ");

  it.each(["Pending", "Validating", "Preparing"])("rolls an offline migration back from %s", (phase) => {
    const text = sentences({ phase, mode: "offline", modeUnresolved: false });

    expect(text).toContain("aborts it and rolls the guest back");
    expect(text).toContain("claim annotation is cleared");
    expect(text).toContain("source pod comes back");
  });

  it.each(["StopAndCopy", "Resuming"])("orphans an offline migration forward from %s", (phase) => {
    const text = sentences({ phase, mode: "offline", modeUnresolved: false });

    expect(text).toContain("rolls nothing back");
    expect(text).toContain("continues on the destination node");
    expect(text).not.toContain("rolls the guest back");
  });

  it.each(["Pending", "Preparing"])("says a live migration at %s cleans up nothing", (phase) => {
    const text = sentences({ phase, mode: "live", modeUnresolved: false });

    expect(text).toContain("cleans up nothing");
    expect(text).toContain("destination pod and the transfer carry on");
    expect(text).toContain("spec.cancelRequested: true");
    expect(text).not.toContain("rolls the guest back");
  });

  it("says both things about a live migration past the cutover", () => {
    const text = sentences({ phase: "StopAndCopy", mode: "live", modeUnresolved: false });

    expect(text).toContain("continues on the destination node");
    expect(text).toContain("cleans up nothing");
    expect(text).toContain("acknowledged and ignored");
  });

  it.each(["Completed", "Failed", "Cancelled"])("says a %s migration is a record and nothing else", (phase) => {
    const text = sentences({ phase, mode: "offline", modeUnresolved: false });

    expect(text).toContain("removes the record and nothing else");
    expect(text).not.toContain("cleans up nothing");
    expect(text).not.toContain("scoped launcher RBAC");
  });

  it("warns about the RBAC grant a completed live migration still owns", () => {
    const text = sentences({ phase: "Completed", mode: "live", modeUnresolved: false });

    expect(text).toContain("removes the record");
    expect(text).toContain("scoped launcher RBAC");
    expect(text).toContain("goes with it");
  });

  it("does not claim the RBAC edge for a failed live migration", () => {
    expect(sentences({ phase: "Failed", mode: "live", modeUnresolved: false })).not.toContain("scoped launcher RBAC");
  });

  it("states both futures while auto is still unresolved", () => {
    const text = sentences({ phase: "Pending", mode: "auto" });

    expect(text).toContain("has not resolved this migration's mode yet");
    expect(text).toContain("If it resolves to offline");
    expect(text).toContain("If it resolves to live");
  });

  it("treats an object nothing has reconciled yet as pre-cutover", () => {
    expect(sentences({ mode: "offline", modeUnresolved: false })).toContain("aborts it and rolls the guest back");
  });

  it("treats a phase this extension does not know as pre-cutover rather than finished", () => {
    expect(sentences({ phase: "Rewinding", mode: "offline", modeUnresolved: false })).toContain("rolls the guest back");
  });

  it("adds the self-delete line when a ttl is set, and the RBAC caveat in live mode", () => {
    expect(sentences({ phase: "Completed", mode: "offline", modeUnresolved: false, ttl: "24h" })).toContain(
      "self-deletes 24h",
    );
    expect(sentences({ phase: "Preparing", mode: "live", modeUnresolved: false, ttl: "24h" })).toContain(
      "scoped launcher RBAC",
    );
  });

  it.each([
    ["Pending", "pre-cutover"],
    ["Validating", "pre-cutover"],
    ["Preparing", "pre-cutover"],
    ["StopAndCopy", "post-cutover"],
    ["Resuming", "post-cutover"],
    ["Completed", "terminal"],
    ["Failed", "terminal"],
    ["Cancelled", "terminal"],
    [undefined, "pre-cutover"],
  ])("classifies the phase %s as %s", (phase, stage) => {
    expect(migrationStage(phase)).toBe(stage);
  });

  it("always says something, for every phase and mode combination", () => {
    const phases = [
      undefined,
      "Pending",
      "Validating",
      "Preparing",
      "StopAndCopy",
      "Resuming",
      "Completed",
      "Failed",
      "Cancelled",
    ];
    const modes: SwiftMigrationMode[] = ["auto", "live", "offline"];

    for (const phase of phases) {
      for (const mode of modes) {
        expect(migrationDeleteRow({ phase, mode }).sentences.join(" ").length).toBeGreaterThan(0);
      }
    }
  });
});

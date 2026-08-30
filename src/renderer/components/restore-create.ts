/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Restore dialog decides, as pure functions over structurally
// declared inputs (SPEC-0011, "Where the code lives"): the guard, the two modes
// and the reasons one of them is refused, the field validation that replaces the
// admission webhook, the identity payload, the live write summary, the sentences
// the notifications carry, and the drawer's On Delete row.
//
// Nothing here emits JSX, reads a store, or touches a host global. A fact only
// the renderer can know - what the guest store happens to hold, what the click
// time read of the source guest returned, what time it is - is taken as an
// argument, which is what keeps the interesting half of this dialog unit-testable
// without a cluster.
//
// What creating a SwiftRestore mechanically IS is the reason this module exists,
// and none of it is in the schema:
//
// - In place means kill and replace: the controller merge-patches the live guest
//   and deletes its launcher pod with `gracePeriodSeconds: 0`. There is no phase
//   precondition and no graceful shutdown. The disks are untouched; the memory
//   is replaced.
// - In place on a csi snapshot restores NOTHING: the path returns early when the
//   PVC and the guest already exist, and the object marches to `Ready` having
//   changed nothing. That is a dead control, so the mode is refused there.
// - In place over a guest whose `runPolicy` is `Stopped` WEDGES: the restore
//   never touches the policy, the controller will not recreate the launcher pod,
//   and the restore waits in `Restoring` with no timeout.
// - A clone is built from the source guest's CURRENT spec, not the captured one,
//   and on the memory backends boots the captured memory on a fresh image-cloned
//   disk rather than a copy of the source's disk.
// - The clone belongs to the restore: the new SwiftGuest carries a controller
//   `ownerReference` to the SwiftRestore, so deleting the restore later garbage
//   collects the guest (and, on csi, its restored root PVC). Undocumented
//   upstream, which is why this dialog says it once and the drawer says it
//   permanently.
// - Identity regeneration has two real knobs, not four: `hostname`, `machineId`
//   and `sshHostKeys` collapse into ONE marker annotation that relies on in-guest
//   cloud-init, and `macAddresses` is the per-NIC rewrite. An in-place restore is
//   DEFINED upstream as a name match plus an EMPTY `regenerate`, so it carries no
//   identity block at all.
// - Every cross-field rule lives in a validating webhook that ships DISABLED by
//   default, so the same rules are enforced here, at the field, before submit.

import { notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import { stoppedRunPolicy } from "./guest-status";
import { isMemoryBackend, objectNameError } from "./snapshot-create";

import type {
  SwiftRestoreIdentityItem,
  SwiftRestoreMemoryRestoreMode,
  SwiftRestoreSpec,
  SwiftRestoreTargetMode,
} from "../api/kubeswift/swiftrestore-v1alpha1";
import type { SwiftSnapshotBackendType } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type { ActionGuard, ApiFailureFacts } from "./guest-actions";

/** The backend whose in-place restore is a verified no-op. */
export const csiBackendType: SwiftSnapshotBackendType = "csi-volume-snapshot";

/** The only phase from which a snapshot will never become restorable. */
export const failedSnapshotPhase = "Failed";

/** The phase a restore waits for; every other one makes the restore sit in `Pending`. */
export const readySnapshotPhase = "Ready";

/** The backends whose restore has to download artifacts, and therefore needs a node. */
export const targetNodeBackendTypes: SwiftSnapshotBackendType[] = ["s3", "oci"];

/**
 * The three identity attributes the "Regenerate machine identity" checkbox
 * stands for.
 *
 * They are one checkbox rather than three because they are ONE annotation
 * upstream: the controller appends `kubeswift.clone=true` to the kernel cmdline
 * and leaves the work to in-guest cloud-init. Three checkboxes would promise a
 * granularity the implementation does not have.
 */
export const machineIdentityItems: SwiftRestoreIdentityItem[] = ["hostname", "machineId", "sshHostKeys"];

/** The one identity attribute that is a real, separate, deterministic rewrite. */
export const macAddressItem: SwiftRestoreIdentityItem = "macAddresses";

/** The two memory restore modes, in the order the dialog offers them. */
export const memoryRestoreModes: SwiftRestoreMemoryRestoreMode[] = ["copy", "ondemand"];

/** The two modes of a restore, in the order the dialog offers them. */
export const restoreModes = ["in-place", "clone"] as const;

export type RestoreMode = (typeof restoreModes)[number];

/** How each mode is named, in the radio and in the summary. */
export const restoreModeLabels: Record<RestoreMode, string> = {
  "in-place": "Restore in place",
  clone: "Clone",
};

/**
 * The rule that locks the MAC checkbox, and the tooltip that explains the lock.
 *
 * The likeliest rejection this dialog can prevent: cloning a memory snapshot to
 * a name other than the source guest's requires `macAddresses` in
 * `identity.regenerate`. The webhook says so, and the controller re-checks and
 * fails the restore when the webhook is off - which it is, by default.
 */
export const macAddressLockRule =
  "Upstream requires the MAC rewrite when a memory snapshot is cloned to a different guest: two VMs booted from one " +
  "memory image would otherwise come up with the same MAC addresses. The rule is in the admission webhook, and the " +
  "controller fails the restore when the webhook is off - which it is, by default.";

/**
 * What `resumeAfterRestore: false` looks like on the memory tail, in the words
 * the summary uses.
 *
 * The csi path has an explicit skip-to-Ready branch; the memory tail forces the
 * clone to `runPolicy: Stopped`, which means no launcher pod, which means the
 * resume step waits forever. The code comment claims the flag is consulted there
 * and it is not. The checkbox stays - a stopped clone is a legitimate DR shape -
 * but never silently.
 */
export const memoryTailHangWarning =
  "Resume after restore is off on a memory snapshot: the recorded upstream behaviour is a restore that never leaves " +
  "Restoring, while the guest it created exists and stays Stopped. The guest is usable; the SwiftRestore object is " +
  "the thing that hangs.";

/**
 * What an in-place restore of a guest that is set to stay down does, in the
 * words the summary and the mode control both use.
 *
 * The restore path never touches `spec.runPolicy`; with the policy `Stopped`
 * the guest controller will not recreate the launcher pod, and the restore waits
 * in `Restoring` with no timeout on its side either. A warning rather than a
 * block, because the policy can change between this dialog and the reconcile -
 * and the sentence names the change that unblocks it.
 */
export function inPlaceWedgeWarning(target: string): string {
  return (
    `This restore will wedge: the run policy of ${target} is ${stoppedRunPolicy}, the restore never changes it, so ` +
    "the controller will not recreate the launcher pod and the restore waits in Restoring with no timeout. Start " +
    "the guest first."
  );
}

/** The slice of a SwiftSnapshot the dialog's decisions read, taken at click time (W1). */
export interface RestoreSnapshotFacts {
  name: string;
  namespace: string;
  /** `spec.guestRef.name`: the guest the snapshot was taken from. */
  sourceGuestName?: string;
  backend?: SwiftSnapshotBackendType;
  phase?: string;
  /** `status.memorySnapshot`: the capture really holds a memory image. */
  hasMemorySnapshot?: boolean;
}

/**
 * What the one cheap read of the source guest found on open (B3, spike T4).
 *
 * `absent` is a classified 404 and is the only outcome that refuses the in-place
 * mode. `unreadable` is any other failure, and it degrades the sentences rather
 * than the action: a read that fails must not block a write the user is allowed
 * to make.
 */
export interface SourceGuestReading {
  outcome: "present" | "absent" | "unreadable";
  /** `status.phase`, when the read returned a guest. */
  phase?: string;
  /** `spec.runPolicy`, which is what decides whether an in-place restore wedges. */
  runPolicy?: string;
  /** `status.podRef.name`: the pod an in-place restore deletes with no grace period. */
  podName?: string;
}

/** A SwiftGuest the store already holds, as the collision check and the node rule read it. */
export interface ExistingGuestFacts {
  name: string;
  /** `status.nodeName`, or the pinned `spec.nodeName`: the node a restore can default to. */
  nodeName?: string;
}

/** Every field the form holds, in one flat object so the model is one observable. */
export interface RestoreFormValues {
  mode: RestoreMode;
  /** The SwiftRestore's own name. */
  name: string;
  /** The clone's guest name. In place the target is the source guest and this is ignored. */
  targetName: string;
  regenerateMachineIdentity: boolean;
  rewriteMacAddresses: boolean;
  memoryRestoreMode: SwiftRestoreMemoryRestoreMode;
  resumeAfterRestore: boolean;
  targetNode: string;
}

const enabledGuard: ActionGuard = { enabled: true };

function disabled(reason: string): ActionGuard {
  return { enabled: false, reason };
}

/**
 * Whether the item offers to restore this snapshot at all.
 *
 * Disabled on exactly one phase, and for a reason that is upstream's own
 * construction rather than a preference: `Failed` is terminal, the snapshot will
 * never become `Ready`, and the restore controller answers a not-Ready snapshot
 * by requeuing every ten seconds forever. A restore created from a failed
 * snapshot is an object that waits in `Pending` until someone deletes it.
 *
 * Every other phase is enabled: a restore created against a snapshot that is
 * still capturing is a legitimate early restore, and the summary says it will
 * wait. (Upstream gates nothing here; its Restore button is live on a `Failed`
 * snapshot.) The `deletionTimestamp` exception is the component's, as in
 * SPEC-0010: a terminating object gets no action item at all.
 */
export function canRestore(snapshot: RestoreSnapshotFacts): ActionGuard {
  if (snapshot.phase === failedSnapshotPhase) {
    return disabled(
      "The snapshot phase is Failed, which is terminal: it will never become Ready, and a restore created from it " +
        "would wait in Pending forever rather than fail.",
    );
  }

  return enabledGuard;
}

/**
 * Whether this snapshot holds a memory image, which is what makes the MAC rule
 * bind, the memory restore mode meaningful and the fresh-disk sentence true.
 *
 * Two sources, either of which is enough: the backend (the SPEC-0004 Contents
 * derivation, shared with Take Snapshot - `local`, `s3` and `oci` all capture
 * memory), and `status.memorySnapshot`, which is the controller's own record
 * that a memory image exists. The CRD's field documentation names only `local`
 * and `s3`; the derivation is wider, and being wider here is the cheap direction
 * to be wrong in - it locks a checkbox upstream would have required anyway.
 */
export function snapshotCapturesMemory(snapshot: RestoreSnapshotFacts): boolean {
  return Boolean(snapshot.hasMemorySnapshot) || (snapshot.backend !== undefined && isMemoryBackend(snapshot.backend));
}

/**
 * Whether the in-place mode can be offered, and why not when it cannot (W4).
 *
 * The order of the three refusals is deliberate. The structural one comes first
 * (a snapshot that names no source guest has no in-place target at all), then
 * the csi no-op, which is a certain property of this object that nothing can
 * change, and last the missing source guest, which is read from a store that may
 * be stale and may even not have answered. A certain refusal outranks an
 * uncertain one; all three name the clone path as the way forward, because it is.
 */
export function inPlaceGuard(snapshot: RestoreSnapshotFacts, source: SourceGuestReading): ActionGuard {
  const sourceName = snapshot.sourceGuestName;

  if (!sourceName) {
    return disabled(
      "This snapshot names no source guest, so there is no guest to restore over. Clone it into a new guest instead.",
    );
  }

  if (snapshot.backend === csiBackendType) {
    return disabled(
      `An in-place restore of a ${csiBackendType} snapshot restores nothing: the disk and the guest already exist, ` +
        "so upstream returns early and marches the restore to Ready having changed nothing. Clone it into a new " +
        "guest instead.",
    );
  }

  if (source.outcome === "absent") {
    return disabled(
      `The source guest ${sourceName} no longer exists in ${snapshot.namespace}, so there is nothing to restore ` +
        "over. Clone it into a new guest instead.",
    );
  }

  return enabledGuard;
}

/** One mode of the dialog's radio, with its label and its verdict. */
export interface RestoreModeChoice {
  mode: RestoreMode;
  label: string;
  guard: ActionGuard;
}

/**
 * The two modes, each carrying its verdict.
 *
 * A clone is never refused: it creates a guest that does not exist yet, which
 * every backend supports and which is the fallback all three in-place refusals
 * point at.
 */
export function restoreModeChoices(snapshot: RestoreSnapshotFacts, source: SourceGuestReading): RestoreModeChoice[] {
  const inPlace = inPlaceGuard(snapshot, source);

  return restoreModes.map((mode) => ({
    mode,
    label: restoreModeLabels[mode],
    guard: mode === "in-place" ? inPlace : enabledGuard,
  }));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The default name of the SwiftRestore itself: the snapshot's, plus the local
 * wall-clock instant of the click.
 *
 * Local rather than UTC because the operator reads it against their own clock,
 * and to the second because that is the resolution at which a human restores one
 * snapshot twice. Upstream has no restore surface at all and `swiftctl` makes the
 * user invent a name; a colliding default is the failure this shape removes (C6).
 */
export function defaultRestoreName(snapshotName: string, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  return `${snapshotName}-restore-${stamp}`;
}

/**
 * The default name of the cloned guest, which the spec fixes to
 * `<source-guest>-restore-<hhmmss>`.
 *
 * Shorter than the restore's own stamp on purpose: this one becomes a guest's
 * hostname, and the date is already in the object it comes from.
 */
export function defaultTargetGuestName(sourceGuestName: string, now: Date): string {
  return `${sourceGuestName}-restore-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * The form the dialog opens with.
 *
 * The mode defaults to `clone`, which is the one that destroys nothing: an
 * in-place restore kills the running VM with no grace period, and a dialog whose
 * default answer is the destructive one is a trap however well it is labelled.
 * The explicit radio is what makes choosing the other one a decision (C10).
 */
export function defaultRestoreForm(snapshot: RestoreSnapshotFacts, now: Date): RestoreFormValues {
  return {
    mode: "clone",
    name: defaultRestoreName(snapshot.name, now),
    targetName: defaultTargetGuestName(snapshot.sourceGuestName || snapshot.name, now),
    regenerateMachineIdentity: true,
    rewriteMacAddresses: true,
    memoryRestoreMode: "copy",
    resumeAfterRestore: true,
    targetNode: "",
  };
}

/**
 * The guest this restore will write to.
 *
 * In place it is the snapshot's source guest by definition - upstream reads the
 * mode off the name match, so the name IS the mode - and the field is not
 * editable. In clone mode it is whatever was typed.
 */
export function restoreTargetName(snapshot: RestoreSnapshotFacts, values: RestoreFormValues): string {
  if (values.mode === "in-place") {
    return snapshot.sourceGuestName || values.targetName.trim();
  }

  return values.targetName.trim();
}

/**
 * Whether the MAC rewrite is forced on and locked.
 *
 * Exactly the case the webhook rule covers: a clone of a snapshot that holds
 * memory. An in-place restore carries no identity block at all, so there is
 * nothing to lock there, and a csi clone is free to leave it off.
 */
export function macAddressLock(snapshot: RestoreSnapshotFacts, values: RestoreFormValues): boolean {
  return values.mode === "clone" && snapshotCapturesMemory(snapshot);
}

/**
 * Whether an in-place restore would wedge, from the click-time read.
 *
 * Only ever true for a guest the read actually returned: a policy nobody could
 * verify is not a fact to warn about, and the summary says the read failed
 * instead.
 */
export function inPlaceWedges(values: RestoreFormValues, source: SourceGuestReading): boolean {
  return values.mode === "in-place" && source.outcome === "present" && source.runPolicy === stoppedRunPolicy;
}

/** Whether the target node field means anything for this snapshot, or is dropped (W12). */
export function targetNodeApplies(snapshot: RestoreSnapshotFacts): boolean {
  return snapshot.backend !== undefined && targetNodeBackendTypes.includes(snapshot.backend);
}

/** What the target node field is, for this snapshot and this target, right now. */
export interface TargetNodeFacts {
  /** False when the field is not rendered at all: `local` is pinned, `csi` ignores it. */
  applies: boolean;
  required: boolean;
  /** What the field says under itself when it is optional. */
  note?: string;
}

/**
 * Whether a node has to be named, computed from the same live facts the summary
 * quotes.
 *
 * Upstream fails an `s3` or `oci` restore whose target guest does not exist yet
 * and which names no node, with an explicit message; when the target does exist,
 * the controller falls back to that guest's own node. So the required-ness is a
 * function of the target name the user is typing, which is why it is recomputed
 * rather than decided once on open.
 */
export function targetNodeFacts(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
  existingGuests: ExistingGuestFacts[],
): TargetNodeFacts {
  if (!targetNodeApplies(snapshot)) {
    return { applies: false, required: false };
  }

  const target = restoreTargetName(snapshot, values);
  const existing = target ? existingGuests.find((guest) => guest.name === target) : undefined;

  if (!existing) {
    return { applies: true, required: true };
  }

  return {
    applies: true,
    required: false,
    note: existing.nodeName
      ? `Optional: ${target} already exists, so the restore defaults to ${existing.nodeName}, the node it is on.`
      : `Optional: ${target} already exists, so the restore resolves the node from it.`,
  };
}

/** The fields validation and the warnings are keyed on, so a message renders next to its input. */
export type RestoreField = "name" | "targetName" | "targetNode";

/** One message per field, absent when the field has nothing to say. */
export type RestoreFieldMessages = Partial<Record<RestoreField, string>>;

/** How the submit-disabled sentence names each field (W4: it names the field AND the reason). */
export const restoreFieldLabels: Record<RestoreField, string> = {
  name: "Name",
  targetName: "Target guest",
  targetNode: "Target node",
};

/** The order the submit-disabled sentence reports the first offending field in. */
const fieldOrder: RestoreField[] = ["name", "targetName", "targetNode"];

/**
 * Everything that would make this create fail, keyed by field.
 *
 * The typo rule is the webhook's own: a target guest named after the snapshot is
 * rejected as a mistake, because a restore whose target is its own source
 * snapshot is never what anyone meant. Upstream ships that webhook disabled by
 * default, so on a normal install nobody produces the message at all and the
 * object simply never resolves (C2).
 */
export function restoreErrors(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
  existingGuests: ExistingGuestFacts[],
): RestoreFieldMessages {
  const errors: RestoreFieldMessages = {};
  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  if (values.mode === "clone") {
    const target = values.targetName.trim();
    const targetError = objectNameError(target);

    if (targetError) {
      errors.targetName = targetError;
    } else if (target === snapshot.name) {
      errors.targetName =
        `A clone cannot be named after the snapshot it restores: upstream rejects ${snapshot.name} as a typo for ` +
        "the guest name. Name the guest this restore should produce.";
    }
  }

  const node = targetNodeFacts(snapshot, values, existingGuests);

  if (node.required && !values.targetNode.trim()) {
    errors.targetNode =
      `A node is required: ${restoreTargetName(snapshot, values) || "the target guest"} does not exist yet, and a ` +
      `${snapshot.backend} restore that names no node has nowhere to download the artifacts to. Upstream fails it.`;
  }

  return errors;
}

/**
 * Everything worth saying about a field that would still be accepted, keyed by
 * field.
 *
 * Warnings never block (W12): the store can be stale, the API server is the
 * authority, and a warned submit that 409s is honest where a blocked one is a
 * client-side heuristic in the driver's seat. A store that holds nothing - a cold
 * page - simply produces no warnings, and the 409 path stays the backstop.
 */
export function restoreWarnings(
  values: RestoreFormValues,
  existingRestores: string[],
  existingGuests: ExistingGuestFacts[],
): RestoreFieldMessages {
  const warnings: RestoreFieldMessages = {};
  const name = values.name.trim();

  if (name && existingRestores.includes(name)) {
    warnings.name =
      "A SwiftRestore with this name already exists in this namespace. Submitting will be refused by the API " +
      "server; the fix is a different name.";
  }

  if (values.mode === "clone") {
    const target = values.targetName.trim();

    if (target && existingGuests.some((guest) => guest.name === target)) {
      warnings.targetName =
        `The guest ${target} already exists. A clone does not set overwriteExisting, so upstream will not replace ` +
        "it: pick another name, or switch to Restore in place if replacing it is what you meant.";
    }
  }

  return warnings;
}

/**
 * Why the submit button is disabled, naming the field and the reason (W4 applied
 * to submit buttons), or `undefined` when the form can be sent.
 */
export function restoreSubmitBlockReason(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
  existingGuests: ExistingGuestFacts[],
): string | undefined {
  const errors = restoreErrors(snapshot, values, existingGuests);
  const field = fieldOrder.find((candidate) => errors[candidate]);

  return field ? `${restoreFieldLabels[field]}: ${errors[field]}` : undefined;
}

/**
 * Whether the OK button takes the accent styling Stop uses.
 *
 * In place, and only in place: it kills a running workload's launcher pod with
 * no grace period, which is the same class of consequence as stopping a guest. A
 * clone creates something and destroys nothing.
 */
export function restoreIsAccented(values: RestoreFormValues): boolean {
  return values.mode === "in-place";
}

/**
 * The identity attributes this restore regenerates: exactly the enum values the
 * two checkboxes stand for, and never an empty list.
 *
 * An in-place restore produces NONE of them, and that is not a preference: the
 * controller defines in-place as a target name matching the source guest AND an
 * empty `identity.regenerate`. Sending an identity block with an in-place name
 * would turn the write into something upstream does not classify as in-place at
 * all.
 */
export function restoreIdentityItems(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
): SwiftRestoreIdentityItem[] {
  if (values.mode !== "clone") {
    return [];
  }

  const items: SwiftRestoreIdentityItem[] = [];

  if (values.regenerateMachineIdentity) {
    items.push(...machineIdentityItems);
  }

  if (values.rewriteMacAddresses || macAddressLock(snapshot, values)) {
    items.push(macAddressItem);
  }

  return items;
}

/**
 * The spec the create sends: exactly the fields the form owns, and nothing else.
 *
 * Every omission is deliberate. `memoryRestoreMode` is sent only for `ondemand`
 * on a memory snapshot, because `copy` is the hypervisor's own default and
 * upstream never propagates it; `resumeAfterRestore` is sent only when it is
 * false, because true is the schema default; `overwriteExisting` exists only in
 * the in-place mode, where it is the consent field and this dialog is the
 * consent; `targetNode` is sent only where the controller consults it.
 */
export function restoreCreatePayload(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
): { spec: SwiftRestoreSpec } {
  const spec: SwiftRestoreSpec = {
    snapshotRef: { name: snapshot.name },
    targetGuest: { name: restoreTargetName(snapshot, values) },
  };

  if (values.mode === "in-place") {
    spec.targetGuest.overwriteExisting = true;
  }

  const regenerate = restoreIdentityItems(snapshot, values);

  if (regenerate.length > 0) {
    spec.identity = { regenerate };
  }

  if (snapshotCapturesMemory(snapshot) && values.memoryRestoreMode === "ondemand") {
    spec.memoryRestoreMode = "ondemand";
  }

  if (!values.resumeAfterRestore) {
    spec.resumeAfterRestore = false;
  }

  const targetNode = values.targetNode.trim();

  if (targetNodeApplies(snapshot) && targetNode) {
    spec.targetNode = targetNode;
  }

  return { spec };
}

/** The facts the live write summary is built from. The component owns the JSX. */
export interface RestoreSummaryFacts {
  /** The one API call this dialog makes (W1). */
  write: string;
  /** What the create means, each line rendered only when it is true of this object. */
  notes: string[];
  /** What it costs, in the warning style. */
  warnings: string[];
}

/** What the click-time read says about the guest an in-place restore lands on (B3). */
function liveGuestSentence(source: SourceGuestReading): string {
  if (source.outcome === "unreadable") {
    return " The guest could not be read from here, so its live phase and launcher pod are unverified.";
  }

  if (source.outcome === "absent") {
    return "";
  }

  const phase = source.phase ? `is ${source.phase}` : "reports no phase";
  const pod = source.podName ? `its launcher pod is ${source.podName}` : "no launcher pod is recorded";

  return ` The guest ${phase} and ${pod}.`;
}

/** The lines an in-place restore is answerable for. */
function inPlaceSummary(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
  source: SourceGuestReading,
  notes: string[],
  warnings: string[],
): void {
  const target = restoreTargetName(snapshot, values);

  notes.push(
    `The launcher pod of ${target} is deleted with no grace period and its memory is replaced by the snapshot's: ` +
      "there is no graceful shutdown, and everything that happened since the capture is lost." +
      liveGuestSentence(source),
  );
  notes.push("The guest's spec and its disks are untouched: the memory state is restored on top of the existing disk.");
  notes.push(
    `spec.targetGuest.overwriteExisting: true is sent with the create. It is the consent to overwrite ${target}, ` +
      "and this dialog is that consent.",
  );

  if (inPlaceWedges(values, source)) {
    warnings.push(inPlaceWedgeWarning(target));
  }
}

/** The lines a clone restore is answerable for. */
function cloneSummary(snapshot: RestoreSnapshotFacts, values: RestoreFormValues, notes: string[]): void {
  const target = restoreTargetName(snapshot, values) || "<target>";
  const sourceName = snapshot.sourceGuestName;

  notes.push(
    `A new SwiftGuest ${target} is created from ${sourceName ? `${sourceName}'s` : "the source guest's"} current ` +
      "spec - not the spec captured in the snapshot - so any edit made since the capture is in the clone.",
  );

  if (snapshotCapturesMemory(snapshot)) {
    notes.push(
      "It boots the captured memory on a fresh disk cloned from the image rather than on a copy of the source's " +
        "disk, so filesystem changes made since the image are not in it.",
    );
  }

  notes.push(
    `The clone's life is tied to this SwiftRestore: deleting the restore later deletes the guest ${target} with ` +
      (snapshot.backend === csiBackendType ? "it, and its restored root PVC too." : "it."),
  );

  notes.push(
    values.resumeAfterRestore
      ? "The clone starts Running; the source guest's own run policy is not inherited."
      : "The clone starts Stopped, because Resume after restore is off; the source guest's own run policy is not " +
          "inherited.",
  );
}

/**
 * The live write summary: the one create line, plus the consequence lines that
 * are true of this object in this state (W1, rebuilt on every change).
 */
export function restoreSummary(
  snapshot: RestoreSnapshotFacts,
  values: RestoreFormValues,
  source: SourceGuestReading,
): RestoreSummaryFacts {
  const name = values.name.trim() || "<name>";
  const notes: string[] = [];
  const warnings: string[] = [];

  if (values.mode === "in-place") {
    inPlaceSummary(snapshot, values, source, notes, warnings);
  } else {
    cloneSummary(snapshot, values, notes);
  }

  if (snapshot.phase !== readySnapshotPhase) {
    notes.push(
      `The snapshot is ${snapshot.phase ?? "in no reported phase"}, not ${readySnapshotPhase}: the restore is ` +
        "created now and waits in Pending until it is.",
    );
  }

  if (source.outcome === "absent" && snapshot.sourceGuestName) {
    warnings.push(
      `The source guest ${snapshot.sourceGuestName} is gone from ${snapshot.namespace}. Upstream fails a restore ` +
        "whose source guest is missing, on every backend; the store may be stale, so this is a warning and not a " +
        "block.",
    );
  }

  if (snapshotCapturesMemory(snapshot) && !values.resumeAfterRestore) {
    warnings.push(memoryTailHangWarning);
  }

  return {
    write: `Create SwiftRestore ${snapshot.namespace}/${name}`,
    notes,
    warnings,
  };
}

/** The success sentence: the fact that was written, from a page that does not show the new row (W9). */
export function restoreSuccessMessage(name: string): string {
  return `SwiftRestore ${name} created`;
}

/** The status code an ignored collision warning comes back as. */
export const conflictStatusCode = 409;

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface RestoreCreateFailureContext {
  namespace: string;
  name: string;
}

/**
 * The actionable sentence alone, for the three failures this dialog can predict.
 *
 * A 409 is the one this dialog produces on purpose: the collision warning does
 * not block, so an ignored warning arrives here as the API server's own
 * AlreadyExists, and the fix is a rename in the form that is still open. The 403
 * sentence is SPEC-0010's, reused verbatim.
 */
export function restoreCreateFailurePrefix(
  code: number | undefined,
  context: RestoreCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftRestore named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftRestore CRD is gone.`;
  }

  return writeFailurePrefix(code, { verb: "create", resource: "swiftrestores", namespace: context.namespace });
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function restoreCreateFailureMessage(
  failure: ApiFailureFacts,
  context: RestoreCreateFailureContext,
): string | undefined {
  const prefix = restoreCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/** What the drawer's On Delete row says, and which object it links to (SPEC-0011). */
export interface RestoreDeleteRow {
  /**
   * The guest that goes with this object, when one does. The drawer renders it
   * as a link, so the sentences below read as its predicate.
   */
  deletedGuest?: string;
  sentences: string[];
}

/**
 * What deleting a SwiftRestore does and does not destroy, computed from the
 * object's own mode rather than stated in the abstract.
 *
 * This is the sharpest fact the SPEC-0011 recon produced and upstream documents
 * it nowhere: the controller makes the restored guest a child of the SwiftRestore
 * (a controller `ownerReference`), so deleting the restore garbage-collects the
 * guest it created, and on the csi path its restored root PVC too. An in-place
 * restore owns nothing - it wrote over a guest that already existed - so deleting
 * it deletes nothing else.
 *
 * The drawer says this permanently, because the host owns the Delete confirmation
 * and gives an extension no hook for a per-kind consequence (the SPEC-0010
 * stance).
 */
export function restoreDeleteRow(facts: {
  mode: SwiftRestoreTargetMode;
  /** `status.guestRef` when the restore got that far, the target name before that. */
  guestName?: string;
  /** The snapshot's backend, or `undefined` when the snapshot could not be read. */
  snapshotBackend?: SwiftSnapshotBackendType;
}): RestoreDeleteRow {
  if (facts.mode === "In-place") {
    return {
      sentences: [
        "Deleting this SwiftRestore deletes nothing else. An in-place restore wrote over a guest that already " +
          "existed, and nothing here owns that guest.",
      ],
    };
  }

  if (!facts.guestName) {
    return {
      sentences: [
        "Deleting this SwiftRestore deletes the guest it created, which it owns through a controller reference. " +
          "This object names no guest, so which one that is cannot be stated from here.",
      ],
    };
  }

  const sentences = [
    "is deleted with this SwiftRestore: the controller made this object its owner, so the garbage collector takes " +
      "the guest when this object goes.",
  ];

  if (facts.snapshotBackend === csiBackendType) {
    sentences.push("The restored root PVC goes with it too.");
  } else if (!facts.snapshotBackend) {
    sentences.push(
      "Whether a restored disk goes with it depends on the snapshot's backend, which could not be read from here.",
    );
  }

  return { deletedGuest: facts.guestName, sentences };
}

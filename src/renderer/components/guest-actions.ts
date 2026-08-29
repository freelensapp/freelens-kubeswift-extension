/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the guest Start and Stop actions decide, as pure functions over
// structurally declared inputs (SPEC-0010, "Where the actions live"): the
// guards, the patch payloads, the write sequences, the facts each confirmation
// dialog is built from, and the sentences the outcome and failure notifications
// carry. The menu components in `src/renderer/menus/` are then thin - read the
// object, call a guard, build a dialog, call the store, catch, notify - which is
// what makes the interesting half of this milestone unit-testable without a host
// global and without a cluster.
//
// Nothing here emits JSX, formats a date or reads a store. A function that needs
// a fact only the renderer can know (the sizing of a guest class that happens to
// be loaded, what a click-time pod read returned) takes it as an argument.
//
// What a start and a stop mechanically ARE is the reason this module exists, and
// it is not in the schema: `spec.runPolicy` governs what the controller does
// when the launcher pod reaches a terminal state, so patching it to `Stopped`
// guards against RECREATION and does not terminate a running pod. A stop is
// therefore two writes, and SPEC-0010's W1 exists partly because the only honest
// way to ship a two-write verb is to say it is one.

import { guestFailedPhase, guestRunningPhase, guestStoppedPhase, stoppedRunPolicy } from "./guest-status";

/** The `runPolicy` value a start writes. Never restores a previous `Always`; see `startDialogFacts`. */
export const runningRunPolicy = "Running";

/** The two policies whose auto-restart behaviour a stop overwrites (B6). */
export const autoRestartRunPolicies: string[] = ["Always", "RestartOnFailure"];

/** The network binding under which the guest lives behind the launcher pod's own address (B7). */
export const natNetworkBinding = "nat";

/** Pod phases from which the guest has already exited, so a stop is only tidying up (B3). */
const terminalPodPhases: string[] = ["Succeeded", "Failed"];

/** What a data disk entry must look like for the delete-cascade summary to read it. */
export interface GuestDataDiskFacts {
  name?: string;
  blank?: unknown;
  pvcRef?: { name?: string };
}

/** What a SwiftGuest's spec must look like for these functions to read it. */
export interface GuestActionSpecFacts {
  runPolicy?: string;
  guestClassRef?: { name?: string };
  imageRef?: { name?: string };
  gpuProfileRef?: { name?: string };
  gpuResourceClaim?: unknown;
  nodeName?: string;
  network?: { binding?: string; ports?: unknown[] };
  seedProfileRef?: { name?: string };
  dataDiskRefs?: GuestDataDiskFacts[];
}

/** What a SwiftGuest's status must look like for these functions to read it. */
export interface GuestActionStatusFacts {
  phase?: string;
  podRef?: { name?: string; namespace?: string };
  network?: { primaryIP?: string };
}

/**
 * The slice of a SwiftGuest these functions work on. The menu components build
 * it from the live object at click time (never from a render-time snapshot),
 * which is what makes the guard and the dialog quote the same facts (W1, B2).
 */
export interface GuestActionFacts {
  name: string;
  namespace: string;
  spec?: GuestActionSpecFacts;
  status?: GuestActionStatusFacts;
}

/**
 * The outcome of a guard.
 *
 * A union rather than `{ enabled: boolean; reason?: string }` on purpose: B5
 * requires that a disabled control always carries its reason, and this shape
 * makes a mute disabled branch a compile error rather than a review comment. The
 * unit tests assert the same invariant over every input the guards distinguish,
 * so a future branch cannot be added without one either.
 */
export type ActionGuard = { enabled: true; reason?: undefined } | { enabled: false; reason: string };

const enabled: ActionGuard = { enabled: true };

function disabled(reason: string): ActionGuard {
  return { enabled: false, reason };
}

/** A launcher pod a stop would delete: what `status.podRef` names, resolved against the guest. */
export interface LauncherPodTarget {
  name: string;
  namespace: string;
}

/**
 * What the click-time read of the launcher pod found (B3).
 *
 * `absent` is the host API returning `null` for a pod that is not there, and it
 * is the only outcome that drops the delete from the sequence. `unreadable` is
 * any error - a 403 on pods is the realistic one - and it degrades the sentence,
 * never the action: a read that fails must not block a write the user is allowed
 * to make.
 */
export interface LauncherPodReading {
  outcome: "present" | "absent" | "unreadable";
  /** The pod's phase, when the read returned a pod. */
  phase?: string;
}

/** One API call an action will make, in the order it makes them (W1). */
export interface ActionWrite {
  kind: "patch" | "delete";
  /** The field path and value transition of a patch, or the kind and name of a delete. */
  text: string;
}

/** The facts a confirmation dialog is built from. The component owns the JSX. */
export interface ActionDialogFacts {
  /** The kind and `namespace/name` the action is about. */
  subject: string;
  /** One line per API call, in order. A write that would change nothing is not here (B4). */
  writes: ActionWrite[];
  /** Sentences that say what the action does and what it starts from. */
  notes: string[];
  /** Sentences about what the action costs, loses, or could not verify. */
  warnings: string[];
}

/** What a stop will actually send, once the no-op writes are dropped (B4). */
export interface StopWritePlan {
  /** False when the policy is already `Stopped`: the patch would be a no-op. */
  patchRunPolicy: boolean;
  /** The pod to delete, when the status names one and the read did not say it is already gone. */
  deletePod?: LauncherPodTarget;
}

/** `SwiftGuest kubeswift-e2e/e2e-guest-running`, the subject line of every dialog. */
function guestSubject(guest: GuestActionFacts): string {
  return `SwiftGuest ${guest.namespace}/${guest.name}`;
}

/** The policy as the dialog spells it, including the case where the field is absent. */
function currentRunPolicy(guest: GuestActionFacts): string {
  return guest.spec?.runPolicy ?? "not set";
}

/**
 * Whether a start would change anything.
 *
 * Enabled only for `Stopped`. Every other value, **absent included**, means the
 * guest is already meant to run, and the patch would be a no-op - which is why
 * this tests for `Stopped` rather than for `!== "Running"`, the reading a
 * webhook-disabled cluster gets wrong (SPEC-0010).
 *
 * The second disabled reason is a real gap in the API's shape rather than a
 * limitation of this design: with the policy already at `Running`, no patch
 * changes anything, because what blocks the boot is a terminal pod the
 * controller will not replace. `swiftctl` solves that with `restart`, which this
 * milestone excludes, so the reason names the two-click path this milestone does
 * provide.
 */
export function canStart(guest: GuestActionFacts): ActionGuard {
  if (guest.spec?.runPolicy === stoppedRunPolicy) {
    return enabled;
  }

  const phase = guest.status?.phase;

  if (phase === guestStoppedPhase || phase === guestFailedPhase) {
    return disabled(
      "The guest is already set to run but has exited. Bringing it back means recreating its launcher pod: stop " +
        "it, then start it.",
    );
  }

  return disabled("The guest is already set to run.");
}

/**
 * Whether a stop would change anything.
 *
 * Enabled when the policy is not `Stopped`, **or** when the status still names a
 * launcher pod. The second half is what makes the recovery path work: a guest
 * whose policy is already `Stopped` but which still has a pod - a stop whose
 * second write failed, or a `kubectl patch` somebody else ran - can still be
 * stopped, so the retry the partial-failure message promises is reachable.
 */
export function canStop(guest: GuestActionFacts): ActionGuard {
  if (guest.spec?.runPolicy !== stoppedRunPolicy) {
    return enabled;
  }

  if (launcherPodTarget(guest)) {
    return enabled;
  }

  return disabled("The guest is already stopped, and no launcher pod is recorded.");
}

/**
 * The merge patch a start sends: the one field it changes and nothing else.
 *
 * Never a read-modify-write of the whole spec, which would clobber a field a
 * controller or another user wrote between the read and the write (W6).
 */
export function startPatch(): { spec: { runPolicy: typeof runningRunPolicy } } {
  return { spec: { runPolicy: runningRunPolicy } };
}

/** The merge patch a stop sends, under the same rule as `startPatch`. */
export function stopPatch(): { spec: { runPolicy: typeof stoppedRunPolicy } } {
  return { spec: { runPolicy: stoppedRunPolicy } };
}

/**
 * The launcher pod a stop would delete, or `undefined` when the status names
 * none.
 *
 * Selected by `status.podRef` rather than by the `swift.kubeswift.io/guest`
 * label `swiftctl` uses: the field is the controller's own published pointer to
 * the pod it created, the drawer already reads it, and from a list row the
 * extension has no pods loaded for that namespace at all - so a label selection
 * would mean a list request on every render instead of one `GET` on a click
 * (SPEC-0010, spike S6).
 */
export function launcherPodTarget(guest: GuestActionFacts): LauncherPodTarget | undefined {
  const name = guest.status?.podRef?.name;

  if (!name) {
    return undefined;
  }

  return { name, namespace: guest.status?.podRef?.namespace || guest.namespace };
}

/**
 * What the dialog says about the launcher pod, given what the click-time read
 * found (B3). Four readings, four sentences; only `absent` drops the delete from
 * the sequence, which `stopWrites` decides from the same input.
 */
export function launcherPodSentence(target: LauncherPodTarget, reading: LauncherPodReading): string {
  const podName = `${target.namespace}/${target.name}`;

  if (reading.outcome === "absent") {
    return `The launcher pod ${podName} is already gone, so only the run policy will change.`;
  }

  if (reading.outcome === "unreadable") {
    return `The status records the launcher pod ${podName}, but this could not be verified: reading the pod failed.`;
  }

  if (reading.phase && terminalPodPhases.includes(reading.phase)) {
    return (
      `The launcher pod ${podName} has already exited (${reading.phase}), so this only clears it away; the policy ` +
      "change is what keeps it from coming back."
    );
  }

  const phase = reading.phase ? ` (${reading.phase})` : "";

  return `The launcher pod ${podName}${phase} will be deleted, and the running guest goes with it.`;
}

/**
 * The writes a stop will actually send.
 *
 * Both halves can be dropped, and each drop is what makes "run it again, it will
 * finish the job" a true statement rather than a hopeful one (B4, W9): the patch
 * goes when the policy is already `Stopped`, and the delete goes when the status
 * names no pod or the click-time read found none.
 */
export function stopWrites(guest: GuestActionFacts, reading?: LauncherPodReading): StopWritePlan {
  const target = launcherPodTarget(guest);
  const podIsGone = reading?.outcome === "absent";

  return {
    patchRunPolicy: guest.spec?.runPolicy !== stoppedRunPolicy,
    deletePod: target && !podIsGone ? target : undefined,
  };
}

/**
 * The facts the Start dialog is built from.
 *
 * Beyond the one write it also says what the start will schedule (B8): the guest
 * class, whose sizing is shown when the class object happens to be in the store
 * and whose name alone is shown when it is not (a one-line context is not a
 * reason to issue a request), that a GPU-profiled guest claims a device, and the
 * node the user pinned, because a start that cannot be scheduled anywhere else
 * is worth knowing about before the click rather than from a `Pending` phase
 * afterwards.
 */
export function startDialogFacts(guest: GuestActionFacts, guestClassSummary?: string): ActionDialogFacts {
  const spec = guest.spec;
  const notes: string[] = ["The controller will create a launcher pod and boot the guest."];
  const guestClassName = spec?.guestClassRef?.name;

  if (guestClassName) {
    notes.push(
      guestClassSummary
        ? `It will be sized by the guest class ${guestClassName} (${guestClassSummary}).`
        : `It will be sized by the guest class ${guestClassName}.`,
    );
  }

  if (spec?.gpuProfileRef?.name) {
    notes.push(`It will claim a GPU through the profile ${spec.gpuProfileRef.name}.`);
  } else if (spec?.gpuResourceClaim) {
    notes.push("It will claim a GPU through its resource claim.");
  }

  if (spec?.nodeName) {
    notes.push(`It is pinned to the node ${spec.nodeName}, and can be scheduled nowhere else.`);
  }

  return {
    subject: guestSubject(guest),
    writes: [{ kind: "patch", text: `spec.runPolicy: ${currentRunPolicy(guest)} -> ${runningRunPolicy}` }],
    notes,
    warnings: [],
  };
}

/**
 * The facts the Stop dialog is built from.
 *
 * `reading` is what the click-time `GET` on the launcher pod returned, and it is
 * `undefined` when the status names no pod at all - in which case there was
 * nothing to read, the dialog shows one line instead of two, and it says which
 * of the two situations the user is looking at rather than inventing a pod name
 * to delete.
 *
 * The three conditional cost lines are B6 and B7: the auto-restart policy a stop
 * replaces irreversibly, the address a `nat`-bound guest releases with its pod
 * (deliberately not claimed for a `bridge`-bound one, whose address comes from a
 * network attachment and may well be stable), and the disks a stop keeps.
 */
export function stopDialogFacts(guest: GuestActionFacts, reading?: LauncherPodReading): ActionDialogFacts {
  const plan = stopWrites(guest, reading);
  const target = launcherPodTarget(guest);
  const writes: ActionWrite[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];

  if (plan.patchRunPolicy) {
    writes.push({ kind: "patch", text: `spec.runPolicy: ${currentRunPolicy(guest)} -> ${stoppedRunPolicy}` });
  }

  if (plan.deletePod) {
    writes.push({ kind: "delete", text: `Delete Pod ${plan.deletePod.namespace}/${plan.deletePod.name}` });
  }

  if (target && reading) {
    const sentence = launcherPodSentence(target, reading);

    if (reading.outcome === "unreadable") {
      warnings.push(sentence);
    } else {
      notes.push(sentence);
    }
  }

  if (!target) {
    notes.push("No launcher pod is recorded on this guest, so only the run policy will change.");

    if (guest.status?.phase === guestRunningPhase) {
      warnings.push(
        "The guest still reports the phase Running, so if it really is running, this action will not stop it.",
      );
    }
  }

  if (plan.deletePod) {
    // Deliberately a termination and not a shutdown: the recon found no ACPI
    // power-button call, no call site for the hypervisor client's `shutdown`
    // method, no shutdown operation in the guest agent and no signal handling in
    // the node daemon, while upstream's own documentation describes a graceful
    // SIGTERM. Until a live KVM cluster proves otherwise this sentence says
    // less, which is the cheap direction to be wrong in (B14).
    notes.push(
      "The pod's containers are terminated with the pod, under the default 30-second grace period, and the guest " +
        "is not asked to shut down cleanly.",
    );
  }

  const policy = guest.spec?.runPolicy;

  if (policy && autoRestartRunPolicies.includes(policy)) {
    warnings.push(
      `The run policy ${policy} is replaced: Start will set ${runningRunPolicy}, which does not restart the guest ` +
        "on its own, unless you edit the guest afterwards.",
    );
  }

  const binding = guest.spec?.network?.binding;

  if (guest.status?.network?.primaryIP && (binding === undefined || binding === natNetworkBinding)) {
    warnings.push(
      `The address ${guest.status.network.primaryIP} goes with the pod, and the next start will get a different one.`,
    );
  }

  notes.push("The root disk and every data disk are kept: stopping is not deleting.");

  return { subject: guestSubject(guest), writes, notes, warnings };
}

/**
 * What the delete of this guest takes with it and what it leaves behind (B13),
 * computed from its own spec rather than stated in the abstract.
 *
 * SwiftGuest carries no finalizers, the validating webhook registers no `DELETE`
 * rule and the reconciler has no deletion branch: everything that goes, goes by
 * owner reference. Snapshots in particular reference their guest by name with no
 * owner reference, which is the behaviour a backup deserves and the one a user
 * is most likely to guess wrong.
 */
export interface DeleteCascade {
  /** Controller-owned children, which the garbage collector removes. */
  removed: string[];
  /** Objects nothing owns, which survive the deletion. */
  retained: string[];
}

export function deleteCascade(guest: GuestActionFacts): DeleteCascade {
  const spec = guest.spec;
  const dataDisks = spec?.dataDiskRefs ?? [];
  const removed = ["the launcher pod", "the seed and runtime ConfigMaps", "the cloned root disk"];
  const retained: string[] = [];

  if (dataDisks.some((disk) => disk.blank)) {
    removed.push("the blank data disks and their fill jobs");
  }

  if ((spec?.network?.ports ?? []).length > 0) {
    removed.push("the per-guest Service");
  }

  const attachedDisks = dataDisks
    .filter((disk) => disk.pvcRef?.name)
    .map((disk) => disk.pvcRef?.name)
    .filter((name): name is string => Boolean(name));

  if (attachedDisks.length > 0) {
    retained.push(`the data disks attached through an explicit PVC reference (${attachedDisks.join(", ")})`);
  }

  if (spec?.imageRef?.name) {
    retained.push(`the shared image ${spec.imageRef.name}`);
  }

  retained.push("every snapshot taken of this guest");

  return { removed, retained };
}

/** The success sentence a start ends with: the fact that was written, never a prediction (W9). */
export function startSuccessMessage(): string {
  return `Run policy set to ${runningRunPolicy}`;
}

/**
 * The success sentence a stop ends with, naming exactly what was written - which
 * is why it is derived from the plan rather than assumed: a stop that only had a
 * pod left to delete says so.
 */
export function stopSuccessMessage(plan: StopWritePlan): string {
  const podName = plan.deletePod?.name;

  if (plan.patchRunPolicy && podName) {
    return `Run policy set to ${stoppedRunPolicy} and launcher pod ${podName} deleted`;
  }

  if (podName) {
    return `Launcher pod ${podName} deleted`;
  }

  return `Run policy set to ${stoppedRunPolicy}`;
}

/**
 * What a half-applied stop left behind, and how to finish the job (W9, B9).
 *
 * Naming both halves is not enough: the message says what is now true of the
 * cluster and that repeating the action retries only what is missing. That last
 * clause is honest only because `stopWrites` drops the patch that has become a
 * no-op, and because `canStop` keeps Stop enabled in exactly this state.
 */
export function stopPartialFailureMessage(podName: string): string {
  return (
    `The run policy is now ${stoppedRunPolicy}, so the controller will not bring this guest back once it exits, ` +
    `but the launcher pod ${podName} is still there and the guest is still running. Running Stop again retries ` +
    "just the deletion."
  );
}

/** What a caught write failure carries, once the host's error object has been read. */
export interface ApiFailureFacts {
  /** The HTTP status the API server answered with, when the error carries one. */
  code?: number;
  /** The API server's own `Status.message`. */
  message?: string;
  /**
   * True when the host has already toasted this error globally. Freelens toasts
   * every 403 from `apiKube` itself (`api-kube.injectable.ts`) and marks it, so
   * a second notification from here would be a duplicate (spike S4).
   */
  alreadyNotified: boolean;
}

/**
 * Reads a caught error without assuming its class.
 *
 * A Kubernetes error arrives as `JsonApiErrorParsed`, which is not an `Error`:
 * its `toString()` is the API server's own `Status.message` and it carries the
 * parsed `Status` (with its `code`) and the `isUsedForNotification` flag. The
 * access is narrowed structurally rather than through `any`, so an error of any
 * other shape simply reports nothing instead of throwing in the error path.
 */
export function apiFailureFacts(error: unknown): ApiFailureFacts {
  if (typeof error !== "object" || error === null) {
    return { message: typeof error === "string" ? error : undefined, alreadyNotified: false };
  }

  const holder = error as { error?: { code?: unknown }; code?: unknown; isUsedForNotification?: unknown };
  const rawCode = typeof holder.error?.code === "number" ? holder.error.code : holder.code;
  const message = String(error);

  return {
    code: typeof rawCode === "number" ? rawCode : undefined,
    message: message && message !== "[object Object]" ? message : undefined,
    alreadyNotified: holder.isUsedForNotification === true,
  };
}

/** Which write failed, for the one actionable sentence a predictable failure is prefixed with (B10). */
export interface WriteFailureContext {
  /** The API verb that was refused, as RBAC spells it: `patch`, `delete`. */
  verb: string;
  /** The resource, as RBAC spells it: `swiftguests`, `pods`. */
  resource: string;
  namespace: string;
}

/** The status codes whose failure is predictable enough to say something useful about. */
export const forbiddenStatusCode = 403;
export const notFoundStatusCode = 404;

/**
 * The message a failed write is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9, B10).
 *
 * An unrecognized failure is passed through exactly as it arrived, because
 * anything this extension could add to it would be a guess.
 */
export function writeFailureMessage(failure: ApiFailureFacts, context: WriteFailureContext): string | undefined {
  const prefix = writeFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/** The actionable sentence alone, for the two failures this milestone can predict. */
export function writeFailurePrefix(code: number | undefined, context: WriteFailureContext): string | undefined {
  if (code === forbiddenStatusCode) {
    return `You are not allowed to ${context.verb} ${context.resource} in the namespace ${context.namespace}.`;
  }

  if (code === notFoundStatusCode) {
    return "The object is gone from the cluster, and the list is about to catch up.";
  }

  return undefined;
}

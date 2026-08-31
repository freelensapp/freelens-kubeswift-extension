/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Migrate dialog decides, as pure functions over structurally
// declared inputs (SPEC-0012, "Where the code lives"): the guard, the per-guest
// mode availability and the reasons a mode is refused, the prediction of what
// `auto` will resolve to, the storage capability read off the guest-class merge,
// the field validation that replaces the admission webhook, the payload the
// create sends, the live write summary, the sentences the notifications carry,
// and the drawer's On Delete row.
//
// Nothing here emits JSX, reads a store, or touches a host global. A fact only
// the renderer can know - which nodes the one-shot read returned, which
// migrations the store happens to hold, what the guest's class says, what time
// it is when the item is clicked - is taken as an argument, which is what keeps
// the interesting half of this dialog unit-testable without a cluster.
//
// What creating a SwiftMigration mechanically IS is the reason this module
// exists, and almost none of it is in the schema:
//
// - `auto` is the default and resolves to `live` whenever the guest looks
//   eligible - WITHOUT ever consulting storage. The resolver checks VFIO,
//   node-local virtio backends and networking, defaults to `offline` and
//   promotes to `live` when all of them pass; the RWX+Block gate exists only in
//   the admission webhook, and only for an EXPLICIT `mode: live`. A default-mode
//   migration of an eligible guest on RWO storage therefore walks into a live
//   migration whose two launcher pods contend for one RWO PVC (drift D1). This
//   module computes the same resolution the controller will, says it out loud,
//   and applies the storage gate to the RESOLVED mode.
// - `offline` means stop, move nothing, restart: the run policy is patched, the
//   launcher pod deleted, and the SAME root-disk PVC is reattached on the
//   target. The StorageClass must support cross-node attach and nothing upstream
//   checks that. Offline of a STOPPED guest boots it on the target.
// - Offline has no timeout: `spec.timeout` is read in exactly two live-mode
//   places, and `timeoutStrategy` is never read at all, so an offline migration
//   can park forever with the guest stopped and claimed.
// - `live` runs two launcher pods for the same guest, on both nodes, for the
//   whole transfer, and needs a running source pod, RWX+Block storage (webhook
//   only, kernel-boot guests exempt), no VFIO and no node-local virtio backends.
// - SR-IOV guests cannot migrate at all, in any mode, and nothing re-checks it
//   once the webhook is off - which it is, by default.
// - Every cross-field rule mirrored below lives in that same validating webhook.
//   Thirteen of them have no controller re-check at all, which is most of why
//   this module exists.

import { notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import { guestRunningPhase } from "./guest-status";
import { liveAccessMode, liveVolumeMode } from "./kube-storage";
import { objectNameError, sriovInterfaceType } from "./snapshot-create";

import type {
  SwiftMigrationMode,
  SwiftMigrationPhase,
  SwiftMigrationSpec,
} from "../api/kubeswift/swiftmigration-v1alpha1";
import type { ActionGuard, ApiFailureFacts } from "./guest-actions";

/** The three modes the schema's enum allows, in the order the dialog offers them. */
export const migrationModes: SwiftMigrationMode[] = ["auto", "live", "offline"];

/** The schema's own default, and the one the dialog opens on. */
export const defaultMigrationMode: SwiftMigrationMode = "auto";

/** The two modes `auto` can resolve to. */
export type ResolvedMigrationMode = "live" | "offline";

/** The label a node must carry before a kernel-boot guest can run on it. */
export const kernelNodeLabel = "kubeswift.io/kernel-node";
export const kernelNodeLabelValue = "true";

/**
 * Whether this node is one a kernel-boot guest can run on.
 *
 * One function for the rule, because two surfaces ask it: the Migrate dialog's
 * target picker (this file) and the Create Guest form's node pin on kernel boot
 * (SPEC-0013 slice 2). The controller pulls the kernel artifact onto the
 * labelled nodes only, so an unlabelled node cannot start such a guest at all.
 */
export function isKernelNode(node: Pick<NodeFacts, "labels">): boolean {
  return node.labels?.[kernelNodeLabel] === kernelNodeLabelValue;
}

/** The phases before the cutover, from which a delete rolls an offline migration back. */
export const preCutoverPhases: SwiftMigrationPhase[] = ["Pending", "Validating", "Preparing"];

/** The phases from the cutover on, from which nothing is rolled back. */
export const postCutoverPhases: SwiftMigrationPhase[] = ["StopAndCopy", "Resuming"];

/** The phases from which nothing more will happen. */
export const terminalMigrationPhases: SwiftMigrationPhase[] = ["Completed", "Failed", "Cancelled"];

/** The webhook's own bounds on `spec.timeout`, in milliseconds. */
export const minTimeoutMs = 60_000;
export const maxTimeoutMs = 24 * 60 * 60 * 1000;

/** The webhook's own window for `spec.downtimeTarget`, in milliseconds. */
export const minDowntimeMs = 10;
export const maxDowntimeMs = 10_000;

/** The webhook's own bounds on `spec.parallelConnections`. */
export const minParallelConnections = 0;
export const maxParallelConnections = 16;

/** The webhook's own cap on `spec.reason`. */
export const maxReasonLength = 256;

/** What a SwiftGuest's spec must look like for these functions to read it. */
export interface MigrationGuestSpecFacts {
  filesystems?: { name?: string }[];
  gpuProfileRef?: { name?: string };
  gpuResourceClaim?: unknown;
  guestClassRef?: { name?: string };
  interfaces?: { name?: string; type?: string; primary?: boolean; networkRef?: { name?: string } }[];
  kernelRef?: { name?: string };
  migration?: { enabled?: boolean };
  nodeName?: string;
  storage?: { accessMode?: string; volumeMode?: string };
  vhostUserDevices?: { name?: string }[];
}

/** What a SwiftGuest's status must look like for these functions to read it. */
export interface MigrationGuestStatusFacts {
  nodeName?: string;
  phase?: string;
  podRef?: { name?: string };
}

/**
 * The slice of a SwiftGuest this dialog works on, built from the live object at
 * click time so the gating and the summary quote the same facts (W1).
 */
export interface MigrationGuestFacts {
  name: string;
  namespace: string;
  spec?: MigrationGuestSpecFacts;
  status?: MigrationGuestStatusFacts;
}

/** The slice of a SwiftGuestClass the storage capability is read from. */
export interface MigrationGuestClassFacts {
  name: string;
  storage?: { accessMode?: string; volumeMode?: string };
}

/** One node of the cluster, as the one-shot read on open hands it over. */
export interface NodeFacts {
  name: string;
  /** The `Ready` condition, as the cluster reports it. */
  ready: boolean;
  /** `spec.unschedulable` inverted: a cordoned node takes nothing new. */
  schedulable: boolean;
  labels?: Record<string, string | undefined>;
}

/** A SwiftMigration of this guest that has not finished, as the stores hold it. */
export interface InFlightMigrationFacts {
  name: string;
  phase?: string;
  mode?: SwiftMigrationMode;
  /** The `selfLink` the drawer of that object is opened from. */
  selfLink?: string;
}

/**
 * Everything the dialog knows about the cluster when it decides something.
 *
 * One object rather than five parameters because every decision below reads a
 * different subset of it, and because the dialog holds exactly this and hands it
 * over unchanged - the click-time snapshot of W1, refined by the reads on open.
 */
export interface MigrationInputs {
  guest: MigrationGuestFacts;
  /** The guest's class, or `undefined` when it is not in the store and could not be read. */
  guestClass?: MigrationGuestClassFacts;
  /** The cluster's nodes, as the one-shot read returned them; empty until it answers. */
  nodes: NodeFacts[];
  /** True when that read was refused: the node becomes a typed, unverified name. */
  nodesUnverified: boolean;
  /** The non-terminal migrations of this guest, for the warning no upstream surface has. */
  inFlight: InFlightMigrationFacts[];
  /** The namespace's SwiftMigration names, for the collision warning. */
  existingNames: string[];
}

const enabledGuard: ActionGuard = { enabled: true };

function disabled(reason: string): ActionGuard {
  return { enabled: false, reason };
}

/** The SR-IOV interfaces of a guest, by name, for the reason migration is refused. */
function sriovInterfaceNames(guest: MigrationGuestFacts): string[] {
  return (guest.spec?.interfaces ?? [])
    .filter((networkInterface) => networkInterface.type === sriovInterfaceType)
    .map((networkInterface, index) => networkInterface.name || `interface ${index + 1}`);
}

/**
 * Whether the item offers to migrate this guest at all.
 *
 * Two refusals, and they are opposites in how much upstream agrees with them.
 * `migration.enabled: false` is the one precondition that fails cleanly
 * everywhere - the webhook refuses it and the controller refuses it again - so
 * disabling the item costs nothing and saves a round trip. SR-IOV is refused by
 * the webhook in every mode and re-checked by NOBODY, so with the webhook off
 * (the default) this guard is the only thing between an operator and a migration
 * that cannot work.
 *
 * Everything else is enabled, stopped and unsettled guests included: an offline
 * migration of a stopped guest is legitimate (and disclosed in the summary), and
 * unknown state permits (W4). The `deletionTimestamp` exception is the
 * component's, as in SPEC-0010: a terminating object gets no action item at all.
 */
export function canMigrate(guest: MigrationGuestFacts): ActionGuard {
  if (guest.spec?.migration?.enabled === false) {
    return disabled(
      "Migrations are not permitted for this guest: spec.migration.enabled is false, and upstream refuses the " +
        "migration both at admission and in the controller.",
    );
  }

  const sriov = sriovInterfaceNames(guest);

  if (sriov.length > 0) {
    return disabled(
      "Upstream's admission rule refuses migration of an SR-IOV guest in every mode, and nothing re-checks it when " +
        `the webhook is off - which it is, by default. This guest has ${sriov.join(", ")}.`,
    );
  }

  return enabledGuard;
}

/** What the guest-class merge says about the disk this migration would move. */
export interface StorageCapability {
  accessMode?: string;
  volumeMode?: string;
  /** A kernel-boot guest is exempt from upstream's RWX+Block rule. */
  exempt: boolean;
  /** Both fields could be read, so the verdict below is a fact rather than a guess. */
  resolved: boolean;
  /** Storage both nodes can hold at once - or a guest the rule does not apply to. */
  liveCapable: boolean;
}

/**
 * The storage a live migration would have to share between two nodes, read off
 * the guest-class merge the same way the guest controller builds the PVC: the
 * guest's own `spec.storage` wins per field, the class supplies the rest.
 *
 * Kernel-boot guests are exempt because upstream exempts them: they do not boot
 * from a cloned root disk at all, so there is no volume for two launcher pods to
 * contend for.
 *
 * A class that is not in the store and could not be read leaves this
 * `resolved: false`, which is deliberately NOT a refusal: a read that fails must
 * not block a write the user is allowed to make (W4), so live stays offered and
 * the summary marks the storage unverified.
 */
export function storageCapability(inputs: MigrationInputs): StorageCapability {
  const { guest, guestClass } = inputs;

  if (guest.spec?.kernelRef?.name) {
    return { exempt: true, resolved: true, liveCapable: true };
  }

  const accessMode = guest.spec?.storage?.accessMode ?? guestClass?.storage?.accessMode;
  const volumeMode = guest.spec?.storage?.volumeMode ?? guestClass?.storage?.volumeMode;
  const resolved = Boolean(accessMode && volumeMode);

  return {
    accessMode,
    volumeMode,
    exempt: false,
    resolved,
    liveCapable: accessMode === liveAccessMode && volumeMode === liveVolumeMode,
  };
}

/** How the storage reads in a sentence, for the refusal and for the summary. */
function storageText(storage: StorageCapability): string {
  return `${storage.accessMode ?? "an unreported access mode"}/${storage.volumeMode ?? "an unreported volume mode"}`;
}

/** Whether this guest holds a VFIO device, which is what upstream refuses to live-migrate. */
export function hasVfioDevices(guest: MigrationGuestFacts): boolean {
  return Boolean(guest.spec?.gpuProfileRef?.name) || Boolean(guest.spec?.gpuResourceClaim);
}

/** The node-local virtio backends a live migration cannot carry to another node. */
export function nodeLocalBackends(guest: MigrationGuestFacts): string[] {
  const filesystems = (guest.spec?.filesystems ?? []).map((filesystem, index) =>
    filesystem.name ? `the filesystem ${filesystem.name}` : `filesystem ${index + 1}`,
  );
  const devices = (guest.spec?.vhostUserDevices ?? []).map((device, index) =>
    device.name ? `the vhost-user device ${device.name}` : `vhost-user device ${index + 1}`,
  );

  return [...filesystems, ...devices];
}

/** Whether the guest is running with a launcher pod recorded, which live needs. */
export function guestIsLive(guest: MigrationGuestFacts): boolean {
  return guest.status?.phase === guestRunningPhase && Boolean(guest.status?.podRef?.name);
}

/**
 * Whether a live migration of this guest can be offered, and why not when it
 * cannot (W4).
 *
 * The order is the spec's own table, and it is deliberate: the live-state rule
 * comes first because it is the one an operator can act on (start the guest,
 * then migrate), while VFIO and the virtio backends are properties of the
 * guest's shape that starting it would not change, and the storage gate is last
 * because it is the one that depends on a read that can fail.
 *
 * All four refusals describe upstream behaviour rather than a preference. The
 * last one is the sharpest: upstream applies it only at admission, to an
 * explicit `mode: live`, in a webhook that ships disabled - so on a default
 * install nobody else enforces it at all.
 */
export function liveModeGuard(inputs: MigrationInputs): ActionGuard {
  const { guest } = inputs;

  if (!guestIsLive(guest)) {
    const phase = guest.status?.phase;
    const phaseText = phase ? `is ${phase}` : "has no phase yet";
    const podText = guest.status?.podRef?.name ? "" : " and no launcher pod is recorded";

    return disabled(
      `A live migration needs the running VM: upstream fails a live migration of a non-running guest. This guest ` +
        `${phaseText}${podText}, so it can only move offline.`,
    );
  }

  if (hasVfioDevices(guest)) {
    const profile = guest.spec?.gpuProfileRef?.name;

    return disabled(
      "Upstream refuses to live-migrate a guest that holds a VFIO device: " +
        `${profile ? `this guest uses the GPU profile ${profile}` : "this guest claims a GPU through its resource claim"}. ` +
        "It moves offline instead, with the GPU released on the source and re-reserved on the target.",
    );
  }

  const backends = nodeLocalBackends(guest);

  if (backends.length > 0) {
    return disabled(
      `Upstream refuses to live-migrate a guest with a node-local virtio backend: this guest has ` +
        `${backends.join(", ")}, which exists on its current node only.`,
    );
  }

  const storage = storageCapability(inputs);

  if (storage.resolved && !storage.liveCapable) {
    return disabled(
      `A live migration needs storage both nodes can hold at once (${liveAccessMode} and ${liveVolumeMode}); this ` +
        `guest resolves to ${storageText(storage)}. Upstream enforces this only at admission, in a webhook that ` +
        "ships disabled, so on a default install nothing else would stop it.",
    );
  }

  return enabledGuard;
}

/**
 * Whether the guest's address survives the move, which decides whether the IP
 * consent means anything at all.
 *
 * The primary interface is the one marked `primary`, or the first one declared;
 * a guest with no interfaces at all is on default node-local networking, which
 * is exactly the case whose address does not survive. A `networkRef` means the
 * address comes from a network attachment that follows the guest, so those
 * guests keep their IP and are shown nothing (M7).
 */
export function ipConsentApplies(guest: MigrationGuestFacts): boolean {
  const interfaces = guest.spec?.interfaces ?? [];

  if (interfaces.length === 0) {
    return true;
  }

  const primary = interfaces.find((networkInterface) => networkInterface.primary) ?? interfaces[0];

  return !primary.networkRef?.name;
}

/** The fact the consent checkbox and the summary both state, once each. */
export const freshIpFact =
  "The guest's address does not survive a cross-node move on default networking: it will get a fresh IP on the " +
  "target, and connections to the old one break.";

/** Why the consent is checked and locked rather than offered as a choice. */
export const ipConsentLockRule =
  "spec.allowIPChange is consent and nothing else: with the admission webhook on, refusing it only turns the " +
  "migration into a rejection, and with the webhook off - the default - the address changes anyway.";

/** What `auto` will resolve to, computed the way the controller computes it. */
export interface AutoResolution {
  mode: ResolvedMigrationMode;
  /** The because-clause, without its leading "because". */
  because: string;
  /** True when the prediction rests on the one input this extension cannot read. */
  assumesNoUdn: boolean;
}

/**
 * The mode `auto` will resolve to, in upstream's own resolver order.
 *
 * Upstream checks VFIO, then node-local virtio backends, then networking, then
 * the namespace's user-defined networks, defaults to `offline`, and promotes to
 * `live` when everything passes. This mirrors that order, with the live-state
 * rule first for the same reason `liveModeGuard` puts it first: a stopped guest
 * cannot be live-migrated, so predicting `live` for one would be a prediction of
 * a failure.
 *
 * `allowIPChange` is a parameter rather than a derived constant because the
 * resolver reads the field, not the dialog: this dialog always sends the consent
 * where it applies (so the branch never fires from here), and passing `false`
 * is how the resolver's own behaviour for a client that does not - `swiftctl`,
 * `kubectl` - stays covered and testable.
 *
 * The one input the extension cannot see is a primary OVN-K user-defined network
 * in the namespace: modelling the NAD kinds for it is out of scope, so the
 * prediction states the assumption instead of half-implementing the check.
 */
export function autoPrediction(
  inputs: MigrationInputs,
  allowIPChange = ipConsentApplies(inputs.guest),
): AutoResolution {
  const { guest } = inputs;

  if (!guestIsLive(guest)) {
    return {
      mode: "offline",
      because: `this guest ${guest.status?.phase ? `is ${guest.status.phase}` : "has no running launcher pod"} and a live migration needs the running VM`,
      assumesNoUdn: false,
    };
  }

  if (hasVfioDevices(guest)) {
    return { mode: "offline", because: "this guest holds a VFIO device", assumesNoUdn: false };
  }

  const backends = nodeLocalBackends(guest);

  if (backends.length > 0) {
    return {
      mode: "offline",
      because: `this guest has a node-local virtio backend (${backends.join(", ")})`,
      assumesNoUdn: false,
    };
  }

  if (ipConsentApplies(guest) && !allowIPChange) {
    return {
      mode: "offline",
      because: "this guest is on default networking and the migration does not consent to the address change",
      assumesNoUdn: false,
    };
  }

  return {
    mode: "live",
    because:
      "the guest is running, holds no VFIO device and no node-local virtio backend, and its address is either " +
      "preserved or consented to",
    assumesNoUdn: true,
  };
}

/** The prediction as the mode control and the summary both say it. */
export function autoPredictionLine(resolution: AutoResolution): string {
  const assumption = resolution.assumesNoUdn
    ? " This assumes no primary user-defined network in this namespace, which is the one resolver input this dialog " +
      "cannot read."
    : "";

  return `auto will resolve to: ${resolution.mode}, because ${resolution.because}.${assumption}`;
}

/**
 * The mode this migration will really run in, as far as the dialog can tell: the
 * selected one, or what `auto` is predicted to become.
 *
 * This, and not the selected value, is what decides which fields exist: a
 * timeout field rendered for a migration whose resolved mode never reads it
 * would be the dead input W12 forbids, and one hidden from a migration that
 * resolves to `live` would be the option dropping W12 also forbids.
 */
export function effectiveMigrationMode(inputs: MigrationInputs, mode: SwiftMigrationMode): ResolvedMigrationMode {
  return mode === "auto" ? autoPrediction(inputs).mode : mode;
}

/** One option of the mode select, with what it means for this guest and its verdict. */
export interface MigrationModeChoice {
  mode: SwiftMigrationMode;
  /**
   * How the option reads in the control: the mode, and for `auto` what it will
   * resolve to. Short on purpose - the sentence below is rendered under the
   * control and in the summary, and a select whose own label is a paragraph is
   * unreadable in every theme.
   */
  label: string;
  /** One sentence about what this mode does to THIS guest, never generic prose (M2). */
  note: string;
  guard: ActionGuard;
}

/** What each mode means for this guest, in one sentence naming the target when there is one. */
function modeNote(inputs: MigrationInputs, mode: SwiftMigrationMode, targetNode: string): string {
  const target = targetNode || "the target node";

  if (mode === "auto") {
    return autoPredictionLine(autoPrediction(inputs));
  }

  if (mode === "live") {
    return (
      `The VM keeps serving while its memory is pre-copied to ${target}; the cutover then deletes the source pod ` +
      "and costs a short measured downtime."
    );
  }

  return guestIsLive(inputs.guest)
    ? `The guest is stopped, its disk is reattached on ${target}, and it is started again there. Nothing is copied.`
    : `The guest is already stopped: this moves it to ${target} and starts it there.`;
}

/**
 * The three modes, each carrying its verdict and its per-guest sentence.
 *
 * `auto` and `offline` are never refused: `auto` always resolves to something,
 * and `offline` is the mode every other refusal points at.
 */
export function migrationModeChoices(inputs: MigrationInputs, targetNode = ""): MigrationModeChoice[] {
  const live = liveModeGuard(inputs);

  return migrationModes.map((mode) => ({
    mode,
    label: mode === "auto" ? `auto (resolves to: ${autoPrediction(inputs).mode})` : mode,
    note: modeNote(inputs, mode, targetNode),
    guard: mode === "live" ? live : enabledGuard,
  }));
}

/** The node this guest is on right now, which a migration may never target. */
export function currentNodeName(guest: MigrationGuestFacts): string | undefined {
  return guest.status?.nodeName || guest.spec?.nodeName || undefined;
}

/** One option of the node picker, with the reason it cannot be chosen when it cannot. */
export interface NodeChoice {
  name: string;
  guard: ActionGuard;
}

/**
 * The nodes this migration can be pointed at.
 *
 * Not Ready, cordoned and the guest's own node are dropped rather than disabled:
 * the first two cannot take the guest at all, and the third is upstream's
 * same-node refusal, which lives in the webhook only - without it the controller
 * happily stops the guest and restarts it where it already was, which is a
 * reboot disguised as a migration. A node that is left is offered, and disabled
 * with its reason only for the one constraint that is about this guest rather
 * than about the node: a kernel-boot guest needs a node labelled for kernels.
 */
export function nodeChoices(inputs: MigrationInputs): NodeChoice[] {
  const current = currentNodeName(inputs.guest);
  const needsKernelNode = Boolean(inputs.guest.spec?.kernelRef?.name);

  return inputs.nodes
    .filter((node) => node.ready && node.schedulable && node.name !== current)
    .map((node) => {
      if (needsKernelNode && !isKernelNode(node)) {
        return {
          name: node.name,
          guard: disabled(
            `This guest boots the kernel ${inputs.guest.spec?.kernelRef?.name}, and ${node.name} does not carry ` +
              `${kernelNodeLabel}: ${kernelNodeLabelValue}, so it cannot run a kernel-boot guest.`,
          ),
        };
      }

      return { name: node.name, guard: enabledGuard };
    });
}

/**
 * Why the picker is empty, counted rather than asserted.
 *
 * An empty control with no explanation is the state upstream's own picker
 * degrades to; naming which nodes were dropped, and why, is what turns "there is
 * nothing here" into something an operator can act on.
 */
export function noNodeReason(inputs: MigrationInputs): string {
  const current = currentNodeName(inputs.guest);
  const excluded: string[] = [];
  const currentCount = inputs.nodes.filter((node) => node.name === current).length;
  const notReady = inputs.nodes.filter((node) => node.name !== current && !node.ready).length;
  const cordoned = inputs.nodes.filter((node) => node.name !== current && node.ready && !node.schedulable).length;

  if (currentCount > 0) {
    excluded.push(`${current} is the node this guest is already on`);
  }

  if (notReady > 0) {
    excluded.push(`${notReady} ${notReady === 1 ? "is" : "are"} not Ready`);
  }

  if (cordoned > 0) {
    excluded.push(`${cordoned} ${cordoned === 1 ? "is" : "are"} cordoned`);
  }

  const total = inputs.nodes.length;
  const tail = excluded.length > 0 ? `: ${excluded.join(", ")}.` : ".";

  return `No node in this cluster can take this guest. It has ${total} ${total === 1 ? "node" : "nodes"}${tail}`;
}

/** Every field the form holds, in one flat object so the model is one observable. */
export interface MigrationFormValues {
  name: string;
  targetNode: string;
  mode: SwiftMigrationMode;
  /** Go duration. Live only: no offline handler reads `spec.timeout`. */
  timeout: string;
  /** Go duration, the Cloud Hypervisor pause-window hint. Live only. */
  downtimeTarget: string;
  /** Kept as typed text so an invalid number is reported rather than swallowed. */
  parallelConnections: string;
  reason: string;
  ttl: string;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The default name: the guest's, plus the local wall-clock time of the click.
 *
 * To the second, and local rather than UTC, for the same reason the two
 * SPEC-0011 dialogs use that shape: the operator reads it against their own
 * clock, and a human migrates one guest twice within a minute often enough that
 * a coarser stamp would collide.
 */
export function defaultMigrationName(guestName: string, now: Date): string {
  return `${guestName}-migrate-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The form the dialog opens with. Every default is the one the spec's field table names. */
export function defaultMigrationForm(guest: MigrationGuestFacts, now: Date): MigrationFormValues {
  return {
    name: defaultMigrationName(guest.name, now),
    targetNode: "",
    mode: defaultMigrationMode,
    timeout: "",
    downtimeTarget: "",
    parallelConnections: "",
    reason: "",
    ttl: "",
  };
}

/** Whether the live-only fields exist for this form, from the mode that will really run. */
export function liveFieldsApply(inputs: MigrationInputs, values: MigrationFormValues): boolean {
  return effectiveMigrationMode(inputs, values.mode) === "live";
}

/** The fields validation and the warnings are keyed on, so a message renders next to its input. */
export type MigrationField =
  | "name"
  | "targetNode"
  | "mode"
  | "timeout"
  | "downtimeTarget"
  | "parallelConnections"
  | "reason"
  | "ttl";

/** One message per field, absent when the field has nothing to say. */
export type MigrationFieldMessages = Partial<Record<MigrationField, string>>;

/** How the submit-disabled sentence names each field (W4: it names the field AND the reason). */
export const migrationFieldLabels: Record<MigrationField, string> = {
  name: "Name",
  targetNode: "Target node",
  mode: "Mode",
  timeout: "Timeout",
  downtimeTarget: "Downtime target",
  parallelConnections: "Parallel connections",
  reason: "Reason",
  ttl: "TTL",
};

/** The order the submit-disabled sentence reports the first offending field in. */
const fieldOrder: MigrationField[] = [
  "mode",
  "targetNode",
  "name",
  "timeout",
  "downtimeTarget",
  "parallelConnections",
  "reason",
  "ttl",
];

/**
 * A Go duration, which is what `timeout`, `downtimeTarget` and `ttl` all are.
 *
 * The schema declares plain strings, but the fields deserialize to
 * `metav1.Duration`, so the API server's own decoder parses them with
 * `time.ParseDuration`: `90s`, `30m` and `1h30m` are fine and `7d` is not,
 * because days are not one of the units. Returns milliseconds, because every
 * bound the webhook enforces is a comparison rather than a format check.
 */
export function parseGoDuration(value: string): number | undefined {
  const match = /^([+-])?((?:\d+(?:\.\d+)?(?:ns|us|µs|μs|ms|s|m|h))+)$/.exec(value);

  if (!match) {
    return undefined;
  }

  const unitMs: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    μs: 1e-3,
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
  };
  let total = 0;

  for (const term of match[2].matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)/g)) {
    total += Number(term[1]) * unitMs[term[2]];
  }

  return match[1] === "-" ? -total : total;
}

/** The message every duration field carries when it does not parse, naming the units. */
export const durationFormatMessage =
  "This must be a Go duration, like 90s, 30m or 1h30m. The units are ns, us, ms, s, m and h - days are not one of " +
  "them, so a day is 24h rather than 1d.";

/** The control characters upstream's own validation refuses in `spec.reason`. */
//
// Written as escapes rather than as literal characters, because a source file
// that contains the characters it refuses is a file no editor renders honestly.
const controlCharacters = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/**
 * Everything that would make this create fail, keyed by field.
 *
 * These are the admission webhook's own rules, and this is the only place they
 * are enforced on a default install: upstream ships that webhook disabled
 * (`webhook.enabled: false`), so nobody else produces these messages and the
 * mistake surfaces much later as a `Failed` phase or a permanent `Validating`.
 *
 * The `mode` entry is the exception, and it is the D1 closure: it refuses a
 * combination upstream ACCEPTS - a default-mode migration of an eligible guest
 * whose storage no two launcher pods can share - because accepting it is how a
 * guest ends up with two pods contending for one RWO PVC.
 */
export function migrationErrors(inputs: MigrationInputs, values: MigrationFormValues): MigrationFieldMessages {
  const errors: MigrationFieldMessages = {};
  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  const targetNode = values.targetNode.trim();
  const choices = nodeChoices(inputs);

  if (!targetNode) {
    errors.targetNode =
      inputs.nodes.length > 0 && choices.length === 0
        ? noNodeReason(inputs)
        : "A target node is required: a migration that names none is refused at admission, and without the webhook " +
          "it never resolves.";
  } else {
    const chosen = choices.find((choice) => choice.name === targetNode);

    if (chosen && !chosen.guard.enabled) {
      errors.targetNode = chosen.guard.reason;
    }
  }

  const live = liveModeGuard(inputs);

  if (values.mode === "live" && !live.enabled) {
    errors.mode = live.reason;
  }

  // The one place this spec allows a block, and the reason it exists: the
  // resolved mode is certain from inputs this dialog owns, and the combination
  // it refuses is the one upstream walks into by default (D1).
  if (values.mode === "auto") {
    const prediction = autoPrediction(inputs);
    const storage = storageCapability(inputs);

    if (prediction.mode === "live" && storage.resolved && !storage.liveCapable) {
      // Deliberately short, and deliberately NOT a second copy of the
      // prediction line: that line is rendered under the control already, and
      // the live option carries the whole storage rule with its refusal. What
      // is left is the fact those two do not state together - that the default
      // mode walks into it - and the choice that avoids it.
      errors.mode =
        `auto will resolve to live, and a live migration needs ${liveAccessMode} and ${liveVolumeMode} storage: two ` +
        `launcher pods would contend for this guest's ${storageText(storage)} volume. Pick offline, or fix the ` +
        "storage.";
    }
  }

  const liveFields = liveFieldsApply(inputs, values);

  if (liveFields) {
    const timeout = values.timeout.trim();

    if (timeout) {
      const parsed = parseGoDuration(timeout);

      if (parsed === undefined) {
        errors.timeout = durationFormatMessage;
      } else if (parsed < minTimeoutMs) {
        errors.timeout = "The timeout must be at least 60s: upstream refuses anything shorter.";
      } else if (parsed > maxTimeoutMs) {
        errors.timeout = "The timeout must be at most 24h: upstream refuses anything longer.";
      }
    }

    const downtime = values.downtimeTarget.trim();

    if (downtime) {
      const parsed = parseGoDuration(downtime);

      if (parsed === undefined) {
        errors.downtimeTarget = durationFormatMessage;
      } else if (parsed < minDowntimeMs || parsed > maxDowntimeMs) {
        errors.downtimeTarget = "The downtime target must be between 10ms and 10s, which is upstream's own window.";
      }
    }

    const connections = values.parallelConnections.trim();

    if (connections) {
      const parsed = Number(connections);

      if (!/^\d+$/.test(connections) || parsed < minParallelConnections || parsed > maxParallelConnections) {
        errors.parallelConnections = `This must be a whole number between ${minParallelConnections} and ${maxParallelConnections}.`;
      }
    }
  }

  const reason = values.reason;

  if (reason.length > maxReasonLength) {
    errors.reason = `The reason must be at most ${maxReasonLength} characters; this one is ${reason.length}.`;
  } else if (controlCharacters.test(reason)) {
    errors.reason = "The reason must not contain control characters. Spaces and tabs are fine.";
  }

  const ttl = values.ttl.trim();

  if (ttl) {
    const parsed = parseGoDuration(ttl);

    if (parsed === undefined) {
      errors.ttl = durationFormatMessage;
    } else if (parsed <= 0) {
      errors.ttl = "The TTL must be positive: upstream refuses zero and negative retentions.";
    }
  }

  return errors;
}

/**
 * Everything worth saying about a field that would still be accepted.
 *
 * Warnings never block (W12): the store can be stale, the API server is the
 * authority, and a warned submit that 409s is honest where a blocked one is a
 * client-side heuristic in the driver's seat.
 */
export function migrationWarnings(inputs: MigrationInputs, values: MigrationFormValues): MigrationFieldMessages {
  const warnings: MigrationFieldMessages = {};
  const name = values.name.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name =
      "A SwiftMigration with this name already exists in this namespace. Submitting will be refused by the API " +
      "server; the fix is a different name.";
  }

  return warnings;
}

/**
 * Why the submit button is disabled, naming the field and the reason (W4 applied
 * to submit buttons), or `undefined` when the form can be sent.
 *
 * The mode is reported before the required node on purpose: the two can be wrong
 * at once - a freshly opened dialog on a guest whose storage cannot carry the
 * mode `auto` will resolve to has no node yet either - and picking a node would
 * not fix the mode, while the mode's message names the choice that does. Every
 * other form has no mode error at all, so the node keeps the sentence there.
 */
export function migrationSubmitBlockReason(inputs: MigrationInputs, values: MigrationFormValues): string | undefined {
  const errors = migrationErrors(inputs, values);
  const field = fieldOrder.find((candidate) => errors[candidate]);

  return field ? `${migrationFieldLabels[field]}: ${errors[field]}` : undefined;
}

/**
 * Whether the OK button takes the accent styling Stop uses.
 *
 * Exactly one situation earns it: an offline migration of a running guest stops
 * that guest, which is the same class of consequence as the Stop action itself.
 * A live migration and a boot-on-target are commitments, not terminations, and
 * they keep the default styling.
 */
export function migrationIsAccented(inputs: MigrationInputs, values: MigrationFormValues): boolean {
  return effectiveMigrationMode(inputs, values.mode) === "offline" && guestIsLive(inputs.guest);
}

/**
 * The spec the create sends: exactly the fields the form owns, and nothing else.
 *
 * Three fields are never sent, each for its own recorded reason.
 * `target.nodeSelector` is upstream-unshipped, refused by the webhook and an
 * infinite Validating retry without it; `timeoutStrategy` is never read by any
 * handler in any mode; `cancelRequested` is not a create-time field at all. The
 * live-only fields are sent only where they are rendered, which is the same rule
 * that keeps a timeout out of an offline migration nobody would ever read it
 * from. The API server fills the schema defaults (`mode`, `timeout`,
 * `timeoutStrategy`) into whatever this omits.
 */
export function migrationCreatePayload(
  inputs: MigrationInputs,
  values: MigrationFormValues,
): { spec: SwiftMigrationSpec } {
  const spec: SwiftMigrationSpec = {
    guestRef: { name: inputs.guest.name },
    target: { nodeName: values.targetNode.trim() },
    mode: values.mode,
  };

  if (ipConsentApplies(inputs.guest)) {
    spec.allowIPChange = true;
  }

  if (liveFieldsApply(inputs, values)) {
    const timeout = values.timeout.trim();
    const downtime = values.downtimeTarget.trim();
    const connections = values.parallelConnections.trim();

    if (timeout) {
      spec.timeout = timeout;
    }

    if (downtime) {
      spec.downtimeTarget = downtime;
    }

    if (connections) {
      spec.parallelConnections = Number(connections);
    }
  }

  const reason = values.reason.trim();
  const ttl = values.ttl.trim();

  if (reason) {
    spec.reason = reason;
  }

  if (ttl) {
    spec.ttl = ttl;
  }

  return { spec };
}

/** The facts the live write summary is built from. The component owns the JSX. */
export interface MigrationSummaryFacts {
  /** The one API call this dialog makes (W1). */
  write: string;
  /** What the create means, each line rendered only when it is true of this object. */
  notes: string[];
  /** What it costs, in the warning style. */
  warnings: string[];
}

/** A SwiftMigration the stores hold, as the in-flight pass reads it. */
export interface StoredMigrationFacts {
  name: string;
  /** `spec.guestRef.name`: the guest that migration is about. */
  guestName?: string;
  phase?: string;
  mode?: SwiftMigrationMode;
  selfLink?: string;
}

/**
 * The migrations of this guest that have not finished.
 *
 * One pass over what the stores hold, on open: nothing upstream guards against
 * two migrations of one guest at admission - the in-progress annotation is
 * controller-side, Preparing-phase and offline-only, so live plus anything is
 * unguarded - which is precisely why this exists. A terminal migration is not a
 * conflict and is ignored.
 */
export function inFlightMigrations(guestName: string, migrations: StoredMigrationFacts[]): InFlightMigrationFacts[] {
  return migrations
    .filter((migration) => migration.guestName === guestName && migrationStage(migration.phase) !== "terminal")
    .map((migration) => ({
      name: migration.name,
      phase: migration.phase,
      mode: migration.mode,
      selfLink: migration.selfLink,
    }));
}

/** What an in-flight migration of this guest means for the one being created. */
export function inFlightWarning(migration: InFlightMigrationFacts): string {
  const phase = migration.phase ? `is ${migration.phase}` : "has not reported a phase yet";
  const mode = migration.mode === "live" ? "live" : migration.mode === "offline" ? "offline" : undefined;

  return (
    `The migration ${migration.name} of this guest ${phase} and has not finished. ` +
    (mode === "live"
      ? "Upstream has no admission guard against two migrations of one guest at all, and none against a live one in " +
        "particular: creating this second migration is not refused anywhere."
      : "An offline migration claims the guest with an annotation, so this second one would fail at Preparing with " +
        "the claim conflict.") +
    " The store can be stale, so this is a warning and not a block."
  );
}

/** The caveat `spec.ttl` carries, and the one place it can bite. */
export const ttlScopedRbacCaveat =
  "On a cluster running with scoped launcher RBAC, a completed live migration's record still owns the RBAC grant of " +
  "the pod the guest now runs in, so a record that self-deletes takes that grant with it under a running pod.";

/**
 * The live write summary: the one create line, plus the consequence lines that
 * are true of this object in this state (W1, rebuilt on every change).
 */
export function migrationSummary(inputs: MigrationInputs, values: MigrationFormValues): MigrationSummaryFacts {
  const { guest } = inputs;
  const name = values.name.trim() || "<name>";
  const target = values.targetNode.trim() || "<target>";
  const notes: string[] = [];
  const warnings: string[] = [];
  const resolved = effectiveMigrationMode(inputs, values.mode);
  const running = guestIsLive(guest);

  if (values.mode === "auto") {
    notes.push(`Mode auto: ${autoPredictionLine(autoPrediction(inputs))}`);
  } else {
    notes.push(`Mode ${values.mode}: ${modeNote(inputs, values.mode, target)}`);
  }

  if (resolved === "offline" && running) {
    warnings.push(
      `The guest ${guest.name} is stopped for the move: its run policy is patched and its launcher pod is deleted ` +
        "with a 30-second grace period, and it is not asked to shut down cleanly.",
    );
    notes.push(
      `Its disk is reattached, not copied: the same root-disk PVC is attached on ${target}, so the StorageClass has ` +
        "to support that - and nothing upstream verifies it.",
    );
    warnings.push(
      "There is no timeout in offline mode: no handler reads spec.timeout outside the live path, so a migration " +
        "that cannot detach the volume or boot the guest waits forever, with the guest stopped and claimed the " +
        "whole time.",
    );
  }

  if (resolved === "offline" && !running) {
    warnings.push(
      `This migration will start the guest on ${target}: moving a stopped guest means booting it, because the ` +
        "cutover patches the run policy back to Running.",
    );
  }

  if (resolved === "live") {
    notes.push(
      `A second launcher pod runs on ${target} for the whole transfer, so this guest has two pods on two nodes ` +
        "until the cutover.",
    );
    notes.push(
      "The VM keeps serving until the cutover, which deletes the source pod and costs a short downtime the " +
        "migration measures and records.",
    );
    warnings.push(
      "A failure after the cutover point can leave the guest needing operator intervention: upstream's own message " +
        "for that case says so.",
    );
  }

  if (ipConsentApplies(guest)) {
    warnings.push(freshIpFact);
  }

  if (guest.spec?.kernelRef?.name) {
    notes.push(
      `This guest boots the kernel ${guest.spec.kernelRef.name}, so it can only run on a node labelled ` +
        `${kernelNodeLabel}: ${kernelNodeLabelValue}.`,
    );
  }

  for (const migration of inputs.inFlight) {
    warnings.push(inFlightWarning(migration));
  }

  const storage = storageCapability(inputs);

  if (resolved === "live" && !storage.resolved) {
    warnings.push(
      `The storage of this guest could not be resolved${inputs.guestClass ? "" : ` - the guest class ${guest.spec?.guestClassRef?.name ?? "it points at"} is not readable from here`}, ` +
        `so whether it is ${liveAccessMode} and ${liveVolumeMode} is unverified. A live migration needs both.`,
    );
  }

  if (inputs.nodesUnverified) {
    warnings.push(
      `The cluster's nodes could not be listed, so ${target} is not verified: whether it exists, is Ready and can ` +
        "take this guest is unknown from here.",
    );
  }

  if (values.ttl.trim()) {
    notes.push(`The record self-deletes ${values.ttl.trim()} after the migration finishes. ${ttlScopedRbacCaveat}`);
  }

  return { write: `Create SwiftMigration ${guest.namespace}/${name}`, notes, warnings };
}

/** The success sentence: the fact that was written, from a page that does not show the new row (W9). */
export function migrationSuccessMessage(name: string): string {
  return `SwiftMigration ${name} created`;
}

/** The status code an ignored collision warning comes back as. */
export const conflictStatusCode = 409;

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface MigrationCreateFailureContext {
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
export function migrationCreateFailurePrefix(
  code: number | undefined,
  context: MigrationCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftMigration named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftMigration CRD is gone.`;
  }

  return writeFailurePrefix(code, { verb: "create", resource: "swiftmigrations", namespace: context.namespace });
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function migrationCreateFailureMessage(
  failure: ApiFailureFacts,
  context: MigrationCreateFailureContext,
): string | undefined {
  const prefix = migrationCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/** Where a migration is in its own life, which is what decides what deleting it does. */
export type MigrationStage = "pre-cutover" | "post-cutover" | "terminal";

/**
 * The stage a phase belongs to.
 *
 * An absent or unknown phase is pre-cutover: an object nothing has reconciled
 * yet - which is exactly what this dialog's own create produces - has not moved
 * anything, and a phase this extension does not know is not a reason to claim
 * the cutover happened.
 */
export function migrationStage(phase?: string): MigrationStage {
  if (terminalMigrationPhases.includes(phase as SwiftMigrationPhase)) {
    return "terminal";
  }

  if (postCutoverPhases.includes(phase as SwiftMigrationPhase)) {
    return "post-cutover";
  }

  return "pre-cutover";
}

/** What the drawer's On Delete row says about this migration (SPEC-0012). */
export interface MigrationDeleteRow {
  sentences: string[];
}

/**
 * What deleting a SwiftMigration does, computed from its own phase and mode
 * rather than stated in the abstract.
 *
 * This is the row this recon proved matters more here than anywhere else,
 * because one trash icon covers three different verbs: deleting a pre-cutover
 * offline migration ROLLS THE GUEST BACK, deleting a post-cutover one orphans it
 * forward, and deleting an in-flight live one cleans up NOTHING - the in-progress
 * annotation was never written in live mode, so the cleanup no-ops while the
 * destination pod and the transfer carry on.
 *
 * The drawer says this permanently, because the host owns the Delete
 * confirmation and gives an extension no hook for a per-kind consequence (the
 * SPEC-0010 stance).
 */
export function migrationDeleteRow(facts: {
  phase?: string;
  /** The resolved mode when the controller has written one, the requested one before that. */
  mode: SwiftMigrationMode;
  /** True when the mode is still the unresolved request rather than the controller's answer. */
  modeUnresolved?: boolean;
  ttl?: string;
}): MigrationDeleteRow {
  const stage = migrationStage(facts.phase);
  const sentences: string[] = [];

  if (stage === "terminal") {
    sentences.push("This migration has finished: deleting it removes the record and nothing else.");

    if (facts.phase === "Completed" && facts.mode === "live") {
      sentences.push(
        "On a cluster running with scoped launcher RBAC, this record still owns the RBAC grant of the pod the guest " +
          "now runs in, and that grant goes with it.",
      );
    }
  } else if (facts.mode === "auto" && facts.modeUnresolved !== false) {
    // Nothing has resolved `auto` yet, so both futures are still open and the
    // row states both rather than picking one.
    sentences.push(
      "The controller has not resolved this migration's mode yet. If it resolves to offline, deleting it before the " +
        "cutover aborts it and rolls the guest back - the claim is cleared, the run policy is restored and the " +
        "source pod comes back. If it resolves to live, deleting it cleans up nothing: set " +
        "spec.cancelRequested: true instead.",
    );
  } else {
    if (facts.mode === "offline" && stage === "pre-cutover") {
      sentences.push(
        "Deleting this migration aborts it and rolls the guest back: the claim annotation is cleared, the run " +
          "policy is restored to Running, and the source pod comes back.",
      );
    }

    if (stage === "post-cutover") {
      sentences.push(
        "The cutover has already happened, so deleting this migration rolls nothing back: the guest continues on " +
          "the destination node.",
      );
    }

    if (facts.mode === "live") {
      sentences.push(
        "Deleting a live migration cleans up nothing: the in-progress annotation is never written in live mode, so " +
          "the destination pod and the transfer carry on and only this record disappears. To stop it safely, set " +
          "spec.cancelRequested: true - pre-cutover it aborts cleanly, post-cutover it is acknowledged and ignored.",
      );
    }
  }

  if (facts.ttl) {
    sentences.push(`This record self-deletes ${facts.ttl} after the migration finishes.`);

    if (facts.mode === "live") {
      sentences.push(ttlScopedRbacCaveat);
    }
  }

  return { sentences };
}

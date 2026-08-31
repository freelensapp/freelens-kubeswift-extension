/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Guest form decides, as pure functions over structurally
// declared inputs (SPEC-0013, "Where the code lives"): the defaults, the
// pickers' options and the readiness they show, the sizing block of the chosen
// class and the live-migratability that follows from it, the OS type synced
// from the image, the validation that replaces the absent admission webhook,
// the payload the create sends, the live write summary, and the sentences the
// notifications carry.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which classes, images, seed profiles and nodes the
// reads on open returned, which guests the store happens to hold, what the
// page's namespace filter says - is taken as an argument, which is what keeps
// the interesting half of this form unit-testable without a cluster.
//
// What creating a SwiftGuest mechanically IS is the reason this module exists,
// and almost none of it is in the schema:
//
// - The schema requires ONE field, `guestClassRef`, and its `.name` defaults to
//   the empty string - so `guestClassRef: {}` passes the API server. Only the
//   admission webhook demands a non-empty name, and that webhook ships
//   disabled. Nothing here ever emits a reference without a name, which also
//   avoids the resolver/webhook disagreement where `imageRef: {}` counts as
//   "has an image" to one and "no source" to the other.
// - The class is the sizing: cpu, memory and the root disk come from the
//   SwiftGuestClass only, and a guest cannot override them. So the class is
//   never auto-selected and its sizing is shown at the moment it is chosen.
// - The IMAGE is authoritative for the OS, and the schema fights it: the CRD
//   defaults `spec.osType` to `linux`, so a guest created from a Windows image
//   with the field untouched is born Failed on an osType mismatch. The form
//   reads the picked image's own `osType` and keeps the guest's field equal to
//   it, as a fact rather than as a choice.
// - A missing or not-Ready image fails and then HEALS: the guest is born
//   `Failed` with `Resolved=False`, and images are watched, so it reconciles
//   again the moment the image turns Ready. Creating against a still-importing
//   image is therefore safe, and the summary says so instead of blocking.
// - The mutating webhook's entire defaulting is `runPolicy: Running`, and it
//   ships off, so the form sends the run policy explicitly - exactly as
//   `swiftctl guest import` does - and the stored object reads the same with
//   and without it.
// - The one CEL rule in the whole CRD is on `spec.storage`: `ReadWriteMany`
//   requires `volumeMode: Block`. It is evaluated on the guest's OWN storage
//   struct, not on the class merge, so inheriting `Block` from the class does
//   not satisfy it - which is the kind of rule an operator meets as a rejected
//   create and never as an explanation.

import { notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import { conflictStatusCode, liveAccessMode, liveVolumeMode } from "./migration-create";

import type {
  SwiftGuestAccessMode,
  SwiftGuestOsType,
  SwiftGuestRunPolicy,
  SwiftGuestSpec,
  SwiftGuestVolumeMode,
} from "../api/kubeswift/swiftguest-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";
import type { NodeFacts } from "./migration-create";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createGuestTitle = "Create Guest";

/**
 * The three boot sources a SwiftGuest can have.
 *
 * All three are declared here although this slice implements the first one
 * only: the boot source is what the whole form branches on, and a type that
 * covered one case would have to be widened - and every function taking it
 * revisited - by the slice that adds the other two.
 */
export type GuestBootSource = "image" | "kernel" | "clone";

/** The boot sources this slice builds. Kernel and clone arrive in slices 2 and 3. */
export const implementedBootSources: GuestBootSource[] = ["image"];

/** The boot source the form opens on, and the only one it can express today. */
export const defaultBootSource: GuestBootSource = "image";

/** The `phase` a SwiftImage reaches when it can be cloned into a guest's root disk. */
export const readyImagePhase = "Ready";

/** The run policies the select offers, in the order it offers them. */
export const guestRunPolicies: SwiftGuestRunPolicy[] = ["Running", "Stopped", "RestartOnFailure", "Always"];

/** The schema has no default for `runPolicy`; this is the mutating webhook's, sent explicitly (G8). */
export const defaultRunPolicy: SwiftGuestRunPolicy = "Running";

/** The access modes the storage override offers. An empty value means "whatever the class says". */
export const guestAccessModes: SwiftGuestAccessMode[] = ["ReadWriteOnce", "ReadWriteMany"];

/** The volume modes the storage override offers, under the same empty-means-inherit rule. */
export const guestVolumeModes: SwiftGuestVolumeMode[] = ["Filesystem", "Block"];

/**
 * What the API server falls back to when neither the guest nor its class says
 * anything about storage. Stated rather than assumed: it is the difference
 * between a guest that can be live-migrated and one that cannot.
 */
export const systemDefaultAccessMode: SwiftGuestAccessMode = "ReadWriteOnce";
export const systemDefaultVolumeMode: SwiftGuestVolumeMode = "Filesystem";

/** A DNS-1123 label, which is the longest a guest's name may be. */
export const maxGuestNameLength = 63;

/** The slice of a SwiftGuestClass the sizing block and the storage merge read. */
export interface GuestClassFacts {
  name: string;
  cpu?: string;
  memory?: string;
  rootDisk?: { format?: string; size?: string };
  coreScheduling?: string;
  storage?: { accessMode?: string; volumeMode?: string; storageClassName?: string };
}

/** The slice of a SwiftImage the boot-source picker and the osType sync read. */
export interface GuestImageFacts {
  name: string;
  /** `status.phase`: shown on every option, and never a reason to refuse one. */
  phase?: string;
  /** `spec.osType`, which is authoritative for the guest's own. */
  osType?: string;
}

/**
 * The slice of a SwiftSeedProfile the optional seed picker reads.
 *
 * `datasource` is carried although nothing reads it any more: the spec planned
 * a warning for an empty one (G9), and the schema makes the field REQUIRED with
 * a single-member enum, so a stored profile cannot have an empty datasource and
 * the warning could never fire. Kept in the shape because it is what the picker
 * would show if upstream ever widens the enum.
 */
export interface GuestSeedProfileFacts {
  name: string;
  datasource?: string;
}

/**
 * Everything the dialog knows about the cluster when it decides something.
 *
 * One object rather than six parameters, for the reason the other create
 * dialogs use one: every function below reads a different subset of it, and the
 * dialog holds exactly this and hands it over unchanged.
 */
export interface GuestCreateInputs {
  /** The cluster-scoped guest classes, as the read on open returned them. */
  guestClasses: GuestClassFacts[];
  /** True when that read was refused: the picker degrades to a typed, unverified name (T3). */
  guestClassesUnverified: boolean;
  /** The chosen namespace's SwiftImages. Reloaded whenever the namespace changes. */
  images: GuestImageFacts[];
  imagesUnverified: boolean;
  /** The chosen namespace's SwiftSeedProfiles, under the same rule. */
  seedProfiles: GuestSeedProfileFacts[];
  seedProfilesUnverified: boolean;
  /** The cluster's nodes, for the optional pin. */
  nodes: NodeFacts[];
  nodesUnverified: boolean;
  /** The chosen namespace's SwiftGuest names, for the collision warning. */
  existingNames: string[];
}

/** Every field the form holds, in one flat object so the model is one observable. */
export interface GuestFormValues {
  namespace: string;
  name: string;
  guestClass: string;
  /** Always `image` in this slice; the field exists so slices 2 and 3 only add branches. */
  bootSource: GuestBootSource;
  image: string;
  seedProfile: string;
  runPolicy: SwiftGuestRunPolicy;
  /** `spec.nodeName`: an optional pin, empty meaning "let the scheduler decide". */
  nodeName: string;
  /** The storage overrides. An empty string means "inherit from the class". */
  storageAccessMode: string;
  storageVolumeMode: string;
  storageClassName: string;
  guestAgentEnabled: boolean;
}

/**
 * The form the dialog opens with.
 *
 * Two defaults and no more: the namespace, when the page's filter names exactly
 * one (below), and the run policy, which is the one value this form sends
 * although the schema does not default it. Neither the class nor the image is
 * pre-selected - they are the two decisions with resource consequences, and
 * upstream's alphabetically-first class default is the anti-pattern this form
 * exists to avoid.
 */
export function defaultGuestForm(namespace = ""): GuestFormValues {
  return {
    namespace,
    name: "",
    guestClass: "",
    bootSource: defaultBootSource,
    image: "",
    seedProfile: "",
    runPolicy: defaultRunPolicy,
    nodeName: "",
    storageAccessMode: "",
    storageVolumeMode: "",
    storageClassName: "",
    guestAgentEnabled: false,
  };
}

/**
 * The namespace the form opens on, from the page's own filter.
 *
 * Exactly one selected namespace is an answer; anything else - all of them, a
 * multi-selection, none - is not, and a guest created in a guessed namespace is
 * a guest in the wrong place. So the field is left empty for the user to pick,
 * which is also what makes it a required field rather than a silent default.
 */
export function defaultNamespace(contextNamespaces: readonly string[]): string {
  return contextNamespaces.length === 1 ? contextNamespaces[0] : "";
}

/** The Kubernetes DNS-1123 LABEL rule, which is what a guest's name has to satisfy. */
const guestNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Why a typed guest name would be refused, or `undefined` when it is legal.
 *
 * Stricter than the object-name rule the snapshot and restore dialogs use, and
 * deliberately so: those two create objects nothing else is named after, while a
 * guest's name is the stem of its launcher pod, its cloned root-disk PVC and its
 * per-guest Service, each of which is a DNS-1123 LABEL - no dots, at most 63
 * characters. Upstream validates none of this on any surface, and the failure it
 * produces arrives much later, from a controller, about an object the user never
 * asked for.
 */
export function guestNameError(name: string): string | undefined {
  if (!name) {
    return "A name is required.";
  }

  if (name.length > maxGuestNameLength) {
    return (
      `A guest name is at most ${maxGuestNameLength} characters; this one is ${name.length}. The name is the stem ` +
      "of the launcher pod, the cloned root disk and the per-guest Service, and each of those is a DNS label."
    );
  }

  if (!guestNamePattern.test(name)) {
    return (
      "A guest name is lowercase letters, digits and '-', starting and ending with a letter or a digit. Dots are " +
      "not allowed: the name becomes a DNS label of the launcher pod and of the guest's own Service."
    );
  }

  return undefined;
}

/** One option of the guest class picker, with the sizing it commits the guest to. */
export interface GuestClassChoice {
  name: string;
  /** How the option reads in the control: the name, then the sizing in short form. */
  label: string;
  facts: GuestClassFacts;
}

/** The sizing of a class in one short line, for the option label. */
export function guestClassSummary(guestClass: GuestClassFacts): string {
  const parts: string[] = [];

  if (guestClass.cpu) {
    parts.push(`${guestClass.cpu} vCPU`);
  }

  if (guestClass.memory) {
    parts.push(guestClass.memory);
  }

  if (guestClass.rootDisk?.size) {
    parts.push(
      guestClass.rootDisk.format
        ? `${guestClass.rootDisk.size} ${guestClass.rootDisk.format}`
        : guestClass.rootDisk.size,
    );
  }

  return parts.join(", ");
}

/**
 * The classes the picker offers, in the order the read returned them.
 *
 * No filtering and no refusals: a SwiftGuestClass is spec-only and valid the
 * moment it exists, so there is nothing about one that could make it
 * unchoosable. The sizing rides along on every option, because choosing a class
 * IS choosing the cpu, the memory and the root disk, and upstream hides both
 * facts behind an alphabetical default.
 */
export function guestClassChoices(inputs: GuestCreateInputs): GuestClassChoice[] {
  return inputs.guestClasses.map((guestClass) => {
    const summary = guestClassSummary(guestClass);

    return {
      name: guestClass.name,
      label: summary ? `${guestClass.name} - ${summary}` : guestClass.name,
      facts: guestClass,
    };
  });
}

/** The class the form is pointing at, when the read returned it. */
export function pickedGuestClass(inputs: GuestCreateInputs, values: GuestFormValues): GuestClassFacts | undefined {
  const name = values.guestClass.trim();

  return name ? inputs.guestClasses.find((guestClass) => guestClass.name === name) : undefined;
}

/** One row of the sizing block rendered next to the class picker. */
export interface GuestClassSizingRow {
  label: string;
  value: string;
}

/**
 * The sizing the chosen class commits this guest to, at the moment it is chosen
 * (G3).
 *
 * Everything here is class-only: a guest cannot override its cpu, its memory or
 * its root disk, and the storage line is the class's own value before this
 * form's overrides are applied - the merged one is in the write summary, where
 * the override is already known.
 */
export function guestClassSizing(guestClass: GuestClassFacts): GuestClassSizingRow[] {
  const rows: GuestClassSizingRow[] = [
    { label: "CPU", value: guestClass.cpu ?? "not set" },
    { label: "Memory", value: guestClass.memory ?? "not set" },
    {
      label: "Root disk",
      value: guestClass.rootDisk?.size
        ? `${guestClass.rootDisk.size}${guestClass.rootDisk.format ? ` ${guestClass.rootDisk.format}` : ""}`
        : "not set",
    },
    { label: "Storage", value: classStorageText(guestClass) },
    // The CRD defaults `coreScheduling` to `off` and documents an empty value as
    // the same thing, which is how the model reads it too.
    { label: "Core scheduling", value: guestClass.coreScheduling || "off" },
  ];

  return rows;
}

/** The class's own storage, as the sizing block spells it. */
function classStorageText(guestClass: GuestClassFacts): string {
  const { accessMode, volumeMode, storageClassName } = guestClass.storage ?? {};

  if (!accessMode && !volumeMode && !storageClassName) {
    return `not set (cluster default: ${systemDefaultAccessMode}/${systemDefaultVolumeMode})`;
  }

  const mode = `${accessMode ?? systemDefaultAccessMode}/${volumeMode ?? systemDefaultVolumeMode}`;

  return storageClassName ? `${mode} on ${storageClassName}` : mode;
}

/** The storage this guest will really get, and whether that answer is a fact. */
export interface ResolvedGuestStorage {
  accessMode?: string;
  volumeMode?: string;
  storageClassName?: string;
  /** True when a class was read, so the fields below are the merge rather than a guess. */
  resolved: boolean;
  /** Storage both nodes can hold at once, which is what a live migration needs. */
  liveMigratable: boolean;
}

/**
 * The storage of the root disk the controller will create, as the per-field
 * merge the guest controller performs: the guest's own value wins per field,
 * the class supplies the rest, and the API server's own defaults are underneath
 * both.
 *
 * A class that could not be read leaves `resolved: false`, which is never a
 * refusal: a read that fails must not block a write the user is allowed to make
 * (W4), so the summary marks the live-migratability unverified instead.
 */
export function resolvedStorage(inputs: GuestCreateInputs, values: GuestFormValues): ResolvedGuestStorage {
  const guestClass = pickedGuestClass(inputs, values);
  const accessMode = values.storageAccessMode.trim() || guestClass?.storage?.accessMode;
  const volumeMode = values.storageVolumeMode.trim() || guestClass?.storage?.volumeMode;
  const storageClassName = values.storageClassName.trim() || guestClass?.storage?.storageClassName;
  const resolved = Boolean(guestClass) || Boolean(values.storageAccessMode.trim() && values.storageVolumeMode.trim());

  return {
    accessMode,
    volumeMode,
    storageClassName,
    resolved,
    liveMigratable:
      (accessMode ?? systemDefaultAccessMode) === liveAccessMode &&
      (volumeMode ?? systemDefaultVolumeMode) === liveVolumeMode,
  };
}

/** The merged storage in one short phrase, for the sentences that name it. */
export function resolvedStorageText(storage: ResolvedGuestStorage): string {
  return `${storage.accessMode ?? systemDefaultAccessMode}/${storage.volumeMode ?? systemDefaultVolumeMode}`;
}

/**
 * What this guest's storage means for a future migration of it, stated both
 * ways.
 *
 * Not a warning and not an error: it is the one consequence of the storage
 * choice an operator will meet months later, when a node has to be drained and
 * the guest can only move by being stopped.
 *
 * The two ways of not being live-migratable have different reasons, and one
 * sentence for both would be false: a ReadWriteOnce disk is held by a single
 * node at a time, while a ReadWriteMany disk on a Filesystem volume is shared
 * by as many nodes as need it and is still not live-migratable, because the
 * migration needs a Block volume.
 */
export function liveMigrationFact(storage: ResolvedGuestStorage): string {
  if (!storage.resolved) {
    return (
      "The guest class could not be read from here, so whether this guest's root disk can be held by two nodes at " +
      `once is unverified. Live migration needs ${liveAccessMode} and ${liveVolumeMode}; anything else moves only ` +
      "by being stopped first."
    );
  }

  if (storage.liveMigratable) {
    return (
      `The root disk is ${resolvedStorageText(storage)}, which two launcher pods can hold at once: this guest can be ` +
      "live-migrated to another node without being stopped."
    );
  }

  if ((storage.accessMode ?? systemDefaultAccessMode) === liveAccessMode) {
    return (
      `The root disk is ${resolvedStorageText(storage)}, which more than one node can hold at once, but a live ` +
      `migration needs a ${liveVolumeMode} volume: this guest can be migrated offline only.`
    );
  }

  return (
    `The root disk is ${resolvedStorageText(storage)}, which only one node can hold at a time: this guest can be ` +
    `migrated offline only. Live migration needs ${liveAccessMode} on a ${liveVolumeMode} volume.`
  );
}

/**
 * The same answer as `liveMigrationFact`, short enough for the sizing block next
 * to the class picker (G3).
 *
 * Two renderings of one derivation rather than two derivations: the block states
 * the verdict where the class is chosen, and the sentence states what it means
 * where the storage can be changed and in the write summary.
 */
export function liveMigrationLabel(storage: ResolvedGuestStorage): string {
  if (!storage.resolved) {
    return "unverified (the guest class could not be read)";
  }

  return storage.liveMigratable
    ? `possible (${resolvedStorageText(storage)})`
    : `offline only (${resolvedStorageText(storage)})`;
}

/** One option of the image picker, with the readiness upstream's own UI discards (G2). */
export interface GuestImageChoice {
  name: string;
  phase?: string;
  /** Ready images are offered plainly; the others are dimmed and still selectable. */
  ready: boolean;
  /** How the option reads in the control: the name, then its phase when it has one. */
  label: string;
  facts: GuestImageFacts;
}

/**
 * The images the picker offers: every image in the namespace, with its phase.
 *
 * Nothing is filtered out and nothing is disabled. A guest created against an
 * image that is still importing is born `Failed` with `Resolved=False` and then
 * HEALS - images are watched, so the guest reconciles the moment the image turns
 * Ready - which makes "create it now, it will catch up" a legitimate thing to
 * do, and a picker that hid the image would be hiding a valid workflow.
 */
export function guestImageChoices(inputs: GuestCreateInputs): GuestImageChoice[] {
  return inputs.images.map((image) => ({
    name: image.name,
    phase: image.phase,
    ready: image.phase === readyImagePhase,
    label: image.phase ? `${image.name} - ${image.phase}` : `${image.name} - no phase yet`,
    facts: image,
  }));
}

/** The image the form is pointing at, when the read returned it. */
export function pickedImage(inputs: GuestCreateInputs, values: GuestFormValues): GuestImageFacts | undefined {
  const name = values.image.trim();

  return name ? inputs.images.find((image) => image.name === name) : undefined;
}

/**
 * What happens when this guest is created against an image that is not Ready,
 * or `undefined` when the question does not arise.
 *
 * The whole point of the line: this is a wait, not a mistake. It is a warning
 * because it changes what the operator will see for a while, and it is not a
 * block because the system recovers by itself.
 */
export function imageWillWaitFact(image: GuestImageChoice | GuestImageFacts | undefined): string | undefined {
  if (!image || image.phase === readyImagePhase) {
    return undefined;
  }

  const phase = image.phase ? `is ${image.phase}` : "has not reported a phase yet";

  return (
    `The image ${image.name} ${phase}, not ${readyImagePhase}: this guest is created now and is born Failed, with ` +
    "Resolved=False, until the image finishes. Images are watched, so the guest reconciles again the moment the " +
    "image turns Ready - nothing else has to happen, and nothing has to be recreated."
  );
}

/** The OS of this guest, which is the image's answer rather than the user's (G4). */
export interface GuestOsTypeFact {
  osType: SwiftGuestOsType;
  /** True when a picked image in the store said so, rather than the schema default standing in. */
  fromImage: boolean;
  /** True when an image is named but could not be read, so the value is an assumption. */
  unverified: boolean;
  /** The sentence the form renders where a user would otherwise expect a control. */
  text: string;
}

/**
 * The guest's `spec.osType`, synced from the picked image.
 *
 * The resolved OS comes from the SwiftImage and the guest's own field is only a
 * cross-check - but the CRD defaults that field to `linux`, so a guest created
 * from a Windows image with the field untouched is born Failed on the mismatch.
 * Keeping the two equal by construction is what closes that trap, and it is why
 * this is rendered as a fact instead of offered as a select.
 */
export function guestOsType(inputs: GuestCreateInputs, values: GuestFormValues): GuestOsTypeFact {
  const named = values.image.trim();
  const image = pickedImage(inputs, values);

  if (!named) {
    return {
      osType: "linux",
      fromImage: false,
      unverified: false,
      text: "linux, until an image is picked: the image decides the OS type, so this is never a choice on this form.",
    };
  }

  if (!image) {
    return {
      osType: "linux",
      fromImage: false,
      unverified: true,
      text:
        `linux, assumed: the image ${named} could not be read from here, so its own osType is unverified. If it is ` +
        "a Windows image, this guest is born Failed on the osType mismatch, and the fix is to set spec.osType in " +
        "the YAML editor.",
    };
  }

  const osType: SwiftGuestOsType = image.osType === "windows" ? "windows" : "linux";

  return {
    osType,
    fromImage: true,
    unverified: false,
    text:
      `${osType}, read from the image ${image.name}. The guest's own spec.osType is only a cross-check of the ` +
      "image's, and the CRD defaults it to linux - so this form sends what the image says rather than letting the " +
      "default decide.",
  };
}

/** The rules a Windows guest lives under, which the OS type activates client-side (G4, G5). */
export const windowsConstraintFact =
  "This is a Windows image, so the guest is created with osType: windows and upstream's Windows rules apply to it: " +
  "it boots from a disk image only, it takes no GPU profile, and it mounts no filesystems.";

/** One option of the run policy select, with what it means right after this create. */
export interface GuestRunPolicyChoice {
  policy: SwiftGuestRunPolicy;
  note: string;
}

/**
 * What each run policy does, in the vocabulary SPEC-0010 established.
 *
 * The field governs what the controller does when the LAUNCHER POD reaches a
 * terminal state, which is not the same thing as a power switch: a guest reboot
 * resets the VM in place and never reaches this field at all. Each sentence
 * therefore says what happens right after this create AND what happens when
 * Cloud Hypervisor exits, because a user picking a value here is picking both.
 */
export function runPolicyNote(policy: SwiftGuestRunPolicy): string {
  switch (policy) {
    case "Stopped":
      return (
        "The guest is created but not started: no launcher pod is made, and its phase settles on Stopped. Start it " +
        "later from its row or its drawer."
      );
    case "RestartOnFailure":
      return (
        "The guest starts now, and its pod is recreated when Cloud Hypervisor exits abnormally, with a backoff that " +
        "doubles from 10 seconds up to 5 minutes. A clean shutdown from inside the guest is left alone."
      );
    case "Always":
      return (
        "The guest starts now, and its pod is recreated whenever Cloud Hypervisor exits - after a crash and after a " +
        "clean shutdown from inside the guest alike."
      );
    default:
      return (
        "The guest starts now and keeps its launcher pod. If Cloud Hypervisor exits - the guest shuts down or " +
        "crashes - the pod is not recreated, and the guest reads as Stopped or Failed until it is started again."
      );
  }
}

/** The four policies with their sentences, for the select and its hint. */
export function guestRunPolicyChoices(): GuestRunPolicyChoice[] {
  return guestRunPolicies.map((policy) => ({ policy, note: runPolicyNote(policy) }));
}

/** Whether this run policy makes the controller start the guest right away. */
export function runPolicyStarts(policy: SwiftGuestRunPolicy): boolean {
  return policy !== "Stopped";
}

/** One option of the optional node pin. */
export interface GuestNodeChoice {
  name: string;
}

/**
 * The nodes this guest can be pinned to: Ready and schedulable, in name order.
 *
 * Not Ready and cordoned nodes are dropped rather than disabled, exactly as the
 * Migrate dialog drops them: a node that cannot take a pod is not a choice with
 * a reason, it is not a choice. The kernel-node label rule of SPEC-0012 does not
 * apply here - it is about kernel boot, which is slice 2.
 */
export function guestNodeChoices(inputs: GuestCreateInputs): GuestNodeChoice[] {
  return inputs.nodes
    .filter((node) => node.ready && node.schedulable)
    .map((node) => ({ name: node.name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Why the node picker has nothing to offer, counted rather than asserted.
 *
 * The same honesty the Migrate dialog's empty picker carries: an empty control
 * with no explanation is indistinguishable from a broken one.
 */
export function noGuestNodeReason(inputs: GuestCreateInputs): string {
  const notReady = inputs.nodes.filter((node) => !node.ready).length;
  const cordoned = inputs.nodes.filter((node) => node.ready && !node.schedulable).length;
  const excluded: string[] = [];

  if (notReady > 0) {
    excluded.push(`${notReady} ${notReady === 1 ? "is" : "are"} not Ready`);
  }

  if (cordoned > 0) {
    excluded.push(`${cordoned} ${cordoned === 1 ? "is" : "are"} cordoned`);
  }

  const total = inputs.nodes.length;
  const tail = excluded.length > 0 ? `: ${excluded.join(", ")}.` : ".";

  return (
    `No node in this cluster can take a pinned guest. It has ${total} ${total === 1 ? "node" : "nodes"}${tail} ` +
    "Leave the pin empty to let the scheduler place this guest."
  );
}

/** What a node pin does, which is not what a `nodeSelector` would do. */
export const nodePinFact =
  "A pinned guest has its launcher pod bound to that node directly, bypassing the scheduler: a node that cannot fit " +
  "the guest rejects it within seconds instead of leaving it Pending forever.";

/** The fields validation and the warnings are keyed on, so a message renders next to its input. */
export type GuestCreateField =
  | "namespace"
  | "name"
  | "guestClass"
  | "image"
  | "seedProfile"
  | "runPolicy"
  | "nodeName"
  | "storageAccessMode"
  | "storageVolumeMode"
  | "storageClassName";

/** One message per field, absent when the field has nothing to say. */
export type GuestCreateFieldMessages = Partial<Record<GuestCreateField, string>>;

/** How the submit-disabled sentence names each field (W4: it names the field AND the reason). */
export const guestCreateFieldLabels: Record<GuestCreateField, string> = {
  namespace: "Namespace",
  name: "Name",
  guestClass: "Guest class",
  image: "Image",
  seedProfile: "Seed profile",
  runPolicy: "Run policy",
  nodeName: "Node",
  storageAccessMode: "Access mode",
  storageVolumeMode: "Volume mode",
  storageClassName: "Storage class",
};

/**
 * The order the submit-disabled sentence reports the first offending field in:
 * the reading order of the form, so the sentence points at the first thing a
 * user would fix rather than at the last rule that happened to fail.
 */
const fieldOrder: GuestCreateField[] = [
  "namespace",
  "name",
  "guestClass",
  "image",
  "storageAccessMode",
  "storageVolumeMode",
  "storageClassName",
  "seedProfile",
  "nodeName",
  "runPolicy",
];

/** The fields of the storage section, so the dialog can open it when it holds an error. */
export const storageFields: GuestCreateField[] = ["storageAccessMode", "storageVolumeMode", "storageClassName"];

/** The one CEL rule in the whole SwiftGuest CRD, stated as the message it refuses with. */
export const storageCelRule =
  `${liveAccessMode} requires volumeMode ${liveVolumeMode}: the CRD refuses the combination outright, because a ` +
  "shared Filesystem volume is not live-migration-capable. The rule is evaluated on this guest's own storage block, " +
  `so inheriting ${liveVolumeMode} from the guest class does not satisfy it - set it here as well.`;

/** The storage-class name rule: it is an object name, and the API server would refuse anything else. */
const storageClassNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/**
 * Everything that would make this create fail, keyed by field.
 *
 * Most of these are the admission webhook's own rules, and this is the only
 * place they are enforced on a default install: upstream ships that webhook
 * disabled, so nobody else produces these messages and the mistake surfaces
 * much later as a `Failed` phase. The storage one is different and sharper - it
 * is a CEL rule in the CRD itself, so the API server WILL refuse it, and
 * enforcing it here is the difference between a sentence at the field and a
 * rejected create the user has to decode.
 */
export function guestCreateErrors(values: GuestFormValues): GuestCreateFieldMessages {
  const errors: GuestCreateFieldMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace =
      "A namespace is required: a guest, its launcher pod, its cloned root disk and its seed Secret all live in one.";
  }

  const nameError = guestNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  if (!values.guestClass.trim()) {
    errors.guestClass =
      "A guest class is required: it is the only field the CRD requires, and it is where the guest's cpu, memory " +
      "and root disk come from.";
  }

  if (values.bootSource === "image" && !values.image.trim()) {
    errors.image =
      "An image is required: a guest with no boot source at all is born Failed with Resolved=False, and unlike a " +
      "not-Ready image that never heals on its own.";
  }

  if (values.storageAccessMode.trim() === liveAccessMode && values.storageVolumeMode.trim() !== liveVolumeMode) {
    errors.storageAccessMode = storageCelRule;
  }

  const storageClassName = values.storageClassName.trim();

  if (storageClassName && !storageClassNamePattern.test(storageClassName)) {
    errors.storageClassName =
      "A StorageClass name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit.";
  }

  return errors;
}

/**
 * Everything worth saying about a field that would still be accepted.
 *
 * Warnings never block (W12): the store can be stale, the API server is the
 * authority, and a warned submit that comes back 409 is honest where a blocked
 * one is a client-side heuristic in the driver's seat.
 */
export function guestCreateWarnings(inputs: GuestCreateInputs, values: GuestFormValues): GuestCreateFieldMessages {
  const warnings: GuestCreateFieldMessages = {};
  const name = values.name.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name =
      "A SwiftGuest with this name already exists in this namespace. Submitting will be refused by the API server; " +
      "the fix is a different name.";
  }

  const guestClass = values.guestClass.trim();

  if (guestClass && !pickedGuestClass(inputs, values)) {
    warnings.guestClass = inputs.guestClassesUnverified
      ? `The cluster's guest classes could not be listed, so ${guestClass} is not verified: whether it exists, and ` +
        "what it sizes this guest to, is unknown from here."
      : `No guest class named ${guestClass} is in this cluster. A guest whose class cannot be resolved is born ` +
        "Failed with Resolved=False, and heals within the 30-second resync once the class exists.";
  }

  const image = values.image.trim();

  if (image && !pickedImage(inputs, values)) {
    warnings.image = inputs.imagesUnverified
      ? `The SwiftImages of this namespace could not be listed, so ${image} is not verified: whether it exists, ` +
        "whether it is Ready and which OS it carries are unknown from here."
      : `No SwiftImage named ${image} is in the namespace ${values.namespace || "of this guest"}. The guest is born ` +
        "Failed with Resolved=False and heals by itself once the image exists.";
  }

  const seedProfile = values.seedProfile.trim();

  if (seedProfile && !inputs.seedProfiles.some((profile) => profile.name === seedProfile)) {
    warnings.seedProfile = inputs.seedProfilesUnverified
      ? `The seed profiles of this namespace could not be listed, so ${seedProfile} is not verified.`
      : `No SwiftSeedProfile named ${seedProfile} is in the namespace ${values.namespace || "of this guest"}. The ` +
        "guest waits, Resolved=False, until one exists.";
  }

  const nodeName = values.nodeName.trim();

  if (nodeName && !guestNodeChoices(inputs).some((node) => node.name === nodeName)) {
    warnings.nodeName = inputs.nodesUnverified
      ? `The cluster's nodes could not be listed, so ${nodeName} is not verified: whether it exists, is Ready and ` +
        "can take this guest is unknown from here."
      : `No Ready, schedulable node named ${nodeName} is in this cluster. A pinned pod that no node accepts is ` +
        "rejected rather than rescheduled.";
  }

  return warnings;
}

/**
 * Why the submit button is disabled, naming the field and the reason (W4 applied
 * to submit buttons), or `undefined` when the form can be sent.
 *
 * The same sentence is rendered next to the offending field and next to the
 * button, because a mute grey button is a dead control and a form this tall
 * puts its button below the fold of its own scroll area.
 */
export function guestCreateSubmitBlockReason(values: GuestFormValues): string | undefined {
  const errors = guestCreateErrors(values);
  const field = fieldOrder.find((candidate) => errors[candidate]);

  return field ? `${guestCreateFieldLabels[field]}: ${errors[field]}` : undefined;
}

/**
 * The storage block the create sends, or `undefined` when the form overrides
 * nothing.
 *
 * Only the keys the user actually set: an override that repeated the class's own
 * value would turn a class-wide decision into a per-guest copy of it, which is
 * exactly what an operator changing the class later would not expect.
 */
export function guestStorageOverrides(values: GuestFormValues): SwiftGuestSpec["storage"] | undefined {
  const storage: NonNullable<SwiftGuestSpec["storage"]> = {};
  const accessMode = values.storageAccessMode.trim();
  const volumeMode = values.storageVolumeMode.trim();
  const storageClassName = values.storageClassName.trim();

  if (accessMode === "ReadWriteOnce" || accessMode === "ReadWriteMany") {
    storage.accessMode = accessMode;
  }

  if (volumeMode === "Filesystem" || volumeMode === "Block") {
    storage.volumeMode = volumeMode;
  }

  if (storageClassName) {
    storage.storageClassName = storageClassName;
  }

  return Object.keys(storage).length > 0 ? storage : undefined;
}

/**
 * The spec the create sends: exactly the fields the form owns, and nothing else.
 *
 * Two rules shape it. No reference is ever emitted without a name (G7) - the
 * schema's `""` default would let `guestClassRef: {}` through the API server,
 * and an `imageRef: {}` counts as "has an image" to the resolver and as "no
 * source" to the webhook - and `runPolicy` is always sent (G8), which is the
 * mutating webhook's only defaulting and therefore the one field whose absence
 * would make the stored object differ between installs.
 *
 * `osType` is sent for the same class of reason: the schema WILL default it to
 * `linux`, and that default is wrong for every Windows image.
 */
export function guestCreatePayload(
  inputs: GuestCreateInputs,
  values: GuestFormValues,
): { spec: Partial<SwiftGuestSpec> } {
  const spec: Partial<SwiftGuestSpec> = {};
  const guestClass = values.guestClass.trim();
  const image = values.image.trim();
  const seedProfile = values.seedProfile.trim();
  const nodeName = values.nodeName.trim();
  const storage = guestStorageOverrides(values);

  if (guestClass) {
    spec.guestClassRef = { name: guestClass };
  }

  if (values.bootSource === "image" && image) {
    spec.imageRef = { name: image };
  }

  spec.osType = guestOsType(inputs, values).osType;
  spec.runPolicy = values.runPolicy;

  if (seedProfile) {
    spec.seedProfileRef = { name: seedProfile };
  }

  if (nodeName) {
    spec.nodeName = nodeName;
  }

  if (storage) {
    spec.storage = storage;
  }

  if (values.guestAgentEnabled) {
    spec.guestAgent = { enabled: true };
  }

  return { spec };
}

/** The facts the live write summary is built from. The component owns the JSX. */
export interface GuestCreateSummaryFacts {
  /** The one API call this dialog makes (W1). */
  write: string;
  /** What the create means, each line rendered only when it is true of this object. */
  notes: string[];
  /** What it costs or cannot verify, in the warning style. */
  warnings: string[];
}

/** The guest agent's one consequence, which is about a clone that does not exist yet. */
export const guestAgentFact =
  "The vsock device of the in-guest identity agent is attached to this guest. It is what lets a clone taken from a " +
  "snapshot of it regenerate its machine id, its SSH host keys, its hostname and its MAC and re-DHCP in place, " +
  "without a reboot - and the device has to be on the source when the snapshot is taken, not added afterwards.";

/**
 * The live write summary: the one create line, plus the consequence lines that
 * are true of this object in this state (W1, rebuilt on every change).
 *
 * The order is the order things happen: what is stored, what the controller
 * resolves, what it creates, what waits, and what this configuration will mean
 * later.
 */
export function guestCreateSummary(inputs: GuestCreateInputs, values: GuestFormValues): GuestCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const notes: string[] = [];
  const warnings: string[] = [];
  const guestClass = pickedGuestClass(inputs, values);
  const guestClassName = values.guestClass.trim();
  const image = pickedImage(inputs, values);
  const imageName = values.image.trim();
  const seedProfile = values.seedProfile.trim();
  const nodeName = values.nodeName.trim();
  const storage = resolvedStorage(inputs, values);
  const osType = guestOsType(inputs, values);

  if (guestClassName) {
    const sizing = guestClass ? guestClassSummary(guestClass) : "";

    notes.push(
      sizing
        ? `The guest class ${guestClassName} sizes it: ${sizing}. The class owns the cpu, the memory and the root ` +
            "disk, and a guest cannot override them."
        : `The guest class ${guestClassName} sizes it: its cpu, its memory and its root disk come from the class ` +
            "and cannot be overridden here.",
    );
  }

  if (imageName) {
    notes.push(
      `Its root disk is cloned from the image ${imageName} into a PVC of this guest, by a clone job the controller ` +
        "creates for it.",
    );
  }

  if (seedProfile) {
    notes.push(
      `The seed profile ${seedProfile} is rendered into a Secret of this guest and attached as its cloud-init ` +
        "NoCloud seed.",
    );
  }

  notes.push(
    runPolicyStarts(values.runPolicy)
      ? `Run policy ${values.runPolicy}: ${runPolicyNote(values.runPolicy)} A launcher pod is created for it as ` +
          "soon as its root disk is ready."
      : `Run policy ${values.runPolicy}: ${runPolicyNote(values.runPolicy)} No launcher pod is created now.`,
  );

  if (nodeName) {
    notes.push(`It is pinned to the node ${nodeName}. ${nodePinFact}`);
  }

  notes.push(liveMigrationFact(storage));

  if (values.guestAgentEnabled) {
    notes.push(guestAgentFact);
  }

  const willWait = imageWillWaitFact(image);

  if (willWait) {
    warnings.push(willWait);
  }

  if (osType.osType === "windows") {
    warnings.push(windowsConstraintFact);
  }

  if (osType.unverified) {
    warnings.push(osType.text);
  }

  const warningsByField = guestCreateWarnings(inputs, values);

  // The name collision and every unverified value are stated in the summary as
  // well as at their field, for the reason the two SPEC-0011 dialogs state their
  // sharpest sentence twice: this form is tall enough that the summary sits
  // below the fold of the dialog's own scroll area, and a fact that has to be
  // visible at the moment it is chosen cannot live only where the user has to
  // scroll to find it.
  for (const field of ["name", "guestClass", "image", "seedProfile", "nodeName"] as const) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftGuest ${namespace}/${name}`, notes, warnings };
}

/**
 * The fields the form does not offer, named rather than silently absent (G1).
 *
 * Freelens' own YAML editor is the escape hatch upstream's UI does not have at
 * all - guests are missing from its resource catalog, so there is no YAML path
 * to a SwiftGuest there in any form.
 */
export const excludedFieldsFooter =
  "Not on this form: filesystems, vhostUserDevices and the sriov and vhost-user interface types, " +
  "topologySpreadConstraints, schedulerName, network.serviceAnnotations, network.loadBalancerClass, and the " +
  "migration block. Freelens' own YAML editor can add any of them to the guest after it exists.";

/** The success sentence: the fact that was written, never a prediction (W9). */
export function guestCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftGuest ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface GuestCreateFailureContext {
  namespace: string;
  name: string;
}

/**
 * The actionable sentence alone, for the three failures this dialog can predict.
 *
 * A 409 is the one it produces on purpose: the collision warning does not block,
 * so an ignored warning arrives here as the API server's own AlreadyExists, and
 * the fix is a rename in the form that is still open.
 */
export function guestCreateFailurePrefix(
  code: number | undefined,
  context: GuestCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftGuest named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftGuest CRD is gone.`;
  }

  return writeFailurePrefix(code, { verb: "create", resource: "swiftguests", namespace: context.namespace });
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function guestCreateFailureMessage(
  failure: ApiFailureFacts,
  context: GuestCreateFailureContext,
): string | undefined {
  const prefix = guestCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

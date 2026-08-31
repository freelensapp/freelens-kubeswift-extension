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
//
// Since slice 2 the same module owns the other two boot sources, whose grammar
// is entirely different from the image one:
//
// - A KERNEL-boot guest boots a SwiftKernel and its initramfs directly. It
//   clones no root disk, which is why upstream exempts it from the storage rule
//   a live migration otherwise needs, and why the storage overrides have
//   nothing to apply to. It is Linux only - the CRD scopes `windows` to disk
//   boot - and it only runs on the nodes the kernel artifact was pulled onto,
//   which are the ones labelled for kernel boot. A missing or not-Ready kernel
//   fails and then heals like the others, but on the 30-second resync rather
//   than immediately: kernels are not watched, images are.
// - A CLONE resumes the memory state of a SwiftSnapshot instead of booting.
//   The guest class is still required by the schema and is inert for sizing -
//   the resumed VM keeps the CPU and the memory of the capture - the target
//   node is required exactly for the two tiers whose artifacts have to be
//   downloaded (`s3` and `oci`) and ignored for the one that lives on a single
//   node (`local`), the MAC addresses are always rewritten because two VMs
//   resumed from one memory image would collide on them, and `regenerate` has
//   the trap that an EMPTY list means all four items - so a form that shows
//   three checkboxes and sends nothing would silently do the opposite of what
//   it displayed.

import { notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import {
  conflictStatusCode,
  isKernelNode,
  kernelNodeLabel,
  kernelNodeLabelValue,
  liveAccessMode,
  liveVolumeMode,
} from "./migration-create";
import {
  macAddressItem,
  machineIdentityItems,
  readySnapshotPhase,
  snapshotCapturesMemory,
  targetNodeBackendTypes,
} from "./restore-create";
import { backendWithArticle } from "./snapshot-create";

import type {
  SwiftGuestAccessMode,
  SwiftGuestCloneFromSnapshot,
  SwiftGuestOsType,
  SwiftGuestRunPolicy,
  SwiftGuestSeedIdentityField,
  SwiftGuestSpec,
  SwiftGuestVolumeMode,
} from "../api/kubeswift/swiftguest-v1alpha1";
import type { SwiftSnapshotBackendType } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type { ActionGuard, ApiFailureFacts } from "./guest-actions";
import type { NodeFacts } from "./migration-create";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createGuestTitle = "Create Guest";

/**
 * The three boot sources a SwiftGuest can have.
 *
 * Exclusivity between them lives in the admission webhook and nowhere in the
 * schema, so a control that offers exactly one of them makes the violation
 * inexpressible - which is stronger than validating it, and is the whole reason
 * the form branches on this type rather than on which field happens to be set.
 */
export type GuestBootSource = "image" | "kernel" | "clone";

/** The boot sources the form builds. All three since slice 2. */
export const implementedBootSources: GuestBootSource[] = ["image", "kernel", "clone"];

/** The boot source the form opens on: the one most guests have. */
export const defaultBootSource: GuestBootSource = "image";

/** The `phase` a SwiftImage reaches when it can be cloned into a guest's root disk. */
export const readyImagePhase = "Ready";

/** The `phase` a SwiftKernel reaches when its artifact is on the nodes that need it. */
export const readyKernelPhase = "Ready";

/** How each boot source is named, in the selector and in the sentences about it. */
export const guestBootSourceLabels: Record<GuestBootSource, string> = {
  image: "Disk image",
  kernel: "Kernel",
  clone: "Clone from snapshot",
};

/** One option of the boot-source selector: what it is called and what it does. */
export interface GuestBootSourceChoice {
  source: GuestBootSource;
  label: string;
  /** One line under the label, because these are three different kinds of guest. */
  description: string;
}

/**
 * What each boot source means, in one sentence apiece.
 *
 * The sentences are about what the CONTROLLER does, not about what the field is
 * called: the difference between the three is a cloned root disk, no disk at
 * all, and a memory image that is resumed rather than booted, and an operator
 * choosing between them is choosing between those three things.
 */
export function guestBootSourceChoices(): GuestBootSourceChoice[] {
  return implementedBootSources.map((source) => ({
    source,
    label: guestBootSourceLabels[source],
    description: guestBootSourceDescription(source),
  }));
}

/** The one-line description of a boot source, for the selector and its facts. */
export function guestBootSourceDescription(source: GuestBootSource): string {
  switch (source) {
    case "kernel":
      return (
        "The guest boots a SwiftKernel and its initramfs directly, with no root disk of its own. Linux only, and " +
        "only on the nodes the kernel artifact was pulled onto."
      );
    case "clone":
      return (
        "The guest resumes the memory state captured in a SwiftSnapshot instead of booting, with fresh MAC " +
        "addresses. The snapshot decides its CPU and memory, not the guest class."
      );
    default:
      return "The controller clones a SwiftImage into this guest's own root disk, and the guest boots from it.";
  }
}

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

/** The slice of a SwiftKernel the kernel picker and the cmdline override read. */
export interface GuestKernelFacts {
  name: string;
  /** `status.phase`: shown on every option, and never a reason to refuse one. */
  phase?: string;
  /** `spec.kernelCmdline`: the kernel's own default, which the guest can override. */
  kernelCmdline?: string;
  /** `spec.profile`: the informational label the artifact carries. */
  profile?: string;
}

/**
 * The slice of a captured guest spec the clone reads (`status.guestSpec`).
 *
 * The snapshot's own record of the guest it was taken from, and the only
 * authority a clone has about the VM it will resume: its OS, and the CPU and
 * memory the guest class is NOT going to decide.
 */
export interface GuestSnapshotGuestSpecFacts {
  cpu?: string;
  memoryMi?: number;
  osType?: string;
  imageName?: string;
  /** Whether the SOURCE guest carried the agent's vsock device at capture time. */
  guestAgent?: boolean;
  hasSeed?: boolean;
}

/** The slice of a SwiftSnapshot the clone picker and every clone sentence read. */
export interface GuestSnapshotFacts {
  name: string;
  phase?: string;
  backend?: SwiftSnapshotBackendType;
  /** `status.memorySnapshot`: the capture really holds a memory image. */
  hasMemorySnapshot?: boolean;
  /** `spec.includeDisk`: with the `oci` backend, the full-state capture. */
  includeDisk?: boolean;
  /** `spec.guestRef.name`: the guest the snapshot was taken from. */
  sourceGuestName?: string;
  /** `status.nodeName`: set for a `local` capture, which lives on exactly one node. */
  nodeName?: string;
  capturedAt?: string;
  /** `status.guestSpec`: what the source guest looked like at capture time. */
  guestSpec?: GuestSnapshotGuestSpecFacts;
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
  /** The chosen namespace's SwiftKernels, for kernel boot. */
  kernels: GuestKernelFacts[];
  kernelsUnverified: boolean;
  /** The chosen namespace's SwiftSnapshots, for clone boot. */
  snapshots: GuestSnapshotFacts[];
  snapshotsUnverified: boolean;
  /** The cluster's nodes, for the optional pin. */
  nodes: NodeFacts[];
  nodesUnverified: boolean;
  /** The chosen namespace's SwiftGuest names, for the collision warning. */
  existingNames: string[];
  /**
   * True when that read was refused, so the names above are unknown rather than
   * absent.
   *
   * The collision warning does not need the distinction - a list nobody could
   * read produces no warning, which is the safe direction - but the clone's
   * gone-source warning does, and in the opposite direction: it fires on a name
   * that is MISSING from the list, so an empty list from a refused read would
   * accuse every snapshot in the namespace of having lost its source guest.
   */
  existingNamesUnverified: boolean;
}

/** Every field the form holds, in one flat object so the model is one observable. */
export interface GuestFormValues {
  namespace: string;
  name: string;
  guestClass: string;
  /** What this guest boots from, and the one field most of the others hang off. */
  bootSource: GuestBootSource;
  image: string;
  /** Kernel boot: the SwiftKernel this guest boots. */
  kernel: string;
  /** Kernel boot: the per-guest override of the kernel's own command line. */
  kernelCmdline: string;
  /** Clone boot: the SwiftSnapshot whose memory state this guest resumes. */
  snapshot: string;
  /** Clone boot: `cloneFromSnapshot.targetNode`, required for the downloaded tiers. */
  cloneTargetNode: string;
  /**
   * Clone boot: hostname, machine ID and SSH host keys, as one checkbox.
   *
   * One control for three enum values, the granularity SPEC-0011 settled for
   * the Restore dialog: upstream does the three inside the guest, on its first
   * boot, through one marker - so three checkboxes would promise a precision
   * the implementation does not have. The fourth item, the MAC rewrite, is not
   * a checkbox at all because it cannot be turned off.
   */
  regenerateMachineIdentity: boolean;
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
    kernel: "",
    kernelCmdline: "",
    snapshot: "",
    cloneTargetNode: "",
    // On, like the Restore dialog's own checkbox: a clone that keeps the
    // source's hostname, machine ID and SSH host keys is two machines with one
    // identity, and the operator who wants that can say so.
    regenerateMachineIdentity: true,
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

/**
 * The form after the boot source changes: the fields of the other two sources
 * emptied, and the fields the new one does not have either.
 *
 * Every field that belongs to a source the guest no longer has is cleared, and
 * that is not tidiness: the payload builder branches on `bootSource`, so a
 * leftover value would be invisible in the object the API server stores and
 * visible in the form, which is the worst of the two. What survives is what the
 * three sources share - the namespace, the name, the class, the run policy and
 * the guest agent - because they answer questions the boot source does not
 * change.
 *
 * Three fields are cleared for a reason of their own:
 *
 * - the SEED profile, because upstream scopes it to disk boot and the clone
 *   path ignores it, so this form refuses it on the other two sources;
 * - the NODE pin on clone boot, where the clone's own `targetNode` decides
 *   where the guest runs and a second pin could disagree with it;
 * - the STORAGE overrides on kernel boot, where there is no root-disk clone for
 *   them to apply to.
 */
export function switchBootSource(values: GuestFormValues, source: GuestBootSource): GuestFormValues {
  return {
    ...values,
    bootSource: source,
    image: source === "image" ? values.image : "",
    kernel: source === "kernel" ? values.kernel : "",
    kernelCmdline: source === "kernel" ? values.kernelCmdline : "",
    snapshot: source === "clone" ? values.snapshot : "",
    cloneTargetNode: source === "clone" ? values.cloneTargetNode : "",
    seedProfile: seedProfileApplies(source) ? values.seedProfile : "",
    nodeName: source === "clone" ? "" : values.nodeName,
    storageAccessMode: storageOverridesApply(source) ? values.storageAccessMode : "",
    storageVolumeMode: storageOverridesApply(source) ? values.storageVolumeMode : "",
    storageClassName: storageOverridesApply(source) ? values.storageClassName : "",
  };
}

/**
 * Whether a cloud-init seed profile means anything for this boot source.
 *
 * Disk boot only, which is the CRD's own scope for the field: a kernel-boot
 * guest has no cloned root disk for the seed to be attached to, and the clone
 * path resumes a VM that was already seeded once, so upstream ignores the
 * reference there. A field the API documents as a no-op is not rendered at all
 * (W12), and what it claims to control is stated as a fact instead.
 */
export function seedProfileApplies(source: GuestBootSource): boolean {
  return source === "image";
}

/** Why the seed profile is not offered for this source, or `undefined` when it is. */
export function seedProfileDroppedReason(source: GuestBootSource): string | undefined {
  if (source === "kernel") {
    return (
      "A kernel-boot guest takes no cloud-init seed: the CRD scopes seedProfileRef to disk boot, and this guest " +
      "clones no root disk for a seed to be attached to. Nothing is sent for it."
    );
  }

  if (source === "clone") {
    return (
      "A clone takes no cloud-init seed: it resumes a machine that was already seeded on its first boot, and the " +
      "clone path ignores the reference. Nothing is sent for it - the identity below is what a clone regenerates."
    );
  }

  return undefined;
}

/**
 * Whether the storage overrides change anything for this boot source.
 *
 * They configure the PVCs the controller creates for the guest, which today is
 * the root-disk clone alone - and a kernel-boot guest has none. That is the same
 * fact upstream uses to exempt kernel-boot guests from the storage rule a live
 * migration needs, and it is why the section is dropped rather than rendered
 * and ignored.
 */
export function storageOverridesApply(source: GuestBootSource): boolean {
  return source !== "kernel";
}

/** What the storage section says on kernel boot, where it is not rendered (W12). */
export const kernelStorageDroppedFact =
  "A kernel-boot guest has no root disk of its own, so there is no PVC for these overrides to apply to. It is the " +
  "same fact that exempts a kernel-boot guest from the ReadWriteMany and Block storage a live migration otherwise " +
  "needs.";

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
export function guestClassSizing(
  guestClass: GuestClassFacts,
  source: GuestBootSource = "image",
): GuestClassSizingRow[] {
  // Two of the five rows are about something the other boot sources do not
  // have. A clone keeps the CPU and the memory of the capture, so the class's
  // numbers are stored and never applied; a kernel-boot guest clones no root
  // disk, so neither the root disk nor the storage of the class is used for it.
  // Saying so on the row is cheaper than a paragraph, and it is the row a user
  // would otherwise plan around.
  const inert = source === "clone" ? " - not used by a clone" : "";
  const rows: GuestClassSizingRow[] = [
    { label: "CPU", value: `${guestClass.cpu ?? "not set"}${inert}` },
    { label: "Memory", value: `${guestClass.memory ?? "not set"}${inert}` },
    {
      label: "Root disk",
      value:
        source === "kernel"
          ? "not used - a kernel-boot guest clones none"
          : guestClass.rootDisk?.size
            ? `${guestClass.rootDisk.size}${guestClass.rootDisk.format ? ` ${guestClass.rootDisk.format}` : ""}`
            : "not set",
    },
    {
      label: "Storage",
      value: source === "kernel" ? "not used - no root-disk PVC is created" : classStorageText(guestClass),
    },
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
export function liveMigrationFact(storage: ResolvedGuestStorage, source: GuestBootSource = "image"): string {
  if (source === "kernel") {
    return kernelLiveMigrationFact;
  }

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
export function liveMigrationLabel(storage: ResolvedGuestStorage, source: GuestBootSource = "image"): string {
  if (source === "kernel") {
    return "not restricted by storage (kernel boot)";
  }

  if (!storage.resolved) {
    return "unverified (the guest class could not be read)";
  }

  return storage.liveMigratable
    ? `possible (${resolvedStorageText(storage)})`
    : `offline only (${resolvedStorageText(storage)})`;
}

/**
 * What a kernel-boot guest's storage means for a future migration of it, which
 * is nothing.
 *
 * The one place this form states an exemption rather than a constraint: upstream
 * requires shared Block storage before it will live-migrate a guest, and it
 * skips that check entirely for a kernel-boot guest, because there is no cloned
 * root disk for two launcher pods to contend for. The sentence is the same fact
 * the Migrate dialog computes from the other side (SPEC-0012).
 */
export const kernelLiveMigrationFact =
  `A kernel-boot guest clones no root disk, so the ${liveAccessMode} and ${liveVolumeMode} storage a live migration ` +
  "normally needs does not apply to it: upstream exempts it from that rule. What decides a live migration for this " +
  "guest is its devices and its node, not its storage.";

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

/** One option of the kernel picker, with the readiness of the artifact pull (G2). */
export interface GuestKernelChoice {
  name: string;
  phase?: string;
  /** Ready kernels are offered plainly; the others are dimmed and still selectable. */
  ready: boolean;
  label: string;
  facts: GuestKernelFacts;
}

/**
 * The kernels the picker offers: every SwiftKernel in the namespace, with its
 * phase.
 *
 * Nothing is filtered and nothing is disabled, for the reason the image picker
 * offers a still-importing image: a guest created against a kernel that is
 * still being pulled is born Failed and then heals. What differs is HOW it
 * heals, and the difference is worth a sentence rather than a refusal - see
 * `kernelWillWaitFact`.
 */
export function guestKernelChoices(inputs: GuestCreateInputs): GuestKernelChoice[] {
  return inputs.kernels.map((kernel) => ({
    name: kernel.name,
    phase: kernel.phase,
    ready: kernel.phase === readyKernelPhase,
    label: kernel.phase ? `${kernel.name} - ${kernel.phase}` : `${kernel.name} - no phase yet`,
    facts: kernel,
  }));
}

/** The kernel the form is pointing at, when the read returned it. */
export function pickedKernel(inputs: GuestCreateInputs, values: GuestFormValues): GuestKernelFacts | undefined {
  const name = values.kernel.trim();

  return name ? inputs.kernels.find((kernel) => kernel.name === name) : undefined;
}

/**
 * What happens when this guest is created against a kernel that is not Ready,
 * or `undefined` when the question does not arise.
 *
 * The same shape as the image's will-wait line and deliberately not the same
 * sentence: images are WATCHED, so a guest waiting for one reconciles the
 * instant it turns Ready, while a kernel is caught by the controller's periodic
 * resync instead. Half a minute of `Failed` that nobody has to act on is a
 * different thing to be told about than an immediate recovery, and stating one
 * as the other is how a form teaches an operator to distrust it.
 */
export function kernelWillWaitFact(kernel: GuestKernelChoice | GuestKernelFacts | undefined): string | undefined {
  if (!kernel || kernel.phase === readyKernelPhase) {
    return undefined;
  }

  const phase = kernel.phase ? `is ${kernel.phase}` : "has not reported a phase yet";

  return (
    `The kernel ${kernel.name} ${phase}, not ${readyKernelPhase}: this guest is created now and is born Failed, ` +
    "with Resolved=False, until the artifact is on its node. Kernels are not watched the way images are, so the " +
    "guest reconciles on the controller's 30-second resync rather than the moment the kernel turns Ready - nothing " +
    "else has to happen, and nothing has to be recreated."
  );
}

/**
 * What the command-line field overrides, which is a fact about the kernel
 * rather than about the field.
 *
 * The one thing a user cannot guess here is what they are replacing: a kernel
 * carries its own `spec.kernelCmdline`, the guest's value replaces it whole
 * rather than adding to it, and an empty field leaves the kernel's own line
 * alone.
 */
export function kernelCmdlineFact(kernel: GuestKernelFacts | undefined, named: string): string {
  const name = named.trim();

  if (!name) {
    return "Optional. It replaces the kernel's own command line for this guest alone; empty keeps the kernel's.";
  }

  if (!kernel) {
    return (
      `Optional. The kernel ${name} could not be read from here, so the command line it would boot with is ` +
      "unknown: anything typed here replaces it whole."
    );
  }

  if (!kernel.kernelCmdline) {
    return `Optional. The kernel ${name} declares no command line of its own, so this guest boots with what is typed here.`;
  }

  return `Optional. The kernel ${name} boots with "${kernel.kernelCmdline}"; a value here replaces that line whole for this guest.`;
}

/**
 * The rule a pinned kernel-boot guest lives under, shared with the Migrate
 * dialog (SPEC-0012).
 *
 * The controller pulls the artifact onto the labelled nodes only, so an
 * unlabelled node cannot start the guest at all - which is why the node picker
 * offers those nodes disabled, with this as the reason, rather than dropping
 * them: the fix is a label on a node the operator can see in the list.
 */
export const kernelNodeRuleFact =
  `A kernel-boot guest only runs on a node labelled ${kernelNodeLabel}: ${kernelNodeLabelValue} - the controller ` +
  "pulls the kernel artifact onto those nodes and no others.";

/** One option of the clone picker: a snapshot this guest could resume. */
export interface GuestSnapshotChoice {
  name: string;
  phase?: string;
  backend?: SwiftSnapshotBackendType;
  label: string;
  facts: GuestSnapshotFacts;
}

/**
 * Whether this snapshot can be resumed at all: it is Ready, and it holds memory.
 *
 * The memory half is `snapshotCapturesMemory`, the derivation the Restore dialog
 * already ships (backend, or the controller's own `status.memorySnapshot`
 * record). `spec.includeMemory` is deliberately not consulted: the CRD documents
 * it as a no-op on every backend, so a `local` capture with the flag off still
 * holds memory and a `csi-volume-snapshot` with it on still does not.
 */
export function snapshotIsResumable(snapshot: GuestSnapshotFacts): boolean {
  return snapshot.phase === readySnapshotPhase && snapshotCapturesMemory(snapshot);
}

/**
 * The snapshots the picker offers: the Ready ones that hold a memory image.
 *
 * The only picker of this form that filters rather than dims, and the reason is
 * that the two rejected kinds are not waits. A disk-only snapshot has nothing to
 * resume and never will - it is what the backend captured, not a phase it will
 * grow out of - and a snapshot that is still capturing is a partial artifact
 * whose readiness the CRD itself requires. What the dimmed-and-selectable
 * treatment buys elsewhere is "create it now, it heals", and neither of these
 * heals into a clone the way an importing image heals into a boot. The count of
 * what was left out, and why, is one sentence under the control
 * (`excludedSnapshotsReason`), because an empty picker with no explanation is
 * indistinguishable from a broken one.
 */
export function cloneSnapshotChoices(inputs: GuestCreateInputs): GuestSnapshotChoice[] {
  return inputs.snapshots.filter(snapshotIsResumable).map((snapshot) => ({
    name: snapshot.name,
    phase: snapshot.phase,
    backend: snapshot.backend,
    label: snapshot.backend
      ? `${snapshot.name} - ${snapshot.backend}, ${snapshot.phase ?? "no phase"}`
      : `${snapshot.name} - ${snapshot.phase ?? "no phase"}`,
    facts: snapshot,
  }));
}

/**
 * Why the namespace's other snapshots are not in the picker, counted rather
 * than asserted, or `undefined` when every one of them is offered.
 *
 * The same honesty the empty node picker carries in the Migrate dialog: the
 * numbers say which of the two rules removed what, so an operator who expected
 * to see a name knows whether to wait for a capture or to take a different kind
 * of snapshot.
 */
export function excludedSnapshotsReason(inputs: GuestCreateInputs): string | undefined {
  const diskOnly = inputs.snapshots.filter((snapshot) => !snapshotCapturesMemory(snapshot)).length;
  const notReady = inputs.snapshots.filter(
    (snapshot) => snapshotCapturesMemory(snapshot) && snapshot.phase !== readySnapshotPhase,
  ).length;

  if (diskOnly === 0 && notReady === 0) {
    return undefined;
  }

  const parts: string[] = [];

  if (diskOnly > 0) {
    parts.push(
      `${diskOnly} ${diskOnly === 1 ? "holds" : "hold"} no memory image (a disk-only capture has nothing to resume)`,
    );
  }

  if (notReady > 0) {
    parts.push(`${notReady} ${notReady === 1 ? "is" : "are"} not ${readySnapshotPhase} yet`);
  }

  const total = inputs.snapshots.length;

  return (
    `${parts.join(", and ")}. This namespace has ${total} ${total === 1 ? "snapshot" : "snapshots"}; a clone needs a ` +
    `${readySnapshotPhase} one that captured memory.`
  );
}

/** The snapshot the form is pointing at, when the read returned it. */
export function pickedSnapshot(inputs: GuestCreateInputs, values: GuestFormValues): GuestSnapshotFacts | undefined {
  const name = values.snapshot.trim();

  return name ? inputs.snapshots.find((snapshot) => snapshot.name === name) : undefined;
}

/**
 * Whether this clone has to be told which node to run on (G10).
 *
 * Computed from the snapshot's backend and never asked of the user: an `s3` or
 * an `oci` capture is an artifact in a registry or a bucket that has to be
 * downloaded somewhere, and upstream needs to be told where; a `local` capture
 * lives on exactly one node and the clone is pinned to it. Upstream's own
 * clients ask the operator to know which tier they are on. This one reads it
 * off the object.
 *
 * It narrows rather than returning a plain boolean: the tiers it selects are by
 * definition snapshots whose backend is known, so the sentences it guards can
 * name that backend without a fallback that could never render.
 */
export function cloneTargetNodeApplies(
  snapshot: GuestSnapshotFacts | undefined,
): snapshot is GuestSnapshotFacts & { backend: SwiftSnapshotBackendType } {
  return snapshot?.backend !== undefined && targetNodeBackendTypes.includes(snapshot.backend);
}

/**
 * Where this clone will run, in one sentence, for the case where the form does
 * not ask.
 *
 * A `local` snapshot pins the clone to the node that holds it, which is a fact
 * of the capture rather than a decision of this form - so the node is stated
 * where the picker would have been (W12's option dropping), including when the
 * status did not record one.
 */
export function cloneNodeFact(snapshot: GuestSnapshotFacts | undefined): string | undefined {
  if (!snapshot || cloneTargetNodeApplies(snapshot)) {
    return undefined;
  }

  if (snapshot.nodeName) {
    return (
      `This clone runs on ${snapshot.nodeName}: the ${snapshot.backend ?? "local"} capture lives on that node and ` +
      "the clone is pinned to it, so no target node is sent and no node pin is offered."
    );
  }

  return (
    `This clone runs where the ${snapshot.backend ?? "local"} capture lives: that node is not recorded on the ` +
    "snapshot, so it cannot be named here. No target node is sent."
  );
}

/**
 * The identity attributes this clone regenerates: always the MAC addresses,
 * plus the machine-identity trio when the checkbox is on.
 *
 * The list is ALWAYS sent explicitly, and that is a correctness rule rather
 * than a preference: upstream reads an empty `regenerate` as all four items, so
 * a clone whose operator deliberately left the machine identity alone and whose
 * form sent nothing would regenerate exactly what the operator kept. Sending
 * the list the checkboxes show is the only way the stored object can say what
 * the user saw.
 */
export function cloneIdentityItems(values: GuestFormValues): SwiftGuestSeedIdentityField[] {
  const items: SwiftGuestSeedIdentityField[] = [];

  if (values.regenerateMachineIdentity) {
    items.push(...machineIdentityItems);
  }

  // Never optional: the CRD says the rewrite is forced on, and a list that
  // omitted it would be a list upstream has to correct.
  items.push(macAddressItem);

  return items;
}

/** Why the MAC rewrite is not a checkbox, on the control and in the summary. */
export const cloneMacLockRule =
  "Every NIC of this clone is given a new MAC address, and that cannot be turned off: two VMs resumed from one " +
  "memory image would come up holding the same MAC addresses and collide on the network. Upstream forces the " +
  "rewrite, and this form sends it in the list rather than relying on it.";

/** What the regenerate list means on the wire, which is not what an empty one means. */
export function cloneRegenerateFact(values: GuestFormValues): string {
  const items = cloneIdentityItems(values).join(", ");

  return (
    `spec.cloneFromSnapshot.regenerate is sent as ${items}. An empty list means all four items to upstream, so ` +
    "this form always sends the list it shows: what is stored is what was on screen."
  );
}

/** What the machine-identity checkbox really does, and where the work happens. */
export function cloneMachineIdentityFact(snapshot: GuestSnapshotFacts | undefined): string {
  const base =
    "Hostname, machine ID and SSH host keys, as one control: upstream regenerates the three together on the " +
    "clone's first boot, through the seed's own commands.";

  if (!snapshot?.guestSpec) {
    return base;
  }

  return snapshot.guestSpec.guestAgent
    ? `${base} The captured guest carried the agent's vsock device, so the clone can also do it in place, without a reboot.`
    : `${base} The captured guest carried no agent device, so this happens on the clone's first boot and not in place.`;
}

/** The sizing rows a clone really gets, read off the snapshot rather than the class. */
export function cloneSizingRows(snapshot: GuestSnapshotFacts | undefined): GuestClassSizingRow[] {
  const guestSpec = snapshot?.guestSpec;

  if (!snapshot || !guestSpec || (guestSpec.cpu === undefined && guestSpec.memoryMi === undefined)) {
    return [];
  }

  const rows: GuestClassSizingRow[] = [];

  if (guestSpec.cpu !== undefined) {
    rows.push({ label: "Resumed CPU", value: `${guestSpec.cpu} (from ${snapshot.name})` });
  }

  if (guestSpec.memoryMi !== undefined) {
    rows.push({ label: "Resumed memory", value: `${guestSpec.memoryMi}Mi (from ${snapshot.name})` });
  }

  return rows;
}

/**
 * Why the guest class is still required although it sizes nothing here (G10).
 *
 * The trap this closes is an operator picking a bigger class to give the clone
 * more memory. The schema requires the reference, the resumed VM keeps the CPU
 * and the memory of the capture, and the two facts together are only obvious to
 * someone who has read the CRD's own field comment.
 */
export function cloneInertClassNote(snapshot: GuestSnapshotFacts | undefined): string {
  const guestSpec = snapshot?.guestSpec;
  const sizing: string[] = [];

  if (guestSpec?.cpu !== undefined) {
    sizing.push(`${guestSpec.cpu} vCPU`);
  }

  if (guestSpec?.memoryMi !== undefined) {
    sizing.push(`${guestSpec.memoryMi}Mi`);
  }

  const captured =
    sizing.length > 0
      ? ` The capture records ${sizing.join(" and ")}, and that is what the clone comes up with.`
      : " What the capture recorded is not readable from here, but it is still the snapshot that decides.";

  return (
    "The guest class is required by the schema and does not size this clone: the resumed VM keeps the CPU and the " +
    `memory it was captured with.${captured}`
  );
}

/**
 * Whether the snapshot's source guest is gone from the namespace, which is a
 * warning and never a block.
 *
 * Read from the same list the collision warning uses, with one asymmetry that
 * matters: a read that was REFUSED produces no warning at all, because a list
 * nobody could fetch is not evidence that a guest is missing. The two tails of
 * the sentence are different facts rather than different phrasings - a
 * full-state `oci` capture carries the disk as well as the memory, which is what
 * makes a clone of it independent of the guest it came from.
 */
export function cloneGoneSourceWarning(inputs: GuestCreateInputs, values: GuestFormValues): string | undefined {
  if (values.bootSource !== "clone" || inputs.existingNamesUnverified) {
    return undefined;
  }

  const snapshot = pickedSnapshot(inputs, values);
  const source = snapshot?.sourceGuestName;

  if (!snapshot || !source || inputs.existingNames.includes(source)) {
    return undefined;
  }

  const fullState = snapshot.backend === "oci" && snapshot.includeDisk === true;
  const capture = snapshot.backend ? `${backendWithArticle(snapshot.backend)} capture` : "a non-oci capture";

  return fullState
    ? `The guest ${source} this snapshot was taken from is gone from ${values.namespace.trim() || "this namespace"}. ` +
        "This is a full-state oci capture, which carries the disk as well as the memory, so the clone does not need " +
        "it - the warning is here because the store may be stale and because nothing else would say so."
    : `The guest ${source} this snapshot was taken from is gone from ${values.namespace.trim() || "this namespace"}. ` +
        "A clone that does not need its source guest is only possible from a full-state oci capture; this one is " +
        `${capture}, so the create may fail. The store may be stale, so this warns rather than blocks.`;
}

/** The OS of this guest, which the boot source answers rather than the user (G4). */
export interface GuestOsTypeFact {
  osType: SwiftGuestOsType;
  /**
   * True when the object the boot source names said so: the picked image, or
   * the guest spec the picked snapshot captured. False when the schema default
   * is standing in, and on kernel boot, where the answer is a property of the
   * boot source itself.
   */
  fromImage: boolean;
  /** True when the object is named but could not be read, so the value is an assumption. */
  unverified: boolean;
  /** The sentence the form renders where a user would otherwise expect a control. */
  text: string;
}

/**
 * The guest's `spec.osType`, synced from whatever this guest boots from.
 *
 * On disk boot the resolved OS comes from the SwiftImage and the guest's own
 * field is only a cross-check - but the CRD defaults that field to `linux`, so a
 * guest created from a Windows image with the field untouched is born Failed on
 * the mismatch. Keeping the two equal by construction is what closes that trap,
 * and it is why this is rendered as a fact instead of offered as a select.
 *
 * The other two sources have an answer of their own. Kernel boot is Linux only,
 * which the CRD states as a scope on `windows` rather than as a rule on
 * `kernelRef`, so nothing about it is a choice. A clone resumes a machine that
 * already has an OS, and the snapshot recorded which one in the guest spec it
 * captured - which is the same G4 move made against a different object.
 */
export function guestOsType(inputs: GuestCreateInputs, values: GuestFormValues): GuestOsTypeFact {
  if (values.bootSource === "kernel") {
    return {
      osType: "linux",
      fromImage: false,
      unverified: false,
      text:
        "linux: a kernel-boot guest is Linux only. Upstream scopes windows to disk boot, so this is a property of " +
        "the boot source rather than a choice, and it is sent explicitly like every other value on this form.",
    };
  }

  if (values.bootSource === "clone") {
    return cloneOsType(inputs, values);
  }

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

/**
 * The OS of a clone, read off the guest spec its snapshot captured.
 *
 * Three readings rather than one, because "not readable" and "readable and
 * silent" are different facts: a snapshot that recorded no osType is not
 * evidence that the captured guest was Linux, it is evidence that this form
 * cannot tell.
 */
function cloneOsType(inputs: GuestCreateInputs, values: GuestFormValues): GuestOsTypeFact {
  const named = values.snapshot.trim();
  const snapshot = pickedSnapshot(inputs, values);

  if (!named) {
    return {
      osType: "linux",
      fromImage: false,
      unverified: false,
      text: "linux, until a snapshot is picked: a clone keeps the OS of the machine it resumes, so this is never a choice.",
    };
  }

  if (!snapshot) {
    return {
      osType: "linux",
      fromImage: false,
      unverified: true,
      text:
        `linux, assumed: the snapshot ${named} could not be read from here, so the OS of the guest it captured is ` +
        "unverified. If that guest was a Windows one, fix spec.osType in the YAML editor after the create.",
    };
  }

  const captured = snapshot.guestSpec?.osType;

  if (!captured) {
    return {
      osType: "linux",
      fromImage: false,
      unverified: true,
      text:
        `linux, assumed: the snapshot ${snapshot.name} records no osType for the guest it captured, so this is the ` +
        "schema default rather than a reading. A clone keeps the OS it was captured with whatever this field says.",
    };
  }

  const osType: SwiftGuestOsType = captured === "windows" ? "windows" : "linux";

  return {
    osType,
    fromImage: true,
    unverified: false,
    text:
      `${osType}, read from the guest spec the snapshot ${snapshot.name} captured. A clone resumes a machine that ` +
      "already has an OS, so the form sends what the capture recorded rather than letting the CRD default decide.",
  };
}

/**
 * What a Windows clone runs into, which is a rule rather than a consequence.
 *
 * The CRD scopes `windows` to disk boot: a guest whose osType is `windows` and
 * whose boot source is a clone contradicts the field's own documentation. The
 * form still sends what the capture recorded - the alternative is claiming the
 * machine is Linux - and says where the rule lives, because the validating
 * webhook that would enforce it ships disabled and the create will usually go
 * through.
 */
export const windowsCloneWarning =
  "The captured guest is a Windows one, so this clone is created with osType: windows - but upstream documents " +
  "windows as disk boot only. A cluster with the validating webhook enabled may refuse this create; on a default " +
  "install, where the webhook is off, it is stored as it reads here.";

/** The rules a Windows guest lives under, which the OS type activates client-side (G4, G5). */
export const windowsConstraintFact =
  "This is a Windows image, so the guest is created with osType: windows and upstream's Windows rules apply to it: " +
  "it boots from a disk image only, it takes no GPU profile, and it mounts no filesystems.";

/**
 * Whether a GPU can be attached to this guest at all, and why not when it
 * cannot (W4's `{ enabled, reason }`, applied to a section rather than a
 * button).
 *
 * The section itself is slice 3; the rule is here now because it belongs to the
 * boot source, and because two of its three cases are the kind upstream leaves
 * to a webhook that ships disabled:
 *
 * - KERNEL boot is the documented-but-unenforced one (G6). Upstream's own field
 *   documentation calls `gpuProfileRef` and `kernelRef` mutually exclusive, and
 *   gives the reason - GPU boot needs a disk boot with UEFI - and no webhook or
 *   controller anywhere rejects the pair. A guest that carries both is accepted
 *   and then fails to boot for a reason nothing states.
 * - CLONE boot is upstream's own exclusion, with its own reason: the device
 *   state of a passed-through GPU is not in a memory snapshot, so a resumed VM
 *   cannot get its GPU back. Upstream writes the exclusion against
 *   `gpuProfileRef`; the reason it gives holds for the DRA claim in exactly the
 *   same way, so this form excludes both backends and says which half is ours.
 * - WINDOWS is the third, and it is about the OS rather than the boot source:
 *   upstream does not support a GPU profile on a Windows guest in v1.
 */
export function guestGpuGuard(inputs: GuestCreateInputs, values: GuestFormValues): ActionGuard {
  if (values.bootSource === "kernel") {
    return {
      enabled: false,
      reason:
        "A kernel-boot guest takes no GPU. Upstream's own documentation calls the GPU profile and the kernel " +
        "reference mutually exclusive - GPU boot needs a disk boot with UEFI - and nothing in the API server, the " +
        "webhook or the controller enforces it, so a guest that carried both would be accepted and never boot.",
    };
  }

  if (values.bootSource === "clone") {
    return {
      enabled: false,
      reason:
        "A clone takes no GPU: the state of a passed-through device is not captured in a memory snapshot, so a " +
        "resumed VM cannot be given its GPU back. Upstream states the exclusion for the GPU profile; the same " +
        "reason applies to the DRA claim, so this form excludes both.",
    };
  }

  if (guestOsType(inputs, values).osType === "windows") {
    return {
      enabled: false,
      reason: "A Windows guest takes no GPU profile: upstream does not support the pair in v1.",
    };
  }

  return { enabled: true };
}

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

/** One option of a node picker, with the reason it cannot be chosen when it cannot. */
export interface GuestNodeChoice {
  name: string;
  guard: ActionGuard;
}

/**
 * The nodes this guest can be placed on: Ready and schedulable, in name order.
 *
 * Not Ready and cordoned nodes are dropped rather than disabled, exactly as the
 * Migrate dialog drops them: a node that cannot take a pod is not a choice with
 * a reason, it is not a choice. The one constraint that disables rather than
 * drops is the kernel-node label, for the same reason it does there: it is
 * about this guest rather than about the node, and the fix is a label the
 * operator can put on a node they can see in the list.
 *
 * Both node pickers of this form use it - the optional pin and the clone's
 * target node - which is why the boot source is a parameter: the label rule
 * binds on kernel boot and on nothing else.
 */
export function guestNodeChoices(inputs: GuestCreateInputs, source: GuestBootSource = "image"): GuestNodeChoice[] {
  return inputs.nodes
    .filter((node) => node.ready && node.schedulable)
    .map((node) => ({
      name: node.name,
      guard:
        source === "kernel" && !isKernelNode(node)
          ? {
              enabled: false as const,
              reason: `${node.name} does not carry ${kernelNodeLabel}: ${kernelNodeLabelValue}. ${kernelNodeRuleFact}`,
            }
          : { enabled: true as const },
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Whether the optional node pin is offered at all for this boot source. */
export function nodePinApplies(source: GuestBootSource): boolean {
  return source !== "clone";
}

/** What stands where the node pin would be on clone boot (W12's option dropping). */
export const clonePinDroppedFact =
  "A clone is placed by its snapshot: the tiers that have to be downloaded take the target node above, and a local " +
  "capture pins the clone to the node that holds it. A second pin here could disagree with either, so none is " +
  "offered and spec.nodeName is not sent.";

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
  | "kernel"
  | "kernelCmdline"
  | "snapshot"
  | "cloneTargetNode"
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
  kernel: "Kernel",
  kernelCmdline: "Kernel command line",
  snapshot: "Snapshot",
  cloneTargetNode: "Target node",
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
  "kernel",
  "kernelCmdline",
  "snapshot",
  "cloneTargetNode",
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
export function guestCreateErrors(inputs: GuestCreateInputs, values: GuestFormValues): GuestCreateFieldMessages {
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

  if (values.bootSource === "kernel" && !values.kernel.trim()) {
    errors.kernel =
      "A kernel is required: a guest with no boot source at all is born Failed with Resolved=False, and unlike a " +
      "kernel that is still being pulled that never heals on its own.";
  }

  if (values.bootSource === "clone") {
    const snapshot = pickedSnapshot(inputs, values);

    if (!values.snapshot.trim()) {
      errors.snapshot =
        "A snapshot is required: it is what this guest resumes, and a clone with no snapshot has no boot source at " +
        "all.";
    }

    // The requirement is a property of the snapshot rather than a question for
    // the user (G10): the two tiers whose artifacts have to be downloaded need
    // somewhere to download them to, and upstream fails the create without it.
    // The other tiers never render the field, so this can only fire where it
    // means something.
    if (cloneTargetNodeApplies(snapshot) && !values.cloneTargetNode.trim()) {
      errors.cloneTargetNode =
        `A target node is required: the snapshot ${values.snapshot.trim()} is ` +
        `${backendWithArticle(snapshot.backend)} capture, whose artifacts have to be downloaded onto a node before ` +
        "the clone can resume. Upstream fails a clone that names none.";
    }
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

  // Only where the seed means anything: a value left over from a boot source
  // the user moved away from is not sent at all, so warning about it would be
  // warning about a field that is neither rendered nor written.
  if (
    seedProfile &&
    seedProfileApplies(values.bootSource) &&
    !inputs.seedProfiles.some((profile) => profile.name === seedProfile)
  ) {
    warnings.seedProfile = inputs.seedProfilesUnverified
      ? `The seed profiles of this namespace could not be listed, so ${seedProfile} is not verified.`
      : `No SwiftSeedProfile named ${seedProfile} is in the namespace ${values.namespace || "of this guest"}. The ` +
        "guest waits, Resolved=False, until one exists.";
  }

  const kernel = values.kernel.trim();

  if (kernel && !pickedKernel(inputs, values)) {
    warnings.kernel = inputs.kernelsUnverified
      ? `The SwiftKernels of this namespace could not be listed, so ${kernel} is not verified: whether it exists, ` +
        "and whether its artifact is on any node, are unknown from here."
      : `No SwiftKernel named ${kernel} is in the namespace ${values.namespace || "of this guest"}. The guest is ` +
        "born Failed with Resolved=False and heals on the 30-second resync once the kernel exists.";
  }

  const snapshot = values.snapshot.trim();

  if (snapshot && !pickedSnapshot(inputs, values)) {
    warnings.snapshot = inputs.snapshotsUnverified
      ? `The SwiftSnapshots of this namespace could not be listed, so ${snapshot} is not verified: whether it ` +
        "exists, whether it is Ready and which tier it is on are unknown from here - including whether this clone " +
        "needs a target node."
      : `No SwiftSnapshot named ${snapshot} is in the namespace ${values.namespace || "of this guest"}, so what ` +
        "this guest would resume, and where, cannot be stated from here.";
  }

  const goneSource = cloneGoneSourceWarning(inputs, values);

  if (goneSource) {
    warnings.snapshot = warnings.snapshot ? `${warnings.snapshot} ${goneSource}` : goneSource;
  }

  const nodeName = values.nodeName.trim();
  const pinChoices = guestNodeChoices(inputs, values.bootSource);
  const pinned = pinChoices.find((node) => node.name === nodeName);

  if (nodeName && nodePinApplies(values.bootSource) && !pinned) {
    warnings.nodeName = inputs.nodesUnverified
      ? `The cluster's nodes could not be listed, so ${nodeName} is not verified: whether it exists, is Ready and ` +
        "can take this guest is unknown from here."
      : `No Ready, schedulable node named ${nodeName} is in this cluster. A pinned pod that no node accepts is ` +
        "rejected rather than rescheduled.";
  } else if (nodeName && pinned && !pinned.guard.enabled) {
    // The one case a node the picker holds is still the wrong answer: the pin
    // survived a switch to kernel boot, and the node it names cannot run a
    // kernel-boot guest. A warning rather than a refusal, because a label is
    // one `kubectl label` away and the read behind it can be stale.
    warnings.nodeName = pinned.guard.reason;
  }

  const targetNode = values.cloneTargetNode.trim();

  if (
    targetNode &&
    values.bootSource === "clone" &&
    !guestNodeChoices(inputs).some((node) => node.name === targetNode)
  ) {
    warnings.cloneTargetNode = inputs.nodesUnverified
      ? `The cluster's nodes could not be listed, so ${targetNode} is not verified: whether it exists, is Ready and ` +
        "can hold this clone is unknown from here."
      : `No Ready, schedulable node named ${targetNode} is in this cluster. The clone's artifacts have nowhere to ` +
        "be downloaded to on a node that cannot take its pod.";
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
export function guestCreateSubmitBlockReason(inputs: GuestCreateInputs, values: GuestFormValues): string | undefined {
  const errors = guestCreateErrors(inputs, values);
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
  if (!storageOverridesApply(values.bootSource)) {
    return undefined;
  }

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
  const kernel = values.kernel.trim();
  const kernelCmdline = values.kernelCmdline.trim();
  const snapshot = values.snapshot.trim();
  const seedProfile = values.seedProfile.trim();
  const nodeName = values.nodeName.trim();
  const storage = guestStorageOverrides(values);

  if (guestClass) {
    spec.guestClassRef = { name: guestClass };
  }

  // Exactly one boot source is expressible, because the form has one control
  // for the three and this builder reads it rather than the fields: a value
  // left behind by a source the user moved away from cannot reach the object.
  if (values.bootSource === "image" && image) {
    spec.imageRef = { name: image };
  }

  if (values.bootSource === "kernel" && kernel) {
    spec.kernelRef = { name: kernel };

    if (kernelCmdline) {
      spec.kernelCmdline = kernelCmdline;
    }
  }

  if (values.bootSource === "clone" && snapshot) {
    spec.cloneFromSnapshot = cloneFromSnapshotPayload(inputs, values, snapshot);
  }

  spec.osType = guestOsType(inputs, values).osType;
  spec.runPolicy = values.runPolicy;

  if (seedProfile && seedProfileApplies(values.bootSource)) {
    spec.seedProfileRef = { name: seedProfile };
  }

  if (nodeName && nodePinApplies(values.bootSource)) {
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

/**
 * The clone block: the snapshot, the explicit identity list, and the target
 * node only where the controller consults it.
 *
 * `regenerate` is never omitted, because an omitted list is not "none" to
 * upstream but "all four" - the one place on this form where sending less would
 * do more.
 */
function cloneFromSnapshotPayload(
  inputs: GuestCreateInputs,
  values: GuestFormValues,
  snapshotName: string,
): SwiftGuestCloneFromSnapshot {
  const clone: SwiftGuestCloneFromSnapshot = {
    snapshotRef: { name: snapshotName },
    regenerate: cloneIdentityItems(values),
  };
  const targetNode = values.cloneTargetNode.trim();

  if (targetNode && cloneTargetNodeApplies(pickedSnapshot(inputs, values))) {
    clone.targetNode = targetNode;
  }

  return clone;
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
  const kernel = pickedKernel(inputs, values);
  const kernelName = values.kernel.trim();
  const kernelCmdline = values.kernelCmdline.trim();
  const snapshot = pickedSnapshot(inputs, values);
  const snapshotName = values.snapshot.trim();
  const seedProfile = values.seedProfile.trim();
  const nodeName = values.nodeName.trim();
  const storage = resolvedStorage(inputs, values);
  const osType = guestOsType(inputs, values);

  if (guestClassName) {
    const sizing = guestClass ? guestClassSummary(guestClass) : "";

    notes.push(
      values.bootSource === "clone"
        ? `The guest class ${guestClassName} is stored on this guest. ${cloneInertClassNote(snapshot)}`
        : sizing
          ? `The guest class ${guestClassName} sizes it: ${sizing}. The class owns the cpu, the memory and the root ` +
            "disk, and a guest cannot override them."
          : `The guest class ${guestClassName} sizes it: its cpu, its memory and its root disk come from the class ` +
            "and cannot be overridden here.",
    );
  }

  if (values.bootSource === "image" && imageName) {
    notes.push(
      `Its root disk is cloned from the image ${imageName} into a PVC of this guest, by a clone job the controller ` +
        "creates for it.",
    );
  }

  if (values.bootSource === "kernel" && kernelName) {
    notes.push(
      `It boots the kernel ${kernelName} and its initramfs directly: no image is cloned and no root disk is created ` +
        "for it.",
    );

    if (kernelCmdline) {
      notes.push(
        kernel?.kernelCmdline
          ? `Its kernel command line is "${kernelCmdline}", replacing the kernel's own "${kernel.kernelCmdline}".`
          : `Its kernel command line is "${kernelCmdline}", sent as spec.kernelCmdline for this guest alone.`,
      );
    }

    notes.push(kernelNodeRuleFact);
  }

  if (values.bootSource === "clone" && snapshotName) {
    cloneSummaryNotes(inputs, values, notes);
  }

  if (seedProfile && seedProfileApplies(values.bootSource)) {
    notes.push(
      `The seed profile ${seedProfile} is rendered into a Secret of this guest and attached as its cloud-init ` +
        "NoCloud seed.",
    );
  }

  notes.push(runPolicySummaryNote(values));

  if (nodeName && nodePinApplies(values.bootSource)) {
    notes.push(`It is pinned to the node ${nodeName}. ${nodePinFact}`);
  }

  notes.push(liveMigrationFact(storage, values.bootSource));

  if (values.guestAgentEnabled) {
    notes.push(guestAgentFact);
  }

  const willWait =
    values.bootSource === "kernel"
      ? kernelWillWaitFact(kernel)
      : values.bootSource === "image"
        ? imageWillWaitFact(image)
        : undefined;

  if (willWait) {
    warnings.push(willWait);
  }

  if (osType.osType === "windows") {
    warnings.push(values.bootSource === "clone" ? windowsCloneWarning : windowsConstraintFact);
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
  for (const field of [
    "name",
    "guestClass",
    "image",
    "kernel",
    "snapshot",
    "cloneTargetNode",
    "seedProfile",
    "nodeName",
  ] as const) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftGuest ${namespace}/${name}`, notes, warnings };
}

/**
 * What the run policy means for this guest, which is not the same sentence on
 * every boot source.
 *
 * A clone is the one that reads differently: what its launcher pod does is
 * resume a memory image rather than boot a disk, so `Stopped` does not mean "a
 * guest that has not started" but "a capture that has not been resumed".
 * Upstream's own `swiftctl guest import` sends the policy explicitly on exactly
 * this path, which is why the form keeps sending it here too (G8).
 */
function runPolicySummaryNote(values: GuestFormValues): string {
  const head = `Run policy ${values.runPolicy}: ${runPolicyNote(values.runPolicy)}`;

  if (values.bootSource === "clone") {
    return runPolicyStarts(values.runPolicy)
      ? `${head} Its launcher pod resumes the captured memory instead of booting.`
      : `${head} No launcher pod is created now, so the captured memory is not resumed until this guest is started.`;
  }

  return runPolicyStarts(values.runPolicy)
    ? `${head} A launcher pod is created for it as soon as its ${values.bootSource === "kernel" ? "kernel artifact" : "root disk"} is ready.`
    : `${head} No launcher pod is created now.`;
}

/** The lines a clone-boot create is answerable for (SPEC-0011's grammar, G10). */
function cloneSummaryNotes(inputs: GuestCreateInputs, values: GuestFormValues, notes: string[]): void {
  const snapshot = pickedSnapshot(inputs, values);
  const snapshotName = values.snapshot.trim();
  const backend = snapshot?.backend ? `${snapshot.backend} ` : "";
  const captured = snapshot?.capturedAt ? `, captured at ${snapshot.capturedAt}` : "";

  notes.push(
    `It resumes the memory state of the ${backend}snapshot ${snapshotName}${captured} instead of booting: the VM ` +
      "comes up where the capture left it.",
  );
  notes.push(cloneMacLockRule);
  notes.push(cloneRegenerateFact(values));

  if (values.regenerateMachineIdentity) {
    notes.push(cloneMachineIdentityFact(snapshot));
  } else {
    notes.push(
      "The hostname, the machine ID and the SSH host keys of the captured machine are kept: only the MAC addresses " +
        "are regenerated. Two machines with one identity is a legitimate thing to want, and a surprising thing to " +
        "get by accident.",
    );
  }

  const targetNode = values.cloneTargetNode.trim();

  if (cloneTargetNodeApplies(snapshot)) {
    const capture = `${backendWithArticle(snapshot.backend)} capture`;

    notes.push(
      targetNode
        ? `Its artifacts are downloaded onto ${targetNode}, which is where this clone runs: ${capture} lives in a ` +
            "registry or a bucket rather than on a node, so upstream has to be told where to put it."
        : `The artifacts of ${capture} have to be downloaded onto a node before the clone can resume, and no ` +
            "target node is set yet.",
    );
  } else {
    const nodeFact = cloneNodeFact(snapshot);

    if (nodeFact) {
      notes.push(nodeFact);
    }
  }
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

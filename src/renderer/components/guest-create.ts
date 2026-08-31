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
  SwiftGuestDataDisk,
  SwiftGuestGpuResourceClaim,
  SwiftGuestGpuTier,
  SwiftGuestInterface,
  SwiftGuestInterfaceType,
  SwiftGuestNetwork,
  SwiftGuestNetworkBinding,
  SwiftGuestOsType,
  SwiftGuestPort,
  SwiftGuestProtocol,
  SwiftGuestRunPolicy,
  SwiftGuestSeedIdentityField,
  SwiftGuestServiceExposure,
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

/** The number of data disks the webhook allows on one guest. Nothing in the schema says so. */
export const maxDataDisks = 8;

/** The schema's own cap on a data disk's name, which is shorter than a DNS label. */
export const maxDataDiskNameLength = 36;

/** The volume mode `attachAsDisk` needs on the PVC it attaches: a raw device, not a directory. */
export const attachAsDiskVolumeMode: SwiftGuestVolumeMode = "Block";

/** The volume mode the API server stamps on a blank data disk when the form sends none. */
export const defaultBlankVolumeMode: SwiftGuestVolumeMode = "Block";

/** The binding the API server stamps on a `network` block that does not name one. */
export const defaultNetworkBinding: SwiftGuestNetworkBinding = "nat";

/** The protocol the API server stamps on a port that does not name one. */
export const defaultPortProtocol: SwiftGuestProtocol = "TCP";

/** The interface type the API server stamps on an interface that does not name one. */
export const defaultInterfaceType: SwiftGuestInterfaceType = "bridge";

/** The GPU tier the API server stamps on a DRA claim that does not name one. */
export const defaultGpuTier: SwiftGuestGpuTier = "pcie";

/** The lowest and the highest port number the schema accepts. */
export const minPortNumber = 1;
export const maxPortNumber = 65535;

/** The protocols a port may declare, in the order the select offers them. */
export const guestPortProtocols: SwiftGuestProtocol[] = ["TCP", "UDP", "SCTP"];

/** The Service types a port may ask the controller to mint. */
export const guestPortExposures: SwiftGuestServiceExposure[] = ["ClusterIP", "NodePort", "LoadBalancer"];

/** The bindings the primary interface may have. */
export const guestNetworkBindings: SwiftGuestNetworkBinding[] = ["nat", "bridge"];

/** The tiers a DRA claim may ask for, which are the SwiftGPUProfile ones. */
export const guestGpuTiers: SwiftGuestGpuTier[] = ["pcie", "hgx-shared", "hgx-full"];

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
 * The slice of a PersistentVolumeClaim a data-disk row reads.
 *
 * `volumeMode` is the interesting one: `attachAsDisk` attaches the claim as a
 * raw VM block device, which upstream only accepts on a `Block` claim - and
 * that is a fact of an object this form did not create and may not be allowed
 * to read, so the rule has a readable branch and an unreadable one.
 */
export interface GuestPvcFacts {
  name: string;
  /** `spec.volumeMode`: `Block` or `Filesystem`, absent when the claim does not say. */
  volumeMode?: string;
  /** `status.phase`: shown on the option, never a reason to refuse one. */
  phase?: string;
  storageClassName?: string;
}

/**
 * The slice of a SwiftGPUProfile the GPU picker reads.
 *
 * There is no readiness to show: the SwiftGPUProfile CRD declares
 * `subresources: {}` and no `status` at all (SPEC-0007), so a profile is a
 * request that nothing ever writes back to. What the option carries instead is
 * the request itself - how many GPUs, of which model, in which tier - because
 * that is the whole content of the object.
 */
export interface GuestGpuProfileFacts {
  name: string;
  count?: number;
  /** `spec.model`: the empty string means "any model matches". */
  model?: string;
  tier?: string;
  partitionMode?: string;
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
  /** The chosen namespace's PersistentVolumeClaims, for the data disks that attach one. */
  pvcs: GuestPvcFacts[];
  pvcsUnverified: boolean;
  /** The chosen namespace's SwiftGPUProfiles, for the native GPU backend. */
  gpuProfiles: GuestGpuProfileFacts[];
  gpuProfilesUnverified: boolean;
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

/** What one data-disk row is made of. Exactly one of the three, by construction. */
export type GuestDataDiskSource = "image" | "pvc" | "blank";

/**
 * One row of the data disks section.
 *
 * `id` is stable for the life of the row so that removing the second of three
 * does not renumber the third under the user's cursor; everything else is a
 * string because it is what an input holds, and the payload parses it once.
 */
export interface GuestDataDiskRow {
  id: string;
  name: string;
  source: GuestDataDiskSource;
  /** `imageRef.name`: a SwiftImage cloned into a guest-owned PVC. */
  image: string;
  /** `pvcRef.name`: a claim that already exists, attached as it is. */
  pvc: string;
  /** `blank.size`: a Kubernetes quantity, the one required field of a blank disk. */
  blankSize: string;
  blankStorageClass: string;
  /** `blank.volumeMode`: empty means the `Block` the API server stamps. */
  blankVolumeMode: string;
  /** Only ever true on a PVC row: upstream accepts it nowhere else. */
  attachAsDisk: boolean;
}

/** One row of the ports list, as the inputs hold it. */
export interface GuestPortRow {
  id: string;
  /** `port`: reachable on the pod IP, and the Service port when one is minted. */
  port: string;
  /** `name`: required above one port, because it becomes the Service port's name. */
  name: string;
  /** `targetPort`: what the guest listens on. Empty means "the same as the port". */
  targetPort: string;
  protocol: SwiftGuestProtocol;
  /** `expose`: empty means DNAT only and no Service object at all. */
  expose: string;
}

/** One row of the additional interfaces list. Bridge type only on this form. */
export interface GuestInterfaceRow {
  id: string;
  name: string;
  /** `networkRef.name`: a NetworkAttachmentDefinition. Empty means a node-local tap+bridge. */
  networkName: string;
  /** `networkRef.namespace`: empty means the guest's own namespace. */
  networkNamespace: string;
  primary: boolean;
  /** `mac`: empty means the deterministic address upstream generates. */
  mac: string;
}

/** Which GPU allocation backend this guest asks for, if any. */
export type GuestGpuBackend = "none" | "profile" | "claim";

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
  /** The secondary disks, at most eight of them. */
  dataDisks: GuestDataDiskRow[];
  /** `network.binding` of the PRIMARY interface. Sent only when it is not the stamped default. */
  networkBinding: SwiftGuestNetworkBinding;
  ports: GuestPortRow[];
  /** The additional interfaces, all of them bridge type on this form. */
  interfaces: GuestInterfaceRow[];
  gpuBackend: GuestGpuBackend;
  /** `gpuProfileRef.name`: the native backend. */
  gpuProfile: string;
  /** `gpuResourceClaim.resourceClaimName`: the DRA backend, shared claim. */
  gpuClaimName: string;
  /** `gpuResourceClaim.resourceClaimTemplateName`: the DRA backend, per-pod claim. */
  gpuClaimTemplateName: string;
  gpuRequestName: string;
  gpuTier: SwiftGuestGpuTier;
  gpuHugepages: string;
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
    // The three collapsed sections open on nothing at all: a form that arrived
    // with one empty data disk, one empty port and one interface would be
    // asking three questions nobody asked it to ask, and each of those rows
    // would block the submit until it was filled in or removed.
    dataDisks: [],
    networkBinding: defaultNetworkBinding,
    ports: [],
    interfaces: [],
    gpuBackend: "none",
    gpuProfile: "",
    gpuClaimName: "",
    gpuClaimTemplateName: "",
    gpuRequestName: "",
    gpuTier: defaultGpuTier,
    gpuHugepages: "",
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
 *
 * Since slice 3 the GPU goes the same way on the two sources that exclude it
 * outright (`guestGpuGuard`), and for the same reason: the payload builder
 * refuses to emit a GPU there, so a value left behind would be visible in the
 * form and absent from the object. The Windows exclusion is deliberately NOT
 * cleared here - it follows the picked image rather than the boot source, and a
 * user who tries a Windows image and goes back to a Linux one should find their
 * GPU choice where they left it.
 */
export function switchBootSource(values: GuestFormValues, source: GuestBootSource): GuestFormValues {
  const keepsGpu = gpuAppliesToBootSource(source);

  return {
    ...values,
    bootSource: source,
    gpuBackend: keepsGpu ? values.gpuBackend : "none",
    gpuProfile: keepsGpu ? values.gpuProfile : "",
    gpuClaimName: keepsGpu ? values.gpuClaimName : "",
    gpuClaimTemplateName: keepsGpu ? values.gpuClaimTemplateName : "",
    gpuRequestName: keepsGpu ? values.gpuRequestName : "",
    gpuTier: keepsGpu ? values.gpuTier : defaultGpuTier,
    gpuHugepages: keepsGpu ? values.gpuHugepages : "",
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
 * Whether a GPU can be attached to a guest with this boot source at all.
 *
 * The half of `guestGpuGuard` that depends on nothing but the source, which is
 * what `switchBootSource` clears against: the Windows exclusion follows the
 * picked image and cannot be answered from the source alone.
 */
export function gpuAppliesToBootSource(source: GuestBootSource): boolean {
  return source === "image";
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

// ---------------------------------------------------------------------------
// Section 8: data disks.
//
// Every rule below is the admission webhook's, and NONE of them is in the
// schema: upstream enforces "exactly one source", "attachAsDisk needs a
// Block-mode pvcRef", "at most eight disks" and "unique names" in a validating
// webhook that ships disabled, so on a normal install this form is the only
// place they are enforced at all. What a violation costs is not an error
// message from the API server but a guest that comes up missing a disk, or a
// launcher pod that mounts a directory where the operator expected a device.
// ---------------------------------------------------------------------------

/** The Kubernetes quantity pattern, off the CRD: what a blank disk's size has to match. */
const quantityPattern =
  /^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$/;

/** The DNS-1123 label rule, shared by the data disk, the port and the interface names. */
const dnsLabelPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** The name of a NetworkAttachmentDefinition: an object name, so a DNS subdomain. */
const dnsSubdomainPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** The canonical colon-separated MAC the schema's own pattern accepts. */
const macAddressPattern = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

/** How the Service port name a Kubernetes Service accepts is capped (IANA_SVC_NAME). */
export const maxServicePortNameLength = 15;

/**
 * The next id for a row of one of the repeatable sections.
 *
 * Derived from the rows that exist rather than from a counter, so the function
 * stays pure and two forms opened in sequence cannot disagree about it.
 */
export function nextRowId(prefix: string, rows: readonly { id: string }[]): string {
  const used = rows
    .map((row) => Number.parseInt(row.id.startsWith(`${prefix}-`) ? row.id.slice(prefix.length + 1) : "", 10))
    .filter((value) => Number.isFinite(value));

  return `${prefix}-${used.length > 0 ? Math.max(...used) + 1 : 1}`;
}

/** A data-disk row as the section adds it: named by the user, image-backed by default. */
export function newDataDiskRow(id: string): GuestDataDiskRow {
  return {
    id,
    name: "",
    source: "image",
    image: "",
    pvc: "",
    blankSize: "",
    blankStorageClass: "",
    blankVolumeMode: "",
    attachAsDisk: false,
  };
}

/**
 * Whether another data disk can be added, and why not when it cannot (W4).
 *
 * The one rule of this section that is about the section rather than about a
 * row, so it disables a control instead of marking a field - and like every
 * guard in this repository it produces the reason rather than a bare boolean.
 */
export function addDataDiskGuard(values: GuestFormValues): ActionGuard {
  if (values.dataDisks.length < maxDataDisks) {
    return { enabled: true };
  }

  return {
    enabled: false,
    reason:
      `A guest takes at most ${maxDataDisks} data disks, and this one already has ${values.dataDisks.length}. ` +
      "Upstream enforces the limit in its validating webhook, which ships disabled - so a ninth disk would be " +
      "stored and then ignored by the controller rather than refused.",
  };
}

/** The form with one more data-disk row, or unchanged when the guard refuses. */
export function addDataDisk(values: GuestFormValues): GuestFormValues {
  if (!addDataDiskGuard(values).enabled) {
    return values;
  }

  return { ...values, dataDisks: [...values.dataDisks, newDataDiskRow(nextRowId("disk", values.dataDisks))] };
}

/** The form without the named row. */
export function removeDataDisk(values: GuestFormValues, id: string): GuestFormValues {
  return { ...values, dataDisks: values.dataDisks.filter((row) => row.id !== id) };
}

/** The form with one field of one data-disk row changed. */
export function updateDataDisk(values: GuestFormValues, id: string, patch: Partial<GuestDataDiskRow>): GuestFormValues {
  return { ...values, dataDisks: values.dataDisks.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/**
 * Moves one row to another source, emptying the fields of the source it leaves.
 *
 * The same rule as `switchBootSource`, one level down and for the same reason:
 * "exactly one of imageRef/pvcRef/blank" is a webhook rule on a webhook that is
 * off, so the form makes the violation inexpressible instead of validating it
 * after the fact. `attachAsDisk` goes with the PVC it belonged to, because
 * upstream accepts it on nothing else.
 */
export function setDataDiskSource(values: GuestFormValues, id: string, source: GuestDataDiskSource): GuestFormValues {
  return {
    ...values,
    dataDisks: values.dataDisks.map((row) =>
      row.id === id
        ? {
            ...row,
            source,
            image: source === "image" ? row.image : "",
            pvc: source === "pvc" ? row.pvc : "",
            blankSize: source === "blank" ? row.blankSize : "",
            blankStorageClass: source === "blank" ? row.blankStorageClass : "",
            blankVolumeMode: source === "blank" ? row.blankVolumeMode : "",
            attachAsDisk: source === "pvc" ? row.attachAsDisk : false,
          }
        : row,
    ),
  };
}

/** Whether `attachAsDisk` is offered at all on this row: upstream accepts it on a PVC only. */
export function attachAsDiskApplies(row: GuestDataDiskRow): boolean {
  return row.source === "pvc";
}

/** What stands where the `attachAsDisk` checkbox would be on the other two sources (W12). */
export function attachAsDiskDroppedFact(source: GuestDataDiskSource): string {
  return source === "image"
    ? "An image-backed data disk is always attached as a raw VM disk, so there is nothing to choose here: attachAsDisk exists for the PVC case, where the default is a filesystem directory in the launcher pod instead."
    : "A blank data disk is always attached as a raw VM disk, so there is nothing to choose here: attachAsDisk exists for the PVC case alone.";
}

/** The fields a data-disk row can carry a message on. */
export type GuestDataDiskField =
  | "name"
  | "source"
  | "image"
  | "pvc"
  | "blankSize"
  | "blankStorageClass"
  | "attachAsDisk";

/** One message per field of one row, absent when the field has nothing to say. */
export type GuestDataDiskMessages = Partial<Record<GuestDataDiskField, string>>;

/** How the submit-disabled sentence names each field of a data-disk row. */
export const guestDataDiskFieldLabels: Record<GuestDataDiskField, string> = {
  name: "Name",
  source: "Source",
  image: "Image",
  pvc: "PVC",
  blankSize: "Size",
  blankStorageClass: "Storage class",
  attachAsDisk: "Attach as disk",
};

/** The order the submit-disabled sentence reports a data-disk row's first problem in. */
const dataDiskFieldOrder: GuestDataDiskField[] = [
  "name",
  "source",
  "image",
  "pvc",
  "blankSize",
  "blankStorageClass",
  "attachAsDisk",
];

/**
 * The line the data disks header carries, open or shut.
 *
 * DESIGN.md section 12 lets a section ship collapsed only when what it hides is
 * a consequence rather than a value, AND that consequence is stated on the
 * header line - so this sentence is what makes the section legal, not
 * decoration.
 */
export function dataDisksSectionHint(values: GuestFormValues): string {
  const count = values.dataDisks.length;

  if (count === 0) {
    return (
      "None. A data disk is a second disk beside the root one: a clone of a SwiftImage, an existing PVC, or a blank " +
      `volume the controller creates. At most ${maxDataDisks}.`
    );
  }

  return (
    `${count} ${count === 1 ? "disk" : "disks"}. Image-backed and blank disks become PVCs owned by this guest, so ` +
    "they are deleted with it; an attached PVC is not, and outlives the guest."
  );
}

/** The line the network header carries, open or shut. */
export function networkSectionHint(values: GuestFormValues): string {
  const ports = values.ports.length;
  const nics = values.interfaces.length;
  const exposure = declaredExposure(values);
  const parts: string[] = [`${values.networkBinding} binding`];

  if (ports > 0) {
    parts.push(`${ports} ${ports === 1 ? "port" : "ports"}`);
  }

  if (nics > 0) {
    parts.push(`${nics} additional ${nics === 1 ? "interface" : "interfaces"}`);
  }

  const service =
    values.networkBinding === "bridge"
      ? "No per-guest Service is created under a bridge binding."
      : exposure
        ? `A per-guest Service of type ${exposure} is created for the exposed ports.`
        : "No Service is created until a port asks to be exposed.";

  return `${parts.join(", ")}. ${service}`;
}

/** The line the GPU header carries, open or shut. */
export function gpuSectionHint(inputs: GuestCreateInputs, values: GuestFormValues): string {
  const guard = guestGpuGuard(inputs, values);

  if (!guard.enabled) {
    return guard.reason;
  }

  if (values.gpuBackend === "none") {
    return "None. A GPU is passed through to the guest whole, and the guest waits in Pending until one is free.";
  }

  return `${guestGpuBackendLabels[values.gpuBackend]}. ${gpuParksInPendingFact}`;
}

/** The PVC a row is pointing at, when the read returned it. */
export function pickedPvc(inputs: GuestCreateInputs, row: GuestDataDiskRow): GuestPvcFacts | undefined {
  const name = row.pvc.trim();

  return name ? inputs.pvcs.find((pvc) => pvc.name === name) : undefined;
}

/** Which of the three sources this row names, counted rather than assumed. */
function namedDataDiskSources(row: GuestDataDiskRow): GuestDataDiskSource[] {
  const named: GuestDataDiskSource[] = [];

  if (row.image.trim()) {
    named.push("image");
  }

  if (row.pvc.trim()) {
    named.push("pvc");
  }

  if (row.blankSize.trim()) {
    named.push("blank");
  }

  return named;
}

/** How the source of a data disk reads in the sentences about it. */
export const guestDataDiskSourceLabels: Record<GuestDataDiskSource, string> = {
  image: "a SwiftImage",
  pvc: "an existing PVC",
  blank: "a blank disk",
};

/**
 * Everything that would make a data disk wrong, one message set per row.
 *
 * The blocking half of the section. Every rule here is one upstream states in a
 * webhook nobody has enabled, so the alternative to this function is a guest
 * that is stored, admitted and then quietly missing a disk.
 */
export function dataDiskErrors(inputs: GuestCreateInputs, values: GuestFormValues): GuestDataDiskMessages[] {
  const names = values.dataDisks.map((row) => row.name.trim());

  return values.dataDisks.map((row) => {
    const messages: GuestDataDiskMessages = {};
    const name = row.name.trim();

    if (!name) {
      messages.name =
        "A data disk needs a name: it is what the guest's volume and the host device path are built from " +
        "(/dev/kubeswift-data-<name>).";
    } else if (name.length > maxDataDiskNameLength) {
      messages.name =
        `A data disk name is at most ${maxDataDiskNameLength} characters; this one is ${name.length}. The cap is ` +
        "the schema's own, and it is shorter than a DNS label because the name becomes part of a device path.";
    } else if (!dnsLabelPattern.test(name)) {
      messages.name =
        "A data disk name is lowercase letters, digits and '-', starting and ending with a letter or a digit: it is " +
        "a DNS label, and it becomes the guest's volume name.";
    } else if (names.filter((candidate) => candidate === name).length > 1) {
      messages.name =
        `Two data disks are named ${name}. The names have to differ: they are what the volumes and the device paths ` +
        "inside the guest are built from, and upstream refuses the collision in a webhook that ships disabled.";
    }

    const named = namedDataDiskSources(row);

    if (named.length > 1) {
      const listed = named.map((source) => guestDataDiskSourceLabels[source]);

      messages.source =
        "A data disk is exactly one of an image, an existing PVC or a blank size; this one names " +
        `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}. Upstream refuses more than one in a ` +
        "webhook that ships disabled, and the controller would pick one of them without saying which.";
    } else if (named.length === 0) {
      if (row.source === "image") {
        messages.image =
          "Name the SwiftImage this disk is cloned from. The controller clones it into a PVC of this guest and " +
          "attaches it as a raw VM disk.";
      } else if (row.source === "pvc") {
        messages.pvc =
          "Name the PersistentVolumeClaim this disk attaches. It has to exist already: the controller attaches it, " +
          "it does not create it.";
      } else {
        messages.blankSize =
          "Give the blank disk a size, for example 100Gi. It is the one field a blank disk requires, and the " +
          "controller creates a PVC of this guest for it.";
      }
    }

    const blankSize = row.blankSize.trim();

    if (blankSize && !quantityPattern.test(blankSize)) {
      messages.blankSize =
        "A size is a Kubernetes quantity, for example 100Gi, 10G or 1Ti. The API server refuses anything else " +
        "outright, because the pattern is in the CRD.";
    } else if (blankSize && !isPositiveQuantity(blankSize)) {
      messages.blankSize = "A blank disk has to be larger than zero: upstream refuses a size that is not.";
    }

    const storageClass = row.blankStorageClass.trim();

    if (storageClass && !dnsSubdomainPattern.test(storageClass)) {
      messages.blankStorageClass =
        "A StorageClass name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit.";
    }

    if (row.attachAsDisk && row.source !== "pvc") {
      messages.attachAsDisk =
        `attachAsDisk only applies to a PVC: ${row.source === "image" ? "an image-backed" : "a blank"} disk is ` +
        "attached as a raw VM disk anyway. Upstream refuses the combination in a webhook that ships disabled.";
    } else if (row.attachAsDisk) {
      const pvc = pickedPvc(inputs, row);

      // A claim that DECLARES another mode is a refusal; one that declares none
      // is a warning, because the claim may still have been provisioned as a
      // Block one and a client-side guess must not block a create the API
      // server would accept (W12).
      if (pvc?.volumeMode !== undefined && pvc.volumeMode !== attachAsDiskVolumeMode) {
        messages.attachAsDisk =
          `The claim ${pvc.name} is ${pvc.volumeMode}, and attaching it as a raw VM disk needs a ` +
          `${attachAsDiskVolumeMode} claim: a Filesystem claim is a directory, and there is no device to hand to the ` +
          `guest. Leave it off to mount it in the launcher pod instead, or attach a ${attachAsDiskVolumeMode} claim.`;
      }
    }

    return messages;
  });
}

/** Whether a quantity is greater than zero, which the CRD's pattern does not say. */
function isPositiveQuantity(value: string): boolean {
  const digits = value.replace(/^[+-]/, "").match(/^[0-9]*\.?[0-9]*/)?.[0] ?? "";

  return !value.startsWith("-") && Number.parseFloat(digits) > 0;
}

/**
 * Everything worth saying about a data disk that would still be accepted.
 *
 * The `attachAsDisk` rule has a warning branch as well as an error one, and the
 * split is the point: the volume mode of a claim this form did not create is a
 * fact of an object the user may not be allowed to read, and a read that was
 * refused must never block a write the API server would accept (W12).
 */
export function dataDiskWarnings(inputs: GuestCreateInputs, values: GuestFormValues): GuestDataDiskMessages[] {
  return values.dataDisks.map((row) => {
    const messages: GuestDataDiskMessages = {};
    const image = row.image.trim();

    if (row.source === "image" && image) {
      const picked = inputs.images.find((candidate) => candidate.name === image);

      if (!picked) {
        messages.image = inputs.imagesUnverified
          ? `The SwiftImages of this namespace could not be listed, so ${image} is not verified: whether it exists, ` +
            "and whether it is Ready, are unknown from here."
          : `No SwiftImage named ${image} is in this namespace. Upstream needs a Ready image to clone a data disk ` +
            "from, so the guest waits, Resolved=False, until one exists.";
      } else if (picked.phase !== readyImagePhase) {
        messages.image =
          `The image ${image} ${picked.phase ? `is ${picked.phase}` : "has not reported a phase yet"}, not ` +
          `${readyImagePhase}: upstream clones a data disk from a Ready image only, so this guest waits for it the ` +
          "same way it would wait for a boot image.";
      }
    }

    const pvcName = row.pvc.trim();

    if (row.source === "pvc" && pvcName) {
      const pvc = pickedPvc(inputs, row);

      if (!pvc) {
        messages.pvc = inputs.pvcsUnverified
          ? `The PersistentVolumeClaims of this namespace could not be listed, so ${pvcName} is not verified: ` +
            "whether it exists, and whether it is a Block claim, are unknown from here." +
            (row.attachAsDisk
              ? ` Attaching it as a raw VM disk needs a ${attachAsDiskVolumeMode} claim, and this form cannot check ` +
                "that from here."
              : "")
          : `No PersistentVolumeClaim named ${pvcName} is in this namespace. The controller attaches an existing ` +
            "claim rather than creating one, so the guest waits until it exists.";
      } else if (row.attachAsDisk && pvc.volumeMode === undefined) {
        messages.attachAsDisk =
          `The claim ${pvc.name} declares no volumeMode, so whether it can be attached as a raw VM disk is not ` +
          `verifiable from here: upstream needs a ${attachAsDiskVolumeMode} claim. This warns rather than blocks, ` +
          "because a claim that says nothing may still have been provisioned as one.";
      }
    }

    return messages;
  });
}

/** What one data disk does, for the write summary. */
export function dataDiskSummaryNote(inputs: GuestCreateInputs, row: GuestDataDiskRow): string | undefined {
  const name = row.name.trim();

  if (!name) {
    return undefined;
  }

  if (row.source === "image") {
    const image = row.image.trim();

    return image
      ? `Data disk ${name}: the image ${image} is cloned into a PVC of this guest and attached as a raw VM disk.`
      : undefined;
  }

  if (row.source === "pvc") {
    const pvc = row.pvc.trim();

    if (!pvc) {
      return undefined;
    }

    const facts = pickedPvc(inputs, row);
    const mode = facts?.volumeMode ? ` (${facts.volumeMode})` : "";

    return row.attachAsDisk
      ? `Data disk ${name}: the existing claim ${pvc}${mode} is attached to the guest as a raw VM block disk.`
      : `Data disk ${name}: the existing claim ${pvc}${mode} is mounted as a filesystem directory in the launcher ` +
          "pod, not as a disk the guest sees. Tick attachAsDisk to hand it to the guest as a device.";
  }

  const size = row.blankSize.trim();

  if (!size) {
    return undefined;
  }

  const volumeMode = row.blankVolumeMode.trim() || defaultBlankVolumeMode;
  const storageClass = row.blankStorageClass.trim();

  return (
    `Data disk ${name}: a blank ${size} ${volumeMode} PVC of this guest is created ` +
    `${storageClass ? `on the storage class ${storageClass}` : "on the cluster's default storage class"} and ` +
    "attached as a disk. It arrives unformatted - the guest partitions it."
  );
}

// ---------------------------------------------------------------------------
// Section 9: network binding, ports and additional interfaces.
//
// The same webhook-only territory, with a sharper failure mode: the controller
// does not refuse a bad `expose` mix, it mints a Service of the wrong type, and
// it does not refuse `expose` under a bridge binding, it mints no Service at
// all and says nothing. Both are silent, both survive a `kubectl get`, and both
// are the kind of thing an operator finds out about from a user.
// ---------------------------------------------------------------------------

/** What each binding does to the primary interface, in one sentence apiece. */
export function networkBindingDescription(binding: SwiftGuestNetworkBinding): string {
  return binding === "bridge"
    ? "The primary NIC rides a multi-node L2 network (a Multus NAD), so the guest keeps a portable IP. Ports are " +
        "not DNAT'd through the pod IP and upstream refuses expose entirely: no per-guest Service is created."
    : "The VM sits behind the pod IP, and each port below installs an in-pod DNAT from the pod to the guest. This " +
        "is the only binding under which a port can ask for a Service.";
}

/** A port row as the section adds it: TCP, unexposed, and nothing filled in. */
export function newPortRow(id: string): GuestPortRow {
  return { id, port: "", name: "", targetPort: "", protocol: defaultPortProtocol, expose: "" };
}

/** The form with one more port row. */
export function addPort(values: GuestFormValues): GuestFormValues {
  return { ...values, ports: [...values.ports, newPortRow(nextRowId("port", values.ports))] };
}

/** The form without the named port row. */
export function removePort(values: GuestFormValues, id: string): GuestFormValues {
  return { ...values, ports: values.ports.filter((row) => row.id !== id) };
}

/** The form with one field of one port row changed. */
export function updatePort(values: GuestFormValues, id: string, patch: Partial<GuestPortRow>): GuestFormValues {
  return { ...values, ports: values.ports.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/** The fields a port row can carry a message on. */
export type GuestPortField = "port" | "name" | "targetPort" | "protocol" | "expose";

/** One message per field of one port row. */
export type GuestPortMessages = Partial<Record<GuestPortField, string>>;

/** How the submit-disabled sentence names each field of a port row. */
export const guestPortFieldLabels: Record<GuestPortField, string> = {
  port: "Port",
  name: "Name",
  targetPort: "Target port",
  protocol: "Protocol",
  expose: "Expose",
};

const portFieldOrder: GuestPortField[] = ["port", "name", "targetPort", "protocol", "expose"];

/** The expose value every exposed port has to share: the first one that names it. */
export function declaredExposure(values: GuestFormValues): string | undefined {
  return values.ports.map((row) => row.expose.trim()).find((expose) => expose !== "");
}

/** Whether a port number is what the schema accepts, and nothing else. */
function portNumberError(value: string, label: string): string | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return `${label} is a whole number: the schema declares it as an int32 and the API server refuses anything else.`;
  }

  const port = Number.parseInt(value, 10);

  if (port < minPortNumber || port > maxPortNumber) {
    return `${label} is between ${minPortNumber} and ${maxPortNumber}; this one is ${port}. The bounds are the CRD's own.`;
  }

  return undefined;
}

/**
 * Everything that would make a port wrong, one message set per row.
 *
 * Four of the five rules are the webhook's and the fifth is the schema's, and
 * the difference is worth keeping: a port outside 1-65535 is refused by the API
 * server with a message, while a second port without a name, a mixed `expose`
 * and an `expose` under a bridge binding are all accepted in silence.
 */
export function portErrors(values: GuestFormValues): GuestPortMessages[] {
  const names = values.ports.map((row) => row.name.trim());
  const exposure = declaredExposure(values);
  const bridge = values.networkBinding === "bridge";

  return values.ports.map((row, index) => {
    const messages: GuestPortMessages = {};
    const port = row.port.trim();
    const name = row.name.trim();
    const targetPort = row.targetPort.trim();
    const expose = row.expose.trim();

    if (!port) {
      messages.port = "A port is required: it is the only field of a port the schema requires.";
    } else {
      const error = portNumberError(port, "A port");

      if (error) {
        messages.port = error;
      }
    }

    if (!name && values.ports.length > 1) {
      messages.name =
        `A name is required once a guest declares more than one port: it becomes the port's name on the Service ` +
        "the controller mints, and Kubernetes refuses a multi-port Service whose ports are unnamed. Upstream " +
        "enforces it in a webhook that ships disabled.";
    } else if (name && !dnsLabelPattern.test(name)) {
      messages.name =
        "A port name is lowercase letters, digits and '-', starting and ending with a letter or a digit: it is a " +
        "DNS label, and it becomes the name of a port on the guest's own Service.";
    } else if (name && names.filter((candidate) => candidate === name).length > 1) {
      messages.name = `Two ports are named ${name}. A Service cannot carry two ports with one name.`;
    }

    if (targetPort) {
      const error = portNumberError(targetPort, "A target port");

      if (error) {
        messages.targetPort = error;
      }
    }

    const duplicate = values.ports.findIndex(
      (candidate) => candidate.port.trim() === port && candidate.protocol === row.protocol,
    );

    if (port && duplicate !== -1 && duplicate < index) {
      messages.port =
        `Port ${port}/${row.protocol} is declared twice. Upstream refuses the duplicate in a webhook that ships ` +
        "disabled, and a Service with two identical ports is refused by Kubernetes itself.";
    }

    if (expose && bridge) {
      messages.expose =
        "A bridge-bound guest exposes nothing: its ports reach the network's own IP rather than the pod IP, so " +
        "upstream " +
        "rejects expose for the bridge binding - and on an install whose webhook is off it simply mints no Service " +
        "and reports no error. The same rule applies to a guest whose primary interface is an sriov one.";
    } else if (expose && exposure && expose !== exposure) {
      messages.expose =
        `All exposed ports share ONE per-guest Service, so they have to ask for one type: this port asks for ` +
        `${expose} while another asks for ${exposure}. Upstream refuses the mix in a webhook that ships disabled, ` +
        "and the controller silently mints a Service of whichever type it read first.";
    }

    return messages;
  });
}

/**
 * Everything worth saying about a port that would still be accepted.
 *
 * The partial-exposure line is the one that matters: a guest with three ports
 * of which two are exposed is a legitimate configuration - the third is
 * reachable pod-to-VM through the DNAT and is simply not on the Service - and
 * it is also exactly what a half-finished form looks like.
 */
export function portWarnings(values: GuestFormValues): GuestPortMessages[] {
  const exposure = declaredExposure(values);
  const exposed = values.ports.filter((row) => row.expose.trim() !== "").length;

  return values.ports.map((row) => {
    const messages: GuestPortMessages = {};
    const name = row.name.trim();

    if (name && (name.length > maxServicePortNameLength || !/[a-z]/.test(name))) {
      messages.name =
        `Kubernetes caps a Service port name at ${maxServicePortNameLength} characters and requires at least one ` +
        "letter in it. Upstream calls this field a DNS label and does not check either rule, so a longer name is " +
        "stored here and refused later, by the API server, on the Service the controller mints.";
    }

    if (exposure && exposed < values.ports.length && row.expose.trim() === "") {
      messages.expose =
        `This port is not on the Service: only the ports that name a type are, and the others stay reachable ` +
        "pod-to-VM through the in-pod DNAT alone. That is a legitimate configuration and this is a reminder, not a " +
        "refusal.";
    }

    return messages;
  });
}

/** An interface row as the section adds it: a bridge NIC with nothing filled in. */
export function newInterfaceRow(id: string): GuestInterfaceRow {
  return { id, name: "", networkName: "", networkNamespace: "", primary: false, mac: "" };
}

/** The form with one more interface row. */
export function addInterface(values: GuestFormValues): GuestFormValues {
  return { ...values, interfaces: [...values.interfaces, newInterfaceRow(nextRowId("nic", values.interfaces))] };
}

/** The form without the named interface row. */
export function removeInterface(values: GuestFormValues, id: string): GuestFormValues {
  return { ...values, interfaces: values.interfaces.filter((row) => row.id !== id) };
}

/** The form with one field of one interface row changed. */
export function updateInterface(
  values: GuestFormValues,
  id: string,
  patch: Partial<GuestInterfaceRow>,
): GuestFormValues {
  return { ...values, interfaces: values.interfaces.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/** The fields an interface row can carry a message on. */
export type GuestInterfaceField = "name" | "networkName" | "networkNamespace" | "primary" | "mac";

/** One message per field of one interface row. */
export type GuestInterfaceMessages = Partial<Record<GuestInterfaceField, string>>;

/** How the submit-disabled sentence names each field of an interface row. */
export const guestInterfaceFieldLabels: Record<GuestInterfaceField, string> = {
  name: "Name",
  networkName: "Network",
  networkNamespace: "Network namespace",
  primary: "Primary",
  mac: "MAC address",
};

const interfaceFieldOrder: GuestInterfaceField[] = ["name", "networkName", "networkNamespace", "primary", "mac"];

/**
 * Everything that would make an additional interface wrong.
 *
 * The MAC rule is the one with teeth: its pattern is in the schema, and
 * upstream's own comment says why - the value is written into a shell env file
 * the launcher sources, so an unconstrained one would execute in a privileged
 * container. The API server refuses it; this says so before the create does.
 */
export function interfaceErrors(values: GuestFormValues): GuestInterfaceMessages[] {
  const names = values.interfaces.map((row) => row.name.trim());
  const primaries = values.interfaces.filter((row) => row.primary).length;

  return values.interfaces.map((row) => {
    const messages: GuestInterfaceMessages = {};
    const name = row.name.trim();
    const networkName = row.networkName.trim();
    const networkNamespace = row.networkNamespace.trim();
    const mac = row.mac.trim();

    if (!name) {
      messages.name =
        "An interface needs a name: the schema requires it, and the guest's status reports each NIC by it.";
    } else if (!dnsLabelPattern.test(name)) {
      messages.name =
        "An interface name is lowercase letters, digits and '-', starting and ending with a letter or a digit.";
    } else if (names.filter((candidate) => candidate === name).length > 1) {
      messages.name = `Two interfaces are named ${name}. The names identify the NICs in the guest's own status.`;
    }

    if (networkName && !dnsSubdomainPattern.test(networkName)) {
      messages.networkName =
        "A NetworkAttachmentDefinition name is lowercase letters, digits, '-' and '.', starting and ending with a " +
        "letter or a digit.";
    }

    if (networkNamespace && !networkName) {
      messages.networkNamespace =
        "A namespace without a network name points at nothing. Name the NetworkAttachmentDefinition, or clear the " +
        "namespace to leave this a node-local tap+bridge interface.";
    } else if (networkNamespace && !dnsLabelPattern.test(networkNamespace)) {
      messages.networkNamespace =
        "A namespace is lowercase letters, digits and '-', starting and ending with a letter or a digit.";
    }

    if (row.primary && primaries > 1) {
      messages.primary =
        `At most one interface may be the primary, and ${primaries} are marked. Upstream refuses more than one in a ` +
        "webhook that ships disabled; with none marked, the first interface without a network reference is the " +
        "primary, which is the behaviour a guest gets anyway.";
    }

    if (mac && !macAddressPattern.test(mac)) {
      messages.mac =
        "A MAC address is six colon-separated hex pairs, for example 52:54:00:12:34:56. The pattern is in the CRD, " +
        "and it is a security boundary rather than a formality: upstream writes the value into a shell file the " +
        "privileged launcher sources.";
    }

    return messages;
  });
}

/** Everything worth saying about an interface that would still be accepted. */
export function interfaceWarnings(values: GuestFormValues): GuestInterfaceMessages[] {
  return values.interfaces.map((row) => {
    const messages: GuestInterfaceMessages = {};

    if (row.primary && row.networkName.trim()) {
      messages.primary =
        "Marking a network-backed interface as the primary is upstream's own attestation that the network really is " +
        "a multi-node L2: the guest's IP then comes from the network's IPAM instead of the node-local bridge, and " +
        "the SwiftMigration webhook treats the guest as IP-preserving on that basis.";
    }

    return messages;
  });
}

/** What this form does not offer on an interface, named rather than silently absent (G1). */
export const interfaceTypesFact =
  `Additional interfaces are ${defaultInterfaceType} type here - a tap and a bridge, virtio-net inside the guest. ` +
  "The sriov and vhost-user types need a device-plugin resource name or a node-local socket path, and they live in " +
  "the YAML editor with the other excluded fields.";

/** What the binding and the ports below apply to, which is not every NIC of the guest. */
export const primaryInterfaceFact =
  "The binding and the ports apply to the guest's PRIMARY interface. Any additional interface below is a secondary " +
  "NIC, and nothing here exposes one.";

// ---------------------------------------------------------------------------
// Section 10: the GPU, behind `guestGpuGuard`.
//
// Two backends that do the same thing by opposite routes: the native one, where
// the SwiftGPU controller picks the node and the devices before the pod exists,
// and the DRA one, where a resource claim rides on the pod and the scheduler
// allocates the device. Exactly one, and a guest that has neither is the normal
// case rather than an unfinished one.
// ---------------------------------------------------------------------------

/** How the two backends read, in the control and in the sentences about them. */
export const guestGpuBackendLabels: Record<GuestGpuBackend, string> = {
  none: "No GPU",
  profile: "SwiftGPUProfile (native allocation)",
  claim: "Resource claim (DRA)",
};

/** What choosing each backend means, in one line apiece. */
export function guestGpuBackendDescription(backend: GuestGpuBackend): string {
  switch (backend) {
    case "profile":
      return (
        "The SwiftGPU controller finds a node with free devices and allocates them before the launcher pod is " +
        "created, from the profile's own request (count, model, tier)."
      );
    case "claim":
      return (
        "The launcher pod carries a ResourceClaim, and the Kubernetes scheduler with a DRA driver allocates the " +
        "device at schedule time; the controller reads the result back and passes it into the VM."
      );
    default:
      return "The guest gets no GPU, which is what almost every guest wants.";
  }
}

/** The backends the control offers, in the order it offers them. */
export const guestGpuBackends: GuestGpuBackend[] = ["none", "profile", "claim"];

/**
 * Moves the GPU section to another backend, emptying the one it leaves.
 *
 * `gpuProfileRef` and `gpuResourceClaim` are mutually exclusive in upstream's
 * own words, and nothing enforces it: the same shape as the boot source, so the
 * violation is made inexpressible rather than validated.
 */
export function setGpuBackend(values: GuestFormValues, backend: GuestGpuBackend): GuestFormValues {
  return {
    ...values,
    gpuBackend: backend,
    gpuProfile: backend === "profile" ? values.gpuProfile : "",
    gpuClaimName: backend === "claim" ? values.gpuClaimName : "",
    gpuClaimTemplateName: backend === "claim" ? values.gpuClaimTemplateName : "",
    gpuRequestName: backend === "claim" ? values.gpuRequestName : "",
    gpuTier: backend === "claim" ? values.gpuTier : defaultGpuTier,
    gpuHugepages: backend === "claim" ? values.gpuHugepages : "",
  };
}

/** One option of the GPU profile picker, with the request it carries. */
export interface GuestGpuProfileChoice {
  name: string;
  label: string;
  facts: GuestGpuProfileFacts;
}

/** The request a profile makes, in one short line, for the option label. */
export function gpuProfileSummary(profile: GuestGpuProfileFacts): string {
  const parts: string[] = [];

  if (profile.count !== undefined) {
    parts.push(`${profile.count} ${profile.count === 1 ? "GPU" : "GPUs"}`);
  }

  // The empty string is the schema's way of saying "any model matches", which
  // is a fact rather than a missing value - the same reading the M3 list uses.
  if (profile.model) {
    parts.push(profile.model);
  } else if (profile.model === "") {
    parts.push("any model");
  }

  if (profile.tier) {
    parts.push(profile.tier);
  }

  return parts.join(", ");
}

/**
 * The profiles the picker offers: every SwiftGPUProfile of the namespace.
 *
 * Nothing is filtered and nothing is dimmed, and that is a fact of the CRD
 * rather than a choice: a SwiftGPUProfile has no status at all (SPEC-0007), so
 * there is no readiness to show and no state that could make one unchoosable.
 * What the option carries instead is the request itself.
 */
export function gpuProfileChoices(inputs: GuestCreateInputs): GuestGpuProfileChoice[] {
  return inputs.gpuProfiles.map((profile) => {
    const summary = gpuProfileSummary(profile);

    return { name: profile.name, label: summary ? `${profile.name} - ${summary}` : profile.name, facts: profile };
  });
}

/** The GPU profile the form is pointing at, when the read returned it. */
export function pickedGpuProfile(inputs: GuestCreateInputs, values: GuestFormValues): GuestGpuProfileFacts | undefined {
  const name = values.gpuProfile.trim();

  return name ? inputs.gpuProfiles.find((profile) => profile.name === name) : undefined;
}

/** The fields the GPU section can carry a message on. */
export type GuestGpuField = "profile" | "claimName" | "claimTemplateName" | "requestName" | "hugepages";

/** One message per field of the GPU section. */
export type GuestGpuMessages = Partial<Record<GuestGpuField, string>>;

/** How the submit-disabled sentence names each GPU field. */
export const guestGpuFieldLabels: Record<GuestGpuField, string> = {
  profile: "GPU profile",
  claimName: "Resource claim",
  claimTemplateName: "Resource claim template",
  requestName: "Request name",
  hugepages: "Hugepages",
};

const gpuFieldOrder: GuestGpuField[] = ["profile", "claimName", "claimTemplateName", "requestName", "hugepages"];

/**
 * Everything that would make the GPU section wrong.
 *
 * Empty whenever the guard refuses, because a section that is not rendered
 * cannot block a submit: the reason the guard gives is what stands in its
 * place, and the payload emits nothing for it either.
 */
export function gpuErrors(inputs: GuestCreateInputs, values: GuestFormValues): GuestGpuMessages {
  const messages: GuestGpuMessages = {};

  if (!guestGpuGuard(inputs, values).enabled || values.gpuBackend === "none") {
    return messages;
  }

  if (values.gpuBackend === "profile") {
    if (!values.gpuProfile.trim()) {
      messages.profile =
        "Name the SwiftGPUProfile this guest asks for: it is what says how many GPUs, of which model and in which " +
        "tier, and the allocation cannot start without it.";
    }

    return messages;
  }

  const claimName = values.gpuClaimName.trim();
  const templateName = values.gpuClaimTemplateName.trim();

  if (claimName && templateName) {
    messages.claimName =
      "A DRA claim is either a pre-created ResourceClaim or a ResourceClaimTemplate the scheduler mints one from, " +
      "never both: upstream declares the two mutually exclusive and enforces it in a webhook that ships disabled.";
    messages.claimTemplateName = messages.claimName;
  } else if (!claimName && !templateName) {
    messages.claimName =
      "Name a ResourceClaim to share, or a ResourceClaimTemplate for a claim of this guest's own. A DRA backend " +
      "with neither allocates nothing.";
  }

  const hugepages = values.gpuHugepages.trim();

  if (hugepages && !quantityPattern.test(hugepages)) {
    messages.hugepages =
      "Hugepages is a size, for example 1Gi or 2Mi. Leave it empty for none - most GPU workloads want 1Gi.";
  }

  const requestName = values.gpuRequestName.trim();

  if (requestName && !dnsLabelPattern.test(requestName)) {
    messages.requestName =
      "A request name is lowercase letters, digits and '-', starting and ending with a letter or a digit: it names " +
      "one device request inside the claim.";
  }

  return messages;
}

/** Everything worth saying about the GPU section that would still be accepted. */
export function gpuWarnings(inputs: GuestCreateInputs, values: GuestFormValues): GuestGpuMessages {
  const messages: GuestGpuMessages = {};

  if (!guestGpuGuard(inputs, values).enabled || values.gpuBackend !== "profile") {
    return messages;
  }

  const named = values.gpuProfile.trim();

  if (named && !pickedGpuProfile(inputs, values)) {
    messages.profile = inputs.gpuProfilesUnverified
      ? `The SwiftGPUProfiles of this namespace could not be listed, so ${named} is not verified: how many GPUs it ` +
        "asks for, and of which tier, are unknown from here."
      : `No SwiftGPUProfile named ${named} is in the namespace ${values.namespace || "of this guest"}. A guest whose ` +
        "profile cannot be resolved parks in Pending on GPUAllocated rather than failing.";
  }

  return messages;
}

/**
 * Whether this guest really asks for a GPU through the native backend.
 *
 * The guard is consulted as well as the backend, because a Windows image turns
 * the whole section off without touching the values it holds: the answer has to
 * be "what will be sent", not "what the control says".
 */
export function usesNativeGpuProfile(inputs: GuestCreateInputs, values: GuestFormValues): boolean {
  return (
    guestGpuGuard(inputs, values).enabled && values.gpuBackend === "profile" && values.gpuProfile.trim().length > 0
  );
}

/** What the request name defaults to when the claim does not name one. */
export const defaultGpuRequestName = "gpu";

/** What a GPU costs this guest at create time, which is a wait rather than a failure. */
export const gpuParksInPendingFact =
  "A GPU is allocated before the launcher pod is created, so a guest whose devices are not available yet parks in " +
  "Pending on its GPUAllocated condition instead of failing. It starts by itself once a node has the devices this " +
  "asks for - and it stays parked, without an error, for as long as none does.";

/** Why a node pin and a native GPU profile disagree, which upstream states and nothing shows. */
export const gpuNodePinWarning =
  "This guest is pinned to a node AND asks for a native GPU profile. Upstream requires the pin to name the node its " +
  "GPU controller allocated on, and the two are decided independently: the validating webhook refuses the pair when " +
  "they disagree, and with the webhook off the pod builder refuses to build the pod and reports Resolved=False. " +
  "Leave the pin empty and let the allocation choose the node, unless the node is known to be the one that has the " +
  "devices.";

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
  } else if (nodeName && nodePinApplies(values.bootSource) && usesNativeGpuProfile(inputs, values)) {
    // Upstream states this one in the `nodeName` field's own documentation and
    // enforces it nowhere an operator can see: the GPU controller picks the
    // node from the devices it finds, and a pin that names another node makes
    // the pod builder refuse to build with Resolved=False. Not a block: the
    // operator may know which node holds the devices.
    warnings.nodeName = gpuNodePinWarning;
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
  const [first] = guestCreateBlockingIssues(inputs, values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface GuestCreateBlockingIssue {
  /** How the field reads in the sentence, including which row it belongs to. */
  label: string;
  message: string;
}

/**
 * Every reason the form cannot be submitted, in the reading order of the form.
 *
 * The flat fields first, then the three repeatable sections row by row, then
 * the GPU: a sentence that pointed at the fifth data disk while the namespace
 * was still empty would be pointing past the first thing the user has to fix.
 * The row labels carry the row's number, because "Name" alone means nothing on
 * a form with three data disks and two ports.
 */
export function guestCreateBlockingIssues(
  inputs: GuestCreateInputs,
  values: GuestFormValues,
): GuestCreateBlockingIssue[] {
  const issues: GuestCreateBlockingIssue[] = [];
  const errors = guestCreateErrors(inputs, values);

  for (const field of fieldOrder) {
    const message = errors[field];

    if (message) {
      issues.push({ label: guestCreateFieldLabels[field], message });
    }
  }

  dataDiskErrors(inputs, values).forEach((messages, index) => {
    for (const field of dataDiskFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Data disk ${index + 1} ${guestDataDiskFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  portErrors(values).forEach((messages, index) => {
    for (const field of portFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Port ${index + 1} ${guestPortFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  interfaceErrors(values).forEach((messages, index) => {
    for (const field of interfaceFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Interface ${index + 1} ${guestInterfaceFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  const gpu = gpuErrors(inputs, values);

  for (const field of gpuFieldOrder) {
    const message = gpu[field];

    if (message) {
      issues.push({ label: guestGpuFieldLabels[field], message });
    }
  }

  return issues;
}

/**
 * Whether a collapsed section holds an error, so the dialog can open it.
 *
 * A submit blocked on a field nobody can see is the dead control W4 forbids,
 * and the three sections this slice adds are all collapsed by default
 * (DESIGN.md section 12).
 */
export function dataDisksSectionHasError(inputs: GuestCreateInputs, values: GuestFormValues): boolean {
  return dataDiskErrors(inputs, values).some((messages) => Object.keys(messages).length > 0);
}

/** The same question for the network section, whose errors live on its rows. */
export function networkSectionHasError(values: GuestFormValues): boolean {
  return (
    portErrors(values).some((messages) => Object.keys(messages).length > 0) ||
    interfaceErrors(values).some((messages) => Object.keys(messages).length > 0)
  );
}

/** The same question for the GPU section. */
export function gpuSectionHasError(inputs: GuestCreateInputs, values: GuestFormValues): boolean {
  return Object.keys(gpuErrors(inputs, values)).length > 0;
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
 * The data disks the create sends, or `undefined` when the section is untouched.
 *
 * Exactly the keys each row set, and never the legacy singular `dataDiskRef` -
 * which this list supersedes and which can only carry an image, on the fixed
 * device path `/dev/vdb`. A row without a name or without a source is dropped
 * rather than sent: the submit is blocked on it anyway, and an empty-name
 * reference is the one thing this form never emits (G7).
 */
export function guestDataDiskPayload(values: GuestFormValues): SwiftGuestDataDisk[] | undefined {
  const disks = values.dataDisks
    .map((row) => dataDiskPayload(row))
    .filter((disk): disk is SwiftGuestDataDisk => disk !== undefined);

  return disks.length > 0 ? disks : undefined;
}

/** One data disk, with exactly the keys its own source needs. */
function dataDiskPayload(row: GuestDataDiskRow): SwiftGuestDataDisk | undefined {
  const name = row.name.trim();

  if (!name) {
    return undefined;
  }

  if (row.source === "image") {
    const image = row.image.trim();

    return image ? { name, imageRef: { name: image } } : undefined;
  }

  if (row.source === "pvc") {
    const pvc = row.pvc.trim();

    if (!pvc) {
      return undefined;
    }

    const disk: SwiftGuestDataDisk = { name, pvcRef: { name: pvc } };

    // `false` is the schema's own default and the behaviour a PVC row gets
    // without it, so it is not sent: an explicit false would be this form
    // writing a value the API server would have written anyway.
    if (row.attachAsDisk) {
      disk.attachAsDisk = true;
    }

    return disk;
  }

  const size = row.blankSize.trim();

  if (!size) {
    return undefined;
  }

  const blank: NonNullable<SwiftGuestDataDisk["blank"]> = { size };
  const storageClassName = row.blankStorageClass.trim();
  const volumeMode = row.blankVolumeMode.trim();

  if (storageClassName) {
    blank.storageClassName = storageClassName;
  }

  // Only when it is not the `Block` the API server stamps: a re-sent default is
  // a value this form claims to own and does not.
  if (volumeMode === "Filesystem") {
    blank.volumeMode = volumeMode;
  }

  return { name, blank };
}

/**
 * The network block, or `undefined` when nothing in it was set.
 *
 * `nil preserves today's behavior` in the CRD's own words - nat binding, no
 * Service - so a form that touched nothing sends no `network` at all rather
 * than an empty object. The binding itself is sent only when it is not the
 * `nat` the API server stamps, and a port's protocol only when it is not `TCP`,
 * for the same reason: what the server would write anyway is not this form's to
 * claim.
 */
export function guestNetworkPayload(values: GuestFormValues): SwiftGuestNetwork | undefined {
  const network: SwiftGuestNetwork = {};
  const ports = values.ports
    .map((row) => portPayload(row))
    .filter((port): port is SwiftGuestPort => port !== undefined);

  if (values.networkBinding !== defaultNetworkBinding) {
    network.binding = values.networkBinding;
  }

  if (ports.length > 0) {
    network.ports = ports;
  }

  return Object.keys(network).length > 0 ? network : undefined;
}

/** One port, with exactly the keys the row set. */
function portPayload(row: GuestPortRow): SwiftGuestPort | undefined {
  const port = Number.parseInt(row.port.trim(), 10);

  if (!Number.isFinite(port)) {
    return undefined;
  }

  const payload: SwiftGuestPort = { port };
  const name = row.name.trim();
  const targetPort = Number.parseInt(row.targetPort.trim(), 10);
  const expose = row.expose.trim();

  if (name) {
    payload.name = name;
  }

  if (Number.isFinite(targetPort)) {
    payload.targetPort = targetPort;
  }

  if (row.protocol !== defaultPortProtocol) {
    payload.protocol = row.protocol;
  }

  if (expose === "ClusterIP" || expose === "NodePort" || expose === "LoadBalancer") {
    payload.expose = expose;
  }

  return payload;
}

/**
 * The additional interfaces, or `undefined` when none was added.
 *
 * `type` is never sent: every interface this form builds is a `bridge` one, and
 * that is the value the API server stamps. `primary: false` is not sent either
 * - with nothing marked, upstream makes the first interface without a network
 * reference the primary, which is what an unmarked list means.
 */
export function guestInterfacesPayload(values: GuestFormValues): SwiftGuestInterface[] | undefined {
  const interfaces = values.interfaces
    .map((row) => interfacePayload(row))
    .filter((nic): nic is SwiftGuestInterface => nic !== undefined);

  return interfaces.length > 0 ? interfaces : undefined;
}

/** One interface, with exactly the keys the row set. */
function interfacePayload(row: GuestInterfaceRow): SwiftGuestInterface | undefined {
  const name = row.name.trim();

  if (!name) {
    return undefined;
  }

  const nic: SwiftGuestInterface = { name };
  const networkName = row.networkName.trim();
  const networkNamespace = row.networkNamespace.trim();
  const mac = row.mac.trim();

  if (networkName) {
    nic.networkRef = networkNamespace ? { name: networkName, namespace: networkNamespace } : { name: networkName };
  }

  if (row.primary) {
    nic.primary = true;
  }

  if (mac) {
    nic.mac = mac;
  }

  return nic;
}

/**
 * The GPU half of the spec: the native reference, the DRA claim, or nothing.
 *
 * The guard is what decides, not the control: a Windows image turns the section
 * off without emptying it, and a payload that read the backend alone would send
 * a GPU upstream refuses on a guest whose OS the form itself chose.
 */
export function guestGpuPayload(
  inputs: GuestCreateInputs,
  values: GuestFormValues,
): Pick<SwiftGuestSpec, "gpuProfileRef" | "gpuResourceClaim"> {
  if (!guestGpuGuard(inputs, values).enabled) {
    return {};
  }

  if (values.gpuBackend === "profile") {
    const profile = values.gpuProfile.trim();

    return profile ? { gpuProfileRef: { name: profile } } : {};
  }

  if (values.gpuBackend !== "claim") {
    return {};
  }

  const claimName = values.gpuClaimName.trim();
  const templateName = values.gpuClaimTemplateName.trim();

  if (!claimName && !templateName) {
    return {};
  }

  const claim: SwiftGuestGpuResourceClaim = {};
  const requestName = values.gpuRequestName.trim();
  const hugepages = values.gpuHugepages.trim();

  // Exactly one, which is what upstream declares and nothing enforces. The
  // shared claim wins on a form that somehow holds both, and the submit is
  // blocked on that state anyway.
  if (claimName) {
    claim.resourceClaimName = claimName;
  } else {
    claim.resourceClaimTemplateName = templateName;
  }

  if (requestName) {
    claim.requestName = requestName;
  }

  if (values.gpuTier !== defaultGpuTier) {
    claim.tier = values.gpuTier;
  }

  if (hugepages) {
    claim.hugepages = hugepages;
  }

  return { gpuResourceClaim: claim };
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

  const dataDisks = guestDataDiskPayload(values);
  const network = guestNetworkPayload(values);
  const interfaces = guestInterfacesPayload(values);

  if (dataDisks) {
    spec.dataDiskRefs = dataDisks;
  }

  if (network) {
    spec.network = network;
  }

  if (interfaces) {
    spec.interfaces = interfaces;
  }

  Object.assign(spec, guestGpuPayload(inputs, values));

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

  for (const row of values.dataDisks) {
    const note = dataDiskSummaryNote(inputs, row);

    if (note) {
      notes.push(note);
    }
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

  const serviceNote = serviceSummaryNote(values);

  if (serviceNote) {
    notes.push(serviceNote);
  }

  const interfacesNote = interfacesSummaryNote(values);

  if (interfacesNote) {
    notes.push(interfacesNote);
  }

  const gpuNote = gpuSummaryNote(inputs, values);

  if (gpuNote) {
    notes.push(gpuNote);
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

  // A GPU is the one thing on this form that makes a guest WAIT without failing
  // (G11): the allocation runs before the launcher pod exists, so a guest whose
  // devices are not free parks in Pending and starts by itself later.
  if (values.gpuBackend !== "none" && guestGpuGuard(inputs, values).enabled) {
    warnings.push(gpuParksInPendingFact);
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

  // The GPU profile joins them for the same reason: a profile that could not be
  // verified is a guest that parks in Pending, and the picker is inside a
  // section that ships collapsed.
  const gpuProfileWarning = gpuWarnings(inputs, values).profile;

  if (gpuProfileWarning) {
    warnings.push(gpuProfileWarning);
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

/**
 * What the ports do, which is two different things depending on the binding.
 *
 * The per-guest Service is the one object of this create the operator did not
 * ask for by name, so W1 requires it on its own line - and its absence under a
 * bridge binding is worth the same line, because that is the silent failure the
 * inline rule exists to prevent.
 */
function serviceSummaryNote(values: GuestFormValues): string | undefined {
  const ports = values.ports.filter((row) => row.port.trim() !== "");

  if (ports.length === 0) {
    return undefined;
  }

  const declared = ports
    .map((row) => `${row.port.trim()}/${row.protocol}${row.targetPort.trim() ? ` to ${row.targetPort.trim()}` : ""}`)
    .join(", ");

  if (values.networkBinding === "bridge") {
    return (
      `It declares ${ports.length === 1 ? "one port" : `${ports.length} ports`} (${declared}) on a bridge-bound ` +
      "primary interface: no Service is created and no in-pod DNAT is installed, because the ports reach the " +
      "network's own IP. They are declarable for NetworkPolicy to target."
    );
  }

  const exposure = declaredExposure(values);
  const exposed = ports.filter((row) => row.expose.trim() !== "").length;

  if (!exposure) {
    return (
      `It declares ${ports.length === 1 ? "one port" : `${ports.length} ports`} (${declared}), each installing an ` +
      "in-pod DNAT from the pod IP to the guest. No Service is created: none of them asks to be exposed."
    );
  }

  const carried =
    exposed === ports.length
      ? ports.length === 1
        ? "its one port"
        : `every one of its ${ports.length} ports`
      : `${exposed} of its ${ports.length} ports`;

  return (
    `One Service of type ${exposure} is created for this guest, carrying ${carried} (${declared}). All exposed ports ` +
    "share that one Service, and it is deleted with the guest."
  );
}

/** What the additional interfaces add, for the summary. */
function interfacesSummaryNote(values: GuestFormValues): string | undefined {
  const nics = values.interfaces.filter((row) => row.name.trim() !== "");

  if (nics.length === 0) {
    return undefined;
  }

  const primary = nics.find((row) => row.primary);
  const attached = nics.filter((row) => row.networkName.trim() !== "").length;

  const count =
    nics.length === 1
      ? `one additional ${defaultInterfaceType} interface`
      : `${nics.length} additional ${defaultInterfaceType} interfaces`;
  const multus =
    attached === 0
      ? ""
      : nics.length === 1
        ? ", attached to a network by Multus"
        : `, ${attached} of them attached to a network by Multus`;

  return (
    `It gets ${count}${multus}. ` +
    (primary
      ? `The primary NIC is ${primary.name.trim()}: that is the one whose address the guest reports as its primary IP.`
      : "None is marked primary, so the first interface without a network reference is the primary, as upstream " +
        "does by default.")
  );
}

/** What a GPU commits this guest to, for the summary. */
function gpuSummaryNote(inputs: GuestCreateInputs, values: GuestFormValues): string | undefined {
  if (!guestGpuGuard(inputs, values).enabled) {
    return undefined;
  }

  if (values.gpuBackend === "profile") {
    const profile = values.gpuProfile.trim();

    if (!profile) {
      return undefined;
    }

    const facts = pickedGpuProfile(inputs, values);
    const summary = facts ? gpuProfileSummary(facts) : "";

    return (
      `It asks for the GPU profile ${profile}${summary ? ` (${summary})` : ""} through the native backend: the ` +
      "SwiftGPU controller picks the node and the devices before the launcher pod is created, and passes them " +
      "through with VFIO."
    );
  }

  if (values.gpuBackend !== "claim") {
    return undefined;
  }

  const claimName = values.gpuClaimName.trim();
  const templateName = values.gpuClaimTemplateName.trim();

  if (!claimName && !templateName) {
    return undefined;
  }

  const requestName = values.gpuRequestName.trim() || defaultGpuRequestName;

  return (
    `It asks for a GPU through DRA: the launcher pod carries ` +
    `${claimName ? `the ResourceClaim ${claimName}` : `a claim minted from the template ${templateName}`}, the ` +
    `scheduler and the DRA driver allocate the device for the request ${requestName}, and the tier is ` +
    `${values.gpuTier}${values.gpuTier === defaultGpuTier ? " (the value the API server stamps)" : ""}.`
  );
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

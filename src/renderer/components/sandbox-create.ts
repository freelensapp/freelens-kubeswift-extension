/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the two sandbox create forms decide, as pure functions over
// structurally declared inputs (SPEC-0016, "Where the code lives"). ONE module
// for both kinds, deliberately: every SwiftSandboxPool field except the two warm
// counts is a SwiftSandbox field, and the sandbox form READS a pool's shape, so
// two modules would be one rule with two implementations.
//
// Slice 1 is the pool half - the slot shape, the pool payload, the pool rules
// and the pool summary. Slice 2 adds the sandbox's own surface (the workload,
// the two expiries, the scratch disk, the GPU exclusivities and the checkout) on
// top of the same `SlotShapeValues`, and derives that shape from a picked pool.
//
// What creating a SwiftSandboxPool mechanically IS, and why so little of it is
// visible from the schema:
//
// - The pool is NOT a template of a sandbox. It flattens a subset of the shape
//   and deliberately omits every workload field (`command`, `args`, `env`,
//   `workingDir`, `timeout`, `ttl`), which belong to the claiming sandbox and
//   are injected post-boot.
// - Per warm slot the controller creates a runtime-intent ConfigMap and a
//   launcher Pod, both pool-owned, plus a deny-ingress NetworkPolicy when the
//   slot is networked, with a SOFT spread over hostname. A GPU finalizer runs
//   before any GPU slot warms.
// - A slot pod is named `<pool>-slot-<five random lowercase alphanumerics>` -
//   not ordinal, not stable across recreation, unlike SwiftGuestPool's indices.
//   That is where the 242-character name cap comes from.
// - `memory` is PER SLOT: N warm slots hold N times it, idle, and a warm GPU
//   pool holds one whole GPU per slot idle.
// - `maxWarm: 0` or absent means no cap beyond `minWarm`, and a cap BELOW the
//   floor is silently folded to the larger of the two: the controller's own
//   comment says bounds are the webhook's job, and there is no webhook.
// - **There is no admission webhook for SwiftSandboxPool at all**, so the CRD's
//   own types are the entire server-side validation: no CEL, no pattern beyond
//   the quantity one, no cross-field rule. Every rule below is therefore the
//   only place it is enforced anywhere (W12).
// - Nothing on a pool is immutable. The controller re-resolves, new slots take
//   the new shape, and existing slots keep the old one.
// - An HGX-tier GPU profile has no status surface at all: the tier is rejected
//   when the first slot is allocated, on a path that returns before the status
//   update, so the pool never reaches Degraded, never gets a message, and
//   error-backoffs forever with an empty phase.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which Secrets, kernels and GPU profiles the reads on
// open returned, which pool names the store happens to hold - is taken as an
// argument.

import { formatBytes } from "../api/kubeswift/types";
import { forbiddenStatusCode, notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import { gpuProfileSummary } from "./guest-create";
import { hasQuantityUnit, quantityError, unitlessQuantityWarning } from "./guestclass-create";
import { conflictStatusCode, kernelNodeLabel, kernelNodeLabelValue } from "./migration-create";

import type { SwiftSandboxPoolSpec } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import type { Quantity } from "../api/kubeswift/types";
import type { ApiFailureFacts } from "./guest-actions";
import type { GuestGpuProfileFacts } from "./guest-create";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createSandboxPoolTitle = "Create Sandbox Pool";

// ---------------------------------------------------------------------------
// The schema's own defaults, as constants.
//
// Every one of them is a value the API server stamps into the stored object, so
// none of them is ever sent: they are shown as the effective value while the
// field is untouched, and omitted from the payload (SPEC-0013's rule, restated
// by SPEC-0016's "Considered and rejected" table).
// ---------------------------------------------------------------------------

/** `spec.cpu`, an int32 with a minimum of 1. */
export const defaultSlotCpu = "1";

/** `spec.memory`, required AND defaulted, so the API server always fills it. */
export const defaultSlotMemory = "512Mi";

/** `spec.rootfsMode`, one of two. */
export const defaultRootfsMode = "block";

/** The two ways a slot's OCI rootfs is delivered. */
export const sandboxRootfsModes: string[] = ["block", "virtiofs"];

/** `spec.network.mode`, one of three. */
export const defaultNetworkMode = "restricted";

/** The three networking postures of a slot. */
export const sandboxNetworkModes: string[] = ["restricted", "open", "none"];

/** `spec.model.mountPath`, the read-only in-guest mount point. */
export const defaultModelMountPath = "/model";

/** `spec.minWarm`, the desired number of Ready, pre-booted, unclaimed slots. */
export const defaultMinWarm = "1";

/** The tiers whose profile a pool cannot warm a slot on. */
export const hgxGpuTiers: string[] = ["hgx-shared", "hgx-full"];

/**
 * How long a Kubernetes object name may be: a DNS-1123 subdomain.
 *
 * The pool's own budget is this minus the slot suffix, because the slot POD is
 * what carries the composed name.
 */
export const maxObjectNameLength = 253;

/** The literal every slot pod's name carries between the pool's name and its random tail. */
export const slotNameInfix = "-slot-";

/** How many random lowercase alphanumerics end a slot pod's name. */
export const slotRandomSuffixLength = 5;

/**
 * The longest a pool's name may be: `253 - len("-slot-") - 5`.
 *
 * Every warm slot is a Pod named `<pool>-slot-<five characters>`, and a Pod name
 * is a DNS-1123 subdomain capped at 253. Nothing upstream checks any of it - the
 * pool has no webhook - so a pool named past this budget is admitted and then
 * fails to create a single slot, forever, with nothing on the pool saying why.
 */
export const maxSandboxPoolNameLength = maxObjectNameLength - slotNameInfix.length - slotRandomSuffixLength;

/**
 * What can be changed after the create, on each of the two kinds, as one fact.
 *
 * Exported as a pair rather than as two constants because the pair IS the fact:
 * the two kinds sit at opposite ends of it, and the pool's end is why the
 * sandbox form's derivation (slice 2) is a snapshot rather than a live link.
 */
export const sandboxImmutabilityBoundary = {
  /**
   * Nothing on a pool is immutable, and that is not the same as harmless: the
   * controller re-resolves and new slots take the new shape, while every slot
   * that is already up keeps the shape it booted with.
   */
  pool:
    "Every field of this pool stays editable afterwards - nothing on it is immutable. The controller re-resolves " +
    "and new slots take the new shape, while the slots that are already warm keep the shape they booted with, so a " +
    "pool can be holding two shapes at once until the old slots are consumed.",
  /**
   * The sandbox's end of the same fact, for slice 2: everything but `ttl` is
   * immutable by a webhook that ships disabled, so with the webhook off the
   * edit is accepted and silently does nothing.
   */
  sandbox:
    "Everything on a SwiftSandbox except ttl is immutable. The rule lives only in the validating webhook, which " +
    "ships disabled, so on a normal install an edit is accepted and then does nothing at all: the launch is built " +
    "only when the launcher pod is missing.",
};

// ---------------------------------------------------------------------------
// The slot shape: the fields a SwiftSandboxPool and a SwiftSandbox share.
// ---------------------------------------------------------------------------

/** One entry of `spec.nodeSelector`, as a repeatable row. */
export interface NodeSelectorRow {
  id: string;
  key: string;
  value: string;
}

/**
 * The shape of one microVM, as both forms hold it.
 *
 * Every field here is a field of BOTH CRDs, which is what makes one section
 * serve two forms. The workload fields the pool deliberately omits - `command`,
 * `args`, `env`, `workingDir`, `timeout`, `ttl` - are not here either: they
 * belong to the claiming sandbox and slice 2 adds them beside this, not inside
 * it.
 *
 * Everything is a string because that is what an input holds; the payload
 * builder parses each one exactly once.
 */
export interface SlotShapeValues {
  /** `spec.image`, required by the schema on both kinds. */
  image: string;
  /** `spec.cpu`. Empty is the schema's own 1, which is never re-sent. */
  cpu: string;
  /** `spec.memory`. Empty is the schema's own 512Mi, which is never re-sent. */
  memory: string;
  /** `spec.rootfsMode`. Empty is `block`. */
  rootfsMode: string;
  /** `spec.network.mode`. Empty is `restricted`. */
  networkMode: string;
  /** `spec.kernelProfileRef.name`. Empty means the well-known `sandbox` kernel. */
  kernelProfile: string;
  /** `spec.nodeSelector`, merged by the controller with the kernel-node label. */
  nodeSelector: NodeSelectorRow[];
  /** `spec.gpuProfileRef.name`: the native GPU backend, which makes this a warm GPU pool. */
  gpuProfile: string;
  /** `spec.imagePullSecret`: a docker-registry Secret of the same namespace. */
  imagePullSecret: string;
  /** `spec.verifyKeySecretRef.name`: a cosign public key every slot verifies against. */
  verifyKeySecret: string;
  /** `spec.model.imageRef`: the block is emitted only with one. */
  modelImageRef: string;
  /** `spec.model.mountPath`. Empty is the schema's own /model, which is never re-sent. */
  modelMountPath: string;
}

/** The shape as a form opens it: nothing prefilled, every default shown as an effective value. */
export function defaultSlotShape(): SlotShapeValues {
  return {
    image: "",
    cpu: "",
    memory: "",
    rootfsMode: "",
    networkMode: "",
    kernelProfile: "",
    nodeSelector: [],
    gpuProfile: "",
    imagePullSecret: "",
    verifyKeySecret: "",
    modelImageRef: "",
    modelMountPath: "",
  };
}

/**
 * The next id for a node-selector row.
 *
 * Derived from the rows that exist rather than from a counter, so the function
 * stays pure and two forms opened in sequence cannot disagree about it (the
 * `nextRowId` idiom of the Create Guest form, kept local because this module has
 * exactly one repeatable section).
 */
export function nextNodeSelectorRowId(rows: readonly NodeSelectorRow[]): string {
  const used = rows
    .map((row) => Number.parseInt(row.id.startsWith("node-selector-") ? row.id.slice("node-selector-".length) : "", 10))
    .filter((value) => Number.isFinite(value));

  return `node-selector-${used.length > 0 ? Math.max(...used) + 1 : 1}`;
}

/** A fresh, empty node-selector row. */
export function newNodeSelectorRow(id: string): NodeSelectorRow {
  return { id, key: "", value: "" };
}

export function addNodeSelectorRow(shape: SlotShapeValues): SlotShapeValues {
  return {
    ...shape,
    nodeSelector: [...shape.nodeSelector, newNodeSelectorRow(nextNodeSelectorRowId(shape.nodeSelector))],
  };
}

export function removeNodeSelectorRow(shape: SlotShapeValues, id: string): SlotShapeValues {
  return { ...shape, nodeSelector: shape.nodeSelector.filter((row) => row.id !== id) };
}

export function updateNodeSelectorRow(
  shape: SlotShapeValues,
  id: string,
  patch: Partial<NodeSelectorRow>,
): SlotShapeValues {
  return { ...shape, nodeSelector: shape.nodeSelector.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

// ---------------------------------------------------------------------------
// The pool's own form.
// ---------------------------------------------------------------------------

/** Every field the Create Sandbox Pool form holds. */
export interface SandboxPoolFormValues {
  namespace: string;
  name: string;
  /** `spec.minWarm`. Empty is the schema's own 1, which is never re-sent. */
  minWarm: string;
  /** `spec.maxWarm`. Empty means no cap, which is also what 0 means. */
  maxWarm: string;
  /** The slot shape, which slice 2's form holds under the same name. */
  shape: SlotShapeValues;
}

/**
 * The form the dialog opens with.
 *
 * The namespace comes from the page's own filter when it names exactly one, and
 * is otherwise empty and required (S2) - never the literal `default`, which is
 * what upstream stamps and which looks deliberate without being.
 */
export function defaultSandboxPoolForm(namespace = ""): SandboxPoolFormValues {
  return { namespace, name: "", minWarm: "", maxWarm: "", shape: defaultSlotShape() };
}

/** What the reads on open found, as both sandbox forms need it. */
export interface SandboxCreateInputs {
  /** The namespace's Secret names, for the pull-secret and verify-key pickers (T3). */
  secrets: string[];
  secretsUnverified: boolean;
  /** The namespace's SwiftKernel names, for the kernel-profile picker. */
  kernels: string[];
  kernelsUnverified: boolean;
  /**
   * The namespace's SwiftGPUProfiles.
   *
   * The same shape the Create Guest form reads, reused rather than re-declared:
   * it is the same CRD, read the same way, and a second reading of one object
   * would be the drift this repository removes elsewhere.
   */
  gpuProfiles: GuestGpuProfileFacts[];
  /** True when that read was refused, which turns the HGX refusal into a warning. */
  gpuProfilesUnverified: boolean;
  /** The namespace's SwiftSandboxPool names, for the collision warning that never blocks. */
  existingNames: string[];
  /** True when that read was refused: the name is UNVERIFIABLE rather than free. */
  existingNamesUnverified: boolean;
}

// ---------------------------------------------------------------------------
// B1: identity.
// ---------------------------------------------------------------------------

/** A DNS-1123 subdomain, which is what an object name and a pod name both are. */
const dnsSubdomainPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** What an empty namespace is refused with. */
export const poolNamespaceRequiredMessage =
  "A namespace is required: the pool, every warm slot it boots, the Secrets it names and the kernel and GPU " +
  "profiles it points at all live in one, and every one of those references is namespace-local.";

/** What a name past the budget is refused with, with the arithmetic that produced it. */
export function poolNameTooLongMessage(length: number): string {
  return (
    `A pool name is at most ${maxSandboxPoolNameLength} characters; this one is ${length}. Every warm slot is a Pod ` +
    `named <pool>${slotNameInfix}<${slotRandomSuffixLength} characters>, and a Pod name is a DNS-1123 subdomain ` +
    `capped at ${maxObjectNameLength} - so the pool's own budget is ${maxObjectNameLength} minus the ` +
    `${slotNameInfix.length} of "${slotNameInfix}" minus the ${slotRandomSuffixLength} random ones. Nothing upstream ` +
    "checks it: there is no pool webhook, so the pool is admitted and then never manages to create a single slot."
  );
}

/** What a name that is not a DNS-1123 subdomain is refused with. */
export const poolNamePatternMessage =
  "A pool name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit. It becomes " +
  "the stem of every slot pod's name, so what a Pod name accepts is what this accepts.";

/** Why a typed pool name would be refused, or `undefined` when it is legal. */
export function sandboxPoolNameError(name: string): string | undefined {
  const trimmed = name.trim();

  if (!trimmed) {
    return "A name is required: it is what every warm slot of this pool is named after, and what a SwiftSandbox names to check a slot out.";
  }

  if (trimmed.length > maxSandboxPoolNameLength) {
    return poolNameTooLongMessage(trimmed.length);
  }

  if (!dnsSubdomainPattern.test(trimmed)) {
    return poolNamePatternMessage;
  }

  return undefined;
}

/** What one slot pod of this pool will be called, as the summary states it. */
export function slotNameExample(name: string): string {
  return `${name || "<name>"}${slotNameInfix}${"a1b2c".slice(0, slotRandomSuffixLength)}`;
}

// ---------------------------------------------------------------------------
// B2: the slot shape.
// ---------------------------------------------------------------------------

/** What an empty image reference is refused with. */
export const slotImageRequiredMessage =
  "An OCI image is required: it is what every warm slot boots as its root filesystem, and a claiming SwiftSandbox " +
  "must request the same one. A digest reference (repo@sha256:...) is preferred, because it pins what is warmed.";

/** What a reference carrying whitespace is refused with. */
export const slotImageWhitespaceMessage =
  "An image reference carries no whitespace. Nothing refuses it here - the pool has no admission webhook and the " +
  "schema declares a bare string - so what a padded reference produces is a registry lookup that fails, on every " +
  "node, with a message about a name nobody typed.";

/** Why a typed image reference would be refused, or `undefined` when it is legal. */
export function slotImageError(image: string): string | undefined {
  if (!image.trim()) {
    return slotImageRequiredMessage;
  }

  return /\s/.test(image) ? slotImageWhitespaceMessage : undefined;
}

/** What a cpu that is not a whole number is refused with. */
export const slotCpuFormatMessage =
  "A vCPU count is a whole number: the schema declares it as an int32, so 1.5 and 'two' are refused by the API " +
  "server rather than rounded.";

/** What a cpu below the schema's own minimum is refused with. */
export const slotCpuMinimumMessage =
  "A slot has at least 1 vCPU, which is the schema's own minimum. A microVM with none cannot boot, and a pool of " +
  "them warms nothing.";

/** Why a typed vCPU count would be refused, or `undefined` when it is legal. */
export function slotCpuError(cpu: string): string | undefined {
  const value = cpu.trim();

  if (!value) {
    return undefined;
  }

  if (!/^[+-]?\d+$/.test(value)) {
    return slotCpuFormatMessage;
  }

  return Number.parseInt(value, 10) < 1 ? slotCpuMinimumMessage : undefined;
}

/**
 * Why a typed memory would be refused, or `undefined` when it is legal.
 *
 * The grammar and the zero and negative refusals are the shared quantity ones
 * (SPEC-0014). What is specific here is that the field is OPTIONAL although the
 * schema calls it required: it is required AND defaulted, so the API server
 * fills it before it validates, and an object that never mentions memory is
 * stored with 512Mi in it.
 */
export function slotMemoryError(memory: string): string | undefined {
  return quantityError(memory);
}

/** What a model mount path that is not absolute is refused with. */
export const modelMountPathRelativeMessage =
  "A mount path is absolute: it is the in-guest mount point of the model tree, and a relative one is not a mount " +
  "point at all. Nothing refuses it - there is no pool webhook and the schema declares a bare string - so what it " +
  "produces is a slot whose weights are not where the workload looks for them.";

/** Why a typed mount path would be refused, or `undefined` when it is legal. */
export function modelMountPathError(mountPath: string): string | undefined {
  const value = mountPath.trim();

  if (!value) {
    return undefined;
  }

  return value.startsWith("/") ? undefined : modelMountPathRelativeMessage;
}

/** A label key's name segment, and the optional DNS-subdomain prefix before its '/'. */
const labelNamePattern = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const labelValuePattern = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;
const maxLabelSegmentLength = 63;

/** The fields one node-selector row can carry a message on. */
export type NodeSelectorField = "key" | "value";

export type NodeSelectorMessages = Partial<Record<NodeSelectorField, string>>;

export const nodeSelectorFieldLabels: Record<NodeSelectorField, string> = { key: "Label", value: "Value" };

const nodeSelectorFieldOrder: NodeSelectorField[] = ["key", "value"];

/** Why a node-selector label key would be refused, or `undefined` when it is legal. */
export function nodeSelectorKeyError(key: string): string | undefined {
  const value = key.trim();

  if (!value) {
    return undefined;
  }

  const slash = value.indexOf("/");
  const prefix = slash < 0 ? "" : value.slice(0, slash);
  const name = slash < 0 ? value : value.slice(slash + 1);

  if (slash >= 0 && (!prefix || !dnsSubdomainPattern.test(prefix) || prefix.length > maxObjectNameLength)) {
    return (
      "The part before the '/' of a label key is a DNS-1123 subdomain, like kubeswift.io. Nothing here refuses a " +
      "malformed one - a nodeSelector is a plain map in this schema - but the launcher Pod the controller then " +
      "builds is refused by the API server on every single reconcile."
    );
  }

  if (!name || name.length > maxLabelSegmentLength || !labelNamePattern.test(name)) {
    return (
      `A label key is at most ${maxLabelSegmentLength} characters of letters, digits, '-', '_' and '.', starting ` +
      "and ending with a letter or a digit, optionally prefixed with a DNS subdomain and a '/'. The pool stores " +
      "whatever is typed and the Pod that carries it is what the API server refuses."
    );
  }

  return undefined;
}

/** Why a node-selector label value would be refused, or `undefined` when it is legal. */
export function nodeSelectorValueError(value: string): string | undefined {
  const trimmed = value.trim();

  if (trimmed.length > maxLabelSegmentLength || !labelValuePattern.test(trimmed)) {
    return (
      `A label value is at most ${maxLabelSegmentLength} characters of letters, digits, '-', '_' and '.', starting ` +
      "and ending with a letter or a digit, or empty. An empty value is a real selector: it matches nodes that " +
      "carry the label with no value at all."
    );
  }

  return undefined;
}

/**
 * Everything that would make one node-selector row wrong, row by row.
 *
 * A row with a value and no key is the one refusal that is about the FORM
 * rather than about Kubernetes: a map has no such entry, so the value would be
 * silently dropped on the way to the payload, which is exactly the silence this
 * form exists to remove. An entirely empty row is not an error - it is a row
 * the user has not filled in yet - and it is dropped from the payload instead.
 */
export function nodeSelectorErrors(shape: SlotShapeValues): NodeSelectorMessages[] {
  const rows = shape.nodeSelector;

  return rows.map((row, index) => {
    const messages: NodeSelectorMessages = {};
    const key = row.key.trim();
    const value = row.value.trim();

    if (!key && value) {
      messages.key =
        "A label key is required once the row has a value: a nodeSelector is a map, so there is no entry for a " +
        "value with no key, and the value would simply not be sent.";
    } else {
      const keyError = nodeSelectorKeyError(key);

      if (keyError) {
        messages.key = keyError;
      } else if (key && rows.some((other, otherIndex) => otherIndex < index && other.key.trim() === key)) {
        messages.key = `Another row of this selector already constrains ${key}, and a map holds one value per key - the second row would silently replace the first.`;
      }
    }

    const valueError = nodeSelectorValueError(row.value);

    if (valueError) {
      messages.value = valueError;
    }

    return messages;
  });
}

/** What the node selector really constrains, said on the section (the merge nobody documents). */
export const nodeSelectorMergeFact =
  `Whatever is set here is MERGED with the required ${kernelNodeLabel}: ${kernelNodeLabelValue} label, which the ` +
  "controller adds itself: a pool only ever warms slots on kernel nodes, and this narrows that set rather than " +
  "replacing it.";

// ---------------------------------------------------------------------------
// B3: the warm buffer.
// ---------------------------------------------------------------------------

/** One warm-buffer count as a number, or `undefined` when the field does not hold one. */
export function warmCount(value: string): number | undefined {
  const count = value.trim();

  if (!/^[+-]?\d+$/.test(count)) {
    return undefined;
  }

  const parsed = Number.parseInt(count, 10);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The number of warm slots the facts are stated for: the typed one, or the
 * schema's default while the field is empty.
 *
 * A summary that said nothing while the field was empty would disappear exactly
 * when the operator is deciding how much memory to hold idle.
 */
export function effectiveMinWarm(values: SandboxPoolFormValues): number {
  return warmCount(values.minWarm) ?? Number.parseInt(defaultMinWarm, 10);
}

/** What `minWarm: 0` means, said on the field rather than left to be discovered. */
export const minWarmZeroFact =
  "0 is legal and warms nothing: the pool holds no slot at all until something scales it up, and every checkout " +
  "misses and cold-boots until then.";

/** What `maxWarm: 0` means, which is not a count. */
export const maxWarmZeroFact =
  "0 is the schema's no-cap sentinel rather than a count, and it means exactly what leaving this empty means: no " +
  "cap beyond minWarm.";

/** Where `minWarm` really lives, which is what makes it move without anyone editing this object. */
export const minWarmScalePathFact =
  "minWarm is the scale subresource's own spec path (specReplicasPath: .spec.minWarm), so `kubectl scale` and an " +
  "HPA change this number on a live pool - it is a floor this form sets, not one it owns.";

/** The fold this refusal exists to prevent, in the words the field carries. */
export const warmBufferFoldMessage =
  "A cap below the floor is silently folded to the larger of the two: the controller takes max(minWarm, maxWarm) " +
  "and its own comment says bounds are the webhook's job - and there is no webhook for a pool at all. So the " +
  "number typed here would not be the number that ends up capping anything. Upstream's own wizard refuses the " +
  "pair too; its controller does not.";

/** The fields the warm buffer can carry a message on. */
export type WarmBufferField = "minWarm" | "maxWarm";

export type WarmBufferMessages = Partial<Record<WarmBufferField, string>>;

/** Everything that would make the warm buffer refuse the create. */
export function warmBufferErrors(values: SandboxPoolFormValues): WarmBufferMessages {
  const messages: WarmBufferMessages = {};
  const minWarm = values.minWarm.trim();
  const maxWarm = values.maxWarm.trim();
  const min = warmCount(values.minWarm);
  const max = warmCount(values.maxWarm);

  if (minWarm && min === undefined) {
    messages.minWarm = "A warm-slot floor is a whole number: the schema declares it as an int32.";
  } else if (min !== undefined && min < 0) {
    messages.minWarm = `A warm-slot floor is 0 or more, which is the schema's own minimum. ${minWarmZeroFact}`;
  }

  if (maxWarm && max === undefined) {
    messages.maxWarm = "A warm-slot cap is a whole number: the schema declares it as an int32.";
  } else if (max !== undefined && max < 0) {
    messages.maxWarm = `A warm-slot cap is 0 or more, which is the schema's own minimum. ${maxWarmZeroFact}`;
  } else if (max !== undefined && max > 0 && min !== undefined && max < min) {
    messages.maxWarm = `A cap of ${max} is below this pool's floor of ${min}. ${warmBufferFoldMessage}`;
  }

  return messages;
}

// ---------------------------------------------------------------------------
// B4: the GPU profile.
// ---------------------------------------------------------------------------

/** The GPU profile the form is pointing at, when the read on open returned it. */
export function pickedSandboxGpuProfile(
  inputs: SandboxCreateInputs,
  shape: SlotShapeValues,
): GuestGpuProfileFacts | undefined {
  const name = shape.gpuProfile.trim();

  return name ? inputs.gpuProfiles.find((profile) => profile.name === name) : undefined;
}

/** Whether a tier is one of the two HGX ones, which is the whole of the refusal. */
export function isHgxTier(tier: string | undefined): boolean {
  return tier !== undefined && hgxGpuTiers.includes(tier);
}

/** What an HGX-tier profile is refused with, and what upstream does about it: nothing at all. */
export function hgxProfileRefusal(name: string, tier: string): string {
  return (
    `${name} is an ${tier} profile, and a pool cannot warm a slot on an HGX tier. The rejection happens upstream ` +
    "when the first slot is allocated, on a path that returns BEFORE the status update - so the pool never reaches " +
    "Degraded, never gets a message, and error-backoffs forever with an empty phase and nothing at all to read. " +
    "A pcie-tier profile is what a warm GPU pool takes."
  );
}

/** What an unreadable profile list costs here: the refusal above degrades to this. */
export function hgxProfileUnverifiedWarning(name: string): string {
  return (
    `The SwiftGPUProfiles of this namespace could not be listed from here, so the tier of ${name} is unverified. ` +
    "An HGX-tier profile cannot warm a slot, and upstream reports that nowhere: the pool would sit at an empty " +
    "phase forever. The create is not blocked on a read that failed."
  );
}

/** The profiles the picker offers, with the request each one makes on its label. */
export interface SandboxGpuProfileChoice {
  name: string;
  label: string;
  facts: GuestGpuProfileFacts;
}

/**
 * Every SwiftGPUProfile of the namespace, HGX ones included.
 *
 * The HGX tiers are offered and then refused rather than hidden: a profile that
 * is simply missing from a list teaches nothing, and the reason is the whole
 * value of this rule (upstream reports it nowhere at all).
 */
export function sandboxGpuProfileChoices(inputs: SandboxCreateInputs): SandboxGpuProfileChoice[] {
  return inputs.gpuProfiles.map((profile) => {
    const summary = gpuProfileSummary(profile);

    return { name: profile.name, label: summary ? `${profile.name} - ${summary}` : profile.name, facts: profile };
  });
}

// ---------------------------------------------------------------------------
// Errors, warnings and the submit verdict.
// ---------------------------------------------------------------------------

/** Every field of the slot shape, keyed the way its messages are. */
export type SlotShapeField =
  | "image"
  | "cpu"
  | "memory"
  | "rootfsMode"
  | "networkMode"
  | "kernelProfile"
  | "gpuProfile"
  | "imagePullSecret"
  | "verifyKeySecret"
  | "modelImageRef"
  | "modelMountPath";

export type SlotShapeMessages = Partial<Record<SlotShapeField, string>>;

/** How each slot-shape field reads in the sentence next to the disabled submit button. */
export const slotShapeFieldLabels: Record<SlotShapeField, string> = {
  image: "Image",
  cpu: "vCPUs",
  memory: "Memory",
  rootfsMode: "Root filesystem",
  networkMode: "Network",
  kernelProfile: "Kernel profile",
  gpuProfile: "GPU profile",
  imagePullSecret: "Pull secret",
  verifyKeySecret: "Verification key",
  modelImageRef: "Model image",
  modelMountPath: "Model mount path",
};

/** The reading order of the shape, which is the order the blocked sentence names fields in. */
const slotShapeFieldOrder: SlotShapeField[] = [
  "image",
  "cpu",
  "memory",
  "rootfsMode",
  "networkMode",
  "kernelProfile",
  "gpuProfile",
  "imagePullSecret",
  "verifyKeySecret",
  "modelImageRef",
  "modelMountPath",
];

/**
 * Everything that would make the slot shape wrong.
 *
 * Shared by both forms, because the shape is: slice 2's sandbox form calls this
 * against the same values and adds its own workload, scratch-disk and expiry
 * rules beside it.
 */
export function slotShapeErrors(inputs: SandboxCreateInputs, shape: SlotShapeValues): SlotShapeMessages {
  const errors: SlotShapeMessages = {};
  const imageError = slotImageError(shape.image);

  if (imageError) {
    errors.image = imageError;
  }

  const cpuError = slotCpuError(shape.cpu);

  if (cpuError) {
    errors.cpu = cpuError;
  }

  const memoryError = slotMemoryError(shape.memory);

  if (memoryError) {
    errors.memory = memoryError;
  }

  const profile = pickedSandboxGpuProfile(inputs, shape);

  if (profile && isHgxTier(profile.tier)) {
    errors.gpuProfile = hgxProfileRefusal(profile.name, String(profile.tier));
  }

  const mountPathError = modelMountPathError(shape.modelMountPath);

  if (mountPathError && shape.modelImageRef.trim()) {
    errors.modelMountPath = mountPathError;
  }

  return errors;
}

/**
 * Everything worth saying about a slot shape that would still be accepted.
 *
 * Warnings never block (W12). Every one of these is about a read that may have
 * failed or a name that may have been created since, which is precisely where a
 * client-side heuristic must not be in the driver's seat.
 */
export function slotShapeWarnings(inputs: SandboxCreateInputs, shape: SlotShapeValues): SlotShapeMessages {
  const warnings: SlotShapeMessages = {};
  const memory = shape.memory.trim();
  const kernelProfile = shape.kernelProfile.trim();
  const gpuProfile = shape.gpuProfile.trim();
  const pullSecret = shape.imagePullSecret.trim();
  const verifyKey = shape.verifyKeySecret.trim();

  if (memory && !quantityError(memory) && !hasQuantityUnit(memory)) {
    warnings.memory = unitlessQuantityWarning("slot memory", memory);
  }

  if (kernelProfile) {
    if (inputs.kernelsUnverified) {
      warnings.kernelProfile =
        "The SwiftKernels of this namespace could not be listed from here, so this name is unverified. A kernel " +
        "profile that does not exist is not refused at admission - the slots simply never boot.";
    } else if (!inputs.kernels.includes(kernelProfile)) {
      warnings.kernelProfile =
        `No SwiftKernel named ${kernelProfile} is in this namespace. Nothing refuses the pool for it: the slots ` +
        "fail to boot instead, and the pool reports it as a warming failure rather than as a missing reference.";
    }
  }

  if (gpuProfile && !pickedSandboxGpuProfile(inputs, shape)) {
    warnings.gpuProfile = inputs.gpuProfilesUnverified
      ? hgxProfileUnverifiedWarning(gpuProfile)
      : `No SwiftGPUProfile named ${gpuProfile} is in this namespace. A GPU pool whose profile cannot be resolved parks with an empty phase and a 30-second requeue, indefinitely - it never turns terminal on its own.`;
  }

  for (const [field, name, what] of [
    ["imagePullSecret", pullSecret, "the image pull"],
    ["verifyKeySecret", verifyKey, "the cosign verification"],
  ] as const) {
    if (!name) {
      continue;
    }

    if (inputs.secretsUnverified) {
      warnings[field] =
        "The Secrets of this namespace could not be listed from here, so this name is unverified. A Secret that " +
        `does not exist is not refused at admission - ${what} fails on the slot instead.`;
    } else if (!inputs.secrets.includes(name)) {
      warnings[field] =
        `No Secret named ${name} is in this namespace. Nothing refuses the pool for it: ${what} fails on every slot, so the pool never warms one.`;
    }
  }

  return warnings;
}

/** The pool's own fields, keyed the way their messages are. */
export type SandboxPoolOwnField = "namespace" | "name" | "minWarm" | "maxWarm";

export type SandboxPoolOwnMessages = Partial<Record<SandboxPoolOwnField, string>>;

export const sandboxPoolFieldLabels: Record<SandboxPoolOwnField, string> = {
  namespace: "Namespace",
  name: "Name",
  minWarm: "Warm slots",
  maxWarm: "Maximum warm slots",
};

/** Everything that would make the pool's own fields refuse the create. */
export function sandboxPoolOwnErrors(values: SandboxPoolFormValues): SandboxPoolOwnMessages {
  const errors: SandboxPoolOwnMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace = poolNamespaceRequiredMessage;
  }

  const nameError = sandboxPoolNameError(values.name);

  if (nameError) {
    errors.name = nameError;
  }

  return { ...errors, ...warmBufferErrors(values) };
}

/**
 * The store collision warning (S1): it warns, and it never blocks.
 *
 * A refused read makes the name UNVERIFIABLE rather than free - an empty list
 * from a read nobody was allowed to make is not "the name is available" - which
 * is SPEC-0013's `existingNamesUnverified` rule in a new place.
 */
export function sandboxPoolNameWarning(inputs: SandboxCreateInputs, values: SandboxPoolFormValues): string | undefined {
  const name = values.name.trim();
  const namespace = values.namespace.trim();

  if (!name) {
    return undefined;
  }

  if (inputs.existingNames.includes(name)) {
    return `A SwiftSandboxPool named ${name} already exists in ${namespace}. The create will be refused, and this form stays open when it is.`;
  }

  if (inputs.existingNamesUnverified) {
    return (
      `The SwiftSandboxPools of ${namespace || "this namespace"} could not be listed from here, so whether this ` +
      "name is already taken is unverified rather than answered. The API server answers it on submit."
    );
  }

  return undefined;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface SandboxPoolBlockingIssue {
  label: string;
  message: string;
}

/**
 * Every reason the form cannot be submitted, in the reading order of the form.
 *
 * B1 first, then the slot shape, then the node-selector rows, then the warm
 * buffer: a sentence that pointed at the third selector row while the namespace
 * was still empty would be pointing past the first thing to fix.
 */
export function sandboxPoolBlockingIssues(
  inputs: SandboxCreateInputs,
  values: SandboxPoolFormValues,
): SandboxPoolBlockingIssue[] {
  const issues: SandboxPoolBlockingIssue[] = [];
  const own = sandboxPoolOwnErrors(values);
  const shape = slotShapeErrors(inputs, values.shape);

  for (const field of ["namespace", "name"] as const) {
    const message = own[field];

    if (message) {
      issues.push({ label: sandboxPoolFieldLabels[field], message });
    }
  }

  for (const field of slotShapeFieldOrder) {
    const message = shape[field];

    if (message) {
      issues.push({ label: slotShapeFieldLabels[field], message });
    }
  }

  nodeSelectorErrors(values.shape).forEach((messages, index) => {
    for (const field of nodeSelectorFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Node selector ${index + 1} ${nodeSelectorFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  for (const field of ["minWarm", "maxWarm"] as const) {
    const message = own[field];

    if (message) {
      issues.push({ label: sandboxPoolFieldLabels[field], message });
    }
  }

  return issues;
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function sandboxPoolSubmitBlockReason(
  inputs: SandboxCreateInputs,
  values: SandboxPoolFormValues,
): string | undefined {
  const [first] = sandboxPoolBlockingIssues(inputs, values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/**
 * Whether the GPU section holds an error, so a collapsed section opens itself.
 *
 * Keyed on the SHAPE rather than on the pool, like everything else about the
 * shared section: a collapsed section that holds an error nobody can see is the
 * dead control W4 forbids, and that is as true of slice 2's form as of this one.
 */
export function slotGpuSectionHasError(inputs: SandboxCreateInputs, shape: SlotShapeValues): boolean {
  return Boolean(slotShapeErrors(inputs, shape).gpuProfile);
}

/** The same question for the registry, verification and model section. */
export function slotRegistrySectionHasError(inputs: SandboxCreateInputs, shape: SlotShapeValues): boolean {
  const errors = slotShapeErrors(inputs, shape);

  return Boolean(errors.imagePullSecret || errors.verifyKeySecret || errors.modelImageRef || errors.modelMountPath);
}

// ---------------------------------------------------------------------------
// The payload.
// ---------------------------------------------------------------------------

/**
 * The pool spec this form sends.
 *
 * `memory` is optional HERE and required in the model, and the difference is the
 * point: the schema marks it required and defaulted at once, and the API server
 * applies structural-schema defaults BEFORE it validates `required`, so an
 * object that never mentions memory is admitted and stored with 512Mi in it.
 * Sending it anyway would be re-sending a value the API server stamps.
 */
export type SandboxPoolCreateSpec = Omit<SwiftSandboxPoolSpec, "memory"> & { memory?: Quantity };

/** The keys of a slot shape that both kinds share, with nothing the API server stamps. */
export type SlotShapePayload = Pick<
  SandboxPoolCreateSpec,
  | "image"
  | "cpu"
  | "memory"
  | "rootfsMode"
  | "network"
  | "kernelProfileRef"
  | "nodeSelector"
  | "gpuProfileRef"
  | "imagePullSecret"
  | "verifyKeySecretRef"
  | "model"
>;

/**
 * The shape both kinds send, with exactly the keys the form set (G7, S9).
 *
 * Two rules and no exceptions:
 *
 * - **No empty-name reference is ever emitted.** `kernelProfileRef.name` and
 *   `gpuProfileRef.name` DEFAULT to the empty string in the schema, so an empty
 *   block is a reference the resolver then looks up and reports not-found
 *   forever; `verifyKeySecretRef` requires its name, and `model` requires its
 *   `imageRef`. All four blocks exist only when they carry a name.
 * - **A value the API server stamps is not re-sent.** `cpu`, `memory`,
 *   `rootfsMode`, `network.mode` and `model.mountPath` are omitted when the
 *   field is untouched, and also when the operator typed exactly the value the
 *   schema defaults to - which is the same object either way, and one rule
 *   rather than two.
 */
export function slotShapePayload(shape: SlotShapeValues): SlotShapePayload {
  const payload: SlotShapePayload = { image: shape.image.trim() };
  const cpu = warmCount(shape.cpu);
  const memory = shape.memory.trim();
  const rootfsMode = shape.rootfsMode.trim();
  const networkMode = shape.networkMode.trim();
  const kernelProfile = shape.kernelProfile.trim();
  const gpuProfile = shape.gpuProfile.trim();
  const pullSecret = shape.imagePullSecret.trim();
  const verifyKey = shape.verifyKeySecret.trim();
  const modelImageRef = shape.modelImageRef.trim();
  const modelMountPath = shape.modelMountPath.trim();
  const nodeSelector = nodeSelectorPayload(shape);

  if (cpu !== undefined && shape.cpu.trim() !== defaultSlotCpu) {
    payload.cpu = cpu;
  }

  if (memory && memory !== defaultSlotMemory) {
    payload.memory = memory;
  }

  if (rootfsMode && rootfsMode !== defaultRootfsMode) {
    payload.rootfsMode = rootfsMode;
  }

  if (networkMode && networkMode !== defaultNetworkMode) {
    payload.network = { mode: networkMode };
  }

  if (kernelProfile) {
    payload.kernelProfileRef = { name: kernelProfile };
  }

  if (nodeSelector) {
    payload.nodeSelector = nodeSelector;
  }

  if (gpuProfile) {
    payload.gpuProfileRef = { name: gpuProfile };
  }

  if (pullSecret) {
    payload.imagePullSecret = pullSecret;
  }

  if (verifyKey) {
    payload.verifyKeySecretRef = { name: verifyKey };
  }

  if (modelImageRef) {
    payload.model =
      modelMountPath && modelMountPath !== defaultModelMountPath
        ? { imageRef: modelImageRef, mountPath: modelMountPath }
        : { imageRef: modelImageRef };
  }

  return payload;
}

/** The node selector as a map, or `undefined` when no row carries a key. */
export function nodeSelectorPayload(shape: SlotShapeValues): Record<string, string> | undefined {
  const entries = shape.nodeSelector
    .map((row) => [row.key.trim(), row.value.trim()] as const)
    .filter(([key]) => key !== "");

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

/**
 * The object the create sends: the slot shape, and the pool's own two counts.
 *
 * `minWarm` follows the same rule as the shape's stamped values - the schema
 * defaults it to 1, so an untouched field sends nothing - while `maxWarm` has no
 * default at all, so whatever the operator typed is sent, including the 0 that
 * is the schema's own no-cap sentinel.
 */
export function sandboxPoolCreatePayload(values: SandboxPoolFormValues): { spec: SandboxPoolCreateSpec } {
  const spec: SandboxPoolCreateSpec = { ...slotShapePayload(values.shape) };
  const minWarm = warmCount(values.minWarm);
  const maxWarm = warmCount(values.maxWarm);

  if (minWarm !== undefined && values.minWarm.trim() !== defaultMinWarm) {
    spec.minWarm = minWarm;
  }

  if (maxWarm !== undefined) {
    spec.maxWarm = maxWarm;
  }

  return { spec };
}

// ---------------------------------------------------------------------------
// The write summary (W1, W12).
// ---------------------------------------------------------------------------

/** The facts the live write summary is built from. The component owns the JSX. */
export interface SandboxPoolCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/** A quantity as a byte count, for the one piece of arithmetic this form does. */
export function quantityToBytes(value: string): number | undefined {
  const quantity = value.trim();
  const match = /^(\d+(?:\.\d*)?|\.\d+)(Ki|Mi|Gi|Ti|Pi|Ei|k|M|G|T|P|E|m)?$/.exec(quantity);

  if (!match) {
    return undefined;
  }

  const magnitude = Number(match[1]);
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
    m: 0.001,
  };

  return Number.isFinite(magnitude) ? magnitude * (match[2] ? multipliers[match[2]] : 1) : undefined;
}

/**
 * How much memory this pool holds idle, as arithmetic on the form's own values.
 *
 * Deliberately not capacity math against the cluster (the SPEC-0012/0013
 * verdict, unchanged): the multiplication is stated, a second source of truth
 * about what the cluster can afford is not.
 */
export function poolIdleMemoryFact(values: SandboxPoolFormValues): string {
  const count = effectiveMinWarm(values);
  const memory = values.shape.memory.trim() || defaultSlotMemory;
  const perSlot = quantityToBytes(memory);
  const total = perSlot !== undefined ? formatBytes(perSlot * count) : undefined;

  if (count === 0) {
    return `Memory is held per slot, so a floor of 0 holds none: nothing warms, and each slot would take ${memory} once something scales this pool up.`;
  }

  return (
    `Memory is held PER SLOT, so ${count} warm ${count === 1 ? "slot holds" : "slots hold"} ${count} x ${memory}` +
    `${total ? ` = ${total}` : ""} idle, all the time, whether anything ever checks a slot out or not.`
  );
}

/** How many whole GPUs a warm GPU pool holds idle, which is the trade it makes. */
export function poolIdleGpuFact(inputs: SandboxCreateInputs, values: SandboxPoolFormValues): string | undefined {
  const name = values.shape.gpuProfile.trim();

  if (!name) {
    return undefined;
  }

  const count = effectiveMinWarm(values);
  const profile = pickedSandboxGpuProfile(inputs, values.shape);
  const perSlot = profile?.count;
  const total = perSlot === undefined ? undefined : perSlot * count;

  return (
    `This is a warm GPU pool: every slot holds a whole native SwiftGPU allocation from ${name}, idle, so the ` +
    `${count === 1 ? "one warm slot" : `${count} warm slots`} hold ` +
    `${total === undefined ? "one whole GPU each" : `${total} ${total === 1 ? "GPU" : "GPUs"}`} that nothing else ` +
    "can use. It trades idle hardware for a sub-second checkout; on an N-GPU cluster keep the floor at or below N. " +
    "A GPU pool warms only on nodes that are both gpu-node and kernel-node."
  );
}

/** What the controller creates per warm slot, which is the whole of what this write starts. */
export function poolWarmsFact(values: SandboxPoolFormValues): string {
  const count = effectiveMinWarm(values);
  const networked = (values.shape.networkMode.trim() || defaultNetworkMode) !== "none";
  const per = ["a runtime-intent ConfigMap", "a launcher Pod"];

  if (networked) {
    per.push("a deny-ingress NetworkPolicy");
  }

  if (count === 0) {
    return `Nothing warms yet: a floor of 0 asks for no slot at all. Each slot the pool later warms is ${per.join(", ")}, all pool-owned.`;
  }

  return (
    `${count} warm ${count === 1 ? "slot is" : "slots are"} asked for, and each one is ${per.join(", ")} - all of ` +
    "them owned by this pool, and spread softly over the hostnames of the kernel nodes in scope."
  );
}

/** How a slot pod is named, which is not how a SwiftGuestPool names a replica. */
export function poolSlotNamingFact(values: SandboxPoolFormValues): string {
  return (
    `Each slot pod is named ${slotNameExample(values.name.trim())} - the pool's name, then ` +
    `${slotRandomSuffixLength} random lowercase alphanumerics. The names are not ordinal and not stable across a ` +
    "recreation, unlike a SwiftGuestPool's replica indices, and scaling down prefers slots whose launcher is not " +
    "ready yet and never drains a claimed one."
  );
}

/** The phase honesty of this kind: `Pending` is never written, here or on a sandbox. */
export const poolFirstPhaseFact =
  "The first phase you see may be no phase at all, and then Warming: a reconcile that errors before the status " +
  "update writes none, and nothing here ever writes Pending even though the enum declares it. An empty phase is a " +
  "normal first state rather than a fault.";

/** Why the two counts do not add up, which is what makes them readable at all. */
export const poolCountsFact =
  "warmReplicas counts launcher-ready slots only, while claimedReplicas counts every live non-warm one, so warm " +
  "plus claimed is NOT a conserved total and the two can disagree with the floor for as long as a slot takes to " +
  "boot. observedGeneration is stale on a Degraded pool.";

/** What this pool is FOR, which is the one sentence the sandbox form's derivation rests on. */
export const poolRelationshipFact =
  "A SwiftSandbox checks a slot out of this pool by naming it in spec.poolRef, and that one field is the whole " +
  "client-side protocol. A miss is never a failure - the sandbox cold-boots instead - and nothing upstream checks " +
  "that a claimant's image, cpu, memory and rootfsMode match the pool's, although four schema descriptions say " +
  "they must: a mismatched image silently runs the workload inside this pool's rootfs. That is why the Create " +
  "Sandbox form derives its shape from here rather than asking for it again.";

/** What the model preload buys, and what every claiming sandbox inherits. */
export function poolModelFact(values: SandboxPoolFormValues): string {
  const mountPath = values.shape.modelMountPath.trim() || defaultModelMountPath;

  return (
    `Every slot preloads the model ${values.shape.modelImageRef.trim()} read-only at ${mountPath} over virtio-fs, ` +
    "materialized once per node and shared across slots, so the weights are resident before a checkout runs. Every " +
    "claiming SwiftSandbox inherits it."
  );
}

/** What the verification key really does, per slot rather than per pool. */
export function poolVerifyFact(values: SandboxPoolFormValues): string {
  return (
    `Every warm slot cosign-verifies the image against the key in ${values.shape.verifyKeySecret.trim()} before ` +
    "materializing, so the pool never warms an unverified rootfs and a failed verification fails that slot. It " +
    "needs a TLS registry."
  );
}

/**
 * The live write summary: the one create line, then the facts that are true of
 * this pool in this state (W1, rebuilt on every change).
 *
 * The order is the order things happen: what is stored, what warms, what those
 * slots are called, what they cost, what the pool will and will not tell you
 * afterwards, and what the pool is for.
 */
export function sandboxPoolCreateSummary(
  inputs: SandboxCreateInputs,
  values: SandboxPoolFormValues,
): SandboxPoolCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const image = values.shape.image.trim();
  const notes: string[] = [];
  const warnings: string[] = [];

  if (image) {
    notes.push(
      `Every warm slot boots ${image} as its root filesystem, delivered as ${values.shape.rootfsMode.trim() || defaultRootfsMode}, with ${values.shape.cpu.trim() || defaultSlotCpu} vCPU and ${values.shape.memory.trim() || defaultSlotMemory} of RAM.`,
    );
  }

  notes.push(poolWarmsFact(values));
  notes.push(poolSlotNamingFact(values));
  notes.push(poolIdleMemoryFact(values));

  const gpuFact = poolIdleGpuFact(inputs, values);

  if (gpuFact) {
    notes.push(gpuFact);
  }

  if (values.shape.verifyKeySecret.trim()) {
    notes.push(poolVerifyFact(values));
  }

  if (values.shape.modelImageRef.trim()) {
    notes.push(poolModelFact(values));
  }

  if (nodeSelectorPayload(values.shape)) {
    notes.push(nodeSelectorMergeFact);
  }

  notes.push(minWarmScalePathFact);
  notes.push(poolFirstPhaseFact);
  notes.push(poolCountsFact);
  notes.push(sandboxImmutabilityBoundary.pool);
  notes.push(poolRelationshipFact);

  const collision = sandboxPoolNameWarning(inputs, values);

  if (collision) {
    warnings.push(collision);
  }

  // The sharpest sentences are stated twice on purpose, at the field and here:
  // the summary is what a user reads before pressing OK.
  const shapeWarnings = slotShapeWarnings(inputs, values.shape);

  for (const field of slotShapeFieldOrder) {
    const warning = shapeWarnings[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftSandboxPool ${namespace}/${name}`, notes, warnings };
}

// ---------------------------------------------------------------------------
// The outcome (W9).
// ---------------------------------------------------------------------------

/** What a create that succeeded is acknowledged with: the fact, never a prediction. */
export function sandboxPoolCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftSandboxPool ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the sentence it is prefixed with. */
export interface SandboxPoolCreateFailureContext {
  namespace: string;
  name: string;
}

/**
 * The actionable sentence alone, for the three failures this dialog can predict.
 *
 * **403 is the expected failure on a well-run cluster**, since upstream's own
 * RBAC presets grant read only on both sandbox kinds - so W9's prefix names the
 * verb, the plural and the namespace, and the host's own toast carries the API
 * server's words underneath it.
 */
export function sandboxPoolCreateFailurePrefix(
  code: number | undefined,
  context: SandboxPoolCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftSandboxPool named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftSandboxPool CRD is gone.`;
  }

  if (code === forbiddenStatusCode) {
    return writeFailurePrefix(code, {
      verb: "create",
      resource: "swiftsandboxpools",
      namespace: context.namespace,
    });
  }

  return undefined;
}

/** One actionable sentence prefixed to what the API server said, never replacing it (W9). */
export function sandboxPoolCreateFailureMessage(
  failure: ApiFailureFacts,
  context: SandboxPoolCreateFailureContext,
): string | undefined {
  const prefix = sandboxPoolCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

// ---------------------------------------------------------------------------
// The header lines of the two collapsed sections.
//
// A section ships collapsed only when it is optional, consequence-bearing and
// hides no required field, and the consequence has to be readable whether the
// section is open or shut (DESIGN.md section 12). These are those lines: short,
// with the long form of each fact left to the summary, which is the grammar the
// shipped forms already use.
// ---------------------------------------------------------------------------

/** The line the GPU section carries, open or shut. */
export function sandboxGpuSectionHint(inputs: SandboxCreateInputs, shape: SlotShapeValues): string {
  const name = shape.gpuProfile.trim();

  if (!name) {
    return "None. A profile here makes this a warm GPU pool: every warm slot then holds a whole GPU idle, which is the trade it exists to make.";
  }

  const profile = pickedSandboxGpuProfile(inputs, shape);

  if (profile && isHgxTier(profile.tier)) {
    return `${name} is an HGX-tier profile, which a pool cannot warm a slot on - and upstream reports that nowhere at all.`;
  }

  return `${name}: every warm slot holds a whole native GPU allocation idle, and warms only on nodes that are both gpu-node and kernel-node.`;
}

/** The line the registry, verification and model section carries, open or shut. */
export function sandboxRegistrySectionHint(shape: SlotShapeValues): string {
  const parts: string[] = [];

  if (shape.imagePullSecret.trim()) {
    parts.push(`Pulled with ${shape.imagePullSecret.trim()}`);
  }

  if (shape.verifyKeySecret.trim()) {
    parts.push(`cosign-verified by every slot against ${shape.verifyKeySecret.trim()}`);
  }

  if (shape.modelImageRef.trim()) {
    parts.push(
      `the model ${shape.modelImageRef.trim()} preloaded read-only at ${shape.modelMountPath.trim() || defaultModelMountPath} in every slot`,
    );
  }

  if (parts.length === 0) {
    return "None. A public image, no signature check, and no model preloaded into the slots.";
  }

  // Every part begins with a word of prose rather than with a value, so the
  // first one can be capitalized whichever of the three it is - a header line
  // that started "ghcr.io/..." would be a reference nobody could copy.
  const [first, ...rest] = parts;
  const head = first.charAt(0).toUpperCase() + first.slice(1);

  return `${[head, ...rest].join(", ")}. Every claiming SwiftSandbox inherits what is set here.`;
}

/** What this form does NOT do, said rather than left to be discovered (G1's cousin). */
export const sandboxPoolFooter =
  "This form authors all fourteen fields of a SwiftSandboxPool, so nothing is left to the YAML editor here - but " +
  "the editor is what EDITS a pool afterwards, since no edit path is offered: every field stays mutable and the " +
  "slots that are already warm keep the shape they booted with. minWarm additionally moves through the scale " +
  "subresource, so `kubectl scale` and an HPA change it without touching the object's spec by hand.";

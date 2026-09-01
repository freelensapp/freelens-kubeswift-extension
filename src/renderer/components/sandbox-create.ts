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
// Everything the slot shape decides is called by both halves; where the two
// kinds say the same rule with different words, the shared function takes the
// wording as an argument and the DEFAULT is the pool's, which is where it was
// written.
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
import { gpuProfileSummary, nextRowId } from "./guest-create";
import { hasQuantityUnit, quantityError, unitlessQuantityWarning } from "./guestclass-create";
import { conflictStatusCode, kernelNodeLabel, kernelNodeLabelValue } from "./migration-create";

import type {
  SwiftSandboxEnvVar,
  SwiftSandboxGpuResourceClaim,
  SwiftSandboxScratchDisk,
  SwiftSandboxSpec,
} from "../api/kubeswift/swiftsandbox-v1alpha1";
import type { SwiftSandboxPoolSpec } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import type { Quantity } from "../api/kubeswift/types";
import type { ApiFailureFacts } from "./guest-actions";
import type { GuestGpuProfileFacts, GuestPvcFacts } from "./guest-create";

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

/** A label key's name segment, and the optional DNS-subdomain prefix before its '/'. */
const labelNamePattern = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const labelValuePattern = /^([A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?)?$/;
const maxLabelSegmentLength = 63;

/** What an empty image reference is refused with. */
export const slotImageRequiredMessage =
  "An OCI image is required: it is what every warm slot boots as its root filesystem, and a claiming SwiftSandbox " +
  "must request the same one. A digest reference (repo@sha256:...) is preferred, because it pins what is warmed.";

/** What a reference carrying whitespace is refused with. */
export const slotImageWhitespaceMessage =
  "An image reference carries no whitespace. Nothing refuses it here - the pool has no admission webhook and the " +
  "schema declares a bare string - so what a padded reference produces is a registry lookup that fails, on every " +
  "node, with a message about a name nobody typed.";

/** What a cpu that is not a whole number is refused with. Shared: it is the schema's own type. */
export const slotCpuFormatMessage =
  "A vCPU count is a whole number: the schema declares it as an int32, so 1.5 and 'two' are refused by the API " +
  "server rather than rounded.";

/** What a cpu below the schema's own minimum is refused with. */
export const slotCpuMinimumMessage =
  "A slot has at least 1 vCPU, which is the schema's own minimum. A microVM with none cannot boot, and a pool of " +
  "them warms nothing.";

/** What a model mount path that is not absolute is refused with. */
export const modelMountPathRelativeMessage =
  "A mount path is absolute: it is the in-guest mount point of the model tree, and a relative one is not a mount " +
  "point at all. Nothing refuses it - there is no pool webhook and the schema declares a bare string - so what it " +
  "produces is a slot whose weights are not where the workload looks for them.";

/**
 * What each refusal of the slot shape SAYS, per kind.
 *
 * The conditions are the same on both forms, because they are the same fields;
 * the consequences are not, and every one of these sentences names one. A form
 * about a sandbox that told its operator what a POOL would do with the value is
 * the drift this record exists to remove - the screenshot pass found five of
 * them. The DEFAULT is the pool's, which is where they were written (slice 1).
 */
export interface SlotShapeRefusalWording {
  imageRequired: string;
  imageWhitespace: string;
  cpuMinimum: string;
  nodeSelectorKeyPrefix: string;
  nodeSelectorKeyName: string;
  modelMountPathRelative: string;
}

/** The pool's own words, which are the ones slice 1 shipped. */
export const poolSlotRefusalWording: SlotShapeRefusalWording = {
  imageRequired: slotImageRequiredMessage,
  imageWhitespace: slotImageWhitespaceMessage,
  cpuMinimum: slotCpuMinimumMessage,
  nodeSelectorKeyPrefix:
    "The part before the '/' of a label key is a DNS-1123 subdomain, like kubeswift.io. Nothing here refuses a " +
    "malformed one - a nodeSelector is a plain map in this schema - but the launcher Pod the controller then " +
    "builds is refused by the API server on every single reconcile.",
  nodeSelectorKeyName:
    `A label key is at most ${maxLabelSegmentLength} characters of letters, digits, '-', '_' and '.', starting ` +
    "and ending with a letter or a digit, optionally prefixed with a DNS subdomain and a '/'. The pool stores " +
    "whatever is typed and the Pod that carries it is what the API server refuses.",
  modelMountPathRelative: modelMountPathRelativeMessage,
};

/** The sandbox's own words for the same five refusals. */
export const sandboxSlotRefusalWording: SlotShapeRefusalWording = {
  imageRequired:
    "An OCI image is required: it is what this sandbox boots as its root filesystem, and it is the one field of " +
    "the spec the schema cannot default. A digest reference (repo@sha256:...) is preferred, because it pins " +
    "exactly what runs.",
  imageWhitespace:
    "An image reference carries no whitespace. Nothing refuses it - the schema declares a bare string with no " +
    "pattern - so what a padded reference produces is a registry lookup that fails at materialize time, which is " +
    "TERMINAL: the sandbox goes Failed about a name nobody typed.",
  cpuMinimum:
    "A sandbox has at least 1 vCPU, which is the schema's own minimum. A microVM with none cannot boot at all.",
  nodeSelectorKeyPrefix:
    "The part before the '/' of a label key is a DNS-1123 subdomain, like kubeswift.io. Nothing here refuses a " +
    "malformed one - a nodeSelector is a plain map in this schema - but the launcher Pod the controller then " +
    "builds is refused by the API server on every single reconcile.",
  nodeSelectorKeyName:
    `A label key is at most ${maxLabelSegmentLength} characters of letters, digits, '-', '_' and '.', starting ` +
    "and ending with a letter or a digit, optionally prefixed with a DNS subdomain and a '/'. The sandbox stores " +
    "whatever is typed and the Pod that carries it is what the API server refuses.",
  modelMountPathRelative:
    "A mount path is absolute: it is the in-guest mount point of the model tree, and a relative one is not a " +
    "mount point at all. The schema declares a bare string with no pattern, so nothing refuses it - what it " +
    "produces is a sandbox whose weights are not where the workload looks for them.",
};

/** Why a typed image reference would be refused, or `undefined` when it is legal. */
export function slotImageError(
  image: string,
  wording: SlotShapeRefusalWording = poolSlotRefusalWording,
): string | undefined {
  if (!image.trim()) {
    return wording.imageRequired;
  }

  return /\s/.test(image) ? wording.imageWhitespace : undefined;
}

/** Why a typed vCPU count would be refused, or `undefined` when it is legal. */
export function slotCpuError(
  cpu: string,
  wording: SlotShapeRefusalWording = poolSlotRefusalWording,
): string | undefined {
  const value = cpu.trim();

  if (!value) {
    return undefined;
  }

  if (!/^[+-]?\d+$/.test(value)) {
    return slotCpuFormatMessage;
  }

  return Number.parseInt(value, 10) < 1 ? wording.cpuMinimum : undefined;
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

/** Why a typed mount path would be refused, or `undefined` when it is legal. */
export function modelMountPathError(
  mountPath: string,
  wording: SlotShapeRefusalWording = poolSlotRefusalWording,
): string | undefined {
  const value = mountPath.trim();

  if (!value) {
    return undefined;
  }

  return value.startsWith("/") ? undefined : wording.modelMountPathRelative;
}

/** The fields one node-selector row can carry a message on. */
export type NodeSelectorField = "key" | "value";

export type NodeSelectorMessages = Partial<Record<NodeSelectorField, string>>;

export const nodeSelectorFieldLabels: Record<NodeSelectorField, string> = { key: "Label", value: "Value" };

const nodeSelectorFieldOrder: NodeSelectorField[] = ["key", "value"];

/** Why a node-selector label key would be refused, or `undefined` when it is legal. */
export function nodeSelectorKeyError(
  key: string,
  wording: SlotShapeRefusalWording = poolSlotRefusalWording,
): string | undefined {
  const value = key.trim();

  if (!value) {
    return undefined;
  }

  const slash = value.indexOf("/");
  const prefix = slash < 0 ? "" : value.slice(0, slash);
  const name = slash < 0 ? value : value.slice(slash + 1);

  if (slash >= 0 && (!prefix || !dnsSubdomainPattern.test(prefix) || prefix.length > maxObjectNameLength)) {
    return wording.nodeSelectorKeyPrefix;
  }

  if (!name || name.length > maxLabelSegmentLength || !labelNamePattern.test(name)) {
    return wording.nodeSelectorKeyName;
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
export function nodeSelectorErrors(
  shape: SlotShapeValues,
  wording: SlotShapeRefusalWording = poolSlotRefusalWording,
): NodeSelectorMessages[] {
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
      const keyError = nodeSelectorKeyError(key, wording);

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
 * What each reference warning of the slot shape SAYS, per kind.
 *
 * The conditions are the same for both forms - a name that the read did not
 * return, or a read that was refused - and the consequence is not: a name that
 * resolves to nothing keeps a pool from warming a single slot, and keeps a
 * sandbox from ever booting. One implementation of WHEN to warn, two sets of
 * words for WHAT it costs, rather than two implementations of both.
 */
export interface SlotShapeWarningWording {
  /** How the unitless-memory warning names this field. */
  memoryLabel: string;
  kernelUnverified: string;
  kernelMissing: (name: string) => string;
  gpuProfileMissing: (name: string) => string;
  gpuProfileUnverified: (name: string) => string;
  secretUnverified: (what: string) => string;
  secretMissing: (name: string, what: string) => string;
}

/** The pool's own words, which are the ones slice 1 shipped. */
export const poolSlotWarningWording: SlotShapeWarningWording = {
  memoryLabel: "slot memory",
  kernelUnverified:
    "The SwiftKernels of this namespace could not be listed from here, so this name is unverified. A kernel " +
    "profile that does not exist is not refused at admission - the slots simply never boot.",
  kernelMissing: (name) =>
    `No SwiftKernel named ${name} is in this namespace. Nothing refuses the pool for it: the slots ` +
    "fail to boot instead, and the pool reports it as a warming failure rather than as a missing reference.",
  gpuProfileMissing: (name) =>
    `No SwiftGPUProfile named ${name} is in this namespace. A GPU pool whose profile cannot be resolved parks with an empty phase and a 30-second requeue, indefinitely - it never turns terminal on its own.`,
  gpuProfileUnverified: hgxProfileUnverifiedWarning,
  secretUnverified: (what) =>
    "The Secrets of this namespace could not be listed from here, so this name is unverified. A Secret that " +
    `does not exist is not refused at admission - ${what} fails on the slot instead.`,
  secretMissing: (name, what) =>
    `No Secret named ${name} is in this namespace. Nothing refuses the pool for it: ${what} fails on every slot, so the pool never warms one.`,
};

/**
 * Everything worth saying about a slot shape that would still be accepted.
 *
 * Warnings never block (W12). Every one of these is about a read that may have
 * failed or a name that may have been created since, which is precisely where a
 * client-side heuristic must not be in the driver's seat.
 */
export function slotShapeWarnings(
  inputs: SandboxCreateInputs,
  shape: SlotShapeValues,
  wording: SlotShapeWarningWording = poolSlotWarningWording,
): SlotShapeMessages {
  const warnings: SlotShapeMessages = {};
  const memory = shape.memory.trim();
  const kernelProfile = shape.kernelProfile.trim();
  const gpuProfile = shape.gpuProfile.trim();
  const pullSecret = shape.imagePullSecret.trim();
  const verifyKey = shape.verifyKeySecret.trim();

  if (memory && !quantityError(memory) && !hasQuantityUnit(memory)) {
    warnings.memory = unitlessQuantityWarning(wording.memoryLabel, memory);
  }

  if (kernelProfile) {
    if (inputs.kernelsUnverified) {
      warnings.kernelProfile = wording.kernelUnverified;
    } else if (!inputs.kernels.includes(kernelProfile)) {
      warnings.kernelProfile = wording.kernelMissing(kernelProfile);
    }
  }

  if (gpuProfile && !pickedSandboxGpuProfile(inputs, shape)) {
    warnings.gpuProfile = inputs.gpuProfilesUnverified
      ? wording.gpuProfileUnverified(gpuProfile)
      : wording.gpuProfileMissing(gpuProfile);
  }

  for (const [field, name, what] of [
    ["imagePullSecret", pullSecret, "the image pull"],
    ["verifyKeySecret", verifyKey, "the cosign verification"],
  ] as const) {
    if (!name) {
      continue;
    }

    if (inputs.secretsUnverified) {
      warnings[field] = wording.secretUnverified(what);
    } else if (!inputs.secrets.includes(name)) {
      warnings[field] = wording.secretMissing(name, what);
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

// ===========================================================================
// The sandbox's own surface (SPEC-0016 slice 2, Dialog A).
//
// What creating a SwiftSandbox mechanically IS, and why almost none of it is
// visible from the schema:
//
// - The cold path: namespace launcher RBAC and a per-pod scoped grant, native
//   GPU allocation behind a finalizer, the scratch disk (a PVC named
//   `<sandbox>-scratch`, ReadWriteOnce, ALWAYS Block, owner-referenced, gated on
//   Bound), and a registry resolve. Then, all owned by the sandbox: a runtime
//   intent ConfigMap, a Pod named exactly `<sandbox>`, and a NetworkPolicy when
//   `network.mode` is not `none`. NO Service and NO Secret are ever created.
// - The first observable state is an EMPTY `status.phase`, not `Pending`. That
//   phase is in the enum, in the metrics labels and in a test, and is written by
//   no controller (correction 3 owed to SPEC-0008).
// - **Nothing self-heals.** TERMINAL, and needing a delete-and-recreate: an
//   invalid pull secret, an image or model resolve failure, a non-zero
//   materialize exit, a `timeout` breach, a Failed pod. PARKS, forever, as an
//   empty phase with one False condition: a GPU profile that is missing, out of
//   capacity or on an unsupported tier (30-second requeue), and a scratch PVC
//   that is missing or not Bound (3-second requeue). SPEC-0013's "create early,
//   it heals" sentence must not be borrowed here.
// - The whole spec except `ttl` is immutable, by a webhook that ships disabled,
//   so with the webhook off an edit is accepted and does nothing at all: the
//   launch is built only when the launcher pod is missing.
// - `spec.scratchDisk: {}` makes the controller dereference a nil pointer. It is
//   made UNBUILDABLE by the three-way control below rather than validated (S7).
// - `env[].valueFrom` is schema-complete and behaviourally IGNORED: the merge
//   takes the literal value only, because a microVM has no downward-API or
//   Secret path, so a `secretKeyRef` variable reaches the guest EMPTY.
// - `scratchDisk.blank.volumeMode` is a no-op on three legs: enum-allowed,
//   webhook-rejected and controller-hardcoded to `Block`.
//
// **The checkout.** Setting `spec.poolRef.name` at create time is the ENTIRE
// client-side protocol: no claim field, no lease, no annotation and no gateway
// RPC. A warm slot is a Pod, not a custom resource; the claim is a label flip
// plus a re-parented ownerRef; a miss is never a failure (the sandbox cold-boots
// instead); and NOTHING upstream checks that a claimant's `image`, `cpu`,
// `memory` and `rootfsMode` match the pool's, although four schema descriptions
// say they must - a mismatched image silently runs the workload inside the
// pool's rootfs. That is why the shape is DERIVED from the picked pool here
// rather than asked for again (S3).
// ===========================================================================

/** The verb, on the Sandboxes page's create control, on the OK button and in the failures. */
export const createSandboxTitle = "Create Sandbox";

/** What the blank branch's own PVC is named after the sandbox: `<name>-scratch`. */
export const scratchClaimSuffix = "-scratch";

/**
 * The longest a sandbox's name may be on the blank-scratch branch.
 *
 * The claim the controller creates is `<name>-scratch`, and a PVC name is a
 * DNS-1123 subdomain capped at 253 like every other object name - so a sandbox
 * named past this budget is ADMITTED and then waits on Binding forever, with
 * nothing on it saying that the claim it is waiting for could never be created.
 */
export const maxSandboxNameLengthWithScratchClaim = maxObjectNameLength - scratchClaimSuffix.length;

/** The tiers `gpuResourceClaim.tier` accepts, in the order the control offers them. */
export const sandboxGpuTiers: string[] = ["pcie", "hgx-shared", "hgx-full"];

/** `gpuResourceClaim.tier`, which the API server stamps and this form never re-sends. */
export const defaultSandboxGpuTier = "pcie";

/** What an empty `gpuResourceClaim.requestName` resolves to, shown rather than sent. */
export const defaultSandboxGpuRequestName = "gpu";

// ---------------------------------------------------------------------------
// A2: the two modes.
// ---------------------------------------------------------------------------

/** Cold microVM, or a slot checked out of a warm pool. */
export type SandboxSource = "new" | "checkout";

/** The modes the radio group offers, in the order it offers them. */
export const sandboxSources: SandboxSource[] = ["new", "checkout"];

export const sandboxSourceLabels: Record<SandboxSource, string> = {
  new: "New microVM",
  checkout: "Check out a warm slot",
};

/** What choosing each mode means, in one line apiece, under its label. */
export function sandboxSourceDescription(source: SandboxSource): string {
  return source === "checkout"
    ? "Name a SwiftSandboxPool and this sandbox claims one of its pre-booted slots, which is a sub-second start instead of a materialize and a boot. A miss is not a failure: it cold-boots instead."
    : "The cold path: the OCI rootfs is materialized on the node, a launcher pod is built and the microVM boots. It is what every sandbox does when no pool is named.";
}

// ---------------------------------------------------------------------------
// A3: the workload.
// ---------------------------------------------------------------------------

/** One element of `command` or `args`, as a repeatable row: one row, one argv element. */
export interface ArgvRow {
  id: string;
  value: string;
}

/** One literal entry of `spec.env`. `valueFrom` is not offered; see the footer. */
export interface EnvRow {
  id: string;
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// A5: the scratch disk, as a three-way control.
// ---------------------------------------------------------------------------

/**
 * Where the one secondary block device comes from, or that there is none.
 *
 * Three-way rather than two checkboxes, because that is what makes
 * `spec.scratchDisk: {}` - the nil dereference in the reconcile loop -
 * UNBUILDABLE rather than validated (S7): `none` omits the block entirely, and
 * neither of the other two can produce an empty one.
 */
export type SandboxScratchSource = "none" | "blank" | "existing";

export const sandboxScratchSources: SandboxScratchSource[] = ["none", "blank", "existing"];

export const sandboxScratchSourceLabels: Record<SandboxScratchSource, string> = {
  none: "None",
  blank: "Blank disk",
  existing: "Existing claim",
};

/** What each of the three does, in one line apiece. */
export function sandboxScratchSourceDescription(source: SandboxScratchSource): string {
  switch (source) {
    case "blank":
      return "A new, empty, sized claim OWNED by this sandbox and deleted with it, attached as a raw block device. The workload runs mkfs on it.";
    case "existing":
      return "An existing PersistentVolumeClaim of this namespace, attached as a raw block device. It is NOT owned by the sandbox and survives it, which is the case for a cache reused across runs.";
    default:
      return "No secondary disk. The sandbox writes into its own RAM-backed tmpfs overlay, which is gone when it ends and is limited by the guest's memory.";
  }
}

// ---------------------------------------------------------------------------
// A6: the GPU backend.
// ---------------------------------------------------------------------------

/** The native allocation, the DRA claim, or neither - and never two of them. */
export type SandboxGpuBackend = "none" | "profile" | "dra";

export const sandboxGpuBackends: SandboxGpuBackend[] = ["none", "profile", "dra"];

export const sandboxGpuBackendLabels: Record<SandboxGpuBackend, string> = {
  none: "No GPU",
  profile: "SwiftGPUProfile (native allocation)",
  dra: "Resource claim (DRA)",
};

/** What choosing each backend means, in one line apiece. */
export function sandboxGpuBackendDescription(backend: SandboxGpuBackend): string {
  switch (backend) {
    case "profile":
      return "The SwiftGPU controller allocates the devices at controller time and stamps status.gpu; the launcher pod is then pinned to the node it chose and gpu-init binds those exact PCI addresses.";
    case "dra":
      return "The launcher pod carries a ResourceClaim, the kube-scheduler with a DRA driver allocates the device at schedule time, and the KubeSwift DRA driver injects it.";
    default:
      return "No GPU, which is what almost every sandbox wants.";
  }
}

// ---------------------------------------------------------------------------
// The form's values.
// ---------------------------------------------------------------------------

/** Every field the Create Sandbox form holds. */
export interface SandboxFormValues {
  namespace: string;
  name: string;
  /** A2. `checkout` is the one field, `spec.poolRef.name`, that is the whole protocol. */
  source: SandboxSource;
  /** `spec.poolRef.name`, a reference into the sandbox's OWN namespace. */
  pool: string;
  /** `spec.command`, one row per argv element, so a quoted argument cannot be split. */
  command: ArgvRow[];
  /** `spec.args`, appended to the command (or to the image entrypoint when there is none). */
  args: ArgvRow[];
  /** `spec.workingDir`, which overrides the image config's working directory. */
  workingDir: string;
  /** `spec.env`, literal values only. */
  env: EnvRow[];
  /** The shape slice 1 built, shared field for field with the pool form. */
  shape: SlotShapeValues;
  /** A5, as a three-way that cannot produce an empty block. */
  scratchSource: SandboxScratchSource;
  scratchSize: string;
  scratchStorageClass: string;
  scratchClaim: string;
  /** A6. The profile itself lives in `shape.gpuProfile`, which is a field of both kinds. */
  gpuBackend: SandboxGpuBackend;
  gpuClaimName: string;
  gpuClaimTemplateName: string;
  gpuRequestName: string;
  gpuTier: string;
  /** A7, both Go durations, both validated positive. */
  timeout: string;
  ttl: string;
}

/**
 * The form the dialog opens with.
 *
 * The namespace comes from the page's own filter when it names exactly one, and
 * is otherwise empty and required (S2) - never the literal `default`.
 */
export function defaultSandboxForm(namespace = ""): SandboxFormValues {
  return {
    namespace,
    name: "",
    source: "new",
    pool: "",
    command: [],
    args: [],
    workingDir: "",
    env: [],
    shape: defaultSlotShape(),
    scratchSource: "none",
    scratchSize: "",
    scratchStorageClass: "",
    scratchClaim: "",
    gpuBackend: "none",
    gpuClaimName: "",
    gpuClaimTemplateName: "",
    gpuRequestName: "",
    gpuTier: "",
    timeout: "",
    ttl: "",
  };
}

/** The facts one SwiftSandboxPool option carries, and the four the derivation reads. */
export interface SandboxPoolFacts {
  name: string;
  /** `status.phase`, which may be absent: nothing here ever writes `Pending`. */
  phase?: string;
  warm?: number;
  claimed?: number;
  /** The four the schema says a claimant must match, and that nothing compares. */
  image?: string;
  cpu?: number;
  memory?: string;
  rootfsMode?: string;
}

/** One PersistentVolumeClaim of the namespace, as the existing-claim branch reads it. */
export type SandboxPvcFacts = GuestPvcFacts;

/** What the reads on open found, for the sandbox form specifically. */
export interface SandboxFormInputs extends SandboxCreateInputs {
  /** The namespace's SwiftSandboxPools, for the checkout picker and the derivation. */
  pools: SandboxPoolFacts[];
  /** True when that read was refused: the derivation cannot happen and the shape is asked for. */
  poolsUnverified: boolean;
  /** When the pool list was read, because the derivation is a SNAPSHOT of a mutable object. */
  poolsReadAt?: string;
  /** The namespace's PersistentVolumeClaims, for the existing-claim branch (T3). */
  pvcs: SandboxPvcFacts[];
  pvcsUnverified: boolean;
}

// ---------------------------------------------------------------------------
// The repeatable rows.
// ---------------------------------------------------------------------------

/** A fresh, empty argv row. */
export function newArgvRow(id: string): ArgvRow {
  return { id, value: "" };
}

/** A fresh, empty environment row. */
export function newEnvRow(id: string): EnvRow {
  return { id, name: "", value: "" };
}

/** Which of the two argv lists a row helper is acting on. */
export type ArgvList = "command" | "args";

export function addArgvRow(values: SandboxFormValues, list: ArgvList): SandboxFormValues {
  return { ...values, [list]: [...values[list], newArgvRow(nextRowId(list, values[list]))] };
}

export function removeArgvRow(values: SandboxFormValues, list: ArgvList, id: string): SandboxFormValues {
  return { ...values, [list]: values[list].filter((row) => row.id !== id) };
}

export function updateArgvRow(values: SandboxFormValues, list: ArgvList, id: string, value: string): SandboxFormValues {
  return { ...values, [list]: values[list].map((row) => (row.id === id ? { ...row, value } : row)) };
}

export function addEnvRow(values: SandboxFormValues): SandboxFormValues {
  return { ...values, env: [...values.env, newEnvRow(nextRowId("env", values.env))] };
}

export function removeEnvRow(values: SandboxFormValues, id: string): SandboxFormValues {
  return { ...values, env: values.env.filter((row) => row.id !== id) };
}

export function updateEnvRow(values: SandboxFormValues, id: string, patch: Partial<EnvRow>): SandboxFormValues {
  return { ...values, env: values.env.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/**
 * Moves the form between the two modes, emptying what the mode it leaves owned.
 *
 * The same rule as the Create Guest form's boot source, and for the same reason:
 * the payload builder branches on the mode, so a value left behind by the mode
 * the user moved away from would be invisible in the stored object and visible
 * in the form - which is the one place this form must never be.
 *
 * What a checkout clears is the four fields whose control it does not render:
 * the pool decides the network mode, the kernel profile and the node the slot is
 * already on (O4), and GPU is inexpressible with a pool at all. The image, the
 * vCPUs and the memory are NOT cleared, because the degraded branch - a pool
 * list that could not be read - asks for them again.
 */
export function switchSandboxSource(values: SandboxFormValues, source: SandboxSource): SandboxFormValues {
  if (source === values.source) {
    return values;
  }

  if (source === "new") {
    return { ...values, source, pool: "" };
  }

  return {
    ...values,
    source,
    shape: { ...values.shape, networkMode: "", kernelProfile: "", nodeSelector: [], gpuProfile: "" },
    gpuBackend: "none",
    gpuClaimName: "",
    gpuClaimTemplateName: "",
    gpuRequestName: "",
    gpuTier: "",
  };
}

/** Moves the scratch disk to another source, emptying the one it leaves. */
export function setSandboxScratchSource(values: SandboxFormValues, scratchSource: SandboxScratchSource) {
  return {
    ...values,
    scratchSource,
    scratchSize: scratchSource === "blank" ? values.scratchSize : "",
    scratchStorageClass: scratchSource === "blank" ? values.scratchStorageClass : "",
    scratchClaim: scratchSource === "existing" ? values.scratchClaim : "",
  };
}

/**
 * Moves the GPU section to another backend, emptying the one it leaves.
 *
 * `gpuProfileRef` and `gpuResourceClaim` are mutually exclusive in upstream's
 * own schema description and enforced by a webhook that ships disabled, so the
 * violation is made inexpressible rather than validated - the same shape as the
 * scratch disk one section above.
 */
export function setSandboxGpuBackend(values: SandboxFormValues, gpuBackend: SandboxGpuBackend): SandboxFormValues {
  return {
    ...values,
    gpuBackend,
    shape: { ...values.shape, gpuProfile: gpuBackend === "profile" ? values.shape.gpuProfile : "" },
    gpuClaimName: gpuBackend === "dra" ? values.gpuClaimName : "",
    gpuClaimTemplateName: gpuBackend === "dra" ? values.gpuClaimTemplateName : "",
    gpuRequestName: gpuBackend === "dra" ? values.gpuRequestName : "",
    gpuTier: gpuBackend === "dra" ? values.gpuTier : "",
  };
}

// ---------------------------------------------------------------------------
// A1: identity.
// ---------------------------------------------------------------------------

/** What an empty namespace is refused with. */
export const sandboxNamespaceRequiredMessage =
  "A namespace is required: the sandbox, its launcher Pod, its scratch claim, the Secrets it names, the kernel and " +
  "GPU profiles it points at and the pool it can check a slot out of all live in one, and every one of those " +
  "references is namespace-local.";

/** What a name past the plain budget is refused with. */
export function sandboxNameTooLongMessage(length: number): string {
  return (
    `A sandbox name is at most ${maxObjectNameLength} characters; this one is ${length}. The name becomes a Pod ` +
    "name exactly - the launcher Pod is named after the sandbox and after nothing else - and a Pod name is a " +
    `DNS-1123 subdomain capped at ${maxObjectNameLength}.`
  );
}

/** What a name past the blank-scratch budget is refused with, with the arithmetic. */
export function sandboxNameTooLongForScratchMessage(length: number): string {
  return (
    `A sandbox with a blank scratch disk is named at most ${maxSandboxNameLengthWithScratchClaim} characters; this ` +
    `one is ${length}. The claim the controller creates is <name>${scratchClaimSuffix}, so the budget is ` +
    `${maxObjectNameLength} minus the ${scratchClaimSuffix.length} of "${scratchClaimSuffix}". Nothing upstream ` +
    "checks it: the sandbox is admitted, the claim can never be created, and it waits on Binding forever with an " +
    "empty phase."
  );
}

/** What a name that is not a DNS-1123 subdomain is refused with. */
export const sandboxNamePatternMessage =
  "A sandbox name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit. It " +
  "becomes the launcher Pod's name exactly, so what a Pod name accepts is what this accepts.";

/** Why a typed sandbox name would be refused, or `undefined` when it is legal. */
export function sandboxNameError(name: string, scratchSource: SandboxScratchSource = "none"): string | undefined {
  const trimmed = name.trim();

  if (!trimmed) {
    return "A name is required: it is what the launcher Pod, the runtime-intent ConfigMap and the NetworkPolicy are all named after, and what the scratch claim is the stem of.";
  }

  if (scratchSource === "blank" && trimmed.length > maxSandboxNameLengthWithScratchClaim) {
    return sandboxNameTooLongForScratchMessage(trimmed.length);
  }

  if (trimmed.length > maxObjectNameLength) {
    return sandboxNameTooLongMessage(trimmed.length);
  }

  if (!dnsSubdomainPattern.test(trimmed)) {
    return sandboxNamePatternMessage;
  }

  return undefined;
}

/**
 * The store collision warning: it warns, and it never blocks (S1, W12).
 *
 * A refused read makes the name UNVERIFIABLE rather than free, which is
 * SPEC-0013's `existingNamesUnverified` rule in a third place.
 */
export function sandboxNameWarning(inputs: SandboxFormInputs, values: SandboxFormValues): string | undefined {
  const name = values.name.trim();
  const namespace = values.namespace.trim();

  if (!name) {
    return undefined;
  }

  if (inputs.existingNames.includes(name)) {
    return `A SwiftSandbox named ${name} already exists in ${namespace}. The create will be refused, and this form stays open when it is.`;
  }

  if (inputs.existingNamesUnverified) {
    return (
      `The SwiftSandboxes of ${namespace || "this namespace"} could not be listed from here, so whether this name ` +
      "is already taken is unverified rather than answered. The API server answers it on submit."
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// A2: the checkout, the pool picker and the derivation (S3, S4, S5).
// ---------------------------------------------------------------------------

/** One option of the pool picker, with phase, warm and claimed on its label (S4). */
export interface SandboxPoolChoice {
  name: string;
  label: string;
  facts: SandboxPoolFacts;
}

/**
 * What one pool's option says beyond its name.
 *
 * A pool with no phase at all is the normal first state of this kind rather
 * than a fault - a reconcile that errors before the status update writes none,
 * and nothing ever writes `Pending` - so an absent phase reads as "no phase
 * yet" and not as a missing value.
 */
export function sandboxPoolSummary(pool: SandboxPoolFacts): string {
  const parts = [pool.phase ? pool.phase : "no phase yet"];

  parts.push(`${pool.warm ?? 0} warm`);
  parts.push(`${pool.claimed ?? 0} claimed`);

  return parts.join(", ");
}

/**
 * Every SwiftSandboxPool of the sandbox's OWN namespace, and none is disabled.
 *
 * Upstream's picker is cluster-wide while `poolRef` is a namespace-local
 * reference, and it shows neither the phase nor the counts its own gateway
 * already returns. Nothing here is disabled either: a cold or empty pool is a
 * slower boot, never an error, and blocking the checkout would make a miss into
 * a failure that upstream does not have.
 */
export function sandboxPoolChoices(inputs: SandboxFormInputs): SandboxPoolChoice[] {
  return inputs.pools.map((pool) => ({
    name: pool.name,
    label: `${pool.name} - ${sandboxPoolSummary(pool)}`,
    facts: pool,
  }));
}

/** The pool the form is pointing at, when the read on open returned it. */
export function pickedSandboxPool(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxPoolFacts | undefined {
  const name = values.pool.trim();

  return name ? inputs.pools.find((pool) => pool.name === name) : undefined;
}

/** Where the four "must match" fields came from, and what they are. */
export interface SandboxDerivedShape {
  /** `pool` when they were read from the picked pool, `form` when they are asked for. */
  source: "pool" | "form";
  image: string;
  cpu: string;
  memory: string;
  rootfsMode: string;
  /** When the pool list was read, because a pool has no immutability at all. */
  readAt?: string;
}

/**
 * The claimant's shape: read from the picked pool where that is possible, and
 * asked for where it is not (S3, and the T3 degradation of it).
 *
 * Four schema descriptions and the warm-pool documentation say a claimant "must
 * match" the pool's `image`, `cpu`, `memory` and `rootfsMode`. No webhook - the
 * pool has none at all - and no controller compares them, so a mismatched image
 * silently runs the workload inside the pool image's rootfs. Deriving the four
 * makes the mismatch INEXPRESSIBLE, which is stronger than validating it, and an
 * operator who wants a different shape wants the other radio option.
 *
 * The derivation is a snapshot: nothing on a pool is immutable, so the values
 * are what the pool held when the list was read, which is why `readAt` travels
 * with them and the summary says it out loud.
 */
export function sandboxDerivedShape(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxDerivedShape {
  const pool = values.source === "checkout" ? pickedSandboxPool(inputs, values) : undefined;

  if (!pool) {
    return {
      source: "form",
      image: values.shape.image.trim(),
      cpu: values.shape.cpu.trim() || defaultSlotCpu,
      memory: values.shape.memory.trim() || defaultSlotMemory,
      rootfsMode: values.shape.rootfsMode.trim() || defaultRootfsMode,
    };
  }

  return {
    source: "pool",
    image: pool.image ?? "",
    cpu: pool.cpu === undefined ? defaultSlotCpu : String(pool.cpu),
    memory: pool.memory ?? defaultSlotMemory,
    rootfsMode: pool.rootfsMode ?? defaultRootfsMode,
    readAt: inputs.poolsReadAt,
  };
}

/** Whether the four fields are controls of this form rather than facts read from a pool. */
export function sandboxShapeIsAsked(inputs: SandboxFormInputs, values: SandboxFormValues): boolean {
  return sandboxDerivedShape(inputs, values).source === "form";
}

/** What an empty pool name is refused with, on the branch that needs one. */
export const sandboxPoolRequiredMessage =
  "Name the SwiftSandboxPool this sandbox checks a slot out of. spec.poolRef.name defaults to the empty string in " +
  "the schema, so an empty reference is admitted and then looked up and reported not-found on every reconcile - it " +
  "is not the same thing as no pool at all.";

/**
 * What the degraded branch costs, said where the four controls come back.
 *
 * A read nobody was allowed to make is not evidence that the shape matches, and
 * it is not evidence that it does not: the create is not blocked on it, and the
 * form says what nothing on the cluster will ever say.
 */
export function sandboxShapeUnverifiedWarning(name: string): string {
  return (
    `The SwiftSandboxPools of this namespace could not be listed from here, so ${name} could not be read and its ` +
    "image, vCPUs, memory and root filesystem mode had to be asked for instead. Four schema descriptions say a " +
    "claimant must match the pool on exactly those four, and NOTHING compares them - not a webhook, because the " +
    "pool has none, and not the controller: a mismatched image silently runs this workload inside the pool image's " +
    "rootfs."
  );
}

/** What a pool the read really answered about, and did not hold, is warned with. */
export function sandboxPoolMissingWarning(name: string, namespace: string): string {
  return (
    `No SwiftSandboxPool named ${name} is in ${namespace || "this namespace"}. Nothing refuses the sandbox for it: ` +
    "the checkout simply misses and the cold path runs, which is a slower start rather than a failure. The four " +
    "fields it would have matched had to be asked for instead."
  );
}

/**
 * The command-less checkout warning (S5): it never blocks.
 *
 * Only the cold path resolves the image's own entrypoint, so a pooled sandbox
 * with no command ALWAYS cold-falls-back, whatever the pool is holding. Upstream
 * warns nowhere at all.
 */
export const commandlessCheckoutWarning =
  "This checkout names no command, so it will always cold-fall-back: only the cold path resolves the image's own " +
  "entrypoint, and the workload injected into a warm slot is the command and args of this sandbox. The pool's warm " +
  "slots are not used, the sub-second start is lost, and nothing reports it as anything other than a normal boot. " +
  "Adding one argv row is what makes the checkout a checkout.";

/**
 * Why the GPU section is not offered in checkout mode.
 *
 * Two webhook-only rules make `poolRef` exclusive with either GPU backend, and
 * with the webhook off the checkout runs FIRST and the GPU request is silently
 * ignored - so a sandbox that asked for a GPU and named a pool gets a slot with
 * no GPU and no error anywhere. Making the pair inexpressible is what stops that
 * (W12 option dropping, with the fact in the control's place).
 */
export const sandboxGpuDroppedInCheckoutReason =
  "A GPU sandbox always boots cold: a warm pool cannot hold a scarce GPU idle, so upstream declares poolRef " +
  "mutually exclusive with BOTH GPU backends. Both rules live only in the validating webhook, which ships disabled, " +
  "and with it off the checkout runs first and the GPU request is silently ignored - a sandbox with no GPU, no " +
  "error and nothing to read. Choose New microVM to ask for a GPU.";

// ---------------------------------------------------------------------------
// A7: the two expiries, as Go durations.
// ---------------------------------------------------------------------------

/** The unit suffixes Go's own duration parser accepts, longest first so `ms` beats `m`. */
const goDurationUnits: [string, number][] = [
  ["ns", 1e-6],
  ["us", 1e-3],
  ["µs", 1e-3],
  ["μs", 1e-3],
  ["ms", 1],
  ["s", 1000],
  ["m", 60_000],
  ["h", 3_600_000],
];

const goDurationTokenPattern = /(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/gy;

/**
 * A Go duration as milliseconds, or `undefined` when it is not one at all.
 *
 * Written from Go's own grammar - a sign, then one or more decimal-and-unit
 * pairs, with a bare `0` as the one value that needs no unit - because neither
 * `spec.timeout` nor `spec.ttl` carries a schema pattern or a format, and the
 * rules refusing a non-positive one are webhook-only. A negative value is
 * returned as a negative number rather than rejected here: the sign is what the
 * two refusals below are about, and the consequence of each differs.
 */
export function parseGoDurationMs(value: string): number | undefined {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const sign = trimmed.startsWith("-") ? -1 : 1;
  const body = trimmed.replace(/^[+-]/, "");

  if (!body) {
    return undefined;
  }

  // Go accepts a bare zero, with or without a unit, and nothing else unitless.
  if (/^0+(\.0*)?$/.test(body)) {
    return 0;
  }

  goDurationTokenPattern.lastIndex = 0;

  let total = 0;
  let consumed = 0;
  let match = goDurationTokenPattern.exec(body);

  while (match) {
    const magnitude = Number(match[1]);
    const unit = goDurationUnits.find(([suffix]) => suffix === match?.[2]);

    if (!Number.isFinite(magnitude) || !unit) {
      return undefined;
    }

    total += magnitude * unit[1];
    consumed = goDurationTokenPattern.lastIndex;
    match = goDurationTokenPattern.exec(body);
  }

  return consumed === body.length && consumed > 0 ? sign * total : undefined;
}

/** The grammar, as the hint under both duration fields states it. */
export const goDurationGrammar =
  "A Go duration: a number and a unit, or several of them run together - 30m, 90s, 1h30m, 500ms. The units are ns, " +
  "us, ms, s, m and h; there is no day unit, so a day is 24h.";

/** What a value that is not a Go duration at all is refused with. */
export const goDurationFormatMessage =
  "This is not a Go duration. Neither field carries a schema pattern or a format, so the API server stores whatever " +
  "is typed and the controller's own parse is what fails - on every reconcile, with the failure on the controller " +
  "rather than on this object.";

/** What a non-positive `timeout` really does, which is the reason it is refused. */
export const timeoutNotPositiveMessage =
  "A run cap has to be positive. Zero or less is already past startedAt the moment the sandbox starts, so the " +
  "controller force-terminates it on its first five-second poll and marks it Failed with a deadline reason: the " +
  "workload never runs. Leave the field empty for no cap at all.";

/** What a non-positive `ttl` really does, which is sharper still. */
export const ttlNotPositiveMessage =
  "A retention has to be positive. Zero or less has already elapsed the moment the sandbox turns terminal, so the " +
  "controller DELETES the SwiftSandbox object itself on its first terminal reconcile - the exit code, the message " +
  "and the conditions are gone before anyone reads them. Leave the field empty to keep it until it is deleted by " +
  "hand.";

/** Why a typed `timeout` would be refused, or `undefined` when it is legal. */
export function sandboxTimeoutError(timeout: string): string | undefined {
  const value = timeout.trim();

  if (!value) {
    return undefined;
  }

  const parsed = parseGoDurationMs(value);

  if (parsed === undefined) {
    return goDurationFormatMessage;
  }

  return parsed > 0 ? undefined : timeoutNotPositiveMessage;
}

/** Why a typed `ttl` would be refused, or `undefined` when it is legal. */
export function sandboxTtlError(ttl: string): string | undefined {
  const value = ttl.trim();

  if (!value) {
    return undefined;
  }

  const parsed = parseGoDurationMs(value);

  if (parsed === undefined) {
    return goDurationFormatMessage;
  }

  return parsed > 0 ? undefined : ttlNotPositiveMessage;
}

// ---------------------------------------------------------------------------
// A3: the workload's own rules.
// ---------------------------------------------------------------------------

/** The fields one argv row can carry a message on. */
export type ArgvMessages = { value?: string };

/**
 * Everything that would make an argv row wrong.
 *
 * An empty row is REFUSED rather than dropped, which is the opposite of the node
 * selector's rule one file section above, and the difference is position: a map
 * loses nothing when an unfilled row is dropped, while an argv array shifts
 * every element after it. A row the operator has not filled in is therefore
 * named and refused, and removing it is one click.
 */
export function argvErrors(rows: readonly ArgvRow[], list: ArgvList): ArgvMessages[] {
  return rows.map((row) => {
    if (row.value.trim()) {
      return {};
    }

    return {
      value:
        `An empty ${list === "command" ? "command" : "argument"} row would be an empty argv element, which shifts ` +
        "every element after it. Type the argument or remove the row - one row is one argument, which is what makes " +
        "a quoted argument impossible to split by accident.",
    };
  });
}

/** The fields one environment row can carry a message on. */
export type EnvField = "name" | "value";

export type EnvMessages = Partial<Record<EnvField, string>>;

export const envFieldLabels: Record<EnvField, string> = { name: "Name", value: "Value" };

const envFieldOrder: EnvField[] = ["name", "value"];

/**
 * Everything that would make an environment row wrong.
 *
 * `name` is the schema's own required field. The two refusals beyond it are
 * about the merge rather than about the schema: the variables are merged over
 * the image config's own environment as `NAME=value` lines, so a name carrying
 * whitespace or an `=` corrupts the line it lands in, and two rows with one name
 * silently keep one of the two.
 */
export function envErrors(values: SandboxFormValues): EnvMessages[] {
  const names = values.env.map((row) => row.name.trim());

  return values.env.map((row, index) => {
    const messages: EnvMessages = {};
    const name = row.name.trim();

    if (!name) {
      messages.name =
        "An environment variable needs a name: the schema requires it, and a nameless entry is one the API server " +
        "refuses outright.";
    } else if (/[\s=]/.test(name)) {
      messages.name =
        "An environment variable name carries no whitespace and no '='. The variables are merged over the image " +
        "config's own environment as NAME=value lines, so either character corrupts the line it lands in.";
    } else if (names.some((other, otherIndex) => otherIndex < index && other === name)) {
      messages.name = `Another row already sets ${name}. The merge keeps one of the two and says nothing about the other.`;
    }

    return messages;
  });
}

/** The same merge, said about one microVM rather than about a pool of slots. */
export const sandboxNodeSelectorMergeFact =
  `Whatever is set here is MERGED with the required ${kernelNodeLabel}: ${kernelNodeLabelValue} label, which the ` +
  "controller adds itself: a sandbox only ever runs on a kernel node, and this narrows that set rather than " +
  "replacing it.";

/** What an absent command means, which is what the schema says and not a missing value. */
export const imageEntrypointFact =
  "No command is given, so the image config's own Entrypoint and Cmd run. Any argument rows below are appended to " +
  "it, exactly as they would be to a command.";

// ---------------------------------------------------------------------------
// A5: the scratch disk's rules.
// ---------------------------------------------------------------------------

/** The fields the scratch-disk section can carry a message on. */
export type SandboxScratchField = "size" | "storageClass" | "claim";

export type SandboxScratchMessages = Partial<Record<SandboxScratchField, string>>;

export const sandboxScratchFieldLabels: Record<SandboxScratchField, string> = {
  size: "Scratch disk size",
  storageClass: "Scratch storage class",
  claim: "Scratch claim",
};

const sandboxScratchFieldOrder: SandboxScratchField[] = ["size", "storageClass", "claim"];

/** What `volumeMode` is not offered with: the fact that stands in the control's place. */
export const scratchVolumeModeFact =
  "The disk is ALWAYS attached as a raw Block device, so no volume mode is asked for. The field is a no-op on " +
  "three legs at once: the enum allows Filesystem, the webhook rejects it, and the controller hardcodes Block " +
  "whatever the object says.";

/** Everything that would make the scratch-disk section refuse the create. */
export function sandboxScratchErrors(values: SandboxFormValues): SandboxScratchMessages {
  const messages: SandboxScratchMessages = {};

  if (values.scratchSource === "blank") {
    const size = values.scratchSize.trim();

    if (!size) {
      messages.size =
        "A blank scratch disk needs a size, for example 100Gi. It is the one field the schema requires inside the " +
        "block, and the claim cannot be created without it.";
    } else {
      const sizeError = quantityError(size);

      if (sizeError) {
        messages.size = sizeError;
      }
    }

    const storageClass = values.scratchStorageClass.trim();

    if (storageClass && !dnsSubdomainPattern.test(storageClass)) {
      messages.storageClass =
        "A StorageClass name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a " +
        "digit. Empty uses the cluster's default class.";
    }
  }

  if (values.scratchSource === "existing" && !values.scratchClaim.trim()) {
    messages.claim =
      "Name the PersistentVolumeClaim to attach. scratchDisk.pvcRef.name defaults to the empty string in the " +
      "schema, so an empty reference is admitted and then looked up and reported not-found forever, with the " +
      "sandbox parked at an empty phase - it is not the same thing as no scratch disk.";
  }

  return messages;
}

/** The claim the existing branch is pointing at, when the read on open returned it. */
export function pickedScratchClaim(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxPvcFacts | undefined {
  const name = values.scratchClaim.trim();

  return name ? inputs.pvcs.find((pvc) => pvc.name === name) : undefined;
}

/** The volume mode a scratch claim has to have, which the description states and nothing enforces. */
export const scratchClaimVolumeMode = "Block";

/**
 * Everything worth saying about a scratch disk that would still be accepted.
 *
 * The `Filesystem` rule WARNS rather than refusing, and that is deliberate: it
 * is a schema description enforced nowhere at all - not by a CEL rule, not by
 * the webhook's own list - so refusing it here would be this form inventing an
 * admission the cluster does not have. The unreadable-claim branch warns for the
 * SPEC-0013 reason instead: a read that was refused is not evidence of anything.
 */
export function sandboxScratchWarnings(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxScratchMessages {
  const messages: SandboxScratchMessages = {};

  if (values.scratchSource !== "existing") {
    return messages;
  }

  const name = values.scratchClaim.trim();

  if (!name) {
    return messages;
  }

  if (inputs.pvcsUnverified) {
    messages.claim =
      "The PersistentVolumeClaims of this namespace could not be listed from here, so this name is unverified and " +
      `so is its volume mode. A scratch claim has to be ${scratchClaimVolumeMode}, and one that is missing or not ` +
      "Bound parks the sandbox at an empty phase with one False condition, requeued every three seconds, forever.";

    return messages;
  }

  const claim = pickedScratchClaim(inputs, values);

  if (!claim) {
    messages.claim =
      `No PersistentVolumeClaim named ${name} is in this namespace. Nothing refuses the sandbox for it: it is ` +
      "admitted and then parks at an empty phase with one False condition, requeued every three seconds, until the " +
      "claim exists and is Bound. It never turns terminal on its own.";

    return messages;
  }

  if (claim.volumeMode !== undefined && claim.volumeMode !== scratchClaimVolumeMode) {
    messages.claim =
      `The claim ${claim.name} is ${claim.volumeMode}, and a scratch disk is attached as a RAW block device - a ` +
      "Filesystem claim is a directory, and there is no device to hand to the guest. Nothing refuses it: the rule " +
      "is a schema description with no CEL and no webhook behind it, so the create is not blocked on it.";

    return messages;
  }

  if (claim.phase !== undefined && claim.phase !== "Bound") {
    messages.claim =
      `The claim ${claim.name} is ${claim.phase} rather than Bound. The sandbox is admitted and then parks at an ` +
      "empty phase with one False condition, requeued every three seconds, until it binds - and never turns " +
      "terminal on its own if it does not.";
  }

  return messages;
}

// ---------------------------------------------------------------------------
// A6: the GPU's own rules.
// ---------------------------------------------------------------------------

/** Whether the GPU section is offered at all, which a checkout decides. */
export function sandboxGpuApplies(values: SandboxFormValues): boolean {
  return values.source !== "checkout";
}

/** The fields the GPU section can carry a message on. */
export type SandboxGpuField = "profile" | "claimName" | "claimTemplateName" | "requestName";

export type SandboxGpuMessages = Partial<Record<SandboxGpuField, string>>;

export const sandboxGpuFieldLabels: Record<SandboxGpuField, string> = {
  profile: "GPU profile",
  claimName: "Resource claim",
  claimTemplateName: "Resource claim template",
  requestName: "Request name",
};

const sandboxGpuFieldOrder: SandboxGpuField[] = ["profile", "claimName", "claimTemplateName", "requestName"];

/** A DNS-1123 label, which is what one device request inside a claim is named as. */
const dnsLabelPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/**
 * Everything that would make the GPU section wrong.
 *
 * Empty whenever the section is not offered, because a section that is not
 * rendered cannot block a submit: the reason it was dropped stands in its place,
 * and the payload emits nothing for it either.
 *
 * There is no HGX refusal here, and its absence is the point: an unsupported
 * tier PARKS a sandbox - an empty phase with one False condition, requeued every
 * thirty seconds, forever - where it makes a POOL error-backoff with no status
 * at all. The parks-forever expectation is on the section's own header line
 * instead, which is where a fact that is not a refusal belongs.
 */
export function sandboxGpuErrors(values: SandboxFormValues): SandboxGpuMessages {
  const messages: SandboxGpuMessages = {};

  if (!sandboxGpuApplies(values) || values.gpuBackend === "none") {
    return messages;
  }

  if (values.gpuBackend === "profile") {
    if (!values.shape.gpuProfile.trim()) {
      messages.profile =
        "Name the SwiftGPUProfile this sandbox asks for: it is what says how many GPUs, of which model and in " +
        "which tier. gpuProfileRef.name defaults to the empty string in the schema, so an empty reference is " +
        "admitted and then parks the sandbox forever on a profile nobody named.";
    }

    return messages;
  }

  const claimName = values.gpuClaimName.trim();
  const templateName = values.gpuClaimTemplateName.trim();

  if (claimName && templateName) {
    messages.claimName =
      "A DRA claim is either a pre-created ResourceClaim or a ResourceClaimTemplate the scheduler mints one from, " +
      "never both: upstream declares the two mutually exclusive in the schema's own descriptions and enforces it " +
      "in a webhook that ships disabled.";
    messages.claimTemplateName = messages.claimName;
  } else if (!claimName && !templateName) {
    messages.claimName =
      "Name a ResourceClaim to share, or a ResourceClaimTemplate for a claim of this sandbox's own. A DRA backend " +
      "with neither allocates nothing at all.";
  }

  const requestName = values.gpuRequestName.trim();

  if (requestName && !dnsLabelPattern.test(requestName)) {
    messages.requestName =
      "A request name is lowercase letters, digits and '-', starting and ending with a letter or a digit: it names " +
      `one device request inside the claim, and empty means ${defaultSandboxGpuRequestName}.`;
  }

  return messages;
}

/** Everything worth saying about the GPU section that would still be accepted. */
export function sandboxGpuWarnings(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxGpuMessages {
  const messages: SandboxGpuMessages = {};

  if (!sandboxGpuApplies(values) || values.gpuBackend !== "profile") {
    return messages;
  }

  const shapeWarnings = slotShapeWarnings(inputs, values.shape, sandboxSlotWarningWording);

  if (shapeWarnings.gpuProfile) {
    messages.profile = shapeWarnings.gpuProfile;
  }

  return messages;
}

/** What a GPU costs at create time on this kind: a park, and not a failure. */
export const sandboxGpuParksFact =
  "A GPU is allocated before the launcher pod exists, so a profile that is missing, out of capacity or on a tier " +
  "this cluster cannot serve PARKS the sandbox: an empty phase with one False condition, requeued every thirty " +
  "seconds, indefinitely. It never turns terminal on its own, and nothing deletes it either.";

/** What choosing a GPU silently does to the kernel, which the schema says and no UI shows. */
export const sandboxGpuKernelFact =
  "Asking for a GPU switches the sandbox to the module-capable gpu-sandbox kernel unless a kernel profile is named " +
  "above, in which case the named one is used and has to carry the NVIDIA modules itself.";

// ---------------------------------------------------------------------------
// Errors, warnings and the submit verdict.
// ---------------------------------------------------------------------------

/**
 * The sandbox's own words for the shared reference warnings.
 *
 * Same conditions, different consequence: a name that resolves to nothing keeps
 * a pool from warming a single slot, and keeps THIS sandbox from ever booting.
 */
export const sandboxSlotWarningWording: SlotShapeWarningWording = {
  memoryLabel: "guest memory",
  kernelUnverified:
    "The SwiftKernels of this namespace could not be listed from here, so this name is unverified. A kernel " +
    "profile that does not exist is not refused at admission - the sandbox is admitted and its launcher never " +
    "boots.",
  kernelMissing: (name) =>
    `No SwiftKernel named ${name} is in this namespace. Nothing refuses the sandbox for it: it is admitted and the ` +
    "guest never boots, which is reported as a boot failure rather than as a missing reference.",
  gpuProfileMissing: (name) =>
    `No SwiftGPUProfile named ${name} is in this namespace. A sandbox whose profile cannot be resolved PARKS - an ` +
    "empty phase with one False condition, requeued every thirty seconds - indefinitely, and never turns terminal " +
    "on its own.",
  gpuProfileUnverified: (name) =>
    `The SwiftGPUProfiles of this namespace could not be listed from here, so ${name} is unverified: how many GPUs ` +
    "it asks for, and in which tier, are unknown from here. A profile that cannot be resolved parks the sandbox " +
    "forever rather than failing it. The create is not blocked on a read that failed.",
  secretUnverified: (what) =>
    "The Secrets of this namespace could not be listed from here, so this name is unverified. A Secret that does " +
    `not exist is not refused at admission - ${what} fails on the launcher instead.`,
  secretMissing: (name, what) =>
    `No Secret named ${name} is in this namespace. Nothing refuses the sandbox for it: ${what} fails, which is a ` +
    "TERMINAL failure - the sandbox goes Failed and never boots, and there is nothing to do but delete it and " +
    "create it again.",
};

/** The shape errors that apply to a sandbox, which is fewer than a pool's on a checkout. */
export function sandboxShapeErrors(inputs: SandboxFormInputs, values: SandboxFormValues): SlotShapeMessages {
  const errors: SlotShapeMessages = {};

  // Asked for on the cold path, and on the checkout branch where the pool could
  // not be read; read from the pool otherwise, where there is no control to
  // carry a message at all.
  if (sandboxShapeIsAsked(inputs, values)) {
    const image = slotImageError(values.shape.image, sandboxSlotRefusalWording);

    if (image) {
      errors.image = image;
    }

    const cpu = slotCpuError(values.shape.cpu, sandboxSlotRefusalWording);

    if (cpu) {
      errors.cpu = cpu;
    }

    const memory = slotMemoryError(values.shape.memory);

    if (memory) {
      errors.memory = memory;
    }
  }

  const mountPath = modelMountPathError(values.shape.modelMountPath, sandboxSlotRefusalWording);

  // Option dropping (W12): the control does not exist until a model image is
  // named, so the refusal exists only on the branch where it can matter.
  if (mountPath && values.shape.modelImageRef.trim()) {
    errors.modelMountPath = mountPath;
  }

  return errors;
}

/** The sandbox's own fields, keyed the way their messages are. */
export type SandboxOwnField = "namespace" | "name" | "pool" | "workingDir" | "timeout" | "ttl";

export type SandboxOwnMessages = Partial<Record<SandboxOwnField, string>>;

export const sandboxFieldLabels: Record<SandboxOwnField, string> = {
  namespace: "Namespace",
  name: "Name",
  pool: "Pool",
  workingDir: "Working directory",
  timeout: "Timeout",
  ttl: "TTL",
};

/** Everything that would make the sandbox's own flat fields refuse the create. */
export function sandboxOwnErrors(values: SandboxFormValues): SandboxOwnMessages {
  const errors: SandboxOwnMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace = sandboxNamespaceRequiredMessage;
  }

  const nameError = sandboxNameError(values.name, values.scratchSource);

  if (nameError) {
    errors.name = nameError;
  }

  if (values.source === "checkout" && !values.pool.trim()) {
    errors.pool = sandboxPoolRequiredMessage;
  }

  const timeoutError = sandboxTimeoutError(values.timeout);

  if (timeoutError) {
    errors.timeout = timeoutError;
  }

  const ttlError = sandboxTtlError(values.ttl);

  if (ttlError) {
    errors.ttl = ttlError;
  }

  return errors;
}

/** Everything worth saying about the sandbox's own fields that would still be accepted. */
export function sandboxOwnWarnings(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxOwnMessages {
  const warnings: SandboxOwnMessages = {};

  if (values.source !== "checkout") {
    return warnings;
  }

  const name = values.pool.trim();

  if (!name) {
    return warnings;
  }

  if (inputs.poolsUnverified) {
    warnings.pool = sandboxShapeUnverifiedWarning(name);
  } else if (!pickedSandboxPool(inputs, values)) {
    warnings.pool = sandboxPoolMissingWarning(name, values.namespace.trim());
  }

  return warnings;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface SandboxBlockingIssue {
  label: string;
  message: string;
}

/**
 * Every reason the form cannot be submitted, in the reading order of the form.
 *
 * A1, then A2, then the workload's rows, then the shape, then the scratch disk,
 * then the GPU, then the two expiries, then the model's mount path: a sentence
 * that pointed at the third environment row while the namespace was still empty
 * would be pointing past the first thing to fix. Every row-shaped reason names
 * its row, because a form with three arguments and two variables has several
 * fields called the same thing.
 */
export function sandboxBlockingIssues(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxBlockingIssue[] {
  const issues: SandboxBlockingIssue[] = [];
  const own = sandboxOwnErrors(values);
  const shape = sandboxShapeErrors(inputs, values);
  const scratch = sandboxScratchErrors(values);
  const gpu = sandboxGpuErrors(values);

  for (const field of ["namespace", "name", "pool"] as const) {
    const message = own[field];

    if (message) {
      issues.push({ label: sandboxFieldLabels[field], message });
    }
  }

  for (const list of ["command", "args"] as const) {
    argvErrors(values[list], list).forEach((messages, index) => {
      if (messages.value) {
        issues.push({ label: `${list === "command" ? "Command" : "Argument"} ${index + 1}`, message: messages.value });
      }
    });
  }

  envErrors(values).forEach((messages, index) => {
    for (const field of envFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Variable ${index + 1} ${envFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  for (const field of slotShapeFieldOrder) {
    const message = shape[field];

    if (message && field !== "modelMountPath") {
      issues.push({ label: slotShapeFieldLabels[field], message });
    }
  }

  nodeSelectorErrors(values.shape, sandboxSlotRefusalWording).forEach((messages, index) => {
    for (const field of nodeSelectorFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({ label: `Node selector ${index + 1} ${nodeSelectorFieldLabels[field].toLowerCase()}`, message });
      }
    }
  });

  for (const field of sandboxScratchFieldOrder) {
    const message = scratch[field];

    if (message) {
      issues.push({ label: sandboxScratchFieldLabels[field], message });
    }
  }

  for (const field of sandboxGpuFieldOrder) {
    const message = gpu[field];

    if (message) {
      issues.push({ label: sandboxGpuFieldLabels[field], message });
    }
  }

  for (const field of ["timeout", "ttl"] as const) {
    const message = own[field];

    if (message) {
      issues.push({ label: sandboxFieldLabels[field], message });
    }
  }

  if (shape.modelMountPath) {
    issues.push({ label: slotShapeFieldLabels.modelMountPath, message: shape.modelMountPath });
  }

  return issues;
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function sandboxSubmitBlockReason(inputs: SandboxFormInputs, values: SandboxFormValues): string | undefined {
  const [first] = sandboxBlockingIssues(inputs, values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/** Whether the collapsed scratch-disk section holds an error, so it opens itself. */
export function sandboxScratchSectionHasError(values: SandboxFormValues): boolean {
  return Object.keys(sandboxScratchErrors(values)).length > 0;
}

/** The same question for the GPU section. */
export function sandboxGpuSectionHasError(values: SandboxFormValues): boolean {
  return Object.keys(sandboxGpuErrors(values)).length > 0;
}

/** The same question for the model section, whose one refusal is a relative mount path. */
export function sandboxModelSectionHasError(inputs: SandboxFormInputs, values: SandboxFormValues): boolean {
  return Boolean(sandboxShapeErrors(inputs, values).modelMountPath);
}

// ---------------------------------------------------------------------------
// The payload.
// ---------------------------------------------------------------------------

/**
 * The sandbox spec this form sends.
 *
 * `memory` is optional HERE and required in the model, for the reason the pool's
 * payload type says: the schema marks it required and defaulted at once, and the
 * API server applies structural-schema defaults BEFORE it validates `required`.
 */
export type SandboxCreateSpec = Omit<SwiftSandboxSpec, "memory"> & { memory?: Quantity };

/** One argv list as the array the CRD declares, or `undefined` when no row carries one. */
export function argvPayload(rows: readonly ArgvRow[]): string[] | undefined {
  const values = rows.map((row) => row.value.trim()).filter((value) => value !== "");

  return values.length > 0 ? values : undefined;
}

/** The environment as the CRD declares it: literal values only, and never an empty name. */
export function envPayload(values: SandboxFormValues): SwiftSandboxEnvVar[] | undefined {
  const rows = values.env
    .filter((row) => row.name.trim() !== "")
    .map((row) => {
      const entry: SwiftSandboxEnvVar = { name: row.name.trim() };

      // An empty value is a real environment variable - it is set, and it is
      // empty - so it is sent as one rather than dropped.
      if (row.value !== "") {
        entry.value = row.value;
      }

      return entry;
    });

  return rows.length > 0 ? rows : undefined;
}

/**
 * The scratch disk, or `undefined`, and never `{}`.
 *
 * The empty block is the sharpest webhook-off consequence in this domain - the
 * controller dereferences a nil pointer on it - and the three-way control is
 * what makes it unbuildable. This function is the second half of that guarantee:
 * a branch that carries nothing produces no block at all, so no combination of
 * values can put an empty object on the wire (S7).
 */
export function scratchDiskPayload(values: SandboxFormValues): SwiftSandboxScratchDisk | undefined {
  if (values.scratchSource === "blank") {
    const size = values.scratchSize.trim();

    if (!size) {
      return undefined;
    }

    const storageClassName = values.scratchStorageClass.trim();

    // `volumeMode` is never sent: it is hardcoded to Block by the controller
    // whatever the object says, so sending it would be re-sending a value this
    // form does not own.
    return { blank: storageClassName ? { size, storageClassName } : { size } };
  }

  if (values.scratchSource === "existing") {
    const name = values.scratchClaim.trim();

    return name ? { pvcRef: { name } } : undefined;
  }

  return undefined;
}

/**
 * The GPU block, which is at most one of the two backends and never both.
 *
 * The guard is consulted rather than the control, the SPEC-0013 rule: a checkout
 * turns the whole section off without touching the values it holds, so the
 * answer has to be "what will be sent" and not "what the radio says".
 */
export function sandboxGpuPayload(
  values: SandboxFormValues,
): Pick<SandboxCreateSpec, "gpuProfileRef" | "gpuResourceClaim"> {
  if (!sandboxGpuApplies(values)) {
    return {};
  }

  if (values.gpuBackend === "profile") {
    const profile = values.shape.gpuProfile.trim();

    return profile ? { gpuProfileRef: { name: profile } } : {};
  }

  if (values.gpuBackend !== "dra") {
    return {};
  }

  const claimName = values.gpuClaimName.trim();
  const templateName = values.gpuClaimTemplateName.trim();

  if (!claimName && !templateName) {
    return {};
  }

  const claim: SwiftSandboxGpuResourceClaim = {};
  const requestName = values.gpuRequestName.trim();
  const tier = values.gpuTier.trim();

  // Exactly one, which is what upstream declares and what its disabled webhook
  // enforces. The shared claim wins on a form that somehow holds both, and the
  // submit is blocked on that state anyway.
  if (claimName) {
    claim.resourceClaimName = claimName;
  } else {
    claim.resourceClaimTemplateName = templateName;
  }

  if (requestName) {
    claim.requestName = requestName;
  }

  if (tier && tier !== defaultSandboxGpuTier) {
    claim.tier = tier;
  }

  // `hugepages` is not offered at all; the footer names it with its reason.
  return { gpuResourceClaim: claim };
}

/**
 * The object the create sends: the shape, the workload, the disk, the GPU and
 * the two expiries, with exactly the keys the form set (G7, S9).
 *
 * Two rules, one of them with one deliberate exception:
 *
 * - **No empty-name reference is ever emitted**, on any of the six blocks that
 *   carry one (`poolRef`, `kernelProfileRef`, `gpuProfileRef`,
 *   `verifyKeySecretRef`, `model`, `scratchDisk.pvcRef`). Five of the six
 *   default their `name` to the empty string in the schema, so an empty block is
 *   a reference the controller then looks up and reports not-found forever.
 * - **A value the API server stamps is not re-sent** - `cpu`, `memory`,
 *   `rootfsMode`, `network.mode`, `model.mountPath` and `gpuResourceClaim.tier`
 *   - EXCEPT on the derived branch of a checkout, where the four "must match"
 *   fields are sent from the pool even when they happen to equal the schema's
 *   own defaults. They are not this operator's choice and not the schema's
 *   value there: they are a reading of another object at a point in time, and
 *   what makes the claim auditable afterwards is that the stored sandbox says
 *   so rather than carrying a default that looks identical.
 */
export function sandboxCreatePayload(
  inputs: SandboxFormInputs,
  values: SandboxFormValues,
): { spec: SandboxCreateSpec } {
  const spec: SandboxCreateSpec = { ...slotShapePayload(values.shape) };
  const derived = sandboxDerivedShape(inputs, values);

  if (values.source === "checkout") {
    const pool = values.pool.trim();

    if (pool) {
      spec.poolRef = { name: pool };
    }

    if (derived.source === "pool") {
      const cpu = warmCount(derived.cpu);

      if (derived.image) {
        spec.image = derived.image;
      }

      if (cpu !== undefined) {
        spec.cpu = cpu;
      }

      spec.memory = derived.memory;
      spec.rootfsMode = derived.rootfsMode;
    }
  }

  const command = argvPayload(values.command);
  const args = argvPayload(values.args);
  const workingDir = values.workingDir.trim();
  const env = envPayload(values);
  const scratchDisk = scratchDiskPayload(values);
  const timeout = values.timeout.trim();
  const ttl = values.ttl.trim();

  if (command) {
    spec.command = command;
  }

  if (args) {
    spec.args = args;
  }

  if (workingDir) {
    spec.workingDir = workingDir;
  }

  if (env) {
    spec.env = env;
  }

  if (scratchDisk) {
    spec.scratchDisk = scratchDisk;
  }

  if (timeout) {
    spec.timeout = timeout;
  }

  if (ttl) {
    spec.ttl = ttl;
  }

  // The shape's own GPU key is replaced rather than trusted, because the mode
  // and the backend both decide it and neither of them is the control that
  // wrote `shape.gpuProfile`.
  delete spec.gpuProfileRef;
  Object.assign(spec, sandboxGpuPayload(values));

  return { spec };
}

// ---------------------------------------------------------------------------
// The header lines of the four collapsed sections (DESIGN.md section 12).
//
// Short, with the long form of each fact left to the summary, which is the
// grammar every shipped form of this repository uses. Each one is readable
// whether its section is open or shut, which is what makes the section
// collapsible at all.
// ---------------------------------------------------------------------------

/**
 * The line the scratch-disk section carries, open or shut.
 *
 * Short, and deliberately not a summary of what is inside it: the three radio
 * descriptions and the always-Block fact are one scroll below, and the
 * screenshot pass caught this line saying both of those things again in the
 * same screen - the duplication SPEC-0013 slice 3 removed from the GPU section,
 * made a second time. The long form of each fact lives in the summary.
 */
export function sandboxScratchSectionHint(values: SandboxFormValues): string {
  if (values.scratchSource === "blank") {
    const size = values.scratchSize.trim();
    // A size that is being refused is not quoted back as if it were one: "a new
    // 0 claim" reads as a fact about the object rather than as the value under
    // the red line below it.
    const sized = size && !quantityError(size) ? `${size} ` : "";

    return `A new ${sized}claim named ${values.name.trim() || "<name>"}${scratchClaimSuffix}, created with this sandbox and deleted with it.`;
  }

  if (values.scratchSource === "existing") {
    const claim = values.scratchClaim.trim();

    return `${claim || "An existing claim"}, which outlives this sandbox rather than being owned by it. The sandbox parks until it is Bound.`;
  }

  return "None. The workload has only the guest's own RAM to write into, and whatever it writes is gone when the sandbox ends.";
}

/** The line the GPU section carries, open or shut. */
export function sandboxGpuSectionLine(values: SandboxFormValues): string {
  if (values.gpuBackend === "profile") {
    const profile = values.shape.gpuProfile.trim();

    return `${profile || "A SwiftGPUProfile"}, allocated before the launcher pod exists. A profile that cannot be served parks this sandbox forever rather than failing it.`;
  }

  if (values.gpuBackend === "dra") {
    return "A DRA resource claim, allocated by the scheduler. A claim that cannot be satisfied leaves the pod unschedulable rather than failing the sandbox.";
  }

  return "None. A GPU is passed through whole, and a sandbox that asks for one boots cold and parks until the devices are free.";
}

/** The line the registry and verification section carries, open or shut. */
export function sandboxRegistrySectionLine(shape: SlotShapeValues): string {
  const parts: string[] = [];

  if (shape.imagePullSecret.trim()) {
    parts.push(`Pulled with ${shape.imagePullSecret.trim()}`);
  }

  if (shape.verifyKeySecret.trim()) {
    parts.push(`cosign-verified against ${shape.verifyKeySecret.trim()}`);
  }

  if (parts.length === 0) {
    return "None. A public image and no signature check.";
  }

  const [first, ...rest] = parts;
  const head = first.charAt(0).toUpperCase() + first.slice(1);

  return `${[head, ...rest].join(", ")}. A failed verification is TERMINAL: the sandbox never boots.`;
}

/** The line the model section carries, open or shut. */
export function sandboxModelSectionLine(shape: SlotShapeValues): string {
  const imageRef = shape.modelImageRef.trim();

  if (!imageRef) {
    return "None. Nothing is preloaded, and a workload that needs weights pulls or mounts them itself.";
  }

  // Short, for the reason the scratch section's line is: how the model gets
  // there is on the field itself and in the summary, one scroll apart, and
  // saying it here as well put the same sentence twice in one screen.
  return `${imageRef}, mounted at ${shape.modelMountPath.trim() || defaultModelMountPath}. A model that cannot be resolved is TERMINAL.`;
}

// ---------------------------------------------------------------------------
// The write summary (W1, W12).
// ---------------------------------------------------------------------------

/** The facts the live write summary is built from. The component owns the JSX. */
export interface SandboxCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/** What the create makes, which is the whole of what this write sets in motion. */
export function sandboxCreatesFact(values: SandboxFormValues): string {
  const name = values.name.trim() || "<name>";
  const created = ["a runtime-intent ConfigMap", `a Pod named exactly ${name}`];

  if ((values.shape.networkMode.trim() || defaultNetworkMode) !== "none") {
    created.push("a NetworkPolicy");
  }

  if (values.scratchSource === "blank") {
    created.push(`a claim named ${name}${scratchClaimSuffix}`);
  }

  return (
    `The controller creates ${created.join(", ")}, all owned by this sandbox. No Service and no Secret are EVER ` +
    "created for a sandbox, whatever it asks for."
  );
}

/** What a checkout does, which is not what a miss makes it. */
export const sandboxCheckoutFact =
  "A checkout claims one of the pool's pre-booted slots if a warm one is free, and cold-boots if none is - which " +
  "is a slower start and NOT a failure. The claimed slot's pod is named after the POOL rather than after this " +
  "sandbox, and status.podRef is the only place it is ever visible.";

/** Where the four derived fields came from, and when, since a pool is mutable. */
export function sandboxDerivationFact(derived: SandboxDerivedShape, pool: string): string {
  return (
    `The image, vCPUs, memory and root filesystem mode are read from ${pool} as it stood ` +
    `${derived.readAt ? `at ${derived.readAt}` : "when this dialog opened"} and are sent from it. Nothing on a pool ` +
    "is immutable, so this is a snapshot: if the pool is edited afterwards, the slots that are already warm keep " +
    "the shape they booted with and this sandbox keeps the shape recorded here."
  );
}

/** The phase honesty of this kind, which is correction 3 owed to SPEC-0008. */
export const sandboxFirstPhaseFact =
  "The first state you see is an EMPTY phase, not Pending: that value is in the enum, in the metrics labels and in " +
  "a test, and is written by no controller at all. A sandbox with no phase is a normal first state rather than a " +
  "fault.";

/** What parks, and never turns terminal on its own. */
export const sandboxParksFact =
  "Nothing here self-heals. What PARKS, as an empty phase with one False condition, indefinitely: a GPU profile " +
  "that is missing, out of capacity or on an unsupported tier (requeued every thirty seconds), and a scratch claim " +
  "that is missing or not Bound (every three seconds). A parked sandbox waits forever and nothing deletes it.";

/** What is terminal, and what the only remedy is. */
export const sandboxTerminalFact =
  "What is TERMINAL, and needs a delete and a re-create rather than a wait: an invalid pull secret, an image or a " +
  "model that cannot be resolved, a non-zero materialize exit, a timeout breach, and a Failed pod. There is no " +
  "retry and no self-heal on any of them.";

/** What `ttl` does to the object being created, which is the sentence this form exists to say. */
export function sandboxTtlFact(values: SandboxFormValues): string {
  const ttl = values.ttl.trim();

  if (!ttl) {
    return "No TTL is set, so this SwiftSandbox is kept until someone deletes it - the exit code, the message and the conditions stay readable for as long as that.";
  }

  return (
    `Once this sandbox has been terminal - Completed or Failed - for ${ttl}, the controller DELETES the ` +
    "SwiftSandbox object itself, not just its pod: it disappears from this list, and its exit code, message and " +
    "conditions go with it."
  );
}

/** What a `timeout` does, which deletes a pod rather than an object. */
export function sandboxTimeoutFact(values: SandboxFormValues): string {
  const timeout = values.timeout.trim();

  if (!timeout) {
    return "No timeout is set, so there is no run cap at all: a workload that never ends keeps its microVM alive until something else stops it.";
  }

  return `Past startedAt plus ${timeout} the controller force-terminates the launcher or the claimed slot and marks this sandbox Failed with a deadline reason. The object itself stays behind, which is what makes it different from the TTL.`;
}

/** What the workload actually is, in the one line a reader needs before pressing OK. */
export function sandboxWorkloadFact(values: SandboxFormValues): string {
  const command = argvPayload(values.command);
  const args = argvPayload(values.args);
  const parts: string[] = [];

  parts.push(
    command
      ? `The workload is ${command.join(" ")}${args ? ` ${args.join(" ")}` : ""}, one argv element per row - nothing is split on whitespace.`
      : `No command is given, so the image's own entrypoint runs${args ? `, with ${args.join(" ")} appended to it` : ""}.`,
  );

  const workingDir = values.workingDir.trim();

  if (workingDir) {
    parts.push(`It runs in ${workingDir}, which overrides the image config's own working directory.`);
  }

  const env = envPayload(values);

  if (env) {
    parts.push(
      `${env.length} environment ${env.length === 1 ? "variable is" : "variables are"} merged over the image config's own environment, as literal values.`,
    );
  }

  return parts.join(" ");
}

/** What the scratch disk is, and what happens to it, which differs by branch. */
export function sandboxScratchFact(values: SandboxFormValues): string | undefined {
  if (values.scratchSource === "blank") {
    const size = values.scratchSize.trim();
    const storageClass = values.scratchStorageClass.trim();

    return (
      `A ${size || "sized"} claim named ${values.name.trim() || "<name>"}${scratchClaimSuffix} is created, owned by ` +
      `this sandbox and DELETED with it, from ${storageClass ? `the ${storageClass} storage class` : "the cluster's default storage class"}. ` +
      "It is attached as a raw block device, so the workload runs mkfs on it, and the sandbox parks until it binds."
    );
  }

  if (values.scratchSource === "existing") {
    return (
      `The claim ${values.scratchClaim.trim() || "<claim>"} is attached as a raw block device. It is NOT owned by ` +
      "the sandbox and survives it, which is the case for a cache reused across runs, and the sandbox parks at an " +
      "empty phase until it exists and is Bound."
    );
  }

  return undefined;
}

/** What a native GPU profile costs at create time, and what it does to the kernel. */
export function sandboxGpuFact(values: SandboxFormValues): string | undefined {
  if (!sandboxGpuApplies(values) || values.gpuBackend === "none") {
    return undefined;
  }

  const backend =
    values.gpuBackend === "profile"
      ? `The SwiftGPU controller allocates from ${values.shape.gpuProfile.trim() || "the named profile"} before the launcher pod exists and pins the pod to the node it chose.`
      : "The kube-scheduler allocates the device through the DRA claim and the KubeSwift driver injects it into the guest.";

  return `${backend} ${sandboxGpuParksFact} ${sandboxGpuKernelFact}`;
}

/** What the verification key really does, which is terminal rather than a retry. */
export function sandboxVerifyFact(values: SandboxFormValues): string {
  return (
    `The rootfs is cosign-verified against the key in ${values.shape.verifyKeySecret.trim()} before it is ` +
    "materialized, and the digest is re-pinned to the verified one, so a tag that moves between the verification " +
    "and the pull cannot be pulled. A missing or invalid signature fails the materialize step, which is TERMINAL: " +
    "the sandbox goes Failed and never boots. It needs a TLS registry."
  );
}

/** What the model preload buys, and where the workload finds it. */
export function sandboxModelFact(values: SandboxFormValues): string {
  const mountPath = values.shape.modelMountPath.trim() || defaultModelMountPath;

  return (
    `The model ${values.shape.modelImageRef.trim()} is mounted read-only at ${mountPath} over virtio-fs, ` +
    "materialized once per node and shared from the host page cache, so the weights are resident before the " +
    "workload runs. A model image that cannot be resolved is terminal."
  );
}

/**
 * The live write summary: the one create line, then the facts that are true of
 * this sandbox in this state (W1, rebuilt on every change).
 *
 * The order is the order things happen: what it is, what it runs, what the
 * create makes, what it costs, and then what the object will and will not tell
 * anyone afterwards - which is the half nothing on the cluster ever says.
 */
export function sandboxCreateSummary(inputs: SandboxFormInputs, values: SandboxFormValues): SandboxCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const derived = sandboxDerivedShape(inputs, values);
  const notes: string[] = [];
  const warnings: string[] = [];

  if (derived.image) {
    notes.push(
      `This sandbox boots ${derived.image} as its root filesystem, delivered as ${derived.rootfsMode}, with ${derived.cpu} vCPU and ${derived.memory} of RAM.`,
    );
  }

  if (values.source === "checkout") {
    notes.push(sandboxCheckoutFact);

    if (derived.source === "pool") {
      notes.push(sandboxDerivationFact(derived, values.pool.trim()));
    }
  }

  notes.push(sandboxWorkloadFact(values));
  notes.push(sandboxCreatesFact(values));

  const scratch = sandboxScratchFact(values);

  if (scratch) {
    notes.push(scratch);
  }

  const gpu = sandboxGpuFact(values);

  if (gpu) {
    notes.push(gpu);
  }

  if (values.shape.verifyKeySecret.trim()) {
    notes.push(sandboxVerifyFact(values));
  }

  if (values.shape.modelImageRef.trim()) {
    notes.push(sandboxModelFact(values));
  }

  if (nodeSelectorPayload(values.shape)) {
    notes.push(nodeSelectorMergeFact);
  }

  notes.push(sandboxFirstPhaseFact);
  notes.push(sandboxParksFact);
  notes.push(sandboxTerminalFact);
  notes.push(sandboxTimeoutFact(values));
  notes.push(sandboxTtlFact(values));
  notes.push(sandboxImmutabilityBoundary.sandbox);

  const collision = sandboxNameWarning(inputs, values);

  if (collision) {
    warnings.push(collision);
  }

  if (values.source === "checkout" && !argvPayload(values.command)) {
    warnings.push(commandlessCheckoutWarning);
  }

  // The sharpest sentences are stated twice on purpose, at the field and here:
  // the summary is what a user reads before pressing OK, and on a form this
  // tall it sits below the fold of the dialog's own scroll area.
  const own = sandboxOwnWarnings(inputs, values);

  if (own.pool) {
    warnings.push(own.pool);
  }

  const scratchWarning = sandboxScratchWarnings(inputs, values).claim;

  if (scratchWarning) {
    warnings.push(scratchWarning);
  }

  const shapeWarnings = slotShapeWarnings(inputs, values.shape, sandboxSlotWarningWording);

  for (const field of slotShapeFieldOrder) {
    const warning = shapeWarnings[field];

    // The GPU profile's own warning is dropped with the section it belongs to,
    // for the reason the payload drops the reference: a checkout sends no GPU.
    if (warning && (field !== "gpuProfile" || sandboxGpuApplies(values))) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftSandbox ${namespace}/${name}`, notes, warnings };
}

// ---------------------------------------------------------------------------
// The outcome (W9).
// ---------------------------------------------------------------------------

/** What a create that succeeded is acknowledged with: the fact, never a prediction. */
export function sandboxCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftSandbox ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the sentence it is prefixed with. */
export interface SandboxCreateFailureContext {
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
export function sandboxCreateFailurePrefix(
  code: number | undefined,
  context: SandboxCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftSandbox named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftSandbox CRD is gone.`;
  }

  if (code === forbiddenStatusCode) {
    return writeFailurePrefix(code, { verb: "create", resource: "swiftsandboxes", namespace: context.namespace });
  }

  return undefined;
}

/** One actionable sentence prefixed to what the API server said, never replacing it (W9). */
export function sandboxCreateFailureMessage(
  failure: ApiFailureFacts,
  context: SandboxCreateFailureContext,
): string | undefined {
  const prefix = sandboxCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/**
 * What this form does NOT author, said rather than left to be discovered (A10).
 *
 * Three leaves, each with the reason it is absent rather than a bare list: two
 * of them are no-ops the schema still declares, and the third is sixteen leaves
 * of boilerplate that the controller reads and then ignores.
 */
export const sandboxCreateFooter =
  "Three things this form deliberately does not author, each reachable in Freelens' own YAML editor. " +
  "env[].valueFrom is schema-complete and behaviourally IGNORED: the merge takes the literal value only, because a " +
  "microVM has no downward-API and no Secret path, so a secretKeyRef variable reaches the guest empty. " +
  "scratchDisk.blank.volumeMode is a no-op on three legs - the enum allows Filesystem, the webhook rejects it, and " +
  "the controller hardcodes Block - so the disk is ALWAYS Block and no control asks about it. " +
  "gpuResourceClaim.hugepages sizes the GPU memory hugepage backing and belongs with the cluster's own hugepage " +
  "configuration rather than with a create form. Editing a sandbox afterwards is the YAML editor's job too, and " +
  "only ttl actually changes anything.";

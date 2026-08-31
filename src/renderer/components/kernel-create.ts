/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Kernel form decides, as pure functions over structurally
// declared inputs (SPEC-0014, "Where the code lives"): the defaults, the five
// webhook-only rules, the payload the create sends, the live write summary, and
// the sentences the notifications carry.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which Secrets and nodes the reads on open returned,
// which kernel names the store happens to hold - is taken as an argument.
//
// What creating a SwiftKernel mechanically IS, and why almost none of it is in
// the schema (four leaves, no CEL, no defaults, no patterns):
//
// - The controller lists the nodes carrying `kubeswift.io/kernel-node=true` -
//   an equality match on the literal string - and creates ONE JOB PER NODE, not
//   a DaemonSet. `Pending` means only "no node carries the label", which is why
//   the count is read on open and stated before the write (F12).
// - `Ready` means every labelled node's Job exited zero. It does NOT mean the
//   kernel and initramfs files landed: nothing verifies the artifact's content,
//   so an artifact missing the kernel reaches `Ready` all the same.
// - `Failed` is terminal AND enforced as terminal. Recovery is
//   delete-and-recreate; deleting the pull Job, which the docs prescribe, does
//   nothing on its own, because the phase has to be cleared too - and a node
//   labelled after the failure never gets a Job while the scheduler will still
//   place kernel-boot pods on it (F13, and deliberately NOT SPEC-0013's
//   self-heal sentence).
// - `spec.ociRef.pullSecret` is wired to the pod's image-pull secrets, so it
//   authenticates the ORAS CONTAINER IMAGE and not the `oras pull` of the
//   artifact. It is offered rather than dropped because it is not a no-op - it
//   just answers a different question from the one an operator reaching for it
//   is asking (F19).
// - Re-pointing `ociRef.image` afterwards is a silent no-op: the Job's name
//   carries no image and no digest, so nothing re-pulls.
// - `spec.profile` is free text with ZERO code consumers. Its only effects are
//   a printer column and a drawer row; `spec.kernelProfileRef` on a guest
//   selects a kernel by `metadata.name`, not by this.
//
// Five of the validator's six rules live only in the webhook, and that webhook
// ships disabled (`webhook.enabled: false`), so on a normal install nobody else
// produces these messages at all (W12).

import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import { conflictStatusCode, isKernelNode, kernelNodeLabel, kernelNodeLabelValue } from "./migration-create";
import { objectNameError } from "./snapshot-create";

import type { SwiftKernelSpec } from "../api/kubeswift/swiftkernel-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";
import type { NodeFacts } from "./migration-create";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createKernelTitle = "Create Kernel";

/** The form's fields, all of them typed. */
export interface KernelFormValues {
  namespace: string;
  name: string;
  /** `spec.ociRef.image`, the one field the schema requires. */
  image: string;
  /** `spec.ociRef.pullSecret`, which reaches less far than its name suggests. */
  pullSecret: string;
  kernelCmdline: string;
  profile: string;
}

/** What the reads on open found. */
export interface KernelCreateInputs {
  /** The namespace's Secret names, for the pull-secret picker and its T3 degradation. */
  secrets: string[];
  secretsUnverified: boolean;
  /** The cluster's nodes, for the labelled-node count the summary states. */
  nodes: NodeFacts[];
  /** True when that read was refused, which makes the count unverified and NEVER zero. */
  nodesUnverified: boolean;
  /** The namespace's SwiftKernel names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
}

/**
 * The form as it opens.
 *
 * The namespace comes from the page's own filter when it names exactly one and
 * is otherwise empty and required (F2) - never the literal `default`, which
 * looks deliberate and is not.
 */
export function defaultKernelForm(namespace = ""): KernelFormValues {
  return {
    namespace,
    name: "",
    image: "",
    pullSecret: "",
    kernelCmdline: "",
    profile: "",
  };
}

/**
 * The characters upstream's validator refuses in the image reference.
 *
 * An OCI reference is a registry, a path, a tag and a digest, and none of them
 * needs any of these. The rule lives only in the webhook, so this is the only
 * place it is enforced on a default install; the space is in the list because
 * an internal space is as much a shell separator as a semicolon is.
 */
const shellMetacharacters = [
  ";",
  "&",
  "|",
  "$",
  "`",
  "(",
  ")",
  "<",
  ">",
  "\\",
  "'",
  '"',
  "*",
  "?",
  "{",
  "}",
  "[",
  "]",
  "!",
  "#",
  "~",
  " ",
  "\t",
];

/** The path segment upstream refuses outright, and what it prevents. */
export const imageTraversalMessage =
  "An image reference containing .. is refused upstream as a path traversal: the reference is what the pull Job " +
  "builds the artifact's path from on every labelled node, and .. is how a path leaves the directory it was meant " +
  "to stay in.";

/** What an empty reference is refused with. */
export const imageRequiredMessage =
  "An OCI image reference is required: it is the one field the schema requires, and it is the whole content of " +
  "this object.";

/** What a padded reference is refused with. */
export const imagePaddedMessage =
  "The reference has whitespace around it. Upstream refuses that rather than trimming it, and a reference that " +
  "reaches the pull with a leading space is a registry lookup that fails with a message about a name nobody typed.";

/** What a reference carrying a shell metacharacter is refused with. */
export function imageMetacharacterMessage(character: string): string {
  const shown = character === " " ? "a space" : character === "\t" ? "a tab" : `'${character}'`;

  return (
    `The reference contains ${shown}, which upstream's validator refuses as a shell metacharacter. None of a ` +
    "registry, a path, a tag or a digest needs one, and the validator that would have caught it ships disabled."
  );
}

/**
 * Why a typed image reference would be refused, or `undefined` when it is legal.
 *
 * The four rules in the order they are checked, each naming what it prevents.
 * The raw value is what arrives here, not a trimmed one, because the second
 * rule is about exactly that difference.
 */
export function kernelImageError(image: string): string | undefined {
  if (!image.trim()) {
    return imageRequiredMessage;
  }

  if (image !== image.trim()) {
    return imagePaddedMessage;
  }

  const offending = shellMetacharacters.find((character) => image.includes(character));

  if (offending) {
    return imageMetacharacterMessage(offending);
  }

  if (image.includes("..")) {
    return imageTraversalMessage;
  }

  return undefined;
}

/** What a command line carrying a control character is refused with. */
export const kernelCmdlineControlCharacterMessage =
  "A kernel command line cannot contain a newline, a carriage return or a NUL. Upstream refuses all three in a " +
  "webhook that ships disabled, and what they would otherwise reach is the hypervisor argument itself, unvalidated.";

/**
 * Why a typed kernel command line would be refused, or `undefined` when it is
 * legal.
 *
 * The fifth of the validator's six rules, and the only one about a field that
 * is optional: an empty command line is not a refusal, it is the normal case.
 */
export function kernelCmdlineError(kernelCmdline: string): string | undefined {
  return /[\n\r\0]/.test(kernelCmdline) ? kernelCmdlineControlCharacterMessage : undefined;
}

/** How far the pull secret really reaches, said at the field (F19). */
export const pullSecretReachFact =
  "This Secret authenticates the ORAS container image the pull Job runs - it is wired to the pod's image-pull " +
  "secrets - and not the oras pull of the kernel artifact itself. A private registry holding the artifact is not " +
  "what this field solves, and upstream documents the limit nowhere.";

/** What `spec.profile` is, said at the field (W12 option dropping's honest cousin). */
export const profileFact =
  "A free-text label with no code consumers: it fills the Profile column and a drawer row, and nothing selects on " +
  "it. A guest's spec.kernelProfileRef picks a kernel by metadata.name, not by this. The samples' values are a " +
  "hint rather than an enum.";

/** SPEC-0013's sentence, from the other end: a guest replaces this line, it does not extend it. */
export const kernelCmdlineReplacedFact =
  "A guest's own spec.kernelCmdline replaces this line rather than being appended to it, so a guest that overrides " +
  "it loses whatever is set here.";

/** What `Ready` does and does not mean for this object. */
export const kernelReadyFact =
  "Ready means every labelled node's Job exited zero. It does not mean the kernel and the initramfs landed: " +
  "nothing verifies the artifact's content, so an artifact missing the kernel reaches Ready all the same.";

/** The terminal-`Failed` vocabulary (F13). Deliberately not SPEC-0013's self-heal sentence. */
export const kernelTerminalFailedFact =
  "Failed is terminal and is enforced as terminal: a failed pull needs delete-and-recreate. Deleting the pull Job, " +
  "which the docs prescribe, does nothing on its own - the phase has to be cleared too - and a node labelled after " +
  "the failure never gets a Job, while the scheduler will still place kernel-boot guests on it.";

/** Re-pointing the image afterwards changes nothing, which is worth knowing before the name is chosen. */
export const kernelImageIsImmutableInPracticeFact =
  "Re-pointing ociRef.image on this object later is a silent no-op: the pull Job's name carries no image and no " +
  "digest, so nothing re-pulls. A new artifact is a new SwiftKernel.";

/** The nodes a pull Job will be created on, as the read on open found them. */
export function kernelNodes(inputs: KernelCreateInputs): NodeFacts[] {
  return inputs.nodes.filter((node) => isKernelNode(node));
}

/**
 * How many nodes will get a pull Job, stated before the write (F12).
 *
 * A refused read makes the count **unverified, never zero**: "no node carries
 * the label" and "we could not look" are different sentences, and only one of
 * them is a reason to hesitate.
 */
export function kernelNodeCountFact(inputs: KernelCreateInputs): string {
  if (inputs.nodesUnverified) {
    return (
      "The cluster's nodes could not be listed from here, so how many carry " +
      `${kernelNodeLabel}: ${kernelNodeLabelValue} is unverified - not zero. The controller creates one pull Job ` +
      "per labelled node."
    );
  }

  const count = kernelNodes(inputs).length;

  if (count === 0) {
    return (
      `No node in this cluster carries ${kernelNodeLabel}: ${kernelNodeLabelValue}, so the controller creates no ` +
      "Job at all and this kernel sits in Pending. Pending means exactly that and nothing else; labelling a node " +
      "afterwards starts the pull."
    );
  }

  return (
    `${count} ${count === 1 ? "node carries" : "nodes carry"} ${kernelNodeLabel}: ${kernelNodeLabelValue}, so the ` +
    `controller creates ${count === 1 ? "one pull Job" : `${count} pull Jobs`}, one per node - it is not a ` +
    "DaemonSet."
  );
}

/** True when the count is a real zero rather than an unverified one, which is the only warning case. */
export function kernelWillParkInPending(inputs: KernelCreateInputs): boolean {
  return !inputs.nodesUnverified && kernelNodes(inputs).length === 0;
}

/** Every field of the form, keyed the way the messages are. */
export type KernelCreateField = keyof KernelFormValues;

/** Messages keyed by field, for the inline errors and the inline warnings. */
export type KernelFieldMessages = Partial<Record<KernelCreateField, string>>;

/** How each field reads in the sentence next to the disabled submit button (W12). */
export const kernelFieldLabels: Record<KernelCreateField, string> = {
  namespace: "Namespace",
  name: "Name",
  image: "OCI image",
  pullSecret: "Pull secret",
  kernelCmdline: "Kernel command line",
  profile: "Profile",
};

/** The reading order of the form, which is the order the blocked sentence names fields in. */
const fieldOrder: KernelCreateField[] = ["namespace", "name", "image", "pullSecret", "kernelCmdline", "profile"];

/**
 * Everything that would make this create fail, keyed by field.
 *
 * Five of the six are the admission webhook's own rules, and this is the only
 * place they are enforced on a default install: upstream ships that webhook
 * disabled, so nobody else produces these messages and the mistake surfaces
 * later as a pull that fails on every labelled node at once.
 */
export function kernelCreateErrors(values: KernelFormValues): KernelFieldMessages {
  const errors: KernelFieldMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace =
      "A namespace is required: the kernel, its pull Jobs and the Secret it may name all live in one, and a guest " +
      "resolves its kernel from its own namespace.";
  }

  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  const imageError = kernelImageError(values.image);

  if (imageError) {
    errors.image = imageError;
  }

  const cmdlineError = kernelCmdlineError(values.kernelCmdline);

  if (cmdlineError) {
    errors.kernelCmdline = cmdlineError;
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
export function kernelCreateWarnings(inputs: KernelCreateInputs, values: KernelFormValues): KernelFieldMessages {
  const warnings: KernelFieldMessages = {};
  const name = values.name.trim();
  const namespace = values.namespace.trim();
  const pullSecret = values.pullSecret.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name = `A SwiftKernel named ${name} already exists in ${namespace}. The create will be refused.`;
  } else if (name && inputs.existingNamesUnverified) {
    warnings.name =
      `The SwiftKernels of ${namespace || "this namespace"} could not be listed from here, so whether this name is ` +
      "already taken is unverified. The API server answers on submit.";
  }

  if (pullSecret) {
    if (inputs.secretsUnverified) {
      warnings.pullSecret =
        "The Secrets of this namespace could not be listed from here, so this name is unverified. A pull secret " +
        "that does not exist is not refused at admission - the pull pod fails to start instead.";
    } else if (!inputs.secrets.includes(pullSecret)) {
      warnings.pullSecret =
        `No Secret named ${pullSecret} is in this namespace. Nothing refuses the kernel for it - the pull pod ` +
        "fails to start, on every labelled node.";
    }
  }

  return warnings;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface KernelBlockingIssue {
  label: string;
  message: string;
}

/** Every reason the form cannot be submitted, in the reading order of the form. */
export function kernelBlockingIssues(values: KernelFormValues): KernelBlockingIssue[] {
  const errors = kernelCreateErrors(values);

  return fieldOrder
    .filter((field) => errors[field])
    .map((field) => ({ label: kernelFieldLabels[field], message: errors[field] as string }));
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function kernelSubmitBlockReason(values: KernelFormValues): string | undefined {
  const [first] = kernelBlockingIssues(values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/**
 * The object the create sends: only what the form set, and nothing the API
 * server would stamp on its own (G7, F17).
 *
 * `pullSecret` is never sent empty - an empty-name reference is the shape
 * SPEC-0013's G7 exists to prevent, and it is one the schema would accept here
 * because `pullSecret` is a bare string with no pattern.
 */
export function kernelCreatePayload(values: KernelFormValues): { spec: SwiftKernelSpec } {
  const pullSecret = values.pullSecret.trim();
  const kernelCmdline = values.kernelCmdline.trim();
  const profile = values.profile.trim();
  const spec: SwiftKernelSpec = { ociRef: { image: values.image.trim() } };

  if (pullSecret) {
    spec.ociRef.pullSecret = pullSecret;
  }

  if (kernelCmdline) {
    spec.kernelCmdline = kernelCmdline;
  }

  if (profile) {
    spec.profile = profile;
  }

  return { spec };
}

/** The live write summary, as the dialog renders it. */
export interface KernelCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/**
 * The live write summary: the one create line, then the facts that are true of
 * this object in this state (W1, rebuilt on every change).
 *
 * The order is the order things happen: what is stored, what the controller does
 * with it, what it will and will not tell you afterwards.
 */
export function kernelCreateSummary(inputs: KernelCreateInputs, values: KernelFormValues): KernelCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const image = values.image.trim();
  const pullSecret = values.pullSecret.trim();
  const kernelCmdline = values.kernelCmdline.trim();
  const profile = values.profile.trim();
  const notes: string[] = [];
  const warnings: string[] = [];

  if (image) {
    notes.push(`Its artifact is ${image}, pulled with oras onto the nodes that carry the kernel-node label.`);
  }

  // The count is a note when it is a fact and a warning when it is a cost: a
  // kernel that will park in Pending, and a count a refused read left
  // unverified, both belong above the OK button rather than among the things
  // that simply are.
  const nodeFact = kernelNodeCountFact(inputs);

  if (!kernelWillParkInPending(inputs) && !inputs.nodesUnverified) {
    notes.push(nodeFact);
  }

  if (pullSecret) {
    notes.push(`It names the pull secret ${pullSecret}. ${pullSecretReachFact}`);
  }

  if (kernelCmdline) {
    notes.push(`Guests booting it get "${kernelCmdline}" as their command line. ${kernelCmdlineReplacedFact}`);
  }

  if (profile) {
    notes.push(`It is labelled ${profile}. ${profileFact}`);
  }

  notes.push(kernelReadyFact);
  notes.push(kernelTerminalFailedFact);
  notes.push(kernelImageIsImmutableInPracticeFact);

  if (kernelWillParkInPending(inputs) || inputs.nodesUnverified) {
    warnings.push(nodeFact);
  }

  const warningsByField = kernelCreateWarnings(inputs, values);

  // The collision and every unverified value are stated in the summary as well
  // as at their field, for the reason the shipped dialogs state their sharpest
  // sentence twice: the summary is what a user reads before pressing OK.
  for (const field of ["name", "pullSecret"] as const) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftKernel ${namespace}/${name}`, notes, warnings };
}

/** What a create that succeeded is acknowledged with (W9). */
export function kernelCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftKernel ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface KernelCreateFailureContext {
  namespace: string;
  name: string;
}

/** The actionable sentence alone, for the three failures this dialog can predict. */
export function kernelCreateFailurePrefix(
  code: number | undefined,
  context: KernelCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftKernel named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === forbiddenStatusCode) {
    return `You are not allowed to create swiftkernels in the namespace ${context.namespace}.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftKernel CRD is gone.`;
  }

  return undefined;
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function kernelCreateFailureMessage(
  failure: ApiFailureFacts,
  context: KernelCreateFailureContext,
): string | undefined {
  const prefix = kernelCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

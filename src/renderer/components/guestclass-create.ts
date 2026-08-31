/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Guest Class form decides, as pure functions over
// structurally declared inputs (SPEC-0014, "Where the code lives"): the
// defaults, the quantity grammar, the storage trio and the CEL rule it carries,
// the payload the create sends, the live write summary, and the sentences the
// notifications carry.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which StorageClasses the read on open returned, which
// class names the store happens to hold - is taken as an argument.
//
// What creating a SwiftGuestClass mechanically IS is short enough to say in
// full, and is the reason this form is the smallest of the four:
//
// - No controller is registered for the kind and the CRD declares no status
//   subresource, so a class is valid the moment it exists, does nothing on its
//   own, and reports nothing about itself afterwards. There is no phase to
//   wait for and no failure to recover from.
// - There is no webhook of ANY kind - not a disabled one, none - so the schema
//   is the entire rule set. Its one CEL rule is on `spec.storage` and it is the
//   guest's: `ReadWriteMany` requires `volumeMode: Block`, with an unset volume
//   mode refused exactly as `Filesystem` is (`kube-storage.ts`).
// - The kind is CLUSTER-SCOPED. There is no namespace control at all, and the
//   fact is stated where the field would have been, because upstream's own
//   sample sets `metadata.namespace` on one.
// - `cpu`, `memory` and `rootDisk` are required and have no minimum, so
//   `cpu: "0"` is stored happily and produces guests nothing can start. The
//   quantity rules below are the only thing between an operator and that
//   object.
// - The two sizing rules the docs call mandatory - the class's root disk format
//   matching the image's, and its size being at least the image's - are
//   enforced by nothing, and the docs and the Go comment state the second one
//   in opposite directions. They are named where the operator sets them (F21)
//   rather than checked, because the class does not know which image a guest
//   will boot.
// - `coreScheduling` defaults to `off` in the schema, so `off` is never sent,
//   and an all-empty `storage` is dropped rather than emitted as `{}` (F17).

import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import {
  guestClassStorageCelRule,
  liveAccessMode,
  liveMigrationFact,
  liveVolumeMode,
  resolveStorage,
  storageClassNameError,
  violatesStorageCelRule,
} from "./kube-storage";
import { conflictStatusCode } from "./migration-create";
import { objectNameError } from "./snapshot-create";

import type {
  SwiftGuestClassAccessMode,
  SwiftGuestClassCoreScheduling,
  SwiftGuestClassDiskFormat,
  SwiftGuestClassSpec,
  SwiftGuestClassStorage,
  SwiftGuestClassVolumeMode,
} from "../api/kubeswift/swiftguestclass-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";
import type { ResolvedStorage } from "./kube-storage";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createGuestClassTitle = "Create Guest Class";

/** The disk formats the schema's enum offers, in the order the control offers them. */
export const guestClassDiskFormats: SwiftGuestClassDiskFormat[] = ["raw", "qcow2"];

/** The core-scheduling policies the schema's enum offers. */
export const guestClassCoreSchedulingPolicies: SwiftGuestClassCoreScheduling[] = ["off", "vm", "vcpu"];

/** The policy the schema stamps when the field is absent, and therefore the one never sent (F17). */
export const defaultCoreScheduling: SwiftGuestClassCoreScheduling = "off";

/** The access modes the storage block offers. An empty value sends no access mode at all. */
export const guestClassAccessModes: SwiftGuestClassAccessMode[] = ["ReadWriteOnce", "ReadWriteMany"];

/** The volume modes the storage block offers, under the same empty-means-unset rule. */
export const guestClassVolumeModes: SwiftGuestClassVolumeMode[] = ["Filesystem", "Block"];

/**
 * The form's fields, all of them strings because all of them are typed.
 *
 * The format is a string rather than the enum, so that "not chosen yet" is
 * expressible: the schema requires it, and there is no default to inherit.
 */
export interface GuestClassFormValues {
  name: string;
  cpu: string;
  memory: string;
  rootDiskSize: string;
  rootDiskFormat: SwiftGuestClassDiskFormat | "";
  storageAccessMode: string;
  storageVolumeMode: string;
  storageClassName: string;
  coreScheduling: SwiftGuestClassCoreScheduling;
}

/**
 * What the reads on open found.
 *
 * `storageClassesUnverified` is the T3 degradation: a refused list costs a
 * sentence, never a control and never the write.
 */
export interface GuestClassCreateInputs {
  /** The cluster's StorageClass names, for the picker and for the unverified warning. */
  storageClasses: string[];
  storageClassesUnverified: boolean;
  /** The cluster's SwiftGuestClass names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
}

/**
 * The form as it opens: everything empty except the one field the schema
 * defaults.
 *
 * Nothing is prefilled, and the sizing fields are the reason: upstream's own
 * wizard says `20Gi` for the root disk, its docs say `10Gi` and its shipped
 * sample says `40Gi`, so there is no value to inherit and a prefill would be a
 * sizing decision made by the form (SPEC-0013's rejected class prefill, in the
 * place the class itself is written).
 */
export function defaultGuestClassForm(): GuestClassFormValues {
  return {
    name: "",
    cpu: "",
    memory: "",
    rootDiskSize: "",
    rootDiskFormat: "",
    storageAccessMode: "",
    storageVolumeMode: "",
    storageClassName: "",
    coreScheduling: defaultCoreScheduling,
  };
}

/**
 * The Kubernetes quantity grammar, exactly as the CRD's own pattern spells it.
 *
 * Copied from the schema rather than approximated, because a client-side rule
 * that is stricter than the server's would refuse values the cluster accepts.
 */
const quantityPattern =
  /^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))((([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+)))))?$/;

/** The mantissa of a quantity, which is what decides its sign and whether it is zero. */
const quantityMantissaPattern = /^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))/;

/** The grammar, as the hint under every quantity field states it. */
export const quantityGrammar =
  "A Kubernetes quantity: a plain number, or a number with a unit - 2, 500m, 4Gi, 1.5G. A number with no unit is a " +
  "count for cpu and a count of BYTES for memory and for disks.";

/** What a value that is not a quantity at all is refused with. */
export const quantityFormatMessage =
  "This is not a Kubernetes quantity. Write a plain number or a number with one of the units the API server " +
  "accepts: m, k, M, G, T, P, E or their binary forms Ki, Mi, Gi, Ti, Pi, Ei.";

/** What zero is refused with, which is the refusal the schema does not carry. */
export const quantityZeroMessage =
  "A size of zero is accepted by the API server and honoured by nothing: the schema sets no minimum, so a class " +
  "with a zero here is stored happily and produces guests that cannot start.";

/** What a negative quantity is refused with. */
export const quantityNegativeMessage =
  "A negative quantity is accepted by the API server, which validates the pattern and not the sign. Nothing " +
  "downstream can honour it.";

/**
 * Why a typed quantity would be refused, or `undefined` when it is legal.
 *
 * An empty value is not this function's business: whether a field is required
 * belongs to the form, and the same grammar serves an optional field in
 * SPEC-0014's second slice.
 *
 * The three refusals are the ones the API server does not carry. The pattern is
 * the schema's, so a value that fails it would be refused by the cluster too;
 * zero and negatives would not be, which is precisely why they are here (W12:
 * inline validation replaces the absent admission).
 */
export function quantityError(value: string): string | undefined {
  const quantity = value.trim();

  if (!quantity) {
    return undefined;
  }

  if (!quantityPattern.test(quantity)) {
    return quantityFormatMessage;
  }

  const mantissa = quantityMantissaPattern.exec(quantity);
  const magnitude = mantissa ? Number(mantissa[0]) : Number.NaN;

  if (!Number.isFinite(magnitude)) {
    return quantityFormatMessage;
  }

  if (magnitude < 0) {
    return quantityNegativeMessage;
  }

  if (magnitude === 0) {
    return quantityZeroMessage;
  }

  return undefined;
}

/**
 * Whether a quantity carries a unit, for the one warning the grammar itself
 * makes necessary.
 *
 * `memory: 4` is four BYTES, and it is a legal quantity: nothing anywhere
 * refuses it, and the class it produces reads as if it said `4Gi` to everyone
 * who scans the list. The warning never blocks - a unitless byte count is a
 * legitimate value, just almost never the intended one.
 */
export function hasQuantityUnit(value: string): boolean {
  const quantity = value.trim();
  const mantissa = quantityMantissaPattern.exec(quantity);

  return Boolean(mantissa) && mantissa?.[0] !== quantity;
}

/** The warning a unitless memory or disk size carries, named for the field it is on. */
export function unitlessQuantityWarning(label: string, value: string): string {
  return (
    `${value} is ${value} bytes, not ${value}Gi: a quantity with no unit is a plain byte count. Nothing refuses it, ` +
    `so a ${label} meant as gibibytes has to say so.`
  );
}

/** Every field of the form, keyed the way the messages are. */
export type GuestClassCreateField = keyof GuestClassFormValues;

/** Messages keyed by field, for the inline errors and the inline warnings. */
export type GuestClassFieldMessages = Partial<Record<GuestClassCreateField, string>>;

/** How each field reads in the sentence next to the disabled submit button (W12). */
export const guestClassFieldLabels: Record<GuestClassCreateField, string> = {
  name: "Name",
  cpu: "CPU",
  memory: "Memory",
  rootDiskSize: "Root disk size",
  rootDiskFormat: "Root disk format",
  storageAccessMode: "Access mode",
  storageVolumeMode: "Volume mode",
  storageClassName: "Storage class",
  coreScheduling: "Core scheduling",
};

/** The reading order of the form, which is the order the blocked sentence names fields in. */
const fieldOrder: GuestClassCreateField[] = [
  "name",
  "cpu",
  "memory",
  "rootDiskSize",
  "rootDiskFormat",
  "storageAccessMode",
  "storageVolumeMode",
  "storageClassName",
];

/**
 * The fact stated where the namespace control would have been (F3).
 *
 * Upstream's create cannot write this kind on any cluster - its catalog marks
 * `swiftguestclasses` namespaced while the CRD is `scope: Cluster` - and its
 * own shipped sample sets `metadata.namespace` on an object that has none. The
 * sentence states what is true of the object this form writes, and leaves the
 * upstream reading to the spec.
 */
export const guestClassScopeFact =
  "A guest class is cluster-scoped: there is no namespace to choose, and a guest in any namespace can point at it. " +
  "A metadata.namespace on a guest class - which upstream's own sample carries - names nothing.";

/** The two sizing rules the docs call mandatory and nothing enforces (F21). */
export const guestClassSizingRulesFact =
  "Nothing checks either of the two rules the docs call mandatory here. The format has to match the real format of " +
  "the image a guest boots, and a mismatch is a boot failure rather than a rejected create; the size has to cover " +
  "that image, and the docs and the code comment state that one in opposite directions. No webhook exists for this " +
  "kind at all, so neither is checked anywhere.";

/** What the storage block is for, on the header line of the trio. */
export const guestClassStorageFact =
  "The cluster default for the root-disk PVC the SwiftGuest controller creates. A guest overrides it per field, and " +
  "an empty block here leaves the API server's own defaults in place.";

/**
 * The warning ReadWriteMany on a Block volume carries.
 *
 * The pair satisfies the CRD's rule and is not sufficient on its own: what
 * actually has to hold the volume on two nodes at once is the StorageClass, and
 * no admission checks that. The failure is a guest waiting on storage that
 * never turns ready, which is a controller-time condition rather than a
 * rejected create.
 */
export const migratableStorageClassWarning =
  `${liveAccessMode} on a ${liveVolumeMode} volume satisfies the CRD's rule, and it is not enough on its own: the ` +
  "StorageClass behind it has to be one that can really attach the volume to two nodes at once. Nothing checks " +
  "that at admission - a class that cannot becomes a guest waiting on storage that never turns ready.";

/** What each core-scheduling policy does, one sentence per option. */
export function coreSchedulingNote(policy: SwiftGuestClassCoreScheduling): string {
  if (policy === "vm") {
    return (
      "One core-scheduling group per guest: the vCPUs of two different guests never share a physical core. This is " +
      "the setting upstream names for multi-tenant isolation, and the mitigation the field exists for."
    );
  }

  if (policy === "vcpu") {
    return (
      "One core-scheduling group per vCPU, the finest of the three. Upstream documents only vm, so what this costs " +
      "in scheduling headroom is written down nowhere."
    );
  }

  return (
    "No core scheduling: the hypervisor's cpu arguments are left untouched, and a guest's vCPUs may share a " +
    "physical core with another tenant's. This is what the API server stores when the field is absent, so it is " +
    "not sent."
  );
}

/** The storage of a guest of this class, as the class's own block resolves it. */
export function guestClassResolvedStorage(values: GuestClassFormValues): ResolvedStorage {
  return resolveStorage({
    accessMode: values.storageAccessMode.trim() || undefined,
    volumeMode: values.storageVolumeMode.trim() || undefined,
    storageClassName: values.storageClassName.trim() || undefined,
    // Always a fact: a class has no class above it, so there is no read whose
    // failure could leave the answer a guess. This is the whole reason the
    // derivation was extracted here first (SPEC-0014, slice 1).
    resolved: true,
  });
}

/** What a guest of this class will be able to do about a node drain, in the summary's words. */
export function guestClassLiveMigrationFact(values: GuestClassFormValues): string {
  return liveMigrationFact(guestClassResolvedStorage(values), "image", "a guest of this class");
}

/**
 * Everything that would make this create fail, keyed by field.
 *
 * Unusually for this milestone, every rule here is the API server's own: there
 * is no webhook for this kind, disabled or otherwise, so the schema is the
 * whole rule set and nothing below is a mirror of something that ships off. The
 * three that go beyond the schema - zero, negatives, and the CEL rule's unset
 * shape - are refusals the API server would ACCEPT, which is the sharper half
 * of W12.
 */
export function guestClassCreateErrors(values: GuestClassFormValues): GuestClassFieldMessages {
  const errors: GuestClassFieldMessages = {};
  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  for (const field of ["cpu", "memory", "rootDiskSize"] as const) {
    const value = values[field].trim();

    if (!value) {
      errors[field] = `${guestClassFieldLabels[field]} is required: the schema requires it and there is no default.`;
      continue;
    }

    const message = quantityError(value);

    if (message) {
      errors[field] = message;
    }
  }

  if (!values.rootDiskFormat) {
    errors.rootDiskFormat =
      "A root disk format is required: the schema requires it, and unlike the image's own format there is no " +
      "webhook here to default it.";
  }

  if (violatesStorageCelRule(values.storageAccessMode.trim(), values.storageVolumeMode.trim())) {
    errors.storageAccessMode = guestClassStorageCelRule;
  }

  const storageClassNameMessage = storageClassNameError(values.storageClassName.trim());

  if (storageClassNameMessage) {
    errors.storageClassName = storageClassNameMessage;
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
export function guestClassCreateWarnings(
  inputs: GuestClassCreateInputs,
  values: GuestClassFormValues,
): GuestClassFieldMessages {
  const warnings: GuestClassFieldMessages = {};
  const name = values.name.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name =
      `A guest class named ${name} already exists in this cluster. The create will be refused; the name is ` +
      "cluster-wide, because the kind is.";
  } else if (name && inputs.existingNamesUnverified) {
    warnings.name =
      "The cluster's guest classes could not be listed from here, so whether this name is already taken is " +
      "unverified. The API server answers on submit.";
  }

  for (const field of ["memory", "rootDiskSize"] as const) {
    const value = values[field].trim();

    if (value && !quantityError(value) && !hasQuantityUnit(value)) {
      warnings[field] = unitlessQuantityWarning(guestClassFieldLabels[field].toLowerCase(), value);
    }
  }

  if (
    values.storageAccessMode.trim() === liveAccessMode &&
    values.storageVolumeMode.trim() === liveVolumeMode &&
    !values.storageClassName.trim()
  ) {
    warnings.storageVolumeMode = migratableStorageClassWarning;
  }

  const storageClassName = values.storageClassName.trim();

  if (storageClassName && !storageClassNameError(storageClassName)) {
    if (inputs.storageClassesUnverified) {
      warnings.storageClassName =
        "The cluster's StorageClasses could not be listed from here, so this name is unverified. A class that does " +
        "not exist is not refused at admission: the PVC of the first guest simply never binds.";
    } else if (!inputs.storageClasses.includes(storageClassName)) {
      warnings.storageClassName =
        `No StorageClass named ${storageClassName} is in this cluster. Nothing refuses the class for it - the PVC ` +
        "of the first guest built from it never binds, and the guest waits.";
    }
  }

  return warnings;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface GuestClassBlockingIssue {
  label: string;
  message: string;
}

/** Every reason the form cannot be submitted, in the reading order of the form. */
export function guestClassBlockingIssues(values: GuestClassFormValues): GuestClassBlockingIssue[] {
  const errors = guestClassCreateErrors(values);

  return fieldOrder
    .filter((field) => errors[field])
    .map((field) => ({ label: guestClassFieldLabels[field], message: errors[field] as string }));
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function guestClassSubmitBlockReason(values: GuestClassFormValues): string | undefined {
  const [first] = guestClassBlockingIssues(values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/**
 * The storage block, or `undefined` when nothing in it was set.
 *
 * The CRD's own words are that an unset block keeps the legacy behaviour, so a
 * form that touched nothing sends no `storage` at all rather than an empty
 * object: `storage: {}` is a different stored object that says the same thing,
 * and it is the kind of difference a GitOps diff has to explain later (F17).
 */
export function guestClassStoragePayload(values: GuestClassFormValues): SwiftGuestClassStorage | undefined {
  const storage: SwiftGuestClassStorage = {};
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
 * The object the create sends: only what the form set, and nothing the API
 * server would stamp on its own (G7, F17).
 *
 * `coreScheduling: off` is the schema's own default, so it never appears; an
 * empty storage block is dropped rather than emitted; and the name is not in
 * here at all, because the store's `create` carries it.
 */
export function guestClassCreatePayload(values: GuestClassFormValues): { spec: SwiftGuestClassSpec } {
  const spec: SwiftGuestClassSpec = {
    cpu: values.cpu.trim(),
    memory: values.memory.trim(),
    rootDisk: {
      // The schema requires the format and the submit is blocked until one is
      // chosen, so the fallback is unreachable; it is `raw` rather than an
      // empty string because an empty string is what the API server would
      // answer with a decoded enum error nobody should have to read.
      format: values.rootDiskFormat || "raw",
      size: values.rootDiskSize.trim(),
    },
  };
  const storage = guestClassStoragePayload(values);

  if (storage) {
    spec.storage = storage;
  }

  if (values.coreScheduling !== defaultCoreScheduling) {
    spec.coreScheduling = values.coreScheduling;
  }

  return { spec };
}

/** The live write summary, as the dialog renders it. */
export interface GuestClassCreateSummaryFacts {
  /** The one API call the dialog makes. No namespace: the kind is cluster-scoped. */
  write: string;
  notes: string[];
  warnings: string[];
}

/** What this create sets in motion, which is nothing. */
export const guestClassCreatesNothingFact =
  "Creating a guest class creates nothing else. No controller is registered for the kind and the CRD declares no " +
  "status subresource, so the class is usable by a guest the moment it exists and never reports anything about " +
  "itself.";

/**
 * The live write summary: the one create line, then the facts that are true of
 * this object in this state (W1, rebuilt on every change).
 */
export function guestClassCreateSummary(
  inputs: GuestClassCreateInputs,
  values: GuestClassFormValues,
): GuestClassCreateSummaryFacts {
  const name = values.name.trim() || "<name>";
  const notes: string[] = [];
  const warnings: string[] = [];
  const cpu = values.cpu.trim();
  const memory = values.memory.trim();
  const size = values.rootDiskSize.trim();
  const format = values.rootDiskFormat.trim();
  const storageClassName = values.storageClassName.trim();

  notes.push(guestClassCreatesNothingFact);

  if (cpu && memory && size && format) {
    notes.push(
      `Every guest of this class gets ${cpu} cpu, ${memory} of memory and a ${size} ${format} root disk, and cannot ` +
        "override any of the three.",
    );
  }

  notes.push(guestClassSizingRulesFact);

  if (storageClassName) {
    notes.push(`Its root-disk PVC asks for the StorageClass ${storageClassName}, unless the guest names another.`);
  }

  notes.push(guestClassLiveMigrationFact(values));

  if (values.coreScheduling !== defaultCoreScheduling) {
    notes.push(
      `Its guests run with coreScheduling ${values.coreScheduling}. ${coreSchedulingNote(values.coreScheduling)}`,
    );
  }

  const warningsByField = guestClassCreateWarnings(inputs, values);

  // The collision and every unverified value are stated in the summary as well
  // as at their field, for the reason the shipped dialogs state their sharpest
  // sentence twice: the summary is what a user reads before pressing OK, and a
  // fact that only lives at a field is a fact a scrolled-past field hides.
  for (const field of ["name", "memory", "rootDiskSize", "storageVolumeMode", "storageClassName"] as const) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftGuestClass ${name}`, notes, warnings };
}

/** What a create that succeeded is acknowledged with (W9). */
export function guestClassCreateSuccessMessage(name: string): string {
  return `SwiftGuestClass ${name} created`;
}

/**
 * The actionable sentence alone, for the failures this dialog can predict.
 *
 * The 403 is worded without a namespace, which is the one place the shared
 * `writeFailurePrefix` cannot serve a cluster-scoped kind.
 */
export function guestClassCreateFailurePrefix(code: number | undefined, name: string): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftGuestClass named ${name} already exists in this cluster. Change the name and try again.`;
  }

  if (code === forbiddenStatusCode) {
    return "You are not allowed to create swiftguestclasses in this cluster.";
  }

  if (code === notFoundStatusCode) {
    return "Nothing here accepted the create: the SwiftGuestClass CRD is gone from this cluster.";
  }

  return undefined;
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function guestClassCreateFailureMessage(failure: ApiFailureFacts, name: string): string | undefined {
  const prefix = guestClassCreateFailurePrefix(failure.code, name);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

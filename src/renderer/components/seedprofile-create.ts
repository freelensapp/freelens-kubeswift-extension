/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Seed Profile form decides, as pure functions over
// structurally declared inputs (SPEC-0014, "Where the code lives"): the
// defaults, the one CEL rule, the four payload rules, the live write summary,
// and the sentences the notifications carry.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which Secrets and ConfigMaps the reads on open
// returned, and which keys each of them carries - is taken as an argument.
//
// What creating a SwiftSeedProfile mechanically IS: nothing now, one Secret
// later.
//
// - There is no controller and no status schema. A profile is inert until a
//   SwiftGuest points at it, and the rendering happens inside the SwiftGuest
//   reconcile, from the GUEST's namespace, producing one Secret named
//   `<guest-name>-seed` with up to three keys. It was a ConfigMap before
//   v0.13.4, which the upstream docs still say.
// - `datasource` is stamped by a MUTATING webhook that ships off and is
//   `failurePolicy: Ignore` besides, while the schema requires it. Omitting it
//   is therefore a hard rejection on every default install, which is why this
//   form sends it explicitly even though it has exactly one legal value (F16).
//   This is SPEC-0013's retired G9 seen from the other side.
// - Three defaults are shown rather than asked for. With `NoCloud` and both
//   metadata fields empty the renderer synthesizes an instance id and a
//   hostname - and the rationale matters, because a NoCloud disk with NO
//   metadata file is not recognised as a datasource at all, so cloud-init
//   discards the user data wholesale while the guest still boots and reports
//   Running and Ready. An empty rendered network config is replaced by a
//   built-in dual-match DHCP netplan.
// - FOUR precedences are silent and unenforced, and every one of them is made
//   unreachable here rather than validated (F20): inline beside a `*From`
//   resolves to the reference; `secretKeyRef` beside `configMapKeyRef` resolves
//   to the Secret by statement order; an empty `userDataFrom: {}` satisfies the
//   CEL rule and renders nothing; and a selector's `name` carries the core
//   API's `""` default, which resolves to nothing at all.
// - A missing referenced object or key is worse than a missing profile: the
//   error returns raw, so the guest RETRIES WITH BACKOFF, with no
//   `Resolved=False` condition and no `Failed` phase. `optional: true` is
//   ignored by both resolvers, which is why it is not rendered (F15).
// - And a profile edit after the guest exists rewrites bytes nobody will read:
//   the seed is consumed once, at first boot.
//
// The one rule the API server really enforces is CEL rather than webhook, on
// purpose - upstream's own reasoning is DESIGN.md W12's: a rule that only holds
// when the webhook is enabled is not a rule.

import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import { conflictStatusCode } from "./migration-create";
import { objectNameError } from "./snapshot-create";

import type {
  SwiftSeedProfileDatasource,
  SwiftSeedProfileDataValueFrom,
  SwiftSeedProfileSpec,
} from "../api/kubeswift/swiftseedprofile-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createSeedProfileTitle = "Create Seed Profile";

/** The only datasource the schema's enum offers, and the one this form always sends (F16). */
export const seedDatasource: SwiftSeedProfileDatasource = "NoCloud";

/** The three cloud-init documents a profile carries. */
export type SeedDocumentKind = "userData" | "metaData" | "networkData";

/** Where one document comes from. Exactly one, which is what makes the XOR inexpressible (F6). */
export type SeedDocumentOrigin = "inline" | "secret" | "configMap";

/** The documents, in the order the form asks for them. */
export const seedDocumentKinds: SeedDocumentKind[] = ["userData", "metaData", "networkData"];

/** The origins, in the order each group's control offers them. */
export const seedDocumentOrigins: SeedDocumentOrigin[] = ["inline", "secret", "configMap"];

/** One document group, as the form holds it. */
export interface SeedDocumentValues {
  origin: SeedDocumentOrigin;
  /** The document itself, when the origin is `inline`. Never trimmed on the way out. */
  inline: string;
  /** The Secret or ConfigMap holding it, when the origin is not. Never emitted empty. */
  objectName: string;
  /** The key inside that object. Required by the schema, and never emitted empty either. */
  key: string;
}

/** The form's fields, all of them typed. */
export interface SeedProfileFormValues {
  namespace: string;
  name: string;
  userData: SeedDocumentValues;
  metaData: SeedDocumentValues;
  networkData: SeedDocumentValues;
}

/** One object a document can be read from, with the keys it carries. */
export interface SeedObjectFacts {
  name: string;
  /** Empty when the object carries none, which is a different thing from "not read yet". */
  keys: string[];
}

/**
 * What the reads on open found.
 *
 * Two namespace reads a namespaced role may well not carry, and each degrades
 * on its own (T3): a refused `secretsApi` leaves the Secret pickers as text
 * inputs while the ConfigMap ones stay pickers, and the other way round.
 */
export interface SeedProfileCreateInputs {
  secrets: SeedObjectFacts[];
  secretsUnverified: boolean;
  configMaps: SeedObjectFacts[];
  configMapsUnverified: boolean;
  /** The namespace's SwiftSeedProfile names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
}

/** An empty document group: inline, with nothing in it. */
export function defaultSeedDocument(): SeedDocumentValues {
  return { origin: "inline", inline: "", objectName: "", key: "" };
}

/**
 * The form as it opens.
 *
 * The namespace comes from the page's own filter when it names exactly one and
 * is otherwise empty and required (F2). All three documents start inline and
 * empty: two of them have effective values the form states rather than fills
 * in, and the third is the one the CEL rule refuses until it has something.
 */
export function defaultSeedProfileForm(namespace = ""): SeedProfileFormValues {
  return {
    namespace,
    name: "",
    userData: defaultSeedDocument(),
    metaData: defaultSeedDocument(),
    networkData: defaultSeedDocument(),
  };
}

/**
 * The group after its origin changes: everything belonging to the origin being
 * left, emptied.
 *
 * This is the first of the two places "never an inline value beside a
 * reference" is made true. The second is the payload builder, which branches on
 * the same field - so the shape upstream's own edit path actively produces,
 * writing `spec.userData` unconditionally onto a preserved base, cannot be
 * assembled here even by a user who types into one control and then switches.
 */
export function switchSeedDocumentOrigin(document: SeedDocumentValues, origin: SeedDocumentOrigin): SeedDocumentValues {
  // A reference survives only a move between the two reference origins. Anything
  // that touches `inline` starts from nothing, so no group can ever hold an
  // inline document and a half-typed reference at the same time - which is the
  // first precedence, made unreachable in the state rather than in the payload.
  const keepsReference = origin !== "inline" && document.origin !== "inline";

  return {
    origin,
    inline: origin === "inline" ? document.inline : "",
    objectName: keepsReference ? document.objectName : "",
    // The key belongs to the object it was picked from, so a change of origin
    // between Secret and ConfigMap drops it too: a key that exists in one and
    // not in the other is the reference that retries forever.
    key: keepsReference && origin === document.origin ? document.key : "",
  };
}

/** How each document reads in a sentence. */
export const seedDocumentLabels: Record<SeedDocumentKind, string> = {
  userData: "User data",
  metaData: "Metadata",
  networkData: "Network config",
};

/** The spec field each document is written to, for the summary's own words. */
export const seedDocumentSpecFields: Record<SeedDocumentKind, string> = {
  userData: "userData",
  metaData: "metaData",
  networkData: "networkData",
};

/** How each origin reads on its own radio. */
export const seedOriginLabels: Record<SeedDocumentOrigin, string> = {
  inline: "Inline",
  secret: "Secret key",
  configMap: "ConfigMap key",
};

/** What choosing each origin does, one sentence under its label. */
export function seedOriginNote(kind: SeedDocumentKind, origin: SeedDocumentOrigin): string {
  if (origin === "inline") {
    return kind === "userData"
      ? "The document lives in this object's own spec, readable by anyone who can get the profile and by anything " +
          "that mirrors the namespace into Git."
      : "The document lives in this object's own spec.";
  }

  if (origin === "secret") {
    return (
      "One key of a Secret in this namespace, resolved at the moment a guest is reconciled. This is the path " +
      "upstream's own API comments and GitOps docs prefer for anything carrying credentials, and the one path its " +
      "GUI cannot express at all."
    );
  }

  return "One key of a ConfigMap in this namespace, resolved at the moment a guest is reconciled.";
}

/** The namespace fact: a profile is resolved from the GUEST's namespace, not from the guest's own. */
export const seedNamespaceFact =
  "A guest resolves its seed profile from ITS OWN namespace, so a profile a guest cannot see is a hard resolution " +
  "error rather than a fallback - and the Secrets and ConfigMaps named below are resolved from the same place.";

/** `datasource` as a stamped fact that is nevertheless always sent (F16). */
export const seedDatasourceFact =
  `The schema requires datasource and offers exactly one value, ${seedDatasource}, so there is nothing to choose. ` +
  "It is sent explicitly all the same: the mutating webhook that would fill it in ships disabled, and is " +
  "failurePolicy: Ignore besides, so a manifest omitting it is a hard rejection on every default install.";

/**
 * The CEL rule, in its own terms rather than as the API server's decoded
 * message.
 *
 * The rule is `(has(self.userData) && size(self.userData) > 0) ||
 * has(self.userDataFrom)`, and it is CEL rather than webhook on purpose,
 * because a rule that only holds when the webhook is enabled is not a rule.
 */
export const seedUserDataRequiredMessage =
  "A profile needs user data: either an inline document that is not empty, or a reference to a Secret or " +
  "ConfigMap key. This one is the API server's own rule - a CEL rule on the spec, not a webhook rule - so it is " +
  "enforced on every cluster, and an empty inline document does not satisfy it.";

/** What an empty selector name is refused with, which is SPEC-0013's G7 in a new place. */
export function seedSelectorNameRequiredMessage(kind: SeedDocumentKind, origin: SeedDocumentOrigin): string {
  const object = origin === "secret" ? "Secret" : "ConfigMap";

  return (
    `${seedDocumentLabels[kind]} names no ${object}. The core API's selector defaults name to the empty string ` +
    "rather than requiring it, so an empty one is stored happily and resolves to nothing - and a reference that " +
    "resolves to nothing makes the guest retry with backoff, with no condition and no Failed phase to see it by."
  );
}

/** What an empty key is refused with. The schema requires the key; nothing requires it to exist. */
export function seedSelectorKeyRequiredMessage(kind: SeedDocumentKind, origin: SeedDocumentOrigin): string {
  const object = origin === "secret" ? "Secret" : "ConfigMap";

  return (
    `${seedDocumentLabels[kind]} names no key of that ${object}. The schema requires the key, and a key that is ` +
    "not there resolves the same way an absent object does: silently, forever."
  );
}

/** What a key the read did not find is warned about, and why it is a warning rather than a refusal. */
export function seedMissingKeyWarning(origin: SeedDocumentOrigin, objectName: string, key: string): string {
  const object = origin === "secret" ? "Secret" : "ConfigMap";

  return (
    `The ${object} ${objectName} carries no key named ${key} right now. Nothing refuses the profile for it - the ` +
    "key may be added before a guest ever reads it - but if it is still missing then, the guest retries with " +
    "backoff and says nothing about why."
  );
}

/** What an object the read did not find is warned about. */
export function seedMissingObjectWarning(origin: SeedDocumentOrigin, objectName: string): string {
  const object = origin === "secret" ? "Secret" : "ConfigMap";

  return (
    `No ${object} named ${objectName} is in this namespace. Nothing refuses the profile for it, and a reference ` +
    "that cannot be resolved is the failure this kind reports least: the guest retries with backoff, with no " +
    "Resolved=False and no Failed phase."
  );
}

/** What a refused read costs, said at the field it degraded. */
export function seedUnverifiedObjectHint(origin: SeedDocumentOrigin): string {
  const objects = origin === "secret" ? "Secrets" : "ConfigMaps";

  return `The ${objects} of this namespace could not be listed, so this name and its key are not verified.`;
}

/** The metadata effective value, shown as a fact rather than filled in (F17's habit, one kind over). */
export const seedMetaDataEffectiveFact =
  "Left empty, the renderer synthesizes the metadata: instance-id <guest namespace>-<guest name> and " +
  "local-hostname <guest name>. That is not cosmetic - a NoCloud disk with no meta-data file is not recognised as " +
  "a datasource at all, and cloud-init then discards the user data WHOLESALE while the guest still boots and " +
  "reports Running and Ready. Set this only to override the synthesized pair.";

/** The network config effective value, under the same rule. */
export const seedNetworkDataEffectiveFact =
  "Left empty, an empty rendered network config is replaced by a built-in dual-match DHCP netplan, so a guest " +
  "still gets an address. Set this only to override that.";

/** `optional` is not rendered, and this is what stands in its place (F15). */
export const seedOptionalDroppedFact =
  "The selectors' optional flag is not offered: neither resolver reads it, and upstream documents that nowhere. " +
  "What it looks like it controls - what happens when the object or the key is missing - is the same either way: " +
  "the error returns raw, so the guest retries with backoff, with no Resolved=False condition and no Failed " +
  "phase. Setting it would change nothing except what the manifest appears to promise.";

/** The four precedences, made unreachable rather than validated (F20). */
export const seedPrecedencesFact =
  "Four precedences in this kind are silent and unenforced, and this form cannot express any of them: an inline " +
  "document beside a reference (which resolves to the reference), a Secret key beside a ConfigMap key (which " +
  "resolves to the Secret by statement order), an empty reference block (which satisfies the API server's rule " +
  "and renders nothing), and a reference with an empty name.";

/** What creating a seed profile sets in motion, which is nothing. */
export const seedCreatesNothingFact =
  "Creating a seed profile creates nothing else and starts nothing. There is no controller and no status " +
  "subresource: the object is inert until a SwiftGuest points at it.";

/** The Secret a guest will render later, and the doc error worth knowing about it. */
export const seedRenderedSecretFact =
  "The first guest that points at it renders one Secret named <guest name>-seed in the GUEST's namespace, with up " +
  "to three keys - one per document. Upstream's own reference still calls it a ConfigMap; it has been a Secret " +
  "since v0.13.4.";

/** Where an inline document ends up, which matters when it carries credentials. */
export const seedInlineCredentialsFact =
  "An inline document is stored in this object's spec in clear, so anything that can read the profile can read " +
  "it, and anything that mirrors this namespace into Git carries it there. A Secret key keeps it out of both.";

/** A profile edit after the guest exists rewrites bytes nobody reads. */
export const seedEditIsIgnoredFact =
  "Editing this profile after a guest has booted rewrites bytes nobody reads: the seed is consumed once, at first " +
  "boot. A changed profile reaches a guest only through a new guest.";

/** The cross-reference SPEC-0013 already acts on. */
export const seedKernelBootFact =
  "A kernel-boot guest's seed Secret is created and never mounted, which is why the Create Guest form refuses a " +
  "seed profile on kernel boot.";

/** Every field of the form, keyed the way the messages are. */
export type SeedProfileField =
  | "namespace"
  | "name"
  | "userData"
  | "userDataName"
  | "userDataKey"
  | "metaData"
  | "metaDataName"
  | "metaDataKey"
  | "networkData"
  | "networkDataName"
  | "networkDataKey";

/** Messages keyed by field, for the inline errors and the inline warnings. */
export type SeedProfileFieldMessages = Partial<Record<SeedProfileField, string>>;

/** How each field reads in the sentence next to the disabled submit button (W12). */
export const seedProfileFieldLabels: Record<SeedProfileField, string> = {
  namespace: "Namespace",
  name: "Name",
  userData: "User data",
  userDataName: "User data source",
  userDataKey: "User data key",
  metaData: "Metadata",
  metaDataName: "Metadata source",
  metaDataKey: "Metadata key",
  networkData: "Network config",
  networkDataName: "Network config source",
  networkDataKey: "Network config key",
};

/** The reading order of the form, which is the order the blocked sentence names fields in. */
const fieldOrder: SeedProfileField[] = [
  "namespace",
  "name",
  "userData",
  "userDataName",
  "userDataKey",
  "metaData",
  "metaDataName",
  "metaDataKey",
  "networkData",
  "networkDataName",
  "networkDataKey",
];

/** The objects one origin can be read from, as the reads on open found them. */
export function seedOriginObjects(inputs: SeedProfileCreateInputs, origin: SeedDocumentOrigin): SeedObjectFacts[] {
  return origin === "configMap" ? inputs.configMaps : inputs.secrets;
}

/** True when the read behind one origin was refused, which is what degrades its picker (T3). */
export function seedOriginUnverified(inputs: SeedProfileCreateInputs, origin: SeedDocumentOrigin): boolean {
  return origin === "configMap" ? inputs.configMapsUnverified : inputs.secretsUnverified;
}

/**
 * The keys the picked object carries, or `undefined` when they cannot be known.
 *
 * `undefined` is what sends the key control back to a text input: the read was
 * refused, or no object is picked, or the picked name is one the read never
 * returned. An object that really carries no keys answers `[]`, which is a
 * different sentence and gets a different control.
 */
export function seedObjectKeys(
  inputs: SeedProfileCreateInputs,
  origin: SeedDocumentOrigin,
  objectName: string,
): string[] | undefined {
  const name = objectName.trim();

  if (origin === "inline" || !name || seedOriginUnverified(inputs, origin)) {
    return undefined;
  }

  return seedOriginObjects(inputs, origin).find((object) => object.name === name)?.keys;
}

/**
 * Everything that would make this create fail, keyed by field.
 *
 * One of these is the API server's own CEL rule and the rest are this form's,
 * and the difference is stated in the messages: the CEL rule holds on every
 * cluster, while an empty selector name is a shape the API server ACCEPTS and
 * nothing downstream reports.
 */
export function seedProfileCreateErrors(values: SeedProfileFormValues): SeedProfileFieldMessages {
  const errors: SeedProfileFieldMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace =
      "A namespace is required: the profile and every Secret or ConfigMap it names live in one, and a guest " +
      "resolves the profile from its own namespace.";
  }

  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  for (const kind of seedDocumentKinds) {
    const document = values[kind];

    if (document.origin === "inline") {
      if (kind === "userData" && !document.inline.trim()) {
        errors.userData = seedUserDataRequiredMessage;
      }

      continue;
    }

    if (!document.objectName.trim()) {
      errors[`${kind}Name` as SeedProfileField] = seedSelectorNameRequiredMessage(kind, document.origin);
    }

    if (!document.key.trim()) {
      errors[`${kind}Key` as SeedProfileField] = seedSelectorKeyRequiredMessage(kind, document.origin);
    }
  }

  return errors;
}

/**
 * Everything worth saying about a field that would still be accepted.
 *
 * Warnings never block (W12), and here that is more than a habit: a Secret key
 * that does not exist yet is a legitimate thing to reference, because nothing
 * reads it until a guest is created.
 */
export function seedProfileCreateWarnings(
  inputs: SeedProfileCreateInputs,
  values: SeedProfileFormValues,
): SeedProfileFieldMessages {
  const warnings: SeedProfileFieldMessages = {};
  const name = values.name.trim();
  const namespace = values.namespace.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name = `A SwiftSeedProfile named ${name} already exists in ${namespace}. The create will be refused.`;
  } else if (name && inputs.existingNamesUnverified) {
    warnings.name =
      `The SwiftSeedProfiles of ${namespace || "this namespace"} could not be listed from here, so whether this ` +
      "name is already taken is unverified. The API server answers on submit.";
  }

  for (const kind of seedDocumentKinds) {
    const document = values[kind];
    const objectName = document.objectName.trim();
    const key = document.key.trim();

    if (document.origin === "inline" || !objectName) {
      continue;
    }

    if (seedOriginUnverified(inputs, document.origin)) {
      warnings[`${kind}Name` as SeedProfileField] =
        `${seedUnverifiedObjectHint(document.origin)} A reference that cannot be resolved makes the guest retry ` +
        "with backoff, with no condition to see it by.";
      continue;
    }

    const keys = seedObjectKeys(inputs, document.origin, objectName);

    if (keys === undefined) {
      warnings[`${kind}Name` as SeedProfileField] = seedMissingObjectWarning(document.origin, objectName);
      continue;
    }

    if (key && !keys.includes(key)) {
      warnings[`${kind}Key` as SeedProfileField] = seedMissingKeyWarning(document.origin, objectName, key);
    }
  }

  return warnings;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface SeedProfileBlockingIssue {
  label: string;
  message: string;
}

/** Every reason the form cannot be submitted, in the reading order of the form. */
export function seedProfileBlockingIssues(values: SeedProfileFormValues): SeedProfileBlockingIssue[] {
  const errors = seedProfileCreateErrors(values);

  return fieldOrder
    .filter((field) => errors[field])
    .map((field) => ({ label: seedProfileFieldLabels[field], message: errors[field] as string }));
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function seedProfileSubmitBlockReason(values: SeedProfileFormValues): string | undefined {
  const [first] = seedProfileBlockingIssues(values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/** One document as the payload carries it: an inline value, a reference, or nothing at all. */
export interface SeedDocumentPayload {
  value?: string;
  valueFrom?: SwiftSeedProfileDataValueFrom;
}

/**
 * One document group, as the payload carries it (F20).
 *
 * All four silent precedences are unreachable from here by construction rather
 * than by check:
 *
 * - the function returns at most ONE of `value` and `valueFrom`, so an inline
 *   document beside a reference cannot be assembled;
 * - `valueFrom` is built in one branch per origin, so two refs in one block
 *   cannot be either;
 * - an incomplete reference returns `{}` and the caller writes nothing, so no
 *   empty `*From: {}` is ever emitted;
 * - and the selector is built only from a non-empty name, so the core API's
 *   `""` default never reaches the object.
 *
 * The inline value is NOT trimmed: a cloud-init document is significant
 * whitespace, `#cloud-config` has to be the first line of it, and a form that
 * quietly reflowed a document would be a worse bug than any it prevented.
 * Emptiness is decided on the trimmed value all the same, because a document of
 * three spaces satisfies the API server's `size() > 0` and means nothing.
 */
export function seedDocumentPayload(document: SeedDocumentValues): SeedDocumentPayload {
  if (document.origin === "inline") {
    return document.inline.trim() ? { value: document.inline } : {};
  }

  const name = document.objectName.trim();
  const key = document.key.trim();

  if (!name || !key) {
    return {};
  }

  return document.origin === "secret"
    ? { valueFrom: { secretKeyRef: { name, key } } }
    : { valueFrom: { configMapKeyRef: { name, key } } };
}

/**
 * The object the create sends.
 *
 * `datasource` is always there (F16); every document is there only if it was
 * filled in, and an unfilled group leaves both of its keys out rather than
 * emitting an empty block.
 */
export function seedProfileCreatePayload(values: SeedProfileFormValues): { spec: SwiftSeedProfileSpec } {
  const spec: SwiftSeedProfileSpec = { datasource: seedDatasource };
  const userData = seedDocumentPayload(values.userData);
  const metaData = seedDocumentPayload(values.metaData);
  const networkData = seedDocumentPayload(values.networkData);

  if (userData.value !== undefined) {
    spec.userData = userData.value;
  }

  if (userData.valueFrom) {
    spec.userDataFrom = userData.valueFrom;
  }

  if (metaData.value !== undefined) {
    spec.metaData = metaData.value;
  }

  if (metaData.valueFrom) {
    spec.metaDataFrom = metaData.valueFrom;
  }

  if (networkData.value !== undefined) {
    spec.networkData = networkData.value;
  }

  if (networkData.valueFrom) {
    spec.networkDataFrom = networkData.valueFrom;
  }

  return { spec };
}

/** The live write summary, as the dialog renders it. */
export interface SeedProfileCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/** One line describing where a document comes from, for the summary. */
export function seedDocumentSummaryLine(kind: SeedDocumentKind, document: SeedDocumentValues): string | undefined {
  const label = seedDocumentLabels[kind];
  const field = seedDocumentSpecFields[kind];

  if (document.origin === "inline") {
    return document.inline.trim() ? `${label} is stored inline, in spec.${field}.` : undefined;
  }

  const name = document.objectName.trim();
  const key = document.key.trim();

  if (!name || !key) {
    return undefined;
  }

  return document.origin === "secret"
    ? `${label} is the key ${key} of the Secret ${name}, read when a guest is reconciled.`
    : `${label} is the key ${key} of the ConfigMap ${name}, read when a guest is reconciled.`;
}

/** True when at least one document is stored in the object's own spec. */
export function hasInlineSeedDocument(values: SeedProfileFormValues): boolean {
  return seedDocumentKinds.some((kind) => values[kind].origin === "inline" && values[kind].inline.trim() !== "");
}

/**
 * The live write summary: the one create line, then the facts that are true of
 * this object in this state (W1, rebuilt on every change).
 */
export function seedProfileCreateSummary(
  inputs: SeedProfileCreateInputs,
  values: SeedProfileFormValues,
): SeedProfileCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const notes: string[] = [];
  const warnings: string[] = [];

  notes.push(seedCreatesNothingFact);

  for (const kind of seedDocumentKinds) {
    const line = seedDocumentSummaryLine(kind, values[kind]);

    if (line) {
      notes.push(line);
    }
  }

  if (values.metaData.origin === "inline" && !values.metaData.inline.trim()) {
    notes.push(seedMetaDataEffectiveFact);
  }

  if (values.networkData.origin === "inline" && !values.networkData.inline.trim()) {
    notes.push(seedNetworkDataEffectiveFact);
  }

  notes.push(seedRenderedSecretFact);

  if (hasInlineSeedDocument(values)) {
    notes.push(seedInlineCredentialsFact);
  }

  notes.push(seedEditIsIgnoredFact);
  notes.push(seedKernelBootFact);

  // `optional` is deliberately NOT repeated here. It is stated once, in the
  // footer, where the control would have been (W12 option dropping); the
  // summary repeats warnings rather than facts, and a note that appears twice
  // on one screen reads as a bug rather than as emphasis.

  const warningsByField = seedProfileCreateWarnings(inputs, values);

  // Every unverified value and every missing reference is stated in the summary
  // as well as at its field, for the reason the shipped dialogs state their
  // sharpest sentence twice: the summary is what a user reads before pressing
  // OK, and a fact that only lives at a field is a fact a scrolled-past field
  // hides.
  for (const field of fieldOrder) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftSeedProfile ${namespace}/${name}`, notes, warnings };
}

/** What a create that succeeded is acknowledged with (W9). */
export function seedProfileCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftSeedProfile ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface SeedProfileCreateFailureContext {
  namespace: string;
  name: string;
}

/** The actionable sentence alone, for the three failures this dialog can predict. */
export function seedProfileCreateFailurePrefix(
  code: number | undefined,
  context: SeedProfileCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftSeedProfile named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === forbiddenStatusCode) {
    return `You are not allowed to create swiftseedprofiles in the namespace ${context.namespace}.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftSeedProfile CRD is gone.`;
  }

  return undefined;
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function seedProfileCreateFailureMessage(
  failure: ApiFailureFacts,
  context: SeedProfileCreateFailureContext,
): string | undefined {
  const prefix = seedProfileCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

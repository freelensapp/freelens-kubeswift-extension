/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create SwiftGuestPool form decides, as pure functions over the
// same structurally declared inputs the Create Guest form uses (SPEC-0015,
// "where the code lives"). The pool's own surface is what this module adds; the
// template is a `GuestFormValues` held inside these values and handed to
// `guest-create.ts` unchanged, so the two forms can never disagree about what a
// SwiftGuest is.
//
// What creating a SwiftGuestPool mechanically IS, and why almost none of it is
// visible from the schema:
//
// - `spec.template.spec` is a FULL SwiftGuest spec, not a subset: the two CRDs
//   carry the same 70 leaves and the Go type is literally `SwiftGuestSpec`. The
//   controller deep-copies it per replica and performs exactly four mutations -
//   `topologySpreadConstraints` overwritten (by the pool's own, by a
//   synthesized hostname constraint under `spreadPolicy: Spread`, or by nil
//   under the default `Pack`), `network.ports` wholly replaced by the pool
//   Service's ports with `expose` cleared, `cloneFromSnapshot.targetNode`
//   overwritten by a round-robin over the schedulable workers, and
//   `dataDiskRefs` appended with the per-replica claim-template references -
//   and copies everything else byte for byte.
// - TWO of the fields it copies unchanged must not be. `nodeName` is never
//   uniquified, so a pinned template puts every replica on one node and makes
//   the stamped constraints irrelevant; `interfaces[].mac` is copied verbatim,
//   so every replica comes up holding the same MAC. Nothing anywhere rejects
//   either: the pool has NO admission webhook at all, so the CRD's schema is
//   the entire server-side validation and it carries one CEL rule, inside the
//   template's own storage block.
// - Replicas are named `<pool>-<index>`, zero-based; the per-replica PVCs are
//   named `<template>-<pool>-<index>` - that order, which upstream's own
//   documents have backwards - and they are controller-owned by the POOL, so
//   deleting the pool deletes them and their data, which is the opposite of
//   what the guide promises.
// - `runPolicy` is the only template field with feedback into pool behaviour: a
//   Failed replica is replaced only if the live guest's policy is Running,
//   Always or RestartOnFailure, and a `Stopped` one is parked forever with its
//   index never refilled.
// - The rollout can deadlock: `maxUnavailable: 0` with `maxSurge: 0` is
//   schema-legal, coupled by no rule, reported by no condition, and can never
//   progress.
//
// The divergences from the embedded form are D1 to D4 of the spec, and each one
// is a decision about a field the Create Guest form already renders: the node
// pin WARNS above one replica and is never dropped, a template MAC is REFUSED
// above one replica, the three overwritten controls are dropped where the
// controller would replace them, and the summary multiplies.

import { notFoundStatusCode, writeFailurePrefix } from "./guest-actions";
import {
  defaultGuestForm,
  defaultPortProtocol,
  guestCreateBlockingIssues,
  guestCreatePayload,
  guestCreateSummary,
  maxGuestNameLength,
  maxPortNumber,
  maxServicePortNameLength,
  minPortNumber,
  nextRowId,
  nodePinApplies,
  seedProfileApplies,
} from "./guest-create";
import { quantityError } from "./guestclass-create";
import { storageClassNameError } from "./kube-storage";
import { conflictStatusCode } from "./migration-create";

import type { SwiftGuestProtocol, SwiftGuestSpec } from "../api/kubeswift/swiftguest-v1alpha1";
import type {
  SwiftGuestPoolService,
  SwiftGuestPoolServicePort,
  SwiftGuestPoolServiceType,
  SwiftGuestPoolSpreadPolicy,
  SwiftGuestPoolUpdateStrategy,
  SwiftGuestPoolUpdateStrategyType,
  SwiftGuestPoolVolumeClaimTemplate,
} from "../api/kubeswift/swiftguestpool-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";
import type { GuestCreateBlockingIssue, GuestCreateInputs, GuestFormValues } from "./guest-create";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createGuestPoolTitle = "Create Guest Pool";

/** The schema's own default for `replicas`, which this form sends explicitly (P11). */
export const defaultReplicas = "1";

/** The schema's default spread policy: no constraints at all. */
export const defaultSpreadPolicy: SwiftGuestPoolSpreadPolicy = "Pack";

/** The spread policies the control offers, in the order it offers them. */
export const poolSpreadPolicies: SwiftGuestPoolSpreadPolicy[] = ["Pack", "Spread"];

/** The Service types the pool's own Service may have. `expose` is not offered at all (P12). */
export const poolServiceTypes: SwiftGuestPoolServiceType[] = ["ClusterIP", "NodePort", "LoadBalancer"];

/** The type the API server stamps on a `service` block that does not name one. */
export const defaultPoolServiceType: SwiftGuestPoolServiceType = "ClusterIP";

/** The update strategies the control offers. */
export const poolUpdateStrategyTypes: SwiftGuestPoolUpdateStrategyType[] = ["RollingUpdate", "Recreate"];

/** The strategy the API server stamps on an `updateStrategy` block that does not name one. */
export const defaultUpdateStrategyType: SwiftGuestPoolUpdateStrategyType = "RollingUpdate";

/** The pace the API server stamps inside a `rollingUpdate` block. */
export const defaultMaxSurge = "0";
export const defaultMaxUnavailable = "1";

/** A DNS-1123 label, which is what a replica's name has to be. */
const dnsLabelPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** One port of the pool's own Service, as the inputs hold it. */
export interface PoolServicePortRow {
  id: string;
  /** `port`: the Service port, and the port injected into every replica. */
  port: string;
  /** `name`: required above one port, because it becomes the Service port's name. */
  name: string;
  /** `targetPort`: what the guest listens on. Empty means "the same as the port". */
  targetPort: string;
  protocol: SwiftGuestProtocol;
}

/** One per-replica claim template, in the vocabulary the blank data disk already uses. */
export interface PoolClaimTemplateRow {
  id: string;
  /** `metadata.name`: required by this form although the schema does not require it (P8). */
  name: string;
  /** `spec.resources.requests.storage`. */
  size: string;
  storageClass: string;
  /** `spec.accessModes[0]`. Empty means the storage class's own default. */
  accessMode: string;
  /** `spec.volumeMode`. Empty is the `Filesystem` a PVC implies. */
  volumeMode: string;
}

/** Every field the pool form holds, with the template's own values inside it. */
export interface PoolFormValues {
  namespace: string;
  name: string;
  /** A string because it is what an input holds; the payload parses it once. */
  replicas: string;
  spreadPolicy: SwiftGuestPoolSpreadPolicy;
  /** Whether `spec.service` is sent at all, which is what makes the ports control disappear (D3). */
  serviceEnabled: boolean;
  serviceType: SwiftGuestPoolServiceType;
  /** `service.headless`: only expressible on a ClusterIP Service (P12). */
  serviceHeadless: boolean;
  servicePorts: PoolServicePortRow[];
  claimTemplates: PoolClaimTemplateRow[];
  updateStrategyType: SwiftGuestPoolUpdateStrategyType;
  maxSurge: string;
  maxUnavailable: string;
  /**
   * The SwiftGuest this pool stamps out, authored by the Create Guest form.
   *
   * `namespace` is kept equal to the pool's, because it is what the namespaced
   * pickers read; `name` stays empty, because a template has no name of its own
   * and the replicas are named after the pool.
   */
  template: GuestFormValues;
}

/**
 * The form the dialog opens with.
 *
 * Three defaults and no more: the namespace when the page's filter names
 * exactly one, `replicas: 1` - the schema's own, not upstream's invented 2 -
 * and the template's own `runPolicy`, which is the field a pool needs most
 * (a template with no policy is a pool that will not replace a Failed replica).
 */
export function defaultPoolForm(namespace = ""): PoolFormValues {
  return {
    namespace,
    name: "",
    replicas: defaultReplicas,
    spreadPolicy: defaultSpreadPolicy,
    serviceEnabled: false,
    serviceType: defaultPoolServiceType,
    serviceHeadless: false,
    servicePorts: [],
    claimTemplates: [],
    updateStrategyType: defaultUpdateStrategyType,
    maxSurge: defaultMaxSurge,
    maxUnavailable: defaultMaxUnavailable,
    template: defaultGuestForm(namespace),
  };
}

/** The pool's fields, with the template's namespace kept equal to the pool's. */
export function setPoolNamespace(values: PoolFormValues, namespace: string): PoolFormValues {
  return { ...values, namespace, template: { ...values.template, namespace } };
}

/**
 * How many replicas this pool asks for, or `undefined` when the field does not
 * hold a number at all.
 *
 * Parsed once, here, so every rule that depends on the count - and there are
 * six of them - reads the same value.
 */
export function poolReplicas(values: PoolFormValues): number | undefined {
  const replicas = values.replicas.trim();

  if (!/^-?\d+$/.test(replicas)) {
    return undefined;
  }

  const count = Number.parseInt(replicas, 10);

  return Number.isFinite(count) ? count : undefined;
}

/**
 * The count the facts are stated for: the parsed one, or the schema's default
 * while the field is being typed.
 *
 * A summary that said nothing while the field was empty would be a summary that
 * disappears exactly when the user is deciding how many machines to create.
 */
export function replicaCount(values: PoolFormValues): number {
  return poolReplicas(values) ?? Number.parseInt(defaultReplicas, 10);
}

/** Whether the rules that only exist above one replica apply to this form. */
export function aboveOneReplica(values: PoolFormValues): boolean {
  return replicaCount(values) > 1;
}

/** Why a typed replica count would be refused, or `undefined` when it is legal. */
export function poolReplicasError(values: PoolFormValues): string | undefined {
  const replicas = values.replicas.trim();

  if (!replicas) {
    return "A replica count is required: the schema requires the field and defaults it to 1, so this form sends it explicitly rather than letting an install decide.";
  }

  if (!/^-?\d+$/.test(replicas)) {
    return "A replica count is a whole number: the schema declares it as an int32, so 2.5 and 'two' are refused by the API server rather than rounded.";
  }

  const count = poolReplicas(values);

  if (count === undefined || count < 0) {
    return "A replica count is at least 0: the schema's minimum. 0 is legal and means a pool that owns no guest yet, which is what scaling it up later fills in.";
  }

  return undefined;
}

/** How many digits the highest replica index takes, which is what the name budget is short by. */
function indexDigits(count: number): number {
  return String(Math.max(count - 1, 0)).length;
}

/**
 * The longest a pool's name may be, given how many replicas it will name.
 *
 * A replica is `<pool>-<index>`, and that name is the stem of its launcher pod,
 * its cloned root-disk PVC and its per-guest Service, each of which is a
 * DNS-1123 label capped at 63. So the pool's own budget is 63 minus the
 * separator minus the widest index it will ever write, and nothing upstream
 * checks any of it: the failure arrives later, from a controller, about an
 * object the operator never asked for.
 */
export function poolNameBudget(count: number): number {
  return maxGuestNameLength - 1 - indexDigits(count);
}

/** Why a typed pool name would be refused, or `undefined` when it is legal. */
export function poolNameError(values: PoolFormValues): string | undefined {
  const name = values.name.trim();

  if (!name) {
    return "A name is required: it is what every replica of this pool is named after.";
  }

  const count = replicaCount(values);
  const budget = poolNameBudget(count);

  if (name.length > budget) {
    return (
      `A pool of ${count} ${count === 1 ? "replica" : "replicas"} takes a name of at most ${budget} characters; this ` +
      `one is ${name.length}. Every replica is named <pool>-<index>, up to index ${Math.max(count - 1, 0)} here, and ` +
      "that name is the stem of its launcher pod, its cloned root disk and its per-guest Service - each of which is " +
      `a DNS label capped at ${maxGuestNameLength}.`
    );
  }

  if (!dnsLabelPattern.test(name)) {
    return (
      "A pool name is lowercase letters, digits and '-', starting and ending with a letter or a digit. Dots are not " +
      "allowed: the name becomes part of a DNS label of every replica's launcher pod and Service."
    );
  }

  return undefined;
}

/** The names the replicas of this pool will take, zero-based and stable. */
export function replicaNames(values: PoolFormValues, limit = 3): string[] {
  const name = values.name.trim() || "<name>";
  const count = replicaCount(values);

  return Array.from({ length: Math.min(count, limit) }, (_unused, index) => `${name}-${index}`);
}

/**
 * The names the replicas take, as one sentence with the last one named.
 *
 * The whole list is not printed: a pool of fifty replicas would push the rest
 * of the summary off the screen, and the first, the ellipsis and the last say
 * the same thing about the naming scheme.
 */
export function replicaNamesFact(values: PoolFormValues): string {
  const name = values.name.trim() || "<name>";
  const count = replicaCount(values);

  if (count === 0) {
    return `No guest is created yet: a pool of 0 replicas owns nothing until it is scaled up, and its replicas would be named ${name}-0 onwards.`;
  }

  if (count === 1) {
    return `One guest is created, named ${name}-0. The index is part of the name, so a pool of one is not a guest named ${name}.`;
  }

  return (
    `${count} guests are created, named ${name}-0 to ${name}-${count - 1}. The indices are stable and reused after ` +
    "a deletion, so a replica that is deleted comes back under the same name."
  );
}

/** The real name of one claim template's PVC for one replica: `<template>-<pool>-<index>`. */
export function poolPvcName(templateName: string, poolName: string, index: number): string {
  return `${templateName}-${poolName}-${index}`;
}

/**
 * Whether a pool Service can exist at all for this template.
 *
 * The controller injects the Service's ports into every replica's
 * `spec.network.ports` and needs the nat binding to install the in-pod DNAT; on
 * a bridge-bound template it skips the injection, garbage-collects the Service
 * and reports `ServiceReady=False`. The CRD's own description says such a pool
 * is "rejected at admission", and that describes a webhook that does not exist:
 * the pool IS admitted, and what an operator gets is a condition nobody looks
 * at. So the section is dropped (W12) and what really happens is stated in its
 * place.
 */
export function poolServiceApplies(values: PoolFormValues): boolean {
  return values.template.networkBinding !== "bridge";
}

/** Whether this form is sending a `spec.service` at all. */
export function poolServiceConfigured(values: PoolFormValues): boolean {
  return values.serviceEnabled && poolServiceApplies(values);
}

/** What happens instead, on a bridge-bound template, where the section is not rendered. */
export const poolServiceDroppedFact =
  "This template's primary interface is bridge-bound, so this pool gets no Service. The CRD says such a pool is " +
  "rejected at admission; there is no pool webhook, so it is admitted instead - the controller skips the port " +
  "injection, garbage-collects any Service it had made and reports ServiceReady=False, which is the only place the " +
  "refusal appears. The ports of a bridge-bound guest reach the network's own IP anyway.";

/** Whether `headless` means anything for this Service type. */
export function poolHeadlessApplies(type: SwiftGuestPoolServiceType): boolean {
  return type === defaultPoolServiceType;
}

/** Why `headless` is not offered on the other two types, said where the checkbox would be. */
export function poolHeadlessDroppedFact(type: SwiftGuestPoolServiceType): string {
  return (
    `A ${type} Service publishes an address, and a headless Service has none: the two are mutually exclusive, and ` +
    "upstream resolves the pair by silently overriding the headless flag. This form makes the pair inexpressible " +
    "instead, so nothing is sent that the controller would have to correct."
  );
}

/** Moves the Service to another type, dropping a headless flag the type cannot carry. */
export function setPoolServiceType(values: PoolFormValues, type: SwiftGuestPoolServiceType): PoolFormValues {
  return { ...values, serviceType: type, serviceHeadless: poolHeadlessApplies(type) ? values.serviceHeadless : false };
}

/** A fresh, empty Service port row. */
export function newPoolServicePortRow(id: string): PoolServicePortRow {
  return { id, port: "", name: "", targetPort: "", protocol: defaultPortProtocol };
}

export function addPoolServicePort(values: PoolFormValues): PoolFormValues {
  return {
    ...values,
    servicePorts: [...values.servicePorts, newPoolServicePortRow(nextRowId("service-port", values.servicePorts))],
  };
}

export function removePoolServicePort(values: PoolFormValues, id: string): PoolFormValues {
  return { ...values, servicePorts: values.servicePorts.filter((row) => row.id !== id) };
}

export function updatePoolServicePort(
  values: PoolFormValues,
  id: string,
  patch: Partial<PoolServicePortRow>,
): PoolFormValues {
  return {
    ...values,
    servicePorts: values.servicePorts.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  };
}

/** The fields one Service port row can carry a message on. */
export type PoolServicePortField = "port" | "name" | "targetPort" | "protocol";

export type PoolServicePortMessages = Partial<Record<PoolServicePortField, string>>;

/** How the submit-disabled sentence names each of them. */
export const poolServicePortFieldLabels: Record<PoolServicePortField, string> = {
  port: "Port",
  name: "Name",
  targetPort: "Target port",
  protocol: "Protocol",
};

const servicePortFieldOrder: PoolServicePortField[] = ["port", "name", "targetPort", "protocol"];

/** Why a port number would be refused, or `undefined` when it is legal. */
function portNumberError(value: string, label: string): string | undefined {
  const port = value.trim();

  if (!port) {
    return undefined;
  }

  if (!/^\d+$/.test(port)) {
    return `${label} is a whole number: the schema declares it as an int32.`;
  }

  const number = Number.parseInt(port, 10);

  if (number < minPortNumber || number > maxPortNumber) {
    return `${label} is between ${minPortNumber} and ${maxPortNumber}, which is the schema's own range.`;
  }

  return undefined;
}

/**
 * Everything that would make one Service port refuse the create, row by row.
 *
 * The name rule is the interesting one: it is REQUIRED above one port, exactly
 * as it is on a standalone guest - and where the guest's admission webhook
 * would have caught it, nothing catches it here, because the pool has no
 * webhook at all. What an operator gets instead is a controller that fails to
 * create the Service on every single reconcile, since Kubernetes refuses a
 * multi-port Service whose ports have no names (P12).
 */
export function poolServicePortErrors(values: PoolFormValues): PoolServicePortMessages[] {
  const rows = values.servicePorts;

  return rows.map((row) => {
    const messages: PoolServicePortMessages = {};
    const port = row.port.trim();
    const name = row.name.trim();
    const portError = portNumberError(port, "A port");

    if (!port) {
      messages.port = "A port number is required: the schema requires it on every entry of the list.";
    } else if (portError) {
      messages.port = portError;
    }

    if (!name && rows.length > 1) {
      messages.name =
        "A name is required above one port: it becomes the Service port's name, and Kubernetes refuses a " +
        "multi-port Service whose ports have none. Nothing validates it here - the pool has no admission webhook - " +
        "so the failure would be a Service the controller never manages to create.";
    } else if (name && !dnsLabelPattern.test(name)) {
      messages.name =
        "A port name is a DNS label: lowercase letters, digits and '-', starting and ending with a letter or a digit.";
    }

    const targetPortError = portNumberError(row.targetPort, "A target port");

    if (targetPortError) {
      messages.targetPort = targetPortError;
    }

    return messages;
  });
}

/** What is worth saying about a Service port that would still be accepted. */
export function poolServicePortWarnings(values: PoolFormValues): PoolServicePortMessages[] {
  return values.servicePorts.map((row) => {
    const messages: PoolServicePortMessages = {};
    const name = row.name.trim();

    if (name && name.length > maxServicePortNameLength) {
      messages.name =
        `A Service port name is at most ${maxServicePortNameLength} characters; this one is ${name.length}. The ` +
        "schema accepts it and the Service the controller then creates does not, so the pool would report " +
        "ServiceReady=False forever.";
    }

    return messages;
  });
}

/** Why the Service section as a whole would refuse the create. */
export function poolServiceError(values: PoolFormValues): string | undefined {
  if (!poolServiceConfigured(values)) {
    return undefined;
  }

  return values.servicePorts.length === 0
    ? "A pool Service carries at least one port: the schema declares `ports` as required with a minimum of one item, so a Service with none is refused by the API server."
    : undefined;
}

/**
 * What the pool's Service does, in one sentence, for the summary.
 *
 * The load balancing is the whole point and it is the thing upstream never
 * documents: ONE Service in front of every replica, with the ports injected
 * into each of them, and an endpoint that only becomes Ready once the in-guest
 * service answers.
 */
export function poolServiceFact(values: PoolFormValues): string {
  if (!poolServiceApplies(values)) {
    return poolServiceDroppedFact;
  }

  if (!values.serviceEnabled) {
    return "No Service is created for this pool. Each replica is still reachable pod-to-guest through its own in-pod DNAT, and the template's own ports are what declare it.";
  }

  const ports = values.servicePorts.filter((row) => row.port.trim() !== "").length;
  const carried = ports === 1 ? "its one port" : `${ports} ports`;

  return (
    `One ${values.serviceType} Service is created in front of every replica, carrying ${carried} and selecting them ` +
    `by the pool's own label${values.serviceHeadless ? ", headless, so DNS returns one A record per ready replica instead of a virtual IP" : ""}. ` +
    "Kubernetes load-balances across the replica pods, and an endpoint becomes Ready only once the guest behind it " +
    "answers."
  );
}

/**
 * What the template's network section says on its header line, in place of the
 * guest form's own.
 *
 * That line says a Service is created when a port asks to be exposed, which is
 * true of a standalone guest and false of a replica: the pool's Service is the
 * one that exists, and `expose` on a replica's port is cleared by the
 * controller. `undefined` leaves the shipped sentence alone.
 */
export function templateNetworkHint(values: PoolFormValues): string | undefined {
  if (!poolServiceConfigured(values)) {
    return undefined;
  }

  const nics = values.template.interfaces.length;
  const parts = [`${values.template.networkBinding} binding`];

  if (nics > 0) {
    parts.push(`${nics} additional ${nics === 1 ? "interface" : "interfaces"}`);
  }

  return (
    `${parts.join(", ")}. The pool's own ${values.serviceType} Service is what carries the ports, and it replaces ` +
    "every replica's."
  );
}

/**
 * What replaces the template's ports control when the pool has a Service (D3).
 *
 * The controller replaces `spec.network.ports` wholly, with `expose` cleared,
 * on every replica - so a form that offered the control would be collecting a
 * value it knows will be discarded, which is the same dishonesty as re-sending
 * a schema default.
 */
export function templatePortsDroppedFact(values: PoolFormValues): string {
  const ports = values.servicePorts
    .filter((row) => row.port.trim() !== "")
    .map((row) => `${row.port.trim()}/${row.protocol}${row.targetPort.trim() ? ` to ${row.targetPort.trim()}` : ""}`)
    .join(", ");

  return (
    "The pool's own Service ports become every replica's ports: the controller replaces spec.network.ports wholly, " +
    `with expose cleared, so nothing is offered or sent here.${ports ? ` They are ${ports}.` : ""} Remove the pool's ` +
    "Service to declare per-replica ports instead."
  );
}

/** A fresh, empty claim template row. */
export function newPoolClaimTemplateRow(id: string): PoolClaimTemplateRow {
  return { id, name: "", size: "", storageClass: "", accessMode: "", volumeMode: "" };
}

export function addPoolClaimTemplate(values: PoolFormValues): PoolFormValues {
  return {
    ...values,
    claimTemplates: [...values.claimTemplates, newPoolClaimTemplateRow(nextRowId("claim", values.claimTemplates))],
  };
}

export function removePoolClaimTemplate(values: PoolFormValues, id: string): PoolFormValues {
  return { ...values, claimTemplates: values.claimTemplates.filter((row) => row.id !== id) };
}

export function updatePoolClaimTemplate(
  values: PoolFormValues,
  id: string,
  patch: Partial<PoolClaimTemplateRow>,
): PoolFormValues {
  return {
    ...values,
    claimTemplates: values.claimTemplates.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  };
}

/** The fields one claim template row can carry a message on. */
export type PoolClaimTemplateField = "name" | "size" | "storageClass" | "accessMode" | "volumeMode";

export type PoolClaimTemplateMessages = Partial<Record<PoolClaimTemplateField, string>>;

export const poolClaimTemplateFieldLabels: Record<PoolClaimTemplateField, string> = {
  name: "Name",
  size: "Size",
  storageClass: "Storage class",
  accessMode: "Access mode",
  volumeMode: "Volume mode",
};

const claimTemplateFieldOrder: PoolClaimTemplateField[] = ["name", "size", "storageClass", "accessMode", "volumeMode"];

/**
 * Everything that would make one claim template refuse the create.
 *
 * `metadata.name` is required HERE and by nothing else (P8): the schema
 * requires the `metadata` object and not the name inside it, and an empty one
 * produces a PVC named `-<pool>-<index>`, which is not a legal object name - so
 * the pool reconciles, errors on the create, and reconciles again forever with
 * nothing on the pool explaining why no replica ever starts. The name also
 * cannot collide with a data disk of the template: both end up as volumes of
 * the same launcher pod, and only the guest webhook - the disabled one - would
 * ever say so.
 */
export function poolClaimTemplateErrors(values: PoolFormValues): PoolClaimTemplateMessages[] {
  const rows = values.claimTemplates;
  const dataDiskNames = values.template.dataDisks.map((row) => row.name.trim()).filter(Boolean);

  return rows.map((row, index) => {
    const messages: PoolClaimTemplateMessages = {};
    const name = row.name.trim();
    const size = row.size.trim();

    if (!name) {
      messages.name =
        "A name is required: it is the prefix of every PVC this template creates, and the schema does not require " +
        "it. An empty one yields the invalid PVC name -<pool>-<index>, and a pool whose PVC create is rejected " +
        "retries forever with nothing on the pool to explain it.";
    } else if (!dnsLabelPattern.test(name)) {
      messages.name =
        "A claim template name is a DNS label: lowercase letters, digits and '-', starting and ending with a letter " +
        "or a digit. It becomes the first segment of the PVC's own name.";
    } else if (dataDiskNames.includes(name)) {
      messages.name =
        `The template already has a data disk named ${name}. Both become volumes of the same launcher pod, so the ` +
        "guest spec the controller writes would carry two volumes with one name - a duplicate only the guest's " +
        "admission webhook would catch, and it ships disabled.";
    } else if (rows.some((other, otherIndex) => otherIndex < index && other.name.trim() === name)) {
      messages.name = `Another claim template of this pool is already named ${name}, and the two would produce the same PVC for every replica.`;
    }

    if (!size) {
      messages.size =
        "A size is required: a PVC with no storage request is refused by the API server, so the pool would retry " +
        "the same rejected create on every reconcile.";
    } else {
      const sizeError = quantityError(size);

      if (sizeError) {
        messages.size = sizeError;
      }
    }

    const storageClassMessage = storageClassNameError(row.storageClass.trim());

    if (storageClassMessage) {
      messages.storageClass = storageClassMessage;
    }

    return messages;
  });
}

/** What one claim template's PVCs are called, for index 0, as a fact under the row. */
export function poolClaimPvcFact(values: PoolFormValues, row: PoolClaimTemplateRow): string {
  const name = row.name.trim() || "<name>";
  const pool = values.name.trim() || "<pool>";
  const count = replicaCount(values);

  return (
    `The PVCs are named ${poolPvcName(name, pool, 0)} to ${poolPvcName(name, pool, Math.max(count - 1, 0))}: the ` +
    "order is <template>-<pool>-<index>, which both of upstream's own documents have backwards."
  );
}

/**
 * What one claim template means for the fleet, for the summary.
 *
 * Deliberately not the row's own sentence: the row states the names while the
 * operator is typing one, and the summary states what the claims are and who
 * owns them, which is what the deletion warning below it is about.
 */
export function poolClaimSummaryNote(values: PoolFormValues, row: PoolClaimTemplateRow): string {
  const name = row.name.trim() || "<name>";
  const pool = values.name.trim() || "<pool>";
  const size = row.size.trim();
  const count = replicaCount(values);

  return (
    `The storage template ${name} gives each of the ${count} ${count === 1 ? "replica" : "replicas"} ` +
    `${size ? `a ${size} PVC` : "a PVC"} of its own, ${poolPvcName(name, pool, 0)} to ` +
    `${poolPvcName(name, pool, Math.max(count - 1, 0))}, owned by the pool rather than by the replica - so it ` +
    "survives the replica's replacement and is rebound to the guest that takes its index."
  );
}

/** The one line about claim templates upstream's guide gets exactly backwards (P9). */
export const poolClaimDeletionWarning =
  "Deleting this pool deletes the per-replica PVCs it owns, and their data with them. The controller sets a " +
  "controller owner reference on each claim, so garbage collection takes them; the upstream guide promises the " +
  "opposite, and following it loses data.";

/** Whether the pace fields mean anything for this update strategy. */
export function rollingUpdateApplies(type: SwiftGuestPoolUpdateStrategyType): boolean {
  return type === defaultUpdateStrategyType;
}

/** What Recreate does instead, said where the pace fields would have been (W12). */
export const recreateStrategyFact =
  "Recreate replaces every replica at once when the template changes: the pace fields are only read for a rolling " +
  "update, so they are not offered here and nothing is sent for them.";

/** The fields the rollout section can carry a message on. */
export type PoolRolloutField = "maxSurge" | "maxUnavailable";

export type PoolRolloutMessages = Partial<Record<PoolRolloutField, string>>;

export const poolRolloutFieldLabels: Record<PoolRolloutField, string> = {
  maxSurge: "Max surge",
  maxUnavailable: "Max unavailable",
};

const rolloutFieldOrder: PoolRolloutField[] = ["maxUnavailable", "maxSurge"];

/** The deadlock this form makes inexpressible, in the words the field carries (P10). */
export const rolloutDeadlockMessage =
  "A rollout with max unavailable 0 AND max surge 0 can never progress: it may take no replica down and may create " +
  "no extra one, so a template change stalls forever. The pair is schema-legal, coupled by no rule, and reported by " +
  "no condition - move either of the two above 0.";

/** Everything that would make the rollout refuse the create. */
export function poolRolloutErrors(values: PoolFormValues): PoolRolloutMessages {
  const messages: PoolRolloutMessages = {};

  if (!rollingUpdateApplies(values.updateStrategyType)) {
    return messages;
  }

  const surge = paceValue(values.maxSurge);
  const unavailable = paceValue(values.maxUnavailable);

  if (surge === undefined) {
    messages.maxSurge =
      "Max surge is a whole number of 0 or more: the schema declares it as an int32 with a minimum of 0.";
  }

  if (unavailable === undefined) {
    messages.maxUnavailable =
      "Max unavailable is a whole number of 0 or more: the schema declares it as an int32 with a minimum of 0.";
  }

  if (surge === 0 && unavailable === 0) {
    messages.maxUnavailable = rolloutDeadlockMessage;
  }

  return messages;
}

/** One pace field as a number, or `undefined` when it is not one at all. */
function paceValue(value: string): number | undefined {
  const pace = value.trim();

  if (!/^\d+$/.test(pace)) {
    return undefined;
  }

  const number = Number.parseInt(pace, 10);

  return Number.isFinite(number) ? number : undefined;
}

/** What the rollout does to a running fleet, for the summary. */
export function poolRolloutFact(values: PoolFormValues): string {
  if (!rollingUpdateApplies(values.updateStrategyType)) {
    return recreateStrategyFact;
  }

  const surge = values.maxSurge.trim() || defaultMaxSurge;
  const unavailable = values.maxUnavailable.trim() || defaultMaxUnavailable;

  return (
    `A change to the template rolls the fleet: at most ${unavailable} replica${unavailable === "1" ? "" : "s"} ` +
    `unavailable and at most ${surge} extra one${surge === "1" ? "" : "s"} at a time, highest index first. Only ` +
    "spec.template.spec is hashed, so a change to the template's metadata rolls nothing at all."
  );
}

/**
 * What `spreadPolicy` really does, including the field it discards (D3).
 *
 * The discard is stated here rather than in the footer, because this is where
 * an operator looks for it: `topologySpreadConstraints` on a replica is
 * OVERWRITTEN on every reconcile - by the pool's own constraints, by a
 * synthesized hostname constraint under Spread, or by nil under Pack - so a
 * template that carried any would silently lose them.
 */
export function poolSpreadFact(values: PoolFormValues): string {
  const head =
    values.spreadPolicy === "Spread"
      ? "Spread adds a hostname topology constraint to every replica, so the scheduler spreads them across nodes as far as it can."
      : "Pack, the schema's default, adds no constraint at all: the scheduler places the replicas wherever it likes, which usually means together.";

  return (
    `${head} Either way the controller OVERWRITES each replica's topologySpreadConstraints - the pool's own take ` +
    "precedence, and under Pack the field is set to nothing - so constraints written into the template are " +
    "discarded rather than merged."
  );
}

/** The labels that make a node a control-plane one, which the round-robin skips. */
const controlPlaneLabels = ["node-role.kubernetes.io/control-plane", "node-role.kubernetes.io/master"];

/**
 * The nodes the clone round-robin would walk, in the order it walks them.
 *
 * Ready, schedulable, non-control-plane, sorted by name: the controller's own
 * ordering, which is what makes the preview below a statement rather than a
 * guess. `guestNodeChoices` is deliberately not reused - it keeps the control
 * plane, because a standalone guest may legitimately be pinned to it.
 */
export function schedulableWorkers(inputs: GuestCreateInputs): string[] {
  return inputs.nodes
    .filter(
      (node) =>
        node.ready && node.schedulable && !controlPlaneLabels.some((label) => node.labels?.[label] !== undefined),
    )
    .map((node) => node.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Where each replica of a cloning pool resumes, as a derived preview (D3, P6).
 *
 * `cloneFromSnapshot.targetNode` is overwritten per replica by a round-robin
 * over the workers, so the control the Create Guest form REQUIRES here - where
 * nothing else supplies the value - would be a control the pool controller
 * ignores. G10's block is lifted with it: blocking a submit on a field the
 * controller fills in would be this form refusing a create the API server
 * accepts.
 */
export function cloneTargetNodePreview(inputs: GuestCreateInputs, values: PoolFormValues): string | undefined {
  if (values.template.bootSource !== "clone") {
    return undefined;
  }

  const workers = schedulableWorkers(inputs);
  const count = replicaCount(values);

  if (inputs.nodesUnverified) {
    return (
      "The controller gives each replica a target node itself, walking the Ready, schedulable, non-control-plane " +
      "nodes in name order. This cluster's nodes could not be listed from here, so which node each replica lands " +
      "on cannot be shown - and if there are none at all, the whole reconcile aborts and no replica is created."
    );
  }

  if (workers.length === 0) {
    return (
      "The controller gives each replica a target node itself, and this cluster has no Ready, schedulable, " +
      "non-control-plane node for it to pick: with zero of them the reconcile ABORTS, so the pool creates no " +
      "replica at all rather than creating some of them."
    );
  }

  const assignments = Array.from(
    { length: Math.min(count, 3) },
    (_unused, index) => `${values.name.trim() || "<name>"}-${index} on ${workers[index % workers.length]}`,
  ).join(", ");

  return (
    `The controller gives each replica a target node itself, walking the ${workers.length} Ready, schedulable, ` +
    `non-control-plane ${workers.length === 1 ? "node" : "nodes"} in name order: ${assignments}` +
    `${count > 3 ? ", and so on" : ""}. Nothing is sent for it, and no target node is asked for here.`
  );
}

/**
 * What a node pin does to a pool of more than one replica (D1).
 *
 * A warning and never a refusal, and never a dropped field: a pinned pool is
 * legitimate on a single-node cluster, on the node that holds the local
 * storage, or on the node that has the devices. What is NOT legitimate is not
 * knowing, because upstream copies `nodeName` verbatim into every replica -
 * there is no node-name logic in the pool controller at all - so the fleet
 * lands on one node and the spread policy cannot save it: the pin bypasses the
 * scheduler that the constraints act on.
 */
export function poolNodePinWarning(values: PoolFormValues): string | undefined {
  const nodeName = values.template.nodeName.trim();

  if (!nodeName || !nodePinApplies(values.template.bootSource) || !aboveOneReplica(values)) {
    return undefined;
  }

  const count = replicaCount(values);

  return (
    `All ${count} replicas are pinned to ${nodeName}. The pool copies spec.nodeName into every replica unchanged - ` +
    "there is no node-name logic in the controller - so the whole fleet lands on that one node" +
    `${values.spreadPolicy === "Spread" ? ", and the Spread policy cannot save it" : " whatever the spread policy says"}: ` +
    "a pin binds the launcher pod directly and bypasses the scheduler the constraints act on."
  );
}

/**
 * Why a template MAC address is refused above one replica (D2).
 *
 * The one place this form refuses what the Create Guest form accepts, and the
 * asymmetry is the point: `interfaces[].mac` is copied verbatim into every
 * replica, so N machines come up holding one address on one L2 segment. Unlike
 * the pin it has no valid outcome - the field exists to pin ONE interface to
 * ONE address - and nothing else rejects it: the schema's pattern is
 * format-only, the guest webhook's rule is per-object and disabled, and the
 * pool has no webhook at all. At one replica it is as legitimate as it is on a
 * standalone guest, so the refusal is conditional on the count and releases the
 * moment the count comes back down.
 */
export function poolMacRefusals(values: PoolFormValues): { index: number; message: string }[] {
  if (!aboveOneReplica(values)) {
    return [];
  }

  const count = replicaCount(values);

  return values.template.interfaces
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.mac.trim() !== "")
    .map(({ row, index }) => ({
      index,
      message:
        `Interface ${index + 1} names the MAC address ${row.mac.trim()}, and the pool copies it into all ${count} ` +
        "replicas unchanged: every one of them would come up holding that address, which is a collision on any " +
        "segment they share. Nothing rejects it - the schema checks the format only, the guest's webhook rule is " +
        "per-object and ships disabled, and a pool has no webhook at all. Clear it, or create one replica.",
    }));
}

/**
 * Why a shared DRA ResourceClaim is worth a warning above one replica.
 *
 * `resourceClaimName` names ONE object; `resourceClaimTemplateName` mints one
 * claim per pod, which is the per-replica-correct choice, and nothing upstream
 * steers an operator towards it. A warning rather than a refusal: a claim
 * carrying enough devices for the whole fleet is a legitimate thing to share.
 */
export function poolGpuClaimWarning(values: PoolFormValues): string | undefined {
  const claimName = values.template.gpuClaimName.trim();

  if (!claimName || values.template.gpuBackend !== "claim" || !aboveOneReplica(values)) {
    return undefined;
  }

  return (
    `Every replica asks for the same ResourceClaim ${claimName}: a claim is one object with one allocation, so ` +
    `all ${replicaCount(values)} replicas contend for it and the ones that lose stay Pending. The resource claim ` +
    "template beside it is the per-replica answer - the scheduler mints one claim per launcher pod from it."
  );
}

/** What one seed profile means when every replica shares it. */
export function poolSeedProfileNote(values: PoolFormValues): string | undefined {
  const seedProfile = values.template.seedProfile.trim();

  if (!seedProfile || !seedProfileApplies(values.template.bootSource) || !aboveOneReplica(values)) {
    return undefined;
  }

  return (
    `Every replica is seeded from ${seedProfile}: there is no per-replica substitution at any layer, so the same ` +
    "cloud-init document reaches all of them. Per-replica identity has to come from the seed's own logic, or from " +
    "cloud-init reading the hostname, which is the replica's name <pool>-<index>."
  );
}

/**
 * Which data disks name one existing claim that every replica would share.
 *
 * A `pvcRef` is attached as it is, so N replicas attach ONE claim: with the
 * `ReadWriteOnce` most storage classes hand out, exactly one replica schedules
 * and the rest wait for a volume that will never be free. The claim templates
 * of this pool are the alternative, and the row says so.
 *
 * Derivation note: the recon states this mechanism for `filesystems`, and this
 * is the same one. It is the one rule of this form that is derived rather than
 * quoted, which is why it warns instead of refusing.
 */
export function poolSharedPvcWarnings(values: PoolFormValues): { index: number; message: string }[] {
  if (!aboveOneReplica(values)) {
    return [];
  }

  const count = replicaCount(values);

  return values.template.dataDisks
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.source === "pvc" && row.pvc.trim() !== "")
    .map(({ row, index }) => ({
      index,
      message:
        `All ${count} replicas attach the existing claim ${row.pvc.trim()}: a pvcRef is attached as it is, never ` +
        "copied, so one ReadWriteOnce claim lets exactly one replica schedule and parks the others. A per-replica " +
        "storage template of this pool gives each replica a claim of its own.",
    }));
}

/**
 * Which replica names a guest of this namespace already holds.
 *
 * A guest already named `<pool>-<index>` is NOT adopted - ownership is by owner
 * reference only - so the create fails with AlreadyExists and, the first error
 * aborting the reconcile, the pool never fans out at all. It is a warning and
 * never a block, for the reason SPEC-0013's own collision warning is one: the
 * read behind it can be stale, and a refused read must never accuse.
 */
export function poolReplicaNameWarning(inputs: GuestCreateInputs, values: PoolFormValues): string | undefined {
  const name = values.name.trim();

  if (!name) {
    return undefined;
  }

  if (inputs.existingNamesUnverified) {
    return (
      "The SwiftGuests of this namespace could not be listed, so whether a guest already holds one of this pool's " +
      "replica names is unknown from here. A name that is taken is not adopted: the pool's create fails with " +
      "AlreadyExists, and the first error aborts the reconcile, so the pool would never fan out."
    );
  }

  const count = replicaCount(values);
  const taken = Array.from({ length: count }, (_unused, index) => index).filter((index) =>
    inputs.existingNames.includes(`${name}-${index}`),
  );

  if (taken.length === 0) {
    return undefined;
  }

  const named = taken.map((index) => `${name}-${index}`).join(", ");

  return (
    `${taken.length === 1 ? "A guest" : `${taken.length} guests`} of this namespace already ${taken.length === 1 ? "holds" : "hold"} ` +
    `a replica name of this pool: ${named}. An existing guest is not adopted - ownership is by owner reference - so ` +
    "the pool's create fails with AlreadyExists, and the first error aborts the reconcile, leaving the pool with no " +
    "replicas at all."
  );
}

/**
 * The line the Spread header carries, open or shut.
 *
 * Short on purpose, like every other collapsed section's: the summary carries
 * the long form (`poolSpreadFact`), and a form that printed the same paragraph
 * twice within one screen is the duplication SPEC-0013 removed from its own
 * live-migration line.
 */
export function poolSpreadHint(values: PoolFormValues): string {
  return values.spreadPolicy === "Spread"
    ? "Spread: a hostname constraint on every replica, which the controller writes over the template's own."
    : "Pack, the schema's default: no constraint at all, and the template's own are discarded rather than merged.";
}

/** The line the Service header carries, open or shut. */
export function poolServiceHint(values: PoolFormValues): string {
  if (!poolServiceApplies(values)) {
    return "None: a bridge-bound template gets no pool Service.";
  }

  if (!values.serviceEnabled) {
    return "None. One Service can load-balance every replica, and its ports then replace the template's own.";
  }

  const ports = values.servicePorts.filter((row) => row.port.trim() !== "").length;

  return (
    `One ${values.serviceType}${values.serviceHeadless ? " headless" : ""} Service across every replica, ` +
    `${ports === 1 ? "1 port" : `${ports} ports`}.`
  );
}

/** The line the Rollout header carries, open or shut. */
export function poolRolloutHint(values: PoolFormValues): string {
  if (!rollingUpdateApplies(values.updateStrategyType)) {
    return "Recreate: every replica is replaced at once when the template changes.";
  }

  const surge = values.maxSurge.trim() || defaultMaxSurge;
  const unavailable = values.maxUnavailable.trim() || defaultMaxUnavailable;

  return `RollingUpdate: at most ${unavailable} unavailable and ${surge} extra at a time, highest index first.`;
}

/** The fields of the pool's own head, for the submit-disabled sentence. */
export type PoolCreateField = "namespace" | "name" | "replicas";

export const poolCreateFieldLabels: Record<PoolCreateField, string> = {
  namespace: "Namespace",
  name: "Name",
  replicas: "Replicas",
};

/** Everything that would make the pool's own fields refuse the create. */
export function poolCreateErrors(values: PoolFormValues): Partial<Record<PoolCreateField, string>> {
  const errors: Partial<Record<PoolCreateField, string>> = {};

  if (!values.namespace.trim()) {
    errors.namespace =
      "A namespace is required: the pool, every replica it creates and every per-replica PVC live in one.";
  }

  const nameError = poolNameError(values);

  if (nameError) {
    errors.name = nameError;
  }

  const replicasError = poolReplicasError(values);

  if (replicasError) {
    errors.replicas = replicasError;
  }

  return errors;
}

/**
 * The fields of the template the pool owns instead, which its own head asks
 * for and its own rules answer.
 *
 * `cloneTargetNode` is the third one and the only interesting one: the Create
 * Guest form REQUIRES it for the two downloaded tiers because nothing else
 * supplies it, and here the controller supplies it per replica, so keeping the
 * block would refuse a create the API server accepts (D3, P6).
 */
const templateFieldsOwnedByPool = ["namespace", "name", "cloneTargetNode"] as const;

/**
 * Every reason the pool form cannot be submitted, in the reading order of the
 * form.
 *
 * The pool's head first, then the template's own issues - the shipped
 * `guestCreateBlockingIssues`, minus the three fields this form owns - then the
 * MAC refusal, then the four collapsed sections in the order they are rendered.
 * A sentence that pointed at the third claim template while the namespace was
 * still empty would be pointing past the first thing the user has to fix.
 */
export function poolCreateBlockingIssues(
  inputs: GuestCreateInputs,
  values: PoolFormValues,
): GuestCreateBlockingIssue[] {
  const issues: GuestCreateBlockingIssue[] = [];
  const errors = poolCreateErrors(values);

  for (const field of ["namespace", "name", "replicas"] as const) {
    const message = errors[field];

    if (message) {
      issues.push({ label: poolCreateFieldLabels[field], message });
    }
  }

  issues.push(...guestCreateBlockingIssues(inputs, values.template, { skipFields: templateFieldsOwnedByPool }));

  for (const refusal of poolMacRefusals(values)) {
    issues.push({ label: `Interface ${refusal.index + 1} MAC address`, message: refusal.message });
  }

  const serviceError = poolServiceError(values);

  if (serviceError) {
    issues.push({ label: "Service", message: serviceError });
  }

  poolServicePortErrors(values).forEach((messages, index) => {
    for (const field of servicePortFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({
          label: `Service port ${index + 1} ${poolServicePortFieldLabels[field].toLowerCase()}`,
          message,
        });
      }
    }
  });

  poolClaimTemplateErrors(values).forEach((messages, index) => {
    for (const field of claimTemplateFieldOrder) {
      const message = messages[field];

      if (message) {
        issues.push({
          label: `Storage template ${index + 1} ${poolClaimTemplateFieldLabels[field].toLowerCase()}`,
          message,
        });
      }
    }
  });

  const rollout = poolRolloutErrors(values);

  for (const field of rolloutFieldOrder) {
    const message = rollout[field];

    if (message) {
      issues.push({ label: poolRolloutFieldLabels[field], message });
    }
  }

  return issues;
}

/** Why the submit button is disabled, naming the field and the reason (W4). */
export function poolCreateSubmitBlockReason(inputs: GuestCreateInputs, values: PoolFormValues): string | undefined {
  const [first] = poolCreateBlockingIssues(inputs, values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/** Whether the Service section holds an error, so the dialog can open it. */
export function poolServiceSectionHasError(values: PoolFormValues): boolean {
  return (
    Boolean(poolServiceError(values)) ||
    poolServicePortErrors(values).some((messages) => Object.keys(messages).length > 0)
  );
}

/** The same question for the per-replica storage section. */
export function poolStorageSectionHasError(values: PoolFormValues): boolean {
  return poolClaimTemplateErrors(values).some((messages) => Object.keys(messages).length > 0);
}

/** The same question for the rollout section. */
export function poolRolloutSectionHasError(values: PoolFormValues): boolean {
  return Object.keys(poolRolloutErrors(values)).length > 0;
}

/**
 * The template spec the pool sends: the Create Guest payload, minus exactly
 * what the controller would overwrite.
 *
 * Two removals and no additions, which is what makes the composition a
 * property rather than a coincidence: `cloneFromSnapshot.targetNode` always,
 * because the round-robin decides it per replica, and `network.ports` when a
 * pool Service is configured, because the Service's ports replace them wholly.
 * `dataDiskRefs` are left exactly as the guest form built them - the controller
 * APPENDS the claim-template references rather than replacing the list, so
 * pre-empting it here would be this form inventing the mechanism.
 */
export function poolTemplateSpec(inputs: GuestCreateInputs, values: PoolFormValues): Partial<SwiftGuestSpec> {
  const spec: Partial<SwiftGuestSpec> = { ...guestCreatePayload(inputs, values.template).spec };

  if (spec.cloneFromSnapshot) {
    const clone = { ...spec.cloneFromSnapshot };

    delete clone.targetNode;
    spec.cloneFromSnapshot = clone;
  }

  if (poolServiceConfigured(values) && spec.network?.ports) {
    const network = { ...spec.network };

    delete network.ports;

    if (Object.keys(network).length > 0) {
      spec.network = network;
    } else {
      // An empty `network` block is not the same thing as no block at all: the
      // API server would stamp the nat binding into it, which is a default this
      // form does not claim to own.
      delete spec.network;
    }
  }

  return spec;
}

/** One port of the pool's Service, with exactly the keys the row set. */
function servicePortPayload(row: PoolServicePortRow): SwiftGuestPoolServicePort | undefined {
  const port = Number.parseInt(row.port.trim(), 10);

  if (!Number.isFinite(port)) {
    return undefined;
  }

  const payload: SwiftGuestPoolServicePort = { port };
  const name = row.name.trim();
  const targetPort = Number.parseInt(row.targetPort.trim(), 10);

  if (name) {
    payload.name = name;
  }

  if (Number.isFinite(targetPort)) {
    payload.targetPort = targetPort;
  }

  if (row.protocol !== defaultPortProtocol) {
    payload.protocol = row.protocol;
  }

  // `expose` is never emitted: the controller accepts it on a pool port and
  // drops it, the pool's own `type` being what governs the single Service.
  return payload;
}

/** The pool's Service, or `undefined` when it has none. */
export function poolServicePayload(values: PoolFormValues): SwiftGuestPoolService | undefined {
  if (!poolServiceConfigured(values)) {
    return undefined;
  }

  const ports = values.servicePorts
    .map((row) => servicePortPayload(row))
    .filter((port): port is SwiftGuestPoolServicePort => port !== undefined);

  if (ports.length === 0) {
    return undefined;
  }

  const service: SwiftGuestPoolService = { ports };

  if (values.serviceType !== defaultPoolServiceType) {
    service.type = values.serviceType;
  }

  if (values.serviceHeadless && poolHeadlessApplies(values.serviceType)) {
    service.headless = true;
  }

  return service;
}

/** The per-replica claim templates, or `undefined` when none was added. */
export function poolClaimTemplatesPayload(values: PoolFormValues): SwiftGuestPoolVolumeClaimTemplate[] | undefined {
  const templates = values.claimTemplates
    .map((row) => claimTemplatePayload(row))
    .filter((template): template is SwiftGuestPoolVolumeClaimTemplate => template !== undefined);

  return templates.length > 0 ? templates : undefined;
}

/** One claim template, with exactly the keys its row set. */
function claimTemplatePayload(row: PoolClaimTemplateRow): SwiftGuestPoolVolumeClaimTemplate | undefined {
  const name = row.name.trim();
  const size = row.size.trim();

  if (!name || !size) {
    return undefined;
  }

  const template: SwiftGuestPoolVolumeClaimTemplate = {
    metadata: { name },
    spec: { resources: { requests: { storage: size } } },
  };
  const storageClass = row.storageClass.trim();
  const accessMode = row.accessMode.trim();
  const volumeMode = row.volumeMode.trim();

  if (accessMode) {
    template.spec.accessModes = [accessMode];
  }

  if (storageClass) {
    template.spec.storageClassName = storageClass;
  }

  if (volumeMode) {
    template.spec.volumeMode = volumeMode;
  }

  return template;
}

/**
 * The rollout, or `undefined` when it is the one the controller would use
 * anyway.
 *
 * `updateStrategy` has no default of its own, so an absent block is not a
 * re-sent default: what is defaulted is `type` and the two pace fields INSIDE
 * the blocks that carry them. Sending nothing is therefore the honest way to
 * say "the standard rolling update", and sending the pace is what a form does
 * when the operator has changed it.
 */
export function poolUpdateStrategyPayload(values: PoolFormValues): SwiftGuestPoolUpdateStrategy | undefined {
  if (!rollingUpdateApplies(values.updateStrategyType)) {
    return { type: values.updateStrategyType };
  }

  const surge = paceValue(values.maxSurge);
  const unavailable = paceValue(values.maxUnavailable);

  if (surge === undefined || unavailable === undefined) {
    return undefined;
  }

  if (values.maxSurge.trim() === defaultMaxSurge && values.maxUnavailable.trim() === defaultMaxUnavailable) {
    return undefined;
  }

  // Both are required by the schema as soon as the block exists, so the pace is
  // sent as a pair or not at all.
  return { rollingUpdate: { maxSurge: surge, maxUnavailable: unavailable } };
}

/** The pool spec this form sends. */
export interface PoolCreateSpec {
  /** Required and defaulted at once, so it is sent explicitly (P11). */
  replicas: number;
  template: { spec: Partial<SwiftGuestSpec> };
  spreadPolicy?: SwiftGuestPoolSpreadPolicy;
  service?: SwiftGuestPoolService;
  volumeClaimTemplates?: SwiftGuestPoolVolumeClaimTemplate[];
  updateStrategy?: SwiftGuestPoolUpdateStrategy;
}

/** The object the create sends: the pool's own fields, and the template's spec. */
export function poolCreatePayload(inputs: GuestCreateInputs, values: PoolFormValues): { spec: PoolCreateSpec } {
  const spec: PoolCreateSpec = {
    replicas: poolReplicas(values) ?? Number.parseInt(defaultReplicas, 10),
    template: { spec: poolTemplateSpec(inputs, values) },
  };

  if (values.spreadPolicy !== defaultSpreadPolicy) {
    spec.spreadPolicy = values.spreadPolicy;
  }

  const service = poolServicePayload(values);
  const claimTemplates = poolClaimTemplatesPayload(values);
  const updateStrategy = poolUpdateStrategyPayload(values);

  if (service) {
    spec.service = service;
  }

  if (claimTemplates) {
    spec.volumeClaimTemplates = claimTemplates;
  }

  if (updateStrategy) {
    spec.updateStrategy = updateStrategy;
  }

  return { spec };
}

/** The facts the live write summary is built from. The component owns the JSX. */
export interface PoolCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/** How the fan-out really happens, which is neither batched nor capped. */
export const poolFanOutFact =
  "Every missing replica is created in ONE unbatched pass, with no rate limit and no surge cap, and the first " +
  "create error aborts the reconcile - so a pool that comes up partially created is a normal outcome rather than a " +
  "fault, and the next reconcile fills in the rest.";

/**
 * The live write summary: the one create line, the pool's own facts, and the
 * Create Guest summary's lines read as N times themselves (W1, D4).
 *
 * The order is the order things happen: what is stored, what it is named, what
 * is created per replica, how it is placed, exposed, stored and rolled - and
 * only then what each individual replica is, which is the embedded form's own
 * summary unchanged.
 */
export function poolCreateSummary(inputs: GuestCreateInputs, values: PoolFormValues): PoolCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const count = replicaCount(values);
  const notes: string[] = [];
  const warnings: string[] = [];
  const guest = guestCreateSummary(inputs, values.template);

  notes.push(replicaNamesFact(values));

  if (count > 0) {
    notes.push(multiplicationFact(values, count));
  }

  for (const row of values.claimTemplates) {
    if (row.name.trim()) {
      notes.push(poolClaimSummaryNote(values, row));
    }
  }

  notes.push(poolSpreadFact(values));
  notes.push(poolServiceFact(values));

  if (poolServiceConfigured(values)) {
    notes.push(templatePortsDroppedFact(values));
  }

  const clonePreview = cloneTargetNodePreview(inputs, values);

  if (clonePreview) {
    notes.push(clonePreview);
  }

  notes.push(poolRolloutFact(values));

  const seedNote = poolSeedProfileNote(values);

  if (seedNote) {
    notes.push(seedNote);
  }

  if (count > 0) {
    notes.push(poolFanOutFact);
  }

  // The embedded form's own summary, introduced as what it is: a description of
  // ONE replica, of which this create makes N.
  if (guest.notes.length > 0) {
    notes.push(
      count === 1
        ? "The one replica of this pool is a full SwiftGuest, and this is what it is:"
        : `Each of the ${count} replicas is a full SwiftGuest, and this is what each of them is:`,
    );
    notes.push(...guest.notes);
  }

  if (values.claimTemplates.some((row) => row.name.trim() !== "")) {
    warnings.push(poolClaimDeletionWarning);
  }

  const pinWarning = poolNodePinWarning(values);

  if (pinWarning) {
    warnings.push(pinWarning);
  }

  const gpuClaimWarning = poolGpuClaimWarning(values);

  if (gpuClaimWarning) {
    warnings.push(gpuClaimWarning);
  }

  for (const shared of poolSharedPvcWarnings(values)) {
    warnings.push(shared.message);
  }

  const collision = poolReplicaNameWarning(inputs, values);

  if (collision) {
    warnings.push(collision);
  }

  warnings.push(...guest.warnings);

  return { write: `Create SwiftGuestPool ${namespace}/${name}`, notes, warnings };
}

/**
 * What a create of N replicas really creates, counted rather than implied (D4).
 *
 * The numbers ARE the warning: the schema sets no upper bound on `replicas` and
 * the right cap is a fact of the cluster, so this form invents none and
 * multiplies out loud instead.
 */
function multiplicationFact(values: PoolFormValues, count: number): string {
  const template = values.template;
  const created: string[] = [];
  const each = count === 1 ? "" : `${count} `;

  if (template.runPolicy !== "Stopped") {
    created.push(`${each}launcher ${count === 1 ? "pod" : "pods"}`);
  }

  if (template.bootSource === "image" && template.image.trim()) {
    created.push(`${each}root-disk ${count === 1 ? "clone" : "clones"} of ${template.image.trim()}`);
  }

  if (template.seedProfile.trim() && seedProfileApplies(template.bootSource)) {
    created.push(`${each}seed ${count === 1 ? "Secret" : "Secrets"}`);
  }

  for (const disk of template.dataDisks) {
    const diskName = disk.name.trim();

    if (!diskName) {
      continue;
    }

    if (disk.source === "blank" && disk.blankSize.trim()) {
      created.push(`${each}${disk.blankSize.trim()} ${count === 1 ? "PVC" : "PVCs"} for the data disk ${diskName}`);
    }

    if (disk.source === "image" && disk.image.trim()) {
      created.push(
        `${each}${count === 1 ? "PVC" : "PVCs"} cloned from ${disk.image.trim()} for the data disk ${diskName}`,
      );
    }
  }

  for (const row of values.claimTemplates) {
    if (row.name.trim() && row.size.trim()) {
      created.push(
        `${each}${row.size.trim()} ${count === 1 ? "PVC" : "PVCs"} for the storage template ${row.name.trim()}`,
      );
    }
  }

  if (created.length === 0) {
    return `${count} SwiftGuest ${count === 1 ? "object is" : "objects are"} created, one per replica.`;
  }

  return `That is ${created.join(", ")}, one set per replica.`;
}

/** The success sentence: the fact that was written, never a prediction (W9). */
export function poolCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftGuestPool ${namespace}/${name} created`;
}

/** What a failed create was trying to write. */
export interface PoolCreateFailureContext {
  namespace: string;
  name: string;
}

/**
 * The actionable sentence alone, for the three failures this dialog can
 * predict.
 *
 * The 409 is the one it produces on purpose: this form uses `store.create`
 * rather than upstream's forced apply, so a name clash is an AlreadyExists that
 * reopens the form - not an overwrite that would also roll the existing fleet
 * onto this template (P2).
 */
export function poolCreateFailurePrefix(
  code: number | undefined,
  context: PoolCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftGuestPool named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftGuestPool CRD is gone.`;
  }

  return writeFailurePrefix(code, { verb: "create", resource: "swiftguestpools", namespace: context.namespace });
}

/** One actionable sentence prefixed to what the API server said, never replacing it (W9). */
export function poolCreateFailureMessage(
  failure: ApiFailureFacts,
  context: PoolCreateFailureContext,
): string | undefined {
  const prefix = poolCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

/** The fields the pool form does not offer, named rather than silently absent (G1). */
export const poolExcludedFieldsFooter =
  "Not on this form, for the pool itself: topologySpreadConstraints (spreadPolicy above covers what they are " +
  "reached for, and explicit ones take precedence over it), service.annotations, service.loadBalancerClass, " +
  "service.ports[].expose (the controller drops it), template.metadata (the pool hashes template.spec only, so " +
  "editing it later changes nothing), and the claim templates' dataSource, dataSourceRef, selector, volumeName and " +
  "volumeAttributesClassName. Freelens' own YAML editor can add any of them, and it is also what edits a pool that " +
  "already exists - losslessly, which upstream's own edit path does not manage.";

/** What the replicas field means, on the field itself. */
export const replicasFact =
  "How many SwiftGuests this pool keeps alive. 0 is legal and means a pool that owns nothing yet; there is no upper " +
  "bound in the schema, and the right one is a fact of the cluster, so the summary multiplies rather than guessing " +
  "a cap.";

/** What the per-replica storage section is for, on its header line. */
export function poolClaimTemplatesHint(values: PoolFormValues): string {
  const count = values.claimTemplates.length;

  if (count === 0) {
    return "Optional. Each template here gives every replica a PVC of its own, named <template>-<pool>-<index> and owned by the pool - which is the whole of the stateful-pool feature, and is unreachable in upstream's own UI.";
  }

  return `${count} per-replica ${count === 1 ? "claim" : "claims"} for each of the ${replicaCount(values)} ${replicaCount(values) === 1 ? "replica" : "replicas"}. They are owned by the pool, so they survive a replica's replacement and are deleted with the pool.`;
}

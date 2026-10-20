/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Network section of the Create Sandbox and Create Sandbox Pool forms
// (SPEC-0019 T4): the ports a sandbox exposes, who may reach them, and where a
// restricted guest may go besides DNS and the public internet. One schema on
// both kinds, so one module, with the kind passed in where the consequence
// differs.
//
// Every rule the admission webhook would enforce is enforced here, because the
// webhook ships disabled: a port with mode none, an egress rule without mode
// restricted, an ingress rule with no port to narrow, and the schema's own
// counts, ranges and name rules. Nothing here reads a store or emits JSX.

import { nextRowId } from "./guest-create";
import { addKeyValueRow, keyValuePayload, keyValueRowErrors, removeKeyValueRow, updateKeyValueRow } from "./label-rows";

import type {
  SwiftSandboxEgressRule,
  SwiftSandboxNetwork,
  SwiftSandboxNetworkPeer,
} from "../api/kubeswift/swiftsandbox-v1alpha1";
import type { KeyValueMessages, KeyValueRow } from "./label-rows";

/** `spec.network.mode` when the form leaves it empty: the schema's default. */
const defaultMode = "restricted";

/** `spec.network.ports`, at most. */
export const maxSandboxPorts = 16;

/** `spec.network.ingress.from`, at most. */
export const maxIngressSources = 16;

/** `spec.network.egress.allow`, at most. */
export const maxEgressRules = 32;

/** The ports of one egress rule, at most. */
export const maxEgressRulePorts = 16;

/** An IANA service name is at most this long. */
export const maxPortNameLength = 15;

/** The lowest and highest port numbers the schema accepts. */
export const minPortNumber = 1;
export const maxPortNumber = 65535;

/** The label every namespace carries with its own name, which a by-name selector matches. */
export const namespaceNameLabel = "kubernetes.io/metadata.name";

/** The cloud metadata range, which stays blocked whatever egress allows. */
export const metadataRange = "169.254.0.0/16";

/** The two egress protocols. */
export const egressProtocols: string[] = ["TCP", "UDP"];

/** Which kind of object the section is part of, for the sentences whose subject differs. */
export type SandboxNetworkKind = "sandbox" | "pool";

/** One exposed port: a name and a number, TCP being the only protocol. */
export interface SandboxPortRow {
  id: string;
  name: string;
  port: string;
}

/** The three source shapes the form offers (D3): no expressions, no combined selectors. */
export type SandboxIngressSourceKind = "cidr" | "namespace" | "pods";

export const sandboxIngressSourceKinds: SandboxIngressSourceKind[] = ["cidr", "namespace", "pods"];

export const sandboxIngressSourceLabels: Record<SandboxIngressSourceKind, string> = {
  cidr: "IP range",
  namespace: "Namespace",
  pods: "Pods of this namespace",
};

/** One ingress source. Only the fields of its kind are read. */
export interface SandboxIngressRow {
  id: string;
  kind: SandboxIngressSourceKind;
  /** `ipBlock.cidr`. */
  cidr: string;
  /** `ipBlock.except`, as typed: CIDRs separated by commas or spaces. */
  except: string;
  /** A namespace by name, written as a selector on `kubernetes.io/metadata.name`. */
  namespace: string;
  /** `podSelector.matchLabels`. */
  podLabels: KeyValueRow[];
}

/** An egress destination: an IPv4 range or a Service. */
export type SandboxEgressDestinationKind = "cidr" | "service";

export const sandboxEgressDestinationKinds: SandboxEgressDestinationKind[] = ["service", "cidr"];

export const sandboxEgressDestinationLabels: Record<SandboxEgressDestinationKind, string> = {
  service: "Service",
  cidr: "IPv4 range",
};

/** One port an egress rule is narrowed to. */
export interface SandboxEgressPortRow {
  id: string;
  port: string;
  protocol: string;
}

/** One egress rule. Only the fields of its kind are read. */
export interface SandboxEgressRow {
  id: string;
  kind: SandboxEgressDestinationKind;
  cidr: string;
  serviceName: string;
  /** Empty is the object's own namespace. */
  serviceNamespace: string;
  ports: SandboxEgressPortRow[];
}

/** Everything the Network section holds, next to the mode the shape already has. */
export interface SandboxNetworkValues {
  ports: SandboxPortRow[];
  ingress: SandboxIngressRow[];
  egress: SandboxEgressRow[];
}

export function defaultSandboxNetwork(): SandboxNetworkValues {
  return { ports: [], ingress: [], egress: [] };
}

/** The mode in force: the one typed, or the schema's default. */
export function effectiveNetworkMode(mode: string): string {
  return mode.trim() || defaultMode;
}

// ---------------------------------------------------------------------------
// The rows.
// ---------------------------------------------------------------------------

export function addSandboxPort(network: SandboxNetworkValues): SandboxNetworkValues {
  return { ...network, ports: [...network.ports, { id: nextRowId("port", network.ports), name: "", port: "" }] };
}

export function removeSandboxPort(network: SandboxNetworkValues, id: string): SandboxNetworkValues {
  return { ...network, ports: network.ports.filter((row) => row.id !== id) };
}

export function updateSandboxPort(
  network: SandboxNetworkValues,
  id: string,
  patch: Partial<SandboxPortRow>,
): SandboxNetworkValues {
  return { ...network, ports: network.ports.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

export function addIngressSource(network: SandboxNetworkValues): SandboxNetworkValues {
  const row: SandboxIngressRow = {
    id: nextRowId("ingress", network.ingress),
    kind: "cidr",
    cidr: "",
    except: "",
    namespace: "",
    podLabels: [],
  };

  return { ...network, ingress: [...network.ingress, row] };
}

export function removeIngressSource(network: SandboxNetworkValues, id: string): SandboxNetworkValues {
  return { ...network, ingress: network.ingress.filter((row) => row.id !== id) };
}

export function updateIngressSource(
  network: SandboxNetworkValues,
  id: string,
  patch: Partial<SandboxIngressRow>,
): SandboxNetworkValues {
  return { ...network, ingress: network.ingress.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/** Moves one source to another shape, emptying the fields of the shape it leaves. */
export function setIngressSourceKind(
  network: SandboxNetworkValues,
  id: string,
  kind: SandboxIngressSourceKind,
): SandboxNetworkValues {
  return updateIngressSource(network, id, { kind, cidr: "", except: "", namespace: "", podLabels: [] });
}

export function addIngressPodLabel(network: SandboxNetworkValues, id: string): SandboxNetworkValues {
  const row = network.ingress.find((candidate) => candidate.id === id);

  return row ? updateIngressSource(network, id, { podLabels: addKeyValueRow(row.podLabels, "pod-label") }) : network;
}

export function removeIngressPodLabel(
  network: SandboxNetworkValues,
  id: string,
  labelId: string,
): SandboxNetworkValues {
  const row = network.ingress.find((candidate) => candidate.id === id);

  return row ? updateIngressSource(network, id, { podLabels: removeKeyValueRow(row.podLabels, labelId) }) : network;
}

export function updateIngressPodLabel(
  network: SandboxNetworkValues,
  id: string,
  labelId: string,
  patch: Partial<KeyValueRow>,
): SandboxNetworkValues {
  const row = network.ingress.find((candidate) => candidate.id === id);

  return row
    ? updateIngressSource(network, id, { podLabels: updateKeyValueRow(row.podLabels, labelId, patch) })
    : network;
}

export function addEgressRule(network: SandboxNetworkValues): SandboxNetworkValues {
  const row: SandboxEgressRow = {
    id: nextRowId("egress", network.egress),
    kind: "service",
    cidr: "",
    serviceName: "",
    serviceNamespace: "",
    ports: [],
  };

  return { ...network, egress: [...network.egress, row] };
}

export function removeEgressRule(network: SandboxNetworkValues, id: string): SandboxNetworkValues {
  return { ...network, egress: network.egress.filter((row) => row.id !== id) };
}

export function updateEgressRule(
  network: SandboxNetworkValues,
  id: string,
  patch: Partial<SandboxEgressRow>,
): SandboxNetworkValues {
  return { ...network, egress: network.egress.map((row) => (row.id === id ? { ...row, ...patch } : row)) };
}

/** Moves one rule to the other destination, emptying the fields of the one it leaves; the ports stay. */
export function setEgressRuleKind(
  network: SandboxNetworkValues,
  id: string,
  kind: SandboxEgressDestinationKind,
): SandboxNetworkValues {
  return updateEgressRule(network, id, { kind, cidr: "", serviceName: "", serviceNamespace: "" });
}

export function addEgressPort(network: SandboxNetworkValues, id: string): SandboxNetworkValues {
  const row = network.egress.find((candidate) => candidate.id === id);

  if (!row) {
    return network;
  }

  return updateEgressRule(network, id, {
    ports: [...row.ports, { id: nextRowId("egress-port", row.ports), port: "", protocol: "TCP" }],
  });
}

export function removeEgressPort(network: SandboxNetworkValues, id: string, portId: string): SandboxNetworkValues {
  const row = network.egress.find((candidate) => candidate.id === id);

  return row ? updateEgressRule(network, id, { ports: row.ports.filter((port) => port.id !== portId) }) : network;
}

export function updateEgressPort(
  network: SandboxNetworkValues,
  id: string,
  portId: string,
  patch: Partial<SandboxEgressPortRow>,
): SandboxNetworkValues {
  const row = network.egress.find((candidate) => candidate.id === id);

  return row
    ? updateEgressRule(network, id, {
        ports: row.ports.map((port) => (port.id === portId ? { ...port, ...patch } : port)),
      })
    : network;
}

// ---------------------------------------------------------------------------
// The add controls: disabled with their reason, never hidden (W4).
// ---------------------------------------------------------------------------

/** What a port is refused with under mode none, at the section and at the add control. */
export const portsWithModeNoneMessage =
  "Ports are not valid with network mode none: such a sandbox has no network at all, so there is nothing to " +
  "forward a port to. Choose restricted or open above, or remove the ports.";

/** Why the add-a-port control is disabled, or `undefined` when it is enabled. */
export function addPortBlockedReason(mode: string, network: SandboxNetworkValues): string | undefined {
  if (effectiveNetworkMode(mode) === "none") {
    return portsWithModeNoneMessage;
  }

  return network.ports.length >= maxSandboxPorts
    ? `The schema allows at most ${maxSandboxPorts} ports, and all ${maxSandboxPorts} are declared.`
    : undefined;
}

/** What an ingress rule is refused with while no port is declared. */
export const ingressWithoutPortsMessage =
  "Ingress narrows who may reach the ports, and none is declared: without a port nothing inbound is admitted at " +
  "all, so a source here would allow nothing. Declare a port first, or remove the sources.";

/** Why the add-a-source control is disabled, or `undefined` when it is enabled. */
export function addIngressBlockedReason(network: SandboxNetworkValues): string | undefined {
  if (network.ports.length === 0) {
    return ingressWithoutPortsMessage;
  }

  return network.ingress.length >= maxIngressSources
    ? `The schema allows at most ${maxIngressSources} sources, and all ${maxIngressSources} are set.`
    : undefined;
}

/** What an egress rule is refused with outside mode restricted. */
export function egressModeMessage(mode: string): string {
  return effectiveNetworkMode(mode) === "open"
    ? "Egress rules are only valid with network mode restricted: mode open already reaches whatever the pod " +
        "network reaches, so a rule would allow nothing more. Choose restricted, or remove the rules."
    : "Egress rules are only valid with network mode restricted: mode none has no network at all. Choose " +
        "restricted, or remove the rules.";
}

/** Why the add-a-destination control is disabled, or `undefined` when it is enabled. */
export function addEgressBlockedReason(mode: string, network: SandboxNetworkValues): string | undefined {
  if (effectiveNetworkMode(mode) !== "restricted") {
    return egressModeMessage(mode);
  }

  return network.egress.length >= maxEgressRules
    ? `The schema allows at most ${maxEgressRules} destinations, and all ${maxEgressRules} are set.`
    : undefined;
}

/** Why one rule's add-a-port control is disabled, or `undefined` when it is enabled. */
export function addEgressPortBlockedReason(row: SandboxEgressRow): string | undefined {
  return row.ports.length >= maxEgressRulePorts
    ? `The schema allows at most ${maxEgressRulePorts} ports per destination, and all ${maxEgressRulePorts} are set.`
    : undefined;
}

// ---------------------------------------------------------------------------
// The rules.
// ---------------------------------------------------------------------------

/** What an IANA service name is, said once for every place that asks for one. */
export const portNameMessage =
  `A port name is an IANA service name: at most ${maxPortNameLength} lowercase letters, digits and '-', with at ` +
  "least one letter, not starting or ending with '-' and with no '--'. It becomes the launcher pod's containerPort " +
  "name, which Kubernetes refuses otherwise.";

/** Whether a string is an IANA service name, the rule Kubernetes applies to a container port's name. */
export function isIanaServiceName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= maxPortNameLength &&
    /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(name) &&
    /[a-z]/.test(name) &&
    !name.includes("--")
  );
}

/** A port number as a number, or `undefined` when the field does not hold one in range. */
export function portNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);

  return parsed >= minPortNumber && parsed <= maxPortNumber ? parsed : undefined;
}

/** What a port number out of range is refused with. */
export const portNumberMessage = `A port is a whole number from ${minPortNumber} to ${maxPortNumber}.`;

/** An address range, parsed: its family, its first address and its prefix length. */
export interface ParsedCidr {
  family: 4 | 6;
  address: bigint;
  prefix: number;
}

function parseIPv4(text: string): bigint | undefined {
  const parts = text.split(".");

  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    return undefined;
  }

  return parts.reduce((total, part) => (total << 8n) + BigInt(Number(part)), 0n);
}

function parseIPv6(text: string): bigint | undefined {
  if (!/^[0-9a-fA-F:.]+$/.test(text) || text.split("::").length > 2) {
    return undefined;
  }

  const [head, tail] = text.includes("::") ? text.split("::") : [text, undefined];
  const split = (part: string) => (part ? part.split(":") : []);
  let left = split(head);
  let right = tail === undefined ? [] : split(tail);
  const embedded = (tail === undefined ? left : right).at(-1);
  const extra: string[] = [];

  // An embedded IPv4 tail (::ffff:10.0.0.1) counts as the last two groups.
  if (embedded?.includes(".")) {
    const v4 = parseIPv4(embedded);

    if (v4 === undefined) {
      return undefined;
    }

    extra.push(((v4 >> 16n) & 0xffffn).toString(16), (v4 & 0xffffn).toString(16));

    if (tail === undefined) {
      left = left.slice(0, -1);
    } else {
      right = right.slice(0, -1);
    }
  }

  const groups = left.length + right.length + extra.length;

  if (tail === undefined ? groups !== 8 : groups > 7) {
    return undefined;
  }

  const all = [...left, ...Array(8 - groups).fill("0"), ...right, ...extra];

  if (all.some((group) => !/^[0-9a-fA-F]{1,4}$/.test(group))) {
    return undefined;
  }

  return all.reduce((total, group) => (total << 16n) + BigInt(Number.parseInt(group, 16)), 0n);
}

/** An IPv4 or IPv6 CIDR, or `undefined` when the text is not one. */
export function parseCidr(text: string): ParsedCidr | undefined {
  const value = text.trim();
  const slash = value.indexOf("/");

  if (slash < 0 || !/^\d{1,3}$/.test(value.slice(slash + 1))) {
    return undefined;
  }

  const prefix = Number(value.slice(slash + 1));
  const host = value.slice(0, slash);
  const v4 = parseIPv4(host);

  if (v4 !== undefined) {
    return prefix <= 32 ? { family: 4, address: v4, prefix } : undefined;
  }

  const v6 = parseIPv6(host);

  return v6 !== undefined && prefix <= 128 ? { family: 6, address: v6, prefix } : undefined;
}

function networkOf(cidr: ParsedCidr, prefix: number): bigint {
  const width = cidr.family === 4 ? 32n : 128n;
  const hostBits = width - BigInt(prefix);

  return (cidr.address >> hostBits) << hostBits;
}

/** True when `inner` lies strictly inside `outer`: same family, a longer prefix, and inside its range. */
export function cidrStrictlyContains(outer: ParsedCidr, inner: ParsedCidr): boolean {
  return (
    outer.family === inner.family &&
    inner.prefix > outer.prefix &&
    networkOf(inner, outer.prefix) === networkOf(outer, outer.prefix)
  );
}

/** True when two IPv4 ranges share at least one address. */
function cidrsOverlap(a: ParsedCidr, b: ParsedCidr): boolean {
  const prefix = Math.min(a.prefix, b.prefix);

  return a.family === b.family && networkOf(a, prefix) === networkOf(b, prefix);
}

/** The CIDRs of an `except` field, as typed: separated by commas or spaces. */
export function splitCidrList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** A namespace name: a DNS label. */
const dnsLabelPattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

/** A Service name: a DNS-1035 label, which starts with a letter. */
const serviceNamePattern = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

export interface SandboxPortMessages {
  name?: string;
  port?: string;
}

export interface SandboxIngressMessages {
  cidr?: string;
  except?: string;
  namespace?: string;
  /** The source as a whole: a pod source with no label. */
  podLabels?: string;
  labels: KeyValueMessages[];
}

export interface SandboxEgressMessages {
  cidr?: string;
  serviceName?: string;
  serviceNamespace?: string;
  ports: { port?: string }[];
}

/** Every refusal of the section: one per subsection, then one set per row. */
export interface SandboxNetworkErrors {
  ports?: string;
  ingress?: string;
  egress?: string;
  portRows: SandboxPortMessages[];
  ingressRows: SandboxIngressMessages[];
  egressRows: SandboxEgressMessages[];
}

/** Everything that would make the section refuse the create. */
export function sandboxNetworkErrors(mode: string, network: SandboxNetworkValues): SandboxNetworkErrors {
  const effective = effectiveNetworkMode(mode);
  const errors: SandboxNetworkErrors = { portRows: [], ingressRows: [], egressRows: [] };

  if (network.ports.length > 0 && effective === "none") {
    errors.ports = portsWithModeNoneMessage;
  } else if (network.ports.length > maxSandboxPorts) {
    errors.ports = `The schema allows at most ${maxSandboxPorts} ports. Remove ${network.ports.length - maxSandboxPorts}.`;
  }

  if (network.ingress.length > 0 && network.ports.length === 0) {
    errors.ingress = ingressWithoutPortsMessage;
  } else if (network.ingress.length > maxIngressSources) {
    errors.ingress = `The schema allows at most ${maxIngressSources} sources. Remove ${network.ingress.length - maxIngressSources}.`;
  }

  if (network.egress.length > 0 && effective !== "restricted") {
    errors.egress = egressModeMessage(mode);
  } else if (network.egress.length > maxEgressRules) {
    errors.egress = `The schema allows at most ${maxEgressRules} destinations. Remove ${network.egress.length - maxEgressRules}.`;
  }

  errors.portRows = network.ports.map((row, index) => {
    const messages: SandboxPortMessages = {};
    const name = row.name.trim();
    const port = row.port.trim();

    if (!name) {
      messages.name =
        "A port needs a name: the schema requires it, and it is how a Service and a probe reach the port.";
    } else if (!isIanaServiceName(name)) {
      messages.name = portNameMessage;
    } else if (network.ports.some((other, otherIndex) => otherIndex < index && other.name.trim() === name)) {
      messages.name = `Another port is already named ${name}. The names are the list's keys, so the API server refuses the second one.`;
    }

    if (!port) {
      messages.port = "A port needs a number: the schema requires it.";
    } else if (portNumber(port) === undefined) {
      messages.port = portNumberMessage;
    }

    return messages;
  });

  errors.ingressRows = network.ingress.map((row) => ingressRowErrors(row));
  errors.egressRows = network.egress.map((row) => egressRowErrors(row));

  return errors;
}

function ingressRowErrors(row: SandboxIngressRow): SandboxIngressMessages {
  const messages: SandboxIngressMessages = { labels: [] };

  if (row.kind === "cidr") {
    const cidr = parseCidr(row.cidr);

    if (!row.cidr.trim()) {
      messages.cidr = "An IP range is required: it is what this source allows, as a CIDR such as 10.0.0.0/16.";
    } else if (!cidr) {
      messages.cidr = "This is not a CIDR. Write an IPv4 or IPv6 range with its prefix length, such as 10.0.0.0/16.";
    }

    const invalid = splitCidrList(row.except).filter((text) => {
      const except = parseCidr(text);

      return !except || (cidr !== undefined && !cidrStrictlyContains(cidr, except));
    });

    if (invalid.length > 0) {
      messages.except =
        `${invalid.join(", ")} ${invalid.length === 1 ? "is" : "are"} not inside the range above. An exception is ` +
        "a CIDR strictly within it, of the same family and with a longer prefix, or the API server refuses it.";
    }
  }

  if (row.kind === "namespace") {
    const namespace = row.namespace.trim();

    if (!namespace) {
      messages.namespace = "A namespace is required: every pod of that namespace may reach the ports.";
    } else if (namespace.length > 63 || !dnsLabelPattern.test(namespace)) {
      messages.namespace =
        "A namespace name is at most 63 lowercase letters, digits and '-', starting and ending with a letter or a digit.";
    }
  }

  if (row.kind === "pods") {
    messages.labels = keyValueRowErrors(row.podLabels, { syntax: "label", what: "a pod selector" });

    if (!keyValuePayload(row.podLabels)) {
      messages.podLabels =
        "At least one label is required. A pod selector with none selects every pod of this namespace, which is " +
        "almost never what a source is for; write it as the labels the allowed pods carry.";
    }
  }

  return messages;
}

function egressRowErrors(row: SandboxEgressRow): SandboxEgressMessages {
  const messages: SandboxEgressMessages = { ports: [] };

  if (row.kind === "cidr") {
    const cidr = parseCidr(row.cidr);

    if (!row.cidr.trim()) {
      messages.cidr = "An IPv4 range is required, such as 10.20.0.0/24 or 10.20.0.5/32.";
    } else if (!cidr) {
      messages.cidr = "This is not a CIDR. Write an IPv4 range with its prefix length, such as 10.20.0.0/24.";
    } else if (cidr.family !== 4) {
      messages.cidr =
        "Egress allows IPv4 ranges only: IPv6 stays blocked whatever is allowed, so the rule would allow nothing.";
    }
  } else {
    const name = row.serviceName.trim();
    const namespace = row.serviceNamespace.trim();

    if (!name) {
      messages.serviceName = "A Service name is required: its ClusterIP is what this rule allows.";
    } else if (name.length > 63 || !serviceNamePattern.test(name)) {
      messages.serviceName =
        "A Service name is at most 63 lowercase letters, digits and '-', starting with a letter and ending with a letter or a digit.";
    }

    if (namespace && (namespace.length > 63 || !dnsLabelPattern.test(namespace))) {
      messages.serviceNamespace =
        "A namespace name is at most 63 lowercase letters, digits and '-', starting and ending with a letter or a digit.";
    }
  }

  messages.ports = row.ports.map((port) => {
    if (!port.port.trim()) {
      return { port: "A port number is required, or remove the port to allow every port." };
    }

    if (portNumber(port.port) === undefined) {
      return { port: portNumberMessage };
    }

    return egressProtocols.includes(port.protocol) ? {} : { port: "The protocol is TCP or UDP." };
  });

  if (row.ports.length > maxEgressRulePorts && messages.ports.length > 0) {
    messages.ports[maxEgressRulePorts] = {
      port: `The schema allows at most ${maxEgressRulePorts} ports per destination.`,
    };
  }

  return messages;
}

/** Everything worth saying about the section that would still be accepted: one message per egress rule. */
export function sandboxNetworkWarnings(mode: string, network: SandboxNetworkValues): (string | undefined)[] {
  const metadata = parseCidr(metadataRange);

  return network.egress.map((row) => {
    const cidr = row.kind === "cidr" ? parseCidr(row.cidr) : undefined;

    if (effectiveNetworkMode(mode) !== "restricted" || !cidr || cidr.family !== 4 || !metadata) {
      return undefined;
    }

    return cidrsOverlap(cidr, metadata)
      ? `This range overlaps ${metadataRange}, the cloud metadata range, which stays blocked whatever is allowed: the overlapping addresses remain unreachable.`
      : undefined;
  });
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface SandboxNetworkIssue {
  label: string;
  message: string;
}

/** Every reason the section blocks the submit, in the reading order of the section. */
export function sandboxNetworkBlockingIssues(mode: string, network: SandboxNetworkValues): SandboxNetworkIssue[] {
  const errors = sandboxNetworkErrors(mode, network);
  const issues: SandboxNetworkIssue[] = [];

  if (errors.ports) {
    issues.push({ label: "Ports", message: errors.ports });
  }

  errors.portRows.forEach((messages, index) => {
    if (messages.name) {
      issues.push({ label: `Port ${index + 1} name`, message: messages.name });
    }

    if (messages.port) {
      issues.push({ label: `Port ${index + 1} number`, message: messages.port });
    }
  });

  if (errors.ingress) {
    issues.push({ label: "Ingress", message: errors.ingress });
  }

  errors.ingressRows.forEach((messages, index) => {
    const label = `Ingress source ${index + 1}`;

    for (const [field, text] of [
      ["IP range", messages.cidr],
      ["exceptions", messages.except],
      ["namespace", messages.namespace],
      ["labels", messages.podLabels],
    ] as const) {
      if (text) {
        issues.push({ label: `${label} ${field}`, message: text });
      }
    }

    messages.labels.forEach((label, labelIndex) => {
      for (const field of ["key", "value"] as const) {
        const text = label[field];

        if (text) {
          issues.push({ label: `Ingress source ${index + 1} label ${labelIndex + 1} ${field}`, message: text });
        }
      }
    });
  });

  if (errors.egress) {
    issues.push({ label: "Egress", message: errors.egress });
  }

  errors.egressRows.forEach((messages, index) => {
    const label = `Egress destination ${index + 1}`;

    for (const [field, text] of [
      ["IP range", messages.cidr],
      ["Service", messages.serviceName],
      ["namespace", messages.serviceNamespace],
    ] as const) {
      if (text) {
        issues.push({ label: `${label} ${field}`, message: text });
      }
    }

    messages.ports.forEach((port, portIndex) => {
      if (port?.port) {
        issues.push({ label: `${label} port ${portIndex + 1}`, message: port.port });
      }
    });
  });

  return issues;
}

/** Whether the collapsed section holds an error, so it opens itself (W4). */
export function sandboxNetworkSectionHasError(mode: string, network: SandboxNetworkValues): boolean {
  return sandboxNetworkBlockingIssues(mode, network).length > 0;
}

// ---------------------------------------------------------------------------
// The payload.
// ---------------------------------------------------------------------------

/** One ingress source as the NetworkPolicy peer it is, or `undefined` while it holds nothing. */
export function ingressPeerPayload(row: SandboxIngressRow): SwiftSandboxNetworkPeer | undefined {
  if (row.kind === "cidr") {
    const cidr = row.cidr.trim();
    const except = splitCidrList(row.except);

    if (!cidr) {
      return undefined;
    }

    return { ipBlock: except.length > 0 ? { cidr, except } : { cidr } };
  }

  if (row.kind === "namespace") {
    const namespace = row.namespace.trim();

    return namespace ? { namespaceSelector: { matchLabels: { [namespaceNameLabel]: namespace } } } : undefined;
  }

  const matchLabels = keyValuePayload(row.podLabels);

  return matchLabels ? { podSelector: { matchLabels } } : undefined;
}

/** One egress rule as the CRD declares it, or `undefined` while it names no destination. */
export function egressRulePayload(row: SandboxEgressRow): SwiftSandboxEgressRule | undefined {
  const rule: SwiftSandboxEgressRule = {};

  if (row.kind === "cidr") {
    const cidr = row.cidr.trim();

    if (!cidr) {
      return undefined;
    }

    rule.cidr = cidr;
  } else {
    const name = row.serviceName.trim();
    const namespace = row.serviceNamespace.trim();

    if (!name) {
      return undefined;
    }

    rule.service = namespace ? { name, namespace } : { name };
  }

  const ports = row.ports
    .map((port) => ({ number: portNumber(port.port), protocol: port.protocol }))
    .filter((port): port is { number: number; protocol: string } => port.number !== undefined)
    // TCP is the schema's default, so it is not re-sent.
    .map((port) => (port.protocol === "TCP" ? { port: port.number } : { port: port.number, protocol: port.protocol }));

  if (ports.length > 0) {
    rule.ports = ports;
  }

  return rule;
}

/**
 * The ports, ingress and egress keys of `spec.network`, each only when set.
 *
 * The mode is not here: the shape's payload owns it and omits the default. An
 * untouched section adds no key at all, so the stored object reads back exactly
 * as it did before this section existed. `protocol: TCP` is never sent, on a
 * port or an egress port: it is the schema's default, and on a port its only
 * value.
 */
export function sandboxNetworkPayload(network: SandboxNetworkValues): Omit<SwiftSandboxNetwork, "mode"> {
  const payload: Omit<SwiftSandboxNetwork, "mode"> = {};
  const ports = network.ports
    .map((row) => ({ name: row.name.trim(), port: portNumber(row.port) }))
    .filter((row): row is { name: string; port: number } => row.name !== "" && row.port !== undefined);
  const from = network.ingress
    .map(ingressPeerPayload)
    .filter((peer): peer is SwiftSandboxNetworkPeer => peer !== undefined);
  const allow = network.egress
    .map(egressRulePayload)
    .filter((rule): rule is SwiftSandboxEgressRule => rule !== undefined);

  if (ports.length > 0) {
    payload.ports = ports;
  }

  if (from.length > 0) {
    payload.ingress = { from };
  }

  if (allow.length > 0) {
    payload.egress = { allow };
  }

  return payload;
}

// ---------------------------------------------------------------------------
// What the section says: its header line and its summary lines.
// ---------------------------------------------------------------------------

/** A source in words, for the header line and the summary. */
export function describeIngressRow(row: SandboxIngressRow): string {
  if (row.kind === "cidr") {
    const except = splitCidrList(row.except);

    return `${row.cidr.trim() || "<range>"}${except.length > 0 ? ` except ${except.join(", ")}` : ""}`;
  }

  if (row.kind === "namespace") {
    return `every pod of the namespace ${row.namespace.trim() || "<namespace>"}`;
  }

  const labels = Object.entries(keyValuePayload(row.podLabels) ?? {}).map(([key, value]) => `${key}=${value}`);

  return `the pods of this namespace labelled ${labels.join(", ") || "<labels>"}`;
}

/** A destination in words, for the header line and the summary. */
export function describeEgressRow(row: SandboxEgressRow): string {
  const destination =
    row.kind === "cidr"
      ? row.cidr.trim() || "<range>"
      : `the Service ${row.serviceNamespace.trim() ? `${row.serviceNamespace.trim()}/` : ""}${row.serviceName.trim() || "<name>"}`;
  const ports = row.ports
    .filter((port) => portNumber(port.port) !== undefined)
    .map((port) => `${port.port.trim()}/${port.protocol}`);

  return ports.length > 0 ? `${destination} on ${ports.join(", ")}` : `${destination} on every port`;
}

/** The line the section carries, open or shut. */
export function sandboxNetworkSectionHint(mode: string, network: SandboxNetworkValues): string {
  const parts: string[] = [];
  const ports = network.ports.filter((row) => row.name.trim() || row.port.trim());

  if (ports.length === 0) {
    parts.push("No port is exposed, so nothing inbound is admitted");
  } else {
    parts.push(
      `Exposes ${ports.map((row) => `${row.name.trim() || "<name>"} on ${row.port.trim() || "<port>"}`).join(", ")} to ${
        network.ingress.length === 0
          ? "any source"
          : `${network.ingress.length} ${network.ingress.length === 1 ? "source" : "sources"}`
      }`,
    );
  }

  if (network.egress.length > 0) {
    parts.push(
      `${network.egress.length} more ${network.egress.length === 1 ? "destination" : "destinations"} allowed out`,
    );
  } else if (effectiveNetworkMode(mode) === "restricted") {
    parts.push("egress is DNS and the public internet only");
  }

  return `${parts.join("; ")}.`;
}

/**
 * The summary lines of the section, each only when what it describes is set.
 *
 * The ports line carries the fact the rest of the form depends on: no Service
 * is created for them. On a sandbox the launcher pod's labels are what a
 * Service of the user's own selects it by.
 */
export function sandboxNetworkFacts(kind: SandboxNetworkKind, network: SandboxNetworkValues): string[] {
  const payload = sandboxNetworkPayload(network);
  const facts: string[] = [];
  const pod = kind === "pool" ? "every warm slot's launcher pod" : "the launcher pod";

  if (payload.ports) {
    facts.push(
      `${payload.ports.map((port) => `${port.name} (${port.port})`).join(", ")} ${payload.ports.length === 1 ? "is" : "are"} ` +
        `exposed as named containerPorts of ${pod}, forwarded to the same guest ports: they are the only inbound ` +
        "traffic its NetworkPolicy admits. No Service is created for them; a Service of your own that selects " +
        `${kind === "pool" ? "the slot's pod" : "the pod by the labels set below"} reaches them by name as its targetPort.`,
    );
    facts.push(
      payload.ingress
        ? `Only ${network.ingress.map(describeIngressRow).join("; ")} may reach them.`
        : "Any source may reach them: no ingress rule narrows who may.",
    );
  }

  if (payload.egress) {
    facts.push(
      `Besides DNS and the public internet, the guest may reach ${network.egress.map(describeEgressRow).join("; ")}. ` +
        `The metadata range ${metadataRange} and IPv6 stay blocked whatever is allowed.` +
        (network.egress.some((row) => row.kind === "service")
          ? kind === "pool"
            ? " A Service is resolved to its ClusterIP each time the pool reconciles, and warm slots holding an older " +
              "address are replaced; one that is missing, headless or has no IPv4 ClusterIP keeps a sandbox Pending."
            : " A Service is resolved to its ClusterIP when the launcher is created; one that is missing, headless or " +
              "has no IPv4 ClusterIP keeps this sandbox Pending."
          : ""),
    );
  }

  return facts;
}

/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  addEgressBlockedReason,
  addEgressPort,
  addEgressPortBlockedReason,
  addEgressRule,
  addIngressBlockedReason,
  addIngressPodLabel,
  addIngressSource,
  addPortBlockedReason,
  addSandboxPort,
  cidrStrictlyContains,
  defaultSandboxNetwork,
  describeEgressRow,
  describeIngressRow,
  effectiveNetworkMode,
  egressModeMessage,
  egressRulePayload,
  ingressPeerPayload,
  ingressWithoutPortsMessage,
  isIanaServiceName,
  maxEgressRulePorts,
  maxEgressRules,
  maxIngressSources,
  maxSandboxPorts,
  metadataRange,
  namespaceNameLabel,
  parseCidr,
  portNameMessage,
  portNumber,
  portNumberMessage,
  portsWithModeNoneMessage,
  removeEgressPort,
  removeEgressRule,
  removeIngressPodLabel,
  removeIngressSource,
  removeSandboxPort,
  sandboxNetworkBlockingIssues,
  sandboxNetworkErrors,
  sandboxNetworkFacts,
  sandboxNetworkPayload,
  sandboxNetworkSectionHasError,
  sandboxNetworkSectionHint,
  sandboxNetworkWarnings,
  setEgressRuleKind,
  setIngressSourceKind,
  splitCidrList,
  updateEgressPort,
  updateEgressRule,
  updateIngressPodLabel,
  updateIngressSource,
  updateSandboxPort,
} from "./sandbox-network-create";

import type {
  SandboxEgressRow,
  SandboxIngressRow,
  SandboxNetworkValues,
  SandboxPortRow,
} from "./sandbox-network-create";

function port(name: string, number: string, id = `port-${name}`): SandboxPortRow {
  return { id, name, port: number };
}

function ingress(patch: Partial<SandboxIngressRow> = {}): SandboxIngressRow {
  return { id: "ingress-1", kind: "cidr", cidr: "", except: "", namespace: "", podLabels: [], ...patch };
}

function egress(patch: Partial<SandboxEgressRow> = {}): SandboxEgressRow {
  return { id: "egress-1", kind: "service", cidr: "", serviceName: "", serviceNamespace: "", ports: [], ...patch };
}

function network(patch: Partial<SandboxNetworkValues> = {}): SandboxNetworkValues {
  return { ...defaultSandboxNetwork(), ...patch };
}

const web = port("http", "8080");

describe("defaults", () => {
  it("opens empty and reads an empty mode as restricted", () => {
    expect(defaultSandboxNetwork()).toEqual({ ports: [], ingress: [], egress: [] });
    expect(effectiveNetworkMode("")).toBe("restricted");
    expect(effectiveNetworkMode(" open ")).toBe("open");
  });
});

describe("the row helpers", () => {
  it("adds, updates and removes ports", () => {
    let values = addSandboxPort(addSandboxPort(network()));

    expect(values.ports.map((row) => row.id)).toEqual(["port-1", "port-2"]);
    values = updateSandboxPort(values, "port-2", { name: "http", port: "80" });
    expect(values.ports[1]).toEqual({ id: "port-2", name: "http", port: "80" });
    expect(removeSandboxPort(values, "port-1").ports.map((row) => row.id)).toEqual(["port-2"]);
  });

  it("adds an ingress source as an IP range and clears the old shape on a kind change", () => {
    let values = addIngressSource(network());

    expect(values.ingress[0]).toMatchObject({ id: "ingress-1", kind: "cidr" });
    values = updateIngressSource(values, "ingress-1", { cidr: "10.0.0.0/8", except: "10.1.0.0/16" });
    values = setIngressSourceKind(values, "ingress-1", "namespace");
    expect(values.ingress[0]).toMatchObject({ kind: "namespace", cidr: "", except: "" });
    expect(removeIngressSource(values, "ingress-1").ingress).toEqual([]);
  });

  it("edits the pod labels of one source and ignores an unknown source", () => {
    let values = addIngressSource(network());

    values = setIngressSourceKind(values, "ingress-1", "pods");
    values = addIngressPodLabel(values, "ingress-1");
    values = updateIngressPodLabel(values, "ingress-1", "pod-label-1", { key: "app", value: "client" });
    expect(values.ingress[0].podLabels).toEqual([{ id: "pod-label-1", key: "app", value: "client" }]);
    expect(removeIngressPodLabel(values, "ingress-1", "pod-label-1").ingress[0].podLabels).toEqual([]);
    expect(addIngressPodLabel(values, "nope")).toBe(values);
    expect(removeIngressPodLabel(values, "nope", "x")).toBe(values);
    expect(updateIngressPodLabel(values, "nope", "x", {})).toBe(values);
  });

  it("adds an egress rule as a Service with TCP ports, and keeps the ports on a kind change", () => {
    let values = addEgressRule(network());

    expect(values.egress[0]).toMatchObject({ id: "egress-1", kind: "service" });
    values = updateEgressRule(values, "egress-1", { serviceName: "db" });
    values = addEgressPort(values, "egress-1");
    expect(values.egress[0].ports).toEqual([{ id: "egress-port-1", port: "", protocol: "TCP" }]);
    values = updateEgressPort(values, "egress-1", "egress-port-1", { port: "53", protocol: "UDP" });
    values = setEgressRuleKind(values, "egress-1", "cidr");
    expect(values.egress[0]).toMatchObject({ kind: "cidr", serviceName: "", ports: [{ port: "53", protocol: "UDP" }] });
    expect(removeEgressPort(values, "egress-1", "egress-port-1").egress[0].ports).toEqual([]);
    expect(removeEgressRule(values, "egress-1").egress).toEqual([]);
    expect(addEgressPort(values, "nope")).toBe(values);
    expect(removeEgressPort(values, "nope", "x")).toBe(values);
    expect(updateEgressPort(values, "nope", "x", {})).toBe(values);
  });
});

describe("the add controls (W4)", () => {
  it("blocks a port under mode none and at the cap", () => {
    expect(addPortBlockedReason("none", network())).toBe(portsWithModeNoneMessage);
    expect(addPortBlockedReason("", network())).toBeUndefined();
    const full = network({ ports: Array.from({ length: maxSandboxPorts }, (_, i) => port(`p${i}`, `${i + 1}`)) });

    expect(addPortBlockedReason("open", full)).toContain(`at most ${maxSandboxPorts} ports`);
  });

  it("blocks an ingress source until a port exists, and at the cap", () => {
    expect(addIngressBlockedReason(network())).toBe(ingressWithoutPortsMessage);
    expect(addIngressBlockedReason(network({ ports: [web] }))).toBeUndefined();
    const full = network({
      ports: [web],
      ingress: Array.from({ length: maxIngressSources }, (_, i) => ingress({ id: `ingress-${i}` })),
    });

    expect(addIngressBlockedReason(full)).toContain(`at most ${maxIngressSources} sources`);
  });

  it("blocks an egress rule outside restricted, and at the cap", () => {
    expect(addEgressBlockedReason("open", network())).toBe(egressModeMessage("open"));
    expect(addEgressBlockedReason("none", network())).toContain("mode none has no network");
    expect(egressModeMessage("open")).toContain("mode open already reaches");
    expect(addEgressBlockedReason("", network())).toBeUndefined();
    const full = network({ egress: Array.from({ length: maxEgressRules }, (_, i) => egress({ id: `egress-${i}` })) });

    expect(addEgressBlockedReason("restricted", full)).toContain(`at most ${maxEgressRules} destinations`);
  });

  it("blocks an egress port at the per-rule cap", () => {
    const ports = Array.from({ length: maxEgressRulePorts }, (_, i) => ({ id: `p-${i}`, port: "1", protocol: "TCP" }));

    expect(addEgressPortBlockedReason(egress())).toBeUndefined();
    expect(addEgressPortBlockedReason(egress({ ports }))).toContain(`at most ${maxEgressRulePorts} ports`);
  });
});

describe("the syntax rules", () => {
  it.each(["http", "web-1", "a1", "x".repeat(15)])("takes %s as an IANA service name", (name) => {
    expect(isIanaServiceName(name)).toBe(true);
  });

  it.each(["", "8080", "-web", "web-", "we--b", "Web", "x".repeat(16), "web_1"])("refuses %j", (name) => {
    expect(isIanaServiceName(name)).toBe(false);
  });

  it("reads a port number only in range", () => {
    expect(portNumber(" 1 ")).toBe(1);
    expect(portNumber("65535")).toBe(65535);
    expect(portNumber("0")).toBeUndefined();
    expect(portNumber("65536")).toBeUndefined();
    expect(portNumber("80.5")).toBeUndefined();
    expect(portNumber("http")).toBeUndefined();
  });

  it("parses IPv4 and IPv6 CIDRs", () => {
    expect(parseCidr("10.0.0.0/8")).toEqual({ family: 4, address: 10n << 24n, prefix: 8 });
    expect(parseCidr("fd00::/8")?.family).toBe(6);
    expect(parseCidr("::ffff:10.0.0.1/128")?.family).toBe(6);
    expect(parseCidr("2001:db8:0:0:0:0:0:1/64")?.prefix).toBe(64);
    expect(parseCidr("10.0.0.0")).toBeUndefined();
    expect(parseCidr("10.0.0.256/8")).toBeUndefined();
    expect(parseCidr("10.0.0.0/33")).toBeUndefined();
    expect(parseCidr("fd00::1::2/64")).toBeUndefined();
    expect(parseCidr("fd00::/129")).toBeUndefined();
    expect(parseCidr("1:2:3:4:5:6:7/64")).toBeUndefined();
  });

  it("knows strict containment", () => {
    const outer = parseCidr("10.0.0.0/16");
    const inner = parseCidr("10.0.1.0/24");
    const other = parseCidr("10.1.0.0/24");
    const v6 = parseCidr("fd00::/120");

    expect(outer && inner && cidrStrictlyContains(outer, inner)).toBe(true);
    expect(outer && cidrStrictlyContains(outer, outer)).toBe(false);
    expect(outer && other && cidrStrictlyContains(outer, other)).toBe(false);
    expect(outer && v6 && cidrStrictlyContains(outer, v6)).toBe(false);
  });

  it("splits an exception list on commas and spaces", () => {
    expect(splitCidrList(" 10.0.1.0/24, 10.0.2.0/24  10.0.3.0/24,")).toEqual([
      "10.0.1.0/24",
      "10.0.2.0/24",
      "10.0.3.0/24",
    ]);
  });
});

describe("sandboxNetworkErrors", () => {
  it("has nothing to say about an untouched section in any mode", () => {
    for (const mode of ["", "restricted", "open", "none"]) {
      expect(sandboxNetworkBlockingIssues(mode, network())).toEqual([]);
      expect(sandboxNetworkSectionHasError(mode, network())).toBe(false);
    }
  });

  it("refuses ports under mode none", () => {
    expect(sandboxNetworkErrors("none", network({ ports: [web] })).ports).toBe(portsWithModeNoneMessage);
  });

  it("refuses a missing, malformed or repeated port name and a bad number", () => {
    const errors = sandboxNetworkErrors(
      "",
      network({ ports: [port("", ""), port("HTTP", "0"), web, port("http", "9090", "port-dup")] }),
    );

    expect(errors.portRows[0].name).toContain("needs a name");
    expect(errors.portRows[0].port).toContain("needs a number");
    expect(errors.portRows[1]).toEqual({ name: portNameMessage, port: portNumberMessage });
    expect(errors.portRows[2]).toEqual({});
    expect(errors.portRows[3].name).toContain("already named http");
  });

  it("refuses more ports than the schema allows", () => {
    const ports = Array.from({ length: maxSandboxPorts + 1 }, (_, i) => port(`p${i}`, `${i + 1}`));

    expect(sandboxNetworkErrors("", network({ ports })).ports).toContain("Remove 1");
  });

  it("refuses an ingress source without a port", () => {
    expect(sandboxNetworkErrors("", network({ ingress: [ingress({ cidr: "10.0.0.0/8" })] })).ingress).toBe(
      ingressWithoutPortsMessage,
    );
  });

  it("checks each ingress shape", () => {
    const errors = sandboxNetworkErrors(
      "",
      network({
        ports: [web],
        ingress: [
          ingress(),
          ingress({ cidr: "not-a-cidr" }),
          ingress({ cidr: "10.0.0.0/16", except: "10.0.1.0/24, 10.1.0.0/24, junk" }),
          ingress({ kind: "namespace" }),
          ingress({ kind: "namespace", namespace: "Bad_NS" }),
          ingress({ kind: "pods" }),
          ingress({ kind: "pods", podLabels: [{ id: "l-1", key: "Bad Key", value: "x" }] }),
          ingress({ kind: "namespace", namespace: "team-a" }),
        ],
      }),
    );

    expect(errors.ingressRows[0].cidr).toContain("required");
    expect(errors.ingressRows[1].cidr).toContain("not a CIDR");
    expect(errors.ingressRows[2].except).toMatch(/^10\.1\.0\.0\/24, junk are not inside/);
    expect(errors.ingressRows[3].namespace).toContain("required");
    expect(errors.ingressRows[4].namespace).toContain("at most 63");
    expect(errors.ingressRows[5].podLabels).toContain("At least one label");
    expect(errors.ingressRows[6].labels[0].key).toBeDefined();
    expect(errors.ingressRows[7]).toEqual({ labels: [] });
  });

  it("refuses egress outside restricted", () => {
    expect(sandboxNetworkErrors("open", network({ egress: [egress({ serviceName: "db" })] })).egress).toBe(
      egressModeMessage("open"),
    );
  });

  it("checks each egress shape and its ports", () => {
    const errors = sandboxNetworkErrors(
      "",
      network({
        egress: [
          egress(),
          egress({ serviceName: "1db", serviceNamespace: "Bad_NS" }),
          egress({ kind: "cidr" }),
          egress({ kind: "cidr", cidr: "x" }),
          egress({ kind: "cidr", cidr: "fd00::/8" }),
          egress({
            serviceName: "db",
            ports: [
              { id: "p-1", port: "", protocol: "TCP" },
              { id: "p-2", port: "70000", protocol: "TCP" },
              { id: "p-3", port: "53", protocol: "SCTP" },
              { id: "p-4", port: "53", protocol: "UDP" },
            ],
          }),
        ],
      }),
    );

    expect(errors.egressRows[0].serviceName).toContain("required");
    expect(errors.egressRows[1].serviceName).toContain("starting with a letter");
    expect(errors.egressRows[1].serviceNamespace).toContain("at most 63");
    expect(errors.egressRows[2].cidr).toContain("required");
    expect(errors.egressRows[3].cidr).toContain("not a CIDR");
    expect(errors.egressRows[4].cidr).toContain("IPv4 ranges only");
    expect(errors.egressRows[5].ports[0].port).toContain("required");
    expect(errors.egressRows[5].ports[1].port).toBe(portNumberMessage);
    expect(errors.egressRows[5].ports[2].port).toBeDefined();
    expect(errors.egressRows[5].ports[3]).toEqual({});
  });
});

describe("sandboxNetworkWarnings", () => {
  it("warns about a range overlapping the metadata range, under restricted only", () => {
    const values = network({
      egress: [egress({ kind: "cidr", cidr: "169.254.169.254/32" }), egress({ kind: "cidr", cidr: "10.0.0.0/8" })],
    });

    expect(sandboxNetworkWarnings("", values)[0]).toContain(metadataRange);
    expect(sandboxNetworkWarnings("", values)[1]).toBeUndefined();
    expect(sandboxNetworkWarnings("open", values)).toEqual([undefined, undefined]);
    expect(sandboxNetworkWarnings("", network({ egress: [egress({ kind: "cidr", cidr: "0.0.0.0/0" })] }))[0]).toContain(
      "overlaps",
    );
  });
});

describe("sandboxNetworkBlockingIssues", () => {
  it("names each field and row in reading order", () => {
    const issues = sandboxNetworkBlockingIssues(
      "",
      network({
        ports: [port("", "8080")],
        ingress: [ingress({ kind: "pods", podLabels: [{ id: "l-1", key: "", value: "x" }] })],
        egress: [egress({ ports: [{ id: "p-1", port: "", protocol: "TCP" }] })],
      }),
    );

    expect(issues.map((issue) => issue.label)).toEqual([
      "Port 1 name",
      "Ingress source 1 labels",
      "Ingress source 1 label 1 key",
      "Egress destination 1 Service",
      "Egress destination 1 port 1",
    ]);
  });

  it("puts a section refusal before its rows", () => {
    const issues = sandboxNetworkBlockingIssues("none", network({ ports: [port("http", "x")] }));

    expect(issues.map((issue) => issue.label)).toEqual(["Ports", "Port 1 number"]);
    expect(sandboxNetworkSectionHasError("none", network({ ports: [web] }))).toBe(true);
  });

  it("names the egress section refusal", () => {
    const issues = sandboxNetworkBlockingIssues("open", network({ egress: [egress({ kind: "cidr", cidr: "x/1" })] }));

    expect(issues.map((issue) => issue.label)).toEqual(["Egress", "Egress destination 1 IP range"]);
  });

  it("names an ingress section refusal and each field of a source", () => {
    const issues = sandboxNetworkBlockingIssues("", network({ ingress: [ingress({ cidr: "x", except: "y" })] }));

    expect(issues.map((issue) => issue.label)).toEqual([
      "Ingress",
      "Ingress source 1 IP range",
      "Ingress source 1 exceptions",
    ]);
  });
});

describe("the payload", () => {
  it("adds no key for an untouched section", () => {
    expect(sandboxNetworkPayload(network())).toEqual({});
  });

  it("writes each ingress shape as its NetworkPolicy peer", () => {
    expect(ingressPeerPayload(ingress())).toBeUndefined();
    expect(ingressPeerPayload(ingress({ cidr: " 10.0.0.0/16 " }))).toEqual({ ipBlock: { cidr: "10.0.0.0/16" } });
    expect(ingressPeerPayload(ingress({ cidr: "10.0.0.0/16", except: "10.0.1.0/24" }))).toEqual({
      ipBlock: { cidr: "10.0.0.0/16", except: ["10.0.1.0/24"] },
    });
    expect(ingressPeerPayload(ingress({ kind: "namespace" }))).toBeUndefined();
    expect(ingressPeerPayload(ingress({ kind: "namespace", namespace: "team-a" }))).toEqual({
      namespaceSelector: { matchLabels: { [namespaceNameLabel]: "team-a" } },
    });
    expect(ingressPeerPayload(ingress({ kind: "pods" }))).toBeUndefined();
    expect(
      ingressPeerPayload(ingress({ kind: "pods", podLabels: [{ id: "l-1", key: "app", value: "client" }] })),
    ).toEqual({ podSelector: { matchLabels: { app: "client" } } });
  });

  it("writes each egress shape, never re-sending TCP", () => {
    expect(egressRulePayload(egress())).toBeUndefined();
    expect(egressRulePayload(egress({ kind: "cidr" }))).toBeUndefined();
    expect(egressRulePayload(egress({ serviceName: "db" }))).toEqual({ service: { name: "db" } });
    expect(egressRulePayload(egress({ serviceName: "db", serviceNamespace: "data" }))).toEqual({
      service: { name: "db", namespace: "data" },
    });
    expect(
      egressRulePayload(
        egress({
          kind: "cidr",
          cidr: "10.20.0.0/24",
          ports: [
            { id: "p-1", port: "5432", protocol: "TCP" },
            { id: "p-2", port: "53", protocol: "UDP" },
            { id: "p-3", port: "", protocol: "TCP" },
          ],
        }),
      ),
    ).toEqual({ cidr: "10.20.0.0/24", ports: [{ port: 5432 }, { port: 53, protocol: "UDP" }] });
  });

  it("writes ports, ingress and egress, dropping incomplete rows", () => {
    expect(
      sandboxNetworkPayload(
        network({
          ports: [web, port("", "9090"), port("metrics", "x")],
          ingress: [ingress({ kind: "namespace", namespace: "team-a" }), ingress()],
          egress: [egress({ serviceName: "db" }), egress()],
        }),
      ),
    ).toEqual({
      ports: [{ name: "http", port: 8080 }],
      ingress: { from: [{ namespaceSelector: { matchLabels: { [namespaceNameLabel]: "team-a" } } }] },
      egress: { allow: [{ service: { name: "db" } }] },
    });
  });
});

describe("what the section says", () => {
  it("describes sources and destinations, with placeholders for empty fields", () => {
    expect(describeIngressRow(ingress({ cidr: "10.0.0.0/16", except: "10.0.1.0/24" }))).toBe(
      "10.0.0.0/16 except 10.0.1.0/24",
    );
    expect(describeIngressRow(ingress())).toBe("<range>");
    expect(describeIngressRow(ingress({ kind: "namespace" }))).toBe("every pod of the namespace <namespace>");
    expect(describeIngressRow(ingress({ kind: "pods" }))).toBe("the pods of this namespace labelled <labels>");
    expect(describeEgressRow(egress({ serviceName: "db", serviceNamespace: "data" }))).toBe(
      "the Service data/db on every port",
    );
    expect(
      describeEgressRow(
        egress({ kind: "cidr", cidr: "10.0.0.0/8", ports: [{ id: "p", port: "53", protocol: "UDP" }] }),
      ),
    ).toBe("10.0.0.0/8 on 53/UDP");
  });

  it("carries a header line in every state", () => {
    expect(sandboxNetworkSectionHint("", network())).toBe(
      "No port is exposed, so nothing inbound is admitted; egress is DNS and the public internet only.",
    );
    expect(sandboxNetworkSectionHint("open", network())).toBe("No port is exposed, so nothing inbound is admitted.");
    expect(sandboxNetworkSectionHint("", network({ ports: [web] }))).toContain("Exposes http on 8080 to any source");
    expect(
      sandboxNetworkSectionHint("", network({ ports: [web], ingress: [ingress()], egress: [egress(), egress()] })),
    ).toBe("Exposes http on 8080 to 1 source; 2 more destinations allowed out.");
  });

  it("states no fact for an untouched section", () => {
    expect(sandboxNetworkFacts("sandbox", network())).toEqual([]);
  });

  it("says what the ports are and who may reach them, per kind", () => {
    const [sandboxPorts, anySource] = sandboxNetworkFacts("sandbox", network({ ports: [web] }));

    expect(sandboxPorts).toContain("http (8080) is exposed as named containerPorts of the launcher pod");
    expect(sandboxPorts).toContain("No Service is created");
    expect(anySource).toContain("Any source may reach them");
    const [poolPorts, narrowed] = sandboxNetworkFacts(
      "pool",
      network({ ports: [web], ingress: [ingress({ kind: "namespace", namespace: "team-a" })] }),
    );

    expect(poolPorts).toContain("every warm slot's launcher pod");
    expect(narrowed).toBe("Only every pod of the namespace team-a may reach them.");
  });

  it("says what egress allows and what a Service costs, per kind", () => {
    const values = network({ egress: [egress({ serviceName: "db" })] });
    const [sandboxEgress] = sandboxNetworkFacts("sandbox", values);
    const [poolEgress] = sandboxNetworkFacts("pool", values);

    expect(sandboxEgress).toContain("the guest may reach the Service db");
    expect(sandboxEgress).toContain("keeps this sandbox Pending");
    expect(poolEgress).toContain("warm slots holding an older address are replaced");
    expect(
      sandboxNetworkFacts("sandbox", network({ egress: [egress({ kind: "cidr", cidr: "10.0.0.0/8" })] }))[0],
    ).not.toContain("ClusterIP");
  });
});

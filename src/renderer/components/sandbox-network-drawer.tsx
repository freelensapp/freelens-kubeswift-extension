/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Network section of the two sandbox drawers (SPEC-0019 T2): the ports, who
// may reach them and where a restricted guest may go, which SwiftSandbox and
// SwiftSandboxPool declare with one schema. The mode itself stays where it was,
// in the Guest and Slot Shape sections, next to the shape it belongs to.

import { Renderer } from "@freelensapp/extensions";
import {
  describeEgressAllowed,
  describeEgressRule,
  describeIngressPeer,
  describeSandboxPort,
} from "../api/kubeswift/swiftsandbox-v1alpha1";

import type { SwiftSandboxEgressAllowed, SwiftSandboxNetwork } from "../api/kubeswift/swiftsandbox-v1alpha1";

const {
  Component: { Badge, DrawerItem, DrawerTitle, WithTooltip },
} = Renderer;

const portsTooltip =
  "Each port is a named containerPort of the launcher pod, forwarded to the same port in the guest. They are the " +
  "only inbound traffic the NetworkPolicy admits, and a Service reaches them by name as its targetPort";

const anySourceLabel = "Any source";
const anySourceTooltip = "The object sets no ingress rule, so every source may reach its ports";

const egressTooltip =
  "Destinations a restricted guest may reach besides DNS and the public internet. The metadata range " +
  "169.254.0.0/16 and IPv6 stay blocked whatever is allowed, and a Service that is missing, headless or has no " +
  "IPv4 ClusterIP keeps the sandbox Pending";

const enforcedTooltip = "The allowlist the launcher enforces, with every Service resolved to its address";

export interface SandboxNetworkSectionProps {
  network?: SwiftSandboxNetwork;
  /** `status.network.egressAllowed`, which only a SwiftSandbox reports. */
  egressAllowed?: SwiftSandboxEgressAllowed[];
}

/** Self-guarding: an object with no port, no rule and nothing enforced renders nothing. */
export function SandboxNetworkSection({ network, egressAllowed = [] }: SandboxNetworkSectionProps) {
  const ports = network?.ports ?? [];
  const from = network?.ingress?.from ?? [];
  const allow = network?.egress?.allow ?? [];

  if (ports.length === 0 && from.length === 0 && allow.length === 0 && egressAllowed.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Network</DrawerTitle>
      <DrawerItem name="Ports" hidden={ports.length === 0} labelsOnly>
        {ports.map((port) => (
          <Badge key={port.name} label={describeSandboxPort(port)} tooltip={portsTooltip} />
        ))}
      </DrawerItem>
      {/* Without a rule every source may reach the ports, which is a fact
          about an exposed object and not a missing value. */}
      <DrawerItem name="Ingress From" hidden={from.length === 0 && ports.length === 0} labelsOnly={from.length > 0}>
        {from.length > 0 ? (
          from.map((peer, index) => (
            <Badge key={`${index}-${describeIngressPeer(peer)}`} label={describeIngressPeer(peer)} />
          ))
        ) : (
          <WithTooltip tooltip={anySourceTooltip}>{anySourceLabel}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Egress Allow" hidden={allow.length === 0} labelsOnly>
        {allow.map((rule, index) => (
          <Badge
            key={`${index}-${describeEgressRule(rule)}`}
            label={describeEgressRule(rule)}
            tooltip={egressTooltip}
          />
        ))}
      </DrawerItem>
      <DrawerItem name="Egress Enforced" hidden={egressAllowed.length === 0} labelsOnly>
        {egressAllowed.map((entry, index) => (
          <Badge
            key={`${index}-${describeEgressAllowed(entry)}`}
            label={describeEgressAllowed(entry)}
            tooltip={enforcedTooltip}
          />
        ))}
      </DrawerItem>
    </>
  );
}

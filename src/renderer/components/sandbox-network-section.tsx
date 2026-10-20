/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Network section of the Create Sandbox Pool form and of the Create Sandbox
// form's cold path (SPEC-0019 T4): ports, ingress sources and egress
// destinations, next to the mode the slot shape already asks for. A checkout
// does not render it: the pool decides the network (D2).
//
// Every decision belongs to `sandbox-network-create.ts`; this is the JSX. It
// takes the slot-shape owner both dialogs' models satisfy, and changes the
// values through its own action, so it imports nothing at runtime from either
// dialog.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { AddRowButton, CollapsibleSection, Field, FormRow } from "./create-dialog";
import styles from "./create-dialog.module.scss";
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
  egressProtocols,
  maxEgressRules,
  maxIngressSources,
  maxSandboxPorts,
  metadataRange,
  removeEgressPort,
  removeEgressRule,
  removeIngressPodLabel,
  removeIngressSource,
  removeSandboxPort,
  sandboxEgressDestinationKinds,
  sandboxEgressDestinationLabels,
  sandboxIngressSourceKinds,
  sandboxIngressSourceLabels,
  sandboxNetworkErrors,
  sandboxNetworkSectionHasError,
  sandboxNetworkSectionHint,
  sandboxNetworkWarnings,
  setEgressRuleKind,
  setIngressSourceKind,
  updateEgressPort,
  updateEgressRule,
  updateIngressPodLabel,
  updateIngressSource,
  updateSandboxPort,
} from "./sandbox-network-create";

import type { KeyValueMessages, KeyValueRow } from "./label-rows";
import type {
  SandboxEgressDestinationKind,
  SandboxEgressMessages,
  SandboxEgressRow,
  SandboxIngressMessages,
  SandboxIngressRow,
  SandboxIngressSourceKind,
  SandboxNetworkKind,
  SandboxNetworkValues,
  SandboxPortMessages,
  SandboxPortRow,
} from "./sandbox-network-create";

const { observer } = MobxReact;

const {
  Component: { Input, Select },
} = Renderer;

/** What the section needs of the form it is rendered inside: the shape's mode and rows, and its own toggle. */
export interface SandboxNetworkOwner {
  values: { shape: { networkMode: string; network: SandboxNetworkValues } };
  /** Ships shut, like every optional section (DESIGN.md section 12). */
  networkOpen: boolean;
  onValuesChanged: () => void;
}

/** The one way the section's rows change, so the OK button can never drift. */
export const applySandboxNetwork = Mobx.action((model: SandboxNetworkOwner, next: SandboxNetworkValues) => {
  model.values.shape.network = next;
  model.onValuesChanged();
});

export const toggleSandboxNetworkSection = Mobx.action((model: SandboxNetworkOwner) => {
  model.networkOpen = !model.networkOpen;
});

/** The section, for a pool or for a sandbox's cold path. */
export const SandboxNetworkSection = observer(
  ({ model, kind }: { model: SandboxNetworkOwner; kind: SandboxNetworkKind }) => {
    const { networkMode, network } = model.values.shape;

    return (
      <CollapsibleSection
        title="Ports, ingress and egress"
        hint={sandboxNetworkSectionHint(networkMode, network)}
        open={model.networkOpen || sandboxNetworkSectionHasError(networkMode, network)}
        onToggle={() => toggleSandboxNetworkSection(model)}
        testId="sandbox-create-network-section"
      >
        <SandboxPortsField model={model} kind={kind} />
        <SandboxIngressField model={model} />
        <SandboxEgressField model={model} kind={kind} />
      </CollapsibleSection>
    );
  },
);

// ---------------------------------------------------------------------------
// Ports.
// ---------------------------------------------------------------------------

const SandboxPortsField = observer(({ model, kind }: { model: SandboxNetworkOwner; kind: SandboxNetworkKind }) => {
  const { networkMode, network } = model.values.shape;
  const errors = sandboxNetworkErrors(networkMode, network);

  return (
    <div className={styles.field} data-testid="sandbox-create-ports">
      <div className={styles.label}>Ports</div>
      <div className={styles.hint}>
        {`Guest ports exposed as named containerPorts of ${kind === "pool" ? "each slot's" : "the"} launcher pod and forwarded to the same port in the guest; they are the only inbound traffic its NetworkPolicy admits. TCP only, at most ${maxSandboxPorts}. No Service is created: one of your own targets them by name.`}
      </div>
      {errors.ports ? <div className={styles.error}>{errors.ports}</div> : null}

      {network.ports.map((row, index) => (
        <SandboxPortFields key={row.id} model={model} row={row} index={index} messages={errors.portRows[index] ?? {}} />
      ))}

      <AddRowButton
        label="Add a port"
        onAdd={() => applySandboxNetwork(model, addSandboxPort(model.values.shape.network))}
        blockedReason={addPortBlockedReason(networkMode, network)}
        testId="sandbox-create-add-port"
        blockedTestId="sandbox-create-add-port-blocked"
      />
    </div>
  );
});

const SandboxPortFields = observer(
  ({
    model,
    row,
    index,
    messages,
  }: {
    model: SandboxNetworkOwner;
    row: SandboxPortRow;
    index: number;
    messages: SandboxPortMessages;
  }) => {
    const prefix = `sandbox-create-port-${index}`;
    const update = (patch: Partial<SandboxPortRow>) =>
      applySandboxNetwork(model, updateSandboxPort(model.values.shape.network, row.id, patch));

    return (
      <FormRow
        title={`Port ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxNetwork(model, removeSandboxPort(model.values.shape.network, row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field
          label="Name"
          hint="An IANA service name: lowercase letters, digits and '-', at most 15, with a letter."
          error={messages.name}
        >
          <Input
            value={row.name}
            placeholder="http"
            data-testid={`${prefix}-name`}
            onChange={(value: string) => update({ name: value })}
          />
        </Field>

        <Field label="Port" hint="From 1 to 65535." error={messages.port}>
          <Input
            value={row.port}
            placeholder="8080"
            data-testid={`${prefix}-number`}
            onChange={(value: string) => update({ port: value })}
          />
        </Field>
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// Ingress.
// ---------------------------------------------------------------------------

const SandboxIngressField = observer(({ model }: { model: SandboxNetworkOwner }) => {
  const { networkMode, network } = model.values.shape;
  const errors = sandboxNetworkErrors(networkMode, network);

  return (
    <div className={styles.field} data-testid="sandbox-create-ingress">
      <div className={styles.label}>Ingress sources</div>
      <div className={styles.hint}>
        {`Who may reach the ports. Without a source, any source may. Each is an IP range, every pod of a namespace, or the pods of this namespace that carry some labels; at most ${maxIngressSources}.`}
      </div>
      {errors.ingress ? <div className={styles.error}>{errors.ingress}</div> : null}

      {network.ingress.map((row, index) => (
        <SandboxIngressFields
          key={row.id}
          model={model}
          row={row}
          index={index}
          messages={errors.ingressRows[index] ?? { labels: [] }}
        />
      ))}

      <AddRowButton
        label="Add a source"
        onAdd={() => applySandboxNetwork(model, addIngressSource(model.values.shape.network))}
        blockedReason={addIngressBlockedReason(network)}
        testId="sandbox-create-add-ingress"
        blockedTestId="sandbox-create-add-ingress-blocked"
      />
    </div>
  );
});

const SandboxIngressFields = observer(
  ({
    model,
    row,
    index,
    messages,
  }: {
    model: SandboxNetworkOwner;
    row: SandboxIngressRow;
    index: number;
    messages: SandboxIngressMessages;
  }) => {
    const prefix = `sandbox-create-ingress-${index}`;
    const network = () => model.values.shape.network;
    const update = (patch: Partial<SandboxIngressRow>) =>
      applySandboxNetwork(model, updateIngressSource(network(), row.id, patch));

    return (
      <FormRow
        title={`Source ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxNetwork(model, removeIngressSource(network(), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field label="Kind">
          <Select
            id={`${prefix}-kind`}
            themeName="light"
            menuClass={styles.selectMenu}
            value={row.kind}
            options={sandboxIngressSourceKinds.map((kind) => ({
              value: kind,
              label: sandboxIngressSourceLabels[kind],
            }))}
            onChange={(option: { value: SandboxIngressSourceKind } | null) =>
              option ? applySandboxNetwork(model, setIngressSourceKind(network(), row.id, option.value)) : undefined
            }
          />
        </Field>

        {row.kind === "cidr" ? (
          <>
            <Field label="IP range" hint="An IPv4 or IPv6 CIDR." error={messages.cidr}>
              <Input
                value={row.cidr}
                placeholder="10.0.0.0/16"
                data-testid={`${prefix}-cidr`}
                onChange={(value: string) => update({ cidr: value })}
              />
            </Field>
            <Field
              label="Except"
              hint="Optional CIDRs inside the range that may not, separated by commas or spaces."
              error={messages.except}
            >
              <Input
                value={row.except}
                placeholder="10.0.1.0/24"
                data-testid={`${prefix}-except`}
                onChange={(value: string) => update({ except: value })}
              />
            </Field>
          </>
        ) : null}

        {row.kind === "namespace" ? (
          <Field
            label="Namespace"
            hint="Every pod of this namespace, selected by its kubernetes.io/metadata.name label."
            error={messages.namespace}
          >
            <Input
              value={row.namespace}
              placeholder="team-a"
              data-testid={`${prefix}-namespace`}
              onChange={(value: string) => update({ namespace: value })}
            />
          </Field>
        ) : null}

        {row.kind === "pods" ? (
          <KeyValueRowsField
            label="Pod labels"
            hint="The pods of this namespace that carry all of these labels."
            error={messages.podLabels}
            rows={row.podLabels}
            messages={messages.labels}
            prefix={`${prefix}-label`}
            rowTitle="Label"
            addLabel="Add a label"
            keyPlaceholder="app"
            valuePlaceholder="client"
            onAdd={() => applySandboxNetwork(model, addIngressPodLabel(network(), row.id))}
            onRemove={(id) => applySandboxNetwork(model, removeIngressPodLabel(network(), row.id, id))}
            onUpdate={(id, patch) => applySandboxNetwork(model, updateIngressPodLabel(network(), row.id, id, patch))}
          />
        ) : null}
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// Egress.
// ---------------------------------------------------------------------------

const SandboxEgressField = observer(({ model, kind }: { model: SandboxNetworkOwner; kind: SandboxNetworkKind }) => {
  const { networkMode, network } = model.values.shape;
  const errors = sandboxNetworkErrors(networkMode, network);
  const warnings = sandboxNetworkWarnings(networkMode, network);

  return (
    <div className={styles.field} data-testid="sandbox-create-egress">
      <div className={styles.label}>Egress destinations</div>
      <div className={styles.hint}>
        {`What a restricted ${kind === "pool" ? "slot" : "sandbox"} may reach besides DNS and the public internet: an IPv4 range or a Service, optionally on some ports; at most ${maxEgressRules}. ${metadataRange} and IPv6 stay blocked whatever is allowed.`}
      </div>
      {errors.egress ? <div className={styles.error}>{errors.egress}</div> : null}

      {network.egress.map((row, index) => (
        <SandboxEgressFields
          key={row.id}
          model={model}
          row={row}
          index={index}
          messages={errors.egressRows[index] ?? { ports: [] }}
          warning={warnings[index]}
        />
      ))}

      <AddRowButton
        label="Add a destination"
        onAdd={() => applySandboxNetwork(model, addEgressRule(model.values.shape.network))}
        blockedReason={addEgressBlockedReason(networkMode, network)}
        testId="sandbox-create-add-egress"
        blockedTestId="sandbox-create-add-egress-blocked"
      />
    </div>
  );
});

const SandboxEgressFields = observer(
  ({
    model,
    row,
    index,
    messages,
    warning,
  }: {
    model: SandboxNetworkOwner;
    row: SandboxEgressRow;
    index: number;
    messages: SandboxEgressMessages;
    warning?: string;
  }) => {
    const prefix = `sandbox-create-egress-${index}`;
    const network = () => model.values.shape.network;
    const update = (patch: Partial<SandboxEgressRow>) =>
      applySandboxNetwork(model, updateEgressRule(network(), row.id, patch));

    return (
      <FormRow
        title={`Destination ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxNetwork(model, removeEgressRule(network(), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field label="Kind">
          <Select
            id={`${prefix}-kind`}
            themeName="light"
            menuClass={styles.selectMenu}
            value={row.kind}
            options={sandboxEgressDestinationKinds.map((kind) => ({
              value: kind,
              label: sandboxEgressDestinationLabels[kind],
            }))}
            onChange={(option: { value: SandboxEgressDestinationKind } | null) =>
              option ? applySandboxNetwork(model, setEgressRuleKind(network(), row.id, option.value)) : undefined
            }
          />
        </Field>

        {row.kind === "cidr" ? (
          <Field label="IPv4 range" hint="A CIDR, such as 10.20.0.5/32." error={messages.cidr} warning={warning}>
            <Input
              value={row.cidr}
              placeholder="10.20.0.0/24"
              data-testid={`${prefix}-cidr`}
              onChange={(value: string) => update({ cidr: value })}
            />
          </Field>
        ) : (
          <>
            <Field
              label="Service"
              hint="Resolved to its ClusterIP; a missing or headless Service keeps the sandbox Pending."
              error={messages.serviceName}
            >
              <Input
                value={row.serviceName}
                placeholder="postgres"
                data-testid={`${prefix}-service`}
                onChange={(value: string) => update({ serviceName: value })}
              />
            </Field>
            <Field label="Service namespace" hint="Empty is this namespace." error={messages.serviceNamespace}>
              <Input
                value={row.serviceNamespace}
                placeholder="this namespace"
                data-testid={`${prefix}-service-namespace`}
                onChange={(value: string) => update({ serviceNamespace: value })}
              />
            </Field>
          </>
        )}

        <div className={styles.field} data-testid={`${prefix}-ports`}>
          <div className={styles.label}>Ports</div>
          <div className={styles.hint}>Without a port, every port of the destination is allowed.</div>
          {row.ports.map((port, portIndex) => (
            <FormRow
              key={port.id}
              title={`Port ${portIndex + 1}`}
              removeLabel="Remove"
              onRemove={() => applySandboxNetwork(model, removeEgressPort(network(), row.id, port.id))}
              testId={`${prefix}-port-${portIndex}`}
              removeTestId={`${prefix}-port-${portIndex}-remove`}
            >
              <Field label="Port" error={messages.ports[portIndex]?.port}>
                <Input
                  value={port.port}
                  placeholder="5432"
                  data-testid={`${prefix}-port-${portIndex}-number`}
                  onChange={(value: string) =>
                    applySandboxNetwork(model, updateEgressPort(network(), row.id, port.id, { port: value }))
                  }
                />
              </Field>
              <Field label="Protocol">
                <Select
                  id={`${prefix}-port-${portIndex}-protocol`}
                  themeName="light"
                  menuClass={styles.selectMenu}
                  value={port.protocol}
                  options={egressProtocols.map((protocol) => ({ value: protocol, label: protocol }))}
                  onChange={(option: { value: string } | null) =>
                    option
                      ? applySandboxNetwork(
                          model,
                          updateEgressPort(network(), row.id, port.id, { protocol: option.value }),
                        )
                      : undefined
                  }
                />
              </Field>
            </FormRow>
          ))}
          <AddRowButton
            label="Add a port"
            onAdd={() => applySandboxNetwork(model, addEgressPort(network(), row.id))}
            blockedReason={addEgressPortBlockedReason(row)}
            testId={`${prefix}-add-port`}
          />
        </div>
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// Key and value rows, which the workload sections render too.
// ---------------------------------------------------------------------------

export interface KeyValueRowsFieldProps {
  label: string;
  hint: string;
  error?: string;
  rows: KeyValueRow[];
  messages: KeyValueMessages[];
  /** The test-id prefix of each row: `<prefix>-<index>`, then `-key`, `-value`, `-remove`. */
  prefix: string;
  rowTitle: string;
  addLabel: string;
  blockedReason?: string;
  keyPlaceholder: string;
  valuePlaceholder: string;
  testId?: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<KeyValueRow>) => void;
}

/** A map as repeatable rows of a key and a value. */
export const KeyValueRowsField = observer(function KeyValueRowsField({
  label,
  hint,
  error,
  rows,
  messages,
  prefix,
  rowTitle,
  addLabel,
  blockedReason,
  keyPlaceholder,
  valuePlaceholder,
  testId,
  onAdd,
  onRemove,
  onUpdate,
}: KeyValueRowsFieldProps) {
  return (
    <div className={styles.field} data-testid={testId}>
      <div className={styles.label}>{label}</div>
      <div className={styles.hint}>{hint}</div>
      {error ? <div className={styles.error}>{error}</div> : null}

      {rows.map((row, index) => (
        <FormRow
          key={row.id}
          title={`${rowTitle} ${index + 1}`}
          removeLabel="Remove"
          onRemove={() => onRemove(row.id)}
          testId={`${prefix}-${index}`}
          removeTestId={`${prefix}-${index}-remove`}
        >
          <Field label="Key" error={messages[index]?.key}>
            <Input
              value={row.key}
              placeholder={keyPlaceholder}
              data-testid={`${prefix}-${index}-key`}
              onChange={(value: string) => onUpdate(row.id, { key: value })}
            />
          </Field>
          <Field label="Value" error={messages[index]?.value}>
            <Input
              value={row.value}
              placeholder={valuePlaceholder}
              data-testid={`${prefix}-${index}-value`}
              onChange={(value: string) => onUpdate(row.id, { value })}
            />
          </Field>
        </FormRow>
      ))}

      <AddRowButton
        label={addLabel}
        onAdd={onAdd}
        blockedReason={blockedReason}
        testId={`${prefix}-add`}
        blockedTestId={`${prefix}-add-blocked`}
      />
    </div>
  );
});

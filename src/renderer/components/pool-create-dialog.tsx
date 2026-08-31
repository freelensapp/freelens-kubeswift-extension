/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create SwiftGuestPool form (SPEC-0015), which is the Create Guest form
// with a pool around it: the head asks how many replicas and what each one is,
// the four collapsed sections at the bottom carry the pool's own surface, and
// everything in between is the section components of `guest-create-dialog.tsx`,
// rendered against a values owner this dialog holds rather than against a copy
// of them. That is the whole reason the extraction exists - a second
// implementation of the twelve template sections would drift at the next
// SwiftGuest field addition, which is the mistake upstream makes and pays for
// on every edit of a pool.
//
// The host wiring is the SPEC-0011 machinery unchanged for the sixth time:
// `ConfirmDialog.open` as the dialog host, the model outside React so the 409
// reopen cannot wipe it, an observable `okButtonProps`, and the
// catch-never-rethrow submit. Two things are new and both follow from the
// embedding:
//
// - the model owns TWO value objects - the pool's own fields and the template's
//   owner - and `poolFormValues` is what joins them for the pure module, so
//   there is exactly one copy of the template in the dialog;
// - the template's owner carries an `embedding` callback, which is how D1's pin
//   warning, D2's MAC refusal, D3's dropped ports and derived clone node and
//   the shared-referent warnings reach the shipped sections without any of
//   those sections knowing what a pool is.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { SwiftGuestPool } from "../api/kubeswift/swiftguestpool-v1alpha1";
import { AddRowButton, CollapsibleSection, Field, FormRow, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import {
  defaultNamespace,
  defaultPortProtocol,
  guestAccessModes,
  guestPortProtocols,
  guestVolumeModes,
} from "./guest-create";
import {
  BootSourceFields,
  changeNamespace,
  createGuestValuesOwner,
  DataDisksSection,
  GpuSection,
  GuestAgentField,
  GuestClassField,
  guestCreateInputs,
  guestFormSeed,
  loadGuestClasses,
  loadNamespacedObjects,
  loadNodes,
  NetworkSection,
  NodeField,
  RunPolicyField,
  SeedProfileField,
  StorageSection,
} from "./guest-create-dialog";
import { conflictStatusCode } from "./migration-create";
import {
  addPoolClaimTemplate,
  addPoolServicePort,
  cloneTargetNodePreview,
  createGuestPoolTitle,
  defaultMaxSurge,
  defaultMaxUnavailable,
  defaultPoolForm,
  poolClaimPvcFact,
  poolClaimTemplateErrors,
  poolClaimTemplatesHint,
  poolCreateErrors,
  poolCreateFailureMessage,
  poolCreatePayload,
  poolCreateSubmitBlockReason,
  poolCreateSuccessMessage,
  poolCreateSummary,
  poolExcludedFieldsFooter,
  poolGpuClaimWarning,
  poolHeadlessApplies,
  poolHeadlessDroppedFact,
  poolMacRefusals,
  poolNodePinWarning,
  poolRolloutErrors,
  poolRolloutFact,
  poolRolloutFieldLabels,
  poolRolloutHint,
  poolRolloutSectionHasError,
  poolSeedProfileNote,
  poolServiceApplies,
  poolServiceConfigured,
  poolServiceDroppedFact,
  poolServiceError,
  poolServiceHint,
  poolServicePortErrors,
  poolServicePortWarnings,
  poolServiceSectionHasError,
  poolServiceTypes,
  poolSharedPvcWarnings,
  poolSpreadHint,
  poolSpreadPolicies,
  poolStorageSectionHasError,
  poolUpdateStrategyTypes,
  removePoolClaimTemplate,
  removePoolServicePort,
  replicasFact,
  rollingUpdateApplies,
  setPoolServiceType,
  templateNetworkHint,
  templatePortsDroppedFact,
  updatePoolClaimTemplate,
  updatePoolServicePort,
} from "./pool-create";

import type { SwiftGuestProtocol } from "../api/kubeswift/swiftguest-v1alpha1";
import type {
  SwiftGuestPoolServiceType,
  SwiftGuestPoolSpreadPolicy,
  SwiftGuestPoolUpdateStrategyType,
} from "../api/kubeswift/swiftguestpool-v1alpha1";
import type { GuestTemplateEmbedding, GuestValuesOwner } from "./guest-create-dialog";
import type { PoolClaimTemplateRow, PoolFormValues, PoolServicePortRow } from "./pool-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, NamespaceSelect, Notifications, Radio, RadioGroup, Select },
  K8sApi: { namespaceStore },
} = Renderer;

/** The pool's own fields: everything of the form that is not the template. */
export type PoolOwnValues = Omit<PoolFormValues, "template">;

/**
 * The form's state, for one opening of the dialog.
 *
 * The template lives in its own values owner rather than inside `values`,
 * because that owner is what the shipped sections take - so there is one copy
 * of the template in this dialog and `poolFormValues` is the only place the two
 * halves are joined.
 */
export interface PoolCreateDialogModel {
  values: PoolOwnValues;
  template: GuestValuesOwner;
  /** The four collapsed sections of the pool's own surface. */
  spreadOpen: boolean;
  serviceOpen: boolean;
  storageOpen: boolean;
  rolloutOpen: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The whole form, as the pure module reads it: the pool's fields and the template's. */
export function poolFormValues(model: PoolCreateDialogModel): PoolFormValues {
  return { ...model.values, template: model.template.values };
}

function syncPoolOkButton(model: PoolCreateDialogModel): void {
  model.okButtonProps.disabled = Boolean(
    poolCreateSubmitBlockReason(guestCreateInputs(model.template), poolFormValues(model)),
  );
}

/**
 * What this form adds to the template's own sections (SPEC-0015, D1 to D3 and
 * the shared referents).
 *
 * Recomputed on every render of the section that reads it, which is what makes
 * the MAC refusal appear and disappear with the replica count under the user's
 * cursor.
 */
function poolEmbedding(model: PoolCreateDialogModel): GuestTemplateEmbedding {
  const values = poolFormValues(model);
  const inputs = guestCreateInputs(model.template);
  const refusals = poolMacRefusals(values);
  const shared = poolSharedPvcWarnings(values);

  return {
    nodePinWarning: poolNodePinWarning(values),
    macRefusal: (index) => refusals.find((refusal) => refusal.index === index)?.message,
    portsDropped: poolServiceConfigured(values) ? templatePortsDroppedFact(values) : undefined,
    networkHint: templateNetworkHint(values),
    cloneTargetNode: cloneTargetNodePreview(inputs, values),
    gpuClaimWarning: poolGpuClaimWarning(values),
    seedProfileNote: poolSeedProfileNote(values),
    sharedPvcWarning: (index) => shared.find((warning) => warning.index === index)?.message,
  };
}

/** A fresh model for one opening of the dialog. */
export function createPoolDialogModel(namespace: string): PoolCreateDialogModel {
  const { template: templateValues, ...own } = defaultPoolForm(namespace);
  const template = createGuestValuesOwner(namespace, guestFormSeed(namespace));

  Mobx.runInAction(() => {
    template.values = templateValues;
  });

  const model = Mobx.observable({
    values: own,
    template,
    // Collapsed, per the section's own rule (DESIGN.md section 12): every field
    // inside is optional, has a default the object would get anyway, and what
    // it changes is stated on the header line whether the section is open or
    // shut. The head above them is deliberately short - this form is strictly
    // taller than the Create Guest form, and the collapsing is the mitigation.
    spreadOpen: false,
    serviceOpen: false,
    storageOpen: false,
    rolloutOpen: false,
    okButtonProps: { disabled: false, primary: true, accent: false },
  });

  model.template.onValuesChanged = () => syncPoolOkButton(model);
  model.template.embedding = () => poolEmbedding(model);
  Mobx.runInAction(() => syncPoolOkButton(model));

  return model;
}

/** The one way the pool's own fields change, so the OK button cannot drift. */
export const updatePoolForm = Mobx.action((model: PoolCreateDialogModel, patch: Partial<PoolOwnValues>) => {
  Object.assign(model.values, patch);
  syncPoolOkButton(model);
});

/**
 * Replaces the pool's own fields with the ones a pure function computed.
 *
 * The template is dropped on the way in: the pure transformers take and return
 * a whole `PoolFormValues`, and the copy of the template they carry is the one
 * that came out of the owner a moment ago.
 */
export const applyPoolForm = Mobx.action((model: PoolCreateDialogModel, next: PoolFormValues) => {
  const { template: _template, ...own } = next;

  Object.assign(model.values, own);
  syncPoolOkButton(model);
});

export const togglePoolSection = Mobx.action(
  (model: PoolCreateDialogModel, section: "spreadOpen" | "serviceOpen" | "storageOpen" | "rolloutOpen") => {
    model[section] = !model[section];
  },
);

/**
 * Moves the pool to another namespace, and the template with it.
 *
 * The template's namespace is not a field of its own here - a template has no
 * metadata at all - but it is what the namespaced pickers read, so the two are
 * kept equal and the shipped `changeNamespace` does the rest: it clears every
 * selection that named an object of the previous namespace and reloads the
 * reads behind them.
 */
export const changePoolNamespace = Mobx.action((model: PoolCreateDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  changeNamespace(model.template, namespace);
  syncPoolOkButton(model);
});

/** The namespace: the host's own control, in the light theme the white box requires. */
const PoolNamespaceField = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const errors = poolCreateErrors(poolFormValues(model));

  return (
    <Field
      label="Namespace"
      hint="The pool, every replica it creates and every per-replica PVC live here, and the images, seed profiles and claims offered below are the ones in it."
      error={errors.namespace}
    >
      <NamespaceSelect
        id="pool-create-namespace"
        themeName="light"
        menuClass={styles.selectMenu}
        value={model.values.namespace || null}
        onChange={(option: { value: string } | null) => changePoolNamespace(model, option?.value ?? "")}
      />
    </Field>
  );
});

/** The pool's name, whose budget is one separator and the widest index short of a label. */
const PoolNameField = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const errors = poolCreateErrors(poolFormValues(model));

  return (
    <Field
      label="Name"
      hint="Lowercase letters, digits and '-'. Every replica is named <pool>-<index>, and that name is the stem of its launcher pod, its cloned root disk and its per-guest Service."
      error={errors.name}
    >
      <Input
        value={model.values.name}
        placeholder="my-pool"
        data-testid="pool-create-name"
        onChange={(value: string) => updatePoolForm(model, { name: value })}
      />
    </Field>
  );
});

/** How many replicas, which is the number every line of the summary multiplies by. */
const ReplicasField = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const errors = poolCreateErrors(poolFormValues(model));

  return (
    <Field label="Replicas" hint={replicasFact} error={errors.replicas}>
      <Input
        value={model.values.replicas}
        placeholder="1"
        data-testid="pool-create-replicas"
        onChange={(value: string) => updatePoolForm(model, { replicas: value })}
      />
    </Field>
  );
});

/**
 * The spread policy, and the constraints it discards.
 *
 * Collapsed like the other three, and carrying on its header line the fact an
 * operator would otherwise meet as a template field that vanished: the
 * controller overwrites every replica's `topologySpreadConstraints`, with the
 * pool's own or with nothing at all.
 */
const SpreadSection = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const values = poolFormValues(model);

  return (
    <CollapsibleSection
      title="Spread"
      hint={poolSpreadHint(values)}
      open={model.spreadOpen}
      onToggle={() => togglePoolSection(model, "spreadOpen")}
      testId="pool-create-spread-section"
    >
      <div className={styles.field} data-testid="pool-create-spread">
        <div className={styles.label}>Spread policy</div>
        <RadioGroup
          className={styles.options}
          value={model.values.spreadPolicy}
          onChange={(policy: SwiftGuestPoolSpreadPolicy) => updatePoolForm(model, { spreadPolicy: policy })}
        >
          {poolSpreadPolicies.map((policy) => (
            <Radio
              key={policy}
              value={policy}
              label={
                <>
                  <span data-testid={`pool-create-spread-${policy.toLowerCase()}`}>{policy}</span>
                  <div className={styles.optionReason}>
                    {policy === "Spread"
                      ? "A hostname constraint on every replica, so the scheduler spreads them across nodes."
                      : "The schema's default: no constraint at all, so the scheduler usually places them together."}
                  </div>
                </>
              }
            />
          ))}
        </RadioGroup>
      </div>
    </CollapsibleSection>
  );
});

/**
 * The pool's Service: one load-balanced Service in front of every replica.
 *
 * Dropped altogether on a bridge-bound template, with what upstream really does
 * there in its place - the pool admitted, the Service garbage-collected, the
 * port injection skipped and a condition nobody looks at (D3).
 */
const PoolServiceSection = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const values = poolFormValues(model);

  if (!poolServiceApplies(values)) {
    return (
      <Field label="Service">
        <div className={styles.hint} data-testid="pool-create-service-dropped">
          {poolServiceDroppedFact}
        </div>
      </Field>
    );
  }

  const errors = poolServicePortErrors(values);
  const warnings = poolServicePortWarnings(values);
  const serviceError = poolServiceError(values);

  return (
    <CollapsibleSection
      title="Service"
      hint={poolServiceHint(values)}
      open={model.serviceOpen || poolServiceSectionHasError(values)}
      onToggle={() => togglePoolSection(model, "serviceOpen")}
      testId="pool-create-service-section"
    >
      <div className={styles.checkboxRow} data-testid="pool-create-service-enabled">
        <Checkbox
          label="Expose one Service across every replica"
          value={model.values.serviceEnabled}
          onChange={(value: boolean) => updatePoolForm(model, { serviceEnabled: value })}
        />
        <div className={styles.hint}>
          The controller mints one Service selecting the pool's replicas and injects its ports into every one of them,
          which is what replaces the template's own ports.
        </div>
        {serviceError ? <div className={styles.error}>{serviceError}</div> : null}
      </div>

      {model.values.serviceEnabled ? (
        <>
          <Field
            label="Type"
            hint="ClusterIP load-balances inside the cluster; NodePort and LoadBalancer additionally publish it outside."
          >
            <Select
              id="pool-create-service-type"
              themeName="light"
              menuClass={styles.selectMenu}
              value={model.values.serviceType}
              options={poolServiceTypes.map((type) => ({ value: type, label: type }))}
              onChange={(option: { value: SwiftGuestPoolServiceType } | null) =>
                option && applyPoolForm(model, setPoolServiceType(values, option.value))
              }
            />
          </Field>

          {poolHeadlessApplies(model.values.serviceType) ? (
            <div className={styles.checkboxRow} data-testid="pool-create-service-headless">
              <Checkbox
                label="Headless"
                value={model.values.serviceHeadless}
                onChange={(value: boolean) => updatePoolForm(model, { serviceHeadless: value })}
              />
              <div className={styles.hint}>
                No virtual IP: DNS returns one A record per ready replica instead, which is what client-side load
                balancing and sharded workloads want.
              </div>
            </div>
          ) : (
            <Field label="Headless">
              <div className={styles.hint} data-testid="pool-create-headless-dropped">
                {poolHeadlessDroppedFact(model.values.serviceType)}
              </div>
            </Field>
          )}

          {model.values.servicePorts.map((row, index) => (
            <PoolServicePortFields
              key={row.id}
              model={model}
              row={row}
              index={index}
              errors={errors[index] ?? {}}
              warnings={warnings[index] ?? {}}
            />
          ))}

          <AddRowButton
            label="Add a port"
            onAdd={() => applyPoolForm(model, addPoolServicePort(values))}
            testId="pool-create-add-service-port"
          />
        </>
      ) : null}
    </CollapsibleSection>
  );
});

/** One port of the pool's Service. `expose` is not offered: the controller drops it. */
const PoolServicePortFields = observer(
  ({
    model,
    row,
    index,
    errors,
    warnings,
  }: {
    model: PoolCreateDialogModel;
    row: PoolServicePortRow;
    index: number;
    errors: Partial<Record<"port" | "name" | "targetPort" | "protocol", string>>;
    warnings: Partial<Record<"port" | "name" | "targetPort" | "protocol", string>>;
  }) => {
    const prefix = `pool-create-service-port-${index}`;
    const update = (patch: Partial<PoolServicePortRow>) =>
      applyPoolForm(model, updatePoolServicePort(poolFormValues(model), row.id, patch));

    return (
      <FormRow
        title={`Service port ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applyPoolForm(model, removePoolServicePort(poolFormValues(model), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field
          label="Port"
          hint="The Service port, and the port injected into every replica's own network block."
          error={errors.port}
        >
          <Input
            value={row.port}
            placeholder="80"
            data-testid={`${prefix}-port`}
            onChange={(value: string) => update({ port: value })}
          />
        </Field>

        <Field
          label="Name"
          hint={
            model.values.servicePorts.length > 1
              ? "Required above one port: it becomes this port's name on the Service, and Kubernetes refuses a multi-port Service without one."
              : "Optional on a single port, and required as soon as there is a second one."
          }
          error={errors.name}
          warning={warnings.name}
        >
          <Input
            value={row.name}
            placeholder="http"
            data-testid={`${prefix}-name`}
            onChange={(value: string) => update({ name: value })}
          />
        </Field>

        <Field
          label="Target port"
          hint="What the guest itself listens on. Empty means the same number as the port above."
          error={errors.targetPort}
        >
          <Input
            value={row.targetPort}
            placeholder="the same as the port"
            data-testid={`${prefix}-target-port`}
            onChange={(value: string) => update({ targetPort: value })}
          />
        </Field>

        <Field label="Protocol" hint={`Empty is ${defaultPortProtocol}, which the API server stamps.`}>
          <Select
            id={`${prefix}-protocol`}
            themeName="light"
            menuClass={styles.selectMenu}
            value={row.protocol}
            options={guestPortProtocols.map((protocol) => ({ value: protocol, label: protocol }))}
            onChange={(option: { value: SwiftGuestProtocol } | null) => option && update({ protocol: option.value })}
          />
        </Field>
      </FormRow>
    );
  },
);

/**
 * The per-replica storage: the whole stateful-pool feature, which upstream's
 * own UI cannot reach at all.
 *
 * The vocabulary is the blank data disk's, one level up: a name, a size, a
 * class and the two modes. `metadata.name` is required here and by nothing else
 * (P8), and the resulting PVC name is shown as a fact because both of
 * upstream's documents state it backwards.
 */
const PoolStorageSection = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const values = poolFormValues(model);
  const errors = poolClaimTemplateErrors(values);

  return (
    <CollapsibleSection
      title="Per-replica storage"
      hint={poolClaimTemplatesHint(values)}
      open={model.storageOpen || poolStorageSectionHasError(values)}
      onToggle={() => togglePoolSection(model, "storageOpen")}
      testId="pool-create-storage-section"
    >
      {model.values.claimTemplates.map((row, index) => (
        <PoolClaimTemplateFields key={row.id} model={model} row={row} index={index} errors={errors[index] ?? {}} />
      ))}

      <AddRowButton
        label="Add a per-replica claim"
        onAdd={() => applyPoolForm(model, addPoolClaimTemplate(values))}
        testId="pool-create-add-claim"
      />
    </CollapsibleSection>
  );
});

/** One claim template, with the PVC name it produces stated under it. */
const PoolClaimTemplateFields = observer(
  ({
    model,
    row,
    index,
    errors,
  }: {
    model: PoolCreateDialogModel;
    row: PoolClaimTemplateRow;
    index: number;
    errors: Partial<Record<"name" | "size" | "storageClass" | "accessMode" | "volumeMode", string>>;
  }) => {
    const prefix = `pool-create-claim-${index}`;
    const update = (patch: Partial<PoolClaimTemplateRow>) =>
      applyPoolForm(model, updatePoolClaimTemplate(poolFormValues(model), row.id, patch));

    return (
      <FormRow
        title={`Storage template ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applyPoolForm(model, removePoolClaimTemplate(poolFormValues(model), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field
          label="Name"
          hint="A DNS label. It is the first segment of every PVC this template creates, and the schema does not require it - an empty one produces a PVC name nothing can create."
          error={errors.name}
        >
          <Input
            value={row.name}
            placeholder="state"
            data-testid={`${prefix}-name`}
            onChange={(value: string) => update({ name: value })}
          />
        </Field>

        <Field
          label="Size"
          hint="A Kubernetes quantity, for example 50Gi. Each replica gets its own claim of this size."
          error={errors.size}
        >
          <Input
            value={row.size}
            placeholder="50Gi"
            data-testid={`${prefix}-size`}
            onChange={(value: string) => update({ size: value })}
          />
        </Field>

        <Field label="Storage class" hint="Empty uses the cluster's default class." error={errors.storageClass}>
          <Input
            value={row.storageClass}
            placeholder="the cluster default"
            data-testid={`${prefix}-storage-class`}
            onChange={(value: string) => update({ storageClass: value })}
          />
        </Field>

        <Field label="Access mode" hint="Empty leaves it to the storage class's own default.">
          <Select
            id={`${prefix}-access-mode`}
            themeName="light"
            menuClass={styles.selectMenu}
            placeholder="From the storage class"
            isClearable
            value={row.accessMode || null}
            options={guestAccessModes.map((mode) => ({ value: mode, label: mode }))}
            onChange={(option: { value: string } | null) => update({ accessMode: option?.value ?? "" })}
          />
        </Field>

        <Field label="Volume mode" hint="Empty is the Filesystem a PVC implies when it says nothing.">
          <Select
            id={`${prefix}-volume-mode`}
            themeName="light"
            menuClass={styles.selectMenu}
            placeholder="Filesystem (implied)"
            isClearable
            value={row.volumeMode || null}
            options={guestVolumeModes.map((mode) => ({ value: mode, label: mode }))}
            onChange={(option: { value: string } | null) => update({ volumeMode: option?.value ?? "" })}
          />
        </Field>

        <p className={styles.hint} data-testid={`${prefix}-pvc-name`}>
          {poolClaimPvcFact(poolFormValues(model), row)}
        </p>
      </FormRow>
    );
  },
);

/**
 * The rollout: what a template change does to a fleet that is already running.
 *
 * The one refusal in it is P10's - `maxUnavailable: 0` with `maxSurge: 0` is
 * schema-legal, coupled by no rule, reported by no condition, and can never
 * progress - and the pace fields are dropped altogether under Recreate, where
 * the controller does not read them.
 */
const PoolRolloutSection = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const values = poolFormValues(model);
  const errors = poolRolloutErrors(values);

  return (
    <CollapsibleSection
      title="Rollout"
      hint={poolRolloutHint(values)}
      open={model.rolloutOpen || poolRolloutSectionHasError(values)}
      onToggle={() => togglePoolSection(model, "rolloutOpen")}
      testId="pool-create-rollout-section"
    >
      <div className={styles.field} data-testid="pool-create-strategy">
        <div className={styles.label}>Strategy</div>
        <RadioGroup
          className={styles.options}
          value={model.values.updateStrategyType}
          onChange={(type: SwiftGuestPoolUpdateStrategyType) => updatePoolForm(model, { updateStrategyType: type })}
        >
          {poolUpdateStrategyTypes.map((type) => (
            <Radio
              key={type}
              value={type}
              label={
                <>
                  <span data-testid={`pool-create-strategy-${type.toLowerCase()}`}>{type}</span>
                  <div className={styles.optionReason}>
                    {type === "Recreate"
                      ? "Every replica is replaced at once when the template changes."
                      : "The schema's default: replicas are replaced a few at a time, highest index first."}
                  </div>
                </>
              }
            />
          ))}
        </RadioGroup>
      </div>

      {rollingUpdateApplies(model.values.updateStrategyType) ? (
        <>
          <Field
            label={poolRolloutFieldLabels.maxUnavailable}
            hint={`How many replicas may be down at once during a rollout. ${defaultMaxUnavailable} is what the API server stamps.`}
            error={errors.maxUnavailable}
          >
            <Input
              value={model.values.maxUnavailable}
              placeholder={defaultMaxUnavailable}
              data-testid="pool-create-max-unavailable"
              onChange={(value: string) => updatePoolForm(model, { maxUnavailable: value })}
            />
          </Field>

          <Field
            label={poolRolloutFieldLabels.maxSurge}
            hint={`How many replicas may exist above the desired count during a rollout. ${defaultMaxSurge} is what the API server stamps.`}
            error={errors.maxSurge}
          >
            <Input
              value={model.values.maxSurge}
              placeholder={defaultMaxSurge}
              data-testid="pool-create-max-surge"
              onChange={(value: string) => updatePoolForm(model, { maxSurge: value })}
            />
          </Field>
        </>
      ) : (
        <Field label="Pace">
          <div className={styles.hint} data-testid="pool-create-pace-dropped">
            {poolRolloutFact(values)}
          </div>
        </Field>
      )}
    </CollapsibleSection>
  );
});

/** The live write summary: the one create line, the pool's facts, and each replica's (W1, D4). */
const PoolWriteSummary = observer(({ model }: { model: PoolCreateDialogModel }) => (
  <WriteSummary facts={poolCreateSummary(guestCreateInputs(model.template), poolFormValues(model))} />
));

/**
 * The form, as the dialog's `message`.
 *
 * The head is short on purpose - three fields - and the template's own sections
 * follow it under their own heading, so the form reads as "a pool of N of
 * these" rather than as two forms in one box.
 */
export const PoolCreateForm = observer(({ model }: { model: PoolCreateDialogModel }) => {
  const blocked = poolCreateSubmitBlockReason(guestCreateInputs(model.template), poolFormValues(model));

  return (
    <div className={styles.form} data-testid="swiftguestpool-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftGuestPool</b>
      </p>

      <PoolNamespaceField model={model} />
      <PoolNameField model={model} />
      <ReplicasField model={model} />

      <p className={styles.subject}>
        {"Every replica is a "}
        <b>SwiftGuest</b>
        {" of this template"}
      </p>

      {/* The Create Guest form's own sections, rendered against this dialog's
          template owner: one implementation of each, and the divergences reach
          them through the embedding rather than through a copy of the code. */}
      <GuestClassField model={model.template} />
      <BootSourceFields model={model.template} />
      <SeedProfileField model={model.template} />
      <RunPolicyField model={model.template} />
      <NodeField model={model.template} />
      <StorageSection model={model.template} />
      <DataDisksSection model={model.template} />
      <NetworkSection model={model.template} />
      <GpuSection model={model.template} />
      <GuestAgentField model={model.template} />

      <SpreadSection model={model} />
      <PoolServiceSection model={model} />
      <PoolStorageSection model={model} />
      <PoolRolloutSection model={model} />

      <PoolWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="pool-create-submit-blocked">
          {`${createGuestPoolTitle} is disabled - ${blocked}`}
        </p>
      ) : null}

      <p className={styles.footer} data-testid="pool-create-yaml-footer">
        {poolExcludedFieldsFooter}
      </p>
    </div>
  );
});

/**
 * Performs the create, reports the outcome, and keeps the form when the name
 * was the problem.
 *
 * Nothing is ever rethrown, for the reason every dialog before it does not:
 * `ConfirmDialog.ok` closes the dialog in a `finally` on both outcomes, and a
 * rethrown `JsonApiErrorParsed` additionally triggers the host's own "Unknown
 * error occurred while ok-ing" toast.
 */
async function submitPool(model: PoolCreateDialogModel, params: Renderer.Component.ConfirmDialogParams): Promise<void> {
  const inputs = guestCreateInputs(model.template);
  const values = poolFormValues(model);
  const namespace = values.namespace.trim();
  const name = values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  const blocked = poolCreateSubmitBlockReason(inputs, values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftGuestPool.getStore<SwiftGuestPool>().create({ name, namespace }, poolCreatePayload(inputs, values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        poolCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftGuestPool ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(poolCreateSuccessMessage(namespace, name));
}

/** Opens the dialog for one model, keeping the params so the 409 path can reopen it. */
export function openPoolCreateDialog(model: PoolCreateDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createGuestPoolTitle,
    // No icon, as in the five dialogs before it: the host's default is a warning
    // triangle, and a create commits resources without destroying anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <PoolCreateForm model={model} />,
    ok: () => submitPool(model, params),
  };

  ConfirmDialog.open(params);
}

/**
 * The entry point the Guest Pools page's create control calls.
 *
 * The namespace comes from the page's own filter when it names exactly one, the
 * pickers are seeded from whatever the stores already hold, and the three reads
 * that refine them are the Create Guest form's own - none awaited, none able to
 * throw.
 */
export function openCreateGuestPoolDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createPoolDialogModel(namespace);

  void loadGuestClasses(model.template);
  void loadNamespacedObjects(model.template);
  void loadNodes(model.template);

  openPoolCreateDialog(model);
}

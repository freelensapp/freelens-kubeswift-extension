/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The five workload sections of the Create Sandbox form (SPEC-0019 T4, D1, D2):
// probes, termination, artifacts, Secret files and pod labels, each collapsed
// like the form's other optional sections and opening itself on an error. They
// are offered on both modes: they belong to the workload, not to the slot.
//
// Every decision belongs to `sandbox-workload-create.ts`; this is the JSX. The
// context the rules need (the network the sandbox runs under, its port names,
// the namespace's Secrets) is computed by the form and handed in, so this file
// imports nothing at runtime from the dialog.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { AddRowButton, CollapsibleSection, Field, FormRow, ObjectPickerField } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import { goDurationGrammar } from "./sandbox-create";
import { KeyValueRowsField } from "./sandbox-network-section";
import {
  addArtifactBlockedReason,
  addArtifactClaim,
  addArtifactClaimBlockedReason,
  addPodLabelBlockedReason,
  addSandboxArtifact,
  addSandboxPodLabel,
  addSandboxSecretFile,
  addSecretFileBlockedReason,
  addSecretFileItem,
  addSecretFileItemBlockedReason,
  artifactLayouts,
  defaultDrainPeriodText,
  defaultFetchTimeout,
  drainPeriodError,
  maxSandboxArtifacts,
  maxSandboxSecretFiles,
  maxSecretFileItems,
  probeBlockedReason,
  removeArtifactClaim,
  removeSandboxArtifact,
  removeSandboxPodLabel,
  removeSandboxSecretFile,
  removeSecretFileItem,
  sandboxArtifactErrors,
  sandboxArtifactsSectionHasError,
  sandboxArtifactsSectionHint,
  sandboxArtifactWarnings,
  sandboxPodLabelErrors,
  sandboxPodLabelsSectionHasError,
  sandboxPodLabelsSectionHint,
  sandboxProbeActionLabels,
  sandboxProbeActions,
  sandboxProbeErrors,
  sandboxProbeKinds,
  sandboxProbeLabels,
  sandboxProbeNumberDefaults,
  sandboxProbeNumberFields,
  sandboxProbesSectionHasError,
  sandboxProbesSectionHint,
  sandboxProbeWarning,
  sandboxSecretFileErrors,
  sandboxSecretFilesSectionHasError,
  sandboxSecretFilesSectionHint,
  sandboxSecretFileWarnings,
  sandboxTerminationSectionHasError,
  sandboxTerminationSectionHint,
  setSandboxProbeEnabled,
  updateArtifactClaim,
  updateSandboxArtifact,
  updateSandboxPodLabel,
  updateSandboxProbe,
  updateSandboxSecretFile,
  updateSecretFileItem,
} from "./sandbox-workload-create";

import type { ObjectPickerFacts } from "./create-dialog";
import type {
  SandboxArtifactMessages,
  SandboxArtifactRow,
  SandboxArtifactWarnings,
  SandboxProbeKind,
  SandboxProbeNumberField,
  SandboxProbeValues,
  SandboxSecretFileMessages,
  SandboxSecretFileRow,
  SandboxWorkloadContext,
  SandboxWorkloadValues,
} from "./sandbox-workload-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, Input, Select },
} = Renderer;

/** The five sections ship shut; these are what the user does about that. */
export type SandboxWorkloadSection =
  | "probesOpen"
  | "terminationOpen"
  | "artifactsOpen"
  | "secretFilesOpen"
  | "podLabelsOpen";

/** What the sections need of the form they are rendered inside. */
export interface SandboxWorkloadOwner extends Record<SandboxWorkloadSection, boolean> {
  values: { workload: SandboxWorkloadValues };
  /** The namespace's Secrets, for the artifacts' and the Secret files' pickers. */
  secrets: ObjectPickerFacts;
  onValuesChanged: () => void;
}

/** The one way the sections' values change, so the OK button can never drift. */
export const applySandboxWorkload = Mobx.action((model: SandboxWorkloadOwner, next: SandboxWorkloadValues) => {
  model.values.workload = next;
  model.onValuesChanged();
});

export const toggleSandboxWorkloadSection = Mobx.action(
  (model: SandboxWorkloadOwner, section: SandboxWorkloadSection) => {
    model[section] = !model[section];
  },
);

const secretUnverifiedHint = "The Secrets of this namespace could not be listed, so the name is not verified.";

type SectionProps = { model: SandboxWorkloadOwner; context: SandboxWorkloadContext };

// ---------------------------------------------------------------------------
// Probes.
// ---------------------------------------------------------------------------

export const SandboxProbesSection = observer(({ model, context }: SectionProps) => {
  const workload = model.values.workload;

  return (
    <CollapsibleSection
      title="Probes"
      hint={sandboxProbesSectionHint(workload)}
      open={model.probesOpen || sandboxProbesSectionHasError(workload, context)}
      onToggle={() => toggleSandboxWorkloadSection(model, "probesOpen")}
      testId="sandbox-create-probes-section"
    >
      {sandboxProbeKinds.map((kind) => (
        <SandboxProbeFields key={kind} model={model} context={context} kind={kind} />
      ))}
    </CollapsibleSection>
  );
});

const probeHints: Record<SandboxProbeKind, string> = {
  readiness:
    "Its result is the WorkloadReady condition and, when the sandbox exposes ports, the launcher pod's readiness, so a Service routes to it only while it passes. Off, the workload counts as ready once the guest runs.",
  liveness:
    "After the failure threshold is reached in a row, the workload is stopped and the sandbox ends Failed. Nothing restarts it.",
};

const SandboxProbeFields = observer(({ model, context, kind }: SectionProps & { kind: SandboxProbeKind }) => {
  const probe = model.values.workload[kind];
  const errors = sandboxProbeErrors(probe, context);
  const blocked = probeBlockedReason(context);
  const prefix = `sandbox-create-${kind}-probe`;
  const update = (patch: Partial<SandboxProbeValues>) =>
    applySandboxWorkload(model, updateSandboxProbe(model.values.workload, kind, patch));

  return (
    <div className={styles.field} data-testid={prefix}>
      <div className={styles.checkboxRow} data-testid={`${prefix}-enabled`}>
        <Checkbox
          label={sandboxProbeLabels[kind]}
          value={probe.enabled}
          // W4: a probe that cannot pass is not offered, with its reason; one
          // already on stays editable so it can be turned off.
          disabled={Boolean(blocked) && !probe.enabled}
          onChange={(value: boolean) =>
            applySandboxWorkload(model, setSandboxProbeEnabled(model.values.workload, kind, value))
          }
        />
        <div className={styles.hint}>{probeHints[kind]}</div>
        {blocked && !probe.enabled ? (
          <div className={styles.blocked} data-testid={`${prefix}-blocked`}>
            {blocked}
          </div>
        ) : null}
        {errors.probe ? <div className={styles.error}>{errors.probe}</div> : null}
        {sandboxProbeWarning(probe, context) ? (
          <div className={styles.warning}>{sandboxProbeWarning(probe, context)}</div>
        ) : null}
      </div>

      {probe.enabled ? (
        <>
          <Field label="Check" hint="The two checks KubeSwift supports, run on the guest from inside the launcher.">
            <Select
              id={`${prefix}-action`}
              themeName="light"
              menuClass={styles.selectMenu}
              value={probe.action}
              options={sandboxProbeActions.map((action) => ({
                value: action,
                label: sandboxProbeActionLabels[action],
              }))}
              onChange={(option: { value: SandboxProbeValues["action"] } | null) =>
                option ? update({ action: option.value }) : undefined
              }
            />
          </Field>

          {probe.action === "http" ? (
            <Field label="Path" hint="Optional, such as /healthz. HTTP only." error={errors.path}>
              <Input
                value={probe.path}
                placeholder="/healthz"
                data-testid={`${prefix}-path`}
                onChange={(value: string) => update({ path: value })}
              />
            </Field>
          ) : null}

          <Field
            label="Port"
            hint={
              context.checkout
                ? "A number: on a checkout the pool decides the network, so this sandbox has no port names of its own. It need not be exposed."
                : `A number, or the name of a port declared in the Network section${context.portNames.length > 0 ? ` (${context.portNames.join(", ")})` : ""}. It need not be exposed.`
            }
            error={errors.port}
          >
            <Input
              value={probe.port}
              placeholder="8080"
              data-testid={`${prefix}-port`}
              onChange={(value: string) => update({ port: value })}
            />
          </Field>

          {sandboxProbeNumberFields.map((field) => (
            <SandboxProbeNumberInput
              key={field}
              prefix={prefix}
              field={field}
              value={probe[field]}
              error={errors[field]}
              onChange={(value) => update({ [field]: value })}
            />
          ))}
        </>
      ) : null}
    </div>
  );
});

const probeNumberLabels: Record<SandboxProbeNumberField, string> = {
  periodSeconds: "Period (seconds)",
  timeoutSeconds: "Timeout (seconds)",
  failureThreshold: "Failure threshold",
  initialDelaySeconds: "Initial delay (seconds)",
};

const probeNumberTestIds: Record<SandboxProbeNumberField, string> = {
  periodSeconds: "period",
  timeoutSeconds: "timeout",
  failureThreshold: "failure-threshold",
  initialDelaySeconds: "initial-delay",
};

function SandboxProbeNumberInput({
  prefix,
  field,
  value,
  error,
  onChange,
}: {
  prefix: string;
  field: SandboxProbeNumberField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={probeNumberLabels[field]} hint={`Empty is ${sandboxProbeNumberDefaults[field]}.`} error={error}>
      <Input
        value={value}
        placeholder={sandboxProbeNumberDefaults[field]}
        data-testid={`${prefix}-${probeNumberTestIds[field]}`}
        onChange={onChange}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Termination.
// ---------------------------------------------------------------------------

export const SandboxTerminationSection = observer(({ model, context }: SectionProps) => {
  const workload = model.values.workload;

  return (
    <CollapsibleSection
      title="Termination"
      hint={sandboxTerminationSectionHint(workload, context)}
      open={model.terminationOpen || sandboxTerminationSectionHasError(workload)}
      onToggle={() => toggleSandboxWorkloadSection(model, "terminationOpen")}
      testId="sandbox-create-termination-section"
    >
      <Field
        label="Drain period"
        hint={`How long the workload keeps running after deletion has taken the sandbox out of Service endpoints, before the microVM is stopped; it ends early when the workload exits. Between 0s and 10m; empty is ${defaultDrainPeriodText(context)}. ${goDurationGrammar}`}
        error={drainPeriodError(workload.drainPeriod)}
      >
        <Input
          value={workload.drainPeriod}
          placeholder={context.checkout ? "the default" : defaultDrainPeriodText(context)}
          data-testid="sandbox-create-drain-period"
          onChange={(value: string) => applySandboxWorkload(model, { ...model.values.workload, drainPeriod: value })}
        />
      </Field>
    </CollapsibleSection>
  );
});

// ---------------------------------------------------------------------------
// Artifacts.
// ---------------------------------------------------------------------------

export const SandboxArtifactsSection = observer(({ model, context }: SectionProps) => {
  const workload = model.values.workload;
  const errors = sandboxArtifactErrors(workload);
  const warnings = sandboxArtifactWarnings(workload, context);

  return (
    <CollapsibleSection
      title="Artifacts"
      hint={sandboxArtifactsSectionHint(workload)}
      open={model.artifactsOpen || sandboxArtifactsSectionHasError(workload)}
      onToggle={() => toggleSandboxWorkloadSection(model, "artifactsOpen")}
      testId="sandbox-create-artifacts-section"
    >
      <div className={styles.field} data-testid="sandbox-create-artifacts">
        <div className={styles.hint}>
          {`OCI artifacts mounted read-only into the guest - bundles, plugins, datasets - pulled on the node and cached by digest, at most ${maxSandboxArtifacts}. They need the sandbox kernel 6.6.14 or later.`}
        </div>
        {errors.artifacts ? <div className={styles.error}>{errors.artifacts}</div> : null}

        {workload.artifacts.map((row, index) => (
          <SandboxArtifactFields
            key={row.id}
            model={model}
            row={row}
            index={index}
            messages={errors.rows[index] ?? { claimRows: [] }}
            warnings={warnings[index] ?? {}}
          />
        ))}

        <AddRowButton
          label="Add an artifact"
          onAdd={() => applySandboxWorkload(model, addSandboxArtifact(model.values.workload))}
          blockedReason={addArtifactBlockedReason(workload)}
          testId="sandbox-create-add-artifact"
          blockedTestId="sandbox-create-add-artifact-blocked"
        />
      </div>
    </CollapsibleSection>
  );
});

const SandboxArtifactFields = observer(
  ({
    model,
    row,
    index,
    messages,
    warnings,
  }: {
    model: SandboxWorkloadOwner;
    row: SandboxArtifactRow;
    index: number;
    messages: SandboxArtifactMessages;
    warnings: SandboxArtifactWarnings;
  }) => {
    const prefix = `sandbox-create-artifact-${index}`;
    const workload = () => model.values.workload;
    const update = (patch: Partial<SandboxArtifactRow>) =>
      applySandboxWorkload(model, updateSandboxArtifact(workload(), row.id, patch));

    return (
      <FormRow
        title={`Artifact ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxWorkload(model, removeSandboxArtifact(workload(), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field label="Name" hint="A DNS label of at most 40 characters, unique in the sandbox." error={messages.name}>
          <Input
            value={row.name}
            placeholder="plugins"
            data-testid={`${prefix}-name`}
            onChange={(value: string) => update({ name: value })}
          />
        </Field>

        <Field
          label="Reference"
          hint="A digest (repo@sha256:...) pins it; a tag is resolved to a digest when the sandbox starts."
          error={messages.ref}
        >
          <Input
            value={row.ref}
            placeholder="ghcr.io/example/plugins@sha256:..."
            data-testid={`${prefix}-ref`}
            onChange={(value: string) => update({ ref: value })}
          />
        </Field>

        <Field
          label="Mount path"
          hint="Absolute; not /, /proc, /sys or /dev, and not inside another artifact's mount."
          error={messages.mountPath}
          warning={warnings.mountPath}
        >
          <Input
            value={row.mountPath}
            placeholder="/opt/plugins"
            data-testid={`${prefix}-mount-path`}
            onChange={(value: string) => update({ mountPath: value })}
          />
        </Field>

        <Field
          label="Layout"
          hint="oci keeps the OCI image layout as pushed, for an OCI-aware tool; unpacked extracts the image's layers into a tree."
        >
          <Select
            id={`${prefix}-layout`}
            themeName="light"
            menuClass={styles.selectMenu}
            isClearable
            placeholder={`${artifactLayouts[0]} (the schema's default)`}
            value={row.layout || null}
            options={artifactLayouts.map((layout) => ({ value: layout, label: layout }))}
            onChange={(option: { value: string } | null) => update({ layout: option?.value ?? "" })}
          />
        </Field>

        <div className={styles.checkboxRow} data-testid={`${prefix}-optional`}>
          <Checkbox label="Optional" value={row.optional} onChange={(value: boolean) => update({ optional: value })} />
          <div className={styles.hint}>
            The workload can run without it: one that cannot be resolved, fetched or verified in time is not mounted,
            instead of failing the sandbox. Verification is never skipped.
          </div>
        </div>

        {row.optional ? (
          <Field
            label="Fetch timeout"
            hint={`How long it may delay the workload, from the sandbox's creation; 0s uses it only if it is already on the node. At most 5m; empty is ${defaultFetchTimeout}.`}
            error={messages.fetchTimeout}
          >
            <Input
              value={row.fetchTimeout}
              placeholder={defaultFetchTimeout}
              data-testid={`${prefix}-fetch-timeout`}
              onChange={(value: string) => update({ fetchTimeout: value })}
            />
          </Field>
        ) : null}

        <ObjectPickerField
          id={`${prefix}-pull-secret`}
          inputTestId={`${prefix}-pull-secret-input`}
          label="Pull secret"
          hint="A docker-registry Secret of this namespace for this artifact's registry. Empty uses the sandbox's own pull secret. It never enters the guest."
          unverifiedHint={secretUnverifiedHint}
          placeholder="the sandbox's pull secret"
          value={row.pullSecret}
          facts={model.secrets}
          error={messages.pullSecret}
          warning={warnings.pullSecret}
          onChange={(value: string) => update({ pullSecret: value })}
        />

        <ObjectPickerField
          id={`${prefix}-verify-key`}
          inputTestId={`${prefix}-verify-key-input`}
          label="Verification key"
          hint="A Secret holding a cosign public key under cosign.pub; the artifact is verified at its digest before it is mounted. It needs a TLS registry."
          unverifiedHint={secretUnverifiedHint}
          placeholder="None"
          value={row.verifyKeySecret}
          facts={model.secrets}
          error={messages.verifyKeySecret}
          warning={warnings.verifyKeySecret}
          onChange={(value: string) => update({ verifyKeySecret: value })}
        />

        <div className={styles.checkboxRow} data-testid={`${prefix}-require-platform-verification`}>
          <Checkbox
            label="Require platform verification"
            value={row.requirePlatformVerification}
            onChange={(value: boolean) => update({ requirePlatformVerification: value })}
          />
          <div className={styles.hint}>
            Refuses the artifact (skips it, if optional) unless a SwiftArtifactVerificationPolicy of this namespace
            governs it.
          </div>
        </div>

        <KeyValueRowsField
          label="Claims"
          hint="Signed annotations a verification policy must find. They only add requirements: claims that no policy governs make the artifact refused."
          error={messages.claims}
          rows={row.claims}
          messages={messages.claimRows}
          prefix={`${prefix}-claim`}
          rowTitle="Claim"
          addLabel="Add a claim"
          blockedReason={addArtifactClaimBlockedReason(row)}
          keyPlaceholder="org.example/team"
          valuePlaceholder="platform"
          testId={`${prefix}-claims`}
          onAdd={() => applySandboxWorkload(model, addArtifactClaim(workload(), row.id))}
          onRemove={(id) => applySandboxWorkload(model, removeArtifactClaim(workload(), row.id, id))}
          onUpdate={(id, patch) => applySandboxWorkload(model, updateArtifactClaim(workload(), row.id, id, patch))}
        />
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// Secret files.
// ---------------------------------------------------------------------------

export const SandboxSecretFilesSection = observer(({ model, context }: SectionProps) => {
  const workload = model.values.workload;
  const errors = sandboxSecretFileErrors(workload);
  const warnings = sandboxSecretFileWarnings(workload, context);

  return (
    <CollapsibleSection
      title="Secret files"
      hint={sandboxSecretFilesSectionHint(workload)}
      open={model.secretFilesOpen || sandboxSecretFilesSectionHasError(workload)}
      onToggle={() => toggleSandboxWorkloadSection(model, "secretFilesOpen")}
      testId="sandbox-create-secret-files-section"
    >
      <div className={styles.field} data-testid="sandbox-create-secret-files">
        <div className={styles.hint}>
          {`Keys of Secrets of this namespace, written into the guest as files before the workload starts, in its in-memory writable layer; at most ${maxSandboxSecretFiles} Secrets. They need the sandbox kernel 6.6.14 or later.`}
        </div>
        {errors.secretFiles ? <div className={styles.error}>{errors.secretFiles}</div> : null}

        {workload.secretFiles.map((row, index) => (
          <SandboxSecretFileFields
            key={row.id}
            model={model}
            row={row}
            index={index}
            messages={errors.rows[index] ?? { itemRows: [] }}
            warning={warnings[index]}
          />
        ))}

        <AddRowButton
          label="Add a Secret"
          onAdd={() => applySandboxWorkload(model, addSandboxSecretFile(model.values.workload))}
          blockedReason={addSecretFileBlockedReason(workload)}
          testId="sandbox-create-add-secret-file"
          blockedTestId="sandbox-create-add-secret-file-blocked"
        />
      </div>
    </CollapsibleSection>
  );
});

const SandboxSecretFileFields = observer(
  ({
    model,
    row,
    index,
    messages,
    warning,
  }: {
    model: SandboxWorkloadOwner;
    row: SandboxSecretFileRow;
    index: number;
    messages: SandboxSecretFileMessages;
    warning?: string;
  }) => {
    const prefix = `sandbox-create-secret-file-${index}`;
    const workload = () => model.values.workload;
    const update = (patch: Partial<SandboxSecretFileRow>) =>
      applySandboxWorkload(model, updateSandboxSecretFile(workload(), row.id, patch));

    return (
      <FormRow
        title={`Secret ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxWorkload(model, removeSandboxSecretFile(workload(), row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <ObjectPickerField
          id={`${prefix}-secret`}
          inputTestId={`${prefix}-secret-input`}
          label="Secret"
          hint="A Secret of this namespace, read by the launcher with its own account."
          unverifiedHint={secretUnverifiedHint}
          placeholder="Pick a Secret"
          value={row.secretName}
          facts={model.secrets}
          error={messages.secretName}
          warning={warning}
          onChange={(value: string) => update({ secretName: value })}
        />

        <Field
          label="Default mode"
          hint="Octal, the mode of every file unless its item sets one. Empty is 0400."
          error={messages.mode}
        >
          <Input
            value={row.mode}
            placeholder="0400"
            data-testid={`${prefix}-mode`}
            onChange={(value: string) => update({ mode: value })}
          />
        </Field>

        <div className={styles.checkboxRow} data-testid={`${prefix}-optional`}>
          <Checkbox label="Optional" value={row.optional} onChange={(value: boolean) => update({ optional: value })} />
          <div className={styles.hint}>
            A missing Secret or key then leaves its files out, instead of keeping the sandbox Pending.
          </div>
        </div>

        <div className={styles.field} data-testid={`${prefix}-items`}>
          <div className={styles.label}>Files</div>
          <div
            className={styles.hint}
          >{`Each key of the Secret and the file it becomes; at least one, at most ${maxSecretFileItems}.`}</div>
          {messages.items ? <div className={styles.error}>{messages.items}</div> : null}

          {row.items.map((item, itemIndex) => (
            <FormRow
              key={item.id}
              title={`File ${itemIndex + 1}`}
              removeLabel="Remove"
              onRemove={() => applySandboxWorkload(model, removeSecretFileItem(workload(), row.id, item.id))}
              testId={`${prefix}-item-${itemIndex}`}
              removeTestId={`${prefix}-item-${itemIndex}-remove`}
            >
              <Field label="Key" error={messages.itemRows[itemIndex]?.key}>
                <Input
                  value={item.key}
                  placeholder="token"
                  data-testid={`${prefix}-item-${itemIndex}-key`}
                  onChange={(value: string) =>
                    applySandboxWorkload(model, updateSecretFileItem(workload(), row.id, item.id, { key: value }))
                  }
                />
              </Field>
              <Field
                label="Path"
                hint="Absolute, with no '.' or '..' component, not under /proc, /sys or /dev."
                error={messages.itemRows[itemIndex]?.path}
              >
                <Input
                  value={item.path}
                  placeholder="/etc/app/token"
                  data-testid={`${prefix}-item-${itemIndex}-path`}
                  onChange={(value: string) =>
                    applySandboxWorkload(model, updateSecretFileItem(workload(), row.id, item.id, { path: value }))
                  }
                />
              </Field>
              <Field
                label="Mode"
                hint="Octal; empty is the default mode above."
                error={messages.itemRows[itemIndex]?.mode}
              >
                <Input
                  value={item.mode}
                  placeholder={row.mode.trim() || "0400"}
                  data-testid={`${prefix}-item-${itemIndex}-mode`}
                  onChange={(value: string) =>
                    applySandboxWorkload(model, updateSecretFileItem(workload(), row.id, item.id, { mode: value }))
                  }
                />
              </Field>
            </FormRow>
          ))}

          <AddRowButton
            label="Add a file"
            onAdd={() => applySandboxWorkload(model, addSecretFileItem(workload(), row.id))}
            blockedReason={addSecretFileItemBlockedReason(row)}
            testId={`${prefix}-add-item`}
            blockedTestId={`${prefix}-add-item-blocked`}
          />
        </div>
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// Pod labels (D1).
// ---------------------------------------------------------------------------

export const SandboxPodLabelsSection = observer(({ model, context }: SectionProps) => {
  const workload = model.values.workload;
  const errors = sandboxPodLabelErrors(workload);

  return (
    <CollapsibleSection
      title="Pod labels"
      hint={sandboxPodLabelsSectionHint(workload)}
      open={model.podLabelsOpen || sandboxPodLabelsSectionHasError(workload)}
      onToggle={() => toggleSandboxWorkloadSection(model, "podLabelsOpen")}
      testId="sandbox-create-pod-labels-section"
    >
      <KeyValueRowsField
        label="Labels"
        hint={`Added to ${context.checkout ? "the claimed slot's pod" : "the launcher pod"}, so a Service of yours can select the sandbox. Keys under kubeswift.io, *.kubeswift.io and the pod-network domains KubeSwift wires itself are refused.`}
        error={errors.podLabels}
        rows={workload.podLabels}
        messages={errors.rows}
        prefix="sandbox-create-pod-label"
        rowTitle="Label"
        addLabel="Add a label"
        blockedReason={addPodLabelBlockedReason(workload)}
        keyPlaceholder="app"
        valuePlaceholder="web"
        testId="sandbox-create-pod-labels"
        onAdd={() => applySandboxWorkload(model, addSandboxPodLabel(model.values.workload))}
        onRemove={(id) => applySandboxWorkload(model, removeSandboxPodLabel(model.values.workload, id))}
        onUpdate={(id, patch) => applySandboxWorkload(model, updateSandboxPodLabel(model.values.workload, id, patch))}
      />
    </CollapsibleSection>
  );
});

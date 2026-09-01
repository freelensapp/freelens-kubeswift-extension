/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Sandbox form (SPEC-0016, slice 2), Dialog A of that spec: the
// workload, the two expiries, the scratch disk, the GPU exclusivities and the
// checkout - which is the centre of the milestone, because one field,
// `spec.poolRef.name`, is the whole client-side protocol for claiming a warm
// slot, and nothing upstream checks that the claimant matches the pool it claims
// from.
//
// Every decision it renders belongs to `sandbox-create.ts`. What lives here is
// the host wiring, and it is the SPEC-0011 machinery unchanged for the eighth
// time: `ConfirmDialog.open` as the dialog host, a per-open MobX model outside
// React so the 409 reopen keeps the form, an observable `okButtonProps`, and a
// catch-never-rethrow submit.
//
// The shape's own controls are slice 1's, rendered against this model rather
// than copied: `SlotImageField`, `SlotShapeFields`, `SlotGpuProfileField`,
// `SlotPullSecretField`, `SlotVerifyKeyField` and `SlotModelFields` all take a
// `SandboxShapeOwner`, which this model satisfies. What is NOT shared is the
// grouping: this form spends four collapsed sections where the pool spends two,
// because A8 and A9 are two sections here and one there, and because a sandbox's
// GPU section is a three-way backend control that a checkout removes entirely.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftSandbox } from "../api/kubeswift/swiftsandbox-v1alpha1";
import { SwiftSandboxPool } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import {
  AddRowButton,
  CollapsibleSection,
  dialogReopenDelay,
  Field,
  FormRow,
  ObjectPickerField,
  QuantityField,
  WriteSummary,
} from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import { defaultNamespace } from "./guest-create";
import { quantityGrammar } from "./guestclass-create";
import { conflictStatusCode } from "./migration-create";
import {
  addArgvRow,
  addEnvRow,
  argvErrors,
  createSandboxTitle,
  defaultNetworkMode,
  defaultRootfsMode,
  defaultSandboxForm,
  defaultSandboxGpuRequestName,
  defaultSandboxGpuTier,
  defaultSlotCpu,
  defaultSlotMemory,
  envErrors,
  envFieldLabels,
  goDurationGrammar,
  imageEntrypointFact,
  nodeSelectorErrors,
  removeArgvRow,
  removeEnvRow,
  sandboxCreateFailureMessage,
  sandboxCreateFooter,
  sandboxCreatePayload,
  sandboxCreateSuccessMessage,
  sandboxCreateSummary,
  sandboxDerivedShape,
  sandboxFieldLabels,
  sandboxGpuBackendDescription,
  sandboxGpuBackendLabels,
  sandboxGpuBackends,
  sandboxGpuDroppedInCheckoutReason,
  sandboxGpuErrors,
  sandboxGpuFieldLabels,
  sandboxGpuSectionHasError,
  sandboxGpuSectionLine,
  sandboxGpuTiers,
  sandboxGpuWarnings,
  sandboxModelSectionHasError,
  sandboxModelSectionLine,
  sandboxNameWarning,
  sandboxNodeSelectorMergeFact,
  sandboxOwnErrors,
  sandboxOwnWarnings,
  sandboxPoolChoices,
  sandboxRegistrySectionLine,
  sandboxRootfsModes,
  sandboxScratchErrors,
  sandboxScratchFieldLabels,
  sandboxScratchSectionHasError,
  sandboxScratchSectionHint,
  sandboxScratchSourceDescription,
  sandboxScratchSourceLabels,
  sandboxScratchSources,
  sandboxScratchWarnings,
  sandboxShapeErrors,
  sandboxShapeIsAsked,
  sandboxSlotRefusalWording,
  sandboxSlotWarningWording,
  sandboxSourceDescription,
  sandboxSourceLabels,
  sandboxSources,
  sandboxSubmitBlockReason,
  scratchVolumeModeFact,
  setSandboxGpuBackend,
  setSandboxScratchSource,
  slotShapeWarnings,
  switchSandboxSource,
  updateArgvRow,
  updateEnvRow,
} from "./sandbox-create";
import {
  loadGpuProfiles,
  loadKernels,
  loadSecrets,
  SlotGpuProfileField,
  SlotImageField,
  SlotModelFields,
  SlotPullSecretField,
  SlotShapeFields,
  SlotVerifyKeyField,
  sandboxCreateInputs,
  updateSandboxShape,
} from "./sandbox-pool-create-dialog";

import type { ObjectPickerFacts } from "./create-dialog";
import type { GuestGpuProfileFacts } from "./guest-create";
import type { PickerFacts } from "./guest-create-dialog";
import type {
  ArgvList,
  ArgvRow,
  EnvRow,
  SandboxFormInputs,
  SandboxFormValues,
  SandboxGpuBackend,
  SandboxPoolFacts,
  SandboxPvcFacts,
  SandboxScratchSource,
  SandboxSource,
} from "./sandbox-create";
import type { SandboxShapeOwner, SlotShapeWording } from "./sandbox-pool-create-dialog";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, Input, NamespaceSelect, Notifications, Radio, RadioGroup, Select },
  K8sApi: { namespaceStore, pvcApi },
} = Renderer;

/**
 * What each shared control says on THIS form.
 *
 * The pool's wording is about a warm slot and about what a claimant inherits;
 * every sentence here is about the one microVM this dialog creates. The controls
 * themselves, their validation and their payload are slice 1's, unchanged.
 */
export const sandboxSlotShapeWording: SlotShapeWording = {
  imageHint:
    "The OCI image this sandbox boots as its root filesystem. A digest reference (repo@sha256:...) pins exactly what runs; a tag is accepted and resolved at materialize time.",
  cpuHint: `How many vCPUs the guest gets. Empty is ${defaultSlotCpu}, which the API server stamps, so nothing is sent for it.`,
  memoryLabel: "Memory",
  memoryHint: `The guest's RAM, which is also what its tmpfs rootfs overlay is bounded by. ${quantityGrammar} Empty is ${defaultSlotMemory}, which the API server stamps.`,
  rootfsHint: `How the OCI rootfs reaches the guest: block is a node-local read-only ext4 disk, virtiofs the unpacked tree. Both put a writable tmpfs overlay on top. Empty is ${defaultRootfsMode}, which the API server stamps.`,
  networkHint: `What the sandbox is allowed to reach. Empty is ${defaultNetworkMode}, which the API server stamps; none is the only mode that gets no NetworkPolicy at all, and it is also why the sandbox then has no address.`,
  kernelHint:
    "The SwiftKernel this sandbox boots. Empty means the well-known sandbox kernel, which is what the controller falls back to - or the gpu-sandbox one when a GPU is asked for below.",
  nodeSelectorHint: sandboxNodeSelectorMergeFact,
  pullSecretHint:
    "A docker-registry Secret of this namespace, for pulling the image from a private registry. An invalid one is a TERMINAL failure rather than a wait.",
  verifyKeyHint:
    "A Secret holding a cosign public key under cosign.pub. The rootfs is verified against it before it is materialized and the digest is then re-pinned to the verified one, so a tag cannot move between the check and the pull. It needs a TLS registry.",
  modelImageHint:
    "An OCI image whose filesystem holds the weights, mounted read-only over virtio-fs and materialized once per node, so they are resident before the workload runs.",
};

/** The form's state, for one opening of the dialog. */
export interface SandboxDialogModel extends SandboxShapeOwner {
  values: SandboxFormValues;
  /** The namespace's SwiftSandboxPools, for the checkout picker and the derivation. */
  pools: PickerFacts<SandboxPoolFacts>;
  /** When that read answered, because the derivation is a snapshot of a mutable object. */
  poolsReadAt?: string;
  /** The namespace's PersistentVolumeClaims, for the existing-claim branch (T3). */
  pvcs: PickerFacts<SandboxPvcFacts>;
  /** The four collapsed sections ship shut; these are what the user does about that. */
  scratchOpen: boolean;
  modelOpen: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function sandboxFormInputs(model: SandboxDialogModel): SandboxFormInputs {
  return {
    ...sandboxCreateInputs(model),
    pools: model.pools.items,
    poolsUnverified: model.pools.state === "unavailable",
    poolsReadAt: model.poolsReadAt,
    pvcs: model.pvcs.items,
    pvcsUnverified: model.pvcs.state === "unavailable",
  };
}

function syncOkButton(model: SandboxDialogModel): void {
  model.okButtonProps.disabled = Boolean(sandboxSubmitBlockReason(sandboxFormInputs(model), model.values));
}

/** A fresh model for one opening of the dialog, seeded from what the stores already hold. */
export function createSandboxDialogModel(
  namespace: string,
  seed: { existingNames?: string[] } = {},
): SandboxDialogModel {
  const model: SandboxDialogModel = Mobx.observable(
    {
      values: defaultSandboxForm(namespace),
      secrets: { state: "loading", names: [] } as ObjectPickerFacts,
      kernels: { state: "loading", names: [] } as ObjectPickerFacts,
      gpuProfiles: { state: "loading", items: [] } as PickerFacts<GuestGpuProfileFacts>,
      pools: { state: "loading", items: [] } as PickerFacts<SandboxPoolFacts>,
      poolsReadAt: undefined as string | undefined,
      pvcs: { state: "loading", items: [] } as PickerFacts<SandboxPvcFacts>,
      existingNames: seed.existingNames ?? [],
      existingNamesUnverified: false,
      // Collapsed, per the section's own rule (DESIGN.md section 12): every
      // field inside is optional and has a default the object would get anyway,
      // what each one changes is a consequence rather than a value the create
      // needs, and that consequence is on the header line whether the section is
      // open or shut.
      scratchOpen: false,
      gpuOpen: false,
      registryOpen: false,
      modelOpen: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
      onValuesChanged: () => syncOkButton(model),
    },
    { existingNames: Mobx.observable.ref, onValuesChanged: Mobx.observable.ref },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/** The one way the sandbox's own fields change, so the OK button can never drift. */
export const updateSandboxForm = Mobx.action(
  (model: SandboxDialogModel, patch: Partial<Omit<SandboxFormValues, "shape">>) => {
    Object.assign(model.values, patch);
    syncOkButton(model);
  },
);

/** The same, for the pure transformers that return a whole set of values. */
export const applySandboxForm = Mobx.action((model: SandboxDialogModel, next: SandboxFormValues) => {
  Object.assign(model.values, next);
  Object.assign(model.values.shape, next.shape);
  syncOkButton(model);
});

export const toggleSandboxFormSection = Mobx.action(
  (model: SandboxDialogModel, section: "scratchOpen" | "gpuOpen" | "registryOpen" | "modelOpen") => {
    model[section] = !model[section];
  },
);

/**
 * Moves the form to another namespace.
 *
 * Everything namespaced goes with it: the pool, the scratch claim, the kernel
 * and GPU profiles and the two Secrets all named objects of the previous
 * namespace and name nothing in this one, which is the stale-selection bug
 * upstream's own wizard carries across cluster switches.
 */
export const changeSandboxNamespace = Mobx.action((model: SandboxDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  model.values.pool = "";
  model.values.scratchClaim = "";
  Object.assign(model.values.shape, {
    kernelProfile: "",
    gpuProfile: "",
    imagePullSecret: "",
    verifyKeySecret: "",
  });
  model.secrets = { state: "loading", names: [] };
  model.kernels = { state: "loading", names: [] };
  model.gpuProfiles = { state: "loading", items: [] };
  model.pools = { state: "loading", items: [] };
  model.poolsReadAt = undefined;
  model.pvcs = { state: "loading", items: [] };
  model.existingNames = [];
  model.existingNamesUnverified = false;
  syncOkButton(model);

  void loadSandboxNamespacedObjects(model);
});

/** The six namespace reads on open. None is awaited, none can throw. */
export async function loadSandboxNamespacedObjects(model: SandboxDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([
    loadSecrets(model, namespace),
    loadKernels(model, namespace),
    loadGpuProfiles(model, namespace),
    loadSandboxPools(model, namespace),
    loadScratchClaims(model, namespace),
    loadSandboxNames(model, namespace),
  ]);
}

/**
 * The namespace's SwiftSandboxPools.
 *
 * The one read whose failure changes more than a control: the derivation of the
 * four "must match" fields depends on it, so a refusal degrades the picker to a
 * text input AND brings the four controls back, with the warning that says
 * nothing on the cluster will compare them either (T3, one level further than
 * anywhere else on this form).
 */
export async function loadSandboxPools(model: SandboxDialogModel, namespace: string): Promise<void> {
  try {
    const pools = await SwiftSandboxPool.getStore<SwiftSandboxPool>().api.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.pools = {
        state: "ready",
        items: (pools ?? []).map((pool) => ({
          name: pool.getName(),
          phase: pool.status?.phase,
          warm: pool.status?.warmReplicas,
          claimed: pool.status?.claimedReplicas,
          image: pool.spec?.image,
          cpu: pool.spec?.cpu,
          memory: pool.spec?.memory,
          rootfsMode: pool.spec?.rootfsMode,
        })),
      };
      // The derivation is a snapshot of an object nothing makes immutable, so
      // the moment it was taken travels with it into the summary.
      model.poolsReadAt = new Date().toLocaleTimeString();
      model.onValuesChanged();
    });
  } catch {
    Mobx.runInAction(() => {
      model.pools = { state: "unavailable", items: [] };
      model.poolsReadAt = undefined;
      model.onValuesChanged();
    });
  }
}

/** The namespace's PersistentVolumeClaims, through the host's own `pvcApi`. */
export async function loadScratchClaims(model: SandboxDialogModel, namespace: string): Promise<void> {
  try {
    const claims = await pvcApi.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.pvcs = {
        state: "ready",
        items: (claims ?? []).map((claim) => ({
          name: claim.getName(),
          volumeMode: claim.spec?.volumeMode,
          phase: claim.status?.phase,
          storageClassName: claim.spec?.storageClassName,
        })),
      };
      model.onValuesChanged();
    });
  } catch {
    Mobx.runInAction(() => {
      model.pvcs = { state: "unavailable", items: [] };
      model.onValuesChanged();
    });
  }
}

/** The namespace's SwiftSandbox names, for the collision warning that never blocks. */
export async function loadSandboxNames(model: SandboxDialogModel, namespace: string): Promise<void> {
  try {
    const sandboxes = await SwiftSandbox.getStore<SwiftSandbox>().api.list({ namespace });

    Mobx.runInAction(() => {
      model.existingNames = (sandboxes ?? []).map((sandbox) => sandbox.getName());
      model.existingNamesUnverified = false;
      syncOkButton(model);
    });
  } catch {
    Mobx.runInAction(() => {
      // A refused read makes the name UNVERIFIABLE rather than free: an empty
      // list nobody was allowed to fetch is never "the name is available".
      model.existingNamesUnverified = true;
      syncOkButton(model);
    });
  }
}

/** Whether a picker over labelled options can be a picker at all (spike T3, one level up). */
function poolPickerIsUsable(facts: PickerFacts<SandboxPoolFacts>, value: string): boolean {
  if (facts.state !== "ready" || facts.items.length === 0) {
    return false;
  }

  return value === "" || facts.items.some((item) => item.name === value);
}

// ---------------------------------------------------------------------------
// A1: identity.
// ---------------------------------------------------------------------------

/** The namespace: the host's own control, in the light theme the white box requires. */
const SandboxNamespaceField = observer(({ model }: { model: SandboxDialogModel }) => (
  <Field
    label={sandboxFieldLabels.namespace}
    hint="The sandbox, its launcher Pod, its scratch claim and every Secret, kernel, GPU profile and pool it names all live here - each of those references is namespace-local."
    error={sandboxOwnErrors(model.values).namespace}
  >
    <NamespaceSelect
      id="sandbox-create-namespace"
      themeName="light"
      menuClass={styles.selectMenu}
      value={model.values.namespace || null}
      onChange={(option: { value: string } | null) => changeSandboxNamespace(model, option?.value ?? "")}
    />
  </Field>
));

/** The sandbox's name, which becomes the launcher Pod's name exactly. */
const SandboxNameField = observer(({ model }: { model: SandboxDialogModel }) => (
  <Field
    label={sandboxFieldLabels.name}
    hint="Lowercase letters, digits, '-' and '.'. The launcher Pod is named after it exactly, and a blank scratch disk adds a claim named <name>-scratch, which is what shortens the budget to 245."
    error={sandboxOwnErrors(model.values).name}
    warning={sandboxNameWarning(sandboxFormInputs(model), model.values)}
  >
    <Input
      value={model.values.name}
      placeholder="build-cache-warmer"
      data-testid="sandbox-create-name"
      onChange={(value: string) => updateSandboxForm(model, { name: value })}
    />
  </Field>
));

// ---------------------------------------------------------------------------
// A2: the two modes, and the derivation.
// ---------------------------------------------------------------------------

/**
 * The source: a radio per mode, each with what choosing it does.
 *
 * The host has no segmented control and DESIGN.md's first pillar forbids
 * inventing one; the Restore dialog's mode radios and the Create Guest form's
 * boot source are the precedent this repository already ships.
 */
const SandboxSourceField = observer(({ model }: { model: SandboxDialogModel }) => (
  <div className={styles.field} data-testid="sandbox-create-source">
    <div className={styles.label}>Source</div>
    <RadioGroup
      className={styles.options}
      value={model.values.source}
      onChange={(source: SandboxSource) => applySandboxForm(model, switchSandboxSource(model.values, source))}
    >
      {sandboxSources.map((source) => (
        <Radio
          key={source}
          value={source}
          label={
            <>
              {/* The host's `Radio` takes no test id of its own, so the form
                  puts one on the span inside the label - the idiom every radio
                  group of this repository uses. */}
              <span data-testid={`sandbox-create-source-${source}`}>{sandboxSourceLabels[source]}</span>
              <div className={styles.optionReason}>{sandboxSourceDescription(source)}</div>
            </>
          }
        />
      ))}
    </RadioGroup>
  </div>
));

/** The pool a checkout claims from, scoped to the sandbox's OWN namespace (S4). */
const SandboxPoolField = observer(({ model }: { model: SandboxDialogModel }) => {
  const inputs = sandboxFormInputs(model);
  const choices = sandboxPoolChoices(inputs);
  const error = sandboxOwnErrors(model.values).pool;
  const warning = sandboxOwnWarnings(inputs, model.values).pool;
  const hint =
    "A SwiftSandboxPool of this namespace - poolRef is a local reference, so a pool anywhere else cannot be claimed from. Every option carries its phase and its warm and claimed counts, and none of them is disabled: a cold or empty pool is a slower start, never an error.";

  if (poolPickerIsUsable(model.pools, model.values.pool)) {
    return (
      <Field label={sandboxFieldLabels.pool} hint={hint} error={error} warning={warning}>
        <Select
          id="sandbox-create-pool"
          themeName="light"
          menuClass={styles.selectMenu}
          isClearable
          placeholder="Pick a SwiftSandboxPool"
          value={model.values.pool || null}
          options={choices.map((choice) => ({ value: choice.name, label: choice.label }))}
          onChange={(option: { value: string } | null) => updateSandboxForm(model, { pool: option?.value ?? "" })}
        />
      </Field>
    );
  }

  return (
    <Field
      label={sandboxFieldLabels.pool}
      hint={
        model.pools.state === "unavailable"
          ? "The SwiftSandboxPools of this namespace could not be listed, so the name is not verified and the pool's own shape could not be read - the four fields it would have supplied are asked for below instead."
          : model.pools.state === "ready"
            ? `${hint} This namespace holds no SwiftSandboxPool yet, so the name has to be typed.`
            : hint
      }
      error={error}
      warning={warning}
    >
      <Input
        value={model.values.pool}
        placeholder="the name of a SwiftSandboxPool"
        data-testid="sandbox-create-pool-input"
        onChange={(value: string) => updateSandboxForm(model, { pool: value })}
      />
    </Field>
  );
});

/**
 * The four fields the pool decides, rendered as facts rather than as controls
 * (S3, and the other half of open item O4).
 *
 * Four schema descriptions say a claimant must match the pool on exactly these,
 * and nothing anywhere compares them - so they are read from the pool and sent
 * from it, which makes the mismatch inexpressible instead of validated. Upstream
 * prefills the image and leaves it editable, which is the trap itself.
 */
const SandboxDerivedShapeFacts = observer(({ model }: { model: SandboxDialogModel }) => {
  const derived = sandboxDerivedShape(sandboxFormInputs(model), model.values);

  if (derived.source !== "pool") {
    return null;
  }

  const rows: { label: string; value: string }[] = [
    { label: "Image", value: derived.image },
    { label: "vCPUs", value: derived.cpu },
    { label: "Memory", value: derived.memory },
    { label: "Root filesystem", value: derived.rootfsMode },
  ];

  return (
    <div className={styles.field} data-testid="sandbox-create-derived-shape">
      <div className={styles.label}>Slot shape, read from the pool</div>
      <dl className={styles.facts}>
        {rows.flatMap((row) => [
          <dt className={styles.factLabel} key={`${row.label}-label`}>
            {row.label}
          </dt>,
          <dd className={styles.factValue} key={`${row.label}-value`}>
            {row.value}
          </dd>,
        ])}
      </dl>
      <div className={styles.hint}>
        {`Read from ${model.values.pool.trim()} ${derived.readAt ? `at ${derived.readAt}` : "as this dialog opened"} and SENT from it. These are the four upstream documents a claimant as having to match, and the four nothing on the cluster ever compares - a mismatched image silently runs this workload inside the pool image's rootfs, which is why they are not editable here. A different shape is what the other mode is for.`}
      </div>
      <div className={styles.hint}>
        The network mode, the kernel profile and the node selector are not asked for on a checkout either: the slot is
        already booted and already placed, and the documented match set is these four alone. The YAML editor is the
        escape hatch if a claim ever needs more.
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// A3: the workload.
// ---------------------------------------------------------------------------

/**
 * One argv list, one row per element.
 *
 * The whole point of the shape: upstream splits a command on whitespace, so a
 * quoted argument arrives at the guest in pieces and nothing says it happened.
 * One row is one argv element, which makes that inexpressible rather than
 * validated.
 */
const ArgvSection = observer(({ model, list }: { model: SandboxDialogModel; list: ArgvList }) => {
  const rows = model.values[list];
  const messages = argvErrors(rows, list);
  const command = list === "command";

  return (
    <div className={styles.field} data-testid={`sandbox-create-${list}`}>
      <div className={styles.label}>{command ? "Command" : "Arguments"}</div>
      <div className={styles.hint}>
        {command
          ? "Overrides the image's entrypoint, one argv element per row - nothing is ever split on whitespace, so a quoted argument stays one argument. Leave it empty to run the image's own Entrypoint and Cmd."
          : "Appended to the command, or to the image's own entrypoint when there is no command. One argv element per row."}
      </div>

      {rows.map((row, index) => (
        <ArgvFields key={row.id} model={model} list={list} row={row} index={index} error={messages[index]?.value} />
      ))}

      <AddRowButton
        label={command ? "Add a command element" : "Add an argument"}
        onAdd={() => applySandboxForm(model, addArgvRow(model.values, list))}
        testId={`sandbox-create-add-${list}`}
      />
    </div>
  );
});

/** One argv element, which is one text input and its own removal control. */
const ArgvFields = observer(
  ({
    model,
    list,
    row,
    index,
    error,
  }: {
    model: SandboxDialogModel;
    list: ArgvList;
    row: ArgvRow;
    index: number;
    error?: string;
  }) => {
    const prefix = `sandbox-create-${list}-${index}`;

    return (
      <FormRow
        title={`${list === "command" ? "Command" : "Argument"} ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxForm(model, removeArgvRow(model.values, list, row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field label="Value" error={error}>
          <Input
            value={row.value}
            placeholder={list === "command" ? "/bin/sh" : "--verbose"}
            data-testid={`${prefix}-value`}
            onChange={(value: string) => applySandboxForm(model, updateArgvRow(model.values, list, row.id, value))}
          />
        </Field>
      </FormRow>
    );
  },
);

/** The working directory, which overrides the image config's own. */
const WorkingDirField = observer(({ model }: { model: SandboxDialogModel }) => (
  <Field
    label={sandboxFieldLabels.workingDir}
    hint="Overrides the image config's working directory. Empty uses the image's own."
  >
    <Input
      value={model.values.workingDir}
      placeholder="/workspace"
      data-testid="sandbox-create-working-dir"
      onChange={(value: string) => updateSandboxForm(model, { workingDir: value })}
    />
  </Field>
));

/**
 * The environment, as literal values only.
 *
 * `valueFrom` is schema-complete and behaviourally ignored - the merge takes the
 * literal value, because a microVM has no downward-API and no Secret path - so a
 * `secretKeyRef` variable reaches the guest EMPTY. The control is not offered
 * and the fact stands in its place (W12 option dropping); the footer says it
 * again with the reason.
 */
const EnvSection = observer(({ model }: { model: SandboxDialogModel }) => {
  const messages = envErrors(model.values);

  return (
    <div className={styles.field} data-testid="sandbox-create-env">
      <div className={styles.label}>Environment</div>
      <div className={styles.hint}>
        Merged over the image config's own environment. Literal values only: env[].valueFrom is declared in the schema
        and IGNORED by the controller, which takes the literal value, so a secretKeyRef variable would reach the guest
        empty.
      </div>

      {model.values.env.map((row, index) => (
        <EnvFields key={row.id} model={model} row={row} index={index} messages={messages[index] ?? {}} />
      ))}

      <AddRowButton
        label="Add a variable"
        onAdd={() => applySandboxForm(model, addEnvRow(model.values))}
        testId="sandbox-create-add-env"
      />
    </div>
  );
});

/** One environment variable: a name and a literal value. */
const EnvFields = observer(
  ({
    model,
    row,
    index,
    messages,
  }: {
    model: SandboxDialogModel;
    row: EnvRow;
    index: number;
    messages: Partial<Record<"name" | "value", string>>;
  }) => {
    const prefix = `sandbox-create-env-${index}`;
    const update = (patch: Partial<EnvRow>) => applySandboxForm(model, updateEnvRow(model.values, row.id, patch));

    return (
      <FormRow
        title={`Variable ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxForm(model, removeEnvRow(model.values, row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field label={envFieldLabels.name} error={messages.name}>
          <Input
            value={row.name}
            placeholder="SANDBOX_MODE"
            data-testid={`${prefix}-name`}
            onChange={(value: string) => update({ name: value })}
          />
        </Field>

        <Field label={envFieldLabels.value} hint="Empty is a real value: the variable is set and it is empty.">
          <Input
            value={row.value}
            placeholder="fast"
            data-testid={`${prefix}-value`}
            onChange={(value: string) => update({ value })}
          />
        </Field>
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// A5: the scratch disk, whose three-way control is what makes `{}` unbuildable.
// ---------------------------------------------------------------------------

const ScratchDiskSection = observer(({ model }: { model: SandboxDialogModel }) => {
  const inputs = sandboxFormInputs(model);
  const errors = sandboxScratchErrors(model.values);
  const warnings = sandboxScratchWarnings(inputs, model.values);

  return (
    <CollapsibleSection
      title="Scratch disk"
      hint={sandboxScratchSectionHint(model.values)}
      open={model.scratchOpen || sandboxScratchSectionHasError(model.values)}
      onToggle={() => toggleSandboxFormSection(model, "scratchOpen")}
      testId="sandbox-create-scratch-section"
    >
      <div className={styles.field} data-testid="sandbox-create-scratch-source">
        <div className={styles.label}>Source</div>
        <RadioGroup
          className={styles.options}
          value={model.values.scratchSource}
          onChange={(source: SandboxScratchSource) =>
            applySandboxForm(model, setSandboxScratchSource(model.values, source))
          }
        >
          {sandboxScratchSources.map((source) => (
            <Radio
              key={source}
              value={source}
              label={
                <>
                  <span data-testid={`sandbox-create-scratch-source-${source}`}>
                    {sandboxScratchSourceLabels[source]}
                  </span>
                  <div className={styles.optionReason}>{sandboxScratchSourceDescription(source)}</div>
                </>
              }
            />
          ))}
        </RadioGroup>
        {/* Three options rather than a checkbox and two fields: `scratchDisk: {}`
            makes the controller dereference a nil pointer, and a control that
            cannot express it is stronger than a rule that refuses it (S7). */}
        <div className={styles.hint}>{scratchVolumeModeFact}</div>
      </div>

      {model.values.scratchSource === "blank" ? (
        <>
          <QuantityField
            label={sandboxScratchFieldLabels.size}
            hint={`How large the new claim is. ${quantityGrammar} The schema requires it and sets no minimum, so a zero would be stored and then fail at the PVC create, with the sandbox parked on Binding forever.`}
            placeholder="100Gi"
            testId="sandbox-create-scratch-size"
            value={model.values.scratchSize}
            error={errors.size}
            onChange={(value: string) => updateSandboxForm(model, { scratchSize: value })}
          />

          <Field
            label={sandboxScratchFieldLabels.storageClass}
            hint="Which StorageClass provisions the claim. Empty uses the cluster's default class."
            error={errors.storageClass}
          >
            <Input
              value={model.values.scratchStorageClass}
              placeholder="the cluster's default class"
              data-testid="sandbox-create-scratch-storage-class"
              onChange={(value: string) => updateSandboxForm(model, { scratchStorageClass: value })}
            />
          </Field>
        </>
      ) : null}

      {model.values.scratchSource === "existing" ? (
        <ObjectPickerField
          id="sandbox-create-scratch-claim"
          inputTestId="sandbox-create-scratch-claim-input"
          label={sandboxScratchFieldLabels.claim}
          hint="An existing PersistentVolumeClaim of this namespace. It has to be a Block claim - the disk is attached as a raw device - and it has to be Bound before the sandbox stops waiting."
          unverifiedHint="The PersistentVolumeClaims of this namespace could not be listed, so neither the name nor its volume mode is verified."
          placeholder="Pick a claim"
          value={model.values.scratchClaim}
          facts={{
            state: model.pvcs.state,
            names: model.pvcs.items.map((claim) => claim.name),
          }}
          error={errors.claim}
          warning={warnings.claim}
          onChange={(value: string) => updateSandboxForm(model, { scratchClaim: value })}
        />
      ) : null}
    </CollapsibleSection>
  );
});

// ---------------------------------------------------------------------------
// A6: the GPU, which a checkout removes entirely.
// ---------------------------------------------------------------------------

const SandboxGpuSection = observer(({ model }: { model: SandboxDialogModel }) => {
  const inputs = sandboxFormInputs(model);
  const errors = sandboxGpuErrors(model.values);
  const warnings = sandboxGpuWarnings(inputs, model.values);

  // Option dropping (W12): a GPU and a pool are mutually exclusive in two
  // webhook rules that ship disabled, and with the webhook off the checkout
  // runs first and the GPU request is silently ignored. The section is
  // replaced by the reason rather than rendered and ignored.
  if (model.values.source === "checkout") {
    return (
      <Field label="GPU">
        <div className={styles.hint} data-testid="sandbox-create-gpu-dropped">
          {sandboxGpuDroppedInCheckoutReason}
        </div>
      </Field>
    );
  }

  return (
    <CollapsibleSection
      title="GPU"
      hint={sandboxGpuSectionLine(model.values)}
      open={model.gpuOpen || sandboxGpuSectionHasError(model.values)}
      onToggle={() => toggleSandboxFormSection(model, "gpuOpen")}
      testId="sandbox-create-gpu-section"
    >
      <div className={styles.field} data-testid="sandbox-create-gpu-backend">
        <div className={styles.label}>Allocation backend</div>
        <RadioGroup
          className={styles.options}
          value={model.values.gpuBackend}
          onChange={(backend: SandboxGpuBackend) =>
            applySandboxForm(model, setSandboxGpuBackend(model.values, backend))
          }
        >
          {sandboxGpuBackends.map((backend) => (
            <Radio
              key={backend}
              value={backend}
              label={
                <>
                  <span data-testid={`sandbox-create-gpu-backend-${backend}`}>{sandboxGpuBackendLabels[backend]}</span>
                  <div className={styles.optionReason}>{sandboxGpuBackendDescription(backend)}</div>
                </>
              }
            />
          ))}
        </RadioGroup>
      </div>

      {/* The parks-forever expectation is NOT repeated inside the section: its
          own header line carries it, and that line is visible whether the
          section is open or shut. The summary states it once more, below the
          fold, as it does for every will-wait line of this repository's forms. */}
      {model.values.gpuBackend === "profile" ? (
        <SlotGpuProfileField model={model} error={errors.profile} warning={warnings.profile} />
      ) : null}
      {model.values.gpuBackend === "dra" ? <SandboxGpuClaimFields model={model} /> : null}
    </CollapsibleSection>
  );
});

/** The DRA backend: a shared claim or a template, and never both. */
const SandboxGpuClaimFields = observer(({ model }: { model: SandboxDialogModel }) => {
  const errors = sandboxGpuErrors(model.values);
  const update = (patch: Partial<SandboxFormValues>) => updateSandboxForm(model, patch);

  return (
    <>
      <Field
        label={sandboxGpuFieldLabels.claimName}
        hint="A ResourceClaim that already exists and is shared. Exactly one of this and the template below."
        error={errors.claimName}
      >
        <Input
          value={model.values.gpuClaimName}
          placeholder="the name of a ResourceClaim"
          data-testid="sandbox-create-gpu-claim"
          onChange={(value: string) => update({ gpuClaimName: value })}
        />
      </Field>

      <Field
        label={sandboxGpuFieldLabels.claimTemplateName}
        hint="A ResourceClaimTemplate the scheduler mints a claim of this sandbox's own from."
        error={errors.claimTemplateName}
      >
        <Input
          value={model.values.gpuClaimTemplateName}
          placeholder="the name of a ResourceClaimTemplate"
          data-testid="sandbox-create-gpu-claim-template"
          onChange={(value: string) => update({ gpuClaimTemplateName: value })}
        />
      </Field>

      <Field
        label={sandboxGpuFieldLabels.requestName}
        hint={`Which device request inside the claim the allocation is read back from. Empty is ${defaultSandboxGpuRequestName}, which the controller falls back to.`}
        error={errors.requestName}
      >
        <Input
          value={model.values.gpuRequestName}
          placeholder={`${defaultSandboxGpuRequestName} (the controller's own fallback)`}
          data-testid="sandbox-create-gpu-request"
          onChange={(value: string) => update({ gpuRequestName: value })}
        />
      </Field>

      <Field
        label="Tier"
        hint={`The hypervisor and firmware the GPU is passed through with: pcie is Cloud Hypervisor, both HGX tiers are QEMU. Empty is ${defaultSandboxGpuTier}, which the API server stamps.`}
      >
        <Select
          id="sandbox-create-gpu-tier"
          themeName="light"
          menuClass={styles.selectMenu}
          isClearable
          placeholder={`${defaultSandboxGpuTier} (the schema's default)`}
          value={model.values.gpuTier || null}
          options={sandboxGpuTiers.map((tier) => ({ value: tier, label: tier }))}
          onChange={(option: { value: string } | null) => update({ gpuTier: option?.value ?? "" })}
        />
      </Field>
    </>
  );
});

// ---------------------------------------------------------------------------
// A7: the two expiries.
// ---------------------------------------------------------------------------

const LifecycleFields = observer(({ model }: { model: SandboxDialogModel }) => {
  const errors = sandboxOwnErrors(model.values);

  return (
    <>
      <Field
        label={sandboxFieldLabels.timeout}
        hint={`The wall-clock run cap, measured from startedAt. Past it the controller force-terminates the launcher or the claimed slot and marks the sandbox Failed with a deadline reason; the object itself stays behind. Empty is no cap at all. ${goDurationGrammar}`}
        error={errors.timeout}
      >
        <Input
          value={model.values.timeout}
          placeholder="30m"
          data-testid="sandbox-create-timeout"
          onChange={(value: string) => updateSandboxForm(model, { timeout: value })}
        />
      </Field>

      <Field
        label={sandboxFieldLabels.ttl}
        hint="How long a terminal sandbox is kept. Once it has been Completed or Failed for this long the controller DELETES the SwiftSandbox object itself - not just its pod - so its exit code, message and conditions go with it. Empty keeps it until it is deleted by hand."
        error={errors.ttl}
      >
        <Input
          value={model.values.ttl}
          placeholder="1h"
          data-testid="sandbox-create-ttl"
          onChange={(value: string) => updateSandboxForm(model, { ttl: value })}
        />
      </Field>
    </>
  );
});

// ---------------------------------------------------------------------------
// A8 and A9: the two collapsed tails, whose fields are slice 1's.
// ---------------------------------------------------------------------------

const SandboxRegistrySection = observer(({ model }: { model: SandboxDialogModel }) => {
  const warnings = slotShapeWarnings(sandboxFormInputs(model), model.values.shape, sandboxSlotWarningWording);

  return (
    <CollapsibleSection
      title="Registry and verification"
      hint={sandboxRegistrySectionLine(model.values.shape)}
      open={model.registryOpen}
      onToggle={() => toggleSandboxFormSection(model, "registryOpen")}
      testId="sandbox-create-registry-section"
    >
      <SlotPullSecretField model={model} wording={sandboxSlotShapeWording} warning={warnings.imagePullSecret} />
      <SlotVerifyKeyField model={model} wording={sandboxSlotShapeWording} warning={warnings.verifyKeySecret} />
    </CollapsibleSection>
  );
});

const SandboxModelSection = observer(({ model }: { model: SandboxDialogModel }) => (
  <CollapsibleSection
    title="Model"
    hint={sandboxModelSectionLine(model.values.shape)}
    open={model.modelOpen || sandboxModelSectionHasError(sandboxFormInputs(model), model.values)}
    onToggle={() => toggleSandboxFormSection(model, "modelOpen")}
    testId="sandbox-create-model-section"
  >
    <SlotModelFields
      model={model}
      wording={sandboxSlotShapeWording}
      mountPathError={sandboxShapeErrors(sandboxFormInputs(model), model.values).modelMountPath}
    />
  </CollapsibleSection>
));

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const SandboxWriteSummary = observer(({ model }: { model: SandboxDialogModel }) => (
  <WriteSummary facts={sandboxCreateSummary(sandboxFormInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const SandboxCreateForm = observer(({ model }: { model: SandboxDialogModel }) => {
  const inputs = sandboxFormInputs(model);
  const blocked = sandboxSubmitBlockReason(inputs, model.values);
  const asked = sandboxShapeIsAsked(inputs, model.values);
  const checkout = model.values.source === "checkout";

  return (
    <div className={styles.form} data-testid="swiftsandbox-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftSandbox</b>
      </p>

      <SandboxNamespaceField model={model} />
      <SandboxNameField model={model} />

      <SandboxSourceField model={model} />
      {checkout ? <SandboxPoolField model={model} /> : null}
      {checkout ? <SandboxDerivedShapeFacts model={model} /> : null}

      <p className={styles.subject}>
        {"What it "}
        <b>runs</b>
      </p>

      <ArgvSection model={model} list="command" />
      {model.values.command.length === 0 ? <p className={styles.hint}>{imageEntrypointFact}</p> : null}
      <ArgvSection model={model} list="args" />
      <WorkingDirField model={model} />
      <EnvSection model={model} />

      {/* A4 is asked for on the cold path, and on a checkout whose pool could
          not be read - where the four fields it would have supplied come back
          as controls with the warning that nothing will compare them. */}
      {asked ? (
        <>
          <p className={styles.subject}>
            {"The "}
            <b>microVM</b>
            {" it runs in"}
          </p>
          <SlotImageField
            model={model}
            wording={sandboxSlotShapeWording}
            error={sandboxShapeErrors(inputs, model.values).image}
          />
        </>
      ) : null}
      {asked && !checkout ? (
        <SlotShapeFields
          model={model}
          wording={sandboxSlotShapeWording}
          errors={sandboxShapeErrors(inputs, model.values)}
          warnings={slotShapeWarnings(inputs, model.values.shape, sandboxSlotWarningWording)}
          nodeSelectorMessages={nodeSelectorErrors(model.values.shape, sandboxSlotRefusalWording)}
        />
      ) : null}
      {asked && checkout ? <SandboxDegradedShapeFields model={model} /> : null}

      <LifecycleFields model={model} />

      <ScratchDiskSection model={model} />
      <SandboxGpuSection model={model} />
      <SandboxRegistrySection model={model} />
      <SandboxModelSection model={model} />

      <SandboxWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="sandbox-create-submit-blocked">
          {`${createSandboxTitle} is disabled - ${blocked}`}
        </p>
      ) : null}

      <p className={styles.footer} data-testid="sandbox-create-footer">
        {sandboxCreateFooter}
      </p>
    </div>
  );
});

/**
 * The three sizing fields a checkout asks for when the pool could not be read.
 *
 * The kernel profile, the network mode and the node selector stay dropped even
 * here: they are not part of the documented match set, and asking for them
 * because one read failed would be inventing a requirement (O4).
 */
const SandboxDegradedShapeFields = observer(({ model }: { model: SandboxDialogModel }) => {
  const inputs = sandboxFormInputs(model);
  const errors = sandboxShapeErrors(inputs, model.values);
  const warnings = slotShapeWarnings(inputs, model.values.shape, sandboxSlotWarningWording);

  return (
    <>
      <Field label="vCPUs" hint={sandboxSlotShapeWording.cpuHint} error={errors.cpu}>
        <Input
          value={model.values.shape.cpu}
          placeholder={`${defaultSlotCpu} (the schema's default)`}
          data-testid="sandbox-create-cpu"
          onChange={(value: string) => updateSandboxShape(model, { cpu: value })}
        />
      </Field>

      <QuantityField
        label={sandboxSlotShapeWording.memoryLabel}
        hint={sandboxSlotShapeWording.memoryHint}
        placeholder={`${defaultSlotMemory} (the schema's default)`}
        testId="sandbox-create-memory"
        value={model.values.shape.memory}
        error={errors.memory}
        warning={warnings.memory}
        onChange={(value: string) => updateSandboxShape(model, { memory: value })}
      />

      <Field label="Root filesystem" hint={sandboxSlotShapeWording.rootfsHint}>
        <Select
          id="sandbox-create-rootfs-mode"
          themeName="light"
          menuClass={styles.selectMenu}
          isClearable
          placeholder={`${defaultRootfsMode} (the schema's default)`}
          value={model.values.shape.rootfsMode || null}
          options={sandboxRootfsModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(option: { value: string } | null) =>
            updateSandboxShape(model, { rootfsMode: option?.value ?? "" })
          }
        />
      </Field>
    </>
  );
});

/**
 * Performs the create, reports the outcome, and keeps the form when the name was
 * the problem.
 *
 * Nothing is ever rethrown, for the reason the seven dialogs before it do not:
 * `ConfirmDialog.ok` closes the dialog in a `finally` on both outcomes, and a
 * rethrown `JsonApiErrorParsed` additionally triggers the host's own "Unknown
 * error occurred while ok-ing" toast.
 */
async function submitSandbox(model: SandboxDialogModel, params: Renderer.Component.ConfirmDialogParams): Promise<void> {
  const inputs = sandboxFormInputs(model);
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  // Not zero: reopening inside the host's own 100ms leave animation leaves the
  // dialog at `opacity: 0` forever (the mechanism is on `dialogReopenDelay`).
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), dialogReopenDelay);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = sandboxSubmitBlockReason(inputs, model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftSandbox.getStore<SwiftSandbox>().create({ name, namespace }, sandboxCreatePayload(inputs, model.values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4) - and 403 is the expected failure here, since upstream's own
    // RBAC presets grant read only on both sandbox kinds.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        sandboxCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftSandbox ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(sandboxCreateSuccessMessage(namespace, name));
}

/** Opens the dialog for one model, keeping the params so the 409 path can reopen it. */
export function openSandboxCreateDialog(model: SandboxDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createSandboxTitle,
    // No icon, as in the seven dialogs before it: the host's default is a
    // warning triangle, and a create commits resources without destroying
    // anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <SandboxCreateForm model={model} />,
    ok: () => submitSandbox(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Sandboxes page's create control calls. */
export function openCreateSandboxDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createSandboxDialogModel(namespace, { existingNames: storedSandboxNames(namespace) });

  void loadSandboxNamespacedObjects(model);

  openSandboxCreateDialog(model);
}

/** The namespace's sandboxes as the store already holds them: free, and usually right. */
function storedSandboxNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftSandbox.getStore<SwiftSandbox>());

  return (store?.items ?? []).filter((sandbox) => sandbox.getNs() === namespace).map((sandbox) => sandbox.getName());
}

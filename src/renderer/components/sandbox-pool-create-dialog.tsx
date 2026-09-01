/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Sandbox Pool form (SPEC-0016, slice 1), Dialog B of that spec:
// fourteen flat fields, two collapsed sections, and no admission webhook
// anywhere behind it - which is why every refusal it makes is the only one an
// operator will ever see.
//
// Every decision it renders belongs to `sandbox-create.ts`. What lives here is
// the host wiring, and it is the SPEC-0011 machinery unchanged for the seventh
// time: `ConfirmDialog.open` as the dialog host, a per-open MobX model outside
// React so the 409 reopen keeps the form, an observable `okButtonProps`, and a
// catch-never-rethrow submit.
//
// The section components below take a `SandboxShapeOwner` rather than this
// dialog's own model, for the reason SPEC-0015's values-owner extraction exists:
// slice 2's Create Sandbox form renders the SAME slot-shape section - the image,
// the sizing, the GPU and the registry/model blocks - against a model of its
// own, and a second copy of them would drift at the next field the sandbox CRDs
// gain. `SandboxPoolFormValues` and slice 2's own values both carry a
// `namespace` and a `shape`, which is all the owner reads of them.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftKernel } from "../api/kubeswift/swiftkernel-v1alpha1";
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
  addNodeSelectorRow,
  createSandboxPoolTitle,
  defaultMinWarm,
  defaultModelMountPath,
  defaultNetworkMode,
  defaultRootfsMode,
  defaultSandboxPoolForm,
  defaultSlotCpu,
  defaultSlotMemory,
  maxWarmZeroFact,
  minWarmScalePathFact,
  minWarmZeroFact,
  nodeSelectorErrors,
  nodeSelectorMergeFact,
  removeNodeSelectorRow,
  sandboxGpuProfileChoices,
  sandboxGpuSectionHint,
  sandboxNetworkModes,
  sandboxPoolCreateFailureMessage,
  sandboxPoolCreatePayload,
  sandboxPoolCreateSuccessMessage,
  sandboxPoolCreateSummary,
  sandboxPoolFieldLabels,
  sandboxPoolFooter,
  sandboxPoolNameWarning,
  sandboxPoolOwnErrors,
  sandboxPoolSubmitBlockReason,
  sandboxRegistrySectionHint,
  sandboxRootfsModes,
  slotGpuSectionHasError,
  slotRegistrySectionHasError,
  slotShapeErrors,
  slotShapeWarnings,
  updateNodeSelectorRow,
} from "./sandbox-create";

import type { ObjectPickerFacts } from "./create-dialog";
import type { GuestGpuProfileFacts } from "./guest-create";
import type { PickerFacts } from "./guest-create-dialog";
import type {
  NodeSelectorMessages,
  NodeSelectorRow,
  SandboxCreateInputs,
  SandboxPoolFormValues,
  SlotShapeMessages,
  SlotShapeValues,
} from "./sandbox-create";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, Input, NamespaceSelect, Notifications, Select },
  K8sApi: { namespaceStore, secretsApi },
} = Renderer;

/**
 * What the slot-shape sections need of the form they are rendered inside.
 *
 * Slice 2's Create Sandbox dialog model satisfies exactly this and adds its own
 * workload, scratch disk, expiries and checkout beside it; the derivation from a
 * picked pool is a transformation of `values.shape` and needs nothing more from
 * this interface than it already carries.
 */
export interface SandboxShapeOwner {
  /** The section reads exactly two things of the values: the namespace and the shape. */
  values: { namespace: string; shape: SlotShapeValues };
  /** The namespace's Secrets, for the pull-secret and verify-key pickers (T3). */
  secrets: ObjectPickerFacts;
  /** The namespace's SwiftKernels, for the kernel-profile picker. */
  kernels: ObjectPickerFacts;
  /** The namespace's SwiftGPUProfiles, whose tier is what the GPU refusal reads. */
  gpuProfiles: PickerFacts<GuestGpuProfileFacts>;
  /** The namespace's existing names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
  /** The two collapsed sections ship shut; these are what the user does about that. */
  gpuOpen: boolean;
  registryOpen: boolean;
  /** Run inside the action that changed the values, so the submit verdict cannot drift. */
  onValuesChanged: () => void;
}

/** The form's state, for one opening of the dialog. */
export interface SandboxPoolDialogModel extends SandboxShapeOwner {
  values: SandboxPoolFormValues;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function sandboxCreateInputs(model: SandboxShapeOwner): SandboxCreateInputs {
  return {
    secrets: model.secrets.names,
    secretsUnverified: model.secrets.state === "unavailable",
    kernels: model.kernels.names,
    kernelsUnverified: model.kernels.state === "unavailable",
    gpuProfiles: model.gpuProfiles.items,
    gpuProfilesUnverified: model.gpuProfiles.state === "unavailable",
    existingNames: model.existingNames,
    existingNamesUnverified: model.existingNamesUnverified,
  };
}

function syncOkButton(model: SandboxPoolDialogModel): void {
  model.okButtonProps.disabled = Boolean(sandboxPoolSubmitBlockReason(sandboxCreateInputs(model), model.values));
}

/** A fresh model for one opening of the dialog, seeded from what the stores already hold. */
export function createSandboxPoolDialogModel(
  namespace: string,
  seed: { existingNames?: string[] } = {},
): SandboxPoolDialogModel {
  const model: SandboxPoolDialogModel = Mobx.observable(
    {
      values: defaultSandboxPoolForm(namespace),
      secrets: { state: "loading", names: [] } as ObjectPickerFacts,
      kernels: { state: "loading", names: [] } as ObjectPickerFacts,
      gpuProfiles: { state: "loading", items: [] } as PickerFacts<GuestGpuProfileFacts>,
      existingNames: seed.existingNames ?? [],
      existingNamesUnverified: false,
      // Collapsed, per the section's own rule (DESIGN.md section 12): every
      // field inside is optional and has a default the object would get anyway,
      // what each one changes is a consequence rather than a value the create
      // needs, and that consequence is on the header line whether the section is
      // open or shut.
      gpuOpen: false,
      registryOpen: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
      onValuesChanged: () => syncOkButton(model),
    },
    { existingNames: Mobx.observable.ref, onValuesChanged: Mobx.observable.ref },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/** The one way the pool's own fields change, so the OK button can never drift. */
export const updateSandboxPoolForm = Mobx.action(
  (model: SandboxPoolDialogModel, patch: Partial<Omit<SandboxPoolFormValues, "shape">>) => {
    Object.assign(model.values, patch);
    syncOkButton(model);
  },
);

/** The one way the slot shape changes, on this dialog and on slice 2's. */
export const updateSandboxShape = Mobx.action((model: SandboxShapeOwner, patch: Partial<SlotShapeValues>) => {
  Object.assign(model.values.shape, patch);
  model.onValuesChanged();
});

/** The same, for the pure transformers that return a whole shape (the row helpers). */
export const applySandboxShape = Mobx.action((model: SandboxShapeOwner, next: SlotShapeValues) => {
  Object.assign(model.values.shape, next);
  model.onValuesChanged();
});

export const toggleSandboxSection = Mobx.action((model: SandboxShapeOwner, section: "gpuOpen" | "registryOpen") => {
  model[section] = !model[section];
});

/**
 * Moves the form to another namespace.
 *
 * Everything namespaced goes with it: the kernel profile, the GPU profile and
 * the two Secrets all named objects of the previous namespace and name nothing
 * in this one, which is the stale-selection bug upstream's own wizard carries.
 */
export const changeSandboxPoolNamespace = Mobx.action((model: SandboxPoolDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  Object.assign(model.values.shape, {
    kernelProfile: "",
    gpuProfile: "",
    imagePullSecret: "",
    verifyKeySecret: "",
  });
  model.secrets = { state: "loading", names: [] };
  model.kernels = { state: "loading", names: [] };
  model.gpuProfiles = { state: "loading", items: [] };
  model.existingNames = [];
  model.existingNamesUnverified = false;
  syncOkButton(model);

  void loadNamespacedObjects(model);
});

/** The four namespace reads on open. None is awaited, none can throw. */
export async function loadNamespacedObjects(model: SandboxPoolDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([
    loadSecrets(model, namespace),
    loadKernels(model, namespace),
    loadGpuProfiles(model, namespace),
    loadPoolNames(model, namespace),
  ]);
}

/** The namespace's Secrets: a read a namespaced role may well not carry (spike T3). */
export async function loadSecrets(model: SandboxShapeOwner, namespace: string): Promise<void> {
  try {
    const secrets = await secretsApi.list({ namespace });
    const names = (secrets ?? []).map((secret) => secret.getName()).sort();

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.secrets = { state: "ready", names };
      model.onValuesChanged();
    });
  } catch {
    Mobx.runInAction(() => {
      model.secrets = { state: "unavailable", names: [] };
      model.onValuesChanged();
    });
  }
}

/** The namespace's SwiftKernels, for the kernel-profile picker. */
export async function loadKernels(model: SandboxShapeOwner, namespace: string): Promise<void> {
  try {
    const kernels = await SwiftKernel.getStore<SwiftKernel>().api.list({ namespace });
    const names = (kernels ?? []).map((kernel) => kernel.getName()).sort();

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.kernels = { state: "ready", names };
      model.onValuesChanged();
    });
  } catch {
    Mobx.runInAction(() => {
      model.kernels = { state: "unavailable", names: [] };
      model.onValuesChanged();
    });
  }
}

/**
 * The namespace's SwiftGPUProfiles.
 *
 * The one read whose FAILURE changes a verdict rather than a control: the HGX
 * refusal is computed from the picked profile's tier, so a refused read degrades
 * it to a warning instead of blocking a create the API server would accept.
 */
export async function loadGpuProfiles(model: SandboxShapeOwner, namespace: string): Promise<void> {
  try {
    const profiles = await SwiftGPUProfile.getStore<SwiftGPUProfile>().api.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.gpuProfiles = {
        state: "ready",
        items: (profiles ?? []).map((profile) => ({
          name: profile.getName(),
          count: profile.spec?.count,
          model: profile.spec?.model,
          tier: profile.spec?.tier,
          partitionMode: profile.spec?.partitionMode,
        })),
      };
      model.onValuesChanged();
    });
  } catch {
    Mobx.runInAction(() => {
      model.gpuProfiles = { state: "unavailable", items: [] };
      model.onValuesChanged();
    });
  }
}

/** The namespace's SwiftSandboxPool names, for the collision warning that never blocks. */
export async function loadPoolNames(model: SandboxPoolDialogModel, namespace: string): Promise<void> {
  try {
    const pools = await SwiftSandboxPool.getStore<SwiftSandboxPool>().api.list({ namespace });

    Mobx.runInAction(() => {
      model.existingNames = (pools ?? []).map((pool) => pool.getName());
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
function gpuPickerIsUsable(facts: PickerFacts<GuestGpuProfileFacts>, value: string): boolean {
  if (facts.state !== "ready" || facts.items.length === 0) {
    return false;
  }

  return value === "" || facts.items.some((item) => item.name === value);
}

// ---------------------------------------------------------------------------
// B1: identity.
// ---------------------------------------------------------------------------

/** The namespace: the host's own control, in the light theme the white box requires. */
const PoolNamespaceField = observer(({ model }: { model: SandboxPoolDialogModel }) => (
  <Field
    label={sandboxPoolFieldLabels.namespace}
    hint="The pool, every warm slot it boots and every Secret, kernel and GPU profile it names all live here - each of those references is namespace-local."
    error={sandboxPoolOwnErrors(model.values).namespace}
  >
    <NamespaceSelect
      id="sandbox-pool-create-namespace"
      themeName="light"
      menuClass={styles.selectMenu}
      value={model.values.namespace || null}
      onChange={(option: { value: string } | null) => changeSandboxPoolNamespace(model, option?.value ?? "")}
    />
  </Field>
));

/** The pool's name, whose budget is one slot suffix short of a Pod name. */
const PoolNameField = observer(({ model }: { model: SandboxPoolDialogModel }) => (
  <Field
    label={sandboxPoolFieldLabels.name}
    hint="Lowercase letters, digits, '-' and '.'. Every warm slot is a Pod named <pool>-slot-<five characters>, which is what caps this at 242."
    error={sandboxPoolOwnErrors(model.values).name}
    warning={sandboxPoolNameWarning(sandboxCreateInputs(model), model.values)}
  >
    <Input
      value={model.values.name}
      placeholder="warm-pool"
      data-testid="sandbox-pool-create-name"
      onChange={(value: string) => updateSandboxPoolForm(model, { name: value })}
    />
  </Field>
));

// ---------------------------------------------------------------------------
// B2: the slot shape, which slice 2's form renders against its own model.
// ---------------------------------------------------------------------------

/**
 * What each control of the shape SAYS, per kind.
 *
 * The controls, their validation, their T3 degradations and their payload are
 * one implementation shared by both forms; the sentences around them are not,
 * because the subject of every one of them is a warm slot on a pool and the
 * object being created on a sandbox. The DEFAULT is the pool's, which is where
 * these controls were written (slice 1), and slice 2's form passes its own.
 */
export interface SlotShapeWording {
  imageHint: string;
  cpuHint: string;
  memoryLabel: string;
  memoryHint: string;
  rootfsHint: string;
  networkHint: string;
  kernelHint: string;
  nodeSelectorHint: string;
  pullSecretHint: string;
  verifyKeyHint: string;
  modelImageHint: string;
}

/** The pool's own words, which are the ones slice 1 shipped. */
export const poolSlotShapeWording: SlotShapeWording = {
  imageHint:
    "The OCI image every warm slot boots as its root filesystem. A digest reference (repo@sha256:...) pins exactly what is warmed; a claiming SwiftSandbox has to request the same one.",
  cpuHint: `How many vCPUs each warm slot gets. Empty is ${defaultSlotCpu}, which the API server stamps, so nothing is sent for it.`,
  memoryLabel: "Memory per slot",
  memoryHint: `Held PER SLOT, so a pool of N slots holds N times it idle. ${quantityGrammar} Empty is ${defaultSlotMemory}, which the API server stamps.`,
  rootfsHint: `How the OCI rootfs reaches each slot: block is a read-only ext4 disk, virtiofs the unpacked tree. Empty is ${defaultRootfsMode}, which the API server stamps. A claiming SwiftSandbox must request the same mode.`,
  networkHint: `The slot's networking posture. Empty is ${defaultNetworkMode}, which the API server stamps; none is the only mode that gets no NetworkPolicy at all.`,
  kernelHint:
    "The SwiftKernel each slot boots. Empty means the well-known sandbox kernel, which is what the controller falls back to.",
  nodeSelectorHint: nodeSelectorMergeFact,
  pullSecretHint: "A docker-registry Secret of this namespace, for pulling the image from a private registry.",
  verifyKeyHint:
    "A Secret holding a cosign public key under cosign.pub. EVERY warm slot verifies the image against it before materializing, so the pool never warms an unverified rootfs. It needs a TLS registry.",
  modelImageHint:
    "An OCI image whose filesystem holds the weights, preloaded read-only into every slot over virtio-fs and materialized once per node. Every claiming SwiftSandbox inherits it.",
};

/** The image every slot boots, and the one field of the shape the schema requires. */
export const SlotImageField = observer(
  ({
    model,
    wording = poolSlotShapeWording,
    error,
  }: {
    model: SandboxShapeOwner;
    wording?: SlotShapeWording;
    /** The embedding form's own refusal, when its consequence is not a pool's. */
    error?: string;
  }) => (
    <Field
      label="Image"
      hint={wording.imageHint}
      error={error ?? slotShapeErrors(sandboxCreateInputs(model), model.values.shape).image}
    >
      <Input
        value={model.values.shape.image}
        placeholder="ghcr.io/example/sandbox:warm"
        data-testid="sandbox-create-image"
        onChange={(value: string) => updateSandboxShape(model, { image: value })}
      />
    </Field>
  ),
);

/**
 * The sizing and placement of one slot.
 *
 * Every stamped value is left empty with its effective value on the field: the
 * schema defaults `cpu`, `memory`, `rootfsMode` and `network.mode`, the API
 * server fills them in before it validates, and re-sending them would be this
 * form claiming to own a decision it did not make.
 */
export const SlotShapeFields = observer(
  ({
    model,
    wording = poolSlotShapeWording,
    errors: errorOverrides,
    warnings: warningOverrides,
    nodeSelectorMessages,
  }: {
    model: SandboxShapeOwner;
    wording?: SlotShapeWording;
    /** The embedding form's own refusals and warnings, when the consequences are not a pool's. */
    errors?: SlotShapeMessages;
    warnings?: SlotShapeMessages;
    nodeSelectorMessages?: NodeSelectorMessages[];
  }) => {
    const inputs = sandboxCreateInputs(model);
    const shape = model.values.shape;
    const errors = errorOverrides ?? slotShapeErrors(inputs, shape);
    const warnings = warningOverrides ?? slotShapeWarnings(inputs, shape);

    return (
      <>
        <Field label="vCPUs" hint={wording.cpuHint} error={errors.cpu}>
          <Input
            value={shape.cpu}
            placeholder={`${defaultSlotCpu} (the schema's default)`}
            data-testid="sandbox-create-cpu"
            onChange={(value: string) => updateSandboxShape(model, { cpu: value })}
          />
        </Field>

        <QuantityField
          label={wording.memoryLabel}
          hint={wording.memoryHint}
          placeholder={`${defaultSlotMemory} (the schema's default)`}
          testId="sandbox-create-memory"
          value={shape.memory}
          error={errors.memory}
          warning={warnings.memory}
          onChange={(value: string) => updateSandboxShape(model, { memory: value })}
        />

        <Field label="Root filesystem" hint={wording.rootfsHint}>
          <Select
            id="sandbox-create-rootfs-mode"
            themeName="light"
            menuClass={styles.selectMenu}
            isClearable
            placeholder={`${defaultRootfsMode} (the schema's default)`}
            value={shape.rootfsMode || null}
            options={sandboxRootfsModes.map((mode) => ({ value: mode, label: mode }))}
            onChange={(option: { value: string } | null) =>
              updateSandboxShape(model, { rootfsMode: option?.value ?? "" })
            }
          />
        </Field>

        <Field label="Network" hint={wording.networkHint}>
          <Select
            id="sandbox-create-network-mode"
            themeName="light"
            menuClass={styles.selectMenu}
            isClearable
            placeholder={`${defaultNetworkMode} (the schema's default)`}
            value={shape.networkMode || null}
            options={sandboxNetworkModes.map((mode) => ({ value: mode, label: mode }))}
            onChange={(option: { value: string } | null) =>
              updateSandboxShape(model, { networkMode: option?.value ?? "" })
            }
          />
        </Field>

        <ObjectPickerField
          id="sandbox-create-kernel-profile"
          inputTestId="sandbox-create-kernel-profile-input"
          label="Kernel profile"
          hint={wording.kernelHint}
          unverifiedHint="The SwiftKernels of this namespace could not be listed, so the name is not verified."
          placeholder="the well-known sandbox kernel"
          value={shape.kernelProfile}
          facts={model.kernels}
          warning={warnings.kernelProfile}
          onChange={(value: string) => updateSandboxShape(model, { kernelProfile: value })}
        />

        <NodeSelectorSection model={model} hint={wording.nodeSelectorHint} messages={nodeSelectorMessages} />
      </>
    );
  },
);

/** The node selector, merged by the controller with the kernel-node label it adds itself. */
const NodeSelectorSection = observer(
  ({ model, hint, messages }: { model: SandboxShapeOwner; hint: string; messages?: NodeSelectorMessages[] }) => {
    const errors = messages ?? nodeSelectorErrors(model.values.shape);

    return (
      <div className={styles.field} data-testid="sandbox-create-node-selector">
        <div className={styles.label}>Node selector</div>
        <div className={styles.hint}>{hint}</div>

        {model.values.shape.nodeSelector.map((row, index) => (
          <NodeSelectorFields key={row.id} model={model} row={row} index={index} messages={errors[index] ?? {}} />
        ))}

        <AddRowButton
          label="Add a node label"
          onAdd={() => applySandboxShape(model, addNodeSelectorRow(model.values.shape))}
          testId="sandbox-create-add-node-selector"
        />
      </div>
    );
  },
);

/** One label of the node selector: a key and a value, both of them a Kubernetes label's. */
const NodeSelectorFields = observer(
  ({
    model,
    row,
    index,
    messages,
  }: {
    model: SandboxShapeOwner;
    row: NodeSelectorRow;
    index: number;
    messages: Partial<Record<"key" | "value", string>>;
  }) => {
    const prefix = `sandbox-create-node-selector-${index}`;
    const update = (patch: Partial<NodeSelectorRow>) =>
      applySandboxShape(model, updateNodeSelectorRow(model.values.shape, row.id, patch));

    return (
      <FormRow
        title={`Node label ${index + 1}`}
        removeLabel="Remove"
        onRemove={() => applySandboxShape(model, removeNodeSelectorRow(model.values.shape, row.id))}
        testId={prefix}
        removeTestId={`${prefix}-remove`}
      >
        <Field
          label="Label"
          hint="A Kubernetes label key, optionally prefixed with a DNS subdomain."
          error={messages.key}
        >
          <Input
            value={row.key}
            placeholder="kubeswift.io/gpu-node"
            data-testid={`${prefix}-key`}
            onChange={(value: string) => update({ key: value })}
          />
        </Field>

        <Field
          label="Value"
          hint="Empty matches nodes that carry the label with no value at all."
          error={messages.value}
        >
          <Input
            value={row.value}
            placeholder="true"
            data-testid={`${prefix}-value`}
            onChange={(value: string) => update({ value })}
          />
        </Field>
      </FormRow>
    );
  },
);

// ---------------------------------------------------------------------------
// B3: the warm buffer, which is the pool's own surface.
// ---------------------------------------------------------------------------

/** The floor and the cap, and the fold that makes a cap below the floor a refusal. */
const WarmBufferFields = observer(({ model }: { model: SandboxPoolDialogModel }) => {
  const errors = sandboxPoolOwnErrors(model.values);

  return (
    <>
      <Field
        label={sandboxPoolFieldLabels.minWarm}
        hint={`How many Ready, pre-booted, unclaimed slots the pool keeps. Empty is ${defaultMinWarm}, which the API server stamps. ${minWarmZeroFact} ${minWarmScalePathFact}`}
        error={errors.minWarm}
      >
        <Input
          value={model.values.minWarm}
          placeholder={`${defaultMinWarm} (the schema's default)`}
          data-testid="sandbox-pool-create-min-warm"
          onChange={(value: string) => updateSandboxPoolForm(model, { minWarm: value })}
        />
      </Field>

      <Field
        label={sandboxPoolFieldLabels.maxWarm}
        hint={`Back-pressure on the total warm slots the pool will hold. ${maxWarmZeroFact}`}
        error={errors.maxWarm}
      >
        <Input
          value={model.values.maxWarm}
          placeholder="no cap"
          data-testid="sandbox-pool-create-max-warm"
          onChange={(value: string) => updateSandboxPoolForm(model, { maxWarm: value })}
        />
      </Field>
    </>
  );
});

// ---------------------------------------------------------------------------
// B4 and B5: the two collapsed sections, both shared with slice 2.
// ---------------------------------------------------------------------------

/**
 * The GPU profile picker, with its T3 degradation, shared by both forms.
 *
 * The SECTION around it is not shared and deliberately so: a pool's is this
 * picker alone, because the pool schema has no DRA backend at all, while a
 * sandbox's is a three-way backend control with a DRA branch that a checkout
 * removes entirely. What would drift at the next field this CRD gains is the
 * picker, and there is exactly one of it.
 *
 * The messages are handed in rather than computed here, because the two kinds
 * disagree about them: an HGX-tier profile is a refusal on a pool, whose
 * controller rejects the tier on a path that writes no status at all, and a
 * fact on a sandbox, which parks on it instead.
 */
export const SlotGpuProfileField = observer(
  ({ model, error, warning }: { model: SandboxShapeOwner; error?: string; warning?: string }) => {
    const inputs = sandboxCreateInputs(model);
    const shape = model.values.shape;
    const choices = sandboxGpuProfileChoices(inputs);
    const hint =
      "A SwiftGPUProfile of this namespace. It is the request itself - how many GPUs, of which model, in which tier - because a profile has no status at all and nothing ever writes back to it.";

    if (gpuPickerIsUsable(model.gpuProfiles, shape.gpuProfile)) {
      return (
        <Field label="GPU profile" hint={hint} error={error} warning={warning}>
          <Select
            id="sandbox-create-gpu-profile"
            themeName="light"
            menuClass={styles.selectMenu}
            isClearable
            placeholder="No GPU"
            value={shape.gpuProfile || null}
            options={choices.map((choice) => ({ value: choice.name, label: choice.label }))}
            onChange={(option: { value: string } | null) =>
              updateSandboxShape(model, { gpuProfile: option?.value ?? "" })
            }
          />
        </Field>
      );
    }

    return (
      <Field
        label="GPU profile"
        hint={
          model.gpuProfiles.state === "unavailable"
            ? "The SwiftGPUProfiles of this namespace could not be listed, so a name typed here is not verified - and neither is its tier."
            : model.gpuProfiles.state === "ready"
              ? `${hint} This namespace holds no SwiftGPUProfile yet, so the name has to be typed.`
              : hint
        }
        error={error}
        warning={warning}
      >
        <Input
          value={shape.gpuProfile}
          placeholder="the name of a SwiftGPUProfile"
          data-testid="sandbox-create-gpu-profile-input"
          onChange={(value: string) => updateSandboxShape(model, { gpuProfile: value })}
        />
      </Field>
    );
  },
);

/**
 * The GPU profile, and the one refusal upstream reports nowhere at all.
 *
 * The pool schema has no DRA backend, so there is one control here rather than
 * the Create Sandbox form's three-way choice: `gpuResourceClaim` simply does not
 * exist on a SwiftSandboxPool.
 */
export const SlotGpuSection = observer(({ model }: { model: SandboxShapeOwner }) => {
  const inputs = sandboxCreateInputs(model);
  const shape = model.values.shape;
  const errors = slotShapeErrors(inputs, shape);
  const warnings = slotShapeWarnings(inputs, shape);

  return (
    <CollapsibleSection
      title="GPU"
      hint={sandboxGpuSectionHint(inputs, shape)}
      open={model.gpuOpen || slotGpuSectionHasError(inputs, shape)}
      onToggle={() => toggleSandboxSection(model, "gpuOpen")}
      testId="sandbox-create-gpu-section"
    >
      <SlotGpuProfileField model={model} error={errors.gpuProfile} warning={warnings.gpuProfile} />
    </CollapsibleSection>
  );
});

/** The registry credentials, shared by both forms and grouped differently by each. */
export const SlotPullSecretField = observer(
  ({
    model,
    wording = poolSlotShapeWording,
    warning,
  }: {
    model: SandboxShapeOwner;
    wording?: SlotShapeWording;
    /** The embedding form's own warning, when its consequence is not a pool's. */
    warning?: string;
  }) => (
    <ObjectPickerField
      id="sandbox-create-pull-secret"
      inputTestId="sandbox-create-pull-secret-input"
      label="Pull secret"
      hint={wording.pullSecretHint}
      unverifiedHint="The Secrets of this namespace could not be listed, so the name is not verified."
      placeholder="None"
      value={model.values.shape.imagePullSecret}
      facts={model.secrets}
      warning={warning ?? slotShapeWarnings(sandboxCreateInputs(model), model.values.shape).imagePullSecret}
      onChange={(value: string) => updateSandboxShape(model, { imagePullSecret: value })}
    />
  ),
);

/** The cosign key the rootfs is verified against before it is materialized. */
export const SlotVerifyKeyField = observer(
  ({
    model,
    wording = poolSlotShapeWording,
    warning,
  }: {
    model: SandboxShapeOwner;
    wording?: SlotShapeWording;
    warning?: string;
  }) => (
    <ObjectPickerField
      id="sandbox-create-verify-key"
      inputTestId="sandbox-create-verify-key-input"
      label="Verification key"
      hint={wording.verifyKeyHint}
      unverifiedHint="The Secrets of this namespace could not be listed, so the name is not verified."
      placeholder="None"
      value={model.values.shape.verifyKeySecret}
      facts={model.secrets}
      warning={warning ?? slotShapeWarnings(sandboxCreateInputs(model), model.values.shape).verifyKeySecret}
      onChange={(value: string) => updateSandboxShape(model, { verifyKeySecret: value })}
    />
  ),
);

/**
 * The model image and its mount path, which is one control until an image is
 * named and one sentence until then (W12 option dropping).
 */
export const SlotModelFields = observer(
  ({
    model,
    wording = poolSlotShapeWording,
    mountPathError,
  }: {
    model: SandboxShapeOwner;
    wording?: SlotShapeWording;
    mountPathError?: string;
  }) => {
    const shape = model.values.shape;
    const errors = slotShapeErrors(sandboxCreateInputs(model), shape);

    return (
      <>
        <Field label="Model image" hint={wording.modelImageHint} error={errors.modelImageRef}>
          <Input
            value={shape.modelImageRef}
            placeholder="ghcr.io/example/model@sha256:..."
            data-testid="sandbox-create-model-image"
            onChange={(value: string) => updateSandboxShape(model, { modelImageRef: value })}
          />
        </Field>

        {/* Option dropping (W12): the model block exists only with an imageRef, so
            a mount path with no image is a value that could never be sent. The
            fact stands in the control's place rather than the control standing
            there collecting something that is thrown away. */}
        {shape.modelImageRef.trim() ? (
          <Field
            label="Model mount path"
            hint={`Where the weights are mounted inside the guest. Empty is ${defaultModelMountPath}, which the API server stamps.`}
            error={mountPathError ?? errors.modelMountPath}
          >
            <Input
              value={shape.modelMountPath}
              placeholder={`${defaultModelMountPath} (the schema's default)`}
              data-testid="sandbox-create-model-mount-path"
              onChange={(value: string) => updateSandboxShape(model, { modelMountPath: value })}
            />
          </Field>
        ) : (
          <Field label="Model mount path">
            <div className={styles.hint} data-testid="sandbox-create-model-mount-path-dropped">
              A mount path only exists once a model image is named: the model block is emitted only with an imageRef, so
              nothing would carry it.
            </div>
          </Field>
        )}
      </>
    );
  },
);

/** The registry credentials, the signature check every slot performs, and the model preload. */
export const SlotRegistrySection = observer(({ model }: { model: SandboxShapeOwner }) => {
  const inputs = sandboxCreateInputs(model);
  const shape = model.values.shape;

  return (
    <CollapsibleSection
      title="Registry, verification and model"
      hint={sandboxRegistrySectionHint(shape)}
      open={model.registryOpen || slotRegistrySectionHasError(inputs, shape)}
      onToggle={() => toggleSandboxSection(model, "registryOpen")}
      testId="sandbox-create-registry-section"
    >
      <SlotPullSecretField model={model} />
      <SlotVerifyKeyField model={model} />
      <SlotModelFields model={model} />
    </CollapsibleSection>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const SandboxPoolWriteSummary = observer(({ model }: { model: SandboxPoolDialogModel }) => (
  <WriteSummary facts={sandboxPoolCreateSummary(sandboxCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const SandboxPoolCreateForm = observer(({ model }: { model: SandboxPoolDialogModel }) => {
  const blocked = sandboxPoolSubmitBlockReason(sandboxCreateInputs(model), model.values);

  return (
    <div className={styles.form} data-testid="swiftsandboxpool-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftSandboxPool</b>
      </p>

      <PoolNamespaceField model={model} />
      <PoolNameField model={model} />

      <p className={styles.subject}>
        {"Every warm slot is a workload-less "}
        <b>SwiftSandbox</b>
        {" of this shape"}
      </p>

      <SlotImageField model={model} />
      <SlotShapeFields model={model} />

      <WarmBufferFields model={model} />

      <SlotGpuSection model={model} />
      <SlotRegistrySection model={model} />

      <SandboxPoolWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="sandbox-pool-create-submit-blocked">
          {`${createSandboxPoolTitle} is disabled - ${blocked}`}
        </p>
      ) : null}

      <p className={styles.footer} data-testid="sandbox-pool-create-footer">
        {sandboxPoolFooter}
      </p>
    </div>
  );
});

/**
 * Performs the create, reports the outcome, and keeps the form when the name was
 * the problem.
 *
 * Nothing is ever rethrown, for the reason the six dialogs before it do not:
 * `ConfirmDialog.ok` closes the dialog in a `finally` on both outcomes, and a
 * rethrown `JsonApiErrorParsed` additionally triggers the host's own "Unknown
 * error occurred while ok-ing" toast.
 */
async function submitSandboxPool(
  model: SandboxPoolDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const inputs = sandboxCreateInputs(model);
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  // Not zero: reopening inside the host's own 100ms leave animation leaves the
  // dialog at `opacity: 0` forever (the mechanism is on `dialogReopenDelay`).
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), dialogReopenDelay);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = sandboxPoolSubmitBlockReason(inputs, model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftSandboxPool.getStore<SwiftSandboxPool>().create(
      { name, namespace },
      sandboxPoolCreatePayload(model.values),
    );
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4) - and 403 is the expected failure here, since upstream's own
    // RBAC presets grant read only on both sandbox kinds.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        sandboxPoolCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftSandboxPool ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(sandboxPoolCreateSuccessMessage(namespace, name));
}

/** Opens the dialog for one model, keeping the params so the 409 path can reopen it. */
export function openSandboxPoolCreateDialog(model: SandboxPoolDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createSandboxPoolTitle,
    // No icon, as in the six dialogs before it: the host's default is a warning
    // triangle, and a create commits resources without destroying anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <SandboxPoolCreateForm model={model} />,
    ok: () => submitSandboxPool(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Sandbox Pools page's create control calls. */
export function openCreateSandboxPoolDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createSandboxPoolDialogModel(namespace, { existingNames: storedSandboxPoolNames(namespace) });

  void loadNamespacedObjects(model);

  openSandboxPoolCreateDialog(model);
}

/** The namespace's pools as the store already holds them: free, and usually right. */
function storedSandboxPoolNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftSandboxPool.getStore<SwiftSandboxPool>());

  return (store?.items ?? []).filter((pool) => pool.getNs() === namespace).map((pool) => pool.getName());
}

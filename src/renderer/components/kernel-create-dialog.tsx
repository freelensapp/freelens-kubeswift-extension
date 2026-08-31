/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Kernel form, the sixth create surface of the milestone (SPEC-0014,
// slice 1). Every decision it renders - what is refused and why, how many nodes
// will get a pull Job, what the write summary lists, what the payload is -
// belongs to `kernel-create.ts`.
//
// What lives here is the host wiring, and it is the same wiring the five earlier
// dialogs use: `ConfirmDialog.open` as the dialog host, a per-open MobX model
// outside React so the 409 reopen keeps the form, and an observable
// `okButtonProps`.
//
// Five of its six controls are text with one rule each, so the interesting part
// is the two reads on open: the namespace's Secrets, for a pull-secret picker
// that degrades to a text input, and the cluster's nodes, for the labelled-node
// count the summary states before the write. A refused node read makes that
// count unverified and NEVER zero, which is the `existingNamesUnverified`
// lesson of SPEC-0013 slice 2 applied to a number.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftKernel } from "../api/kubeswift/swiftkernel-v1alpha1";
import { Field, ObjectPickerField, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import { defaultNamespace } from "./guest-create";
import {
  createKernelTitle,
  defaultKernelForm,
  kernelCmdlineReplacedFact,
  kernelCreateErrors,
  kernelCreateFailureMessage,
  kernelCreatePayload,
  kernelCreateSuccessMessage,
  kernelCreateSummary,
  kernelCreateWarnings,
  kernelSubmitBlockReason,
  profileFact,
  pullSecretReachFact,
} from "./kernel-create";
import { conflictStatusCode } from "./migration-create";

import type { ObjectPickerFacts } from "./create-dialog";
import type { KernelCreateInputs, KernelFormValues } from "./kernel-create";
import type { NodeFacts } from "./migration-create";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, Input, NamespaceSelect, Notifications },
  K8sApi: { namespaceStore, nodesApi, secretsApi },
} = Renderer;

/** What the one-shot node read on open found. */
export interface NodePickerFacts {
  state: "loading" | "ready" | "unavailable";
  items: NodeFacts[];
}

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most.
 */
export interface KernelDialogModel {
  values: KernelFormValues;
  /** The namespace's Secrets, for the pull-secret picker and its T3 degradation. */
  secrets: ObjectPickerFacts;
  /** The cluster's nodes, for the labelled-node count. */
  nodes: NodePickerFacts;
  /** The namespace's SwiftKernel names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function kernelCreateInputs(model: KernelDialogModel): KernelCreateInputs {
  return {
    secrets: model.secrets.names,
    secretsUnverified: model.secrets.state === "unavailable",
    nodes: model.nodes.items,
    nodesUnverified: model.nodes.state === "unavailable",
    existingNames: model.existingNames,
    existingNamesUnverified: model.existingNamesUnverified,
  };
}

function syncOkButton(model: KernelDialogModel): void {
  model.okButtonProps.disabled = Boolean(kernelSubmitBlockReason(model.values));
}

/** A fresh model for one opening of the dialog, seeded from what the stores already hold. */
export function createKernelDialogModel(
  namespace: string,
  seed: { secrets?: string[]; existingNames?: string[] } = {},
): KernelDialogModel {
  const model = Mobx.observable(
    {
      values: defaultKernelForm(namespace),
      secrets: { state: "loading", names: seed.secrets ?? [] } as ObjectPickerFacts,
      nodes: { state: "loading", items: [] } as NodePickerFacts,
      existingNames: seed.existingNames ?? [],
      existingNamesUnverified: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    { existingNames: Mobx.observable.ref },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/**
 * The one way the form changes, so the OK button can never drift out of step
 * with the values it is a verdict on.
 */
export const updateKernelForm = Mobx.action((model: KernelDialogModel, patch: Partial<KernelFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/**
 * Moves the form to another namespace.
 *
 * Everything namespaced goes with it: the pull secret named one Secret of the
 * previous namespace and names nothing in this one, which is the stale-selection
 * bug upstream's own wizard carries across cluster switches.
 */
export const changeKernelNamespace = Mobx.action((model: KernelDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  model.values.pullSecret = "";
  model.secrets = { state: "loading", names: [] };
  model.existingNames = [];
  model.existingNamesUnverified = false;
  syncOkButton(model);

  void loadNamespacedObjects(model);
});

/** The namespace's Secrets and kernel names, as two list calls. Neither is awaited, neither can throw. */
export async function loadNamespacedObjects(model: KernelDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([loadSecrets(model, namespace), loadKernelNames(model, namespace)]);
}

/**
 * The namespace's Secrets, as one list call on open (spike T3).
 *
 * A namespace read a namespaced role may well not carry: a refusal degrades the
 * pull-secret field to a text input and costs one sentence, never the write.
 */
export async function loadSecrets(model: KernelDialogModel, namespace: string): Promise<void> {
  try {
    const secrets = await secretsApi.list({ namespace });
    const names = (secrets ?? []).map((secret) => secret.getName()).sort();

    Mobx.runInAction(() => {
      model.secrets = { state: "ready", names };
    });
  } catch {
    Mobx.runInAction(() => {
      model.secrets = { state: "unavailable", names: model.secrets.names };
    });
  }
}

/** The namespace's SwiftKernel names, for the collision warning. */
export async function loadKernelNames(model: KernelDialogModel, namespace: string): Promise<void> {
  try {
    const kernels = await SwiftKernel.getStore<SwiftKernel>().api.list({ namespace });

    Mobx.runInAction(() => {
      model.existingNames = (kernels ?? []).map((kernel) => kernel.getName());
      model.existingNamesUnverified = false;
    });
  } catch {
    Mobx.runInAction(() => {
      model.existingNamesUnverified = true;
    });
  }
}

/**
 * The cluster's nodes, for the one number this form reads on open (F12).
 *
 * The count of nodes carrying the kernel-node label is what says, before the
 * write, that this kernel will park in `Pending` with no Job at all. A refused
 * read makes it unverified rather than zero: those are different sentences and
 * only one of them is a reason to hesitate.
 */
export async function loadNodes(model: KernelDialogModel): Promise<void> {
  try {
    const nodes = await nodesApi.list();

    Mobx.runInAction(() => {
      model.nodes = {
        state: "ready",
        items: (nodes ?? []).map((node) => ({
          name: node.getName(),
          ready: (node.status?.conditions ?? []).some(
            (condition) => condition.type === "Ready" && condition.status === "True",
          ),
          schedulable: node.spec?.unschedulable !== true,
          labels: node.metadata?.labels,
        })),
      };
    });
  } catch {
    Mobx.runInAction(() => {
      model.nodes = { state: "unavailable", items: [] };
    });
  }
}

interface TextFieldProps {
  model: KernelDialogModel;
  field: "name" | "image" | "kernelCmdline" | "profile";
  testId: string;
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  placeholder?: string;
  multiLine?: boolean;
}

/** A text input bound to one field of the model. */
const TextField = observer(({ model, field, testId, placeholder, multiLine, ...fieldProps }: TextFieldProps) => (
  <Field {...fieldProps}>
    <Input
      value={model.values[field]}
      placeholder={placeholder}
      multiLine={multiLine}
      maxRows={multiLine ? 3 : undefined}
      data-testid={testId}
      onChange={(value: string) => updateKernelForm(model, { [field]: value } as Partial<KernelFormValues>)}
    />
  </Field>
));

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const KernelWriteSummary = observer(({ model }: { model: KernelDialogModel }) => (
  <WriteSummary facts={kernelCreateSummary(kernelCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const KernelCreateForm = observer(({ model }: { model: KernelDialogModel }) => {
  const inputs = kernelCreateInputs(model);
  const errors = kernelCreateErrors(model.values);
  const warnings = kernelCreateWarnings(inputs, model.values);
  const blocked = kernelSubmitBlockReason(model.values);

  return (
    <div className={styles.form} data-testid="swiftkernel-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftKernel</b>
      </p>

      <Field
        label="Namespace"
        hint="The kernel, its pull Jobs and the Secret it may name all live here, and a guest resolves its kernel from its own namespace."
        error={errors.namespace}
      >
        <NamespaceSelect
          id="kernel-create-namespace"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.namespace || null}
          onChange={(option: { value: string } | null) => changeKernelNamespace(model, option?.value ?? "")}
        />
      </Field>

      <TextField
        model={model}
        field="name"
        testId="kernel-create-name"
        label="Name"
        error={errors.name}
        warning={warnings.name}
      />

      <TextField
        model={model}
        field="image"
        testId="kernel-create-image"
        label="OCI image"
        placeholder="ghcr.io/example/kernel:6.12"
        hint="The artifact holding the kernel and the initramfs, pulled with oras onto every labelled node."
        error={errors.image}
      />

      <ObjectPickerField
        id="kernel-create-pull-secret"
        inputTestId="kernel-create-pull-secret-input"
        label="Pull secret"
        hint={pullSecretReachFact}
        unverifiedHint="The Secrets of this namespace could not be listed, so the name is not verified."
        placeholder="None"
        value={model.values.pullSecret}
        facts={model.secrets}
        warning={warnings.pullSecret}
        onChange={(value: string) => updateKernelForm(model, { pullSecret: value })}
      />

      {/* Multi-line on purpose, for a value that is one line. A single-line
          <input> applies the browser's own value sanitization, which STRIPS a
          pasted newline instead of refusing it - so `console=ttyS0` and `quiet`
          arrive joined into one nonsense token, silently, and the rule below
          could never fire from this control at all. A textarea makes the paste
          visible and lets the refusal say what is wrong with it. */}
      <TextField
        model={model}
        field="kernelCmdline"
        testId="kernel-create-cmdline"
        label="Kernel command line"
        placeholder="console=ttyS0 reboot=k panic=1"
        hint={`Optional, and one line. ${kernelCmdlineReplacedFact}`}
        error={errors.kernelCmdline}
        multiLine
      />

      <TextField
        model={model}
        field="profile"
        testId="kernel-create-profile"
        label="Profile"
        placeholder="linux-6.12"
        hint={`Optional. ${profileFact}`}
      />

      <KernelWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="kernel-create-submit-blocked">
          {`${createKernelTitle} is disabled - ${blocked}`}
        </p>
      ) : null}
    </div>
  );
});

/**
 * Performs the create, reports the outcome, and keeps the form when the name was
 * the problem.
 *
 * Nothing is ever rethrown: `ConfirmDialog.ok` closes the dialog in a `finally`
 * on both outcomes, and a rethrown `JsonApiErrorParsed` additionally triggers the
 * host's own "Unknown error occurred while ok-ing" toast.
 */
async function submitKernel(model: KernelDialogModel, params: Renderer.Component.ConfirmDialogParams): Promise<void> {
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = kernelSubmitBlockReason(model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftKernel.getStore<SwiftKernel>().create({ name, namespace }, kernelCreatePayload(model.values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        kernelCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftKernel ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(kernelCreateSuccessMessage(namespace, name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openKernelCreateDialog(model: KernelDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createKernelTitle,
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <KernelCreateForm model={model} />,
    ok: () => submitKernel(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Kernels page's create control calls. */
export function openCreateKernelDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createKernelDialogModel(namespace, {
    secrets: [],
    existingNames: storedKernelNames(namespace),
  });

  void loadNamespacedObjects(model);
  void loadNodes(model);

  openKernelCreateDialog(model);
}

/** The namespace's kernels as the store already holds them: free, and usually right. */
function storedKernelNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftKernel.getStore<SwiftKernel>());

  return (store?.items ?? []).filter((kernel) => kernel.getNs() === namespace).map((kernel) => kernel.getName());
}

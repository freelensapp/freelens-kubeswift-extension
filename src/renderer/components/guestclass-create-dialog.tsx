/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Guest Class form, the fifth create surface of the milestone
// (SPEC-0014, slice 1). Every decision it renders - what is refused and why,
// what the write summary lists, what the payload is - belongs to
// `guestclass-create.ts`.
//
// What lives here is the host wiring, and it is deliberately the same wiring the
// four earlier dialogs use, for the same three host facts the SPEC-0011 spikes
// settled: `ConfirmDialog.open` is the dialog host, the form model lives OUTSIDE
// React in a per-open MobX observable so a 409 reopen does not wipe it, and the
// OK button reacts to nothing except an `okButtonProps` that is itself
// observable.
//
// One thing is new, and it is an absence: there is no namespace control. The
// kind is cluster-scoped, so the fact is stated where the field would have been
// rather than left to be noticed - upstream's own sample sets
// `metadata.namespace` on one of these, and its gateway catalog marks the kind
// namespaced while the CRD is not.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { Field, ObjectPickerField, QuantityField, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import {
  coreSchedulingNote,
  createGuestClassTitle,
  defaultGuestClassForm,
  guestClassAccessModes,
  guestClassCoreSchedulingPolicies,
  guestClassCreateErrors,
  guestClassCreateFailureMessage,
  guestClassCreatePayload,
  guestClassCreateSuccessMessage,
  guestClassCreateSummary,
  guestClassCreateWarnings,
  guestClassDiskFormats,
  guestClassLiveMigrationFact,
  guestClassScopeFact,
  guestClassSizingRulesFact,
  guestClassStorageFact,
  guestClassSubmitBlockReason,
  guestClassVolumeModes,
  quantityGrammar,
} from "./guestclass-create";
import { conflictStatusCode } from "./migration-create";

import type {
  SwiftGuestClassCoreScheduling,
  SwiftGuestClassDiskFormat,
} from "../api/kubeswift/swiftguestclass-v1alpha1";
import type { ObjectPickerFacts } from "./create-dialog";
import type { GuestClassCreateInputs, GuestClassFormValues } from "./guestclass-create";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, Input, Notifications, Select },
  K8sApi: { storageClassApi, storageClassStore },
} = Renderer;

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most - with a name to fix and everything else already typed.
 */
export interface GuestClassDialogModel {
  values: GuestClassFormValues;
  /** The cluster's StorageClasses, for the picker and its T3 degradation. */
  storageClasses: ObjectPickerFacts;
  /** The cluster's guest class names, for the collision warning that never blocks. */
  existingNames: string[];
  /** True when that read was refused, which the collision warning must not read as "free". */
  existingNamesUnverified: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function guestClassCreateInputs(model: GuestClassDialogModel): GuestClassCreateInputs {
  return {
    storageClasses: model.storageClasses.names,
    storageClassesUnverified: model.storageClasses.state === "unavailable",
    existingNames: model.existingNames,
    existingNamesUnverified: model.existingNamesUnverified,
  };
}

function syncOkButton(model: GuestClassDialogModel): void {
  model.okButtonProps.disabled = Boolean(guestClassSubmitBlockReason(model.values));
}

/**
 * A fresh model for one opening of the dialog.
 *
 * The seeds are what the stores already hold at click time - free, and usually
 * right when the user is looking at the page these objects are listed on - and
 * the reads on open refine them.
 */
export function createGuestClassDialogModel(
  seed: { storageClasses?: string[]; existingNames?: string[] } = {},
): GuestClassDialogModel {
  const model = Mobx.observable(
    {
      values: defaultGuestClassForm(),
      storageClasses: { state: "loading", names: seed.storageClasses ?? [] } as ObjectPickerFacts,
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
export const updateGuestClassForm = Mobx.action(
  (model: GuestClassDialogModel, patch: Partial<GuestClassFormValues>) => {
    Object.assign(model.values, patch);
    syncOkButton(model);
  },
);

/**
 * The cluster's StorageClasses, as one list call on open (spike T3).
 *
 * A cluster read, which a namespaced role may well not carry: never awaited by
 * the caller and never allowed to throw, because a read that fails must not
 * block a write the user is allowed to make. The picker degrades to a text
 * input and the summary marks the value unverified.
 */
export async function loadStorageClasses(model: GuestClassDialogModel): Promise<void> {
  try {
    const storageClasses = await storageClassApi.list();
    const names = (storageClasses ?? []).map((storageClass) => storageClass.getName()).sort();

    Mobx.runInAction(() => {
      model.storageClasses = { state: "ready", names };
    });
  } catch {
    Mobx.runInAction(() => {
      model.storageClasses = { state: "unavailable", names: model.storageClasses.names };
    });
  }
}

/**
 * The cluster's guest class names, as one list call on open.
 *
 * Cluster-scoped and cheap, so a cold store never blocks the form; a refusal
 * leaves the collision warning unverified rather than silent, which is the
 * `existingNamesUnverified` lesson of SPEC-0013 slice 2.
 */
export async function loadGuestClassNames(model: GuestClassDialogModel): Promise<void> {
  try {
    const guestClasses = await SwiftGuestClass.getStore<SwiftGuestClass>().api.list();

    Mobx.runInAction(() => {
      model.existingNames = (guestClasses ?? []).map((guestClass) => guestClass.getName());
      model.existingNamesUnverified = false;
      syncOkButton(model);
    });
  } catch {
    Mobx.runInAction(() => {
      model.existingNamesUnverified = true;
    });
  }
}

interface TextFieldProps {
  model: GuestClassDialogModel;
  field: "name";
  testId: string;
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  placeholder?: string;
}

/** A text input bound to one field of the model. */
const TextField = observer(({ model, field, testId, placeholder, ...fieldProps }: TextFieldProps) => (
  <Field {...fieldProps}>
    <Input
      value={model.values[field]}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(value: string) => updateGuestClassForm(model, { [field]: value } as Partial<GuestClassFormValues>)}
    />
  </Field>
));

interface ClassQuantityFieldProps {
  model: GuestClassDialogModel;
  field: "cpu" | "memory" | "rootDiskSize";
  testId: string;
  label: string;
  hint: string;
  placeholder: string;
}

/** One of the three required quantities, with the grammar under it and the refusals from the module. */
const ClassQuantityField = observer(({ model, field, testId, label, hint, placeholder }: ClassQuantityFieldProps) => {
  const errors = guestClassCreateErrors(model.values);
  const warnings = guestClassCreateWarnings(guestClassCreateInputs(model), model.values);

  return (
    <QuantityField
      label={label}
      hint={`${hint} ${quantityGrammar}`}
      error={errors[field]}
      warning={warnings[field]}
      value={model.values[field]}
      placeholder={placeholder}
      testId={testId}
      onChange={(value: string) => updateGuestClassForm(model, { [field]: value } as Partial<GuestClassFormValues>)}
    />
  );
});

/**
 * The storage trio: the CRD's one CEL rule, and the one consequence it decides.
 *
 * Flat rather than collapsed. DESIGN.md section 12 allows a collapsed section
 * only when what it hides is a consequence rather than a decision, and this
 * block decides whether every guest of this class can ever be live-migrated -
 * which is exactly the decision a form does not hide to look shorter.
 */
const StorageFields = observer(({ model }: { model: GuestClassDialogModel }) => {
  const inputs = guestClassCreateInputs(model);
  const errors = guestClassCreateErrors(model.values);
  const warnings = guestClassCreateWarnings(inputs, model.values);

  return (
    <>
      <Field
        label="Access mode"
        hint={`${guestClassStorageFact} ${guestClassLiveMigrationFact(model.values)}`}
        error={errors.storageAccessMode}
      >
        <Select
          id="guestclass-create-access-mode"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="Unset (the API server uses ReadWriteOnce)"
          isClearable
          value={model.values.storageAccessMode || null}
          options={guestClassAccessModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(option: { value: string } | null) =>
            updateGuestClassForm(model, { storageAccessMode: option?.value ?? "" })
          }
        />
      </Field>

      <Field
        label="Volume mode"
        hint="Unset leaves the API server's own Filesystem. Block is what a live migration needs, and what the CRD's rule pairs ReadWriteMany with."
        error={errors.storageVolumeMode}
        warning={warnings.storageVolumeMode}
      >
        <Select
          id="guestclass-create-volume-mode"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="Unset (the API server uses Filesystem)"
          isClearable
          value={model.values.storageVolumeMode || null}
          options={guestClassVolumeModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(option: { value: string } | null) =>
            updateGuestClassForm(model, { storageVolumeMode: option?.value ?? "" })
          }
        />
      </Field>

      <ObjectPickerField
        id="guestclass-create-storage-class"
        inputTestId="guestclass-create-storage-class-input"
        label="Storage class"
        hint="Unset falls through to the source image's own PVC class, and then to the cluster default."
        unverifiedHint="The cluster's StorageClasses could not be listed, so the name is not verified."
        placeholder="Unset"
        value={model.values.storageClassName}
        facts={model.storageClasses}
        error={errors.storageClassName}
        warning={warnings.storageClassName}
        onChange={(value: string) => updateGuestClassForm(model, { storageClassName: value })}
      />
    </>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const GuestClassWriteSummary = observer(({ model }: { model: GuestClassDialogModel }) => (
  <WriteSummary facts={guestClassCreateSummary(guestClassCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const GuestClassCreateForm = observer(({ model }: { model: GuestClassDialogModel }) => {
  const inputs = guestClassCreateInputs(model);
  const errors = guestClassCreateErrors(model.values);
  const warnings = guestClassCreateWarnings(inputs, model.values);
  const blocked = guestClassSubmitBlockReason(model.values);

  return (
    <div className={styles.form} data-testid="swiftguestclass-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftGuestClass</b>
      </p>

      {/* Where the namespace control would have been on any other create form
          of this milestone (F3). Stated rather than merely absent: the kind's
          own upstream sample carries a `metadata.namespace`. */}
      <div className={styles.hint} data-testid="guestclass-create-scope">
        {guestClassScopeFact}
      </div>

      <TextField
        model={model}
        field="name"
        testId="guestclass-create-name"
        label="Name"
        error={errors.name}
        warning={warnings.name}
      />

      <ClassQuantityField
        model={model}
        field="cpu"
        testId="guestclass-create-cpu"
        label="CPU"
        hint="The vCPUs every guest of this class gets."
        placeholder="4"
      />

      <ClassQuantityField
        model={model}
        field="memory"
        testId="guestclass-create-memory"
        label="Memory"
        hint="The memory every guest of this class gets."
        placeholder="8Gi"
      />

      <ClassQuantityField
        model={model}
        field="rootDiskSize"
        testId="guestclass-create-root-disk-size"
        label="Root disk size"
        hint="The size of the root-disk PVC the guest controller creates."
        placeholder="40Gi"
      />

      <Field label="Root disk format" hint={guestClassSizingRulesFact} error={errors.rootDiskFormat}>
        <Select
          id="guestclass-create-root-disk-format"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="Pick a format"
          value={model.values.rootDiskFormat || null}
          options={guestClassDiskFormats.map((format) => ({ value: format, label: format }))}
          onChange={(option: { value: SwiftGuestClassDiskFormat } | null) =>
            updateGuestClassForm(model, { rootDiskFormat: option?.value ?? "" })
          }
        />
      </Field>

      <StorageFields model={model} />

      <Field label="Core scheduling" hint={coreSchedulingNote(model.values.coreScheduling)}>
        <Select
          id="guestclass-create-core-scheduling"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.coreScheduling}
          options={guestClassCoreSchedulingPolicies.map((policy) => ({ value: policy, label: policy }))}
          onChange={(option: { value: SwiftGuestClassCoreScheduling } | null) =>
            option && updateGuestClassForm(model, { coreScheduling: option.value })
          }
        />
      </Field>

      <GuestClassWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="guestclass-create-submit-blocked">
          {`${createGuestClassTitle} is disabled - ${blocked}`}
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
 * host's own "Unknown error occurred while ok-ing" toast. The 409 is answered by
 * reopening the same params after the host's `finally` has run, which works
 * because the model is not React state.
 */
async function submitGuestClass(
  model: GuestClassDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const name = model.values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = guestClassSubmitBlockReason(model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    // No namespace: the kind is cluster-scoped, and the host's own store builds
    // the cluster-scoped request path from the absence of one.
    await SwiftGuestClass.getStore<SwiftGuestClass>().create({ name }, guestClassCreatePayload(model.values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        guestClassCreateFailureMessage(failure, name) ?? error,
        `Could not create the SwiftGuestClass ${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(guestClassCreateSuccessMessage(name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openGuestClassCreateDialog(model: GuestClassDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createGuestClassTitle,
    // No icon, as in the four dialogs before it: the host's default is a warning
    // triangle, and a create commits resources without destroying anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <GuestClassCreateForm model={model} />,
    ok: () => submitGuestClass(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Guest Classes page's create control calls. */
export function openCreateGuestClassDialog(): void {
  const model = createGuestClassDialogModel({
    storageClasses: storedStorageClassNames(),
    existingNames: storedGuestClassNames(),
  });

  void loadStorageClasses(model);
  void loadGuestClassNames(model);

  openGuestClassCreateDialog(model);
}

/** The cluster's StorageClasses as the host's own store already holds them. */
function storedStorageClassNames(): string[] {
  const store = maybe(() => storageClassStore);

  return (store?.items ?? []).map((storageClass) => storageClass.getName()).sort();
}

/** The cluster's guest classes as the store already holds them: free, and usually right. */
function storedGuestClassNames(): string[] {
  const store = maybe(() => SwiftGuestClass.getStore<SwiftGuestClass>());

  return (store?.items ?? []).map((guestClass) => guestClass.getName());
}

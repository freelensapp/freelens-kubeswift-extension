/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Restore form, the second create surface of SPEC-0011 and the first one
// whose write can destroy something. Every decision it renders - which modes are
// offered, what a refused one says, which fields exist at all, which are invalid,
// what the write summary lists, what the payload is - belongs to
// `restore-create.ts`. What lives here is the host wiring, and it is deliberately
// the same wiring `snapshot-create-dialog.tsx` uses, for the same three host
// facts the spikes settled:
//
// - `ConfirmDialog.open` is the dialog host. A self-rendered `Dialog` works in
//   the drawer toolbar and dies in the list row kebab, so it cannot satisfy W5's
//   both-surfaces rule.
// - The form model lives OUTSIDE React, in a per-open MobX observable owned by
//   the menu item, and this component is an `observer` over it: the 409 path
//   reopens the dialog, which remounts the message and would wipe React-local
//   state exactly when the user needs it most.
// - The OK button reacts to nothing except an `okButtonProps` that is itself a
//   MobX observable object. A plain object is inert.
//
// One thing is genuinely new here: the form has a control whose value the user
// cannot change - the MAC rewrite of a memory clone, which upstream requires -
// and a control whose target changes what another control means - the mode,
// which decides whether the identity checkboxes exist at all. Both are rendered
// with their reason next to them rather than silently.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftRestore } from "../api/kubeswift/swiftrestore-v1alpha1";
import { dialogReopenDelay, Field, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts, notFoundStatusCode } from "./guest-actions";
import {
  conflictStatusCode,
  defaultRestoreForm,
  inPlaceWedges,
  inPlaceWedgeWarning,
  macAddressLock,
  macAddressLockRule,
  memoryRestoreModes,
  restoreCreateFailureMessage,
  restoreCreatePayload,
  restoreErrors,
  restoreIsAccented,
  restoreModeChoices,
  restoreSubmitBlockReason,
  restoreSuccessMessage,
  restoreSummary,
  restoreTargetName,
  restoreWarnings,
  snapshotCapturesMemory,
  targetNodeFacts,
} from "./restore-create";

import type { SwiftRestoreMemoryRestoreMode } from "../api/kubeswift/swiftrestore-v1alpha1";
import type { FieldProps } from "./create-dialog";
import type {
  ExistingGuestFacts,
  RestoreFormValues,
  RestoreMode,
  RestoreSnapshotFacts,
  SourceGuestReading,
} from "./restore-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, Notifications, Radio, RadioGroup, Select },
  K8sApi: { nodesApi },
} = Renderer;

/** The verb, on the item, on the OK button and in the failure sentences. */
export const restoreTitle = "Restore";

/** What the one-shot read of the cluster's Nodes found (spike T3). */
export interface NodePickerFacts {
  /** `unavailable` is any failure: the field degrades to a text input, and nothing is blocked. */
  state: "loading" | "ready" | "unavailable";
  names: string[];
}

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most.
 */
export interface RestoreDialogModel {
  snapshot: RestoreSnapshotFacts;
  values: RestoreFormValues;
  /** What the one cheap read of the source guest found on open (B3, spike T4). */
  source: SourceGuestReading;
  /** The namespace's SwiftRestores, by name, for the name collision warning. */
  existingRestores: string[];
  /** The namespace's SwiftGuests, for the target collision warning and the node rule. */
  existingGuests: ExistingGuestFacts[];
  nodes: NodePickerFacts;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

function syncOkButton(model: RestoreDialogModel): void {
  const accent = restoreIsAccented(model.values);

  model.okButtonProps.disabled = Boolean(restoreSubmitBlockReason(model.snapshot, model.values, model.existingGuests));
  model.okButtonProps.accent = accent;
  model.okButtonProps.primary = !accent;
}

/**
 * A fresh model for one opening of the dialog, with the defaults the spec's
 * field table names.
 *
 * `snapshot` and the two store snapshots are refs: they are taken at click time
 * (W1), and nothing in the form mutates them.
 */
export function createRestoreDialogModel(
  snapshot: RestoreSnapshotFacts,
  existingRestores: string[],
  existingGuests: ExistingGuestFacts[],
  now: Date,
): RestoreDialogModel {
  const model = Mobx.observable(
    {
      snapshot,
      values: defaultRestoreForm(snapshot, now),
      // Nothing is known about the source guest until the read on open answers,
      // and "unreadable" is the reading that blocks nothing and claims nothing.
      source: { outcome: "unreadable" } as SourceGuestReading,
      existingRestores,
      existingGuests,
      nodes: { state: "loading", names: [] } as NodePickerFacts,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    {
      snapshot: Mobx.observable.ref,
      source: Mobx.observable.ref,
      existingRestores: Mobx.observable.ref,
      existingGuests: Mobx.observable.ref,
    },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/**
 * The one way the form changes, so the OK button can never drift out of step
 * with the values it is a verdict on.
 */
export const updateRestoreForm = Mobx.action((model: RestoreDialogModel, patch: Partial<RestoreFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/**
 * The source guest, as one `GET` on open (B3, spike T4).
 *
 * The three outcomes are the whole point: a guest that is there gives the
 * in-place summary its live phase, pod and run policy - which is what makes the
 * wedge warning a fact rather than a guess; a classified 404 refuses the in-place
 * mode outright; and anything else degrades the sentences without blocking the
 * write. The failure code lives at `error.error.code` rather than `error.code`,
 * which is why `apiFailureFacts` is reused verbatim rather than reimplemented.
 */
export async function loadSourceGuest(model: RestoreDialogModel): Promise<void> {
  const name = model.snapshot.sourceGuestName;

  if (!name) {
    return;
  }

  let source: SourceGuestReading;

  try {
    const guest = await SwiftGuest.getStore<SwiftGuest>().api.get({ name, namespace: model.snapshot.namespace });

    source = guest
      ? {
          outcome: "present",
          phase: guest.status?.phase,
          runPolicy: guest.spec?.runPolicy,
          podName: guest.status?.podRef?.name,
        }
      : { outcome: "absent" };
  } catch (error) {
    source = { outcome: apiFailureFacts(error).code === notFoundStatusCode ? "absent" : "unreadable" };
  }

  Mobx.runInAction(() => {
    model.source = source;
    syncOkButton(model);
  });
}

/**
 * The namespace's SwiftRestores and SwiftGuests, as one list call each on open.
 *
 * The click-time seed from the stores is what the dialog opens with - free, and
 * usually right when the user came from one of those pages - and these refine it.
 * Like every read on open they are never awaited and never allowed to throw: a
 * store that says nothing produces no warnings and no node default, and the 409
 * path stays the backstop.
 */
export async function loadExistingRestores(model: RestoreDialogModel): Promise<void> {
  try {
    const restores = await SwiftRestore.getStore<SwiftRestore>().api.list({ namespace: model.snapshot.namespace });

    if (!restores) {
      return;
    }

    const names = restores.map((restore) => restore.getName());

    Mobx.runInAction(() => {
      model.existingRestores = names;
    });
  } catch {
    // Nothing: the dialog keeps whatever the store already gave it.
  }
}

export async function loadExistingGuests(model: RestoreDialogModel): Promise<void> {
  try {
    const guests = await SwiftGuest.getStore<SwiftGuest>().api.list({ namespace: model.snapshot.namespace });

    if (!guests) {
      return;
    }

    const existing = guests.map((guest) => ({
      name: guest.getName(),
      nodeName: guest.status?.nodeName || guest.spec?.nodeName,
    }));

    Mobx.runInAction(() => {
      model.existingGuests = existing;
      // The node rule reads this list, so the submit verdict can change with it.
      syncOkButton(model);
    });
  } catch {
    // Nothing: the dialog keeps whatever the store already gave it.
  }
}

/**
 * The cluster's Nodes, as one list call on open (spike T3), for the target node
 * picker.
 *
 * Only issued where the field exists at all, and degrading to a text input on any
 * failure: a refused read must not stop a user from typing the node they know.
 */
export async function loadNodeNames(model: RestoreDialogModel): Promise<void> {
  try {
    const nodes = await nodesApi.list();
    const names = (nodes ?? []).map((node) => node.getName()).sort();

    Mobx.runInAction(() => {
      model.nodes.names = names;
      model.nodes.state = "ready";
    });
  } catch {
    Mobx.runInAction(() => {
      model.nodes.state = "unavailable";
    });
  }
}

interface TextFieldProps extends FieldProps {
  model: RestoreDialogModel;
  field: keyof RestoreFormValues;
  testId: string;
  placeholder?: string;
}

/** A text input bound to one field of the model. */
const TextField = observer(({ model, field, testId, placeholder, ...fieldProps }: TextFieldProps) => (
  <Field {...fieldProps}>
    <Input
      value={String(model.values[field] ?? "")}
      placeholder={placeholder}
      data-testid={testId}
      onChange={(value: string) => updateRestoreForm(model, { [field]: value } as Partial<RestoreFormValues>)}
    />
  </Field>
));

/**
 * The mode radio, and the reason the refused one carries (W4).
 *
 * The first control in the dialog on purpose. Upstream infers the mode from
 * whether the typed name happens to equal the source guest's, surfaces it as a
 * hint, and hides the overwrite consent on the path where a typo turns one mode
 * into the other. An explicit control costs one radio row and removes the whole
 * failure class (C10).
 *
 * The reason is rendered inside the option's own label rather than as a tooltip:
 * a disabled radio cannot be hovered either, and a reason nobody can reach is not
 * a reason.
 */
const ModeField = observer(({ model }: { model: RestoreDialogModel }) => {
  const choices = restoreModeChoices(model.snapshot, model.source);
  const wedges = inPlaceWedges(model.values, model.source);

  return (
    <div className={styles.field} data-testid="restore-mode">
      <div className={styles.label}>Mode</div>
      <RadioGroup
        className={styles.options}
        value={model.values.mode}
        onChange={(mode: RestoreMode) => updateRestoreForm(model, { mode })}
      >
        {choices.map((choice) => (
          <Radio
            key={choice.mode}
            value={choice.mode}
            disabled={!choice.guard.enabled}
            label={
              <>
                {/* The host's `Radio` takes no test id of its own, and the
                    refused option's reason contains the name of the other one,
                    so the option cannot be addressed by its text either. */}
                <span data-testid={`restore-mode-${choice.mode}`}>{choice.label}</span>
                {choice.guard.enabled ? null : <div className={styles.optionReason}>{choice.guard.reason}</div>}
              </>
            }
          />
        ))}
      </RadioGroup>
      {/* The same sentence the summary carries, repeated here on purpose: this
          form is tall enough that the summary sits below the fold of the
          dialog's own scroll area, and the cost of choosing this mode has to be
          visible at the moment it is chosen (the slice-1 precedent, which caught
          exactly this - an accent button whose reason needed scrolling to). */}
      {wedges ? (
        <div className={styles.warning}>{inPlaceWedgeWarning(restoreTargetName(model.snapshot, model.values))}</div>
      ) : null}
    </div>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const RestoreWriteSummary = observer(({ model }: { model: RestoreDialogModel }) => (
  <WriteSummary facts={restoreSummary(model.snapshot, model.values, model.source)} />
));

/**
 * The target node: a picker over the cluster's Nodes when the one-shot read
 * answered, a plain text input otherwise.
 *
 * Rendered only where the controller consults the field - `s3` and `oci` - and
 * its required-ness is recomputed from the target name as it is typed, because
 * that is what upstream keys on: a restore whose target guest does not exist yet
 * and which names no node fails outright.
 */
const TargetNodeField = observer(({ model }: { model: RestoreDialogModel }) => {
  const facts = targetNodeFacts(model.snapshot, model.values, model.existingGuests);

  if (!facts.applies) {
    return null;
  }

  const errors = restoreErrors(model.snapshot, model.values, model.existingGuests);
  const value = model.values.targetNode;
  const listed = model.nodes.names.includes(value);
  const hint = facts.required ? "Required: the artifacts are downloaded to this node." : facts.note;

  if (model.nodes.state !== "ready" || model.nodes.names.length === 0 || (value !== "" && !listed)) {
    return (
      <TextField
        model={model}
        field="targetNode"
        testId="restore-target-node"
        label="Target node"
        error={errors.targetNode}
        hint={
          model.nodes.state === "unavailable"
            ? `${hint ?? ""} The cluster's nodes could not be listed, so the name is not verified.`.trim()
            : hint
        }
      />
    );
  }

  return (
    <Field label="Target node" hint={hint} error={errors.targetNode}>
      <Select
        id="restore-target-node"
        themeName="light"
        menuClass={styles.selectMenu}
        isClearable
        value={value || null}
        options={model.nodes.names.map((name) => ({ value: name, label: name }))}
        onChange={(option: { value: string } | null) => updateRestoreForm(model, { targetNode: option?.value ?? "" })}
      />
    </Field>
  );
});

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's own
 * re-renders, and the reopen after a 409, harmless.
 */
export const RestoreCreateForm = observer(({ model }: { model: RestoreDialogModel }) => {
  const { snapshot, values } = model;
  const errors = restoreErrors(snapshot, values, model.existingGuests);
  const warnings = restoreWarnings(values, model.existingRestores, model.existingGuests);
  const blocked = restoreSubmitBlockReason(snapshot, values, model.existingGuests);
  const clone = values.mode === "clone";
  const memory = snapshotCapturesMemory(snapshot);
  const macLocked = macAddressLock(snapshot, values);

  return (
    <div className={styles.form} data-testid="swiftsnapshot-restore-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Restore "}
        <b>{`SwiftSnapshot ${snapshot.namespace}/${snapshot.name}`}</b>
      </p>

      <ModeField model={model} />

      <TextField
        model={model}
        field="name"
        testId="restore-name"
        label="Name"
        hint="The name of the SwiftRestore object this creates, not of the guest."
        error={errors.name}
        warning={warnings.name}
      />

      {clone ? (
        <TextField
          model={model}
          field="targetName"
          testId="restore-target-name"
          label="Target guest"
          hint="The new SwiftGuest this restore creates."
          error={errors.targetName}
          warning={warnings.targetName}
        />
      ) : (
        <Field label="Target guest" hint="Fixed to the guest this snapshot was taken from: in place is not a rename.">
          <div className={styles.readOnlyValue} data-testid="restore-target-guest">
            {restoreTargetName(snapshot, values) || "N/A"}
          </div>
        </Field>
      )}

      {clone ? (
        <div className={styles.checkboxRow} data-testid="restore-regenerate-identity">
          <Checkbox
            label="Regenerate machine identity"
            value={values.regenerateMachineIdentity}
            onChange={(value: boolean) => updateRestoreForm(model, { regenerateMachineIdentity: value })}
          />
          {/* One checkbox for three enum values, because upstream collapses them
              into ONE marker annotation and leaves the work to in-guest
              cloud-init. Three checkboxes would promise a granularity the
              implementation does not have, and this caveat is the honest half of
              the one checkbox that is left. */}
          <div className={styles.hint}>
            Hostname, machine ID and SSH host keys. The work happens inside the guest, through cloud-init: a guest whose
            seed profile does not run it keeps the identity it was cloned with.
          </div>
        </div>
      ) : null}

      {clone ? (
        <div
          className={styles.checkboxRow}
          data-testid="restore-rewrite-mac"
          // The lock's reason, on the attribute that survives a control the user
          // cannot interact with - the same channel the disabled menu items use
          // for their guard reason (SPEC-0010 spike S7).
          title={macLocked ? macAddressLockRule : undefined}
        >
          <Checkbox
            label="Rewrite MAC addresses"
            disabled={macLocked}
            value={macLocked || values.rewriteMacAddresses}
            onChange={(value: boolean) => updateRestoreForm(model, { rewriteMacAddresses: value })}
          />
          {macLocked ? <div className={styles.warning}>{macAddressLockRule}</div> : null}
        </div>
      ) : null}

      {memory ? (
        <Field
          label="Memory restore mode"
          hint={
            values.memoryRestoreMode === "ondemand"
              ? "Demand paging: the guest resumes immediately and faults its pages in. Needs Cloud Hypervisor v52 or newer."
              : "Eager: the whole memory image is read before the guest resumes."
          }
        >
          <Select
            id="restore-memory-restore-mode"
            themeName="light"
            menuClass={styles.selectMenu}
            value={values.memoryRestoreMode}
            options={memoryRestoreModes.map((mode) => ({ value: mode, label: mode }))}
            onChange={(option: { value: SwiftRestoreMemoryRestoreMode } | null) =>
              option && updateRestoreForm(model, { memoryRestoreMode: option.value })
            }
          />
        </Field>
      ) : null}

      <div className={styles.checkboxRow} data-testid="restore-resume-after-restore">
        <Checkbox
          label="Resume after restore"
          value={values.resumeAfterRestore}
          onChange={(value: boolean) => updateRestoreForm(model, { resumeAfterRestore: value })}
        />
        {/* The summary carries this too, and this form is tall enough that the
            summary can sit below the fold of the dialog's own scroll area: a cost
            has to be visible at the moment it is chosen (the slice-1 precedent). */}
        {memory && !values.resumeAfterRestore ? (
          <div className={styles.warning}>
            The restore is recorded to hang in Restoring on a memory snapshot when this is off. The guest is created and
            stays Stopped.
          </div>
        ) : null}
      </div>

      <TargetNodeField model={model} />

      <RestoreWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="restore-submit-blocked">
          {`${restoreTitle} is disabled - ${blocked}`}
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
async function submitRestore(model: RestoreDialogModel, params: Renderer.Component.ConfirmDialogParams): Promise<void> {
  const { snapshot, values } = model;
  const name = values.name.trim();
  // Not zero: reopening inside the host's own 100ms leave animation leaves the
  // dialog at `opacity: 0` forever (the mechanism is on `dialogReopenDelay`).
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), dialogReopenDelay);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = restoreSubmitBlockReason(snapshot, values, model.existingGuests);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftRestore.getStore<SwiftRestore>().create(
      { name, namespace: snapshot.namespace },
      restoreCreatePayload(snapshot, values),
    );
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        restoreCreateFailureMessage(failure, { namespace: snapshot.namespace, name }) ?? error,
        `Could not create the SwiftRestore ${snapshot.namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  // Fired from a page that does not show the created row: the SwiftRestore lands
  // on the Restores page, which upstream's own UI does not have at all (W9).
  Notifications.ok(restoreSuccessMessage(name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can reopen
 * exactly the same dialog rather than build a second one.
 */
export function openRestoreDialog(model: RestoreDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: restoreTitle,
    // No icon: the host's default is a warning triangle, and a clone restore is
    // not destructive. What IS destructive - the in-place mode - says so in the
    // summary, in the warning style, and turns the OK button to the accent
    // styling Stop uses.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <RestoreCreateForm model={model} />,
    ok: () => submitRestore(model, params),
  };

  ConfirmDialog.open(params);
}

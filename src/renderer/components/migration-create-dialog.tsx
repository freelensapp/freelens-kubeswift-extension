/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Migrate form, the third create surface of the milestone (SPEC-0012) and
// the first whose write moves a running workload to another machine. Every
// decision it renders - which modes are offered, what a refused one says, what
// `auto` will resolve to, which fields exist at all, which are invalid, what the
// write summary lists, what the payload is - belongs to `migration-create.ts`.
// What lives here is the host wiring, and it is deliberately the same wiring the
// two SPEC-0011 dialogs use, for the same three host facts the spikes settled:
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
// Two things are new here. The target node is a REQUIRED picker built from a
// read that can fail, so it has three renderings - a select, a text input when
// the read was refused or the value is not in the list, and an honest empty
// sentence when the cluster has no node this guest could move to. And the mode
// select shows what `auto` will resolve to, recomputed from the same inputs the
// controller uses, which is the one place this dialog blocks a submit upstream
// would have accepted (drift D1).

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { SwiftMigration } from "../api/kubeswift/swiftmigration-v1alpha1";
import { Field, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import {
  conflictStatusCode,
  defaultMigrationForm,
  freshIpFact,
  inFlightMigrations,
  inFlightWarning,
  ipConsentApplies,
  ipConsentLockRule,
  liveFieldsApply,
  migrationCreateFailureMessage,
  migrationCreatePayload,
  migrationErrors,
  migrationIsAccented,
  migrationModeChoices,
  migrationSubmitBlockReason,
  migrationSuccessMessage,
  migrationSummary,
  migrationWarnings,
  nodeChoices,
  noNodeReason,
  storageCapability,
} from "./migration-create";

import type { SwiftMigrationMode } from "../api/kubeswift/swiftmigration-v1alpha1";
import type { FieldProps } from "./create-dialog";
import type {
  InFlightMigrationFacts,
  MigrationFormValues,
  MigrationGuestClassFacts,
  MigrationGuestFacts,
  MigrationInputs,
  NodeFacts,
} from "./migration-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, Notifications, Select },
  K8sApi: { nodesApi },
  Navigation: { showDetails },
} = Renderer;

/** The verb, on the item, on the OK button and in the failure sentences. */
export const migrateTitle = "Migrate";

/** What the one-shot read of the cluster's Nodes found (spike T3). */
export interface NodePickerFacts {
  /** `unavailable` is any failure: the field degrades to a text input, and nothing is blocked. */
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
export interface MigrationDialogModel {
  guest: MigrationGuestFacts;
  values: MigrationFormValues;
  /** The guest's class, for the storage capability; `undefined` until a read answers. */
  guestClass?: MigrationGuestClassFacts;
  nodes: NodePickerFacts;
  /** The non-terminal migrations of this guest, for the warning no upstream surface has. */
  inFlight: InFlightMigrationFacts[];
  /** The namespace's SwiftMigrations, by name, for the collision warning. */
  existingNames: string[];
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/**
 * The model as the pure module reads it.
 *
 * One shape for every decision, rebuilt on each render of an `observer`, so a
 * function can never see a mix of the click-time snapshot and a later read.
 */
export function migrationInputs(model: MigrationDialogModel): MigrationInputs {
  return {
    guest: model.guest,
    guestClass: model.guestClass,
    nodes: model.nodes.items,
    nodesUnverified: model.nodes.state === "unavailable",
    inFlight: model.inFlight,
    existingNames: model.existingNames,
  };
}

function syncOkButton(model: MigrationDialogModel): void {
  const inputs = migrationInputs(model);
  const accent = migrationIsAccented(inputs, model.values);

  model.okButtonProps.disabled = Boolean(migrationSubmitBlockReason(inputs, model.values));
  model.okButtonProps.accent = accent;
  model.okButtonProps.primary = !accent;
}

/**
 * A fresh model for one opening of the dialog, with the defaults the spec's
 * field table names.
 *
 * `guest` and the store snapshots are refs: they are taken at click time (W1),
 * and nothing in the form mutates them.
 */
export function createMigrationDialogModel(
  guest: MigrationGuestFacts,
  seed: { guestClass?: MigrationGuestClassFacts; inFlight: InFlightMigrationFacts[]; existingNames: string[] },
  now: Date,
): MigrationDialogModel {
  const model = Mobx.observable(
    {
      guest,
      values: defaultMigrationForm(guest, now),
      guestClass: seed.guestClass,
      nodes: { state: "loading", items: [] } as NodePickerFacts,
      inFlight: seed.inFlight,
      existingNames: seed.existingNames,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    {
      guest: Mobx.observable.ref,
      guestClass: Mobx.observable.ref,
      inFlight: Mobx.observable.ref,
      existingNames: Mobx.observable.ref,
    },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/**
 * The one way the form changes, so the OK button can never drift out of step
 * with the values it is a verdict on.
 */
export const updateMigrationForm = Mobx.action((model: MigrationDialogModel, patch: Partial<MigrationFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/**
 * The cluster's Nodes, as one list call on open (spike T3), for the target node
 * picker.
 *
 * The picker is this dialog's one required field, so the degradation matters
 * more here than it did in SPEC-0011: any failure turns it into a text input and
 * marks the node unverified in the summary, because a refused read must not stop
 * a user from typing the node they know.
 */
export async function loadNodes(model: MigrationDialogModel): Promise<void> {
  try {
    const nodes = await nodesApi.list();
    const items = (nodes ?? [])
      .map((node) => ({
        name: node.getName(),
        ready: (node.status?.conditions ?? []).some(
          (condition) => condition.type === "Ready" && condition.status === "True",
        ),
        schedulable: node.spec?.unschedulable !== true,
        labels: node.metadata?.labels,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    Mobx.runInAction(() => {
      model.nodes.items = items;
      model.nodes.state = "ready";
      // The node rules decide the submit verdict, so it is recomputed with them.
      syncOkButton(model);
    });
  } catch {
    Mobx.runInAction(() => {
      model.nodes.state = "unavailable";
      syncOkButton(model);
    });
  }
}

/**
 * The guest's class, as one `GET` on open, for the storage capability.
 *
 * Cluster-scoped, so no namespace is sent. Never awaited and never allowed to
 * throw: a class nobody can read leaves the storage unresolved, which keeps the
 * live mode offered with an unverified-storage warning rather than refusing it
 * on a failed read (W4).
 */
export async function loadGuestClass(model: MigrationDialogModel): Promise<void> {
  const name = model.guest.spec?.guestClassRef?.name;

  if (!name) {
    return;
  }

  try {
    const guestClass = await SwiftGuestClass.getStore<SwiftGuestClass>().api.get({ name });

    if (!guestClass) {
      return;
    }

    const facts = { name, storage: guestClass.spec?.storage };

    Mobx.runInAction(() => {
      model.guestClass = facts;
      // The storage gate can flip the live option and the auto block with it.
      syncOkButton(model);
    });
  } catch {
    // Nothing: the dialog keeps whatever the store already gave it.
  }
}

/**
 * The namespace's SwiftMigrations, as one list call on open: the names for the
 * collision warning, and the non-terminal ones referencing this guest for the
 * in-flight warning.
 *
 * The click-time seed from the store is what the dialog opens with - free, and
 * usually right when the user came from the Migrations page - and this refines
 * it. Like every read on open it is never awaited and never allowed to throw.
 */
export async function loadExistingMigrations(model: MigrationDialogModel): Promise<void> {
  try {
    const migrations = await SwiftMigration.getStore<SwiftMigration>().api.list({
      namespace: model.guest.namespace,
    });

    if (!migrations) {
      return;
    }

    const existingNames = migrations.map((migration) => migration.getName());
    const inFlight = inFlightMigrationFacts(migrations, model.guest.name);

    Mobx.runInAction(() => {
      model.existingNames = existingNames;
      model.inFlight = inFlight;
    });
  } catch {
    // Nothing: the dialog keeps whatever the store already gave it.
  }
}

/**
 * The migrations of this guest that have not finished, from live objects.
 *
 * Shared with the menu item, which seeds the same facts from the store before
 * the list call answers. The filtering itself is `inFlightMigrations`, in the
 * pure module: what lives here is only the reading of a host object.
 */
export function inFlightMigrationFacts(migrations: SwiftMigration[], guestName: string): InFlightMigrationFacts[] {
  return inFlightMigrations(
    guestName,
    migrations.map((migration) => ({
      name: migration.getName(),
      guestName: SwiftMigration.getGuestName(migration),
      phase: SwiftMigration.getPhase(migration),
      mode: SwiftMigration.getMode(migration),
      selfLink: migration.selfLink,
    })),
  );
}

interface TextFieldProps extends FieldProps {
  model: MigrationDialogModel;
  field: keyof MigrationFormValues;
  testId: string;
  placeholder?: string;
  type?: string;
}

/** A text input bound to one field of the model. */
const TextField = observer(({ model, field, testId, placeholder, type, ...fieldProps }: TextFieldProps) => (
  <Field {...fieldProps}>
    <Input
      value={String(model.values[field] ?? "")}
      placeholder={placeholder}
      type={type}
      data-testid={testId}
      onChange={(value: string) => updateMigrationForm(model, { [field]: value } as Partial<MigrationFormValues>)}
    />
  </Field>
));

/**
 * The target node: a picker over the nodes that can take this guest, a text
 * input when the read was refused, and an honest sentence when nothing is left
 * to offer.
 *
 * The exclusions are upstream's own (the guest's current node is the webhook's
 * same-node refusal, which is the difference between a migration and a reboot),
 * and the kernel-node rule is rendered as a disabled option with its reason
 * rather than as a silent omission: a node that exists and cannot be used is
 * exactly the case W4 exists for.
 */
const TargetNodeField = observer(({ model }: { model: MigrationDialogModel }) => {
  const inputs = migrationInputs(model);
  const errors = migrationErrors(inputs, model.values);
  const choices = nodeChoices(inputs);
  const value = model.values.targetNode;
  const listed = choices.some((choice) => choice.name === value);

  if (model.nodes.state === "ready" && model.nodes.items.length > 0 && choices.length === 0) {
    return (
      <Field label="Target node" error={errors.targetNode}>
        <div className={styles.readOnlyValue} data-testid="migration-no-nodes">
          {noNodeReason(inputs)}
        </div>
      </Field>
    );
  }

  if (model.nodes.state !== "ready" || (value !== "" && !listed)) {
    return (
      <TextField
        model={model}
        field="targetNode"
        testId="migration-target-node"
        label="Target node"
        error={errors.targetNode}
        hint={
          model.nodes.state === "unavailable"
            ? "The cluster's nodes could not be listed, so this name is not verified: whether it exists, is Ready " +
              "and can take this guest is unknown from here."
            : "The node this guest moves to. Its own node is never offered: a same-node migration is a reboot."
        }
      />
    );
  }

  return (
    <Field
      label="Target node"
      hint="Ready and schedulable nodes, without the one this guest is already on."
      error={errors.targetNode}
    >
      <Select
        id="migration-target-node"
        themeName="light"
        menuClass={styles.selectMenu}
        value={value || null}
        options={choices.map((choice) => ({
          value: choice.name,
          label: choice.guard.enabled ? choice.name : `${choice.name} - ${choice.guard.reason}`,
          isDisabled: !choice.guard.enabled,
        }))}
        onChange={(option: { value: string } | null) => updateMigrationForm(model, { targetNode: option?.value ?? "" })}
      />
    </Field>
  );
});

/**
 * The mode select, with what each mode means for THIS guest and the reason the
 * refused one carries (W4, M2).
 *
 * `auto`'s option says what it will resolve to and why, because a default that
 * silently becomes a live migration is the shape drift D1 is made of. When that
 * prediction is `live` and the storage cannot carry it, the error under the
 * control is the one place this dialog blocks a submit upstream would accept.
 */
const ModeField = observer(({ model }: { model: MigrationDialogModel }) => {
  const inputs = migrationInputs(model);
  const errors = migrationErrors(inputs, model.values);
  const choices = migrationModeChoices(inputs, model.values.targetNode.trim());
  const selected = choices.find((choice) => choice.mode === model.values.mode);
  const refused = choices.filter((choice) => !choice.guard.enabled);

  return (
    <Field
      label="Mode"
      hint={selected?.note}
      error={errors.mode}
      warning={
        refused.length > 0
          ? `${refused.map((choice) => choice.mode).join(", ")}: ${refused[0].guard.reason}`
          : undefined
      }
    >
      <Select
        id="migration-mode"
        themeName="light"
        menuClass={styles.selectMenu}
        value={model.values.mode}
        options={choices.map((choice) => ({
          value: choice.mode,
          // The refused option carries its whole reason, because a reason
          // nobody opens a dropdown to read is a reason nobody reads; the
          // offered ones stay short, and the sentence under the control says
          // what the selected one means for this guest.
          label: choice.guard.enabled ? choice.label : `${choice.label} - ${choice.guard.reason}`,
          isDisabled: !choice.guard.enabled,
        }))}
        onChange={(option: { value: SwiftMigrationMode } | null) =>
          option && updateMigrationForm(model, { mode: option.value })
        }
      />
    </Field>
  );
});

/**
 * The migrations of this guest that are still running, named and linked.
 *
 * Rendered at the top of the form as well as in the summary, for the reason both
 * SPEC-0011 dialogs render their sharpest sentence twice: this form is tall
 * enough that the summary sits below the fold of the dialog's own scroll area.
 * The link is what makes it actionable - the drawer of the other migration opens
 * behind this dialog - and it is the one fact here that no upstream surface has
 * at all, because only a client holding every SwiftMigration can see it.
 */
const InFlightWarning = observer(({ model }: { model: MigrationDialogModel }) => {
  if (model.inFlight.length === 0) {
    return null;
  }

  return (
    <div className={styles.field} data-testid="migration-in-flight">
      {model.inFlight.map((migration) => (
        <div className={styles.warning} key={migration.name}>
          {migration.selfLink ? (
            <a
              href="#"
              onClick={(event) => {
                event.preventDefault();
                showDetails(migration.selfLink);
              }}
            >
              {migration.name}
            </a>
          ) : (
            migration.name
          )}
          {`: ${inFlightWarning(migration)}`}
        </div>
      ))}
    </div>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const MigrationWriteSummary = observer(({ model }: { model: MigrationDialogModel }) => (
  <WriteSummary facts={migrationSummary(migrationInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's own
 * re-renders, and the reopen after a 409, harmless.
 */
export const MigrationCreateForm = observer(({ model }: { model: MigrationDialogModel }) => {
  const { guest, values } = model;
  const inputs = migrationInputs(model);
  const errors = migrationErrors(inputs, values);
  const warnings = migrationWarnings(inputs, values);
  const blocked = migrationSubmitBlockReason(inputs, values);
  const consent = ipConsentApplies(guest);
  const live = liveFieldsApply(inputs, values);
  const storage = storageCapability(inputs);

  return (
    <div className={styles.form} data-testid="swiftguest-migrate-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Migrate "}
        <b>{`SwiftGuest ${guest.namespace}/${guest.name}`}</b>
      </p>

      <InFlightWarning model={model} />

      <TextField
        model={model}
        field="name"
        testId="migration-name"
        label="Name"
        hint="The name of the SwiftMigration object this creates."
        error={errors.name}
        warning={warnings.name}
      />

      <TargetNodeField model={model} />

      <ModeField model={model} />

      {consent ? (
        <div
          className={styles.checkboxRow}
          data-testid="migration-allow-ip-change"
          // The lock's reason, on the attribute that survives a control the user
          // cannot interact with - the same channel the disabled menu items use
          // for their guard reason (SPEC-0010 spike S7).
          title={ipConsentLockRule}
        >
          <Checkbox label="Allow the guest's IP to change" disabled value={true} />
          <div className={styles.warning}>{freshIpFact}</div>
          <div className={styles.hint}>{ipConsentLockRule}</div>
        </div>
      ) : null}

      {live ? (
        <>
          <TextField
            model={model}
            field="timeout"
            testId="migration-timeout"
            label="Timeout"
            placeholder="30m"
            hint="Empty uses the schema default of 30m. Between 60s and 24h; read in live mode only."
            error={errors.timeout}
          />
          <TextField
            model={model}
            field="downtimeTarget"
            testId="migration-downtime-target"
            label="Downtime target"
            placeholder="500ms"
            hint="The pause window Cloud Hypervisor aims for, between 10ms and 10s. The migration records what it applied."
            error={errors.downtimeTarget}
          />
          <TextField
            model={model}
            field="parallelConnections"
            testId="migration-parallel-connections"
            label="Parallel connections"
            type="number"
            placeholder="0"
            hint="TCP connections for the memory stream, 0 to 16. Two or more become the hypervisor's own connection count."
            error={errors.parallelConnections}
          />
        </>
      ) : null}

      <TextField
        model={model}
        field="reason"
        testId="migration-reason"
        label="Reason"
        placeholder="node maintenance"
        hint="Optional, for the audit trail. At most 256 characters."
        error={errors.reason}
      />

      <TextField
        model={model}
        field="ttl"
        testId="migration-ttl"
        label="TTL"
        placeholder="24h"
        hint={
          values.ttl.trim()
            ? "The record self-deletes this long after the migration finishes. On a cluster with scoped launcher " +
              "RBAC, a completed live migration's record owns the running pod's RBAC grant, which goes with it."
            : "Optional. The record self-deletes this long after the migration finishes."
        }
        error={errors.ttl}
      />

      {/* The unverified-storage case, said where the mode is chosen as well as
          in the summary: a live migration whose storage nobody could read is a
          migration whose central precondition is unknown. */}
      {live && !storage.resolved ? (
        <p className={styles.warning} data-testid="migration-storage-unverified">
          The storage of this guest could not be resolved, so whether it is ReadWriteMany and Block is unverified. A
          live migration needs both.
        </p>
      ) : null}

      <MigrationWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="migration-submit-blocked">
          {`${migrateTitle} is disabled - ${blocked}`}
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
async function submitMigration(
  model: MigrationDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const { guest, values } = model;
  const inputs = migrationInputs(model);
  const name = values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = migrationSubmitBlockReason(inputs, values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftMigration.getStore<SwiftMigration>().create(
      { name, namespace: guest.namespace },
      migrationCreatePayload(inputs, values),
    );
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        migrationCreateFailureMessage(failure, { namespace: guest.namespace, name }) ?? error,
        `Could not create the SwiftMigration ${guest.namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  // Fired from the Guests page, where the created row is not visible: the
  // SwiftMigration lands on the Migrations page, which shows it phase by phase
  // with the progress and downtime columns SPEC-0004 already ships (W9).
  Notifications.ok(migrationSuccessMessage(name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can reopen
 * exactly the same dialog rather than build a second one.
 */
export function openMigrateDialog(model: MigrationDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: migrateTitle,
    // No icon: the host's default is a warning triangle, and a migration is a
    // commitment rather than a termination. What IS a termination here - an
    // offline migration of a running guest, which stops it - says so in the
    // summary, in the warning style, and turns the OK button to the accent
    // styling Stop uses.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <MigrationCreateForm model={model} />,
    ok: () => submitMigration(model, params),
  };

  ConfirmDialog.open(params);
}

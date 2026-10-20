/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Take Snapshot form, and the extension's first create surface (SPEC-0011).
// Every decision it renders - which backends are offered, what each disabled one
// says, which fields are invalid, what the write summary lists, what the payload
// is - belongs to `snapshot-create.ts`. What lives here is the host wiring, and
// three host facts settled by the spikes shape all of it:
//
// - `ConfirmDialog.open` is the dialog host. A self-rendered `Dialog` works in
//   the drawer toolbar and dies in the list row kebab (`MenuActions` renders the
//   kebab menu `animated`, and `Animate`'s leave path returns `null`, which
//   unmounts the dialog ~100 ms after the menu closes), so it cannot satisfy
//   W5's both-surfaces rule.
// - The form model lives OUTSIDE React, in a per-open MobX observable owned by
//   the menu item, and this component is an `observer` over it. The reason is
//   the 409 path below: reopening the dialog remounts the message and would wipe
//   any React-local state, which would turn "the dialog survives with the form
//   intact" into a lie.
// - The OK button reacts to nothing except an `okButtonProps` that is itself a
//   MobX observable object. A plain object is inert: the host reads it once per
//   render of its own, and nothing re-renders it.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import {
  SwiftClusterStorageLocation,
  type SwiftClusterStorageLocationStore,
} from "../api/kubeswift/swiftclusterstoragelocation-v1alpha1";
import { SwiftSnapshot, type SwiftSnapshotStore } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import {
  type StorageLocationSpec,
  type StorageLocationStatus,
  SwiftStorageLocation,
  type SwiftStorageLocationStore,
  storageLocationConditionValue,
  storageLocationCredentialsSecret,
} from "../api/kubeswift/swiftstoragelocation-v1alpha1";
import { dialogReopenDelay, Field, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import { apiFailureFacts } from "./guest-actions";
import {
  backendChoices,
  conflictStatusCode,
  createFailureMessage,
  defaultSnapshotForm,
  deletionPolicies,
  frozenVmWarning,
  isMemoryBackend,
  localSnapshotDirectory,
  ociReference,
  snapshotCreatePayload,
  snapshotErrors,
  snapshotSuccessMessage,
  snapshotSummary,
  snapshotWarnings,
  storageLocationLabel,
  storageLocationRefusal,
  storageLocationValue,
  storageLocationWarning,
  submitBlockReason,
  submitIsAccented,
  usesDestination,
} from "./snapshot-create";

import type { SwiftSnapshotBackendType, SwiftSnapshotDeletionPolicy } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type { FieldProps } from "./create-dialog";
import type {
  ExistingSnapshotFacts,
  SnapshotDestination,
  SnapshotFormValues,
  SnapshotGuestFacts,
  StorageLocationChoice,
  StorageLocationFacts,
} from "./snapshot-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, Notifications, Select },
  K8sApi: { secretsApi },
} = Renderer;

/** The verb, on the item, on the OK button and in the failure sentences. */
export const takeSnapshotTitle = "Take Snapshot";

/** What the one-shot read of the namespace's Secrets found (spike T3). */
export interface SecretPickerFacts {
  /** `unavailable` is any failure: the field degrades to a text input, and nothing is blocked. */
  state: "loading" | "ready" | "unavailable";
  names: string[];
}

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most - with a name to fix and everything else already typed.
 */
export interface SnapshotDialogModel {
  guest: SnapshotGuestFacts;
  values: SnapshotFormValues;
  /** The namespace's snapshots as the store holds them, for the two collision warnings. */
  existing: ExistingSnapshotFacts[];
  secrets: SecretPickerFacts;
  /** The storage locations the oci and csi destinations can name (SPEC-0019 T4). */
  locations: StorageLocationFacts;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

function syncOkButton(model: SnapshotDialogModel): void {
  const accent = submitIsAccented(model.values);

  model.okButtonProps.disabled = Boolean(submitBlockReason(model.values));
  model.okButtonProps.accent = accent;
  model.okButtonProps.primary = !accent;
}

/**
 * A fresh model for one opening of the dialog, with the defaults the spec's
 * field table names.
 *
 * `guest` and `existing` are refs: they are snapshots taken at click time (W1),
 * and nothing in the form mutates them.
 */
export function createSnapshotDialogModel(
  guest: SnapshotGuestFacts,
  existing: ExistingSnapshotFacts[],
  now: Date,
): SnapshotDialogModel {
  const model = Mobx.observable(
    {
      guest,
      values: defaultSnapshotForm(guest, now),
      existing,
      secrets: { state: "loading", names: [] } as SecretPickerFacts,
      locations: { state: "loading", choices: [] } as StorageLocationFacts,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    { guest: Mobx.observableRef, existing: Mobx.observableRef },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/**
 * The one way the form changes, so the OK button can never drift out of step
 * with the values it is a verdict on.
 */
export const updateSnapshotForm = Mobx.action((model: SnapshotDialogModel, patch: Partial<SnapshotFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/**
 * The namespace's Secrets, as one list call on open (spike T3).
 *
 * Never awaited by the caller and never allowed to throw: a refused or slow
 * read degrades the credential fields to plain text inputs, which is the same
 * stance SPEC-0010 takes for its click-time pod read - a read that fails must
 * not block a write the user is allowed to make.
 */
export async function loadSecretNames(model: SnapshotDialogModel, namespace: string): Promise<void> {
  try {
    const secrets = await secretsApi.list({ namespace });
    const names = (secrets ?? []).map((secret) => secret.getName()).sort();

    Mobx.runInAction(() => {
      model.secrets.names = names;
      model.secrets.state = "ready";
    });
  } catch {
    Mobx.runInAction(() => {
      model.secrets.state = "unavailable";
    });
  }
}

/** What the destination checks read from a location of either kind. */
function storageLocationChoice(
  kind: StorageLocationChoice["kind"],
  name: string,
  spec: StorageLocationSpec | undefined,
  status: StorageLocationStatus | undefined,
): StorageLocationChoice {
  const ready = status?.conditions?.find((condition) => condition.type === "Ready");

  return {
    kind,
    name,
    hasOci: Boolean(spec?.oci),
    hasCsi: Boolean(spec?.csi),
    isDefault: spec?.default === true,
    ready: storageLocationConditionValue(status, "Ready"),
    readyMessage: ready?.message || undefined,
    credentialsSecretName: storageLocationCredentialsSecret(spec),
    signingKeySecretName: spec?.oci?.signingKeySecretName || undefined,
    repository: spec?.oci?.repository || undefined,
  };
}

/**
 * The guest namespace's SwiftStorageLocations and the cluster's
 * SwiftClusterStorageLocations, as two list calls on open (SPEC-0019 T4).
 *
 * Never awaited and never allowed to throw: a refused list, or a cluster
 * before KubeSwift v0.16.0 that has no such kinds, leaves the "Storage
 * location" destination with a sentence, and the other two work.
 */
export async function loadStorageLocations(model: SnapshotDialogModel): Promise<void> {
  try {
    const [namespaced, cluster] = await Promise.all([
      SwiftStorageLocation.getStore<SwiftStorageLocation, SwiftStorageLocationStore>().api.list({
        namespace: model.guest.namespace,
      }),
      SwiftClusterStorageLocation.getStore<SwiftClusterStorageLocation, SwiftClusterStorageLocationStore>().api.list(
        {},
      ),
    ]);
    const choices = [
      ...(namespaced ?? []).map((location) =>
        storageLocationChoice(SwiftStorageLocation.kind, location.getName(), location.spec, location.status),
      ),
      ...(cluster ?? []).map((location) =>
        storageLocationChoice(SwiftClusterStorageLocation.kind, location.getName(), location.spec, location.status),
      ),
    ];

    Mobx.runInAction(() => {
      model.locations.choices = choices;
      model.locations.state = "ready";
    });
  } catch {
    Mobx.runInAction(() => {
      model.locations.state = "unavailable";
    });
  }
}

/**
 * The namespace's SwiftSnapshots, as one list call on open, so the two
 * collision warnings hold from a page that never loaded them.
 *
 * The click-time seed from the store is what the dialog opens with - free, and
 * usually right, because the Snapshots page fills that store - and this refines
 * it. Like every other read on open it is never awaited and never allowed to
 * throw: a store that says nothing produces no warnings, and the 409 path stays
 * the backstop the spec designed it to be.
 */
/** What the collision checks read from a SwiftSnapshot. */
export function existingSnapshotFacts(snapshot: SwiftSnapshot): ExistingSnapshotFacts {
  const name = snapshot.getName();
  const namespace = snapshot.getNs() ?? "";

  return { name, namespace, ociReference: ociReference(namespace, name, snapshot.spec?.backend) };
}

export async function loadExistingSnapshots(model: SnapshotDialogModel): Promise<void> {
  try {
    const api = SwiftSnapshot.getStore<SwiftSnapshot, SwiftSnapshotStore>().api;
    // The whole cluster, for the repository:tag check of an oci snapshot; the
    // namespace alone when the user may not list the others.
    const snapshots =
      (await api.list({}).catch(() => undefined)) ?? (await api.list({ namespace: model.guest.namespace }));

    if (!snapshots) {
      return;
    }

    const existing = snapshots.map(existingSnapshotFacts);

    Mobx.runInAction(() => {
      model.existing = existing;
    });
  } catch {
    // Nothing: the dialog keeps whatever the store already gave it.
  }
}

interface TextFieldProps extends FieldProps {
  model: SnapshotDialogModel;
  field: keyof SnapshotFormValues;
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
      onChange={(value: string) => updateSnapshotForm(model, { [field]: value } as Partial<SnapshotFormValues>)}
    />
  </Field>
));

interface SecretFieldProps extends FieldProps {
  model: SnapshotDialogModel;
  field: "s3CredentialsSecret" | "ociCredentialsSecret" | "signingKeySecret";
  testId: string;
}

/**
 * A Secret reference: a picker over the namespace's Secrets when the one-shot
 * read answered, a plain text input otherwise.
 *
 * "Otherwise" includes a value the list does not contain, which is the case
 * that would otherwise lose it silently: the field would show an empty picker
 * while the model still submitted the typed name. Creating a Secret is out of
 * scope by design - the host's own resource editor exists - so this field only
 * ever references one.
 */
const SecretField = observer(({ model, field, testId, ...fieldProps }: SecretFieldProps) => {
  const value = model.values[field];
  const listed = model.secrets.names.includes(value);

  if (model.secrets.state !== "ready" || model.secrets.names.length === 0 || (value !== "" && !listed)) {
    return (
      <TextField
        {...fieldProps}
        model={model}
        field={field}
        testId={testId}
        hint={
          model.secrets.state === "unavailable"
            ? `${fieldProps.hint ?? ""} The Secrets of this namespace could not be listed, so the name is not verified.`.trim()
            : fieldProps.hint
        }
      />
    );
  }

  return (
    <Field {...fieldProps}>
      <Select
        id={testId}
        themeName="light"
        menuClass={styles.selectMenu}
        isClearable
        value={value || null}
        options={model.secrets.names.map((name) => ({ value: name, label: name }))}
        onChange={(option: { value: string } | null) =>
          updateSnapshotForm(model, { [field]: option?.value ?? "" } as Partial<SnapshotFormValues>)
        }
      />
    </Field>
  );
});

/** The backend select, plus the reason every option it cannot offer carries (W4). */
const BackendField = observer(({ model }: { model: SnapshotDialogModel }) => {
  const choices = backendChoices(model.guest);
  const refused = choices.filter((choice) => !choice.guard.enabled);
  // The three memory backends always share one verdict, so the sentence under
  // the select names them together rather than three times. It is here, and not
  // only inside the menu, because a reason nobody opens a dropdown to read is a
  // reason nobody reads.
  const refusal =
    refused.length > 0 ? `${refused.map((choice) => choice.type).join(", ")}: ${refused[0].guard.reason}` : undefined;

  return (
    <Field
      label="Backend"
      hint={`This one captures: ${choices.find((choice) => choice.type === model.values.backend)?.contents}.`}
      warning={refusal}
    >
      <Select
        id="snapshot-backend"
        themeName="light"
        menuClass={styles.selectMenu}
        value={model.values.backend}
        options={choices.map((choice) => ({
          value: choice.type,
          label: choice.guard.enabled
            ? `${choice.type} (${choice.contents})`
            : `${choice.type} - ${choice.guard.reason}`,
          isDisabled: !choice.guard.enabled,
        }))}
        onChange={(option: { value: SwiftSnapshotBackendType } | null) =>
          option && updateSnapshotForm(model, { backend: option.value })
        }
      />
    </Field>
  );
});

/** The three destinations, in the words each backend gives the third. */
function destinationOptions(backend: SwiftSnapshotBackendType): { value: SnapshotDestination; label: string }[] {
  return [
    { value: "default", label: "Default storage location" },
    { value: "location", label: "Storage location" },
    { value: "explicit", label: backend === "oci" ? "Registry" : "VolumeSnapshotClass" },
  ];
}

/** Where an oci or csi snapshot goes, and the location picker when it goes to one (SPEC-0019 T4). */
const DestinationField = observer(({ model }: { model: SnapshotDialogModel }) => {
  const { values, locations } = model;
  const errors = snapshotErrors(values);
  const warning = storageLocationWarning(
    values,
    locations,
    model.secrets.state === "ready" ? model.secrets.names : undefined,
  );

  return (
    <>
      <Field
        label="Destination"
        hint={
          values.destination === "default"
            ? "KubeSwift resolves the namespace's default storage location, else the cluster's."
            : undefined
        }
        warning={values.destination === "location" ? undefined : warning}
      >
        <Select
          id="snapshot-destination"
          themeName="light"
          menuClass={styles.selectMenu}
          value={values.destination}
          options={destinationOptions(values.backend)}
          onChange={(option: { value: SnapshotDestination } | null) =>
            option && updateSnapshotForm(model, { destination: option.value })
          }
        />
      </Field>

      {values.destination === "location" ? (
        locations.state === "ready" && locations.choices.length > 0 ? (
          <Field label="Storage location" error={errors.location} warning={warning}>
            <Select
              id="snapshot-storage-location"
              themeName="light"
              menuClass={styles.selectMenu}
              value={values.location || null}
              options={locations.choices.map((choice) => {
                const refusal = storageLocationRefusal(choice, values.backend);
                const label =
                  storageLocationLabel(choice) +
                  (choice.isDefault ? " (default)" : "") +
                  (choice.ready === false ? " - not ready" : "");

                return {
                  value: storageLocationValue(choice.kind, choice.name),
                  label: refusal ? `${label} - ${refusal}` : label,
                  isDisabled: Boolean(refusal),
                };
              })}
              onChange={(option: { value: string } | null) =>
                updateSnapshotForm(model, { location: option?.value ?? "" })
              }
            />
          </Field>
        ) : (
          <Field label="Storage location" error={errors.location}>
            <div className={styles.readOnlyValue} data-testid="snapshot-storage-location-unavailable">
              {locations.state === "loading"
                ? "Listing the storage locations..."
                : locations.state === "unavailable"
                  ? "The storage locations could not be listed: the cluster may have none (KubeSwift before " +
                    "v0.16.0) or you may not read them. Choose another destination."
                  : "This namespace and the cluster have no storage locations. Choose another destination."}
            </div>
          </Field>
        )
      ) : null}
    </>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const SnapshotWriteSummary = observer(({ model }: { model: SnapshotDialogModel }) => (
  <WriteSummary facts={snapshotSummary(model.guest, model.values, model.locations)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const SnapshotCreateForm = observer(({ model }: { model: SnapshotDialogModel }) => {
  const { guest, values } = model;
  const errors = snapshotErrors(values);
  const warnings = snapshotWarnings(guest, values, model.existing);
  const blocked = submitBlockReason(values);

  return (
    <div className={styles.form} data-testid="swiftguest-take-snapshot-form">
      <p className={styles.subject}>
        {"Take a snapshot of "}
        <b>{`SwiftGuest ${guest.namespace}/${guest.name}`}</b>
      </p>

      <TextField
        model={model}
        field="name"
        testId="snapshot-name"
        label="Name"
        error={errors.name}
        warning={warnings.name}
      />

      <BackendField model={model} />

      {usesDestination(values.backend) ? <DestinationField model={model} /> : null}

      {values.backend === "csi-volume-snapshot" && values.destination === "explicit" ? (
        <TextField
          model={model}
          field="volumeSnapshotClassName"
          testId="snapshot-volume-snapshot-class"
          label="VolumeSnapshotClass"
          error={errors.volumeSnapshotClassName}
        />
      ) : null}

      {values.backend === "local" ? (
        <Field
          label="Directory"
          hint="Derived by KubeSwift from the snapshot's namespace and name, on the guest's node."
        >
          <div className={styles.readOnlyValue} data-testid="snapshot-local-directory">
            {localSnapshotDirectory(guest.namespace, values.name.trim() || "<name>")}
          </div>
        </Field>
      ) : null}

      {values.backend === "s3" ? (
        <>
          <TextField model={model} field="bucket" testId="snapshot-bucket" label="Bucket" error={errors.bucket} />
          <TextField
            model={model}
            field="region"
            testId="snapshot-region"
            label="Region"
            error={errors.region}
            hint="Required unless an endpoint is set."
          />
          <TextField
            model={model}
            field="endpoint"
            testId="snapshot-endpoint"
            label="Endpoint"
            hint="Empty targets AWS S3."
          />
          <TextField model={model} field="prefix" testId="snapshot-prefix" label="Prefix" />
          <SecretField
            model={model}
            field="s3CredentialsSecret"
            testId="snapshot-s3-credentials-secret"
            label="Credentials secret"
            hint="Holds accessKeyId and secretAccessKey."
            error={errors.s3CredentialsSecret}
          />
          <div className={styles.checkboxRow}>
            <Checkbox
              label="Path-style addressing"
              value={values.forcePathStyle}
              onChange={(value: boolean) => updateSnapshotForm(model, { forcePathStyle: value })}
            />
            <Checkbox
              label="Allow a plaintext endpoint"
              value={values.s3Insecure}
              onChange={(value: boolean) => updateSnapshotForm(model, { s3Insecure: value })}
            />
          </div>
        </>
      ) : null}

      {values.backend === "oci" && values.destination === "explicit" ? (
        <>
          <TextField
            model={model}
            field="repository"
            testId="snapshot-repository"
            label="Repository"
            placeholder="registry.example.com/snapshots/guest"
            error={errors.repository}
          />
          <TextField
            model={model}
            field="tag"
            testId="snapshot-tag"
            label="Tag"
            hint={`Empty is tagged ${model.guest.namespace}-${values.name || "<name>"} by the server.`}
            error={errors.tag}
            warning={warnings.tag}
          />
          <SecretField
            model={model}
            field="ociCredentialsSecret"
            testId="snapshot-oci-credentials-secret"
            label="Credentials secret"
            hint="A kubernetes.io/dockerconfigjson Secret. Empty pushes anonymously."
          />
          <SecretField
            model={model}
            field="signingKeySecret"
            testId="snapshot-signing-key-secret"
            label="Signing key secret"
            hint="A cosign keypair. Empty pushes the artifact unsigned."
          />
          <Checkbox
            label="Allow a plaintext registry"
            value={values.ociInsecure}
            onChange={(value: boolean) => updateSnapshotForm(model, { ociInsecure: value })}
          />
        </>
      ) : null}

      {isMemoryBackend(values.backend) ? (
        <div className={styles.checkboxRow} data-testid="snapshot-resume-after-capture">
          <Checkbox
            label="Resume after capture"
            value={values.resumeAfterSnapshot}
            onChange={(value: boolean) => updateSnapshotForm(model, { resumeAfterSnapshot: value })}
          />
          {/* The same sentence the summary carries, repeated here on purpose:
              the summary sits below the fold of a form this tall, and the cost
              of this checkbox has to be visible at the moment it is chosen. */}
          {values.resumeAfterSnapshot ? null : <div className={styles.warning}>{frozenVmWarning}</div>}
        </div>
      ) : null}

      <Field label="Deletion policy">
        <Select
          id="snapshot-deletion-policy"
          themeName="light"
          menuClass={styles.selectMenu}
          value={values.deletionPolicy}
          options={deletionPolicies.map((policy) => ({ value: policy, label: policy }))}
          onChange={(option: { value: SwiftSnapshotDeletionPolicy } | null) =>
            option && updateSnapshotForm(model, { deletionPolicy: option.value })
          }
        />
      </Field>

      <TextField
        model={model}
        field="ttl"
        testId="snapshot-ttl"
        label="TTL"
        placeholder="720h"
        hint="Optional. Measured from the moment the capture finishes."
        error={errors.ttl}
      />

      <SnapshotWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="snapshot-submit-blocked">
          {`${takeSnapshotTitle} is disabled - ${blocked}`}
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
 * on both outcomes, and a rethrown `JsonApiErrorParsed` additionally triggers
 * the host's own "Unknown error occurred while ok-ing" toast, which says less
 * than nothing. The 409 - the outcome an ignored collision warning produces on
 * purpose - is answered by reopening the same params after the host's `finally`
 * has run, which works because the model is not React state.
 */
async function submitSnapshot(
  model: SnapshotDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const { guest, values } = model;
  const name = values.name.trim();
  // Not zero: reopening inside the host's own 100ms leave animation leaves the
  // dialog at `opacity: 0` forever (the mechanism is on `dialogReopenDelay`).
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), dialogReopenDelay);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = submitBlockReason(values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftSnapshot.getStore<SwiftSnapshot>().create(
      { name, namespace: guest.namespace },
      snapshotCreatePayload(guest, values),
    );
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        createFailureMessage(failure, { namespace: guest.namespace, name }) ?? error,
        `Could not create the SwiftSnapshot ${guest.namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  // Fired from a page that does not show the created row: the SwiftSnapshot
  // lands on the Snapshots page, which is somewhere else entirely (W9).
  Notifications.ok(snapshotSuccessMessage(name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openTakeSnapshotDialog(model: SnapshotDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: takeSnapshotTitle,
    // No icon: the host's default is a warning triangle, and a snapshot is not
    // destructive. What IS dangerous here says so in the summary, in the warning
    // style, and turns the OK button to the accent styling Stop uses.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <SnapshotCreateForm model={model} />,
    ok: () => submitSnapshot(model, params),
  };

  ConfirmDialog.open(params);
}

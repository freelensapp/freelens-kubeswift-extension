/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Seed Profile form, the eighth and last create surface of the
// milestone (SPEC-0014, slice 2). Every decision it renders - what is refused
// and why, what the write summary lists, what the payload is - belongs to
// `seedprofile-create.ts`.
//
// What lives here is the host wiring, and it is the same wiring the seven
// earlier dialogs use: `ConfirmDialog.open` as the dialog host, a per-open MobX
// model outside React so the 409 reopen keeps the form, and an observable
// `okButtonProps`.
//
// What is new is the shape: THREE REPEATED GROUPS, one per cloud-init document,
// each an origin control and then either a multi-line document field or a key
// inside an object that lives somewhere else. The reference path is the whole
// point of this form - it is the path upstream's own API comments and GitOps
// docs prefer, and the one path its GUI cannot express at all (F14) - and the
// four silent precedences of this kind are unreachable from here rather than
// validated (F20): the origin is one radio group per document, and the payload
// builder branches on it.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftSeedProfile } from "../api/kubeswift/swiftseedprofile-v1alpha1";
import { DocumentField, Field, KeyInObjectField, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import { defaultNamespace } from "./guest-create";
import { conflictStatusCode } from "./migration-create";
import {
  createSeedProfileTitle,
  defaultSeedProfileForm,
  seedDatasource,
  seedDatasourceFact,
  seedDocumentKinds,
  seedDocumentLabels,
  seedDocumentOrigins,
  seedMetaDataEffectiveFact,
  seedNamespaceFact,
  seedNetworkDataEffectiveFact,
  seedObjectKeys,
  seedOptionalDroppedFact,
  seedOriginLabels,
  seedOriginNote,
  seedOriginObjects,
  seedOriginUnverified,
  seedPrecedencesFact,
  seedProfileCreateErrors,
  seedProfileCreateFailureMessage,
  seedProfileCreatePayload,
  seedProfileCreateSuccessMessage,
  seedProfileCreateSummary,
  seedProfileCreateWarnings,
  seedProfileSubmitBlockReason,
  seedUnverifiedObjectHint,
  switchSeedDocumentOrigin,
} from "./seedprofile-create";

import type { ObjectPickerFacts } from "./create-dialog";
import type {
  SeedDocumentKind,
  SeedDocumentOrigin,
  SeedObjectFacts,
  SeedProfileCreateInputs,
  SeedProfileField,
  SeedProfileFormValues,
} from "./seedprofile-create";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, Input, NamespaceSelect, Notifications, Radio, RadioGroup },
  K8sApi: { configMapApi, namespaceStore, secretsApi },
} = Renderer;

/** What one of the two namespace reads on open found: the objects, and the keys each carries. */
export interface SeedObjectPickerFacts {
  state: "loading" | "ready" | "unavailable";
  items: SeedObjectFacts[];
}

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most - with three documents already typed.
 */
export interface SeedProfileDialogModel {
  values: SeedProfileFormValues;
  /** The namespace's Secrets, with their keys, for the Secret-key selectors. */
  secrets: SeedObjectPickerFacts;
  /** The namespace's ConfigMaps, with their keys, for the ConfigMap-key selectors. */
  configMaps: SeedObjectPickerFacts;
  /** The namespace's SwiftSeedProfile names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function seedProfileCreateInputs(model: SeedProfileDialogModel): SeedProfileCreateInputs {
  return {
    secrets: model.secrets.items,
    secretsUnverified: model.secrets.state === "unavailable",
    configMaps: model.configMaps.items,
    configMapsUnverified: model.configMaps.state === "unavailable",
    existingNames: model.existingNames,
    existingNamesUnverified: model.existingNamesUnverified,
  };
}

/** One origin's objects as the shared picker reads them: names only, plus the read's own state. */
export function seedObjectPickerFacts(
  inputs: SeedProfileCreateInputs,
  model: SeedProfileDialogModel,
  origin: SeedDocumentOrigin,
): ObjectPickerFacts {
  const facts = origin === "configMap" ? model.configMaps : model.secrets;

  return {
    state: facts.state,
    names: seedOriginObjects(inputs, origin)
      .map((object) => object.name)
      .sort(),
  };
}

function syncOkButton(model: SeedProfileDialogModel): void {
  model.okButtonProps.disabled = Boolean(seedProfileSubmitBlockReason(model.values));
}

/** A fresh model for one opening of the dialog, seeded from what the store already holds. */
export function createSeedProfileDialogModel(
  namespace: string,
  seed: { existingNames?: string[] } = {},
): SeedProfileDialogModel {
  const model = Mobx.observable(
    {
      values: defaultSeedProfileForm(namespace),
      secrets: { state: "loading", items: [] } as SeedObjectPickerFacts,
      configMaps: { state: "loading", items: [] } as SeedObjectPickerFacts,
      existingNames: seed.existingNames ?? [],
      existingNamesUnverified: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    { existingNames: Mobx.observable.ref },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/** The one way the two flat fields change. */
export const updateSeedProfileForm = Mobx.action(
  (model: SeedProfileDialogModel, patch: Partial<Pick<SeedProfileFormValues, "namespace" | "name">>) => {
    Object.assign(model.values, patch);
    syncOkButton(model);
  },
);

/** The one way a document group changes, so the OK button follows every keystroke in it. */
export const updateSeedDocument = Mobx.action(
  (model: SeedProfileDialogModel, kind: SeedDocumentKind, patch: Partial<SeedProfileFormValues[typeof kind]>) => {
    Object.assign(model.values[kind], patch);
    syncOkButton(model);
  },
);

/**
 * Moves one document to another origin, clearing what belonged to the one it
 * left.
 *
 * This is where "never an inline value beside a reference" stops being a rule
 * and becomes a fact about the state: the value the user typed into the control
 * they are leaving is gone from the model, not merely ignored by the payload
 * builder.
 */
export const changeSeedDocumentOrigin = Mobx.action(
  (model: SeedProfileDialogModel, kind: SeedDocumentKind, origin: SeedDocumentOrigin) => {
    model.values[kind] = switchSeedDocumentOrigin(model.values[kind], origin);
    syncOkButton(model);
  },
);

/**
 * Moves the form to another namespace.
 *
 * Every reference goes with it: a Secret named in the previous namespace names
 * nothing in this one, and a reference that resolves to nothing is precisely
 * the failure this kind reports least.
 */
export const changeSeedProfileNamespace = Mobx.action((model: SeedProfileDialogModel, namespace: string) => {
  model.values.namespace = namespace;

  for (const kind of seedDocumentKinds) {
    model.values[kind].objectName = "";
    model.values[kind].key = "";
  }

  model.secrets = { state: "loading", items: [] };
  model.configMaps = { state: "loading", items: [] };
  model.existingNames = [];
  model.existingNamesUnverified = false;
  syncOkButton(model);

  void loadNamespacedObjects(model);
});

/** The three namespace reads this form makes on open. None is awaited, none can throw. */
export async function loadNamespacedObjects(model: SeedProfileDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([
    loadSecrets(model, namespace),
    loadConfigMaps(model, namespace),
    loadSeedProfileNames(model, namespace),
  ]);
}

/**
 * The namespace's Secrets, with the keys each one carries (spike T3).
 *
 * The keys are what makes the second control a picker rather than a text input,
 * and they are free: the list call already returns them. A refusal degrades both
 * controls of every Secret-key group and costs one sentence, never the write -
 * and it degrades the ConfigMap groups not at all, because that is a different
 * read.
 */
export async function loadSecrets(model: SeedProfileDialogModel, namespace: string): Promise<void> {
  try {
    const secrets = await secretsApi.list({ namespace });

    Mobx.runInAction(() => {
      model.secrets = {
        state: "ready",
        items: (secrets ?? []).map((secret) => ({ name: secret.getName(), keys: secret.getKeys().sort() })),
      };
    });
  } catch {
    Mobx.runInAction(() => {
      model.secrets = { state: "unavailable", items: model.secrets.items };
    });
  }
}

/** The namespace's ConfigMaps, with their keys, under the same rule. */
export async function loadConfigMaps(model: SeedProfileDialogModel, namespace: string): Promise<void> {
  try {
    const configMaps = await configMapApi.list({ namespace });

    Mobx.runInAction(() => {
      model.configMaps = {
        state: "ready",
        items: (configMaps ?? []).map((configMap) => ({
          name: configMap.getName(),
          keys: configMap.getKeys().sort(),
        })),
      };
    });
  } catch {
    Mobx.runInAction(() => {
      model.configMaps = { state: "unavailable", items: model.configMaps.items };
    });
  }
}

/** The namespace's SwiftSeedProfile names, for the collision warning. */
export async function loadSeedProfileNames(model: SeedProfileDialogModel, namespace: string): Promise<void> {
  try {
    const profiles = await SwiftSeedProfile.getStore<SwiftSeedProfile>().api.list({ namespace });

    Mobx.runInAction(() => {
      model.existingNames = (profiles ?? []).map((profile) => profile.getName());
      model.existingNamesUnverified = false;
    });
  } catch {
    Mobx.runInAction(() => {
      model.existingNamesUnverified = true;
    });
  }
}

/** The slug of each document, which is what its test ids and select ids are built from. */
const documentSlugs: Record<SeedDocumentKind, string> = {
  userData: "user-data",
  metaData: "meta-data",
  networkData: "network-config",
};

/** The slug of each origin, for the same reason. */
const originSlugs: Record<SeedDocumentOrigin, string> = {
  inline: "inline",
  secret: "secret",
  configMap: "config-map",
};

/** What each document is for, on its own group's first line. */
const documentHints: Record<SeedDocumentKind, string> = {
  userData:
    "The cloud-init user-data document. This is the one the API server's own CEL rule requires: a profile needs " +
    "either a non-empty inline document or a reference.",
  metaData: seedMetaDataEffectiveFact,
  networkData: seedNetworkDataEffectiveFact,
};

/** The placeholder of each inline document, which is also a hint about its first line. */
const documentPlaceholders: Record<SeedDocumentKind, string> = {
  userData: "#cloud-config\nusers:\n  - name: ops\n    sudo: ALL=(ALL) NOPASSWD:ALL",
  metaData: "instance-id: my-guest\nlocal-hostname: my-guest",
  networkData: "version: 2\nethernets:\n  id0:\n    dhcp4: true",
};

/** One document group: the origin control, and then whichever pair of controls it selects. */
const SeedDocumentGroup = observer(({ model, kind }: { model: SeedProfileDialogModel; kind: SeedDocumentKind }) => {
  const inputs = seedProfileCreateInputs(model);
  const errors = seedProfileCreateErrors(model.values);
  const warnings = seedProfileCreateWarnings(inputs, model.values);
  const document = model.values[kind];
  const slug = documentSlugs[kind];
  const label = seedDocumentLabels[kind];
  const nameField = `${kind}Name` as SeedProfileField;
  const keyField = `${kind}Key` as SeedProfileField;

  return (
    <>
      <div className={styles.field} data-testid={`seedprofile-create-${slug}-origin`}>
        <div className={styles.label}>{label}</div>
        <div className={styles.hint}>{documentHints[kind]}</div>
        <RadioGroup
          className={styles.options}
          value={document.origin}
          onChange={(origin: SeedDocumentOrigin) => changeSeedDocumentOrigin(model, kind, origin)}
        >
          {seedDocumentOrigins.map((origin) => (
            <Radio
              key={origin}
              value={origin}
              label={
                <>
                  {/* The host's `Radio` takes no test id of its own, so the form
                      puts one on the span inside the label. */}
                  <span data-testid={`seedprofile-create-${slug}-origin-${originSlugs[origin]}`}>
                    {seedOriginLabels[origin]}
                  </span>
                  <div className={styles.optionReason}>{seedOriginNote(kind, origin)}</div>
                </>
              }
            />
          ))}
        </RadioGroup>
      </div>

      {document.origin === "inline" ? (
        <DocumentField
          label={`${label} document`}
          hint="Typed here, it is stored in this object's own spec."
          error={errors[kind as SeedProfileField]}
          value={document.inline}
          placeholder={documentPlaceholders[kind]}
          testId={`seedprofile-create-${slug}-inline`}
          onChange={(value: string) => updateSeedDocument(model, kind, { inline: value })}
        />
      ) : (
        <KeyInObjectField
          idPrefix={`seedprofile-create-${slug}`}
          objectLabel={`${label} ${document.origin === "secret" ? "Secret" : "ConfigMap"}`}
          keyLabel={`${label} key`}
          objectHint={`The object holding the document, in this namespace. It is read when a guest is reconciled, not now.`}
          keyHint="The key inside it. The document is whatever that key holds, byte for byte."
          objectError={errors[nameField]}
          keyError={errors[keyField]}
          objectWarning={warnings[nameField]}
          keyWarning={warnings[keyField]}
          objectPlaceholder={document.origin === "secret" ? "Pick a Secret" : "Pick a ConfigMap"}
          keyPlaceholder="Pick a key"
          objectName={document.objectName}
          keyName={document.key}
          objectFacts={seedObjectPickerFacts(inputs, model, document.origin)}
          keys={seedObjectKeys(inputs, document.origin, document.objectName)}
          unverifiedHint={seedUnverifiedObjectHint(document.origin)}
          emptyKeysHint={
            seedOriginUnverified(inputs, document.origin)
              ? ""
              : "That object carries no keys at all right now, so this one is typed rather than picked."
          }
          noObjectHint={`Name the ${
            document.origin === "secret" ? "Secret" : "ConfigMap"
          } first. A key with no object is a selector whose name is the empty string the core API defaults to, which resolves to nothing and makes the guest retry forever - so this form never offers one.`}
          onObjectChange={(value: string) =>
            // The key belongs to the object it was picked from, so a change of
            // object drops it: a key that exists in one and not in the other is
            // the reference that retries with backoff and says nothing.
            updateSeedDocument(model, kind, { objectName: value, key: "" })
          }
          onKeyChange={(value: string) => updateSeedDocument(model, kind, { key: value })}
        />
      )}
    </>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const SeedProfileWriteSummary = observer(({ model }: { model: SeedProfileDialogModel }) => (
  <WriteSummary facts={seedProfileCreateSummary(seedProfileCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const SeedProfileCreateForm = observer(({ model }: { model: SeedProfileDialogModel }) => {
  const inputs = seedProfileCreateInputs(model);
  const errors = seedProfileCreateErrors(model.values);
  const warnings = seedProfileCreateWarnings(inputs, model.values);
  const blocked = seedProfileSubmitBlockReason(model.values);

  return (
    <div className={styles.form} data-testid="swiftseedprofile-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftSeedProfile</b>
      </p>

      <Field label="Namespace" hint={seedNamespaceFact} error={errors.namespace}>
        <NamespaceSelect
          id="seedprofile-create-namespace"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.namespace || null}
          onChange={(option: { value: string } | null) => changeSeedProfileNamespace(model, option?.value ?? "")}
        />
      </Field>

      <Field label="Name" error={errors.name} warning={warnings.name}>
        <Input
          value={model.values.name}
          data-testid="seedprofile-create-name"
          onChange={(value: string) => updateSeedProfileForm(model, { name: value })}
        />
      </Field>

      {/* A stamped value shown rather than asked for - and sent all the same,
          because the webhook that would stamp it ships disabled (F16). */}
      <Field label="Datasource" hint={seedDatasourceFact}>
        <div className={styles.readOnlyValue} data-testid="seedprofile-create-datasource">
          {seedDatasource}
        </div>
      </Field>

      {seedDocumentKinds.map((kind) => (
        <SeedDocumentGroup key={kind} model={model} kind={kind} />
      ))}

      <SeedProfileWriteSummary model={model} />

      {/* The field this form does not offer, with what it claims to control
          stated in its place, and the four shapes it cannot produce (W12
          option dropping, F15, F20). */}
      <div className={styles.footer} data-testid="seedprofile-create-footer">
        <p>{seedOptionalDroppedFact}</p>
        <p>{seedPrecedencesFact}</p>
      </div>

      {blocked ? (
        <p className={styles.blocked} data-testid="seedprofile-create-submit-blocked">
          {`${createSeedProfileTitle} is disabled - ${blocked}`}
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
async function submitSeedProfile(
  model: SeedProfileDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = seedProfileSubmitBlockReason(model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftSeedProfile.getStore<SwiftSeedProfile>().create(
      { name, namespace },
      seedProfileCreatePayload(model.values),
    );
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        seedProfileCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftSeedProfile ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(seedProfileCreateSuccessMessage(namespace, name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openSeedProfileCreateDialog(model: SeedProfileDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createSeedProfileTitle,
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <SeedProfileCreateForm model={model} />,
    ok: () => submitSeedProfile(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Seed Profiles page's create control calls. */
export function openCreateSeedProfileDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createSeedProfileDialogModel(namespace, { existingNames: storedSeedProfileNames(namespace) });

  void loadNamespacedObjects(model);

  openSeedProfileCreateDialog(model);
}

/** The namespace's profiles as the store already holds them: free, and usually right. */
function storedSeedProfileNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftSeedProfile.getStore<SwiftSeedProfile>());

  return (store?.items ?? []).filter((profile) => profile.getNs() === namespace).map((profile) => profile.getName());
}

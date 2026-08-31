/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Image form, the seventh create surface of the milestone
// (SPEC-0014, slice 2). Every decision it renders - what is refused and why,
// what the write summary lists, what the payload is - belongs to
// `image-create.ts`.
//
// What lives here is the host wiring, and it is the same wiring the six earlier
// dialogs use: `ConfirmDialog.open` as the dialog host, a per-open MobX model
// outside React so the 409 reopen keeps the form, and an observable
// `okButtonProps`.
//
// Two shapes are new to this slice and both are about exclusivity. The form is
// SOURCE-BRANCHED - one radio group decides which half of it exists - and the
// OCI half branches again on how the artifact is pinned. Neither exclusivity is
// validated anywhere: the radio decides, and switching it empties the fields of
// the branch being left, so a payload carrying two sources or both a tag and a
// digest cannot be assembled at all (F6, F7). The third is the milestone's one
// collapsed section (DESIGN.md section 12): it hides no field that is required
// before it is opened, because the requirement - a volume snapshot class - is
// created INSIDE it by choosing the snapshot strategy, and the section opens
// itself while it holds an error.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftImage } from "../api/kubeswift/swiftimage-v1alpha1";
import { CollapsibleSection, Field, ObjectPickerField, QuantityField, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import { defaultNamespace } from "./guest-create";
import { quantityGrammar } from "./guestclass-create";
import {
  cloneStrategyNote,
  createImageTitle,
  defaultImageForm,
  formatAlwaysSentFact,
  formatSilentCorruptionFact,
  httpNoChecksumFact,
  imageCloneStrategies,
  imageCreateErrors,
  imageCreateFailureMessage,
  imageCreatePayload,
  imageCreateSuccessMessage,
  imageCreateSummary,
  imageCreateWarnings,
  imageDiskFormats,
  imageDroppedFieldsFacts,
  imageOsTypes,
  imagePinBys,
  imageSourceKinds,
  imageSourceNote,
  imageStorageSectionFields,
  imageSubmitBlockReason,
  importStorageClassFact,
  ociCredentialsFact,
  ociInsecureFact,
  ociVerifyKeyFact,
  osTypeLinuxFact,
  osTypeWindowsFact,
  rootDiskSizeFact,
  storageSectionHint,
  switchImagePinBy,
  switchImageSource,
  volumeSnapshotClassUnverifiedFact,
} from "./image-create";
import { conflictStatusCode } from "./migration-create";

import type {
  SwiftImageCloneStrategy,
  SwiftImageDiskFormat,
  SwiftImageOsType,
} from "../api/kubeswift/swiftimage-v1alpha1";
import type { ObjectPickerFacts } from "./create-dialog";
import type { ImageCreateInputs, ImageFormValues, ImagePinBy, ImageSourceKind } from "./image-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, NamespaceSelect, Notifications, Radio, RadioGroup, Select },
  K8sApi: { namespaceStore, secretsApi, storageClassApi, storageClassStore },
} = Renderer;

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most.
 */
export interface ImageDialogModel {
  values: ImageFormValues;
  /** The namespace's Secrets, for the two OCI pickers and their T3 degradation. */
  secrets: ObjectPickerFacts;
  /** The cluster's StorageClasses, for the import storage class picker. */
  storageClasses: ObjectPickerFacts;
  /** The namespace's SwiftImage names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
  /** The collapsed section's own state, in the model so a 409 reopen cannot close it. */
  storageOpen: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/** The model as the pure module reads it, rebuilt on each render of an `observer`. */
export function imageCreateInputs(model: ImageDialogModel): ImageCreateInputs {
  return {
    secrets: model.secrets.names,
    secretsUnverified: model.secrets.state === "unavailable",
    storageClasses: model.storageClasses.names,
    storageClassesUnverified: model.storageClasses.state === "unavailable",
    existingNames: model.existingNames,
    existingNamesUnverified: model.existingNamesUnverified,
  };
}

function syncOkButton(model: ImageDialogModel): void {
  model.okButtonProps.disabled = Boolean(imageSubmitBlockReason(model.values));
}

/** A fresh model for one opening of the dialog, seeded from what the stores already hold. */
export function createImageDialogModel(
  namespace: string,
  seed: { secrets?: string[]; storageClasses?: string[]; existingNames?: string[] } = {},
): ImageDialogModel {
  const model = Mobx.observable(
    {
      values: defaultImageForm(namespace),
      secrets: { state: "loading", names: seed.secrets ?? [] } as ObjectPickerFacts,
      storageClasses: { state: "loading", names: seed.storageClasses ?? [] } as ObjectPickerFacts,
      existingNames: seed.existingNames ?? [],
      existingNamesUnverified: false,
      storageOpen: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    { existingNames: Mobx.observable.ref },
  );

  Mobx.runInAction(() => syncOkButton(model));

  return model;
}

/**
 * The one way a field changes, so the OK button can never drift out of step with
 * the values it is a verdict on.
 */
export const updateImageForm = Mobx.action((model: ImageDialogModel, patch: Partial<ImageFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/** The one way the WHOLE form changes, for the two switches that clear a branch. */
export const applyImageForm = Mobx.action((model: ImageDialogModel, values: ImageFormValues) => {
  Object.assign(model.values, values);
  syncOkButton(model);
});

/** Opens or shuts the storage and clone strategy section. */
export const toggleImageStorageSection = Mobx.action((model: ImageDialogModel) => {
  model.storageOpen = !model.storageOpen;
});

/**
 * Moves the form to another namespace.
 *
 * Everything namespaced goes with it: the two Secret names belonged to the
 * previous namespace and name nothing in this one, which is the stale-selection
 * bug upstream's own wizard carries across cluster switches.
 */
export const changeImageNamespace = Mobx.action((model: ImageDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  model.values.ociCredentialsSecret = "";
  model.values.ociVerifyKeySecret = "";
  model.secrets = { state: "loading", names: [] };
  model.existingNames = [];
  model.existingNamesUnverified = false;
  syncOkButton(model);

  void loadNamespacedObjects(model);
});

/** The namespace's Secrets and image names, as two list calls. Neither is awaited, neither can throw. */
export async function loadNamespacedObjects(model: ImageDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([loadSecrets(model, namespace), loadImageNames(model, namespace)]);
}

/**
 * The namespace's Secrets, as one list call on open (spike T3).
 *
 * A namespace read a namespaced role may well not carry: a refusal degrades
 * both OCI Secret fields to text inputs and costs one sentence, never the write.
 */
export async function loadSecrets(model: ImageDialogModel, namespace: string): Promise<void> {
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

/** The namespace's SwiftImage names, for the collision warning. */
export async function loadImageNames(model: ImageDialogModel, namespace: string): Promise<void> {
  try {
    const images = await SwiftImage.getStore<SwiftImage>().api.list({ namespace });

    Mobx.runInAction(() => {
      model.existingNames = (images ?? []).map((image) => image.getName());
      model.existingNamesUnverified = false;
    });
  } catch {
    Mobx.runInAction(() => {
      model.existingNamesUnverified = true;
    });
  }
}

/**
 * The cluster's StorageClasses, as one list call on open.
 *
 * A cluster read, which a namespaced role may well not carry: never awaited and
 * never allowed to throw, because a read that fails must not block a write the
 * user is allowed to make.
 */
export async function loadStorageClasses(model: ImageDialogModel): Promise<void> {
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

interface TextFieldProps {
  model: ImageDialogModel;
  field: "name" | "httpUrl" | "ociRepository" | "ociTag" | "ociDigest" | "volumeSnapshotClassName";
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
      onChange={(value: string) => updateImageForm(model, { [field]: value } as Partial<ImageFormValues>)}
    />
  </Field>
));

/**
 * The source: a radio per source, each with what choosing it does.
 *
 * "Exactly one source" is a webhook-only rule, and this control makes violating
 * it inexpressible rather than validating it - which is stronger, and is also
 * what lets the two halves of the form below simply not exist for the source
 * that is not chosen (F6, W12 option dropping).
 */
const SourceField = observer(({ model }: { model: ImageDialogModel }) => (
  <div className={styles.field} data-testid="image-create-source">
    <div className={styles.label}>Source</div>
    <RadioGroup
      className={styles.options}
      value={model.values.source}
      onChange={(source: ImageSourceKind) => applyImageForm(model, switchImageSource(model.values, source))}
    >
      {imageSourceKinds.map((source) => (
        <Radio
          key={source}
          value={source}
          label={
            <>
              {/* The host's `Radio` takes no test id of its own, so the form
                  puts one on the span inside the label - the idiom the Restore
                  and Create Guest dialogs already use. */}
              <span data-testid={`image-create-source-${source}`}>
                {source === "http" ? "HTTP URL" : "OCI artifact"}
              </span>
              <div className={styles.optionReason}>{imageSourceNote(source)}</div>
            </>
          }
        />
      ))}
    </RadioGroup>
  </div>
));

/** The HTTP source: one field, one rule of upstream's and one it has nowhere. */
const HttpSourceFields = observer(({ model }: { model: ImageDialogModel }) => {
  const errors = imageCreateErrors(model.values);

  return (
    <TextField
      model={model}
      field="httpUrl"
      testId="image-create-url"
      label="URL"
      placeholder="https://cloud-images.example.com/noble-server-cloudimg-amd64.img"
      hint={httpNoChecksumFact}
      error={errors.httpUrl}
    />
  );
});

/**
 * The pin: a radio per pin, which closes the gap no layer closes (F7).
 *
 * Neither the schema, nor the webhook, nor the controller checks that one of
 * `tag` and `digest` is set, so an OCI source with neither is admitted and then
 * hands the puller an empty reference. The radio makes "neither" unreachable and
 * the field under it makes "empty" a refusal with a reason.
 */
const PinByField = observer(({ model }: { model: ImageDialogModel }) => (
  <div className={styles.field} data-testid="image-create-pin-by">
    <div className={styles.label}>Pin by</div>
    <RadioGroup
      className={styles.options}
      value={model.values.ociPinBy}
      onChange={(pinBy: ImagePinBy) => applyImageForm(model, switchImagePinBy(model.values, pinBy))}
    >
      {imagePinBys.map((pinBy) => (
        <Radio
          key={pinBy}
          value={pinBy}
          label={
            <>
              <span data-testid={`image-create-pin-by-${pinBy}`}>{pinBy === "tag" ? "Tag" : "Digest"}</span>
              <div className={styles.optionReason}>
                {pinBy === "tag"
                  ? "A tag is mutable: the same reference can serve different bytes tomorrow, and nothing here would notice."
                  : "A manifest digest pins the exact bytes, which is what upstream's own CRD comment recommends."}
              </div>
            </>
          }
        />
      ))}
    </RadioGroup>
  </div>
));

/** The OCI source: the repository, the pin, the plaintext switch and the two Secrets. */
const OciSourceFields = observer(({ model }: { model: ImageDialogModel }) => {
  const inputs = imageCreateInputs(model);
  const errors = imageCreateErrors(model.values);
  const warnings = imageCreateWarnings(inputs, model.values);

  return (
    <>
      <TextField
        model={model}
        field="ociRepository"
        testId="image-create-repository"
        label="Repository"
        placeholder="ghcr.io/example/golden-ubuntu-noble"
        hint="The address without a tag: the pin below carries the tag or the digest."
        error={errors.ociRepository}
      />

      <PinByField model={model} />

      {model.values.ociPinBy === "tag" ? (
        <TextField
          model={model}
          field="ociTag"
          testId="image-create-tag"
          label="Tag"
          placeholder="24.04"
          error={errors.ociTag}
        />
      ) : (
        <TextField
          model={model}
          field="ociDigest"
          testId="image-create-digest"
          label="Digest"
          placeholder="sha256:..."
          error={errors.ociDigest}
          warning={warnings.ociDigest}
        />
      )}

      <ObjectPickerField
        id="image-create-credentials-secret"
        inputTestId="image-create-credentials-secret-input"
        label="Registry credentials"
        hint={ociCredentialsFact}
        unverifiedHint="The Secrets of this namespace could not be listed, so the name is not verified."
        placeholder="None (anonymous)"
        value={model.values.ociCredentialsSecret}
        facts={model.secrets}
        warning={warnings.ociCredentialsSecret}
        onChange={(value: string) => updateImageForm(model, { ociCredentialsSecret: value })}
      />

      <ObjectPickerField
        id="image-create-verify-key-secret"
        inputTestId="image-create-verify-key-secret-input"
        label="Cosign verify key"
        hint={ociVerifyKeyFact}
        unverifiedHint="The Secrets of this namespace could not be listed, so the name is not verified."
        placeholder="None (no signature check)"
        value={model.values.ociVerifyKeySecret}
        facts={model.secrets}
        warning={warnings.ociVerifyKeySecret}
        onChange={(value: string) => updateImageForm(model, { ociVerifyKeySecret: value })}
      />

      <div className={styles.checkboxRow} data-testid="image-create-insecure">
        <Checkbox
          label="Plaintext (http) registry"
          value={model.values.ociInsecure}
          onChange={(value: boolean) => updateImageForm(model, { ociInsecure: value })}
        />
        <div className={styles.hint}>{ociInsecureFact}</div>
        {warnings.ociInsecure ? <div className={styles.warning}>{warnings.ociInsecure}</div> : null}
      </div>
    </>
  );
});

/**
 * Storage and clone strategy, the milestone's one collapsed section.
 *
 * Legal under DESIGN.md section 12 because it hides no field that is required
 * before it is opened: every field in it has a value the object would get
 * anyway, and the one requirement - a volume snapshot class - is CREATED inside
 * the section, by choosing the strategy that needs it. What the section changes
 * is on its header line whether it is open or shut, and it opens itself while it
 * holds an error, which is what keeps a blocked submit from pointing at a field
 * nobody can see (W4).
 */
const StorageSection = observer(({ model }: { model: ImageDialogModel }) => {
  const inputs = imageCreateInputs(model);
  const errors = imageCreateErrors(model.values);
  const warnings = imageCreateWarnings(inputs, model.values);
  const hasError = imageStorageSectionFields.some((field) => errors[field]);

  return (
    <CollapsibleSection
      title="Storage and clone strategy"
      hint={storageSectionHint(model.values)}
      open={model.storageOpen || hasError}
      onToggle={() => toggleImageStorageSection(model)}
      testId="image-create-storage-section"
    >
      <Field label="Clone strategy" hint={cloneStrategyNote(model.values.cloneStrategy)}>
        <Select
          id="image-create-clone-strategy"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.cloneStrategy}
          options={imageCloneStrategies.map((strategy) => ({ value: strategy, label: strategy }))}
          onChange={(option: { value: SwiftImageCloneStrategy } | null) =>
            option && updateImageForm(model, { cloneStrategy: option.value })
          }
        />
      </Field>

      {/* Rendered only for the strategy that reads it: for `copy` the field is
          ignored outright, and a field the API documents as a no-op is not
          rendered at all (W12 option dropping). */}
      {model.values.cloneStrategy === "snapshot" ? (
        <TextField
          model={model}
          field="volumeSnapshotClassName"
          testId="image-create-volume-snapshot-class"
          label="Volume snapshot class"
          placeholder="csi-hostpath-snapclass"
          hint={volumeSnapshotClassUnverifiedFact}
          error={errors.volumeSnapshotClassName}
        />
      ) : null}

      <ObjectPickerField
        id="image-create-import-storage-class"
        inputTestId="image-create-import-storage-class-input"
        label="Import storage class"
        hint={importStorageClassFact}
        unverifiedHint="The cluster's StorageClasses could not be listed, so the name is not verified."
        placeholder="The cluster default"
        value={model.values.importStorageClassName}
        facts={model.storageClasses}
        error={errors.importStorageClassName}
        warning={warnings.importStorageClassName}
        onChange={(value: string) => updateImageForm(model, { importStorageClassName: value })}
      />
    </CollapsibleSection>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const ImageWriteSummary = observer(({ model }: { model: ImageDialogModel }) => (
  <WriteSummary facts={imageCreateSummary(imageCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const ImageCreateForm = observer(({ model }: { model: ImageDialogModel }) => {
  const inputs = imageCreateInputs(model);
  const errors = imageCreateErrors(model.values);
  const warnings = imageCreateWarnings(inputs, model.values);
  const blocked = imageSubmitBlockReason(model.values);

  return (
    <div className={styles.form} data-testid="swiftimage-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftImage</b>
      </p>

      <Field
        label="Namespace"
        hint="The image, its import PVC, its two Jobs and every Secret it names all live here, and a guest resolves its image from its own namespace."
        error={errors.namespace}
      >
        <NamespaceSelect
          id="image-create-namespace"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.namespace || null}
          onChange={(option: { value: string } | null) => changeImageNamespace(model, option?.value ?? "")}
        />
      </Field>

      <TextField
        model={model}
        field="name"
        testId="image-create-name"
        label="Name"
        error={errors.name}
        warning={warnings.name}
      />

      <SourceField model={model} />

      {model.values.source === "http" ? <HttpSourceFields model={model} /> : <OciSourceFields model={model} />}

      <Field
        label="Format"
        hint={`${formatSilentCorruptionFact} ${formatAlwaysSentFact}`}
        error={errors.format}
        warning={warnings.format}
      >
        <Select
          id="image-create-format"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="Pick a format"
          value={model.values.format || null}
          options={imageDiskFormats.map((format) => ({ value: format, label: format }))}
          onChange={(option: { value: SwiftImageDiskFormat } | null) =>
            updateImageForm(model, { format: option?.value ?? "" })
          }
        />
      </Field>

      <Field label="OS type" hint={model.values.osType === "linux" ? osTypeLinuxFact : osTypeWindowsFact}>
        <Select
          id="image-create-os-type"
          themeName="light"
          menuClass={styles.selectMenu}
          value={model.values.osType}
          options={imageOsTypes.map((osType) => ({ value: osType, label: osType }))}
          onChange={(option: { value: SwiftImageOsType } | null) =>
            option && updateImageForm(model, { osType: option.value })
          }
        />
      </Field>

      <QuantityField
        label="Root disk size"
        hint={`${rootDiskSizeFact} ${quantityGrammar}`}
        error={errors.rootDiskSize}
        value={model.values.rootDiskSize}
        placeholder="10Gi (the controller's own value, not sent)"
        testId="image-create-root-disk-size"
        onChange={(value: string) => updateImageForm(model, { rootDiskSize: value })}
      />

      <StorageSection model={model} />

      <ImageWriteSummary model={model} />

      {/* The three fields this form does not offer, each with what it claims to
          control stated in its place (W12 option dropping). */}
      <div className={styles.footer} data-testid="image-create-footer">
        {imageDroppedFieldsFacts.map((fact) => (
          <p key={fact}>{fact}</p>
        ))}
      </div>

      {blocked ? (
        <p className={styles.blocked} data-testid="image-create-submit-blocked">
          {`${createImageTitle} is disabled - ${blocked}`}
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
async function submitImage(model: ImageDialogModel, params: Renderer.Component.ConfirmDialogParams): Promise<void> {
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = imageSubmitBlockReason(model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftImage.getStore<SwiftImage>().create({ name, namespace }, imageCreatePayload(model.values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        imageCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftImage ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  Notifications.ok(imageCreateSuccessMessage(namespace, name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openImageCreateDialog(model: ImageDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createImageTitle,
    // No icon, as in the six dialogs before it: the host's default is a warning
    // triangle, and a create commits resources without destroying anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <ImageCreateForm model={model} />,
    ok: () => submitImage(model, params),
  };

  ConfirmDialog.open(params);
}

/** The entry point the Images page's create control calls. */
export function openCreateImageDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createImageDialogModel(namespace, {
    secrets: [],
    storageClasses: storedStorageClassNames(),
    existingNames: storedImageNames(namespace),
  });

  void loadNamespacedObjects(model);
  void loadStorageClasses(model);

  openImageCreateDialog(model);
}

/** The cluster's StorageClasses as the host's own store already holds them. */
function storedStorageClassNames(): string[] {
  const store = maybe(() => storageClassStore);

  return (store?.items ?? []).map((storageClass) => storageClass.getName()).sort();
}

/** The namespace's images as the store already holds them: free, and usually right. */
function storedImageNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftImage.getStore<SwiftImage>());

  return (store?.items ?? []).filter((image) => image.getNs() === namespace).map((image) => image.getName());
}

/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Create Guest form, the fourth create surface of the milestone (SPEC-0013)
// and the first that is not about an object the user already selected: it is
// opened from the Guests page itself, so everything it knows about the cluster
// comes from the reads it fires when it opens. Every decision it renders - which
// classes and images are offered, what a not-Ready one says, what the OS type
// is, which fields are invalid, what the write summary lists, what the payload
// is - belongs to `guest-create.ts`.
//
// What lives here is the host wiring, and it is deliberately the same wiring the
// three earlier dialogs use, for the same three host facts the SPEC-0011 spikes
// settled:
//
// - `ConfirmDialog.open` is the dialog host for every form.
// - The form model lives OUTSIDE React, in a per-open MobX observable, and this
//   component is an `observer` over it: the 409 path reopens the dialog, which
//   remounts the message and would wipe React-local state exactly when the user
//   needs it most. That is also why the collapsed section's open state lives in
//   the model rather than in the DOM.
// - The OK button reacts to nothing except an `okButtonProps` that is itself a
//   MobX observable object. A plain object is inert.
//
// Three things are new here. The namespace is a field rather than a property of
// the object the dialog was opened from, so it is the host's own
// `NamespaceSelect` (in its light theme, on the hardcoded white box) and
// changing it reloads everything that is namespaced. The image picker offers
// options it dims and does not disable, because a not-Ready image is a wait
// rather than a mistake. And the storage section ships collapsed, which is the
// one new piece of shared form grammar this spec adds.

import { Renderer } from "@freelensapp/extensions";
import * as Mobx from "mobx";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { SwiftImage } from "../api/kubeswift/swiftimage-v1alpha1";
import { SwiftSeedProfile } from "../api/kubeswift/swiftseedprofile-v1alpha1";
import { CollapsibleSection, Field, WriteSummary } from "./create-dialog";
import styles from "./create-dialog.module.scss";
import stylesInline from "./create-dialog.module.scss?inline";
import { apiFailureFacts } from "./guest-actions";
import {
  createGuestTitle,
  defaultGuestForm,
  defaultNamespace,
  excludedFieldsFooter,
  guestAccessModes,
  guestClassChoices,
  guestClassSizing,
  guestCreateErrors,
  guestCreateFailureMessage,
  guestCreatePayload,
  guestCreateSubmitBlockReason,
  guestCreateSuccessMessage,
  guestCreateSummary,
  guestCreateWarnings,
  guestImageChoices,
  guestNodeChoices,
  guestOsType,
  guestRunPolicyChoices,
  guestVolumeModes,
  imageWillWaitFact,
  liveMigrationFact,
  liveMigrationLabel,
  nodePinFact,
  noGuestNodeReason,
  pickedGuestClass,
  pickedImage,
  resolvedStorage,
  runPolicyNote,
  storageFields,
  windowsConstraintFact,
} from "./guest-create";
import { conflictStatusCode } from "./migration-create";

import type { SwiftGuestRunPolicy } from "../api/kubeswift/swiftguest-v1alpha1";
import type { FieldProps } from "./create-dialog";
import type {
  GuestClassFacts,
  GuestCreateInputs,
  GuestFormValues,
  GuestImageFacts,
  GuestSeedProfileFacts,
} from "./guest-create";
import type { NodeFacts } from "./migration-create";

const { observer } = MobxReact;

const {
  Component: { Checkbox, ConfirmDialog, Input, NamespaceSelect, Notifications, Select },
  K8sApi: { namespaceStore, nodesApi },
} = Renderer;

/**
 * What one read on open found.
 *
 * `unavailable` is any failure: the field it fills degrades to a text input and
 * nothing is blocked, which is spike T3's verdict applied for the fourth time.
 */
export interface PickerFacts<T> {
  state: "loading" | "ready" | "unavailable";
  items: T[];
}

function loadingPicker<T>(items: T[] = []): PickerFacts<T> {
  return { state: "loading", items };
}

/**
 * The form's state, for one opening of the dialog.
 *
 * Deliberately not React state: a 409 reopens the dialog, which remounts the
 * message element, and anything held in a hook would be gone exactly when the
 * user needs it most.
 */
export interface GuestCreateDialogModel {
  values: GuestFormValues;
  guestClasses: PickerFacts<GuestClassFacts>;
  images: PickerFacts<GuestImageFacts>;
  seedProfiles: PickerFacts<GuestSeedProfileFacts>;
  nodes: PickerFacts<NodeFacts>;
  /** The chosen namespace's SwiftGuest names, for the collision warning. */
  existingNames: string[];
  /** The storage section ships collapsed; this is what the user does about that. */
  storageOpen: boolean;
  /** Read by the host's own render, so it must be observable to have any effect at all. */
  okButtonProps: { disabled: boolean; primary: boolean; accent: boolean };
}

/**
 * The model as the pure module reads it.
 *
 * One shape for every decision, rebuilt on each render of an `observer`, so a
 * function can never see a mix of two different moments of the reads on open.
 */
export function guestCreateInputs(model: GuestCreateDialogModel): GuestCreateInputs {
  return {
    guestClasses: model.guestClasses.items,
    guestClassesUnverified: model.guestClasses.state === "unavailable",
    images: model.images.items,
    imagesUnverified: model.images.state === "unavailable",
    seedProfiles: model.seedProfiles.items,
    seedProfilesUnverified: model.seedProfiles.state === "unavailable",
    nodes: model.nodes.items,
    nodesUnverified: model.nodes.state === "unavailable",
    existingNames: model.existingNames,
  };
}

function syncOkButton(model: GuestCreateDialogModel): void {
  model.okButtonProps.disabled = Boolean(guestCreateSubmitBlockReason(model.values));
}

/**
 * A fresh model for one opening of the dialog.
 *
 * The seeds are what the stores already hold at click time - free, and usually
 * right when the user is looking at the page these objects are listed on - and
 * the reads on open refine them.
 */
export function createGuestDialogModel(
  namespace: string,
  seed: {
    guestClasses?: GuestClassFacts[];
    images?: GuestImageFacts[];
    seedProfiles?: GuestSeedProfileFacts[];
    existingNames?: string[];
  } = {},
): GuestCreateDialogModel {
  const model = Mobx.observable(
    {
      values: defaultGuestForm(namespace),
      guestClasses: loadingPicker(seed.guestClasses ?? []),
      images: loadingPicker(seed.images ?? []),
      seedProfiles: loadingPicker(seed.seedProfiles ?? []),
      nodes: loadingPicker<NodeFacts>(),
      existingNames: seed.existingNames ?? [],
      // Collapsed, per the section's own rule: everything in it is optional and
      // every value it holds has a default the class already supplies.
      storageOpen: false,
      okButtonProps: { disabled: false, primary: true, accent: false },
    },
    {
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
export const updateGuestForm = Mobx.action((model: GuestCreateDialogModel, patch: Partial<GuestFormValues>) => {
  Object.assign(model.values, patch);
  syncOkButton(model);
});

/** The collapsed section's toggle, in the model so a 409 reopen does not shut it. */
export const toggleStorageSection = Mobx.action((model: GuestCreateDialogModel) => {
  model.storageOpen = !model.storageOpen;
});

/**
 * Moves the form to another namespace.
 *
 * Everything namespaced goes with it: the images and the seed profiles are
 * read per namespace, and a selection made in the previous one would name an
 * object that does not exist in this one - which is the stale-selection bug
 * upstream's own wizard carries across cluster switches.
 */
export const changeNamespace = Mobx.action((model: GuestCreateDialogModel, namespace: string) => {
  model.values.namespace = namespace;
  model.values.image = "";
  model.values.seedProfile = "";
  model.images = loadingPicker();
  model.seedProfiles = loadingPicker();
  model.existingNames = [];
  syncOkButton(model);

  void loadNamespacedObjects(model);
});

/**
 * The cluster's guest classes, as one list call on open.
 *
 * Cluster-scoped, so no namespace is sent, and cheap enough to read on every
 * open: the class is the one field the CRD requires, and a picker that cannot
 * offer it is a form nobody can submit.
 */
export async function loadGuestClasses(model: GuestCreateDialogModel): Promise<void> {
  try {
    const guestClasses = await SwiftGuestClass.getStore<SwiftGuestClass>().api.list();

    Mobx.runInAction(() => {
      model.guestClasses = { state: "ready", items: (guestClasses ?? []).map(guestClassFacts) };
      syncOkButton(model);
    });
  } catch {
    Mobx.runInAction(() => {
      model.guestClasses = { state: "unavailable", items: model.guestClasses.items };
      syncOkButton(model);
    });
  }
}

/**
 * The chosen namespace's images, seed profiles and guest names, as three list
 * calls.
 *
 * Fired on open and again on every namespace change. None of them is awaited by
 * the caller and none of them can throw: what they answer sharpens the form,
 * what they refuse degrades one sentence.
 */
export async function loadNamespacedObjects(model: GuestCreateDialogModel): Promise<void> {
  const namespace = model.values.namespace.trim();

  if (!namespace) {
    return;
  }

  await Promise.all([
    loadImages(model, namespace),
    loadSeedProfiles(model, namespace),
    loadGuestNames(model, namespace),
  ]);
}

async function loadImages(model: GuestCreateDialogModel, namespace: string): Promise<void> {
  try {
    const images = await SwiftImage.getStore<SwiftImage>().api.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.images = { state: "ready", items: (images ?? []).map(imageFacts) };
      syncOkButton(model);
    });
  } catch {
    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.images = { state: "unavailable", items: [] };
      syncOkButton(model);
    });
  }
}

async function loadSeedProfiles(model: GuestCreateDialogModel, namespace: string): Promise<void> {
  try {
    const profiles = await SwiftSeedProfile.getStore<SwiftSeedProfile>().api.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.seedProfiles = {
        state: "ready",
        items: (profiles ?? []).map((profile) => ({
          name: profile.getName(),
          datasource: SwiftSeedProfile.getDatasource(profile),
        })),
      };
    });
  } catch {
    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.seedProfiles = { state: "unavailable", items: [] };
    });
  }
}

async function loadGuestNames(model: GuestCreateDialogModel, namespace: string): Promise<void> {
  try {
    const guests = await SwiftGuest.getStore<SwiftGuest>().api.list({ namespace });

    Mobx.runInAction(() => {
      if (model.values.namespace.trim() !== namespace) {
        return;
      }

      model.existingNames = (guests ?? []).map((guest) => guest.getName());
    });
  } catch {
    // Nothing: a collision warning nobody could compute is a warning that does
    // not fire, and the API server's own AlreadyExists is what the failure path
    // is designed to carry.
  }
}

/**
 * The cluster's nodes, for the optional pin.
 *
 * The one read here whose field is optional, which is why a failure costs a
 * sentence rather than a control: the pin degrades to a typed, unverified name.
 */
export async function loadNodes(model: GuestCreateDialogModel): Promise<void> {
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

/** The slice of a live SwiftGuestClass the sizing block and the storage merge read. */
export function guestClassFacts(guestClass: SwiftGuestClass): GuestClassFacts {
  return {
    name: guestClass.getName(),
    cpu: SwiftGuestClass.getCpu(guestClass),
    memory: SwiftGuestClass.getMemory(guestClass),
    rootDisk: {
      format: SwiftGuestClass.getRootDiskFormat(guestClass),
      size: SwiftGuestClass.getRootDiskSize(guestClass),
    },
    coreScheduling: SwiftGuestClass.getCoreScheduling(guestClass),
    storage: guestClass.spec?.storage,
  };
}

/** The slice of a live SwiftImage the picker and the osType sync read. */
export function imageFacts(image: SwiftImage): GuestImageFacts {
  return { name: image.getName(), phase: SwiftImage.getPhase(image), osType: SwiftImage.getOsType(image) };
}

interface TextFieldProps extends FieldProps {
  model: GuestCreateDialogModel;
  field: keyof GuestFormValues;
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
      onChange={(value: string) => updateGuestForm(model, { [field]: value } as Partial<GuestFormValues>)}
    />
  </Field>
));

/**
 * Whether a picker can be rendered as a select at all.
 *
 * Four situations degrade it to a text input, and they are not the same
 * situation: the read was refused (the value is unverified), the read has not
 * answered yet and the store seeded nothing, the namespace genuinely holds no
 * such object, and the value names something the list does not contain - which
 * is what happens after a refused read has already been typed into.
 */
function isPicker<T extends { name: string }>(picker: PickerFacts<T>, value: string): boolean {
  if (picker.state === "unavailable" || picker.items.length === 0) {
    return false;
  }

  return value === "" || picker.items.some((item) => item.name === value);
}

/** The namespace: the host's own control, in the light theme the white box requires. */
const NamespaceField = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const errors = guestCreateErrors(model.values);

  return (
    <Field
      label="Namespace"
      hint="The guest, its launcher pod, its cloned root disk and its seed Secret all live here, and the images and seed profiles offered below are the ones in it."
      error={errors.namespace}
    >
      <NamespaceSelect
        id="guest-create-namespace"
        themeName="light"
        menuClass={styles.selectMenu}
        value={model.values.namespace || null}
        onChange={(option: { value: string } | null) => changeNamespace(model, option?.value ?? "")}
      />
    </Field>
  );
});

/**
 * The guest class: the one field the CRD requires, never auto-selected, with
 * the sizing it commits the guest to rendered next to it (G3).
 */
const GuestClassField = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const errors = guestCreateErrors(model.values);
  const warnings = guestCreateWarnings(inputs, model.values);
  const choices = guestClassChoices(inputs);
  const guestClass = pickedGuestClass(inputs, model.values);
  const hint =
    "The cpu, the memory and the root disk of this guest come from its class, and cannot be overridden on the guest.";

  return (
    <>
      {isPicker(model.guestClasses, model.values.guestClass) ? (
        <Field label="Guest class" hint={hint} error={errors.guestClass} warning={warnings.guestClass}>
          <Select
            id="guest-create-class"
            themeName="light"
            menuClass={styles.selectMenu}
            placeholder="Pick a guest class"
            value={model.values.guestClass || null}
            options={choices.map((choice) => ({ value: choice.name, label: choice.label }))}
            onChange={(option: { value: string } | null) => updateGuestForm(model, { guestClass: option?.value ?? "" })}
          />
        </Field>
      ) : (
        <TextField
          model={model}
          field="guestClass"
          testId="guest-create-class-input"
          label="Guest class"
          placeholder="the name of a guest class"
          hint={
            model.guestClasses.state === "unavailable"
              ? "The cluster's guest classes could not be listed, so this name is not verified: whether it exists, and what it sizes this guest to, is unknown from here."
              : model.guestClasses.state === "ready"
                ? `${hint} This cluster has no SwiftGuestClass yet, so the name has to be typed.`
                : hint
          }
          error={errors.guestClass}
          warning={warnings.guestClass}
        />
      )}

      {guestClass ? (
        <dl className={styles.facts} data-testid="guest-create-class-sizing">
          {/* The class's own facts, plus the one derived from them that decides
              how this guest will ever be moved to another node. */}
          {[
            ...guestClassSizing(guestClass),
            { label: "Live migration", value: liveMigrationLabel(resolvedStorage(inputs, model.values)) },
          ].flatMap((row) => [
            <dt className={styles.factLabel} key={`${row.label}-label`}>
              {row.label}
            </dt>,
            <dd className={styles.factValue} key={`${row.label}-value`}>
              {row.value}
            </dd>,
          ])}
        </dl>
      ) : null}
    </>
  );
});

/**
 * The OS type: a fact read off the picked image, never a control (G4).
 *
 * The CRD defaults `spec.osType` to `linux`, and the resolver cross-checks it
 * against the image's own - so a Windows guest created with the field untouched
 * is born Failed. Rendering the value as a fact is what makes the mismatch
 * impossible rather than merely validated.
 */
const OsTypeFact = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const osType = guestOsType(guestCreateInputs(model), model.values);

  return (
    <div className={styles.field} data-testid="guest-create-os-type">
      <div className={styles.label}>OS type</div>
      <div className={styles.readOnlyValue}>{osType.osType}</div>
      <div className={styles.hint}>{osType.text}</div>
      {osType.osType === "windows" ? <div className={styles.warning}>{windowsConstraintFact}</div> : null}
    </div>
  );
});

/**
 * The boot source.
 *
 * A SwiftGuest boots from an image, from a kernel or from a snapshot clone, and
 * this slice writes the first one. There is no segmented control and no
 * placeholder for the other two: a control with one option is a decoration, and
 * a disabled option labelled with a future release is a promise the product
 * makes on the roadmap's behalf. What the field says instead is what this form
 * creates, which is true today and stays true when the other two arrive next to
 * it.
 */
const BootSourceField = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const errors = guestCreateErrors(model.values);
  const warnings = guestCreateWarnings(inputs, model.values);
  const choices = guestImageChoices(inputs);
  const image = pickedImage(inputs, model.values);
  const willWait = imageWillWaitFact(image);
  const hint =
    "This form creates a disk-boot guest: the controller clones the image below into the guest's own root disk.";

  return (
    <>
      {isPicker(model.images, model.values.image) ? (
        <Field label="Boot image" hint={hint} error={errors.image} warning={warnings.image}>
          <Select
            id="guest-create-image"
            themeName="light"
            menuClass={styles.selectMenu}
            placeholder="Pick a SwiftImage"
            value={model.values.image || null}
            options={choices.map((choice) => ({
              value: choice.name,
              // Dimmed and selectable: an image that is still importing is a
              // legitimate choice whose consequence is a wait, and the wait is
              // stated under the control rather than by refusing the option.
              label: choice.ready ? choice.label : <span className={styles.dimOption}>{choice.label}</span>,
            }))}
            onChange={(option: { value: string } | null) => updateGuestForm(model, { image: option?.value ?? "" })}
          />
        </Field>
      ) : (
        <TextField
          model={model}
          field="image"
          testId="guest-create-image-input"
          label="Boot image"
          placeholder="the name of a SwiftImage"
          hint={
            model.values.namespace.trim() === ""
              ? `${hint} The images it can boot from are the ones in its namespace, so pick a namespace first.`
              : model.images.state === "unavailable"
                ? "The SwiftImages of this namespace could not be listed, so this name is not verified: whether it exists, whether it is Ready and which OS it carries are unknown from here."
                : model.images.state === "ready"
                  ? `${hint} This namespace holds no SwiftImage yet, so the name has to be typed - the guest waits for it and reconciles when it appears.`
                  : hint
          }
          error={errors.image}
          warning={warnings.image}
        />
      )}

      {willWait ? (
        <p className={styles.warning} data-testid="guest-create-image-waits">
          {willWait}
        </p>
      ) : null}

      <OsTypeFact model={model} />
    </>
  );
});

/** The optional cloud-init seed profile. */
const SeedProfileField = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const warnings = guestCreateWarnings(inputs, model.values);
  const hint =
    "Optional. The profile is rendered into a Secret of this guest and attached as its cloud-init NoCloud seed, which is what configures the guest on its first boot.";

  if (!isPicker(model.seedProfiles, model.values.seedProfile)) {
    return (
      <TextField
        model={model}
        field="seedProfile"
        testId="guest-create-seed-input"
        label="Seed profile"
        placeholder="none"
        hint={
          model.values.namespace.trim() === ""
            ? `${hint} The profiles it can use are the ones in its namespace, so pick a namespace first.`
            : model.seedProfiles.state === "unavailable"
              ? "The seed profiles of this namespace could not be listed, so a name typed here is not verified."
              : hint
        }
        warning={warnings.seedProfile}
      />
    );
  }

  return (
    <Field label="Seed profile" hint={hint} warning={warnings.seedProfile}>
      <Select
        id="guest-create-seed"
        themeName="light"
        menuClass={styles.selectMenu}
        placeholder="No seed profile"
        isClearable
        value={model.values.seedProfile || null}
        options={model.seedProfiles.items.map((profile) => ({ value: profile.name, label: profile.name }))}
        onChange={(option: { value: string } | null) => updateGuestForm(model, { seedProfile: option?.value ?? "" })}
      />
    </Field>
  );
});

/**
 * The run policy, with what the selected value means right after this create.
 *
 * The one field this form sends although the schema does not default it: the
 * mutating webhook's entire defaulting is `runPolicy: Running`, and it ships
 * disabled, so sending the value explicitly is what makes the stored object read
 * the same on every install (G8).
 */
const RunPolicyField = observer(({ model }: { model: GuestCreateDialogModel }) => (
  <Field label="Run policy" hint={runPolicyNote(model.values.runPolicy)}>
    <Select
      id="guest-create-run-policy"
      themeName="light"
      menuClass={styles.selectMenu}
      value={model.values.runPolicy}
      options={guestRunPolicyChoices().map((choice) => ({ value: choice.policy, label: choice.policy }))}
      onChange={(option: { value: SwiftGuestRunPolicy } | null) =>
        option && updateGuestForm(model, { runPolicy: option.value })
      }
    />
  </Field>
));

/** The optional node pin, over the nodes that could take the guest. */
const NodeField = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const warnings = guestCreateWarnings(inputs, model.values);
  const choices = guestNodeChoices(inputs);
  const hint = `Optional. ${nodePinFact}`;

  if (model.nodes.state === "ready" && model.nodes.items.length > 0 && choices.length === 0) {
    return (
      <Field label="Node">
        <div className={styles.readOnlyValue} data-testid="guest-create-no-nodes">
          {noGuestNodeReason(inputs)}
        </div>
      </Field>
    );
  }

  const pinned = model.values.nodeName.trim();
  const listed = choices.some((choice) => choice.name === pinned);

  if (model.nodes.state !== "ready" || choices.length === 0 || (pinned !== "" && !listed)) {
    return (
      <TextField
        model={model}
        field="nodeName"
        testId="guest-create-node-input"
        label="Node"
        placeholder="let the scheduler decide"
        hint={
          model.nodes.state === "unavailable"
            ? "The cluster's nodes could not be listed, so a name typed here is not verified: whether it exists, is Ready and can take this guest is unknown from here."
            : hint
        }
        warning={warnings.nodeName}
      />
    );
  }

  return (
    <Field label="Node" hint={hint} warning={warnings.nodeName}>
      <Select
        id="guest-create-node"
        themeName="light"
        menuClass={styles.selectMenu}
        placeholder="Let the scheduler decide"
        isClearable
        value={model.values.nodeName || null}
        options={choices.map((choice) => ({ value: choice.name, label: choice.name }))}
        onChange={(option: { value: string } | null) => updateGuestForm(model, { nodeName: option?.value ?? "" })}
      />
    </Field>
  );
});

/**
 * The storage overrides, collapsed (SPEC-0013, DESIGN.md section 12).
 *
 * Everything in it is optional and already answered by the class, which is what
 * lets it ship collapsed; what it hides is a consequence rather than a required
 * value, and the consequence itself - whether this guest can ever be
 * live-migrated - is stated next to the class picker, in the open.
 *
 * It opens by itself when it holds an error, because a submit blocked on a
 * field nobody can see is the dead control W4 forbids.
 */
const StorageSection = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const errors = guestCreateErrors(model.values);
  const storage = resolvedStorage(inputs, model.values);
  const hasError = storageFields.some((field) => errors[field]);

  return (
    <CollapsibleSection
      title="Storage overrides"
      hint={liveMigrationFact(storage)}
      open={model.storageOpen || hasError}
      onToggle={() => toggleStorageSection(model)}
      testId="guest-create-storage-section"
    >
      <Field
        label="Access mode"
        hint="Empty inherits the class's value. ReadWriteMany is what lets two launcher pods hold the disk at once, which is what a live migration needs."
        error={errors.storageAccessMode}
      >
        <Select
          id="guest-create-access-mode"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="From the guest class"
          isClearable
          value={model.values.storageAccessMode || null}
          options={guestAccessModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(option: { value: string } | null) =>
            updateGuestForm(model, { storageAccessMode: option?.value ?? "" })
          }
        />
      </Field>

      <Field
        label="Volume mode"
        hint="Empty inherits the class's value. The CRD's own rule pairs Block with ReadWriteMany, and it is checked on this guest's storage block alone."
        error={errors.storageVolumeMode}
      >
        <Select
          id="guest-create-volume-mode"
          themeName="light"
          menuClass={styles.selectMenu}
          placeholder="From the guest class"
          isClearable
          value={model.values.storageVolumeMode || null}
          options={guestVolumeModes.map((mode) => ({ value: mode, label: mode }))}
          onChange={(option: { value: string } | null) =>
            updateGuestForm(model, { storageVolumeMode: option?.value ?? "" })
          }
        />
      </Field>

      <TextField
        model={model}
        field="storageClassName"
        testId="guest-create-storage-class"
        label="Storage class"
        placeholder="from the guest class"
        hint="Empty falls through to the class, then to the image's own PVC class, then to the cluster default."
        error={errors.storageClassName}
      />
    </CollapsibleSection>
  );
});

/** The live write summary: the one create line, then the facts that are true of it (W1). */
const GuestWriteSummary = observer(({ model }: { model: GuestCreateDialogModel }) => (
  <WriteSummary facts={guestCreateSummary(guestCreateInputs(model), model.values)} />
));

/**
 * The form, as the dialog's `message`.
 *
 * An `observer` over a model that outlives it, which is what makes the host's
 * own re-renders, and the reopen after a 409, harmless.
 */
export const GuestCreateForm = observer(({ model }: { model: GuestCreateDialogModel }) => {
  const inputs = guestCreateInputs(model);
  const errors = guestCreateErrors(model.values);
  const warnings = guestCreateWarnings(inputs, model.values);
  const blocked = guestCreateSubmitBlockReason(model.values);

  return (
    <div className={styles.form} data-testid="swiftguest-create-form">
      <style>{stylesInline}</style>
      <p className={styles.subject}>
        {"Create a "}
        <b>SwiftGuest</b>
      </p>

      <NamespaceField model={model} />

      <TextField
        model={model}
        field="name"
        testId="guest-create-name"
        label="Name"
        placeholder="my-guest"
        hint="Lowercase letters, digits and '-', at most 63: the name is the stem of the launcher pod, the cloned root disk and the per-guest Service."
        error={errors.name}
        warning={warnings.name}
      />

      <GuestClassField model={model} />

      <BootSourceField model={model} />

      <SeedProfileField model={model} />

      <RunPolicyField model={model} />

      <NodeField model={model} />

      <StorageSection model={model} />

      <div className={styles.checkboxRow} data-testid="guest-create-guest-agent">
        <Checkbox
          label="Attach the guest agent device"
          value={model.values.guestAgentEnabled}
          onChange={(value: boolean) => updateGuestForm(model, { guestAgentEnabled: value })}
        />
        <div className={styles.hint}>
          The vsock device the in-guest identity agent talks over. It is what lets a clone taken from a snapshot of this
          guest regenerate its machine id, its SSH host keys, its hostname and its MAC without a reboot - and it has to
          be on the source when the snapshot is taken, not added to the clone afterwards.
        </div>
      </div>

      <GuestWriteSummary model={model} />

      {blocked ? (
        <p className={styles.blocked} data-testid="guest-create-submit-blocked">
          {`${createGuestTitle} is disabled - ${blocked}`}
        </p>
      ) : null}

      <p className={styles.footer} data-testid="guest-create-yaml-footer">
        {excludedFieldsFooter}
      </p>
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
async function submitGuest(
  model: GuestCreateDialogModel,
  params: Renderer.Component.ConfirmDialogParams,
): Promise<void> {
  const inputs = guestCreateInputs(model);
  const namespace = model.values.namespace.trim();
  const name = model.values.name.trim();
  const reopen = () => setTimeout(() => ConfirmDialog.open(params), 0);
  // The click handler re-evaluates the verdict before writing anything, exactly
  // as the menu items do: a disabled button is a styling contract, not a guard.
  const blocked = guestCreateSubmitBlockReason(model.values);

  if (blocked) {
    Notifications.error(blocked);
    reopen();

    return;
  }

  try {
    await SwiftGuest.getStore<SwiftGuest>().create({ name, namespace }, guestCreatePayload(inputs, model.values));
  } catch (error) {
    const failure = apiFailureFacts(error);

    // A 403 has already been toasted by the host itself, verbatim (SPEC-0010
    // spike S4); a 404 and a 409 have not, so those are ours to report.
    if (!failure.alreadyNotified) {
      Notifications.checkedError(
        guestCreateFailureMessage(failure, { namespace, name }) ?? error,
        `Could not create the SwiftGuest ${namespace}/${name}.`,
      );
    }

    if (failure.code === conflictStatusCode) {
      reopen();
    }

    return;
  }

  // Fired from the Guests page, which is where the row arrives - through that
  // page's own store, with no optimistic write of ours (W2). The notification is
  // still worth its space: the row lands at the bottom of a sorted list the user
  // may not be looking at, and a create that says nothing is a create nobody is
  // sure happened.
  Notifications.ok(guestCreateSuccessMessage(namespace, name));
}

/**
 * Opens the dialog for one model, and keeps the params so the 409 path can
 * reopen exactly the same dialog rather than build a second one.
 */
export function openGuestCreateDialog(model: GuestCreateDialogModel): void {
  const params: Renderer.Component.ConfirmDialogParams = {
    labelOk: createGuestTitle,
    // No icon, as in the three dialogs before it: the host's default is a
    // warning triangle, and a create commits resources without destroying
    // anything.
    icon: null,
    okButtonProps: model.okButtonProps,
    message: <GuestCreateForm model={model} />,
    ok: () => submitGuest(model, params),
  };

  ConfirmDialog.open(params);
}

/**
 * The entry point the Guests page's create control calls.
 *
 * Everything the dialog opens with comes from here: the namespace from the
 * page's own filter when it names exactly one, the pickers seeded from whatever
 * the stores already hold, and the reads that refine them - none awaited, none
 * able to throw.
 */
export function openCreateGuestDialog(): void {
  const namespace = defaultNamespace(namespaceStore.contextNamespaces);
  const model = createGuestDialogModel(namespace, {
    guestClasses: storedGuestClasses(),
    images: storedImages(namespace),
    seedProfiles: storedSeedProfiles(namespace),
    existingNames: storedGuestNames(namespace),
  });

  void loadGuestClasses(model);
  void loadNamespacedObjects(model);
  void loadNodes(model);

  openGuestCreateDialog(model);
}

/** The cluster's guest classes as the store already holds them: free, and usually right. */
function storedGuestClasses(): GuestClassFacts[] {
  const store = maybe(() => SwiftGuestClass.getStore<SwiftGuestClass>());

  return (store?.items ?? []).map(guestClassFacts);
}

/** The namespace's images as the store already holds them. */
function storedImages(namespace: string): GuestImageFacts[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftImage.getStore<SwiftImage>());

  return (store?.items ?? []).filter((image) => image.getNs() === namespace).map(imageFacts);
}

/** The namespace's seed profiles as the store already holds them. */
function storedSeedProfiles(namespace: string): GuestSeedProfileFacts[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftSeedProfile.getStore<SwiftSeedProfile>());

  return (store?.items ?? [])
    .filter((profile) => profile.getNs() === namespace)
    .map((profile) => ({ name: profile.getName(), datasource: SwiftSeedProfile.getDatasource(profile) }));
}

/** The namespace's guest names as the store already holds them, for the collision warning. */
function storedGuestNames(namespace: string): string[] {
  if (!namespace) {
    return [];
  }

  const store = maybe(() => SwiftGuest.getStore<SwiftGuest>());

  return (store?.items ?? []).filter((guest) => guest.getNs() === namespace).map((guest) => guest.getName());
}

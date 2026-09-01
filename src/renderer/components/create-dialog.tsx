/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The pieces of form grammar every create dialog renders identically
// (SPEC-0011, W12): a labelled control with its inline messages, the live write
// summary block underneath the form, and - since SPEC-0013, whose form is large
// enough to need one - a section that ships collapsed.
//
// Nothing here decides anything. `Field` renders whatever messages it is handed
// and `WriteSummary` renders whatever facts it is handed, and both sets of facts
// are computed by the pure module of the verb - `snapshot-create.ts`,
// `restore-create.ts`, `migration-create.ts`, `guest-create.ts`,
// `guestclass-create.ts` or `kernel-create.ts` - which is where the unit tests
// are. This file exists only so that the dialogs cannot drift into different
// renderings of the same idea, and so that the stylesheet has one owner.
//
// SPEC-0014 adds the four controls its four forms kept needing in the same
// shapes: in slice 1 a quantity and a reference to an object that lives
// somewhere else, and in slice 2 a multi-line document and a KEY INSIDE one of
// those objects. All four are renderings rather than rules - `quantityError`
// and the messages a picker's value carries belong to the pure modules - and
// the two decisions made here are which of two controls each picker shows,
// which is a fact about the read on open rather than about the object being
// written.

import { Renderer } from "@freelensapp/extensions";
import styles from "./create-dialog.module.scss";

const {
  Component: { Input, Select },
} = Renderer;

/** The live write summary of a create, as its pure module computes it (W1). */
export interface WriteSummaryFacts {
  /** The one API call the dialog makes: `Create <Kind> <ns>/<name>`. */
  write: string;
  /** What the create means, each line rendered only when it is true of this object. */
  notes: string[];
  /** What it costs, in the warning style. */
  warnings: string[];
}

/**
 * How long to wait before reopening a dialog the host has just closed, which is
 * what W12's `AlreadyExists` path does (SPEC-0016 slice 2).
 *
 * It is a fix rather than a tolerance, and the mechanism is in
 * `@freelensapp/animate` (Freelens 1.10.3, `animate.tsx`): when its `enter` prop
 * goes false it adds a `leave` class and schedules a `setTimeout(leaveDuration)`
 * that clears `isVisible`, `enter` and `leave` together - and its effect's own
 * cleanup CANCELS that timeout when `enter` goes true again. A dialog reopened
 * inside that window therefore keeps BOTH classes, and `.opacity-scale.leave`
 * wins the cascade: `opacity: 0`, permanently, on an element that still
 * intercepts every click on the page underneath it. Measured on this
 * repository's own E2E cluster in both themes, at one and at five seconds after
 * the reopen, on this dialog AND on the shipped Take Snapshot one.
 *
 * `leaveDuration` defaults to 100ms
 * (`default-leave-duration.injectable.ts`), and the `Dialog` passes no override,
 * so 250ms clears the window with room for a slow frame. The other seven create
 * dialogs of this repository still reopen at zero and still carry the defect;
 * moving them onto this constant is the follow-up SPEC-0016's notes name, and
 * the `Animate` bug itself goes on the upstream-Freelens list.
 */
export const dialogReopenDelay = 250;

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  warning?: string;
  children?: React.ReactNode;
}

/**
 * One labelled control, with the inline messages that replace the absent
 * admission webhook.
 *
 * The order is deliberate: what the field is, what it does, why it is wrong, and
 * what it will still do if submitted anyway. A warning never blocks (W12), so it
 * reads last rather than in place of the error.
 */
export function Field({ label, hint, error, warning, children }: FieldProps) {
  return (
    <div className={styles.field}>
      <div className={styles.label}>{label}</div>
      {children}
      {hint ? <div className={styles.hint}>{hint}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      {warning ? <div className={styles.warning}>{warning}</div> : null}
    </div>
  );
}

export interface QuantityFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  placeholder?: string;
}

/**
 * A Kubernetes quantity: cpu, memory, a disk size (SPEC-0014).
 *
 * A text input rather than a number one, because a quantity is `2`, `500m` and
 * `4Gi` and a `number` input refuses two of those. What makes it a field of its
 * own is what surrounds it: the grammar in the hint and the refusals the pure
 * module attaches, since the schemas behind these forms accept `0` and negative
 * values that no controller can honour - a class with `cpu: "0"` is stored
 * happily and produces guests nothing can start.
 */
export function QuantityField({ value, onChange, testId, placeholder, ...fieldProps }: QuantityFieldProps) {
  return (
    <Field {...fieldProps}>
      <Input value={value} placeholder={placeholder} data-testid={testId} onChange={onChange} />
    </Field>
  );
}

/** What one read on open found, as the picker below needs to know it (spike T3). */
export interface ObjectPickerFacts {
  /** `unavailable` is any failure: the field degrades to a text input, and nothing is blocked. */
  state: "loading" | "ready" | "unavailable";
  names: string[];
}

/**
 * Whether the picker can be a picker at all.
 *
 * Three cases send it back to a text input, and the third is the one that would
 * otherwise lose a value silently: a read that has not answered or was refused,
 * an empty list, and a value the list does not contain - where a select would
 * show nothing while the model still submitted the typed name.
 */
export function objectPickerIsUsable(facts: ObjectPickerFacts, value: string): boolean {
  if (facts.state !== "ready" || facts.names.length === 0) {
    return false;
  }

  return value === "" || facts.names.includes(value);
}

export interface ObjectPickerFieldProps extends FieldProps {
  /**
   * The id of the select, which is what makes its portalled menu addressable as
   * `<id>-options`: the host spends the `id` on react-select's `inputId` rather
   * than on the container.
   */
  id: string;
  /** The test id of the text input the field degrades to. */
  inputTestId: string;
  value: string;
  onChange: (value: string) => void;
  facts: ObjectPickerFacts;
  placeholder?: string;
  /** Said at the field when the list could not be read, so the name is marked unverified. */
  unverifiedHint: string;
}

/**
 * A reference to an object this form does not create: a StorageClass, a Secret
 * (SPEC-0014, F11).
 *
 * A picker over what the one-shot read on open found, and a plain text input
 * whenever that read cannot support one. Degrading rather than blocking is the
 * point: `storageClassApi` is a cluster read and `secretsApi` a namespace one,
 * and a role that carries neither must still be able to write the object it is
 * allowed to write (W4). What the degradation costs is one sentence, which the
 * caller supplies because only the caller knows what the name is for.
 */
export function ObjectPickerField({
  id,
  inputTestId,
  value,
  onChange,
  facts,
  placeholder,
  unverifiedHint,
  ...fieldProps
}: ObjectPickerFieldProps) {
  if (!objectPickerIsUsable(facts, value)) {
    const hint = facts.state === "unavailable" ? `${fieldProps.hint ?? ""} ${unverifiedHint}`.trim() : fieldProps.hint;

    return (
      <Field {...fieldProps} hint={hint}>
        <Input value={value} placeholder={placeholder} data-testid={inputTestId} onChange={onChange} />
      </Field>
    );
  }

  return (
    <Field {...fieldProps}>
      <Select
        id={id}
        themeName="light"
        menuClass={styles.selectMenu}
        isClearable
        placeholder={placeholder}
        value={value || null}
        options={facts.names.map((name) => ({ value: name, label: name }))}
        onChange={(option: { value: string } | null) => onChange(option?.value ?? "")}
      />
    </Field>
  );
}

export interface DocumentFieldProps extends FieldProps {
  value: string;
  onChange: (value: string) => void;
  testId: string;
  placeholder?: string;
}

/**
 * A multi-line document: a cloud-init user-data, a metadata block, a netplan
 * (SPEC-0014 slice 2).
 *
 * A textarea rather than a text input, and for a sharper reason than length: a
 * single-line `<input>` applies the browser's own value-sanitization algorithm,
 * which STRIPS carriage returns and newlines from an assigned value rather than
 * keeping them - so a pasted YAML document would arrive as one line with every
 * key run together, silently. The same fact made the kernel command line a
 * textarea in slice 1; here it is not an edge case but the whole content of the
 * field.
 *
 * The value reaches the model exactly as it was typed. A cloud-init document is
 * significant whitespace - `#cloud-config` has to be its first line - so nothing
 * here trims, reflows or normalizes it; the pure module decides emptiness on a
 * trimmed copy and sends the original.
 */
export function DocumentField({ value, onChange, testId, placeholder, ...fieldProps }: DocumentFieldProps) {
  return (
    <Field {...fieldProps}>
      <div className={styles.document}>
        <Input
          multiLine
          maxRows={12}
          rows={4}
          value={value}
          placeholder={placeholder}
          data-testid={testId}
          onChange={onChange}
        />
      </div>
    </Field>
  );
}

/**
 * Whether the key control of a key-in-object selector can be a picker.
 *
 * `keys` is `undefined` when they cannot be known at all - the read was
 * refused, or the picked name is one it never returned - and `[]` when the
 * object really carries none. Both send the control back to a text input, and
 * the second one deserves a different sentence, which is why the caller supplies
 * both hints.
 */
export function keyPickerIsUsable(keys: string[] | undefined, value: string): boolean {
  if (!keys || keys.length === 0) {
    return false;
  }

  return value === "" || keys.includes(value);
}

export interface KeyInObjectFieldProps {
  /** `<idPrefix>-object` and `<idPrefix>-key` are the ids of the two selects. */
  idPrefix: string;
  objectLabel: string;
  keyLabel: string;
  objectHint?: string;
  keyHint?: string;
  objectError?: string;
  keyError?: string;
  objectWarning?: string;
  keyWarning?: string;
  objectPlaceholder?: string;
  keyPlaceholder?: string;
  objectName: string;
  keyName: string;
  onObjectChange: (value: string) => void;
  onKeyChange: (value: string) => void;
  /** The objects the read on open found, for the first picker and its T3 degradation. */
  objectFacts: ObjectPickerFacts;
  /** The keys of the picked object, or `undefined` when they cannot be known. */
  keys: string[] | undefined;
  /** Said at the object field when the list could not be read. */
  unverifiedHint: string;
  /** Said at the key field when the object is readable and carries no keys at all. */
  emptyKeysHint: string;
  /** Said in place of the key control while no object is named - the invariant, stated (W4). */
  noObjectHint: string;
}

/**
 * A key inside an object that lives somewhere else: one key of a Secret, one key
 * of a ConfigMap (SPEC-0014, F14).
 *
 * The component upstream's UI does not have at all - its seed wizard offers
 * three textareas and its own class comment calls YAML the escape hatch for
 * references - and the one that **can never emit an empty name**. The guarantee
 * is structural rather than validated: the key control is not rendered until an
 * object is named, so there is no state in which a key exists beside an empty
 * selector name, and the sentence that would have been an error stands in the
 * control's place instead (W12 option dropping).
 *
 * The key control is a picker over the keys the picked object really carries
 * whenever that is knowable, and a text input whenever it is not - the same T3
 * degradation as the object picker above it, one level down.
 */
export function KeyInObjectField({
  idPrefix,
  objectLabel,
  keyLabel,
  objectHint,
  keyHint,
  objectError,
  keyError,
  objectWarning,
  keyWarning,
  objectPlaceholder,
  keyPlaceholder,
  objectName,
  keyName,
  onObjectChange,
  onKeyChange,
  objectFacts,
  keys,
  unverifiedHint,
  emptyKeysHint,
  noObjectHint,
}: KeyInObjectFieldProps) {
  const named = objectName.trim() !== "";
  const hintWithEmptyKeys = keys && keys.length === 0 ? `${keyHint ?? ""} ${emptyKeysHint}`.trim() : keyHint;

  return (
    <>
      <ObjectPickerField
        id={`${idPrefix}-object`}
        inputTestId={`${idPrefix}-object-input`}
        label={objectLabel}
        hint={objectHint}
        error={objectError}
        warning={objectWarning}
        placeholder={objectPlaceholder}
        unverifiedHint={unverifiedHint}
        value={objectName}
        facts={objectFacts}
        onChange={onObjectChange}
      />

      {named ? (
        <Field label={keyLabel} hint={hintWithEmptyKeys} error={keyError} warning={keyWarning}>
          {keyPickerIsUsable(keys, keyName) ? (
            <Select
              id={`${idPrefix}-key`}
              themeName="light"
              menuClass={styles.selectMenu}
              isClearable
              placeholder={keyPlaceholder}
              value={keyName || null}
              options={(keys ?? []).map((key) => ({ value: key, label: key }))}
              onChange={(option: { value: string } | null) => onKeyChange(option?.value ?? "")}
            />
          ) : (
            <Input
              value={keyName}
              placeholder={keyPlaceholder}
              data-testid={`${idPrefix}-key-input`}
              onChange={onKeyChange}
            />
          )}
        </Field>
      ) : (
        <Field label={keyLabel}>
          <div className={styles.hint} data-testid={`${idPrefix}-key-blocked`}>
            {noObjectHint}
          </div>
        </Field>
      )}
    </>
  );
}

export interface CollapsibleSectionProps {
  title: string;
  /** One line under the title, visible whether the section is open or closed. */
  hint?: string;
  /** Controlled, so the state survives the remount a 409 reopen performs. */
  open: boolean;
  onToggle: () => void;
  testId?: string;
  children?: React.ReactNode;
}

/**
 * A form section that ships collapsed (SPEC-0013, DESIGN.md section 12).
 *
 * Mechanical on purpose: it renders a header that toggles, and the fields of
 * the section when it is open. It decides nothing - in particular it never
 * decides to hide a field, which is what the DESIGN.md note constrains: a
 * section ships collapsed only when every field in it is optional, changes a
 * consequence rather than a required value, and is summarized by the line the
 * header carries whether it is open or shut.
 *
 * Controlled rather than a `<details>` element, because the 409 reopen remounts
 * the whole message: DOM state would collapse a section the user had opened,
 * exactly when they are looking for the field they need to change.
 */
export function CollapsibleSection({ title, hint, open, onToggle, testId, children }: CollapsibleSectionProps) {
  return (
    <div className={styles.section} data-testid={testId}>
      <button className={styles.sectionHeader} type="button" onClick={onToggle} aria-expanded={open}>
        <span className={styles.sectionCaret}>{open ? "-" : "+"}</span>
        <span className={styles.label}>{title}</span>
      </button>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
      {open ? <div className={styles.sectionBody}>{children}</div> : null}
    </div>
  );
}

export interface FormRowProps {
  /** How the row is numbered in the form and in the submit-disabled sentence. */
  title: string;
  onRemove: () => void;
  removeLabel: string;
  testId?: string;
  removeTestId?: string;
  children?: React.ReactNode;
}

/**
 * One row of a repeatable section: a data disk, a port, an interface
 * (SPEC-0013 slice 3).
 *
 * Mechanical like the rest of this file. The remove control is a plain button
 * rather than the host's own: inside the `ConfirmDialog` box, which is
 * hardcoded white in both themes, `Button` paints itself from theme tokens that
 * were chosen for a dark surface - the same fact the collapsible section's
 * header already works around, recorded in DESIGN.md section 12.
 */
export function FormRow({ title, onRemove, removeLabel, testId, removeTestId, children }: FormRowProps) {
  return (
    <div className={styles.row} data-testid={testId}>
      <div className={styles.rowHeader}>
        <span className={styles.rowTitle}>{title}</span>
        <button className={styles.rowButton} type="button" onClick={onRemove} data-testid={removeTestId}>
          {removeLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

export interface AddRowButtonProps {
  label: string;
  onAdd: () => void;
  /** W4: a control whose click would do nothing is disabled WITH its reason, never hidden. */
  blockedReason?: string;
  testId?: string;
  blockedTestId?: string;
}

/** The control that adds a row to a repeatable section, with the reason it cannot. */
export function AddRowButton({ label, onAdd, blockedReason, testId, blockedTestId }: AddRowButtonProps) {
  return (
    <div className={styles.addRow}>
      <button
        className={styles.rowButton}
        type="button"
        onClick={onAdd}
        disabled={Boolean(blockedReason)}
        title={blockedReason}
        data-testid={testId}
      >
        {label}
      </button>
      {blockedReason ? (
        <div className={styles.blocked} data-testid={blockedTestId}>
          {blockedReason}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The live write summary: the one create line, then the facts that are true of
 * it (W1, rebuilt from the current field values on every change).
 *
 * Not an `observer` itself: each dialog wraps it in one of its own, so the
 * component that reads the form model is the component that owns it.
 */
export function WriteSummary({ facts }: { facts: WriteSummaryFacts }) {
  return (
    <div className={styles.summary}>
      <p className={styles.summaryTitle}>This will:</p>
      <ol className={styles.summaryWrite}>
        <li>
          <code>{facts.write}</code>
        </li>
      </ol>
      {facts.notes.map((note) => (
        <p className={styles.note} key={note}>
          {note}
        </p>
      ))}
      {facts.warnings.map((warning) => (
        <p className={styles.warning} key={warning}>
          <b>{warning}</b>
        </p>
      ))}
    </div>
  );
}

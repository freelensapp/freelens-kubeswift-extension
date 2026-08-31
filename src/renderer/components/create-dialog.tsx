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
// SPEC-0014 adds the two controls its four forms kept needing in the same two
// shapes: a quantity, and a reference to an object that lives somewhere else.
// Both are renderings rather than rules - `quantityError` and the messages a
// picker's value carries belong to the pure modules, and the one decision made
// here is which of two controls a picker shows, which is a fact about the read
// on open rather than about the object being written.

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

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
// `restore-create.ts`, `migration-create.ts` or `guest-create.ts` - which is
// where the unit tests are. This file exists only so that the dialogs cannot
// drift into different renderings of the same idea, and so that the stylesheet
// has one owner.

import styles from "./create-dialog.module.scss";

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

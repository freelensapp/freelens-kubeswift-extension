/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The two pieces of form grammar every create dialog renders identically
// (SPEC-0011, W12): a labelled control with its inline messages, and the live
// write summary block underneath the form.
//
// Nothing here decides anything. `Field` renders whatever messages it is handed
// and `WriteSummary` renders whatever facts it is handed, and both sets of facts
// are computed by the pure module of the verb - `snapshot-create.ts` or
// `restore-create.ts` - which is where the unit tests are. This file exists only
// so that the two dialogs cannot drift into two different renderings of the same
// idea, and so that the stylesheet has one owner.

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

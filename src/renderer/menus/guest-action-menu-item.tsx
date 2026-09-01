/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The shell both guest action menu items are built on (SPEC-0010): the host
// idiom for a `kubeObjectMenuItems` component, the live click-time snapshot, the
// guard re-evaluation W4 requires, and the confirmation dialog W1 requires.
//
// Each verb keeps its own file, because each verb owns its guard, its dialog
// facts and its error messages; what lives here is only what would otherwise be
// copied verbatim between the two, and none of it is verb-specific. The pure
// decisions are in `components/guest-actions.ts`.
//
// Two host facts shape this file:
//
// - One registration renders in BOTH surfaces (W5). The list layout renders
//   `<KubeObjectMenu object={item} />` from `renderItemMenu` and the details
//   view renders it with `toolbar={true}`, so the component gets exactly
//   `{ object, toolbar }` and uses the host idiom - `<Icon interactive={toolbar}
//   tooltip={...} />`, through `ActionIcon`, plus a `<span className="title">`
//   the toolbar layout hides.
// - `MenuItem`'s `disabled` prop does NOT block its `onClick`: it adds a class
//   and sets `tabIndex: -1`, and what actually stops the click is the
//   stylesheet's `.MenuItem.disabled { pointer-events: none }`. A guard that
//   lives only in CSS is not a guard on a write surface, so the click handler
//   re-evaluates it before anything is written.

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { ActionIcon } from "./action-icon";

import type { ActionDialogFacts, ActionGuard, GuestActionFacts } from "../components/guest-actions";

const { observer } = MobxReact;

const {
  Component: { ConfirmDialog, MenuItem, Notifications },
} = Renderer;

/** What the host passes a `kubeObjectMenuItems` component, and nothing else. */
export interface GuestMenuItemProps {
  object: SwiftGuest;
  toolbar?: boolean;
}

/** What an action does once the user has confirmed it. */
export interface GuestActionPlan {
  /** The facts the dialog is built from, quoting the same snapshot the guard saw. */
  facts: ActionDialogFacts;
  /** Performs the writes and reports the outcome. Owns its own try/catch (W9). */
  run: () => Promise<void>;
}

export interface GuestActionMenuItemProps extends GuestMenuItemProps {
  extension: Renderer.LensExtension;
  /** The verb, used as the item's title, as the dialog's OK label and in the tooltip. */
  title: string;
  /** A host Material ligature: an unknown name renders as its own word rather than failing. */
  icon: string;
  testId: string;
  /** The host's accent styling, for an action that terminates a running workload. */
  accent?: boolean;
  guard: (guest: GuestActionFacts) => ActionGuard;
  /** Builds the dialog and the writes, on the click, from the live object. */
  plan: (guest: GuestActionFacts, object: SwiftGuest) => Promise<GuestActionPlan>;
}

/** The slice of a live SwiftGuest the pure decision functions read. */
export function guestActionFacts(object: SwiftGuest): GuestActionFacts {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    spec: object.spec,
    status: object.status,
  };
}

/**
 * The object as the store holds it right now, falling back to the one the row
 * was rendered with.
 *
 * The guard and the dialog are both built from this, so a dialog can never quote
 * a value the guard did not see (W1, B2). `getStore()` throws when the api
 * manager has no store for the kind - reachable from a click handler for a CRD
 * deleted from the cluster while Freelens is open - so it is guarded.
 */
export function liveGuest(object: SwiftGuest): SwiftGuest {
  const store = maybe(() => SwiftGuest.getStore<SwiftGuest>());

  return store?.getByPath(object.selfLink) ?? object;
}

/** The confirmation message: the subject, one numbered line per API call, then what it means. */
function renderMessage(title: string, facts: ActionDialogFacts) {
  return (
    <div>
      <p>
        {`${title} `}
        <b>{facts.subject}</b>?
      </p>
      {facts.writes.length > 0 ? (
        <ol>
          {facts.writes.map((write) => (
            <li key={write.text}>
              <code>{write.text}</code>
            </li>
          ))}
        </ol>
      ) : null}
      {facts.notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
      {facts.warnings.map((warning) => (
        <p key={warning}>
          <b>{warning}</b>
        </p>
      ))}
    </div>
  );
}

export const GuestActionMenuItem = observer((props: GuestActionMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar, title, icon, testId, accent, guard, plan } = props;

    // A terminating object is not a thing you act on, and the host's own
    // delete-mode logic keys on the same field (W4's one exception: absent
    // rather than disabled).
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = guard(guestActionFacts(object));
    const tooltip = verdict.enabled ? title : `${title}: ${verdict.reason}`;

    const onClick = async () => {
      const live = liveGuest(object);
      // The guard is re-evaluated against the live object before anything is
      // written: `disabled` alone does not stop the click, and the render-time
      // verdict may have been computed from a stale object (W4).
      if (!guard(guestActionFacts(live)).enabled) {
        return;
      }

      let action: GuestActionPlan;

      try {
        action = await plan(guestActionFacts(live), live);
      } catch (error) {
        Notifications.checkedError(error, `Could not prepare the ${title.toLowerCase()} of ${object.getName()}.`);

        return;
      }

      // `open({ ok })` rather than `confirm()`: it keeps the dialog on screen
      // and its OK button in the host's `waiting` state until the promise
      // settles, which is the "buttons disable while an operation is in flight"
      // DESIGN.md section 7 asks for. Declared deviation, recorded in SPEC-0010.
      ConfirmDialog.open({
        labelOk: title,
        okButtonProps: accent ? { primary: false, accent: true } : undefined,
        message: renderMessage(title, action.facts),
        ok: action.run,
      });
    };

    // The reason has to be reachable in BOTH surfaces (B5), and the toolbar
    // hides the title span, so it is carried three ways: the host `Icon`'s own
    // tooltip, which the toolbar renders; the item's native `title` attribute,
    // which survives the `pointer-events: none` of a disabled item and is what
    // the pre-review pass reads without opening a menu; and, durably, the
    // drawer's Condition row explanation. `ActionIcon` adds the fourth, which
    // needs no hover and no reading at all: a refused action is visibly dimmer
    // than the ones next to it (M7 milestone review).
    return (
      <MenuItem onClick={onClick} disabled={!verdict.enabled} data-testid={testId} title={tooltip}>
        <ActionIcon material={icon} toolbar={toolbar} tooltip={tooltip} disabled={!verdict.enabled} />
        <span className="title">{title}</span>
      </MenuItem>
    );
  }),
);

/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Serial Console: no API call at all, and therefore no dialog (SPEC-0017). The
// item composes a command line and hands it to a terminal tab the host owns,
// where it runs under the user's own kubectl and the user's own credentials.
//
// Deliberately NOT built on `menus/guest-action-menu-item.tsx`. That shell
// exists to carry a confirmation and a write plan (SPEC-0010, W1), and W1
// governs the writes the extension performs - here it performs none: no patch,
// no create, no delete. What stands in the confirmation's place is required
// rather than optional, and three quarters of it is in this file: the guard with
// its reason, the pod named in the tooltip, and the command line itself, typed
// into the shell where the user can read it, re-run it or edit it before its
// output arrives. That is a stronger disclosure than a modal, because it is the
// literal act rather than a description of one.
//
// What IS shared with the M6 items is the shape of the surface, and the two host
// facts it rests on:
//
// - One registration renders in BOTH the list row kebab and the drawer toolbar
//   (W5), so the component gets exactly `{ object, toolbar }` and uses the host
//   idiom - `<Icon interactive={toolbar} tooltip={...} />` plus a
//   `<span className="title">` the toolbar layout hides.
// - `MenuItem`'s `disabled` prop does NOT block its `onClick`: it adds a class
//   and sets `tabIndex: -1`, and what actually stops the click is the
//   stylesheet's `.MenuItem.disabled { pointer-events: none }`. A guard that
//   lives only in CSS is not a guard, so the click handler re-evaluates it
//   against the live object before anything opens.

import os from "node:os";
import { Common, Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import {
  canOpenGuestConsole,
  guestConsoleCommand,
  guestConsoleTabTitle,
  guestConsoleTooltip,
} from "../components/console-commands";
import { withErrorPage } from "../components/error-page";
import { liveGuest } from "./guest-action-menu-item";

import type { GuestConsoleFacts } from "../components/console-commands";

const { observer } = MobxReact;

const {
  Component: { createTerminalTab, Icon, MenuItem, Notifications, terminalStore },
} = Renderer;

export interface SwiftGuestConsoleMenuItemProps {
  object: SwiftGuest;
  toolbar?: boolean;
  extension: Renderer.LensExtension;
}

const title = "Serial Console";

/** The slice of a live SwiftGuest the pure decision functions read. */
export function guestConsoleFacts(object: SwiftGuest): GuestConsoleFacts {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    spec: object.spec,
    status: object.status,
  };
}

/**
 * The id of the tab this click opens.
 *
 * Fresh on every click, exactly as the host's own Pod Shell generates a fresh
 * uuid: two consoles onto the same guest are two sessions, and reusing an id
 * would collide with a tab the user may still be reading. The guest is named in
 * it so that a tab is identifiable in the host's own logs.
 */
function consoleTabId(guest: GuestConsoleFacts): string {
  return `kubeswift-console-${guest.namespace}-${guest.name}-${Date.now()}`;
}

export const SwiftGuestConsoleMenuItem = observer((props: SwiftGuestConsoleMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar } = props;

    // A terminating object is not a thing you act on, and the host's own
    // delete-mode logic keys on the same field (W4's one stated exception:
    // absent rather than disabled).
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = canOpenGuestConsole(guestConsoleFacts(object));
    const tooltip = verdict.enabled
      ? `${title}. ${guestConsoleTooltip(guestConsoleFacts(object), verdict)}`
      : `${title}: ${guestConsoleTooltip(guestConsoleFacts(object), verdict)}`;

    const onClick = async () => {
      const guest = guestConsoleFacts(liveGuest(object));

      // Re-evaluated against the live object before anything opens: `disabled`
      // alone does not stop the click, and the render-time verdict may have been
      // computed from an object the watch has since replaced (W4).
      if (!canOpenGuestConsole(guest).enabled) {
        return;
      }

      const tabId = consoleTabId(guest);
      const command = guestConsoleCommand({
        guest,
        // Empty on a default install, in which case the bare name is used: the
        // host's shell session has already put its bundled kubectl directory on
        // the tab's PATH, along with the cluster's own proxy kubeconfig.
        kubectlPath: Common.App.Preferences.getKubectlPath(),
        platform: os.platform(),
      });

      // The one failure that is OURS, and the only one that produces a
      // notification (W9): getting the tab open and the line onto its stdin.
      // Everything past that belongs to the terminal - a forbidden `pods/exec`,
      // a pod that went away, a socket that never appeared all arrive as
      // kubectl's own words on the user's own screen, which is what the rule
      // asks for rather than an exception to it. The send is inside the same
      // `try` so that a rejected promise is reported once here instead of
      // surfacing as an unhandled rejection nobody attributes to this click.
      try {
        createTerminalTab({ title: guestConsoleTabTitle(guest), id: tabId });
        await terminalStore.sendCommand(command, { enter: true, tabId });
      } catch (error) {
        Notifications.checkedError(error, `Could not open a serial console for ${guest.namespace}/${guest.name}.`);
      }
    };

    // The reason has to be reachable in BOTH surfaces (W4), and the toolbar
    // hides the title span, so it is carried three ways: the host `Icon`'s own
    // tooltip, which the toolbar renders; the item's native `title` attribute,
    // which survives the `pointer-events: none` of a disabled item; and,
    // durably, the drawer's own Serial Console row.
    return (
      <MenuItem onClick={onClick} disabled={!verdict.enabled} data-testid="swiftguest-console-action" title={tooltip}>
        <Icon material="terminal" interactive={toolbar} tooltip={tooltip} tooltipOverrideDisabled />
        <span className="title">{title}</span>
      </MenuItem>
    );
  }),
);

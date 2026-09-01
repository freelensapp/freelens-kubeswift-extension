/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Workload Console: the sandbox half of SPEC-0017, and the same shape as the
// guest's Serial Console item next to it - no API call, therefore no dialog, and
// deliberately not built on `menus/guest-action-menu-item.tsx`, whose whole
// reason to exist is carrying a confirmation and a write plan.
//
// What differs from that item is only what the mechanism differs in: this
// console is a `tail` on a FILE and not a relay to a socket, so it is read-only
// by construction, its command line carries no stdin and no TTY, and its tab
// title names the launcher POD as well as the sandbox - because for a warm-slot
// checkout the two are different, and that difference is otherwise invisible
// (K11). Every sentence lives in `components/console-commands.ts`, which is
// where the thinking is unit-tested; this file is the surface.

import os from "node:os";
import { Common, Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftSandbox } from "../api/kubeswift/swiftsandbox-v1alpha1";
import {
  canOpenSandboxConsole,
  sandboxConsoleCommand,
  sandboxConsoleTabTitle,
  sandboxConsoleTooltip,
} from "../components/console-commands";
import { withErrorPage } from "../components/error-page";

import type { SandboxConsoleFacts } from "../components/console-commands";

const { observer } = MobxReact;

const {
  Component: { createTerminalTab, Icon, MenuItem, Notifications, terminalStore },
} = Renderer;

export interface SwiftSandboxConsoleMenuItemProps {
  object: SwiftSandbox;
  toolbar?: boolean;
  extension: Renderer.LensExtension;
}

const title = "Workload Console";

/** The slice of a live SwiftSandbox the pure decision functions read. */
export function sandboxConsoleFacts(object: SwiftSandbox): SandboxConsoleFacts {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    spec: object.spec,
    status: object.status,
  };
}

/**
 * The object as the store holds it right now, falling back to the one the row
 * was rendered with - the sandbox twin of `liveGuest`.
 *
 * `getStore()` throws when the api manager has no store for the kind, which is
 * reachable from a click handler for a CRD deleted from the cluster while
 * Freelens is open, so it is guarded.
 */
function liveSandbox(object: SwiftSandbox): SwiftSandbox {
  const store = maybe(() => SwiftSandbox.getStore<SwiftSandbox>());

  return store?.getByPath(object.selfLink) ?? object;
}

/**
 * The id of the tab this click opens: fresh every time, as the host's own Pod
 * Shell generates a fresh uuid. Two consoles onto the same sandbox are two
 * sessions, and reusing an id would collide with a tab the user may still be
 * reading. The sandbox is named in it so a tab is identifiable in the host's own
 * logs; the pod is not, because it is in the tab's title, where a user can
 * actually see it.
 */
function consoleTabId(sandbox: SandboxConsoleFacts): string {
  return `kubeswift-sandbox-console-${sandbox.namespace}-${sandbox.name}-${Date.now()}`;
}

export const SwiftSandboxConsoleMenuItem = observer((props: SwiftSandboxConsoleMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar } = props;

    // W4's one stated exception: a terminating object is not a thing you act on,
    // and the item is absent rather than disabled.
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = canOpenSandboxConsole(sandboxConsoleFacts(object));
    const tooltip = verdict.enabled
      ? `${title}. ${sandboxConsoleTooltip(sandboxConsoleFacts(object), verdict)}`
      : `${title}: ${sandboxConsoleTooltip(sandboxConsoleFacts(object), verdict)}`;

    const onClick = async () => {
      const sandbox = sandboxConsoleFacts(liveSandbox(object));

      // Re-evaluated against the live object before anything opens: `disabled`
      // only adds a class and sets `tabIndex`, what stops the click is a
      // stylesheet rule, and a guard that lives only in CSS is not a guard (W4).
      if (!canOpenSandboxConsole(sandbox).enabled) {
        return;
      }

      const tabId = consoleTabId(sandbox);
      const command = sandboxConsoleCommand({
        sandbox,
        // Empty on a default install: the host's shell session has already put
        // its bundled kubectl on the tab's PATH, with the cluster's kubeconfig.
        kubectlPath: Common.App.Preferences.getKubectlPath(),
        platform: os.platform(),
      });

      // The one failure that is ours (W9): getting the tab open and the line
      // onto its stdin. A forbidden `pods/exec`, a pod that went away, a console
      // file that is not there yet all arrive as kubectl's own words in the
      // user's own terminal. Both calls sit in the same `try` so a rejected
      // promise is reported once here rather than surfacing as an unhandled
      // rejection nobody attributes to this click.
      try {
        createTerminalTab({ title: sandboxConsoleTabTitle(sandbox), id: tabId });
        await terminalStore.sendCommand(command, { enter: true, tabId });
      } catch (error) {
        Notifications.checkedError(
          error,
          `Could not open a workload console for ${sandbox.namespace}/${sandbox.name}.`,
        );
      }
    };

    // The icon is the host's `subject`, the same one the M4 "View logs"
    // affordance carries in this kind's drawer: both of them open a stream of
    // text about this sandbox in the dock, and a user who has learned one should
    // recognise the other.
    return (
      <MenuItem onClick={onClick} disabled={!verdict.enabled} data-testid="swiftsandbox-console-action" title={tooltip}>
        <Icon material="subject" interactive={toolbar} tooltip={tooltip} tooltipOverrideDisabled />
        <span className="title">{title}</span>
      </MenuItem>
    );
  }),
);

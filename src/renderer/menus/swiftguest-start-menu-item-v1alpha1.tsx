/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Start: one merge patch on the guest, behind a confirmation that names it
// (SPEC-0010). The guard, the dialog facts and the messages are pure functions
// in `components/guest-actions.ts`; what is here is the wiring the host sees.
//
// A start is the one action in this milestone with no visible effect anywhere
// until a controller acts - `spec.runPolicy` is not a column, and the phase will
// not move until the guest boots - so it ends with a short notification naming
// what was written. Silence there is indistinguishable from an action that did
// nothing (W9, B11).

import { Renderer } from "@freelensapp/extensions";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import {
  apiFailureFacts,
  canStart,
  startDialogFacts,
  startPatch,
  startSuccessMessage,
  writeFailureMessage,
} from "../components/guest-actions";
import { GuestActionMenuItem } from "./guest-action-menu-item";

import type { GuestActionFacts } from "../components/guest-actions";
import type { GuestActionPlan, GuestMenuItemProps } from "./guest-action-menu-item";

const {
  Component: { Notifications },
} = Renderer;

export interface SwiftGuestStartMenuItemProps extends GuestMenuItemProps {
  extension: Renderer.LensExtension;
}

/**
 * The sizing the start will ask for, when the guest class happens to be in the
 * store already (B8).
 *
 * Nothing is fetched: a one-line context is not a reason to issue a request, so
 * a class that is not loaded contributes its name alone. A gateway client could
 * not do even that without a second round trip, which is the CRD-native
 * advantage this line spends.
 */
function guestClassSummary(guest: GuestActionFacts): string | undefined {
  const name = guest.spec?.guestClassRef?.name;

  if (!name) {
    return undefined;
  }

  const store = maybe(() => SwiftGuestClass.getStore<SwiftGuestClass>());
  const guestClass = store?.getByName(name, guest.namespace);

  if (!guestClass) {
    return undefined;
  }

  const cpu = SwiftGuestClass.getCpu(guestClass);
  const memory = SwiftGuestClass.getMemory(guestClass);
  const parts = [cpu ? `${cpu} vCPU` : undefined, memory].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

async function planStart(guest: GuestActionFacts, object: SwiftGuest): Promise<GuestActionPlan> {
  const store = SwiftGuest.getStore<SwiftGuest>();

  return {
    facts: startDialogFacts(guest, guestClassSummary(guest)),
    run: async () => {
      try {
        await store.patch(object, startPatch(), "merge");
      } catch (error) {
        const failure = apiFailureFacts(error);

        // A 403 has already been toasted by the host itself, verbatim and with
        // the API server's own naming of the verb, the resource and the
        // namespace (spike S4); a second notification would only duplicate it.
        if (!failure.alreadyNotified) {
          Notifications.checkedError(
            writeFailureMessage(failure, {
              verb: "patch",
              resource: "swiftguests",
              namespace: guest.namespace,
            }) ?? error,
            `Could not start ${guest.namespace}/${guest.name}.`,
          );
        }

        return;
      }

      Notifications.ok(startSuccessMessage());
    },
  };
}

export const SwiftGuestStartMenuItem = (props: SwiftGuestStartMenuItemProps) => (
  <GuestActionMenuItem
    {...props}
    title="Start"
    icon="play_arrow"
    testId="swiftguest-start-action"
    guard={canStart}
    plan={planStart}
  />
);

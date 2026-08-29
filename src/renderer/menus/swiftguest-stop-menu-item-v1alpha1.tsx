/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Stop: a merge patch on the guest and a delete of its launcher pod, in that
// order, behind a confirmation that names both (SPEC-0010).
//
// The order is upstream's own and it matters: patching first means the
// controller never has a window in which it could recreate the pod this action
// is about to delete. Patching alone would not stop anything - the `Stopped`
// branch of `spec.runPolicy` guards against RECREATION, and a pod that is
// currently running falls straight through it - which is why this verb writes
// twice and why the dialog says so.
//
// The dialog reads the pod before it offers to delete it (B3): one `GET`, on an
// explicit click, never per row and never on render. A read that fails degrades
// the sentence, never the action.

import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import {
  apiFailureFacts,
  canStop,
  launcherPodTarget,
  notFoundStatusCode,
  stopDialogFacts,
  stopPartialFailureMessage,
  stopPatch,
  stopSuccessMessage,
  stopWrites,
  writeFailureMessage,
} from "../components/guest-actions";
import { GuestActionMenuItem } from "./guest-action-menu-item";

import type { GuestActionFacts, LauncherPodReading } from "../components/guest-actions";
import type { GuestActionPlan, GuestMenuItemProps } from "./guest-action-menu-item";

const {
  Component: { Notifications },
  K8sApi: { podsApi },
} = Renderer;

export interface SwiftGuestStopMenuItemProps extends GuestMenuItemProps {
  extension: Renderer.LensExtension;
}

/**
 * What the launcher pod actually is right now, as one request on the click.
 *
 * `podsApi.get` is typed as returning `null`, but a pod that is not there makes
 * it THROW: `KubeApi.get` calls `request.get`, and the underlying `JsonApi`
 * turns every non-2xx response into a rejected promise, so the `null` return is
 * only ever an empty body. Spike S6 found this live, and SPEC-0010's own
 * fallback for it is what this does - the not-found case is read from the
 * caught error's status code. Both readings are kept, so a host that starts
 * returning `null` needs no change here.
 *
 * Anything else that throws (a 403 on pods is the realistic one) becomes
 * `unreadable`, which weakens the sentence and leaves the action offered: a read
 * that fails must never block a write the user is allowed to make.
 */
async function readLauncherPod(guest: GuestActionFacts): Promise<LauncherPodReading | undefined> {
  const target = launcherPodTarget(guest);

  if (!target) {
    return undefined;
  }

  try {
    const pod = await podsApi.get({ name: target.name, namespace: target.namespace });

    if (!pod) {
      return { outcome: "absent" };
    }

    return { outcome: "present", phase: pod.getStatusPhase() };
  } catch (error) {
    return apiFailureFacts(error).code === notFoundStatusCode ? { outcome: "absent" } : { outcome: "unreadable" };
  }
}

async function planStop(guest: GuestActionFacts, object: SwiftGuest): Promise<GuestActionPlan> {
  const store = SwiftGuest.getStore<SwiftGuest>();
  const reading = await readLauncherPod(guest);
  const plan = stopWrites(guest, reading);

  return {
    facts: stopDialogFacts(guest, reading),
    run: async () => {
      if (plan.patchRunPolicy) {
        try {
          await store.patch(object, stopPatch(), "merge");
        } catch (error) {
          const failure = apiFailureFacts(error);

          if (!failure.alreadyNotified) {
            Notifications.checkedError(
              writeFailureMessage(failure, {
                verb: "patch",
                resource: "swiftguests",
                namespace: guest.namespace,
              }) ?? error,
              `Could not stop ${guest.namespace}/${guest.name}.`,
            );
          }

          return;
        }
      }

      const pod = plan.deletePod;

      if (pod) {
        try {
          await podsApi.delete({ name: pod.name, namespace: pod.namespace });
        } catch (error) {
          const failure = apiFailureFacts(error);

          // The pod being gone is the outcome this write wanted.
          if (failure.code !== notFoundStatusCode) {
            // A compound action that only half applied reports the state it
            // left behind and how to finish the job, because the retry it
            // promises is genuinely reachable: the patch has become a no-op and
            // is dropped, and the guard keeps Stop enabled in exactly this
            // state (W9, B9).
            const detail = plan.patchRunPolicy ? stopPartialFailureMessage(pod.name) : undefined;
            const reported =
              writeFailureMessage(failure, { verb: "delete", resource: "pods", namespace: pod.namespace }) ?? "";

            if (!failure.alreadyNotified) {
              Notifications.checkedError(
                detail ? `${detail} ${reported}`.trim() : reported || error,
                `Could not delete the launcher pod ${pod.namespace}/${pod.name}.`,
              );
            } else if (detail) {
              Notifications.error(detail);
            }

            return;
          }
        }
      }

      Notifications.ok(stopSuccessMessage(plan));
    },
  };
}

export const SwiftGuestStopMenuItem = (props: SwiftGuestStopMenuItemProps) => (
  <GuestActionMenuItem
    {...props}
    title="Stop"
    icon="stop"
    testId="swiftguest-stop-action"
    accent
    guard={canStop}
    plan={planStop}
  />
);

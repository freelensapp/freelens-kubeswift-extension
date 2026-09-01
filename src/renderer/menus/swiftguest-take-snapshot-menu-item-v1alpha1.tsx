/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Take Snapshot: one `create`, behind a dialog that is both the form and the
// confirmation (SPEC-0011). The decisions are pure functions in
// `components/snapshot-create.ts`, the form is
// `components/snapshot-create-dialog.tsx`, and what is here is the host wiring:
// the registration's component, the live click-time snapshot, and the two reads
// the dialog opens with.
//
// It does not reuse `GuestActionMenuItem` the way Start and Stop do: that shell
// builds a dialog out of a fixed set of facts and hands it a `run`, while a
// create has to carry a form whose state outlives the dialog's own renders. What
// it does reuse is `liveGuest`, because reading the object the store holds right
// now, rather than the one the row was rendered with, is the same rule here as
// there (W1).

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { canTakeSnapshot } from "../components/snapshot-create";
import {
  createSnapshotDialogModel,
  loadExistingSnapshots,
  loadSecretNames,
  openTakeSnapshotDialog,
  takeSnapshotTitle,
} from "../components/snapshot-create-dialog";
import { ActionIcon } from "./action-icon";
import { liveGuest } from "./guest-action-menu-item";

import type { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import type { ExistingSnapshotFacts, SnapshotGuestFacts } from "../components/snapshot-create";
import type { GuestMenuItemProps } from "./guest-action-menu-item";

const { observer } = MobxReact;

const {
  Component: { MenuItem },
} = Renderer;

export interface SwiftGuestTakeSnapshotMenuItemProps extends GuestMenuItemProps {
  extension: Renderer.LensExtension;
}

/** The slice of a live SwiftGuest the dialog's decisions read. */
export function snapshotGuestFacts(object: SwiftGuest): SnapshotGuestFacts {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    annotations: object.metadata?.annotations,
    spec: object.spec,
    status: object.status,
  };
}

/**
 * The namespace's snapshots as the store already holds them, for the name
 * collision and host path reuse warnings.
 *
 * Free: no request, and no reason to issue one before the dialog is open. What
 * the store does not have, the list call the dialog fires on open supplies.
 */
function storedSnapshots(namespace: string): ExistingSnapshotFacts[] {
  const store = maybe(() => SwiftSnapshot.getStore<SwiftSnapshot>());

  return (store?.items ?? [])
    .filter((snapshot) => snapshot.getNs() === namespace)
    .map((snapshot) => ({ name: snapshot.getName(), hostPath: snapshot.spec?.backend?.local?.hostPath }));
}

export const SwiftGuestTakeSnapshotMenuItem = observer((props: SwiftGuestTakeSnapshotMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar } = props;

    // A terminating object is not a thing you act on (W4's one exception:
    // absent rather than disabled).
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = canTakeSnapshot(snapshotGuestFacts(object));
    const tooltip = verdict.enabled ? takeSnapshotTitle : `${takeSnapshotTitle}: ${verdict.reason}`;

    const onClick = () => {
      const guest = snapshotGuestFacts(liveGuest(object));

      // The guard is re-evaluated against the live object before the dialog is
      // built: `disabled` alone does not stop the click (W4).
      if (!canTakeSnapshot(guest).enabled) {
        return;
      }

      // The model is created here, outside React, and outlives every render of
      // the dialog's message - including the remount a 409 reopen performs.
      const model = createSnapshotDialogModel(guest, storedSnapshots(guest.namespace), new Date());

      // Two reads on open, neither awaited and neither able to throw: what they
      // answer sharpens the form, what they refuse degrades one sentence.
      void loadSecretNames(model, guest.namespace);
      void loadExistingSnapshots(model);

      openTakeSnapshotDialog(model);
    };

    return (
      <MenuItem
        onClick={onClick}
        disabled={!verdict.enabled}
        data-testid="swiftguest-take-snapshot-action"
        title={tooltip}
      >
        <ActionIcon material="photo_camera" toolbar={toolbar} tooltip={tooltip} disabled={!verdict.enabled} />
        <span className="title">{takeSnapshotTitle}</span>
      </MenuItem>
    );
  }),
);

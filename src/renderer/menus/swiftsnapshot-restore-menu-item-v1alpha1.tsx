/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Restore: one `create`, behind a dialog that is both the form and the
// confirmation (SPEC-0011, W12). The decisions are pure functions in
// `components/restore-create.ts`, the form is
// `components/restore-create-dialog.tsx`, and what is here is the host wiring:
// the registration's component, the live click-time snapshot, and the reads the
// dialog opens with.
//
// Registered on SwiftSnapshot, because the object a restore is about is the
// snapshot; the SwiftRestore it writes lands on the Restores page, which is what
// the success notification exists to say - and which upstream's own UI does not
// have at all.
//
// Like the Take Snapshot item, it does not reuse `GuestActionMenuItem`: that
// shell builds a dialog out of a fixed set of facts and hands it a `run`, while a
// create has to carry a form whose state outlives the dialog's own renders. What
// it does reuse is the rule that shell exists for - read the object the store
// holds right now, not the one the row was rendered with (W1).

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftRestore } from "../api/kubeswift/swiftrestore-v1alpha1";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { canRestore, targetNodeApplies } from "../components/restore-create";
import {
  createRestoreDialogModel,
  loadExistingGuests,
  loadExistingRestores,
  loadNodeNames,
  loadSourceGuest,
  openRestoreDialog,
  restoreTitle,
} from "../components/restore-create-dialog";
import { ActionIcon } from "./action-icon";

import type { ExistingGuestFacts, RestoreSnapshotFacts } from "../components/restore-create";

const { observer } = MobxReact;

const {
  Component: { MenuItem },
} = Renderer;

export interface SwiftSnapshotRestoreMenuItemProps {
  object: SwiftSnapshot;
  toolbar?: boolean;
  extension: Renderer.LensExtension;
}

/** The slice of a live SwiftSnapshot the dialog's decisions read. */
export function restoreSnapshotFacts(object: SwiftSnapshot): RestoreSnapshotFacts {
  return {
    name: object.getName(),
    // The SwiftSnapshot model predates the `NamespaceScopedMetadata` convention
    // (M3 onwards), so `getNs()` is typed as optional even though the kind is
    // always namespaced. The fallback is unreachable and exists for the type.
    namespace: object.getNs() ?? "",
    sourceGuestName: SwiftSnapshot.getGuestName(object),
    backend: SwiftSnapshot.getBackendType(object),
    phase: SwiftSnapshot.getPhase(object),
    hasMemorySnapshot: Boolean(object.status?.memorySnapshot),
  };
}

/**
 * The snapshot as the store holds it right now, falling back to the one the row
 * was rendered with.
 *
 * `getStore()` throws when the api manager has no store for the kind - reachable
 * from a click handler for a CRD deleted from the cluster while Freelens is open
 * - so it is guarded, exactly as `liveGuest` is.
 */
function liveSnapshot(object: SwiftSnapshot): SwiftSnapshot {
  const store = maybe(() => SwiftSnapshot.getStore<SwiftSnapshot>());

  return store?.getByPath(object.selfLink) ?? object;
}

/** The namespace's restores as the store already holds them, for the name collision warning. */
function storedRestoreNames(namespace: string): string[] {
  const store = maybe(() => SwiftRestore.getStore<SwiftRestore>());

  return (store?.items ?? []).filter((restore) => restore.getNs() === namespace).map((restore) => restore.getName());
}

/**
 * The namespace's guests as the store already holds them, for the target
 * collision warning and the target node rule.
 *
 * Free: no request, and no reason to issue one before the dialog is open. What
 * the store does not have, the list call the dialog fires on open supplies.
 */
function storedGuests(namespace: string): ExistingGuestFacts[] {
  const store = maybe(() => SwiftGuest.getStore<SwiftGuest>());

  return (store?.items ?? [])
    .filter((guest) => guest.getNs() === namespace)
    .map((guest) => ({ name: guest.getName(), nodeName: guest.status?.nodeName || guest.spec?.nodeName }));
}

export const SwiftSnapshotRestoreMenuItem = observer((props: SwiftSnapshotRestoreMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar } = props;

    // A terminating object is not a thing you act on (W4's one exception:
    // absent rather than disabled).
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = canRestore(restoreSnapshotFacts(object));
    const tooltip = verdict.enabled ? restoreTitle : `${restoreTitle}: ${verdict.reason}`;

    const onClick = () => {
      const snapshot = restoreSnapshotFacts(liveSnapshot(object));

      // The guard is re-evaluated against the live object before the dialog is
      // built: `disabled` alone does not stop the click (W4).
      if (!canRestore(snapshot).enabled) {
        return;
      }

      // The model is created here, outside React, and outlives every render of
      // the dialog's message - including the remount a 409 reopen performs.
      const model = createRestoreDialogModel(
        snapshot,
        storedRestoreNames(snapshot.namespace),
        storedGuests(snapshot.namespace),
        new Date(),
      );

      // The reads on open, none awaited and none able to throw: what they answer
      // sharpens the form, what they refuse degrades one sentence. The nodes are
      // only fetched where the field they fill exists at all (W12's option
      // dropping applied to the request, not only to the control).
      void loadSourceGuest(model);
      void loadExistingRestores(model);
      void loadExistingGuests(model);

      if (targetNodeApplies(snapshot)) {
        void loadNodeNames(model);
      }

      openRestoreDialog(model);
    };

    return (
      <MenuItem
        onClick={onClick}
        disabled={!verdict.enabled}
        data-testid="swiftsnapshot-restore-action"
        title={tooltip}
      >
        <ActionIcon
          material="settings_backup_restore"
          toolbar={toolbar}
          tooltip={tooltip}
          disabled={!verdict.enabled}
        />
        <span className="title">{restoreTitle}</span>
      </MenuItem>
    );
  }),
);

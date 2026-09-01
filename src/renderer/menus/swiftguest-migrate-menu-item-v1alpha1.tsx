/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Migrate: one `create`, behind a dialog that is both the form and the
// confirmation (SPEC-0012, W12). The decisions are pure functions in
// `components/migration-create.ts`, the form is
// `components/migration-create-dialog.tsx`, and what is here is the host wiring:
// the registration's component, the live click-time snapshot, and the reads the
// dialog opens with.
//
// Registered on SwiftGuest, because the object a migration is about is the
// guest; the SwiftMigration it writes lands on the Migrations page, which is
// what the success notification exists to say - the Guests page the click came
// from never shows it.
//
// Like the two SPEC-0011 items it does not reuse `GuestActionMenuItem`: that
// shell builds a dialog out of a fixed set of facts and hands it a `run`, while
// a create has to carry a form whose state outlives the dialog's own renders.
// What it does reuse is `liveGuest`, because reading the object the store holds
// right now, rather than the one the row was rendered with, is the same rule
// here as there (W1).

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { SwiftMigration } from "../api/kubeswift/swiftmigration-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { canMigrate } from "../components/migration-create";
import {
  createMigrationDialogModel,
  inFlightMigrationFacts,
  loadExistingMigrations,
  loadGuestClass,
  loadNodes,
  migrateTitle,
  openMigrateDialog,
} from "../components/migration-create-dialog";
import { ActionIcon } from "./action-icon";
import { liveGuest } from "./guest-action-menu-item";

import type { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import type {
  InFlightMigrationFacts,
  MigrationGuestClassFacts,
  MigrationGuestFacts,
} from "../components/migration-create";
import type { GuestMenuItemProps } from "./guest-action-menu-item";

const { observer } = MobxReact;

const {
  Component: { MenuItem },
} = Renderer;

export interface SwiftGuestMigrateMenuItemProps extends GuestMenuItemProps {
  extension: Renderer.LensExtension;
}

/** The slice of a live SwiftGuest the dialog's decisions read. */
export function migrationGuestFacts(object: SwiftGuest): MigrationGuestFacts {
  return {
    name: object.getName(),
    namespace: object.getNs(),
    spec: object.spec,
    status: object.status,
  };
}

/**
 * The guest's class as the store already holds it, for the storage capability.
 *
 * Free: no request, and no reason to issue one before the dialog is open. What
 * the store does not have, the `GET` the dialog fires on open supplies; and when
 * neither answers, the storage stays unresolved and the summary says so rather
 * than the live mode being refused on a failed read.
 */
function storedGuestClass(guest: MigrationGuestFacts): MigrationGuestClassFacts | undefined {
  const name = guest.spec?.guestClassRef?.name;

  if (!name) {
    return undefined;
  }

  const store = maybe(() => SwiftGuestClass.getStore<SwiftGuestClass>());
  const guestClass = store?.getByName(name);

  return guestClass ? { name, storage: guestClass.spec?.storage } : undefined;
}

/** The namespace's migrations as the store already holds them: names, and the unfinished ones. */
function storedMigrations(guest: MigrationGuestFacts): { existingNames: string[]; inFlight: InFlightMigrationFacts[] } {
  const store = maybe(() => SwiftMigration.getStore<SwiftMigration>());
  const migrations = (store?.items ?? []).filter((migration) => migration.getNs() === guest.namespace);

  return {
    existingNames: migrations.map((migration) => migration.getName()),
    inFlight: inFlightMigrationFacts(migrations, guest.name),
  };
}

export const SwiftGuestMigrateMenuItem = observer((props: SwiftGuestMigrateMenuItemProps) =>
  withErrorPage(props, () => {
    const { object, toolbar } = props;

    // A terminating object is not a thing you act on (W4's one exception:
    // absent rather than disabled).
    if (object.metadata?.deletionTimestamp) {
      return <></>;
    }

    const verdict = canMigrate(migrationGuestFacts(object));
    const tooltip = verdict.enabled ? migrateTitle : `${migrateTitle}: ${verdict.reason}`;

    const onClick = () => {
      const guest = migrationGuestFacts(liveGuest(object));

      // The guard is re-evaluated against the live object before the dialog is
      // built: `disabled` alone does not stop the click (W4).
      if (!canMigrate(guest).enabled) {
        return;
      }

      // The model is created here, outside React, and outlives every render of
      // the dialog's message - including the remount a 409 reopen performs.
      const model = createMigrationDialogModel(
        guest,
        { guestClass: storedGuestClass(guest), ...storedMigrations(guest) },
        new Date(),
      );

      // The reads on open, none awaited and none able to throw: what they answer
      // sharpens the form, what they refuse degrades one sentence. The nodes are
      // the one that matters most here, because the field they fill is required.
      void loadNodes(model);
      void loadGuestClass(model);
      void loadExistingMigrations(model);

      openMigrateDialog(model);
    };

    return (
      <MenuItem onClick={onClick} disabled={!verdict.enabled} data-testid="swiftguest-migrate-action" title={tooltip}>
        {/* Upstream's own icon for this verb, and a Material ligature name
            rather than their asset (ARCHITECTURE.md's licensing boundary). */}
        <ActionIcon material="swap_horiz" toolbar={toolbar} tooltip={tooltip} disabled={!verdict.enabled} />
        <span className="title">{migrateTitle}</span>
      </MenuItem>
    );
  }),
);

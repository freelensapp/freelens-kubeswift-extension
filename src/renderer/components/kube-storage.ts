/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The storage vocabulary the create forms share (SPEC-0014, "Where the code
// lives"): the two modes a PVC is described by, the defaults the API server
// falls back to, the CEL rule the SwiftGuest and SwiftGuestClass schemas both
// carry, and the live-migratability that follows from all three.
//
// Extracted from `guest-create.ts` rather than copied. One rule with two
// implementations is a rule that drifts, and this one is derived from two
// different places: the Create Guest form asks it of a guest whose class
// supplies every field the guest itself did not set, and the Create Guest Class
// form asks it of the class's own storage block, which has nothing above it to
// override it. The derivation is the same in both; only the merge that feeds it
// differs, which is why what moved here is the part below the merge.
//
// Nothing here emits JSX, reads a store or touches a host global.

import type { SwiftGuestAccessMode, SwiftGuestVolumeMode } from "../api/kubeswift/swiftguest-v1alpha1";

/**
 * The boot source, as far as the storage derivation is concerned.
 *
 * `guest-create.ts` names the same three values `GuestBootSource`; only one of
 * them changes the answer below, because a kernel-boot guest clones no root
 * disk and upstream exempts it from the storage rule outright.
 */
export type StorageBootSource = "image" | "kernel" | "clone";

/** The storage the live path needs: both nodes must be able to hold the disk at once. */
export const liveAccessMode: SwiftGuestAccessMode = "ReadWriteMany";
export const liveVolumeMode: SwiftGuestVolumeMode = "Block";

/**
 * What the API server falls back to when nothing says anything about storage.
 * Stated rather than assumed: it is the difference between a guest that can be
 * live-migrated and one that cannot.
 */
export const systemDefaultAccessMode: SwiftGuestAccessMode = "ReadWriteOnce";
export const systemDefaultVolumeMode: SwiftGuestVolumeMode = "Filesystem";

/** The storage this object will really get, and whether that answer is a fact. */
export interface ResolvedStorage {
  accessMode?: string;
  volumeMode?: string;
  storageClassName?: string;
  /** True when the fields above are the merge rather than a guess. */
  resolved: boolean;
  /** Storage both nodes can hold at once, which is what a live migration needs. */
  liveMigratable: boolean;
}

/** The three fields a resolved storage block is built from, before the verdict is added. */
export interface StorageParts {
  accessMode?: string;
  volumeMode?: string;
  storageClassName?: string;
  /** False when a read the merge needed was refused, which is never a refusal of the write. */
  resolved: boolean;
}

/**
 * The storage trio plus the one verdict that follows from it.
 *
 * The verdict is computed from the API server's own defaults rather than from
 * the fields as typed, because an unset access mode is `ReadWriteOnce` in the
 * cluster whatever the form shows.
 */
export function resolveStorage(parts: StorageParts): ResolvedStorage {
  return {
    accessMode: parts.accessMode,
    volumeMode: parts.volumeMode,
    storageClassName: parts.storageClassName,
    resolved: parts.resolved,
    liveMigratable:
      (parts.accessMode ?? systemDefaultAccessMode) === liveAccessMode &&
      (parts.volumeMode ?? systemDefaultVolumeMode) === liveVolumeMode,
  };
}

/** The merged storage in one short phrase, for the sentences that name it. */
export function resolvedStorageText(storage: ResolvedStorage): string {
  return `${storage.accessMode ?? systemDefaultAccessMode}/${storage.volumeMode ?? systemDefaultVolumeMode}`;
}

/**
 * What this storage means for a future migration, stated both ways.
 *
 * Not a warning and not an error: it is the one consequence of the storage
 * choice an operator will meet months later, when a node has to be drained and
 * the guest can only move by being stopped.
 *
 * The two ways of not being live-migratable have different reasons, and one
 * sentence for both would be false: a ReadWriteOnce disk is held by a single
 * node at a time, while a ReadWriteMany disk on a Filesystem volume is shared
 * by as many nodes as need it and is still not live-migratable, because the
 * migration needs a Block volume.
 *
 * `subject` is what the sentence is about. The Create Guest form is writing one
 * guest and says "this guest"; the Create Guest Class form is writing a template
 * and says "a guest of this class" - the same derivation, named for the object
 * the operator is actually creating.
 */
export function liveMigrationFact(
  storage: ResolvedStorage,
  source: StorageBootSource = "image",
  subject = "this guest",
): string {
  if (source === "kernel") {
    return kernelLiveMigrationFact;
  }

  if (!storage.resolved) {
    return (
      "The guest class could not be read from here, so whether this guest's root disk can be held by two nodes at " +
      `once is unverified. Live migration needs ${liveAccessMode} and ${liveVolumeMode}; anything else moves only ` +
      "by being stopped first."
    );
  }

  if (storage.liveMigratable) {
    return (
      `The root disk is ${resolvedStorageText(storage)}, which two launcher pods can hold at once: ${subject} can be ` +
      "live-migrated to another node without being stopped."
    );
  }

  if ((storage.accessMode ?? systemDefaultAccessMode) === liveAccessMode) {
    return (
      `The root disk is ${resolvedStorageText(storage)}, which more than one node can hold at once, but a live ` +
      `migration needs a ${liveVolumeMode} volume: ${subject} can be migrated offline only.`
    );
  }

  return (
    `The root disk is ${resolvedStorageText(storage)}, which only one node can hold at a time: ${subject} can be ` +
    `migrated offline only. Live migration needs ${liveAccessMode} on a ${liveVolumeMode} volume.`
  );
}

/**
 * The same answer as `liveMigrationFact`, short enough for the sizing block next
 * to a picker.
 *
 * Two renderings of one derivation rather than two derivations: the block states
 * the verdict where the storage is chosen, and the sentence states what it means
 * in the write summary.
 */
export function liveMigrationLabel(storage: ResolvedStorage, source: StorageBootSource = "image"): string {
  if (source === "kernel") {
    return "not restricted by storage (kernel boot)";
  }

  if (!storage.resolved) {
    return "unverified (the guest class could not be read)";
  }

  return storage.liveMigratable
    ? `possible (${resolvedStorageText(storage)})`
    : `offline only (${resolvedStorageText(storage)})`;
}

/**
 * What a kernel-boot guest's storage means for a future migration of it, which
 * is nothing.
 *
 * The one place these forms state an exemption rather than a constraint:
 * upstream requires shared Block storage before it will live-migrate a guest,
 * and it skips that check entirely for a kernel-boot guest, because there is no
 * cloned root disk for two launcher pods to contend for. The sentence is the
 * same fact the Migrate dialog computes from the other side (SPEC-0012).
 */
export const kernelLiveMigrationFact =
  `A kernel-boot guest clones no root disk, so the ${liveAccessMode} and ${liveVolumeMode} storage a live migration ` +
  "normally needs does not apply to it: upstream exempts it from that rule. What decides a live migration for this " +
  "guest is its devices and its node, not its storage.";

/**
 * The CEL rule both storage blocks carry, as the predicate the API server
 * evaluates.
 *
 * The rule is `!(accessMode == 'ReadWriteMany' && (!has(volumeMode) ||
 * volumeMode == 'Filesystem'))`, so an unset volume mode is refused exactly as
 * `Filesystem` is - which is the shape a client that only compared the two set
 * values would miss, and the one an operator meets as a rejected create with a
 * decoded CEL message attached.
 */
export function violatesStorageCelRule(accessMode: string, volumeMode: string): boolean {
  return accessMode === liveAccessMode && volumeMode !== liveVolumeMode;
}

/** The rule itself, in the words both forms refuse with. */
export const storageCelRuleHeadline =
  `${liveAccessMode} requires volumeMode ${liveVolumeMode}: the CRD refuses the combination outright, because a ` +
  "shared Filesystem volume is not live-migration-capable.";

/**
 * The rule as the Create Guest form states it: the guest's own block is what is
 * evaluated, so inheriting the volume mode from the class does not satisfy it.
 */
export const storageCelRule =
  `${storageCelRuleHeadline} The rule is evaluated on this guest's own storage block, ` +
  `so inheriting ${liveVolumeMode} from the guest class does not satisfy it - set it here as well.`;

/**
 * The same rule as the Create Guest Class form states it (the guest CLASS, not a
 * StorageClass: the CEL rule sits on the class's own `spec.storage`).
 *
 * A class has nothing above it to inherit from, so the guest's tail is replaced
 * by the shape the rule really has: leaving the volume mode empty is refused as
 * hard as choosing `Filesystem` (SPEC-0014, F9).
 */
export const guestClassStorageCelRule =
  `${storageCelRuleHeadline} The rule tests whether the volume mode is set at all, so ${liveAccessMode} with the ` +
  `volume mode left empty is refused exactly as ${liveAccessMode} with ${systemDefaultVolumeMode} is.`;

/** A StorageClass name is an object name, and the API server would refuse anything else. */
const storageClassNamePattern = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** The message a malformed StorageClass name is refused with. */
export const storageClassNameMessage =
  "A StorageClass name is lowercase letters, digits, '-' and '.', starting and ending with a letter or a digit.";

/** Why a typed StorageClass name would be refused, or `undefined` when it is legal or empty. */
export function storageClassNameError(name: string): string | undefined {
  return name && !storageClassNamePattern.test(name) ? storageClassNameMessage : undefined;
}

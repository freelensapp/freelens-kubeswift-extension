/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The storage derivation as the shared module now owns it (SPEC-0014).
//
// The guest-side behaviour is unchanged and is still asserted through the form
// that merges into it (`guest-create.test.ts`, which reaches the same functions
// from here). What this file covers is the surface the extraction added: the
// CEL rule as a predicate rather than as one form's message, the class-side
// wording of it, the subject the live-migration sentence can be told to name,
// and the StorageClass name rule two forms now share.

import { describe, expect, it } from "vitest";
import {
  guestClassStorageCelRule,
  liveAccessMode,
  liveMigrationFact,
  liveMigrationLabel,
  liveVolumeMode,
  resolvedStorageText,
  resolveStorage,
  storageCelRule,
  storageCelRuleHeadline,
  storageClassNameError,
  storageClassNameMessage,
  systemDefaultAccessMode,
  systemDefaultVolumeMode,
  violatesStorageCelRule,
} from "./kube-storage";

describe("resolveStorage", () => {
  it("keeps the three fields it was given", () => {
    const storage = resolveStorage({
      accessMode: "ReadWriteMany",
      volumeMode: "Block",
      storageClassName: "fast",
      resolved: true,
    });

    expect(storage.accessMode).toBe("ReadWriteMany");
    expect(storage.volumeMode).toBe("Block");
    expect(storage.storageClassName).toBe("fast");
    expect(storage.resolved).toBe(true);
  });

  it("calls the shared pair live-migratable", () => {
    expect(
      resolveStorage({ accessMode: liveAccessMode, volumeMode: liveVolumeMode, resolved: true }).liveMigratable,
    ).toBe(true);
  });

  it("refuses the same access mode on a Filesystem volume", () => {
    expect(
      resolveStorage({ accessMode: liveAccessMode, volumeMode: "Filesystem", resolved: true }).liveMigratable,
    ).toBe(false);
  });

  it("reads an unset volume mode as the API server's own default, which is not live-migratable", () => {
    expect(resolveStorage({ accessMode: liveAccessMode, resolved: true }).liveMigratable).toBe(false);
  });

  it("reads an unset access mode as the API server's own default", () => {
    expect(resolveStorage({ volumeMode: liveVolumeMode, resolved: true }).liveMigratable).toBe(false);
    expect(resolvedStorageText(resolveStorage({ resolved: true }))).toBe(
      `${systemDefaultAccessMode}/${systemDefaultVolumeMode}`,
    );
  });
});

describe("violatesStorageCelRule", () => {
  it("accepts the one pair the CRD allows", () => {
    expect(violatesStorageCelRule(liveAccessMode, liveVolumeMode)).toBe(false);
  });

  it("refuses ReadWriteMany on a Filesystem volume", () => {
    expect(violatesStorageCelRule(liveAccessMode, systemDefaultVolumeMode)).toBe(true);
  });

  it("refuses ReadWriteMany with the volume mode absent, which is the shape a value comparison misses", () => {
    expect(violatesStorageCelRule(liveAccessMode, "")).toBe(true);
  });

  it("says nothing about ReadWriteOnce, whatever the volume mode is", () => {
    expect(violatesStorageCelRule(systemDefaultAccessMode, "")).toBe(false);
    expect(violatesStorageCelRule(systemDefaultAccessMode, systemDefaultVolumeMode)).toBe(false);
    expect(violatesStorageCelRule(systemDefaultAccessMode, liveVolumeMode)).toBe(false);
  });

  it("says nothing about an empty access mode, which the rule does not reach", () => {
    expect(violatesStorageCelRule("", "")).toBe(false);
  });
});

describe("the CEL rule's two wordings", () => {
  it("shares one headline, so the rule itself cannot drift between the two forms", () => {
    expect(storageCelRule.startsWith(storageCelRuleHeadline)).toBe(true);
    expect(guestClassStorageCelRule.startsWith(storageCelRuleHeadline)).toBe(true);
  });

  it("keeps the guest's own tail about the merge the class does not have", () => {
    expect(storageCelRule).toContain("this guest's own storage block");
    expect(guestClassStorageCelRule).not.toContain("this guest's own storage block");
  });

  it("says the absent shape out loud on the class, where there is nothing to inherit", () => {
    expect(guestClassStorageCelRule).toContain("left empty");
  });

  it("names both values of the pair in both wordings", () => {
    for (const rule of [storageCelRule, guestClassStorageCelRule]) {
      expect(rule).toContain(liveAccessMode);
      expect(rule).toContain(liveVolumeMode);
    }
  });
});

describe("liveMigrationFact", () => {
  it("names the subject it was given rather than assuming a guest", () => {
    const storage = resolveStorage({ accessMode: liveAccessMode, volumeMode: liveVolumeMode, resolved: true });

    expect(liveMigrationFact(storage, "image", "a guest of this class")).toContain("a guest of this class");
  });

  it("keeps naming this guest when no subject is given, which is what the Create Guest form sends", () => {
    const storage = resolveStorage({ resolved: true });

    expect(liveMigrationFact(storage)).toContain("this guest");
  });

  it("carries the subject into the ReadWriteMany-on-Filesystem sentence too", () => {
    const storage = resolveStorage({ accessMode: liveAccessMode, volumeMode: "Filesystem", resolved: true });
    const fact = liveMigrationFact(storage, "image", "a guest of this class");

    expect(fact).toContain("a guest of this class");
    expect(fact).toContain(liveVolumeMode);
  });

  it("never returns an empty sentence for any of the four shapes", () => {
    for (const parts of [
      { accessMode: liveAccessMode, volumeMode: liveVolumeMode },
      { accessMode: liveAccessMode, volumeMode: "Filesystem" },
      { accessMode: systemDefaultAccessMode, volumeMode: liveVolumeMode },
      {},
    ]) {
      expect(liveMigrationFact(resolveStorage({ ...parts, resolved: true }))).not.toBe("");
    }
  });

  it("never disagrees with the short form it shares its derivation with", () => {
    for (const parts of [
      { accessMode: liveAccessMode, volumeMode: liveVolumeMode },
      { accessMode: liveAccessMode, volumeMode: "Filesystem" },
      { accessMode: systemDefaultAccessMode, volumeMode: liveVolumeMode },
      {},
    ]) {
      const storage = resolveStorage({ ...parts, resolved: true });
      const label = liveMigrationLabel(storage);
      const fact = liveMigrationFact(storage);

      expect(label.startsWith("possible")).toBe(storage.liveMigratable);
      expect(fact.includes("without being stopped")).toBe(storage.liveMigratable);
    }
  });
});

describe("storageClassNameError", () => {
  it("accepts an object name", () => {
    expect(storageClassNameError("fast")).toBeUndefined();
    expect(storageClassNameError("csi.example.com")).toBeUndefined();
  });

  it("accepts an empty value, because the requirement is the caller's", () => {
    expect(storageClassNameError("")).toBeUndefined();
  });

  it("refuses what the API server would refuse, with the reason", () => {
    expect(storageClassNameError("Fast")).toBe(storageClassNameMessage);
    expect(storageClassNameError("-fast")).toBe(storageClassNameMessage);
    expect(storageClassNameError("fast_class")).toBe(storageClassNameMessage);
    expect(storageClassNameMessage).not.toBe("");
  });
});

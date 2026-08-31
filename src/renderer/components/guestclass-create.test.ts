/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Guest Class form decides (SPEC-0014, slice 1).
//
// The bar is the shipped small dialogs, counted as `it(...)` blocks: 65 for Take
// Snapshot, 83 for Restore. The class sits there because its schema is the whole
// rule set - there is no webhook for this kind, disabled or otherwise - and
// because the three refusals that matter most are refusals the API server would
// accept: zero, a negative, and ReadWriteMany with the volume mode left empty.

import { describe, expect, it } from "vitest";
import {
  coreSchedulingNote,
  createGuestClassTitle,
  defaultCoreScheduling,
  defaultGuestClassForm,
  guestClassBlockingIssues,
  guestClassCoreSchedulingPolicies,
  guestClassCreateErrors,
  guestClassCreateFailureMessage,
  guestClassCreateFailurePrefix,
  guestClassCreatePayload,
  guestClassCreateSuccessMessage,
  guestClassCreateSummary,
  guestClassCreatesNothingFact,
  guestClassCreateWarnings,
  guestClassDiskFormats,
  guestClassLiveMigrationFact,
  guestClassResolvedStorage,
  guestClassScopeFact,
  guestClassSizingRulesFact,
  guestClassStoragePayload,
  guestClassSubmitBlockReason,
  hasQuantityUnit,
  migratableStorageClassWarning,
  quantityError,
  quantityFormatMessage,
  quantityGrammar,
  quantityNegativeMessage,
  quantityZeroMessage,
} from "./guestclass-create";
import { guestClassStorageCelRule, liveAccessMode, liveVolumeMode } from "./kube-storage";

import type { GuestClassCreateInputs, GuestClassFormValues } from "./guestclass-create";

function inputs(overrides: Partial<GuestClassCreateInputs> = {}): GuestClassCreateInputs {
  return {
    storageClasses: ["fast", "standard"],
    storageClassesUnverified: false,
    existingNames: ["e2e-small", "e2e-large"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** A form that would submit, so each case can break exactly one thing. */
function values(overrides: Partial<GuestClassFormValues> = {}): GuestClassFormValues {
  return {
    ...defaultGuestClassForm(),
    name: "gold",
    cpu: "4",
    memory: "8Gi",
    rootDiskSize: "40Gi",
    rootDiskFormat: "qcow2",
    ...overrides,
  };
}

describe("defaultGuestClassForm", () => {
  it("prefills nothing, because three upstream sources give three root-disk sizes", () => {
    const form = defaultGuestClassForm();

    expect(form.cpu).toBe("");
    expect(form.memory).toBe("");
    expect(form.rootDiskSize).toBe("");
    expect(form.rootDiskFormat).toBe("");
  });

  it("opens with no name and no storage block", () => {
    const form = defaultGuestClassForm();

    expect(form.name).toBe("");
    expect(form.storageAccessMode).toBe("");
    expect(form.storageVolumeMode).toBe("");
    expect(form.storageClassName).toBe("");
  });

  it("opens on the core-scheduling policy the schema itself stamps", () => {
    expect(defaultGuestClassForm().coreScheduling).toBe(defaultCoreScheduling);
    expect(defaultCoreScheduling).toBe("off");
  });

  it("names the verb the OK button carries", () => {
    expect(createGuestClassTitle).toBe("Create Guest Class");
  });
});

describe("quantityError", () => {
  it("accepts a plain count", () => {
    expect(quantityError("4")).toBeUndefined();
  });

  it("accepts a binary suffix", () => {
    expect(quantityError("8Gi")).toBeUndefined();
    expect(quantityError("512Mi")).toBeUndefined();
  });

  it("accepts a decimal suffix", () => {
    expect(quantityError("1.5G")).toBeUndefined();
  });

  it("accepts the milli suffix cpu is usually written with", () => {
    expect(quantityError("500m")).toBeUndefined();
  });

  it("accepts an exponent, which the schema's own pattern allows", () => {
    expect(quantityError("1e3")).toBeUndefined();
  });

  it("says nothing about an empty value, because required-ness belongs to the form", () => {
    expect(quantityError("")).toBeUndefined();
    expect(quantityError("   ")).toBeUndefined();
  });

  it("ignores surrounding whitespace, which the field cannot stop the user typing", () => {
    expect(quantityError("  4Gi  ")).toBeUndefined();
  });

  it("refuses a value that is not a quantity at all, naming the units that are", () => {
    expect(quantityError("lots")).toBe(quantityFormatMessage);
    expect(quantityFormatMessage).toContain("Gi");
  });

  it("refuses a unit the API server does not have", () => {
    expect(quantityError("4GB")).toBe(quantityFormatMessage);
    expect(quantityError("4gb")).toBe(quantityFormatMessage);
  });

  it("refuses zero, which the schema accepts and nothing honours", () => {
    expect(quantityError("0")).toBe(quantityZeroMessage);
    expect(quantityZeroMessage).toContain("no minimum");
  });

  it("refuses a zero with a unit too, which reads as a size and is not one", () => {
    expect(quantityError("0Gi")).toBe(quantityZeroMessage);
    expect(quantityError("0.0")).toBe(quantityZeroMessage);
  });

  it("refuses a negative quantity, which the schema's pattern explicitly allows", () => {
    expect(quantityError("-1")).toBe(quantityNegativeMessage);
    expect(quantityError("-4Gi")).toBe(quantityNegativeMessage);
  });

  it("accepts an explicitly signed positive value", () => {
    expect(quantityError("+4Gi")).toBeUndefined();
  });

  it("refuses a signed zero as zero rather than as a sign problem", () => {
    expect(quantityError("+0")).toBe(quantityZeroMessage);
    expect(quantityError("-0")).toBe(quantityZeroMessage);
  });

  it("never refuses without a reason", () => {
    for (const value of ["0", "-1", "lots", "4GB", "", "4Gi"]) {
      const message = quantityError(value);

      expect(message === undefined || message.length > 0).toBe(true);
    }
  });
});

describe("hasQuantityUnit", () => {
  it("is false for a plain number, which is a byte count for a size", () => {
    expect(hasQuantityUnit("4")).toBe(false);
    expect(hasQuantityUnit("+4")).toBe(false);
  });

  it("is true for a suffixed quantity", () => {
    expect(hasQuantityUnit("4Gi")).toBe(true);
    expect(hasQuantityUnit("500m")).toBe(true);
  });

  it("states the grammar the fields carry as their hint", () => {
    expect(quantityGrammar).toContain("BYTES");
    expect(quantityGrammar).toContain("4Gi");
  });
});

describe("guestClassCreateErrors", () => {
  it("accepts a complete form", () => {
    expect(guestClassCreateErrors(values())).toEqual({});
  });

  it("requires a name, in the API server's own words", () => {
    expect(guestClassCreateErrors(values({ name: "" })).name).toBe("A name is required.");
  });

  it("refuses a name the API server would refuse", () => {
    expect(guestClassCreateErrors(values({ name: "Gold" })).name).toContain("lowercase");
  });

  it("requires cpu, memory and the root disk size, which the schema requires too", () => {
    const errors = guestClassCreateErrors(values({ cpu: "", memory: "", rootDiskSize: "" }));

    expect(errors.cpu).toContain("required");
    expect(errors.memory).toContain("required");
    expect(errors.rootDiskSize).toContain("required");
  });

  it("names the field in each required message", () => {
    expect(guestClassCreateErrors(values({ cpu: "" })).cpu).toContain("CPU");
    expect(guestClassCreateErrors(values({ memory: "" })).memory).toContain("Memory");
    expect(guestClassCreateErrors(values({ rootDiskSize: "" })).rootDiskSize).toContain("Root disk size");
  });

  it("refuses a zero cpu, which is the object the schema would store happily", () => {
    expect(guestClassCreateErrors(values({ cpu: "0" })).cpu).toBe(quantityZeroMessage);
  });

  it("refuses a negative memory", () => {
    expect(guestClassCreateErrors(values({ memory: "-8Gi" })).memory).toBe(quantityNegativeMessage);
  });

  it("refuses a root disk size that is not a quantity", () => {
    expect(guestClassCreateErrors(values({ rootDiskSize: "40 gigs" })).rootDiskSize).toBe(quantityFormatMessage);
  });

  it("requires the root disk format, which no webhook would default here", () => {
    const error = guestClassCreateErrors(values({ rootDiskFormat: "" })).rootDiskFormat;

    expect(error).toContain("required");
    expect(error).toContain("webhook");
  });

  it("accepts both formats the enum offers", () => {
    for (const format of guestClassDiskFormats) {
      expect(guestClassCreateErrors(values({ rootDiskFormat: format })).rootDiskFormat).toBeUndefined();
    }
  });

  it("refuses ReadWriteMany on a Filesystem volume, which is the CRD's own CEL rule", () => {
    const errors = guestClassCreateErrors(
      values({ storageAccessMode: liveAccessMode, storageVolumeMode: "Filesystem" }),
    );

    expect(errors.storageAccessMode).toBe(guestClassStorageCelRule);
  });

  it("refuses ReadWriteMany with the volume mode left empty, which is the shape upstream misses", () => {
    const errors = guestClassCreateErrors(values({ storageAccessMode: liveAccessMode, storageVolumeMode: "" }));

    expect(errors.storageAccessMode).toBe(guestClassStorageCelRule);
    expect(guestClassStorageCelRule).toContain("left empty");
  });

  it("accepts the one pair the rule allows", () => {
    const errors = guestClassCreateErrors(
      values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode }),
    );

    expect(errors.storageAccessMode).toBeUndefined();
  });

  it("says nothing about ReadWriteOnce with no volume mode, which the rule does not reach", () => {
    const errors = guestClassCreateErrors(values({ storageAccessMode: "ReadWriteOnce" }));

    expect(errors.storageAccessMode).toBeUndefined();
  });

  it("refuses a StorageClass name the API server would refuse", () => {
    expect(guestClassCreateErrors(values({ storageClassName: "Fast" })).storageClassName).toContain("lowercase");
  });

  it("accepts an empty storage block entirely, which is the normal case", () => {
    expect(guestClassCreateErrors(values())).toEqual({});
  });

  it("never refuses a field without a non-empty reason", () => {
    const broken = values({
      name: "",
      cpu: "0",
      memory: "-1",
      rootDiskSize: "nope",
      rootDiskFormat: "",
      storageAccessMode: liveAccessMode,
      storageVolumeMode: "Filesystem",
      storageClassName: "Fast",
    });

    for (const message of Object.values(guestClassCreateErrors(broken))) {
      expect(message).not.toBe("");
    }
  });
});

describe("guestClassCreateWarnings", () => {
  it("warns about a name the cluster already has, and does not refuse it", () => {
    const warning = guestClassCreateWarnings(inputs(), values({ name: "e2e-small" })).name;

    expect(warning).toContain("already exists");
    expect(guestClassCreateErrors(values({ name: "e2e-small" })).name).toBeUndefined();
  });

  it("says the collision is unverified rather than absent when the list was refused", () => {
    const warning = guestClassCreateWarnings(
      inputs({ existingNames: [], existingNamesUnverified: true }),
      values({ name: "gold" }),
    ).name;

    expect(warning).toContain("unverified");
  });

  it("says nothing about a name no class has", () => {
    expect(guestClassCreateWarnings(inputs(), values({ name: "gold" })).name).toBeUndefined();
  });

  it("warns that a unitless memory is a byte count", () => {
    const warning = guestClassCreateWarnings(inputs(), values({ memory: "8" })).memory;

    expect(warning).toContain("bytes");
    expect(warning).toContain("8Gi");
  });

  it("warns the same way about a unitless root disk size", () => {
    expect(guestClassCreateWarnings(inputs(), values({ rootDiskSize: "40" })).rootDiskSize).toContain("bytes");
  });

  it("says nothing about a unitless cpu, where a plain number is the usual form", () => {
    expect(guestClassCreateWarnings(inputs(), values({ cpu: "4" })).cpu).toBeUndefined();
  });

  it("does not warn about a byte count that is already refused for another reason", () => {
    expect(guestClassCreateWarnings(inputs(), values({ memory: "0" })).memory).toBeUndefined();
  });

  it("warns that the allowed pair still needs a migration-capable StorageClass", () => {
    const warning = guestClassCreateWarnings(
      inputs(),
      values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode }),
    ).storageVolumeMode;

    expect(warning).toBe(migratableStorageClassWarning);
    expect(warning).toContain("two nodes at once");
  });

  it("drops that warning once a StorageClass has been named", () => {
    const warning = guestClassCreateWarnings(
      inputs(),
      values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode, storageClassName: "fast" }),
    ).storageVolumeMode;

    expect(warning).toBeUndefined();
  });

  it("warns about a StorageClass the cluster does not have, and does not refuse it", () => {
    const warning = guestClassCreateWarnings(inputs(), values({ storageClassName: "nope" })).storageClassName;

    expect(warning).toContain("No StorageClass named nope");
    expect(warning).toContain("never binds");
  });

  it("says the StorageClass is unverified rather than missing when the read was refused", () => {
    const warning = guestClassCreateWarnings(
      inputs({ storageClasses: [], storageClassesUnverified: true }),
      values({ storageClassName: "nope" }),
    ).storageClassName;

    expect(warning).toContain("unverified");
    expect(warning).not.toContain("No StorageClass named");
  });

  it("says nothing about a StorageClass the read returned", () => {
    expect(guestClassCreateWarnings(inputs(), values({ storageClassName: "fast" })).storageClassName).toBeUndefined();
  });

  it("does not warn about a StorageClass name that is already refused", () => {
    expect(guestClassCreateWarnings(inputs(), values({ storageClassName: "Fast" })).storageClassName).toBeUndefined();
  });
});

describe("guestClassSubmitBlockReason", () => {
  it("is undefined for a form that would submit", () => {
    expect(guestClassSubmitBlockReason(values())).toBeUndefined();
  });

  it("names the field and its reason, so a disabled button is never mute", () => {
    const reason = guestClassSubmitBlockReason(values({ cpu: "" }));

    expect(reason).toContain("CPU");
    expect(reason).toContain("required");
  });

  it("names the first field in the reading order of the form", () => {
    expect(guestClassSubmitBlockReason(values({ name: "", cpu: "" }))).toContain("Name");
  });

  it("lists every blocking issue in the reading order", () => {
    const issues = guestClassBlockingIssues(values({ name: "", memory: "0", rootDiskFormat: "" }));

    expect(issues.map((issue) => issue.label)).toEqual(["Name", "Memory", "Root disk format"]);
  });

  it("carries a non-empty message on every issue it lists", () => {
    for (const issue of guestClassBlockingIssues(values({ name: "", cpu: "-1", rootDiskSize: "x" }))) {
      expect(issue.message).not.toBe("");
    }
  });

  it("blocks on the CEL rule, which the API server would answer with a decoded message", () => {
    const reason = guestClassSubmitBlockReason(values({ storageAccessMode: liveAccessMode }));

    expect(reason).toContain("Access mode");
    expect(reason).toContain(liveVolumeMode);
  });
});

describe("guestClassStoragePayload", () => {
  it("is undefined when nothing in the block was set, rather than an empty object", () => {
    expect(guestClassStoragePayload(values())).toBeUndefined();
  });

  it("sends only the access mode when only the access mode was chosen", () => {
    expect(guestClassStoragePayload(values({ storageAccessMode: "ReadWriteOnce" }))).toEqual({
      accessMode: "ReadWriteOnce",
    });
  });

  it("sends only the volume mode when only the volume mode was chosen", () => {
    expect(guestClassStoragePayload(values({ storageVolumeMode: "Block" }))).toEqual({ volumeMode: "Block" });
  });

  it("sends only the class name when only the class name was typed", () => {
    expect(guestClassStoragePayload(values({ storageClassName: "fast" }))).toEqual({ storageClassName: "fast" });
  });

  it("sends all three when all three were set", () => {
    expect(
      guestClassStoragePayload(
        values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode, storageClassName: "fast" }),
      ),
    ).toEqual({ accessMode: liveAccessMode, volumeMode: liveVolumeMode, storageClassName: "fast" });
  });

  it("trims the class name rather than storing the spaces", () => {
    expect(guestClassStoragePayload(values({ storageClassName: "  fast  " }))).toEqual({ storageClassName: "fast" });
  });

  it("drops a whitespace-only class name entirely", () => {
    expect(guestClassStoragePayload(values({ storageClassName: "   " }))).toBeUndefined();
  });
});

describe("guestClassCreatePayload", () => {
  it("sends the four required leaves and nothing else", () => {
    const { spec } = guestClassCreatePayload(values());

    expect(Object.keys(spec).sort()).toEqual(["cpu", "memory", "rootDisk"]);
    expect(spec.cpu).toBe("4");
    expect(spec.memory).toBe("8Gi");
    expect(spec.rootDisk).toEqual({ format: "qcow2", size: "40Gi" });
  });

  it("never sends coreScheduling off, which is what the schema stamps", () => {
    expect(guestClassCreatePayload(values()).spec.coreScheduling).toBeUndefined();
    expect(guestClassCreatePayload(values({ coreScheduling: "off" })).spec.coreScheduling).toBeUndefined();
  });

  it("sends coreScheduling when it is not the default", () => {
    expect(guestClassCreatePayload(values({ coreScheduling: "vm" })).spec.coreScheduling).toBe("vm");
    expect(guestClassCreatePayload(values({ coreScheduling: "vcpu" })).spec.coreScheduling).toBe("vcpu");
  });

  it("never sends an empty storage object", () => {
    const { spec } = guestClassCreatePayload(values());

    expect(spec.storage).toBeUndefined();
    expect(Object.keys(spec)).not.toContain("storage");
  });

  it("sends the storage block when something in it was set", () => {
    const { spec } = guestClassCreatePayload(values({ storageVolumeMode: "Block" }));

    expect(spec.storage).toEqual({ volumeMode: "Block" });
  });

  it("trims every quantity it sends", () => {
    const { spec } = guestClassCreatePayload(values({ cpu: " 4 ", memory: " 8Gi ", rootDiskSize: " 40Gi " }));

    expect(spec.cpu).toBe("4");
    expect(spec.memory).toBe("8Gi");
    expect(spec.rootDisk.size).toBe("40Gi");
  });

  it("sends the format the form chose", () => {
    expect(guestClassCreatePayload(values({ rootDiskFormat: "raw" })).spec.rootDisk.format).toBe("raw");
  });

  it("carries no name: the store's create carries it", () => {
    expect(JSON.stringify(guestClassCreatePayload(values()))).not.toContain("gold");
  });

  it("carries no namespace, which the kind does not have", () => {
    expect(JSON.stringify(guestClassCreatePayload(values()))).not.toContain("namespace");
  });

  it("sends every key the schema requires, whatever else is empty", () => {
    const { spec } = guestClassCreatePayload(values({ storageAccessMode: "", storageVolumeMode: "" }));

    expect(spec.cpu).not.toBe("");
    expect(spec.memory).not.toBe("");
    expect(spec.rootDisk.size).not.toBe("");
    expect(spec.rootDisk.format).not.toBe("");
  });
});

describe("guestClassResolvedStorage", () => {
  it("is always resolved: a class has nothing above it to inherit from", () => {
    expect(guestClassResolvedStorage(values()).resolved).toBe(true);
  });

  it("calls the allowed pair live-migratable", () => {
    expect(
      guestClassResolvedStorage(values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode }))
        .liveMigratable,
    ).toBe(true);
  });

  it("falls back to the API server's own defaults when the block is empty", () => {
    const storage = guestClassResolvedStorage(values());

    expect(storage.accessMode).toBeUndefined();
    expect(storage.liveMigratable).toBe(false);
  });

  it("names a guest of this class rather than this guest, which is not what is being written", () => {
    const fact = guestClassLiveMigrationFact(values());

    expect(fact).toContain("a guest of this class");
    expect(fact).not.toContain("this guest can");
  });

  it("says the empty block moves offline only", () => {
    expect(guestClassLiveMigrationFact(values())).toContain("offline only");
  });

  it("says the allowed pair can move without being stopped", () => {
    const fact = guestClassLiveMigrationFact(
      values({ storageAccessMode: liveAccessMode, storageVolumeMode: liveVolumeMode }),
    );

    expect(fact).toContain("without being stopped");
  });
});

describe("coreSchedulingNote", () => {
  it("says what off does, and that it is not sent", () => {
    expect(coreSchedulingNote("off")).toContain("not sent");
  });

  it("names vm as the multi-tenant isolation upstream documents", () => {
    expect(coreSchedulingNote("vm")).toContain("multi-tenant");
  });

  it("says that vcpu is undocumented rather than inventing what it costs", () => {
    expect(coreSchedulingNote("vcpu")).toContain("nowhere");
  });

  it("has a non-empty sentence for every policy the enum offers", () => {
    for (const policy of guestClassCoreSchedulingPolicies) {
      expect(coreSchedulingNote(policy)).not.toBe("");
    }
  });
});

describe("guestClassCreateSummary", () => {
  it("names the object it writes, with no namespace at all", () => {
    expect(guestClassCreateSummary(inputs(), values()).write).toBe("Create SwiftGuestClass gold");
  });

  it("uses a placeholder before the name is typed", () => {
    expect(guestClassCreateSummary(inputs(), values({ name: "" })).write).toBe("Create SwiftGuestClass <name>");
  });

  it("says that the create sets nothing in motion", () => {
    const { notes } = guestClassCreateSummary(inputs(), values());

    expect(notes).toContain(guestClassCreatesNothingFact);
    expect(guestClassCreatesNothingFact).toContain("no status subresource");
  });

  it("says the class is usable the moment it exists", () => {
    expect(guestClassCreatesNothingFact).toContain("the moment it exists");
  });

  it("states the sizing every guest of the class inherits", () => {
    const { notes } = guestClassCreateSummary(inputs(), values());

    expect(notes.some((note) => note.includes("4 cpu, 8Gi of memory and a 40Gi qcow2 root disk"))).toBe(true);
  });

  it("leaves the sizing line out while the sizing is incomplete", () => {
    const { notes } = guestClassCreateSummary(inputs(), values({ memory: "" }));

    expect(notes.some((note) => note.includes("of memory and a"))).toBe(false);
  });

  it("carries the two unenforced sizing rules", () => {
    expect(guestClassCreateSummary(inputs(), values()).notes).toContain(guestClassSizingRulesFact);
    expect(guestClassSizingRulesFact).toContain("opposite directions");
  });

  it("carries the live-migration sentence", () => {
    const { notes } = guestClassCreateSummary(inputs(), values());

    expect(notes).toContain(guestClassLiveMigrationFact(values()));
  });

  it("names the StorageClass when one was chosen", () => {
    const { notes } = guestClassCreateSummary(inputs(), values({ storageClassName: "fast" }));

    expect(notes.some((note) => note.includes("StorageClass fast"))).toBe(true);
  });

  it("says nothing about a StorageClass when none was chosen", () => {
    const { notes } = guestClassCreateSummary(inputs(), values());

    expect(notes.some((note) => note.includes("StorageClass"))).toBe(false);
  });

  it("states the core-scheduling policy only when it is not the default", () => {
    expect(guestClassCreateSummary(inputs(), values()).notes.some((note) => note.includes("coreScheduling"))).toBe(
      false,
    );
    expect(
      guestClassCreateSummary(inputs(), values({ coreScheduling: "vm" })).notes.some((note) =>
        note.includes("coreScheduling vm"),
      ),
    ).toBe(true);
  });

  it("repeats the collision warning in the summary as well as at the field", () => {
    const { warnings } = guestClassCreateSummary(inputs(), values({ name: "e2e-small" }));

    expect(warnings.some((warning) => warning.includes("already exists"))).toBe(true);
  });

  it("repeats what a refused read left unverified", () => {
    const { warnings } = guestClassCreateSummary(
      inputs({ storageClasses: [], storageClassesUnverified: true }),
      values({ storageClassName: "fast" }),
    );

    expect(warnings.some((warning) => warning.includes("unverified"))).toBe(true);
  });

  it("has no warnings for a clean form", () => {
    expect(guestClassCreateSummary(inputs(), values()).warnings).toEqual([]);
  });

  it("never carries an empty note or an empty warning", () => {
    const summary = guestClassCreateSummary(
      inputs({ existingNamesUnverified: true, existingNames: [] }),
      values({ memory: "8", coreScheduling: "vcpu", storageClassName: "nope" }),
    );

    for (const line of [...summary.notes, ...summary.warnings]) {
      expect(line).not.toBe("");
    }
  });
});

describe("the facts the form states in place of a control", () => {
  it("says the kind is cluster-scoped where the namespace field would have been", () => {
    expect(guestClassScopeFact).toContain("cluster-scoped");
    expect(guestClassScopeFact).toContain("metadata.namespace");
  });

  it("names both sizing rules the docs call mandatory", () => {
    expect(guestClassSizingRulesFact).toContain("format");
    expect(guestClassSizingRulesFact).toContain("size");
  });

  it("says that no webhook exists for this kind at all", () => {
    expect(guestClassSizingRulesFact).toContain("No webhook exists for this kind");
  });
});

describe("the create's own messages", () => {
  it("acknowledges a create with no namespace in the sentence", () => {
    expect(guestClassCreateSuccessMessage("gold")).toBe("SwiftGuestClass gold created");
  });

  it("names the collision and what to do about it", () => {
    const prefix = guestClassCreateFailurePrefix(409, "gold");

    expect(prefix).toContain("already exists in this cluster");
    expect(prefix).toContain("Change the name");
  });

  it("names the verb and the resource on a 403, without a namespace", () => {
    const prefix = guestClassCreateFailurePrefix(403, "gold");

    expect(prefix).toContain("create swiftguestclasses");
    expect(prefix).not.toContain("namespace");
  });

  it("says the CRD is gone on a 404", () => {
    expect(guestClassCreateFailurePrefix(404, "gold")).toContain("CRD is gone");
  });

  it("adds nothing to a failure it cannot predict", () => {
    expect(guestClassCreateFailurePrefix(500, "gold")).toBeUndefined();
  });

  it("prefixes its sentence to the API server's own words rather than replacing them", () => {
    const message = guestClassCreateFailureMessage(
      { code: 409, message: "already exists", alreadyNotified: false },
      "gold",
    );

    expect(message).toContain("Change the name");
    expect(message).toContain("already exists");
  });

  it("passes an unpredictable failure through exactly as it arrived", () => {
    expect(
      guestClassCreateFailureMessage({ code: 500, message: "internal error", alreadyNotified: false }, "gold"),
    ).toBe("internal error");
  });

  it("falls back to its own sentence when the API server said nothing", () => {
    expect(guestClassCreateFailureMessage({ code: 409, alreadyNotified: false }, "gold")).toContain("already exists");
  });
});

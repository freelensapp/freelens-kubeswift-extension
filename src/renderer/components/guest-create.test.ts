import { describe, expect, it } from "vitest";
import {
  createGuestTitle,
  defaultBootSource,
  defaultGuestForm,
  defaultNamespace,
  defaultRunPolicy,
  excludedFieldsFooter,
  guestAgentFact,
  guestClassChoices,
  guestClassSizing,
  guestClassSummary,
  guestCreateErrors,
  guestCreateFailureMessage,
  guestCreateFailurePrefix,
  guestCreateFieldLabels,
  guestCreatePayload,
  guestCreateSubmitBlockReason,
  guestCreateSuccessMessage,
  guestCreateSummary,
  guestCreateWarnings,
  guestImageChoices,
  guestNameError,
  guestNodeChoices,
  guestOsType,
  guestRunPolicies,
  guestRunPolicyChoices,
  guestStorageOverrides,
  imageWillWaitFact,
  implementedBootSources,
  liveMigrationFact,
  liveMigrationLabel,
  maxGuestNameLength,
  nodePinFact,
  noGuestNodeReason,
  pickedGuestClass,
  pickedImage,
  readyImagePhase,
  resolvedStorage,
  resolvedStorageText,
  runPolicyNote,
  runPolicyStarts,
  storageCelRule,
  storageFields,
  systemDefaultAccessMode,
  systemDefaultVolumeMode,
  windowsConstraintFact,
} from "./guest-create";

import type { SwiftGuestRunPolicy } from "../api/kubeswift/swiftguest-v1alpha1";
import type {
  GuestClassFacts,
  GuestCreateField,
  GuestCreateInputs,
  GuestFormValues,
  GuestImageFacts,
} from "./guest-create";
import type { NodeFacts } from "./migration-create";

/** A class whose storage two launcher pods can share: the live-migratable one. */
const sharedClass: GuestClassFacts = {
  name: "e2e-shared",
  cpu: "4",
  memory: "8Gi",
  rootDisk: { format: "qcow2", size: "40Gi" },
  coreScheduling: "vm",
  storage: { accessMode: "ReadWriteMany", volumeMode: "Block", storageClassName: "longhorn" },
};

/** The class most clusters really have: one node at a time. */
const smallClass: GuestClassFacts = {
  name: "e2e-small",
  cpu: "2",
  memory: "4Gi",
  rootDisk: { format: "qcow2", size: "20Gi" },
  coreScheduling: "off",
  storage: { accessMode: "ReadWriteOnce", volumeMode: "Filesystem" },
};

/** A class whose disk is shared but not on a Block volume: several nodes, still no live migration. */
const sharedFilesystemClass: GuestClassFacts = {
  name: "e2e-shared-fs",
  cpu: "4",
  memory: "8Gi",
  rootDisk: { format: "qcow2", size: "40Gi" },
  storage: { accessMode: "ReadWriteMany", volumeMode: "Filesystem" },
};

/** The same shared disk with the volume mode left unset, so the cluster default answers for it. */
const sharedDefaultVolumeClass: GuestClassFacts = {
  name: "e2e-shared-default",
  cpu: "4",
  memory: "8Gi",
  rootDisk: { format: "qcow2", size: "40Gi" },
  storage: { accessMode: "ReadWriteMany" },
};

/** A class that says nothing about storage, so the cluster defaults answer for it. */
const bareClass: GuestClassFacts = {
  name: "e2e-bare",
  cpu: "1",
  memory: "2Gi",
  rootDisk: { format: "raw", size: "10Gi" },
};

const readyImage: GuestImageFacts = { name: "ubuntu-2404", phase: "Ready", osType: "linux" };
const importingImage: GuestImageFacts = { name: "ubuntu-2604", phase: "Importing", osType: "linux" };
const windowsImage: GuestImageFacts = { name: "windows-2022", phase: "Ready", osType: "windows" };
const phaselessImage: GuestImageFacts = { name: "fresh-image" };

const nodes: NodeFacts[] = [
  { name: "node-b", ready: true, schedulable: true },
  { name: "node-a", ready: true, schedulable: true },
  { name: "node-cordoned", ready: true, schedulable: false },
  { name: "node-down", ready: false, schedulable: true },
];

function inputs(overrides: Partial<GuestCreateInputs> = {}): GuestCreateInputs {
  return {
    guestClasses: [smallClass, sharedClass, bareClass],
    guestClassesUnverified: false,
    images: [readyImage, importingImage, windowsImage, phaselessImage],
    imagesUnverified: false,
    seedProfiles: [{ name: "e2e-seed-basic", datasource: "NoCloud" }],
    seedProfilesUnverified: false,
    nodes,
    nodesUnverified: false,
    existingNames: ["already-here"],
    ...overrides,
  };
}

function values(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return {
    ...defaultGuestForm("vms"),
    name: "demo",
    guestClass: "e2e-small",
    image: "ubuntu-2404",
    ...overrides,
  };
}

/** The summary as one line, for the assertions that are about a sentence being there. */
function summaryText(overrides: Partial<GuestFormValues> = {}, inputOverrides: Partial<GuestCreateInputs> = {}) {
  const facts = guestCreateSummary(inputs(inputOverrides), values(overrides));

  return [facts.write, ...facts.notes, ...facts.warnings].join(" ");
}

describe("defaultGuestForm", () => {
  it("opens on the namespace it is given", () => {
    expect(defaultGuestForm("vms").namespace).toBe("vms");
  });

  it("opens with no namespace when none was decided", () => {
    expect(defaultGuestForm().namespace).toBe("");
  });

  it("never pre-selects a guest class: the sizing decision stays explicit", () => {
    expect(defaultGuestForm().guestClass).toBe("");
  });

  it("never pre-selects an image: the other decision with resource consequences", () => {
    expect(defaultGuestForm().image).toBe("");
  });

  it("sends the run policy the mutating webhook would have defaulted", () => {
    expect(defaultGuestForm().runPolicy).toBe(defaultRunPolicy);
    expect(defaultRunPolicy).toBe("Running");
  });

  it("opens on the one boot source this slice implements", () => {
    expect(defaultGuestForm().bootSource).toBe(defaultBootSource);
    expect(implementedBootSources).toEqual(["image"]);
  });

  it("overrides nothing about storage and attaches no guest agent", () => {
    const form = defaultGuestForm();

    expect(form.storageAccessMode).toBe("");
    expect(form.storageVolumeMode).toBe("");
    expect(form.storageClassName).toBe("");
    expect(form.guestAgentEnabled).toBe(false);
    expect(form.seedProfile).toBe("");
    expect(form.nodeName).toBe("");
  });
});

describe("defaultNamespace", () => {
  it("takes the page's filter when it names exactly one namespace", () => {
    expect(defaultNamespace(["vms"])).toBe("vms");
  });

  it("leaves the field empty when the filter names several", () => {
    expect(defaultNamespace(["vms", "default"])).toBe("");
  });

  it("leaves the field empty when the filter names none", () => {
    expect(defaultNamespace([])).toBe("");
  });
});

describe("guestNameError", () => {
  it.each(["a", "demo", "demo-1", "web-server-01", "0", "a-b-c"])("accepts %s", (name) => {
    expect(guestNameError(name)).toBeUndefined();
  });

  it("accepts a name of exactly the maximum length", () => {
    expect(guestNameError("a".repeat(maxGuestNameLength))).toBeUndefined();
  });

  it("requires a name", () => {
    expect(guestNameError("")).toBe("A name is required.");
  });

  it("refuses one character over the maximum, and counts it", () => {
    const error = guestNameError("a".repeat(maxGuestNameLength + 1));

    expect(error).toContain(`at most ${maxGuestNameLength} characters`);
    expect(error).toContain(`is ${maxGuestNameLength + 1}`);
  });

  it.each(["Demo", "DEMO"])("refuses the uppercase name %s", (name) => {
    expect(guestNameError(name)).toContain("lowercase letters");
  });

  it.each(["-demo", "demo-", "-", "_demo", "demo_1", "demo 1", "demo!"])("refuses %s", (name) => {
    expect(guestNameError(name)).toContain("lowercase letters");
  });

  it("refuses dots, which the object-name rule of the other dialogs allows", () => {
    const error = guestNameError("demo.example");

    expect(error).toContain("Dots are not allowed");
    expect(error).toContain("DNS label");
  });

  it("names what the guest's name becomes, so the rule is not arbitrary", () => {
    expect(guestNameError("demo.example")).toContain("launcher pod");
  });
});

describe("guestClassSummary", () => {
  it("reads as the sizing the class commits the guest to", () => {
    expect(guestClassSummary(smallClass)).toBe("2 vCPU, 4Gi, 20Gi qcow2");
  });

  it("drops the disk format when the class does not declare one", () => {
    expect(guestClassSummary({ name: "x", cpu: "2", memory: "4Gi", rootDisk: { size: "10Gi" } })).toBe(
      "2 vCPU, 4Gi, 10Gi",
    );
  });

  it("is empty for a class that declares nothing, rather than punctuation", () => {
    expect(guestClassSummary({ name: "x" })).toBe("");
  });
});

describe("guestClassChoices", () => {
  it("offers every class the read returned, in its order", () => {
    expect(guestClassChoices(inputs()).map((choice) => choice.name)).toEqual(["e2e-small", "e2e-shared", "e2e-bare"]);
  });

  it("carries the sizing on the option itself, which is what upstream hides", () => {
    expect(guestClassChoices(inputs())[0].label).toBe("e2e-small - 2 vCPU, 4Gi, 20Gi qcow2");
  });

  it("falls back to the bare name when the class declares no sizing", () => {
    expect(guestClassChoices(inputs({ guestClasses: [{ name: "x" }] }))[0].label).toBe("x");
  });

  it("refuses no class: a guest class is valid the moment it exists", () => {
    expect(guestClassChoices(inputs())).toHaveLength(3);
  });

  it("is empty when nothing was read", () => {
    expect(guestClassChoices(inputs({ guestClasses: [] }))).toEqual([]);
  });
});

describe("pickedGuestClass", () => {
  it("finds the chosen class", () => {
    expect(pickedGuestClass(inputs(), values({ guestClass: "e2e-shared" }))?.name).toBe("e2e-shared");
  });

  it("is undefined when the name is not in the list", () => {
    expect(pickedGuestClass(inputs(), values({ guestClass: "typed-by-hand" }))).toBeUndefined();
  });

  it("is undefined when no class is chosen", () => {
    expect(pickedGuestClass(inputs(), values({ guestClass: "" }))).toBeUndefined();
  });
});

describe("guestClassSizing", () => {
  it("shows what the class owns and the guest cannot override", () => {
    expect(guestClassSizing(smallClass)).toEqual([
      { label: "CPU", value: "2" },
      { label: "Memory", value: "4Gi" },
      { label: "Root disk", value: "20Gi qcow2" },
      { label: "Storage", value: "ReadWriteOnce/Filesystem" },
      { label: "Core scheduling", value: "off" },
    ]);
  });

  it("names the storage class when the class picks one", () => {
    const storage = guestClassSizing(sharedClass).find((row) => row.label === "Storage");

    expect(storage?.value).toBe("ReadWriteMany/Block on longhorn");
  });

  it("says which cluster defaults answer for a class that declares no storage", () => {
    const storage = guestClassSizing(bareClass).find((row) => row.label === "Storage");

    expect(storage?.value).toContain(systemDefaultAccessMode);
    expect(storage?.value).toContain(systemDefaultVolumeMode);
    expect(storage?.value).toContain("cluster default");
  });

  it("reads an absent core scheduling as off, which is what the CRD defaults it to", () => {
    const row = guestClassSizing(bareClass).find((entry) => entry.label === "Core scheduling");

    expect(row?.value).toBe("off");
  });

  it("says 'not set' rather than nothing for a field the class omits", () => {
    const rows = guestClassSizing({ name: "x" });

    expect(rows.find((row) => row.label === "CPU")?.value).toBe("not set");
    expect(rows.find((row) => row.label === "Memory")?.value).toBe("not set");
    expect(rows.find((row) => row.label === "Root disk")?.value).toBe("not set");
  });

  it("never renders an empty value", () => {
    for (const guestClass of [smallClass, sharedClass, bareClass, { name: "x" }]) {
      for (const row of guestClassSizing(guestClass)) {
        expect(row.value).not.toBe("");
      }
    }
  });
});

describe("resolvedStorage", () => {
  it("takes the class's values when the form overrides nothing", () => {
    const storage = resolvedStorage(inputs(), values({ guestClass: "e2e-shared" }));

    expect(storage.accessMode).toBe("ReadWriteMany");
    expect(storage.volumeMode).toBe("Block");
    expect(storage.storageClassName).toBe("longhorn");
    expect(storage.resolved).toBe(true);
  });

  it("lets the guest win per field, which is how the controller merges them", () => {
    const storage = resolvedStorage(inputs(), values({ guestClass: "e2e-shared", storageAccessMode: "ReadWriteOnce" }));

    expect(storage.accessMode).toBe("ReadWriteOnce");
    expect(storage.volumeMode).toBe("Block");
  });

  it("overrides the storage class alone without touching the modes", () => {
    const storage = resolvedStorage(inputs(), values({ guestClass: "e2e-shared", storageClassName: "fast" }));

    expect(storage.storageClassName).toBe("fast");
    expect(storage.accessMode).toBe("ReadWriteMany");
  });

  it("is resolved from the overrides alone when no class could be read", () => {
    const storage = resolvedStorage(
      inputs({ guestClasses: [] }),
      values({ guestClass: "typed", storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" }),
    );

    expect(storage.resolved).toBe(true);
    expect(storage.liveMigratable).toBe(true);
  });

  it("is unresolved when neither a class nor both overrides answer", () => {
    const storage = resolvedStorage(inputs({ guestClasses: [] }), values({ guestClass: "typed" }));

    expect(storage.resolved).toBe(false);
  });

  it("derives live-migratability from the pair, not from one of them", () => {
    expect(resolvedStorage(inputs(), values({ guestClass: "e2e-shared" })).liveMigratable).toBe(true);
    expect(resolvedStorage(inputs(), values({ guestClass: "e2e-small" })).liveMigratable).toBe(false);
    expect(
      resolvedStorage(inputs(), values({ guestClass: "e2e-shared", storageVolumeMode: "Filesystem" })).liveMigratable,
    ).toBe(false);
  });

  it("falls back to the cluster defaults for a class that says nothing", () => {
    const storage = resolvedStorage(inputs(), values({ guestClass: "e2e-bare" }));

    expect(storage.accessMode).toBeUndefined();
    expect(storage.liveMigratable).toBe(false);
    expect(resolvedStorageText(storage)).toBe(`${systemDefaultAccessMode}/${systemDefaultVolumeMode}`);
  });

  it("becomes live-migratable when the overrides say so on a class that does not", () => {
    const storage = resolvedStorage(
      inputs(),
      values({ guestClass: "e2e-small", storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" }),
    );

    expect(storage.liveMigratable).toBe(true);
  });
});

describe("liveMigrationFact", () => {
  it("says a shared disk can move without stopping the guest", () => {
    const fact = liveMigrationFact(resolvedStorage(inputs(), values({ guestClass: "e2e-shared" })));

    expect(fact).toContain("ReadWriteMany/Block");
    expect(fact).toContain("live-migrated");
  });

  it("says an exclusive disk can only move offline, and what would change that", () => {
    const fact = liveMigrationFact(resolvedStorage(inputs(), values({ guestClass: "e2e-small" })));

    expect(fact).toContain("ReadWriteOnce/Filesystem");
    expect(fact).toContain("offline only");
    expect(fact).toContain("ReadWriteMany");
  });

  it("says a shared disk on a Filesystem volume can be held by several nodes and still not move live", () => {
    const fact = liveMigrationFact(
      resolvedStorage(inputs({ guestClasses: [sharedFilesystemClass] }), values({ guestClass: "e2e-shared-fs" })),
    );

    expect(fact).toContain("ReadWriteMany/Filesystem");
    expect(fact).toContain("more than one node can hold at once");
    expect(fact).toContain("Block");
    expect(fact).toContain("offline only");
    expect(fact).not.toContain("only one node can hold at a time");
  });

  it("says the same when the override, not the class, made the disk shared", () => {
    const fact = liveMigrationFact(
      resolvedStorage(
        inputs(),
        values({ guestClass: "e2e-small", storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" }),
      ),
    );

    expect(fact).toContain("ReadWriteMany/Filesystem");
    expect(fact).toContain("more than one node can hold at once");
    expect(fact).not.toContain("only one node can hold at a time");
  });

  it("reads a shared disk with no volume mode as the cluster's Filesystem default, not as an exclusive one", () => {
    const fact = liveMigrationFact(
      resolvedStorage(
        inputs({ guestClasses: [sharedDefaultVolumeClass] }),
        values({ guestClass: "e2e-shared-default" }),
      ),
    );

    expect(fact).toContain(`ReadWriteMany/${systemDefaultVolumeMode}`);
    expect(fact).toContain("more than one node can hold at once");
    expect(fact).not.toContain("only one node can hold at a time");
  });

  it("marks the answer unverified when the class could not be read", () => {
    const fact = liveMigrationFact(resolvedStorage(inputs({ guestClasses: [] }), values({ guestClass: "typed" })));

    expect(fact).toContain("unverified");
  });

  it("is never empty, whatever it was handed", () => {
    for (const guestClass of ["e2e-small", "e2e-shared", "e2e-bare", "typed", ""]) {
      expect(liveMigrationFact(resolvedStorage(inputs(), values({ guestClass })))).not.toBe("");
    }
  });
});

describe("liveMigrationLabel", () => {
  it("says possible, with the storage that makes it so", () => {
    expect(liveMigrationLabel(resolvedStorage(inputs(), values({ guestClass: "e2e-shared" })))).toBe(
      "possible (ReadWriteMany/Block)",
    );
  });

  it("says offline only, with the storage that makes it so", () => {
    expect(liveMigrationLabel(resolvedStorage(inputs(), values({ guestClass: "e2e-small" })))).toBe(
      "offline only (ReadWriteOnce/Filesystem)",
    );
  });

  it("reports the cluster defaults for a class that says nothing about storage", () => {
    expect(liveMigrationLabel(resolvedStorage(inputs(), values({ guestClass: "e2e-bare" })))).toBe(
      "offline only (ReadWriteOnce/Filesystem)",
    );
  });

  it("says unverified when the class could not be read", () => {
    expect(
      liveMigrationLabel(resolvedStorage(inputs({ guestClasses: [] }), values({ guestClass: "typed" }))),
    ).toContain("unverified");
  });

  it("follows the overrides, not only the class", () => {
    expect(
      liveMigrationLabel(
        resolvedStorage(
          inputs(),
          values({ guestClass: "e2e-small", storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" }),
        ),
      ),
    ).toBe("possible (ReadWriteMany/Block)");
  });

  it("agrees with the long sentence in every case", () => {
    const cases: Partial<GuestFormValues>[] = [
      { guestClass: "e2e-small" },
      { guestClass: "e2e-shared" },
      { guestClass: "e2e-bare" },
      { guestClass: "typed" },
      { guestClass: "e2e-small", storageAccessMode: "ReadWriteMany" },
      { guestClass: "e2e-small", storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" },
      { guestClass: "e2e-shared", storageVolumeMode: "Filesystem" },
      { guestClass: "e2e-shared", storageAccessMode: "ReadWriteOnce" },
    ];

    for (const overrides of cases) {
      const storage = resolvedStorage(inputs(), values(overrides));
      const label = liveMigrationLabel(storage);
      const fact = liveMigrationFact(storage);

      expect(label.startsWith("possible")).toBe(fact.includes("can be live-migrated"));
      expect(label.startsWith("unverified")).toBe(fact.includes("unverified"));
    }
  });
});

describe("guestImageChoices", () => {
  it("offers every image of the namespace, Ready or not", () => {
    expect(guestImageChoices(inputs())).toHaveLength(4);
  });

  it("shows the phase upstream's own picker discards", () => {
    const choice = guestImageChoices(inputs()).find((option) => option.name === "ubuntu-2604");

    expect(choice?.label).toBe("ubuntu-2604 - Importing");
  });

  it("marks a Ready image ready and nothing else", () => {
    const ready = guestImageChoices(inputs()).filter((choice) => choice.ready);

    expect(ready.map((choice) => choice.name)).toEqual(["ubuntu-2404", "windows-2022"]);
    expect(readyImagePhase).toBe("Ready");
  });

  it("says an image has no phase yet rather than leaving the option bare", () => {
    const choice = guestImageChoices(inputs()).find((option) => option.name === "fresh-image");

    expect(choice?.label).toBe("fresh-image - no phase yet");
    expect(choice?.ready).toBe(false);
  });

  it("disables nothing: a not-Ready image is a wait, not a refusal", () => {
    for (const choice of guestImageChoices(inputs())) {
      expect(Object.keys(choice)).not.toContain("guard");
    }
  });
});

describe("pickedImage", () => {
  it("finds the chosen image", () => {
    expect(pickedImage(inputs(), values({ image: "windows-2022" }))?.osType).toBe("windows");
  });

  it("is undefined for a name the read did not return", () => {
    expect(pickedImage(inputs(), values({ image: "typed-by-hand" }))).toBeUndefined();
  });
});

describe("imageWillWaitFact", () => {
  it("says nothing about a Ready image", () => {
    expect(imageWillWaitFact(readyImage)).toBeUndefined();
  });

  it("says nothing when no image is picked", () => {
    expect(imageWillWaitFact(undefined)).toBeUndefined();
  });

  it("names the phase, the failure and the recovery for an importing image", () => {
    const fact = imageWillWaitFact(importingImage);

    expect(fact).toContain("is Importing");
    expect(fact).toContain("born Failed");
    expect(fact).toContain("Resolved=False");
    expect(fact).toContain("watched");
  });

  it("says an image has not reported a phase rather than inventing one", () => {
    expect(imageWillWaitFact(phaselessImage)).toContain("has not reported a phase yet");
  });

  it("promises no recreation, which is the point of saying it at all", () => {
    expect(imageWillWaitFact(importingImage)).toContain("nothing has to be recreated");
  });
});

describe("guestOsType", () => {
  it("is linux with no image picked, and says the image decides it", () => {
    const fact = guestOsType(inputs(), values({ image: "" }));

    expect(fact.osType).toBe("linux");
    expect(fact.fromImage).toBe(false);
    expect(fact.unverified).toBe(false);
    expect(fact.text).toContain("until an image is picked");
  });

  it("reads linux off a linux image", () => {
    const fact = guestOsType(inputs(), values({ image: "ubuntu-2404" }));

    expect(fact.osType).toBe("linux");
    expect(fact.fromImage).toBe(true);
    expect(fact.text).toContain("read from the image ubuntu-2404");
  });

  it("reads windows off a windows image, which is the born-Failed trap closed", () => {
    const fact = guestOsType(inputs(), values({ image: "windows-2022" }));

    expect(fact.osType).toBe("windows");
    expect(fact.fromImage).toBe(true);
  });

  it("falls back to linux for an image that declares no osType, as the CRD does", () => {
    const fact = guestOsType(inputs({ images: [{ name: "bare", phase: "Ready" }] }), values({ image: "bare" }));

    expect(fact.osType).toBe("linux");
    expect(fact.fromImage).toBe(true);
  });

  it("marks the value unverified when the named image could not be read", () => {
    const fact = guestOsType(inputs({ imagesUnverified: true, images: [] }), values({ image: "typed" }));

    expect(fact.osType).toBe("linux");
    expect(fact.unverified).toBe(true);
    expect(fact.text).toContain("could not be read");
    expect(fact.text).toContain("born Failed");
  });

  it("never claims to have read an image it did not", () => {
    const fact = guestOsType(inputs(), values({ image: "typed" }));

    expect(fact.fromImage).toBe(false);
  });

  it("is never empty text", () => {
    for (const image of ["", "ubuntu-2404", "windows-2022", "typed", "fresh-image"]) {
      expect(guestOsType(inputs(), values({ image })).text).not.toBe("");
    }
  });
});

describe("windowsConstraintFact", () => {
  it("states the three rules a Windows guest lives under", () => {
    expect(windowsConstraintFact).toContain("disk image only");
    expect(windowsConstraintFact).toContain("no GPU profile");
    expect(windowsConstraintFact).toContain("no filesystems");
  });
});

describe("runPolicyNote", () => {
  it.each(guestRunPolicies)("says what %s does right after this create", (policy) => {
    expect(runPolicyNote(policy).length).toBeGreaterThan(40);
  });

  it("says a Running guest is not restarted when the hypervisor exits", () => {
    expect(runPolicyNote("Running")).toContain("not recreated");
  });

  it("says a Stopped guest gets no pod at all", () => {
    expect(runPolicyNote("Stopped")).toContain("no launcher pod");
  });

  it("names the backoff of RestartOnFailure", () => {
    const note = runPolicyNote("RestartOnFailure");

    expect(note).toContain("10 seconds");
    expect(note).toContain("5 minutes");
  });

  it("says Always covers a clean shutdown too, which is the difference", () => {
    expect(runPolicyNote("Always")).toContain("clean shutdown");
  });

  it("gives every policy a different sentence", () => {
    const notes = guestRunPolicies.map(runPolicyNote);

    expect(new Set(notes).size).toBe(guestRunPolicies.length);
  });

  it("offers the four policies of the enum, in reading order", () => {
    expect(guestRunPolicyChoices().map((choice) => choice.policy)).toEqual([
      "Running",
      "Stopped",
      "RestartOnFailure",
      "Always",
    ]);
  });

  it.each<[SwiftGuestRunPolicy, boolean]>([
    ["Running", true],
    ["RestartOnFailure", true],
    ["Always", true],
    ["Stopped", false],
  ])("knows that %s starts the guest: %s", (policy, starts) => {
    expect(runPolicyStarts(policy)).toBe(starts);
  });
});

describe("guestNodeChoices", () => {
  it("offers Ready and schedulable nodes only", () => {
    expect(guestNodeChoices(inputs()).map((choice) => choice.name)).toEqual(["node-a", "node-b"]);
  });

  it("sorts them, so the list does not depend on the API's order", () => {
    const names = guestNodeChoices(inputs()).map((choice) => choice.name);

    expect(names).toEqual([...names].sort());
  });

  it("is empty when nothing was read", () => {
    expect(guestNodeChoices(inputs({ nodes: [] }))).toEqual([]);
  });

  it("drops a cordoned node rather than offering it with a reason", () => {
    expect(guestNodeChoices(inputs()).some((choice) => choice.name === "node-cordoned")).toBe(false);
  });

  it("drops a node that is not Ready", () => {
    expect(guestNodeChoices(inputs()).some((choice) => choice.name === "node-down")).toBe(false);
  });
});

describe("noGuestNodeReason", () => {
  it("counts what it dropped and why", () => {
    const reason = noGuestNodeReason(inputs({ nodes: [nodes[2], nodes[3]] }));

    expect(reason).toContain("It has 2 nodes");
    expect(reason).toContain("1 is not Ready");
    expect(reason).toContain("1 is cordoned");
  });

  it("says the pin can be left empty, which is the way out", () => {
    expect(noGuestNodeReason(inputs({ nodes: [] }))).toContain("Leave the pin empty");
  });

  it("counts one node in the singular", () => {
    expect(noGuestNodeReason(inputs({ nodes: [nodes[3]] }))).toContain("It has 1 node");
  });

  it("pluralizes the counts it reports", () => {
    const reason = noGuestNodeReason(inputs({ nodes: [nodes[3], { ...nodes[3], name: "node-down-2" }] }));

    expect(reason).toContain("2 are not Ready");
  });

  it("explains the node pin itself once, in the field's own hint", () => {
    expect(nodePinFact).toContain("bypassing the scheduler");
  });
});

describe("guestCreateErrors", () => {
  it("accepts a filled form", () => {
    expect(guestCreateErrors(values())).toEqual({});
  });

  it("requires a namespace", () => {
    expect(guestCreateErrors(values({ namespace: "" })).namespace).toContain("required");
  });

  it("requires a name, and reports the DNS rule at that field", () => {
    expect(guestCreateErrors(values({ name: "" })).name).toBe("A name is required.");
    expect(guestCreateErrors(values({ name: "Bad_Name" })).name).toContain("lowercase letters");
  });

  it("requires a guest class, and says why it is the one required field", () => {
    const error = guestCreateErrors(values({ guestClass: "" })).guestClass;

    expect(error).toContain("required");
    expect(error).toContain("root disk");
  });

  it("requires an image, and distinguishes it from a not-Ready one", () => {
    const error = guestCreateErrors(values({ image: "" })).image;

    expect(error).toContain("required");
    expect(error).toContain("never heals");
  });

  it("trims before deciding a field is empty", () => {
    expect(guestCreateErrors(values({ guestClass: "   " })).guestClass).toBeDefined();
    expect(guestCreateErrors(values({ image: " " })).image).toBeDefined();
    expect(guestCreateErrors(values({ namespace: "  " })).namespace).toBeDefined();
  });

  it("refuses ReadWriteMany without an explicit Block volume mode, which is the CRD's own rule", () => {
    const error = guestCreateErrors(values({ storageAccessMode: "ReadWriteMany" })).storageAccessMode;

    expect(error).toBe(storageCelRule);
    expect(error).toContain("does not satisfy it");
  });

  it("refuses ReadWriteMany with an explicit Filesystem volume mode", () => {
    expect(
      guestCreateErrors(values({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" }))
        .storageAccessMode,
    ).toBe(storageCelRule);
  });

  it("accepts ReadWriteMany once Block is set on the guest itself", () => {
    expect(
      guestCreateErrors(values({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" })).storageAccessMode,
    ).toBeUndefined();
  });

  it("accepts ReadWriteOnce with any volume mode", () => {
    for (const storageVolumeMode of ["", "Filesystem", "Block"]) {
      expect(
        guestCreateErrors(values({ storageAccessMode: "ReadWriteOnce", storageVolumeMode })).storageAccessMode,
      ).toBeUndefined();
    }
  });

  it("says the rule is evaluated on the guest's own storage block", () => {
    expect(storageCelRule).toContain("this guest's own storage block");
  });

  it("accepts an empty storage class name", () => {
    expect(guestCreateErrors(values({ storageClassName: "" })).storageClassName).toBeUndefined();
  });

  it.each(["fast", "longhorn-rwx", "csi.example.com"])("accepts the storage class %s", (storageClassName) => {
    expect(guestCreateErrors(values({ storageClassName })).storageClassName).toBeUndefined();
  });

  it.each(["Fast", "-fast", "fast-", "fast_1"])("refuses the storage class %s", (storageClassName) => {
    expect(guestCreateErrors(values({ storageClassName })).storageClassName).toContain("lowercase letters");
  });

  it("has an error for every field the storage section holds when they are wrong", () => {
    expect(storageFields).toEqual(["storageAccessMode", "storageVolumeMode", "storageClassName"]);
  });
});

describe("guestCreateSubmitBlockReason", () => {
  it("is undefined for a form that can be sent", () => {
    expect(guestCreateSubmitBlockReason(values())).toBeUndefined();
  });

  it("names the field and the reason, which is what W4 asks of a submit button", () => {
    const reason = guestCreateSubmitBlockReason(values({ name: "" }));

    expect(reason).toBe(`${guestCreateFieldLabels.name}: A name is required.`);
  });

  it("reports the first offending field in reading order", () => {
    const reason = guestCreateSubmitBlockReason(values({ namespace: "", name: "", guestClass: "" }));

    expect(reason?.startsWith(`${guestCreateFieldLabels.namespace}:`)).toBe(true);
  });

  it("reports the name before the class", () => {
    expect(guestCreateSubmitBlockReason(values({ name: "", guestClass: "" }))?.startsWith("Name:")).toBe(true);
  });

  it("reports the class before the image", () => {
    expect(guestCreateSubmitBlockReason(values({ guestClass: "", image: "" }))?.startsWith("Guest class:")).toBe(true);
  });

  it("reports the storage rule when everything else is right", () => {
    const reason = guestCreateSubmitBlockReason(values({ storageAccessMode: "ReadWriteMany" }));

    expect(reason?.startsWith(`${guestCreateFieldLabels.storageAccessMode}:`)).toBe(true);
    expect(reason).toContain("Block");
  });

  it("never disables the submit without a reason (the W4 contract)", () => {
    const forms: Partial<GuestFormValues>[] = [
      {},
      { namespace: "" },
      { name: "" },
      { name: "Bad" },
      { name: "a".repeat(64) },
      { guestClass: "" },
      { image: "" },
      { storageAccessMode: "ReadWriteMany" },
      { storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" },
      { storageClassName: "Bad" },
      { namespace: "", name: "", guestClass: "", image: "" },
    ];

    for (const form of forms) {
      const reason = guestCreateSubmitBlockReason(values(form));

      if (reason !== undefined) {
        expect(reason.length).toBeGreaterThan(10);
        expect(reason).toMatch(/^[A-Z][^:]*: \S/);
      }
    }
  });

  it("labels every field it could name", () => {
    for (const field of Object.keys(guestCreateFieldLabels) as GuestCreateField[]) {
      expect(guestCreateFieldLabels[field]).not.toBe("");
    }
  });
});

describe("guestCreateWarnings", () => {
  it("warns about a name that is already taken, and says the fix", () => {
    const warning = guestCreateWarnings(inputs(), values({ name: "already-here" })).name;

    expect(warning).toContain("already exists");
    expect(warning).toContain("different name");
  });

  it("does not warn about a free name", () => {
    expect(guestCreateWarnings(inputs(), values({ name: "demo" })).name).toBeUndefined();
  });

  it("never blocks on a collision: the store can be stale", () => {
    expect(guestCreateErrors(values({ name: "already-here" })).name).toBeUndefined();
    expect(guestCreateSubmitBlockReason(values({ name: "already-here" }))).toBeUndefined();
  });

  it("warns that a typed class is unverified when the list was refused", () => {
    const warning = guestCreateWarnings(
      inputs({ guestClasses: [], guestClassesUnverified: true }),
      values({ guestClass: "typed" }),
    ).guestClass;

    expect(warning).toContain("not verified");
  });

  it("warns that a class nobody has is a guest that waits, when the list did answer", () => {
    const warning = guestCreateWarnings(inputs(), values({ guestClass: "missing" })).guestClass;

    expect(warning).toContain("Resolved=False");
    expect(warning).toContain("30-second resync");
  });

  it("warns that a typed image is unverified when the list was refused", () => {
    const warning = guestCreateWarnings(
      inputs({ images: [], imagesUnverified: true }),
      values({ image: "typed" }),
    ).image;

    expect(warning).toContain("not verified");
    expect(warning).toContain("which OS it carries");
  });

  it("warns that an image nobody has heals by itself once it exists", () => {
    expect(guestCreateWarnings(inputs(), values({ image: "missing" })).image).toContain("heals by itself");
  });

  it("does not warn about an image the read returned", () => {
    expect(guestCreateWarnings(inputs(), values({ image: "ubuntu-2404" })).image).toBeUndefined();
  });

  it("warns about a seed profile that is not in the namespace", () => {
    expect(guestCreateWarnings(inputs(), values({ seedProfile: "missing" })).seedProfile).toContain("waits");
  });

  it("does not warn about the seed profile that is", () => {
    expect(guestCreateWarnings(inputs(), values({ seedProfile: "e2e-seed-basic" })).seedProfile).toBeUndefined();
  });

  it("warns about a node that is not in the offerable list", () => {
    expect(guestCreateWarnings(inputs(), values({ nodeName: "node-cordoned" })).nodeName).toContain("Ready");
  });

  it("warns that a typed node is unverified when the nodes could not be listed", () => {
    const warning = guestCreateWarnings(
      inputs({ nodes: [], nodesUnverified: true }),
      values({ nodeName: "typed" }),
    ).nodeName;

    expect(warning).toContain("not verified");
  });

  it("does not warn about an offerable node", () => {
    expect(guestCreateWarnings(inputs(), values({ nodeName: "node-a" })).nodeName).toBeUndefined();
  });

  it("warns about nothing when nothing is typed", () => {
    expect(guestCreateWarnings(inputs(), values({ seedProfile: "", nodeName: "" }))).toEqual({});
  });
});

describe("guestStorageOverrides", () => {
  it("is undefined when nothing is overridden", () => {
    expect(guestStorageOverrides(values())).toBeUndefined();
  });

  it("carries only the access mode when only it is set", () => {
    expect(guestStorageOverrides(values({ storageAccessMode: "ReadWriteOnce" }))).toEqual({
      accessMode: "ReadWriteOnce",
    });
  });

  it("carries only the volume mode when only it is set", () => {
    expect(guestStorageOverrides(values({ storageVolumeMode: "Block" }))).toEqual({ volumeMode: "Block" });
  });

  it("carries only the storage class when only it is set", () => {
    expect(guestStorageOverrides(values({ storageClassName: "fast" }))).toEqual({ storageClassName: "fast" });
  });

  it("carries all three when all three are set", () => {
    expect(
      guestStorageOverrides(
        values({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block", storageClassName: "longhorn" }),
      ),
    ).toEqual({ accessMode: "ReadWriteMany", volumeMode: "Block", storageClassName: "longhorn" });
  });

  it("ignores a value that is not one of the enum members", () => {
    expect(guestStorageOverrides(values({ storageAccessMode: "ReadWriteWhatever" }))).toBeUndefined();
  });

  it("trims what it is given", () => {
    expect(guestStorageOverrides(values({ storageClassName: "  fast  " }))).toEqual({ storageClassName: "fast" });
  });

  it("treats a whitespace-only storage class as unset", () => {
    expect(guestStorageOverrides(values({ storageClassName: "   " }))).toBeUndefined();
  });
});

describe("guestCreatePayload", () => {
  it("sends the class, the image, the OS type and the run policy of a minimal form", () => {
    const { spec } = guestCreatePayload(inputs(), values());

    expect(Object.keys(spec).sort()).toEqual(["guestClassRef", "imageRef", "osType", "runPolicy"]);
    expect(spec.guestClassRef).toEqual({ name: "e2e-small" });
    expect(spec.imageRef).toEqual({ name: "ubuntu-2404" });
    expect(spec.osType).toBe("linux");
    expect(spec.runPolicy).toBe("Running");
  });

  it("sends the run policy explicitly, whichever it is (G8)", () => {
    for (const runPolicy of guestRunPolicies) {
      expect(guestCreatePayload(inputs(), values({ runPolicy })).spec.runPolicy).toBe(runPolicy);
    }
  });

  it("adds the seed profile only when one is picked", () => {
    expect(guestCreatePayload(inputs(), values()).spec.seedProfileRef).toBeUndefined();
    expect(guestCreatePayload(inputs(), values({ seedProfile: "e2e-seed-basic" })).spec.seedProfileRef).toEqual({
      name: "e2e-seed-basic",
    });
  });

  it("adds the node pin only when one is picked", () => {
    expect(guestCreatePayload(inputs(), values()).spec.nodeName).toBeUndefined();
    expect(guestCreatePayload(inputs(), values({ nodeName: "node-a" })).spec.nodeName).toBe("node-a");
  });

  it("adds the storage block only when something is overridden", () => {
    expect(guestCreatePayload(inputs(), values()).spec.storage).toBeUndefined();
    expect(guestCreatePayload(inputs(), values({ storageVolumeMode: "Block" })).spec.storage).toEqual({
      volumeMode: "Block",
    });
  });

  it("adds the guest agent only when the box is checked", () => {
    expect(guestCreatePayload(inputs(), values()).spec.guestAgent).toBeUndefined();
    expect(guestCreatePayload(inputs(), values({ guestAgentEnabled: true })).spec.guestAgent).toEqual({
      enabled: true,
    });
  });

  it("sends everything the form owns when everything is set", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      values({
        image: "windows-2022",
        seedProfile: "e2e-seed-basic",
        nodeName: "node-a",
        runPolicy: "Always",
        storageAccessMode: "ReadWriteMany",
        storageVolumeMode: "Block",
        storageClassName: "longhorn",
        guestAgentEnabled: true,
      }),
    );

    expect(Object.keys(spec).sort()).toEqual([
      "guestAgent",
      "guestClassRef",
      "imageRef",
      "nodeName",
      "osType",
      "runPolicy",
      "seedProfileRef",
      "storage",
    ]);
    expect(spec.osType).toBe("windows");
  });

  it("trims every name it sends", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      values({
        guestClass: "  e2e-small  ",
        image: " ubuntu-2404 ",
        seedProfile: " e2e-seed-basic ",
        nodeName: " node-a ",
      }),
    );

    expect(spec.guestClassRef).toEqual({ name: "e2e-small" });
    expect(spec.imageRef).toEqual({ name: "ubuntu-2404" });
    expect(spec.seedProfileRef).toEqual({ name: "e2e-seed-basic" });
    expect(spec.nodeName).toBe("node-a");
  });

  it("never emits a reference without a name, across every combination (G7)", () => {
    const combinations: Partial<GuestFormValues>[] = [];

    for (const guestClass of ["", "   ", "e2e-small"]) {
      for (const image of ["", " ", "ubuntu-2404"]) {
        for (const seedProfile of ["", "  ", "e2e-seed-basic"]) {
          for (const nodeName of ["", " ", "node-a"]) {
            combinations.push({ guestClass, image, seedProfile, nodeName });
          }
        }
      }
    }

    expect(combinations).toHaveLength(81);

    for (const combination of combinations) {
      const { spec } = guestCreatePayload(inputs(), values(combination));

      for (const reference of [spec.guestClassRef, spec.imageRef, spec.seedProfileRef]) {
        if (reference !== undefined) {
          const name = reference.name;

          expect(typeof name).toBe("string");
          expect(name).not.toBe("");
          expect(name?.trim()).toBe(name);
        }
      }

      expect(Object.hasOwn(spec, "nodeName")).toBe(nonEmpty(combination.nodeName));
      expect(Object.hasOwn(spec, "guestClassRef")).toBe(nonEmpty(combination.guestClass));
      expect(Object.hasOwn(spec, "imageRef")).toBe(nonEmpty(combination.image));
      expect(Object.hasOwn(spec, "seedProfileRef")).toBe(nonEmpty(combination.seedProfile));
    }
  });

  it("emits no boot reference at all for a boot source this slice does not build", () => {
    const { spec } = guestCreatePayload(inputs(), values({ bootSource: "kernel" }));

    expect(spec.imageRef).toBeUndefined();
  });

  it("always sends the OS type, because the schema would default it to linux", () => {
    for (const image of ["ubuntu-2404", "windows-2022", "fresh-image", "typed", ""]) {
      expect(guestCreatePayload(inputs(), values({ image })).spec.osType).toBeDefined();
    }
  });

  it("cannot send an osType the picked image disagrees with", () => {
    for (const image of inputs().images) {
      const { spec } = guestCreatePayload(inputs(), values({ image: image.name }));

      expect(spec.osType).toBe(image.osType === "windows" ? "windows" : "linux");
      expect(spec.osType).toBe(guestOsType(inputs(), values({ image: image.name })).osType);
    }
  });

  it("sends windows for a windows image, which is the born-Failed mismatch closed", () => {
    expect(guestCreatePayload(inputs(), values({ image: "windows-2022" })).spec.osType).toBe("windows");
  });

  it("sends no storage key for an override that is not an enum member", () => {
    expect(guestCreatePayload(inputs(), values({ storageVolumeMode: "Whatever" })).spec.storage).toBeUndefined();
  });
});

function nonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

describe("guestCreateSummary", () => {
  it("names the one object it creates", () => {
    expect(guestCreateSummary(inputs(), values()).write).toBe("Create SwiftGuest vms/demo");
  });

  it("names the placeholders while the form is empty, rather than a broken line", () => {
    expect(guestCreateSummary(inputs(), values({ namespace: "", name: "" })).write).toBe(
      "Create SwiftGuest <namespace>/<name>",
    );
  });

  it("says the class sizes the guest, with the sizing", () => {
    expect(summaryText()).toContain("The guest class e2e-small sizes it: 2 vCPU, 4Gi, 20Gi qcow2");
  });

  it("says the class owns the sizing even when the class itself could not be read", () => {
    const text = summaryText({ guestClass: "typed" });

    expect(text).toContain("The guest class typed sizes it");
    expect(text).toContain("cannot be overridden here");
  });

  it("says nothing about a class when none is chosen", () => {
    expect(summaryText({ guestClass: "" })).not.toContain("sizes it");
  });

  it("says the root disk is cloned from the image, by a job", () => {
    expect(summaryText()).toContain("cloned from the image ubuntu-2404");
    expect(summaryText()).toContain("clone job");
  });

  it("says nothing about a root disk clone when no image is chosen", () => {
    expect(summaryText({ image: "" })).not.toContain("cloned from the image");
  });

  it("mentions the seed Secret only when a seed profile is picked", () => {
    expect(summaryText()).not.toContain("seed profile");
    expect(summaryText({ seedProfile: "e2e-seed-basic" })).toContain(
      "The seed profile e2e-seed-basic is rendered into a Secret",
    );
  });

  it("says a launcher pod is created for a guest that starts", () => {
    expect(summaryText({ runPolicy: "Running" })).toContain("A launcher pod is created for it");
  });

  it("says no launcher pod is created for a guest that does not", () => {
    const text = summaryText({ runPolicy: "Stopped" });

    expect(text).toContain("No launcher pod is created now");
    expect(text).not.toContain("A launcher pod is created for it");
  });

  it("carries the run policy's own sentence, whichever it is", () => {
    for (const runPolicy of guestRunPolicies) {
      expect(summaryText({ runPolicy })).toContain(`Run policy ${runPolicy}`);
      expect(summaryText({ runPolicy })).toContain(runPolicyNote(runPolicy));
    }
  });

  it("mentions the node pin only when there is one, and says what it does", () => {
    expect(summaryText()).not.toContain("pinned to the node");

    const text = summaryText({ nodeName: "node-a" });

    expect(text).toContain("pinned to the node node-a");
    expect(text).toContain(nodePinFact);
  });

  it("always states the live-migration consequence of the storage", () => {
    expect(summaryText({ guestClass: "e2e-shared" })).toContain("can be live-migrated");
    expect(summaryText({ guestClass: "e2e-small" })).toContain("migrated offline only");
    expect(summaryText({ guestClass: "e2e-shared", storageVolumeMode: "Filesystem" })).toContain(
      "more than one node can hold at once",
    );
  });

  it("mentions the guest agent only when it is attached", () => {
    expect(summaryText()).not.toContain("vsock");
    expect(summaryText({ guestAgentEnabled: true })).toContain(guestAgentFact);
  });

  it("warns that a not-Ready image makes the guest wait, and heal", () => {
    const facts = guestCreateSummary(inputs(), values({ image: "ubuntu-2604" }));

    expect(facts.warnings.some((warning) => warning.includes("is Importing"))).toBe(true);
    expect(facts.warnings.some((warning) => warning.includes("born Failed"))).toBe(true);
  });

  it("does not warn about a Ready image", () => {
    const facts = guestCreateSummary(inputs(), values());

    expect(facts.warnings.some((warning) => warning.includes("born Failed"))).toBe(false);
  });

  it("warns about the Windows constraints when the image is a Windows one", () => {
    const facts = guestCreateSummary(inputs(), values({ image: "windows-2022" }));

    expect(facts.warnings).toContain(windowsConstraintFact);
  });

  it("does not warn about Windows for a linux image", () => {
    expect(guestCreateSummary(inputs(), values()).warnings).not.toContain(windowsConstraintFact);
  });

  it("warns that the OS type is an assumption when the image could not be read", () => {
    const facts = guestCreateSummary(inputs({ images: [], imagesUnverified: true }), values({ image: "typed" }));

    expect(facts.warnings.some((warning) => warning.includes("could not be read"))).toBe(true);
  });

  it("repeats the name collision in the summary, where the button is", () => {
    const facts = guestCreateSummary(inputs(), values({ name: "already-here" }));

    expect(facts.warnings.some((warning) => warning.includes("already exists"))).toBe(true);
  });

  it("repeats every unverified value in the summary", () => {
    const facts = guestCreateSummary(
      inputs({
        guestClasses: [],
        guestClassesUnverified: true,
        images: [],
        imagesUnverified: true,
        nodes: [],
        nodesUnverified: true,
      }),
      values({ guestClass: "typed-class", image: "typed-image", nodeName: "typed-node" }),
    );

    expect(facts.warnings.filter((warning) => warning.includes("not verified"))).toHaveLength(3);
  });

  it("has no warnings at all for a clean, verified form", () => {
    expect(guestCreateSummary(inputs(), values()).warnings).toEqual([]);
  });

  it("never renders an empty note or warning", () => {
    const facts = guestCreateSummary(
      inputs(),
      values({ image: "ubuntu-2604", seedProfile: "e2e-seed-basic", nodeName: "node-a", guestAgentEnabled: true }),
    );

    for (const line of [...facts.notes, ...facts.warnings]) {
      expect(line.trim()).not.toBe("");
    }
  });

  it("keeps the write line first and singular: this dialog makes one API call", () => {
    const facts = guestCreateSummary(inputs(), values());

    expect(facts.write.startsWith("Create SwiftGuest ")).toBe(true);
    expect(facts.notes.some((note) => note.startsWith("Create "))).toBe(false);
  });
});

describe("excludedFieldsFooter", () => {
  it.each([
    "filesystems",
    "vhostUserDevices",
    "sriov",
    "topologySpreadConstraints",
    "schedulerName",
    "network.serviceAnnotations",
    "network.loadBalancerClass",
    "migration",
  ])("names %s as YAML-editor territory", (field) => {
    expect(excludedFieldsFooter).toContain(field);
  });

  it("names the YAML editor as where they live instead", () => {
    expect(excludedFieldsFooter).toContain("YAML editor");
  });

  it("does not name the fields the later slices add", () => {
    expect(excludedFieldsFooter).not.toContain("dataDiskRefs");
    expect(excludedFieldsFooter).not.toContain("gpuProfileRef");
    expect(excludedFieldsFooter).not.toContain("ports");
  });
});

describe("outcome messages", () => {
  it("names the object that was created", () => {
    expect(guestCreateSuccessMessage("vms", "demo")).toBe("SwiftGuest vms/demo created");
  });

  it("uses the verb of the control on the OK button", () => {
    expect(createGuestTitle).toBe("Create Guest");
  });

  it("says what a 409 means and how to fix it", () => {
    const prefix = guestCreateFailurePrefix(409, { namespace: "vms", name: "demo" });

    expect(prefix).toContain("already exists");
    expect(prefix).toContain("Change the name");
  });

  it("says what a 404 means", () => {
    expect(guestCreateFailurePrefix(404, { namespace: "vms", name: "demo" })).toContain("CRD is gone");
  });

  it("names the verb, the resource and the namespace of a 403", () => {
    const prefix = guestCreateFailurePrefix(403, { namespace: "vms", name: "demo" });

    expect(prefix).toContain("create");
    expect(prefix).toContain("swiftguests");
    expect(prefix).toContain("vms");
  });

  it("adds nothing to a failure it cannot predict", () => {
    expect(guestCreateFailurePrefix(500, { namespace: "vms", name: "demo" })).toBeUndefined();
  });

  it("prefixes the API server's own message rather than replacing it", () => {
    const message = guestCreateFailureMessage(
      { code: 409, message: 'swiftguests.swift.kubeswift.io "demo" already exists', alreadyNotified: false },
      { namespace: "vms", name: "demo" },
    );

    expect(message).toContain("Change the name");
    expect(message).toContain("already exists");
  });

  it("passes an unpredictable failure through as it arrived", () => {
    expect(
      guestCreateFailureMessage(
        { code: 500, message: "internal error", alreadyNotified: false },
        {
          namespace: "vms",
          name: "demo",
        },
      ),
    ).toBe("internal error");
  });

  it("reports the prefix alone when the API server said nothing", () => {
    expect(
      guestCreateFailureMessage({ code: 409, alreadyNotified: false }, { namespace: "vms", name: "demo" }),
    ).toContain("already exists");
  });
});

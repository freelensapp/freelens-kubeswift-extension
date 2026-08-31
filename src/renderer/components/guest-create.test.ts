import { describe, expect, it } from "vitest";
import {
  cloneGoneSourceWarning,
  cloneIdentityItems,
  cloneInertClassNote,
  cloneMachineIdentityFact,
  cloneMacLockRule,
  cloneNodeFact,
  clonePinDroppedFact,
  cloneRegenerateFact,
  cloneSizingRows,
  cloneSnapshotChoices,
  cloneTargetNodeApplies,
  createGuestTitle,
  defaultBootSource,
  defaultGuestForm,
  defaultNamespace,
  defaultRunPolicy,
  excludedFieldsFooter,
  excludedSnapshotsReason,
  guestAgentFact,
  guestBootSourceChoices,
  guestBootSourceDescription,
  guestBootSourceLabels,
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
  guestGpuGuard,
  guestImageChoices,
  guestKernelChoices,
  guestNameError,
  guestNodeChoices,
  guestOsType,
  guestRunPolicies,
  guestRunPolicyChoices,
  guestStorageOverrides,
  imageWillWaitFact,
  implementedBootSources,
  kernelCmdlineFact,
  kernelLiveMigrationFact,
  kernelNodeRuleFact,
  kernelStorageDroppedFact,
  kernelWillWaitFact,
  liveMigrationFact,
  liveMigrationLabel,
  maxGuestNameLength,
  nodePinApplies,
  nodePinFact,
  noGuestNodeReason,
  pickedGuestClass,
  pickedImage,
  pickedKernel,
  pickedSnapshot,
  readyImagePhase,
  resolvedStorage,
  resolvedStorageText,
  runPolicyNote,
  runPolicyStarts,
  seedProfileApplies,
  seedProfileDroppedReason,
  snapshotIsResumable,
  storageCelRule,
  storageFields,
  storageOverridesApply,
  switchBootSource,
  systemDefaultAccessMode,
  systemDefaultVolumeMode,
  windowsCloneWarning,
  windowsConstraintFact,
} from "./guest-create";

import type { SwiftGuestRunPolicy } from "../api/kubeswift/swiftguest-v1alpha1";
import type { SwiftSnapshotBackendType } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type {
  GuestBootSource,
  GuestClassFacts,
  GuestCreateField,
  GuestCreateInputs,
  GuestFormValues,
  GuestImageFacts,
  GuestKernelFacts,
  GuestSnapshotFacts,
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

/** The kernel whose artifact is on its nodes, and the two that are not there yet. */
const readyKernel: GuestKernelFacts = {
  name: "kernel-6-12",
  phase: "Ready",
  kernelCmdline: "console=ttyS0 reboot=k panic=1",
  profile: "linux-6.12",
};
const pullingKernel: GuestKernelFacts = { name: "kernel-6-14", phase: "Pulling" };
const phaselessKernel: GuestKernelFacts = { name: "kernel-fresh", kernelCmdline: "quiet" };

/** The local memory capture: Ready, resumable, pinned to the node that holds it. */
const localSnapshot: GuestSnapshotFacts = {
  name: "snap-local",
  phase: "Ready",
  backend: "local",
  hasMemorySnapshot: true,
  sourceGuestName: "already-here",
  nodeName: "node-a",
  capturedAt: "2026-08-29T18:12:44Z",
  guestSpec: { cpu: "2", memoryMi: 4096, osType: "linux", imageName: "ubuntu-2404", guestAgent: true, hasSeed: true },
};

/** The s3 capture: Ready, resumable, and the one that has to be told where to land. */
const s3Snapshot: GuestSnapshotFacts = {
  name: "snap-s3",
  phase: "Ready",
  backend: "s3",
  hasMemorySnapshot: true,
  sourceGuestName: "already-here",
  guestSpec: { cpu: "8", memoryMi: 16384, osType: "linux", guestAgent: false },
};

/** The full-state oci capture, whose source guest is gone and does not need to be there. */
const ociFullStateSnapshot: GuestSnapshotFacts = {
  name: "snap-oci-full",
  phase: "Ready",
  backend: "oci",
  hasMemorySnapshot: true,
  includeDisk: true,
  sourceGuestName: "long-gone",
  guestSpec: { cpu: "4", memoryMi: 8192, osType: "windows" },
};

/** The gone-source local capture: nothing carries the disk, so the clone needs a guest that is not there. */
const goneSourceSnapshot: GuestSnapshotFacts = {
  name: "snap-orphan",
  phase: "Ready",
  backend: "local",
  hasMemorySnapshot: true,
  sourceGuestName: "long-gone",
  nodeName: "node-b",
  guestSpec: { cpu: "2", memoryMi: 2048, osType: "linux" },
};

/** The two the picker never offers: a disk-only capture and one that is still uploading. */
const diskOnlySnapshot: GuestSnapshotFacts = {
  name: "snap-csi",
  phase: "Ready",
  backend: "csi-volume-snapshot",
  sourceGuestName: "already-here",
};
const uploadingSnapshot: GuestSnapshotFacts = {
  name: "snap-uploading",
  phase: "Uploading",
  backend: "oci",
  hasMemorySnapshot: true,
  sourceGuestName: "already-here",
};

const kernels: GuestKernelFacts[] = [readyKernel, pullingKernel, phaselessKernel];
const snapshots: GuestSnapshotFacts[] = [
  localSnapshot,
  s3Snapshot,
  ociFullStateSnapshot,
  goneSourceSnapshot,
  diskOnlySnapshot,
  uploadingSnapshot,
];

function inputs(overrides: Partial<GuestCreateInputs> = {}): GuestCreateInputs {
  return {
    guestClasses: [smallClass, sharedClass, bareClass],
    guestClassesUnverified: false,
    images: [readyImage, importingImage, windowsImage, phaselessImage],
    imagesUnverified: false,
    seedProfiles: [{ name: "e2e-seed-basic", datasource: "NoCloud" }],
    seedProfilesUnverified: false,
    kernels,
    kernelsUnverified: false,
    snapshots,
    snapshotsUnverified: false,
    nodes,
    nodesUnverified: false,
    existingNames: ["already-here"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** The form pointing at the kernel boot source, which is a different set of fields. */
function kernelValues(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ bootSource: "kernel", image: "", kernel: "kernel-6-12", ...overrides });
}

/** The form pointing at the clone boot source. */
function cloneValues(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ bootSource: "clone", image: "", snapshot: "snap-local", ...overrides });
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

  it("opens on the boot source most guests have, and offers all three", () => {
    expect(defaultGuestForm().bootSource).toBe(defaultBootSource);
    expect(defaultBootSource).toBe("image");
    expect(implementedBootSources).toEqual(["image", "kernel", "clone"]);
  });

  it("opens with no kernel, no snapshot and the machine identity regenerated", () => {
    const form = defaultGuestForm();

    expect(form.kernel).toBe("");
    expect(form.kernelCmdline).toBe("");
    expect(form.snapshot).toBe("");
    expect(form.cloneTargetNode).toBe("");
    expect(form.regenerateMachineIdentity).toBe(true);
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
    expect(guestCreateErrors(inputs(), values())).toEqual({});
  });

  it("requires a namespace", () => {
    expect(guestCreateErrors(inputs(), values({ namespace: "" })).namespace).toContain("required");
  });

  it("requires a name, and reports the DNS rule at that field", () => {
    expect(guestCreateErrors(inputs(), values({ name: "" })).name).toBe("A name is required.");
    expect(guestCreateErrors(inputs(), values({ name: "Bad_Name" })).name).toContain("lowercase letters");
  });

  it("requires a guest class, and says why it is the one required field", () => {
    const error = guestCreateErrors(inputs(), values({ guestClass: "" })).guestClass;

    expect(error).toContain("required");
    expect(error).toContain("root disk");
  });

  it("requires an image, and distinguishes it from a not-Ready one", () => {
    const error = guestCreateErrors(inputs(), values({ image: "" })).image;

    expect(error).toContain("required");
    expect(error).toContain("never heals");
  });

  it("trims before deciding a field is empty", () => {
    expect(guestCreateErrors(inputs(), values({ guestClass: "   " })).guestClass).toBeDefined();
    expect(guestCreateErrors(inputs(), values({ image: " " })).image).toBeDefined();
    expect(guestCreateErrors(inputs(), values({ namespace: "  " })).namespace).toBeDefined();
  });

  it("refuses ReadWriteMany without an explicit Block volume mode, which is the CRD's own rule", () => {
    const error = guestCreateErrors(inputs(), values({ storageAccessMode: "ReadWriteMany" })).storageAccessMode;

    expect(error).toBe(storageCelRule);
    expect(error).toContain("does not satisfy it");
  });

  it("refuses ReadWriteMany with an explicit Filesystem volume mode", () => {
    expect(
      guestCreateErrors(inputs(), values({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" }))
        .storageAccessMode,
    ).toBe(storageCelRule);
  });

  it("accepts ReadWriteMany once Block is set on the guest itself", () => {
    expect(
      guestCreateErrors(inputs(), values({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" }))
        .storageAccessMode,
    ).toBeUndefined();
  });

  it("accepts ReadWriteOnce with any volume mode", () => {
    for (const storageVolumeMode of ["", "Filesystem", "Block"]) {
      expect(
        guestCreateErrors(inputs(), values({ storageAccessMode: "ReadWriteOnce", storageVolumeMode }))
          .storageAccessMode,
      ).toBeUndefined();
    }
  });

  it("says the rule is evaluated on the guest's own storage block", () => {
    expect(storageCelRule).toContain("this guest's own storage block");
  });

  it("accepts an empty storage class name", () => {
    expect(guestCreateErrors(inputs(), values({ storageClassName: "" })).storageClassName).toBeUndefined();
  });

  it.each(["fast", "longhorn-rwx", "csi.example.com"])("accepts the storage class %s", (storageClassName) => {
    expect(guestCreateErrors(inputs(), values({ storageClassName })).storageClassName).toBeUndefined();
  });

  it.each(["Fast", "-fast", "fast-", "fast_1"])("refuses the storage class %s", (storageClassName) => {
    expect(guestCreateErrors(inputs(), values({ storageClassName })).storageClassName).toContain("lowercase letters");
  });

  it("has an error for every field the storage section holds when they are wrong", () => {
    expect(storageFields).toEqual(["storageAccessMode", "storageVolumeMode", "storageClassName"]);
  });
});

describe("guestCreateSubmitBlockReason", () => {
  it("is undefined for a form that can be sent", () => {
    expect(guestCreateSubmitBlockReason(inputs(), values())).toBeUndefined();
  });

  it("names the field and the reason, which is what W4 asks of a submit button", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), values({ name: "" }));

    expect(reason).toBe(`${guestCreateFieldLabels.name}: A name is required.`);
  });

  it("reports the first offending field in reading order", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), values({ namespace: "", name: "", guestClass: "" }));

    expect(reason?.startsWith(`${guestCreateFieldLabels.namespace}:`)).toBe(true);
  });

  it("reports the name before the class", () => {
    expect(guestCreateSubmitBlockReason(inputs(), values({ name: "", guestClass: "" }))?.startsWith("Name:")).toBe(
      true,
    );
  });

  it("reports the class before the image", () => {
    expect(
      guestCreateSubmitBlockReason(inputs(), values({ guestClass: "", image: "" }))?.startsWith("Guest class:"),
    ).toBe(true);
  });

  it("reports the storage rule when everything else is right", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), values({ storageAccessMode: "ReadWriteMany" }));

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
      const reason = guestCreateSubmitBlockReason(inputs(), values(form));

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
    expect(guestCreateErrors(inputs(), values({ name: "already-here" })).name).toBeUndefined();
    expect(guestCreateSubmitBlockReason(inputs(), values({ name: "already-here" }))).toBeUndefined();
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

  it("emits no image reference when the boot source is not the image one", () => {
    // The value is still in the form - only a switch clears it - and the
    // builder reads the source rather than the field.
    expect(guestCreatePayload(inputs(), values({ bootSource: "kernel" })).spec.imageRef).toBeUndefined();
    expect(guestCreatePayload(inputs(), values({ bootSource: "clone" })).spec.imageRef).toBeUndefined();
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

describe("guestBootSourceChoices", () => {
  it("offers the three sources in reading order, each with a description", () => {
    const choices = guestBootSourceChoices();

    expect(choices.map((choice) => choice.source)).toEqual(["image", "kernel", "clone"]);
    expect(choices.map((choice) => choice.label)).toEqual(["Disk image", "Kernel", "Clone from snapshot"]);

    for (const choice of choices) {
      expect(choice.description.length).toBeGreaterThan(0);
    }
  });

  it("says what the image source does to the guest's disk", () => {
    expect(guestBootSourceDescription("image")).toContain("clones a SwiftImage");
    expect(guestBootSourceDescription("image")).toContain("root disk");
  });

  it("says that a kernel-boot guest has no disk and is Linux only", () => {
    const description = guestBootSourceDescription("kernel");

    expect(description).toContain("no root disk");
    expect(description).toContain("Linux only");
  });

  it("says that a clone resumes rather than boots, and is sized by the snapshot", () => {
    const description = guestBootSourceDescription("clone");

    expect(description).toContain("resumes");
    expect(description).toContain("not the guest class");
  });

  it("labels every source, including in the sentences that name one", () => {
    expect(guestBootSourceLabels.image).toBe("Disk image");
    expect(guestBootSourceLabels.kernel).toBe("Kernel");
    expect(guestBootSourceLabels.clone).toBe("Clone from snapshot");
  });
});

describe("switchBootSource", () => {
  /** A form with every source's fields filled at once, which only a switch can produce. */
  function crowded(): GuestFormValues {
    return values({
      image: "ubuntu-2404",
      kernel: "kernel-6-12",
      kernelCmdline: "console=ttyS0",
      snapshot: "snap-s3",
      cloneTargetNode: "node-a",
      seedProfile: "e2e-seed-basic",
      nodeName: "node-a",
      storageAccessMode: "ReadWriteMany",
      storageVolumeMode: "Block",
      storageClassName: "longhorn",
    });
  }

  it("keeps only the image fields on image boot", () => {
    const form = switchBootSource(crowded(), "image");

    expect(form.bootSource).toBe("image");
    expect(form.image).toBe("ubuntu-2404");
    expect(form.kernel).toBe("");
    expect(form.kernelCmdline).toBe("");
    expect(form.snapshot).toBe("");
    expect(form.cloneTargetNode).toBe("");
  });

  it("keeps only the kernel fields on kernel boot", () => {
    const form = switchBootSource(crowded(), "kernel");

    expect(form.kernel).toBe("kernel-6-12");
    expect(form.kernelCmdline).toBe("console=ttyS0");
    expect(form.image).toBe("");
    expect(form.snapshot).toBe("");
    expect(form.cloneTargetNode).toBe("");
  });

  it("keeps only the clone fields on clone boot", () => {
    const form = switchBootSource(crowded(), "clone");

    expect(form.snapshot).toBe("snap-s3");
    expect(form.cloneTargetNode).toBe("node-a");
    expect(form.image).toBe("");
    expect(form.kernel).toBe("");
    expect(form.kernelCmdline).toBe("");
  });

  it("drops the seed profile on the two sources that ignore it", () => {
    expect(switchBootSource(crowded(), "image").seedProfile).toBe("e2e-seed-basic");
    expect(switchBootSource(crowded(), "kernel").seedProfile).toBe("");
    expect(switchBootSource(crowded(), "clone").seedProfile).toBe("");
  });

  it("drops the node pin on clone boot only, where the snapshot places the guest", () => {
    expect(switchBootSource(crowded(), "image").nodeName).toBe("node-a");
    expect(switchBootSource(crowded(), "kernel").nodeName).toBe("node-a");
    expect(switchBootSource(crowded(), "clone").nodeName).toBe("");
  });

  it("drops the storage overrides on kernel boot only, where no PVC is created", () => {
    const kernel = switchBootSource(crowded(), "kernel");

    expect(kernel.storageAccessMode).toBe("");
    expect(kernel.storageVolumeMode).toBe("");
    expect(kernel.storageClassName).toBe("");
    expect(switchBootSource(crowded(), "clone").storageAccessMode).toBe("ReadWriteMany");
    expect(switchBootSource(crowded(), "image").storageClassName).toBe("longhorn");
  });

  it("keeps what the boot source does not decide", () => {
    for (const source of implementedBootSources) {
      const form = switchBootSource(crowded(), source);

      expect(form.namespace).toBe("vms");
      expect(form.name).toBe("demo");
      expect(form.guestClass).toBe("e2e-small");
      expect(form.runPolicy).toBe("Running");
      expect(form.regenerateMachineIdentity).toBe(true);
    }
  });

  it("never leaks another source's reference into the payload, from any source", () => {
    // The property the whole clearing rule exists for: whatever the form held
    // before the switch, the object that leaves this dialog names exactly one
    // boot source.
    const refs: Record<GuestBootSource, "imageRef" | "kernelRef" | "cloneFromSnapshot"> = {
      image: "imageRef",
      kernel: "kernelRef",
      clone: "cloneFromSnapshot",
    };

    for (const source of implementedBootSources) {
      const { spec } = guestCreatePayload(inputs(), switchBootSource(crowded(), source));
      const present = (["imageRef", "kernelRef", "cloneFromSnapshot"] as const).filter((key) => key in spec);

      expect(present).toEqual([refs[source]]);
    }
  });

  it("never leaks the seed reference into a source that ignores it", () => {
    for (const source of implementedBootSources) {
      const { spec } = guestCreatePayload(inputs(), switchBootSource(crowded(), source));

      expect("seedProfileRef" in spec).toBe(source === "image");
    }
  });

  it("is a new object, so the previous values are not mutated under the caller", () => {
    const before = crowded();
    const after = switchBootSource(before, "kernel");

    expect(before.image).toBe("ubuntu-2404");
    expect(after).not.toBe(before);
  });
});

describe("seedProfileApplies", () => {
  it("is disk boot only, which is the CRD's own scope for the field", () => {
    expect(seedProfileApplies("image")).toBe(true);
    expect(seedProfileApplies("kernel")).toBe(false);
    expect(seedProfileApplies("clone")).toBe(false);
  });

  it("gives a reason wherever it refuses the field, and none where it does not", () => {
    expect(seedProfileDroppedReason("image")).toBeUndefined();
    expect(seedProfileDroppedReason("kernel")).toContain("no cloud-init seed");
    expect(seedProfileDroppedReason("kernel")).toContain("disk boot");
    expect(seedProfileDroppedReason("clone")).toContain("already seeded");
  });
});

describe("storageOverridesApply", () => {
  it("is dropped on kernel boot, where there is no root-disk PVC", () => {
    expect(storageOverridesApply("image")).toBe(true);
    expect(storageOverridesApply("clone")).toBe(true);
    expect(storageOverridesApply("kernel")).toBe(false);
  });

  it("says what the dropped section would have configured, and why it does not", () => {
    expect(kernelStorageDroppedFact).toContain("no root disk of its own");
    expect(kernelStorageDroppedFact).toContain("live migration");
  });

  it("sends no storage block on kernel boot even when the fields hold values", () => {
    expect(
      guestStorageOverrides(
        kernelValues({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block", storageClassName: "longhorn" }),
      ),
    ).toBeUndefined();
  });
});

describe("guestKernelChoices", () => {
  it("offers every kernel of the namespace with its phase on the label", () => {
    const choices = guestKernelChoices(inputs());

    expect(choices.map((choice) => choice.name)).toEqual(["kernel-6-12", "kernel-6-14", "kernel-fresh"]);
    expect(choices[0].label).toBe("kernel-6-12 - Ready");
    expect(choices[1].label).toBe("kernel-6-14 - Pulling");
  });

  it("marks the not-Ready ones without refusing them", () => {
    const choices = guestKernelChoices(inputs());

    expect(choices[0].ready).toBe(true);
    expect(choices[1].ready).toBe(false);
    expect(choices[2].ready).toBe(false);
  });

  it("says so when a kernel has no phase at all", () => {
    expect(guestKernelChoices(inputs()).at(2)?.label).toBe("kernel-fresh - no phase yet");
  });

  it("offers nothing when the namespace holds no kernel", () => {
    expect(guestKernelChoices(inputs({ kernels: [] }))).toEqual([]);
  });

  it("finds the picked kernel, and nothing when the name is not one of them", () => {
    expect(pickedKernel(inputs(), kernelValues())?.name).toBe("kernel-6-12");
    expect(pickedKernel(inputs(), kernelValues({ kernel: "typed-by-hand" }))).toBeUndefined();
    expect(pickedKernel(inputs(), kernelValues({ kernel: "" }))).toBeUndefined();
  });
});

describe("kernelWillWaitFact", () => {
  it("says nothing about a Ready kernel", () => {
    expect(kernelWillWaitFact(readyKernel)).toBeUndefined();
    expect(kernelWillWaitFact(undefined)).toBeUndefined();
  });

  it("names the phase and the failure the guest is born into", () => {
    const fact = kernelWillWaitFact(pullingKernel) ?? "";

    expect(fact).toContain("kernel-6-14 is Pulling, not Ready");
    expect(fact).toContain("born Failed");
    expect(fact).toContain("Resolved=False");
  });

  it("states the resync rather than the watch, which is what makes it different from an image", () => {
    const fact = kernelWillWaitFact(pullingKernel) ?? "";

    expect(fact).toContain("30-second resync");
    expect(fact).toContain("not watched the way images are");
    expect(fact).toContain("nothing has to be recreated");
  });

  it("has its own wording for a kernel that has not reported a phase", () => {
    expect(kernelWillWaitFact(phaselessKernel)).toContain("has not reported a phase yet");
  });
});

describe("kernelCmdlineFact", () => {
  it("says what the field does when no kernel is named yet", () => {
    expect(kernelCmdlineFact(undefined, "")).toContain("replaces the kernel's own command line");
  });

  it("quotes the kernel's own command line as the default it replaces", () => {
    const fact = kernelCmdlineFact(readyKernel, "kernel-6-12");

    expect(fact).toContain('"console=ttyS0 reboot=k panic=1"');
    expect(fact).toContain("replaces that line whole");
  });

  it("says when the kernel declares no command line of its own", () => {
    expect(kernelCmdlineFact(pullingKernel, "kernel-6-14")).toContain("declares no command line of its own");
  });

  it("degrades to an unverified sentence when the kernel could not be read", () => {
    const fact = kernelCmdlineFact(undefined, "typed-by-hand");

    expect(fact).toContain("could not be read from here");
    expect(fact).toContain("replaces it whole");
  });
});

describe("cloneSnapshotChoices", () => {
  it("offers only the Ready snapshots that hold a memory image", () => {
    expect(cloneSnapshotChoices(inputs()).map((choice) => choice.name)).toEqual([
      "snap-local",
      "snap-s3",
      "snap-oci-full",
      "snap-orphan",
    ]);
  });

  it("shows the backend and the phase on every option", () => {
    const choices = cloneSnapshotChoices(inputs());

    expect(choices[0].label).toBe("snap-local - local, Ready");
    expect(choices[1].label).toBe("snap-s3 - s3, Ready");
  });

  it("treats a memory image and a memory backend as the same evidence", () => {
    expect(snapshotIsResumable(localSnapshot)).toBe(true);
    expect(snapshotIsResumable({ name: "s3-no-status", phase: "Ready", backend: "s3" })).toBe(true);
    expect(snapshotIsResumable({ name: "unknown-backend", phase: "Ready", hasMemorySnapshot: true })).toBe(true);
  });

  it("refuses a disk-only capture and one that is not Ready yet", () => {
    expect(snapshotIsResumable(diskOnlySnapshot)).toBe(false);
    expect(snapshotIsResumable(uploadingSnapshot)).toBe(false);
  });

  it("counts what it left out, and says which rule left it out", () => {
    const reason = excludedSnapshotsReason(inputs()) ?? "";

    expect(reason).toContain("1 holds no memory image");
    expect(reason).toContain("1 is not Ready yet");
    expect(reason).toContain("This namespace has 6 snapshots");
  });

  it("says nothing when every snapshot of the namespace is offered", () => {
    expect(excludedSnapshotsReason(inputs({ snapshots: [localSnapshot, s3Snapshot] }))).toBeUndefined();
    expect(excludedSnapshotsReason(inputs({ snapshots: [] }))).toBeUndefined();
  });

  it("counts in the plural and the singular alike", () => {
    const reason = excludedSnapshotsReason(inputs({ snapshots: [diskOnlySnapshot, uploadingSnapshot] })) ?? "";

    expect(reason).toContain("1 holds no memory image");
    expect(reason).toContain("1 is not Ready yet");

    const plural =
      excludedSnapshotsReason(inputs({ snapshots: [diskOnlySnapshot, { ...diskOnlySnapshot, name: "snap-csi-2" }] })) ??
      "";

    expect(plural).toContain("2 hold no memory image");
  });

  it("finds the picked snapshot, and nothing when the name is not one of them", () => {
    expect(pickedSnapshot(inputs(), cloneValues())?.name).toBe("snap-local");
    expect(pickedSnapshot(inputs(), cloneValues({ snapshot: "typed-by-hand" }))).toBeUndefined();
    expect(pickedSnapshot(inputs(), cloneValues({ snapshot: "" }))).toBeUndefined();
  });
});

describe("cloneTargetNodeApplies", () => {
  it("is required exactly for the two tiers whose artifacts are downloaded", () => {
    expect(cloneTargetNodeApplies(s3Snapshot)).toBe(true);
    expect(cloneTargetNodeApplies(ociFullStateSnapshot)).toBe(true);
    expect(cloneTargetNodeApplies(localSnapshot)).toBe(false);
    expect(cloneTargetNodeApplies(diskOnlySnapshot)).toBe(false);
  });

  it("does not apply to a snapshot nobody could read", () => {
    expect(cloneTargetNodeApplies(undefined)).toBe(false);
    expect(cloneTargetNodeApplies({ name: "unknown", phase: "Ready" })).toBe(false);
  });

  it("names the node a local capture pins the clone to", () => {
    const fact = cloneNodeFact(localSnapshot) ?? "";

    expect(fact).toContain("runs on node-a");
    expect(fact).toContain("no target node is sent");
  });

  it("says the node is not recorded rather than inventing one", () => {
    const fact = cloneNodeFact({ ...localSnapshot, nodeName: undefined }) ?? "";

    expect(fact).toContain("not recorded on the");
    expect(fact).toContain("No target node is sent");
  });

  it("has nothing to say where the field is rendered instead", () => {
    expect(cloneNodeFact(s3Snapshot)).toBeUndefined();
    expect(cloneNodeFact(undefined)).toBeUndefined();
  });
});

describe("cloneIdentityItems", () => {
  it("sends the four items when the machine identity is regenerated", () => {
    expect(cloneIdentityItems(cloneValues())).toEqual(["hostname", "machineId", "sshHostKeys", "macAddresses"]);
  });

  it("sends the MAC rewrite alone when the machine identity is kept", () => {
    expect(cloneIdentityItems(cloneValues({ regenerateMachineIdentity: false }))).toEqual(["macAddresses"]);
  });

  it("never sends an empty list, which upstream would read as all four", () => {
    for (const regenerateMachineIdentity of [true, false]) {
      expect(cloneIdentityItems(cloneValues({ regenerateMachineIdentity })).length).toBeGreaterThan(0);
    }
  });

  it("always includes the MAC rewrite, whatever the form says", () => {
    expect(cloneIdentityItems(cloneValues({ regenerateMachineIdentity: false }))).toContain("macAddresses");
    expect(cloneIdentityItems(cloneValues())).toContain("macAddresses");
  });

  it("explains the lock with the collision it prevents", () => {
    expect(cloneMacLockRule).toContain("cannot be turned off");
    expect(cloneMacLockRule).toContain("same MAC addresses");
  });

  it("states the empty-list trap next to the list it sends", () => {
    const fact = cloneRegenerateFact(cloneValues());

    expect(fact).toContain("hostname, machineId, sshHostKeys, macAddresses");
    expect(fact).toContain("An empty list means all four");
  });

  it("states the shorter list the same way", () => {
    expect(cloneRegenerateFact(cloneValues({ regenerateMachineIdentity: false }))).toContain(
      "regenerate is sent as macAddresses",
    );
  });

  it("says where the machine-identity work happens, and what the source guest changes about it", () => {
    expect(cloneMachineIdentityFact(localSnapshot)).toContain("without a reboot");
    expect(cloneMachineIdentityFact(s3Snapshot)).toContain("first boot");
    expect(cloneMachineIdentityFact(undefined)).toContain("Hostname, machine ID and SSH host keys");
  });
});

describe("cloneInertClassNote", () => {
  it("says the class does not size the clone, and what does", () => {
    const note = cloneInertClassNote(localSnapshot);

    expect(note).toContain("does not size this clone");
    expect(note).toContain("2 vCPU and 4096Mi");
  });

  it("says so even when the capture recorded no sizing", () => {
    const note = cloneInertClassNote({ name: "bare", phase: "Ready", backend: "local", hasMemorySnapshot: true });

    expect(note).toContain("required by the schema");
    expect(note).toContain("not readable from here");
  });

  it("renders the snapshot's own sizing next to the class block", () => {
    expect(cloneSizingRows(localSnapshot)).toEqual([
      { label: "Resumed CPU", value: "2 (from snap-local)" },
      { label: "Resumed memory", value: "4096Mi (from snap-local)" },
    ]);
  });

  it("renders no sizing rows when there is nothing to render", () => {
    expect(cloneSizingRows(undefined)).toEqual([]);
    expect(cloneSizingRows(diskOnlySnapshot)).toEqual([]);
    expect(cloneSizingRows({ name: "half", guestSpec: { osType: "linux" } })).toEqual([]);
  });

  it("renders only the half the capture recorded", () => {
    expect(cloneSizingRows({ name: "half", guestSpec: { cpu: "4" } })).toEqual([
      { label: "Resumed CPU", value: "4 (from half)" },
    ]);
  });
});

describe("cloneGoneSourceWarning", () => {
  it("warns when the guest the snapshot was taken from is not in the namespace", () => {
    const warning = cloneGoneSourceWarning(inputs(), cloneValues({ snapshot: "snap-orphan" })) ?? "";

    expect(warning).toContain("The guest long-gone");
    expect(warning).toContain("is gone from vms");
    expect(warning).toContain("full-state oci capture");
    expect(warning).toContain("warns");
  });

  it("names the backend of the capture that is not full-state, with the article its name takes", () => {
    const goneS3 = { ...s3Snapshot, sourceGuestName: "long-gone" };
    const warning = cloneGoneSourceWarning(inputs({ snapshots: [goneS3] }), cloneValues({ snapshot: "snap-s3" })) ?? "";

    expect(warning).toContain("this one is an s3 capture");

    const goneLocal = cloneGoneSourceWarning(inputs(), cloneValues({ snapshot: "snap-orphan" })) ?? "";

    expect(goneLocal).toContain("this one is a local capture");
  });

  it("says a full-state oci clone does not need its source", () => {
    const warning = cloneGoneSourceWarning(inputs(), cloneValues({ snapshot: "snap-oci-full" })) ?? "";

    expect(warning).toContain("carries the disk as well as the memory");
    expect(warning).toContain("does not need");
  });

  it("says nothing when the source guest is still there", () => {
    expect(cloneGoneSourceWarning(inputs(), cloneValues())).toBeUndefined();
  });

  it("says nothing when the guest list could not be read", () => {
    // The asymmetry that matters: an empty list from a refused read is not
    // evidence that every source guest is gone.
    expect(
      cloneGoneSourceWarning(
        inputs({ existingNames: [], existingNamesUnverified: true }),
        cloneValues({ snapshot: "snap-orphan" }),
      ),
    ).toBeUndefined();
  });

  it("warns when the namespace genuinely holds no guest at all", () => {
    expect(
      cloneGoneSourceWarning(inputs({ existingNames: [] }), cloneValues({ snapshot: "snap-orphan" })),
    ).toBeDefined();
  });

  it("says nothing on the other two boot sources", () => {
    expect(cloneGoneSourceWarning(inputs(), values({ snapshot: "snap-orphan" }))).toBeUndefined();
    expect(cloneGoneSourceWarning(inputs(), kernelValues({ snapshot: "snap-orphan" }))).toBeUndefined();
  });

  it("says nothing about a snapshot that names no source guest, or that could not be read", () => {
    expect(
      cloneGoneSourceWarning(
        inputs({ snapshots: [{ name: "snap-nameless", phase: "Ready", backend: "local", hasMemorySnapshot: true }] }),
        cloneValues({ snapshot: "snap-nameless" }),
      ),
    ).toBeUndefined();
    expect(cloneGoneSourceWarning(inputs(), cloneValues({ snapshot: "typed-by-hand" }))).toBeUndefined();
  });
});

describe("guestOsType per boot source", () => {
  it("is a fact of the boot source on kernel boot, and always linux", () => {
    const fact = guestOsType(inputs(), kernelValues());

    expect(fact.osType).toBe("linux");
    expect(fact.unverified).toBe(false);
    expect(fact.text).toContain("Linux only");
    expect(fact.text).toContain("disk boot");
  });

  it("stays linux on kernel boot even when a windows image was picked first", () => {
    expect(guestOsType(inputs(), kernelValues({ image: "windows-2022" })).osType).toBe("linux");
  });

  it("is read off the snapshot's captured guest spec on clone boot", () => {
    const fact = guestOsType(inputs(), cloneValues());

    expect(fact.osType).toBe("linux");
    expect(fact.fromImage).toBe(true);
    expect(fact.text).toContain("captured");
    expect(fact.text).toContain("snap-local");
  });

  it("carries a windows capture through instead of claiming it is linux", () => {
    const fact = guestOsType(inputs(), cloneValues({ snapshot: "snap-oci-full" }));

    expect(fact.osType).toBe("windows");
    expect(fact.fromImage).toBe(true);
  });

  it("waits for a snapshot before saying anything about the OS", () => {
    const fact = guestOsType(inputs(), cloneValues({ snapshot: "" }));

    expect(fact.osType).toBe("linux");
    expect(fact.unverified).toBe(false);
    expect(fact.text).toContain("until a snapshot is picked");
  });

  it("marks the value unverified when the snapshot could not be read", () => {
    const fact = guestOsType(inputs(), cloneValues({ snapshot: "typed-by-hand" }));

    expect(fact.unverified).toBe(true);
    expect(fact.text).toContain("could not be read from here");
  });

  it("marks the value unverified when the capture recorded no osType", () => {
    const fact = guestOsType(
      inputs({ snapshots: [{ name: "snap-silent", phase: "Ready", backend: "local", hasMemorySnapshot: true }] }),
      cloneValues({ snapshot: "snap-silent" }),
    );

    expect(fact.osType).toBe("linux");
    expect(fact.unverified).toBe(true);
    expect(fact.text).toContain("records no osType");
  });

  it("warns that windows is documented as disk boot only when the clone is one", () => {
    expect(windowsCloneWarning).toContain("disk boot only");
    expect(windowsCloneWarning).toContain("webhook");
  });
});

describe("guestGpuGuard", () => {
  it("allows a GPU on an image-boot linux guest", () => {
    expect(guestGpuGuard(inputs(), values()).enabled).toBe(true);
  });

  it("refuses one on kernel boot, citing upstream's own documentation (G6)", () => {
    const guard = guestGpuGuard(inputs(), kernelValues());

    expect(guard.enabled).toBe(false);
    expect(guard.reason).toContain("mutually exclusive");
    expect(guard.reason).toContain("UEFI");
    expect(guard.reason).toContain("nothing in the API server");
  });

  it("refuses one on clone boot, with the reason a resumed VM cannot get it back", () => {
    const guard = guestGpuGuard(inputs(), cloneValues());

    expect(guard.enabled).toBe(false);
    expect(guard.reason).toContain("not captured in a memory snapshot");
    expect(guard.reason).toContain("DRA claim");
  });

  it("refuses one on a windows image, which is upstream's v1 limit", () => {
    const guard = guestGpuGuard(inputs(), values({ image: "windows-2022" }));

    expect(guard.enabled).toBe(false);
    expect(guard.reason).toContain("Windows guest");
  });

  it("never disables without a reason (W4)", () => {
    const forms = [values(), values({ image: "windows-2022" }), kernelValues(), cloneValues()];

    for (const form of forms) {
      const guard = guestGpuGuard(inputs(), form);

      if (!guard.enabled) {
        expect(guard.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("guestNodeChoices with the kernel-node rule", () => {
  const labelled: NodeFacts[] = [
    { name: "node-kernel", ready: true, schedulable: true, labels: { "kubeswift.io/kernel-node": "true" } },
    { name: "node-plain", ready: true, schedulable: true },
    { name: "node-down", ready: false, schedulable: true, labels: { "kubeswift.io/kernel-node": "true" } },
  ];

  it("offers every Ready, schedulable node plainly on image boot", () => {
    const choices = guestNodeChoices(inputs({ nodes: labelled }));

    expect(choices.map((choice) => choice.name)).toEqual(["node-kernel", "node-plain"]);
    expect(choices.every((choice) => choice.guard.enabled)).toBe(true);
  });

  it("disables the unlabelled nodes on kernel boot, with the label in the reason", () => {
    const choices = guestNodeChoices(inputs({ nodes: labelled }), "kernel");
    const plain = choices.find((choice) => choice.name === "node-plain");

    expect(choices.find((choice) => choice.name === "node-kernel")?.guard.enabled).toBe(true);
    expect(plain?.guard.enabled).toBe(false);
    expect(plain?.guard.enabled === false ? plain.guard.reason : "").toContain("kubeswift.io/kernel-node: true");
  });

  it("drops what cannot take a pod at all rather than disabling it", () => {
    expect(guestNodeChoices(inputs({ nodes: labelled }), "kernel").map((choice) => choice.name)).toEqual([
      "node-kernel",
      "node-plain",
    ]);
  });

  it("never disables an option without a reason (W4)", () => {
    for (const source of implementedBootSources) {
      for (const choice of guestNodeChoices(inputs({ nodes: labelled }), source)) {
        if (!choice.guard.enabled) {
          expect(choice.guard.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("states the rule the disabled options come from", () => {
    expect(kernelNodeRuleFact).toContain("kubeswift.io/kernel-node: true");
    expect(kernelNodeRuleFact).toContain("pulls the kernel artifact");
  });

  it("offers no pin at all on clone boot, and says who places the guest instead", () => {
    expect(nodePinApplies("image")).toBe(true);
    expect(nodePinApplies("kernel")).toBe(true);
    expect(nodePinApplies("clone")).toBe(false);
    expect(clonePinDroppedFact).toContain("placed by its snapshot");
    expect(clonePinDroppedFact).toContain("spec.nodeName is not sent");
  });
});

describe("guestClassSizing per boot source", () => {
  it("marks the root disk and the storage unused on kernel boot", () => {
    const rows = guestClassSizing(smallClass, "kernel");

    expect(rows.find((row) => row.label === "Root disk")?.value).toContain("not used");
    expect(rows.find((row) => row.label === "Storage")?.value).toContain("not used");
    expect(rows.find((row) => row.label === "CPU")?.value).toBe("2");
  });

  it("marks the cpu and the memory unused on clone boot", () => {
    const rows = guestClassSizing(smallClass, "clone");

    expect(rows.find((row) => row.label === "CPU")?.value).toBe("2 - not used by a clone");
    expect(rows.find((row) => row.label === "Memory")?.value).toBe("4Gi - not used by a clone");
    expect(rows.find((row) => row.label === "Root disk")?.value).toBe("20Gi qcow2");
  });

  it("is the slice-1 block on image boot, and defaults to it", () => {
    expect(guestClassSizing(smallClass, "image")).toEqual(guestClassSizing(smallClass));
  });

  it("says the storage rule does not apply to a kernel-boot guest", () => {
    const storage = resolvedStorage(inputs(), kernelValues());

    expect(liveMigrationLabel(storage, "kernel")).toBe("not restricted by storage (kernel boot)");
    expect(liveMigrationFact(storage, "kernel")).toBe(kernelLiveMigrationFact);
    expect(kernelLiveMigrationFact).toContain("exempts it");
  });

  it("keeps the storage verdict on the other two sources", () => {
    const storage = resolvedStorage(inputs(), cloneValues({ guestClass: "e2e-shared" }));

    expect(liveMigrationLabel(storage, "clone")).toContain("possible");
    expect(liveMigrationFact(storage, "clone")).toContain("live-migrated");
  });
});

describe("guestCreateErrors on kernel and clone boot", () => {
  it("requires a kernel on kernel boot, and no image", () => {
    const errors = guestCreateErrors(inputs(), kernelValues({ kernel: "" }));

    expect(errors.kernel).toContain("A kernel is required");
    expect(errors.image).toBeUndefined();
  });

  it("says the kernel failure never heals on its own, unlike a pull", () => {
    expect(guestCreateErrors(inputs(), kernelValues({ kernel: "  " })).kernel).toContain("never heals on its own");
  });

  it("requires an image on image boot, and no kernel or snapshot", () => {
    const errors = guestCreateErrors(inputs(), values({ image: "" }));

    expect(errors.image).toBeDefined();
    expect(errors.kernel).toBeUndefined();
    expect(errors.snapshot).toBeUndefined();
  });

  it("requires a snapshot on clone boot", () => {
    const errors = guestCreateErrors(inputs(), cloneValues({ snapshot: "" }));

    expect(errors.snapshot).toContain("A snapshot is required");
    expect(errors.image).toBeUndefined();
  });

  it("requires a target node for an s3 capture, naming the backend and the reason", () => {
    const errors = guestCreateErrors(inputs(), cloneValues({ snapshot: "snap-s3" }));

    expect(errors.cloneTargetNode).toContain("A target node is required");
    expect(errors.cloneTargetNode).toContain("is an s3 capture");
    expect(errors.cloneTargetNode).toContain("downloaded");
  });

  it("requires one for an oci capture too, named with its own article", () => {
    expect(guestCreateErrors(inputs(), cloneValues({ snapshot: "snap-oci-full" })).cloneTargetNode).toContain(
      "is an oci capture",
    );
  });

  it("accepts the s3 clone once a node is named", () => {
    expect(
      guestCreateErrors(inputs(), cloneValues({ snapshot: "snap-s3", cloneTargetNode: "node-a" })).cloneTargetNode,
    ).toBeUndefined();
  });

  it("never requires a target node for a local capture", () => {
    expect(guestCreateErrors(inputs(), cloneValues()).cloneTargetNode).toBeUndefined();
  });

  it("requires no target node for a snapshot it could not read, since the tier is unknown", () => {
    expect(guestCreateErrors(inputs(), cloneValues({ snapshot: "typed-by-hand" })).cloneTargetNode).toBeUndefined();
  });

  it("keeps refusing the storage pair the CRD refuses, on the sources that have storage", () => {
    expect(
      guestCreateErrors(inputs(), cloneValues({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" }))
        .storageAccessMode,
    ).toBe(storageCelRule);
  });
});

describe("guestCreateSubmitBlockReason on kernel and clone boot", () => {
  it("submits a complete kernel-boot form", () => {
    expect(guestCreateSubmitBlockReason(inputs(), kernelValues())).toBeUndefined();
  });

  it("submits a complete local clone, and one with its target node", () => {
    expect(guestCreateSubmitBlockReason(inputs(), cloneValues())).toBeUndefined();
    expect(
      guestCreateSubmitBlockReason(inputs(), cloneValues({ snapshot: "snap-s3", cloneTargetNode: "node-a" })),
    ).toBeUndefined();
  });

  it("names the kernel field and its reason when it is empty", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), kernelValues({ kernel: "" })) ?? "";

    expect(reason.startsWith(`${guestCreateFieldLabels.kernel}:`)).toBe(true);
    expect(reason).toContain("A kernel is required");
  });

  it("names the target node field and its reason when an s3 clone has none", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), cloneValues({ snapshot: "snap-s3" })) ?? "";

    expect(reason.startsWith(`${guestCreateFieldLabels.cloneTargetNode}:`)).toBe(true);
    expect(reason).toContain("downloaded");
  });

  it("reports the snapshot before the target node, in reading order", () => {
    const reason = guestCreateSubmitBlockReason(inputs(), cloneValues({ snapshot: "" })) ?? "";

    expect(reason.startsWith(`${guestCreateFieldLabels.snapshot}:`)).toBe(true);
  });

  it("labels every field it can name", () => {
    for (const field of ["kernel", "kernelCmdline", "snapshot", "cloneTargetNode"] as const) {
      expect(guestCreateFieldLabels[field].length).toBeGreaterThan(0);
    }
  });
});

describe("guestCreateWarnings on kernel and clone boot", () => {
  it("warns about a kernel the namespace does not hold, and says it heals", () => {
    const warning = guestCreateWarnings(inputs(), kernelValues({ kernel: "typed-by-hand" })).kernel ?? "";

    expect(warning).toContain("No SwiftKernel named typed-by-hand");
    expect(warning).toContain("30-second resync");
  });

  it("marks a kernel unverified when the list was refused", () => {
    const warning =
      guestCreateWarnings(inputs({ kernels: [], kernelsUnverified: true }), kernelValues({ kernel: "kernel-6-12" }))
        .kernel ?? "";

    expect(warning).toContain("could not be listed");
    expect(warning).toContain("not verified");
  });

  it("warns about a snapshot the namespace does not hold", () => {
    expect(guestCreateWarnings(inputs(), cloneValues({ snapshot: "typed-by-hand" })).snapshot).toContain(
      "No SwiftSnapshot named typed-by-hand",
    );
  });

  it("says which facts a refused snapshot list takes with it, including the target node", () => {
    const warning =
      guestCreateWarnings(inputs({ snapshots: [], snapshotsUnverified: true }), cloneValues({ snapshot: "snap-local" }))
        .snapshot ?? "";

    expect(warning).toContain("could not be listed");
    expect(warning).toContain("target node");
  });

  it("puts the gone-source warning on the snapshot field", () => {
    expect(guestCreateWarnings(inputs(), cloneValues({ snapshot: "snap-orphan" })).snapshot).toContain("is gone from");
  });

  it("keeps both sentences when the snapshot is unreadable and its source is gone", () => {
    // The unreadable branch wins the field, and the gone-source one cannot fire
    // from a snapshot nobody could read - so exactly one sentence is rendered.
    const warning = guestCreateWarnings(inputs(), cloneValues({ snapshot: "typed-by-hand" })).snapshot ?? "";

    expect(warning).toContain("No SwiftSnapshot named");
    expect(warning).not.toContain("is gone from");
  });

  it("warns about a target node no Ready node matches", () => {
    const warning =
      guestCreateWarnings(inputs(), cloneValues({ snapshot: "snap-s3", cloneTargetNode: "node-down" }))
        .cloneTargetNode ?? "";

    expect(warning).toContain("No Ready, schedulable node named node-down");
  });

  it("says nothing about a target node that is one", () => {
    expect(
      guestCreateWarnings(inputs(), cloneValues({ snapshot: "snap-s3", cloneTargetNode: "node-a" })).cloneTargetNode,
    ).toBeUndefined();
  });

  it("warns when the pinned node cannot run a kernel-boot guest", () => {
    const warning =
      guestCreateWarnings(
        inputs({ nodes: [{ name: "node-plain", ready: true, schedulable: true }] }),
        kernelValues({ nodeName: "node-plain" }),
      ).nodeName ?? "";

    expect(warning).toContain("does not carry kubeswift.io/kernel-node");
  });

  it("says nothing about a pinned node that carries the label", () => {
    expect(
      guestCreateWarnings(
        inputs({
          nodes: [
            { name: "node-kernel", ready: true, schedulable: true, labels: { "kubeswift.io/kernel-node": "true" } },
          ],
        }),
        kernelValues({ nodeName: "node-kernel" }),
      ).nodeName,
    ).toBeUndefined();
  });

  it("warns about no node at all on clone boot, where there is no pin", () => {
    expect(guestCreateWarnings(inputs(), cloneValues({ nodeName: "nowhere" })).nodeName).toBeUndefined();
  });
});

describe("guestCreatePayload on kernel boot", () => {
  it("sends the kernel reference and nothing about images", () => {
    const { spec } = guestCreatePayload(inputs(), kernelValues());

    expect(Object.keys(spec).sort()).toEqual(["guestClassRef", "kernelRef", "osType", "runPolicy"]);
    expect(spec.kernelRef).toEqual({ name: "kernel-6-12" });
    expect(spec.osType).toBe("linux");
    expect(spec.runPolicy).toBe("Running");
  });

  it("sends the command line only when the form set one", () => {
    const { spec } = guestCreatePayload(inputs(), kernelValues({ kernelCmdline: "console=ttyS0 quiet" }));

    expect(Object.keys(spec).sort()).toEqual(["guestClassRef", "kernelCmdline", "kernelRef", "osType", "runPolicy"]);
    expect(spec.kernelCmdline).toBe("console=ttyS0 quiet");
  });

  it("trims the command line and drops a blank one", () => {
    expect(guestCreatePayload(inputs(), kernelValues({ kernelCmdline: "  quiet  " })).spec.kernelCmdline).toBe("quiet");
    expect(guestCreatePayload(inputs(), kernelValues({ kernelCmdline: "   " })).spec.kernelCmdline).toBeUndefined();
  });

  it("never sends an empty kernel reference", () => {
    expect(guestCreatePayload(inputs(), kernelValues({ kernel: "" })).spec.kernelRef).toBeUndefined();
    expect(guestCreatePayload(inputs(), kernelValues({ kernel: "   " })).spec.kernelRef).toBeUndefined();
  });

  it("sends the node pin, which a kernel-boot guest still has", () => {
    expect(guestCreatePayload(inputs(), kernelValues({ nodeName: "node-a" })).spec.nodeName).toBe("node-a");
  });

  it("sends osType linux even for a form that once pointed at a windows image", () => {
    expect(guestCreatePayload(inputs(), kernelValues({ image: "windows-2022" })).spec.osType).toBe("linux");
  });
});

describe("guestCreatePayload on clone boot", () => {
  it("sends the clone block with the explicit regenerate list, and no target node for a local capture", () => {
    const { spec } = guestCreatePayload(inputs(), cloneValues());

    expect(Object.keys(spec).sort()).toEqual(["cloneFromSnapshot", "guestClassRef", "osType", "runPolicy"]);
    expect(spec.cloneFromSnapshot).toEqual({
      snapshotRef: { name: "snap-local" },
      regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"],
    });
  });

  it("sends the target node for an s3 capture", () => {
    const { spec } = guestCreatePayload(inputs(), cloneValues({ snapshot: "snap-s3", cloneTargetNode: "node-a" }));

    expect(spec.cloneFromSnapshot).toEqual({
      snapshotRef: { name: "snap-s3" },
      regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"],
      targetNode: "node-a",
    });
  });

  it("sends the target node for an oci capture", () => {
    expect(
      guestCreatePayload(inputs(), cloneValues({ snapshot: "snap-oci-full", cloneTargetNode: "node-b" })).spec
        .cloneFromSnapshot?.targetNode,
    ).toBe("node-b");
  });

  it("drops a target node the backend ignores", () => {
    expect(
      guestCreatePayload(inputs(), cloneValues({ cloneTargetNode: "node-a" })).spec.cloneFromSnapshot?.targetNode,
    ).toBeUndefined();
  });

  it("drops a target node for a snapshot it could not read", () => {
    expect(
      guestCreatePayload(inputs(), cloneValues({ snapshot: "typed-by-hand", cloneTargetNode: "node-a" })).spec
        .cloneFromSnapshot?.targetNode,
    ).toBeUndefined();
  });

  it("sends the MAC rewrite alone when the machine identity is kept", () => {
    expect(
      guestCreatePayload(inputs(), cloneValues({ regenerateMachineIdentity: false })).spec.cloneFromSnapshot
        ?.regenerate,
    ).toEqual(["macAddresses"]);
  });

  it("never sends an empty snapshot reference", () => {
    expect(guestCreatePayload(inputs(), cloneValues({ snapshot: "" })).spec.cloneFromSnapshot).toBeUndefined();
    expect(guestCreatePayload(inputs(), cloneValues({ snapshot: "  " })).spec.cloneFromSnapshot).toBeUndefined();
  });

  it("sends the osType the capture recorded", () => {
    expect(guestCreatePayload(inputs(), cloneValues({ snapshot: "snap-oci-full" })).spec.osType).toBe("windows");
  });

  it("sends the run policy explicitly, as swiftctl guest import does on this very path", () => {
    expect(guestCreatePayload(inputs(), cloneValues({ runPolicy: "Stopped" })).spec.runPolicy).toBe("Stopped");
    expect(guestCreatePayload(inputs(), cloneValues()).spec.runPolicy).toBe("Running");
  });

  it("sends no node pin and no seed reference", () => {
    const { spec } = guestCreatePayload(inputs(), cloneValues({ nodeName: "node-a", seedProfile: "e2e-seed-basic" }));

    expect(spec.nodeName).toBeUndefined();
    expect(spec.seedProfileRef).toBeUndefined();
  });

  it("still sends the storage overrides, which a clone does have", () => {
    expect(
      guestCreatePayload(inputs(), cloneValues({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Block" })).spec
        .storage,
    ).toEqual({ accessMode: "ReadWriteMany", volumeMode: "Block" });
  });

  it("still sends the guest agent, which a clone can be a source for in its turn", () => {
    expect(guestCreatePayload(inputs(), cloneValues({ guestAgentEnabled: true })).spec.guestAgent).toEqual({
      enabled: true,
    });
  });
});

describe("guestCreateSummary on kernel boot", () => {
  /** The kernel-boot summary as one line, for the assertions that are about a sentence being there. */
  function kernelSummary(overrides: Partial<GuestFormValues> = {}, inputOverrides: Partial<GuestCreateInputs> = {}) {
    const facts = guestCreateSummary(inputs(inputOverrides), kernelValues(overrides));

    return [facts.write, ...facts.notes, ...facts.warnings].join(" ");
  }

  it("says what it boots and what it does not clone", () => {
    const summary = kernelSummary();

    expect(summary).toContain("It boots the kernel kernel-6-12 and its initramfs directly");
    expect(summary).toContain("no image is cloned and no root disk is created");
  });

  it("names the command line it overrides, and the one it replaces", () => {
    expect(kernelSummary({ kernelCmdline: "quiet" })).toContain(
      'Its kernel command line is "quiet", replacing the kernel\'s own "console=ttyS0 reboot=k panic=1"',
    );
  });

  it("says the command line is this guest's own when the kernel declares none", () => {
    expect(kernelSummary({ kernel: "kernel-6-14", kernelCmdline: "quiet" })).toContain(
      "sent as spec.kernelCmdline for this guest alone",
    );
  });

  it("says nothing about a command line the form did not set", () => {
    expect(kernelSummary()).not.toContain("kernel command line is");
  });

  it("states the kernel-node rule on every kernel-boot create", () => {
    expect(kernelSummary()).toContain("kubeswift.io/kernel-node: true");
  });

  it("states it again next to the pin when a node is pinned", () => {
    const summary = kernelSummary({ nodeName: "node-a" });

    expect(summary).toContain("It is pinned to the node node-a");
    expect(summary).toContain("bypassing the scheduler");
  });

  it("warns that the guest waits when the kernel is not Ready", () => {
    const summary = kernelSummary({ kernel: "kernel-6-14" });

    expect(summary).toContain("kernel-6-14 is Pulling, not Ready");
    expect(summary).toContain("30-second resync");
  });

  it("says the storage rule does not apply instead of the live-migration verdict", () => {
    const summary = kernelSummary();

    expect(summary).toContain("clones no root disk");
    expect(summary).toContain("exempts it from that rule");
    expect(summary).not.toContain("which two launcher pods can hold at once");
  });

  it("says the launcher pod waits for the kernel artifact rather than a root disk", () => {
    expect(kernelSummary()).toContain("as soon as its kernel artifact is ready");
  });

  it("names no seed profile, whatever the form once held", () => {
    expect(kernelSummary({ seedProfile: "e2e-seed-basic" })).not.toContain("seed profile e2e-seed-basic");
  });

  it("keeps the class sizing line, which a kernel-boot guest does use", () => {
    expect(kernelSummary()).toContain("The guest class e2e-small sizes it");
  });

  it("keeps the write line", () => {
    expect(guestCreateSummary(inputs(), kernelValues()).write).toBe("Create SwiftGuest vms/demo");
  });
});

describe("guestCreateSummary on clone boot", () => {
  /** The clone summary as one line. */
  function cloneSummary(overrides: Partial<GuestFormValues> = {}, inputOverrides: Partial<GuestCreateInputs> = {}) {
    const facts = guestCreateSummary(inputs(inputOverrides), cloneValues(overrides));

    return [facts.write, ...facts.notes, ...facts.warnings].join(" ");
  }

  it("says what it resumes, with the backend and the capture time", () => {
    const summary = cloneSummary();

    expect(summary).toContain("It resumes the memory state of the local snapshot snap-local");
    expect(summary).toContain("captured at 2026-08-29T18:12:44Z");
    expect(summary).toContain("instead of booting");
  });

  it("states the MAC rewrite as something that always happens", () => {
    expect(cloneSummary()).toContain("cannot be turned off");
  });

  it("states the regenerate list and the empty-list trap", () => {
    const summary = cloneSummary();

    expect(summary).toContain("regenerate is sent as hostname, machineId, sshHostKeys, macAddresses");
    expect(summary).toContain("An empty list means all four");
  });

  it("says what is kept when the machine identity is not regenerated", () => {
    const summary = cloneSummary({ regenerateMachineIdentity: false });

    expect(summary).toContain("are kept: only the MAC addresses are regenerated");
    expect(summary).toContain("regenerate is sent as macAddresses");
  });

  it("names the node a local capture pins the clone to", () => {
    expect(cloneSummary()).toContain("This clone runs on node-a");
  });

  it("says where an s3 capture is downloaded once a node is picked", () => {
    const summary = cloneSummary({ snapshot: "snap-s3", cloneTargetNode: "node-a" });

    expect(summary).toContain("Its artifacts are downloaded onto node-a");
    expect(summary).toContain("an s3 capture lives in a registry or a bucket");
  });

  it("says what is missing before the node is picked", () => {
    const summary = cloneSummary({ snapshot: "snap-s3" });

    expect(summary).toContain("The artifacts of an s3 capture have to be downloaded onto a node");
    expect(summary).toContain("no target node is set yet");
  });

  it("names an oci tier with its own article too", () => {
    expect(cloneSummary({ snapshot: "snap-oci-full" })).toContain("The artifacts of an oci capture");
  });

  it("says the class is inert, with the sizing the snapshot decides", () => {
    const summary = cloneSummary();

    expect(summary).toContain("The guest class e2e-small is stored on this guest");
    expect(summary).toContain("does not size this clone");
    expect(summary).toContain("2 vCPU and 4096Mi");
  });

  it("warns when the source guest is gone", () => {
    expect(cloneSummary({ snapshot: "snap-orphan" })).toContain("is gone from vms");
  });

  it("warns that a windows capture is documented as disk boot only", () => {
    expect(cloneSummary({ snapshot: "snap-oci-full", cloneTargetNode: "node-a" })).toContain("disk boot only");
  });

  it("says the memory is not resumed until the guest is started, when it starts Stopped", () => {
    expect(cloneSummary({ runPolicy: "Stopped" })).toContain(
      "the captured memory is not resumed until this guest is started",
    );
  });

  it("says the launcher pod resumes rather than boots, when it starts running", () => {
    expect(cloneSummary()).toContain("resumes the captured memory instead of booting");
  });

  it("keeps the storage line, which a clone still has", () => {
    expect(cloneSummary()).toContain("can be migrated offline only");
  });

  it("names no seed profile and no node pin", () => {
    const summary = cloneSummary({ seedProfile: "e2e-seed-basic", nodeName: "node-a" });

    expect(summary).not.toContain("The seed profile e2e-seed-basic is rendered");
    expect(summary).not.toContain("It is pinned to the node node-a");
  });

  it("says the machine identity is regenerated in place when the source carried the agent", () => {
    expect(cloneSummary()).toContain("without a reboot");
  });

  it("says it happens on the first boot when the source carried no agent", () => {
    expect(cloneSummary({ snapshot: "snap-s3", cloneTargetNode: "node-a" })).toContain("first boot and not in place");
  });
});

describe("the article the sentences put in front of a backend's name", () => {
  // Interpolating the raw name produced "a s3 capture" and "A oci capture" in
  // the four sentences that name a tier. The article belongs to the name rather
  // than to the sentence, so no clone sentence may render one that way for any
  // tier the picker can hold.
  const tiers: SwiftSnapshotBackendType[] = ["csi-volume-snapshot", "local", "s3", "oci"];

  it.each(tiers)("never renders 'a %s'", (backend) => {
    const snapshot: GuestSnapshotFacts = {
      name: "snap-tier",
      phase: "Ready",
      backend,
      hasMemorySnapshot: true,
      // Gone, and not full-state, so the warning that names the backend fires
      // on every tier including oci.
      sourceGuestName: "long-gone",
      nodeName: "node-a",
      guestSpec: { cpu: "2", memoryMi: 2048, osType: "linux" },
    };
    const facts = inputs({ snapshots: [snapshot] });
    const formValues = cloneValues({ snapshot: "snap-tier" });
    const summary = guestCreateSummary(facts, formValues);
    const rendered = [
      guestCreateErrors(facts, formValues).cloneTargetNode,
      cloneGoneSourceWarning(facts, formValues),
      cloneNodeFact(snapshot),
      ...summary.notes,
      ...summary.warnings,
    ]
      .filter((sentence): sentence is string => sentence !== undefined)
      .join(" ");

    expect(rendered).toContain(backend);
    expect(rendered).not.toMatch(/\b[Aa] (?:s3|oci)\b/);
  });
});

describe("guestCreateWarnings about a field the boot source dropped", () => {
  it("says nothing about a seed profile the guest will not carry", () => {
    // Only reachable through a switch, and the switch clears it; the guard is
    // here so a warning can never be about a field that is neither rendered nor
    // written.
    expect(guestCreateWarnings(inputs(), kernelValues({ seedProfile: "not-there" })).seedProfile).toBeUndefined();
    expect(guestCreateWarnings(inputs(), cloneValues({ seedProfile: "not-there" })).seedProfile).toBeUndefined();
  });

  it("still says it on image boot", () => {
    expect(guestCreateWarnings(inputs(), values({ seedProfile: "not-there" })).seedProfile).toContain(
      "No SwiftSeedProfile named not-there",
    );
  });
});

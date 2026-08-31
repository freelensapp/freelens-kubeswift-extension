import { describe, expect, it } from "vitest";
import {
  addDataDisk,
  addDataDiskGuard,
  attachAsDiskApplies,
  attachAsDiskDroppedFact,
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
  dataDiskErrors,
  dataDiskSummaryNote,
  dataDisksSectionHasError,
  dataDisksSectionHint,
  dataDiskWarnings,
  declaredExposure,
  defaultBlankVolumeMode,
  defaultBootSource,
  defaultGpuTier,
  defaultGuestForm,
  defaultInterfaceType,
  defaultNamespace,
  defaultNetworkBinding,
  defaultPortProtocol,
  defaultRunPolicy,
  excludedFieldsFooter,
  excludedSnapshotsReason,
  gpuAppliesToBootSource,
  gpuErrors,
  gpuNodePinWarning,
  gpuProfileChoices,
  gpuProfileSummary,
  gpuSectionHasError,
  gpuSectionHint,
  gpuWarnings,
  guestAgentFact,
  guestBootSourceChoices,
  guestBootSourceDescription,
  guestBootSourceLabels,
  guestClassChoices,
  guestClassSizing,
  guestClassSummary,
  guestCreateBlockingIssues,
  guestCreateErrors,
  guestCreateFailureMessage,
  guestCreateFailurePrefix,
  guestCreateFieldLabels,
  guestCreatePayload,
  guestCreateSubmitBlockReason,
  guestCreateSuccessMessage,
  guestCreateSummary,
  guestCreateWarnings,
  guestDataDiskPayload,
  guestGpuBackendDescription,
  guestGpuBackends,
  guestGpuGuard,
  guestGpuPayload,
  guestImageChoices,
  guestInterfacesPayload,
  guestKernelChoices,
  guestNameError,
  guestNetworkBindings,
  guestNetworkPayload,
  guestNodeChoices,
  guestOsType,
  guestRunPolicies,
  guestRunPolicyChoices,
  guestStorageOverrides,
  imageWillWaitFact,
  implementedBootSources,
  interfaceErrors,
  interfaceTypesFact,
  interfaceWarnings,
  kernelCmdlineFact,
  kernelNodeRuleFact,
  kernelStorageDroppedFact,
  kernelWillWaitFact,
  maxDataDiskNameLength,
  maxDataDisks,
  maxGuestNameLength,
  maxPortNumber,
  maxServicePortNameLength,
  minPortNumber,
  networkBindingDescription,
  networkSectionHasError,
  networkSectionHint,
  newDataDiskRow,
  newInterfaceRow,
  newPortRow,
  nextRowId,
  nodePinApplies,
  nodePinFact,
  noGuestNodeReason,
  pickedGpuProfile,
  pickedGuestClass,
  pickedImage,
  pickedKernel,
  pickedSnapshot,
  portErrors,
  portWarnings,
  primaryInterfaceFact,
  readyImagePhase,
  removeDataDisk,
  removePort,
  resolvedStorage,
  runPolicyNote,
  runPolicyStarts,
  seedProfileApplies,
  seedProfileDroppedReason,
  setDataDiskSource,
  setGpuBackend,
  snapshotIsResumable,
  storageFields,
  storageOverridesApply,
  switchBootSource,
  updateDataDisk,
  usesNativeGpuProfile,
  windowsCloneWarning,
  windowsConstraintFact,
} from "./guest-create";
import {
  kernelLiveMigrationFact,
  liveMigrationFact,
  liveMigrationLabel,
  resolvedStorageText,
  storageCelRule,
  systemDefaultAccessMode,
  systemDefaultVolumeMode,
} from "./kube-storage";

import type { SwiftGuestRunPolicy } from "../api/kubeswift/swiftguest-v1alpha1";
import type { SwiftSnapshotBackendType } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import type {
  GuestBootSource,
  GuestClassFacts,
  GuestCreateField,
  GuestCreateInputs,
  GuestDataDiskRow,
  GuestFormValues,
  GuestGpuProfileFacts,
  GuestImageFacts,
  GuestInterfaceRow,
  GuestKernelFacts,
  GuestPortRow,
  GuestPvcFacts,
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

/** The claim `attachAsDisk` accepts: a raw device the guest can be handed. */
const blockPvc: GuestPvcFacts = { name: "data-block", volumeMode: "Block", phase: "Bound", storageClassName: "fast" };

/** The claim it refuses: a directory, with no device to hand to anything. */
const filesystemPvc: GuestPvcFacts = { name: "data-fs", volumeMode: "Filesystem", phase: "Bound" };

/** The claim that says nothing about its volume mode, which is a warning rather than a refusal. */
const silentPvc: GuestPvcFacts = { name: "data-silent", phase: "Pending" };

const pvcs: GuestPvcFacts[] = [blockPvc, filesystemPvc, silentPvc];

/** The two GPU profiles: a single PCIe card and a four-GPU hgx one. */
const pcieProfile: GuestGpuProfileFacts = {
  name: "gpu-pcie",
  count: 1,
  model: "L40S",
  tier: "pcie",
  partitionMode: "isolated",
};
const hgxProfile: GuestGpuProfileFacts = {
  name: "gpu-hgx",
  count: 4,
  model: "",
  tier: "hgx-shared",
  partitionMode: "shared",
};

const gpuProfiles: GuestGpuProfileFacts[] = [pcieProfile, hgxProfile];

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
    pvcs,
    pvcsUnverified: false,
    gpuProfiles,
    gpuProfilesUnverified: false,
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

// ---------------------------------------------------------------------------
// SPEC-0013 slice 3: the collapsed tail - data disks, network and ports, GPU.
//
// Almost every rule below belongs to a validating webhook that ships disabled,
// so these tests are the only place its behaviour is written down in this
// repository: what they assert is not "the form is strict" but "the form says
// what upstream would have said, on the install where nobody says it".
// ---------------------------------------------------------------------------

/** A data-disk row with everything filled in, so a test can vary one field. */
function diskRow(overrides: Partial<GuestDataDiskRow> = {}): GuestDataDiskRow {
  return { ...newDataDiskRow("disk-1"), name: "data", source: "image", image: "ubuntu-2404", ...overrides };
}

/** A port row with everything filled in. */
function portRow(overrides: Partial<GuestPortRow> = {}): GuestPortRow {
  return { ...newPortRow("port-1"), port: "8080", ...overrides };
}

/** An interface row with everything filled in. */
function nicRow(overrides: Partial<GuestInterfaceRow> = {}): GuestInterfaceRow {
  return { ...newInterfaceRow("nic-1"), name: "net1", ...overrides };
}

/** The form with a set of data disks on it. */
function withDisks(rows: GuestDataDiskRow[], overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ dataDisks: rows, ...overrides });
}

/** The form with a set of ports on it. */
function withPorts(rows: GuestPortRow[], overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ ports: rows, ...overrides });
}

/** The form with a set of additional interfaces on it. */
function withNics(rows: GuestInterfaceRow[]): GuestFormValues {
  return values({ interfaces: rows });
}

/** The form asking for a GPU through the native backend. */
function gpuProfileValues(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ gpuBackend: "profile", gpuProfile: "gpu-pcie", ...overrides });
}

/** The form asking for a GPU through DRA. */
function gpuClaimValues(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return values({ gpuBackend: "claim", gpuClaimName: "shared-gpu", ...overrides });
}

describe("defaultGuestForm, the collapsed tail", () => {
  it("opens with no data disk, no port and no interface at all", () => {
    const form = defaultGuestForm();

    expect(form.dataDisks).toEqual([]);
    expect(form.ports).toEqual([]);
    expect(form.interfaces).toEqual([]);
  });

  it("opens on the binding and the tier the API server would stamp anyway", () => {
    const form = defaultGuestForm();

    expect(form.networkBinding).toBe(defaultNetworkBinding);
    expect(defaultNetworkBinding).toBe("nat");
    expect(form.gpuTier).toBe(defaultGpuTier);
    expect(defaultGpuTier).toBe("pcie");
  });

  it("opens with no GPU: the backend is a choice and none of them is made", () => {
    const form = defaultGuestForm();

    expect(form.gpuBackend).toBe("none");
    expect(form.gpuProfile).toBe("");
    expect(form.gpuClaimName).toBe("");
    expect(form.gpuClaimTemplateName).toBe("");
    expect(form.gpuRequestName).toBe("");
    expect(form.gpuHugepages).toBe("");
  });
});

describe("nextRowId", () => {
  it("starts at one on an empty section", () => {
    expect(nextRowId("disk", [])).toBe("disk-1");
  });

  it("counts past the highest id rather than past the length", () => {
    expect(nextRowId("disk", [{ id: "disk-1" }, { id: "disk-7" }])).toBe("disk-8");
  });

  it("never reuses the id of a row that was removed in the middle", () => {
    const three = addDataDisk(addDataDisk(addDataDisk(defaultGuestForm())));
    const withoutSecond = removeDataDisk(three, three.dataDisks[1].id);
    const fourth = addDataDisk(withoutSecond);

    expect(fourth.dataDisks.map((row) => row.id)).toEqual(["disk-1", "disk-3", "disk-4"]);
  });

  it("ignores ids of another prefix", () => {
    expect(nextRowId("port", [{ id: "disk-9" }])).toBe("port-1");
  });
});

describe("addDataDiskGuard", () => {
  it("allows a disk while the guest has fewer than the maximum", () => {
    expect(addDataDiskGuard(withDisks([diskRow()])).enabled).toBe(true);
    expect(maxDataDisks).toBe(8);
  });

  it("refuses the ninth, with the count and the silent consequence (W4)", () => {
    const full = withDisks(Array.from({ length: maxDataDisks }, (_unused, index) => diskRow({ id: `disk-${index}` })));
    const guard = addDataDiskGuard(full);

    expect(guard.enabled).toBe(false);
    expect(guard.reason).toContain("at most 8 data disks");
    expect(guard.reason).toContain("already has 8");
    expect(guard.reason).toContain("webhook");
  });

  it("never disables without a reason, at every count up to the limit and past it", () => {
    for (let count = 0; count <= maxDataDisks + 2; count += 1) {
      const form = withDisks(Array.from({ length: count }, (_unused, index) => diskRow({ id: `disk-${index}` })));
      const guard = addDataDiskGuard(form);

      if (!guard.enabled) {
        expect(guard.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("adds nothing once the guard refuses", () => {
    const full = withDisks(Array.from({ length: maxDataDisks }, (_unused, index) => diskRow({ id: `disk-${index}` })));

    expect(addDataDisk(full).dataDisks).toHaveLength(maxDataDisks);
  });
});

describe("data disk rows", () => {
  it("adds an image-backed row with nothing filled in", () => {
    const [row] = addDataDisk(defaultGuestForm()).dataDisks;

    expect(row).toEqual({
      id: "disk-1",
      name: "",
      source: "image",
      image: "",
      pvc: "",
      blankSize: "",
      blankStorageClass: "",
      blankVolumeMode: "",
      attachAsDisk: false,
    });
  });

  it("removes the named row and leaves the others alone", () => {
    const form = withDisks([diskRow({ id: "disk-1", name: "one" }), diskRow({ id: "disk-2", name: "two" })]);

    expect(removeDataDisk(form, "disk-1").dataDisks.map((row) => row.name)).toEqual(["two"]);
  });

  it("changes one field of one row", () => {
    const form = withDisks([diskRow({ id: "disk-1" }), diskRow({ id: "disk-2", name: "other" })]);
    const patched = updateDataDisk(form, "disk-2", { name: "renamed" });

    expect(patched.dataDisks.map((row) => row.name)).toEqual(["data", "renamed"]);
  });

  it("empties the source it leaves, so two sources are inexpressible", () => {
    const form = withDisks([diskRow({ id: "disk-1", image: "ubuntu-2404" })]);
    const [row] = setDataDiskSource(form, "disk-1", "pvc").dataDisks;

    expect(row.source).toBe("pvc");
    expect(row.image).toBe("");
  });

  it("keeps attachAsDisk with the PVC it belonged to and drops it elsewhere", () => {
    const form = withDisks([
      diskRow({ id: "disk-1", source: "pvc", image: "", pvc: "data-block", attachAsDisk: true }),
    ]);

    expect(setDataDiskSource(form, "disk-1", "pvc").dataDisks[0].attachAsDisk).toBe(true);
    expect(setDataDiskSource(form, "disk-1", "image").dataDisks[0].attachAsDisk).toBe(false);
  });

  it("empties the blank fields when the row stops being a blank one", () => {
    const form = withDisks([
      diskRow({
        id: "disk-1",
        source: "blank",
        image: "",
        blankSize: "10Gi",
        blankStorageClass: "fast",
        blankVolumeMode: "Filesystem",
      }),
    ]);
    const [row] = setDataDiskSource(form, "disk-1", "image").dataDisks;

    expect(row.blankSize).toBe("");
    expect(row.blankStorageClass).toBe("");
    expect(row.blankVolumeMode).toBe("");
  });

  it("offers attachAsDisk on a PVC row and nowhere else", () => {
    expect(attachAsDiskApplies(diskRow({ source: "pvc" }))).toBe(true);
    expect(attachAsDiskApplies(diskRow({ source: "image" }))).toBe(false);
    expect(attachAsDiskApplies(diskRow({ source: "blank" }))).toBe(false);
  });

  it("says what an image row and a blank row do instead of offering the checkbox", () => {
    expect(attachAsDiskDroppedFact("image")).toContain("always attached as a raw VM disk");
    expect(attachAsDiskDroppedFact("image")).toContain("filesystem directory");
    expect(attachAsDiskDroppedFact("blank")).toContain("always attached as a raw VM disk");
  });
});

describe("dataDiskErrors", () => {
  it("says nothing about a complete image row", () => {
    expect(dataDiskErrors(inputs(), withDisks([diskRow()]))[0]).toEqual({});
  });

  it("requires a name, and says what the name becomes", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ name: "" })]));

    expect(messages.name).toContain("needs a name");
    expect(messages.name).toContain("/dev/kubeswift-data-");
  });

  it("refuses a name that is not a DNS label", () => {
    expect(dataDiskErrors(inputs(), withDisks([diskRow({ name: "Data_1" })]))[0].name).toContain(
      "lowercase letters, digits and '-'",
    );
  });

  it("refuses a name past the schema's own 36-character cap, with the count", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ name: "a".repeat(37) })]));

    expect(messages.name).toContain("at most 36 characters");
    expect(messages.name).toContain("this one is 37");
    expect(maxDataDiskNameLength).toBe(36);
  });

  it("accepts a name of exactly the cap", () => {
    expect(dataDiskErrors(inputs(), withDisks([diskRow({ name: "a".repeat(36) })]))[0].name).toBeUndefined();
  });

  it("refuses two disks with one name, on both rows", () => {
    const errors = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ id: "disk-1", name: "data" }), diskRow({ id: "disk-2", name: "data" })]),
    );

    expect(errors[0].name).toContain("Two data disks are named data");
    expect(errors[1].name).toContain("Two data disks are named data");
  });

  it("allows two disks with different names", () => {
    const errors = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ id: "disk-1", name: "one" }), diskRow({ id: "disk-2", name: "two" })]),
    );

    expect(errors[0].name).toBeUndefined();
    expect(errors[1].name).toBeUndefined();
  });

  it("refuses a row that names two sources, naming both of them", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ image: "ubuntu-2404", pvc: "data-block" })]));

    expect(messages.source).toContain("exactly one");
    expect(messages.source).toContain("a SwiftImage and an existing PVC");
    expect(messages.source).toContain("webhook");
  });

  it("refuses a row that names all three", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ image: "ubuntu-2404", pvc: "data-block", blankSize: "10Gi" })]),
    );

    expect(messages.source).toContain("a SwiftImage, an existing PVC and a blank disk");
  });

  it("asks for the image on an image row that names nothing", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ image: "" })]));

    expect(messages.image).toContain("Name the SwiftImage");
    expect(messages.source).toBeUndefined();
  });

  it("asks for the claim on a PVC row that names nothing", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ source: "pvc", image: "" })]));

    expect(messages.pvc).toContain("has to exist already");
  });

  it("asks for the size on a blank row that names nothing", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ source: "blank", image: "" })]));

    expect(messages.blankSize).toContain("Give the blank disk a size");
  });

  it("refuses a size that is not a Kubernetes quantity", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "blank", image: "", blankSize: "100 gigs" })]),
    );

    expect(messages.blankSize).toContain("Kubernetes quantity");
  });

  it("accepts the quantity forms the CRD's own pattern accepts", () => {
    for (const size of ["100Gi", "10G", "1Ti", "1e3", "500M", "1.5Gi"]) {
      const [messages] = dataDiskErrors(
        inputs(),
        withDisks([diskRow({ source: "blank", image: "", blankSize: size })]),
      );

      expect(messages.blankSize).toBeUndefined();
    }
  });

  it("refuses a size of zero and a negative one", () => {
    for (const size of ["0", "0Gi", "-10Gi"]) {
      const [messages] = dataDiskErrors(
        inputs(),
        withDisks([diskRow({ source: "blank", image: "", blankSize: size })]),
      );

      expect(messages.blankSize).toBeDefined();
    }
  });

  it("refuses a storage class that is not an object name", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "blank", image: "", blankSize: "10Gi", blankStorageClass: "Fast_SSD" })]),
    );

    expect(messages.blankStorageClass).toContain("lowercase letters, digits, '-' and '.'");
  });

  it("refuses attachAsDisk on an image row, saying what an image disk already is", () => {
    const [messages] = dataDiskErrors(inputs(), withDisks([diskRow({ attachAsDisk: true })]));

    // The whole clause, articles included: the same sentence built from the
    // source's own label read "an a SwiftImage disk" before the screenshots.
    expect(messages.attachAsDisk).toContain(
      "attachAsDisk only applies to a PVC: an image-backed disk is attached as a raw VM disk anyway.",
    );
  });

  it("refuses attachAsDisk on a blank row for the same reason", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "blank", image: "", blankSize: "10Gi", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toContain(
      "attachAsDisk only applies to a PVC: a blank disk is attached as a raw VM disk anyway.",
    );
  });

  it("accepts attachAsDisk on a Block claim", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-block", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toBeUndefined();
  });

  it("refuses attachAsDisk on a Filesystem claim, with the reason and the two ways out", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-fs", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toContain("data-fs is Filesystem");
    expect(messages.attachAsDisk).toContain("needs a Block claim");
    expect(messages.attachAsDisk).toContain("Leave it off");
  });

  it("does not refuse attachAsDisk on a claim whose volume mode is unreadable", () => {
    const [messages] = dataDiskErrors(
      inputs({ pvcs: [], pvcsUnverified: true }),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-block", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toBeUndefined();
  });

  it("does not refuse attachAsDisk on a claim that declares no volume mode", () => {
    const [messages] = dataDiskErrors(
      inputs(),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-silent", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toBeUndefined();
  });

  it("reports each row against its own rules, not against the first row's", () => {
    const errors = dataDiskErrors(
      inputs(),
      withDisks([
        diskRow({ id: "disk-1", name: "good" }),
        diskRow({ id: "disk-2", name: "", image: "" }),
        diskRow({ id: "disk-3", name: "third", source: "blank", image: "", blankSize: "20Gi" }),
      ]),
    );

    expect(errors[0]).toEqual({});
    expect(Object.keys(errors[1]).sort()).toEqual(["image", "name"]);
    expect(errors[2]).toEqual({});
  });

  it("says nothing at all when the section is untouched", () => {
    expect(dataDiskErrors(inputs(), values())).toEqual([]);
  });
});

describe("dataDiskWarnings", () => {
  it("says nothing about a Ready image", () => {
    expect(dataDiskWarnings(inputs(), withDisks([diskRow()]))[0]).toEqual({});
  });

  it("warns that a data disk cloned from a not-Ready image waits, like the boot one", () => {
    const [messages] = dataDiskWarnings(inputs(), withDisks([diskRow({ image: "ubuntu-2604" })]));

    expect(messages.image).toContain("is Importing, not Ready");
    expect(messages.image).toContain("Ready image only");
  });

  it("warns about an image that is not in the namespace", () => {
    expect(dataDiskWarnings(inputs(), withDisks([diskRow({ image: "gone" })]))[0].image).toContain(
      "No SwiftImage named gone",
    );
  });

  it("distinguishes an unlistable image read from a missing image", () => {
    const [messages] = dataDiskWarnings(
      inputs({ images: [], imagesUnverified: true }),
      withDisks([diskRow({ image: "ubuntu-2404" })]),
    );

    expect(messages.image).toContain("could not be listed");
  });

  it("warns about a claim that is not in the namespace", () => {
    const [messages] = dataDiskWarnings(inputs(), withDisks([diskRow({ source: "pvc", image: "", pvc: "gone" })]));

    expect(messages.pvc).toContain("No PersistentVolumeClaim named gone");
    expect(messages.pvc).toContain("attaches an existing claim rather than creating one");
  });

  it("says the Block rule is uncheckable when the claims could not be listed", () => {
    const [messages] = dataDiskWarnings(
      inputs({ pvcs: [], pvcsUnverified: true }),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-block", attachAsDisk: true })]),
    );

    expect(messages.pvc).toContain("could not be listed");
    expect(messages.pvc).toContain("Block claim");
  });

  it("warns rather than blocks on a claim that declares no volume mode", () => {
    const [messages] = dataDiskWarnings(
      inputs(),
      withDisks([diskRow({ source: "pvc", image: "", pvc: "data-silent", attachAsDisk: true })]),
    );

    expect(messages.attachAsDisk).toContain("declares no volumeMode");
    expect(messages.attachAsDisk).toContain("warns rather than blocks");
  });

  it("says nothing about a claim that is not attached as a disk and exists", () => {
    expect(dataDiskWarnings(inputs(), withDisks([diskRow({ source: "pvc", image: "", pvc: "data-fs" })]))[0]).toEqual(
      {},
    );
  });
});

describe("dataDiskSummaryNote", () => {
  it("says an image disk becomes a PVC of this guest", () => {
    expect(dataDiskSummaryNote(inputs(), diskRow({ name: "extra" }))).toContain(
      "Data disk extra: the image ubuntu-2404 is cloned into a PVC of this guest",
    );
  });

  it("says an attached Block claim is handed to the guest as a device", () => {
    const note = dataDiskSummaryNote(
      inputs(),
      diskRow({ name: "vol", source: "pvc", image: "", pvc: "data-block", attachAsDisk: true }),
    );

    expect(note).toContain("the existing claim data-block (Block) is attached to the guest as a raw VM block disk");
  });

  it("says an unattached claim is mounted in the launcher pod and the guest never sees it", () => {
    const note = dataDiskSummaryNote(inputs(), diskRow({ name: "vol", source: "pvc", image: "", pvc: "data-fs" }));

    expect(note).toContain("mounted as a filesystem directory in the launcher pod");
    expect(note).toContain("Tick attachAsDisk");
  });

  it("names the storage class of a blank disk when there is one", () => {
    const note = dataDiskSummaryNote(
      inputs(),
      diskRow({ name: "db", source: "blank", image: "", blankSize: "100Gi", blankStorageClass: "fast" }),
    );

    expect(note).toContain("a blank 100Gi Block PVC of this guest is created on the storage class fast");
    expect(note).toContain("arrives unformatted");
  });

  it("names the cluster default when a blank disk sets no class", () => {
    expect(
      dataDiskSummaryNote(inputs(), diskRow({ name: "db", source: "blank", image: "", blankSize: "100Gi" })),
    ).toContain("the cluster's default storage class");
  });

  it("states the volume mode the API server would stamp, and the one that was chosen", () => {
    const stamped = dataDiskSummaryNote(
      inputs(),
      diskRow({ name: "db", source: "blank", image: "", blankSize: "1Gi" }),
    );
    const chosen = dataDiskSummaryNote(
      inputs(),
      diskRow({ name: "db", source: "blank", image: "", blankSize: "1Gi", blankVolumeMode: "Filesystem" }),
    );

    expect(stamped).toContain("blank 1Gi Block PVC");
    expect(chosen).toContain("blank 1Gi Filesystem PVC");
  });

  it("says nothing about a row that is not finished", () => {
    expect(dataDiskSummaryNote(inputs(), diskRow({ name: "" }))).toBeUndefined();
    expect(dataDiskSummaryNote(inputs(), diskRow({ image: "" }))).toBeUndefined();
    expect(dataDiskSummaryNote(inputs(), diskRow({ source: "blank", image: "" }))).toBeUndefined();
  });
});

describe("dataDisksSectionHint", () => {
  it("says what a data disk is while there is none, and what the cap is", () => {
    const hint = dataDisksSectionHint(values());

    expect(hint).toContain("None.");
    expect(hint).toContain("At most 8");
  });

  it("counts the disks and states the ownership consequence once there are some", () => {
    const hint = dataDisksSectionHint(withDisks([diskRow()]));

    expect(hint).toContain("1 disk");
    expect(hint).toContain("deleted with it");
    expect(hint).toContain("an attached PVC is not");
  });

  it("pluralizes the count", () => {
    expect(dataDisksSectionHint(withDisks([diskRow({ id: "disk-1" }), diskRow({ id: "disk-2" })]))).toContain(
      "2 disks",
    );
  });
});

describe("portErrors", () => {
  it("says nothing about one complete port", () => {
    expect(portErrors(withPorts([portRow()]))[0]).toEqual({});
  });

  it("requires a port number", () => {
    expect(portErrors(withPorts([portRow({ port: "" })]))[0].port).toContain("A port is required");
  });

  it("refuses a port that is not a whole number", () => {
    expect(portErrors(withPorts([portRow({ port: "80.5" })]))[0].port).toContain("whole number");
  });

  it("refuses a port outside the schema's own bounds, with the number", () => {
    expect(portErrors(withPorts([portRow({ port: "0" })]))[0].port).toContain("between 1 and 65535");
    expect(portErrors(withPorts([portRow({ port: "65536" })]))[0].port).toContain("this one is 65536");
  });

  it("accepts the bounds themselves", () => {
    expect(portErrors(withPorts([portRow({ port: String(minPortNumber) })]))[0].port).toBeUndefined();
    expect(portErrors(withPorts([portRow({ port: String(maxPortNumber) })]))[0].port).toBeUndefined();
  });

  it("does not require a name on a single port", () => {
    expect(portErrors(withPorts([portRow()]))[0].name).toBeUndefined();
  });

  it("requires a name on every port as soon as there are two, with the reason", () => {
    const errors = portErrors(withPorts([portRow({ id: "port-1" }), portRow({ id: "port-2", port: "8443" })]));

    expect(errors[0].name).toContain("more than one port");
    expect(errors[0].name).toContain("Service");
    expect(errors[1].name).toBeDefined();
  });

  it("stops requiring names when the second port is removed", () => {
    const two = withPorts([portRow({ id: "port-1" }), portRow({ id: "port-2", port: "8443" })]);

    expect(portErrors(removePort(two, "port-2"))[0].name).toBeUndefined();
  });

  it("refuses a port name that is not a DNS label", () => {
    expect(portErrors(withPorts([portRow({ name: "HTTP_1" })]))[0].name).toContain("lowercase letters");
  });

  it("refuses two ports with one name", () => {
    const errors = portErrors(
      withPorts([portRow({ id: "port-1", name: "http" }), portRow({ id: "port-2", port: "8443", name: "http" })]),
    );

    expect(errors[0].name).toContain("Two ports are named http");
    expect(errors[1].name).toContain("Two ports are named http");
  });

  it("refuses the same port and protocol twice, on the later row", () => {
    const errors = portErrors(withPorts([portRow({ id: "port-1", name: "a" }), portRow({ id: "port-2", name: "b" })]));

    expect(errors[0].port).toBeUndefined();
    expect(errors[1].port).toContain("Port 8080/TCP is declared twice");
  });

  it("allows the same port number on two protocols", () => {
    const errors = portErrors(
      withPorts([portRow({ id: "port-1", name: "a" }), portRow({ id: "port-2", name: "b", protocol: "UDP" })]),
    );

    expect(errors[0].port).toBeUndefined();
    expect(errors[1].port).toBeUndefined();
  });

  it("refuses a target port outside the bounds and accepts an empty one", () => {
    expect(portErrors(withPorts([portRow({ targetPort: "70000" })]))[0].targetPort).toContain("between 1 and 65535");
    expect(portErrors(withPorts([portRow({ targetPort: "" })]))[0].targetPort).toBeUndefined();
  });

  it("accepts one expose value across every port", () => {
    const errors = portErrors(
      withPorts([
        portRow({ id: "port-1", name: "a", expose: "NodePort" }),
        portRow({ id: "port-2", name: "b", port: "8443", expose: "NodePort" }),
      ]),
    );

    expect(errors[0].expose).toBeUndefined();
    expect(errors[1].expose).toBeUndefined();
  });

  it("refuses a mixed expose, naming both types and the silent consequence", () => {
    const errors = portErrors(
      withPorts([
        portRow({ id: "port-1", name: "a", expose: "NodePort" }),
        portRow({ id: "port-2", name: "b", port: "8443", expose: "ClusterIP" }),
      ]),
    );

    expect(errors[0].expose).toBeUndefined();
    expect(errors[1].expose).toContain("this port asks for ClusterIP while another asks for NodePort");
    expect(errors[1].expose).toContain("silently mints a Service");
  });

  it("does not call a port without an expose a mix", () => {
    const errors = portErrors(
      withPorts([
        portRow({ id: "port-1", name: "a", expose: "NodePort" }),
        portRow({ id: "port-2", name: "b", port: "8443" }),
      ]),
    );

    expect(errors[1].expose).toBeUndefined();
  });

  it("refuses expose under a bridge binding, with both halves of upstream's rule", () => {
    const [messages] = portErrors(withPorts([portRow({ expose: "NodePort" })], { networkBinding: "bridge" }));

    expect(messages.expose).toContain("bridge-bound guest exposes nothing");
    expect(messages.expose).toContain("mints no Service and reports no error");
    expect(messages.expose).toContain("sriov");
  });

  it("allows a port without expose under a bridge binding", () => {
    expect(portErrors(withPorts([portRow()], { networkBinding: "bridge" }))[0].expose).toBeUndefined();
  });

  it("says nothing at all when the section is untouched", () => {
    expect(portErrors(values())).toEqual([]);
  });
});

describe("portWarnings", () => {
  it("says nothing about a short, lettered port name", () => {
    expect(portWarnings(withPorts([portRow({ name: "http" })]))[0]).toEqual({});
  });

  it("warns about a name Kubernetes would refuse on the Service, without blocking", () => {
    const [messages] = portWarnings(withPorts([portRow({ name: "a-very-long-port-name" })]));

    expect(messages.name).toContain("caps a Service port name at 15");
    expect(portErrors(withPorts([portRow({ name: "a-very-long-port-name" })]))[0].name).toBeUndefined();
    expect(maxServicePortNameLength).toBe(15);
  });

  it("warns about an all-digit name for the same reason", () => {
    expect(portWarnings(withPorts([portRow({ name: "8080" })]))[0].name).toContain("at least one letter");
  });

  it("says which ports are left off the Service when only some are exposed", () => {
    const warnings = portWarnings(
      withPorts([
        portRow({ id: "port-1", name: "a", expose: "NodePort" }),
        portRow({ id: "port-2", name: "b", port: "8443" }),
      ]),
    );

    expect(warnings[0].expose).toBeUndefined();
    expect(warnings[1].expose).toContain("not on the Service");
    expect(warnings[1].expose).toContain("reminder, not a refusal");
  });

  it("says nothing when every port is exposed", () => {
    const warnings = portWarnings(
      withPorts([
        portRow({ id: "port-1", name: "a", expose: "NodePort" }),
        portRow({ id: "port-2", name: "b", port: "8443", expose: "NodePort" }),
      ]),
    );

    expect(warnings[1].expose).toBeUndefined();
  });
});

describe("declaredExposure", () => {
  it("is undefined when no port asks to be exposed", () => {
    expect(declaredExposure(withPorts([portRow()]))).toBeUndefined();
  });

  it("is the first type any port names", () => {
    expect(
      declaredExposure(
        withPorts([portRow({ id: "port-1" }), portRow({ id: "port-2", port: "8443", expose: "LoadBalancer" })]),
      ),
    ).toBe("LoadBalancer");
  });

  it("is undefined on an untouched form", () => {
    expect(declaredExposure(values())).toBeUndefined();
  });
});

describe("networkBindingDescription", () => {
  it("says what nat does, including that it is the only binding a Service is possible under", () => {
    const nat = networkBindingDescription("nat");

    expect(nat).toContain("behind the pod IP");
    expect(nat).toContain("only binding under which a port can ask for a Service");
  });

  it("says what bridge does, including the two things it turns off", () => {
    const bridge = networkBindingDescription("bridge");

    expect(bridge).toContain("portable IP");
    expect(bridge).toContain("refuses expose");
    expect(bridge).toContain("no per-guest Service");
  });

  it("offers exactly the two bindings the schema declares", () => {
    expect(guestNetworkBindings).toEqual(["nat", "bridge"]);
  });
});

describe("networkSectionHint", () => {
  it("names the binding and says no Service is created while no port asks", () => {
    const hint = networkSectionHint(values());

    expect(hint).toContain("nat binding");
    expect(hint).toContain("No Service is created until a port asks");
  });

  it("counts the ports and the interfaces", () => {
    const hint = networkSectionHint(
      values({ ports: [portRow({ id: "port-1" }), portRow({ id: "port-2" })], interfaces: [nicRow()] }),
    );

    expect(hint).toContain("2 ports");
    expect(hint).toContain("1 additional interface");
  });

  it("names the Service type once a port asks for one", () => {
    expect(networkSectionHint(withPorts([portRow({ expose: "NodePort" })]))).toContain(
      "A per-guest Service of type NodePort is created",
    );
  });

  it("says no Service under a bridge binding, whatever the ports say", () => {
    expect(networkSectionHint(withPorts([portRow({ expose: "NodePort" })], { networkBinding: "bridge" }))).toContain(
      "No per-guest Service is created under a bridge binding",
    );
  });
});

describe("interfaceErrors", () => {
  it("says nothing about a named interface", () => {
    expect(interfaceErrors(withNics([nicRow()]))[0]).toEqual({});
  });

  it("requires a name", () => {
    expect(interfaceErrors(withNics([nicRow({ name: "" })]))[0].name).toContain("needs a name");
  });

  it("refuses a name that is not a DNS label", () => {
    expect(interfaceErrors(withNics([nicRow({ name: "Net_1" })]))[0].name).toContain("lowercase letters");
  });

  it("refuses two interfaces with one name", () => {
    const errors = interfaceErrors(withNics([nicRow({ id: "nic-1" }), nicRow({ id: "nic-2" })]));

    expect(errors[0].name).toContain("Two interfaces are named net1");
    expect(errors[1].name).toContain("Two interfaces are named net1");
  });

  it("accepts one primary interface", () => {
    expect(interfaceErrors(withNics([nicRow({ primary: true })]))[0].primary).toBeUndefined();
  });

  it("refuses two primaries, on both, with the count and the default behaviour", () => {
    const errors = interfaceErrors(
      withNics([nicRow({ id: "nic-1", primary: true }), nicRow({ id: "nic-2", name: "net2", primary: true })]),
    );

    expect(errors[0].primary).toContain("At most one interface may be the primary, and 2 are marked");
    expect(errors[0].primary).toContain("first interface without a network reference");
    expect(errors[1].primary).toBeDefined();
  });

  it("accepts a canonical MAC address in either case", () => {
    expect(interfaceErrors(withNics([nicRow({ mac: "52:54:00:12:34:56" })]))[0].mac).toBeUndefined();
    expect(interfaceErrors(withNics([nicRow({ mac: "52:54:00:AB:CD:EF" })]))[0].mac).toBeUndefined();
  });

  it("refuses a MAC that is not the schema's pattern, and says why the pattern exists", () => {
    const [messages] = interfaceErrors(withNics([nicRow({ mac: "52-54-00-12-34-56" })]));

    expect(messages.mac).toContain("six colon-separated hex pairs");
    expect(messages.mac).toContain("security boundary");
  });

  it("refuses a short MAC and one with a bad character", () => {
    expect(interfaceErrors(withNics([nicRow({ mac: "52:54:00:12:34" })]))[0].mac).toBeDefined();
    expect(interfaceErrors(withNics([nicRow({ mac: "52:54:00:12:34:zz" })]))[0].mac).toBeDefined();
  });

  it("accepts an empty MAC, which is the generated one", () => {
    expect(interfaceErrors(withNics([nicRow({ mac: "" })]))[0].mac).toBeUndefined();
  });

  it("refuses a network namespace with no network name", () => {
    const [messages] = interfaceErrors(withNics([nicRow({ networkNamespace: "networks" })]));

    expect(messages.networkNamespace).toContain("points at nothing");
  });

  it("refuses a network name that is not an object name", () => {
    expect(interfaceErrors(withNics([nicRow({ networkName: "Bad Name" })]))[0].networkName).toContain(
      "lowercase letters",
    );
  });

  it("accepts a network reference with a namespace", () => {
    expect(interfaceErrors(withNics([nicRow({ networkName: "macvlan", networkNamespace: "networks" })]))[0]).toEqual(
      {},
    );
  });

  it("says nothing at all when the section is untouched", () => {
    expect(interfaceErrors(values())).toEqual([]);
  });
});

describe("interfaceWarnings", () => {
  it("says nothing about a node-local primary", () => {
    expect(interfaceWarnings(withNics([nicRow({ primary: true })]))[0]).toEqual({});
  });

  it("says what marking a network-backed interface primary attests to", () => {
    const [messages] = interfaceWarnings(withNics([nicRow({ primary: true, networkName: "macvlan" })]));

    expect(messages.primary).toContain("attestation");
    expect(messages.primary).toContain("IP-preserving");
  });

  it("says nothing about a network-backed interface that is not primary", () => {
    expect(interfaceWarnings(withNics([nicRow({ networkName: "macvlan" })]))[0]).toEqual({});
  });
});

describe("interfaceTypesFact", () => {
  it("names the type this form builds and routes the other two to the YAML editor", () => {
    expect(interfaceTypesFact).toContain("bridge");
    expect(interfaceTypesFact).toContain("sriov");
    expect(interfaceTypesFact).toContain("vhost-user");
    expect(interfaceTypesFact).toContain("YAML editor");
  });

  it("says which interface the binding and the ports apply to", () => {
    expect(primaryInterfaceFact).toContain("PRIMARY interface");
    expect(primaryInterfaceFact).toContain("secondary");
  });
});

describe("gpuErrors", () => {
  it("says nothing when the guest asks for no GPU", () => {
    expect(gpuErrors(inputs(), values())).toEqual({});
  });

  it("requires a profile on the native backend", () => {
    expect(gpuErrors(inputs(), values({ gpuBackend: "profile" })).profile).toContain("Name the SwiftGPUProfile");
  });

  it("says nothing about a named profile", () => {
    expect(gpuErrors(inputs(), gpuProfileValues())).toEqual({});
  });

  it("requires one of the two DRA references", () => {
    const messages = gpuErrors(inputs(), values({ gpuBackend: "claim" }));

    expect(messages.claimName).toContain("Name a ResourceClaim to share, or a ResourceClaimTemplate");
  });

  it("refuses both DRA references at once, on both fields", () => {
    const messages = gpuErrors(inputs(), gpuClaimValues({ gpuClaimTemplateName: "gpu-template" }));

    expect(messages.claimName).toContain("never both");
    expect(messages.claimTemplateName).toBe(messages.claimName);
  });

  it("accepts a claim alone and a template alone", () => {
    expect(gpuErrors(inputs(), gpuClaimValues())).toEqual({});
    expect(gpuErrors(inputs(), values({ gpuBackend: "claim", gpuClaimTemplateName: "gpu-template" }))).toEqual({});
  });

  it("refuses a hugepage size that is not a quantity, and accepts the two upstream names", () => {
    expect(gpuErrors(inputs(), gpuClaimValues({ gpuHugepages: "huge" })).hugepages).toContain("is a size");
    expect(gpuErrors(inputs(), gpuClaimValues({ gpuHugepages: "1Gi" })).hugepages).toBeUndefined();
    expect(gpuErrors(inputs(), gpuClaimValues({ gpuHugepages: "2Mi" })).hugepages).toBeUndefined();
  });

  it("refuses a request name that is not a DNS label", () => {
    expect(gpuErrors(inputs(), gpuClaimValues({ gpuRequestName: "GPU_0" })).requestName).toContain("lowercase letters");
  });

  it("says nothing at all when the guard refuses the section, on every excluded case", () => {
    expect(gpuErrors(inputs(), kernelValues({ gpuBackend: "profile" }))).toEqual({});
    expect(gpuErrors(inputs(), cloneValues({ gpuBackend: "claim" }))).toEqual({});
    expect(gpuErrors(inputs(), values({ image: "windows-2022", gpuBackend: "profile" }))).toEqual({});
  });
});

describe("gpuWarnings", () => {
  it("says nothing about a profile that is in the namespace", () => {
    expect(gpuWarnings(inputs(), gpuProfileValues())).toEqual({});
  });

  it("warns about a profile that is not, and says the guest parks rather than fails", () => {
    const messages = gpuWarnings(inputs(), gpuProfileValues({ gpuProfile: "gone" }));

    expect(messages.profile).toContain("No SwiftGPUProfile named gone");
    expect(messages.profile).toContain("parks in Pending on GPUAllocated");
  });

  it("distinguishes an unlistable read from a missing profile", () => {
    const messages = gpuWarnings(
      inputs({ gpuProfiles: [], gpuProfilesUnverified: true }),
      gpuProfileValues({ gpuProfile: "gpu-pcie" }),
    );

    expect(messages.profile).toContain("could not be listed");
  });

  it("says nothing on the DRA backend, whose references this form cannot read", () => {
    expect(gpuWarnings(inputs(), gpuClaimValues({ gpuClaimName: "gone" }))).toEqual({});
  });
});

describe("gpuProfileChoices", () => {
  it("offers every profile of the namespace, with the request it carries", () => {
    const choices = gpuProfileChoices(inputs());

    expect(choices.map((choice) => choice.name)).toEqual(["gpu-pcie", "gpu-hgx"]);
    expect(choices[0].label).toBe("gpu-pcie - 1 GPU, L40S, pcie");
  });

  it("reads the empty model as 'any model', the way the M3 list does", () => {
    expect(gpuProfileChoices(inputs())[1].label).toBe("gpu-hgx - 4 GPUs, any model, hgx-shared");
  });

  it("falls back to the bare name when a profile carries no request at all", () => {
    expect(gpuProfileChoices(inputs({ gpuProfiles: [{ name: "bare" }] }))[0].label).toBe("bare");
  });

  it("dims and disables nothing: a SwiftGPUProfile has no status to be not-Ready in", () => {
    expect(gpuProfileChoices(inputs())).toHaveLength(inputs().gpuProfiles.length);
  });

  it("summarizes the count in the singular and the plural", () => {
    expect(gpuProfileSummary({ name: "one", count: 1 })).toBe("1 GPU");
    expect(gpuProfileSummary({ name: "two", count: 2 })).toBe("2 GPUs");
  });

  it("finds the picked profile, and nothing when the name is not in the list", () => {
    expect(pickedGpuProfile(inputs(), gpuProfileValues())?.count).toBe(1);
    expect(pickedGpuProfile(inputs(), gpuProfileValues({ gpuProfile: "gone" }))).toBeUndefined();
    expect(pickedGpuProfile(inputs(), values())).toBeUndefined();
  });
});

describe("setGpuBackend", () => {
  it("empties the native reference when the form moves to DRA", () => {
    const claim = setGpuBackend(gpuProfileValues(), "claim");

    expect(claim.gpuBackend).toBe("claim");
    expect(claim.gpuProfile).toBe("");
  });

  it("empties every DRA field when the form moves to the native backend", () => {
    const profile = setGpuBackend(
      gpuClaimValues({ gpuRequestName: "gpu0", gpuTier: "hgx-full", gpuHugepages: "1Gi" }),
      "profile",
    );

    expect(profile.gpuClaimName).toBe("");
    expect(profile.gpuRequestName).toBe("");
    expect(profile.gpuTier).toBe(defaultGpuTier);
    expect(profile.gpuHugepages).toBe("");
  });

  it("empties both when the form asks for no GPU", () => {
    const none = setGpuBackend(gpuProfileValues(), "none");

    expect(none.gpuProfile).toBe("");
    expect(none.gpuClaimName).toBe("");
  });

  it("makes the two backends mutually exclusive by construction", () => {
    for (const backend of guestGpuBackends) {
      const form = setGpuBackend(
        values({ gpuProfile: "gpu-pcie", gpuClaimName: "shared", gpuClaimTemplateName: "template" }),
        backend,
      );
      const { spec } = guestCreatePayload(inputs(), form);

      expect(spec.gpuProfileRef !== undefined && spec.gpuResourceClaim !== undefined).toBe(false);
    }
  });
});

describe("switchBootSource, the GPU", () => {
  it("keeps the GPU on image boot", () => {
    expect(gpuAppliesToBootSource("image")).toBe(true);
    expect(switchBootSource(gpuProfileValues(), "image").gpuProfile).toBe("gpu-pcie");
  });

  it("clears it on the two sources that exclude it outright", () => {
    for (const source of ["kernel", "clone"] as GuestBootSource[]) {
      const switched = switchBootSource(gpuClaimValues({ gpuTier: "hgx-full", gpuHugepages: "1Gi" }), source);

      expect(gpuAppliesToBootSource(source)).toBe(false);
      expect(switched.gpuBackend).toBe("none");
      expect(switched.gpuClaimName).toBe("");
      expect(switched.gpuTier).toBe(defaultGpuTier);
      expect(switched.gpuHugepages).toBe("");
    }
  });

  it("keeps the data disks, the ports and the interfaces on every source", () => {
    for (const source of implementedBootSources) {
      const switched = switchBootSource(
        values({ dataDisks: [diskRow()], ports: [portRow()], interfaces: [nicRow()] }),
        source,
      );

      expect(switched.dataDisks).toHaveLength(1);
      expect(switched.ports).toHaveLength(1);
      expect(switched.interfaces).toHaveLength(1);
    }
  });

  it("does not clear the GPU when a Windows image excludes it, because the image can change back", () => {
    const windows = { ...gpuProfileValues(), image: "windows-2022" };

    expect(guestGpuGuard(inputs(), windows).enabled).toBe(false);
    expect(windows.gpuProfile).toBe("gpu-pcie");
    expect(guestCreatePayload(inputs(), windows).spec.gpuProfileRef).toBeUndefined();
  });
});

describe("gpuSectionHint", () => {
  it("says what a GPU costs while none is asked for", () => {
    const hint = gpuSectionHint(inputs(), values());

    expect(hint).toContain("None.");
    expect(hint).toContain("waits in Pending");
  });

  it("names the backend and repeats the parking expectation once one is chosen", () => {
    expect(gpuSectionHint(inputs(), gpuProfileValues())).toContain("SwiftGPUProfile (native allocation)");
    expect(gpuSectionHint(inputs(), gpuClaimValues())).toContain("Resource claim (DRA)");
    expect(gpuSectionHint(inputs(), gpuClaimValues())).toContain("GPUAllocated");
  });

  it("is the guard's own reason wherever the section is refused", () => {
    for (const form of [kernelValues(), cloneValues(), values({ image: "windows-2022" })]) {
      const guard = guestGpuGuard(inputs(), form);

      expect(guard.enabled).toBe(false);
      expect(gpuSectionHint(inputs(), form)).toBe(guard.reason);
    }
  });

  it("describes each backend in one line", () => {
    expect(guestGpuBackendDescription("profile")).toContain("before the launcher pod is created");
    expect(guestGpuBackendDescription("claim")).toContain("ResourceClaim");
    expect(guestGpuBackendDescription("none")).toContain("almost every guest");
  });
});

describe("guestDataDiskPayload", () => {
  it("sends nothing when the section is untouched", () => {
    expect(guestDataDiskPayload(values())).toBeUndefined();
  });

  it("sends an image disk as a name and a reference, and nothing else", () => {
    expect(guestDataDiskPayload(withDisks([diskRow({ name: "extra" })]))).toEqual([
      { name: "extra", imageRef: { name: "ubuntu-2404" } },
    ]);
  });

  it("sends a PVC disk without attachAsDisk when it is off, because false is the default", () => {
    expect(
      guestDataDiskPayload(withDisks([diskRow({ name: "vol", source: "pvc", image: "", pvc: "data-fs" })])),
    ).toEqual([{ name: "vol", pvcRef: { name: "data-fs" } }]);
  });

  it("sends attachAsDisk when it is on", () => {
    expect(
      guestDataDiskPayload(
        withDisks([diskRow({ name: "vol", source: "pvc", image: "", pvc: "data-block", attachAsDisk: true })]),
      ),
    ).toEqual([{ name: "vol", pvcRef: { name: "data-block" }, attachAsDisk: true }]);
  });

  it("sends a blank disk with only the fields that were set", () => {
    expect(
      guestDataDiskPayload(withDisks([diskRow({ name: "db", source: "blank", image: "", blankSize: "100Gi" })])),
    ).toEqual([{ name: "db", blank: { size: "100Gi" } }]);
  });

  it("never re-sends the Block volume mode the API server stamps", () => {
    const disks =
      guestDataDiskPayload(
        withDisks([diskRow({ name: "db", source: "blank", image: "", blankSize: "1Gi", blankVolumeMode: "Block" })]),
      ) ?? [];

    expect(disks[0].blank?.volumeMode).toBeUndefined();
    expect(defaultBlankVolumeMode).toBe("Block");
  });

  it("sends the Filesystem volume mode, which is not the default", () => {
    const disks =
      guestDataDiskPayload(
        withDisks([
          diskRow({
            name: "db",
            source: "blank",
            image: "",
            blankSize: "1Gi",
            blankStorageClass: "fast",
            blankVolumeMode: "Filesystem",
          }),
        ]),
      ) ?? [];

    expect(disks[0].blank?.volumeMode).toBe("Filesystem");
    expect(disks[0].blank?.storageClassName).toBe("fast");
  });

  it("sends only the source the row is on, whatever the other fields still hold", () => {
    const disks =
      guestDataDiskPayload(
        withDisks([diskRow({ name: "one", source: "pvc", image: "ubuntu-2404", pvc: "data-block", blankSize: "1Gi" })]),
      ) ?? [];

    expect(Object.keys(disks[0]).sort()).toEqual(["name", "pvcRef"]);
  });

  it("drops a row with no name and a row with no source, rather than emitting an empty reference (G7)", () => {
    expect(guestDataDiskPayload(withDisks([diskRow({ name: "" })]))).toBeUndefined();
    expect(guestDataDiskPayload(withDisks([diskRow({ image: "" })]))).toBeUndefined();
    expect(guestDataDiskPayload(withDisks([diskRow({ source: "pvc", image: "", pvc: "" })]))).toBeUndefined();
    expect(guestDataDiskPayload(withDisks([diskRow({ source: "blank", image: "" })]))).toBeUndefined();
  });

  it("sends the rows in the order they are on the form", () => {
    const disks = guestDataDiskPayload(
      withDisks([
        diskRow({ id: "disk-1", name: "one" }),
        diskRow({ id: "disk-2", name: "two", source: "blank", image: "", blankSize: "5Gi" }),
      ]),
    );

    expect(disks?.map((disk) => disk.name)).toEqual(["one", "two"]);
  });

  it("trims what it sends", () => {
    expect(guestDataDiskPayload(withDisks([diskRow({ name: " extra ", image: " ubuntu-2404 " })]))).toEqual([
      { name: "extra", imageRef: { name: "ubuntu-2404" } },
    ]);
  });
});

describe("guestNetworkPayload", () => {
  it("sends nothing at all when nothing in the section was touched", () => {
    expect(guestNetworkPayload(values())).toBeUndefined();
  });

  it("never re-sends the nat binding the API server stamps", () => {
    expect(guestNetworkPayload(values({ networkBinding: "nat" }))).toBeUndefined();
  });

  it("sends the bridge binding, which is not the default", () => {
    expect(guestNetworkPayload(values({ networkBinding: "bridge" }))).toEqual({ binding: "bridge" });
  });

  it("sends a port as a number, not as the string the input held", () => {
    expect(guestNetworkPayload(withPorts([portRow({ port: "8080" })]))).toEqual({ ports: [{ port: 8080 }] });
  });

  it("never re-sends the TCP protocol the API server stamps", () => {
    const network = guestNetworkPayload(withPorts([portRow({ protocol: "TCP" })]));

    expect(network?.ports?.[0].protocol).toBeUndefined();
    expect(defaultPortProtocol).toBe("TCP");
  });

  it("sends UDP and SCTP, which are not the default", () => {
    expect(guestNetworkPayload(withPorts([portRow({ protocol: "UDP" })]))?.ports?.[0].protocol).toBe("UDP");
    expect(guestNetworkPayload(withPorts([portRow({ protocol: "SCTP" })]))?.ports?.[0].protocol).toBe("SCTP");
  });

  it("sends the name, the target port and the expose when they are set", () => {
    expect(guestNetworkPayload(withPorts([portRow({ name: "http", targetPort: "80", expose: "NodePort" })]))).toEqual({
      ports: [{ port: 8080, name: "http", targetPort: 80, expose: "NodePort" }],
    });
  });

  it("omits an empty target port, which upstream reads as the port itself", () => {
    expect(guestNetworkPayload(withPorts([portRow({ targetPort: "" })]))?.ports?.[0].targetPort).toBeUndefined();
  });

  it("drops a port with no number rather than sending a NaN", () => {
    expect(guestNetworkPayload(withPorts([portRow({ port: "" })]))).toBeUndefined();
  });

  it("sends the binding and the ports together", () => {
    expect(guestNetworkPayload(withPorts([portRow({ name: "http" })], { networkBinding: "bridge" }))).toEqual({
      binding: "bridge",
      ports: [{ port: 8080, name: "http" }],
    });
  });

  it("sends neither serviceAnnotations nor loadBalancerClass: they are YAML territory", () => {
    const network = guestNetworkPayload(withPorts([portRow({ expose: "LoadBalancer" })]));

    expect(Object.keys(network ?? {})).toEqual(["ports"]);
  });
});

describe("guestInterfacesPayload", () => {
  it("sends nothing when none was added", () => {
    expect(guestInterfacesPayload(values())).toBeUndefined();
  });

  it("sends a bare interface as a name alone: bridge is the type the API server stamps", () => {
    expect(guestInterfacesPayload(withNics([nicRow()]))).toEqual([{ name: "net1" }]);
    expect(defaultInterfaceType).toBe("bridge");
  });

  it("sends a network reference without a namespace when none was given", () => {
    expect(guestInterfacesPayload(withNics([nicRow({ networkName: "macvlan" })]))).toEqual([
      { name: "net1", networkRef: { name: "macvlan" } },
    ]);
  });

  it("sends the namespace when one was given", () => {
    expect(
      guestInterfacesPayload(withNics([nicRow({ networkName: "macvlan", networkNamespace: "networks" })])),
    ).toEqual([{ name: "net1", networkRef: { name: "macvlan", namespace: "networks" } }]);
  });

  it("sends primary only when it is true", () => {
    expect(guestInterfacesPayload(withNics([nicRow({ primary: true })]))).toEqual([{ name: "net1", primary: true }]);
    expect(guestInterfacesPayload(withNics([nicRow({ primary: false })]))?.[0].primary).toBeUndefined();
  });

  it("sends the MAC when one was pinned", () => {
    expect(guestInterfacesPayload(withNics([nicRow({ mac: "52:54:00:12:34:56" })]))?.[0].mac).toBe("52:54:00:12:34:56");
  });

  it("drops a nameless row rather than emitting one the schema requires a name on", () => {
    expect(guestInterfacesPayload(withNics([nicRow({ name: "" })]))).toBeUndefined();
  });
});

describe("guestGpuPayload", () => {
  it("sends nothing when the guest asks for no GPU", () => {
    expect(guestGpuPayload(inputs(), values())).toEqual({});
  });

  it("sends the native reference by name", () => {
    expect(guestGpuPayload(inputs(), gpuProfileValues())).toEqual({ gpuProfileRef: { name: "gpu-pcie" } });
  });

  it("never emits an empty-name profile reference (G7)", () => {
    expect(guestGpuPayload(inputs(), values({ gpuBackend: "profile" }))).toEqual({});
  });

  it("sends a shared claim alone", () => {
    expect(guestGpuPayload(inputs(), gpuClaimValues())).toEqual({
      gpuResourceClaim: { resourceClaimName: "shared-gpu" },
    });
  });

  it("sends a template alone", () => {
    expect(guestGpuPayload(inputs(), values({ gpuBackend: "claim", gpuClaimTemplateName: "gpu-template" }))).toEqual({
      gpuResourceClaim: { resourceClaimTemplateName: "gpu-template" },
    });
  });

  it("never re-sends the pcie tier the API server stamps", () => {
    const { gpuResourceClaim } = guestGpuPayload(inputs(), gpuClaimValues({ gpuTier: "pcie" }));

    expect(gpuResourceClaim?.tier).toBeUndefined();
  });

  it("sends the request name, the tier and the hugepages when they are set", () => {
    expect(
      guestGpuPayload(inputs(), gpuClaimValues({ gpuRequestName: "gpu0", gpuTier: "hgx-shared", gpuHugepages: "1Gi" })),
    ).toEqual({
      gpuResourceClaim: {
        resourceClaimName: "shared-gpu",
        requestName: "gpu0",
        tier: "hgx-shared",
        hugepages: "1Gi",
      },
    });
  });

  it("sends nothing on a DRA backend with neither reference", () => {
    expect(guestGpuPayload(inputs(), values({ gpuBackend: "claim", gpuRequestName: "gpu0" }))).toEqual({});
  });

  it("sends nothing wherever the guard refuses, whatever the section still holds", () => {
    expect(guestGpuPayload(inputs(), kernelValues({ gpuBackend: "profile", gpuProfile: "gpu-pcie" }))).toEqual({});
    expect(guestGpuPayload(inputs(), cloneValues({ gpuBackend: "claim", gpuClaimName: "shared" }))).toEqual({});
    expect(
      guestGpuPayload(inputs(), values({ image: "windows-2022", gpuBackend: "profile", gpuProfile: "gpu-pcie" })),
    ).toEqual({});
  });
});

describe("guestCreatePayload, the collapsed tail", () => {
  it("sends nothing of the three sections when they are untouched", () => {
    const { spec } = guestCreatePayload(inputs(), values());

    expect(spec.dataDiskRefs).toBeUndefined();
    expect(spec.network).toBeUndefined();
    expect(spec.interfaces).toBeUndefined();
    expect(spec.gpuProfileRef).toBeUndefined();
    expect(spec.gpuResourceClaim).toBeUndefined();
  });

  it("never emits the legacy singular dataDiskRef, whatever the disks say", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      withDisks([diskRow({ name: "extra" }), diskRow({ id: "disk-2", name: "second", image: "windows-2022" })]),
    );

    expect(spec.dataDiskRef).toBeUndefined();
    expect(spec.dataDiskRefs).toHaveLength(2);
  });

  it("carries the whole tail on one guest, with the exact key set", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      values({
        dataDisks: [
          diskRow({ name: "extra" }),
          diskRow({ id: "disk-2", name: "db", source: "blank", image: "", blankSize: "50Gi" }),
        ],
        ports: [
          portRow({ id: "port-1", name: "http", expose: "NodePort" }),
          portRow({ id: "port-2", port: "8443", name: "https", expose: "NodePort" }),
        ],
        interfaces: [nicRow({ networkName: "macvlan", primary: true })],
        gpuBackend: "profile",
        gpuProfile: "gpu-pcie",
      }),
    );

    expect(Object.keys(spec).sort()).toEqual([
      "dataDiskRefs",
      "gpuProfileRef",
      "guestClassRef",
      "imageRef",
      "interfaces",
      "network",
      "osType",
      "runPolicy",
    ]);
    expect(spec.network).toEqual({
      ports: [
        { port: 8080, name: "http", expose: "NodePort" },
        { port: 8443, name: "https", expose: "NodePort" },
      ],
    });
    expect(spec.interfaces).toEqual([{ name: "net1", networkRef: { name: "macvlan" }, primary: true }]);
    expect(spec.gpuProfileRef).toEqual({ name: "gpu-pcie" });
  });

  it("carries the tail on kernel boot too, minus the GPU", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      kernelValues({ dataDisks: [diskRow({ name: "extra" })], ports: [portRow()], interfaces: [nicRow()] }),
    );

    expect(Object.keys(spec).sort()).toEqual([
      "dataDiskRefs",
      "guestClassRef",
      "interfaces",
      "kernelRef",
      "network",
      "osType",
      "runPolicy",
    ]);
  });

  it("carries the tail on clone boot too, minus the GPU", () => {
    const { spec } = guestCreatePayload(inputs(), cloneValues({ dataDisks: [diskRow({ name: "extra" })] }));

    expect(spec.dataDiskRefs).toEqual([{ name: "extra", imageRef: { name: "ubuntu-2404" } }]);
    expect(spec.gpuProfileRef).toBeUndefined();
  });

  it("sends the DRA claim instead of the profile when that is the backend", () => {
    const { spec } = guestCreatePayload(inputs(), gpuClaimValues());

    expect(spec.gpuProfileRef).toBeUndefined();
    expect(spec.gpuResourceClaim).toEqual({ resourceClaimName: "shared-gpu" });
  });

  it("never emits a reference without a name anywhere in the tail (G7)", () => {
    const { spec } = guestCreatePayload(
      inputs(),
      values({
        dataDisks: [diskRow({ name: "one", image: "" }), diskRow({ id: "disk-2", name: "", image: "ubuntu-2404" })],
        interfaces: [nicRow({ name: "", networkName: "macvlan" })],
        gpuBackend: "profile",
        gpuProfile: "",
      }),
    );

    expect(spec.dataDiskRefs).toBeUndefined();
    expect(spec.interfaces).toBeUndefined();
    expect(spec.gpuProfileRef).toBeUndefined();
  });

  it("sends a guest whose only tail is one bridge-bound port", () => {
    const { spec } = guestCreatePayload(inputs(), withPorts([portRow()], { networkBinding: "bridge" }));

    expect(spec.network).toEqual({ binding: "bridge", ports: [{ port: 8080 }] });
  });
});

describe("guestCreateSummary, the collapsed tail", () => {
  it("says nothing about the three sections when they are untouched", () => {
    const text = summaryText();

    expect(text).not.toContain("Data disk");
    expect(text).not.toContain("Service");
    expect(text).not.toContain("GPU");
  });

  it("names every data disk on its own line", () => {
    const facts = guestCreateSummary(
      inputs(),
      withDisks([
        diskRow({ name: "extra" }),
        diskRow({ id: "disk-2", name: "db", source: "blank", image: "", blankSize: "50Gi" }),
      ]),
    );

    expect(facts.notes.filter((note) => note.startsWith("Data disk"))).toHaveLength(2);
  });

  it("names the Service and its type when a port is exposed", () => {
    const text = summaryText({ ports: [portRow({ name: "http", expose: "NodePort" })] });

    expect(text).toContain("One Service of type NodePort is created for this guest");
    expect(text).toContain("deleted with the guest");
  });

  it("counts the exposed ports against the declared ones", () => {
    const text = summaryText({
      ports: [
        portRow({ id: "port-1", name: "http", expose: "NodePort" }),
        portRow({ id: "port-2", port: "8443", name: "https" }),
      ],
    });

    expect(text).toContain("1 of its 2 ports");
  });

  it("says no Service is created when no port asks for one", () => {
    const text = summaryText({ ports: [portRow()] });

    expect(text).toContain("in-pod DNAT");
    expect(text).toContain("No Service is created: none of them asks to be exposed");
  });

  it("says no Service and no DNAT under a bridge binding", () => {
    const text = summaryText({ ports: [portRow()], networkBinding: "bridge" });

    expect(text).toContain("no Service is created and no in-pod DNAT is installed");
    expect(text).toContain("NetworkPolicy");
  });

  it("counts the additional interfaces and names the primary", () => {
    const text = summaryText({ interfaces: [nicRow({ networkName: "macvlan", primary: true })] });

    expect(text).toContain("one additional bridge interface, attached to a network by Multus");
    expect(text).toContain("The primary NIC is net1");
  });

  it("counts how many of several interfaces are network-backed", () => {
    const text = summaryText({
      interfaces: [nicRow({ id: "nic-1", networkName: "macvlan" }), nicRow({ id: "nic-2", name: "net2" })],
    });

    expect(text).toContain("2 additional bridge interfaces, 1 of them attached to a network by Multus");
  });

  it("says nothing about Multus when no interface names a network", () => {
    expect(summaryText({ interfaces: [nicRow()] })).toContain("It gets one additional bridge interface. ");
  });

  it("says the Service carries every port when they are all exposed", () => {
    const text = summaryText({
      ports: [
        portRow({ id: "port-1", name: "http", expose: "NodePort" }),
        portRow({ id: "port-2", port: "8443", name: "https", expose: "NodePort" }),
      ],
    });

    expect(text).toContain("carrying every one of its 2 ports");
  });

  it("says the Service carries its one port when there is only one", () => {
    expect(summaryText({ ports: [portRow({ name: "http", expose: "NodePort" })] })).toContain("carrying its one port");
  });

  it("says what an unmarked interface list means", () => {
    expect(summaryText({ interfaces: [nicRow()] })).toContain("None is marked primary");
  });

  it("names the native GPU profile with its request", () => {
    const text = summaryText({ gpuBackend: "profile", gpuProfile: "gpu-pcie" });

    expect(text).toContain("It asks for the GPU profile gpu-pcie (1 GPU, L40S, pcie) through the native backend");
    expect(text).toContain("VFIO");
  });

  it("names the DRA claim, the request and the tier", () => {
    const text = summaryText({ gpuBackend: "claim", gpuClaimName: "shared-gpu" });

    expect(text).toContain("the ResourceClaim shared-gpu");
    expect(text).toContain("the request gpu");
    expect(text).toContain("the tier is pcie (the value the API server stamps)");
  });

  it("names the template when that is the DRA reference", () => {
    const text = summaryText({ gpuBackend: "claim", gpuClaimTemplateName: "gpu-template", gpuTier: "hgx-full" });

    expect(text).toContain("a claim minted from the template gpu-template");
    expect(text).toContain("the tier is hgx-full");
    expect(text).not.toContain("the value the API server stamps");
  });

  it("states the parks-in-Pending expectation as a warning, on both backends (G11)", () => {
    for (const form of [
      { gpuBackend: "profile", gpuProfile: "gpu-pcie" },
      { gpuBackend: "claim", gpuClaimName: "c" },
    ]) {
      const facts = guestCreateSummary(inputs(), values(form as Partial<GuestFormValues>));

      expect(facts.warnings.some((warning) => warning.includes("parks in Pending on its GPUAllocated"))).toBe(true);
    }
  });

  it("says nothing about a GPU the guard refuses, on every excluded case", () => {
    for (const form of [
      kernelValues({ gpuBackend: "profile", gpuProfile: "gpu-pcie" }),
      cloneValues({ gpuBackend: "profile", gpuProfile: "gpu-pcie" }),
      values({ image: "windows-2022", gpuBackend: "profile", gpuProfile: "gpu-pcie" }),
    ]) {
      const facts = guestCreateSummary(inputs(), form);

      expect([...facts.notes, ...facts.warnings].some((line) => line.includes("gpu-pcie"))).toBe(false);
    }
  });

  it("repeats an unverified GPU profile, because the picker is inside a collapsed section", () => {
    expect(summaryText({ gpuBackend: "profile", gpuProfile: "gone" })).toContain("No SwiftGPUProfile named gone");
  });
});

describe("the node pin against a native GPU profile", () => {
  it("is not a warning without a pin, and not a warning without a profile", () => {
    expect(guestCreateWarnings(inputs(), gpuProfileValues()).nodeName).toBeUndefined();
    expect(guestCreateWarnings(inputs(), values({ nodeName: "node-a" })).nodeName).toBeUndefined();
  });

  it("warns when both are set, naming what upstream does about it", () => {
    const warning = guestCreateWarnings(inputs(), gpuProfileValues({ nodeName: "node-a" })).nodeName;

    expect(warning).toBe(gpuNodePinWarning);
    expect(warning).toContain("Resolved=False");
    expect(warning).toContain("Leave the pin empty");
  });

  it("never blocks on it", () => {
    expect(guestCreateSubmitBlockReason(inputs(), gpuProfileValues({ nodeName: "node-a" }))).toBeUndefined();
  });

  it("does not fire on the DRA backend, whose node the scheduler picks anyway", () => {
    expect(guestCreateWarnings(inputs(), gpuClaimValues({ nodeName: "node-a" })).nodeName).toBeUndefined();
  });

  it("does not fire on a guest whose GPU the guard refuses", () => {
    expect(
      usesNativeGpuProfile(inputs(), values({ image: "windows-2022", gpuBackend: "profile", gpuProfile: "gpu-pcie" })),
    ).toBe(false);
  });
});

describe("guestCreateBlockingIssues", () => {
  it("is empty on a form that can be sent", () => {
    expect(guestCreateBlockingIssues(inputs(), values())).toEqual([]);
  });

  it("names the row a data disk problem is on", () => {
    const [issue] = guestCreateBlockingIssues(
      inputs(),
      withDisks([diskRow({ id: "disk-1", name: "one" }), diskRow({ id: "disk-2", name: "" })]),
    );

    expect(issue.label).toBe("Data disk 2 name");
  });

  it("names the row a port problem is on", () => {
    const issues = guestCreateBlockingIssues(
      inputs(),
      withPorts([portRow({ id: "port-1", name: "a" }), portRow({ id: "port-2", port: "70000", name: "b" })]),
    );

    expect(issues[0].label).toBe("Port 2 port");
  });

  it("names the row an interface problem is on", () => {
    const [issue] = guestCreateBlockingIssues(inputs(), withNics([nicRow({ mac: "nope" })]));

    expect(issue.label).toBe("Interface 1 mac address");
  });

  it("names the GPU field", () => {
    const [issue] = guestCreateBlockingIssues(inputs(), values({ gpuBackend: "profile" }));

    expect(issue.label).toBe("GPU profile");
  });

  it("reports the flat fields before the sections, in the reading order of the form", () => {
    const issues = guestCreateBlockingIssues(
      inputs(),
      values({ name: "", dataDisks: [diskRow({ name: "" })], gpuBackend: "profile" }),
    );

    expect(issues.map((issue) => issue.label)).toEqual(["Name", "Data disk 1 name", "GPU profile"]);
  });

  it("is what the submit-disabled sentence names", () => {
    const form = withDisks([diskRow({ name: "" })]);
    const [issue] = guestCreateBlockingIssues(inputs(), form);

    expect(guestCreateSubmitBlockReason(inputs(), form)).toBe(`${issue.label}: ${issue.message}`);
  });

  it("carries a non-empty message on every issue it ever reports", () => {
    const forms: GuestFormValues[] = [
      values({ name: "" }),
      withDisks([diskRow({ name: "" })]),
      withDisks([diskRow({ image: "ubuntu-2404", pvc: "data-block" })]),
      withDisks([diskRow({ attachAsDisk: true })]),
      withPorts([portRow({ port: "" })]),
      withPorts([
        portRow({ id: "port-1", expose: "NodePort" }),
        portRow({ id: "port-2", port: "1", expose: "ClusterIP" }),
      ]),
      withPorts([portRow({ expose: "NodePort" })], { networkBinding: "bridge" }),
      withNics([nicRow({ name: "" })]),
      withNics([nicRow({ id: "nic-1", primary: true }), nicRow({ id: "nic-2", name: "net2", primary: true })]),
      values({ gpuBackend: "profile" }),
      values({ gpuBackend: "claim" }),
      gpuClaimValues({ gpuClaimTemplateName: "template" }),
    ];

    for (const form of forms) {
      const issues = guestCreateBlockingIssues(inputs(), form);

      expect(issues.length).toBeGreaterThan(0);

      for (const issue of issues) {
        expect(issue.label.length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the collapsed sections that open themselves", () => {
  it("reports no error on an untouched form", () => {
    expect(dataDisksSectionHasError(inputs(), values())).toBe(false);
    expect(networkSectionHasError(values())).toBe(false);
    expect(gpuSectionHasError(inputs(), values())).toBe(false);
  });

  it("reports the data disks section when one of its rows is wrong", () => {
    expect(dataDisksSectionHasError(inputs(), withDisks([diskRow({ name: "" })]))).toBe(true);
  });

  it("reports the network section for a port and for an interface alike", () => {
    expect(networkSectionHasError(withPorts([portRow({ port: "" })]))).toBe(true);
    expect(networkSectionHasError(withNics([nicRow({ mac: "nope" })]))).toBe(true);
  });

  it("reports the GPU section, and never one the guard refuses", () => {
    expect(gpuSectionHasError(inputs(), values({ gpuBackend: "profile" }))).toBe(true);
    expect(gpuSectionHasError(inputs(), kernelValues({ gpuBackend: "profile" }))).toBe(false);
  });

  it("never leaves a blocking issue in a section that would stay shut", () => {
    const form = values({ dataDisks: [diskRow({ name: "" })], ports: [portRow({ port: "" })], gpuBackend: "profile" });

    expect(guestCreateBlockingIssues(inputs(), form).length).toBeGreaterThan(0);
    expect(dataDisksSectionHasError(inputs(), form)).toBe(true);
    expect(networkSectionHasError(form)).toBe(true);
    expect(gpuSectionHasError(inputs(), form)).toBe(true);
  });
});

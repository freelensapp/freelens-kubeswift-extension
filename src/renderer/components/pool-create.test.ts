import { describe, expect, it } from "vitest";
import { defaultGuestForm, guestCreatePayload } from "./guest-create";
import {
  aboveOneReplica,
  addPoolClaimTemplate,
  addPoolServicePort,
  cloneTargetNodePreview,
  createGuestPoolTitle,
  defaultMaxSurge,
  defaultMaxUnavailable,
  defaultPoolForm,
  defaultPoolServiceType,
  defaultReplicas,
  defaultSpreadPolicy,
  defaultUpdateStrategyType,
  newPoolClaimTemplateRow,
  newPoolServicePortRow,
  poolClaimDeletionWarning,
  poolClaimPvcFact,
  poolClaimSummaryNote,
  poolClaimTemplateErrors,
  poolClaimTemplatesHint,
  poolClaimTemplatesPayload,
  poolCreateBlockingIssues,
  poolCreateErrors,
  poolCreateFailureMessage,
  poolCreateFailurePrefix,
  poolCreatePayload,
  poolCreateSubmitBlockReason,
  poolCreateSuccessMessage,
  poolCreateSummary,
  poolExcludedFieldsFooter,
  poolFanOutFact,
  poolGpuClaimWarning,
  poolHeadlessApplies,
  poolHeadlessDroppedFact,
  poolMacRefusals,
  poolNameBudget,
  poolNameError,
  poolNodePinWarning,
  poolPvcName,
  poolReplicaNameWarning,
  poolReplicas,
  poolReplicasError,
  poolRolloutErrors,
  poolRolloutFact,
  poolRolloutHint,
  poolRolloutSectionHasError,
  poolSeedProfileNote,
  poolServiceApplies,
  poolServiceConfigured,
  poolServiceDroppedFact,
  poolServiceError,
  poolServiceFact,
  poolServiceHint,
  poolServicePayload,
  poolServicePortErrors,
  poolServicePortWarnings,
  poolServiceSectionHasError,
  poolSharedPvcWarnings,
  poolSpreadFact,
  poolSpreadHint,
  poolStorageSectionHasError,
  poolTemplateSpec,
  poolUpdateStrategyPayload,
  recreateStrategyFact,
  removePoolClaimTemplate,
  removePoolServicePort,
  replicaCount,
  replicaNames,
  replicaNamesFact,
  replicasFact,
  rollingUpdateApplies,
  rolloutDeadlockMessage,
  schedulableWorkers,
  setPoolNamespace,
  setPoolServiceType,
  templateNetworkHint,
  templatePortsDroppedFact,
  updatePoolClaimTemplate,
  updatePoolServicePort,
} from "./pool-create";

import type {
  GuestCreateInputs,
  GuestDataDiskRow,
  GuestFormValues,
  GuestInterfaceRow,
  GuestPortRow,
} from "./guest-create";
import type { PoolFormValues } from "./pool-create";

const readyImage = { name: "ubuntu-2404", phase: "Ready", osType: "linux" };
const smallClass = {
  name: "small",
  cpu: "2",
  memory: "4Gi",
  rootDisk: { format: "qcow2", size: "20Gi" },
  storage: { accessMode: "ReadWriteOnce", volumeMode: "Filesystem" },
};

/** The capture that has to be told where to land: the one the pool overwrites (D3). */
const s3Snapshot = {
  name: "snap-s3",
  phase: "Ready",
  backend: "s3" as const,
  hasMemorySnapshot: true,
  sourceGuestName: "source-guest",
  guestSpec: { cpu: "4", memoryMi: 8192, osType: "linux" },
};

const readyKernel = { name: "kernel-6-12", phase: "Ready", kernelCmdline: "console=ttyS0" };

/**
 * The cluster as the reads on open found it: two workers the round-robin can
 * walk, one control-plane node it must not, and one that is down.
 */
function inputs(overrides: Partial<GuestCreateInputs> = {}): GuestCreateInputs {
  return {
    guestClasses: [smallClass],
    guestClassesUnverified: false,
    images: [readyImage],
    imagesUnverified: false,
    seedProfiles: [{ name: "seed-basic", datasource: "NoCloud" }],
    seedProfilesUnverified: false,
    kernels: [readyKernel],
    kernelsUnverified: false,
    snapshots: [s3Snapshot],
    snapshotsUnverified: false,
    pvcs: [{ name: "data-block", volumeMode: "Block", phase: "Bound" }],
    pvcsUnverified: false,
    gpuProfiles: [{ name: "gpu-pcie", count: 1, tier: "pcie", partitionMode: "isolated" }],
    gpuProfilesUnverified: false,
    nodes: [
      { name: "worker-b", ready: true, schedulable: true },
      { name: "worker-a", ready: true, schedulable: true },
      { name: "control", ready: true, schedulable: true, labels: { "node-role.kubernetes.io/control-plane": "" } },
      { name: "worker-down", ready: false, schedulable: true },
    ],
    nodesUnverified: false,
    existingNames: [],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** A template of the boot source most pools have, with whatever the case needs on top. */
function template(overrides: Partial<GuestFormValues> = {}): GuestFormValues {
  return {
    ...defaultGuestForm("kubeswift"),
    guestClass: "small",
    image: "ubuntu-2404",
    ...overrides,
  };
}

/** A pool form with a valid head, so a case only has to state what it is about. */
function form(overrides: Partial<PoolFormValues> = {}): PoolFormValues {
  return {
    ...defaultPoolForm("kubeswift"),
    name: "web",
    template: template(),
    ...overrides,
  };
}

function dataDisk(overrides: Partial<GuestDataDiskRow> = {}): GuestDataDiskRow {
  return {
    id: "disk-1",
    name: "scratch",
    source: "blank",
    image: "",
    pvc: "",
    blankSize: "20Gi",
    blankStorageClass: "",
    blankVolumeMode: "",
    attachAsDisk: false,
    ...overrides,
  };
}

function portRow(overrides: Partial<GuestPortRow> = {}): GuestPortRow {
  return { id: "port-1", port: "80", name: "http", targetPort: "", protocol: "TCP", expose: "", ...overrides };
}

function interfaceRow(overrides: Partial<GuestInterfaceRow> = {}): GuestInterfaceRow {
  return {
    id: "nic-1",
    name: "net1",
    networkName: "",
    networkNamespace: "",
    primary: false,
    mac: "",
    ...overrides,
  };
}

/**
 * The corpus the composition properties run over: all three boot sources, the
 * collapsed tail, and the two fields the pool removes.
 *
 * Every entry is a `GuestFormValues` the Create Guest form could really hold,
 * because the whole point of the property is that the pool sends what that form
 * would have sent.
 */
const corpus: { label: string; values: GuestFormValues }[] = [
  { label: "a bare image-boot template", values: template() },
  {
    label: "an image-boot template with a seed, a policy and a pin",
    values: template({ seedProfile: "seed-basic", runPolicy: "Always", nodeName: "worker-a" }),
  },
  {
    label: "an image-boot template with the whole collapsed tail",
    values: template({
      storageAccessMode: "ReadWriteMany",
      storageVolumeMode: "Block",
      storageClassName: "fast",
      dataDisks: [dataDisk(), dataDisk({ id: "disk-2", name: "extra", source: "image", image: "ubuntu-2404" })],
      ports: [portRow(), portRow({ id: "port-2", port: "443", name: "https", targetPort: "8443" })],
      interfaces: [interfaceRow({ primary: true })],
      gpuBackend: "profile",
      gpuProfile: "gpu-pcie",
      guestAgentEnabled: true,
    }),
  },
  {
    label: "a kernel-boot template",
    values: template({ bootSource: "kernel", image: "", kernel: "kernel-6-12", kernelCmdline: "quiet" }),
  },
  {
    label: "a clone template with a target node",
    values: template({
      bootSource: "clone",
      image: "",
      snapshot: "snap-s3",
      cloneTargetNode: "worker-a",
      regenerateMachineIdentity: true,
    }),
  },
  {
    label: "a clone template that keeps the machine identity",
    values: template({
      bootSource: "clone",
      image: "",
      snapshot: "snap-s3",
      cloneTargetNode: "worker-b",
      regenerateMachineIdentity: false,
    }),
  },
  {
    label: "a template with a DRA claim and a data disk on an existing PVC",
    values: template({
      gpuBackend: "claim",
      gpuClaimName: "shared-gpu",
      gpuRequestName: "gpu",
      dataDisks: [dataDisk({ source: "pvc", pvc: "data-block", name: "state", attachAsDisk: true })],
    }),
  },
];

describe("the title and the defaults", () => {
  it("names the verb the way the page's control and the OK button do", () => {
    expect(createGuestPoolTitle).toBe("Create Guest Pool");
  });

  it("opens on the schema's own replica default, not upstream's invented two", () => {
    expect(defaultPoolForm().replicas).toBe("1");
    expect(defaultReplicas).toBe("1");
  });

  it("opens on the schema's defaults for everything else it does not ask about", () => {
    const values = defaultPoolForm();

    expect(values.spreadPolicy).toBe(defaultSpreadPolicy);
    expect(values.serviceEnabled).toBe(false);
    expect(values.serviceType).toBe(defaultPoolServiceType);
    expect(values.serviceHeadless).toBe(false);
    expect(values.servicePorts).toEqual([]);
    expect(values.claimTemplates).toEqual([]);
    expect(values.updateStrategyType).toBe(defaultUpdateStrategyType);
    expect(values.maxSurge).toBe(defaultMaxSurge);
    expect(values.maxUnavailable).toBe(defaultMaxUnavailable);
  });

  it("opens with a template the Create Guest form would have opened with", () => {
    expect(defaultPoolForm("kubeswift").template).toEqual(defaultGuestForm("kubeswift"));
  });

  it("carries the namespace into the template, which is what the namespaced pickers read", () => {
    const moved = setPoolNamespace(defaultPoolForm("kubeswift"), "other");

    expect(moved.namespace).toBe("other");
    expect(moved.template.namespace).toBe("other");
  });

  it("leaves the template's own name empty, because a template has none", () => {
    expect(defaultPoolForm("kubeswift").template.name).toBe("");
  });
});

describe("the composition properties", () => {
  it("sends the Create Guest payload as the template, unchanged, for every form in the corpus", () => {
    for (const { label, values } of corpus) {
      const guest = guestCreatePayload(inputs(), values).spec;
      const expected = { ...guest };

      // The one removal that is unconditional: the round-robin decides it.
      if (expected.cloneFromSnapshot) {
        const clone = { ...expected.cloneFromSnapshot };

        delete clone.targetNode;
        expected.cloneFromSnapshot = clone;
      }

      expect(poolTemplateSpec(inputs(), form({ template: values })), label).toEqual(expected);
    }
  });

  it("removes network.ports, and only those, exactly when a pool Service is configured", () => {
    for (const { label, values } of corpus) {
      const withService = form({
        template: values,
        serviceEnabled: true,
        servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "8080", name: "http" }],
      });
      const guest = guestCreatePayload(inputs(), values).spec;
      const expected = { ...guest };

      if (expected.cloneFromSnapshot) {
        const clone = { ...expected.cloneFromSnapshot };

        delete clone.targetNode;
        expected.cloneFromSnapshot = clone;
      }

      if (expected.network?.ports) {
        const network = { ...expected.network };

        delete network.ports;

        if (Object.keys(network).length > 0) {
          expected.network = network;
        } else {
          delete expected.network;
        }
      }

      expect(poolTemplateSpec(inputs(), withService), label).toEqual(expected);
    }
  });

  it("keeps the template's ports when the pool has no Service of its own", () => {
    const values = template({ ports: [portRow()] });
    const spec = poolTemplateSpec(inputs(), form({ template: values }));

    expect(spec.network?.ports).toEqual([{ port: 80, name: "http" }]);
  });

  it("keeps the template's ports when the Service section is dropped by a bridge binding", () => {
    const values = template({ networkBinding: "bridge", ports: [portRow()] });
    const spec = poolTemplateSpec(
      inputs(),
      form({
        template: values,
        serviceEnabled: true,
        servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "8080", name: "http" }],
      }),
    );

    expect(spec.network?.ports).toEqual([{ port: 80, name: "http" }]);
    expect(spec.network?.binding).toBe("bridge");
  });

  it("drops the whole network block when the ports were all it held", () => {
    const values = template({ ports: [portRow()] });
    const spec = poolTemplateSpec(
      inputs(),
      form({
        template: values,
        serviceEnabled: true,
        servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "8080", name: "http" }],
      }),
    );

    expect(spec.network).toBeUndefined();
  });

  it("keeps the binding when the ports were not all the network block held", () => {
    const values = template({ networkBinding: "nat", ports: [portRow()] });
    const withBridge = { ...values, networkBinding: "bridge" as const };
    const spec = poolTemplateSpec(inputs(), form({ template: withBridge, serviceEnabled: false }));

    expect(spec.network?.binding).toBe("bridge");
  });

  it("removes the clone's target node always, whether or not a Service is configured", () => {
    const values = template({ bootSource: "clone", image: "", snapshot: "snap-s3", cloneTargetNode: "worker-a" });

    expect(guestCreatePayload(inputs(), values).spec.cloneFromSnapshot?.targetNode).toBe("worker-a");
    expect(poolTemplateSpec(inputs(), form({ template: values })).cloneFromSnapshot?.targetNode).toBeUndefined();
    // And the rest of the clone block is untouched: the snapshot and the
    // regenerate list are what the guest form built.
    expect(poolTemplateSpec(inputs(), form({ template: values })).cloneFromSnapshot).toEqual({
      snapshotRef: { name: "snap-s3" },
      regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"],
    });
  });

  it("leaves dataDiskRefs exactly as the guest form built them, because the controller appends", () => {
    const values = template({ dataDisks: [dataDisk()] });
    const withClaims = form({
      template: values,
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" }],
    });

    expect(poolTemplateSpec(inputs(), withClaims).dataDiskRefs).toEqual(
      guestCreatePayload(inputs(), values).spec.dataDiskRefs,
    );
  });

  it("emits topologySpreadConstraints from neither form, whatever the spread policy says", () => {
    for (const { label, values } of corpus) {
      expect(guestCreatePayload(inputs(), values).spec.topologySpreadConstraints, label).toBeUndefined();
      expect(
        poolCreatePayload(inputs(), form({ template: values, spreadPolicy: "Spread" })).spec.template.spec
          .topologySpreadConstraints,
        label,
      ).toBeUndefined();
    }
  });

  it("sends replicas and the template's runPolicy in every payload of the corpus", () => {
    for (const { label, values } of corpus) {
      const payload = poolCreatePayload(inputs(), form({ template: values, replicas: "3" }));

      expect(payload.spec.replicas, label).toBe(3);
      expect(payload.spec.template.spec.runPolicy, label).toBe(values.runPolicy);
    }
  });

  it("sends the template under spec.template.spec and nothing else about it", () => {
    const payload = poolCreatePayload(inputs(), form());

    expect(Object.keys(payload.spec.template)).toEqual(["spec"]);
  });
});

describe("replicas", () => {
  it("accepts zero, and says what a pool that owns nothing is", () => {
    expect(poolReplicasError(form({ replicas: "0" }))).toBeUndefined();
    expect(poolReplicas(form({ replicas: "0" }))).toBe(0);
    expect(poolCreatePayload(inputs(), form({ replicas: "0" })).spec.replicas).toBe(0);
  });

  it("refuses a negative count with the schema's own minimum", () => {
    expect(poolReplicasError(form({ replicas: "-1" }))).toContain("at least 0");
  });

  it("refuses a count that is not a whole number", () => {
    expect(poolReplicasError(form({ replicas: "2.5" }))).toContain("whole number");
    expect(poolReplicasError(form({ replicas: "two" }))).toContain("whole number");
  });

  it("refuses an empty count, because the field is sent explicitly", () => {
    expect(poolReplicasError(form({ replicas: "" }))).toContain("required");
  });

  it("accepts a large count without inventing an upper bound", () => {
    expect(poolReplicasError(form({ replicas: "500" }))).toBeUndefined();
    expect(poolCreatePayload(inputs(), form({ replicas: "500" })).spec.replicas).toBe(500);
  });

  it("states the count facts against the schema default while the field is being typed", () => {
    expect(replicaCount(form({ replicas: "" }))).toBe(1);
    expect(replicaCount(form({ replicas: "4" }))).toBe(4);
    expect(aboveOneReplica(form({ replicas: "1" }))).toBe(false);
    expect(aboveOneReplica(form({ replicas: "2" }))).toBe(true);
  });

  it("says on the field what a replica count means, without a cap it invented", () => {
    expect(replicasFact).toContain("0 is legal");
    expect(replicasFact).toContain("no upper bound");
  });
});

describe("the name budget", () => {
  it("is one separator and the widest index short of a DNS label", () => {
    expect(poolNameBudget(1)).toBe(61);
    expect(poolNameBudget(9)).toBe(61);
    expect(poolNameBudget(10)).toBe(61);
    expect(poolNameBudget(11)).toBe(60);
    expect(poolNameBudget(99)).toBe(60);
    expect(poolNameBudget(100)).toBe(60);
    expect(poolNameBudget(101)).toBe(59);
  });

  it("holds at the 9/10 boundary, where the highest index is still one digit", () => {
    const name = "a".repeat(61);

    expect(poolNameError(form({ name, replicas: "9" }))).toBeUndefined();
    expect(poolNameError(form({ name, replicas: "10" }))).toBeUndefined();
    expect(poolNameError(form({ name, replicas: "11" }))).toContain("at most 60 characters");
  });

  it("holds at the 99/100 boundary, where the highest index is still two digits", () => {
    const name = "a".repeat(60);

    expect(poolNameError(form({ name, replicas: "99" }))).toBeUndefined();
    expect(poolNameError(form({ name, replicas: "100" }))).toBeUndefined();
    expect(poolNameError(form({ name, replicas: "101" }))).toContain("at most 59 characters");
  });

  it("names the objects the replica name becomes, rather than stating a preference", () => {
    const message = poolNameError(form({ name: "a".repeat(62), replicas: "2" })) ?? "";

    expect(message).toContain("launcher pod");
    expect(message).toContain("cloned root disk");
    expect(message).toContain("per-guest Service");
    expect(message).toContain("DNS label");
  });

  it("refuses a name that is not a DNS label at all", () => {
    expect(poolNameError(form({ name: "Web_Pool" }))).toContain("lowercase letters");
    expect(poolNameError(form({ name: "web.pool" }))).toContain("Dots are not allowed");
  });

  it("requires a name, saying what it is the name of", () => {
    expect(poolNameError(form({ name: "" }))).toContain("every replica of this pool is named after");
  });
});

describe("the replica and PVC names", () => {
  it("names the replicas zero-based, after the pool", () => {
    expect(replicaNames(form({ name: "web", replicas: "3" }))).toEqual(["web-0", "web-1", "web-2"]);
  });

  it("names the PVCs in the real <template>-<pool>-<index> order", () => {
    expect(poolPvcName("state", "web", 0)).toBe("state-web-0");
    expect(poolPvcName("state", "web", 12)).toBe("state-web-12");
  });

  it("says the indices are stable and reused, which is what a deletion means", () => {
    expect(replicaNamesFact(form({ name: "web", replicas: "3" }))).toContain("web-0 to web-2");
    expect(replicaNamesFact(form({ name: "web", replicas: "3" }))).toContain("reused after a deletion");
  });

  it("says a pool of one is not a guest named after the pool", () => {
    expect(replicaNamesFact(form({ name: "web", replicas: "1" }))).toContain("named web-0");
  });

  it("says a pool of zero owns nothing yet", () => {
    expect(replicaNamesFact(form({ name: "web", replicas: "0" }))).toContain("owns nothing until it is scaled up");
  });
});

describe("D1: the node pin warns above one replica and never blocks", () => {
  const pinned = (replicas: string) => form({ replicas, template: template({ nodeName: "worker-a" }) });

  it("warns above one replica, naming the node and the count", () => {
    const warning = poolNodePinWarning(pinned("3")) ?? "";

    expect(warning).toContain("All 3 replicas are pinned to worker-a");
    expect(warning).toContain("no node-name logic in the controller");
    expect(warning).toContain("bypasses the scheduler");
  });

  it("says nothing at one replica, where the pin is as legitimate as on a guest", () => {
    expect(poolNodePinWarning(pinned("1"))).toBeUndefined();
  });

  it("appears and disappears with the count, which is a field the user changes", () => {
    expect(poolNodePinWarning(pinned("1"))).toBeUndefined();
    expect(poolNodePinWarning(pinned("2"))).toBeDefined();
    expect(poolNodePinWarning(pinned("1"))).toBeUndefined();
  });

  it("names the spread policy when there is one, because the two contradict each other", () => {
    expect(poolNodePinWarning({ ...pinned("3"), spreadPolicy: "Spread" })).toContain(
      "the Spread policy cannot save it",
    );
    expect(poolNodePinWarning({ ...pinned("3"), spreadPolicy: "Pack" })).toContain("whatever the spread policy says");
  });

  it("never blocks the submit, however many replicas share the node", () => {
    const issues = poolCreateBlockingIssues(inputs(), pinned("50"));

    expect(issues).toEqual([]);
    expect(poolCreateSubmitBlockReason(inputs(), pinned("50"))).toBeUndefined();
  });

  it("sends the pin unchanged, because a pinned pool is a legitimate thing to want", () => {
    expect(poolCreatePayload(inputs(), pinned("3")).spec.template.spec.nodeName).toBe("worker-a");
  });

  it("says nothing about a pin the boot source does not offer at all", () => {
    const clone = form({
      replicas: "3",
      template: template({ bootSource: "clone", image: "", snapshot: "snap-s3", nodeName: "worker-a" }),
    });

    expect(poolNodePinWarning(clone)).toBeUndefined();
  });

  it("carries the pin warning into the summary as well as to the field", () => {
    expect(poolCreateSummary(inputs(), pinned("3")).warnings.join(" ")).toContain("All 3 replicas are pinned");
  });
});

describe("D2: a template MAC is refused above one replica", () => {
  const withMac = (replicas: string) =>
    form({ replicas, template: template({ interfaces: [interfaceRow({ mac: "52:54:00:12:34:56" })] }) });

  it("refuses above one replica, naming the row, the address and the count", () => {
    const [refusal] = poolMacRefusals(withMac("3"));

    expect(refusal.index).toBe(0);
    expect(refusal.message).toContain("Interface 1 names the MAC address 52:54:00:12:34:56");
    expect(refusal.message).toContain("all 3 replicas");
    expect(refusal.message).toContain("collision");
  });

  it("offers it again at one replica, where it is as legitimate as on a guest", () => {
    expect(poolMacRefusals(withMac("1"))).toEqual([]);
    expect(poolCreateBlockingIssues(inputs(), withMac("1"))).toEqual([]);
  });

  it("blocks the submit above one replica, naming the interface row", () => {
    const reason = poolCreateSubmitBlockReason(inputs(), withMac("2")) ?? "";

    expect(reason).toContain("Interface 1 MAC address:");
    expect(reason).toContain("52:54:00:12:34:56");
  });

  it("releases the submit when the count comes back down, and blocks again when it goes up", () => {
    expect(poolCreateSubmitBlockReason(inputs(), withMac("2"))).toBeDefined();
    expect(poolCreateSubmitBlockReason(inputs(), withMac("1"))).toBeUndefined();
    expect(poolCreateSubmitBlockReason(inputs(), withMac("4"))).toBeDefined();
  });

  it("releases the submit when the address is cleared instead", () => {
    const cleared = form({ replicas: "3", template: template({ interfaces: [interfaceRow()] }) });

    expect(poolMacRefusals(cleared)).toEqual([]);
    expect(poolCreateSubmitBlockReason(inputs(), cleared)).toBeUndefined();
  });

  it("refuses each offending row and leaves the others alone", () => {
    const values = form({
      replicas: "2",
      template: template({
        interfaces: [
          interfaceRow(),
          interfaceRow({ id: "nic-2", name: "net2", mac: "52:54:00:aa:bb:cc" }),
          interfaceRow({ id: "nic-3", name: "net3", mac: "52:54:00:dd:ee:ff" }),
        ],
      }),
    });
    const refusals = poolMacRefusals(values);

    expect(refusals.map((refusal) => refusal.index)).toEqual([1, 2]);
    expect(refusals[0].message).toContain("Interface 2");
    expect(refusals[1].message).toContain("Interface 3");
  });

  it("says who else would have rejected it, which is nobody", () => {
    const [refusal] = poolMacRefusals(withMac("2"));

    expect(refusal.message).toContain("the schema checks the format only");
    expect(refusal.message).toContain("a pool has no webhook at all");
  });
});

describe("D3: the Service, and the controls the controller would overwrite", () => {
  const withService = (overrides: Partial<PoolFormValues> = {}) =>
    form({
      serviceEnabled: true,
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "8080", name: "http" }],
      ...overrides,
    });

  it("is configured only when the section is on and the template is not bridge-bound", () => {
    expect(poolServiceConfigured(withService())).toBe(true);
    expect(poolServiceConfigured(form())).toBe(false);
    expect(poolServiceConfigured(withService({ template: template({ networkBinding: "bridge" }) }))).toBe(false);
  });

  it("drops the whole section on a bridge-bound template, with what really happens", () => {
    const bridged = withService({ template: template({ networkBinding: "bridge" }) });

    expect(poolServiceApplies(bridged)).toBe(false);
    expect(poolServiceFact(bridged)).toBe(poolServiceDroppedFact);
    expect(poolServiceDroppedFact).toContain("rejected at admission");
    expect(poolServiceDroppedFact).toContain("there is no pool webhook");
    expect(poolServiceDroppedFact).toContain("ServiceReady=False");
  });

  it("sends no service at all for a bridge-bound template, whatever the section held", () => {
    const bridged = withService({ template: template({ networkBinding: "bridge" }) });

    expect(poolServicePayload(bridged)).toBeUndefined();
    expect(poolCreatePayload(inputs(), bridged).spec.service).toBeUndefined();
  });

  it("states the port replacement where the template's ports control was", () => {
    const fact = templatePortsDroppedFact(withService());

    expect(fact).toContain("replaces spec.network.ports wholly");
    expect(fact).toContain("expose cleared");
    expect(fact).toContain("8080/TCP");
  });

  it("sends the pool's own ports, and never an expose on any of them", () => {
    const values = withService({
      servicePorts: [
        { ...newPoolServicePortRow("service-port-1"), port: "80", name: "http" },
        { ...newPoolServicePortRow("service-port-2"), port: "443", name: "https", targetPort: "8443" },
      ],
    });
    const service = poolServicePayload(values);

    expect(service?.ports).toEqual([
      { port: 80, name: "http" },
      { port: 443, name: "https", targetPort: 8443 },
    ]);

    for (const port of service?.ports ?? []) {
      expect(port).not.toHaveProperty("expose");
    }
  });

  it("never re-sends the protocol or the type the API server stamps", () => {
    const service = poolServicePayload(withService());

    expect(service).toEqual({ ports: [{ port: 8080, name: "http" }] });
    expect(service).not.toHaveProperty("type");
  });

  it("sends the type when it is not the stamped ClusterIP", () => {
    expect(poolServicePayload(withService({ serviceType: "NodePort" }))?.type).toBe("NodePort");
  });

  it("sends a non-TCP protocol, which the API server does not stamp", () => {
    const values = withService({
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "53", name: "dns", protocol: "UDP" }],
    });

    expect(poolServicePayload(values)?.ports[0].protocol).toBe("UDP");
  });

  it("makes headless inexpressible against the two types that override it", () => {
    expect(poolHeadlessApplies("ClusterIP")).toBe(true);
    expect(poolHeadlessApplies("NodePort")).toBe(false);
    expect(poolHeadlessApplies("LoadBalancer")).toBe(false);
    expect(poolHeadlessDroppedFact("NodePort")).toContain("mutually exclusive");
    expect(poolHeadlessDroppedFact("LoadBalancer")).toContain("silently overriding");
  });

  it("clears a headless flag the new type cannot carry, rather than sending one it would override", () => {
    const headless = withService({ serviceHeadless: true });

    expect(poolServicePayload(headless)?.headless).toBe(true);
    expect(setPoolServiceType(headless, "NodePort").serviceHeadless).toBe(false);
    expect(poolServicePayload(setPoolServiceType(headless, "NodePort"))?.headless).toBeUndefined();
  });

  it("keeps a headless flag across a move back to ClusterIP only if it was not cleared", () => {
    const headless = withService({ serviceHeadless: true });
    const nodePort = setPoolServiceType(headless, "NodePort");

    expect(setPoolServiceType(nodePort, "ClusterIP").serviceHeadless).toBe(false);
  });

  it("requires a port name above one port, naming what fails without it", () => {
    const values = withService({
      servicePorts: [
        { ...newPoolServicePortRow("service-port-1"), port: "80", name: "" },
        { ...newPoolServicePortRow("service-port-2"), port: "443", name: "" },
      ],
    });
    const errors = poolServicePortErrors(values);

    expect(errors[0].name).toContain("required above one port");
    expect(errors[0].name).toContain("multi-port Service");
    expect(errors[1].name).toBeDefined();
  });

  it("accepts one unnamed port, which is what a single-port Service may have", () => {
    const values = withService({
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "80", name: "" }],
    });

    expect(poolServicePortErrors(values)[0].name).toBeUndefined();
  });

  it("refuses a port number the schema would refuse, and an empty one", () => {
    const values = withService({
      servicePorts: [
        { ...newPoolServicePortRow("service-port-1"), port: "", name: "a" },
        { ...newPoolServicePortRow("service-port-2"), port: "70000", name: "b" },
        { ...newPoolServicePortRow("service-port-3"), port: "eighty", name: "c" },
        { ...newPoolServicePortRow("service-port-4"), port: "80", name: "d", targetPort: "0" },
      ],
    });
    const errors = poolServicePortErrors(values);

    expect(errors[0].port).toContain("required");
    expect(errors[1].port).toContain("between 1 and 65535");
    expect(errors[2].port).toContain("whole number");
    expect(errors[3].targetPort).toContain("between 1 and 65535");
  });

  it("warns about a port name Kubernetes would refuse on the Service it mints", () => {
    const values = withService({
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "80", name: "a-very-long-port-name" }],
    });

    expect(poolServicePortWarnings(values)[0].name).toContain("at most 15 characters");
    expect(poolServicePortErrors(values)[0].name).toBeUndefined();
  });

  it("refuses a Service with no port at all, which the schema refuses too", () => {
    expect(poolServiceError(withService({ servicePorts: [] }))).toContain("at least one port");
    expect(poolServiceSectionHasError(withService({ servicePorts: [] }))).toBe(true);
    expect(poolServiceError(form())).toBeUndefined();
  });

  it("adds, updates and removes port rows without renumbering the others", () => {
    const one = addPoolServicePort(form());
    const two = addPoolServicePort(one);
    const filled = updatePoolServicePort(two, two.servicePorts[0].id, { port: "80" });

    expect(filled.servicePorts).toHaveLength(2);
    expect(filled.servicePorts[0].port).toBe("80");
    expect(removePoolServicePort(filled, filled.servicePorts[0].id).servicePorts).toEqual([filled.servicePorts[1]]);
  });

  it("says what the Service does, including the readiness upstream never documents", () => {
    expect(poolServiceFact(withService())).toContain("in front of every replica");
    expect(poolServiceFact(withService())).toContain("Ready only once the guest behind it answers");
    expect(poolServiceFact(withService({ serviceHeadless: true }))).toContain("one A record per ready replica");
    expect(poolServiceFact(form())).toContain("No Service is created");
  });
});

describe("the per-replica claim templates", () => {
  const withClaim = (overrides: Partial<PoolFormValues> = {}) =>
    form({
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" }],
      ...overrides,
    });

  it("requires a name the schema does not require, and says what an empty one costs", () => {
    const values = withClaim({ claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "", size: "50Gi" }] });
    const message = poolClaimTemplateErrors(values)[0].name ?? "";

    expect(message).toContain("the schema does not require it");
    expect(message).toContain("-<pool>-<index>");
    expect(message).toContain("retries forever");
  });

  it("validates the name as a DNS label, because it becomes the first segment of a PVC name", () => {
    const values = withClaim({
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "State_1", size: "50Gi" }],
    });

    expect(poolClaimTemplateErrors(values)[0].name).toContain("DNS label");
  });

  it("refuses a name that collides with a data disk of the template, across both lists", () => {
    const values = withClaim({
      template: template({ dataDisks: [dataDisk({ name: "state" })] }),
    });
    const message = poolClaimTemplateErrors(values)[0].name ?? "";

    expect(message).toContain("already has a data disk named state");
    expect(message).toContain("admission webhook would catch");
    expect(poolCreateSubmitBlockReason(inputs(), values)).toContain("Storage template 1 name:");
  });

  it("accepts a name that collides with nothing", () => {
    const values = withClaim({ template: template({ dataDisks: [dataDisk({ name: "scratch" })] }) });

    expect(poolClaimTemplateErrors(values)[0].name).toBeUndefined();
    expect(poolStorageSectionHasError(values)).toBe(false);
  });

  it("refuses two claim templates with one name, which would be one PVC per replica", () => {
    const values = withClaim({
      claimTemplates: [
        { ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" },
        { ...newPoolClaimTemplateRow("claim-2"), name: "state", size: "10Gi" },
      ],
    });

    expect(poolClaimTemplateErrors(values)[0].name).toBeUndefined();
    expect(poolClaimTemplateErrors(values)[1].name).toContain("already named state");
  });

  it("requires a size, because a PVC without one is refused by the API server", () => {
    const values = withClaim({ claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "" }] });

    expect(poolClaimTemplateErrors(values)[0].size).toContain("refused by the API server");
  });

  it("refuses a size that is not a quantity, and one that is zero", () => {
    const bad = withClaim({
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50 gigs" }],
    });
    const zero = withClaim({ claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "0" }] });

    expect(poolClaimTemplateErrors(bad)[0].size).toContain("not a Kubernetes quantity");
    expect(poolClaimTemplateErrors(zero)[0].size).toContain("zero");
  });

  it("refuses a storage class name that is not an object name", () => {
    const values = withClaim({
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi", storageClass: "Fast_1" }],
    });

    expect(poolClaimTemplateErrors(values)[0].storageClass).toBeDefined();
  });

  it("shows the PVC name of the first and the last replica, in the real order", () => {
    const values = withClaim({ name: "web", replicas: "3" });
    const fact = poolClaimPvcFact(values, values.claimTemplates[0]);

    expect(fact).toContain("state-web-0");
    expect(fact).toContain("state-web-2");
    expect(fact).toContain("<template>-<pool>-<index>");
    expect(fact).toContain("backwards");
  });

  it("sends the claim template with exactly the keys the row set", () => {
    expect(poolClaimTemplatesPayload(withClaim())).toEqual([
      { metadata: { name: "state" }, spec: { resources: { requests: { storage: "50Gi" } } } },
    ]);
  });

  it("sends the access mode, the storage class and the volume mode when the row set them", () => {
    const values = withClaim({
      claimTemplates: [
        {
          ...newPoolClaimTemplateRow("claim-1"),
          name: "state",
          size: "50Gi",
          storageClass: "fast",
          accessMode: "ReadWriteOnce",
          volumeMode: "Block",
        },
      ],
    });

    expect(poolClaimTemplatesPayload(values)).toEqual([
      {
        metadata: { name: "state" },
        spec: {
          resources: { requests: { storage: "50Gi" } },
          accessModes: ["ReadWriteOnce"],
          storageClassName: "fast",
          volumeMode: "Block",
        },
      },
    ]);
  });

  it("drops a row that is not finished rather than sending half of it", () => {
    const values = withClaim({ claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "" }] });

    expect(poolClaimTemplatesPayload(values)).toBeUndefined();
  });

  it("sends nothing at all when no template was added", () => {
    expect(poolClaimTemplatesPayload(form())).toBeUndefined();
    expect(poolCreatePayload(inputs(), form()).spec.volumeClaimTemplates).toBeUndefined();
  });

  it("adds, updates and removes rows", () => {
    const one = addPoolClaimTemplate(form());
    const named = updatePoolClaimTemplate(one, one.claimTemplates[0].id, { name: "state" });

    expect(named.claimTemplates[0].name).toBe("state");
    expect(removePoolClaimTemplate(named, named.claimTemplates[0].id).claimTemplates).toEqual([]);
  });

  it("says on the header what the section is for, and what upstream cannot reach", () => {
    expect(poolClaimTemplatesHint(form())).toContain("<template>-<pool>-<index>");
    expect(poolClaimTemplatesHint(form())).toContain("unreachable in upstream's own UI");
    expect(poolClaimTemplatesHint(withClaim({ replicas: "3" }))).toContain("3 replicas");
  });

  it("warns in the summary that deleting the pool deletes the claims and their data", () => {
    expect(poolCreateSummary(inputs(), withClaim()).warnings).toContain(poolClaimDeletionWarning);
    expect(poolClaimDeletionWarning).toContain("their data with them");
    expect(poolClaimDeletionWarning).toContain("the upstream guide promises the opposite");
  });

  it("does not warn about a deletion when the pool owns no claim", () => {
    expect(poolCreateSummary(inputs(), form()).warnings).not.toContain(poolClaimDeletionWarning);
  });
});

describe("the rollout", () => {
  it("refuses the pair that can never progress, with the reason", () => {
    const deadlocked = form({ maxSurge: "0", maxUnavailable: "0" });

    expect(poolRolloutErrors(deadlocked).maxUnavailable).toBe(rolloutDeadlockMessage);
    expect(rolloutDeadlockMessage).toContain("can never progress");
    expect(rolloutDeadlockMessage).toContain("reported by no condition");
    expect(poolRolloutSectionHasError(deadlocked)).toBe(true);
    expect(poolCreateSubmitBlockReason(inputs(), deadlocked)).toContain("Max unavailable:");
  });

  it("releases when either of the two moves", () => {
    expect(poolRolloutErrors(form({ maxSurge: "1", maxUnavailable: "0" })).maxUnavailable).toBeUndefined();
    expect(poolRolloutErrors(form({ maxSurge: "0", maxUnavailable: "1" })).maxUnavailable).toBeUndefined();
    expect(poolCreateSubmitBlockReason(inputs(), form({ maxSurge: "1", maxUnavailable: "0" }))).toBeUndefined();
    expect(poolCreateSubmitBlockReason(inputs(), form({ maxSurge: "0", maxUnavailable: "1" }))).toBeUndefined();
  });

  it("refuses a pace that is not a whole number of zero or more", () => {
    expect(poolRolloutErrors(form({ maxSurge: "-1" })).maxSurge).toContain("minimum of 0");
    expect(poolRolloutErrors(form({ maxUnavailable: "half" })).maxUnavailable).toContain("minimum of 0");
  });

  it("does not read the pace at all under Recreate, deadlock included", () => {
    const recreate = form({ updateStrategyType: "Recreate", maxSurge: "0", maxUnavailable: "0" });

    expect(rollingUpdateApplies("Recreate")).toBe(false);
    expect(poolRolloutErrors(recreate)).toEqual({});
    expect(poolRolloutFact(recreate)).toBe(recreateStrategyFact);
    expect(recreateStrategyFact).toContain("replaces every replica at once");
  });

  it("sends nothing when the pace is the one the API server would stamp", () => {
    expect(poolUpdateStrategyPayload(form())).toBeUndefined();
    expect(poolCreatePayload(inputs(), form()).spec.updateStrategy).toBeUndefined();
  });

  it("sends both pace fields together, because the schema requires the pair", () => {
    expect(poolUpdateStrategyPayload(form({ maxSurge: "2", maxUnavailable: "0" }))).toEqual({
      rollingUpdate: { maxSurge: 2, maxUnavailable: 0 },
    });
    expect(poolUpdateStrategyPayload(form({ maxUnavailable: "2" }))).toEqual({
      rollingUpdate: { maxSurge: 0, maxUnavailable: 2 },
    });
  });

  it("sends the type when it is not the stamped rolling update, and no pace with it", () => {
    expect(poolUpdateStrategyPayload(form({ updateStrategyType: "Recreate", maxSurge: "3" }))).toEqual({
      type: "Recreate",
    });
  });

  it("sends nothing while a pace field is being typed into", () => {
    expect(poolUpdateStrategyPayload(form({ maxSurge: "" }))).toBeUndefined();
  });

  it("says what a rollout does to a running fleet, and what it does not hash", () => {
    const fact = poolRolloutFact(form({ maxSurge: "1", maxUnavailable: "2" }));

    expect(fact).toContain("at most 2 replicas unavailable");
    expect(fact).toContain("at most 1 extra one");
    expect(fact).toContain("highest index first");
    expect(fact).toContain("metadata rolls nothing");
  });
});

describe("the spread policy and the constraints it discards", () => {
  it("sends nothing for the schema's own default", () => {
    expect(poolCreatePayload(inputs(), form()).spec.spreadPolicy).toBeUndefined();
  });

  it("sends the policy when it is not the default", () => {
    expect(poolCreatePayload(inputs(), form({ spreadPolicy: "Spread" })).spec.spreadPolicy).toBe("Spread");
  });

  it("states the discard on the control, where an operator looks for it", () => {
    expect(poolSpreadFact(form())).toContain("OVERWRITES");
    expect(poolSpreadFact(form())).toContain("discarded rather than merged");
    expect(poolSpreadFact(form({ spreadPolicy: "Spread" }))).toContain("hostname topology constraint");
    expect(poolSpreadFact(form())).toContain("adds no constraint at all");
  });

  it("carries the discard into the summary", () => {
    expect(poolCreateSummary(inputs(), form()).notes.join(" ")).toContain("discarded rather than merged");
  });
});

describe("the shared-referent rules", () => {
  it("warns that a DRA claim name is one object shared by every replica, above one", () => {
    const values = form({
      replicas: "3",
      template: template({ gpuBackend: "claim", gpuClaimName: "shared-gpu" }),
    });
    const warning = poolGpuClaimWarning(values) ?? "";

    expect(warning).toContain("the same ResourceClaim shared-gpu");
    expect(warning).toContain("all 3 replicas contend for it");
    // The whole point: it names the field that is per-replica correct.
    expect(warning).toContain("resource claim template");
  });

  it("says nothing about a claim name at one replica", () => {
    expect(
      poolGpuClaimWarning(form({ replicas: "1", template: template({ gpuBackend: "claim", gpuClaimName: "g" }) })),
    ).toBeUndefined();
  });

  it("says nothing about a claim TEMPLATE name, which is the per-replica answer", () => {
    const values = form({
      replicas: "3",
      template: template({ gpuBackend: "claim", gpuClaimTemplateName: "gpu-template" }),
    });

    expect(poolGpuClaimWarning(values)).toBeUndefined();
  });

  it("never blocks on a shared claim: a claim big enough for the fleet is legitimate", () => {
    const values = form({ replicas: "3", template: template({ gpuBackend: "claim", gpuClaimName: "shared-gpu" }) });

    expect(poolCreateBlockingIssues(inputs(), values)).toEqual([]);
  });

  it("says that one seed profile reaches every replica, and where identity can come from", () => {
    const values = form({ replicas: "3", template: template({ seedProfile: "seed-basic" }) });
    const note = poolSeedProfileNote(values) ?? "";

    expect(note).toContain("Every replica is seeded from seed-basic");
    expect(note).toContain("no per-replica substitution");
    expect(note).toContain("<pool>-<index>");
  });

  it("says nothing about a seed at one replica, or on a source that takes none", () => {
    expect(
      poolSeedProfileNote(form({ replicas: "1", template: template({ seedProfile: "seed-basic" }) })),
    ).toBeUndefined();
    expect(
      poolSeedProfileNote(
        form({
          replicas: "3",
          template: template({ bootSource: "kernel", image: "", kernel: "kernel-6-12", seedProfile: "seed-basic" }),
        }),
      ),
    ).toBeUndefined();
  });

  it("warns that a data disk on an existing PVC is one claim shared by N replicas", () => {
    const values = form({
      replicas: "3",
      template: template({ dataDisks: [dataDisk({ source: "pvc", pvc: "data-block", name: "state" })] }),
    });
    const [warning] = poolSharedPvcWarnings(values);

    expect(warning.index).toBe(0);
    expect(warning.message).toContain("All 3 replicas attach the existing claim data-block");
    expect(warning.message).toContain("ReadWriteOnce");
    // And it names the alternative this form has and upstream does not.
    expect(warning.message).toContain("per-replica storage template");
  });

  it("says nothing about a blank or image-backed data disk, which is per replica already", () => {
    const values = form({
      replicas: "3",
      template: template({
        dataDisks: [dataDisk(), dataDisk({ id: "disk-2", name: "extra", source: "image", image: "ubuntu-2404" })],
      }),
    });

    expect(poolSharedPvcWarnings(values)).toEqual([]);
  });

  it("says nothing about a shared PVC at one replica", () => {
    const values = form({
      replicas: "1",
      template: template({ dataDisks: [dataDisk({ source: "pvc", pvc: "data-block", name: "state" })] }),
    });

    expect(poolSharedPvcWarnings(values)).toEqual([]);
  });

  it("leaves the kernel-node rule alone: it is the same rule for a pool", () => {
    const values = form({
      replicas: "3",
      template: template({ bootSource: "kernel", image: "", kernel: "kernel-6-12", nodeName: "worker-a" }),
    });

    // The pin warning is D1's, and the kernel-node rule is still the guest
    // form's own, unchanged and still not a block.
    expect(poolNodePinWarning(values)).toContain("All 3 replicas are pinned");
    expect(poolCreateBlockingIssues(inputs(), values)).toEqual([]);
  });

  it("carries all three into the summary, and only above one replica", () => {
    const values = form({
      replicas: "3",
      template: template({
        seedProfile: "seed-basic",
        gpuBackend: "claim",
        gpuClaimName: "shared-gpu",
        dataDisks: [dataDisk({ source: "pvc", pvc: "data-block", name: "state" })],
      }),
    });
    const summary = poolCreateSummary(inputs(), values);
    const text = [...summary.notes, ...summary.warnings].join(" ");

    expect(text).toContain("Every replica is seeded from seed-basic");
    expect(text).toContain("the same ResourceClaim shared-gpu");
    expect(text).toContain("attach the existing claim data-block");

    const single = poolCreateSummary(inputs(), { ...values, replicas: "1" });
    const singleText = [...single.notes, ...single.warnings].join(" ");

    expect(singleText).not.toContain("contend for it");
    expect(singleText).not.toContain("attach the existing claim data-block");
  });
});

describe("the replica-name collision", () => {
  it("warns with the indices named, and does not block", () => {
    const facts = inputs({ existingNames: ["web-1", "web-3", "other"] });
    const values = form({ name: "web", replicas: "4" });
    const warning = poolReplicaNameWarning(facts, values) ?? "";

    expect(warning).toContain("2 guests");
    expect(warning).toContain("web-1, web-3");
    expect(warning).toContain("not adopted");
    expect(warning).toContain("aborts the reconcile");
    expect(poolCreateBlockingIssues(facts, values)).toEqual([]);
    expect(poolCreateSubmitBlockReason(facts, values)).toBeUndefined();
  });

  it("only counts the indices this pool would really take", () => {
    const facts = inputs({ existingNames: ["web-5"] });

    expect(poolReplicaNameWarning(facts, form({ name: "web", replicas: "3" }))).toBeUndefined();
    expect(poolReplicaNameWarning(facts, form({ name: "web", replicas: "6" }))).toContain("web-5");
  });

  it("says nothing when no name is taken", () => {
    expect(poolReplicaNameWarning(inputs({ existingNames: ["other-0"] }), form({ name: "web" }))).toBeUndefined();
  });

  it("says nothing at all while the pool has no name", () => {
    expect(poolReplicaNameWarning(inputs({ existingNames: ["-0"] }), form({ name: "" }))).toBeUndefined();
  });

  it("never accuses on a refused read, and says the check could not be made", () => {
    const facts = inputs({ existingNames: [], existingNamesUnverified: true });
    const warning = poolReplicaNameWarning(facts, form({ name: "web", replicas: "3" })) ?? "";

    expect(warning).toContain("could not be listed");
    expect(warning).toContain("unknown from here");
    expect(warning).not.toContain("web-0");
    expect(poolCreateBlockingIssues(facts, form({ name: "web", replicas: "3" }))).toEqual([]);
  });

  it("reaches the summary, where the form is tall enough to hide the field", () => {
    const facts = inputs({ existingNames: ["web-0"] });

    expect(poolCreateSummary(facts, form({ name: "web", replicas: "2" })).warnings.join(" ")).toContain("web-0");
  });
});

describe("the clone target node, as a derived preview", () => {
  const cloning = (overrides: Partial<PoolFormValues> = {}) =>
    form({
      name: "web",
      replicas: "3",
      template: template({ bootSource: "clone", image: "", snapshot: "snap-s3" }),
      ...overrides,
    });

  it("walks the Ready, schedulable, non-control-plane nodes in name order", () => {
    expect(schedulableWorkers(inputs())).toEqual(["worker-a", "worker-b"]);
  });

  it("shows which replica lands where, and does not ask for the value", () => {
    const preview = cloneTargetNodePreview(inputs(), cloning()) ?? "";

    expect(preview).toContain("web-0 on worker-a");
    expect(preview).toContain("web-1 on worker-b");
    expect(preview).toContain("web-2 on worker-a");
    expect(preview).toContain("Nothing is sent for it");
  });

  it("says the reconcile aborts when there is no worker at all", () => {
    const preview = cloneTargetNodePreview(inputs({ nodes: [] }), cloning()) ?? "";

    expect(preview).toContain("no Ready, schedulable, non-control-plane node");
    expect(preview).toContain("ABORTS");
  });

  it("marks the preview unverified when the nodes could not be listed", () => {
    const preview = cloneTargetNodePreview(inputs({ nodes: [], nodesUnverified: true }), cloning()) ?? "";

    expect(preview).toContain("could not be listed");
    expect(preview).toContain("the whole reconcile aborts");
  });

  it("is not rendered at all on the two boot sources that have no clone block", () => {
    expect(cloneTargetNodePreview(inputs(), form())).toBeUndefined();
    expect(
      cloneTargetNodePreview(
        inputs(),
        form({ template: template({ bootSource: "kernel", image: "", kernel: "kernel-6-12" }) }),
      ),
    ).toBeUndefined();
  });

  it("lifts G10: a clone pool submits with no target node at all", () => {
    expect(poolCreateBlockingIssues(inputs(), cloning())).toEqual([]);
    expect(poolCreatePayload(inputs(), cloning()).spec.template.spec.cloneFromSnapshot?.targetNode).toBeUndefined();
  });

  it("still blocks the standalone form on the same field, which is the mirror image", () => {
    const values = template({ bootSource: "clone", image: "", snapshot: "snap-s3" });

    expect(guestCreatePayload(inputs(), values).spec.cloneFromSnapshot?.targetNode).toBeUndefined();
    expect(poolCreateSummary(inputs(), cloning()).notes.join(" ")).toContain("walking the 2 Ready");
  });
});

describe("the write summary", () => {
  it("names the one API call this dialog makes", () => {
    expect(poolCreateSummary(inputs(), form({ namespace: "kubeswift", name: "web" })).write).toBe(
      "Create SwiftGuestPool kubeswift/web",
    );
  });

  it("falls back to placeholders rather than disappearing while the head is empty", () => {
    expect(poolCreateSummary(inputs(), form({ namespace: "", name: "" })).write).toBe(
      "Create SwiftGuestPool <namespace>/<name>",
    );
  });

  it("multiplies everything the Create Guest summary enumerates", () => {
    const values = form({
      name: "web",
      replicas: "3",
      template: template({
        seedProfile: "seed-basic",
        dataDisks: [dataDisk(), dataDisk({ id: "disk-2", name: "extra", source: "image", image: "ubuntu-2404" })],
      }),
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" }],
    });
    const notes = poolCreateSummary(inputs(), values).notes.join(" ");

    expect(notes).toContain("3 launcher pods");
    expect(notes).toContain("3 root-disk clones of ubuntu-2404");
    expect(notes).toContain("3 seed Secrets");
    expect(notes).toContain("3 20Gi PVCs for the data disk scratch");
    expect(notes).toContain("3 PVCs cloned from ubuntu-2404 for the data disk extra");
    expect(notes).toContain("3 50Gi PVCs for the storage template state");
    expect(notes).toContain("one set per replica");
  });

  it("does not promise launcher pods for a template that is not started", () => {
    const notes = poolCreateSummary(
      inputs(),
      form({ replicas: "3", template: template({ runPolicy: "Stopped" }) }),
    ).notes.join(" ");

    expect(notes).not.toContain("launcher pods");
    expect(notes).toContain("3 root-disk clones");
  });

  it("reads in the singular for a pool of one", () => {
    const notes = poolCreateSummary(inputs(), form({ replicas: "1" })).notes.join(" ");

    expect(notes).toContain("launcher pod");
    expect(notes).toContain("The one replica of this pool is a full SwiftGuest");
  });

  it("says nothing is created yet for a pool of zero", () => {
    const summary = poolCreateSummary(inputs(), form({ name: "web", replicas: "0" }));

    expect(summary.notes.join(" ")).toContain("No guest is created yet");
    expect(summary.notes.join(" ")).not.toContain(poolFanOutFact);
  });

  it("says how the fan-out really happens, partial creation included", () => {
    expect(poolCreateSummary(inputs(), form({ replicas: "3" })).notes).toContain(poolFanOutFact);
    expect(poolFanOutFact).toContain("ONE unbatched pass");
    expect(poolFanOutFact).toContain("first create error aborts the reconcile");
  });

  it("introduces the embedded form's own lines as being about each replica", () => {
    const summary = poolCreateSummary(inputs(), form({ replicas: "3" }));
    const guest = "The guest class small sizes it";

    expect(summary.notes.join(" ")).toContain("Each of the 3 replicas is a full SwiftGuest");
    expect(summary.notes.join(" ")).toContain(guest);
  });

  it("carries the embedded form's warnings without repeating its write line", () => {
    const values = form({ replicas: "2", template: template({ image: "gone-image" }) });
    const summary = poolCreateSummary(inputs(), values);

    expect(summary.warnings.join(" ")).toContain("No SwiftImage named gone-image");
    expect(summary.notes.join(" ")).not.toContain("Create SwiftGuest ");
    expect(summary.write.startsWith("Create SwiftGuestPool")).toBe(true);
  });

  it("states the ports replacement in the summary as well as at the control", () => {
    const values = form({
      serviceEnabled: true,
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "8080", name: "http" }],
    });

    expect(poolCreateSummary(inputs(), values).notes.join(" ")).toContain("replaces spec.network.ports wholly");
  });

  it("does not state a ports replacement when the pool has no Service", () => {
    expect(poolCreateSummary(inputs(), form()).notes.join(" ")).not.toContain("replaces spec.network.ports wholly");
  });

  it("names the PVCs of every claim template it is going to create", () => {
    const values = form({
      name: "web",
      replicas: "2",
      claimTemplates: [
        { ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" },
        { ...newPoolClaimTemplateRow("claim-2"), name: "logs", size: "5Gi" },
      ],
    });
    const notes = poolCreateSummary(inputs(), values).notes.join(" ");

    expect(notes).toContain("state-web-0");
    expect(notes).toContain("logs-web-0");
  });
});

describe("the submit verdict (W4)", () => {
  it("names the field and the reason, in the reading order of the form", () => {
    const values = form({ namespace: "", name: "", replicas: "-1" });
    const issues = poolCreateBlockingIssues(inputs(), values);

    expect(issues.map((issue) => issue.label).slice(0, 3)).toEqual(["Namespace", "Name", "Replicas"]);
    expect(poolCreateSubmitBlockReason(inputs(), values)).toContain("Namespace:");
  });

  it("carries a non-empty reason on every blocking issue it can produce", () => {
    const forms: PoolFormValues[] = [
      form({ namespace: "", name: "", replicas: "" }),
      form({ name: "Bad_Name" }),
      form({ replicas: "-3" }),
      form({ template: template({ guestClass: "", image: "" }) }),
      form({ replicas: "2", template: template({ interfaces: [interfaceRow({ mac: "52:54:00:00:00:01" })] }) }),
      form({ serviceEnabled: true, servicePorts: [] }),
      form({
        serviceEnabled: true,
        servicePorts: [
          { ...newPoolServicePortRow("service-port-1"), port: "", name: "" },
          { ...newPoolServicePortRow("service-port-2"), port: "70000", name: "" },
        ],
      }),
      form({ claimTemplates: [newPoolClaimTemplateRow("claim-1")] }),
      form({ maxSurge: "0", maxUnavailable: "0" }),
      form({ template: template({ storageAccessMode: "ReadWriteMany", storageVolumeMode: "Filesystem" }) }),
      form({ template: template({ dataDisks: [dataDisk({ name: "" })] }) }),
    ];

    for (const values of forms) {
      for (const issue of poolCreateBlockingIssues(inputs(), values)) {
        expect(issue.label.length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("never produces the two messages the pool's own head already carries", () => {
    const values = form({ namespace: "", name: "", template: template({ name: "", namespace: "" }) });
    const labels = poolCreateBlockingIssues(inputs(), values).map((issue) => issue.label);

    expect(labels.filter((label) => label === "Namespace")).toHaveLength(1);
    expect(labels.filter((label) => label === "Name")).toHaveLength(1);
  });

  it("keeps naming the template's own rows, which is what the embedded form's issues are", () => {
    const values = form({ template: template({ dataDisks: [dataDisk({ name: "", blankSize: "" })] }) });
    const labels = poolCreateBlockingIssues(inputs(), values).map((issue) => issue.label);

    expect(labels).toContain("Data disk 1 name");
    expect(labels).toContain("Data disk 1 size");
  });

  it("names the pool's own rows the way the form numbers them", () => {
    const values = form({
      serviceEnabled: true,
      servicePorts: [
        { ...newPoolServicePortRow("service-port-1"), port: "80", name: "" },
        { ...newPoolServicePortRow("service-port-2"), port: "", name: "" },
      ],
      claimTemplates: [newPoolClaimTemplateRow("claim-1"), newPoolClaimTemplateRow("claim-2")],
    });
    const labels = poolCreateBlockingIssues(inputs(), values).map((issue) => issue.label);

    expect(labels).toContain("Service port 1 name");
    expect(labels).toContain("Service port 2 port");
    expect(labels).toContain("Storage template 1 name");
    expect(labels).toContain("Storage template 2 size");
  });

  it("lets a complete form through", () => {
    expect(poolCreateBlockingIssues(inputs(), form())).toEqual([]);
    expect(poolCreateSubmitBlockReason(inputs(), form())).toBeUndefined();
  });

  it("reports the pool's own head before the template's fields", () => {
    const values = form({ replicas: "", template: template({ guestClass: "" }) });
    const [first] = poolCreateBlockingIssues(inputs(), values);

    expect(first.label).toBe("Replicas");
  });

  it("keeps the errors of the pool's head keyed by field, for the inputs to render", () => {
    const errors = poolCreateErrors(form({ namespace: "", name: "", replicas: "-1" }));

    expect(errors.namespace).toContain("A namespace is required");
    expect(errors.name).toContain("A name is required");
    expect(errors.replicas).toContain("at least 0");
  });
});

describe("the outcome and the footer", () => {
  it("reports the fact that was written, never a prediction", () => {
    expect(poolCreateSuccessMessage("kubeswift", "web")).toBe("SwiftGuestPool kubeswift/web created");
  });

  it("says what to do about a name clash, which store.create is what produces", () => {
    expect(poolCreateFailurePrefix(409, { namespace: "kubeswift", name: "web" })).toContain(
      "A SwiftGuestPool named web already exists in the namespace kubeswift",
    );
  });

  it("says what a 404 means for this create", () => {
    expect(poolCreateFailurePrefix(404, { namespace: "kubeswift", name: "web" })).toContain(
      "the namespace kubeswift or the SwiftGuestPool CRD is gone",
    );
  });

  it("names the verb, the resource and the namespace on a 403", () => {
    const prefix = poolCreateFailurePrefix(403, { namespace: "kubeswift", name: "web" }) ?? "";

    expect(prefix).toContain("swiftguestpools");
    expect(prefix).toContain("kubeswift");
  });

  it("prefixes the API server's own words rather than replacing them", () => {
    const message = poolCreateFailureMessage(
      { code: 409, message: 'swiftguestpools.swift.kubeswift.io "web" already exists', alreadyNotified: false },
      { namespace: "kubeswift", name: "web" },
    );

    expect(message).toContain("Change the name and try again.");
    expect(message).toContain('swiftguestpools.swift.kubeswift.io "web" already exists');
  });

  it("passes an unpredictable failure through as it arrived", () => {
    expect(
      poolCreateFailureMessage(
        { code: 500, message: "internal error", alreadyNotified: false },
        { namespace: "kubeswift", name: "web" },
      ),
    ).toBe("internal error");
  });

  it("names every field the form does not offer, with where to reach it", () => {
    expect(poolExcludedFieldsFooter).toContain("topologySpreadConstraints");
    expect(poolExcludedFieldsFooter).toContain("service.annotations");
    expect(poolExcludedFieldsFooter).toContain("service.loadBalancerClass");
    expect(poolExcludedFieldsFooter).toContain("service.ports[].expose");
    expect(poolExcludedFieldsFooter).toContain("template.metadata");
    expect(poolExcludedFieldsFooter).toContain("dataSourceRef");
    expect(poolExcludedFieldsFooter).toContain("YAML editor");
  });
});

describe("the payload as a whole", () => {
  it("sends the two required fields and nothing else on a plain pool", () => {
    const payload = poolCreatePayload(inputs(), form());

    expect(Object.keys(payload.spec).sort()).toEqual(["replicas", "template"]);
  });

  it("sends each optional block only when the form set it", () => {
    const values = form({
      replicas: "3",
      spreadPolicy: "Spread",
      serviceEnabled: true,
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "80", name: "http" }],
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" }],
      maxUnavailable: "2",
    });
    const payload = poolCreatePayload(inputs(), values);

    expect(Object.keys(payload.spec).sort()).toEqual([
      "replicas",
      "service",
      "spreadPolicy",
      "template",
      "updateStrategy",
      "volumeClaimTemplates",
    ]);
    expect(payload.spec.replicas).toBe(3);
    expect(payload.spec.spreadPolicy).toBe("Spread");
    expect(payload.spec.service).toEqual({ ports: [{ port: 80, name: "http" }] });
    expect(payload.spec.volumeClaimTemplates).toHaveLength(1);
    expect(payload.spec.updateStrategy).toEqual({ rollingUpdate: { maxSurge: 0, maxUnavailable: 2 } });
  });

  it("sends a template whose key set is the Create Guest form's own", () => {
    const values = template({ seedProfile: "seed-basic" });
    const payload = poolCreatePayload(inputs(), form({ template: values }));

    expect(Object.keys(payload.spec.template.spec).sort()).toEqual(
      Object.keys(guestCreatePayload(inputs(), values).spec).sort(),
    );
    expect(Object.keys(payload.spec.template.spec).sort()).toEqual([
      "guestClassRef",
      "imageRef",
      "osType",
      "runPolicy",
      "seedProfileRef",
    ]);
  });

  it("never emits an empty reference, whatever the form holds", () => {
    const payload = poolCreatePayload(inputs(), form({ template: template({ guestClass: "", image: "" }) }));

    expect(payload.spec.template.spec.guestClassRef).toBeUndefined();
    expect(payload.spec.template.spec.imageRef).toBeUndefined();
  });
});

describe("the template's network header under a pool Service", () => {
  const withService = form({
    serviceEnabled: true,
    serviceType: "NodePort",
    servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "80", name: "http" }],
  });

  it("replaces the sentence that is true of a guest and false of a replica", () => {
    const hint = templateNetworkHint(withService) ?? "";

    expect(hint).toContain("nat binding");
    expect(hint).toContain("The pool's own NodePort Service is what carries the ports");
    expect(hint).not.toContain("until a port asks to be exposed");
  });

  it("counts the additional interfaces, which are still the template's own", () => {
    const values = { ...withService, template: template({ interfaces: [interfaceRow()] }) };

    expect(templateNetworkHint(values)).toContain("1 additional interface");
  });

  it("leaves the shipped sentence alone when the pool has no Service", () => {
    expect(templateNetworkHint(form())).toBeUndefined();
    expect(templateNetworkHint({ ...withService, template: template({ networkBinding: "bridge" }) })).toBeUndefined();
  });
});

describe("the collapsed sections' header lines", () => {
  it("says what the spread policy is, without repeating the summary's paragraph", () => {
    expect(poolSpreadHint(form())).toContain("Pack, the schema's default");
    expect(poolSpreadHint(form({ spreadPolicy: "Spread" }))).toContain("hostname constraint on every replica");
    expect(poolSpreadHint(form())).not.toBe(poolSpreadFact(form()));
    expect(poolSpreadHint(form()).length).toBeLessThan(poolSpreadFact(form()).length);
  });

  it("says what the Service is, in one line", () => {
    const withService = form({
      serviceEnabled: true,
      serviceType: "LoadBalancer",
      servicePorts: [{ ...newPoolServicePortRow("service-port-1"), port: "80", name: "http" }],
    });

    expect(poolServiceHint(form())).toContain("None");
    expect(poolServiceHint(withService)).toBe("One LoadBalancer Service across every replica, 1 port.");
    expect(poolServiceHint({ ...withService, template: template({ networkBinding: "bridge" }) })).toContain(
      "bridge-bound template",
    );
    expect(poolServiceHint(withService).length).toBeLessThan(poolServiceFact(withService).length);
  });

  it("says what the rollout is, in one line", () => {
    expect(poolRolloutHint(form())).toBe(
      "RollingUpdate: at most 1 unavailable and 0 extra at a time, highest index first.",
    );
    expect(poolRolloutHint(form({ updateStrategyType: "Recreate" }))).toContain("every replica is replaced at once");
    expect(poolRolloutHint(form()).length).toBeLessThan(poolRolloutFact(form()).length);
  });

  it("keeps the claim row's fact and the summary's note from being the same sentence", () => {
    const values = form({
      name: "web",
      replicas: "3",
      claimTemplates: [{ ...newPoolClaimTemplateRow("claim-1"), name: "state", size: "50Gi" }],
    });
    const row = poolClaimPvcFact(values, values.claimTemplates[0]);
    const note = poolClaimSummaryNote(values, values.claimTemplates[0]);

    // Both carry the real order; only one of them explains the ownership, which
    // the section's own header line already carries.
    expect(row).toContain("state-web-0");
    expect(row).toContain("state-web-2");
    expect(row).toContain("<template>-<pool>-<index>");
    expect(row).not.toContain("owned by the pool");
    expect(note).toContain("gives each of the 3 replicas a 50Gi PVC of its own");
    expect(note).toContain("owned by the pool rather than by the replica");
    expect(poolCreateSummary(inputs(), values).notes).toContain(note);
    expect(poolCreateSummary(inputs(), values).notes).not.toContain(row);
  });
});

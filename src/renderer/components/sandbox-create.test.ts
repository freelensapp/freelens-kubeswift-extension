/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Sandbox Pool form decides (SPEC-0016, slice 1).
//
// The bar the spec sets is one case per rule row plus one per summary line, and
// the pool half of this module is where that bar bites hardest: there is NO
// admission webhook for a SwiftSandboxPool at all, so every rule below is the
// only place it is enforced anywhere, and every summary line is a fact nothing
// on the cluster will ever tell the operator.
//
// Slice 2 extends this file with the sandbox half; nothing here is weakened for
// it, and the slot-shape cases are deliberately written against
// `SlotShapeValues` rather than against the pool, because that is the type the
// two forms share.

import { describe, expect, it } from "vitest";
import {
  addNodeSelectorRow,
  createSandboxPoolTitle,
  defaultMinWarm,
  defaultModelMountPath,
  defaultNetworkMode,
  defaultRootfsMode,
  defaultSandboxPoolForm,
  defaultSlotCpu,
  defaultSlotMemory,
  defaultSlotShape,
  effectiveMinWarm,
  hgxProfileRefusal,
  hgxProfileUnverifiedWarning,
  isHgxTier,
  maxObjectNameLength,
  maxSandboxPoolNameLength,
  maxWarmZeroFact,
  minWarmScalePathFact,
  minWarmZeroFact,
  modelMountPathError,
  modelMountPathRelativeMessage,
  newNodeSelectorRow,
  nodeSelectorErrors,
  nodeSelectorKeyError,
  nodeSelectorMergeFact,
  nodeSelectorPayload,
  nodeSelectorValueError,
  poolCountsFact,
  poolFirstPhaseFact,
  poolIdleGpuFact,
  poolIdleMemoryFact,
  poolNamePatternMessage,
  poolNamespaceRequiredMessage,
  poolRelationshipFact,
  poolSlotNamingFact,
  poolWarmsFact,
  quantityToBytes,
  removeNodeSelectorRow,
  sandboxGpuProfileChoices,
  sandboxGpuSectionHint,
  sandboxImmutabilityBoundary,
  sandboxPoolBlockingIssues,
  sandboxPoolCreateFailureMessage,
  sandboxPoolCreateFailurePrefix,
  sandboxPoolCreatePayload,
  sandboxPoolCreateSuccessMessage,
  sandboxPoolCreateSummary,
  sandboxPoolFooter,
  sandboxPoolNameError,
  sandboxPoolNameWarning,
  sandboxPoolOwnErrors,
  sandboxPoolSubmitBlockReason,
  sandboxRegistrySectionHint,
  slotCpuError,
  slotCpuFormatMessage,
  slotCpuMinimumMessage,
  slotGpuSectionHasError,
  slotImageError,
  slotImageRequiredMessage,
  slotImageWhitespaceMessage,
  slotMemoryError,
  slotNameExample,
  slotRandomSuffixLength,
  slotRegistrySectionHasError,
  slotShapeErrors,
  slotShapePayload,
  slotShapeWarnings,
  updateNodeSelectorRow,
  warmBufferErrors,
  warmBufferFoldMessage,
  warmCount,
} from "./sandbox-create";

import type { GuestGpuProfileFacts } from "./guest-create";
import type { SandboxCreateInputs, SandboxPoolFormValues, SlotShapeValues } from "./sandbox-create";

const pcieProfile: GuestGpuProfileFacts = { name: "e2e-gpu-profile-pcie", count: 1, model: "L40S", tier: "pcie" };
const hgxProfile: GuestGpuProfileFacts = { name: "e2e-gpu-profile-hgx", count: 4, model: "", tier: "hgx-shared" };

function inputs(overrides: Partial<SandboxCreateInputs> = {}): SandboxCreateInputs {
  return {
    secrets: ["e2e-sandbox-registry", "e2e-sandbox-cosign"],
    secretsUnverified: false,
    kernels: ["e2e-kernel-6-12"],
    kernelsUnverified: false,
    gpuProfiles: [pcieProfile, hgxProfile],
    gpuProfilesUnverified: false,
    existingNames: ["e2e-sandbox-pool"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** A slot shape that would submit, so each case can break exactly one thing. */
function shape(overrides: Partial<SlotShapeValues> = {}): SlotShapeValues {
  return { ...defaultSlotShape(), image: "ghcr.io/example/sandbox:warm", ...overrides };
}

/** A pool form that would submit, for the same reason. */
function form(overrides: Partial<SandboxPoolFormValues> = {}): SandboxPoolFormValues {
  const { shape: shapeOverrides, ...rest } = overrides;

  return {
    ...defaultSandboxPoolForm("kubeswift-e2e"),
    name: "warm-pool",
    shape: shapeOverrides ?? shape(),
    ...rest,
  };
}

describe("defaultSandboxPoolForm", () => {
  it("takes the namespace it is given and prefills nothing else", () => {
    const values = defaultSandboxPoolForm("kubeswift-e2e");

    expect(values.namespace).toBe("kubeswift-e2e");
    expect(values.name).toBe("");
    expect(values.minWarm).toBe("");
    expect(values.maxWarm).toBe("");
    expect(values.shape).toEqual(defaultSlotShape());
  });

  it("opens with no namespace at all rather than with the literal default (S2)", () => {
    expect(defaultSandboxPoolForm().namespace).toBe("");
  });

  it("leaves every stamped value empty, so the effective one is shown and none is re-sent", () => {
    const values = defaultSandboxPoolForm();

    expect(values.shape.cpu).toBe("");
    expect(values.shape.memory).toBe("");
    expect(values.shape.rootfsMode).toBe("");
    expect(values.shape.networkMode).toBe("");
    expect(values.shape.modelMountPath).toBe("");
    expect(values.minWarm).toBe("");
  });

  it("names the verb the OK button carries", () => {
    expect(createSandboxPoolTitle).toBe("Create Sandbox Pool");
  });
});

describe("the schema defaults, as constants", () => {
  it("carries the CRD's own values", () => {
    expect(defaultSlotCpu).toBe("1");
    expect(defaultSlotMemory).toBe("512Mi");
    expect(defaultRootfsMode).toBe("block");
    expect(defaultNetworkMode).toBe("restricted");
    expect(defaultModelMountPath).toBe("/model");
    expect(defaultMinWarm).toBe("1");
  });
});

describe("the immutability boundary, as one exported fact", () => {
  it("says nothing on a pool is immutable, and that live slots keep the shape they booted with", () => {
    expect(sandboxImmutabilityBoundary.pool).toContain("nothing on it is immutable");
    expect(sandboxImmutabilityBoundary.pool).toContain("keep the shape they booted with");
  });

  it("says everything but ttl is immutable on a sandbox, and that the rule ships disabled", () => {
    expect(sandboxImmutabilityBoundary.sandbox).toContain("except ttl is immutable");
    expect(sandboxImmutabilityBoundary.sandbox).toContain("ships disabled");
  });
});

describe("sandboxPoolNameError (B1)", () => {
  it("accepts a DNS-1123 subdomain", () => {
    expect(sandboxPoolNameError("warm-pool")).toBeUndefined();
    expect(sandboxPoolNameError("team.warm-pool-1")).toBeUndefined();
  });

  it("requires a name, and says what it is the name of", () => {
    expect(sandboxPoolNameError("")).toContain("A name is required");
    expect(sandboxPoolNameError("   ")).toContain("every warm slot of this pool is named after");
  });

  it("refuses uppercase, underscores and a leading dash", () => {
    expect(sandboxPoolNameError("Warm-Pool")).toBe(poolNamePatternMessage);
    expect(sandboxPoolNameError("warm_pool")).toBe(poolNamePatternMessage);
    expect(sandboxPoolNameError("-warm")).toBe(poolNamePatternMessage);
  });

  it("caps the name at 242, which is 253 minus '-slot-' minus the five random characters", () => {
    expect(maxSandboxPoolNameLength).toBe(242);
    expect(maxObjectNameLength - "-slot-".length - slotRandomSuffixLength).toBe(maxSandboxPoolNameLength);
  });

  it("accepts the boundary and refuses one character past it", () => {
    expect(sandboxPoolNameError("a".repeat(maxSandboxPoolNameLength))).toBeUndefined();

    const refusal = sandboxPoolNameError("a".repeat(maxSandboxPoolNameLength + 1));

    expect(refusal).toContain(`at most ${maxSandboxPoolNameLength} characters`);
    expect(refusal).toContain(`this one is ${maxSandboxPoolNameLength + 1}`);
  });

  it("names the arithmetic and the fact that nothing upstream checks it", () => {
    const refusal = sandboxPoolNameError("a".repeat(300));

    expect(refusal).toContain("<pool>-slot-");
    expect(refusal).toContain("253");
    expect(refusal).toContain("there is no pool webhook");
  });

  it("shows what a slot pod will be called", () => {
    expect(slotNameExample("warm-pool")).toMatch(/^warm-pool-slot-[a-z0-9]{5}$/);
    expect(slotNameExample("")).toContain("<name>");
  });
});

describe("slotImageError (B2)", () => {
  it("accepts a tag and a digest", () => {
    expect(slotImageError("ghcr.io/example/sandbox:warm")).toBeUndefined();
    expect(slotImageError(`ghcr.io/example/sandbox@sha256:${"0".repeat(64)}`)).toBeUndefined();
  });

  it("requires one, and says a claiming sandbox must request the same", () => {
    expect(slotImageError("")).toBe(slotImageRequiredMessage);
    expect(slotImageRequiredMessage).toContain("must request the same one");
  });

  it("refuses whitespace around and inside it, with what a padded reference produces", () => {
    expect(slotImageError(" ghcr.io/example/sandbox:warm")).toBe(slotImageWhitespaceMessage);
    expect(slotImageError("ghcr.io/example/sand box:warm")).toBe(slotImageWhitespaceMessage);
    expect(slotImageWhitespaceMessage).toContain("no admission webhook");
  });
});

describe("slotCpuError and slotMemoryError (positive quantities)", () => {
  it("leaves both empty fields alone, because both are defaulted by the schema", () => {
    expect(slotCpuError("")).toBeUndefined();
    expect(slotMemoryError("")).toBeUndefined();
  });

  it("accepts a whole vCPU count of at least one", () => {
    expect(slotCpuError("1")).toBeUndefined();
    expect(slotCpuError("16")).toBeUndefined();
  });

  it("refuses a fractional or non-numeric vCPU count as the int32 it is", () => {
    expect(slotCpuError("1.5")).toBe(slotCpuFormatMessage);
    expect(slotCpuError("two")).toBe(slotCpuFormatMessage);
  });

  it("refuses zero and negative vCPUs with the schema's own minimum", () => {
    expect(slotCpuError("0")).toBe(slotCpuMinimumMessage);
    expect(slotCpuError("-2")).toBe(slotCpuMinimumMessage);
    expect(slotCpuMinimumMessage).toContain("at least 1 vCPU");
  });

  it("accepts a quantity and refuses zero, a negative one and a non-quantity", () => {
    expect(slotMemoryError("2Gi")).toBeUndefined();
    expect(slotMemoryError("0")).toContain("zero");
    expect(slotMemoryError("-1Gi")).toContain("negative");
    expect(slotMemoryError("lots")).toContain("not a Kubernetes quantity");
  });

  it("warns about a unitless memory rather than refusing it", () => {
    const warnings = slotShapeWarnings(inputs(), shape({ memory: "4" }));

    expect(warnings.memory).toContain("4 bytes");
    expect(slotShapeErrors(inputs(), shape({ memory: "4" })).memory).toBeUndefined();
  });
});

describe("modelMountPathError", () => {
  it("accepts an absolute path and the empty one", () => {
    expect(modelMountPathError("/weights")).toBeUndefined();
    expect(modelMountPathError("")).toBeUndefined();
  });

  it("refuses a relative one, and says what it produces", () => {
    expect(modelMountPathError("weights")).toBe(modelMountPathRelativeMessage);
    expect(modelMountPathError("./weights")).toBe(modelMountPathRelativeMessage);
    expect(modelMountPathRelativeMessage).toContain("not where the workload looks for them");
  });

  it("only blocks the create when a model image is named, since the block is dropped without one", () => {
    expect(slotShapeErrors(inputs(), shape({ modelMountPath: "weights" })).modelMountPath).toBeUndefined();
    expect(
      slotShapeErrors(inputs(), shape({ modelImageRef: "ghcr.io/example/model:v1", modelMountPath: "weights" }))
        .modelMountPath,
    ).toBe(modelMountPathRelativeMessage);
  });
});

describe("the node selector rows", () => {
  it("adds, updates and removes a row without touching the rest of the shape", () => {
    const added = addNodeSelectorRow(shape());

    expect(added.nodeSelector).toHaveLength(1);
    expect(added.image).toBe("ghcr.io/example/sandbox:warm");

    const filled = updateNodeSelectorRow(added, added.nodeSelector[0].id, { key: "disk", value: "nvme" });

    expect(filled.nodeSelector[0]).toMatchObject({ key: "disk", value: "nvme" });
    expect(removeNodeSelectorRow(filled, filled.nodeSelector[0].id).nodeSelector).toEqual([]);
  });

  it("gives every row an id of its own", () => {
    const two = addNodeSelectorRow(addNodeSelectorRow(shape()));

    expect(new Set(two.nodeSelector.map((row) => row.id)).size).toBe(2);
  });

  it("accepts a bare key and a prefixed one", () => {
    expect(nodeSelectorKeyError("disk")).toBeUndefined();
    expect(nodeSelectorKeyError("kubeswift.io/kernel-node")).toBeUndefined();
  });

  it("refuses a malformed prefix and a malformed name, naming the Pod that would be refused", () => {
    expect(nodeSelectorKeyError("Not A Prefix/disk")).toContain("DNS-1123 subdomain");
    expect(nodeSelectorKeyError("disk!")).toContain("at most 63 characters");
    expect(nodeSelectorKeyError("a".repeat(64))).toContain("at most 63 characters");
  });

  it("accepts an empty value, and refuses a malformed one", () => {
    expect(nodeSelectorValueError("")).toBeUndefined();
    expect(nodeSelectorValueError("nvme")).toBeUndefined();
    expect(nodeSelectorValueError("with space")).toContain("at most 63 characters");
  });

  it("refuses a value with no key, because a map has no such entry", () => {
    const rows = [{ ...newNodeSelectorRow("node-selector-1"), value: "nvme" }];
    const [messages] = nodeSelectorErrors(shape({ nodeSelector: rows }));

    expect(messages.key).toContain("A label key is required once the row has a value");
  });

  it("leaves an entirely empty row alone, and drops it from the payload", () => {
    const rows = [newNodeSelectorRow("node-selector-1")];

    expect(nodeSelectorErrors(shape({ nodeSelector: rows }))[0]).toEqual({});
    expect(nodeSelectorPayload(shape({ nodeSelector: rows }))).toBeUndefined();
  });

  it("refuses a duplicate key, because the second row would silently replace the first", () => {
    const rows = [
      { ...newNodeSelectorRow("node-selector-1"), key: "disk", value: "nvme" },
      { ...newNodeSelectorRow("node-selector-2"), key: "disk", value: "ssd" },
    ];
    const messages = nodeSelectorErrors(shape({ nodeSelector: rows }));

    expect(messages[0]).toEqual({});
    expect(messages[1].key).toContain("already constrains disk");
  });

  it("states the merge with the kernel-node label the controller adds itself", () => {
    expect(nodeSelectorMergeFact).toContain("kubeswift.io/kernel-node");
    expect(nodeSelectorMergeFact).toContain("MERGED");
  });
});

describe("the warm buffer (B3)", () => {
  it("reads the typed count and falls back to the schema's default", () => {
    expect(warmCount("3")).toBe(3);
    expect(warmCount("")).toBeUndefined();
    expect(warmCount("two")).toBeUndefined();
    expect(effectiveMinWarm(form())).toBe(1);
    expect(effectiveMinWarm(form({ minWarm: "4" }))).toBe(4);
  });

  it("accepts both zeroes, and explains each of them", () => {
    expect(warmBufferErrors(form({ minWarm: "0" }))).toEqual({});
    expect(warmBufferErrors(form({ maxWarm: "0" }))).toEqual({});
    expect(minWarmZeroFact).toContain("warms nothing");
    expect(maxWarmZeroFact).toContain("no-cap sentinel");
  });

  it("refuses a count that is not a whole number", () => {
    expect(warmBufferErrors(form({ minWarm: "1.5" })).minWarm).toContain("whole number");
    expect(warmBufferErrors(form({ maxWarm: "many" })).maxWarm).toContain("whole number");
  });

  it("refuses a negative count with the schema's own minimum", () => {
    expect(warmBufferErrors(form({ minWarm: "-1" })).minWarm).toContain("0 or more");
    expect(warmBufferErrors(form({ maxWarm: "-1" })).maxWarm).toContain("0 or more");
  });

  it("refuses a cap below the floor, with the silent fold as the reason", () => {
    const messages = warmBufferErrors(form({ minWarm: "3", maxWarm: "2" }));

    expect(messages.maxWarm).toContain("A cap of 2 is below this pool's floor of 3");
    expect(messages.maxWarm).toContain(warmBufferFoldMessage);
    expect(warmBufferFoldMessage).toContain("max(minWarm, maxWarm)");
    expect(warmBufferFoldMessage).toContain("no webhook for a pool at all");
  });

  it("names upstream's own two halves: its wizard refuses the pair, its controller folds it", () => {
    expect(warmBufferFoldMessage).toContain("Upstream's own wizard refuses the pair too; its controller does not.");
  });

  it("releases the refusal when either count moves", () => {
    expect(warmBufferErrors(form({ minWarm: "3", maxWarm: "2" })).maxWarm).toBeDefined();
    expect(warmBufferErrors(form({ minWarm: "2", maxWarm: "2" })).maxWarm).toBeUndefined();
    expect(warmBufferErrors(form({ minWarm: "3", maxWarm: "3" })).maxWarm).toBeUndefined();
    expect(warmBufferErrors(form({ minWarm: "3", maxWarm: "" })).maxWarm).toBeUndefined();
  });

  it("does not refuse the zero sentinel below a floor, because it is not a cap at all", () => {
    expect(warmBufferErrors(form({ minWarm: "5", maxWarm: "0" })).maxWarm).toBeUndefined();
  });

  it("compares against the schema's default floor while the floor is untouched", () => {
    expect(warmBufferErrors(form({ minWarm: "", maxWarm: "1" })).maxWarm).toBeUndefined();
  });

  it("names minWarm as the scale subresource's own spec path", () => {
    expect(minWarmScalePathFact).toContain("specReplicasPath: .spec.minWarm");
    expect(minWarmScalePathFact).toContain("HPA");
  });
});

describe("the GPU profile (B4)", () => {
  it("knows the two HGX tiers and the one that is not", () => {
    expect(isHgxTier("hgx-shared")).toBe(true);
    expect(isHgxTier("hgx-full")).toBe(true);
    expect(isHgxTier("pcie")).toBe(false);
    expect(isHgxTier(undefined)).toBe(false);
  });

  it("accepts a pcie-tier profile", () => {
    expect(slotShapeErrors(inputs(), shape({ gpuProfile: "e2e-gpu-profile-pcie" })).gpuProfile).toBeUndefined();
  });

  it("refuses an HGX-tier profile, with the fact that upstream reports it nowhere", () => {
    const refusal = slotShapeErrors(inputs(), shape({ gpuProfile: "e2e-gpu-profile-hgx" })).gpuProfile;

    expect(refusal).toBe(hgxProfileRefusal("e2e-gpu-profile-hgx", "hgx-shared"));
    expect(refusal).toContain("BEFORE the status update");
    expect(refusal).toContain("never reaches Degraded");
    expect(refusal).toContain("empty phase");
  });

  it("refuses the other HGX tier too", () => {
    const hgxFull: GuestGpuProfileFacts = { name: "big", tier: "hgx-full" };
    const facts = inputs({ gpuProfiles: [hgxFull] });

    expect(slotShapeErrors(facts, shape({ gpuProfile: "big" })).gpuProfile).toContain("hgx-full");
  });

  it("degrades to a warning when the profile could not be read at all", () => {
    const facts = inputs({ gpuProfiles: [], gpuProfilesUnverified: true });
    const values = shape({ gpuProfile: "e2e-gpu-profile-hgx" });

    expect(slotShapeErrors(facts, values).gpuProfile).toBeUndefined();
    expect(slotShapeWarnings(facts, values).gpuProfile).toBe(hgxProfileUnverifiedWarning("e2e-gpu-profile-hgx"));
    expect(slotShapeWarnings(facts, values).gpuProfile).toContain("not blocked on a read that failed");
  });

  it("warns about a profile the readable list does not hold, and says the pool parks", () => {
    const warning = slotShapeWarnings(inputs(), shape({ gpuProfile: "no-such-profile" })).gpuProfile;

    expect(warning).toContain("No SwiftGPUProfile named no-such-profile");
    expect(warning).toContain("parks with an empty phase");
  });

  it("offers every profile of the namespace, HGX ones included, with its request on the label", () => {
    const choices = sandboxGpuProfileChoices(inputs());

    expect(choices.map((choice) => choice.name)).toEqual(["e2e-gpu-profile-pcie", "e2e-gpu-profile-hgx"]);
    expect(choices[0].label).toContain("1 GPU");
    expect(choices[1].label).toContain("any model");
  });

  it("opens the collapsed GPU section when it holds the refusal", () => {
    expect(slotGpuSectionHasError(inputs(), shape({ gpuProfile: "e2e-gpu-profile-hgx" }))).toBe(true);
    expect(slotGpuSectionHasError(inputs(), shape())).toBe(false);
  });
});

describe("the other collapsed section", () => {
  it("opens when the model mount path is refused", () => {
    expect(
      slotRegistrySectionHasError(
        inputs(),
        shape({ modelImageRef: "ghcr.io/example/model:v1", modelMountPath: "weights" }),
      ),
    ).toBe(true);
    expect(slotRegistrySectionHasError(inputs(), shape())).toBe(false);
  });
});

describe("the header lines of the two collapsed sections", () => {
  it("says what the GPU section would do while it holds nothing", () => {
    expect(sandboxGpuSectionHint(inputs(), shape())).toContain("warm GPU pool");
    expect(sandboxGpuSectionHint(inputs(), shape())).toContain("None.");
  });

  it("names the profile and the idle GPU once one is picked", () => {
    expect(sandboxGpuSectionHint(inputs(), shape({ gpuProfile: "e2e-gpu-profile-pcie" }))).toContain(
      "holds a whole native GPU allocation idle",
    );
  });

  it("carries the refusal on the header line, so it is readable while the section is shut", () => {
    expect(sandboxGpuSectionHint(inputs(), shape({ gpuProfile: "e2e-gpu-profile-hgx" }))).toContain("HGX-tier profile");
  });

  it("says the registry section holds nothing, and what that means", () => {
    expect(sandboxRegistrySectionHint(shape())).toContain("no signature check");
  });

  it("names each of the three things it holds, and that a claimant inherits them", () => {
    const hint = sandboxRegistrySectionHint(
      shape({
        imagePullSecret: "e2e-sandbox-registry",
        verifyKeySecret: "e2e-sandbox-cosign",
        modelImageRef: "ghcr.io/example/model:v1",
      }),
    );

    expect(hint).toContain("Pulled with e2e-sandbox-registry");
    expect(hint.charAt(0)).toBe("P");
    expect(hint).toContain("cosign-verified by every slot against e2e-sandbox-cosign");
    expect(hint).toContain(`the model ghcr.io/example/model:v1 preloaded read-only at ${defaultModelMountPath}`);
    expect(hint).toContain("Every claiming SwiftSandbox inherits");
  });

  it("capitalizes whichever of the three the line happens to start with", () => {
    expect(sandboxRegistrySectionHint(shape({ verifyKeySecret: "e2e-sandbox-cosign" })).charAt(0)).toBe("C");
    expect(sandboxRegistrySectionHint(shape({ modelImageRef: "ghcr.io/example/model:v1" })).charAt(0)).toBe("T");
  });
});

describe("the reference warnings, which never block", () => {
  it("warns about a kernel profile that is not in the namespace", () => {
    const warning = slotShapeWarnings(inputs(), shape({ kernelProfile: "no-such-kernel" })).kernelProfile;

    expect(warning).toContain("No SwiftKernel named no-such-kernel");
    expect(slotShapeErrors(inputs(), shape({ kernelProfile: "no-such-kernel" })).kernelProfile).toBeUndefined();
  });

  it("marks the kernel name unverified rather than absent when the read was refused", () => {
    const facts = inputs({ kernels: [], kernelsUnverified: true });

    expect(slotShapeWarnings(facts, shape({ kernelProfile: "e2e-kernel-6-12" })).kernelProfile).toContain("unverified");
  });

  it("says nothing about a kernel profile the read really returned", () => {
    expect(slotShapeWarnings(inputs(), shape({ kernelProfile: "e2e-kernel-6-12" })).kernelProfile).toBeUndefined();
  });

  it("warns about each Secret separately, naming what fails on the slot", () => {
    const warnings = slotShapeWarnings(
      inputs(),
      shape({ imagePullSecret: "no-registry", verifyKeySecret: "no-cosign" }),
    );

    expect(warnings.imagePullSecret).toContain("the image pull fails on every slot");
    expect(warnings.verifyKeySecret).toContain("the cosign verification fails on every slot");
  });

  it("marks both Secret names unverified when the namespace read was refused", () => {
    const facts = inputs({ secrets: [], secretsUnverified: true });
    const warnings = slotShapeWarnings(
      facts,
      shape({ imagePullSecret: "e2e-sandbox-registry", verifyKeySecret: "e2e-sandbox-cosign" }),
    );

    expect(warnings.imagePullSecret).toContain("unverified");
    expect(warnings.verifyKeySecret).toContain("unverified");
  });
});

describe("the store collision warning (S1)", () => {
  it("names the taken name, and says the form stays open", () => {
    const warning = sandboxPoolNameWarning(inputs(), form({ name: "e2e-sandbox-pool" }));

    expect(warning).toContain("A SwiftSandboxPool named e2e-sandbox-pool already exists in kubeswift-e2e");
    expect(warning).toContain("stays open");
  });

  it("never blocks: the refusal is the API server's, not this form's", () => {
    expect(sandboxPoolSubmitBlockReason(inputs(), form({ name: "e2e-sandbox-pool" }))).toBeUndefined();
  });

  it("makes a refused read unverifiable rather than absent", () => {
    const facts = inputs({ existingNames: [], existingNamesUnverified: true });
    const warning = sandboxPoolNameWarning(facts, form({ name: "warm-pool" }));

    expect(warning).toContain("could not be listed from here");
    expect(warning).toContain("unverified rather than answered");
  });

  it("says nothing at all when the read answered and the name is free", () => {
    expect(sandboxPoolNameWarning(inputs(), form({ name: "warm-pool" }))).toBeUndefined();
  });

  it("says nothing while there is no name to check", () => {
    expect(sandboxPoolNameWarning(inputs(), form({ name: "" }))).toBeUndefined();
  });
});

describe("the submit verdict (W4)", () => {
  it("requires a namespace, and says what lives in it", () => {
    expect(sandboxPoolOwnErrors(form({ namespace: "" })).namespace).toBe(poolNamespaceRequiredMessage);
    expect(poolNamespaceRequiredMessage).toContain("namespace-local");
  });

  it("names the field and the reason, in the reading order of the form", () => {
    const values = form({ namespace: "", name: "", shape: shape({ image: "" }), maxWarm: "-1" });
    const issues = sandboxPoolBlockingIssues(inputs(), values);

    expect(issues.map((issue) => issue.label)).toEqual(["Namespace", "Name", "Image", "Maximum warm slots"]);
    expect(sandboxPoolSubmitBlockReason(inputs(), values)).toContain("Namespace:");
  });

  it("puts the node-selector rows between the shape and the warm buffer", () => {
    const values = form({
      shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), value: "nvme" }] }),
      minWarm: "-1",
    });

    expect(sandboxPoolBlockingIssues(inputs(), values).map((issue) => issue.label)).toEqual([
      "Node selector 1 label",
      "Warm slots",
    ]);
  });

  it("enables the submit on a form that carries only the required image", () => {
    expect(sandboxPoolSubmitBlockReason(inputs(), form())).toBeUndefined();
  });

  it("carries a non-empty reason on every blocking issue it can produce", () => {
    const forms: SandboxPoolFormValues[] = [
      form({ namespace: "", name: "", shape: shape({ image: "" }) }),
      form({ name: "Bad_Name" }),
      form({ name: "a".repeat(maxSandboxPoolNameLength + 1) }),
      form({ shape: shape({ image: " padded:tag" }) }),
      form({ shape: shape({ cpu: "0" }) }),
      form({ shape: shape({ cpu: "1.5" }) }),
      form({ shape: shape({ memory: "0" }) }),
      form({ shape: shape({ memory: "-1Gi" }) }),
      form({ shape: shape({ memory: "nonsense" }) }),
      form({ shape: shape({ gpuProfile: "e2e-gpu-profile-hgx" }) }),
      form({ shape: shape({ modelImageRef: "ghcr.io/example/model:v1", modelMountPath: "relative" }) }),
      form({ shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), value: "nvme" }] }) }),
      form({
        shape: shape({
          nodeSelector: [
            { ...newNodeSelectorRow("node-selector-1"), key: "disk", value: "nvme" },
            { ...newNodeSelectorRow("node-selector-2"), key: "disk", value: "ssd" },
          ],
        }),
      }),
      form({ shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), key: "Bad Key!" }] }) }),
      form({ shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), key: "k", value: "a b" }] }) }),
      form({ minWarm: "1.5" }),
      form({ minWarm: "-1" }),
      form({ maxWarm: "nope" }),
      form({ maxWarm: "-2" }),
      form({ minWarm: "4", maxWarm: "2" }),
    ];

    for (const values of forms) {
      const issues = sandboxPoolBlockingIssues(inputs(), values);

      expect(issues.length).toBeGreaterThan(0);

      for (const issue of issues) {
        expect(issue.label.length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("blocks nothing on any input that is merely worth a warning", () => {
    const forms: SandboxPoolFormValues[] = [
      form({ name: "e2e-sandbox-pool" }),
      form({ shape: shape({ memory: "4" }) }),
      form({ shape: shape({ kernelProfile: "no-such-kernel" }) }),
      form({ shape: shape({ gpuProfile: "no-such-profile" }) }),
      form({ shape: shape({ imagePullSecret: "no-such-secret", verifyKeySecret: "no-such-key" }) }),
      form({ minWarm: "0" }),
      form({ maxWarm: "0" }),
    ];

    for (const values of forms) {
      expect(sandboxPoolBlockingIssues(inputs(), values)).toEqual([]);
    }
  });
});

describe("sandboxPoolCreatePayload", () => {
  it("sends the image alone when nothing else was touched", () => {
    expect(sandboxPoolCreatePayload(form()).spec).toEqual({ image: "ghcr.io/example/sandbox:warm" });
  });

  it("omits every value the API server stamps (the effective-values rule)", () => {
    const values = form({
      minWarm: defaultMinWarm,
      shape: shape({
        cpu: defaultSlotCpu,
        memory: defaultSlotMemory,
        rootfsMode: defaultRootfsMode,
        networkMode: defaultNetworkMode,
        modelImageRef: "ghcr.io/example/model:v1",
        modelMountPath: defaultModelMountPath,
      }),
    });
    const { spec } = sandboxPoolCreatePayload(values);

    expect(Object.keys(spec).sort()).toEqual(["image", "model"]);
    expect(spec.model).toEqual({ imageRef: "ghcr.io/example/model:v1" });
  });

  it("sends every value that differs from the stamped one", () => {
    const values = form({
      minWarm: "3",
      maxWarm: "6",
      shape: shape({
        cpu: "4",
        memory: "2Gi",
        rootfsMode: "virtiofs",
        networkMode: "none",
        modelImageRef: "ghcr.io/example/model:v1",
        modelMountPath: "/weights",
      }),
    });
    const { spec } = sandboxPoolCreatePayload(values);

    expect(spec.cpu).toBe(4);
    expect(spec.memory).toBe("2Gi");
    expect(spec.rootfsMode).toBe("virtiofs");
    expect(spec.network).toEqual({ mode: "none" });
    expect(spec.minWarm).toBe(3);
    expect(spec.maxWarm).toBe(6);
    expect(spec.model).toEqual({ imageRef: "ghcr.io/example/model:v1", mountPath: "/weights" });
  });

  it("sends a zero floor, because 0 is not the value the schema defaults to", () => {
    expect(sandboxPoolCreatePayload(form({ minWarm: "0" })).spec.minWarm).toBe(0);
  });

  it("sends the zero cap the operator typed, because maxWarm has no default at all", () => {
    expect(sandboxPoolCreatePayload(form({ maxWarm: "0" })).spec.maxWarm).toBe(0);
    expect(sandboxPoolCreatePayload(form({ maxWarm: "" })).spec.maxWarm).toBeUndefined();
  });

  it("never emits an empty-name reference, on any of the four blocks (G7)", () => {
    const { spec } = sandboxPoolCreatePayload(
      form({
        shape: shape({
          kernelProfile: "   ",
          gpuProfile: "",
          verifyKeySecret: "  ",
          imagePullSecret: "",
          modelImageRef: "",
          modelMountPath: "/weights",
        }),
      }),
    );

    expect(spec.kernelProfileRef).toBeUndefined();
    expect(spec.gpuProfileRef).toBeUndefined();
    expect(spec.verifyKeySecretRef).toBeUndefined();
    expect(spec.imagePullSecret).toBeUndefined();
    expect(spec.model).toBeUndefined();
    expect(Object.keys(spec)).toEqual(["image"]);
  });

  it("emits gpuProfileRef only with a name, and the verify block only with a name", () => {
    const { spec } = sandboxPoolCreatePayload(
      form({ shape: shape({ gpuProfile: "e2e-gpu-profile-pcie", verifyKeySecret: "e2e-sandbox-cosign" }) }),
    );

    expect(spec.gpuProfileRef).toEqual({ name: "e2e-gpu-profile-pcie" });
    expect(spec.verifyKeySecretRef).toEqual({ name: "e2e-sandbox-cosign" });
  });

  it("emits the model block only with an imageRef, so a lone mount path is dropped", () => {
    expect(sandboxPoolCreatePayload(form({ shape: shape({ modelMountPath: "/weights" }) })).spec.model).toBeUndefined();
  });

  it("emits the kernel profile reference by name", () => {
    expect(sandboxPoolCreatePayload(form({ shape: shape({ kernelProfile: "e2e-kernel-6-12" }) })).spec).toEqual({
      image: "ghcr.io/example/sandbox:warm",
      kernelProfileRef: { name: "e2e-kernel-6-12" },
    });
  });

  it("omits the node selector when no row carries a key, and sends the rows that do", () => {
    expect(sandboxPoolCreatePayload(form()).spec.nodeSelector).toBeUndefined();

    const rows = [
      { ...newNodeSelectorRow("node-selector-1"), key: "disk", value: "nvme" },
      newNodeSelectorRow("node-selector-2"),
      { ...newNodeSelectorRow("node-selector-3"), key: "zone", value: "" },
    ];

    expect(sandboxPoolCreatePayload(form({ shape: shape({ nodeSelector: rows }) })).spec.nodeSelector).toEqual({
      disk: "nvme",
      zone: "",
    });
  });

  it("trims every value it sends", () => {
    const { spec } = sandboxPoolCreatePayload(
      form({ shape: shape({ image: "ghcr.io/example/sandbox:warm", imagePullSecret: "  e2e-sandbox-registry  " }) }),
    );

    expect(spec.imagePullSecret).toBe("e2e-sandbox-registry");
  });

  it("writes no key the CRD does not declare", () => {
    const declared = [
      "image",
      "memory",
      "cpu",
      "gpuProfileRef",
      "imagePullSecret",
      "kernelProfileRef",
      "maxWarm",
      "minWarm",
      "model",
      "network",
      "nodeSelector",
      "rootfsMode",
      "verifyKeySecretRef",
    ];
    const { spec } = sandboxPoolCreatePayload(
      form({
        minWarm: "2",
        maxWarm: "4",
        shape: shape({
          cpu: "2",
          memory: "1Gi",
          rootfsMode: "virtiofs",
          networkMode: "open",
          kernelProfile: "e2e-kernel-6-12",
          gpuProfile: "e2e-gpu-profile-pcie",
          imagePullSecret: "e2e-sandbox-registry",
          verifyKeySecret: "e2e-sandbox-cosign",
          modelImageRef: "ghcr.io/example/model:v1",
          modelMountPath: "/weights",
          nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), key: "disk", value: "nvme" }],
        }),
      }),
    );

    expect(Object.keys(spec).sort()).toEqual([...declared].sort());
    expect(Object.keys(spec.model ?? {}).sort()).toEqual(["imageRef", "mountPath"]);
    expect(Object.keys(spec.network ?? {})).toEqual(["mode"]);
  });

  it("is the slot shape plus the two counts, and nothing else", () => {
    const values = form({ minWarm: "2", shape: shape({ cpu: "2" }) });
    const { minWarm: _minWarm, ...shapeKeys } = sandboxPoolCreatePayload(values).spec;

    expect(shapeKeys).toEqual(slotShapePayload(values.shape));
  });
});

describe("the sizing arithmetic", () => {
  it("reads a quantity as a byte count", () => {
    expect(quantityToBytes("512Mi")).toBe(512 * 1024 * 1024);
    expect(quantityToBytes("2Gi")).toBe(2 * 1024 ** 3);
    expect(quantityToBytes("1G")).toBe(1_000_000_000);
    expect(quantityToBytes("1024")).toBe(1024);
    expect(quantityToBytes("lots")).toBeUndefined();
  });

  it("multiplies the floor by the memory held per slot", () => {
    const fact = poolIdleMemoryFact(form({ minWarm: "4", shape: shape({ memory: "512Mi" }) }));

    expect(fact).toContain("PER SLOT");
    expect(fact).toContain("4 x 512Mi = 2Gi");
  });

  it("states it against the schema's defaults while both fields are untouched", () => {
    expect(poolIdleMemoryFact(form())).toContain("1 x 512Mi = 512Mi");
  });

  it("says a floor of zero holds nothing idle", () => {
    expect(poolIdleMemoryFact(form({ minWarm: "0" }))).toContain("a floor of 0 holds none");
  });

  it("counts one whole GPU per slot on a GPU pool, from the profile's own count", () => {
    const fact = poolIdleGpuFact(
      inputs(),
      form({ minWarm: "2", shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }),
    );

    expect(fact).toContain("warm GPU pool");
    expect(fact).toContain("2 warm slots hold 2 GPUs");
    expect(fact).toContain("keep the floor at or below N");
  });

  it("falls back to one whole GPU per slot when the profile's count is unknown", () => {
    const facts = inputs({ gpuProfiles: [], gpuProfilesUnverified: true });

    expect(poolIdleGpuFact(facts, form({ shape: shape({ gpuProfile: "unknown" }) }))).toContain("one whole GPU each");
  });

  it("says nothing about GPUs on a pool that names no profile", () => {
    expect(poolIdleGpuFact(inputs(), form())).toBeUndefined();
  });
});

describe("the write summary (W1, W12)", () => {
  it("carries the one create line the dialog is a confirmation of", () => {
    expect(sandboxPoolCreateSummary(inputs(), form()).write).toBe("Create SwiftSandboxPool kubeswift-e2e/warm-pool");
  });

  it("stands in for the missing values while the form is still empty", () => {
    expect(sandboxPoolCreateSummary(inputs(), defaultSandboxPoolForm()).write).toBe(
      "Create SwiftSandboxPool <namespace>/<name>",
    );
  });

  it("says what each slot boots, with the effective values of the untouched fields", () => {
    const [first] = sandboxPoolCreateSummary(inputs(), form()).notes;

    expect(first).toContain("ghcr.io/example/sandbox:warm");
    expect(first).toContain("delivered as block");
    expect(first).toContain("1 vCPU and 512Mi of RAM");
  });

  it("says what warms: an intent ConfigMap and a launcher Pod per slot, both pool-owned", () => {
    const fact = poolWarmsFact(form({ minWarm: "2" }));

    expect(fact).toContain("2 warm slots are asked for");
    expect(fact).toContain("a runtime-intent ConfigMap");
    expect(fact).toContain("a launcher Pod");
    expect(fact).toContain("owned by this pool");
  });

  it("adds the deny-ingress NetworkPolicy only while the slot is networked", () => {
    expect(poolWarmsFact(form())).toContain("a deny-ingress NetworkPolicy");
    expect(poolWarmsFact(form({ shape: shape({ networkMode: "none" }) }))).not.toContain("NetworkPolicy");
  });

  it("says a floor of zero warms nothing yet", () => {
    expect(poolWarmsFact(form({ minWarm: "0" }))).toContain("Nothing warms yet");
  });

  it("states the naming fact, which is not a SwiftGuestPool's ordinal one", () => {
    const fact = poolSlotNamingFact(form());

    expect(fact).toMatch(/warm-pool-slot-[a-z0-9]{5}/);
    expect(fact).toContain("not ordinal and not stable across a recreation");
    expect(fact).toContain("never drains a claimed one");
  });

  it("promises no phase, and names the empty-then-Warming pair", () => {
    expect(poolFirstPhaseFact).toContain("no phase at all, and then Warming");
    expect(poolFirstPhaseFact).toContain("nothing here ever writes Pending");
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).toContain(poolFirstPhaseFact);
  });

  it("says warm plus claimed is not a conserved total", () => {
    expect(poolCountsFact).toContain("NOT a conserved total");
    expect(poolCountsFact).toContain("observedGeneration is stale");
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).toContain(poolCountsFact);
  });

  it("says every field stays editable while live slots keep the shape they booted with", () => {
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).toContain(sandboxImmutabilityBoundary.pool);
  });

  it("states the relationship, and why the sandbox form derives its shape from here", () => {
    expect(poolRelationshipFact).toContain("spec.poolRef");
    expect(poolRelationshipFact).toContain("A miss is never a failure");
    expect(poolRelationshipFact).toContain("nothing upstream checks");
    expect(poolRelationshipFact).toContain("silently runs the workload inside this pool's rootfs");
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).toContain(poolRelationshipFact);
  });

  it("names the scale subresource in the summary as well as at the field", () => {
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).toContain(minWarmScalePathFact);
  });

  it("states the idle memory, and the idle GPUs only on a GPU pool", () => {
    const plain = sandboxPoolCreateSummary(inputs(), form());
    const gpu = sandboxPoolCreateSummary(inputs(), form({ shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }));

    expect(plain.notes.some((note) => note.includes("held PER SLOT"))).toBe(true);
    expect(plain.notes.some((note) => note.includes("warm GPU pool"))).toBe(false);
    expect(gpu.notes.some((note) => note.includes("warm GPU pool"))).toBe(true);
  });

  it("states the verification only when a key is named, and says every slot verifies", () => {
    const notes = sandboxPoolCreateSummary(
      inputs(),
      form({ shape: shape({ verifyKeySecret: "e2e-sandbox-cosign" }) }),
    ).notes;

    expect(notes.some((note) => note.includes("Every warm slot cosign-verifies"))).toBe(true);
    expect(sandboxPoolCreateSummary(inputs(), form()).notes.some((note) => note.includes("cosign-verifies"))).toBe(
      false,
    );
  });

  it("states the model preload only when an image is named, and says the claimant inherits it", () => {
    const notes = sandboxPoolCreateSummary(
      inputs(),
      form({ shape: shape({ modelImageRef: "ghcr.io/example/model:v1" }) }),
    ).notes;

    expect(notes.some((note) => note.includes("/model over virtio-fs"))).toBe(true);
    expect(notes.some((note) => note.includes("Every claiming SwiftSandbox inherits it"))).toBe(true);
  });

  it("states the node-selector merge only when a row carries a key", () => {
    expect(sandboxPoolCreateSummary(inputs(), form()).notes).not.toContain(nodeSelectorMergeFact);
    expect(
      sandboxPoolCreateSummary(
        inputs(),
        form({ shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), key: "disk" }] }) }),
      ).notes,
    ).toContain(nodeSelectorMergeFact);
  });

  it("carries the collision warning above the OK button as well as at the field", () => {
    const { warnings } = sandboxPoolCreateSummary(inputs(), form({ name: "e2e-sandbox-pool" }));

    expect(warnings.some((warning) => warning.includes("already exists in kubeswift-e2e"))).toBe(true);
  });

  it("carries every field warning into the summary, in the reading order of the form", () => {
    const { warnings } = sandboxPoolCreateSummary(
      inputs(),
      form({ shape: shape({ memory: "4", kernelProfile: "no-such-kernel" }) }),
    );

    expect(warnings[0]).toContain("4 bytes");
    expect(warnings[1]).toContain("No SwiftKernel named no-such-kernel");
  });

  it("warns and never blocks on the HGX profile the read could not verify", () => {
    const facts = inputs({ gpuProfiles: [], gpuProfilesUnverified: true });
    const values = form({ shape: shape({ gpuProfile: "e2e-gpu-profile-hgx" }) });

    expect(sandboxPoolCreateSummary(facts, values).warnings.some((warning) => warning.includes("unverified"))).toBe(
      true,
    );
    expect(sandboxPoolSubmitBlockReason(facts, values)).toBeUndefined();
  });
});

describe("the outcome (W9)", () => {
  it("acknowledges the fact that was written, not a prediction", () => {
    expect(sandboxPoolCreateSuccessMessage("kubeswift-e2e", "warm-pool")).toBe(
      "SwiftSandboxPool kubeswift-e2e/warm-pool created",
    );
  });

  it("names the taken name on a 409, which is the failure this form produces on purpose", () => {
    expect(sandboxPoolCreateFailurePrefix(409, { namespace: "kubeswift-e2e", name: "warm-pool" })).toContain(
      "already exists in the namespace kubeswift-e2e",
    );
  });

  it("names the verb, the plural and the namespace on a 403, the expected failure here", () => {
    const prefix = sandboxPoolCreateFailurePrefix(403, { namespace: "kubeswift-e2e", name: "warm-pool" });

    expect(prefix).toContain("create");
    expect(prefix).toContain("swiftsandboxpools");
    expect(prefix).toContain("kubeswift-e2e");
  });

  it("says what is gone on a 404", () => {
    expect(sandboxPoolCreateFailurePrefix(404, { namespace: "kubeswift-e2e", name: "warm-pool" })).toContain(
      "the SwiftSandboxPool CRD is gone",
    );
  });

  it("says nothing it cannot predict", () => {
    expect(sandboxPoolCreateFailurePrefix(500, { namespace: "kubeswift-e2e", name: "warm-pool" })).toBeUndefined();
  });

  it("prefixes its sentence to the API server's words and never replaces them", () => {
    expect(
      sandboxPoolCreateFailureMessage(
        {
          code: 409,
          message: 'swiftsandboxpools.sandbox.kubeswift.io "warm-pool" already exists',
          alreadyNotified: false,
        },
        { namespace: "kubeswift-e2e", name: "warm-pool" },
      ),
    ).toContain("already exists");
  });

  it("passes an unpredictable failure through as it arrived", () => {
    expect(
      sandboxPoolCreateFailureMessage(
        { code: 500, message: "the server is having a moment", alreadyNotified: false },
        { namespace: "kubeswift-e2e", name: "warm-pool" },
      ),
    ).toBe("the server is having a moment");
  });
});

describe("the footer", () => {
  it("says the form authors every field, and what the YAML editor is still for", () => {
    expect(sandboxPoolFooter).toContain("all fourteen fields");
    expect(sandboxPoolFooter).toContain("EDITS a pool afterwards");
    expect(sandboxPoolFooter).toContain("kubectl scale");
  });
});

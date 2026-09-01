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
  addArgvRow,
  addEnvRow,
  addNodeSelectorRow,
  argvErrors,
  argvPayload,
  commandlessCheckoutWarning,
  createSandboxPoolTitle,
  createSandboxTitle,
  defaultMinWarm,
  defaultModelMountPath,
  defaultNetworkMode,
  defaultRootfsMode,
  defaultSandboxForm,
  defaultSandboxGpuTier,
  defaultSandboxPoolForm,
  defaultSlotCpu,
  defaultSlotMemory,
  defaultSlotShape,
  effectiveMinWarm,
  envErrors,
  envPayload,
  goDurationFormatMessage,
  goDurationGrammar,
  hgxProfileRefusal,
  hgxProfileUnverifiedWarning,
  imageEntrypointFact,
  isHgxTier,
  maxObjectNameLength,
  maxSandboxNameLengthWithScratchClaim,
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
  parseGoDurationMs,
  poolCountsFact,
  poolFirstPhaseFact,
  poolIdleGpuFact,
  poolIdleMemoryFact,
  poolNamePatternMessage,
  poolNamespaceRequiredMessage,
  poolRelationshipFact,
  poolSlotNamingFact,
  poolSlotRefusalWording,
  poolSlotWarningWording,
  poolWarmsFact,
  quantityToBytes,
  removeArgvRow,
  removeNodeSelectorRow,
  sandboxBlockingIssues,
  sandboxCheckoutFact,
  sandboxCreateFailureMessage,
  sandboxCreateFailurePrefix,
  sandboxCreateFooter,
  sandboxCreatePayload,
  sandboxCreateSuccessMessage,
  sandboxCreateSummary,
  sandboxCreatesFact,
  sandboxDerivedShape,
  sandboxFirstPhaseFact,
  sandboxGpuDroppedInCheckoutReason,
  sandboxGpuErrors,
  sandboxGpuFact,
  sandboxGpuKernelFact,
  sandboxGpuParksFact,
  sandboxGpuPayload,
  sandboxGpuProfileChoices,
  sandboxGpuSectionHasError,
  sandboxGpuSectionHint,
  sandboxGpuSectionLine,
  sandboxImmutabilityBoundary,
  sandboxModelSectionHasError,
  sandboxModelSectionLine,
  sandboxNameError,
  sandboxNamePatternMessage,
  sandboxNamespaceRequiredMessage,
  sandboxNameWarning,
  sandboxNodeSelectorMergeFact,
  sandboxOwnErrors,
  sandboxOwnWarnings,
  sandboxParksFact,
  sandboxPoolBlockingIssues,
  sandboxPoolChoices,
  sandboxPoolCreateFailureMessage,
  sandboxPoolCreateFailurePrefix,
  sandboxPoolCreatePayload,
  sandboxPoolCreateSuccessMessage,
  sandboxPoolCreateSummary,
  sandboxPoolFooter,
  sandboxPoolNameError,
  sandboxPoolNameWarning,
  sandboxPoolOwnErrors,
  sandboxPoolRequiredMessage,
  sandboxPoolSubmitBlockReason,
  sandboxPoolSummary,
  sandboxRegistrySectionHint,
  sandboxRegistrySectionLine,
  sandboxScratchErrors,
  sandboxScratchFact,
  sandboxScratchSectionHasError,
  sandboxScratchSectionHint,
  sandboxScratchWarnings,
  sandboxShapeErrors,
  sandboxShapeIsAsked,
  sandboxSlotRefusalWording,
  sandboxSlotWarningWording,
  sandboxSourceDescription,
  sandboxSourceLabels,
  sandboxSources,
  sandboxSubmitBlockReason,
  sandboxTerminalFact,
  sandboxTimeoutError,
  sandboxTimeoutFact,
  sandboxTtlError,
  sandboxTtlFact,
  sandboxWorkloadFact,
  scratchClaimSuffix,
  scratchDiskPayload,
  scratchVolumeModeFact,
  setSandboxGpuBackend,
  setSandboxScratchSource,
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
  switchSandboxSource,
  timeoutNotPositiveMessage,
  ttlNotPositiveMessage,
  updateArgvRow,
  updateNodeSelectorRow,
  warmBufferErrors,
  warmBufferFoldMessage,
  warmCount,
} from "./sandbox-create";

import type { GuestGpuProfileFacts } from "./guest-create";
import type {
  SandboxCreateInputs,
  SandboxFormInputs,
  SandboxFormValues,
  SandboxPoolFacts,
  SandboxPoolFormValues,
  SandboxPvcFacts,
  SlotShapeValues,
} from "./sandbox-create";

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

// ===========================================================================
// The sandbox half (SPEC-0016, slice 2).
//
// The bar the spec sets is one case per rule row plus one per summary line, and
// the sixteen-row webhook matrix is where it bites: ELEVEN of those sixteen
// rules are webhook-only - no schema pattern, no CEL, no controller re-check -
// and the webhook ships disabled, so on a normal install this module is the only
// place any of them is enforced anywhere.
//
// Nothing above is weakened for this half. The slot-shape cases stay written
// against `SlotShapeValues`, which is the type the two forms share.
// ===========================================================================

const warmPool: SandboxPoolFacts = {
  name: "e2e-sandbox-pool",
  phase: "Ready",
  warm: 2,
  claimed: 1,
  image: "ghcr.io/example/sandbox:warm",
  cpu: 2,
  memory: "1Gi",
  rootfsMode: "virtiofs",
};

/** A pool nothing has reconciled, which is what every pool this repository creates looks like. */
const coldPool: SandboxPoolFacts = {
  name: "e2e-sandbox-pool-cold",
  image: "ghcr.io/example/sandbox:cold",
  cpu: 1,
  memory: "512Mi",
  rootfsMode: "block",
};

const blockClaim: SandboxPvcFacts = { name: "e2e-data-block", volumeMode: "Block", phase: "Bound" };
const filesystemClaim: SandboxPvcFacts = { name: "e2e-data-filesystem", volumeMode: "Filesystem", phase: "Pending" };

function sandboxInputs(overrides: Partial<SandboxFormInputs> = {}): SandboxFormInputs {
  return {
    ...inputs({ existingNames: ["e2e-sandbox-create-taken"] }),
    pools: [warmPool, coldPool],
    poolsUnverified: false,
    poolsReadAt: "10:15:00",
    pvcs: [blockClaim, filesystemClaim],
    pvcsUnverified: false,
    ...overrides,
  };
}

/** A sandbox form that would submit, so each case can break exactly one thing. */
function sandboxForm(overrides: Partial<SandboxFormValues> = {}): SandboxFormValues {
  return {
    ...defaultSandboxForm("kubeswift-e2e"),
    name: "e2e-sandbox",
    shape: shape(),
    ...overrides,
  };
}

/** The same, already in checkout mode against the warm pool. */
function checkoutForm(overrides: Partial<SandboxFormValues> = {}): SandboxFormValues {
  return sandboxForm({
    source: "checkout",
    pool: warmPool.name,
    shape: defaultSlotShape(),
    command: [{ id: "command-1", value: "/bin/true" }],
    ...overrides,
  });
}

describe("defaultSandboxForm", () => {
  it("takes the namespace it is given and prefills nothing else", () => {
    const values = defaultSandboxForm("kubeswift-e2e");

    expect(values.namespace).toBe("kubeswift-e2e");
    expect(values.name).toBe("");
    expect(values.pool).toBe("");
    expect(values.command).toEqual([]);
    expect(values.args).toEqual([]);
    expect(values.env).toEqual([]);
  });

  it("opens on the cold path, with no scratch disk and no GPU", () => {
    const values = defaultSandboxForm();

    expect(values.source).toBe("new");
    expect(values.scratchSource).toBe("none");
    expect(values.gpuBackend).toBe("none");
  });

  it("opens with no namespace at all rather than with the literal default (S2)", () => {
    expect(defaultSandboxForm().namespace).toBe("");
  });

  it("names the verb the OK button carries", () => {
    expect(createSandboxTitle).toBe("Create Sandbox");
  });
});

// ---------------------------------------------------------------------------
// The sixteen-row webhook matrix, one case per row (S8).
// ---------------------------------------------------------------------------

describe("the sixteen-row webhook matrix", () => {
  it("row 1: refuses a sandbox with no image, which is the schema's own requirement", () => {
    const values = sandboxForm({ shape: shape({ image: "" }) });

    // The sandbox's own words, not the pool's: the same rule, and a different
    // consequence, which is what `SlotShapeRefusalWording` exists for.
    expect(sandboxShapeErrors(sandboxInputs(), values).image).toBe(sandboxSlotRefusalWording.imageRequired);
    expect(sandboxShapeErrors(sandboxInputs(), values).image).not.toBe(slotImageRequiredMessage);
    expect(sandboxShapeErrors(sandboxInputs(), values).image).not.toContain("warm slot");
    expect(sandboxSubmitBlockReason(sandboxInputs(), values)).toContain("Image:");
  });

  it("row 2: refuses a memory that is zero, negative or not a quantity", () => {
    for (const memory of ["0", "-1Gi", "nonsense"]) {
      const values = sandboxForm({ shape: shape({ memory }) });
      const message = sandboxShapeErrors(sandboxInputs(), values).memory;

      expect(message).toBeDefined();
      expect(message?.length).toBeGreaterThan(0);
    }
  });

  it("row 3: refuses a vCPU count below the schema's own minimum of one", () => {
    expect(sandboxShapeErrors(sandboxInputs(), sandboxForm({ shape: shape({ cpu: "0" }) })).cpu).toBe(
      sandboxSlotRefusalWording.cpuMinimum,
    );
    // The pool's version of the same refusal ends "and a pool of them warms
    // nothing", which is not a thing that happens to a sandbox.
    expect(sandboxSlotRefusalWording.cpuMinimum).not.toContain("pool");
    expect(slotCpuMinimumMessage).toContain("pool");
    expect(sandboxShapeErrors(sandboxInputs(), sandboxForm({ shape: shape({ cpu: "1.5" }) })).cpu).toBe(
      slotCpuFormatMessage,
    );
  });

  it("row 4: refuses a name that is not a DNS-1123 subdomain, and caps it at 253", () => {
    expect(sandboxNameError("Bad_Name")).toBe(sandboxNamePatternMessage);
    expect(sandboxNameError("a".repeat(maxObjectNameLength))).toBeUndefined();

    const tooLong = sandboxNameError("a".repeat(maxObjectNameLength + 1));

    expect(tooLong).toContain(`at most ${maxObjectNameLength} characters`);
    expect(tooLong).toContain("becomes a Pod name exactly");
  });

  it("row 5: caps the name at 245 on the blank-scratch branch, because the claim is <name>-scratch", () => {
    expect(maxSandboxNameLengthWithScratchClaim).toBe(maxObjectNameLength - scratchClaimSuffix.length);
    expect(sandboxNameError("a".repeat(maxSandboxNameLengthWithScratchClaim), "blank")).toBeUndefined();

    const tooLong = sandboxNameError("a".repeat(maxSandboxNameLengthWithScratchClaim + 1), "blank");

    expect(tooLong).toContain(`at most ${maxSandboxNameLengthWithScratchClaim} characters`);
    expect(tooLong).toContain(scratchClaimSuffix);
    expect(tooLong).toContain("waits on Binding forever");
    // And the same name is legal without the blank branch, which is what makes
    // the cap a consequence of a choice rather than a preference.
    expect(sandboxNameError("a".repeat(maxSandboxNameLengthWithScratchClaim + 1), "none")).toBeUndefined();
  });

  it("row 6: cannot build an empty scratchDisk at all, on any combination of values (S7)", () => {
    const combinations: SandboxFormValues[] = [
      sandboxForm({ scratchSource: "none" }),
      sandboxForm({ scratchSource: "none", scratchSize: "100Gi", scratchClaim: "e2e-data-block" }),
      sandboxForm({ scratchSource: "blank" }),
      sandboxForm({ scratchSource: "blank", scratchSize: "" }),
      sandboxForm({ scratchSource: "existing" }),
      sandboxForm({ scratchSource: "existing", scratchClaim: "" }),
      sandboxForm({ scratchSource: "existing", scratchClaim: "   " }),
    ];

    for (const values of combinations) {
      const scratchDisk = sandboxCreatePayload(sandboxInputs(), values).spec.scratchDisk;

      expect(scratchDisk === undefined || Object.keys(scratchDisk).length > 0).toBe(true);
    }
  });

  it("row 7: never emits both halves of a scratch disk, because the control is three-way", () => {
    const values = setSandboxScratchSource(
      sandboxForm({ scratchSource: "blank", scratchSize: "100Gi", scratchClaim: "e2e-data-block" }),
      "existing",
    );

    expect(values.scratchSize).toBe("");
    expect(sandboxCreatePayload(sandboxInputs(), values).spec.scratchDisk).toEqual({
      pvcRef: { name: "e2e-data-block" },
    });
  });

  it("row 8: requires a positive size on the blank branch", () => {
    expect(sandboxScratchErrors(sandboxForm({ scratchSource: "blank" })).size).toContain("needs a size");
    expect(sandboxScratchErrors(sandboxForm({ scratchSource: "blank", scratchSize: "0" })).size).toBeDefined();
    expect(sandboxScratchErrors(sandboxForm({ scratchSource: "blank", scratchSize: "-1Gi" })).size).toBeDefined();
    expect(sandboxScratchErrors(sandboxForm({ scratchSource: "blank", scratchSize: "100Gi" })).size).toBeUndefined();
  });

  it("row 9: never sends a volume mode, and says the disk is always Block", () => {
    const values = sandboxForm({ scratchSource: "blank", scratchSize: "100Gi", scratchStorageClass: "fast" });

    expect(sandboxCreatePayload(sandboxInputs(), values).spec.scratchDisk).toEqual({
      blank: { size: "100Gi", storageClassName: "fast" },
    });
    expect(scratchVolumeModeFact).toContain("ALWAYS attached as a raw Block device");
    expect(scratchVolumeModeFact).toContain("no-op on three legs");
  });

  it("row 10: refuses an empty claim name, which is not the same thing as no scratch disk", () => {
    const message = sandboxScratchErrors(sandboxForm({ scratchSource: "existing" })).claim;

    expect(message).toContain("defaults to the empty string");
    expect(message).toContain("not-found forever");
  });

  it("row 11: cannot hold both GPU backends, because moving between them empties the other", () => {
    const withProfile = setSandboxGpuBackend(
      sandboxForm({ gpuBackend: "dra", gpuClaimName: "shared", shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }),
      "profile",
    );

    expect(withProfile.gpuClaimName).toBe("");
    expect(sandboxGpuPayload(withProfile)).toEqual({ gpuProfileRef: { name: "e2e-gpu-profile-pcie" } });

    const withClaim = setSandboxGpuBackend(withProfile, "dra");

    expect(withClaim.shape.gpuProfile).toBe("");
  });

  it("row 12: never sends a GPU together with a pool, whatever the form is holding", () => {
    const values = switchSandboxSource(
      sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }),
      "checkout",
    );

    expect(values.gpuBackend).toBe("none");
    expect(values.shape.gpuProfile).toBe("");

    // And the payload refuses it even on a form that somehow holds both, which
    // is the rule W12 puts on trusting a control.
    const forced: SandboxFormValues = {
      ...values,
      pool: warmPool.name,
      gpuBackend: "profile",
      shape: { ...values.shape, gpuProfile: "e2e-gpu-profile-pcie" },
    };
    const spec = sandboxCreatePayload(sandboxInputs(), forced).spec;

    expect(spec.poolRef).toEqual({ name: warmPool.name });
    expect(spec.gpuProfileRef).toBeUndefined();
    expect(spec.gpuResourceClaim).toBeUndefined();
    expect(sandboxGpuDroppedInCheckoutReason).toContain("mutually exclusive");
    expect(sandboxGpuDroppedInCheckoutReason).toContain("silently ignored");
  });

  it("row 13: refuses a DRA claim that names both, and one that names neither, by both fields", () => {
    const both = sandboxGpuErrors(
      sandboxForm({ gpuBackend: "dra", gpuClaimName: "shared", gpuClaimTemplateName: "per-pod" }),
    );

    expect(both.claimName).toContain("never both");
    expect(both.claimTemplateName).toBe(both.claimName);

    const neither = sandboxGpuErrors(sandboxForm({ gpuBackend: "dra" }));

    expect(neither.claimName).toContain("allocates nothing at all");
  });

  it("row 14: refuses a timeout that is not a positive Go duration, with what it does", () => {
    expect(sandboxTimeoutError("30m")).toBeUndefined();
    expect(sandboxTimeoutError("")).toBeUndefined();
    expect(sandboxTimeoutError("30 minutes")).toBe(goDurationFormatMessage);
    expect(sandboxTimeoutError("0")).toBe(timeoutNotPositiveMessage);
    expect(sandboxTimeoutError("-5m")).toBe(timeoutNotPositiveMessage);
    expect(timeoutNotPositiveMessage).toContain("first five-second poll");
  });

  it("row 15: refuses a ttl that is not a positive Go duration, with the sharper consequence", () => {
    expect(sandboxTtlError("1h")).toBeUndefined();
    expect(sandboxTtlError("")).toBeUndefined();
    expect(sandboxTtlError("forever")).toBe(goDurationFormatMessage);
    expect(sandboxTtlError("0")).toBe(ttlNotPositiveMessage);
    expect(sandboxTtlError("-1h")).toBe(ttlNotPositiveMessage);
    expect(ttlNotPositiveMessage).toContain("DELETES the SwiftSandbox object itself");
  });

  it("row 16: refuses a relative model mount path, only where the block can be sent", () => {
    const withoutImage = sandboxForm({ shape: shape({ modelMountPath: "weights" }) });
    const withImage = sandboxForm({
      shape: shape({ modelImageRef: "ghcr.io/example/model:v1", modelMountPath: "weights" }),
    });

    expect(sandboxShapeErrors(sandboxInputs(), withoutImage).modelMountPath).toBeUndefined();
    expect(sandboxShapeErrors(sandboxInputs(), withImage).modelMountPath).toBe(
      sandboxSlotRefusalWording.modelMountPathRelative,
    );
    expect(sandboxSlotRefusalWording.modelMountPathRelative).not.toContain("pool webhook");
    expect(modelMountPathRelativeMessage).toContain("pool webhook");
    expect(sandboxModelSectionHasError(sandboxInputs(), withImage)).toBe(true);
    expect(sandboxModelSectionHasError(sandboxInputs(), withoutImage)).toBe(false);
  });
});

describe("the submit verdict (W4)", () => {
  it("enables the submit on a form that carries a namespace, a name and an image", () => {
    expect(sandboxSubmitBlockReason(sandboxInputs(), sandboxForm())).toBeUndefined();
  });

  it("requires a namespace, and says what lives in it", () => {
    expect(sandboxOwnErrors(sandboxForm({ namespace: "" })).namespace).toBe(sandboxNamespaceRequiredMessage);
  });

  it("requires a pool on the checkout branch, and says what an empty reference does", () => {
    const message = sandboxOwnErrors(checkoutForm({ pool: "" })).pool;

    expect(message).toBe(sandboxPoolRequiredMessage);
    expect(message).toContain("looked up and reported not-found on every reconcile");
  });

  it("names the field and the reason, in the reading order of the form", () => {
    const values = sandboxForm({ namespace: "", name: "", shape: shape({ image: "" }) });
    const issues = sandboxBlockingIssues(sandboxInputs(), values);

    expect(issues.map((issue) => issue.label)).toEqual(["Namespace", "Name", "Image"]);
    expect(sandboxSubmitBlockReason(sandboxInputs(), values)).toContain("Namespace:");
  });

  it("names the row of every row-shaped reason, because several fields share a label", () => {
    const values = sandboxForm({
      command: [
        { id: "command-1", value: "/bin/sh" },
        { id: "command-2", value: "" },
      ],
      env: [
        { id: "env-1", name: "MODE", value: "fast" },
        { id: "env-2", name: "", value: "x" },
      ],
    });
    const labels = sandboxBlockingIssues(sandboxInputs(), values).map((issue) => issue.label);

    expect(labels).toContain("Command 2");
    expect(labels).toContain("Variable 2 name");
  });

  it("carries a non-empty reason on every blocking issue it can produce", () => {
    const forms: SandboxFormValues[] = [
      sandboxForm({ namespace: "", name: "", shape: shape({ image: "" }) }),
      sandboxForm({ name: "Bad_Name" }),
      sandboxForm({ name: "a".repeat(maxObjectNameLength + 1) }),
      sandboxForm({ name: "a".repeat(maxSandboxNameLengthWithScratchClaim + 1), scratchSource: "blank" }),
      sandboxForm({ shape: shape({ image: " padded:tag" }) }),
      sandboxForm({ shape: shape({ cpu: "0" }) }),
      sandboxForm({ shape: shape({ cpu: "1.5" }) }),
      sandboxForm({ shape: shape({ memory: "0" }) }),
      sandboxForm({ shape: shape({ memory: "-1Gi" }) }),
      sandboxForm({ shape: shape({ memory: "nonsense" }) }),
      sandboxForm({ shape: shape({ modelImageRef: "ghcr.io/example/model:v1", modelMountPath: "weights" }) }),
      sandboxForm({ command: [{ id: "command-1", value: "" }] }),
      sandboxForm({ args: [{ id: "args-1", value: "  " }] }),
      sandboxForm({ env: [{ id: "env-1", name: "", value: "x" }] }),
      sandboxForm({ env: [{ id: "env-1", name: "A B", value: "x" }] }),
      sandboxForm({
        env: [
          { id: "env-1", name: "MODE", value: "fast" },
          { id: "env-2", name: "MODE", value: "slow" },
        ],
      }),
      sandboxForm({ scratchSource: "blank" }),
      sandboxForm({ scratchSource: "blank", scratchSize: "0" }),
      sandboxForm({ scratchSource: "blank", scratchSize: "100Gi", scratchStorageClass: "Bad Class" }),
      sandboxForm({ scratchSource: "existing" }),
      sandboxForm({ gpuBackend: "profile" }),
      sandboxForm({ gpuBackend: "dra" }),
      sandboxForm({ gpuBackend: "dra", gpuClaimName: "a", gpuClaimTemplateName: "b" }),
      sandboxForm({ gpuBackend: "dra", gpuClaimName: "a", gpuRequestName: "Bad Name" }),
      sandboxForm({ timeout: "nonsense" }),
      sandboxForm({ timeout: "-1m" }),
      sandboxForm({ ttl: "nonsense" }),
      sandboxForm({ ttl: "0" }),
      sandboxForm({ shape: shape({ nodeSelector: [{ ...newNodeSelectorRow("node-selector-1"), value: "nvme" }] }) }),
      checkoutForm({ pool: "" }),
    ];

    for (const values of forms) {
      const issues = sandboxBlockingIssues(sandboxInputs(), values);

      expect(issues.length).toBeGreaterThan(0);

      for (const issue of issues) {
        expect(issue.label.length).toBeGreaterThan(0);
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("blocks nothing on any input that is merely worth a warning", () => {
    const forms: SandboxFormValues[] = [
      sandboxForm({ name: "e2e-sandbox-create-taken" }),
      sandboxForm({ shape: shape({ memory: "4" }) }),
      sandboxForm({ shape: shape({ kernelProfile: "no-such-kernel" }) }),
      sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "no-such-profile" }) }),
      // An HGX-tier profile is NOT refused on a sandbox: it parks, where it
      // makes a pool error-backoff with no status at all.
      sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "e2e-gpu-profile-hgx" }) }),
      sandboxForm({ shape: shape({ imagePullSecret: "no-such-secret", verifyKeySecret: "no-such-key" }) }),
      sandboxForm({ scratchSource: "existing", scratchClaim: "e2e-data-filesystem" }),
      checkoutForm(),
      checkoutForm({ command: [] }),
      checkoutForm({ pool: "no-such-pool", shape: shape() }),
    ];

    for (const values of forms) {
      expect(sandboxBlockingIssues(sandboxInputs(), values)).toEqual([]);
    }
  });

  it("does not inherit the pool's HGX refusal, because a sandbox parks on the tier instead", () => {
    const values = sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "e2e-gpu-profile-hgx" }) });

    expect(sandboxGpuErrors(values)).toEqual({});
    expect(sandboxGpuSectionHasError(values)).toBe(false);
    // The pool's own rule is untouched by that, which is the point of the two
    // being different functions.
    expect(slotShapeErrors(inputs(), shape({ gpuProfile: "e2e-gpu-profile-hgx" })).gpuProfile).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The Go durations (A7).
// ---------------------------------------------------------------------------

describe("parseGoDurationMs", () => {
  it("reads the units Go's own parser accepts", () => {
    expect(parseGoDurationMs("30m")).toBe(30 * 60_000);
    expect(parseGoDurationMs("90s")).toBe(90_000);
    expect(parseGoDurationMs("1h")).toBe(3_600_000);
    expect(parseGoDurationMs("500ms")).toBe(500);
    expect(parseGoDurationMs("1us")).toBeCloseTo(0.001);
    expect(parseGoDurationMs("1000ns")).toBeCloseTo(0.001);
  });

  it("reads several pairs run together, which is how Go writes 1h30m", () => {
    expect(parseGoDurationMs("1h30m")).toBe(90 * 60_000);
    expect(parseGoDurationMs("2h45m30s")).toBe((2 * 3600 + 45 * 60 + 30) * 1000);
  });

  it("reads a fraction and a sign", () => {
    expect(parseGoDurationMs("1.5h")).toBe(90 * 60_000);
    expect(parseGoDurationMs("-30m")).toBe(-30 * 60_000);
    expect(parseGoDurationMs("+30m")).toBe(30 * 60_000);
  });

  it("accepts the bare zero Go accepts, and nothing else without a unit", () => {
    expect(parseGoDurationMs("0")).toBe(0);
    expect(parseGoDurationMs("30")).toBeUndefined();
  });

  it("refuses what is not a duration at all", () => {
    for (const value of ["", "  ", "30 minutes", "1d", "h", "1h30", "abc", "1hh"]) {
      expect(parseGoDurationMs(value)).toBeUndefined();
    }
  });

  it("states the grammar it accepts, including that there is no day unit", () => {
    expect(goDurationGrammar).toContain("no day unit");
  });
});

// ---------------------------------------------------------------------------
// The workload (A3).
// ---------------------------------------------------------------------------

describe("the workload rows", () => {
  it("adds, updates and removes an argv row without touching the other list", () => {
    let values = addArgvRow(sandboxForm(), "command");

    values = updateArgvRow(values, "command", values.command[0].id, "/bin/sh");
    values = addArgvRow(values, "args");
    values = updateArgvRow(values, "args", values.args[0].id, "-c");

    expect(values.command.map((row) => row.value)).toEqual(["/bin/sh"]);
    expect(values.args.map((row) => row.value)).toEqual(["-c"]);

    values = removeArgvRow(values, "command", values.command[0].id);

    expect(values.command).toEqual([]);
    expect(values.args).toHaveLength(1);
  });

  it("gives every row an id of its own, in both lists", () => {
    const values = addArgvRow(addArgvRow(addEnvRow(sandboxForm()), "command"), "command");

    expect(new Set(values.command.map((row) => row.id)).size).toBe(2);
    expect(values.env).toHaveLength(1);
  });

  it("refuses an empty argv row rather than dropping it, because position matters", () => {
    const messages = argvErrors([{ id: "command-1", value: "" }], "command");

    expect(messages[0].value).toContain("shifts every element after it");
    expect(argvErrors([{ id: "args-1", value: "-c" }], "args")[0].value).toBeUndefined();
  });

  it("sends each list as the exact array the rows spell, and nothing when there is none", () => {
    expect(argvPayload([])).toBeUndefined();
    expect(
      argvPayload([
        { id: "a", value: " python " },
        { id: "b", value: "-c" },
      ]),
    ).toEqual(["python", "-c"]);
  });

  it("keeps a quoted argument in one element, which is what upstream splits", () => {
    const values = sandboxForm({
      command: [{ id: "command-1", value: "/bin/sh" }],
      args: [
        { id: "args-1", value: "-c" },
        { id: "args-2", value: "echo hello world" },
      ],
    });

    expect(sandboxCreatePayload(sandboxInputs(), values).spec.args).toEqual(["-c", "echo hello world"]);
  });

  it("says what an absent command means, which is a fact and not a missing value", () => {
    expect(imageEntrypointFact).toContain("image config's own Entrypoint and Cmd");
  });

  it("requires an environment variable's name, and refuses what corrupts the merge", () => {
    expect(envErrors(sandboxForm({ env: [{ id: "env-1", name: "", value: "x" }] }))[0].name).toContain("needs a name");
    expect(envErrors(sandboxForm({ env: [{ id: "env-1", name: "A B", value: "x" }] }))[0].name).toContain(
      "no whitespace and no '='",
    );
    expect(envErrors(sandboxForm({ env: [{ id: "env-1", name: "A=B", value: "x" }] }))[0].name).toBeDefined();
  });

  it("refuses a duplicate variable, because the merge keeps one and says nothing", () => {
    const messages = envErrors(
      sandboxForm({
        env: [
          { id: "env-1", name: "MODE", value: "fast" },
          { id: "env-2", name: "MODE", value: "slow" },
        ],
      }),
    );

    expect(messages[0].name).toBeUndefined();
    expect(messages[1].name).toContain("already sets MODE");
  });

  it("sends an empty value as a real variable, and drops a nameless row from the payload", () => {
    const values = sandboxForm({
      env: [
        { id: "env-1", name: "MODE", value: "" },
        { id: "env-2", name: "", value: "orphan" },
      ],
    });

    expect(envPayload(values)).toEqual([{ name: "MODE" }]);
  });

  it("sends the literal values it was given, and never a valueFrom", () => {
    const values = sandboxForm({
      env: [
        { id: "env-1", name: "MODE", value: "fast" },
        { id: "env-2", name: "SEED", value: "7" },
      ],
    });

    for (const entry of envPayload(values) ?? []) {
      expect(Object.keys(entry).sort()).toEqual(["name", "value"]);
    }
  });
});

// ---------------------------------------------------------------------------
// The checkout, the picker and the derivation (A2, S3, S4, S5).
// ---------------------------------------------------------------------------

describe("the checkout", () => {
  it("offers every pool of the namespace with its phase and both counts, and disables none", () => {
    const choices = sandboxPoolChoices(sandboxInputs());

    expect(choices.map((choice) => choice.label)).toEqual([
      "e2e-sandbox-pool - Ready, 2 warm, 1 claimed",
      "e2e-sandbox-pool-cold - no phase yet, 0 warm, 0 claimed",
    ]);
  });

  it("reads a pool with no phase as no phase yet, because nothing here ever writes Pending", () => {
    expect(sandboxPoolSummary(coldPool)).toContain("no phase yet");
  });

  it("derives the four fields from the picked pool, with the time they were read", () => {
    const derived = sandboxDerivedShape(sandboxInputs(), checkoutForm());

    expect(derived).toEqual({
      source: "pool",
      image: warmPool.image,
      cpu: "2",
      memory: "1Gi",
      rootfsMode: "virtiofs",
      readAt: "10:15:00",
    });
  });

  it("sends the four from the pool, even when they equal the schema's own defaults", () => {
    const spec = sandboxCreatePayload(sandboxInputs(), checkoutForm({ pool: coldPool.name })).spec;

    expect(spec.poolRef).toEqual({ name: coldPool.name });
    expect(spec.image).toBe(coldPool.image);
    expect(spec.cpu).toBe(1);
    expect(spec.memory).toBe("512Mi");
    expect(spec.rootfsMode).toBe("block");
  });

  it("ignores whatever the shape's own fields hold once a pool supplies them", () => {
    const values = checkoutForm({ shape: shape({ image: "ghcr.io/example/other:tag", cpu: "8", memory: "16Gi" }) });
    const spec = sandboxCreatePayload(sandboxInputs(), values).spec;

    expect(spec.image).toBe(warmPool.image);
    expect(spec.cpu).toBe(2);
    expect(spec.memory).toBe("1Gi");
  });

  it("asks for the four when the pool list could not be read, and warns that nothing compares them", () => {
    const facts = sandboxInputs({ pools: [], poolsUnverified: true, poolsReadAt: undefined });
    const values = checkoutForm({ shape: shape({ cpu: "2", memory: "1Gi" }) });

    expect(sandboxShapeIsAsked(facts, values)).toBe(true);
    expect(sandboxDerivedShape(facts, values).source).toBe("form");

    const warning = sandboxOwnWarnings(facts, values).pool;

    expect(warning).toContain("could not be read");
    expect(warning).toContain("NOTHING compares them");
    expect(warning).toContain("silently runs this workload inside the pool image's rootfs");
    expect(sandboxBlockingIssues(facts, values)).toEqual([]);
  });

  it("refuses the image again on the degraded branch, because it is schema-required there", () => {
    const facts = sandboxInputs({ pools: [], poolsUnverified: true });
    const values = checkoutForm({ shape: defaultSlotShape() });

    expect(sandboxShapeErrors(facts, values).image).toBe(sandboxSlotRefusalWording.imageRequired);
  });

  it("warns about a pool the read really answered about and did not hold, and never blocks", () => {
    const values = checkoutForm({ pool: "no-such-pool", shape: shape() });
    const warning = sandboxOwnWarnings(sandboxInputs(), values).pool;

    expect(warning).toContain("No SwiftSandboxPool named no-such-pool");
    expect(warning).toContain("slower start rather than a failure");
    expect(sandboxBlockingIssues(sandboxInputs(), values)).toEqual([]);
  });

  it("warns about a command-less checkout, and never blocks it (S5)", () => {
    const summary = sandboxCreateSummary(sandboxInputs(), checkoutForm({ command: [] }));

    expect(summary.warnings).toContain(commandlessCheckoutWarning);
    expect(commandlessCheckoutWarning).toContain("always cold-fall-back");
    expect(sandboxBlockingIssues(sandboxInputs(), checkoutForm({ command: [] }))).toEqual([]);
  });

  it("says nothing about a cold fallback once the checkout names a command", () => {
    expect(sandboxCreateSummary(sandboxInputs(), checkoutForm()).warnings).not.toContain(commandlessCheckoutWarning);
  });

  it("clears what the mode it leaves owned, so the form and the payload cannot disagree", () => {
    const values = switchSandboxSource(
      sandboxForm({
        shape: shape({ networkMode: "open", kernelProfile: "e2e-kernel-6-12", gpuProfile: "e2e-gpu-profile-pcie" }),
        gpuBackend: "profile",
      }),
      "checkout",
    );

    expect(values.shape.networkMode).toBe("");
    expect(values.shape.kernelProfile).toBe("");
    expect(values.shape.nodeSelector).toEqual([]);
    expect(values.gpuBackend).toBe("none");
  });

  it("keeps the image, the vCPUs and the memory across the switch, because the degraded branch needs them", () => {
    const values = switchSandboxSource(sandboxForm({ shape: shape({ cpu: "4", memory: "8Gi" }) }), "checkout");

    expect(values.shape.image).toBe("ghcr.io/example/sandbox:warm");
    expect(values.shape.cpu).toBe("4");
    expect(values.shape.memory).toBe("8Gi");
  });

  it("drops the pool when the form goes back to the cold path", () => {
    expect(switchSandboxSource(checkoutForm(), "new").pool).toBe("");
  });

  it("says what each mode does, in one line apiece", () => {
    expect(sandboxSourceDescription("checkout")).toContain("A miss is not a failure");
    expect(sandboxSourceDescription("new")).toContain("cold path");
    expect(sandboxSources).toEqual(["new", "checkout"]);
    expect(sandboxSourceLabels.checkout).toBe("Check out a warm slot");
  });
});

// ---------------------------------------------------------------------------
// The scratch disk's warnings (A5).
// ---------------------------------------------------------------------------

describe("the scratch disk warnings, which never block", () => {
  it("warns rather than refusing on a Filesystem claim, because nothing enforces the rule", () => {
    const values = sandboxForm({ scratchSource: "existing", scratchClaim: filesystemClaim.name });
    const warning = sandboxScratchWarnings(sandboxInputs(), values).claim;

    expect(warning).toContain("is Filesystem");
    expect(warning).toContain("no CEL and no webhook behind it");
    expect(sandboxScratchErrors(values).claim).toBeUndefined();
    expect(sandboxBlockingIssues(sandboxInputs(), values)).toEqual([]);
  });

  it("says nothing about a Bound Block claim, which is what the field wants", () => {
    const values = sandboxForm({ scratchSource: "existing", scratchClaim: blockClaim.name });

    expect(sandboxScratchWarnings(sandboxInputs(), values).claim).toBeUndefined();
  });

  it("warns about a claim the read answered about and did not hold, with the park", () => {
    const values = sandboxForm({ scratchSource: "existing", scratchClaim: "no-such-claim" });
    const warning = sandboxScratchWarnings(sandboxInputs(), values).claim;

    expect(warning).toContain("No PersistentVolumeClaim named no-such-claim");
    expect(warning).toContain("every three seconds");
    expect(warning).toContain("never turns terminal on its own");
  });

  it("marks the claim unverified when the namespace read was refused", () => {
    const facts = sandboxInputs({ pvcs: [], pvcsUnverified: true });
    const values = sandboxForm({ scratchSource: "existing", scratchClaim: blockClaim.name });
    const warning = sandboxScratchWarnings(facts, values).claim;

    expect(warning).toContain("could not be listed from here");
    expect(warning).toContain("so is its volume mode");
  });

  it("warns about a claim that is not Bound yet, which is what the sandbox waits on", () => {
    const facts = sandboxInputs({ pvcs: [{ name: "pending-claim", volumeMode: "Block", phase: "Pending" }] });
    const values = sandboxForm({ scratchSource: "existing", scratchClaim: "pending-claim" });

    expect(sandboxScratchWarnings(facts, values).claim).toContain("is Pending rather than Bound");
  });

  it("says nothing at all about a scratch disk the form does not have", () => {
    expect(sandboxScratchWarnings(sandboxInputs(), sandboxForm())).toEqual({});
    expect(
      sandboxScratchWarnings(sandboxInputs(), sandboxForm({ scratchSource: "blank", scratchSize: "1Gi" })),
    ).toEqual({});
  });

  it("opens the collapsed section when it holds a refusal", () => {
    expect(sandboxScratchSectionHasError(sandboxForm({ scratchSource: "blank" }))).toBe(true);
    expect(sandboxScratchSectionHasError(sandboxForm({ scratchSource: "blank", scratchSize: "1Gi" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The payload properties.
// ---------------------------------------------------------------------------

describe("sandboxCreatePayload", () => {
  it("sends the image alone when nothing else was touched", () => {
    expect(sandboxCreatePayload(sandboxInputs(), sandboxForm()).spec).toEqual({
      image: "ghcr.io/example/sandbox:warm",
    });
  });

  it("omits every value the API server stamps on the cold path", () => {
    const values = sandboxForm({
      shape: shape({
        cpu: defaultSlotCpu,
        memory: defaultSlotMemory,
        rootfsMode: defaultRootfsMode,
        networkMode: defaultNetworkMode,
        modelImageRef: "ghcr.io/example/model:v1",
        modelMountPath: defaultModelMountPath,
      }),
    });

    expect(sandboxCreatePayload(sandboxInputs(), values).spec).toEqual({
      image: "ghcr.io/example/sandbox:warm",
      model: { imageRef: "ghcr.io/example/model:v1" },
    });
  });

  it("sends every workload field it was given, and nothing it was not", () => {
    const values = sandboxForm({
      command: [{ id: "command-1", value: "python" }],
      args: [
        { id: "args-1", value: "-m" },
        { id: "args-2", value: "http.server" },
      ],
      workingDir: "/workspace",
      env: [{ id: "env-1", name: "MODE", value: "fast" }],
      timeout: "30m",
      ttl: "1h",
    });

    expect(sandboxCreatePayload(sandboxInputs(), values).spec).toEqual({
      image: "ghcr.io/example/sandbox:warm",
      command: ["python"],
      args: ["-m", "http.server"],
      workingDir: "/workspace",
      env: [{ name: "MODE", value: "fast" }],
      timeout: "30m",
      ttl: "1h",
    });
  });

  it("never emits an empty-name reference, on any of the six blocks that carry one (G7)", () => {
    const values = sandboxForm({
      source: "checkout",
      pool: "   ",
      shape: shape({ kernelProfile: "  ", gpuProfile: "  ", verifyKeySecret: "  ", modelImageRef: "  " }),
      scratchSource: "existing",
      scratchClaim: "  ",
      gpuBackend: "profile",
    });
    const spec = sandboxCreatePayload(sandboxInputs(), values).spec;

    expect(spec.poolRef).toBeUndefined();
    expect(spec.kernelProfileRef).toBeUndefined();
    expect(spec.gpuProfileRef).toBeUndefined();
    expect(spec.gpuResourceClaim).toBeUndefined();
    expect(spec.verifyKeySecretRef).toBeUndefined();
    expect(spec.model).toBeUndefined();
    expect(spec.scratchDisk).toBeUndefined();
  });

  it("never emits an empty scratchDisk, and never both of its branches", () => {
    for (const source of ["none", "blank", "existing"] as const) {
      for (const size of ["", "100Gi"]) {
        for (const claim of ["", "e2e-data-block"]) {
          const values = sandboxForm({ scratchSource: source, scratchSize: size, scratchClaim: claim });
          const scratchDisk = sandboxCreatePayload(sandboxInputs(), values).spec.scratchDisk;

          if (scratchDisk) {
            expect(Object.keys(scratchDisk).length).toBe(1);
          }
        }
      }
    }
  });

  it("never sends poolRef together with a GPU backend, on any combination", () => {
    for (const source of ["new", "checkout"] as const) {
      for (const backend of ["none", "profile", "dra"] as const) {
        const values = sandboxForm({
          source,
          pool: source === "checkout" ? warmPool.name : "",
          gpuBackend: backend,
          shape: shape({ gpuProfile: backend === "profile" ? "e2e-gpu-profile-pcie" : "" }),
          gpuClaimName: backend === "dra" ? "shared" : "",
        });
        const spec = sandboxCreatePayload(sandboxInputs(), values).spec;
        const hasGpu = Boolean(spec.gpuProfileRef ?? spec.gpuResourceClaim);

        expect(Boolean(spec.poolRef) && hasGpu).toBe(false);
      }
    }
  });

  it("writes no key the CRD does not declare", () => {
    const declared = [
      "args",
      "command",
      "cpu",
      "env",
      "gpuProfileRef",
      "gpuResourceClaim",
      "image",
      "imagePullSecret",
      "kernelProfileRef",
      "memory",
      "model",
      "network",
      "nodeSelector",
      "poolRef",
      "rootfsMode",
      "scratchDisk",
      "timeout",
      "ttl",
      "verifyKeySecretRef",
      "workingDir",
    ];
    const values = sandboxForm({
      command: [{ id: "command-1", value: "python" }],
      args: [{ id: "args-1", value: "-V" }],
      workingDir: "/workspace",
      env: [{ id: "env-1", name: "MODE", value: "fast" }],
      shape: shape({
        cpu: "4",
        memory: "8Gi",
        rootfsMode: "virtiofs",
        networkMode: "open",
        kernelProfile: "e2e-kernel-6-12",
        nodeSelector: [{ id: "node-selector-1", key: "disk", value: "nvme" }],
        imagePullSecret: "e2e-sandbox-registry",
        verifyKeySecret: "e2e-sandbox-cosign",
        modelImageRef: "ghcr.io/example/model:v1",
        modelMountPath: "/models",
      }),
      scratchSource: "blank",
      scratchSize: "100Gi",
      scratchStorageClass: "e2e-slow",
      gpuBackend: "dra",
      gpuClaimName: "shared-claim",
      gpuRequestName: "gpu0",
      gpuTier: "hgx-shared",
      timeout: "30m",
      ttl: "1h",
    });

    for (const key of Object.keys(sandboxCreatePayload(sandboxInputs(), values).spec)) {
      expect(declared).toContain(key);
    }
  });

  it("sends the DRA claim with exactly one of the two names, and never the stamped tier", () => {
    const shared = sandboxForm({ gpuBackend: "dra", gpuClaimName: "shared", gpuTier: defaultSandboxGpuTier });

    expect(sandboxGpuPayload(shared)).toEqual({ gpuResourceClaim: { resourceClaimName: "shared" } });

    const template = sandboxForm({
      gpuBackend: "dra",
      gpuClaimTemplateName: "per-pod",
      gpuRequestName: "gpu0",
      gpuTier: "hgx-full",
    });

    expect(sandboxGpuPayload(template)).toEqual({
      gpuResourceClaim: { resourceClaimTemplateName: "per-pod", requestName: "gpu0", tier: "hgx-full" },
    });
  });

  it("never sends hugepages, which is not offered at all", () => {
    const values = sandboxForm({ gpuBackend: "dra", gpuClaimName: "shared" });
    const claim = sandboxGpuPayload(values).gpuResourceClaim;

    expect(claim && "hugepages" in claim).toBe(false);
  });

  it("emits the blank block only with a size, and the model block only with an imageRef", () => {
    expect(scratchDiskPayload(sandboxForm({ scratchSource: "blank", scratchStorageClass: "fast" }))).toBeUndefined();
    expect(
      sandboxCreatePayload(sandboxInputs(), sandboxForm({ shape: shape({ modelMountPath: "/models" }) })).spec.model,
    ).toBeUndefined();
  });

  it("trims every value it sends", () => {
    const values = sandboxForm({
      command: [{ id: "command-1", value: "  python  " }],
      workingDir: "  /workspace  ",
      env: [{ id: "env-1", name: "  MODE  ", value: "fast" }],
      timeout: "  30m  ",
      ttl: "  1h  ",
      scratchSource: "existing",
      scratchClaim: "  e2e-data-block  ",
    });
    const spec = sandboxCreatePayload(sandboxInputs(), values).spec;

    expect(spec.command).toEqual(["python"]);
    expect(spec.workingDir).toBe("/workspace");
    expect(spec.env).toEqual([{ name: "MODE", value: "fast" }]);
    expect(spec.timeout).toBe("30m");
    expect(spec.ttl).toBe("1h");
    expect(spec.scratchDisk).toEqual({ pvcRef: { name: "e2e-data-block" } });
  });
});

// ---------------------------------------------------------------------------
// The header lines of the four collapsed sections (DESIGN.md section 12).
// ---------------------------------------------------------------------------

describe("the sandbox form's four header lines", () => {
  it("says the scratch disk holds nothing, and what that costs", () => {
    expect(sandboxScratchSectionHint(sandboxForm())).toContain("only the guest's own RAM to write into");
  });

  it("names the claim the blank branch creates, and that it goes with the sandbox", () => {
    const hint = sandboxScratchSectionHint(sandboxForm({ scratchSource: "blank", scratchSize: "100Gi" }));

    expect(hint).toContain("100Gi");
    expect(hint).toContain(`e2e-sandbox${scratchClaimSuffix}`);
    expect(hint).toContain("deleted with it");
    // The always-Block fact is NOT repeated here: it stands where the control
    // would have been, one scroll below, and the summary says it a third time.
    expect(hint).not.toContain("Block");
  });

  it("says an existing claim survives the sandbox, and that it parks until it binds", () => {
    const hint = sandboxScratchSectionHint(sandboxForm({ scratchSource: "existing", scratchClaim: "cache" }));

    expect(hint).toContain("cache");
    expect(hint).toContain("outlives this sandbox");
    expect(hint).toContain("parks until it is Bound");
    expect(hint).not.toContain("Block device");
  });

  it("carries the parks-forever expectation on the GPU header line rather than inside it", () => {
    expect(sandboxGpuSectionLine(sandboxForm())).toContain("parks until the devices are free");
    expect(
      sandboxGpuSectionLine(
        sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }),
      ),
    ).toContain("parks this sandbox forever");
    expect(sandboxGpuSectionLine(sandboxForm({ gpuBackend: "dra" }))).toContain("unschedulable");
  });

  it("says the registry section holds nothing, and names the terminal failure once it does", () => {
    expect(sandboxRegistrySectionLine(shape())).toContain("A public image and no signature check");

    const line = sandboxRegistrySectionLine(
      shape({ imagePullSecret: "e2e-sandbox-registry", verifyKeySecret: "e2e-sandbox-cosign" }),
    );

    expect(line.startsWith("Pulled with e2e-sandbox-registry")).toBe(true);
    expect(line).toContain("TERMINAL");
  });

  it("capitalizes whichever of the registry clauses comes first", () => {
    expect(
      sandboxRegistrySectionLine(shape({ verifyKeySecret: "e2e-sandbox-cosign" })).startsWith("Cosign-verified"),
    ).toBe(true);
  });

  it("says the model section holds nothing, and names the mount point once it does", () => {
    expect(sandboxModelSectionLine(shape())).toContain("Nothing is preloaded");

    const line = sandboxModelSectionLine(shape({ modelImageRef: "ghcr.io/example/model:v1" }));

    expect(line).toContain("ghcr.io/example/model:v1");
    expect(line).toContain(defaultModelMountPath);
    expect(line).toContain("TERMINAL");
  });
});

// ---------------------------------------------------------------------------
// The write summary (W1, W12).
// ---------------------------------------------------------------------------

describe("the sandbox write summary", () => {
  it("carries the one create line the dialog is a confirmation of", () => {
    expect(sandboxCreateSummary(sandboxInputs(), sandboxForm()).write).toBe(
      "Create SwiftSandbox kubeswift-e2e/e2e-sandbox",
    );
  });

  it("stands in for the missing values while the form is still empty", () => {
    expect(sandboxCreateSummary(sandboxInputs(), defaultSandboxForm()).write).toBe(
      "Create SwiftSandbox <namespace>/<name>",
    );
  });

  it("says what the sandbox boots, with the effective values of the untouched fields", () => {
    const [first] = sandboxCreateSummary(sandboxInputs(), sandboxForm()).notes;

    expect(first).toContain("ghcr.io/example/sandbox:warm");
    expect(first).toContain(`delivered as ${defaultRootfsMode}`);
    expect(first).toContain(`${defaultSlotCpu} vCPU`);
    expect(first).toContain(`${defaultSlotMemory} of RAM`);
  });

  it("names the intent ConfigMap, the Pod named exactly after it, and the NetworkPolicy", () => {
    const fact = sandboxCreatesFact(sandboxForm());

    expect(fact).toContain("a runtime-intent ConfigMap");
    expect(fact).toContain("a Pod named exactly e2e-sandbox");
    expect(fact).toContain("a NetworkPolicy");
    expect(fact).toContain("No Service and no Secret are EVER created");
  });

  it("drops the NetworkPolicy on a network mode of none, which is the one mode that gets none", () => {
    expect(sandboxCreatesFact(sandboxForm({ shape: shape({ networkMode: "none" }) }))).not.toContain("NetworkPolicy");
  });

  it("names the scratch claim among what the create makes, only on the blank branch", () => {
    expect(sandboxCreatesFact(sandboxForm({ scratchSource: "blank", scratchSize: "1Gi" }))).toContain(
      `a claim named e2e-sandbox${scratchClaimSuffix}`,
    );
    expect(sandboxCreatesFact(sandboxForm({ scratchSource: "existing", scratchClaim: "cache" }))).not.toContain(
      "a claim named",
    );
  });

  it("says the first observable state is an empty phase, and never promises a Pending row", () => {
    const summary = sandboxCreateSummary(sandboxInputs(), sandboxForm());

    expect(summary.notes).toContain(sandboxFirstPhaseFact);
    expect(sandboxFirstPhaseFact).toContain("EMPTY phase, not Pending");
    expect(sandboxFirstPhaseFact).toContain("written by no controller at all");
  });

  it("says what parks forever, as an empty phase with one False condition", () => {
    expect(sandboxParksFact).toContain("empty phase with one False condition");
    expect(sandboxParksFact).toContain("thirty seconds");
    expect(sandboxParksFact).toContain("three seconds");
    expect(sandboxCreateSummary(sandboxInputs(), sandboxForm()).notes).toContain(sandboxParksFact);
  });

  it("says what is terminal, and that the remedy is a delete and a re-create", () => {
    expect(sandboxTerminalFact).toContain("delete and a re-create");
    expect(sandboxTerminalFact).toContain("non-zero materialize exit");
    expect(sandboxCreateSummary(sandboxInputs(), sandboxForm()).notes).toContain(sandboxTerminalFact);
  });

  it("says what the TTL will do to this object, and what an unset one means", () => {
    expect(sandboxTtlFact(sandboxForm())).toContain("kept until someone deletes it");
    expect(sandboxTtlFact(sandboxForm({ ttl: "1h" }))).toContain("DELETES the SwiftSandbox object itself");
  });

  it("says what a timeout does, which leaves the object behind", () => {
    expect(sandboxTimeoutFact(sandboxForm())).toContain("no run cap at all");
    expect(sandboxTimeoutFact(sandboxForm({ timeout: "30m" }))).toContain("The object itself stays behind");
  });

  it("says only ttl can be changed afterwards, and that an edit is a silent no-op", () => {
    expect(sandboxCreateSummary(sandboxInputs(), sandboxForm()).notes).toContain(sandboxImmutabilityBoundary.sandbox);
  });

  it("says what the workload is, one argv element per row", () => {
    const fact = sandboxWorkloadFact(
      sandboxForm({
        command: [{ id: "command-1", value: "python" }],
        args: [{ id: "args-1", value: "-V" }],
        workingDir: "/workspace",
        env: [{ id: "env-1", name: "MODE", value: "fast" }],
      }),
    );

    expect(fact).toContain("The workload is python -V");
    expect(fact).toContain("nothing is split on whitespace");
    expect(fact).toContain("/workspace");
    expect(fact).toContain("1 environment variable is merged");
  });

  it("says the image's own entrypoint runs when no command is given", () => {
    expect(sandboxWorkloadFact(sandboxForm())).toContain("the image's own entrypoint runs");
    expect(sandboxWorkloadFact(sandboxForm({ args: [{ id: "args-1", value: "-V" }] }))).toContain(
      "with -V appended to it",
    );
  });

  it("says what a checkout does, and that a miss is not a failure", () => {
    const summary = sandboxCreateSummary(sandboxInputs(), checkoutForm());

    expect(summary.notes).toContain(sandboxCheckoutFact);
    expect(sandboxCheckoutFact).toContain("cold-boots if none is");
    expect(sandboxCheckoutFact).toContain("NOT a failure");
    expect(sandboxCheckoutFact).toContain("named after the POOL");
  });

  it("says when the derived values were read, because a pool is mutable", () => {
    const notes = sandboxCreateSummary(sandboxInputs(), checkoutForm()).notes;

    expect(notes.some((note) => note.includes("at 10:15:00") && note.includes("snapshot"))).toBe(true);
  });

  it("says nothing about a derivation on the cold path", () => {
    const notes = sandboxCreateSummary(sandboxInputs(), sandboxForm()).notes;

    expect(notes).not.toContain(sandboxCheckoutFact);
    expect(notes.some((note) => note.includes("snapshot"))).toBe(false);
  });

  it("states the scratch disk only when there is one, and differently per branch", () => {
    expect(sandboxScratchFact(sandboxForm())).toBeUndefined();
    expect(sandboxScratchFact(sandboxForm({ scratchSource: "blank", scratchSize: "100Gi" }))).toContain(
      "DELETED with it",
    );
    expect(sandboxScratchFact(sandboxForm({ scratchSource: "blank", scratchSize: "100Gi" }))).toContain(
      "the cluster's default storage class",
    );
    expect(sandboxScratchFact(sandboxForm({ scratchSource: "existing", scratchClaim: "cache" }))).toContain(
      "NOT owned by the sandbox",
    );
  });

  it("states the GPU only when there is one, with the park and the kernel switch", () => {
    expect(sandboxGpuFact(sandboxForm())).toBeUndefined();
    expect(sandboxGpuFact(checkoutForm())).toBeUndefined();

    const fact = sandboxGpuFact(
      sandboxForm({ gpuBackend: "profile", shape: shape({ gpuProfile: "e2e-gpu-profile-pcie" }) }),
    );

    expect(fact).toContain("e2e-gpu-profile-pcie");
    expect(fact).toContain(sandboxGpuParksFact);
    expect(fact).toContain(sandboxGpuKernelFact);
  });

  it("states the verification only when a key is named, with the re-pin and the terminal failure", () => {
    const notes = sandboxCreateSummary(
      sandboxInputs(),
      sandboxForm({ shape: shape({ verifyKeySecret: "e2e-sandbox-cosign" }) }),
    ).notes;

    expect(notes.some((note) => note.includes("re-pinned to the verified one"))).toBe(true);
    expect(notes.some((note) => note.includes("TERMINAL"))).toBe(true);
  });

  it("states the model only when an image is named, at its effective mount path", () => {
    const notes = sandboxCreateSummary(
      sandboxInputs(),
      sandboxForm({ shape: shape({ modelImageRef: "ghcr.io/example/model:v1" }) }),
    ).notes;

    expect(notes.some((note) => note.includes(`read-only at ${defaultModelMountPath}`))).toBe(true);
  });

  it("states the node-selector merge only when a row carries a key, in a sandbox's own words", () => {
    const values = sandboxForm({
      shape: shape({ nodeSelector: [{ id: "node-selector-1", key: "disk", value: "nvme" }] }),
    });

    expect(sandboxCreateSummary(sandboxInputs(), values).notes).toContain(nodeSelectorMergeFact);
    expect(sandboxNodeSelectorMergeFact).toContain("a sandbox only ever runs on a kernel node");
  });

  it("carries the collision warning above the OK button as well as at the field", () => {
    const values = sandboxForm({ name: "e2e-sandbox-create-taken" });
    const warning = sandboxNameWarning(sandboxInputs(), values);

    expect(warning).toContain("A SwiftSandbox named e2e-sandbox-create-taken already exists");
    expect(sandboxCreateSummary(sandboxInputs(), values).warnings).toContain(warning);
    expect(sandboxBlockingIssues(sandboxInputs(), values)).toEqual([]);
  });

  it("makes a refused sandbox read unverifiable rather than absent", () => {
    const facts = sandboxInputs({ existingNames: [], existingNamesUnverified: true });

    expect(sandboxNameWarning(facts, sandboxForm())).toContain("unverified rather than answered");
  });

  it("says nothing at all when the read answered and the name is free", () => {
    expect(sandboxNameWarning(sandboxInputs(), sandboxForm())).toBeUndefined();
  });

  it("carries the shape warnings in the reading order of the form, in a sandbox's own words", () => {
    const values = sandboxForm({
      shape: shape({ memory: "4", kernelProfile: "no-such-kernel", imagePullSecret: "no-such-secret" }),
    });
    const warnings = sandboxCreateSummary(sandboxInputs(), values).warnings;

    expect(warnings.some((warning) => warning.includes("4 bytes"))).toBe(true);
    expect(
      warnings.some((warning) => warning.includes("its launcher never boots") || warning.includes("guest never boots")),
    ).toBe(true);
    expect(warnings.some((warning) => warning.includes("TERMINAL failure"))).toBe(true);
  });

  it("drops the GPU profile's own warning with the section a checkout removes", () => {
    const values: SandboxFormValues = { ...checkoutForm(), shape: shape({ gpuProfile: "no-such-profile" }) };

    expect(
      sandboxCreateSummary(sandboxInputs(), values).warnings.some((warning) => warning.includes("no-such-profile")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The outcome (W9) and the footer (A10).
// ---------------------------------------------------------------------------

describe("the sandbox outcome", () => {
  it("acknowledges the fact that was written, not a prediction", () => {
    expect(sandboxCreateSuccessMessage("kubeswift-e2e", "e2e-sandbox")).toBe(
      "SwiftSandbox kubeswift-e2e/e2e-sandbox created",
    );
  });

  it("names the taken name on a 409, which is the failure the reopen path exists for", () => {
    expect(sandboxCreateFailurePrefix(409, { namespace: "kubeswift-e2e", name: "taken" })).toContain(
      "A SwiftSandbox named taken already exists in the namespace kubeswift-e2e",
    );
  });

  it("names the verb, the plural and the namespace on a 403, the expected failure here", () => {
    const prefix = sandboxCreateFailurePrefix(403, { namespace: "kubeswift-e2e", name: "x" });

    expect(prefix).toContain("create");
    expect(prefix).toContain("swiftsandboxes");
    expect(prefix).toContain("kubeswift-e2e");
  });

  it("says what is gone on a 404, and nothing it cannot predict", () => {
    expect(sandboxCreateFailurePrefix(404, { namespace: "kubeswift-e2e", name: "x" })).toContain(
      "the SwiftSandbox CRD is gone",
    );
    expect(sandboxCreateFailurePrefix(500, { namespace: "kubeswift-e2e", name: "x" })).toBeUndefined();
  });

  it("prefixes its sentence to the API server's words and never replaces them", () => {
    const message = sandboxCreateFailureMessage(
      { code: 409, message: 'sandboxes.sandbox.kubeswift.io "taken" already exists', alreadyNotified: false },
      { namespace: "kubeswift-e2e", name: "taken" },
    );

    expect(message).toContain("Change the name and try again.");
    expect(message).toContain("already exists");
  });

  it("passes an unpredictable failure through as it arrived", () => {
    expect(
      sandboxCreateFailureMessage(
        { code: 500, message: "boom", alreadyNotified: false },
        {
          namespace: "kubeswift-e2e",
          name: "x",
        },
      ),
    ).toBe("boom");
  });
});

describe("the sandbox footer", () => {
  it("names the three leaves it does not author, each with its reason", () => {
    expect(sandboxCreateFooter).toContain("env[].valueFrom");
    expect(sandboxCreateFooter).toContain("reaches the guest empty");
    expect(sandboxCreateFooter).toContain("scratchDisk.blank.volumeMode");
    expect(sandboxCreateFooter).toContain("no-op on three legs");
    expect(sandboxCreateFooter).toContain("gpuResourceClaim.hugepages");
  });

  it("says that only ttl actually changes anything on an edit", () => {
    expect(sandboxCreateFooter).toContain("only ttl actually changes anything");
  });
});

// ---------------------------------------------------------------------------
// The two kinds' own words.
//
// The rules are shared and the consequences are not, and the screenshot pass
// found five refusals telling a sandbox operator what a POOL would do with the
// value. These are the properties that keep the two apart.
// ---------------------------------------------------------------------------

describe("the wording records", () => {
  it("never tells a sandbox operator what a pool would do", () => {
    const sandboxWords = [
      ...Object.values(sandboxSlotRefusalWording),
      sandboxSlotWarningWording.memoryLabel,
      sandboxSlotWarningWording.kernelUnverified,
      sandboxSlotWarningWording.kernelMissing("k"),
      sandboxSlotWarningWording.gpuProfileMissing("p"),
      sandboxSlotWarningWording.gpuProfileUnverified("p"),
      sandboxSlotWarningWording.secretUnverified("the image pull"),
      sandboxSlotWarningWording.secretMissing("s", "the image pull"),
    ];

    for (const message of sandboxWords) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.toLowerCase()).not.toContain("pool");
      expect(message.toLowerCase()).not.toContain("warm slot");
    }
  });

  it("keeps the pool's own words on the pool, which is where they were written", () => {
    expect(poolSlotRefusalWording.imageRequired).toBe(slotImageRequiredMessage);
    expect(poolSlotRefusalWording.imageWhitespace).toBe(slotImageWhitespaceMessage);
    expect(poolSlotRefusalWording.cpuMinimum).toBe(slotCpuMinimumMessage);
    expect(poolSlotRefusalWording.modelMountPathRelative).toBe(modelMountPathRelativeMessage);
    expect(poolSlotWarningWording.memoryLabel).toBe("slot memory");
  });

  it("keeps every shared rule function on the pool's words by default", () => {
    expect(slotImageError("")).toBe(slotImageRequiredMessage);
    expect(slotCpuError("0")).toBe(slotCpuMinimumMessage);
    expect(modelMountPathError("weights")).toBe(modelMountPathRelativeMessage);
    expect(nodeSelectorKeyError("Bad Key!")).toBe(poolSlotRefusalWording.nodeSelectorKeyName);
  });

  it("takes the sandbox's words when they are handed in", () => {
    expect(slotImageError("", sandboxSlotRefusalWording)).toBe(sandboxSlotRefusalWording.imageRequired);
    expect(slotImageError(" padded", sandboxSlotRefusalWording)).toBe(sandboxSlotRefusalWording.imageWhitespace);
    expect(slotCpuError("0", sandboxSlotRefusalWording)).toBe(sandboxSlotRefusalWording.cpuMinimum);
    expect(modelMountPathError("weights", sandboxSlotRefusalWording)).toBe(
      sandboxSlotRefusalWording.modelMountPathRelative,
    );
    expect(nodeSelectorKeyError("Bad Key!", sandboxSlotRefusalWording)).toBe(
      sandboxSlotRefusalWording.nodeSelectorKeyName,
    );
  });

  it("uses them in the sandbox form's own blocking issues, row by row", () => {
    const values = sandboxForm({
      shape: shape({ nodeSelector: [{ id: "node-selector-1", key: "Bad Key!", value: "" }] }),
    });
    const [issue] = sandboxBlockingIssues(sandboxInputs(), values);

    expect(issue.label).toBe("Node selector 1 label");
    expect(issue.message).toBe(sandboxSlotRefusalWording.nodeSelectorKeyName);
  });
});

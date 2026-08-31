/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Kernel form decides (SPEC-0014, slice 1).
//
// The bar is the shipped small dialogs, counted as `it(...)` blocks: 65 for Take
// Snapshot, 83 for Restore. The kernel sits there because five of the
// validator's six rules exist only in a webhook that ships disabled, so every
// one of them is a case here, and because the number the summary states - how
// many nodes carry the kernel-node label - has three answers rather than two:
// some, none, and a read that was refused.

import { describe, expect, it } from "vitest";
import {
  createKernelTitle,
  defaultKernelForm,
  imagePaddedMessage,
  imageRequiredMessage,
  imageTraversalMessage,
  kernelBlockingIssues,
  kernelCmdlineControlCharacterMessage,
  kernelCmdlineError,
  kernelCmdlineReplacedFact,
  kernelCreateErrors,
  kernelCreateFailureMessage,
  kernelCreateFailurePrefix,
  kernelCreatePayload,
  kernelCreateSuccessMessage,
  kernelCreateSummary,
  kernelCreateWarnings,
  kernelImageError,
  kernelImageIsImmutableInPracticeFact,
  kernelNodeCountFact,
  kernelNodes,
  kernelReadyFact,
  kernelSubmitBlockReason,
  kernelTerminalFailedFact,
  kernelWillParkInPending,
  profileFact,
  pullSecretReachFact,
} from "./kernel-create";
import { kernelNodeLabel, kernelNodeLabelValue } from "./migration-create";

import type { KernelCreateInputs, KernelFormValues } from "./kernel-create";
import type { NodeFacts } from "./migration-create";

function node(name: string, labelled: boolean): NodeFacts {
  return {
    name,
    ready: true,
    schedulable: true,
    labels: labelled ? { [kernelNodeLabel]: kernelNodeLabelValue } : { "kubernetes.io/os": "linux" },
  };
}

function inputs(overrides: Partial<KernelCreateInputs> = {}): KernelCreateInputs {
  return {
    secrets: ["e2e-registry", "e2e-cosign"],
    secretsUnverified: false,
    nodes: [node("node-1", true), node("node-2", false)],
    nodesUnverified: false,
    existingNames: ["e2e-kernel-6-12"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** A form that would submit, so each case can break exactly one thing. */
function values(overrides: Partial<KernelFormValues> = {}): KernelFormValues {
  return {
    ...defaultKernelForm("kubeswift-e2e"),
    name: "linux-6-12",
    image: "ghcr.io/example/kernel:6.12",
    ...overrides,
  };
}

describe("defaultKernelForm", () => {
  it("takes the namespace it is given and prefills nothing else", () => {
    const form = defaultKernelForm("kubeswift-e2e");

    expect(form.namespace).toBe("kubeswift-e2e");
    expect(form.name).toBe("");
    expect(form.image).toBe("");
    expect(form.pullSecret).toBe("");
    expect(form.kernelCmdline).toBe("");
    expect(form.profile).toBe("");
  });

  it("opens with no namespace at all rather than with the literal default", () => {
    expect(defaultKernelForm().namespace).toBe("");
  });

  it("names the verb the OK button carries", () => {
    expect(createKernelTitle).toBe("Create Kernel");
  });
});

describe("kernelImageError", () => {
  it("accepts a tagged reference", () => {
    expect(kernelImageError("ghcr.io/example/kernel:6.12")).toBeUndefined();
  });

  it("accepts a digest reference", () => {
    expect(
      kernelImageError(
        "ghcr.io/example/kernel@sha256:9b2c8f0e3a7d41c5b6e8d90a2f14c7b38e5a6d0c9f3b1e7a4d2c8b5f6a0e9d31",
      ),
    ).toBeUndefined();
  });

  it("accepts a reference with a port in the registry", () => {
    expect(kernelImageError("registry.example.com:5000/kernel:6.12")).toBeUndefined();
  });

  it("requires a reference, and says it is the only field the schema requires", () => {
    expect(kernelImageError("")).toBe(imageRequiredMessage);
    expect(imageRequiredMessage).toContain("the one field the schema requires");
  });

  it("treats a whitespace-only reference as no reference at all", () => {
    expect(kernelImageError("   ")).toBe(imageRequiredMessage);
  });

  it("refuses a padded reference rather than trimming it, as upstream does", () => {
    expect(kernelImageError(" ghcr.io/example/kernel:6.12")).toBe(imagePaddedMessage);
    expect(kernelImageError("ghcr.io/example/kernel:6.12 ")).toBe(imagePaddedMessage);
    expect(kernelImageError("\tghcr.io/example/kernel:6.12\n")).toBe(imagePaddedMessage);
  });

  it("names what a padded reference produces instead of a pull", () => {
    expect(imagePaddedMessage).toContain("a name nobody typed");
  });

  it("refuses a semicolon, naming it as a shell metacharacter", () => {
    const message = kernelImageError("ghcr.io/example/kernel:6.12;id");

    expect(message).toContain("shell metacharacter");
    expect(message).toContain("';'");
  });

  it("refuses the other separators one by one", () => {
    for (const character of ["&", "|", "$", "`", "(", ")", "<", ">", "\\", "'", '"']) {
      expect(kernelImageError(`ghcr.io/example/kernel${character}:6.12`)).toContain("shell metacharacter");
    }
  });

  it("refuses the globbing characters too", () => {
    for (const character of ["*", "?", "[", "]", "{", "}"]) {
      expect(kernelImageError(`ghcr.io/example/kernel${character}:6.12`)).toContain("shell metacharacter");
    }
  });

  it("refuses an internal space, and names it in words rather than as a quoted blank", () => {
    expect(kernelImageError("ghcr.io/example/my kernel:6.12")).toContain("a space");
  });

  it("refuses an internal tab in words as well", () => {
    expect(kernelImageError("ghcr.io/example/my\tkernel:6.12")).toContain("a tab");
  });

  it("says the rule it is enforcing ships disabled", () => {
    expect(kernelImageError("ghcr.io/example/kernel;")).toContain("ships disabled");
  });

  it("refuses a path traversal, and names what it prevents", () => {
    expect(kernelImageError("ghcr.io/example/../kernel:6.12")).toBe(imageTraversalMessage);
    expect(imageTraversalMessage).toContain("path traversal");
  });

  it("refuses a bare .. as well", () => {
    expect(kernelImageError("..")).toBe(imageTraversalMessage);
  });

  it("keeps a single dot legal, which every registry hostname has", () => {
    expect(kernelImageError("ghcr.io/example/kernel:6.12")).toBeUndefined();
  });

  it("never refuses without a reason", () => {
    for (const image of ["", " x ", "a;b", "a..b", "ghcr.io/x:1"]) {
      const message = kernelImageError(image);

      expect(message === undefined || message.length > 0).toBe(true);
    }
  });
});

describe("kernelCmdlineError", () => {
  it("accepts an empty command line, which is the normal case", () => {
    expect(kernelCmdlineError("")).toBeUndefined();
  });

  it("accepts an ordinary command line", () => {
    expect(kernelCmdlineError("console=ttyS0 reboot=k panic=1")).toBeUndefined();
  });

  it("refuses a newline, naming what it would otherwise reach", () => {
    expect(kernelCmdlineError("console=ttyS0\nquiet")).toBe(kernelCmdlineControlCharacterMessage);
    expect(kernelCmdlineControlCharacterMessage).toContain("hypervisor argument");
  });

  it("refuses a carriage return", () => {
    expect(kernelCmdlineError("console=ttyS0\rquiet")).toBe(kernelCmdlineControlCharacterMessage);
  });

  it("refuses a NUL", () => {
    expect(kernelCmdlineError("console=ttyS0\u0000quiet")).toBe(kernelCmdlineControlCharacterMessage);
  });

  it("says the rule ships disabled, which is why it is enforced here", () => {
    expect(kernelCmdlineControlCharacterMessage).toContain("ships disabled");
  });
});

describe("kernelNodes and the count the summary states", () => {
  it("counts only the nodes carrying the label, on an equality match", () => {
    expect(kernelNodes(inputs()).map((found) => found.name)).toEqual(["node-1"]);
  });

  it("ignores a node whose label carries another value", () => {
    const wrong: NodeFacts = { name: "node-3", ready: true, schedulable: true, labels: { [kernelNodeLabel]: "yes" } };

    expect(kernelNodes(inputs({ nodes: [wrong] }))).toEqual([]);
  });

  it("ignores a node with no labels at all", () => {
    const bare: NodeFacts = { name: "node-4", ready: true, schedulable: true };

    expect(kernelNodes(inputs({ nodes: [bare] }))).toEqual([]);
  });

  it("says how many Jobs the controller will create, and that it is not a DaemonSet", () => {
    const fact = kernelNodeCountFact(inputs());

    expect(fact).toContain("1 node carries");
    expect(fact).toContain("one pull Job");
    expect(fact).toContain("not a DaemonSet");
  });

  it("pluralizes the count rather than saying 2 node", () => {
    const fact = kernelNodeCountFact(inputs({ nodes: [node("a", true), node("b", true)] }));

    expect(fact).toContain("2 nodes carry");
    expect(fact).toContain("2 pull Jobs");
  });

  it("says no node carries the label, and what Pending then means", () => {
    const fact = kernelNodeCountFact(inputs({ nodes: [node("node-2", false)] }));

    expect(fact).toContain("No node in this cluster carries");
    expect(fact).toContain("sits in Pending");
    expect(fact).toContain("labelling a node");
  });

  it("makes a refused read unverified and never zero", () => {
    const fact = kernelNodeCountFact(inputs({ nodes: [], nodesUnverified: true }));

    expect(fact).toContain("unverified - not zero");
    expect(fact).not.toContain("No node in this cluster");
  });

  it("names the label and its literal value in every wording", () => {
    for (const facts of [inputs(), inputs({ nodes: [] }), inputs({ nodes: [], nodesUnverified: true })]) {
      expect(kernelNodeCountFact(facts)).toContain(`${kernelNodeLabel}: ${kernelNodeLabelValue}`);
    }
  });

  it("parks in Pending only on a real zero", () => {
    expect(kernelWillParkInPending(inputs({ nodes: [] }))).toBe(true);
    expect(kernelWillParkInPending(inputs({ nodes: [], nodesUnverified: true }))).toBe(false);
    expect(kernelWillParkInPending(inputs())).toBe(false);
  });
});

describe("kernelCreateErrors", () => {
  it("accepts a complete form", () => {
    expect(kernelCreateErrors(values())).toEqual({});
  });

  it("requires a namespace, naming what lives in it", () => {
    const error = kernelCreateErrors(values({ namespace: "" })).namespace;

    expect(error).toContain("required");
    expect(error).toContain("pull Jobs");
  });

  it("requires a name", () => {
    expect(kernelCreateErrors(values({ name: "" })).name).toBe("A name is required.");
  });

  it("refuses a name the API server would refuse", () => {
    expect(kernelCreateErrors(values({ name: "Linux" })).name).toContain("lowercase");
  });

  it("carries the image rule at the image field", () => {
    expect(kernelCreateErrors(values({ image: "" })).image).toBe(imageRequiredMessage);
    expect(kernelCreateErrors(values({ image: " ghcr.io/x:1 " })).image).toBe(imagePaddedMessage);
  });

  it("carries the command-line rule at the command-line field", () => {
    expect(kernelCreateErrors(values({ kernelCmdline: "a\nb" })).kernelCmdline).toBe(
      kernelCmdlineControlCharacterMessage,
    );
  });

  it("never refuses the pull secret, which is optional and unverifiable", () => {
    expect(kernelCreateErrors(values({ pullSecret: "nope" })).pullSecret).toBeUndefined();
  });

  it("never refuses the profile, which is free text with no consumers", () => {
    expect(kernelCreateErrors(values({ profile: "anything at all" })).profile).toBeUndefined();
  });

  it("never refuses a field without a non-empty reason", () => {
    const broken = values({ namespace: "", name: "", image: " a;b ", kernelCmdline: "a\rb" });

    for (const message of Object.values(kernelCreateErrors(broken))) {
      expect(message).not.toBe("");
    }
  });
});

describe("kernelCreateWarnings", () => {
  it("warns about a name the namespace already has, and does not refuse it", () => {
    const warning = kernelCreateWarnings(inputs(), values({ name: "e2e-kernel-6-12" })).name;

    expect(warning).toContain("already exists in kubeswift-e2e");
    expect(kernelCreateErrors(values({ name: "e2e-kernel-6-12" })).name).toBeUndefined();
  });

  it("says the collision is unverified rather than absent when the list was refused", () => {
    const warning = kernelCreateWarnings(inputs({ existingNames: [], existingNamesUnverified: true }), values()).name;

    expect(warning).toContain("unverified");
  });

  it("says nothing about a name no kernel has", () => {
    expect(kernelCreateWarnings(inputs(), values()).name).toBeUndefined();
  });

  it("warns about a pull secret this namespace does not have", () => {
    const warning = kernelCreateWarnings(inputs(), values({ pullSecret: "nope" })).pullSecret;

    expect(warning).toContain("No Secret named nope");
    expect(warning).toContain("every labelled node");
  });

  it("says the pull secret is unverified rather than missing when the read was refused", () => {
    const warning = kernelCreateWarnings(
      inputs({ secrets: [], secretsUnverified: true }),
      values({ pullSecret: "e2e-registry" }),
    ).pullSecret;

    expect(warning).toContain("unverified");
    expect(warning).not.toContain("No Secret named");
  });

  it("says nothing about a pull secret the read returned", () => {
    expect(kernelCreateWarnings(inputs(), values({ pullSecret: "e2e-registry" })).pullSecret).toBeUndefined();
  });

  it("says nothing about an empty pull secret", () => {
    expect(kernelCreateWarnings(inputs({ secrets: [] }), values()).pullSecret).toBeUndefined();
  });
});

describe("kernelSubmitBlockReason", () => {
  it("is undefined for a form that would submit", () => {
    expect(kernelSubmitBlockReason(values())).toBeUndefined();
  });

  it("names the field and its reason, so a disabled button is never mute", () => {
    const reason = kernelSubmitBlockReason(values({ image: "" }));

    expect(reason).toContain("OCI image");
    expect(reason).toContain("required");
  });

  it("names the first field in the reading order of the form", () => {
    expect(kernelSubmitBlockReason(values({ namespace: "", image: "" }))).toContain("Namespace");
  });

  it("lists every blocking issue in the reading order", () => {
    const issues = kernelBlockingIssues(values({ namespace: "", name: "", kernelCmdline: "a\nb" }));

    expect(issues.map((issue) => issue.label)).toEqual(["Namespace", "Name", "Kernel command line"]);
  });

  it("carries a non-empty message on every issue it lists", () => {
    for (const issue of kernelBlockingIssues(values({ namespace: "", image: " x " }))) {
      expect(issue.message).not.toBe("");
    }
  });
});

describe("kernelCreatePayload", () => {
  it("sends the one required leaf and nothing else", () => {
    const { spec } = kernelCreatePayload(values());

    expect(Object.keys(spec)).toEqual(["ociRef"]);
    expect(spec.ociRef).toEqual({ image: "ghcr.io/example/kernel:6.12" });
  });

  it("never sends an empty pull secret, which the schema would accept", () => {
    expect(kernelCreatePayload(values({ pullSecret: "" })).spec.ociRef.pullSecret).toBeUndefined();
    expect(kernelCreatePayload(values({ pullSecret: "   " })).spec.ociRef.pullSecret).toBeUndefined();
  });

  it("sends the pull secret when one was chosen", () => {
    expect(kernelCreatePayload(values({ pullSecret: "e2e-registry" })).spec.ociRef.pullSecret).toBe("e2e-registry");
  });

  it("never sends an empty command line", () => {
    expect(kernelCreatePayload(values({ kernelCmdline: "  " })).spec.kernelCmdline).toBeUndefined();
    expect(Object.keys(kernelCreatePayload(values()).spec)).not.toContain("kernelCmdline");
  });

  it("sends the command line when one was typed", () => {
    expect(kernelCreatePayload(values({ kernelCmdline: "console=ttyS0" })).spec.kernelCmdline).toBe("console=ttyS0");
  });

  it("never sends an empty profile", () => {
    expect(Object.keys(kernelCreatePayload(values({ profile: "   " })).spec)).not.toContain("profile");
  });

  it("sends the profile when one was typed", () => {
    expect(kernelCreatePayload(values({ profile: "linux-6.12" })).spec.profile).toBe("linux-6.12");
  });

  it("trims every value it sends", () => {
    const { spec } = kernelCreatePayload(
      values({ image: "ghcr.io/example/kernel:6.12", pullSecret: " s ", kernelCmdline: " quiet ", profile: " p " }),
    );

    expect(spec.ociRef.pullSecret).toBe("s");
    expect(spec.kernelCmdline).toBe("quiet");
    expect(spec.profile).toBe("p");
  });

  it("carries neither the name nor the namespace: the store's create carries both", () => {
    const payload = JSON.stringify(kernelCreatePayload(values()));

    expect(payload).not.toContain("linux-6-12");
    expect(payload).not.toContain("kubeswift-e2e");
  });

  it("sends nothing the API server would stamp, because it stamps nothing on this kind", () => {
    const { spec } = kernelCreatePayload(values());

    expect(Object.keys(spec).sort()).toEqual(["ociRef"]);
  });
});

describe("kernelCreateSummary", () => {
  it("names the object it writes, with its namespace", () => {
    expect(kernelCreateSummary(inputs(), values()).write).toBe("Create SwiftKernel kubeswift-e2e/linux-6-12");
  });

  it("uses placeholders before the namespace and the name are chosen", () => {
    expect(kernelCreateSummary(inputs(), values({ namespace: "", name: "" })).write).toBe(
      "Create SwiftKernel <namespace>/<name>",
    );
  });

  it("names the artifact and how it is pulled", () => {
    const { notes } = kernelCreateSummary(inputs(), values());

    expect(notes.some((note) => note.includes("ghcr.io/example/kernel:6.12"))).toBe(true);
    expect(notes.some((note) => note.includes("oras"))).toBe(true);
  });

  it("states the labelled-node count as a note when there are nodes", () => {
    const { notes, warnings } = kernelCreateSummary(inputs(), values());

    expect(notes.some((note) => note.includes("1 node carries"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("carries"))).toBe(false);
  });

  it("moves the count to a warning when no node carries the label, before the write", () => {
    const { notes, warnings } = kernelCreateSummary(inputs({ nodes: [] }), values());

    expect(warnings.some((warning) => warning.includes("No node in this cluster carries"))).toBe(true);
    expect(notes.some((note) => note.includes("No node in this cluster carries"))).toBe(false);
  });

  it("warns once, not twice, when the count is a real zero", () => {
    const { warnings } = kernelCreateSummary(inputs({ nodes: [] }), values());

    expect(warnings.filter((warning) => warning.includes("No node in this cluster carries"))).toHaveLength(1);
  });

  it("warns that the count is unverified when the node read was refused", () => {
    const { warnings } = kernelCreateSummary(inputs({ nodes: [], nodesUnverified: true }), values());

    expect(warnings.some((warning) => warning.includes("unverified - not zero"))).toBe(true);
  });

  it("names the pull secret and how far it reaches", () => {
    const { notes } = kernelCreateSummary(inputs(), values({ pullSecret: "e2e-registry" }));

    expect(notes.some((note) => note.includes("e2e-registry") && note.includes("not the oras pull"))).toBe(true);
  });

  it("says nothing about a pull secret when none was chosen", () => {
    const { notes } = kernelCreateSummary(inputs(), values());

    expect(notes.some((note) => note.includes("pull secret"))).toBe(false);
  });

  it("says the command line replaces rather than extends a guest's own", () => {
    const { notes } = kernelCreateSummary(inputs(), values({ kernelCmdline: "console=ttyS0" }));

    expect(notes.some((note) => note.includes("console=ttyS0") && note.includes("replaces this line"))).toBe(true);
  });

  it("says the profile has no consumers when one was typed", () => {
    const { notes } = kernelCreateSummary(inputs(), values({ profile: "linux-6.12" }));

    expect(notes.some((note) => note.includes("linux-6.12") && note.includes("no code consumers"))).toBe(true);
  });

  it("always carries what Ready does and does not mean", () => {
    expect(kernelCreateSummary(inputs(), values()).notes).toContain(kernelReadyFact);
  });

  it("always carries the terminal-Failed vocabulary, and never a self-heal sentence", () => {
    const { notes } = kernelCreateSummary(inputs(), values());

    expect(notes).toContain(kernelTerminalFailedFact);
    expect(notes.some((note) => note.includes("heals"))).toBe(false);
  });

  it("says that deleting the Job the docs prescribe is not enough on its own", () => {
    expect(kernelTerminalFailedFact).toContain("Deleting the pull Job");
    expect(kernelTerminalFailedFact).toContain("phase has to be cleared");
  });

  it("says that re-pointing the image later changes nothing", () => {
    expect(kernelCreateSummary(inputs(), values()).notes).toContain(kernelImageIsImmutableInPracticeFact);
  });

  it("repeats the collision warning in the summary as well as at the field", () => {
    const { warnings } = kernelCreateSummary(inputs(), values({ name: "e2e-kernel-6-12" }));

    expect(warnings.some((warning) => warning.includes("already exists"))).toBe(true);
  });

  it("has no warnings for a clean form on a labelled cluster", () => {
    expect(kernelCreateSummary(inputs(), values()).warnings).toEqual([]);
  });

  it("never carries an empty note or an empty warning", () => {
    const summary = kernelCreateSummary(
      inputs({ nodes: [], secrets: [] }),
      values({ pullSecret: "nope", kernelCmdline: "quiet", profile: "p" }),
    );

    for (const line of [...summary.notes, ...summary.warnings]) {
      expect(line).not.toBe("");
    }
  });
});

describe("the facts the form states at its fields", () => {
  it("says the pull secret authenticates the container image and not the artifact", () => {
    expect(pullSecretReachFact).toContain("ORAS container image");
    expect(pullSecretReachFact).toContain("not the oras pull");
  });

  it("says upstream documents that limit nowhere", () => {
    expect(pullSecretReachFact).toContain("nowhere");
  });

  it("says the profile is a label with no consumers and names what does select a kernel", () => {
    expect(profileFact).toContain("no code consumers");
    expect(profileFact).toContain("metadata.name");
  });

  it("says the samples' profile values are a hint rather than an enum", () => {
    expect(profileFact).toContain("hint rather than an enum");
  });

  it("says a guest's command line replaces this one", () => {
    expect(kernelCmdlineReplacedFact).toContain("replaces this line");
  });

  it("says Ready does not mean the files landed", () => {
    expect(kernelReadyFact).toContain("does not mean");
    expect(kernelReadyFact).toContain("nothing verifies");
  });
});

describe("the create's own messages", () => {
  it("acknowledges a create by naming the object", () => {
    expect(kernelCreateSuccessMessage("kubeswift-e2e", "linux-6-12")).toBe(
      "SwiftKernel kubeswift-e2e/linux-6-12 created",
    );
  });

  it("names the collision and what to do about it", () => {
    const prefix = kernelCreateFailurePrefix(409, { namespace: "kubeswift-e2e", name: "linux-6-12" });

    expect(prefix).toContain("already exists in the namespace kubeswift-e2e");
    expect(prefix).toContain("Change the name");
  });

  it("names the verb, the resource and the namespace on a 403", () => {
    const prefix = kernelCreateFailurePrefix(403, { namespace: "kubeswift-e2e", name: "linux-6-12" });

    expect(prefix).toContain("create swiftkernels");
    expect(prefix).toContain("kubeswift-e2e");
  });

  it("says what is gone on a 404", () => {
    expect(kernelCreateFailurePrefix(404, { namespace: "kubeswift-e2e", name: "x" })).toContain("CRD is gone");
  });

  it("adds nothing to a failure it cannot predict", () => {
    expect(kernelCreateFailurePrefix(500, { namespace: "kubeswift-e2e", name: "x" })).toBeUndefined();
  });

  it("prefixes its sentence to the API server's own words rather than replacing them", () => {
    const message = kernelCreateFailureMessage(
      { code: 409, message: "already exists", alreadyNotified: false },
      { namespace: "kubeswift-e2e", name: "linux-6-12" },
    );

    expect(message).toContain("Change the name");
    expect(message).toContain("already exists");
  });

  it("passes an unpredictable failure through exactly as it arrived", () => {
    expect(
      kernelCreateFailureMessage(
        { code: 500, message: "internal error", alreadyNotified: false },
        { namespace: "kubeswift-e2e", name: "x" },
      ),
    ).toBe("internal error");
  });

  it("falls back to its own sentence when the API server said nothing", () => {
    expect(
      kernelCreateFailureMessage({ code: 409, alreadyNotified: false }, { namespace: "kubeswift-e2e", name: "x" }),
    ).toContain("already exists");
  });
});

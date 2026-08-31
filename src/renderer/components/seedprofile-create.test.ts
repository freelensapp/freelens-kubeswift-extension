/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Seed Profile form decides (SPEC-0014, slice 2).
//
// The bar is the shipped large dialog, counted as `it(...)` blocks: 117 for
// Migrate. The seed profile sits there for a reason of its own: four of this
// kind's behaviours are SILENT PRECEDENCES that no layer enforces, and "made
// unreachable by construction" is a claim about the payload builder that only
// a case per shape can hold up.

import { describe, expect, it } from "vitest";
import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import { conflictStatusCode } from "./migration-create";
import {
  createSeedProfileTitle,
  defaultSeedDocument,
  defaultSeedProfileForm,
  hasInlineSeedDocument,
  seedCreatesNothingFact,
  seedDatasource,
  seedDatasourceFact,
  seedDocumentKinds,
  seedDocumentLabels,
  seedDocumentOrigins,
  seedDocumentPayload,
  seedDocumentSummaryLine,
  seedEditIsIgnoredFact,
  seedInlineCredentialsFact,
  seedKernelBootFact,
  seedMetaDataEffectiveFact,
  seedNamespaceFact,
  seedNetworkDataEffectiveFact,
  seedObjectKeys,
  seedOptionalDroppedFact,
  seedOriginLabels,
  seedOriginNote,
  seedOriginObjects,
  seedOriginUnverified,
  seedPrecedencesFact,
  seedProfileBlockingIssues,
  seedProfileCreateErrors,
  seedProfileCreateFailureMessage,
  seedProfileCreateFailurePrefix,
  seedProfileCreatePayload,
  seedProfileCreateSuccessMessage,
  seedProfileCreateSummary,
  seedProfileCreateWarnings,
  seedProfileFieldLabels,
  seedProfileSubmitBlockReason,
  seedRenderedSecretFact,
  seedUnverifiedObjectHint,
  seedUserDataRequiredMessage,
  switchSeedDocumentOrigin,
} from "./seedprofile-create";

import type { SeedDocumentValues, SeedProfileCreateInputs, SeedProfileFormValues } from "./seedprofile-create";

function inputs(overrides: Partial<SeedProfileCreateInputs> = {}): SeedProfileCreateInputs {
  return {
    secrets: [
      { name: "seed-user-data", keys: ["network-config", "user-data"] },
      { name: "empty-secret", keys: [] },
    ],
    secretsUnverified: false,
    configMaps: [{ name: "seed-config", keys: ["meta-data", "network-config"] }],
    configMapsUnverified: false,
    existingNames: ["e2e-seed-inline", "e2e-seed-secret"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** One document group, filled the way a case needs it. */
function document(overrides: Partial<SeedDocumentValues> = {}): SeedDocumentValues {
  return { ...defaultSeedDocument(), ...overrides };
}

/** A form that would submit, so each case can break exactly one thing. */
function values(overrides: Partial<SeedProfileFormValues> = {}): SeedProfileFormValues {
  return {
    ...defaultSeedProfileForm("kubeswift-e2e"),
    name: "web",
    userData: document({ inline: "#cloud-config\npackages:\n  - nginx\n" }),
    ...overrides,
  };
}

/** The same, with the user data behind a Secret key. */
function referencedValues(overrides: Partial<SeedProfileFormValues> = {}): SeedProfileFormValues {
  return values({
    userData: document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
    ...overrides,
  });
}

describe("defaultSeedProfileForm", () => {
  it("carries the verb the page's control and the OK button share", () => {
    expect(createSeedProfileTitle).toBe("Create Seed Profile");
  });

  it("takes the namespace it is given, which is the page's own filter when it names one", () => {
    expect(defaultSeedProfileForm("kubeswift-e2e").namespace).toBe("kubeswift-e2e");
  });

  it("leaves the namespace empty rather than writing the literal default (F2)", () => {
    expect(defaultSeedProfileForm().namespace).toBe("");
  });

  it("opens all three documents inline and empty", () => {
    const form = defaultSeedProfileForm();

    for (const kind of seedDocumentKinds) {
      expect(form[kind]).toEqual({ origin: "inline", inline: "", objectName: "", key: "" });
    }
  });

  it("names the three documents in the order the form asks for them", () => {
    expect(seedDocumentKinds).toEqual(["userData", "metaData", "networkData"]);
  });

  it("names the three origins in the order each group offers them", () => {
    expect(seedDocumentOrigins).toEqual(["inline", "secret", "configMap"]);
  });

  it("labels every document and every origin", () => {
    for (const kind of seedDocumentKinds) {
      expect(seedDocumentLabels[kind]).toBeTruthy();
    }

    for (const origin of seedDocumentOrigins) {
      expect(seedOriginLabels[origin]).toBeTruthy();
    }
  });

  it("knows the one datasource the schema's enum offers", () => {
    expect(seedDatasource).toBe("NoCloud");
  });
});

describe("switchSeedDocumentOrigin", () => {
  it("keeps an inline document when the origin does not move", () => {
    expect(switchSeedDocumentOrigin(document({ inline: "#cloud-config" }), "inline").inline).toBe("#cloud-config");
  });

  it("drops the inline document when the group moves to a Secret key", () => {
    expect(switchSeedDocumentOrigin(document({ inline: "#cloud-config" }), "secret").inline).toBe("");
  });

  it("drops the reference when the group moves back to inline", () => {
    const moved = switchSeedDocumentOrigin(
      document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
      "inline",
    );

    expect(moved.objectName).toBe("");
    expect(moved.key).toBe("");
  });

  it("keeps the object name when the group moves between the two reference origins", () => {
    const moved = switchSeedDocumentOrigin(
      document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
      "configMap",
    );

    expect(moved.objectName).toBe("seed-user-data");
  });

  it("drops the key when the group moves between the two reference origins", () => {
    const moved = switchSeedDocumentOrigin(
      document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
      "configMap",
    );

    expect(moved.key).toBe("");
  });

  it("keeps the key when the origin does not really move", () => {
    const moved = switchSeedDocumentOrigin(
      document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
      "secret",
    );

    expect(moved.key).toBe("user-data");
  });

  it("records the origin it moved to", () => {
    expect(switchSeedDocumentOrigin(document(), "configMap").origin).toBe("configMap");
  });

  it("leaves no state in which an inline value sits beside a reference", () => {
    for (const origin of seedDocumentOrigins) {
      const moved = switchSeedDocumentOrigin(
        document({ origin: "inline", inline: "#cloud-config", objectName: "x", key: "y" }),
        origin,
      );

      expect(moved.inline === "" || (moved.objectName === "" && moved.key === "")).toBe(true);
    }
  });

  it("empties an object name left over from an inline group, which never had one to keep", () => {
    expect(switchSeedDocumentOrigin(document({ inline: "x", objectName: "stale" }), "secret").objectName).toBe("");
  });

  it("is a pure function: the group it is handed is not modified", () => {
    const original = document({ inline: "#cloud-config" });

    switchSeedDocumentOrigin(original, "secret");

    expect(original.inline).toBe("#cloud-config");
  });
});

describe("seedOriginObjects, seedOriginUnverified and seedObjectKeys", () => {
  it("reads the Secrets for a Secret-key group", () => {
    expect(seedOriginObjects(inputs(), "secret").map((object) => object.name)).toEqual([
      "seed-user-data",
      "empty-secret",
    ]);
  });

  it("reads the ConfigMaps for a ConfigMap-key group", () => {
    expect(seedOriginObjects(inputs(), "configMap").map((object) => object.name)).toEqual(["seed-config"]);
  });

  it("degrades each read on its own: a refused Secret list leaves the ConfigMaps alone (T3)", () => {
    const facts = inputs({ secretsUnverified: true });

    expect(seedOriginUnverified(facts, "secret")).toBe(true);
    expect(seedOriginUnverified(facts, "configMap")).toBe(false);
  });

  it("answers the keys of a Secret the read returned", () => {
    expect(seedObjectKeys(inputs(), "secret", "seed-user-data")).toEqual(["network-config", "user-data"]);
  });

  it("answers the keys of a ConfigMap the read returned", () => {
    expect(seedObjectKeys(inputs(), "configMap", "seed-config")).toEqual(["meta-data", "network-config"]);
  });

  it("answers an empty list for an object that really carries no keys", () => {
    expect(seedObjectKeys(inputs(), "secret", "empty-secret")).toEqual([]);
  });

  it("answers nothing for a name the read never returned, so the key stays typed", () => {
    expect(seedObjectKeys(inputs(), "secret", "gone")).toBeUndefined();
  });

  it("answers nothing before an object is named", () => {
    expect(seedObjectKeys(inputs(), "secret", "")).toBeUndefined();
  });

  it("answers nothing when the read was refused, which is different from an empty object", () => {
    expect(seedObjectKeys(inputs({ secretsUnverified: true }), "secret", "seed-user-data")).toBeUndefined();
  });

  it("answers nothing for an inline group, which has no object", () => {
    expect(seedObjectKeys(inputs(), "inline", "seed-user-data")).toBeUndefined();
  });

  it("ignores whitespace around a name, which is what the payload would trim anyway", () => {
    expect(seedObjectKeys(inputs(), "secret", "  seed-user-data  ")).toEqual(["network-config", "user-data"]);
  });
});

describe("seedProfileCreateErrors", () => {
  it("accepts a form whose user data is inline", () => {
    expect(seedProfileCreateErrors(values())).toEqual({});
  });

  it("accepts a form whose user data is a Secret key", () => {
    expect(seedProfileCreateErrors(referencedValues())).toEqual({});
  });

  it("requires a namespace, and says what lives in it", () => {
    expect(seedProfileCreateErrors(values({ namespace: "" })).namespace).toContain("resolves the profile from its own");
  });

  it("requires a name", () => {
    expect(seedProfileCreateErrors(values({ name: "" })).name).toContain("required");
  });

  it("refuses a name that is not an RFC-1123 object name", () => {
    expect(seedProfileCreateErrors(values({ name: "Web Seed" })).name).toContain("lowercase");
  });

  it("refuses an empty inline user data in the CEL rule's own terms", () => {
    expect(seedProfileCreateErrors(values({ userData: document() })).userData).toBe(seedUserDataRequiredMessage);
  });

  it("refuses an inline user data of whitespace, which satisfies the CEL rule and means nothing", () => {
    expect(seedProfileCreateErrors(values({ userData: document({ inline: "   \n  " }) })).userData).toBe(
      seedUserDataRequiredMessage,
    );
  });

  it("says that this one is the API server's own rule rather than a webhook's", () => {
    expect(seedUserDataRequiredMessage).toContain("not a webhook rule");
  });

  it("does not require the metadata to be filled in, because it has an effective value", () => {
    expect(seedProfileCreateErrors(values()).metaData).toBeUndefined();
  });

  it("does not require the network config either", () => {
    expect(seedProfileCreateErrors(values()).networkData).toBeUndefined();
  });

  it("refuses a Secret-key user data with no Secret named", () => {
    const errors = seedProfileCreateErrors(values({ userData: document({ origin: "secret", key: "user-data" }) }));

    expect(errors.userDataName).toContain("names no Secret");
  });

  it("names what an empty selector name really is: the core API's own default", () => {
    const errors = seedProfileCreateErrors(values({ userData: document({ origin: "secret", key: "user-data" }) }));

    expect(errors.userDataName).toContain("empty string");
    expect(errors.userDataName).toContain("retry with backoff");
  });

  it("refuses a ConfigMap-key user data with no ConfigMap named, in that object's own words", () => {
    const errors = seedProfileCreateErrors(values({ userData: document({ origin: "configMap", key: "user-data" }) }));

    expect(errors.userDataName).toContain("names no ConfigMap");
  });

  it("refuses a reference with no key", () => {
    const errors = seedProfileCreateErrors(
      values({ userData: document({ origin: "secret", objectName: "seed-user-data" }) }),
    );

    expect(errors.userDataKey).toContain("names no key");
  });

  it("refuses both halves of an entirely empty reference", () => {
    const errors = seedProfileCreateErrors(values({ userData: document({ origin: "secret" }) }));

    expect(errors.userDataName).toBeDefined();
    expect(errors.userDataKey).toBeDefined();
  });

  it("refuses a reference whose name is only whitespace", () => {
    const errors = seedProfileCreateErrors(
      values({ userData: document({ origin: "secret", objectName: "  ", key: "user-data" }) }),
    );

    expect(errors.userDataName).toBeDefined();
  });

  it("applies the same two rules to an incomplete metadata reference", () => {
    const errors = seedProfileCreateErrors(values({ metaData: document({ origin: "configMap" }) }));

    expect(errors.metaDataName).toBeDefined();
    expect(errors.metaDataKey).toBeDefined();
  });

  it("applies them to an incomplete network config reference too", () => {
    const errors = seedProfileCreateErrors(values({ networkData: document({ origin: "secret" }) }));

    expect(errors.networkDataName).toBeDefined();
    expect(errors.networkDataKey).toBeDefined();
  });

  it("accepts a complete metadata reference", () => {
    expect(
      seedProfileCreateErrors(
        values({ metaData: document({ origin: "configMap", objectName: "seed-config", key: "meta-data" }) }),
      ),
    ).toEqual({});
  });

  it("accepts a complete network config reference", () => {
    expect(
      seedProfileCreateErrors(
        values({ networkData: document({ origin: "secret", objectName: "seed-user-data", key: "network-config" }) }),
      ),
    ).toEqual({});
  });

  it("does not refuse an empty inline metadata, which is the case the effective value covers", () => {
    expect(seedProfileCreateErrors(values({ metaData: document() })).metaDataName).toBeUndefined();
  });

  it("refuses a user data reference exactly as hard as an empty inline one, and no harder", () => {
    const referenced = seedProfileCreateErrors(values({ userData: document({ origin: "secret" }) }));

    expect(referenced.userData).toBeUndefined();
    expect(referenced.userDataName).toBeDefined();
  });

  it("gives every refusal a non-empty reason (W4)", () => {
    const broken = seedProfileCreateErrors({
      namespace: "",
      name: "",
      userData: document({ origin: "secret" }),
      metaData: document({ origin: "configMap" }),
      networkData: document({ origin: "secret" }),
    });

    expect(Object.keys(broken)).toHaveLength(8);

    for (const message of Object.values(broken)) {
      expect(message).toBeTruthy();
      expect((message as string).length).toBeGreaterThanOrEqual("A name is required.".length);
    }
  });
});

describe("seedProfileCreateWarnings", () => {
  it("says nothing about a form with nothing to say", () => {
    expect(seedProfileCreateWarnings(inputs(), values())).toEqual({});
  });

  it("warns about a name the store already holds, and never blocks it", () => {
    expect(seedProfileCreateWarnings(inputs(), values({ name: "e2e-seed-inline" })).name).toContain("already exists");
  });

  it("marks the collision unverified when the list was refused", () => {
    expect(
      seedProfileCreateWarnings(inputs({ existingNames: [], existingNamesUnverified: true }), values()).name,
    ).toContain("unverified");
  });

  it("says nothing about a collision before a name is typed", () => {
    expect(
      seedProfileCreateWarnings(inputs({ existingNamesUnverified: true }), values({ name: "" })).name,
    ).toBeUndefined();
  });

  it("says nothing about an inline group, which references nothing", () => {
    expect(seedProfileCreateWarnings(inputs(), values()).userDataName).toBeUndefined();
  });

  it("warns about a Secret the namespace does not hold", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ userData: document({ origin: "secret", objectName: "gone", key: "user-data" }) }),
    );

    expect(warnings.userDataName).toContain("No Secret named gone");
  });

  it("names the consequence: a retry loop with no condition, not a refusal", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ userData: document({ origin: "secret", objectName: "gone", key: "user-data" }) }),
    );

    expect(warnings.userDataName).toContain("no Resolved=False and no Failed phase");
  });

  it("warns about a ConfigMap the namespace does not hold, in that object's own words", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ metaData: document({ origin: "configMap", objectName: "gone", key: "meta-data" }) }),
    );

    expect(warnings.metaDataName).toContain("No ConfigMap named gone");
  });

  it("marks the object unverified rather than missing when the read was refused (T3)", () => {
    const warnings = seedProfileCreateWarnings(
      inputs({ secretsUnverified: true }),
      values({ userData: document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }) }),
    );

    expect(warnings.userDataName).toContain("not verified");
    expect(warnings.userDataName).not.toContain("No Secret named");
  });

  it("warns about a key the picked Secret does not carry", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ userData: document({ origin: "secret", objectName: "seed-user-data", key: "missing" }) }),
    );

    expect(warnings.userDataKey).toContain("carries no key named missing");
  });

  it("says why that is a warning rather than a refusal: nothing reads it until a guest exists", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ userData: document({ origin: "secret", objectName: "seed-user-data", key: "missing" }) }),
    );

    expect(warnings.userDataKey).toContain("may be added before a guest ever reads it");
  });

  it("says nothing about a key the picked Secret does carry", () => {
    expect(seedProfileCreateWarnings(inputs(), referencedValues()).userDataKey).toBeUndefined();
  });

  it("warns about a key of an object that carries none at all", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({ userData: document({ origin: "secret", objectName: "empty-secret", key: "user-data" }) }),
    );

    expect(warnings.userDataKey).toContain("carries no key named user-data");
  });

  it("says nothing about a key before one is typed", () => {
    expect(
      seedProfileCreateWarnings(
        inputs(),
        values({ userData: document({ origin: "secret", objectName: "seed-user-data" }) }),
      ).userDataKey,
    ).toBeUndefined();
  });

  it("says nothing about a group whose object has not been named yet", () => {
    expect(
      seedProfileCreateWarnings(inputs(), values({ metaData: document({ origin: "secret", key: "meta-data" }) }))
        .metaDataName,
    ).toBeUndefined();
  });

  it("warns about all three groups independently", () => {
    const warnings = seedProfileCreateWarnings(
      inputs(),
      values({
        userData: document({ origin: "secret", objectName: "gone-a", key: "user-data" }),
        metaData: document({ origin: "configMap", objectName: "gone-b", key: "meta-data" }),
        networkData: document({ origin: "secret", objectName: "gone-c", key: "network-config" }),
      }),
    );

    expect(warnings.userDataName).toContain("gone-a");
    expect(warnings.metaDataName).toContain("gone-b");
    expect(warnings.networkDataName).toContain("gone-c");
  });
});

describe("seedProfileBlockingIssues and seedProfileSubmitBlockReason", () => {
  it("says nothing about a form that would submit", () => {
    expect(seedProfileBlockingIssues(values())).toEqual([]);
    expect(seedProfileSubmitBlockReason(values())).toBeUndefined();
  });

  it("names the field and its reason next to the button (W4, W12)", () => {
    const reason = seedProfileSubmitBlockReason(values({ userData: document() }));

    expect(reason).toContain(seedProfileFieldLabels.userData);
    expect(reason).toContain(seedUserDataRequiredMessage);
  });

  it("names the fields in the reading order of the form", () => {
    const issues = seedProfileBlockingIssues(
      values({ namespace: "", name: "", userData: document(), networkData: document({ origin: "secret" }) }),
    );

    expect(issues.map((issue) => issue.label)).toEqual([
      "Namespace",
      "Name",
      "User data",
      "Network config source",
      "Network config key",
    ]);
  });

  it("names the first issue only, because a button carries one sentence", () => {
    expect(seedProfileSubmitBlockReason(values({ namespace: "", userData: document() }))).toContain("Namespace");
  });

  it("reaches the metadata group, which is optional until a reference is half-typed", () => {
    expect(seedProfileSubmitBlockReason(values({ metaData: document({ origin: "secret" }) }))).toContain(
      "Metadata source",
    );
  });

  it("gives every field a label the sentence can use", () => {
    for (const label of Object.values(seedProfileFieldLabels)) {
      expect(label).toBeTruthy();
    }
  });
});

describe("seedDocumentPayload", () => {
  it("writes an inline document as a value", () => {
    expect(seedDocumentPayload(document({ inline: "#cloud-config" }))).toEqual({ value: "#cloud-config" });
  });

  it("writes nothing for an empty inline document, rather than an empty string", () => {
    expect(seedDocumentPayload(document())).toEqual({});
  });

  it("writes nothing for an inline document of whitespace", () => {
    expect(seedDocumentPayload(document({ inline: "   " }))).toEqual({});
  });

  it("does not trim the document, because cloud-init reads its whitespace", () => {
    expect(seedDocumentPayload(document({ inline: "#cloud-config\nruncmd:\n  - true\n" })).value).toBe(
      "#cloud-config\nruncmd:\n  - true\n",
    );
  });

  it("writes a Secret key selector", () => {
    expect(seedDocumentPayload(document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }))).toEqual(
      { valueFrom: { secretKeyRef: { name: "seed-user-data", key: "user-data" } } },
    );
  });

  it("writes a ConfigMap key selector", () => {
    expect(seedDocumentPayload(document({ origin: "configMap", objectName: "seed-config", key: "meta-data" }))).toEqual(
      { valueFrom: { configMapKeyRef: { name: "seed-config", key: "meta-data" } } },
    );
  });

  it("trims the name and the key", () => {
    expect(
      seedDocumentPayload(document({ origin: "secret", objectName: " seed-user-data ", key: " user-data " })),
    ).toEqual({ valueFrom: { secretKeyRef: { name: "seed-user-data", key: "user-data" } } });
  });

  it("never emits a selector with an empty name (the fourth silent precedence)", () => {
    expect(seedDocumentPayload(document({ origin: "secret", key: "user-data" }))).toEqual({});
  });

  it("never emits a selector with an empty key", () => {
    expect(seedDocumentPayload(document({ origin: "secret", objectName: "seed-user-data" }))).toEqual({});
  });

  it("never emits an empty reference block (the third silent precedence)", () => {
    expect(seedDocumentPayload(document({ origin: "configMap" })).valueFrom).toBeUndefined();
  });

  it("never emits both refs in one block (the second silent precedence)", () => {
    const payload = seedDocumentPayload(document({ origin: "secret", objectName: "x", key: "y" }));

    expect(payload.valueFrom?.secretKeyRef).toBeDefined();
    expect(payload.valueFrom?.configMapKeyRef).toBeUndefined();
  });

  it("never emits an inline value beside a reference (the first silent precedence)", () => {
    const payload = seedDocumentPayload({ origin: "secret", inline: "#cloud-config", objectName: "x", key: "y" });

    expect(payload.value).toBeUndefined();
    expect(payload.valueFrom).toBeDefined();
  });

  it("never emits a reference beside an inline value either, whatever the group holds", () => {
    const payload = seedDocumentPayload({ origin: "inline", inline: "#cloud-config", objectName: "x", key: "y" });

    expect(payload.value).toBe("#cloud-config");
    expect(payload.valueFrom).toBeUndefined();
  });

  it("never emits more than one key, for any origin and any combination of fields", () => {
    for (const origin of seedDocumentOrigins) {
      const payload = seedDocumentPayload({ origin, inline: "#cloud-config", objectName: "x", key: "y" });

      expect(Object.keys(payload).length).toBeLessThanOrEqual(1);
    }
  });

  it("never emits an optional flag, which neither resolver reads (F15)", () => {
    const selector = seedDocumentPayload(document({ origin: "secret", objectName: "x", key: "y" })).valueFrom
      ?.secretKeyRef;

    expect(selector).toEqual({ name: "x", key: "y" });
    expect(selector && "optional" in selector).toBe(false);
  });
});

describe("seedProfileCreatePayload", () => {
  it("always sends the datasource explicitly (F16)", () => {
    expect(seedProfileCreatePayload(values()).spec.datasource).toBe("NoCloud");
  });

  it("says at the field why: the webhook that would stamp it ships disabled and ignores failures", () => {
    expect(seedDatasourceFact).toContain("failurePolicy: Ignore");
  });

  it("sends the datasource and the inline user data and nothing else, from a minimal form", () => {
    expect(Object.keys(seedProfileCreatePayload(values()).spec).sort()).toEqual(["datasource", "userData"]);
  });

  it("sends the datasource and a userDataFrom for a referenced form", () => {
    expect(Object.keys(seedProfileCreatePayload(referencedValues()).spec).sort()).toEqual([
      "datasource",
      "userDataFrom",
    ]);
  });

  it("writes the Secret key selector a referenced form describes", () => {
    expect(seedProfileCreatePayload(referencedValues()).spec.userDataFrom).toEqual({
      secretKeyRef: { name: "seed-user-data", key: "user-data" },
    });
  });

  it("never sends both userData and userDataFrom", () => {
    const spec = seedProfileCreatePayload(
      values({ userData: { origin: "secret", inline: "#cloud-config", objectName: "x", key: "y" } }),
    ).spec;

    expect(spec.userData).toBeUndefined();
    expect(spec.userDataFrom).toBeDefined();
  });

  it("sends no metadata at all when the group was left empty", () => {
    const spec = seedProfileCreatePayload(values()).spec;

    expect(spec.metaData).toBeUndefined();
    expect(spec.metaDataFrom).toBeUndefined();
  });

  it("sends no network config at all when that group was left empty", () => {
    const spec = seedProfileCreatePayload(values()).spec;

    expect(spec.networkData).toBeUndefined();
    expect(spec.networkDataFrom).toBeUndefined();
  });

  it("sends an inline metadata when one was typed", () => {
    expect(seedProfileCreatePayload(values({ metaData: document({ inline: "instance-id: web" }) })).spec.metaData).toBe(
      "instance-id: web",
    );
  });

  it("sends a ConfigMap metadata reference when one was picked", () => {
    expect(
      seedProfileCreatePayload(
        values({ metaData: document({ origin: "configMap", objectName: "seed-config", key: "meta-data" }) }),
      ).spec.metaDataFrom,
    ).toEqual({ configMapKeyRef: { name: "seed-config", key: "meta-data" } });
  });

  it("sends a Secret network config reference when one was picked", () => {
    expect(
      seedProfileCreatePayload(
        values({ networkData: document({ origin: "secret", objectName: "seed-user-data", key: "network-config" }) }),
      ).spec.networkDataFrom,
    ).toEqual({ secretKeyRef: { name: "seed-user-data", key: "network-config" } });
  });

  it("sends an inline network config when one was typed", () => {
    expect(seedProfileCreatePayload(values({ networkData: document({ inline: "version: 2" }) })).spec.networkData).toBe(
      "version: 2",
    );
  });

  it("never emits an empty *From block for any group, whatever the form holds", () => {
    const spec = seedProfileCreatePayload({
      namespace: "ns",
      name: "web",
      userData: document({ inline: "#cloud-config" }),
      metaData: document({ origin: "configMap" }),
      networkData: document({ origin: "secret", objectName: "x" }),
    }).spec;

    expect(spec.metaDataFrom).toBeUndefined();
    expect(spec.networkDataFrom).toBeUndefined();
  });

  it("never emits a selector with an empty name in any of the three groups", () => {
    const spec = seedProfileCreatePayload({
      namespace: "ns",
      name: "web",
      userData: document({ origin: "secret", key: "user-data" }),
      metaData: document({ origin: "secret", key: "meta-data" }),
      networkData: document({ origin: "configMap", key: "network-config" }),
    }).spec;

    expect(Object.keys(spec)).toEqual(["datasource"]);
  });

  it("carries no name and no namespace: the store's create carries both", () => {
    const spec = seedProfileCreatePayload(values()).spec as unknown as Record<string, unknown>;

    expect(spec.name).toBeUndefined();
    expect(spec.namespace).toBeUndefined();
  });

  it("writes the whole object a fully referenced form describes", () => {
    expect(
      seedProfileCreatePayload(
        values({
          userData: document({ origin: "secret", objectName: "seed-user-data", key: "user-data" }),
          metaData: document({ origin: "configMap", objectName: "seed-config", key: "meta-data" }),
          networkData: document({ origin: "configMap", objectName: "seed-config", key: "network-config" }),
        }),
      ).spec,
    ).toEqual({
      datasource: "NoCloud",
      userDataFrom: { secretKeyRef: { name: "seed-user-data", key: "user-data" } },
      metaDataFrom: { configMapKeyRef: { name: "seed-config", key: "meta-data" } },
      networkDataFrom: { configMapKeyRef: { name: "seed-config", key: "network-config" } },
    });
  });

  it("writes the whole object a fully inline form describes", () => {
    expect(
      seedProfileCreatePayload(
        values({
          metaData: document({ inline: "instance-id: web" }),
          networkData: document({ inline: "version: 2" }),
        }),
      ).spec,
    ).toEqual({
      datasource: "NoCloud",
      userData: "#cloud-config\npackages:\n  - nginx\n",
      metaData: "instance-id: web",
      networkData: "version: 2",
    });
  });

  it("never produces a spec carrying both an inline document and its reference, for any origin", () => {
    for (const origin of seedDocumentOrigins) {
      const spec = seedProfileCreatePayload(
        values({ userData: { origin, inline: "#cloud-config", objectName: "s", key: "k" } }),
      ).spec;

      expect(spec.userData !== undefined && spec.userDataFrom !== undefined).toBe(false);
    }
  });
});

describe("hasInlineSeedDocument and seedDocumentSummaryLine", () => {
  it("sees the inline user data of a typed form", () => {
    expect(hasInlineSeedDocument(values())).toBe(true);
  });

  it("sees none in a fully referenced form", () => {
    expect(hasInlineSeedDocument(referencedValues())).toBe(false);
  });

  it("sees none in a form whose inline documents are all empty", () => {
    expect(hasInlineSeedDocument(values({ userData: document({ origin: "secret", objectName: "s", key: "k" }) }))).toBe(
      false,
    );
  });

  it("names the spec field an inline document lands in", () => {
    expect(seedDocumentSummaryLine("userData", document({ inline: "x" }))).toContain("spec.userData");
  });

  it("names the Secret and the key a reference reads", () => {
    expect(seedDocumentSummaryLine("metaData", document({ origin: "secret", objectName: "s", key: "k" }))).toContain(
      "the key k of the Secret s",
    );
  });

  it("names the ConfigMap and the key of a ConfigMap reference", () => {
    expect(
      seedDocumentSummaryLine("networkData", document({ origin: "configMap", objectName: "c", key: "k" })),
    ).toContain("the key k of the ConfigMap c");
  });

  it("says nothing about an unfilled group, which the payload drops", () => {
    expect(seedDocumentSummaryLine("metaData", document())).toBeUndefined();
  });

  it("says nothing about a half-typed reference either", () => {
    expect(seedDocumentSummaryLine("metaData", document({ origin: "secret", objectName: "s" }))).toBeUndefined();
  });

  it("says when a reference is read: at reconcile time, not now", () => {
    expect(seedDocumentSummaryLine("userData", document({ origin: "secret", objectName: "s", key: "k" }))).toContain(
      "read when a guest is reconciled",
    );
  });
});

describe("seedProfileCreateSummary", () => {
  it("opens with the one API call the dialog makes (W1)", () => {
    expect(seedProfileCreateSummary(inputs(), values()).write).toBe("Create SwiftSeedProfile kubeswift-e2e/web");
  });

  it("uses placeholders before the namespace and the name are typed", () => {
    expect(seedProfileCreateSummary(inputs(), values({ namespace: "", name: "" })).write).toBe(
      "Create SwiftSeedProfile <namespace>/<name>",
    );
  });

  it("says first that this create sets nothing in motion", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes[0]).toBe(seedCreatesNothingFact);
  });

  it("names the Secret a guest will render later, and the docs error about it", () => {
    const notes = seedProfileCreateSummary(inputs(), values()).notes;

    expect(notes).toContain(seedRenderedSecretFact);
    expect(seedRenderedSecretFact).toContain("still calls it a ConfigMap");
  });

  it("says where an inline document lands, when there is one", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).toContain(seedInlineCredentialsFact);
  });

  it("does not say it for a fully referenced profile, which is the point of the path", () => {
    expect(seedProfileCreateSummary(inputs(), referencedValues()).notes).not.toContain(seedInlineCredentialsFact);
  });

  it("shows the metadata effective value as a fact when the group is empty", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).toContain(seedMetaDataEffectiveFact);
  });

  it("drops that fact once the metadata is filled in, because it is no longer true", () => {
    expect(
      seedProfileCreateSummary(inputs(), values({ metaData: document({ inline: "instance-id: web" }) })).notes,
    ).not.toContain(seedMetaDataEffectiveFact);
  });

  it("drops it for a referenced metadata too", () => {
    expect(
      seedProfileCreateSummary(
        inputs(),
        values({ metaData: document({ origin: "configMap", objectName: "seed-config", key: "meta-data" }) }),
      ).notes,
    ).not.toContain(seedMetaDataEffectiveFact);
  });

  it("shows the network config effective value under the same rule", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).toContain(seedNetworkDataEffectiveFact);
    expect(
      seedProfileCreateSummary(inputs(), values({ networkData: document({ inline: "version: 2" }) })).notes,
    ).not.toContain(seedNetworkDataEffectiveFact);
  });

  it("says that an edit after the guest exists rewrites bytes nobody reads", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).toContain(seedEditIsIgnoredFact);
  });

  it("carries the kernel-boot cross-reference SPEC-0013 already acts on", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).toContain(seedKernelBootFact);
    expect(seedKernelBootFact).toContain("created and never mounted");
  });

  it("does not repeat the optional fact, which the footer states where the control would have been", () => {
    expect(seedProfileCreateSummary(inputs(), values()).notes).not.toContain(seedOptionalDroppedFact);
  });

  it("names each document's origin in the summary", () => {
    const notes = seedProfileCreateSummary(inputs(), referencedValues()).notes.join(" ");

    expect(notes).toContain("the key user-data of the Secret seed-user-data");
  });

  it("repeats every warning where the user reads before pressing OK", () => {
    const warnings = seedProfileCreateSummary(
      inputs(),
      values({
        name: "e2e-seed-inline",
        metaData: document({ origin: "configMap", objectName: "gone", key: "meta-data" }),
      }),
    ).warnings.join(" ");

    expect(warnings).toContain("already exists");
    expect(warnings).toContain("No ConfigMap named gone");
  });

  it("keeps the warnings in the reading order of the form", () => {
    const warnings = seedProfileCreateSummary(
      inputs(),
      values({
        name: "e2e-seed-inline",
        networkData: document({ origin: "secret", objectName: "gone", key: "network-config" }),
      }),
    ).warnings;

    expect(warnings[0]).toContain("already exists");
    expect(warnings[1]).toContain("No Secret named gone");
  });

  it("says nothing in warnings about a form with nothing to warn about", () => {
    expect(seedProfileCreateSummary(inputs(), values()).warnings).toEqual([]);
  });
});

describe("the sentences the form carries", () => {
  it("states the namespace fact: the profile is resolved from the guest's namespace", () => {
    expect(seedNamespaceFact).toContain("ITS OWN namespace");
    expect(seedNamespaceFact).toContain("hard resolution error");
  });

  it("describes each origin of each document", () => {
    for (const kind of seedDocumentKinds) {
      for (const origin of seedDocumentOrigins) {
        expect(seedOriginNote(kind, origin).length).toBeGreaterThan(20);
      }
    }
  });

  it("says of the Secret origin that it is the path upstream's own GUI cannot express (F14)", () => {
    expect(seedOriginNote("userData", "secret")).toContain("GUI cannot express");
  });

  it("warns at the inline user data that it is readable by anything that can get the profile", () => {
    expect(seedOriginNote("userData", "inline")).toContain("mirrors the namespace into Git");
  });

  it("says why the metadata is defaulted rather than optional", () => {
    expect(seedMetaDataEffectiveFact).toContain("discards the user data WHOLESALE");
  });

  it("says what an empty network config becomes", () => {
    expect(seedNetworkDataEffectiveFact).toContain("dual-match DHCP netplan");
  });

  it("states the four precedences the form cannot express (F20)", () => {
    expect(seedPrecedencesFact).toContain("inline document beside a reference");
    expect(seedPrecedencesFact).toContain("Secret key beside a ConfigMap key");
    expect(seedPrecedencesFact).toContain("empty reference block");
    expect(seedPrecedencesFact).toContain("reference with an empty name");
  });

  it("states what optional would have controlled, in its place (F15)", () => {
    expect(seedOptionalDroppedFact).toContain("neither resolver reads it");
    expect(seedOptionalDroppedFact).toContain("retries with backoff");
  });

  it("says what a refused read costs, per origin", () => {
    expect(seedUnverifiedObjectHint("secret")).toContain("Secrets");
    expect(seedUnverifiedObjectHint("configMap")).toContain("ConfigMaps");
  });
});

describe("the sentences a create's outcome carries", () => {
  it("acknowledges a create that succeeded (W9)", () => {
    expect(seedProfileCreateSuccessMessage("kubeswift-e2e", "web")).toBe("SwiftSeedProfile kubeswift-e2e/web created");
  });

  it("names the collision a 409 is", () => {
    expect(seedProfileCreateFailurePrefix(conflictStatusCode, { namespace: "ns", name: "web" })).toContain(
      "already exists",
    );
  });

  it("names the verb, the resource and the namespace a 403 refused", () => {
    expect(seedProfileCreateFailurePrefix(forbiddenStatusCode, { namespace: "ns", name: "web" })).toContain(
      "create swiftseedprofiles in the namespace ns",
    );
  });

  it("says what a 404 means here: the namespace or the CRD is gone", () => {
    expect(seedProfileCreateFailurePrefix(notFoundStatusCode, { namespace: "ns", name: "web" })).toContain("is gone");
  });

  it("predicts nothing about a status code it does not know", () => {
    expect(seedProfileCreateFailurePrefix(422, { namespace: "ns", name: "web" })).toBeUndefined();
  });

  it("prefixes its own sentence to what the API server said, never replacing it (W9)", () => {
    const message = seedProfileCreateFailureMessage(
      { code: 422, message: "one of spec.userData or spec.userDataFrom is required", alreadyNotified: false },
      { namespace: "ns", name: "web" },
    );

    expect(message).toBe("one of spec.userData or spec.userDataFrom is required");
  });

  it("prefixes a predicted failure and keeps the server's words after it", () => {
    const message = seedProfileCreateFailureMessage(
      {
        code: conflictStatusCode,
        message: "swiftseedprofiles.seed.kubeswift.io web already exists",
        alreadyNotified: false,
      },
      { namespace: "ns", name: "web" },
    );

    expect(message).toContain("Change the name and try again.");
    expect(message).toContain("already exists");
  });

  it("falls back to its own sentence when the API server said nothing", () => {
    expect(
      seedProfileCreateFailureMessage(
        { code: forbiddenStatusCode, message: undefined, alreadyNotified: true },
        {
          namespace: "ns",
          name: "web",
        },
      ),
    ).toContain("not allowed");
  });
});

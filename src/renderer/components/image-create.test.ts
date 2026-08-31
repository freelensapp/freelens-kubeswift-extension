/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Image form decides (SPEC-0014, slice 2).
//
// The bar is the shipped large dialog, counted as `it(...)` blocks: 117 for
// Migrate. The image sits there because seventeen leaves and ZERO CEL rules
// leave twelve validating rules in a webhook that ships disabled, so every one
// of them is a case here - and because two of its exclusivities are made
// inexpressible rather than validated, which is a property of the payload
// builder and has to be asserted as one.

import { describe, expect, it } from "vitest";
import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import { quantityNegativeMessage, quantityZeroMessage } from "./guestclass-create";
import {
  cloneStrategyNote,
  controllerRootDiskSize,
  createImageTitle,
  defaultCloneStrategy,
  defaultImageForm,
  defaultOsType,
  formatAlwaysSentFact,
  formatFilenameWarning,
  formatFromFilename,
  formatRequiredMessage,
  formatSilentCorruptionFact,
  httpNoChecksumFact,
  httpUrlRequiredMessage,
  httpUrlSchemeMessage,
  imageBlockingIssues,
  imageCloneStrategies,
  imageCreateErrors,
  imageCreateFailureMessage,
  imageCreateFailurePrefix,
  imageCreatePayload,
  imageCreateSuccessMessage,
  imageCreateSummary,
  imageCreatesFact,
  imageCreateWarnings,
  imageDeclaredFormatIsTrustedFact,
  imageDiagnosticSurfaceFact,
  imageDiskFormats,
  imageDroppedFieldsFacts,
  imageFieldLabels,
  imageHttpUrlError,
  imageImportingHangsFact,
  imageNoTtlFact,
  imageOciRepositoryError,
  imageOsTypes,
  imagePhaseWalkFact,
  imagePinBys,
  imageSourceKinds,
  imageSourceNote,
  imageSourcePayload,
  imageStorageSectionFields,
  imageSubmitBlockReason,
  imageTerminalFailedFact,
  isMalformedDigest,
  ociDigestRequiredMessage,
  ociDigestShapeWarning,
  ociInsecureWithVerifyKeyWarning,
  ociRepositoryRequiredMessage,
  ociRepositoryTaggedMessage,
  ociTagRequiredMessage,
  osTypeLinuxFact,
  storageSectionHint,
  switchImagePinBy,
  switchImageSource,
  uploadDroppedFact,
  volumeSnapshotClassRequiredMessage,
} from "./image-create";
import { storageClassNameMessage } from "./kube-storage";
import { conflictStatusCode } from "./migration-create";

import type { ImageCreateInputs, ImageFormValues } from "./image-create";

function inputs(overrides: Partial<ImageCreateInputs> = {}): ImageCreateInputs {
  return {
    secrets: ["registry-creds", "cosign-key"],
    secretsUnverified: false,
    storageClasses: ["fast", "standard"],
    storageClassesUnverified: false,
    existingNames: ["ubuntu-2404", "windows-2022"],
    existingNamesUnverified: false,
    ...overrides,
  };
}

/** A form that would submit, so each case can break exactly one thing. */
function values(overrides: Partial<ImageFormValues> = {}): ImageFormValues {
  return {
    ...defaultImageForm("kubeswift-e2e"),
    name: "noble",
    httpUrl: "https://images.example.com/noble-server-cloudimg-amd64.img",
    format: "raw",
    ...overrides,
  };
}

/** The same, on the OCI branch, pinned by digest. */
function ociValues(overrides: Partial<ImageFormValues> = {}): ImageFormValues {
  return values({
    source: "oci",
    httpUrl: "",
    ociRepository: "ghcr.io/example/golden-ubuntu-noble",
    ociPinBy: "digest",
    ociDigest: `sha256:${"a".repeat(64)}`,
    ...overrides,
  });
}

describe("defaultImageForm", () => {
  it("carries the verb the page's control and the OK button share", () => {
    expect(createImageTitle).toBe("Create Image");
  });

  it("takes the namespace it is given, which is the page's own filter when it names one", () => {
    expect(defaultImageForm("kubeswift-e2e").namespace).toBe("kubeswift-e2e");
  });

  it("leaves the namespace empty rather than writing the literal default (F2)", () => {
    expect(defaultImageForm().namespace).toBe("");
  });

  it("opens on the HTTP source, which is the one with a single field", () => {
    expect(defaultImageForm().source).toBe("http");
  });

  it("opens pinned by digest, which is what upstream's own CRD comment recommends", () => {
    expect(defaultImageForm().ociPinBy).toBe("digest");
  });

  it("prefills no format, because the schema requires one and there is nothing to inherit", () => {
    expect(defaultImageForm().format).toBe("");
  });

  it("opens on the two values the API server would stamp, so an untouched form sends neither", () => {
    expect(defaultImageForm().osType).toBe(defaultOsType);
    expect(defaultImageForm().cloneStrategy).toBe(defaultCloneStrategy);
  });

  it("prefills no root disk size, because 10Gi is a controller constant rather than a value", () => {
    expect(defaultImageForm().rootDiskSize).toBe("");
    expect(controllerRootDiskSize).toBe("10Gi");
  });

  it("offers the two sources this form implements, and no third", () => {
    expect(imageSourceKinds).toEqual(["http", "oci"]);
  });

  it("offers the two pins, the two formats, the two OS types and the two clone strategies", () => {
    expect(imagePinBys).toEqual(["tag", "digest"]);
    expect(imageDiskFormats).toEqual(["raw", "qcow2"]);
    expect(imageOsTypes).toEqual(["linux", "windows"]);
    expect(imageCloneStrategies).toEqual(["copy", "snapshot"]);
  });
});

describe("switchImageSource", () => {
  it("keeps the URL when the source it moves to is the HTTP one", () => {
    expect(switchImageSource(values(), "http").httpUrl).toBe(values().httpUrl);
  });

  it("empties the URL when the form moves to OCI, so no second source survives in the model", () => {
    expect(switchImageSource(values(), "oci").httpUrl).toBe("");
  });

  it("empties every OCI field when the form moves back to HTTP", () => {
    const moved = switchImageSource(ociValues({ ociTag: "24.04", ociCredentialsSecret: "registry-creds" }), "http");

    expect(moved.ociRepository).toBe("");
    expect(moved.ociTag).toBe("");
    expect(moved.ociDigest).toBe("");
    expect(moved.ociCredentialsSecret).toBe("");
  });

  it("clears the plaintext switch with the source it belonged to", () => {
    expect(switchImageSource(ociValues({ ociInsecure: true }), "http").ociInsecure).toBe(false);
  });

  it("clears the verify key too, which is the one field a leftover would be dangerous in", () => {
    expect(switchImageSource(ociValues({ ociVerifyKeySecret: "cosign-key" }), "http").ociVerifyKeySecret).toBe("");
  });

  it("keeps everything the two sources share", () => {
    const moved = switchImageSource(values({ rootDiskSize: "20Gi" }), "oci");

    expect(moved.namespace).toBe("kubeswift-e2e");
    expect(moved.name).toBe("noble");
    expect(moved.format).toBe("raw");
    expect(moved.rootDiskSize).toBe("20Gi");
  });

  it("records the source it moved to", () => {
    expect(switchImageSource(values(), "oci").source).toBe("oci");
  });
});

describe("switchImagePinBy", () => {
  it("empties the digest when the form moves to a tag", () => {
    expect(switchImagePinBy(ociValues(), "tag").ociDigest).toBe("");
  });

  it("empties the tag when the form moves to a digest", () => {
    expect(switchImagePinBy(ociValues({ ociPinBy: "tag", ociTag: "24.04" }), "digest").ociTag).toBe("");
  });

  it("keeps the value of the pin it moves to", () => {
    const tagged = switchImagePinBy(ociValues({ ociPinBy: "tag", ociTag: "24.04" }), "tag");

    expect(tagged.ociTag).toBe("24.04");
  });

  it("records the pin it moved to", () => {
    expect(switchImagePinBy(ociValues(), "tag").ociPinBy).toBe("tag");
  });

  it("leaves the repository alone, which belongs to neither pin", () => {
    expect(switchImagePinBy(ociValues(), "tag").ociRepository).toBe("ghcr.io/example/golden-ubuntu-noble");
  });
});

describe("imageHttpUrlError", () => {
  it("refuses an empty URL with upstream's own rule, which ships disabled", () => {
    expect(imageHttpUrlError("")).toBe(httpUrlRequiredMessage);
  });

  it("refuses a URL of whitespace, which trims to the same nothing", () => {
    expect(imageHttpUrlError("   ")).toBe(httpUrlRequiredMessage);
  });

  it("names what an empty URL costs, rather than saying the field is required", () => {
    expect(httpUrlRequiredMessage).toContain("webhook that ships disabled");
  });

  it("refuses a scheme nothing upstream checks", () => {
    expect(imageHttpUrlError("ftp://images.example.com/noble.img")).toBe(httpUrlSchemeMessage);
  });

  it("refuses a bare host, which reads like a URL and is not one", () => {
    expect(imageHttpUrlError("images.example.com/noble.img")).toBe(httpUrlSchemeMessage);
  });

  it("refuses a scheme with nothing after it", () => {
    expect(imageHttpUrlError("https://")).toBe(httpUrlSchemeMessage);
  });

  it("accepts http as well as https, because a cluster-local mirror is a legitimate source", () => {
    expect(imageHttpUrlError("http://mirror.svc/noble.img")).toBeUndefined();
  });

  it("accepts an uppercase scheme, which the API server and every downloader do", () => {
    expect(imageHttpUrlError("HTTPS://images.example.com/noble.img")).toBeUndefined();
  });

  it("says at the field that this path has no checksum of any kind", () => {
    expect(httpNoChecksumFact).toContain("no checksum field");
  });
});

describe("imageOciRepositoryError", () => {
  it("refuses an empty repository, which the schema requires", () => {
    expect(imageOciRepositoryError("")).toBe(ociRepositoryRequiredMessage);
  });

  it("refuses a repository of whitespace", () => {
    expect(imageOciRepositoryError("  ")).toBe(ociRepositoryRequiredMessage);
  });

  it("refuses a repository that carries its own tag, which is the shape the CRD forbids", () => {
    expect(imageOciRepositoryError("ghcr.io/example/golden:24.04")).toBe(ociRepositoryTaggedMessage);
  });

  it("refuses a repository that carries its own digest, for the same reason", () => {
    expect(imageOciRepositoryError(`ghcr.io/example/golden@sha256:${"a".repeat(64)}`)).toBe(ociRepositoryTaggedMessage);
  });

  it("accepts a registry with a port, which is a colon that is not a tag", () => {
    expect(imageOciRepositoryError("localhost:5000/golden-ubuntu")).toBeUndefined();
  });

  it("accepts a plain repository", () => {
    expect(imageOciRepositoryError("ghcr.io/example/golden-ubuntu-noble")).toBeUndefined();
  });

  it("accepts a repository with no registry at all, which resolves to Docker Hub", () => {
    expect(imageOciRepositoryError("example/golden")).toBeUndefined();
  });
});

describe("formatFromFilename", () => {
  it("reads qcow2 off a .qcow2 filename", () => {
    expect(formatFromFilename("https://images.example.com/noble.qcow2")).toBe("qcow2");
  });

  it("reads raw off a .img filename, which is what cloud images are usually called", () => {
    expect(formatFromFilename("https://images.example.com/noble-cloudimg-amd64.img")).toBe("raw");
  });

  it("reads raw off a .raw filename", () => {
    expect(formatFromFilename("https://images.example.com/noble.raw")).toBe("raw");
  });

  it("looks through a compression suffix, because the import decompresses first", () => {
    expect(formatFromFilename("https://images.example.com/noble.qcow2.xz")).toBe("qcow2");
  });

  it("ignores a query string, which is where a signed URL puts its parameters", () => {
    expect(formatFromFilename("https://images.example.com/noble.qcow2?token=abc")).toBe("qcow2");
  });

  it("ignores the case of the suffix", () => {
    expect(formatFromFilename("https://images.example.com/NOBLE.QCOW2")).toBe("qcow2");
  });

  it("says nothing about a URL with no filename at all", () => {
    expect(formatFromFilename("https://images.example.com/download")).toBeUndefined();
  });

  it("says nothing about an empty URL", () => {
    expect(formatFromFilename("")).toBeUndefined();
  });

  it("is not fooled by a directory that ends in .qcow2", () => {
    expect(formatFromFilename("https://images.example.com/noble.qcow2/download")).toBeUndefined();
  });
});

describe("isMalformedDigest", () => {
  it("accepts a sha256 digest", () => {
    expect(isMalformedDigest(`sha256:${"a".repeat(64)}`)).toBe(false);
  });

  it("accepts a sha512 digest, because the algorithm is not ours to enumerate", () => {
    expect(isMalformedDigest(`sha512:${"f".repeat(128)}`)).toBe(false);
  });

  it("refuses a digest with no algorithm", () => {
    expect(isMalformedDigest("a".repeat(64))).toBe(true);
  });

  it("refuses a digest whose hex is too short to be one", () => {
    expect(isMalformedDigest("sha256:abcd")).toBe(true);
  });

  it("refuses a digest with non-hex characters", () => {
    expect(isMalformedDigest(`sha256:${"z".repeat(64)}`)).toBe(true);
  });

  it("says nothing about an empty value, which is the required-field rule's business", () => {
    expect(isMalformedDigest("")).toBe(false);
  });

  it("warns rather than refuses, because only the registry knows what it accepts", () => {
    expect(ociDigestShapeWarning).toContain("Nothing here refuses another shape");
  });
});

describe("imageCreateErrors", () => {
  it("accepts a filled HTTP form", () => {
    expect(imageCreateErrors(values())).toEqual({});
  });

  it("accepts a filled OCI form", () => {
    expect(imageCreateErrors(ociValues())).toEqual({});
  });

  it("requires a namespace, and says what lives in it", () => {
    expect(imageCreateErrors(values({ namespace: "" })).namespace).toContain("import PVC");
  });

  it("requires a name", () => {
    expect(imageCreateErrors(values({ name: "" })).name).toContain("required");
  });

  it("refuses a name that is not an RFC-1123 object name", () => {
    expect(imageCreateErrors(values({ name: "Noble Image" })).name).toContain("lowercase");
  });

  it("carries the URL's own rules on the HTTP branch", () => {
    expect(imageCreateErrors(values({ httpUrl: "" })).httpUrl).toBe(httpUrlRequiredMessage);
  });

  it("does not carry the URL's rules on the OCI branch, where there is no URL", () => {
    expect(imageCreateErrors(ociValues()).httpUrl).toBeUndefined();
  });

  it("carries the repository's rules on the OCI branch", () => {
    expect(imageCreateErrors(ociValues({ ociRepository: "" })).ociRepository).toBe(ociRepositoryRequiredMessage);
  });

  it("does not carry the repository's rules on the HTTP branch", () => {
    expect(imageCreateErrors(values()).ociRepository).toBeUndefined();
  });

  it("refuses an OCI source pinned by tag with no tag, which no layer upstream checks (F7)", () => {
    expect(imageCreateErrors(ociValues({ ociPinBy: "tag", ociTag: "" })).ociTag).toBe(ociTagRequiredMessage);
  });

  it("refuses an OCI source pinned by digest with no digest, for the same reason", () => {
    expect(imageCreateErrors(ociValues({ ociDigest: "" })).ociDigest).toBe(ociDigestRequiredMessage);
  });

  it("names what an unpinned OCI source really does: it hands the puller an empty reference", () => {
    expect(ociTagRequiredMessage).toContain("empty reference");
    expect(ociDigestRequiredMessage).toContain("empty reference");
  });

  it("refuses only the pin in use, so the field that was emptied is not a second error", () => {
    const errors = imageCreateErrors(ociValues({ ociPinBy: "tag", ociTag: "" }));

    expect(errors.ociTag).toBeDefined();
    expect(errors.ociDigest).toBeUndefined();
  });

  it("requires a format, because the webhook that would fill it in ships disabled", () => {
    expect(imageCreateErrors(values({ format: "" })).format).toBe(formatRequiredMessage);
  });

  it("refuses a root disk size of zero, which the API server accepts", () => {
    expect(imageCreateErrors(values({ rootDiskSize: "0" })).rootDiskSize).toBe(quantityZeroMessage);
  });

  it("refuses a negative root disk size, which the API server also accepts", () => {
    expect(imageCreateErrors(values({ rootDiskSize: "-5Gi" })).rootDiskSize).toBe(quantityNegativeMessage);
  });

  it("refuses a root disk size that is not a quantity at all", () => {
    expect(imageCreateErrors(values({ rootDiskSize: "40 gigs" })).rootDiskSize).toContain("Kubernetes quantity");
  });

  it("accepts an empty root disk size, which is the normal case", () => {
    expect(imageCreateErrors(values({ rootDiskSize: "" })).rootDiskSize).toBeUndefined();
  });

  it("refuses the snapshot strategy with no volume snapshot class (F8)", () => {
    expect(imageCreateErrors(values({ cloneStrategy: "snapshot" })).volumeSnapshotClassName).toBe(
      volumeSnapshotClassRequiredMessage,
    );
  });

  it("says what happens without it: the whole import runs first, then Snapshotting fails", () => {
    expect(volumeSnapshotClassRequiredMessage).toContain("downloaded, converted and measured");
  });

  it("does not require a volume snapshot class for the copy strategy", () => {
    expect(imageCreateErrors(values({ volumeSnapshotClassName: "" })).volumeSnapshotClassName).toBeUndefined();
  });

  it("accepts the snapshot strategy once a class is named", () => {
    expect(imageCreateErrors(values({ cloneStrategy: "snapshot", volumeSnapshotClassName: "csi-snapclass" }))).toEqual(
      {},
    );
  });

  it("refuses an import storage class name the API server would refuse", () => {
    expect(imageCreateErrors(values({ importStorageClassName: "Fast Storage" })).importStorageClassName).toBe(
      storageClassNameMessage,
    );
  });

  it("accepts an empty import storage class, which falls through to the cluster default", () => {
    expect(imageCreateErrors(values({ importStorageClassName: "" })).importStorageClassName).toBeUndefined();
  });

  it("gives every refusal a non-empty reason (W4)", () => {
    const broken = imageCreateErrors(
      values({
        namespace: "",
        name: "",
        httpUrl: "",
        format: "",
        rootDiskSize: "0",
        cloneStrategy: "snapshot",
        importStorageClassName: "NOPE",
      }),
    );

    expect(Object.keys(broken).length).toBeGreaterThan(0);

    for (const message of Object.values(broken)) {
      expect(message).toBeTruthy();
      // The shortest of them is the shipped name rule's "A name is required.",
      // which is the floor every message on this form clears.
      expect((message as string).length).toBeGreaterThanOrEqual("A name is required.".length);
    }
  });

  it("names both fields of the collapsed section, so the section can open itself on either", () => {
    expect(imageStorageSectionFields).toEqual(["volumeSnapshotClassName", "importStorageClassName"]);
  });
});

describe("imageCreateWarnings", () => {
  it("says nothing about a form with nothing to say", () => {
    expect(imageCreateWarnings(inputs(), values())).toEqual({});
  });

  it("warns about a name the store already holds, and never blocks it", () => {
    expect(imageCreateWarnings(inputs(), values({ name: "ubuntu-2404" })).name).toContain("already exists");
  });

  it("marks the collision unverified when the list was refused, rather than saying the name is free", () => {
    const warnings = imageCreateWarnings(inputs({ existingNames: [], existingNamesUnverified: true }), values());

    expect(warnings.name).toContain("unverified");
  });

  it("says nothing about a collision before a name is typed", () => {
    expect(imageCreateWarnings(inputs({ existingNamesUnverified: true }), values({ name: "" })).name).toBeUndefined();
  });

  it("warns when a .qcow2 URL is declared raw, and says it is a guess", () => {
    const warnings = imageCreateWarnings(
      inputs(),
      values({ httpUrl: "https://images.example.com/noble.qcow2", format: "raw" }),
    );

    expect(warnings.format).toContain("GUESS");
    expect(warnings.format).toContain("qcow2");
  });

  it("warns the other way round too, when a .img URL is declared qcow2", () => {
    expect(
      imageCreateWarnings(inputs(), values({ httpUrl: "https://images.example.com/noble.img", format: "qcow2" }))
        .format,
    ).toBeDefined();
  });

  it("says nothing when the filename agrees with the format", () => {
    expect(imageCreateWarnings(inputs(), values()).format).toBeUndefined();
  });

  it("says nothing when the filename says nothing", () => {
    expect(
      imageCreateWarnings(inputs(), values({ httpUrl: "https://images.example.com/download" })).format,
    ).toBeUndefined();
  });

  it("never guesses at a format on the OCI branch, where there is no filename to read", () => {
    expect(imageCreateWarnings(inputs(), ociValues({ format: "qcow2" })).format).toBeUndefined();
  });

  it("warns about a digest that does not look like one", () => {
    expect(imageCreateWarnings(inputs(), ociValues({ ociDigest: "sha256:abcd" })).ociDigest).toBe(
      ociDigestShapeWarning,
    );
  });

  it("warns about a verify key over a plaintext registry, and says it fails closed", () => {
    const warnings = imageCreateWarnings(inputs(), ociValues({ ociInsecure: true, ociVerifyKeySecret: "cosign-key" }));

    expect(warnings.ociInsecure).toBe(ociInsecureWithVerifyKeyWarning);
    expect(ociInsecureWithVerifyKeyWarning).toContain("fails closed");
  });

  it("says that the webhook which would refuse that pair ships disabled", () => {
    expect(ociInsecureWithVerifyKeyWarning).toContain("webhook ships disabled");
  });

  it("says nothing about a plaintext registry with no verify key, which is merely unsafe", () => {
    expect(imageCreateWarnings(inputs(), ociValues({ ociInsecure: true })).ociInsecure).toBeUndefined();
  });

  it("warns about a credentials Secret the namespace does not hold", () => {
    expect(imageCreateWarnings(inputs(), ociValues({ ociCredentialsSecret: "gone" })).ociCredentialsSecret).toContain(
      "No Secret named gone",
    );
  });

  it("names the consequence of a missing pull secret: an Importing hang, not a refusal", () => {
    expect(imageCreateWarnings(inputs(), ociValues({ ociCredentialsSecret: "gone" })).ociCredentialsSecret).toContain(
      "hangs in Importing forever",
    );
  });

  it("marks a Secret unverified rather than missing when the read was refused (T3)", () => {
    const warnings = imageCreateWarnings(
      inputs({ secrets: [], secretsUnverified: true }),
      ociValues({ ociVerifyKeySecret: "cosign-key" }),
    );

    expect(warnings.ociVerifyKeySecret).toContain("unverified");
    expect(warnings.ociVerifyKeySecret).not.toContain("No Secret named");
  });

  it("says nothing about a Secret the namespace does hold", () => {
    expect(
      imageCreateWarnings(inputs(), ociValues({ ociCredentialsSecret: "registry-creds" })).ociCredentialsSecret,
    ).toBeUndefined();
  });

  it("never warns about Secrets on the HTTP branch, where neither field exists", () => {
    const warnings = imageCreateWarnings(inputs(), values({ ociCredentialsSecret: "gone" }));

    expect(warnings.ociCredentialsSecret).toBeUndefined();
  });

  it("warns about an import storage class the cluster does not hold", () => {
    expect(imageCreateWarnings(inputs(), values({ importStorageClassName: "gone" })).importStorageClassName).toContain(
      "never binds",
    );
  });

  it("marks the import storage class unverified when the cluster read was refused", () => {
    const warnings = imageCreateWarnings(
      inputs({ storageClasses: [], storageClassesUnverified: true }),
      values({ importStorageClassName: "fast" }),
    );

    expect(warnings.importStorageClassName).toContain("unverified");
  });

  it("says nothing about an import storage class the cluster does hold", () => {
    expect(
      imageCreateWarnings(inputs(), values({ importStorageClassName: "fast" })).importStorageClassName,
    ).toBeUndefined();
  });

  it("does not warn about a malformed class name, which is already an error", () => {
    expect(
      imageCreateWarnings(inputs(), values({ importStorageClassName: "Fast Storage" })).importStorageClassName,
    ).toBeUndefined();
  });
});

describe("imageBlockingIssues and imageSubmitBlockReason", () => {
  it("says nothing about a form that would submit", () => {
    expect(imageBlockingIssues(values())).toEqual([]);
    expect(imageSubmitBlockReason(values())).toBeUndefined();
  });

  it("names the field and its reason next to the button (W4, W12)", () => {
    const reason = imageSubmitBlockReason(values({ httpUrl: "" }));

    expect(reason).toContain(imageFieldLabels.httpUrl);
    expect(reason).toContain(httpUrlRequiredMessage);
  });

  it("names the fields in the reading order of the form", () => {
    const issues = imageBlockingIssues(values({ namespace: "", name: "", httpUrl: "", format: "" }));

    expect(issues.map((issue) => issue.label)).toEqual(["Namespace", "Name", "URL", "Format"]);
  });

  it("names the first issue only, because a button carries one sentence", () => {
    expect(imageSubmitBlockReason(values({ namespace: "", format: "" }))).toContain("Namespace");
  });

  it("reaches into the collapsed section, whose error opens it", () => {
    expect(imageSubmitBlockReason(values({ cloneStrategy: "snapshot" }))).toContain("Volume snapshot class");
  });

  it("gives every field a label the sentence can use", () => {
    for (const label of Object.values(imageFieldLabels)) {
      expect(label).toBeTruthy();
    }
  });
});

describe("imageSourcePayload", () => {
  it("writes exactly one key, and it is the source the form is on", () => {
    expect(Object.keys(imageSourcePayload(values()))).toEqual(["http"]);
    expect(Object.keys(imageSourcePayload(ociValues()))).toEqual(["oci"]);
  });

  it("trims the URL, because a padded one is a download of nothing", () => {
    expect(imageSourcePayload(values({ httpUrl: "  https://x/y.img  " })).http).toEqual({ url: "https://x/y.img" });
  });

  it("writes the digest when the form is pinned by digest, and no tag", () => {
    const oci = imageSourcePayload(ociValues()).oci;

    expect(oci?.digest).toBe(`sha256:${"a".repeat(64)}`);
    expect(oci?.tag).toBeUndefined();
  });

  it("writes the tag when the form is pinned by tag, and no digest", () => {
    const oci = imageSourcePayload(ociValues({ ociPinBy: "tag", ociTag: "24.04", ociDigest: "" })).oci;

    expect(oci?.tag).toBe("24.04");
    expect(oci?.digest).toBeUndefined();
  });

  it("never writes both, even from a form that somehow holds both (the XOR, as a property)", () => {
    const oci = imageSourcePayload(ociValues({ ociPinBy: "tag", ociTag: "24.04" })).oci;

    expect(oci?.tag).toBe("24.04");
    expect(oci?.digest).toBeUndefined();
  });

  it("omits insecure rather than writing false, which the schema does not default", () => {
    expect(imageSourcePayload(ociValues()).oci?.insecure).toBeUndefined();
  });

  it("writes insecure when it is on", () => {
    expect(imageSourcePayload(ociValues({ ociInsecure: true })).oci?.insecure).toBe(true);
  });

  it("never emits an empty-name credentials reference (G7)", () => {
    expect(imageSourcePayload(ociValues({ ociCredentialsSecret: "   " })).oci?.credentialsSecretRef).toBeUndefined();
  });

  it("never emits an empty-name verify-key reference either", () => {
    expect(imageSourcePayload(ociValues({ ociVerifyKeySecret: "" })).oci?.verifyKeySecretRef).toBeUndefined();
  });

  it("writes both Secret references when both are named", () => {
    const oci = imageSourcePayload(
      ociValues({ ociCredentialsSecret: "registry-creds", ociVerifyKeySecret: "cosign-key" }),
    ).oci;

    expect(oci?.credentialsSecretRef).toEqual({ name: "registry-creds" });
    expect(oci?.verifyKeySecretRef).toEqual({ name: "cosign-key" });
  });

  it("trims the repository and the pin", () => {
    const oci = imageSourcePayload(
      ociValues({ ociRepository: " ghcr.io/x/y ", ociDigest: ` sha256:${"a".repeat(64)} ` }),
    ).oci;

    expect(oci?.repository).toBe("ghcr.io/x/y");
    expect(oci?.digest).toBe(`sha256:${"a".repeat(64)}`);
  });
});

describe("imageCreatePayload", () => {
  it("sends the two keys the schema requires and nothing else, from a minimal HTTP form", () => {
    expect(Object.keys(imageCreatePayload(values()).spec).sort()).toEqual(["format", "source"]);
  });

  it("always sends the format explicitly (F16)", () => {
    expect(imageCreatePayload(values({ format: "qcow2" })).spec.format).toBe("qcow2");
  });

  it("says at the field why the format is always sent", () => {
    expect(formatAlwaysSentFact).toContain("webhook-on cluster and rejected on a webhook-off one");
  });

  it("never sends osType linux, which the API server stamps (F17)", () => {
    expect(imageCreatePayload(values()).spec.osType).toBeUndefined();
  });

  it("sends osType windows, which the API server does not stamp", () => {
    expect(imageCreatePayload(values({ osType: "windows" })).spec.osType).toBe("windows");
  });

  it("never sends cloneStrategy copy, which the API server stamps (F17)", () => {
    expect(imageCreatePayload(values()).spec.cloneStrategy).toBeUndefined();
  });

  it("sends cloneStrategy snapshot with the class it needs", () => {
    const spec = imageCreatePayload(
      values({ cloneStrategy: "snapshot", volumeSnapshotClassName: "csi-snapclass" }),
    ).spec;

    expect(spec.cloneStrategy).toBe("snapshot");
    expect(spec.volumeSnapshotClassName).toBe("csi-snapclass");
  });

  it("never sends a volume snapshot class without the strategy that reads it", () => {
    expect(
      imageCreatePayload(values({ volumeSnapshotClassName: "csi-snapclass" })).spec.volumeSnapshotClassName,
    ).toBeUndefined();
  });

  it("sends no rootDisk at all when no size was typed, because 10Gi is a controller constant", () => {
    expect(imageCreatePayload(values()).spec.rootDisk).toBeUndefined();
  });

  it("sends the size that was typed", () => {
    expect(imageCreatePayload(values({ rootDiskSize: "40Gi" })).spec.rootDisk).toEqual({ size: "40Gi" });
  });

  it("trims the size, so a padded value is not stored as one", () => {
    expect(imageCreatePayload(values({ rootDiskSize: " 40Gi " })).spec.rootDisk).toEqual({ size: "40Gi" });
  });

  it("sends no rootDisk for a size of whitespace", () => {
    expect(imageCreatePayload(values({ rootDiskSize: "   " })).spec.rootDisk).toBeUndefined();
  });

  it("sends the import storage class when one is named", () => {
    expect(imageCreatePayload(values({ importStorageClassName: "fast" })).spec.importStorageClassName).toBe("fast");
  });

  it("sends no import storage class when none is", () => {
    expect(imageCreatePayload(values()).spec.importStorageClassName).toBeUndefined();
  });

  it("never sends cloneStorageClassName, which the controller reads nowhere (F15)", () => {
    expect(imageCreatePayload(values()).spec.cloneStorageClassName).toBeUndefined();
    expect(imageCreatePayload(ociValues()).spec.cloneStorageClassName).toBeUndefined();
  });

  it("never sends an upload or a pvcClone source, whatever the form held", () => {
    expect(imageCreatePayload(values()).spec.source.upload).toBeUndefined();
    expect(imageCreatePayload(values()).spec.source.pvcClone).toBeUndefined();
  });

  it("carries no name and no namespace: the store's create carries both", () => {
    const spec = imageCreatePayload(values()).spec as unknown as Record<string, unknown>;

    expect(spec.name).toBeUndefined();
    expect(spec.namespace).toBeUndefined();
  });

  it("writes the whole OCI object a fully filled form describes", () => {
    const spec = imageCreatePayload(
      ociValues({
        ociCredentialsSecret: "registry-creds",
        ociVerifyKeySecret: "cosign-key",
        format: "raw",
        osType: "windows",
        rootDiskSize: "60Gi",
        cloneStrategy: "snapshot",
        volumeSnapshotClassName: "csi-snapclass",
        importStorageClassName: "fast",
      }),
    ).spec;

    expect(spec).toEqual({
      format: "raw",
      source: {
        oci: {
          repository: "ghcr.io/example/golden-ubuntu-noble",
          digest: `sha256:${"a".repeat(64)}`,
          credentialsSecretRef: { name: "registry-creds" },
          verifyKeySecretRef: { name: "cosign-key" },
        },
      },
      osType: "windows",
      rootDisk: { size: "60Gi" },
      cloneStrategy: "snapshot",
      volumeSnapshotClassName: "csi-snapclass",
      importStorageClassName: "fast",
    });
  });

  it("never emits a source with two keys, whatever the form values are", () => {
    for (const source of imageSourceKinds) {
      const spec = imageCreatePayload(
        values({ source, httpUrl: "https://x/y.img", ociRepository: "ghcr.io/x/y", ociTag: "1", ociDigest: "d" }),
      ).spec;

      expect(Object.keys(spec.source)).toHaveLength(1);
    }
  });
});

describe("imageCreateSummary", () => {
  it("opens with the one API call the dialog makes (W1)", () => {
    expect(imageCreateSummary(inputs(), values()).write).toBe("Create SwiftImage kubeswift-e2e/noble");
  });

  it("uses placeholders before the namespace and the name are typed", () => {
    expect(imageCreateSummary(inputs(), values({ namespace: "", name: "" })).write).toBe(
      "Create SwiftImage <namespace>/<name>",
    );
  });

  it("names the HTTP source it will import, and the absence of any checksum", () => {
    const notes = imageCreateSummary(inputs(), values()).notes.join(" ");

    expect(notes).toContain("images.example.com/noble-server-cloudimg-amd64.img");
    expect(notes).toContain("no checksum field");
  });

  it("names the OCI reference the way a registry would", () => {
    expect(imageCreateSummary(inputs(), ociValues()).notes.join(" ")).toContain(
      `ghcr.io/example/golden-ubuntu-noble@sha256:${"a".repeat(64)}`,
    );
  });

  it("names a tag reference with a colon", () => {
    expect(
      imageCreateSummary(inputs(), ociValues({ ociPinBy: "tag", ociTag: "24.04", ociDigest: "" })).notes.join(" "),
    ).toContain("ghcr.io/example/golden-ubuntu-noble:24.04");
  });

  it("says that nothing is verified when no cosign key is named", () => {
    expect(imageCreateSummary(inputs(), ociValues()).notes.join(" ")).toContain("No signature is verified");
  });

  it("says what a cosign key buys when one is named", () => {
    expect(imageCreateSummary(inputs(), ociValues({ ociVerifyKeySecret: "cosign-key" })).notes.join(" ")).toContain(
      "before its bytes are trusted",
    );
  });

  it("warns about a plaintext registry in the summary as well as at the checkbox", () => {
    expect(imageCreateSummary(inputs(), ociValues({ ociInsecure: true })).warnings.join(" ")).toContain(
      "plaintext http",
    );
  });

  it("says that the linux import Job runs privileged and as root", () => {
    expect(imageCreateSummary(inputs(), values()).notes.join(" ")).toContain("privileged and as root");
    expect(osTypeLinuxFact).toContain("PRIVILEGED");
  });

  it("says what a windows image skips instead", () => {
    expect(imageCreateSummary(inputs(), values({ osType: "windows" })).notes.join(" ")).toContain(
      "skips the Linux-only steps",
    );
  });

  it("says that the 10Gi is the controller's own and is not sent", () => {
    expect(imageCreateSummary(inputs(), values()).notes.join(" ")).toContain(
      "the controller's own 10Gi, which is not sent",
    );
  });

  it("names the size that was typed instead", () => {
    expect(imageCreateSummary(inputs(), values({ rootDiskSize: "40Gi" })).notes.join(" ")).toContain(
      "import PVC asks for 40Gi",
    );
  });

  it("lists the three objects a copy-strategy create makes", () => {
    expect(imageCreateSummary(inputs(), values()).notes).toContain(imageCreatesFact("copy"));
    expect(imageCreatesFact("copy")).not.toContain("VolumeSnapshot");
  });

  it("lists the fourth object the snapshot strategy adds", () => {
    expect(imageCreatesFact("snapshot")).toContain("VolumeSnapshot clone seed");
  });

  it("walks the phases, with Snapshotting only where the strategy puts it", () => {
    expect(imagePhaseWalkFact("copy")).toBe("The walk is Pending, Importing, Validating, Preparing, Ready.");
    expect(imagePhaseWalkFact("snapshot")).toContain("Snapshotting");
  });

  it("says that Failed is terminal, and never borrows SPEC-0013's self-heal sentence (F13)", () => {
    const notes = imageCreateSummary(inputs(), values()).notes;

    expect(notes).toContain(imageTerminalFailedFact);
    expect(imageTerminalFailedFact).toContain("delete-and-recreate");
    expect(notes.join(" ")).not.toContain("self-heal");
  });

  it("says that a declared format is taken on trust, all the way to a booting guest", () => {
    expect(imageCreateSummary(inputs(), values()).notes).toContain(imageDeclaredFormatIsTrustedFact);
    expect(imageDeclaredFormatIsTrustedFact).toContain("boots garbage");
  });

  it("names the two silent indefinite Importing hangs", () => {
    expect(imageCreateSummary(inputs(), values()).notes).toContain(imageImportingHangsFact);
    expect(imageImportingHangsFact).toContain("no Events");
  });

  it("names the missing TTLs", () => {
    expect(imageCreateSummary(inputs(), values()).notes).toContain(imageNoTtlFact);
  });

  it("names the whole diagnostic surface, which is one phase and one condition message", () => {
    expect(imageCreateSummary(inputs(), values()).notes).toContain(imageDiagnosticSurfaceFact);
  });

  it("marks a volume snapshot class unverified for a reason of its own: there is no read to make", () => {
    const warnings = imageCreateSummary(
      inputs(),
      values({ cloneStrategy: "snapshot", volumeSnapshotClassName: "csi-snapclass" }),
    ).warnings.join(" ");

    expect(warnings).toContain("no VolumeSnapshotClass API is exported");
  });

  it("does not mark one when the strategy does not read it", () => {
    expect(
      imageCreateSummary(inputs(), values({ volumeSnapshotClassName: "csi-snapclass" })).warnings.join(" "),
    ).not.toContain("VolumeSnapshotClass API");
  });

  it("repeats the collision warning where the user reads before pressing OK", () => {
    expect(imageCreateSummary(inputs(), values({ name: "ubuntu-2404" })).warnings.join(" ")).toContain(
      "already exists",
    );
  });

  it("repeats the filename guess in the summary too", () => {
    expect(
      imageCreateSummary(inputs(), values({ httpUrl: "https://images.example.com/noble.qcow2" })).warnings.join(" "),
    ).toContain("GUESS");
  });

  it("says nothing about the import storage class when none is named", () => {
    expect(imageCreateSummary(inputs(), values()).notes.join(" ")).not.toContain("also pins where every guest");
  });

  it("says what naming one pins", () => {
    expect(imageCreateSummary(inputs(), values({ importStorageClassName: "fast" })).notes.join(" ")).toContain(
      "also pins where every guest built from this image lives",
    );
  });
});

describe("the sentences the form carries", () => {
  it("describes each source under its own radio", () => {
    expect(imageSourceNote("http")).toContain("no verification of any kind");
    expect(imageSourceNote("oci")).toContain("supply-chain features");
  });

  it("describes each clone strategy, including the docs' own slower-than-copy warning", () => {
    expect(cloneStrategyNote("snapshot")).toContain("SLOWER than copy");
    expect(cloneStrategyNote("copy")).toContain("not sent");
  });

  it("puts the section's consequence on its header line, whether it is open or shut", () => {
    expect(storageSectionHint(values())).toContain("copy");
    expect(storageSectionHint(values({ cloneStrategy: "snapshot" }))).toContain("volume snapshot class");
  });

  it("states the silent corruption at the format field, in the form's own terms", () => {
    expect(formatSilentCorruptionFact).toContain("boots garbage");
    expect(formatSilentCorruptionFact).toContain("No magic-byte check");
  });

  it("says of the filename warning that it is a guess and not a check of content", () => {
    expect(formatFilenameWarning("qcow2", "raw")).toContain("not a check of the content");
  });

  it("names the three dropped fields in the footer, each with what it claims to control", () => {
    expect(imageDroppedFieldsFacts).toHaveLength(3);
    expect(imageDroppedFieldsFacts[0]).toContain("upload");
    expect(imageDroppedFieldsFacts[1]).toContain("pvcClone");
    expect(imageDroppedFieldsFacts[2]).toContain("cloneStorageClassName");
  });

  it("says of upload that it exists on no side at all", () => {
    expect(uploadDroppedFact).toContain("not-implemented");
  });
});

describe("the sentences a create's outcome carries", () => {
  it("acknowledges a create that succeeded (W9)", () => {
    expect(imageCreateSuccessMessage("kubeswift-e2e", "noble")).toBe("SwiftImage kubeswift-e2e/noble created");
  });

  it("names the collision a 409 is", () => {
    expect(imageCreateFailurePrefix(conflictStatusCode, { namespace: "ns", name: "noble" })).toContain(
      "already exists",
    );
  });

  it("names the verb, the resource and the namespace a 403 refused", () => {
    expect(imageCreateFailurePrefix(forbiddenStatusCode, { namespace: "ns", name: "noble" })).toContain(
      "create swiftimages in the namespace ns",
    );
  });

  it("says what a 404 means here: the namespace or the CRD is gone", () => {
    expect(imageCreateFailurePrefix(notFoundStatusCode, { namespace: "ns", name: "noble" })).toContain("is gone");
  });

  it("predicts nothing about a status code it does not know", () => {
    expect(imageCreateFailurePrefix(500, { namespace: "ns", name: "noble" })).toBeUndefined();
  });

  it("prefixes its own sentence to what the API server said, never replacing it (W9)", () => {
    const message = imageCreateFailureMessage(
      { code: conflictStatusCode, message: "images.image.kubeswift.io noble already exists", alreadyNotified: false },
      { namespace: "ns", name: "noble" },
    );

    expect(message).toContain("Change the name and try again.");
    expect(message).toContain("already exists");
  });

  it("passes an unpredicted failure through as it arrived", () => {
    expect(
      imageCreateFailureMessage(
        { code: 500, message: "etcdserver: request timed out", alreadyNotified: false },
        {
          namespace: "ns",
          name: "noble",
        },
      ),
    ).toBe("etcdserver: request timed out");
  });

  it("falls back to its own sentence when the API server said nothing", () => {
    expect(
      imageCreateFailureMessage(
        { code: forbiddenStatusCode, message: undefined, alreadyNotified: true },
        {
          namespace: "ns",
          name: "noble",
        },
      ),
    ).toContain("not allowed");
  });
});

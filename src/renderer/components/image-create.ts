/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the Create Image form decides, as pure functions over structurally
// declared inputs (SPEC-0014, "Where the code lives"): the defaults, the
// webhook-only rules, the payload the create sends, the live write summary, and
// the sentences the notifications carry.
//
// Nothing here emits JSX, reads a store or touches a host global. A fact only
// the renderer can know - which Secrets and StorageClasses the reads on open
// returned, which image names the store happens to hold - is taken as an
// argument.
//
// What creating a SwiftImage mechanically IS, and why so little of it is in the
// schema (seventeen leaves, ZERO CEL rules):
//
// - The controller creates FOUR objects: an import PVC named after the image
//   (hardcoded RWO/Filesystem, sized from `rootDisk.size` or 10Gi), an import
//   Job running as uid 0 and `privileged: true` on the `linux` path - that path
//   loop-mounts the disk to patch the bootloader and the serial console - a
//   measure Job read out of its own pod's logs, and, for
//   `cloneStrategy: snapshot`, a VolumeSnapshot clone seed with finalizers.
//   No Job carries a TTL, a backoff limit or a deadline.
// - The walk is Pending -> Importing -> Validating -> Preparing -> Ready, with
//   Snapshotting inserted for the snapshot strategy.
// - `Failed` is TERMINAL and never self-heals: the reconciler returns on the
//   phase before it reads the spec. `Ready` is short-circuited the same way, so
//   an edit to a Ready image is stored and ignored (F13, and deliberately NOT
//   SPEC-0013's self-heal sentence).
// - The controller emits NO Events at all, and two failures produce no
//   condition either: a storage class that cannot bind and a pull secret that
//   cannot mount both hang in `Importing` forever with no requeue.
// - The sharpest fact is silent the other way: an image DECLARED `raw` whose
//   bytes are qcow2 reaches `Ready`. Nothing converts it, the file is renamed
//   in place, the bootloader patch finds no partitions, and every guest built
//   from it boots garbage. No magic-byte check exists in the controller.
// - `format` is the inverted default: the MUTATING webhook fills it in and the
//   schema requires it, so a manifest omitting it is accepted on a webhook-on
//   cluster and rejected on a webhook-off one. It is therefore always sent
//   explicitly (F16).
//
// Twelve of the validator's rules live only in the webhook, and that webhook
// ships disabled (`webhook.enabled: false`), so on a normal install nobody else
// produces these messages at all (W12). The three the spec names by name -
// exactly-one-source, the OCI tag/digest exclusivity, and the snapshot
// strategy's dependency on a volume snapshot class - are the ones this form is
// built around, and the first two are made INEXPRESSIBLE rather than validated
// (F6), which is stronger than mirroring them.

import { forbiddenStatusCode, notFoundStatusCode } from "./guest-actions";
import { quantityError } from "./guestclass-create";
import { storageClassNameError } from "./kube-storage";
import { conflictStatusCode } from "./migration-create";
import { objectNameError } from "./snapshot-create";

import type {
  SwiftImageCloneStrategy,
  SwiftImageDiskFormat,
  SwiftImageOciSource,
  SwiftImageOsType,
  SwiftImageSource,
  SwiftImageSpec,
} from "../api/kubeswift/swiftimage-v1alpha1";
import type { ApiFailureFacts } from "./guest-actions";

/** The verb, on the page's create control, on the OK button and in the failure sentences. */
export const createImageTitle = "Create Image";

/** The two sources this form offers. `upload` and `pvcClone` are dropped in the footer. */
export type ImageSourceKind = "http" | "oci";

/** How an OCI artifact is pinned. Exactly one, which is what makes the XOR inexpressible (F6). */
export type ImagePinBy = "tag" | "digest";

/** The sources, in the order the radio group offers them. */
export const imageSourceKinds: ImageSourceKind[] = ["http", "oci"];

/** The pins, in the order the radio group offers them. */
export const imagePinBys: ImagePinBy[] = ["tag", "digest"];

/** The disk formats the schema's enum offers. */
export const imageDiskFormats: SwiftImageDiskFormat[] = ["raw", "qcow2"];

/** The OS families the schema's enum offers. */
export const imageOsTypes: SwiftImageOsType[] = ["linux", "windows"];

/** The clone strategies the schema's enum offers. */
export const imageCloneStrategies: SwiftImageCloneStrategy[] = ["copy", "snapshot"];

/** The OS type the CRD stamps when the field is absent, and therefore the one never sent (F17). */
export const defaultOsType: SwiftImageOsType = "linux";

/** The clone strategy the CRD stamps when the field is absent, under the same rule (F17). */
export const defaultCloneStrategy: SwiftImageCloneStrategy = "copy";

/**
 * The import PVC size the CONTROLLER applies when `rootDisk.size` is absent.
 *
 * Not a schema default: nothing stamps it, the stored object never carries it,
 * and that is exactly the distinction this form states next to `format`.
 */
export const controllerRootDiskSize = "10Gi";

/** The form's fields, all of them typed. */
export interface ImageFormValues {
  namespace: string;
  name: string;
  /** Which of the two sources this image has. Exactly one, always. */
  source: ImageSourceKind;
  /** `spec.source.http.url`. */
  httpUrl: string;
  /** `spec.source.oci.repository`, without a tag. */
  ociRepository: string;
  /** Which of `tag` and `digest` the artifact is pinned by. Never both, never neither. */
  ociPinBy: ImagePinBy;
  ociTag: string;
  ociDigest: string;
  /** `spec.source.oci.insecure`: a plaintext registry. */
  ociInsecure: boolean;
  /** `spec.source.oci.credentialsSecretRef.name`, never emitted empty (G7). */
  ociCredentialsSecret: string;
  /** `spec.source.oci.verifyKeySecretRef.name`, under the same rule. */
  ociVerifyKeySecret: string;
  /** `spec.format`, required by the schema and always sent explicitly (F16). */
  format: SwiftImageDiskFormat | "";
  osType: SwiftImageOsType;
  /** `spec.rootDisk.size`, optional: an empty value sends no `rootDisk` at all. */
  rootDiskSize: string;
  cloneStrategy: SwiftImageCloneStrategy;
  /** `spec.volumeSnapshotClassName`, required exactly when the strategy is `snapshot` (F8). */
  volumeSnapshotClassName: string;
  importStorageClassName: string;
}

/**
 * What the reads on open found.
 *
 * Both picker reads degrade rather than block (T3): `storageClassApi` is a
 * cluster read and `secretsApi` a namespace one, and a role that carries
 * neither must still be able to write the object it is allowed to write.
 */
export interface ImageCreateInputs {
  /** The namespace's Secret names, for the two OCI pickers. */
  secrets: string[];
  secretsUnverified: boolean;
  /** The cluster's StorageClass names, for the import storage class picker. */
  storageClasses: string[];
  storageClassesUnverified: boolean;
  /** The namespace's SwiftImage names, for the collision warning that never blocks. */
  existingNames: string[];
  existingNamesUnverified: boolean;
}

/**
 * The form as it opens.
 *
 * The namespace comes from the page's own filter when it names exactly one and
 * is otherwise empty and required (F2) - never the literal `default`. The
 * source starts on `http` because it is the source with one field; the pin
 * starts on `digest` because that is the one upstream's own CRD comment
 * recommends, a tag being mutable.
 */
export function defaultImageForm(namespace = ""): ImageFormValues {
  return {
    namespace,
    name: "",
    source: "http",
    httpUrl: "",
    ociRepository: "",
    ociPinBy: "digest",
    ociTag: "",
    ociDigest: "",
    ociInsecure: false,
    ociCredentialsSecret: "",
    ociVerifyKeySecret: "",
    format: "",
    osType: defaultOsType,
    rootDiskSize: "",
    cloneStrategy: defaultCloneStrategy,
    volumeSnapshotClassName: "",
    importStorageClassName: "",
  };
}

/**
 * The form after the source changes: the fields of the source being left
 * emptied.
 *
 * Not tidiness. The payload builder branches on `source`, so a leftover value
 * would be invisible in the object the API server stores and visible in the
 * form, which is the worse of the two - and it is what makes "exactly one
 * source" a property of the payload rather than a rule anyone has to check.
 */
export function switchImageSource(values: ImageFormValues, source: ImageSourceKind): ImageFormValues {
  return {
    ...values,
    source,
    httpUrl: source === "http" ? values.httpUrl : "",
    ociRepository: source === "oci" ? values.ociRepository : "",
    ociTag: source === "oci" ? values.ociTag : "",
    ociDigest: source === "oci" ? values.ociDigest : "",
    ociInsecure: source === "oci" ? values.ociInsecure : false,
    ociCredentialsSecret: source === "oci" ? values.ociCredentialsSecret : "",
    ociVerifyKeySecret: source === "oci" ? values.ociVerifyKeySecret : "",
  };
}

/**
 * The form after the pin changes: the other pin emptied.
 *
 * The same move one level down, and the reason the tag/digest exclusivity is
 * inexpressible rather than validated - the payload cannot carry both, whatever
 * was typed before the radio moved.
 */
export function switchImagePinBy(values: ImageFormValues, pinBy: ImagePinBy): ImageFormValues {
  return {
    ...values,
    ociPinBy: pinBy,
    ociTag: pinBy === "tag" ? values.ociTag : "",
    ociDigest: pinBy === "digest" ? values.ociDigest : "",
  };
}

/** What each source is, one sentence under its own radio. */
export function imageSourceNote(source: ImageSourceKind): string {
  if (source === "http") {
    return (
      "An HTTP(S) URL the import Job downloads. There is no checksum field and no verification of any kind on this " +
      "path: whatever the URL serves at import time is what the image becomes."
    );
  }

  return (
    "A golden disk artifact pulled from an OCI registry, pinned by tag or by digest. This is the only source with " +
    "supply-chain features - registry credentials and a cosign signature check - and the only one upstream's own " +
    "API reference omits."
  );
}

/** The absence the HTTP source carries, said at the field rather than left to be discovered. */
export const httpNoChecksumFact =
  "There is no checksum field and no verification of any kind on the HTTP path. The CRD has one leaf here, the " +
  "URL, so integrity is whatever the server on the other end served at import time. Signature verification exists " +
  "only on the OCI source.";

/** What an empty URL is refused with. This is the webhook's own rule, and the webhook ships disabled. */
export const httpUrlRequiredMessage =
  "A URL is required: it is the only field of the HTTP source, and upstream refuses an empty one in a validating " +
  "webhook that ships disabled - so nothing else would refuse it, and the import Job would fail on an empty " +
  "download instead.";

/** The scheme check upstream has nowhere at all. */
export const httpUrlSchemeMessage =
  "The URL must start with http:// or https://. Nothing upstream checks the scheme - not the schema, not the " +
  "webhook, not the controller - and anything else is handed to the downloader as an address it cannot resolve.";

/**
 * Why a typed HTTP URL would be refused, or `undefined` when it is legal.
 *
 * Two rules: upstream's own (non-empty) and one it has nowhere (the scheme).
 * Nothing here validates the host or the path, because a client that guessed
 * at those would refuse URLs the cluster accepts.
 */
export function imageHttpUrlError(url: string): string | undefined {
  const value = url.trim();

  if (!value) {
    return httpUrlRequiredMessage;
  }

  if (!/^https?:\/\/\S/i.test(value)) {
    return httpUrlSchemeMessage;
  }

  return undefined;
}

/** What an empty repository is refused with. */
export const ociRepositoryRequiredMessage =
  "A repository is required: the schema requires it, and it is the address the artifact is pulled from. Write it " +
  "WITHOUT a tag - the tag or the digest is the field below.";

/** What a repository carrying its own tag is refused with, which is the shape the CRD's comment forbids. */
export const ociRepositoryTaggedMessage =
  "The repository carries a tag of its own. The CRD's repository is the address without one, and the pin below is " +
  "where a tag or a digest goes; a repository that carries both is a reference nothing assembles correctly.";

/**
 * Why a typed OCI repository would be refused, or `undefined` when it is legal.
 *
 * The tag check looks at the last path segment only, so a port in the registry
 * host (`localhost:5000/golden`) is not mistaken for one.
 */
export function imageOciRepositoryError(repository: string): string | undefined {
  const value = repository.trim();

  if (!value) {
    return ociRepositoryRequiredMessage;
  }

  const lastSegment = value.slice(value.lastIndexOf("/") + 1);

  if (lastSegment.includes(":") || lastSegment.includes("@")) {
    return ociRepositoryTaggedMessage;
  }

  return undefined;
}

/**
 * The gap no layer closes, closed here (F7).
 *
 * Neither the schema, nor the webhook, nor the controller checks that one of
 * `tag` and `digest` is set. With neither, the puller is handed an empty
 * reference and fails opaquely, on an object that was admitted without a word.
 */
export const ociTagRequiredMessage =
  "A tag is required once the artifact is pinned by tag. Nothing upstream checks this - not the schema, not the " +
  "webhook, not the controller - and an OCI source with neither a tag nor a digest is admitted happily and then " +
  "hands the puller an empty reference, which fails with a message about nothing.";

/** The same gap, from the digest side. */
export const ociDigestRequiredMessage =
  "A digest is required once the artifact is pinned by digest. Nothing upstream checks this, and an OCI source " +
  "with neither a tag nor a digest is admitted happily and then hands the puller an empty reference, which fails " +
  "with a message about nothing.";

/** What a digest that does not look like one is warned about. A warning, because only the registry knows. */
export const ociDigestShapeWarning =
  "A manifest digest is an algorithm and a hex value, like sha256:<64 hex characters>. Nothing here refuses " +
  "another shape - only the registry knows what it will accept - but the pull is where a malformed one surfaces, " +
  "and it surfaces as an opaque failure.";

/** True when the digest does not have the `<algorithm>:<hex>` shape every registry uses. */
export function isMalformedDigest(digest: string): boolean {
  const value = digest.trim();

  return Boolean(value) && !/^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[0-9a-f]{32,}$/.test(value);
}

/** What `insecure` really allows, said at the checkbox. */
export const ociInsecureFact =
  "Allows a plaintext (http) registry. Upstream's own comment calls it UNSAFE and scopes it to an in-cluster or " +
  "test registry: the artifact travels unencrypted and unauthenticated, and this is the one field on this form " +
  "that changes what the cluster trusts.";

/** The pair upstream rejects at admission, on a cluster where admission does not run. */
export const ociInsecureWithVerifyKeyWarning =
  "A verify key together with insecure is rejected at admission upstream - and that webhook ships disabled, so " +
  "this object will be admitted. What refuses it instead is the puller pod: cosign verify does not support a " +
  "plaintext registry, so the import FAILS rather than importing unverified bytes. It fails closed, and the whole " +
  "diagnosis is one condition message on a terminal Failed.";

/** What the credentials Secret is for, said at the field. */
export const ociCredentialsFact =
  "A kubernetes.io/dockerconfigjson Secret in this namespace, for a private registry. Empty means anonymous. " +
  "Upstream's own wizard offers no field for it at all.";

/** What the verify-key Secret is for, and the one key name it must carry. */
export const ociVerifyKeyFact =
  "A Secret in this namespace holding a cosign PUBLIC key under the key cosign.pub. When it is set the import " +
  "verifies the artifact's signature BEFORE trusting its bytes and fails the import if it does not verify, which " +
  "is the only supply-chain check anywhere in this kind.";

/** A Secret that cannot mount is one of the two silent hangs, and it is worth saying twice. */
export const ociSecretHangWarning =
  "A pull secret that cannot mount does not fail the import: it hangs in Importing forever, with no requeue, no " +
  "Event and no condition.";

/** The fact the format field carries, in this form's own terms (the sharpest one on this kind). */
export const formatSilentCorruptionFact =
  "This declares what the source already IS; nothing converts it and nothing checks it. An image declared raw " +
  "whose bytes are really qcow2 reaches Ready: the file is renamed in place, the bootloader patch finds no " +
  "partitions, and every guest built from it boots garbage. No magic-byte check exists in the controller, though " +
  "upstream's own CLI does exactly that check on the producer side.";

/** Why `format` is sent explicitly even though a webhook would fill it in (F16). */
export const formatAlwaysSentFact =
  "Sent explicitly, always. The mutating webhook that would default it ships disabled while the schema requires " +
  "it, so a manifest omitting it is accepted on a webhook-on cluster and rejected on a webhook-off one. This form " +
  "writes objects that behave the same on both.";

/** What an unchosen format is refused with. */
export const formatRequiredMessage =
  "A format is required: the schema requires it, and the webhook that would have filled it in ships disabled.";

/** The extensions a URL's last segment can carry, and what each one says the bytes are. */
const filenameFormats: { suffix: string; format: SwiftImageDiskFormat }[] = [
  { suffix: ".qcow2", format: "qcow2" },
  { suffix: ".qcow", format: "qcow2" },
  { suffix: ".raw", format: "raw" },
  { suffix: ".img", format: "raw" },
];

/**
 * What the URL's filename says the format is, or `undefined` when it says
 * nothing.
 *
 * Deliberately small: four suffixes, the last path segment, compression
 * suffixes stripped. Anything cleverer would be a client pretending to know
 * something about bytes it has never seen.
 */
export function formatFromFilename(url: string): SwiftImageDiskFormat | undefined {
  const withoutQuery = url.trim().split(/[?#]/)[0];
  const segment = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1).toLowerCase();
  const name = segment.replace(/\.(gz|xz|bz2|zst)$/, "");

  return filenameFormats.find((candidate) => name.endsWith(candidate.suffix))?.format;
}

/** The warning a filename that disagrees with the declared format carries, said as the guess it is. */
export function formatFilenameWarning(guessed: SwiftImageDiskFormat, declared: SwiftImageDiskFormat): string {
  return (
    `The URL's filename looks like ${guessed} and the format says ${declared}. This is a GUESS about a filename, ` +
    "not a check of the content - no client ever sees the bytes - so it blocks nothing. It is worth reading twice " +
    "all the same, because nothing downstream checks either: a wrong format is imported, prepared and marked Ready."
  );
}

/** The effective OS type, said as a fact rather than asked for when it is the default (F17). */
export const osTypeLinuxFact =
  "linux is what the API server stamps when the field is absent, so it is not sent. It also selects the import " +
  "path that runs the Job as uid 0 and PRIVILEGED: that path loop-mounts the disk to patch the bootloader and the " +
  "serial console, which is what makes a Linux import a privileged workload in this namespace.";

/** What choosing `windows` does, and what it costs. */
export const osTypeWindowsFact =
  "windows skips the Linux-only import steps - the GRUB and serial patch, and the growpart resize expectation - " +
  "so the disk is imported as it is. It is the one value this form sends explicitly, because it is not the one " +
  "the API server stamps.";

/** The root disk size, and the distinction from `format` the spec asks to be stated. */
export const rootDiskSizeFact =
  `Optional. Left empty, the controller sizes the import PVC at ${controllerRootDiskSize} - and that value is NOT ` +
  "sent and never appears in the stored object, which is the difference from the format above: the format is " +
  "required by the API server, while this is a constant inside the controller.";

/** The three numbers this kind carries, and which one this field is. */
export const rootDiskSizeIsTheRequestFact =
  "This is the PVC REQUEST. The size the status later reports is the measured size of the prepared artifact, " +
  "which is a different number, and the guest class's own root disk size is a third. This form sends one of the " +
  "three.";

/** What each clone strategy does, one sentence per option. */
export function cloneStrategyNote(strategy: SwiftImageCloneStrategy): string {
  if (strategy === "snapshot") {
    return (
      "Each guest's root disk is provisioned from a VolumeSnapshot of the prepared image, which needs a " +
      "snapshot-capable CSI driver. Upstream's own clone-strategies document warns that this can be SLOWER than " +
      "copy on a driver whose snapshots are full copies, so it is not a free speed-up. It also adds a phase - " +
      "Snapshotting - and a VolumeSnapshot with finalizers to the objects this image owns."
    );
  }

  return (
    "Each guest's root disk is a full copy of the prepared image. This is what the API server stamps when the " +
    "field is absent, so it is not sent, and it is the strategy that works on every driver."
  );
}

/** What a snapshot strategy without a volume snapshot class is refused with (F8). */
export const volumeSnapshotClassRequiredMessage =
  "A volume snapshot class is required by the snapshot strategy. Upstream refuses the pair in a validating " +
  "webhook that ships disabled, and what happens without it is worse than a rejection: the import runs to " +
  "completion - downloaded, converted and measured - and only then fails on reaching Snapshotting.";

/** Why the class is a text input, and what that costs in the summary. */
export const volumeSnapshotClassUnverifiedFact =
  "Typed rather than picked: the host exposes no VolumeSnapshotClass API to extensions, so this name cannot be " +
  "checked from here at all. It is marked unverified in the summary for that reason - not because a read was " +
  "refused, but because there is no read to make.";

/** What the import storage class decides, and what it pins. */
export const importStorageClassFact =
  "The class of the IMPORT PVC, the one holding the prepared disk. Empty uses the cluster default. Because the " +
  "per-guest clone class defaults to this one, and most CSI drivers cannot clone across classes, this field also " +
  "pins where every guest built from this image will live - and it is immutable once the import PVC exists.";

/** The header line of the collapsed section, visible whether it is open or shut (DESIGN.md section 12). */
export function storageSectionHint(values: ImageFormValues): string {
  if (values.cloneStrategy === "snapshot") {
    return "Clone strategy snapshot: each guest's disk comes from a VolumeSnapshot, which needs a volume snapshot class.";
  }

  return "Clone strategy copy (the API server's own default), on the cluster's default storage class unless one is named here.";
}

/** The `upload` source, dropped with what it claims to control (W12 option dropping). */
export const uploadDroppedFact =
  "upload is not offered: it exists on no side. An empty Go struct, a property-less CRD object, a controller that " +
  "parks it as not-implemented with a pinning test, no gateway endpoint, no RPC and no CLI path. Choosing it " +
  "produces an object with a Failed condition and a permanently blank phase.";

/** The `pvcClone` source, dropped for a sharper reason: it is a stub that always fails. */
export const pvcCloneDroppedFact =
  "pvcClone is not offered: it is a stub that always fails. Upstream's own API reference presents it as working, " +
  "with a worked example, and its wizard offers it as a first-class button - which is a button that produces a " +
  "Failed object.";

/** `cloneStorageClassName`, read nowhere in the controller. */
export const cloneStorageClassDroppedFact =
  "cloneStorageClassName is not offered: the controller reads it nowhere. What it claims to control - the storage " +
  "class of the per-guest clone PVCs - is decided by the import storage class above, which the clone class " +
  "defaults to.";

/** The three fields this form does not offer, as the footer states them. */
export const imageDroppedFieldsFacts = [uploadDroppedFact, pvcCloneDroppedFact, cloneStorageClassDroppedFact];

/** Every field of the form, keyed the way the messages are. */
export type ImageCreateField = keyof ImageFormValues;

/** Messages keyed by field, for the inline errors and the inline warnings. */
export type ImageFieldMessages = Partial<Record<ImageCreateField, string>>;

/** How each field reads in the sentence next to the disabled submit button (W12). */
export const imageFieldLabels: Record<ImageCreateField, string> = {
  namespace: "Namespace",
  name: "Name",
  source: "Source",
  httpUrl: "URL",
  ociRepository: "Repository",
  ociPinBy: "Pin by",
  ociTag: "Tag",
  ociDigest: "Digest",
  ociInsecure: "Plaintext registry",
  ociCredentialsSecret: "Registry credentials",
  ociVerifyKeySecret: "Cosign verify key",
  format: "Format",
  osType: "OS type",
  rootDiskSize: "Root disk size",
  cloneStrategy: "Clone strategy",
  volumeSnapshotClassName: "Volume snapshot class",
  importStorageClassName: "Import storage class",
};

/** The reading order of the form, which is the order the blocked sentence names fields in. */
const fieldOrder: ImageCreateField[] = [
  "namespace",
  "name",
  "httpUrl",
  "ociRepository",
  "ociTag",
  "ociDigest",
  "format",
  "rootDiskSize",
  "volumeSnapshotClassName",
  "importStorageClassName",
];

/** The fields of the collapsed storage-and-clone-strategy section, for its auto-open on error. */
export const imageStorageSectionFields: ImageCreateField[] = ["volumeSnapshotClassName", "importStorageClassName"];

/**
 * Everything that would make this create fail, keyed by field.
 *
 * Every rule below except the format's and the repository's presence belongs to
 * a validating webhook that ships disabled, so this form is the only place they
 * are enforced on a default install - and each one fails LATE when nobody
 * enforces it, on an object that was admitted without a word (F5, W12).
 */
export function imageCreateErrors(values: ImageFormValues): ImageFieldMessages {
  const errors: ImageFieldMessages = {};

  if (!values.namespace.trim()) {
    errors.namespace =
      "A namespace is required: the image, its import PVC, its two Jobs and every Secret it names all live in " +
      "one, and a guest resolves its image from its own namespace.";
  }

  const nameError = objectNameError(values.name.trim());

  if (nameError) {
    errors.name = nameError;
  }

  if (values.source === "http") {
    const urlError = imageHttpUrlError(values.httpUrl);

    if (urlError) {
      errors.httpUrl = urlError;
    }
  } else {
    const repositoryError = imageOciRepositoryError(values.ociRepository);

    if (repositoryError) {
      errors.ociRepository = repositoryError;
    }

    if (values.ociPinBy === "tag" && !values.ociTag.trim()) {
      errors.ociTag = ociTagRequiredMessage;
    }

    if (values.ociPinBy === "digest" && !values.ociDigest.trim()) {
      errors.ociDigest = ociDigestRequiredMessage;
    }
  }

  if (!values.format) {
    errors.format = formatRequiredMessage;
  }

  const sizeError = quantityError(values.rootDiskSize);

  if (sizeError) {
    errors.rootDiskSize = sizeError;
  }

  if (values.cloneStrategy === "snapshot" && !values.volumeSnapshotClassName.trim()) {
    errors.volumeSnapshotClassName = volumeSnapshotClassRequiredMessage;
  }

  const importStorageClassMessage = storageClassNameError(values.importStorageClassName.trim());

  if (importStorageClassMessage) {
    errors.importStorageClassName = importStorageClassMessage;
  }

  return errors;
}

/**
 * Everything worth saying about a field that would still be accepted.
 *
 * Warnings never block (W12). Two of them are the sharpest sentences on this
 * form - the filename that disagrees with the declared format, and a verify key
 * over a plaintext registry - and neither is a refusal, because in both cases
 * the client is guessing and the cluster is the authority.
 */
export function imageCreateWarnings(inputs: ImageCreateInputs, values: ImageFormValues): ImageFieldMessages {
  const warnings: ImageFieldMessages = {};
  const name = values.name.trim();
  const namespace = values.namespace.trim();

  if (name && inputs.existingNames.includes(name)) {
    warnings.name = `A SwiftImage named ${name} already exists in ${namespace}. The create will be refused.`;
  } else if (name && inputs.existingNamesUnverified) {
    warnings.name =
      `The SwiftImages of ${namespace || "this namespace"} could not be listed from here, so whether this name is ` +
      "already taken is unverified. The API server answers on submit.";
  }

  if (values.source === "http" && values.format) {
    const guessed = formatFromFilename(values.httpUrl);

    if (guessed && guessed !== values.format) {
      warnings.format = formatFilenameWarning(guessed, values.format);
    }
  }

  if (values.source === "oci") {
    if (isMalformedDigest(values.ociDigest)) {
      warnings.ociDigest = ociDigestShapeWarning;
    }

    if (values.ociInsecure && values.ociVerifyKeySecret.trim()) {
      warnings.ociInsecure = ociInsecureWithVerifyKeyWarning;
    }

    for (const field of ["ociCredentialsSecret", "ociVerifyKeySecret"] as const) {
      const secret = values[field].trim();

      if (!secret) {
        continue;
      }

      if (inputs.secretsUnverified) {
        warnings[field] =
          "The Secrets of this namespace could not be listed from here, so this name is unverified. " +
          ociSecretHangWarning;
      } else if (!inputs.secrets.includes(secret)) {
        warnings[field] = `No Secret named ${secret} is in this namespace. ${ociSecretHangWarning}`;
      }
    }
  }

  const importStorageClassName = values.importStorageClassName.trim();

  if (importStorageClassName && !storageClassNameError(importStorageClassName)) {
    if (inputs.storageClassesUnverified) {
      warnings.importStorageClassName =
        "The cluster's StorageClasses could not be listed from here, so this name is unverified. A class that " +
        "does not exist is not refused at admission: the import PVC simply never binds, and the image hangs in " +
        "Importing forever.";
    } else if (!inputs.storageClasses.includes(importStorageClassName)) {
      warnings.importStorageClassName =
        `No StorageClass named ${importStorageClassName} is in this cluster. Nothing refuses the image for it - ` +
        "the import PVC never binds, and the image hangs in Importing with no Event and no condition.";
    }
  }

  return warnings;
}

/** One reason the form cannot be submitted, named the way the sentence names it. */
export interface ImageBlockingIssue {
  label: string;
  message: string;
}

/** Every reason the form cannot be submitted, in the reading order of the form. */
export function imageBlockingIssues(values: ImageFormValues): ImageBlockingIssue[] {
  const errors = imageCreateErrors(values);

  return fieldOrder
    .filter((field) => errors[field])
    .map((field) => ({ label: imageFieldLabels[field], message: errors[field] as string }));
}

/**
 * The sentence next to a disabled OK button, or `undefined` when it is enabled.
 *
 * W4 on a submit button: a mute grey button is a dead control, so the reason is
 * next to it as well as at the field it belongs to.
 */
export function imageSubmitBlockReason(values: ImageFormValues): string | undefined {
  const [first] = imageBlockingIssues(values);

  return first ? `${first.label}: ${first.message}` : undefined;
}

/**
 * The source block of the payload: exactly one key, always.
 *
 * The one-of is a property of this function rather than a rule anyone checks -
 * it branches on a two-member union and each branch writes one key - which is
 * what "inexpressible rather than validated" means when it reaches the payload
 * (F6).
 */
export function imageSourcePayload(values: ImageFormValues): SwiftImageSource {
  if (values.source === "http") {
    return { http: { url: values.httpUrl.trim() } };
  }

  const oci: SwiftImageOciSource = { repository: values.ociRepository.trim() };
  const tag = values.ociTag.trim();
  const digest = values.ociDigest.trim();
  const credentials = values.ociCredentialsSecret.trim();
  const verifyKey = values.ociVerifyKeySecret.trim();

  // One of the two, never both, and never neither once the form is submittable:
  // the pin is a radio, and the other field was emptied when it moved.
  if (values.ociPinBy === "tag") {
    if (tag) {
      oci.tag = tag;
    }
  } else if (digest) {
    oci.digest = digest;
  }

  if (values.ociInsecure) {
    oci.insecure = true;
  }

  // G7 in two more places: an empty-name reference is a shape the schema would
  // accept - `name` is a bare required string - and one nothing can resolve.
  if (credentials) {
    oci.credentialsSecretRef = { name: credentials };
  }

  if (verifyKey) {
    oci.verifyKeySecretRef = { name: verifyKey };
  }

  return { oci };
}

/**
 * The object the create sends: only what the form set, and nothing the API
 * server would stamp on its own (G7, F17).
 *
 * `format` is the exception in the other direction and is always there (F16).
 * `osType: linux` and `cloneStrategy: copy` are the CRD's own defaults and
 * never appear; `rootDisk` is absent when no size was typed, because 10Gi is a
 * controller constant rather than a stamped value; and the volume snapshot
 * class is sent only with the strategy that reads it.
 */
export function imageCreatePayload(values: ImageFormValues): { spec: SwiftImageSpec } {
  const spec: SwiftImageSpec = {
    // The submit is blocked until a format is chosen, so the fallback is
    // unreachable; it is `raw` rather than an empty string because an empty
    // string is what the API server would answer with a decoded enum error
    // nobody should have to read.
    format: values.format || "raw",
    source: imageSourcePayload(values),
  };
  const rootDiskSize = values.rootDiskSize.trim();
  const volumeSnapshotClassName = values.volumeSnapshotClassName.trim();
  const importStorageClassName = values.importStorageClassName.trim();

  if (values.osType !== defaultOsType) {
    spec.osType = values.osType;
  }

  if (rootDiskSize) {
    spec.rootDisk = { size: rootDiskSize };
  }

  if (values.cloneStrategy !== defaultCloneStrategy) {
    spec.cloneStrategy = values.cloneStrategy;

    if (volumeSnapshotClassName) {
      spec.volumeSnapshotClassName = volumeSnapshotClassName;
    }
  }

  if (importStorageClassName) {
    spec.importStorageClassName = importStorageClassName;
  }

  return { spec };
}

/** The live write summary, as the dialog renders it. */
export interface ImageCreateSummaryFacts {
  write: string;
  notes: string[];
  warnings: string[];
}

/** The four objects one create sets in motion, and what each of them is. */
export function imageCreatesFact(strategy: SwiftImageCloneStrategy): string {
  const objects =
    strategy === "snapshot"
      ? "an import PVC named after this image, an import Job, a measure Job and a VolumeSnapshot clone seed"
      : "an import PVC named after this image, an import Job and a measure Job";

  return (
    `The controller creates ${objects}. The PVC is hardcoded ReadWriteOnce and Filesystem whatever the guests of ` +
    "this image will use, the import Job runs as uid 0, and the measured size is read out of the measure pod's " +
    "own logs."
  );
}

/** The phase walk, with `Snapshotting` where the strategy puts it. */
export function imagePhaseWalkFact(strategy: SwiftImageCloneStrategy): string {
  return strategy === "snapshot"
    ? "The walk is Pending, Importing, Validating, Preparing, Snapshotting, Ready."
    : "The walk is Pending, Importing, Validating, Preparing, Ready.";
}

/** The terminal-`Failed` vocabulary (F13). Deliberately not SPEC-0013's self-heal sentence. */
export const imageTerminalFailedFact =
  "Failed is terminal: the reconciler returns on the phase before it reads the spec, so no edit to this object " +
  "restarts anything and recovery is delete-and-recreate. Ready is short-circuited the same way, which is why a " +
  "correction to a Ready image is stored and ignored.";

/** The declared format is taken on trust, all the way to a booting guest. */
export const imageDeclaredFormatIsTrustedFact =
  "The format is taken on trust. Nothing reads the bytes: an image declared raw that is really qcow2 reaches " +
  "Ready, and every guest built from it boots garbage.";

/** The two failures that hang forever with nothing to look at. */
export const imageImportingHangsFact =
  "Two failures hang in Importing indefinitely rather than failing: a storage class that cannot bind, and a pull " +
  "secret that cannot mount. Neither requeues, neither sets a condition, and the controller emits no Events at " +
  "all.";

/** No Job carries a TTL, which is what makes a failed import leave litter behind. */
export const imageNoTtlFact =
  "Neither Job carries a TTL, a backoff limit or a deadline, so the pods of a finished or a failed import stay in " +
  "this namespace until someone deletes them.";

/** The whole diagnostic surface of this kind, stated before the write rather than discovered after it. */
export const imageDiagnosticSurfaceFact =
  "The whole diagnostic surface afterwards is one phase and one condition message. Nothing else is written down.";

/**
 * The live write summary: the one create line, then the facts that are true of
 * this object in this state (W1, rebuilt on every change).
 *
 * The order is the order things happen: what is stored, what the controller
 * does with it, and what it will and will not tell you afterwards.
 */
export function imageCreateSummary(inputs: ImageCreateInputs, values: ImageFormValues): ImageCreateSummaryFacts {
  const namespace = values.namespace.trim() || "<namespace>";
  const name = values.name.trim() || "<name>";
  const notes: string[] = [];
  const warnings: string[] = [];
  const format = values.format || "<format>";
  const rootDiskSize = values.rootDiskSize.trim();
  const volumeSnapshotClassName = values.volumeSnapshotClassName.trim();
  const importStorageClassName = values.importStorageClassName.trim();

  if (values.source === "http") {
    const url = values.httpUrl.trim();

    notes.push(
      url
        ? `It imports ${url} over HTTP, declared as ${format}. ${httpNoChecksumFact}`
        : `It imports over HTTP, declared as ${format}. ${httpNoChecksumFact}`,
    );
  } else {
    const repository = values.ociRepository.trim() || "<repository>";
    const pin =
      values.ociPinBy === "tag" ? `:${values.ociTag.trim() || "<tag>"}` : `@${values.ociDigest.trim() || "<digest>"}`;

    notes.push(`It pulls ${repository}${pin} from an OCI registry, declared as ${format}.`);

    if (values.ociCredentialsSecret.trim()) {
      notes.push(`It authenticates with the Secret ${values.ociCredentialsSecret.trim()}.`);
    }

    if (values.ociVerifyKeySecret.trim()) {
      notes.push(
        `Its signature is verified against the cosign public key in ${values.ociVerifyKeySecret.trim()} before its ` +
          "bytes are trusted, and the import fails if it does not verify.",
      );
    } else {
      notes.push(
        "No signature is verified: without a cosign verify key, whatever the registry serves is imported as it is.",
      );
    }

    if (values.ociInsecure) {
      warnings.push(
        "The registry is contacted over plaintext http. The artifact travels unencrypted and unauthenticated, " +
          "which upstream's own comment calls UNSAFE and scopes to a test registry.",
      );
    }
  }

  notes.push(
    values.osType === defaultOsType
      ? "Its import Job runs privileged and as root: the linux path loop-mounts the disk to patch the bootloader " +
          "and the serial console."
      : "Its import Job skips the Linux-only steps - the bootloader and serial patch, and the growpart resize " +
          "expectation - because the OS type is windows.",
  );

  notes.push(
    rootDiskSize
      ? `Its import PVC asks for ${rootDiskSize}. ${rootDiskSizeIsTheRequestFact}`
      : `Its import PVC asks for the controller's own ${controllerRootDiskSize}, which is not sent and never ` +
          `appears in the stored object. ${rootDiskSizeIsTheRequestFact}`,
  );

  if (importStorageClassName) {
    notes.push(
      `That PVC asks for the StorageClass ${importStorageClassName}, which also pins where every guest built from ` +
        "this image lives.",
    );
  }

  notes.push(`Guests clone it with the ${values.cloneStrategy} strategy. ${cloneStrategyNote(values.cloneStrategy)}`);
  notes.push(imageCreatesFact(values.cloneStrategy));
  notes.push(imagePhaseWalkFact(values.cloneStrategy));
  notes.push(imageDeclaredFormatIsTrustedFact);
  notes.push(imageTerminalFailedFact);
  notes.push(imageImportingHangsFact);
  notes.push(imageNoTtlFact);
  notes.push(imageDiagnosticSurfaceFact);

  if (values.cloneStrategy === "snapshot" && volumeSnapshotClassName) {
    warnings.push(
      `The volume snapshot class ${volumeSnapshotClassName} is unverified: no VolumeSnapshotClass API is exported ` +
        "to extensions, so there is no read to make. A name that does not exist fails on reaching Snapshotting, " +
        "after the whole import has already run.",
    );
  }

  const warningsByField = imageCreateWarnings(inputs, values);

  // The collision, the format guess and every unverified value are stated in
  // the summary as well as at their field, for the reason the shipped dialogs
  // state their sharpest sentence twice: the summary is what a user reads
  // before pressing OK, and a fact that only lives at a field is a fact a
  // scrolled-past field hides.
  for (const field of [
    "name",
    "format",
    "ociDigest",
    "ociInsecure",
    "ociCredentialsSecret",
    "ociVerifyKeySecret",
    "importStorageClassName",
  ] as const) {
    const warning = warningsByField[field];

    if (warning) {
      warnings.push(warning);
    }
  }

  return { write: `Create SwiftImage ${namespace}/${name}`, notes, warnings };
}

/** What a create that succeeded is acknowledged with (W9). */
export function imageCreateSuccessMessage(namespace: string, name: string): string {
  return `SwiftImage ${namespace}/${name} created`;
}

/** What a failed create was trying to write, for the one actionable sentence it is prefixed with. */
export interface ImageCreateFailureContext {
  namespace: string;
  name: string;
}

/** The actionable sentence alone, for the three failures this dialog can predict. */
export function imageCreateFailurePrefix(
  code: number | undefined,
  context: ImageCreateFailureContext,
): string | undefined {
  if (code === conflictStatusCode) {
    return `A SwiftImage named ${context.name} already exists in the namespace ${context.namespace}. Change the name and try again.`;
  }

  if (code === forbiddenStatusCode) {
    return `You are not allowed to create swiftimages in the namespace ${context.namespace}.`;
  }

  if (code === notFoundStatusCode) {
    return `Nothing here accepted the create: the namespace ${context.namespace} or the SwiftImage CRD is gone.`;
  }

  return undefined;
}

/**
 * The message a failed create is reported with: one actionable sentence prefixed
 * to what the API server said, never replacing it (W9).
 */
export function imageCreateFailureMessage(
  failure: ApiFailureFacts,
  context: ImageCreateFailureContext,
): string | undefined {
  const prefix = imageCreateFailurePrefix(failure.code, context);

  if (!failure.message) {
    return prefix;
  }

  return prefix ? `${prefix} ${failure.message}` : failure.message;
}

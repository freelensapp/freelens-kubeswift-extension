import { Renderer } from "@freelensapp/extensions";
import { formatBytes, type KubeSwiftKubeObjectCRD } from "./types";

import type { Condition, LocalObjectReference, Quantity } from "./types";

/**
 * Model for `swiftsandboxes.sandbox.kubeswift.io/v1alpha1`.
 *
 * A SwiftSandbox is an ephemeral, strongly-isolated microVM that runs an OCI
 * image as its root filesystem: no PVC, no seed, a tmpfs overlay over a
 * read-only rootfs, and a lifecycle that ends. It is the object a CI runner, a
 * code interpreter or a one-shot inference job is expressed as.
 *
 * The interfaces below are written from the published CustomResourceDefinition
 * schema (KubeSwift v0.13.12). Values the schema declares without an `enum` are
 * typed as plain strings, and `status.phase` - which the schema *does*
 * constrain - is typed as a plain string too, so that a future controller
 * writing a sixth phase cannot break a view (SPEC-0008).
 *
 * One near-miss is called out rather than left to be discovered at runtime:
 * `status.podRef` here is the launcher pod's **name**, a bare string, where
 * SwiftGuest's `status.podRef` is a full core `ObjectReference`. The shared
 * `ObjectReference` type of `types.ts` therefore does not apply to this model
 * and is deliberately not imported.
 */

/** The five phases the schema's enum allows today. Not a type: see the note above. */
export type SwiftSandboxPhase = "Pending" | "Materializing" | "Running" | "Completed" | "Failed";

/** How the OCI rootfs is delivered to the guest. */
export type SwiftSandboxRootfsMode = "block" | "virtiofs";

/** What the sandbox is allowed to reach. */
export type SwiftSandboxNetworkMode = "restricted" | "open" | "none";

/** Volume mode of a blank scratch disk. */
export type SwiftSandboxVolumeMode = "Block" | "Filesystem";

/** Hypervisor/firmware tier of the DRA GPU backend, spelled as SwiftGPUProfile spells it. */
export type SwiftSandboxGpuTier = "pcie" | "hgx-shared" | "hgx-full";

/** Core `ConfigMapKeySelector`. `name` carries the `""` backwards-compatibility default. */
export interface SwiftSandboxConfigMapKeySelector {
  key: string;
  name?: string;
  optional?: boolean;
}

/** Core `SecretKeySelector`. */
export interface SwiftSandboxSecretKeySelector {
  key: string;
  name?: string;
  optional?: boolean;
}

/** Core `ObjectFieldSelector`, the downward API. */
export interface SwiftSandboxObjectFieldSelector {
  fieldPath: string;
  apiVersion?: string;
}

/** Core `ResourceFieldSelector`, the resource half of the downward API. */
export interface SwiftSandboxResourceFieldSelector {
  resource: string;
  containerName?: string;
  divisor?: Quantity;
}

/** Core `FileKeySelector` (the alpha EnvFiles feature gate). */
export interface SwiftSandboxFileKeySelector {
  key: string;
  path: string;
  volumeName: string;
  optional?: boolean;
}

/** Core `EnvVarSource`: all five sources the schema declares. */
export interface SwiftSandboxEnvVarSource {
  configMapKeyRef?: SwiftSandboxConfigMapKeySelector;
  fieldRef?: SwiftSandboxObjectFieldSelector;
  fileKeyRef?: SwiftSandboxFileKeySelector;
  resourceFieldRef?: SwiftSandboxResourceFieldSelector;
  secretKeyRef?: SwiftSandboxSecretKeySelector;
}

/** Core `EnvVar`, merged by the controller over the image config's own environment. */
export interface SwiftSandboxEnvVar {
  name: string;
  value?: string;
  valueFrom?: SwiftSandboxEnvVarSource;
}

/** The DRA GPU backend: the scheduler allocates, the KubeSwift DRA driver injects. */
export interface SwiftSandboxGpuResourceClaim {
  /** Hugepage size backing the GPU memory (`1Gi`, `2Mi`, or the empty string). */
  hugepages?: string;
  /** Device-request name inside the claim. Empty means `gpu`. */
  requestName?: string;
  resourceClaimName?: string;
  resourceClaimTemplateName?: string;
  tier?: string;
}

/** A read-only model artifact mounted over virtio-fs. */
export interface SwiftSandboxModel {
  imageRef: string;
  mountPath?: string;
}

export interface SwiftSandboxNetwork {
  mode?: string;
}

/** A new, empty, sized PVC owned by the sandbox and deleted with it. */
export interface SwiftSandboxBlankScratchDisk {
  size: Quantity;
  storageClassName?: string;
  volumeMode?: string;
}

/** Exactly one of `blank` / `pvcRef`, by webhook rather than by schema. */
export interface SwiftSandboxScratchDisk {
  blank?: SwiftSandboxBlankScratchDisk;
  pvcRef?: LocalObjectReference;
}

/** A Secret holding a cosign public key. `name` is required here, unlike a `LocalObjectReference`. */
export interface SwiftSandboxVerifyKeySecretRef {
  name: string;
}

export interface SwiftSandboxSpec {
  /** Required. A digest reference is strongly preferred over a tag. */
  image: string;
  /** Required and defaulted to `512Mi`, so the API server always fills it. */
  memory: Quantity;
  args?: string[];
  command?: string[];
  cpu?: number;
  env?: SwiftSandboxEnvVar[];
  gpuProfileRef?: LocalObjectReference;
  gpuResourceClaim?: SwiftSandboxGpuResourceClaim;
  imagePullSecret?: string;
  kernelProfileRef?: LocalObjectReference;
  model?: SwiftSandboxModel;
  network?: SwiftSandboxNetwork;
  nodeSelector?: Record<string, string>;
  poolRef?: LocalObjectReference;
  rootfsMode?: string;
  scratchDisk?: SwiftSandboxScratchDisk;
  /** Go duration string, for example `30m`. Rendered raw, never parsed. */
  timeout?: string;
  /** Go duration string. Retention after the sandbox turns terminal. */
  ttl?: string;
  verifyKeySecretRef?: SwiftSandboxVerifyKeySecretRef;
  workingDir?: string;
}

/** The native SwiftGPU allocation, stamped by the SwiftGPU controller. */
export interface SwiftSandboxGpuStatus {
  /** PCI addresses of the allocated devices. */
  devices?: string[];
  hypervisor?: string;
  nodeName?: string;
  numaNodes?: number[];
  /** Fabric Manager partition, `-1` when there is none. */
  partitionId?: number;
}

export interface SwiftSandboxModelStatus {
  cachePath?: string;
  digest?: string;
  mountPath?: string;
}

export interface SwiftSandboxNetworkStatus {
  /** Absent for `network: none` sandboxes, which is a configuration and not a gap. */
  primaryIP?: string;
}

export interface SwiftSandboxRootfsStatus {
  cachePath?: string;
  digest?: string;
  /** A plain `int64` byte count, not a quantity. */
  sizeBytes?: number;
}

export interface SwiftSandboxRuntimeStatus {
  hypervisor?: string;
  pid?: number;
}

export interface SwiftSandboxScratchDiskStatus {
  bound?: boolean;
  devicePath?: string;
  pvcName?: string;
}

export interface SwiftSandboxStatus {
  conditions?: Condition[];
  exitCode?: number;
  gpu?: SwiftSandboxGpuStatus;
  /** The controller's own one-line summary; the first rung of the message ladder. */
  message?: string;
  model?: SwiftSandboxModelStatus;
  network?: SwiftSandboxNetworkStatus;
  nodeName?: string;
  phase?: string;
  /** The launcher pod NAME. A bare string, never an object reference. */
  podRef?: string;
  rootfs?: SwiftSandboxRootfsStatus;
  runtime?: SwiftSandboxRuntimeStatus;
  scratchDisk?: SwiftSandboxScratchDiskStatus;
  startedAt?: string;
  terminalAt?: string;
}

/** What an absent `spec.command` means: the image's own `Entrypoint`+`Cmd` run. */
export const imageEntrypointLabel = "Image entrypoint";

/** What an absent IP means on a `network: none` sandbox: a choice, not a gap. */
export const noNetworkLabel = "None";

/** Explanation of that choice, carried in the cell tooltip. */
export const noNetworkTooltip = 'This sandbox runs with network mode "none", so it is given no address';

/** The network mode that switches the address cell to `noNetworkLabel`. */
export const noNetworkMode = "none";

/** The phases after which nothing else happens, and the only ones with an exit code. */
export const sandboxTerminalPhases = ["Completed", "Failed"];

/** How the sandbox got its GPU, named rather than inferred from the absence of the other. */
export const nativeGpuBackendLabel = "Native SwiftGPU";
export const draGpuBackendLabel = "DRA ResourceClaim";

/** How a blank scratch disk differs from one attached from an existing PVC. */
export const blankScratchDiskLabel = "Blank";
export const existingScratchDiskLabel = "Existing PVC";

// Humanized readings of the two enums the drawer shows raw, written from the
// schema's own field descriptions. They live next to the values, so the view
// can put them in a tooltip without spelling the domain out again (the
// SPEC-0007 treatment of tier and partition mode).
const rootfsModeReadings = new Map<string, string>([
  ["block", "a node-local read-only ext4 image passed as a virtio-blk disk, with a writable tmpfs overlay on top"],
  ["virtiofs", "the unpacked rootfs tree shared over virtio-fs, with the same read-only base and tmpfs overlay"],
]);

// The restricted mode is enforced by in-pod iptables rather than by a
// NetworkPolicy, and saying so is the point: a policy blocking cluster egress
// would also cut swiftletd's own status reporting, so there is no NetworkPolicy
// for a reader to go and inspect.
const networkModeReadings = new Map<string, string>([
  ["restricted", "egress is filtered by in-pod iptables rules, not by a NetworkPolicy"],
  ["open", "the guest reaches whatever the pod network reaches"],
  ["none", "no connectivity at all, and therefore no address"],
]);

/** The reading of a rootfs mode, or `undefined` for a value this extension does not know. */
export function describeRootfsMode(rootfsMode?: string): string | undefined {
  return rootfsMode === undefined ? undefined : rootfsModeReadings.get(rootfsMode);
}

/** The reading of a network mode, or `undefined` for an unknown value. */
export function describeNetworkMode(networkMode?: string): string | undefined {
  return networkMode === undefined ? undefined : networkModeReadings.get(networkMode);
}

/** The kinds of `valueFrom` an environment variable can read, for the Source cell. */
export type SwiftSandboxEnvSourceKind = "Secret" | "ConfigMap" | "field" | "resource" | "file";

/**
 * One environment variable's source, split into the parts the drawer renders:
 * `name` is set only for the two kinds whose referent is a linkable object, and
 * `text` is the whole reading for every other kind.
 */
export interface SwiftSandboxEnvSource {
  kind: SwiftSandboxEnvSourceKind;
  text: string;
  key?: string;
  name?: string;
}

/**
 * What a `valueFrom` reads, or `undefined` for a literal `value` (which has no
 * source and is shown as it arrived).
 *
 * Declared as a free function rather than as a static so it stays usable on a
 * plain object in the tests and in the nested table's own row loop.
 */
export function describeEnvSource(env: SwiftSandboxEnvVar): SwiftSandboxEnvSource | undefined {
  const valueFrom = env.valueFrom;

  if (!valueFrom) {
    return undefined;
  }

  const { configMapKeyRef, fieldRef, fileKeyRef, resourceFieldRef, secretKeyRef } = valueFrom;

  // The `name` of a core key selector carries a `""` default, so an empty
  // string is "not named" rather than a name to look up.
  if (secretKeyRef) {
    const name = secretKeyRef.name || undefined;

    return {
      kind: "Secret",
      name,
      key: secretKeyRef.key,
      text: name ? `Secret ${name}/${secretKeyRef.key}` : `Secret ${secretKeyRef.key}`,
    };
  }

  if (configMapKeyRef) {
    const name = configMapKeyRef.name || undefined;

    return {
      kind: "ConfigMap",
      name,
      key: configMapKeyRef.key,
      text: name ? `ConfigMap ${name}/${configMapKeyRef.key}` : `ConfigMap ${configMapKeyRef.key}`,
    };
  }

  if (fieldRef) {
    return { kind: "field", key: fieldRef.fieldPath, text: `field ${fieldRef.fieldPath}` };
  }

  if (resourceFieldRef) {
    return { kind: "resource", key: resourceFieldRef.resource, text: `resource ${resourceFieldRef.resource}` };
  }

  if (fileKeyRef) {
    return {
      kind: "file",
      key: fileKeyRef.key,
      text: `file ${fileKeyRef.volumeName}/${fileKeyRef.path} (${fileKeyRef.key})`,
    };
  }

  return undefined;
}

// The metadata is declared namespace-scoped rather than with the generic
// `KubeObjectMetadata` the M1/M2 models use: it makes `getNs()` a `string`,
// which is what the `NamespaceSelectBadge` of the list cell and the explicit
// namespaces of `useReferenceStores` both need (the SPEC-0007 slice-1 rule for
// every new namespaced model).
export class SwiftSandbox extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftSandboxStatus,
  SwiftSandboxSpec
> {
  static readonly kind = "SwiftSandbox";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/sandbox.kubeswift.io/v1alpha1/swiftsandboxes";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["sandbox.kubeswift.io/v1alpha1"],
    plural: "swiftsandboxes",
    singular: "swiftsandbox",
    shortNames: ["sbox"],
    title: "Sandboxes",
  };

  static getPhase(object: SwiftSandbox): string | undefined {
    return object.status?.phase;
  }

  static getImage(object: SwiftSandbox): string | undefined {
    return object.spec?.image;
  }

  static getNodeName(object: SwiftSandbox): string | undefined {
    return object.status?.nodeName;
  }

  /** The launcher pod's name, which is a bare string in this CRD. */
  static getPodName(object: SwiftSandbox): string | undefined {
    return object.status?.podRef;
  }

  static getNetworkMode(object: SwiftSandbox): string | undefined {
    return object.spec?.network?.mode;
  }

  static getPrimaryIP(object: SwiftSandbox): string | undefined {
    return object.status?.network?.primaryIP;
  }

  /**
   * The address cell in its three states: the address when there is one,
   * `None` when the sandbox was deliberately given no network, and `undefined`
   * (which the views render as "N/A") when it should have an address and does
   * not have one yet. Rendering "N/A" for a `network: none` sandbox would read
   * as a missing value when it is a chosen configuration.
   */
  static getAddressLabel(object: SwiftSandbox): string | undefined {
    const primaryIP = SwiftSandbox.getPrimaryIP(object);

    if (primaryIP) {
      return primaryIP;
    }

    return SwiftSandbox.getNetworkMode(object) === noNetworkMode ? noNetworkLabel : undefined;
  }

  /** Only the `None` case needs a tooltip; every other cell tooltips itself. */
  static getAddressTooltip(object: SwiftSandbox): string | undefined {
    return SwiftSandbox.getAddressLabel(object) === noNetworkLabel ? noNetworkTooltip : undefined;
  }

  static getCommand(object: SwiftSandbox): string[] {
    return object.spec?.command ?? [];
  }

  static getArgs(object: SwiftSandbox): string[] {
    return object.spec?.args ?? [];
  }

  /**
   * True when no command was given, which the schema says means the image's own
   * `Entrypoint`+`Cmd` run. That is a fact about the sandbox, not a missing
   * value, so the row says so instead of falling back to "N/A".
   */
  static usesImageEntrypoint(object: SwiftSandbox): boolean {
    return SwiftSandbox.getCommand(object).length === 0;
  }

  static isTerminal(object: SwiftSandbox): boolean {
    const phase = SwiftSandbox.getPhase(object);

    return phase !== undefined && sandboxTerminalPhases.includes(phase);
  }

  /**
   * The exit code, for the terminal phases only. `0` is kept: a run that
   * succeeded is a fact worth showing, the same rule `formatBytes` applies to a
   * zero-byte size.
   */
  static getExitCode(object: SwiftSandbox): number | undefined {
    if (!SwiftSandbox.isTerminal(object)) {
      return undefined;
    }

    return object.status?.exitCode;
  }

  static getStartedAt(object: SwiftSandbox): string | undefined {
    return object.status?.startedAt;
  }

  static getTerminalAt(object: SwiftSandbox): string | undefined {
    return object.status?.terminalAt;
  }

  /**
   * How long a finished sandbox ran, in milliseconds, or `undefined` while it
   * is still running (the view then counts from `startedAt` itself) or when
   * either timestamp is absent or unparseable.
   *
   * Neither the CRD nor `kubectl` reports this, and for the CI-runner and
   * code-interpreter cases the docs describe it is the number the user came
   * for, which is why it is derived here rather than left out.
   */
  static getRunDurationMs(object: SwiftSandbox): number | undefined {
    const startedAt = Date.parse(SwiftSandbox.getStartedAt(object) ?? "");
    const terminalAt = Date.parse(SwiftSandbox.getTerminalAt(object) ?? "");

    if (Number.isNaN(startedAt) || Number.isNaN(terminalAt)) {
      return undefined;
    }

    const elapsed = terminalAt - startedAt;

    // A terminal timestamp before the start one is a controller bug, not
    // something to render as a negative duration.
    return elapsed < 0 ? undefined : elapsed;
  }

  static getHypervisor(object: SwiftSandbox): string | undefined {
    return object.status?.runtime?.hypervisor;
  }

  static getPid(object: SwiftSandbox): number | undefined {
    return object.status?.runtime?.pid;
  }

  /** The materialized rootfs size, humanized from the byte count the schema uses. */
  static getRootfsSize(object: SwiftSandbox): string | undefined {
    return formatBytes(object.status?.rootfs?.sizeBytes);
  }

  /**
   * Where the scratch disk comes from, named rather than left for the reader to
   * infer from which of the two blocks is set.
   */
  static getScratchDiskSource(object: SwiftSandbox): string | undefined {
    const scratchDisk = object.spec?.scratchDisk;

    if (scratchDisk?.blank) {
      return blankScratchDiskLabel;
    }

    return scratchDisk?.pvcRef?.name ? existingScratchDiskLabel : undefined;
  }

  /** The PVC actually attached, or the one the spec asked for while it is not bound yet. */
  static getScratchDiskPvcName(object: SwiftSandbox): string | undefined {
    return object.status?.scratchDisk?.pvcName ?? object.spec?.scratchDisk?.pvcRef?.name;
  }

  /**
   * Which GPU backend the sandbox uses. Both fields can be set at once - the
   * schema carries no CEL rule enforcing the documented exclusivity - so both
   * are reported when both are there rather than one being inferred from the
   * absence of the other.
   */
  static getGpuBackend(object: SwiftSandbox): string | undefined {
    const backends = [
      object.spec?.gpuProfileRef?.name ? nativeGpuBackendLabel : undefined,
      object.spec?.gpuResourceClaim ? draGpuBackendLabel : undefined,
    ].filter((backend): backend is string => Boolean(backend));

    return backends.length > 0 ? backends.join(", ") : undefined;
  }

  /** True when any GPU block is present, so the drawer's GPU section guards itself. */
  static hasGpu(object: SwiftSandbox): boolean {
    return Boolean(object.spec?.gpuProfileRef?.name || object.spec?.gpuResourceClaim || object.status?.gpu);
  }

  /** The Fabric Manager partition, with the `-1` "no partition" sentinel dropped. */
  static getGpuPartitionId(object: SwiftSandbox): number | undefined {
    const partitionId = object.status?.gpu?.partitionId;

    return partitionId === undefined || partitionId < 0 ? undefined : partitionId;
  }

  static getEnv(object: SwiftSandbox): SwiftSandboxEnvVar[] {
    return object.spec?.env ?? [];
  }

  /**
   * Every Secret this object names, deduplicated: the image pull secret, the
   * cosign verification key, and every `secretKeyRef` of the environment. It is
   * what the drawer declares to `useReferenceStores`, so an object that names
   * no Secret contributes no request at all.
   */
  static getSecretNames(object: SwiftSandbox): string[] {
    const names = [
      object.spec?.imagePullSecret,
      object.spec?.verifyKeySecretRef?.name,
      ...SwiftSandbox.getEnv(object).map((env) => env.valueFrom?.secretKeyRef?.name),
    ];

    return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
  }

  /** Every ConfigMap named by a `configMapKeyRef` of the environment, deduplicated. */
  static getConfigMapNames(object: SwiftSandbox): string[] {
    const names = SwiftSandbox.getEnv(object).map((env) => env.valueFrom?.configMapKeyRef?.name);

    return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
  }

  /** Every PersistentVolumeClaim this object names, deduplicated. */
  static getPvcNames(object: SwiftSandbox): string[] {
    const names = [object.status?.scratchDisk?.pvcName, object.spec?.scratchDisk?.pvcRef?.name];

    return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
  }
}

export class SwiftSandboxApi extends Renderer.K8sApi.KubeApi<SwiftSandbox> {}
export class SwiftSandboxStore extends Renderer.K8sApi.KubeObjectStore<SwiftSandbox, SwiftSandboxApi> {}

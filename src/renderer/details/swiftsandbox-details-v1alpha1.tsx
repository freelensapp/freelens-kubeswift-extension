import { Common, Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftArtifactVerificationPolicy } from "../api/kubeswift/swiftartifactverificationpolicy-v1alpha1";
import { SwiftGPUNode } from "../api/kubeswift/swiftgpunode-v1alpha1";
import { describeTier, SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftKernel } from "../api/kubeswift/swiftkernel-v1alpha1";
import {
  defaultKernelLabel,
  defaultKernelTooltip,
  describeEnvSource,
  describeNetworkMode,
  describeProbe,
  describeRootfsMode,
  describeSecretFileItem,
  formatFileMode,
  imageEntrypointLabel,
  SwiftSandbox,
} from "../api/kubeswift/swiftsandbox-v1alpha1";
import { SwiftSandboxPool } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import { formatQuantity } from "../api/kubeswift/types";
import { canOpenSandboxConsole, sandboxConsoleDrawerExplanation } from "../components/console-commands";
import { existingObjectRef, objectExists } from "../components/object-existence";
import { findDefaultContainerOfPod } from "../components/pod-logs";
import { useReferenceStores } from "../components/reference-loader";
import { SandboxNetworkSection } from "../components/sandbox-network-drawer";
import { classifySandbox, classifySandboxArtifact } from "../components/sandbox-status";
import styles from "./swiftsandbox-details.module.scss";

import type { ReferenceRequest } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    BadgeBoolean,
    DrawerItem,
    DrawerTitle,
    Icon,
    KubeObjectConditionsDrawer,
    LinkToConfigMap,
    LinkToNode,
    LinkToObject,
    LinkToPod,
    LinkToSecret,
    LinkToStorageClass,
    LocaleDate,
    logTabStore,
    ReactiveDuration,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
  K8sApi: { configMapStore, nodesStore, podsStore, pvcStore, secretsStore, storageClassStore },
} = Renderer;

const notAvailable = "N/A";

/** The single fact that stops a pooled sandbox that booted cold from being misread. */
const poolTooltip =
  "A checkout that finds no free warm slot falls back to the cold materialize and boot path automatically: " +
  "the sandbox loses the speedup, it does not fail";

const timeoutTooltip =
  "Wall-clock run cap. Past startedAt plus this duration the controller force-terminates the sandbox to " +
  "Failed(DeadlineExceeded)";
const ttlTooltip =
  "Retention after the sandbox turns terminal: the controller deletes it once it has been Completed or Failed " +
  "for at least this long. It is anchored on terminalAt, not on startedAt";

const drainPeriodTooltip =
  "How long the workload keeps running after deletion has taken the sandbox out of Service endpoints, before the " +
  "microVM is stopped. 5s by default when the sandbox exposes ports, else 0s";

const podIPTooltip = "The launcher pod's IP, which unlike the guest IP is unique in the cluster";

const ipScopeTooltips = new Map<string, string>([
  [
    "Pod",
    "The guest sits behind its launcher's NAT: the address is on the launcher pod's private network, repeats " +
      "across sandboxes, and is reachable only from inside that launcher pod",
  ],
  ["Network", "The address is reachable on the network it was given from"],
]);

const readinessTooltip =
  "Its result is the WorkloadReady condition and, when the sandbox exposes ports, the launcher pod's readiness, " +
  "so a Service routes to the sandbox only while it passes";
const livenessTooltip =
  "After failureThreshold failures in a row the workload is stopped and the sandbox ends Failed with reason " +
  "LivenessProbeFailed. Nothing restarts it";
const readinessStartupTooltip =
  "The readiness probe runs at this interval from the workload's start until it first passes or the window ends, " +
  "and failures in that time do not count";

const podLabelsTooltip = "Added to the launcher pod, or to the slot a checkout claims, so a Service can select it";

const artifactRefTagTooltip = "A tag, resolved to a digest when the sandbox starts and recorded in the status";
const fetchTimeoutTooltip =
  "How long this optional artifact may delay the workload, counted from the sandbox's creation. 10s by default";
const claimsTooltip =
  "Signed annotations the platform verification must find. An artifact whose claims no policy governs is refused";
const requirePlatformVerificationTooltip =
  "Refused (skipped, if optional) unless a SwiftArtifactVerificationPolicy governs it in this namespace";

const rootfsSharedTooltip = "The materialized rootfs is node-local and shared by every sandbox running the same digest";

interface SectionProps {
  object: SwiftSandbox;
}

/**
 * The sandbox itself: the verdict, what it was asked to run, and when it ran.
 * Always rendered, because a sandbox always has an image and a phase to report
 * (or the absence of one, which is itself the "Unknown" verdict).
 *
 * An observer since M4 slice 2: the Pool row resolves a reference, so the
 * section has to re-render when the SwiftSandboxPool store fills.
 */
const SandboxSection = observer(({ object }: SectionProps) => {
  const spec = object.spec;
  const condition = classifySandbox(object.status);
  const command = SwiftSandbox.getCommand(object);
  const args = SwiftSandbox.getArgs(object);
  const exitCode = SwiftSandbox.getExitCode(object);
  const startedAt = SwiftSandbox.getStartedAt(object);
  const terminalAt = SwiftSandbox.getTerminalAt(object);
  const durationMs = SwiftSandbox.getRunDurationMs(object);
  const poolName = spec?.poolRef?.name;
  const poolStore = maybe(() => SwiftSandboxPool.getStore<SwiftSandboxPool>());
  const poolRef = existingObjectRef(poolStore, SwiftSandboxPool.kind, poolName, object.getNs());
  const consoleFacts = { name: object.getName(), namespace: object.getNs(), spec, status: object.status };
  const consoleVerdict = canOpenSandboxConsole(consoleFacts);

  return (
    <>
      <DrawerTitle>Sandbox</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      {/* The raw phase, since the badge above is a verdict and this is what
          `kubectl` shows. */}
      <DrawerItem name="Phase">
        <WithTooltip>{SwiftSandbox.getPhase(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Image">
        <WithTooltip>{SwiftSandbox.getImage(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* An absent command is not a missing value: the schema says the image
          config's own Entrypoint+Cmd are used, so the row says so. */}
      {SwiftSandbox.usesImageEntrypoint(object) ? (
        <DrawerItem name="Command">
          <WithTooltip>{imageEntrypointLabel}</WithTooltip>
        </DrawerItem>
      ) : (
        <DrawerItem name="Command" labelsOnly>
          {command.map((part, index) => (
            <Badge key={`${index}-${part}`} label={part} />
          ))}
        </DrawerItem>
      )}
      <DrawerItem name="Args" hidden={args.length === 0} labelsOnly>
        {args.map((arg, index) => (
          <Badge key={`${index}-${arg}`} label={arg} />
        ))}
      </DrawerItem>
      <DrawerItem name="Working Dir" hidden={!spec?.workingDir}>
        <WithTooltip>{spec?.workingDir}</WithTooltip>
      </DrawerItem>
      {/* The pool this sandbox was checked out of, existence-checked like every
          other reference: a pooled sandbox routinely outlives the pool it
          claimed a slot from, and a link to a deleted pool would be a dead one.
          The tooltip carries the cold-fallback rule either way, since that is
          the single fact that stops a pooled sandbox which booted cold from
          being misread as a failure, and it is worth reading whether or not the
          pool is still there (the same `WithTooltip` wrapping the Environment
          section's linked sources use). */}
      <DrawerItem name="Pool" hidden={!poolName}>
        <WithTooltip tooltip={poolTooltip}>
          {poolRef ? <LinkToObject objectRef={poolRef} object={object} /> : poolName}
        </WithTooltip>
      </DrawerItem>
      {/* Terminal phases only, and `0` is kept: a run that succeeded is a fact. */}
      <DrawerItem name="Exit Code" hidden={exitCode === undefined}>
        <WithTooltip>{exitCode}</WithTooltip>
      </DrawerItem>
      {/* Where a user who never hovers a menu finds out why the Workload
          Console item is greyed, and what it will do when it is not - the
          second surface W4 requires for a guard's reason, and the durable one,
          since a disabled `MenuItem` carries `pointer-events: none` and can
          never show a hover tooltip (SPEC-0010 spike S7, SPEC-0017).
          Deliberately in this always-rendered section and not next to the
          Launcher Pod row it talks about: the Runtime section guards itself
          away entirely on a sandbox with no runtime status, and that sandbox -
          the one with no launcher pod - is precisely the one whose user needs
          this sentence. It sits after the exit code because the tail's last
          line is what produced that number (K10). The whole sentence is the
          row's own text and not only its tooltip (DESIGN.md section 7). */}
      <DrawerItem name="Workload Console">
        <WithTooltip>{sandboxConsoleDrawerExplanation(consoleFacts, consoleVerdict)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Started" hidden={!startedAt}>
        {startedAt ? <LocaleDate date={startedAt} /> : null}
      </DrawerItem>
      <DrawerItem name="Finished" hidden={!terminalAt}>
        {terminalAt ? <LocaleDate date={terminalAt} /> : null}
      </DrawerItem>
      {/* Derived, because neither the CRD nor `kubectl` reports it and it is
          the number a CI-runner or code-interpreter user came for. A finished
          sandbox gets the interval between its two timestamps, formatted by the
          host's own `formatDuration` (the very function `ReactiveDuration`
          calls, which can only measure against now); a running one is counted
          live from `startedAt`. */}
      <DrawerItem name="Duration" hidden={!startedAt}>
        {durationMs === undefined ? (
          <ReactiveDuration timestamp={startedAt} />
        ) : (
          <WithTooltip>{Common.Util.formatDuration(durationMs)}</WithTooltip>
        )}
      </DrawerItem>
      {/* Both are Go duration strings with no schema format, rendered raw with
          their semantics in the tooltip rather than parsed (SPEC-0008). */}
      <DrawerItem name="Timeout" hidden={!spec?.timeout}>
        <WithTooltip tooltip={timeoutTooltip}>{spec?.timeout}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="TTL" hidden={!spec?.ttl}>
        <WithTooltip tooltip={ttlTooltip}>{spec?.ttl}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Drain Period" hidden={!spec?.termination?.drainPeriod}>
        <WithTooltip tooltip={drainPeriodTooltip}>{spec?.termination?.drainPeriod}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/** The shape of the microVM the image is booted in. */
const GuestSection = observer(({ object }: SectionProps) => {
  const spec = object.spec;
  const namespace = object.getNs();
  const kernelName = spec?.kernelProfileRef?.name;
  const kernelStore = maybe(() => SwiftKernel.getStore<SwiftKernel>());
  const kernelRef = existingObjectRef(kernelStore, SwiftKernel.kind, kernelName, namespace);
  const nodeSelector = Object.entries(spec?.nodeSelector ?? {});
  const rootfsMode = spec?.rootfsMode;
  const networkMode = SwiftSandbox.getNetworkMode(object);
  const imagePullSecret = spec?.imagePullSecret;
  const verifyKeySecret = spec?.verifyKeySecretRef?.name;

  return (
    <>
      <DrawerTitle>Guest</DrawerTitle>
      <DrawerItem name="CPU">
        <WithTooltip>{spec?.cpu ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Memory">
        <WithTooltip>{formatQuantity(spec?.memory) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* The raw enum values, with the schema's own explanation of each in the
          tooltip (the SPEC-0007 treatment of tier and partition mode). */}
      <DrawerItem name="Rootfs Mode">
        <WithTooltip tooltip={describeRootfsMode(rootfsMode)}>{rootfsMode ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* An unset profile is not a missing value: the controller applies the
          well-known "sandbox" kernel. It is not linked, because the schema
          declares no default and a guessed namespace would be a dead link. */}
      <DrawerItem name="Kernel Profile">
        {kernelName ? (
          kernelRef ? (
            <LinkToObject objectRef={kernelRef} object={object} />
          ) : (
            <WithTooltip>{kernelName}</WithTooltip>
          )
        ) : (
          <WithTooltip tooltip={defaultKernelTooltip}>{defaultKernelLabel}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Network Mode">
        <WithTooltip tooltip={describeNetworkMode(networkMode)}>{networkMode ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Node Selector" hidden={nodeSelector.length === 0} labelsOnly>
        {nodeSelector.map(([key, value]) => (
          <Badge key={key} label={`${key}: ${value}`} />
        ))}
      </DrawerItem>
      {/* The two Secrets the sandbox names. SPEC-0008's section list omitted
          them while its reference table declared both lookups, so they are
          rendered here rather than loaded for nothing - grouped exactly as the
          SwiftSandboxPool's "Slot Shape" section groups the same two fields, so
          the two M4 drawers read the same way (declared addition, recorded in
          the spec). */}
      <DrawerItem name="Image Pull Secret" hidden={!imagePullSecret}>
        {objectExists(secretsStore, imagePullSecret, namespace) ? (
          <LinkToSecret name={imagePullSecret} namespace={namespace} />
        ) : (
          <WithTooltip>{imagePullSecret}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Verify Key Secret" hidden={!verifyKeySecret}>
        {objectExists(secretsStore, verifyKeySecret, namespace) ? (
          <LinkToSecret name={verifyKeySecret} namespace={namespace} />
        ) : (
          <WithTooltip>{verifyKeySecret}</WithTooltip>
        )}
      </DrawerItem>
    </>
  );
});

/**
 * Where the sandbox actually runs, and the one place in this extension that
 * reaches into the host's log dock.
 *
 * `status.podRef` is the launcher pod's NAME, and for a pool checkout it names
 * the claimed slot's pod rather than a pod named after the sandbox, so it is
 * always read from the field. A miss is the normal case here, not a defect: a
 * terminal sandbox's pod is routinely gone and `spec.ttl` deletes the record
 * afterwards.
 */
const RuntimeSection = observer(({ object }: SectionProps) => {
  const status = object.status;

  if (
    !status?.nodeName &&
    !status?.podRef &&
    !status?.runtime &&
    !status?.network?.primaryIP &&
    !status?.network?.podIP
  ) {
    return null;
  }

  const namespace = object.getNs();
  const nodeName = SwiftSandbox.getNodeName(object);
  const podName = SwiftSandbox.getPodName(object);
  const nodeIsLinkable = objectExists(nodesStore, nodeName);
  const pod = podName ? podsStore.getByName(podName, namespace) : undefined;
  // The affordance is absent, not disabled, when there is nothing to open: a
  // pod that is gone, or one whose containers the store has not reported.
  const container = pod ? findDefaultContainerOfPod(pod) : undefined;
  const scope = SwiftSandbox.getPrimaryIPScope(object);

  return (
    <>
      <DrawerTitle>Runtime</DrawerTitle>
      <DrawerItem name="Node" hidden={!nodeName}>
        {nodeIsLinkable ? <LinkToNode name={nodeName} /> : <WithTooltip>{nodeName}</WithTooltip>}
      </DrawerItem>
      <DrawerItem name="Launcher Pod" hidden={!podName}>
        <span className={styles.launcherPod}>
          {pod ? <LinkToPod name={podName} namespace={namespace} /> : <WithTooltip>{podName}</WithTooltip>}
          {/* Opens the host's own log dock on the launcher pod: the extension
              renders no log viewer, streams nothing itself and adds no
              permission the user does not already have. The container switch
              inside that tab is what reaches the sandbox-materialize init
              container, which is where a stuck Materializing explains itself.
              Verified live before this row was written (SPEC-0008). */}
          {pod && container ? (
            <Icon
              material="subject"
              tooltip="View logs"
              interactive
              smallest
              data-testid="swiftsandbox-view-logs"
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation();
                logTabStore.createPodTab({ selectedPod: pod, selectedContainer: container });
              }}
            />
          ) : null}
        </span>
      </DrawerItem>
      {/* Named after the printer column since v0.18.0 added the pod's own
          address next to it; the scope says where the guest's can be reached
          from, which for a sandbox is only inside its launcher pod. */}
      <DrawerItem name="Guest IP" hidden={!SwiftSandbox.getPrimaryIP(object)}>
        <WithTooltip>{SwiftSandbox.getPrimaryIP(object)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="IP Scope" hidden={!scope}>
        <WithTooltip tooltip={scope ? ipScopeTooltips.get(scope) : undefined}>{scope}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Pod IP" hidden={!SwiftSandbox.getPodIP(object)}>
        <WithTooltip tooltip={podIPTooltip}>{SwiftSandbox.getPodIP(object)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Hypervisor" hidden={!SwiftSandbox.getHypervisor(object)}>
        <WithTooltip>{SwiftSandbox.getHypervisor(object)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="PID" hidden={SwiftSandbox.getPid(object) === undefined}>
        <WithTooltip>{SwiftSandbox.getPid(object)}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/** The materialized OCI rootfs, reported once the image has been unpacked. */
function RootfsSection({ object }: SectionProps) {
  const rootfs = object.status?.rootfs;

  if (!rootfs) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Rootfs</DrawerTitle>
      <DrawerItem name="Digest" hidden={!rootfs.digest}>
        <WithTooltip>{rootfs.digest}</WithTooltip>
      </DrawerItem>
      {/* An int64 byte count, humanized rather than shown as a digit run. */}
      <DrawerItem name="Size" hidden={rootfs.sizeBytes === undefined}>
        <WithTooltip tooltip={rootfs.sizeBytes === undefined ? undefined : `${rootfs.sizeBytes} bytes`}>
          {SwiftSandbox.getRootfsSize(object)}
        </WithTooltip>
      </DrawerItem>
      <DrawerItem name="Cache Path" hidden={!rootfs.cachePath}>
        <WithTooltip tooltip={rootfsSharedTooltip}>{rootfs.cachePath}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/** The read-only model artifact mounted over virtio-fs, when there is one. */
function ModelSection({ object }: SectionProps) {
  const model = object.spec?.model;
  const status = object.status?.model;

  if (!model && !status) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Model</DrawerTitle>
      <DrawerItem name="Image Ref" hidden={!model?.imageRef}>
        <WithTooltip>{model?.imageRef}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Mount Path">
        <WithTooltip>{status?.mountPath ?? model?.mountPath ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Digest" hidden={!status?.digest}>
        <WithTooltip>{status?.digest}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Cache Path" hidden={!status?.cachePath}>
        <WithTooltip>{status?.cachePath}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/**
 * The secondary block disk, named by its source rather than left for the reader
 * to infer from which of the two spec blocks is set.
 *
 * Core exports no `LinkToPersistentVolumeClaim`, so the PVC row is the generic
 * path DESIGN.md section 3 prescribes for arbitrary refs. The Storage Class
 * does have a core link component, so it takes the existence-checked
 * `LinkToStorageClass` path the SwiftSnapshot drawer's captured Storage Class
 * row uses - the same row in a different drawer must read the same way
 * (Roberto's coherence ruling, 2026-08-29; SPEC-0008 "Milestone review
 * follow-up").
 */
const ScratchDiskSection = observer(({ object }: SectionProps) => {
  const spec = object.spec?.scratchDisk;
  const status = object.status?.scratchDisk;

  if (!spec && !status) {
    return null;
  }

  const blank = spec?.blank;
  const pvcName = SwiftSandbox.getScratchDiskPvcName(object);
  const pvcRef = existingObjectRef(pvcStore, "PersistentVolumeClaim", pvcName, object.getNs());
  // StorageClass is cluster-scoped: no namespace argument. A blank scratch disk
  // may well name a class that was removed since, so the row degrades to plain
  // text like every other reference in this drawer.
  const storageClassIsLinkable = objectExists(storageClassStore, blank?.storageClassName);

  return (
    <>
      <DrawerTitle>Scratch Disk</DrawerTitle>
      <DrawerItem name="Source">
        <WithTooltip>{SwiftSandbox.getScratchDiskSource(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Size" hidden={blank?.size === undefined}>
        <WithTooltip>{formatQuantity(blank?.size)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Storage Class" hidden={!blank?.storageClassName}>
        {storageClassIsLinkable ? (
          <LinkToStorageClass name={blank?.storageClassName} />
        ) : (
          <WithTooltip>{blank?.storageClassName}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Volume Mode" hidden={!blank?.volumeMode}>
        <WithTooltip>{blank?.volumeMode}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="PVC" hidden={!pvcName}>
        {pvcRef ? <LinkToObject objectRef={pvcRef} object={object} /> : <WithTooltip>{pvcName}</WithTooltip>}
      </DrawerItem>
      <DrawerItem name="Bound" hidden={status?.bound === undefined} labelsOnly>
        <BadgeBoolean value={status?.bound} />
      </DrawerItem>
      <DrawerItem name="Device Path" hidden={!status?.devicePath}>
        <WithTooltip>{status?.devicePath}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/**
 * The GPU, whichever of the two backends gave it. The backend is named rather
 * than inferred from the absence of the other: no CEL rule enforces the
 * documented exclusivity, so both blocks can be present on one object.
 */
const GpuSection = observer(({ object }: SectionProps) => {
  if (!SwiftSandbox.hasGpu(object)) {
    return null;
  }

  const namespace = object.getNs();
  const claim = object.spec?.gpuResourceClaim;
  const gpu = object.status?.gpu;
  const gpuProfileName = object.spec?.gpuProfileRef?.name;
  const gpuNodeName = gpu?.nodeName;
  const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());
  const gpuNodeStore = maybe(() => SwiftGPUNode.getStore<SwiftGPUNode>());
  const gpuProfileRef = existingObjectRef(gpuProfileStore, SwiftGPUProfile.kind, gpuProfileName, namespace);
  const gpuNodeRef = existingObjectRef(gpuNodeStore, SwiftGPUNode.kind, gpuNodeName);
  const devices = gpu?.devices ?? [];
  const numaNodes = gpu?.numaNodes ?? [];
  const partitionId = SwiftSandbox.getGpuPartitionId(object);

  return (
    <>
      <DrawerTitle>GPU</DrawerTitle>
      <DrawerItem name="Backend">
        <WithTooltip>{SwiftSandbox.getGpuBackend(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="GPU Profile" hidden={!gpuProfileName}>
        {gpuProfileRef ? (
          <LinkToObject objectRef={gpuProfileRef} object={object} />
        ) : (
          <WithTooltip>{gpuProfileName}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Tier" hidden={!claim?.tier}>
        <WithTooltip tooltip={describeTier(claim?.tier)}>{claim?.tier}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Resource Claim" hidden={!claim?.resourceClaimName}>
        <WithTooltip>{claim?.resourceClaimName}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Claim Template" hidden={!claim?.resourceClaimTemplateName}>
        <WithTooltip>{claim?.resourceClaimTemplateName}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Request Name" hidden={!claim?.requestName}>
        <WithTooltip>{claim?.requestName}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Hugepages" hidden={!claim?.hugepages}>
        <WithTooltip>{claim?.hugepages}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Devices" hidden={devices.length === 0} labelsOnly>
        {devices.map((device) => (
          <Badge key={device} label={device} />
        ))}
      </DrawerItem>
      <DrawerItem name="GPU Node" hidden={!gpuNodeName}>
        {gpuNodeRef ? (
          <LinkToObject objectRef={gpuNodeRef} object={object} />
        ) : (
          <WithTooltip>{gpuNodeName}</WithTooltip>
        )}
      </DrawerItem>
      {/* Named after its section rather than "Hypervisor": the Runtime section
          already has a row by that name, reporting what actually runs the
          guest, and this one is what the GPU tier forced. */}
      <DrawerItem name="GPU Hypervisor" hidden={!gpu?.hypervisor}>
        <WithTooltip>{gpu?.hypervisor}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="NUMA Nodes" hidden={numaNodes.length === 0}>
        <WithTooltip>{numaNodes.join(", ")}</WithTooltip>
      </DrawerItem>
      {/* `partitionId: -1` means "no partition", so the row disappears rather
          than showing the sentinel. */}
      <DrawerItem name="Partition" hidden={partitionId === undefined}>
        <WithTooltip>{partitionId}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/**
 * The two probes and the fast start of the readiness one, each summarized on
 * one line with the schema's defaults filled in (SPEC-0019 T2).
 */
function HealthSection({ object }: SectionProps) {
  const spec = object.spec;
  const readiness = describeProbe(spec?.readinessProbe);
  const liveness = describeProbe(spec?.livenessProbe);
  const startup = spec?.readinessStartup;

  if (!readiness && !liveness && !startup) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Health</DrawerTitle>
      <DrawerItem name="Readiness Probe" hidden={!readiness}>
        <WithTooltip tooltip={readinessTooltip}>{readiness}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Liveness Probe" hidden={!liveness}>
        <WithTooltip tooltip={livenessTooltip}>{liveness}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Readiness Startup" hidden={!startup}>
        <WithTooltip tooltip={readinessStartupTooltip}>
          {`every ${startup?.interval || "100ms"} for ${startup?.window || "30s"}`}
        </WithTooltip>
      </DrawerItem>
    </>
  );
}

/** What the launcher pod is given on top of what KubeSwift sets itself. */
function PodMetadataSection({ object }: SectionProps) {
  const labels = Object.entries(object.spec?.podMetadata?.labels ?? {});
  const annotations = Object.entries(object.spec?.podMetadata?.annotations ?? {});

  if (labels.length === 0 && annotations.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Pod Metadata</DrawerTitle>
      <DrawerItem name="Labels" hidden={labels.length === 0} labelsOnly>
        {labels.map(([key, value]) => (
          <Badge key={key} label={`${key}=${value}`} tooltip={podLabelsTooltip} />
        ))}
      </DrawerItem>
      <DrawerItem name="Annotations" hidden={annotations.length === 0} labelsOnly>
        {annotations.map(([key, value]) => (
          <Badge key={key} label={`${key}=${value}`} />
        ))}
      </DrawerItem>
    </>
  );
}

/** A Secret row: a link while the Secret is in its store, its name otherwise. */
function SecretReference({ name, namespace }: { name?: string; namespace: string }) {
  return objectExists(secretsStore, name, namespace) ? (
    <LinkToSecret name={name} namespace={namespace} />
  ) : (
    <WithTooltip>{name}</WithTooltip>
  );
}

/**
 * Every artifact, as its spec entry and its status entry joined on the name, one
 * titled group each: an artifact has a dozen facts of its own, which a table row
 * could not hold on one line (DESIGN.md section 3).
 */
const ArtifactsSection = observer(({ object }: SectionProps) => {
  const views = SwiftSandbox.getArtifactViews(object);

  if (views.length === 0) {
    return null;
  }

  const namespace = object.getNs();
  const policyStore = maybe(() => SwiftArtifactVerificationPolicy.getStore<SwiftArtifactVerificationPolicy>());

  return (
    <>
      {views.map(({ name, spec, status }) => {
        const condition = status ? classifySandboxArtifact(status.state, status.reason) : undefined;
        const claims = Object.entries(spec?.claims ?? {});
        const policies = status?.policies ?? [];
        const ref = spec?.ref;

        return (
          <div key={name} data-testid={`swiftsandbox-artifact-${name}`}>
            <DrawerTitle>{`Artifact: ${name}`}</DrawerTitle>
            <DrawerItem name="State" hidden={!condition} labelsOnly>
              {condition ? (
                <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
              ) : null}
            </DrawerItem>
            <DrawerItem name="Reason" hidden={!status?.reason}>
              <WithTooltip>{status?.reason}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Message" hidden={!status?.message}>
              <WithTooltip>{status?.message}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Ref" hidden={!ref}>
              <WithTooltip tooltip={ref && !ref.includes("@") ? artifactRefTagTooltip : undefined}>{ref}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Digest" hidden={!status?.digest}>
              <WithTooltip>{status?.digest}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Mount Path">
              <WithTooltip>{status?.mountPath ?? spec?.mountPath ?? notAvailable}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Layout" hidden={!spec?.layout}>
              <WithTooltip>{spec?.layout}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Optional" hidden={!spec?.optional} labelsOnly>
              <BadgeBoolean value={spec?.optional} />
            </DrawerItem>
            <DrawerItem name="Fetch Timeout" hidden={!spec?.fetchTimeout}>
              <WithTooltip tooltip={fetchTimeoutTooltip}>{spec?.fetchTimeout}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Pull Secret" hidden={!spec?.pullSecretRef?.name}>
              <SecretReference name={spec?.pullSecretRef?.name} namespace={namespace} />
            </DrawerItem>
            <DrawerItem name="Verify Key Secret" hidden={!spec?.verifyKeySecretRef?.name}>
              <SecretReference name={spec?.verifyKeySecretRef?.name} namespace={namespace} />
            </DrawerItem>
            <DrawerItem name="Require Platform Verification" hidden={!spec?.requirePlatformVerification} labelsOnly>
              <WithTooltip tooltip={requirePlatformVerificationTooltip}>
                <BadgeBoolean value={spec?.requirePlatformVerification} />
              </WithTooltip>
            </DrawerItem>
            <DrawerItem name="Claims" hidden={claims.length === 0} labelsOnly>
              {claims.map(([key, value]) => (
                <Badge key={key} label={`${key}=${value}`} tooltip={claimsTooltip} />
              ))}
            </DrawerItem>
            <DrawerItem name="Policies" hidden={policies.length === 0}>
              <span className={styles.policies}>
                {policies.map((policy) => {
                  const policyRef = existingObjectRef(policyStore, SwiftArtifactVerificationPolicy.kind, policy.name);
                  const generation = policy.generation === undefined ? "" : ` (generation ${policy.generation})`;

                  return (
                    <span key={policy.name}>
                      {policyRef ? <LinkToObject objectRef={policyRef} object={object} /> : policy.name}
                      {generation}
                    </span>
                  );
                })}
              </span>
            </DrawerItem>
          </div>
        );
      })}
    </>
  );
});

/** The Secrets whose keys are written into the guest as files. */
const SecretFilesSection = observer(({ object }: SectionProps) => {
  const files = SwiftSandbox.getSecretFiles(object);

  if (files.length === 0) {
    return null;
  }

  const namespace = object.getNs();

  return (
    <>
      <DrawerTitle>Secret Files</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.secretFiles}>
        <TableHead flat sticky={false}>
          <TableCell className="secret">Secret</TableCell>
          <TableCell className="items">Files</TableCell>
          <TableCell className="mode">Mode</TableCell>
          <TableCell className="optional">Optional</TableCell>
        </TableHead>
        {files.map((file, index) => {
          const items = (file.items ?? []).map(describeSecretFileItem).join(", ");

          return (
            <TableRow key={`${index}-${file.secretName}`} nowrap>
              <TableCell className="secret">
                <SecretReference name={file.secretName} namespace={namespace} />
              </TableCell>
              <TableCell className="items">
                <WithTooltip>{items || notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="mode">
                <WithTooltip tooltip="0400 when unset">{formatFileMode(file.mode) ?? "0400"}</WithTooltip>
              </TableCell>
              <TableCell className="optional">
                <BadgeBoolean value={Boolean(file.optional)} />
              </TableCell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
});

/**
 * The environment the workload is given, merged by the controller over the
 * image config's own.
 *
 * Values are shown as they arrive and are never masked: a `secretKeyRef`
 * carries no value in the object, so there is nothing to leak, and masking a
 * literal the author typed into the spec would hide data the YAML tab shows
 * anyway (SPEC-0008).
 */
const EnvironmentSection = observer(({ object }: SectionProps) => {
  const env = SwiftSandbox.getEnv(object);

  if (env.length === 0) {
    return null;
  }

  const namespace = object.getNs();

  return (
    <>
      <DrawerTitle>Environment</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.env}>
        <TableHead flat sticky={false}>
          <TableCell className="name">Name</TableCell>
          <TableCell className="value">Value</TableCell>
          <TableCell className="source">Source</TableCell>
        </TableHead>
        {env.map((variable, index) => {
          const source = describeEnvSource(variable);
          const secretIsLinkable =
            source?.kind === "Secret" && objectExists(secretsStore, source.name, namespace) && source.name;
          const configMapIsLinkable =
            source?.kind === "ConfigMap" && objectExists(configMapStore, source.name, namespace) && source.name;

          return (
            <TableRow key={variable.name || `env-${index}`} nowrap>
              <TableCell className="name">
                <WithTooltip>{variable.name || notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="value">
                <WithTooltip>{variable.value || notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="source">
                {source ? (
                  secretIsLinkable ? (
                    <WithTooltip tooltip={source.text}>
                      <LinkToSecret name={source.name} namespace={namespace} /> / {source.key}
                    </WithTooltip>
                  ) : configMapIsLinkable ? (
                    <WithTooltip tooltip={source.text}>
                      <LinkToConfigMap name={source.name} namespace={namespace} /> / {source.key}
                    </WithTooltip>
                  ) : (
                    <WithTooltip>{source.text}</WithTooltip>
                  )
                ) : (
                  <WithTooltip>{notAvailable}</WithTooltip>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
});

export type SwiftSandboxDetailsProps = Renderer.Component.KubeObjectDetailsProps<SwiftSandbox>;

export const SwiftSandboxDetails = observer((props: SwiftSandboxDetailsProps) => {
  const { object } = props;
  const namespace = object.getNs();
  const nodeName = SwiftSandbox.getNodeName(object);
  const podName = SwiftSandbox.getPodName(object);
  const gpuNodeName = object.status?.gpu?.nodeName;
  const gpuProfileName = object.spec?.gpuProfileRef?.name;
  const kernelName = object.spec?.kernelProfileRef?.name;
  const poolName = object.spec?.poolRef?.name;
  const secretNames = SwiftSandbox.getSecretNames(object);
  const configMapNames = SwiftSandbox.getConfigMapNames(object);
  const pvcNames = SwiftSandbox.getPvcNames(object);
  const scratchStorageClassName = object.spec?.scratchDisk?.blank?.storageClassName;
  const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());
  const gpuNodeStore = maybe(() => SwiftGPUNode.getStore<SwiftGPUNode>());
  const kernelStore = maybe(() => SwiftKernel.getStore<SwiftKernel>());
  const poolStore = maybe(() => SwiftSandboxPool.getStore<SwiftSandboxPool>());

  // This drawer resolves more kinds than any other in the extension, so the
  // request list is assembled conditionally: a store whose references are all
  // absent contributes no request at all, and a plain sandbox with no
  // secrets, no scratch disk and no GPU asks for exactly what the SwiftGuest
  // drawer asks for. `nodesStore` is cluster-scoped and loads cluster-wide;
  // every namespaced store is asked for the sandbox's own namespace rather
  // than for whatever the namespace filter happens to hold (DESIGN.md
  // section 3, issue #38).
  //
  // A `lookup=miss` is expected here more often than anywhere else in the
  // extension and is not a defect: a terminal sandbox's launcher pod is gone,
  // a blank scratch PVC is deleted with its sandbox, and a pooled sandbox may
  // name a pool that was removed. Those rows render as plain text, which is
  // the correct outcome.
  const requests: ReferenceRequest<unknown>[] = [];

  if (nodeName || gpuNodeName) {
    requests.push({
      label: "nodes",
      store: nodesStore,
      lookups: [{ name: nodeName }, { name: gpuNodeName }],
    });
  }

  if (podName) {
    requests.push({
      label: "pods",
      store: podsStore,
      namespaces: [namespace],
      lookups: [{ name: podName, namespace }],
    });
  }

  if (secretNames.length > 0) {
    requests.push({
      label: "secrets",
      store: secretsStore,
      namespaces: [namespace],
      lookups: secretNames.map((name) => ({ name, namespace })),
    });
  }

  if (configMapNames.length > 0) {
    requests.push({
      label: "configmaps",
      store: configMapStore,
      namespaces: [namespace],
      lookups: configMapNames.map((name) => ({ name, namespace })),
    });
  }

  if (pvcNames.length > 0) {
    requests.push({
      label: "persistentvolumeclaims",
      store: pvcStore,
      namespaces: [namespace],
      lookups: pvcNames.map((name) => ({ name, namespace })),
    });
  }

  // Only a `blank` scratch disk names a StorageClass, and only then is the
  // store worth loading: a sandbox with no scratch disk, or one attaching an
  // existing PVC, contributes no request here. `storageClassStore` is
  // cluster-scoped, so it takes no namespaces (issue #38).
  if (scratchStorageClassName) {
    requests.push({
      label: "storageclasses",
      store: storageClassStore,
      lookups: [{ name: scratchStorageClassName }],
    });
  }

  if (kernelName) {
    requests.push({
      label: SwiftKernel.crd.plural,
      store: kernelStore,
      namespaces: [namespace],
      lookups: [{ name: kernelName, namespace }],
    });
  }

  // `poolRef` is a `LocalObjectReference`, so the pool can only be in this
  // sandbox's own namespace. A GPU sandbox never carries one - the documented
  // webhook rules make `poolRef` exclusive with both GPU backends - so this
  // request and the two below are mutually exclusive in practice.
  if (poolName) {
    requests.push({
      label: SwiftSandboxPool.crd.plural,
      store: poolStore,
      namespaces: [namespace],
      lookups: [{ name: poolName, namespace }],
    });
  }

  if (gpuProfileName) {
    requests.push({
      label: SwiftGPUProfile.crd.plural,
      store: gpuProfileStore,
      namespaces: [namespace],
      lookups: [{ name: gpuProfileName, namespace }],
    });
  }

  // `status.gpu.nodeName` is looked up twice on purpose: once against
  // `nodesStore` (the Kubernetes node) and once here (the GPU inventory
  // object named after it), which is the pairing SPEC-0007 settled.
  if (gpuNodeName) {
    requests.push({ label: SwiftGPUNode.crd.plural, store: gpuNodeStore, lookups: [{ name: gpuNodeName }] });
  }

  // The verification policies an artifact's status names. Cluster-scoped, so
  // no namespaces; asked for only when a status names one.
  const policyNames = SwiftSandbox.getArtifactPolicyNames(object);

  if (policyNames.length > 0) {
    requests.push({
      label: SwiftArtifactVerificationPolicy.crd.plural,
      store: maybe(() => SwiftArtifactVerificationPolicy.getStore<SwiftArtifactVerificationPolicy>()),
      lookups: policyNames.map((name) => ({ name })),
    });
  }

  useReferenceStores(requests);

  return (
    <>
      <SandboxSection object={object} />
      <GuestSection object={object} />
      <SandboxNetworkSection network={object.spec?.network} egressAllowed={SwiftSandbox.getEgressAllowed(object)} />
      <HealthSection object={object} />
      <PodMetadataSection object={object} />
      <RuntimeSection object={object} />
      <RootfsSection object={object} />
      <ModelSection object={object} />
      <ScratchDiskSection object={object} />
      <GpuSection object={object} />
      <ArtifactsSection object={object} />
      <SecretFilesSection object={object} />
      <EnvironmentSection object={object} />
      <KubeObjectConditionsDrawer object={object} />
    </>
  );
});

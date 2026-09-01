import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGPUNode } from "../api/kubeswift/swiftgpunode-v1alpha1";
import { SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestPool } from "../api/kubeswift/swiftguestpool-v1alpha1";
import { canOpenGuestConsole, guestConsoleDrawerExplanation } from "../components/console-commands";
import { withErrorPage } from "../components/error-page";
import { deleteCascade } from "../components/guest-actions";
import { classifyGuest } from "../components/guest-status";
import { existingObjectRef, objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToNode,
    LinkToObject,
    LinkToPod,
    LocaleDate,
    WithTooltip,
  },
  K8sApi: { nodesStore, podsStore },
} = Renderer;

const notAvailable = "N/A";

/** Why the Managed By row matters, in the row itself rather than in a dialog nobody can amend. */
const managedByTooltip =
  "This guest is owned by a pool, which recreates it as soon as it is deleted on its own. Delete or scale the " +
  "pool instead.";

export interface SwiftGuestDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftGuest> {
  extension: Renderer.LensExtension;
}

export const SwiftGuestDetails = observer((props: SwiftGuestDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const bootSource = SwiftGuest.getBootSource(object);
    const interfaces = status?.network?.interfaces ?? [];
    const gpu = status?.gpu;
    const gpuDevices = gpu?.devices ?? [];
    const gpuNumaNodes = gpu?.numaNodes ?? [];
    const gpuNodeName = gpu?.nodeName;
    const gpuPartitionId = SwiftGuest.getGpuPartitionId(object);
    const gpuProfileName = spec?.gpuProfileRef?.name;
    const seedProfileName = spec?.seedProfileRef?.name;
    const nodeName = SwiftGuest.getNodeName(object);
    const podName = SwiftGuest.getPodName(object);
    const podNamespace = status?.podRef?.namespace ?? object.getNs();
    const namespace = object.getNs();
    const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());
    const gpuNodeStore = maybe(() => SwiftGPUNode.getStore<SwiftGPUNode>());
    const condition = classifyGuest(spec, status);
    const owningPool = SwiftGuest.getOwningPool(object);
    const guestPoolStore = maybe(() => SwiftGuestPool.getStore<SwiftGuestPool>());
    const cascade = deleteCascade({ name: object.getName(), namespace, spec, status });
    const consoleFacts = { name: object.getName(), namespace, spec, status };
    const consoleVerdict = canOpenGuestConsole(consoleFacts);

    // A stale or not-yet-reconciled status can name a Node or Pod that is no
    // longer (or not yet) there; `nodesStore`/`podsStore` may also simply not
    // have loaded yet the first time this drawer opens, since nothing else on
    // this page needs them. Either way `LinkToNode`/`LinkToPod` would still
    // render a link (they only format a details URL from the name, they
    // never check the target exists), so the existence check below decides
    // between a real link and plain text instead (DESIGN.md section 3,
    // issue #23). `nodesStore` is cluster-scoped and loads cluster-wide;
    // `podsStore` is asked for the launcher pod's own namespace rather than
    // for whatever the namespace filter happens to hold (issue #38).
    //
    // The two GPU references became resolvable in M3, when their kinds were
    // registered (SPEC-0007): the GPU profile lives in the guest's own
    // namespace, since `gpuProfileRef` is a `LocalObjectReference`, and the GPU
    // node is cluster-scoped like `nodesStore`. Both rows degrade to plain text
    // when the object is not there, which on a cluster without the GPU
    // discovery DaemonSet is the normal outcome rather than a defect.
    useReferenceStores([
      { label: "nodes", store: nodesStore, lookups: [{ name: nodeName }] },
      {
        label: "pods",
        store: podsStore,
        namespaces: [podNamespace],
        lookups: [{ name: podName, namespace: podNamespace }],
      },
      {
        label: SwiftGPUProfile.crd.plural,
        store: gpuProfileStore,
        namespaces: [namespace],
        lookups: [{ name: gpuProfileName, namespace }],
      },
      { label: SwiftGPUNode.crd.plural, store: gpuNodeStore, lookups: [{ name: gpuNodeName }] },
      {
        label: SwiftGuestPool.crd.plural,
        store: guestPoolStore,
        namespaces: owningPool ? [owningPool.namespace] : [],
        lookups: [{ name: owningPool?.name, namespace: owningPool?.namespace }],
      },
    ]);

    const nodeIsLinkable = objectExists(nodesStore, nodeName);
    const podIsLinkable = objectExists(podsStore, podName, podNamespace);
    const gpuProfileRef = existingObjectRef(gpuProfileStore, SwiftGPUProfile.kind, gpuProfileName, namespace);
    const gpuNodeRef = existingObjectRef(gpuNodeStore, SwiftGPUNode.kind, gpuNodeName);
    const owningPoolRef = existingObjectRef(
      guestPoolStore,
      SwiftGuestPool.kind,
      owningPool?.name,
      owningPool?.namespace,
    );

    return (
      <>
        <DrawerTitle>Guest</DrawerTitle>
        {/* The Phase row became a Condition row with M6 (SPEC-0010): the badge
            says everything the phase said plus the one reading the phase cannot
            express, `Stopping`, and its explanation is where a user finds out
            why a greyed Start or Stop is greyed - the channel B5 keeps for a
            user who never hovers a menu. The raw phase is still one row above,
            in the host's own printer-column block (DESIGN.md section 3). */}
        <DrawerItem name="Condition" labelsOnly>
          <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
        </DrawerItem>
        {/* The field the user's own Start and Stop clicks write. A drawer
            showing `Run Policy: Stopped` next to `Condition: Stopping` is the
            complete and truthful account of a guest mid-transition. */}
        <DrawerItem name="Run Policy">
          <WithTooltip>{SwiftGuest.getRunPolicy(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="OS Type">
          <WithTooltip>{SwiftGuest.getOsType(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Scheduler" hidden={!spec?.schedulerName}>
          <WithTooltip>{spec?.schedulerName}</WithTooltip>
        </DrawerItem>
        {/* What only KubeSwift's ownership model knows: a pool sets a controller
            reference on the guests it creates and recreates any of them that is
            deleted on its own, which turns a confusing outcome (the row comes
            back) into an expected one. The host's own Delete confirmation has no
            hook for this, so the extension says it where it owns the surface,
            and permanently rather than only at the moment of deletion
            (SPEC-0010, B13). */}
        <DrawerItem name="Managed By" hidden={!owningPool}>
          <WithTooltip tooltip={managedByTooltip}>
            {owningPoolRef ? <LinkToObject objectRef={owningPoolRef} object={object} /> : owningPool?.name}
          </WithTooltip>
        </DrawerItem>
        {/* The cascade of this guest's own deletion, computed from its own spec.
            SwiftGuest carries no finalizers and the reconciler has no deletion
            branch: everything that goes, goes by owner reference, and a snapshot
            references its guest by name with no owner reference at all - which
            is the behaviour a backup deserves and the one a user is most likely
            to guess wrong. */}
        <DrawerItem name="On Delete">
          <WithTooltip>{`Removed: ${cascade.removed.join(", ")}. Kept: ${cascade.retained.join(", ")}.`}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>References</DrawerTitle>
        <DrawerItem name="Guest Class">
          <WithTooltip>{spec?.guestClassRef?.name ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name={bootSource?.kind === "kernel" ? "Kernel" : "Image"}>
          <WithTooltip>{bootSource?.name ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Kernel Cmdline" hidden={!spec?.kernelCmdline}>
          <WithTooltip>{spec?.kernelCmdline}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Seed Profile" hidden={!seedProfileName}>
          <WithTooltip>{seedProfileName}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="GPU Profile" hidden={!gpuProfileName}>
          {gpuProfileRef ? (
            <LinkToObject objectRef={gpuProfileRef} object={object} />
          ) : (
            <WithTooltip>{gpuProfileName}</WithTooltip>
          )}
        </DrawerItem>

        <DrawerTitle>Runtime</DrawerTitle>
        <DrawerItem name="Node" hidden={!status?.nodeName}>
          {nodeIsLinkable ? <LinkToNode name={nodeName} /> : <WithTooltip>{nodeName}</WithTooltip>}
        </DrawerItem>
        <DrawerItem name="Pod" hidden={!status?.podRef?.name}>
          {podIsLinkable ? <LinkToPod name={podName} namespace={podNamespace} /> : <WithTooltip>{podName}</WithTooltip>}
        </DrawerItem>
        <DrawerItem name="Hypervisor" hidden={!status?.runtime?.hypervisor}>
          <WithTooltip>{SwiftGuest.getHypervisor(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="PID" hidden={status?.runtime?.pid === undefined}>
          <WithTooltip>{status?.runtime?.pid}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Serial Socket" hidden={!SwiftGuest.getSerialSocket(object)}>
          <WithTooltip>{SwiftGuest.getSerialSocket(object)}</WithTooltip>
        </DrawerItem>
        {/* Where a user who never hovers a menu finds out why the Serial
            Console item is greyed - the second surface W4 requires for a
            guard's reason, and the durable one, since a disabled `MenuItem`
            carries `pointer-events: none` and can never show a hover tooltip
            (SPEC-0010 spike S7, SPEC-0017). It is the Condition row's job for
            Start and Stop, and the console needs its own because its reason is
            about the launcher pod and the socket inside it rather than about
            the phase alone. The whole sentence is the row's text and not only
            its tooltip: DESIGN.md section 7 does not let anything important
            live in a tooltip alone. */}
        <DrawerItem name="Serial Console">
          <WithTooltip>{guestConsoleDrawerExplanation(consoleFacts, consoleVerdict)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Network</DrawerTitle>
        <DrawerItem name="Primary IP">
          <WithTooltip>{SwiftGuest.getPrimaryIP(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Interfaces" hidden={interfaces.length === 0} labelsOnly>
          {interfaces.map((iface, index) => (
            <Badge
              key={iface.name ?? iface.mac ?? `interface-${index}`}
              label={[iface.name, iface.ip].filter(Boolean).join(": ")}
              tooltip={iface.mac}
            />
          ))}
        </DrawerItem>

        <DrawerTitle>Restarts</DrawerTitle>
        <DrawerItem name="Restart Count">
          <WithTooltip>{SwiftGuest.getRestartCount(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Last Restart" hidden={!status?.lastRestartTime}>
          {status?.lastRestartTime ? <LocaleDate date={status.lastRestartTime} /> : null}
        </DrawerItem>

        {/* Everything `SwiftGuestGpuStatus` types, now that M3 gives the node
            reference somewhere to point (SPEC-0007). The hypervisor row is
            named after its section rather than "Hypervisor": the Runtime
            section already has a row by that name, reporting what actually
            runs the guest, and this one is what the GPU tier forced. */}
        {gpu ? (
          <>
            <DrawerTitle>GPU</DrawerTitle>
            <DrawerItem name="GPU Node" hidden={!gpuNodeName}>
              {gpuNodeRef ? (
                <LinkToObject objectRef={gpuNodeRef} object={object} />
              ) : (
                <WithTooltip>{gpuNodeName}</WithTooltip>
              )}
            </DrawerItem>
            <DrawerItem name="Devices" hidden={gpuDevices.length === 0} labelsOnly>
              {gpuDevices.map((device) => (
                <Badge key={device} label={device} />
              ))}
            </DrawerItem>
            <DrawerItem name="Partition" hidden={gpuPartitionId === undefined}>
              <WithTooltip>{gpuPartitionId}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="GPU Hypervisor" hidden={!gpu.hypervisor}>
              <WithTooltip>{gpu.hypervisor}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="NUMA Nodes" hidden={gpuNumaNodes.length === 0}>
              <WithTooltip>{gpuNumaNodes.join(", ")}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

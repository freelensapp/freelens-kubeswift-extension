import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToNode,
    LinkToPod,
    LocaleDate,
    WithTooltip,
  },
  K8sApi: { nodesStore, podsStore },
} = Renderer;

const notAvailable = "N/A";

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
    const gpuDevices = status?.gpu?.devices ?? [];
    const gpuPartitionId = SwiftGuest.getGpuPartitionId(object);
    const gpuProfileName = spec?.gpuProfileRef?.name;
    const seedProfileName = spec?.seedProfileRef?.name;
    const nodeName = SwiftGuest.getNodeName(object);
    const podName = status?.podRef?.name;
    const podNamespace = status?.podRef?.namespace ?? object.getNs();

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
    useReferenceStores([
      { label: "nodes", store: nodesStore, lookups: [{ name: nodeName }] },
      {
        label: "pods",
        store: podsStore,
        namespaces: [podNamespace],
        lookups: [{ name: podName, namespace: podNamespace }],
      },
    ]);

    const nodeIsLinkable = objectExists(nodesStore, nodeName);
    const podIsLinkable = objectExists(podsStore, podName, podNamespace);

    return (
      <>
        <DrawerTitle>Guest</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftGuest.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Run Policy">
          <WithTooltip>{SwiftGuest.getRunPolicy(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="OS Type">
          <WithTooltip>{SwiftGuest.getOsType(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Scheduler" hidden={!spec?.schedulerName}>
          <WithTooltip>{spec?.schedulerName}</WithTooltip>
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
          <WithTooltip>{gpuProfileName}</WithTooltip>
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
        <DrawerItem name="Serial Socket" hidden={!status?.console?.serialSocket}>
          <WithTooltip>{status?.console?.serialSocket}</WithTooltip>
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

        {gpuDevices.length > 0 || gpuPartitionId !== undefined ? (
          <>
            <DrawerTitle>GPU</DrawerTitle>
            <DrawerItem name="Devices" hidden={gpuDevices.length === 0} labelsOnly>
              {gpuDevices.map((device) => (
                <Badge key={device} label={device} />
              ))}
            </DrawerItem>
            <DrawerItem name="Partition" hidden={gpuPartitionId === undefined}>
              <WithTooltip>{gpuPartitionId}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

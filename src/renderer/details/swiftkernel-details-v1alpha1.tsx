import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftKernel } from "../api/kubeswift/swiftkernel-v1alpha1";
import { withErrorPage } from "../components/error-page";

const { observer } = MobxReact;

const {
  Component: { Badge, DrawerItem, DrawerTitle, KubeObjectConditionsDrawer, LinkToSecret, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftKernelDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftKernel> {
  extension: Renderer.LensExtension;
}

export const SwiftKernelDetails = observer((props: SwiftKernelDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const nodeStatuses = SwiftKernel.getNodeStatuses(object);
    const nodes = SwiftKernel.getReadyNodeCount(object);

    return (
      <>
        <DrawerTitle>Kernel</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftKernel.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Profile" hidden={!spec?.profile}>
          <WithTooltip>{SwiftKernel.getProfile(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Kernel Cmdline" hidden={!spec?.kernelCmdline}>
          <WithTooltip>{spec?.kernelCmdline}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>OCI Artifact</DrawerTitle>
        <DrawerItem name="Image">
          <WithTooltip>{SwiftKernel.getArtifact(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Pull Secret" hidden={!spec?.ociRef?.pullSecret}>
          <LinkToSecret name={spec?.ociRef?.pullSecret} namespace={object.getNs()} />
        </DrawerItem>
        <DrawerItem name="Kernel Digest" hidden={!status?.kernelDigest}>
          <WithTooltip>{status?.kernelDigest}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Initramfs Digest" hidden={!status?.initramfsDigest}>
          <WithTooltip>{status?.initramfsDigest}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Nodes</DrawerTitle>
        <DrawerItem name="Ready">
          <WithTooltip>{`${nodes.ready}/${nodes.total}`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Pull Progress" hidden={nodeStatuses.length === 0} labelsOnly>
          {nodeStatuses.map((nodeStatus) => (
            <Badge key={nodeStatus.nodeName} label={`${nodeStatus.nodeName}: ${nodeStatus.phase}`} />
          ))}
        </DrawerItem>

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

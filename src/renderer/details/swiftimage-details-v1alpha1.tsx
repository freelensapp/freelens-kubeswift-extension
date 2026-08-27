import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftImage } from "../api/kubeswift/swiftimage-v1alpha1";
import { withErrorPage } from "../components/error-page";

const { observer } = MobxReact;

const {
  Component: { DrawerItem, DrawerTitle, KubeObjectConditionsDrawer, LinkToSecret, LinkToStorageClass, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftImageDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftImage> {
  extension: Renderer.LensExtension;
}

export const SwiftImageDetails = observer((props: SwiftImageDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const source = SwiftImage.getSourceSummary(object);
    const oci = spec?.source?.oci;
    const preparedPvc = SwiftImage.getPreparedPvc(object);
    const cloneSeed = status?.cloneSeed;

    return (
      <>
        <DrawerTitle>Image</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftImage.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Source Type">
          <WithTooltip>{source?.title ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Source" hidden={!source?.reference}>
          <WithTooltip>{source?.reference}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Source Format">
          <WithTooltip>{SwiftImage.getSourceFormat(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Prepared Format">
          <WithTooltip>{SwiftImage.getPreparedFormat(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="OS Type">
          <WithTooltip>{SwiftImage.getOsType(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Clone Strategy">
          <WithTooltip>{SwiftImage.getCloneStrategy(object)}</WithTooltip>
        </DrawerItem>

        {oci ? (
          <>
            <DrawerTitle>OCI Artifact</DrawerTitle>
            <DrawerItem name="Repository">
              <WithTooltip>{oci.repository}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Tag" hidden={!oci.tag}>
              <WithTooltip>{oci.tag}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Digest" hidden={!oci.digest}>
              <WithTooltip>{oci.digest}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Insecure" hidden={oci.insecure === undefined}>
              <WithTooltip>{String(oci.insecure)}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Credentials Secret" hidden={!oci.credentialsSecretRef?.name}>
              <LinkToSecret name={oci.credentialsSecretRef?.name} namespace={object.getNs()} />
            </DrawerItem>
            <DrawerItem name="Verify Key Secret" hidden={!oci.verifyKeySecretRef?.name}>
              <LinkToSecret name={oci.verifyKeySecretRef?.name} namespace={object.getNs()} />
            </DrawerItem>
          </>
        ) : null}

        <DrawerTitle>Storage</DrawerTitle>
        <DrawerItem name="Root Disk Size">
          <WithTooltip>{SwiftImage.getRootDiskSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Import Storage Class" hidden={!spec?.importStorageClassName}>
          <LinkToStorageClass name={spec?.importStorageClassName} />
        </DrawerItem>
        <DrawerItem name="Clone Storage Class" hidden={!spec?.cloneStorageClassName}>
          <LinkToStorageClass name={spec?.cloneStorageClassName} />
        </DrawerItem>
        <DrawerItem name="Volume Snapshot Class" hidden={!spec?.volumeSnapshotClassName}>
          <WithTooltip>{spec?.volumeSnapshotClassName}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Prepared Artifact</DrawerTitle>
        <DrawerItem name="PVC">
          <WithTooltip>{preparedPvc?.name ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Size">
          <WithTooltip>{SwiftImage.getPreparedSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>

        {cloneSeed ? (
          <>
            <DrawerTitle>Clone Seed</DrawerTitle>
            <DrawerItem name="Kind">
              <WithTooltip>{cloneSeed.kind}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Name">
              <WithTooltip>{cloneSeed.name}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Source Size" hidden={cloneSeed.sourceSizeBytes === undefined}>
              <WithTooltip>{`${cloneSeed.sourceSizeBytes} bytes`}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

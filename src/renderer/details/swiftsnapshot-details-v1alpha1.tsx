import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { formatBytes } from "../api/kubeswift/types";
import { withErrorPage } from "../components/error-page";

const { observer } = MobxReact;

const {
  Component: { Badge, DrawerItem, DrawerTitle, KubeObjectConditionsDrawer, LinkToNode, LocaleDate, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftSnapshotDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftSnapshot> {
  extension: Renderer.LensExtension;
}

export const SwiftSnapshotDetails = observer((props: SwiftSnapshotDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const disks = SwiftSnapshot.getDisks(object);
    const artifact = SwiftSnapshot.getArtifactLocation(object);
    const guestSpec = status?.guestSpec;
    const capturedDataDisks = guestSpec?.dataDisks ?? [];

    return (
      <>
        <DrawerTitle>Snapshot</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftSnapshot.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Guest">
          <WithTooltip>{SwiftSnapshot.getGuestName(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Backend">
          <WithTooltip>{SwiftSnapshot.getBackendType(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Contents">
          <WithTooltip>{SwiftSnapshot.getContents(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Deletion Policy">
          <WithTooltip>{SwiftSnapshot.getDeletionPolicy(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="TTL" hidden={!spec?.ttl}>
          <WithTooltip>{spec?.ttl}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Resume After Snapshot">
          <WithTooltip>{String(SwiftSnapshot.getResumeAfterSnapshot(object))}</WithTooltip>
        </DrawerItem>
        {/* The schema documents includeMemory as a no-op the backend overrides,
            so it is shown next to the contents the backend actually captures. */}
        <DrawerItem name="Include Memory">
          <WithTooltip>{String(SwiftSnapshot.getIncludeMemory(object))}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Include Disk" hidden={spec?.includeDisk === undefined}>
          <WithTooltip>{String(spec?.includeDisk)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Capture</DrawerTitle>
        <DrawerItem name="Captured At" hidden={!status?.capturedAt}>
          {status?.capturedAt ? <LocaleDate date={status.capturedAt} /> : null}
        </DrawerItem>
        <DrawerItem name="Total Size">
          <WithTooltip>{SwiftSnapshot.getTotalSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Memory Size" hidden={!status?.memorySnapshot}>
          <WithTooltip>{SwiftSnapshot.getMemorySnapshotSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Node" hidden={!status?.nodeName}>
          <LinkToNode name={status?.nodeName} />
        </DrawerItem>
        <DrawerItem name="Hypervisor" hidden={!status?.hypervisor}>
          <WithTooltip>
            {[status?.hypervisor, status?.hypervisorVersion].filter(Boolean).join(" ") || notAvailable}
          </WithTooltip>
        </DrawerItem>
        <DrawerItem name="Pause Window" hidden={status?.observedPauseWindowMs === undefined}>
          <WithTooltip>{`${status?.observedPauseWindowMs} ms`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Format Version" hidden={!status?.snapshotDirVersion}>
          <WithTooltip>{status?.snapshotDirVersion}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Disks" hidden={disks.length === 0} labelsOnly>
          {disks.map((disk, index) => (
            <Badge
              key={disk.diskName || `${disk.role}-${index}`}
              label={`${disk.diskName || disk.role}: ${formatBytes(disk.sizeBytes) ?? notAvailable}`}
              tooltip={disk.handle}
            />
          ))}
        </DrawerItem>

        {artifact ? (
          <>
            <DrawerTitle>Artifacts</DrawerTitle>
            <DrawerItem name={artifact.title}>
              <WithTooltip>{artifact.reference}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Manifest Digest" hidden={!status?.oci?.manifestDigest && !status?.s3?.manifestDigest}>
              <WithTooltip>{status?.oci?.manifestDigest ?? status?.s3?.manifestDigest}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Signed" hidden={status?.oci?.signed === undefined}>
              <WithTooltip>{String(status?.oci?.signed)}</WithTooltip>
            </DrawerItem>
            <DrawerItem
              name="Pushed Size"
              hidden={status?.oci?.pushedBytes === undefined && status?.s3?.uploadedBytes === undefined}
            >
              <WithTooltip>
                {formatBytes(status?.oci?.pushedBytes ?? status?.s3?.uploadedBytes) ?? notAvailable}
              </WithTooltip>
            </DrawerItem>
            <DrawerItem name="Pushed At" hidden={!status?.oci?.pushedAt && !status?.s3?.uploadedAt}>
              {status?.oci?.pushedAt || status?.s3?.uploadedAt ? (
                <LocaleDate date={(status?.oci?.pushedAt ?? status?.s3?.uploadedAt) as string} />
              ) : null}
            </DrawerItem>
          </>
        ) : null}

        {guestSpec ? (
          <>
            <DrawerTitle>Captured Guest</DrawerTitle>
            <DrawerItem name="Image" hidden={!guestSpec.imageName}>
              <WithTooltip>{guestSpec.imageName}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="OS Type" hidden={!guestSpec.osType}>
              <WithTooltip>{guestSpec.osType}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="CPU" hidden={!guestSpec.cpu}>
              <WithTooltip>{guestSpec.cpu}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Memory" hidden={guestSpec.memoryMi === undefined}>
              <WithTooltip>{`${guestSpec.memoryMi}Mi`}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Root Disk Size" hidden={!guestSpec.rootDiskSize}>
              <WithTooltip>{guestSpec.rootDiskSize}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Storage Class" hidden={!guestSpec.storage?.storageClassName}>
              <WithTooltip>{guestSpec.storage?.storageClassName}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Data Disks" hidden={capturedDataDisks.length === 0} labelsOnly>
              {capturedDataDisks.map((disk) => (
                <Badge key={disk.name} label={`${disk.name}: ${disk.size ?? notAvailable}`} />
              ))}
            </DrawerItem>
            <DrawerItem name="Seed" hidden={guestSpec.hasSeed === undefined}>
              <WithTooltip>{String(guestSpec.hasSeed)}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Guest Agent" hidden={guestSpec.guestAgent === undefined}>
              <WithTooltip>{String(guestSpec.guestAgent)}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

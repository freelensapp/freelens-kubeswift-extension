import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftImage } from "../api/kubeswift/swiftimage-v1alpha1";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { formatBytes } from "../api/kubeswift/types";
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
    LinkToObject,
    LinkToStorageClass,
    LocaleDate,
    WithTooltip,
  },
  K8sApi: { nodesStore, storageClassStore },
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
    const guestRef = SwiftSnapshot.getGuestRef(object);
    const capturedImageRef = SwiftSnapshot.getCapturedImageRef(object);
    const guestSpec = status?.guestSpec;
    const capturedDataDisks = guestSpec?.dataDisks ?? [];

    // The guest a snapshot was taken from may since have been deleted;
    // LinkToObject only formats a details URL from the ref, it never checks
    // the target exists (DESIGN.md section 3, issue #23). guestStore is
    // wrapped in maybe() because Kind.getStore() throws rather than
    // returning undefined when it cannot resolve a store.
    const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

    // The `local` backend's node - `status.nodeName` - is only ever set for
    // that one backend, and is subject to the same dead-link risk as the
    // guest reference above: `LinkToNode` never checks the target exists
    // either (issue #23).
    //
    // The captured guest's Image and Storage Class references below (#29
    // follow-up) share the same risk: they point at historical values from
    // when the snapshot was taken, so the SwiftImage or StorageClass they
    // named may since have been deleted. `imageStore` follows the same
    // `maybe(() => Kind.getStore())` pattern as `guestStore` above;
    // `storageClassStore` comes straight off `Renderer.K8sApi` like
    // `nodesStore`, since core exports it directly rather than through a
    // per-kind `getStore()`.
    const imageStore = maybe(() => SwiftImage.getStore<SwiftImage>());

    // The namespaced stores are asked for the namespaces these references
    // actually live in (the ref's own namespace, or this snapshot's when the
    // ref does not carry one) instead of relying on the namespace filter;
    // `nodesStore` and `storageClassStore` are cluster-scoped (issue #38).
    useReferenceStores([
      {
        label: SwiftGuest.crd.plural,
        store: guestStore,
        namespaces: [guestRef?.namespace ?? object.getNs()],
        lookups: [{ name: guestRef?.name, namespace: guestRef?.namespace }],
      },
      { label: "nodes", store: nodesStore, lookups: [{ name: status?.nodeName }] },
      {
        label: SwiftImage.crd.plural,
        store: imageStore,
        namespaces: [capturedImageRef?.namespace ?? object.getNs()],
        lookups: [{ name: capturedImageRef?.name, namespace: capturedImageRef?.namespace }],
      },
      {
        label: "storageclasses",
        store: storageClassStore,
        lookups: [{ name: guestSpec?.storage?.storageClassName }],
      },
    ]);

    const guestIsLinkable = objectExists(guestStore, guestRef?.name, guestRef?.namespace);
    const nodeIsLinkable = objectExists(nodesStore, status?.nodeName);
    const capturedImageIsLinkable = objectExists(imageStore, capturedImageRef?.name, capturedImageRef?.namespace);
    // StorageClass is cluster-scoped: no namespace argument.
    const capturedStorageClassIsLinkable = objectExists(storageClassStore, guestSpec?.storage?.storageClassName);

    return (
      <>
        <DrawerTitle>Snapshot</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftSnapshot.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Guest">
          {guestRef && guestIsLinkable ? (
            <LinkToObject objectRef={guestRef} object={object} />
          ) : (
            <WithTooltip>{guestRef?.name ?? notAvailable}</WithTooltip>
          )}
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
          {nodeIsLinkable ? <LinkToNode name={status?.nodeName} /> : <WithTooltip>{status?.nodeName}</WithTooltip>}
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
            {/* Image and Storage Class below are historical values captured at
                snapshot time (status.guestSpec.imageName/.storage.storageClassName).
                Like the Guest and Node references above, the SwiftImage or
                StorageClass they named may since have been deleted, so both
                rows go through the same objectExists degradation, against
                stores loaded by the same useReferenceStores call
                (#29 follow-up, closing the SPEC-0004 residual). */}
            <DrawerTitle>Captured Guest</DrawerTitle>
            <DrawerItem name="Image" hidden={!guestSpec.imageName}>
              {capturedImageRef && capturedImageIsLinkable ? (
                <LinkToObject objectRef={capturedImageRef} object={object} />
              ) : (
                <WithTooltip>{guestSpec.imageName}</WithTooltip>
              )}
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
              {capturedStorageClassIsLinkable ? (
                <LinkToStorageClass name={guestSpec.storage?.storageClassName} />
              ) : (
                <WithTooltip>{guestSpec.storage?.storageClassName}</WithTooltip>
              )}
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

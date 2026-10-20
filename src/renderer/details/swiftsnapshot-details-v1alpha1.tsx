import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftClusterStorageLocation } from "../api/kubeswift/swiftclusterstoragelocation-v1alpha1";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftImage } from "../api/kubeswift/swiftimage-v1alpha1";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { SwiftStorageLocation } from "../api/kubeswift/swiftstoragelocation-v1alpha1";
import { formatBytes } from "../api/kubeswift/types";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import { snapshotDeleteConsequences } from "../components/snapshot-create";

import type { ReferenceRequest } from "../components/reference-loader";

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

export type SwiftSnapshotDetailsProps = Renderer.Component.KubeObjectDetailsProps<SwiftSnapshot>;

export const SwiftSnapshotDetails = observer((props: SwiftSnapshotDetailsProps) => {
  const { object } = props;
  const spec = object.spec;
  const status = object.status;
  const disks = SwiftSnapshot.getDisks(object);
  const artifact = SwiftSnapshot.getArtifactLocation(object);
  const guestRef = SwiftSnapshot.getGuestRef(object);
  const capturedImageRef = SwiftSnapshot.getCapturedImageRef(object);
  const guestSpec = status?.guestSpec;
  const location = status?.location;
  const locationLabel = SwiftSnapshot.getLocationLabel(object);
  const storageLocation = SwiftSnapshot.getStorageLocation(object);
  const storageLocationRef = SwiftSnapshot.getStorageLocationRef(object);
  const isClusterLocation = storageLocation?.kind === SwiftClusterStorageLocation.kind;
  const capturedDataDisks = guestSpec?.dataDisks ?? [];
  const deleteConsequences = snapshotDeleteConsequences(
    SwiftSnapshot.getBackendType(object),
    SwiftSnapshot.getDeletionPolicy(object),
  );

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

  // The storage location the snapshot used (SPEC-0019) may have been deleted
  // since, like every reference above. A namespaced one lives in the
  // snapshot's namespace; a cluster one is cluster-scoped. Only the store of
  // the kind the snapshot names is loaded, and only when it names one.
  const storageLocationStore = maybe(() => SwiftStorageLocation.getStore<SwiftStorageLocation>());
  const clusterStorageLocationStore = maybe(() => SwiftClusterStorageLocation.getStore<SwiftClusterStorageLocation>());

  // The namespaced stores are asked for the namespaces these references
  // actually live in (the ref's own namespace, or this snapshot's when the
  // ref does not carry one) instead of relying on the namespace filter;
  // `nodesStore` and `storageClassStore` are cluster-scoped (issue #38).
  const references: ReferenceRequest<unknown>[] = [
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
  ];

  if (storageLocation && isClusterLocation) {
    references.push({
      label: SwiftClusterStorageLocation.crd.plural,
      store: clusterStorageLocationStore,
      lookups: [{ name: storageLocation.name }],
    });
  } else if (storageLocation) {
    references.push({
      label: SwiftStorageLocation.crd.plural,
      store: storageLocationStore,
      namespaces: [object.getNs()],
      lookups: [{ name: storageLocation.name, namespace: object.getNs() }],
    });
  }

  useReferenceStores(references);

  const guestIsLinkable = objectExists(guestStore, guestRef?.name, guestRef?.namespace);
  const nodeIsLinkable = objectExists(nodesStore, status?.nodeName);
  const capturedImageIsLinkable = objectExists(imageStore, capturedImageRef?.name, capturedImageRef?.namespace);
  // StorageClass is cluster-scoped: no namespace argument.
  const capturedStorageClassIsLinkable = objectExists(storageClassStore, guestSpec?.storage?.storageClassName);
  const storageLocationIsLinkable = isClusterLocation
    ? objectExists(clusterStorageLocationStore, storageLocation?.name)
    : objectExists(storageLocationStore, storageLocation?.name, object.getNs());

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
      {/* What deleting THIS snapshot destroys and what it leaves behind,
          computed from its own backend and policy rather than stated in the
          abstract (SPEC-0011, the SPEC-0010 On Delete precedent). The host
          owns the Delete confirmation and gives an extension no hook to add a
          per-kind consequence to it, so the extension says it where it does
          own the surface, and permanently rather than only at the moment of
          deletion. Two of the four backends make the Deletion Policy row
          above mean something other than what it says, and the last sentence
          is the one nobody can guess: upstream's reference guard protects TTL
          and keep-N reaping only, so a delete is never blocked by a restore
          that is using this snapshot. */}
      <DrawerItem name="On Delete">
        <WithTooltip>{deleteConsequences.join(" ")}</WithTooltip>
      </DrawerItem>

      {/* KubeSwift v0.16.0 (SPEC-0019 T2): where an oci snapshot is stored,
          or the class a csi one uses, as the controller resolved it once
          before the capture, else the location the spec asks for. */}
      {location || locationLabel ? (
        <>
          <DrawerTitle>Location</DrawerTitle>
          <DrawerItem name="Location" hidden={!locationLabel}>
            {storageLocationRef && storageLocationIsLinkable ? (
              <LinkToObject objectRef={storageLocationRef} object={object} />
            ) : (
              <WithTooltip>{locationLabel}</WithTooltip>
            )}
          </DrawerItem>
          <DrawerItem name="Repository" hidden={!location?.repository}>
            <WithTooltip>{location?.repository}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Tag" hidden={!location?.tag}>
            <WithTooltip>{location?.tag}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="VolumeSnapshotClass" hidden={!location?.volumeSnapshotClassName}>
            <WithTooltip>{location?.volumeSnapshotClassName}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Credentials Secret" hidden={!location?.repository}>
            <WithTooltip>{location?.credentialsSecretName || "None: anonymous"}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Signing Key Secret" hidden={!location?.repository}>
            <WithTooltip>{location?.signingKeySecretName || "None: unsigned"}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Insecure" hidden={!location?.insecure}>
            <WithTooltip>Yes: a plaintext (http) registry</WithTooltip>
          </DrawerItem>
          <DrawerItem name="CA Bundle" hidden={!location?.caBundle}>
            <WithTooltip>Recorded at resolution</WithTooltip>
          </DrawerItem>
        </>
      ) : null}

      <DrawerTitle>Capture</DrawerTitle>
      <DrawerItem name="Capture Started" hidden={!status?.captureStartedAt}>
        {status?.captureStartedAt ? <LocaleDate date={status.captureStartedAt} /> : null}
      </DrawerItem>
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
          <DrawerItem name="Primary IP" hidden={!guestSpec.primaryIP}>
            <WithTooltip>{guestSpec.primaryIP}</WithTooltip>
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
});

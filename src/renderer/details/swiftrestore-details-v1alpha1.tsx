import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftRestore } from "../api/kubeswift/swiftrestore-v1alpha1";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
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
    LocaleDate,
    WithTooltip,
  },
  K8sApi: { nodesStore },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftRestoreDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftRestore> {
  extension: Renderer.LensExtension;
}

export const SwiftRestoreDetails = observer((props: SwiftRestoreDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const regenerated = SwiftRestore.getRegeneratedIdentity(object);
    const snapshotRef = SwiftRestore.getSnapshotRef(object);
    const targetGuestRef = SwiftRestore.getTargetGuestRef(object);
    const restoredGuestRef = SwiftRestore.getRestoredGuestRef(object);

    // None of these three refs are guaranteed to resolve: the snapshot can
    // have been deleted, a "Clone" restore's target guest legitimately does
    // not exist yet (the restore is what creates it), and even a completed
    // restore's guest could since have been removed. LinkToObject only
    // formats a details URL from the ref, it never checks the target exists
    // (DESIGN.md section 3, issue #23).
    const snapshotStore = maybe(() => SwiftSnapshot.getStore<SwiftSnapshot>());
    const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

    // `spec.targetNode` (s3 backend restores only) shares the same dead-link
    // risk: `LinkToNode` never checks the target exists either (issue #23).
    //
    // Both CRD stores are asked for the namespaces these references live in
    // (the refs' own, plus this restore's, since a ref may carry none) rather
    // than for whatever the namespace filter holds; `nodesStore` is
    // cluster-scoped (issue #38).
    useReferenceStores([
      {
        label: SwiftSnapshot.crd.plural,
        store: snapshotStore,
        namespaces: [snapshotRef?.namespace ?? object.getNs()],
        lookups: [{ name: snapshotRef?.name, namespace: snapshotRef?.namespace }],
      },
      {
        label: SwiftGuest.crd.plural,
        store: guestStore,
        namespaces: [targetGuestRef?.namespace, restoredGuestRef?.namespace, object.getNs()],
        lookups: [
          { name: targetGuestRef?.name, namespace: targetGuestRef?.namespace },
          { name: restoredGuestRef?.name, namespace: restoredGuestRef?.namespace },
        ],
      },
      { label: "nodes", store: nodesStore, lookups: [{ name: spec?.targetNode }] },
    ]);

    const snapshotIsLinkable = objectExists(snapshotStore, snapshotRef?.name, snapshotRef?.namespace);
    const targetGuestIsLinkable = objectExists(guestStore, targetGuestRef?.name, targetGuestRef?.namespace);
    const restoredGuestIsLinkable = objectExists(guestStore, restoredGuestRef?.name, restoredGuestRef?.namespace);
    const targetNodeIsLinkable = objectExists(nodesStore, spec?.targetNode);

    return (
      <>
        <DrawerTitle>Restore</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftRestore.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Snapshot">
          {snapshotRef && snapshotIsLinkable ? (
            <LinkToObject objectRef={snapshotRef} object={object} />
          ) : (
            <WithTooltip>{snapshotRef?.name ?? notAvailable}</WithTooltip>
          )}
        </DrawerItem>

        <DrawerTitle>Target</DrawerTitle>
        <DrawerItem name="Guest">
          {targetGuestRef && targetGuestIsLinkable ? (
            <LinkToObject objectRef={targetGuestRef} object={object} />
          ) : (
            <WithTooltip>{targetGuestRef?.name ?? notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        {/* `overwriteExisting` is what the schema uses to tell a restore over an
            existing guest from one that creates a new guest from the snapshot. */}
        <DrawerItem name="Mode">
          <WithTooltip>{SwiftRestore.getTargetMode(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Restored Guest" hidden={!restoredGuestRef}>
          {restoredGuestRef ? (
            restoredGuestIsLinkable ? (
              <LinkToObject objectRef={restoredGuestRef} object={object} />
            ) : (
              <WithTooltip>{restoredGuestRef.name}</WithTooltip>
            )
          ) : null}
        </DrawerItem>
        <DrawerItem name="Target Node" hidden={!spec?.targetNode}>
          {targetNodeIsLinkable ? (
            <LinkToNode name={spec?.targetNode} />
          ) : (
            <WithTooltip>{spec?.targetNode}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Memory Restore Mode">
          <WithTooltip>{SwiftRestore.getMemoryRestoreMode(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Resume After Restore">
          <WithTooltip>{String(SwiftRestore.getResumeAfterRestore(object))}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Regenerate Identity" hidden={regenerated.length === 0} labelsOnly>
          {regenerated.map((item) => (
            <Badge key={item} label={item} />
          ))}
        </DrawerItem>

        <DrawerTitle>Progress</DrawerTitle>
        <DrawerItem name="Started At" hidden={!status?.startedAt}>
          {status?.startedAt ? <LocaleDate date={status.startedAt} /> : null}
        </DrawerItem>
        <DrawerItem name="Completed At" hidden={!status?.completedAt}>
          {status?.completedAt ? <LocaleDate date={status.completedAt} /> : null}
        </DrawerItem>
        <DrawerItem name="Downloaded" hidden={status?.downloadedBytes === undefined}>
          <WithTooltip>{SwiftRestore.getDownloadedSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

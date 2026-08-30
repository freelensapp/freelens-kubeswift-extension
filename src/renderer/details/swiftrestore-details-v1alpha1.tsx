import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftRestore } from "../api/kubeswift/swiftrestore-v1alpha1";
import { SwiftSnapshot } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import { restoreDeleteRow } from "../components/restore-create";

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

    // What deleting THIS restore destroys, computed from its own mode rather
    // than stated in the abstract (SPEC-0011, the SPEC-0010 On Delete
    // precedent). The host owns the Delete confirmation and gives an extension
    // no hook to add a per-kind consequence to it, so the extension says it
    // where it does own the surface, and permanently.
    //
    // The guest a clone restore created is a CHILD of this object - the
    // controller sets a controller ownerReference on it - so deleting this
    // object garbage-collects the guest, and on the csi path its restored root
    // PVC too. Upstream documents this nowhere, which is exactly why it is here.
    // The snapshot's backend is read from the store the drawer already loads
    // above; when it has not answered, the row says so rather than guessing.
    const restoredSnapshot = snapshotRef?.name
      ? snapshotStore?.getByName(snapshotRef.name, snapshotRef.namespace ?? object.getNs())
      : undefined;
    const deleteRow = restoreDeleteRow({
      mode: SwiftRestore.getTargetMode(object),
      guestName: restoredGuestRef?.name ?? targetGuestRef?.name,
      snapshotBackend: restoredSnapshot ? SwiftSnapshot.getBackendType(restoredSnapshot) : undefined,
    });
    const deletedGuestRef = deleteRow.deletedGuest ? (restoredGuestRef ?? targetGuestRef) : undefined;
    const deletedGuestIsLinkable = deleteRow.deletedGuest
      ? objectExists(guestStore, deleteRow.deletedGuest, deletedGuestRef?.namespace)
      : false;

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
        {/* The sharpest fact this CRD carries and the one nobody can guess: a
            clone restore OWNS the guest it created, so deleting this object
            deletes that guest with it. The guest is rendered as a link, the way
            the rows above render theirs, and the sentences read as its
            predicate; an in-place restore owns nothing and says so instead. */}
        <DrawerItem name="On Delete">
          {deleteRow.deletedGuest ? (
            <>
              {deletedGuestRef && deletedGuestIsLinkable ? (
                <LinkToObject objectRef={deletedGuestRef} object={object} />
              ) : (
                <WithTooltip>{deleteRow.deletedGuest}</WithTooltip>
              )}{" "}
              <WithTooltip>{deleteRow.sentences.join(" ")}</WithTooltip>
            </>
          ) : (
            <WithTooltip>{deleteRow.sentences.join(" ")}</WithTooltip>
          )}
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

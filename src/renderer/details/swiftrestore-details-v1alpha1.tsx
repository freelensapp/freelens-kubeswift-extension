import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftRestore } from "../api/kubeswift/swiftrestore-v1alpha1";
import { withErrorPage } from "../components/error-page";

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

    return (
      <>
        <DrawerTitle>Restore</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftRestore.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Snapshot">
          {snapshotRef ? (
            <LinkToObject objectRef={snapshotRef} object={object} />
          ) : (
            <WithTooltip>{notAvailable}</WithTooltip>
          )}
        </DrawerItem>

        <DrawerTitle>Target</DrawerTitle>
        <DrawerItem name="Guest">
          {targetGuestRef ? (
            <LinkToObject objectRef={targetGuestRef} object={object} />
          ) : (
            <WithTooltip>{notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        {/* `overwriteExisting` is what the schema uses to tell a restore over an
            existing guest from one that creates a new guest from the snapshot. */}
        <DrawerItem name="Mode">
          <WithTooltip>{SwiftRestore.getTargetMode(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Restored Guest" hidden={!restoredGuestRef}>
          {restoredGuestRef ? <LinkToObject objectRef={restoredGuestRef} object={object} /> : null}
        </DrawerItem>
        <DrawerItem name="Target Node" hidden={!spec?.targetNode}>
          <LinkToNode name={spec?.targetNode} />
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

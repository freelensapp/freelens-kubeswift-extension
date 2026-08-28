import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import React from "react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftMigration } from "../api/kubeswift/swiftmigration-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { ensureLoaded, objectExists } from "../components/object-existence";

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

export interface SwiftMigrationDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftMigration> {
  extension: Renderer.LensExtension;
}

export const SwiftMigrationDetails = observer((props: SwiftMigrationDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const mode = SwiftMigration.getMode(object);
    const requestedMode = SwiftMigration.getRequestedMode(object);
    const failure = SwiftMigration.getFailure(object);
    const nodeSelector = Object.entries(spec?.target?.nodeSelector ?? {});
    const guestRef = SwiftMigration.getGuestRef(object);
    const sourceNode = SwiftMigration.getSourceNode(object);
    const destinationNode = SwiftMigration.getDestinationNode(object);
    const sourcePodName = status?.sourcePodRef?.name;
    const destinationPodName = status?.destinationPodRef?.name;

    // The migrated guest, the source/destination nodes and the launcher pods
    // on each end are none of them guaranteed to still exist: a migration's
    // source node in particular may legitimately be gone by the time anyone
    // looks at a finished migration. LinkToObject/LinkToNode/LinkToPod only
    // format a details URL from the ref/name, they never check the target
    // exists (DESIGN.md section 3, issue #23).
    const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

    React.useEffect(() => {
      ensureLoaded(guestStore);
      ensureLoaded(nodesStore);
      ensureLoaded(podsStore);
    }, []);

    const guestIsLinkable = objectExists(guestStore, guestRef?.name, guestRef?.namespace);
    const sourceNodeIsLinkable = objectExists(nodesStore, sourceNode);
    const destinationNodeIsLinkable = objectExists(nodesStore, destinationNode);
    const sourcePodIsLinkable = objectExists(podsStore, sourcePodName, object.getNs());
    const destinationPodIsLinkable = objectExists(podsStore, destinationPodName, object.getNs());

    return (
      <>
        <DrawerTitle>Migration</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftMigration.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Phase Detail" hidden={!status?.phaseDetail}>
          <WithTooltip>{status?.phaseDetail}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Guest">
          {guestRef && guestIsLinkable ? (
            <LinkToObject objectRef={guestRef} object={object} />
          ) : (
            <WithTooltip>{guestRef?.name ?? notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        {/* The controller resolves `auto`, so the mode in force can differ from
            the one the spec asked for. Both are shown when they disagree. */}
        <DrawerItem name="Mode">
          <WithTooltip>{mode === requestedMode ? mode : `${mode} (requested: ${requestedMode})`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Progress" hidden={SwiftMigration.getTransferProgress(object) === undefined}>
          <WithTooltip>{SwiftMigration.getProgressLabel(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Reason" hidden={!spec?.reason}>
          <WithTooltip>{spec?.reason}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Placement</DrawerTitle>
        <DrawerItem name="From" hidden={!sourceNode}>
          {sourceNodeIsLinkable ? <LinkToNode name={sourceNode} /> : <WithTooltip>{sourceNode}</WithTooltip>}
        </DrawerItem>
        <DrawerItem name="To">
          {destinationNode ? (
            destinationNodeIsLinkable ? (
              <LinkToNode name={destinationNode} />
            ) : (
              <WithTooltip>{destinationNode}</WithTooltip>
            )
          ) : (
            <WithTooltip>{notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Node Selector" hidden={nodeSelector.length === 0} labelsOnly>
          {nodeSelector.map(([key, value]) => (
            <Badge key={key} label={`${key}: ${value}`} />
          ))}
        </DrawerItem>
        <DrawerItem name="Source Pod" hidden={!sourcePodName}>
          {sourcePodIsLinkable ? (
            <LinkToPod name={sourcePodName} namespace={object.getNs()} />
          ) : (
            <WithTooltip>{sourcePodName}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Destination Pod" hidden={!destinationPodName}>
          {destinationPodIsLinkable ? (
            <LinkToPod name={destinationPodName} namespace={object.getNs()} />
          ) : (
            <WithTooltip>{destinationPodName}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Target IP" hidden={!status?.targetIP}>
          <WithTooltip>{status?.targetIP}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Allow IP Change" hidden={spec?.allowIPChange === undefined}>
          <WithTooltip>{String(spec?.allowIPChange)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Timings</DrawerTitle>
        <DrawerItem name="Started At" hidden={!status?.startedAt}>
          {status?.startedAt ? <LocaleDate date={status.startedAt} /> : null}
        </DrawerItem>
        <DrawerItem name="Completed At" hidden={!status?.completedAt}>
          {status?.completedAt ? <LocaleDate date={status.completedAt} /> : null}
        </DrawerItem>
        {/* The schema is explicit that this is the cutover-orchestration
            window, not the guest's own stopped-the-world time. */}
        <DrawerItem name="Observed Downtime" hidden={!status?.observedDowntime}>
          <WithTooltip>{status?.observedDowntime}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Transfer Duration" hidden={!status?.observedTransferDuration}>
          <WithTooltip>{status?.observedTransferDuration}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Downtime Target" hidden={!spec?.downtimeTarget}>
          <WithTooltip>{spec?.downtimeTarget}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Applied Downtime" hidden={status?.appliedDowntimeMs === undefined}>
          <WithTooltip>{`${status?.appliedDowntimeMs} ms`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Timeout">
          <WithTooltip>{`${SwiftMigration.getTimeout(object)} (${SwiftMigration.getTimeoutStrategy(object)})`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="TTL" hidden={!spec?.ttl}>
          <WithTooltip>{spec?.ttl}</WithTooltip>
        </DrawerItem>

        {failure ? (
          <>
            <DrawerTitle>Failure</DrawerTitle>
            <DrawerItem name="Reason">
              <WithTooltip>{failure.reason ?? notAvailable}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Message" hidden={!failure.message}>
              <WithTooltip>{failure.message}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

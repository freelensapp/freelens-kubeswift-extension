import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftMigration } from "../api/kubeswift/swiftmigration-v1alpha1";
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
    LinkToPod,
    LocaleDate,
    WithTooltip,
  },
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
          {guestRef ? <LinkToObject objectRef={guestRef} object={object} /> : <WithTooltip>{notAvailable}</WithTooltip>}
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
        <DrawerItem name="From" hidden={!SwiftMigration.getSourceNode(object)}>
          <LinkToNode name={SwiftMigration.getSourceNode(object)} />
        </DrawerItem>
        <DrawerItem name="To">
          {SwiftMigration.getDestinationNode(object) ? (
            <LinkToNode name={SwiftMigration.getDestinationNode(object)} />
          ) : (
            <WithTooltip>{notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Node Selector" hidden={nodeSelector.length === 0} labelsOnly>
          {nodeSelector.map(([key, value]) => (
            <Badge key={key} label={`${key}: ${value}`} />
          ))}
        </DrawerItem>
        <DrawerItem name="Source Pod" hidden={!status?.sourcePodRef?.name}>
          <LinkToPod name={status?.sourcePodRef?.name} namespace={object.getNs()} />
        </DrawerItem>
        <DrawerItem name="Destination Pod" hidden={!status?.destinationPodRef?.name}>
          <LinkToPod name={status?.destinationPodRef?.name} namespace={object.getNs()} />
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

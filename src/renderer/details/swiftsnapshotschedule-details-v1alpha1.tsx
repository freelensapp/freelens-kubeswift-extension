import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSnapshotSchedule } from "../api/kubeswift/swiftsnapshotschedule-v1alpha1";
import { withErrorPage } from "../components/error-page";

const { observer } = MobxReact;

const {
  Component: { Badge, DrawerItem, DrawerTitle, KubeObjectConditionsDrawer, LinkToObject, LocaleDate, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftSnapshotScheduleDetailsProps
  extends Renderer.Component.KubeObjectDetailsProps<SwiftSnapshotSchedule> {
  extension: Renderer.LensExtension;
}

export const SwiftSnapshotScheduleDetails = observer((props: SwiftSnapshotScheduleDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const templateSpec = SwiftSnapshotSchedule.getSnapshotTemplateSpec(object);
    const guestRef = SwiftSnapshotSchedule.getGuestRef(object);
    const templateLabels = Object.entries(spec?.template?.metadata?.labels ?? {});
    const active = SwiftSnapshotSchedule.getActiveSnapshots(object);
    const lastScheduleTime = SwiftSnapshotSchedule.getLastScheduleTime(object);
    const lastSuccessfulTime = SwiftSnapshotSchedule.getLastSuccessfulTime(object);

    return (
      <>
        <DrawerTitle>Schedule</DrawerTitle>
        <DrawerItem name="Cron">
          <WithTooltip>{SwiftSnapshotSchedule.getSchedule(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Suspended">
          <WithTooltip>{String(SwiftSnapshotSchedule.isSuspended(object))}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Concurrency Policy">
          <WithTooltip>{SwiftSnapshotSchedule.getConcurrencyPolicy(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Starting Deadline" hidden={spec?.startingDeadlineSeconds === undefined}>
          <WithTooltip>{`${spec?.startingDeadlineSeconds}s`}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Retention</DrawerTitle>
        {/* Unset keepLast keeps every Ready snapshot and leaves retention to
            each snapshot's own ttl. */}
        <DrawerItem name="Keep Last">
          <WithTooltip>{SwiftSnapshotSchedule.getKeepLast(object) ?? "All"}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Snapshot TTL" hidden={!templateSpec?.ttl}>
          <WithTooltip>{templateSpec?.ttl}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Snapshot Template</DrawerTitle>
        <DrawerItem name="Guest">
          {guestRef ? <LinkToObject objectRef={guestRef} object={object} /> : <WithTooltip>{notAvailable}</WithTooltip>}
        </DrawerItem>
        <DrawerItem name="Backend">
          <WithTooltip>{templateSpec?.backend?.type ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Deletion Policy">
          <WithTooltip>{templateSpec?.deletionPolicy ?? "Delete"}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Include Memory">
          <WithTooltip>{String(templateSpec?.includeMemory ?? true)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Include Disk" hidden={templateSpec?.includeDisk === undefined}>
          <WithTooltip>{String(templateSpec?.includeDisk)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Labels" hidden={templateLabels.length === 0} labelsOnly>
          {templateLabels.map(([key, value]) => (
            <Badge key={key} label={`${key}: ${value}`} />
          ))}
        </DrawerItem>

        <DrawerTitle>Runs</DrawerTitle>
        <DrawerItem name="Last Schedule" hidden={!lastScheduleTime}>
          {lastScheduleTime ? <LocaleDate date={lastScheduleTime} /> : null}
        </DrawerItem>
        <DrawerItem name="Last Successful" hidden={!lastSuccessfulTime}>
          {lastSuccessfulTime ? <LocaleDate date={lastSuccessfulTime} /> : null}
        </DrawerItem>
        <DrawerItem name="Active" hidden={active.length === 0} labelsOnly>
          {active.map((name) => (
            <Badge key={name} label={name} />
          ))}
        </DrawerItem>

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

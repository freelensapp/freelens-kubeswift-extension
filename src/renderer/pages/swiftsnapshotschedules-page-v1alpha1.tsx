import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSnapshotSchedule, type SwiftSnapshotScheduleApi } from "../api/kubeswift/swiftsnapshotschedule-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftsnapshotschedules-page.module.scss";
import stylesInline from "./swiftsnapshotschedules-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, LocaleDate, WithTooltip },
} = Renderer;

const KubeObject = SwiftSnapshotSchedule;
type KubeObject = SwiftSnapshotSchedule;
type KubeObjectApi = SwiftSnapshotScheduleApi;

const notAvailable = "N/A";

// An unset keepLast keeps every Ready snapshot, so it sorts after every
// schedule that does have a budget.
const keepLastOrAll = (object: KubeObject) => KubeObject.getKeepLast(object) ?? Number.MAX_SAFE_INTEGER;

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  schedule: (object: KubeObject) => KubeObject.getSchedule(object),
  guest: (object: KubeObject) => KubeObject.getGuestName(object),
  keep: keepLastOrAll,
  suspended: (object: KubeObject) => String(KubeObject.isSuspended(object)),
  lastSchedule: (object: KubeObject) => KubeObject.getLastScheduleTime(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// Schedule, suspend, guest and the last tick are the columns the CRD publishes
// as printer columns, so the list reads like `kubectl get
// swiftsnapshotschedules`; Keep is the retention budget that governs them.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Schedule", sortBy: "schedule" },
  { title: "Guest", sortBy: "guest" },
  { title: "Keep", sortBy: "keep", className: styles.keep },
  { title: "Suspended", sortBy: "suspended", className: styles.suspended },
  { title: "Last Schedule", sortBy: "lastSchedule", className: styles.lastSchedule },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftSnapshotSchedulesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftSnapshotSchedulesPage = observer((props: SwiftSnapshotSchedulesPageProps) =>
  withErrorPage(props, () => {
    const store = KubeObject.getStore<KubeObject>();

    return (
      <>
        <style>{stylesInline}</style>
        <KubeObjectListLayout<KubeObject, KubeObjectApi>
          tableId={`${KubeObject.crd.plural}Table`}
          className={styles.page}
          store={store}
          sortingCallbacks={sortingCallbacks}
          searchFilters={[(object: KubeObject) => object.getSearchFields()]}
          renderHeaderTitle={KubeObject.crd.title}
          renderTableHeader={renderTableHeader}
          renderTableContents={(object: KubeObject) => {
            const lastScheduleTime = KubeObject.getLastScheduleTime(object);

            return [
              <WithTooltip>{object.getName()}</WithTooltip>,
              <LinkToNamespace namespace={object.getNs()} />,
              <WithTooltip>{KubeObject.getSchedule(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip>{KubeObject.getGuestName(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip>{KubeObject.getKeepLast(object) ?? "All"}</WithTooltip>,
              <WithTooltip>{String(KubeObject.isSuspended(object))}</WithTooltip>,
              lastScheduleTime ? <LocaleDate date={lastScheduleTime} /> : <WithTooltip>{notAvailable}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

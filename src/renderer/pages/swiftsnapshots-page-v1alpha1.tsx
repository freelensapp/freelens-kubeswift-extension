import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSnapshot, type SwiftSnapshotApi } from "../api/kubeswift/swiftsnapshot-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftsnapshots-page.module.scss";
import stylesInline from "./swiftsnapshots-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftSnapshot;
type KubeObject = SwiftSnapshot;
type KubeObjectApi = SwiftSnapshotApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  guest: (object: KubeObject) => KubeObject.getGuestName(object),
  backend: (object: KubeObject) => KubeObject.getBackendType(object),
  contents: (object: KubeObject) => KubeObject.getContents(object),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  size: (object: KubeObject) => object.status?.totalSizeBytes ?? 0,
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// Guest, backend, phase and size are the columns the CRD publishes as printer
// columns, so the list reads like `kubectl get swiftsnapshots`. Contents is
// derived from the backend, which is what decides whether memory was captured.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Guest", sortBy: "guest", id: "guest" },
  { title: "Backend", sortBy: "backend", id: "backend", className: styles.backend },
  { title: "Contents", sortBy: "contents", id: "contents", className: styles.contents },
  { title: "Phase", sortBy: "phase", id: "phase", className: styles.phase },
  { title: "Size", sortBy: "size", id: "size", className: styles.size },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftSnapshotsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftSnapshotsPage = observer((props: SwiftSnapshotsPageProps) =>
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
          renderTableContents={(object: KubeObject) => [
            <WithTooltip>{object.getName()}</WithTooltip>,
            <LinkToNamespace namespace={object.getNs()} />,
            <WithTooltip>{KubeObject.getGuestName(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getBackendType(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getContents(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getPhase(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getTotalSize(object) ?? notAvailable}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

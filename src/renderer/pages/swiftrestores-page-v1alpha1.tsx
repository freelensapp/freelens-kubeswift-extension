import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftRestore, type SwiftRestoreApi } from "../api/kubeswift/swiftrestore-v1alpha1";
import styles from "./swiftrestores-page.module.scss";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftRestore;
type KubeObject = SwiftRestore;
type KubeObjectApi = SwiftRestoreApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  snapshot: (object: KubeObject) => KubeObject.getSnapshotName(object),
  target: (object: KubeObject) => KubeObject.getTargetGuestName(object),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The columns the CRD publishes as printer columns, so the list reads like
// `kubectl get swiftrestores`.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Snapshot", sortBy: "snapshot", id: "snapshot" },
  { title: "Target", sortBy: "target", id: "target" },
  { title: "Phase", sortBy: "phase", id: "phase", className: styles.phase },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftRestoresPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftRestoresPage = observer((props: SwiftRestoresPageProps) => {
  const store = KubeObject.getStore<KubeObject>();

  return (
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
        <WithTooltip>{KubeObject.getSnapshotName(object) ?? notAvailable}</WithTooltip>,
        <WithTooltip>{KubeObject.getTargetGuestName(object) ?? notAvailable}</WithTooltip>,
        <WithTooltip>{KubeObject.getPhase(object) ?? notAvailable}</WithTooltip>,
        <KubeObjectAge object={object} key="age" />,
      ]}
    />
  );
});

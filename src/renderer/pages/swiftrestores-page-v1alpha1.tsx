import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftRestore, type SwiftRestoreApi } from "../api/kubeswift/swiftrestore-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftrestores-page.module.scss";
import stylesInline from "./swiftrestores-page.module.scss?inline";

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
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Snapshot", sortBy: "snapshot" },
  { title: "Target", sortBy: "target" },
  { title: "Phase", sortBy: "phase", className: styles.phase },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftRestoresPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftRestoresPage = observer((props: SwiftRestoresPageProps) =>
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
            <WithTooltip>{KubeObject.getSnapshotName(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getTargetGuestName(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getPhase(object) ?? notAvailable}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

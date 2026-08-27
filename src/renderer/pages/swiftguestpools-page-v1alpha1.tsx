import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuestPool, type SwiftGuestPoolApi } from "../api/kubeswift/swiftguestpool-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftguestpools-page.module.scss";
import stylesInline from "./swiftguestpools-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftGuestPool;
type KubeObject = SwiftGuestPool;
type KubeObjectApi = SwiftGuestPoolApi;

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  desired: (object: KubeObject) => KubeObject.getDesiredReplicas(object),
  ready: (object: KubeObject) => KubeObject.getReadyReplicas(object),
  updated: (object: KubeObject) => KubeObject.getUpdatedReplicas(object),
  available: (object: KubeObject) => KubeObject.getAvailableReplicas(object),
  failed: (object: KubeObject) => KubeObject.getFailedReplicas(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The replica columns are the ones the CRD publishes as printer columns, so the
// list reads like `kubectl get swiftguestpools`.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Desired", sortBy: "desired", className: styles.desired },
  { title: "Ready", sortBy: "ready", className: styles.ready },
  { title: "Updated", sortBy: "updated", className: styles.updated },
  { title: "Available", sortBy: "available", className: styles.available },
  { title: "Failed", sortBy: "failed", className: styles.failed },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftGuestPoolsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftGuestPoolsPage = observer((props: SwiftGuestPoolsPageProps) =>
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
            <WithTooltip>{KubeObject.getDesiredReplicas(object)}</WithTooltip>,
            <WithTooltip>{KubeObject.getReadyReplicas(object)}</WithTooltip>,
            <WithTooltip>{KubeObject.getUpdatedReplicas(object)}</WithTooltip>,
            <WithTooltip>{KubeObject.getAvailableReplicas(object)}</WithTooltip>,
            <WithTooltip>{KubeObject.getFailedReplicas(object)}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

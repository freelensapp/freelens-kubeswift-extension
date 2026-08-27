import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuest, type SwiftGuestApi } from "../api/kubeswift/swiftguest-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftguests-page.module.scss";
import stylesInline from "./swiftguests-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, LinkToNode, WithTooltip },
} = Renderer;

const KubeObject = SwiftGuest;
type KubeObject = SwiftGuest;
type KubeObjectApi = SwiftGuestApi;

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  node: (object: KubeObject) => KubeObject.getNodeName(object),
  ip: (object: KubeObject) => KubeObject.getPrimaryIP(object),
  restarts: (object: KubeObject) => KubeObject.getRestartCount(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Phase", sortBy: "phase", className: styles.phase },
  { title: "Node", sortBy: "node", className: styles.node },
  { title: "IP", sortBy: "ip", className: styles.ip },
  { title: "Restarts", sortBy: "restarts", className: styles.restarts },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftGuestsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftGuestsPage = observer((props: SwiftGuestsPageProps) =>
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
            <WithTooltip>{KubeObject.getPhase(object) ?? "N/A"}</WithTooltip>,
            <LinkToNode name={KubeObject.getNodeName(object)} />,
            <WithTooltip>{KubeObject.getPrimaryIP(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{KubeObject.getRestartCount(object)}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

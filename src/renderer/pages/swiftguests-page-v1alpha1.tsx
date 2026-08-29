import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuest, type SwiftGuestApi } from "../api/kubeswift/swiftguest-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { classifyGuest, guestMessage } from "../components/guest-status";
import styles from "./swiftguests-page.module.scss";
import stylesInline from "./swiftguests-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, LinkToNode, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftGuest;
type KubeObject = SwiftGuest;
type KubeObjectApi = SwiftGuestApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  node: (object: KubeObject) => KubeObject.getNodeName(object),
  ip: (object: KubeObject) => KubeObject.getPrimaryIP(object),
  restarts: (object: KubeObject) => KubeObject.getRestartCount(object),
  condition: (object: KubeObject) => classifyGuest(object.spec, object.status).state,
  status: (object: KubeObject) => guestMessage(object.spec, object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The plain `Phase` column is gone, exactly as SPEC-0007 dropped a raw column
// the classifier says better and SPEC-0009 dropped `Ready`: the Condition badge
// carries the same information plus the derived `Stopping` state, which is the
// one reading `status.phase` cannot express, and the Status column carries the
// controller's own words. The host's generic printer-column block still shows
// `Phase` in the drawer, and that duplication stays accepted (DESIGN.md
// section 3).
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Node", sortBy: "node", id: "node", className: styles.node },
  { title: "IP", sortBy: "ip", id: "ip", className: styles.ip },
  { title: "Restarts", sortBy: "restarts", id: "restarts", className: styles.restarts },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
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
          renderTableContents={(object: KubeObject) => {
            const condition = classifyGuest(object.spec, object.status);

            return [
              <WithTooltip key="name">{object.getName()}</WithTooltip>,
              <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
              <LinkToNode key="node" name={KubeObject.getNodeName(object)} />,
              <WithTooltip key="ip">{KubeObject.getPrimaryIP(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip key="restarts">{KubeObject.getRestartCount(object)}</WithTooltip>,
              // The badge carries the derived state, so a guest whose stop has
              // been written but not yet reconciled reads `Stopping` here rather
              // than the `Running` the API still reports (SPEC-0010, B12).
              <Badge key="condition" className={condition.className} label={condition.state} />,
              <WithTooltip key="status">{guestMessage(object.spec, object.status)}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

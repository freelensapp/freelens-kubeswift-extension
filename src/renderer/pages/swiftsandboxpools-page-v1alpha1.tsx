import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSandboxPool, type SwiftSandboxPoolApi } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { createSandboxPoolTitle } from "../components/sandbox-create";
import { openCreateSandboxPoolDialog } from "../components/sandbox-pool-create-dialog";
import { classifySandboxPool, sandboxPoolMessage } from "../components/sandbox-status";
import styles from "./swiftsandboxpools-page.module.scss";
import stylesInline from "./swiftsandboxpools-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftSandboxPool;
type KubeObject = SwiftSandboxPool;
type KubeObjectApi = SwiftSandboxPoolApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  image: (object: KubeObject) => KubeObject.getImage(object),
  minWarm: (object: KubeObject) => KubeObject.getMinWarm(object),
  warm: (object: KubeObject) => KubeObject.getWarmReplicas(object),
  claimed: (object: KubeObject) => KubeObject.getClaimedReplicas(object),
  condition: (object: KubeObject) => classifySandboxPool(object.status).state,
  status: (object: KubeObject) => sandboxPoolMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The domain columns are the CRD's printer columns minus Phase, in the CRD's
// own order, so the list reads like `kubectl get sboxpool`; the Condition and
// Status pair says the phase better, and the host's printer-column block shows
// the raw value above our sections anyway (the SPEC-0007 rule, unchanged).
//
// Upstream's generic Explorer projects this table differently (it drops Image
// and reorders to Phase / Warm / Claimed / Min). The divergence is deliberate:
// desired, then actual, then in use is the reading order an operator checking a
// pool wants, and the gap between the first two columns *is* the health of the
// pool, which is what putting them side by side makes scannable (SPEC-0008).
//
// `maxWarm` is deliberately not here. It is a cap that matters when sizing a
// pool, not when scanning a list, and it would push the two counts that matter
// apart. It has a row in the drawer.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Image", sortBy: "image", id: "image", className: styles.image },
  { title: "Min Warm", sortBy: "minWarm", id: "minWarm", className: styles.minWarm },
  { title: "Warm", sortBy: "warm", id: "warm", className: styles.warm },
  { title: "Claimed", sortBy: "claimed", id: "claimed", className: styles.claimed },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftSandboxPoolsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftSandboxPoolsPage = observer((props: SwiftSandboxPoolsPageProps) =>
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
          // The host's own floating create affordance, the idiom SPEC-0013
          // established and six pages already carry: never a custom control
          // where a native one exists (DESIGN.md pillar 1). The stylesheet's
          // clearance rule goes with it.
          addRemoveButtons={{ onAdd: openCreateSandboxPoolDialog, addTooltip: createSandboxPoolTitle }}
          renderTableHeader={renderTableHeader}
          renderTableContents={(object: KubeObject) => {
            const condition = classifySandboxPool(object.status);

            return [
              <WithTooltip key="name">{object.getName()}</WithTooltip>,
              <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
              // Digests are long, so the cell truncates and the tooltip carries
              // the whole reference.
              <WithTooltip key="image">{KubeObject.getImage(object) ?? notAvailable}</WithTooltip>,
              // The desired count, then the actual one, then the in-use one.
              // `0` is a fact in all three and is kept as such.
              <WithTooltip key="minWarm">{KubeObject.getMinWarm(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip key="warm">{KubeObject.getWarmReplicas(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip key="claimed">{KubeObject.getClaimedReplicas(object) ?? notAvailable}</WithTooltip>,
              <Badge key="condition" className={condition.className} label={condition.state} />,
              <WithTooltip key="status">{sandboxPoolMessage(object.status)}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

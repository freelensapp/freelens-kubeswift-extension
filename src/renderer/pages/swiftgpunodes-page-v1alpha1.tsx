import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGPUNode, type SwiftGPUNodeApi } from "../api/kubeswift/swiftgpunode-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { classifyGpuNode } from "../components/gpu-status";
import styles from "./swiftgpunodes-page.module.scss";
import stylesInline from "./swiftgpunodes-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { Badge, BadgeBoolean, getBooleanText, KubeObjectAge, KubeObjectListLayout, LocaleDate, WithTooltip },
} = Renderer;

const KubeObject = SwiftGPUNode;
type KubeObject = SwiftGPUNode;
type KubeObjectApi = SwiftGPUNodeApi;

const notAvailable = "N/A";

// GPU nodes are cluster-scoped, so the list has no Namespace column.
const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  gpus: (object: KubeObject) => KubeObject.getGpuCount(object),
  free: (object: KubeObject) => KubeObject.getFreeGPUs(object),
  model: (object: KubeObject) => KubeObject.getGpuModel(object),
  // Sorted on the same text the `BadgeBoolean` cell shows, so the order the
  // user sees matches the column (a sort callback may not return a boolean).
  vfio: (object: KubeObject) => getBooleanText(KubeObject.getVfioReady(object)),
  condition: (object: KubeObject) => classifyGpuNode(object.status).state,
  status: (object: KubeObject) => classifyGpuNode(object.status).explanation,
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The first four domain columns are the CRD's own printer columns minus Phase,
// which the Condition/Status pair below says better (the raw phase is still in
// the drawer, where `kubectl`'s own value belongs). `vfioReady` appears twice on
// purpose: as its own boolean column, because it is the single most decisive
// fact about a GPU node, and folded into the Condition verdict, because a node
// that is Ready without VFIO must not read as healthy at a glance (SPEC-0007).
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "GPUs", sortBy: "gpus", id: "gpus", className: styles.gpus },
  { title: "Free", sortBy: "free", id: "free", className: styles.free },
  { title: "Model", sortBy: "model", id: "model", className: styles.model },
  { title: "VFIO", sortBy: "vfio", id: "vfio", className: styles.vfio },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftGPUNodesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftGPUNodesPage = observer((props: SwiftGPUNodesPageProps) =>
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
            const condition = classifyGpuNode(object.status);

            return [
              // The name of a SwiftGPUNode is the name of the node it
              // describes. The drawer turns it into a Node link; here the row
              // click opens the drawer (DESIGN.md section 1).
              <WithTooltip key="name">{object.getName()}</WithTooltip>,
              <WithTooltip key="gpus">{KubeObject.getGpuCount(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip key="free">{KubeObject.getFreeGPUs(object) ?? notAvailable}</WithTooltip>,
              <WithTooltip key="model">{KubeObject.getGpuModel(object) ?? notAvailable}</WithTooltip>,
              <BadgeBoolean key="vfio" value={KubeObject.getVfioReady(object)} />,
              <Badge key="condition" className={condition.className} label={condition.state} />,
              // The generated explanation of the same state: the CRD has no
              // conditions and no message field, so there is no raw message to
              // show here (declared deviation, SPEC-0007). A timestamp the
              // explanation ends on is rendered by `LocaleDate` rather than
              // formatted inside the classifier.
              <WithTooltip key="status">
                {condition.explanation}
                {condition.lastDiscovery ? (
                  <>
                    {" "}
                    <LocaleDate date={condition.lastDiscovery} />
                  </>
                ) : null}
              </WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

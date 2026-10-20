import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  SwiftArtifactPlacement,
  type SwiftArtifactPlacementApi,
} from "../api/kubeswift/swiftartifactplacement-v1alpha1";
import { artifactPlacementMessage, classifyArtifactPlacement } from "../components/artifact-status";
import styles from "./swiftartifactplacements-page.module.scss";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftArtifactPlacement;
type KubeObject = SwiftArtifactPlacement;
type KubeObjectApi = SwiftArtifactPlacementApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  pool: (object: KubeObject) => KubeObject.getPoolName(object),
  prepared: (object: KubeObject) => KubeObject.getPreparedNodes(object),
  nodes: (object: KubeObject) => KubeObject.getTargetNodes(object),
  condition: (object: KubeObject) => classifyArtifactPlacement(object.status).state,
  status: (object: KubeObject) => artifactPlacementMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The domain columns are the CRD's printer columns in the CRD's own order:
// the pool, then the prepared nodes next to the target nodes, whose gap is
// what an operator scans for. The CRD's Status column (the reason of the
// Prepared condition) is what the Condition badge reads, and this list's Status
// column carries the condition's message (the SPEC-0007 pair).
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Pool", sortBy: "pool", id: "pool", className: styles.pool },
  { title: "Prepared", sortBy: "prepared", id: "prepared", className: styles.prepared },
  { title: "Nodes", sortBy: "nodes", id: "nodes", className: styles.nodes },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftArtifactPlacementsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftArtifactPlacementsPage = observer((props: SwiftArtifactPlacementsPageProps) => {
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
      renderTableContents={(object: KubeObject) => {
        const condition = classifyArtifactPlacement(object.status);

        return [
          <WithTooltip key="name">{object.getName()}</WithTooltip>,
          <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
          <WithTooltip key="pool">{KubeObject.getPoolName(object) ?? notAvailable}</WithTooltip>,
          // `0` is a fact in both counts and is kept as such.
          <WithTooltip key="prepared">{KubeObject.getPreparedNodes(object) ?? notAvailable}</WithTooltip>,
          <WithTooltip key="nodes">{KubeObject.getTargetNodes(object) ?? notAvailable}</WithTooltip>,
          <Badge key="condition" className={condition.className} label={condition.state} />,
          <WithTooltip key="status">{artifactPlacementMessage(object.status)}</WithTooltip>,
          <KubeObjectAge object={object} key="age" />,
        ];
      }}
    />
  );
});

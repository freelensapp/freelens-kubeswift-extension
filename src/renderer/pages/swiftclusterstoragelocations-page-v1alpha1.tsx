import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  SwiftClusterStorageLocation,
  type SwiftClusterStorageLocationApi,
} from "../api/kubeswift/swiftclusterstoragelocation-v1alpha1";
import { classifyStorageLocation, storageLocationMessage } from "../components/storage-status";
import styles from "./swiftclusterstoragelocations-page.module.scss";

const { observer } = MobxReact;

const {
  Component: { Badge, BadgeBoolean, getBooleanText, KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

const KubeObject = SwiftClusterStorageLocation;
type KubeObject = SwiftClusterStorageLocation;
type KubeObjectApi = SwiftClusterStorageLocationApi;

const notAvailable = "N/A";

const defaultTooltip =
  "The cluster default is the location an object that names none uses, unless its namespace has a default of its own";

// Cluster-scoped, so the list has no Namespace column.
const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  default: (object: KubeObject) => KubeObject.getDefaultLabel(object),
  repository: (object: KubeObject) => KubeObject.getRepository(object),
  // Sorted on the text the `BadgeBoolean` cell shows (a sort callback may not
  // return a boolean).
  reachable: (object: KubeObject) => getBooleanText(KubeObject.getReachable(object)),
  condition: (object: KubeObject) => classifyStorageLocation(object.status).state,
  status: (object: KubeObject) => storageLocationMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The CRD's printer columns minus Ready, which the Condition and Status pair
// says in more detail (the SPEC-0007 rule). Reachable keeps a column of its
// own: it is a printer column of this kind, and a health fact, so it is a
// `BadgeBoolean` ("-" until the controller has probed the registry). It also
// takes part in the Condition verdict when Ready is not True.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Default", sortBy: "default", id: "default", className: styles.defaultLocation },
  { title: "Repository", sortBy: "repository", id: "repository", className: styles.repository },
  { title: "Reachable", sortBy: "reachable", id: "reachable", className: styles.reachable },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftClusterStorageLocationsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftClusterStorageLocationsPage = observer((props: SwiftClusterStorageLocationsPageProps) => {
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
        const condition = classifyStorageLocation(object.status);

        return [
          <WithTooltip key="name">{object.getName()}</WithTooltip>,
          <WithTooltip key="default" tooltip={defaultTooltip}>
            {KubeObject.getDefaultLabel(object)}
          </WithTooltip>,
          <WithTooltip key="repository">{KubeObject.getRepository(object) ?? notAvailable}</WithTooltip>,
          <BadgeBoolean key="reachable" value={KubeObject.getReachable(object)} />,
          <Badge key="condition" className={condition.className} label={condition.state} />,
          <WithTooltip key="status">{storageLocationMessage(object.status)}</WithTooltip>,
          <KubeObjectAge object={object} key="age" />,
        ];
      }}
    />
  );
});

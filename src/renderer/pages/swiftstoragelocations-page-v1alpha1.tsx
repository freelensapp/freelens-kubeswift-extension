import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftStorageLocation, type SwiftStorageLocationApi } from "../api/kubeswift/swiftstoragelocation-v1alpha1";
import { classifyStorageLocation, storageLocationMessage } from "../components/storage-status";
import styles from "./swiftstoragelocations-page.module.scss";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftStorageLocation;
type KubeObject = SwiftStorageLocation;
type KubeObjectApi = SwiftStorageLocationApi;

const notAvailable = "N/A";

const defaultTooltip =
  "The namespace default is the location every object of this namespace that names none uses, ahead of the " +
  "cluster default";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  default: (object: KubeObject) => KubeObject.getDefaultLabel(object),
  repository: (object: KubeObject) => KubeObject.getRepository(object),
  condition: (object: KubeObject) => classifyStorageLocation(object.status).state,
  status: (object: KubeObject) => storageLocationMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The domain columns are the CRD's printer columns minus Ready, which the
// Condition and Status pair says in more detail (the SPEC-0007 rule). A
// CSI-only location has no repository, and its cell reads "N/A"; the drawer
// names its VolumeSnapshotClass.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Default", sortBy: "default", id: "default", className: styles.defaultLocation },
  { title: "Repository", sortBy: "repository", id: "repository", className: styles.repository },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftStorageLocationsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftStorageLocationsPage = observer((props: SwiftStorageLocationsPageProps) => {
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
          <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
          <WithTooltip key="default" tooltip={defaultTooltip}>
            {KubeObject.getDefaultLabel(object)}
          </WithTooltip>,
          <WithTooltip key="repository">{KubeObject.getRepository(object) ?? notAvailable}</WithTooltip>,
          <Badge key="condition" className={condition.className} label={condition.state} />,
          <WithTooltip key="status">{storageLocationMessage(object.status)}</WithTooltip>,
          <KubeObjectAge object={object} key="age" />,
        ];
      }}
    />
  );
});

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGPUProfile, type SwiftGPUProfileApi } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftgpuprofiles-page.module.scss";
import stylesInline from "./swiftgpuprofiles-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftGPUProfile;
type KubeObject = SwiftGPUProfile;
type KubeObjectApi = SwiftGPUProfileApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  count: (object: KubeObject) => KubeObject.getCount(object),
  model: (object: KubeObject) => KubeObject.getModelLabel(object),
  partitionMode: (object: KubeObject) => KubeObject.getPartitionMode(object),
  tier: (object: KubeObject) => KubeObject.getTier(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The four domain columns are exactly the CRD's printer columns, so the list
// reads like `kubectl get swiftgpuprofiles`. Upstream calls the third one
// "Mode": on a row that already carries a Tier column that is ambiguous, so it
// is spelled out here. There is no Condition and no Status column, because the
// CRD has no status to classify - a state pair would render "N/A" on every row
// of every cluster (declared deviation, see SPEC-0007).
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Count", sortBy: "count", id: "count", className: styles.count },
  { title: "Model", sortBy: "model", id: "model", className: styles.model },
  { title: "Partition Mode", sortBy: "partitionMode", id: "partitionMode", className: styles.partitionMode },
  { title: "Tier", sortBy: "tier", id: "tier", className: styles.tier },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftGPUProfilesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftGPUProfilesPage = observer((props: SwiftGPUProfilesPageProps) =>
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
            <WithTooltip key="name">{object.getName()}</WithTooltip>,
            <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
            <WithTooltip key="count">{KubeObject.getCount(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip key="model">{KubeObject.getModelLabel(object) ?? notAvailable}</WithTooltip>,
            // The raw enum values, as `kubectl` shows them, with the schema's
            // own explanation of the value in the cell tooltip; the humanized
            // reading itself lives in the drawer.
            <WithTooltip key="partitionMode" tooltip={KubeObject.getPartitionModeReading(object)}>
              {KubeObject.getPartitionMode(object) ?? notAvailable}
            </WithTooltip>,
            <WithTooltip key="tier" tooltip={KubeObject.getTierReading(object)}>
              {KubeObject.getTier(object) ?? notAvailable}
            </WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

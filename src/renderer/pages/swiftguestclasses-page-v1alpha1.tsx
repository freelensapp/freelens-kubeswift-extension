import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuestClass, type SwiftGuestClassApi } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftguestclasses-page.module.scss";
import stylesInline from "./swiftguestclasses-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

const KubeObject = SwiftGuestClass;
type KubeObject = SwiftGuestClass;
type KubeObjectApi = SwiftGuestClassApi;

// Guest classes are cluster-scoped, so the list has no Namespace column.
const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  cpu: (object: KubeObject) => KubeObject.getCpu(object),
  memory: (object: KubeObject) => KubeObject.getMemory(object),
  disk: (object: KubeObject) => KubeObject.getRootDiskSize(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "CPU", sortBy: "cpu", id: "cpu", className: styles.cpu },
  { title: "Memory", sortBy: "memory", id: "memory", className: styles.memory },
  { title: "Disk", sortBy: "disk", id: "disk", className: styles.disk },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftGuestClassesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftGuestClassesPage = observer((props: SwiftGuestClassesPageProps) =>
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
            <WithTooltip>{KubeObject.getCpu(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{KubeObject.getMemory(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{KubeObject.getRootDiskSize(object) ?? "N/A"}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

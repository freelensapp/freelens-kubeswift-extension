import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftMigration, type SwiftMigrationApi } from "../api/kubeswift/swiftmigration-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftmigrations-page.module.scss";
import stylesInline from "./swiftmigrations-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftMigration;
type KubeObject = SwiftMigration;
type KubeObjectApi = SwiftMigrationApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  guest: (object: KubeObject) => KubeObject.getGuestName(object),
  mode: (object: KubeObject) => KubeObject.getMode(object),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  progress: (object: KubeObject) => KubeObject.getTransferProgress(object) ?? -1,
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// Guest, mode, phase and progress are printer columns of the CRD, so the list
// reads like `kubectl get swiftmigrations`. The source and destination nodes
// are printer columns too, but they are node links, which belong in the detail
// panel rather than in a cell that has to stay narrow.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Guest", sortBy: "guest" },
  { title: "Mode", sortBy: "mode", className: styles.mode },
  { title: "Phase", sortBy: "phase", className: styles.phase },
  { title: "Progress", sortBy: "progress", className: styles.progress },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftMigrationsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftMigrationsPage = observer((props: SwiftMigrationsPageProps) =>
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
            <WithTooltip>{KubeObject.getGuestName(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getMode(object)}</WithTooltip>,
            <WithTooltip>{KubeObject.getPhase(object) ?? notAvailable}</WithTooltip>,
            <WithTooltip>{KubeObject.getProgressLabel(object) ?? notAvailable}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

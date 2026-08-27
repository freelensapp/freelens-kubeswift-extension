import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftImage, type SwiftImageApi } from "../api/kubeswift/swiftimage-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftimages-page.module.scss";
import stylesInline from "./swiftimages-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftImage;
type KubeObject = SwiftImage;
type KubeObjectApi = SwiftImageApi;

const getSource = (object: KubeObject) => {
  const summary = KubeObject.getSourceSummary(object);

  return summary ? (summary.reference ?? summary.title) : undefined;
};

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  source: (object: KubeObject) => getSource(object),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  size: (object: KubeObject) => KubeObject.getPreparedSize(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Source", sortBy: "source", className: styles.source },
  { title: "Phase", sortBy: "phase", className: styles.phase },
  { title: "Size", sortBy: "size", className: styles.size },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftImagesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftImagesPage = observer((props: SwiftImagesPageProps) =>
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
            <WithTooltip>{getSource(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{KubeObject.getPhase(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{KubeObject.getPreparedSize(object) ?? "N/A"}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

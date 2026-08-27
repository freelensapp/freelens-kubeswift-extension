import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftKernel, type SwiftKernelApi } from "../api/kubeswift/swiftkernel-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftkernels-page.module.scss";
import stylesInline from "./swiftkernels-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftKernel;
type KubeObject = SwiftKernel;
type KubeObjectApi = SwiftKernelApi;

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  artifact: (object: KubeObject) => KubeObject.getArtifact(object),
  profile: (object: KubeObject) => KubeObject.getProfile(object),
  phase: (object: KubeObject) => KubeObject.getPhase(object),
  nodes: (object: KubeObject) => KubeObject.getReadyNodeCount(object).ready,
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[] = [
  { title: "Name", sortBy: "name" },
  { title: "Namespace", sortBy: "namespace" },
  { title: "Artifact", sortBy: "artifact", className: styles.artifact },
  { title: "Profile", sortBy: "profile", className: styles.profile },
  { title: "Phase", sortBy: "phase", className: styles.phase },
  { title: "Nodes", sortBy: "nodes", className: styles.nodes },
  { title: "Age", sortBy: "age", className: styles.age },
];

export interface SwiftKernelsPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftKernelsPage = observer((props: SwiftKernelsPageProps) =>
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
            const nodes = KubeObject.getReadyNodeCount(object);

            return [
              <WithTooltip>{object.getName()}</WithTooltip>,
              <LinkToNamespace namespace={object.getNs()} />,
              <WithTooltip>{KubeObject.getArtifact(object) ?? "N/A"}</WithTooltip>,
              <WithTooltip>{KubeObject.getProfile(object) ?? "N/A"}</WithTooltip>,
              <WithTooltip>{KubeObject.getPhase(object) ?? "N/A"}</WithTooltip>,
              <WithTooltip>{`${nodes.ready}/${nodes.total}`}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

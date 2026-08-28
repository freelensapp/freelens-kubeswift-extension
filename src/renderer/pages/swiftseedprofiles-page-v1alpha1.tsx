import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSeedProfile, type SwiftSeedProfileApi } from "../api/kubeswift/swiftseedprofile-v1alpha1";
import { withErrorPage } from "../components/error-page";
import styles from "./swiftseedprofiles-page.module.scss";
import stylesInline from "./swiftseedprofiles-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { KubeObjectAge, KubeObjectListLayout, LinkToNamespace, WithTooltip },
} = Renderer;

const KubeObject = SwiftSeedProfile;
type KubeObject = SwiftSeedProfile;
type KubeObjectApi = SwiftSeedProfileApi;

// The list only ever shows where the cloud-init user-data comes from. Its
// content may embed credentials and never reaches a table cell.
const getUserDataOrigin = (object: KubeObject) => KubeObject.getUserDataSource(object)?.title;

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  datasource: (object: KubeObject) => KubeObject.getDatasource(object),
  userData: (object: KubeObject) => getUserDataOrigin(object),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Datasource", sortBy: "datasource", id: "datasource", className: styles.datasource },
  { title: "User Data", sortBy: "userData", id: "userData", className: styles.userData },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftSeedProfilesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftSeedProfilesPage = observer((props: SwiftSeedProfilesPageProps) =>
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
            <WithTooltip>{KubeObject.getDatasource(object) ?? "N/A"}</WithTooltip>,
            <WithTooltip>{getUserDataOrigin(object) ?? "N/A"}</WithTooltip>,
            <KubeObjectAge object={object} key="age" />,
          ]}
        />
      </>
    );
  }),
);

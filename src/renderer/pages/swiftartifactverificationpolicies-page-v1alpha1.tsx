import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  describeOtherRepositories,
  SwiftArtifactVerificationPolicy,
  type SwiftArtifactVerificationPolicyApi,
} from "../api/kubeswift/swiftartifactverificationpolicy-v1alpha1";
import { classifyVerificationPolicy, verificationPolicyMessage } from "../components/artifact-status";
import styles from "./swiftartifactverificationpolicies-page.module.scss";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, WithTooltip },
} = Renderer;

const KubeObject = SwiftArtifactVerificationPolicy;
type KubeObject = SwiftArtifactVerificationPolicy;
type KubeObjectApi = SwiftArtifactVerificationPolicyApi;

const notAvailable = "N/A";

// Cluster-scoped, so the list has no Namespace column.
const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespaces: (object: KubeObject) => KubeObject.getNamespaceCount(object),
  other: (object: KubeObject) => KubeObject.getOtherRepositories(object),
  condition: (object: KubeObject) => classifyVerificationPolicy(object.status).state,
  status: (object: KubeObject) => verificationPolicyMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The CRD's printer columns minus Ready, which the Condition and Status pair
// says in more detail (the SPEC-0007 rule). "Namespaces" is the count the
// selector matches, and "Other" what happens to an artifact no policy governs.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespaces", sortBy: "namespaces", id: "namespaces", className: styles.namespaces },
  { title: "Other", sortBy: "other", id: "other", className: styles.other },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftArtifactVerificationPoliciesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftArtifactVerificationPoliciesPage = observer((props: SwiftArtifactVerificationPoliciesPageProps) => {
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
        const condition = classifyVerificationPolicy(object.status);
        const other = KubeObject.getOtherRepositories(object);

        return [
          <WithTooltip key="name">{object.getName()}</WithTooltip>,
          // `0` is a fact: a valid selector that matches no namespace yet.
          <WithTooltip key="namespaces">{KubeObject.getNamespaceCount(object) ?? notAvailable}</WithTooltip>,
          <WithTooltip key="other" tooltip={describeOtherRepositories(other)}>
            {other ?? notAvailable}
          </WithTooltip>,
          <Badge key="condition" className={condition.className} label={condition.state} />,
          <WithTooltip key="status">{verificationPolicyMessage(object.status)}</WithTooltip>,
          <KubeObjectAge object={object} key="age" />,
        ];
      }}
    />
  );
});

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { FleetCluster, type FleetClusterApi } from "../api/kubeswift/fleetcluster-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { classifyFleetCluster, fleetClusterMessage } from "../components/fleet-status";
import styles from "./fleetclusters-page.module.scss";
import stylesInline from "./fleetclusters-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = FleetCluster;
type KubeObject = FleetCluster;
type KubeObjectApi = FleetClusterApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  server: (object: KubeObject) => KubeObject.getServerLabel(object),
  k8s: (object: KubeObject) => KubeObject.getKubernetesVersion(object),
  guests: (object: KubeObject) => KubeObject.getGuestCount(object),
  condition: (object: KubeObject) => classifyFleetCluster(object.status).state,
  status: (object: KubeObject) => fleetClusterMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The domain columns are the CRD's printer columns minus Ready, which the
// Condition and Status pair says better and in more detail (the SPEC-0007 rule,
// unchanged), and minus Prometheus, which the schema itself marks `priority: 1`
// - upstream saying it is a `kubectl get -o wide` column and not a default one.
// It is a long URL that would crowd out the version and the guest count an
// operator scans a fleet for, and it has a section in the drawer.
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Server", sortBy: "server", id: "server", className: styles.server },
  { title: "K8s", sortBy: "k8s", id: "k8s", className: styles.k8s },
  { title: "Guests", sortBy: "guests", id: "guests", className: styles.guests },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface FleetClustersPageProps {
  extension: Renderer.LensExtension;
}

export const FleetClustersPage = observer((props: FleetClustersPageProps) =>
  withErrorPage(props, () => {
    const store = KubeObject.getStore<KubeObject>();

    return (
      <>
        <style>{stylesInline}</style>
        <KubeObjectListLayout<KubeObject, KubeObjectApi>
          // A literal rather than `${KubeObject.crd.plural}Table`, which would
          // produce "clustersTable": core persists sort preferences under a
          // globally keyed `table_settings` map shared by itself and every
          // extension, so a plain "clusters" id is a plausible collision.
          // Declared deviation from DESIGN.md section 4, with the sveltos
          // extension's own `capiclustersTable` as the precedent (SPEC-0009).
          tableId="fleetclustersTable"
          className={styles.page}
          store={store}
          sortingCallbacks={sortingCallbacks}
          // The host's `getSearchFields()` covers name, namespace, id and
          // labels. `spec.displayName` is deliberately not added: DESIGN.md
          // section 1 allows extending the filters only for data a column
          // shows, and the display name is not a column.
          searchFilters={[(object: KubeObject) => object.getSearchFields()]}
          renderHeaderTitle={KubeObject.crd.title}
          renderTableHeader={renderTableHeader}
          renderTableContents={(object: KubeObject) => {
            const condition = classifyFleetCluster(object.status);

            return [
              <WithTooltip key="name">{object.getName()}</WithTooltip>,
              <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
              // Four readings, not two: the URL, the hub's own in-cluster
              // entry, the URL that lives inside a credential Secret this
              // extension does not read, and a genuinely missing value.
              // Rendering "N/A" for the middle two would report a correctly
              // configured member as incomplete (SPEC-0009).
              <WithTooltip key="server" tooltip={KubeObject.getServerTooltip(object)}>
                {KubeObject.getServerLabel(object) ?? notAvailable}
              </WithTooltip>,
              <WithTooltip key="k8s">{KubeObject.getKubernetesVersion(object) ?? notAvailable}</WithTooltip>,
              // `0` is kept: the schema omits this field until the gateway has
              // synced the member at least once, so a zero is a synced member
              // running no VMs and an absent one has never been reached.
              <WithTooltip key="guests">{KubeObject.getGuestCount(object) ?? notAvailable}</WithTooltip>,
              <Badge key="condition" className={condition.className} label={condition.state} />,
              <WithTooltip key="status">{fleetClusterMessage(object.status)}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

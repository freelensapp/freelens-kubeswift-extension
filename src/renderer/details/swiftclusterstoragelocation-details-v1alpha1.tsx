import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  clusterLocationSecretTooltip,
  SwiftClusterStorageLocation,
} from "../api/kubeswift/swiftclusterstoragelocation-v1alpha1";
import { StorageLocationSections } from "./storage-location-sections";

const { observer } = MobxReact;

const {
  Component: { KubeObjectConditionsDrawer },
} = Renderer;

const defaultTooltip =
  "The cluster default is the location an object that names none uses, unless its namespace has a default of its " +
  "own. Two cluster defaults are refused, never one picked";

export type SwiftClusterStorageLocationDetailsProps =
  Renderer.Component.KubeObjectDetailsProps<SwiftClusterStorageLocation>;

// No reference store: the Secrets a cluster location names live in the
// namespace of each object that uses it, so there is no one Secret to link.
export const SwiftClusterStorageLocationDetails = observer((props: SwiftClusterStorageLocationDetailsProps) => {
  const { object } = props;

  return (
    <>
      <StorageLocationSections
        spec={object.spec}
        status={object.status}
        defaultTooltip={defaultTooltip}
        secretTooltip={clusterLocationSecretTooltip}
        reachable={SwiftClusterStorageLocation.getReachable(object)}
        observedGeneration={SwiftClusterStorageLocation.getObservedGeneration(object)}
      />
      <KubeObjectConditionsDrawer object={object} />
    </>
  );
});

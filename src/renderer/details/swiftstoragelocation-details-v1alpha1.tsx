import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftStorageLocation } from "../api/kubeswift/swiftstoragelocation-v1alpha1";
import { useReferenceStores } from "../components/reference-loader";
import { StorageLocationSections } from "./storage-location-sections";

import type { ReferenceRequest } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: { KubeObjectConditionsDrawer },
  K8sApi: { secretsStore },
} = Renderer;

const defaultTooltip =
  "The namespace default is the location every object of this namespace that names none uses, ahead of the " +
  "cluster default. Two defaults in one namespace are refused, never one picked";

export type SwiftStorageLocationDetailsProps = Renderer.Component.KubeObjectDetailsProps<SwiftStorageLocation>;

export const SwiftStorageLocationDetails = observer((props: SwiftStorageLocationDetailsProps) => {
  const { object } = props;
  const namespace = object.getNs();
  const secretNames = SwiftStorageLocation.getSecretNames(object);

  // The Secrets are looked up in the location's own namespace, and only when
  // the location names any (an anonymous, CSI-only one asks for nothing).
  const requests: ReferenceRequest<unknown>[] = [];

  if (secretNames.length > 0) {
    requests.push({
      label: "secrets",
      store: secretsStore,
      namespaces: [namespace],
      lookups: secretNames.map((name) => ({ name, namespace })),
    });
  }

  useReferenceStores(requests);

  return (
    <>
      <StorageLocationSections
        spec={object.spec}
        status={object.status}
        namespace={namespace}
        defaultTooltip={defaultTooltip}
        observedGeneration={SwiftStorageLocation.getObservedGeneration(object)}
      />
      <KubeObjectConditionsDrawer object={object} />
    </>
  );
});

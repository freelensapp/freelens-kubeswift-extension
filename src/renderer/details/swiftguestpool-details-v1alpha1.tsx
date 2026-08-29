import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftGuestPool } from "../api/kubeswift/swiftguestpool-v1alpha1";
import { formatQuantity } from "../api/kubeswift/types";
import { withErrorPage } from "../components/error-page";
import { existingObjectRef } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: { Badge, DrawerItem, DrawerTitle, KubeObjectConditionsDrawer, LinkToObject, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftGuestPoolDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftGuestPool> {
  extension: Renderer.LensExtension;
}

export const SwiftGuestPoolDetails = observer((props: SwiftGuestPoolDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const templateSpec = SwiftGuestPool.getGuestTemplateSpec(object);
    const templateLabels = Object.entries(spec?.template?.metadata?.labels ?? {});
    const rollingUpdate = spec?.updateStrategy?.rollingUpdate;
    const topologySpreadConstraints = spec?.topologySpreadConstraints ?? [];
    const service = spec?.service;
    const servicePorts = SwiftGuestPool.getServicePorts(object);
    const volumeClaimTemplates = SwiftGuestPool.getVolumeClaimTemplates(object);
    const namespace = object.getNs();
    const gpuProfileName = templateSpec?.gpuProfileRef?.name;
    const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());

    // The template's GPU profile became resolvable in M3, when the kind was
    // registered (SPEC-0007). `gpuProfileRef` is a `LocalObjectReference`, so
    // the profile lives in the pool's own namespace, which is the one the
    // store is asked for rather than whatever the namespace filter holds
    // (DESIGN.md section 3, issue #38).
    useReferenceStores([
      {
        label: SwiftGPUProfile.crd.plural,
        store: gpuProfileStore,
        namespaces: [namespace],
        lookups: [{ name: gpuProfileName, namespace }],
      },
    ]);

    const gpuProfileRef = existingObjectRef(gpuProfileStore, SwiftGPUProfile.kind, gpuProfileName, namespace);

    return (
      <>
        <DrawerTitle>Replicas</DrawerTitle>
        <DrawerItem name="Desired">
          <WithTooltip>{SwiftGuestPool.getDesiredReplicas(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Current">
          <WithTooltip>{SwiftGuestPool.getCurrentReplicas(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Ready">
          <WithTooltip>{SwiftGuestPool.getReadyReplicas(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Updated">
          <WithTooltip>{SwiftGuestPool.getUpdatedReplicas(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Available">
          <WithTooltip>{SwiftGuestPool.getAvailableReplicas(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Failed">
          <WithTooltip>{SwiftGuestPool.getFailedReplicas(object)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Rollout</DrawerTitle>
        <DrawerItem name="Update Strategy">
          <WithTooltip>{SwiftGuestPool.getUpdateStrategyType(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Max Surge" hidden={rollingUpdate?.maxSurge === undefined}>
          <WithTooltip>{rollingUpdate?.maxSurge}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Max Unavailable" hidden={rollingUpdate?.maxUnavailable === undefined}>
          <WithTooltip>{rollingUpdate?.maxUnavailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Spread Policy">
          <WithTooltip>{SwiftGuestPool.getSpreadPolicy(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Template Hash" hidden={!status?.currentTemplateHash}>
          <WithTooltip>{status?.currentTemplateHash}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Topology Spread" hidden={topologySpreadConstraints.length === 0} labelsOnly>
          {topologySpreadConstraints.map((constraint, index) => (
            <Badge
              key={constraint.topologyKey ?? `constraint-${index}`}
              label={`${constraint.topologyKey}: max skew ${constraint.maxSkew}`}
              tooltip={constraint.whenUnsatisfiable}
            />
          ))}
        </DrawerItem>

        <DrawerTitle>Guest Template</DrawerTitle>
        <DrawerItem name="Guest Class">
          <WithTooltip>{templateSpec?.guestClassRef?.name ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Image" hidden={!templateSpec?.imageRef?.name}>
          <WithTooltip>{templateSpec?.imageRef?.name}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Kernel" hidden={!templateSpec?.kernelRef?.name}>
          <WithTooltip>{templateSpec?.kernelRef?.name}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Kernel Cmdline" hidden={!templateSpec?.kernelCmdline}>
          <WithTooltip>{templateSpec?.kernelCmdline}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Seed Profile" hidden={!templateSpec?.seedProfileRef?.name}>
          <WithTooltip>{templateSpec?.seedProfileRef?.name}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="GPU Profile" hidden={!gpuProfileName}>
          {gpuProfileRef ? (
            <LinkToObject objectRef={gpuProfileRef} object={object} />
          ) : (
            <WithTooltip>{gpuProfileName}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="OS Type" hidden={!templateSpec?.osType}>
          <WithTooltip>{templateSpec?.osType}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Run Policy" hidden={!templateSpec?.runPolicy}>
          <WithTooltip>{templateSpec?.runPolicy}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Scheduler" hidden={!templateSpec?.schedulerName}>
          <WithTooltip>{templateSpec?.schedulerName}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Labels" hidden={templateLabels.length === 0} labelsOnly>
          {templateLabels.map(([key, value]) => (
            <Badge key={key} label={`${key}: ${value}`} />
          ))}
        </DrawerItem>

        {service || status?.serviceRef ? (
          <>
            <DrawerTitle>Service</DrawerTitle>
            <DrawerItem name="Name">
              <WithTooltip>{SwiftGuestPool.getServiceName(object) ?? notAvailable}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Type" hidden={!service}>
              <WithTooltip>{service?.type ?? "ClusterIP"}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Headless" hidden={service?.headless === undefined}>
              <WithTooltip>{String(service?.headless)}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Load Balancer Class" hidden={!service?.loadBalancerClass}>
              <WithTooltip>{service?.loadBalancerClass}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Ports" hidden={servicePorts.length === 0} labelsOnly>
              {servicePorts.map((port, index) => (
                <Badge
                  key={port.name ?? `port-${index}`}
                  label={`${port.port}/${port.protocol ?? "TCP"}`}
                  tooltip={[port.name, port.expose].filter(Boolean).join(" ")}
                />
              ))}
            </DrawerItem>
          </>
        ) : null}

        {volumeClaimTemplates.length > 0 ? (
          <>
            <DrawerTitle>Volume Claim Templates</DrawerTitle>
            {volumeClaimTemplates.map((template, index) => (
              <DrawerItem key={template.metadata?.name ?? `claim-${index}`} name={template.metadata?.name ?? "Claim"}>
                <WithTooltip>
                  {[
                    formatQuantity(template.spec?.resources?.requests?.storage),
                    template.spec?.storageClassName,
                    template.spec?.volumeMode,
                  ]
                    .filter(Boolean)
                    .join(", ") || notAvailable}
                </WithTooltip>
              </DrawerItem>
            ))}
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

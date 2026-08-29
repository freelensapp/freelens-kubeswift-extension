import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { toKubeObjectRef } from "../api/kubeswift/types";
import { withErrorPage } from "../components/error-page";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import styles from "./swiftgpuprofile-details.module.scss";
import stylesInline from "./swiftgpuprofile-details.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: {
    BadgeBoolean,
    DrawerItem,
    DrawerTitle,
    LinkToObject,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
} = Renderer;

const notAvailable = "N/A";

/** `pcie (tier 1: ...)` when the value has a known reading, the bare value otherwise. */
function withReading(value?: string, reading?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return reading ? `${value} (${reading})` : value;
}

interface SectionProps {
  object: SwiftGPUProfile;
}

/**
 * The virtual PCIe hierarchy the profile asks for. Optional in the schema, so
 * the section guards itself instead of rendering three empty rows.
 */
function PcieTopologySection({ object }: SectionProps) {
  const pcieTopology = object.spec?.pcieTopology;

  if (!pcieTopology) {
    return null;
  }

  return (
    <>
      <DrawerTitle>PCIe Topology</DrawerTitle>
      <DrawerItem name="Root Port Per Device" labelsOnly>
        <BadgeBoolean value={pcieTopology.rootPortPerDevice} />
      </DrawerItem>
      <DrawerItem name="GPUDirect Clique">
        <WithTooltip>{pcieTopology.gpuDirectClique ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* Set for GPUs with very large BARs, where mapping them stalls the boot. */}
      <DrawerItem name="No Mmap" labelsOnly>
        <BadgeBoolean value={pcieTopology.noMmap} />
      </DrawerItem>
    </>
  );
}

/**
 * The virtual NUMA layout. An absent block is not nothing: the schema says the
 * guest then gets a flat, single-node topology, so the section says that
 * rather than disappearing or showing four empty rows.
 */
function NumaTopologySection({ object }: SectionProps) {
  const numaTopology = object.spec?.numaTopology;

  return (
    <>
      <DrawerTitle>NUMA Topology</DrawerTitle>
      {numaTopology ? (
        <>
          <DrawerItem name="Sockets">
            <WithTooltip>{numaTopology.sockets ?? notAvailable}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Cores Per Socket">
            <WithTooltip>{numaTopology.coresPerSocket ?? notAvailable}</WithTooltip>
          </DrawerItem>
          <DrawerItem name="Threads Per Core">
            <WithTooltip>{numaTopology.threadsPerCore ?? notAvailable}</WithTooltip>
          </DrawerItem>
          {/* A count of MiB, not of bytes: humanized through formatMebibytes,
              with the value as authored kept in the tooltip. */}
          <DrawerItem name="Memory Per Socket">
            <WithTooltip
              tooltip={
                numaTopology.memoryPerSocketMi === undefined ? undefined : `${numaTopology.memoryPerSocketMi} MiB`
              }
            >
              {SwiftGPUProfile.getMemoryPerSocket(object) ?? notAvailable}
            </WithTooltip>
          </DrawerItem>
        </>
      ) : (
        <DrawerItem name="Layout">
          <WithTooltip>Flat: the guest gets a single NUMA node</WithTooltip>
        </DrawerItem>
      )}
    </>
  );
}

/** Fabric Manager, which only the two HGX tiers ever carry. */
function FabricManagerSection({ object }: SectionProps) {
  const fabricManager = object.spec?.fabricManager;

  if (!fabricManager) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Fabric Manager</DrawerTitle>
      {/* The field is a boolean, but what it decides is where Fabric Manager
          runs, so that is what the row says. */}
      <DrawerItem name="Runs In">
        <WithTooltip>{SwiftGPUProfile.getFabricManagerLocation(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Required Driver Version" hidden={!fabricManager.requiredVersion}>
        <WithTooltip>{fabricManager.requiredVersion}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/**
 * The guests this profile is attached to. `spec.gpuProfileRef` is a
 * `LocalObjectReference`, so the search is namespace-local by construction and
 * the SwiftGuest store is asked for exactly this profile's namespace rather
 * than for whatever the namespace filter happens to hold (DESIGN.md section 3,
 * issue #38). No `lookups` are declared: what the section renders is the
 * result of the listing itself, not a set of names known in advance.
 */
const GuestsUsingSection = observer(({ object }: SectionProps) => {
  const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

  useReferenceStores([{ label: SwiftGuest.crd.plural, store: guestStore, namespaces: [object.getNs()] }]);

  // Nothing is rendered while the store is still filling: an empty section
  // would read as "no guest uses this profile", which is a different statement
  // from "not known yet".
  if (!guestStore?.isLoaded) {
    return null;
  }

  const guests = SwiftGPUProfile.getGuestsUsing(object, guestStore.items);

  return (
    <>
      <DrawerTitle>Guests Using This Profile</DrawerTitle>
      {guests.length === 0 ? (
        <DrawerItem name="Guests">
          <WithTooltip>No guest in this namespace references this profile</WithTooltip>
        </DrawerItem>
      ) : (
        <Table scrollable={false} sortSyncWithUrl={false} className={styles.guests}>
          <TableHead flat sticky={false}>
            <TableCell className="name">Name</TableCell>
            <TableCell className="phase">Phase</TableCell>
            <TableCell className="node">Node</TableCell>
          </TableHead>
          {guests.map((guest) => {
            const guestRef = toKubeObjectRef(SwiftGuest.kind, guest.apiVersion, guest.getName(), guest.getNs());
            // Every row comes from the store this check reads, so it can only
            // ever pass here. It is kept because the rule it enforces is the
            // one every reference in this extension follows (DESIGN.md section
            // 3): a link is rendered only for an object the store can resolve,
            // and the host builds this link's target by looking the object up
            // in that same store.
            const isLinkable = guestRef && objectExists(guestStore, guest.getName(), guest.getNs());

            return (
              <TableRow key={guest.getId()} nowrap>
                <TableCell className="name">
                  {isLinkable ? (
                    <LinkToObject objectRef={guestRef} object={object} />
                  ) : (
                    <WithTooltip>{guest.getName()}</WithTooltip>
                  )}
                </TableCell>
                <TableCell className="phase">
                  <WithTooltip>{SwiftGuest.getPhase(guest) ?? notAvailable}</WithTooltip>
                </TableCell>
                <TableCell className="node">
                  <WithTooltip>{SwiftGuest.getNodeName(guest) ?? notAvailable}</WithTooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </>
  );
});

export interface SwiftGPUProfileDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftGPUProfile> {
  extension: Renderer.LensExtension;
}

export const SwiftGPUProfileDetails = observer((props: SwiftGPUProfileDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;

    // No conditions drawer: the CRD declares `subresources: {}` and has no
    // status property at all, so there is nothing to report (SPEC-0007).
    return (
      <>
        <style>{stylesInline}</style>
        <DrawerTitle>GPU Profile</DrawerTitle>
        <DrawerItem name="Count">
          <WithTooltip>{SwiftGPUProfile.getCount(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        {/* An empty model filter means "any model matches", which is a fact
            rather than a missing value. */}
        <DrawerItem name="Model">
          <WithTooltip>{SwiftGPUProfile.getModelLabel(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Tier">
          <WithTooltip>
            {withReading(SwiftGPUProfile.getTier(object), SwiftGPUProfile.getTierReading(object)) ?? notAvailable}
          </WithTooltip>
        </DrawerItem>
        <DrawerItem name="Partition Mode">
          <WithTooltip>
            {withReading(SwiftGPUProfile.getPartitionMode(object), SwiftGPUProfile.getPartitionModeReading(object)) ??
              notAvailable}
          </WithTooltip>
        </DrawerItem>
        <DrawerItem name="Hugepages">
          <WithTooltip>{SwiftGPUProfile.getHugepagesLabel(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="vCPU Pinning" labelsOnly>
          <BadgeBoolean value={SwiftGPUProfile.getVcpuPinning(object)} />
        </DrawerItem>

        <PcieTopologySection object={object} />
        <NumaTopologySection object={object} />
        <FabricManagerSection object={object} />
        <GuestsUsingSection object={object} />
      </>
    );
  }),
);

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { parseAllocatedTo, SwiftGPUNode } from "../api/kubeswift/swiftgpunode-v1alpha1";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { classifyGpuDevice, classifyGpuNode } from "../components/gpu-status";
import { existingObjectRef, objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import styles from "./swiftgpunode-details.module.scss";
import stylesInline from "./swiftgpunode-details.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    BadgeBoolean,
    DrawerItem,
    DrawerTitle,
    LinkToNode,
    LinkToObject,
    LocaleDate,
    ReactiveDuration,
    StatusBrick,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
  K8sApi: { nodesStore },
} = Renderer;

const notAvailable = "N/A";

interface SectionProps {
  object: SwiftGPUNode;
}

/**
 * The SwiftGuest an `allocatedTo` value names, as a link when that guest is
 * really there and as plain text otherwise.
 *
 * `allocatedTo` is a `"namespace/name"` string, not an object reference, so it
 * is split first and only a well-formed pair is ever looked up; anything else
 * is shown exactly as the controller wrote it. A miss is expected here more
 * often than anywhere else in the extension - a GPU stays recorded as allocated
 * to a guest that was just deleted - and is the correct outcome, not a defect
 * (SPEC-0007, DESIGN.md section 3).
 */
const AllocatedTo = observer(({ object, allocatedTo }: SectionProps & { allocatedTo?: string }) => {
  const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());
  const reference = parseAllocatedTo(allocatedTo);
  const guestRef = existingObjectRef(guestStore, SwiftGuest.kind, reference?.name, reference?.namespace);

  if (!allocatedTo) {
    return <WithTooltip>{notAvailable}</WithTooltip>;
  }

  // The link keeps the whole "namespace/name" as its text: it is what the
  // status says, and the namespace is not otherwise on the row.
  return guestRef ? (
    <LinkToObject objectRef={guestRef} object={object} content={allocatedTo} tooltip={allocatedTo} />
  ) : (
    <WithTooltip>{allocatedTo}</WithTooltip>
  );
});

/**
 * What discovery reported about the node itself: the verdict, the node behind
 * the object, and how fresh the whole inventory is. A `lastDiscovery` that has
 * stopped moving is the signal that the DaemonSet is gone.
 */
const DiscoverySection = observer(({ object }: SectionProps) => {
  const condition = classifyGpuNode(object.status);
  // A SwiftGPUNode is named after the node it describes, so its own name is
  // the reference to check. The node can legitimately be gone (the object
  // outlives it until the DaemonSet cleans up), in which case the row degrades
  // to text rather than rendering a link core would happily build from the
  // name alone.
  const nodeName = object.getName();
  const nodeIsLinkable = objectExists(nodesStore, nodeName);
  const lastDiscovery = SwiftGPUNode.getLastDiscovery(object);

  return (
    <>
      <DrawerTitle>Discovery</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      <DrawerItem name="Node">
        {nodeIsLinkable ? <LinkToNode name={nodeName} /> : <WithTooltip>{nodeName}</WithTooltip>}
      </DrawerItem>
      <DrawerItem name="VFIO Ready" labelsOnly>
        <BadgeBoolean value={SwiftGPUNode.getVfioReady(object)} />
      </DrawerItem>
      {/* The raw phase, since the badge above is a verdict and this is what
          `kubectl` shows. */}
      <DrawerItem name="Phase">
        <WithTooltip>{SwiftGPUNode.getPhase(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Last Discovery" hidden={!lastDiscovery}>
        {lastDiscovery ? (
          <>
            <LocaleDate date={lastDiscovery} /> (<ReactiveDuration timestamp={lastDiscovery} /> ago)
          </>
        ) : null}
      </DrawerItem>
    </>
  );
});

/** The node's inventory as a whole, plus one brick per device. */
function InventorySection({ object }: SectionProps) {
  const gpus = SwiftGPUNode.getGpus(object);
  const allocated = SwiftGPUNode.getAllocatedCount(object);

  return (
    <>
      <DrawerTitle>Inventory</DrawerTitle>
      <DrawerItem name="Vendor">
        <WithTooltip>{SwiftGPUNode.getGpuVendor(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Model">
        <WithTooltip>{SwiftGPUNode.getGpuModel(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="GPUs">
        <WithTooltip>{SwiftGPUNode.getGpuCount(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Free">
        <WithTooltip>{SwiftGPUNode.getFreeGPUs(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* Derived from the two counts above, and hidden when either is absent:
          the DaemonSet and the controller own different fields of this status,
          so a zero invented here could be plain wrong. */}
      <DrawerItem name="Allocated" hidden={allocated === undefined}>
        <WithTooltip>{allocated}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Devices" hidden={gpus.length === 0} labelsOnly>
        <span className={styles.bricks}>
          {gpus.map((device, index) => {
            const condition = classifyGpuDevice(device);

            return (
              <StatusBrick
                key={device.pciAddress || `gpu-${device.index ?? index}`}
                className={`${styles.brick} ${styles[condition.className]}`}
                tooltip={condition.explanation}
              />
            );
          })}
        </span>
      </DrawerItem>
    </>
  );
}

/** One row per device: the table an operator reads against `lspci`. */
function GpusSection({ object }: SectionProps) {
  const gpus = SwiftGPUNode.getGpus(object);

  if (gpus.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>GPUs</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.gpus}>
        <TableHead flat sticky={false}>
          <TableCell className="index">Index</TableCell>
          <TableCell className="model">Model</TableCell>
          <TableCell className="vendor">Vendor</TableCell>
          <TableCell className="pciAddress">PCI Address</TableCell>
          <TableCell className="deviceId">Device ID</TableCell>
          <TableCell className="numa">NUMA</TableCell>
          <TableCell className="iommuGroup">IOMMU Group</TableCell>
          <TableCell className="driver">Driver</TableCell>
          <TableCell className="bars">BARs</TableCell>
          <TableCell className="allocated">Allocated</TableCell>
          <TableCell className="allocatedTo">Allocated To</TableCell>
        </TableHead>
        {gpus.map((device, index) => (
          <TableRow key={device.pciAddress || `gpu-${device.index ?? index}`} nowrap>
            <TableCell className="index">
              <WithTooltip>{device.index ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="model">
              <WithTooltip>{device.model ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="vendor">
              <WithTooltip>{device.vendor ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="pciAddress">
              <WithTooltip>{device.pciAddress ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="deviceId">
              <WithTooltip>{device.deviceId ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="numa">
              <WithTooltip>{device.numaNode ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="iommuGroup">
              <WithTooltip>{device.iommuGroup ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="driver">
              <WithTooltip>{device.driver ?? notAvailable}</WithTooltip>
            </TableCell>
            {/* The largest region, humanized from the MiB the schema counts
                in: it is the number that decides whether the guest needs
                `noMmap`. The full list stays in the tooltip. */}
            <TableCell className="bars">
              <WithTooltip tooltip={SwiftGPUNode.getBarSizesReading(device)}>
                {SwiftGPUNode.getLargestBar(device) ?? notAvailable}
              </WithTooltip>
            </TableCell>
            <TableCell className="allocated">
              <BadgeBoolean value={device.allocated} />
            </TableCell>
            <TableCell className="allocatedTo">
              <AllocatedTo object={object} allocatedTo={device.allocatedTo} />
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

/** The physical host: what the guest's own topology will be carved out of. */
function HostSection({ object }: SectionProps) {
  const host = object.status?.host;

  if (!host) {
    return null;
  }

  const cpuTopology = host.cpuTopology;
  const numaNodes = SwiftGPUNode.getNumaNodes(object);
  const hugepages = SwiftGPUNode.getHugepages1Gi(object);

  return (
    <>
      <DrawerTitle>Host</DrawerTitle>
      <DrawerItem name="IOMMU Enabled" labelsOnly>
        <BadgeBoolean value={host.iommuEnabled} />
      </DrawerItem>
      <DrawerItem name="Sockets" hidden={cpuTopology?.sockets === undefined}>
        <WithTooltip>{cpuTopology?.sockets}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Cores Per Socket" hidden={cpuTopology?.coresPerSocket === undefined}>
        <WithTooltip>{cpuTopology?.coresPerSocket}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Threads Per Core" hidden={cpuTopology?.threadsPerCore === undefined}>
        <WithTooltip>{cpuTopology?.threadsPerCore}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Total CPUs" hidden={cpuTopology?.totalCPUs === undefined}>
        <WithTooltip>{cpuTopology?.totalCPUs}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="1Gi Hugepages" hidden={!hugepages}>
        <WithTooltip>{hugepages}</WithTooltip>
      </DrawerItem>
      {numaNodes.length > 0 ? (
        <Table scrollable={false} sortSyncWithUrl={false} className={styles.numaNodes}>
          <TableHead flat sticky={false}>
            <TableCell className="id">NUMA Node</TableCell>
            <TableCell className="cpus">CPUs</TableCell>
            <TableCell className="memory">Memory</TableCell>
          </TableHead>
          {numaNodes.map((numaNode, index) => (
            <TableRow key={numaNode.id ?? `numa-${index}`} nowrap>
              <TableCell className="id">
                <WithTooltip>{numaNode.id ?? notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="cpus">
                <WithTooltip>{numaNode.cpus ?? notAvailable}</WithTooltip>
              </TableCell>
              {/* `memoryMi` is a count of MiB, never of bytes. */}
              <TableCell className="memory">
                <WithTooltip tooltip={numaNode.memoryMi === undefined ? undefined : `${numaNode.memoryMi} MiB`}>
                  {SwiftGPUNode.getNumaNodeMemory(numaNode) ?? notAvailable}
                </WithTooltip>
              </TableCell>
            </TableRow>
          ))}
        </Table>
      ) : null}
    </>
  );
}

/** HGX nodes only, so the section guards itself away on every other node. */
function NvSwitchesSection({ object }: SectionProps) {
  const nvSwitches = SwiftGPUNode.getNvSwitches(object);

  if (nvSwitches.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>NVSwitches</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.nvSwitches}>
        <TableHead flat sticky={false}>
          <TableCell className="pciAddress">PCI Address</TableCell>
          <TableCell className="deviceId">Device ID</TableCell>
          <TableCell className="numa">NUMA</TableCell>
        </TableHead>
        {nvSwitches.map((nvSwitch, index) => (
          <TableRow key={nvSwitch.pciAddress || `nvswitch-${index}`} nowrap>
            <TableCell className="pciAddress">
              <WithTooltip>{nvSwitch.pciAddress ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="deviceId">
              <WithTooltip>{nvSwitch.deviceId ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className="numa">
              <WithTooltip>{nvSwitch.numaNode ?? notAvailable}</WithTooltip>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

/** The host Fabric Manager and the NVSwitch partitions it holds. */
function FabricManagerSection({ object }: SectionProps) {
  const fabricManager = object.status?.fabricManager;

  if (!fabricManager) {
    return null;
  }

  const partitions = SwiftGPUNode.getPartitions(object);

  return (
    <>
      <DrawerTitle>Fabric Manager</DrawerTitle>
      <DrawerItem name="Installed" labelsOnly>
        <BadgeBoolean value={fabricManager.installed} />
      </DrawerItem>
      <DrawerItem name="Running" labelsOnly>
        <BadgeBoolean value={fabricManager.running} />
      </DrawerItem>
      <DrawerItem name="Version" hidden={!fabricManager.version}>
        <WithTooltip>{fabricManager.version}</WithTooltip>
      </DrawerItem>
      {partitions.length > 0 ? (
        <Table scrollable={false} sortSyncWithUrl={false} className={styles.partitions}>
          <TableHead flat sticky={false}>
            <TableCell className="id">Partition</TableCell>
            <TableCell className="gpuIndices">GPU Indices</TableCell>
            <TableCell className="active">Active</TableCell>
            <TableCell className="allocatedTo">Allocated To</TableCell>
          </TableHead>
          {partitions.map((partition, index) => (
            <TableRow key={partition.id ?? `partition-${index}`} nowrap>
              <TableCell className="id">
                <WithTooltip>{partition.id ?? notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="gpuIndices">
                <WithTooltip>{(partition.gpuIndices ?? []).join(", ") || notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className="active">
                <BadgeBoolean value={partition.active} />
              </TableCell>
              <TableCell className="allocatedTo">
                <AllocatedTo object={object} allocatedTo={partition.allocatedTo} />
              </TableCell>
            </TableRow>
          ))}
        </Table>
      ) : null}
    </>
  );
}

export interface SwiftGPUNodeDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftGPUNode> {
  extension: Renderer.LensExtension;
}

export const SwiftGPUNodeDetails = observer((props: SwiftGPUNodeDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

    // `nodesStore` is cluster-scoped and loads cluster-wide; the SwiftGuest
    // store is asked for exactly the namespaces the `allocatedTo` values name,
    // rather than for whatever the namespace filter happens to hold (DESIGN.md
    // section 3, issue #38). Both are declared here once, for the whole drawer,
    // so the nested tables only have to look objects up at render time.
    useReferenceStores([
      { label: "nodes", store: nodesStore, lookups: [{ name: object.getName() }] },
      {
        label: SwiftGuest.crd.plural,
        store: guestStore,
        namespaces: SwiftGPUNode.getAllocatedToNamespaces(object),
        lookups: SwiftGPUNode.getAllocatedToReferences(object),
      },
    ]);

    // No conditions drawer: the status has no `conditions[]` at all, which is
    // why the Condition badge above is generated by the classifier
    // (SPEC-0007).
    return (
      <>
        <style>{stylesInline}</style>
        <DiscoverySection object={object} />
        <InventorySection object={object} />
        <GpusSection object={object} />
        <HostSection object={object} />
        <NvSwitchesSection object={object} />
        <FabricManagerSection object={object} />
      </>
    );
  }),
);

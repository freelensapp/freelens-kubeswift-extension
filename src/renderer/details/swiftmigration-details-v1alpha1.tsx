import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGuest } from "../api/kubeswift/swiftguest-v1alpha1";
import { SwiftMigration } from "../api/kubeswift/swiftmigration-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { migrationDeleteRow } from "../components/migration-create";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToNode,
    LinkToObject,
    LinkToPod,
    LocaleDate,
    WithTooltip,
  },
  K8sApi: { nodesStore, podsStore },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftMigrationDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftMigration> {
  extension: Renderer.LensExtension;
}

export const SwiftMigrationDetails = observer((props: SwiftMigrationDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const status = object.status;
    const mode = SwiftMigration.getMode(object);
    const requestedMode = SwiftMigration.getRequestedMode(object);
    const failure = SwiftMigration.getFailure(object);
    const nodeSelector = Object.entries(spec?.target?.nodeSelector ?? {});
    const guestRef = SwiftMigration.getGuestRef(object);
    const sourceNode = SwiftMigration.getSourceNode(object);
    const destinationNode = SwiftMigration.getDestinationNode(object);
    const sourcePodName = status?.sourcePodRef?.name;
    const destinationPodName = status?.destinationPodRef?.name;

    // The migrated guest, the source/destination nodes and the launcher pods
    // on each end are none of them guaranteed to still exist: a migration's
    // source node in particular may legitimately be gone by the time anyone
    // looks at a finished migration. LinkToObject/LinkToNode/LinkToPod only
    // format a details URL from the ref/name, they never check the target
    // exists (DESIGN.md section 3, issue #23).
    const guestStore = maybe(() => SwiftGuest.getStore<SwiftGuest>());

    // The launcher pods on both ends live in this migration's namespace and
    // the guest in its ref's, so those stores are asked for exactly those
    // namespaces instead of relying on the namespace filter; `nodesStore` is
    // cluster-scoped (issue #38).
    useReferenceStores([
      {
        label: SwiftGuest.crd.plural,
        store: guestStore,
        namespaces: [guestRef?.namespace ?? object.getNs()],
        lookups: [{ name: guestRef?.name, namespace: guestRef?.namespace }],
      },
      { label: "nodes", store: nodesStore, lookups: [{ name: sourceNode }, { name: destinationNode }] },
      {
        label: "pods",
        store: podsStore,
        namespaces: [object.getNs()],
        lookups: [
          { name: sourcePodName, namespace: object.getNs() },
          { name: destinationPodName, namespace: object.getNs() },
        ],
      },
    ]);

    const guestIsLinkable = objectExists(guestStore, guestRef?.name, guestRef?.namespace);
    const sourceNodeIsLinkable = objectExists(nodesStore, sourceNode);
    const destinationNodeIsLinkable = objectExists(nodesStore, destinationNode);
    const sourcePodIsLinkable = objectExists(podsStore, sourcePodName, object.getNs());
    const destinationPodIsLinkable = objectExists(podsStore, destinationPodName, object.getNs());

    // What deleting THIS migration does, computed from its own phase and mode
    // (SPEC-0012, the SPEC-0011 On Delete precedent). The host owns the Delete
    // confirmation and gives an extension no hook to add a per-kind consequence
    // to it, so the extension says it where it does own the surface, and
    // permanently.
    //
    // It matters more here than anywhere else in this extension, because one
    // trash icon covers three different verbs: deleting a pre-cutover offline
    // migration ROLLS THE GUEST BACK, deleting a post-cutover one leaves it on
    // the destination, and deleting an in-flight LIVE one cleans up nothing at
    // all - the destination pod and the transfer carry on, and only the record
    // disappears. Upstream states none of this anywhere, and `swiftctl migration
    // cancel` deletes the CR against the CRD's own advice.
    const deleteRow = migrationDeleteRow({
      phase: status?.phase,
      mode,
      // `getMode` falls back to the requested mode, so "auto" here means the
      // controller has not resolved it yet and both futures are still open.
      modeUnresolved: status?.mode === undefined,
      ttl: spec?.ttl,
    });

    return (
      <>
        <DrawerTitle>Migration</DrawerTitle>
        <DrawerItem name="Phase">
          <WithTooltip>{SwiftMigration.getPhase(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Phase Detail" hidden={!status?.phaseDetail}>
          <WithTooltip>{status?.phaseDetail}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Guest">
          {guestRef && guestIsLinkable ? (
            <LinkToObject objectRef={guestRef} object={object} />
          ) : (
            <WithTooltip>{guestRef?.name ?? notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        {/* The controller resolves `auto`, so the mode in force can differ from
            the one the spec asked for. Both are shown when they disagree. */}
        <DrawerItem name="Mode">
          <WithTooltip>{mode === requestedMode ? mode : `${mode} (requested: ${requestedMode})`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Progress" hidden={SwiftMigration.getTransferProgress(object) === undefined}>
          <WithTooltip>{SwiftMigration.getProgressLabel(object)}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Reason" hidden={!spec?.reason}>
          <WithTooltip>{spec?.reason}</WithTooltip>
        </DrawerItem>
        {/* Three deletion outcomes wearing one trash icon, told apart from this
            object's own phase and mode. It sits here, next to those two rows,
            because it is a consequence of them - and because an operator
            deciding what to do with a migration reads the top of the drawer. */}
        <DrawerItem name="On Delete">
          <WithTooltip>{deleteRow.sentences.join(" ")}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Placement</DrawerTitle>
        <DrawerItem name="From" hidden={!sourceNode}>
          {sourceNodeIsLinkable ? <LinkToNode name={sourceNode} /> : <WithTooltip>{sourceNode}</WithTooltip>}
        </DrawerItem>
        <DrawerItem name="To">
          {destinationNode ? (
            destinationNodeIsLinkable ? (
              <LinkToNode name={destinationNode} />
            ) : (
              <WithTooltip>{destinationNode}</WithTooltip>
            )
          ) : (
            <WithTooltip>{notAvailable}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Node Selector" hidden={nodeSelector.length === 0} labelsOnly>
          {nodeSelector.map(([key, value]) => (
            <Badge key={key} label={`${key}: ${value}`} />
          ))}
        </DrawerItem>
        <DrawerItem name="Source Pod" hidden={!sourcePodName}>
          {sourcePodIsLinkable ? (
            <LinkToPod name={sourcePodName} namespace={object.getNs()} />
          ) : (
            <WithTooltip>{sourcePodName}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Destination Pod" hidden={!destinationPodName}>
          {destinationPodIsLinkable ? (
            <LinkToPod name={destinationPodName} namespace={object.getNs()} />
          ) : (
            <WithTooltip>{destinationPodName}</WithTooltip>
          )}
        </DrawerItem>
        <DrawerItem name="Target IP" hidden={!status?.targetIP}>
          <WithTooltip>{status?.targetIP}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Allow IP Change" hidden={spec?.allowIPChange === undefined}>
          <WithTooltip>{String(spec?.allowIPChange)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Timings</DrawerTitle>
        <DrawerItem name="Started At" hidden={!status?.startedAt}>
          {status?.startedAt ? <LocaleDate date={status.startedAt} /> : null}
        </DrawerItem>
        <DrawerItem name="Completed At" hidden={!status?.completedAt}>
          {status?.completedAt ? <LocaleDate date={status.completedAt} /> : null}
        </DrawerItem>
        {/* The schema is explicit that this is the cutover-orchestration
            window, not the guest's own stopped-the-world time. */}
        <DrawerItem name="Observed Downtime" hidden={!status?.observedDowntime}>
          <WithTooltip>{status?.observedDowntime}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Transfer Duration" hidden={!status?.observedTransferDuration}>
          <WithTooltip>{status?.observedTransferDuration}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Downtime Target" hidden={!spec?.downtimeTarget}>
          <WithTooltip>{spec?.downtimeTarget}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Applied Downtime" hidden={status?.appliedDowntimeMs === undefined}>
          <WithTooltip>{`${status?.appliedDowntimeMs} ms`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Timeout">
          <WithTooltip>{`${SwiftMigration.getTimeout(object)} (${SwiftMigration.getTimeoutStrategy(object)})`}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="TTL" hidden={!spec?.ttl}>
          <WithTooltip>{spec?.ttl}</WithTooltip>
        </DrawerItem>

        {failure ? (
          <>
            <DrawerTitle>Failure</DrawerTitle>
            <DrawerItem name="Reason">
              <WithTooltip>{failure.reason ?? notAvailable}</WithTooltip>
            </DrawerItem>
            <DrawerItem name="Message" hidden={!failure.message}>
              <WithTooltip>{failure.message}</WithTooltip>
            </DrawerItem>
          </>
        ) : null}

        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  certificateVerificationTooltip,
  displayNameTooltip,
  FleetCluster,
  guestCountTooltip,
  inClusterCredentialLabel,
  telemetryConsumerLabel,
  telemetryConsumerTooltip,
} from "../api/kubeswift/fleetcluster-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { classifyFleetCluster } from "../components/fleet-status";
import { objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";

import type { ReferenceRequest } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    BadgeBoolean,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToSecret,
    LocaleDate,
    ReactiveDuration,
    WithTooltip,
  },
  K8sApi: { secretsStore },
} = Renderer;

const notAvailable = "N/A";

interface SectionProps {
  object: FleetCluster;
}

/**
 * The member itself. Always rendered: a Cluster object always has a federation
 * role and a verdict to report, even when the verdict is "nothing has reported
 * on it", which on a cluster without a kubeswift-gateway is the permanent and
 * correct reading.
 *
 * The host writes the drawer's own title as `Cluster: <name>`, which in an
 * application whose central noun is "cluster" is ambiguous and has no hook to
 * change (DESIGN.md section 4 keeps the kind technical wherever it is a kind).
 * The ambiguity is removed from inside instead: this section is titled "Member
 * Cluster" and its second row states the federation role, so the first two
 * lines under the host's title say what the object is.
 *
 * An observer because the Credential Secret row resolves a reference and has to
 * re-render when the Secret store fills.
 */
const MemberClusterSection = observer(({ object }: SectionProps) => {
  const condition = classifyFleetCluster(object.status);
  const namespace = object.getNs();
  const displayName = FleetCluster.getDisplayName(object);
  const credentialSecret = FleetCluster.getCredentialSecretName(object);
  const guestCount = FleetCluster.getGuestCount(object);
  const lastConnected = FleetCluster.getLastConnected(object);
  const observedGeneration = FleetCluster.getObservedGeneration(object);

  return (
    <>
      <DrawerTitle>Member Cluster</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      {/* Named rather than left as a boolean: this is a topology fact where
          neither value is healthier, so it is deliberately not a
          `BadgeBoolean` - that component's green/red encodes health, and
          colouring "local" green would invent a meaning (DESIGN.md
          section 2). */}
      <DrawerItem name="Federation">
        <WithTooltip>{FleetCluster.getFederationLabel(object)}</WithTooltip>
      </DrawerItem>
      {/* Not a column: the list is keyed on `metadata.name`, which is what
          `kubectl`, the Secret's namespace and every reference use, and a
          second name column that usually repeats the first is noise. */}
      <DrawerItem name="Display Name" hidden={!displayName}>
        <WithTooltip tooltip={displayNameTooltip}>{displayName}</WithTooltip>
      </DrawerItem>
      {/* The same four readings as the list cell. */}
      <DrawerItem name="Server">
        <WithTooltip tooltip={FleetCluster.getServerTooltip(object)}>
          {FleetCluster.getServerLabel(object) ?? notAvailable}
        </WithTooltip>
      </DrawerItem>
      {/* The Secret is named and linked, never read. `secretsStore` would let
          this drawer resolve the server URL, the CA and the token out of the
          member's kubeconfig, and one of those would even improve the row
          above; the hub is the fleet's blast radius because it holds a
          credential to every member, and pulling those credentials into a
          renderer process to pretty-print a hostname would widen exactly that
          radius for a cosmetic gain (SPEC-0009). A reader who needs the
          contents opens the Secret in Freelens, where the host's own reveal
          affordance and the user's own RBAC apply.
          A miss is a normal outcome here, not a defect: a hub operator's RBAC
          may let them list Clusters without listing the credential Secrets
          next to them. */}
      {FleetCluster.isLocal(object) && !credentialSecret ? (
        <DrawerItem name="Credential Secret">
          <WithTooltip>{inClusterCredentialLabel}</WithTooltip>
        </DrawerItem>
      ) : (
        <DrawerItem name="Credential Secret" hidden={!credentialSecret}>
          {objectExists(secretsStore, credentialSecret, namespace) ? (
            <LinkToSecret name={credentialSecret} namespace={namespace} />
          ) : (
            <WithTooltip>{credentialSecret}</WithTooltip>
          )}
        </DrawerItem>
      )}
      {/* Positive phrasing, so green means the member's API server certificate
          is verified (DESIGN.md section 2, the fluxcd "Resumed" precedent).
          This is the one place in this drawer where a boolean genuinely
          encodes health: the schema calls the opposite setting UNSAFE, and its
          warning is this row's tooltip - `title` is the host's own row-level
          tooltip prop, and `BadgeBoolean` takes no tooltip of its own. */}
      <DrawerItem name="Certificate Verification" title={certificateVerificationTooltip} labelsOnly>
        <BadgeBoolean value={FleetCluster.verifiesCertificate(object)} />
      </DrawerItem>
      <DrawerItem name="Kubernetes Version">
        <WithTooltip>{FleetCluster.getKubernetesVersion(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* `0` is kept, and the value is deliberately not a link: linking it
          would land the reader on THIS cluster's SwiftGuests page, which lists
          different objects. The way to see a member's VMs is to connect
          Freelens to the member, which is the roadmap's whole argument for
          excluding fleet aggregation, made visible at the one place a user
          would otherwise expect a link. */}
      <DrawerItem name="Guests">
        <WithTooltip tooltip={guestCountTooltip}>{guestCount ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* The idiom the SwiftGPUNode drawer's "Last Discovery" row already uses
          for the same kind of field. Staleness is never derived from it: the
          gateway already publishes that judgement as the Reachable condition,
          and a second opinion computed by arithmetic would contradict the
          controller on exactly the objects where it matters. */}
      <DrawerItem name="Last Connected" hidden={!lastConnected}>
        {lastConnected ? (
          <>
            <LocaleDate date={lastConnected} /> (<ReactiveDuration timestamp={lastConnected} /> ago)
          </>
        ) : null}
      </DrawerItem>
      <DrawerItem name="Observed Generation" hidden={observedGeneration === undefined}>
        <WithTooltip>{observedGeneration}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/**
 * The per-VM telemetry endpoint, shown as the fact it is. Nothing here is
 * computed: an explicit `spec.prometheusEndpoint` always wins over discovery,
 * and re-deriving the effective value would produce a second opinion - the same
 * stance the pool classifier takes toward its counts.
 *
 * The section guards itself on all three of its triggers, so a member nobody
 * has configured or resolved telemetry for has no empty block.
 */
function TelemetrySection({ object }: SectionProps) {
  if (!FleetCluster.hasTelemetry(object)) {
    return null;
  }

  const configured = FleetCluster.getConfiguredPrometheusEndpoint(object);

  return (
    <>
      <DrawerTitle>Telemetry</DrawerTitle>
      <DrawerItem name="Endpoint">
        <WithTooltip>{FleetCluster.getPrometheusEndpoint(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* Shown next to the effective value so an operator can see at a glance
          whether it was theirs or discovered. */}
      <DrawerItem name="Configured Endpoint" hidden={!configured}>
        <WithTooltip>{configured}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Resolution">
        <WithTooltip tooltip={FleetCluster.getPrometheusResolutionTooltip(object)}>
          {FleetCluster.getPrometheusResolution(object) ?? notAvailable}
        </WithTooltip>
      </DrawerItem>
      {/* A row rather than a tooltip: without it an empty Telemetry section
          reads as a Freelens metrics problem, which is a different subsystem
          entirely. */}
      <DrawerItem name="Queried By">
        <WithTooltip tooltip={telemetryConsumerTooltip}>{telemetryConsumerLabel}</WithTooltip>
      </DrawerItem>
    </>
  );
}

export interface FleetClusterDetailsProps extends Renderer.Component.KubeObjectDetailsProps<FleetCluster> {
  extension: Renderer.LensExtension;
}

export const FleetClusterDetails = observer((props: FleetClusterDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const namespace = object.getNs();
    const credentialSecret = FleetCluster.getCredentialSecretName(object);

    // The smallest reference table in the extension - the schema declares
    // exactly one reference, a `LocalObjectReference` with no namespace of its
    // own - and the request is still assembled conditionally: a `spec.local`
    // entry names no Secret and therefore issues no request at all (DESIGN.md
    // section 3, issue #38). The store is asked for the object's own namespace
    // rather than for whatever the namespace filter happens to hold.
    const requests: ReferenceRequest<unknown>[] = [];

    if (credentialSecret) {
      requests.push({
        label: "secrets",
        store: secretsStore,
        namespaces: [namespace],
        lookups: [{ name: credentialSecret, namespace }],
      });
    }

    useReferenceStores(requests);

    return (
      <>
        <MemberClusterSection object={object} />
        <TelemetrySection object={object} />
        {/* Where Ready, Reachable and PrometheusEndpointResolved appear in full
            with their reasons and transition times, which is why no section
            above restates a condition's raw fields. */}
        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

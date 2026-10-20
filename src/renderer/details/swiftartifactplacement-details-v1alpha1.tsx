import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import {
  defaultArtifactLayout,
  formatClaims,
  SwiftArtifactPlacement,
  type SwiftArtifactPlacementArtifactView,
} from "../api/kubeswift/swiftartifactplacement-v1alpha1";
import { SwiftArtifactVerificationPolicy } from "../api/kubeswift/swiftartifactverificationpolicy-v1alpha1";
import { SwiftSandboxPool } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import {
  classifyArtifactPlacement,
  classifyPlacementArtifact,
  classifyPlacementNode,
} from "../components/artifact-status";
import { existingObjectRef, objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import styles from "./swiftartifactplacement-details.module.scss";

import type { ReferenceRequest } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToNode,
    LinkToObject,
    LinkToSecret,
    LocaleDate,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
  K8sApi: { nodesStore, secretsStore },
} = Renderer;

const notAvailable = "N/A";

const platformVerificationLabel = "Required";
const platformVerificationTooltip =
  "The artifact is refused unless a SwiftArtifactVerificationPolicy governs it in this namespace, so a checkout " +
  "that relies on platform trust learns when there is none";

const claimsTooltip =
  "Signed annotations the artifact's platform verification must find, as asked for by a checkout that uses the " +
  "prepared entry";

interface SectionProps {
  object: SwiftArtifactPlacement;
}

/** A Secret of the placement's namespace: a link when it exists, plain text otherwise. */
const SecretName = observer(({ name, namespace }: { name: string; namespace: string }) =>
  objectExists(secretsStore, name, namespace) ? (
    <LinkToSecret name={name} namespace={namespace} />
  ) : (
    <WithTooltip>{name}</WithTooltip>
  ),
);

/** The placement itself: the verdict, the pool and the two node counts. */
const PlacementSection = observer(({ object }: SectionProps) => {
  const condition = classifyArtifactPlacement(object.status);
  const poolName = SwiftArtifactPlacement.getPoolName(object);
  const poolStore = maybe(() => SwiftSandboxPool.getStore<SwiftSandboxPool>());
  const poolRef = existingObjectRef(poolStore, SwiftSandboxPool.kind, poolName, object.getNs());
  const observedGeneration = SwiftArtifactPlacement.getObservedGeneration(object);

  return (
    <>
      <DrawerTitle>Placement</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      <DrawerItem name="Pool">
        {poolRef ? (
          <LinkToObject objectRef={poolRef} object={object} />
        ) : (
          <WithTooltip>{poolName ?? notAvailable}</WithTooltip>
        )}
      </DrawerItem>
      {/* `0` is a fact in both counts and is kept as such. */}
      <DrawerItem name="Target Nodes">
        <WithTooltip>{SwiftArtifactPlacement.getTargetNodes(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Prepared Nodes">
        <WithTooltip>{SwiftArtifactPlacement.getPreparedNodes(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Observed Generation" hidden={observedGeneration === undefined}>
        <WithTooltip>{observedGeneration}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/**
 * One artifact: what the spec asks for and what the status reports about it,
 * joined by name. The section is titled with the artifact's name, since a
 * placement may hold up to sixteen.
 */
const ArtifactSection = observer(
  ({ object, artifact }: SectionProps & { artifact: SwiftArtifactPlacementArtifactView }) => {
    const namespace = object.getNs();
    const { spec, status } = artifact;
    const condition = classifyPlacementArtifact(status?.reason);
    const claims = formatClaims(spec?.claims);
    const policies = status?.policies ?? [];
    const policyStore = maybe(() => SwiftArtifactVerificationPolicy.getStore<SwiftArtifactVerificationPolicy>());
    const pullSecret = spec?.pullSecretRef?.name;
    const verifyKeySecret = spec?.verifyKeySecretRef?.name;

    return (
      <>
        <DrawerTitle>{`Artifact: ${artifact.name}`}</DrawerTitle>
        <DrawerItem name="Condition" labelsOnly>
          <Badge
            className={condition.className}
            label={condition.state}
            tooltip={status?.message || condition.explanation}
          />
        </DrawerItem>
        <DrawerItem name="Reference" hidden={!spec?.ref}>
          <WithTooltip>{spec?.ref}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Digest" hidden={!status?.digest}>
          <WithTooltip>{status?.digest}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Layout" hidden={!spec}>
          <WithTooltip>{spec?.layout ?? defaultArtifactLayout}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Prepared Nodes" hidden={status?.preparedNodes === undefined}>
          <WithTooltip>{status?.preparedNodes}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Message" hidden={!status?.message}>
          <WithTooltip>{status?.message}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Pull Secret" hidden={!pullSecret}>
          {pullSecret ? <SecretName name={pullSecret} namespace={namespace} /> : null}
        </DrawerItem>
        <DrawerItem name="Verify Key Secret" hidden={!verifyKeySecret}>
          {verifyKeySecret ? <SecretName name={verifyKeySecret} namespace={namespace} /> : null}
        </DrawerItem>
        <DrawerItem name="Claims" hidden={claims.length === 0} labelsOnly>
          {claims.map((claim) => (
            <Badge key={claim} label={claim} tooltip={claimsTooltip} />
          ))}
        </DrawerItem>
        <DrawerItem name="Platform Verification" hidden={!spec?.requirePlatformVerification}>
          <WithTooltip tooltip={platformVerificationTooltip}>{platformVerificationLabel}</WithTooltip>
        </DrawerItem>
        {/* The policies are cluster-scoped, so they resolve by name alone. The
            generation is the one the controller verified against. */}
        <DrawerItem name="Policies" hidden={policies.length === 0}>
          {policies.map((policy, index) => {
            const policyRef = existingObjectRef(policyStore, SwiftArtifactVerificationPolicy.kind, policy.name);

            return (
              <span key={policy.name}>
                {index > 0 ? ", " : null}
                {policyRef ? (
                  <LinkToObject objectRef={policyRef} object={object} />
                ) : (
                  <WithTooltip>{policy.name}</WithTooltip>
                )}
                {policy.generation === undefined ? null : ` (generation ${policy.generation})`}
              </span>
            );
          })}
        </DrawerItem>
      </>
    );
  },
);

/** The target nodes, one row each. Guards itself on a status that reports none. */
const NodesSection = observer(({ object }: SectionProps) => {
  const nodes = SwiftArtifactPlacement.getNodes(object);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Nodes</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.nodes}>
        <TableHead flat sticky={false}>
          <TableCell className={styles.name}>Node</TableCell>
          <TableCell className={styles.condition}>Condition</TableCell>
          <TableCell className={styles.preparedAt}>Prepared At</TableCell>
          <TableCell className={styles.failures}>Failures</TableCell>
          <TableCell className={styles.message}>Message</TableCell>
        </TableHead>
        {nodes.map((node) => {
          const condition = classifyPlacementNode(node);

          return (
            <TableRow key={node.name} nowrap>
              <TableCell className={styles.name}>
                {objectExists(nodesStore, node.name) ? (
                  <LinkToNode name={node.name} />
                ) : (
                  <WithTooltip>{node.name}</WithTooltip>
                )}
              </TableCell>
              <TableCell className={styles.condition}>
                <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
              </TableCell>
              <TableCell className={styles.preparedAt}>
                {node.preparedAt ? <LocaleDate date={node.preparedAt} /> : notAvailable}
              </TableCell>
              {/* Failed attempts since the node was last prepared; `0` is kept. */}
              <TableCell className={styles.failures}>
                <WithTooltip>{node.failures ?? notAvailable}</WithTooltip>
              </TableCell>
              <TableCell className={styles.message}>
                <WithTooltip>{node.message || notAvailable}</WithTooltip>
              </TableCell>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
});

export type SwiftArtifactPlacementDetailsProps = Renderer.Component.KubeObjectDetailsProps<SwiftArtifactPlacement>;

export const SwiftArtifactPlacementDetails = observer((props: SwiftArtifactPlacementDetailsProps) => {
  const { object } = props;
  const namespace = object.getNs();
  const poolName = SwiftArtifactPlacement.getPoolName(object);
  const secretNames = SwiftArtifactPlacement.getSecretNames(object);
  const policyNames = SwiftArtifactPlacement.getPolicyNames(object);
  const nodeNames = SwiftArtifactPlacement.getNodeNames(object);
  const poolStore = maybe(() => SwiftSandboxPool.getStore<SwiftSandboxPool>());
  const policyStore = maybe(() => SwiftArtifactVerificationPolicy.getStore<SwiftArtifactVerificationPolicy>());

  // Assembled conditionally: a store none of whose references are named
  // contributes no request. The pool and the Secrets live in the placement's
  // namespace; the policies and the nodes are cluster-scoped.
  const requests: ReferenceRequest<unknown>[] = [];

  if (poolName) {
    requests.push({
      label: SwiftSandboxPool.crd.plural,
      store: poolStore,
      namespaces: [namespace],
      lookups: [{ name: poolName, namespace }],
    });
  }

  if (secretNames.length > 0) {
    requests.push({
      label: "secrets",
      store: secretsStore,
      namespaces: [namespace],
      lookups: secretNames.map((name) => ({ name, namespace })),
    });
  }

  if (policyNames.length > 0) {
    requests.push({
      label: SwiftArtifactVerificationPolicy.crd.plural,
      store: policyStore,
      lookups: policyNames.map((name) => ({ name })),
    });
  }

  if (nodeNames.length > 0) {
    requests.push({ label: "nodes", store: nodesStore, lookups: nodeNames.map((name) => ({ name })) });
  }

  useReferenceStores(requests);

  return (
    <>
      <PlacementSection object={object} />
      {SwiftArtifactPlacement.getArtifacts(object).map((artifact) => (
        <ArtifactSection key={artifact.name} object={object} artifact={artifact} />
      ))}
      <NodesSection object={object} />
      <KubeObjectConditionsDrawer object={object} />
    </>
  );
});

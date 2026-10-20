import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  describeClaimRequirement,
  describeDigestPinning,
  describeOtherRepositories,
  everyNamespaceLabel,
  SwiftArtifactVerificationPolicy,
} from "../api/kubeswift/swiftartifactverificationpolicy-v1alpha1";
import { classifyVerificationPolicy } from "../components/artifact-status";
import { PemBlock } from "./pem-block";
import styles from "./swiftartifactverificationpolicy-details.module.scss";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
} = Renderer;

const notAvailable = "N/A";

const namespacesTooltip = "How many namespaces the selector matches now";
const repositoriesTooltip =
  "Globs over the canonical repository (registry host and path): * matches within one path segment, ** across " +
  "segments";
const keyIdTooltip = "The hex SHA-256 of the key's SubjectPublicKeyInfo, as the controller parsed it";

interface SectionProps {
  object: SwiftArtifactVerificationPolicy;
}

/** The verdict and the two enums that decide what the policy does. */
function PolicySection({ object }: SectionProps) {
  const condition = classifyVerificationPolicy(object.status);
  const digestPinning = SwiftArtifactVerificationPolicy.getDigestPinning(object);
  const otherRepositories = SwiftArtifactVerificationPolicy.getOtherRepositories(object);
  const observedGeneration = SwiftArtifactVerificationPolicy.getObservedGeneration(object);

  return (
    <>
      <DrawerTitle>Policy</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      {/* `0` is a fact: a selector that matches no namespace yet. */}
      <DrawerItem name="Namespaces">
        <WithTooltip tooltip={namespacesTooltip}>
          {SwiftArtifactVerificationPolicy.getNamespaceCount(object) ?? notAvailable}
        </WithTooltip>
      </DrawerItem>
      {/* The raw enum values, with their reading in the tooltip. */}
      <DrawerItem name="Digest Pinning">
        <WithTooltip tooltip={describeDigestPinning(digestPinning)}>{digestPinning ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Other Repositories">
        <WithTooltip tooltip={describeOtherRepositories(otherRepositories)}>
          {otherRepositories ?? notAvailable}
        </WithTooltip>
      </DrawerItem>
      <DrawerItem name="Observed Generation" hidden={observedGeneration === undefined}>
        <WithTooltip>{observedGeneration}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/** What the policy governs: the repositories, in the namespaces its selector matches. */
function ScopeSection({ object }: SectionProps) {
  const repositories = SwiftArtifactVerificationPolicy.getRepositories(object);
  const requirements = SwiftArtifactVerificationPolicy.getSelectorRequirements(object);

  return (
    <>
      <DrawerTitle>Scope</DrawerTitle>
      <DrawerItem name="Repositories" hidden={repositories.length === 0} labelsOnly>
        {repositories.map((repository) => (
          <Badge key={repository} label={repository} tooltip={repositoriesTooltip} />
        ))}
      </DrawerItem>
      {/* An empty selector is not a missing value: it selects every namespace. */}
      {requirements.length === 0 ? (
        <DrawerItem name="Namespace Selector">
          <WithTooltip>{everyNamespaceLabel}</WithTooltip>
        </DrawerItem>
      ) : (
        <DrawerItem name="Namespace Selector" labelsOnly>
          {requirements.map((requirement) => (
            <Badge key={requirement} label={requirement} />
          ))}
        </DrawerItem>
      )}
    </>
  );
}

/** The signers the policy trusts, with the key identity the controller parsed for each. */
function AuthoritiesSection({ object }: SectionProps) {
  const authorities = SwiftArtifactVerificationPolicy.getAuthorities(object);

  if (authorities.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Authorities</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.authorities}>
        <TableHead flat sticky={false}>
          <TableCell className={styles.name}>Name</TableCell>
          <TableCell className={styles.algorithm}>Algorithm</TableCell>
          <TableCell className={styles.keyId}>Key ID</TableCell>
        </TableHead>
        {authorities.map((authority) => (
          <TableRow key={authority.name} nowrap>
            <TableCell className={styles.name}>
              <WithTooltip>{authority.name}</WithTooltip>
            </TableCell>
            <TableCell className={styles.algorithm}>
              <WithTooltip>{authority.algorithm ?? notAvailable}</WithTooltip>
            </TableCell>
            <TableCell className={styles.keyId}>
              <WithTooltip tooltip={authority.keyID ? keyIdTooltip : undefined}>
                {authority.keyID ?? notAvailable}
              </WithTooltip>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

/** The signed annotations a signature must carry. Guards itself on a policy that requires none. */
function ClaimsSection({ object }: SectionProps) {
  const claims = SwiftArtifactVerificationPolicy.getClaims(object);

  if (claims.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Claims</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.claims}>
        <TableHead flat sticky={false}>
          <TableCell className={styles.key}>Key</TableCell>
          <TableCell className={styles.requirement}>Requirement</TableCell>
        </TableHead>
        {claims.map((claim) => (
          <TableRow key={claim.key} nowrap>
            <TableCell className={styles.key}>
              <WithTooltip>{claim.key}</WithTooltip>
            </TableCell>
            <TableCell className={styles.requirement}>
              <WithTooltip>{describeClaimRequirement(claim)}</WithTooltip>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

export type SwiftArtifactVerificationPolicyDetailsProps =
  Renderer.Component.KubeObjectDetailsProps<SwiftArtifactVerificationPolicy>;

// No reference store: the policy names no other object.
export const SwiftArtifactVerificationPolicyDetails = observer((props: SwiftArtifactVerificationPolicyDetailsProps) => {
  const { object } = props;

  return (
    <>
      <PolicySection object={object} />
      <ScopeSection object={object} />
      <AuthoritiesSection object={object} />
      <ClaimsSection object={object} />
      {SwiftArtifactVerificationPolicy.getAuthorities(object).map((authority) => (
        <PemBlock key={authority.name} title={`Public Key: ${authority.name}`} value={authority.publicKey} />
      ))}
      <KubeObjectConditionsDrawer object={object} />
    </>
  );
});

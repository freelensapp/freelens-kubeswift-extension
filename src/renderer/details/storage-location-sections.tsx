import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import {
  insecureRegistryTooltip,
  type StorageLocationSpec,
  type StorageLocationStatus,
  storageLocationBackends,
  storageLocationCredentialsSecret,
  usesDefaultCredentialsSecret,
} from "../api/kubeswift/swiftstoragelocation-v1alpha1";
import { summarizePem } from "../api/kubeswift/types";
import { objectExists } from "../components/object-existence";
import { classifyStorageLocation } from "../components/storage-status";
import { PemBlock } from "./pem-block";

// The drawer sections of the two storage location kinds, which share one
// schema (SPEC-0019, T3). The namespaced kind resolves the Secrets it names in
// its own namespace and links them; the cluster kind names Secrets that the
// controller looks up in the namespace of each object using the location, so
// it shows the names with that explanation and never links them.

const { observer } = MobxReact;

const {
  Component: { Badge, BadgeBoolean, DrawerItem, DrawerTitle, LinkToSecret, WithTooltip },
  K8sApi: { secretsStore },
} = Renderer;

const notAvailable = "N/A";

const anonymousCredentialsLabel = "None (anonymous registry)";

export interface StorageLocationSectionsProps {
  spec?: StorageLocationSpec;
  status?: StorageLocationStatus;
  /** The location's namespace, where its Secrets live. Unset for the cluster kind. */
  namespace?: string;
  /** The tooltip of the Default row, which says what the default means at this level. */
  defaultTooltip: string;
  /** Set for the cluster kind: why its Secrets are names rather than links. */
  secretTooltip?: string;
  /** The cluster kind's `Reachable` condition; `undefined` hides the row. */
  reachable?: boolean;
  observedGeneration?: number;
}

/** A Secret name: a link when it resolves in the location's namespace, plain text otherwise. */
const SecretName = observer(
  ({ name, namespace, label, tooltip }: { name: string; namespace?: string; label?: string; tooltip?: string }) =>
    namespace && objectExists(secretsStore, name, namespace) ? (
      <LinkToSecret name={name} namespace={namespace} />
    ) : (
      <WithTooltip tooltip={tooltip}>{label ?? name}</WithTooltip>
    ),
);

function LocationSection({
  spec,
  status,
  defaultTooltip,
  reachable,
  observedGeneration,
}: StorageLocationSectionsProps) {
  const condition = classifyStorageLocation(status);

  return (
    <>
      <DrawerTitle>Location</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      <DrawerItem name="Default">
        <WithTooltip tooltip={defaultTooltip}>{spec?.default ? "Yes" : "No"}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Backends">
        <WithTooltip>{storageLocationBackends(spec) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Reachable" hidden={reachable === undefined} labelsOnly>
        <BadgeBoolean value={reachable} />
      </DrawerItem>
      <DrawerItem name="Observed Generation" hidden={observedGeneration === undefined}>
        <WithTooltip>{observedGeneration}</WithTooltip>
      </DrawerItem>
    </>
  );
}

function OciSection({ spec, namespace, secretTooltip }: StorageLocationSectionsProps) {
  const oci = spec?.oci;

  if (!oci) {
    return null;
  }

  const credentials = storageLocationCredentialsSecret(spec);
  const verifyKey = summarizePem(oci.verifyKey);
  const caBundle = summarizePem(oci.caBundle);

  return (
    <>
      <DrawerTitle>OCI Registry</DrawerTitle>
      <DrawerItem name="Repository">
        <WithTooltip>{oci.repository || notAvailable}</WithTooltip>
      </DrawerItem>
      {/* Three readings: an anonymous registry looks up no Secret, an unset
          name means the controller's default one, and a name is the spec's. */}
      <DrawerItem name="Credentials Secret">
        {credentials ? (
          <SecretName
            name={credentials}
            namespace={namespace}
            label={usesDefaultCredentialsSecret(spec) ? `${credentials} (default)` : credentials}
            tooltip={secretTooltip}
          />
        ) : (
          <WithTooltip>{anonymousCredentialsLabel}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Signing Key Secret" hidden={!oci.signingKeySecretName}>
        {oci.signingKeySecretName ? (
          <SecretName name={oci.signingKeySecretName} namespace={namespace} tooltip={secretTooltip} />
        ) : null}
      </DrawerItem>
      {/* Summaries only; the PEM text itself is in its own block below. */}
      <DrawerItem name="Verify Key" hidden={!verifyKey}>
        <WithTooltip>{verifyKey}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="CA Bundle" hidden={!caBundle}>
        <WithTooltip>{caBundle}</WithTooltip>
      </DrawerItem>
      {/* Positive phrasing, so green means encrypted (DESIGN.md section 2);
          the schema calls the other setting unsafe, and its reading is the
          row's tooltip. */}
      <DrawerItem name="TLS" title={insecureRegistryTooltip} labelsOnly>
        <BadgeBoolean value={!oci.insecure} />
      </DrawerItem>
    </>
  );
}

function CsiSection({ spec }: StorageLocationSectionsProps) {
  const csi = spec?.csi;

  if (!csi) {
    return null;
  }

  return (
    <>
      <DrawerTitle>CSI</DrawerTitle>
      <DrawerItem name="Volume Snapshot Class">
        <WithTooltip>{csi.volumeSnapshotClassName || notAvailable}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/** Every section of a storage location's drawer, in order, the PEM blocks last. */
export function StorageLocationSections(props: StorageLocationSectionsProps) {
  return (
    <>
      <LocationSection {...props} />
      <OciSection {...props} />
      <CsiSection {...props} />
      <PemBlock title="Verify Key" value={props.spec?.oci?.verifyKey} />
      <PemBlock title="CA Bundle" value={props.spec?.oci?.caBundle} />
    </>
  );
}

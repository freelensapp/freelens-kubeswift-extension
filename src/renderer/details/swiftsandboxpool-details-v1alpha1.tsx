import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { maybe } from "../../common/utils";
import { SwiftGPUProfile } from "../api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftKernel } from "../api/kubeswift/swiftkernel-v1alpha1";
import {
  defaultKernelLabel,
  defaultKernelTooltip,
  describeNetworkMode,
  describeRootfsMode,
  SwiftSandbox,
} from "../api/kubeswift/swiftsandbox-v1alpha1";
import { noWarmCapTooltip, SwiftSandboxPool } from "../api/kubeswift/swiftsandboxpool-v1alpha1";
import { formatQuantity } from "../api/kubeswift/types";
import { withErrorPage } from "../components/error-page";
import { existingObjectRef, objectExists } from "../components/object-existence";
import { useReferenceStores } from "../components/reference-loader";
import { classifySandbox, classifySandboxPool } from "../components/sandbox-status";
import styles from "./swiftsandboxpool-details.module.scss";
import stylesInline from "./swiftsandboxpool-details.module.scss?inline";

import type { ReferenceRequest } from "../components/reference-loader";

const { observer } = MobxReact;

const {
  Component: {
    Badge,
    DrawerItem,
    DrawerTitle,
    KubeObjectConditionsDrawer,
    LinkToObject,
    LinkToSecret,
    Table,
    TableCell,
    TableHead,
    TableRow,
    WithTooltip,
  },
  K8sApi: { secretsStore },
} = Renderer;

const notAvailable = "N/A";

/**
 * What the pool's spec fields actually describe. Naming it in the section title
 * is not enough on its own: a reader arriving at "CPU: 2" needs to know it is
 * the CPU of every warm slot and of every sandbox that claims one, not a budget
 * the pool holds.
 */
const slotShapeTooltip =
  "These fields describe the shape of every warm slot. A SwiftSandbox must request the same shape to claim one, " +
  "and the memory is held per slot, so a pool of N slots holds N times this much idle";

/** Why the rootfs has no per-slot size: it is materialized once and shared. */
const sharedRootfsLabel = "Every warm slot of this image on the same node";

/**
 * The sizing fact an operator cannot recover from the numbers alone. A warm GPU
 * pool trades an idle GPU per slot for a sub-second checkout, which is a
 * deliberate trade rather than an accident, and the cluster's GPU count is the
 * ceiling it has to respect.
 */
const gpuSizingLabel = "Every warm slot holds one whole GPU idle";
const gpuSizingTooltip =
  "A warm GPU pool pre-boots each slot with its own native SwiftGPU allocation, so minWarm should not exceed the " +
  "number of GPUs the cluster can give it";

/** What the image environment is for, said once rather than per row. */
const imageEnvTooltip =
  "The pool image's own config environment, resolved once at materialize. A checkout merges the claiming " +
  "SwiftSandbox's spec.env over this, so the workload sees both";

interface SectionProps {
  object: SwiftSandboxPool;
}

/**
 * The pool itself: the verdict, the three counts and what the scale subresource
 * exposes. Always rendered, because a pool always has an image and a phase to
 * report (or the absence of one, which is itself the "Unknown" verdict).
 */
function PoolSection({ object }: SectionProps) {
  const condition = classifySandboxPool(object.status);
  const selector = SwiftSandboxPool.getSelector(object);
  const observedGeneration = SwiftSandboxPool.getObservedGeneration(object);

  return (
    <>
      <DrawerTitle>Pool</DrawerTitle>
      <DrawerItem name="Condition" labelsOnly>
        <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
      </DrawerItem>
      {/* The raw phase, since the badge above is a verdict and this is what
          `kubectl` shows. */}
      <DrawerItem name="Phase">
        <WithTooltip>{SwiftSandboxPool.getPhase(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Image">
        <WithTooltip>{SwiftSandboxPool.getImage(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Min Warm">
        <WithTooltip>{SwiftSandboxPool.getMinWarm(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* `0` and an absent value both mean "no cap beyond minWarm", so the row
          renders the sentinel rather than a bare zero that would read as a
          contradiction next to Min Warm (SPEC-0008). */}
      <DrawerItem name="Max Warm">
        <WithTooltip tooltip={noWarmCapTooltip}>{SwiftSandboxPool.getMaxWarmLabel(object)}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Warm">
        <WithTooltip>{SwiftSandboxPool.getWarmReplicas(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Claimed">
        <WithTooltip>{SwiftSandboxPool.getClaimedReplicas(object) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Observed Generation" hidden={observedGeneration === undefined}>
        <WithTooltip>{observedGeneration}</WithTooltip>
      </DrawerItem>
      {/* Shown, never parsed: the schema promises only "serialized as a
          string", so a parser keyed on the documented
          `sandbox.kubeswift.io/pool=<name>` form would be guessing at a
          contract. It tells an operator which pods are this pool's slots, and
          it is what makes `kubectl scale` and an HPA able to target the pool. */}
      <DrawerItem name="Slot Selector" hidden={!selector}>
        <WithTooltip>{selector}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/**
 * The shape of every warm slot - a workload-less sandbox - rather than the
 * pool's own resources. The workload (command, args, env, timeout, ttl) is
 * deliberately not in this schema: it belongs to the SwiftSandbox that checks a
 * slot out and is injected post-boot.
 */
const SlotShapeSection = observer(({ object }: SectionProps) => {
  const spec = object.spec;
  const namespace = object.getNs();
  const kernelName = spec?.kernelProfileRef?.name;
  const kernelStore = maybe(() => SwiftKernel.getStore<SwiftKernel>());
  const kernelRef = existingObjectRef(kernelStore, SwiftKernel.kind, kernelName, namespace);
  const nodeSelector = Object.entries(spec?.nodeSelector ?? {});
  const rootfsMode = spec?.rootfsMode;
  const networkMode = SwiftSandboxPool.getNetworkMode(object);
  const imagePullSecret = spec?.imagePullSecret;
  const verifyKeySecret = spec?.verifyKeySecretRef?.name;

  return (
    <>
      <DrawerTitle>Slot Shape</DrawerTitle>
      <DrawerItem name="CPU">
        <WithTooltip tooltip={slotShapeTooltip}>{spec?.cpu ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Memory">
        <WithTooltip tooltip={slotShapeTooltip}>{formatQuantity(spec?.memory) ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* The raw enum values, with the schema's own explanation of each in the
          tooltip. Both enums are the SwiftSandbox ones - the pool schema says
          so in as many words - so the readings are read from the same place
          rather than restated here. */}
      <DrawerItem name="Rootfs Mode">
        <WithTooltip tooltip={describeRootfsMode(rootfsMode)}>{rootfsMode ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Network Mode">
        <WithTooltip tooltip={describeNetworkMode(networkMode)}>{networkMode ?? notAvailable}</WithTooltip>
      </DrawerItem>
      {/* An unset profile is not a missing value here either: the controller
          applies the well-known "sandbox" kernel, and it is not linked because
          a guessed namespace would be a dead link. */}
      <DrawerItem name="Kernel Profile">
        {kernelName ? (
          kernelRef ? (
            <LinkToObject objectRef={kernelRef} object={object} />
          ) : (
            <WithTooltip>{kernelName}</WithTooltip>
          )
        ) : (
          <WithTooltip tooltip={defaultKernelTooltip}>{defaultKernelLabel}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Node Selector" hidden={nodeSelector.length === 0} labelsOnly>
        {nodeSelector.map(([key, value]) => (
          <Badge key={key} label={`${key}: ${value}`} />
        ))}
      </DrawerItem>
      <DrawerItem name="Image Pull Secret" hidden={!imagePullSecret}>
        {objectExists(secretsStore, imagePullSecret, namespace) ? (
          <LinkToSecret name={imagePullSecret} namespace={namespace} />
        ) : (
          <WithTooltip>{imagePullSecret}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Verify Key Secret" hidden={!verifyKeySecret}>
        {objectExists(secretsStore, verifyKeySecret, namespace) ? (
          <LinkToSecret name={verifyKeySecret} namespace={namespace} />
        ) : (
          <WithTooltip>{verifyKeySecret}</WithTooltip>
        )}
      </DrawerItem>
    </>
  );
});

/** The materialized OCI rootfs, reported once the pool image has been unpacked. */
function RootfsSection({ object }: SectionProps) {
  const rootfs = object.status?.rootfs;

  if (!rootfs) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Rootfs</DrawerTitle>
      {/* Stated first, because it is what makes the single size below correct:
          the pool materializes one rootfs per node, not one per slot. */}
      <DrawerItem name="Shared By">
        <WithTooltip>{sharedRootfsLabel}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Digest" hidden={!rootfs.digest}>
        <WithTooltip>{rootfs.digest}</WithTooltip>
      </DrawerItem>
      {/* An int64 byte count, humanized rather than shown as a digit run.
          `docs/crds.md` omits this field from the pool's status table; the
          schema does define it, and the schema wins (SPEC-0008). */}
      <DrawerItem name="Size" hidden={rootfs.sizeBytes === undefined}>
        <WithTooltip tooltip={rootfs.sizeBytes === undefined ? undefined : `${rootfs.sizeBytes} bytes`}>
          {SwiftSandboxPool.getRootfsSize(object)}
        </WithTooltip>
      </DrawerItem>
      <DrawerItem name="Cache Path" hidden={!rootfs.cachePath}>
        <WithTooltip>{rootfs.cachePath}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/**
 * The read-only model artifact preloaded into every slot. The pool has no
 * `status.model`, unlike the sandbox, so the section is the spec's two fields.
 */
function ModelSection({ object }: SectionProps) {
  const model = object.spec?.model;

  if (!model) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Model</DrawerTitle>
      <DrawerItem name="Image Ref">
        <WithTooltip>{model.imageRef ?? notAvailable}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Mount Path">
        <WithTooltip>{model.mountPath ?? notAvailable}</WithTooltip>
      </DrawerItem>
    </>
  );
}

/**
 * The native SwiftGPU allocation every slot pre-boots with. The pool has no DRA
 * backend and no GPU status of its own - both are the sandbox's - so this
 * section is the profile reference plus the sizing fact the numbers do not
 * carry.
 */
const GpuSection = observer(({ object }: SectionProps) => {
  if (!SwiftSandboxPool.hasGpu(object)) {
    return null;
  }

  const gpuProfileName = object.spec?.gpuProfileRef?.name;
  const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());
  const gpuProfileRef = existingObjectRef(gpuProfileStore, SwiftGPUProfile.kind, gpuProfileName, object.getNs());

  return (
    <>
      <DrawerTitle>GPU</DrawerTitle>
      <DrawerItem name="GPU Profile">
        {gpuProfileRef ? (
          <LinkToObject objectRef={gpuProfileRef} object={object} />
        ) : (
          <WithTooltip>{gpuProfileName}</WithTooltip>
        )}
      </DrawerItem>
      <DrawerItem name="Sizing">
        <WithTooltip tooltip={gpuSizingTooltip}>{gpuSizingLabel}</WithTooltip>
      </DrawerItem>
    </>
  );
});

/**
 * The pool image's own environment, which a checkout merges the claiming
 * sandbox's `spec.env` over. It explains what a sandbox will actually see, and
 * it is the only place that information exists outside the image config.
 */
function ImageEnvironmentSection({ object }: SectionProps) {
  const imageEnv = SwiftSandboxPool.getImageEnv(object);

  if (imageEnv.length === 0) {
    return null;
  }

  return (
    <>
      <DrawerTitle>Image Environment</DrawerTitle>
      <Table scrollable={false} sortSyncWithUrl={false} className={styles.imageEnv}>
        <TableHead flat sticky={false}>
          <TableCell className="name">Name</TableCell>
          <TableCell className="value">Value</TableCell>
        </TableHead>
        {imageEnv.map((variable, index) => (
          <TableRow key={`${index}-${variable.name}`} nowrap>
            <TableCell className="name">
              <WithTooltip tooltip={imageEnvTooltip}>{variable.name || notAvailable}</WithTooltip>
            </TableCell>
            {/* Split on the FIRST `=`: a value may itself contain one, and
                splitting on the last would corrupt it. An entry with no `=` at
                all has a name and no value, which is not the same as an empty
                one. */}
            <TableCell className="value">
              <WithTooltip>{variable.value ?? notAvailable}</WithTooltip>
            </TableCell>
          </TableRow>
        ))}
      </Table>
    </>
  );
}

/**
 * The sandboxes checked out of this pool. `spec.poolRef` is a
 * `LocalObjectReference`, so the search is namespace-local by construction and
 * the SwiftSandbox store is asked for exactly this pool's namespace rather than
 * for whatever the namespace filter happens to hold (DESIGN.md section 3, issue
 * #38). No `lookups` are declared: what the section renders is the result of
 * the listing itself, not a set of names known in advance.
 *
 * This is the SPEC-0007 "Guests Using This Profile" pattern, reused rather than
 * reinvented, with the sandbox classifier's badge in place of a raw phase - the
 * sandbox CRD reports conditions, so the verdict is available here too.
 */
const SandboxesUsingSection = observer(({ object }: SectionProps) => {
  const sandboxStore = maybe(() => SwiftSandbox.getStore<SwiftSandbox>());

  useReferenceStores([{ label: SwiftSandbox.crd.plural, store: sandboxStore, namespaces: [object.getNs()] }]);

  // Nothing is rendered while the store is still filling: an empty section
  // would read as "no sandbox uses this pool", which is a different statement
  // from "not known yet".
  if (!sandboxStore?.isLoaded) {
    return null;
  }

  const sandboxes = SwiftSandboxPool.getSandboxesUsing(object, sandboxStore.items);

  return (
    <>
      <DrawerTitle>Sandboxes Using This Pool</DrawerTitle>
      {sandboxes.length === 0 ? (
        <DrawerItem name="Sandboxes">
          <WithTooltip>No sandbox in this namespace references this pool</WithTooltip>
        </DrawerItem>
      ) : (
        <Table scrollable={false} sortSyncWithUrl={false} className={styles.sandboxes}>
          <TableHead flat sticky={false}>
            <TableCell className="name">Name</TableCell>
            <TableCell className="condition">Condition</TableCell>
            <TableCell className="node">Node</TableCell>
          </TableHead>
          {sandboxes.map((sandbox) => {
            const sandboxRef = existingObjectRef(sandboxStore, SwiftSandbox.kind, sandbox.getName(), sandbox.getNs());
            const condition = classifySandbox(sandbox.status);

            return (
              <TableRow key={sandbox.getId()} nowrap>
                <TableCell className="name">
                  {sandboxRef ? (
                    <LinkToObject objectRef={sandboxRef} object={object} />
                  ) : (
                    <WithTooltip>{sandbox.getName()}</WithTooltip>
                  )}
                </TableCell>
                <TableCell className="condition">
                  <Badge className={condition.className} label={condition.state} tooltip={condition.explanation} />
                </TableCell>
                <TableCell className="node">
                  <WithTooltip>{SwiftSandbox.getNodeName(sandbox) ?? notAvailable}</WithTooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      )}
    </>
  );
});

export interface SwiftSandboxPoolDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftSandboxPool> {
  extension: Renderer.LensExtension;
}

export const SwiftSandboxPoolDetails = observer((props: SwiftSandboxPoolDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const namespace = object.getNs();
    const secretNames = SwiftSandboxPool.getSecretNames(object);
    const kernelName = object.spec?.kernelProfileRef?.name;
    const gpuProfileName = object.spec?.gpuProfileRef?.name;
    const kernelStore = maybe(() => SwiftKernel.getStore<SwiftKernel>());
    const gpuProfileStore = maybe(() => SwiftGPUProfile.getStore<SwiftGPUProfile>());

    // Assembled conditionally, exactly as the SwiftSandbox drawer assembles
    // its own: a store whose references are all absent contributes no request,
    // so a pool with no secrets, no kernel profile and no GPU asks for nothing
    // here at all. The SwiftSandbox store the last section needs is declared by
    // that section itself, because it is a listing rather than a set of names
    // known in advance.
    const requests: ReferenceRequest<unknown>[] = [];

    if (secretNames.length > 0) {
      requests.push({
        label: "secrets",
        store: secretsStore,
        namespaces: [namespace],
        lookups: secretNames.map((name) => ({ name, namespace })),
      });
    }

    if (kernelName) {
      requests.push({
        label: SwiftKernel.crd.plural,
        store: kernelStore,
        namespaces: [namespace],
        lookups: [{ name: kernelName, namespace }],
      });
    }

    if (gpuProfileName) {
      requests.push({
        label: SwiftGPUProfile.crd.plural,
        store: gpuProfileStore,
        namespaces: [namespace],
        lookups: [{ name: gpuProfileName, namespace }],
      });
    }

    useReferenceStores(requests);

    return (
      <>
        <style>{stylesInline}</style>
        <PoolSection object={object} />
        <SlotShapeSection object={object} />
        <RootfsSection object={object} />
        <ModelSection object={object} />
        <GpuSection object={object} />
        <ImageEnvironmentSection object={object} />
        <SandboxesUsingSection object={object} />
        <KubeObjectConditionsDrawer object={object} />
      </>
    );
  }),
);

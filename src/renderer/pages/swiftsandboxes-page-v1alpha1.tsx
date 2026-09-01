import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftSandbox, type SwiftSandboxApi } from "../api/kubeswift/swiftsandbox-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { createSandboxTitle } from "../components/sandbox-create";
import { openCreateSandboxDialog } from "../components/sandbox-create-dialog";
import { classifySandbox, sandboxMessage } from "../components/sandbox-status";
import styles from "./swiftsandboxes-page.module.scss";
import stylesInline from "./swiftsandboxes-page.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { Badge, KubeObjectAge, KubeObjectListLayout, NamespaceSelectBadge, WithTooltip },
} = Renderer;

const KubeObject = SwiftSandbox;
type KubeObject = SwiftSandbox;
type KubeObjectApi = SwiftSandboxApi;

const notAvailable = "N/A";

const sortingCallbacks = {
  name: (object: KubeObject) => object.getName(),
  namespace: (object: KubeObject) => object.getNs(),
  image: (object: KubeObject) => KubeObject.getImage(object),
  node: (object: KubeObject) => KubeObject.getNodeName(object),
  // Sorted on the same text the cell shows, so a "None" sandbox sorts where the
  // user reads it rather than with the ones that have no address yet.
  ip: (object: KubeObject) => KubeObject.getAddressLabel(object),
  condition: (object: KubeObject) => classifySandbox(object.status).state,
  status: (object: KubeObject) => sandboxMessage(object.status),
  age: (object: KubeObject) => object.getCreationTimestamp(),
};

// The three domain columns are exactly the CRD's printer columns minus Phase,
// which the Condition/Status pair below says better; the raw phase stays in the
// drawer, where `kubectl`'s own value belongs, and the host's printer-column
// block shows it above our sections anyway (the SPEC-0007 rule, unchanged).
//
// This is the first list in the extension where the Status column carries the
// controller's own message rather than an explanation generated here: both M4
// CRDs report `metav1.Condition`s and a `status.message`, so DESIGN.md section
// 2's two-column pattern is honoured literally (SPEC-0008).
const renderTableHeader: { title: string; sortBy: keyof typeof sortingCallbacks; id: string; className?: string }[] = [
  { title: "Name", sortBy: "name", id: "name" },
  { title: "Namespace", sortBy: "namespace", id: "namespace" },
  { title: "Image", sortBy: "image", id: "image", className: styles.image },
  { title: "Node", sortBy: "node", id: "node", className: styles.node },
  { title: "IP", sortBy: "ip", id: "ip", className: styles.ip },
  { title: "Condition", sortBy: "condition", id: "condition", className: styles.condition },
  { title: "Status", sortBy: "status", id: "status", className: styles.status },
  { title: "Age", sortBy: "age", id: "age", className: styles.age },
];

export interface SwiftSandboxesPageProps {
  extension: Renderer.LensExtension;
}

export const SwiftSandboxesPage = observer((props: SwiftSandboxesPageProps) =>
  withErrorPage(props, () => {
    const store = KubeObject.getStore<KubeObject>();

    return (
      <>
        <style>{stylesInline}</style>
        <KubeObjectListLayout<KubeObject, KubeObjectApi>
          tableId={`${KubeObject.crd.plural}Table`}
          className={styles.page}
          store={store}
          sortingCallbacks={sortingCallbacks}
          searchFilters={[(object: KubeObject) => object.getSearchFields()]}
          renderHeaderTitle={KubeObject.crd.title}
          // The host's own floating create affordance, the idiom SPEC-0013
          // established and seven pages already carry: never a custom control
          // where a native one exists (DESIGN.md pillar 1). The stylesheet's
          // clearance rule goes with it.
          addRemoveButtons={{ onAdd: openCreateSandboxDialog, addTooltip: createSandboxTitle }}
          renderTableHeader={renderTableHeader}
          renderTableContents={(object: KubeObject) => {
            const condition = classifySandbox(object.status);

            return [
              <WithTooltip key="name">{object.getName()}</WithTooltip>,
              <NamespaceSelectBadge key="namespace" namespace={object.getNs()} />,
              // Digests are long, so the cell truncates and the tooltip carries
              // the whole reference.
              <WithTooltip key="image">{KubeObject.getImage(object) ?? notAvailable}</WithTooltip>,
              // Plain text here; the drawer turns it into a Node link.
              <WithTooltip key="node">{KubeObject.getNodeName(object) ?? notAvailable}</WithTooltip>,
              // Three states, not two: an address, "None" for a sandbox that
              // was deliberately given no network, and "N/A" for one that
              // should have an address and has not been given it yet.
              <WithTooltip key="ip" tooltip={KubeObject.getAddressTooltip(object)}>
                {KubeObject.getAddressLabel(object) ?? notAvailable}
              </WithTooltip>,
              <Badge key="condition" className={condition.className} label={condition.state} />,
              <WithTooltip key="status">{sandboxMessage(object.status)}</WithTooltip>,
              <KubeObjectAge object={object} key="age" />,
            ];
          }}
        />
      </>
    );
  }),
);

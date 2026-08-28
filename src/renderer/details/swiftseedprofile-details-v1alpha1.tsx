import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { type SwiftSeedDataSource, SwiftSeedProfile } from "../api/kubeswift/swiftseedprofile-v1alpha1";
import { withErrorPage } from "../components/error-page";
import { getBlobEditorHeight } from "../utils";
import styles from "./swiftseedprofile-details.module.scss";
import stylesInline from "./swiftseedprofile-details.module.scss?inline";

const { observer } = MobxReact;

const {
  Component: { DrawerItem, DrawerTitle, LinkToConfigMap, LinkToSecret, MonacoEditor, WithTooltip },
} = Renderer;

const notSet = "Not set";

interface SeedDocumentProps {
  title: string;
  namespace?: string;
  source?: SwiftSeedDataSource;
  /** Inline content, only present when the profile carries it in the spec. */
  value?: string;
}

/**
 * One cloud-init document: where it comes from and, when the spec carries it
 * inline, its content as a read-only code block. The content is never logged
 * and never rendered in a table cell.
 */
function SeedDocument({ title, namespace, source, value }: SeedDocumentProps) {
  return (
    <>
      <DrawerTitle>{title}</DrawerTitle>
      <DrawerItem name="Source">
        <WithTooltip>{source?.title ?? notSet}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Secret" hidden={source?.origin !== "secret"}>
        <LinkToSecret name={source?.name} namespace={namespace} />
      </DrawerItem>
      <DrawerItem name="ConfigMap" hidden={source?.origin !== "configMap"}>
        <LinkToConfigMap name={source?.name} namespace={namespace} />
      </DrawerItem>
      <DrawerItem name="Key" hidden={!source?.key}>
        <WithTooltip>{source?.key}</WithTooltip>
      </DrawerItem>
      <DrawerItem name="Optional" hidden={source?.optional === undefined}>
        <WithTooltip>{String(source?.optional)}</WithTooltip>
      </DrawerItem>
      {source?.origin === "inline" && value ? (
        <MonacoEditor
          readOnly
          className={styles.editor}
          style={{ minHeight: getBlobEditorHeight(value) }}
          value={value}
          setInitialHeight
          options={{
            scrollbar: {
              alwaysConsumeMouseWheel: false,
            },
          }}
        />
      ) : null}
    </>
  );
}

export interface SwiftSeedProfileDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftSeedProfile> {
  extension: Renderer.LensExtension;
}

export const SwiftSeedProfileDetails = observer((props: SwiftSeedProfileDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const namespace = object.getNs();

    return (
      <>
        <style>{stylesInline}</style>
        {/* The list page already shows the "Datasource" printer column (parity
            with `kubectl get`); a single-value field ("NoCloud" is the only
            option the CRD currently declares) does not earn its own drawer
            section here, and duplicating it under a "Seed Profile" title with
            no other content of its own was the #25 finding. Each document
            below carries its own title with real content instead. */}
        <SeedDocument
          title="User Data"
          namespace={namespace}
          source={SwiftSeedProfile.getUserDataSource(object)}
          value={spec?.userData}
        />
        <SeedDocument
          title="Meta Data"
          namespace={namespace}
          source={SwiftSeedProfile.getMetaDataSource(object)}
          value={spec?.metaData}
        />
        <SeedDocument
          title="Network Data"
          namespace={namespace}
          source={SwiftSeedProfile.getNetworkDataSource(object)}
          value={spec?.networkData}
        />
      </>
    );
  }),
);

import { Renderer } from "@freelensapp/extensions";
import * as MobxReact from "mobx-react";
import { SwiftGuestClass } from "../api/kubeswift/swiftguestclass-v1alpha1";
import { withErrorPage } from "../components/error-page";

const { observer } = MobxReact;

const {
  Component: { DrawerItem, DrawerTitle, LinkToStorageClass, WithTooltip },
} = Renderer;

const notAvailable = "N/A";

export interface SwiftGuestClassDetailsProps extends Renderer.Component.KubeObjectDetailsProps<SwiftGuestClass> {
  extension: Renderer.LensExtension;
}

export const SwiftGuestClassDetails = observer((props: SwiftGuestClassDetailsProps) =>
  withErrorPage(props, () => {
    const { object } = props;
    const spec = object.spec;
    const storage = spec?.storage;

    return (
      <>
        <DrawerTitle>Resources</DrawerTitle>
        <DrawerItem name="CPU">
          <WithTooltip>{SwiftGuestClass.getCpu(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Memory">
          <WithTooltip>{SwiftGuestClass.getMemory(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Core Scheduling">
          <WithTooltip>{SwiftGuestClass.getCoreScheduling(object)}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Root Disk</DrawerTitle>
        <DrawerItem name="Size">
          <WithTooltip>{SwiftGuestClass.getRootDiskSize(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Format">
          <WithTooltip>{SwiftGuestClass.getRootDiskFormat(object) ?? notAvailable}</WithTooltip>
        </DrawerItem>

        <DrawerTitle>Storage Defaults</DrawerTitle>
        <DrawerItem name="Access Mode">
          <WithTooltip>{storage?.accessMode ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Volume Mode">
          <WithTooltip>{storage?.volumeMode ?? notAvailable}</WithTooltip>
        </DrawerItem>
        <DrawerItem name="Storage Class" hidden={!storage?.storageClassName}>
          <LinkToStorageClass name={storage?.storageClassName} />
        </DrawerItem>
      </>
    );
  }),
);

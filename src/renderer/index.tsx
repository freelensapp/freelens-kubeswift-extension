/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest as SwiftGuestV1alpha1 } from "./api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestDetails as SwiftGuestDetailsV1alpha1 } from "./details/swiftguest-details-v1alpha1";
import { KubeSwiftIcon } from "./icons/kubeswift";
import { SwiftGuestsPage as SwiftGuestsPageV1alpha1 } from "./pages/swiftguests-page-v1alpha1";

/**
 * Renderer-process entry point of the extension.
 *
 * The KubeSwift resource views are being implemented milestone by milestone
 * (see `docs/development/ROADMAP.md`); each one registers itself here through
 * `kubeObjectDetailItems`, `clusterPages`, and `clusterPageMenus`.
 */
export default class KubeSwiftRenderer extends Renderer.LensExtension {
  kubeObjectDetailItems = [
    {
      kind: SwiftGuestV1alpha1.kind,
      apiVersions: SwiftGuestV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftGuestDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
  ];

  clusterPages = [
    {
      id: "swiftguests",
      components: {
        Page: () => <SwiftGuestsPageV1alpha1 extension={this} />,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "kubeswift",
      title: "KubeSwift",
      components: {
        Icon: KubeSwiftIcon,
      },
    },
    {
      // Sub-items of a sidebar group are rendered without their own icon.
      id: "swiftguests",
      parentId: "kubeswift",
      title: SwiftGuestV1alpha1.crd.title,
      target: { pageId: "swiftguests" },
      components: {},
    },
  ];
}

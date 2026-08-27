/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
import { SwiftGuest as SwiftGuestV1alpha1 } from "./api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestClass as SwiftGuestClassV1alpha1 } from "./api/kubeswift/swiftguestclass-v1alpha1";
import { SwiftGuestPool as SwiftGuestPoolV1alpha1 } from "./api/kubeswift/swiftguestpool-v1alpha1";
import { SwiftImage as SwiftImageV1alpha1 } from "./api/kubeswift/swiftimage-v1alpha1";
import { SwiftKernel as SwiftKernelV1alpha1 } from "./api/kubeswift/swiftkernel-v1alpha1";
import { SwiftSeedProfile as SwiftSeedProfileV1alpha1 } from "./api/kubeswift/swiftseedprofile-v1alpha1";
import { SwiftGuestDetails as SwiftGuestDetailsV1alpha1 } from "./details/swiftguest-details-v1alpha1";
import { SwiftGuestClassDetails as SwiftGuestClassDetailsV1alpha1 } from "./details/swiftguestclass-details-v1alpha1";
import { SwiftGuestPoolDetails as SwiftGuestPoolDetailsV1alpha1 } from "./details/swiftguestpool-details-v1alpha1";
import { SwiftImageDetails as SwiftImageDetailsV1alpha1 } from "./details/swiftimage-details-v1alpha1";
import { SwiftKernelDetails as SwiftKernelDetailsV1alpha1 } from "./details/swiftkernel-details-v1alpha1";
import { SwiftSeedProfileDetails as SwiftSeedProfileDetailsV1alpha1 } from "./details/swiftseedprofile-details-v1alpha1";
import { KubeSwiftIcon } from "./icons/kubeswift";
import { SwiftGuestClassesPage as SwiftGuestClassesPageV1alpha1 } from "./pages/swiftguestclasses-page-v1alpha1";
import { SwiftGuestPoolsPage as SwiftGuestPoolsPageV1alpha1 } from "./pages/swiftguestpools-page-v1alpha1";
import { SwiftGuestsPage as SwiftGuestsPageV1alpha1 } from "./pages/swiftguests-page-v1alpha1";
import { SwiftImagesPage as SwiftImagesPageV1alpha1 } from "./pages/swiftimages-page-v1alpha1";
import { SwiftKernelsPage as SwiftKernelsPageV1alpha1 } from "./pages/swiftkernels-page-v1alpha1";
import { SwiftSeedProfilesPage as SwiftSeedProfilesPageV1alpha1 } from "./pages/swiftseedprofiles-page-v1alpha1";

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
    {
      kind: SwiftGuestClassV1alpha1.kind,
      apiVersions: SwiftGuestClassV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftGuestClassDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftGuestPoolV1alpha1.kind,
      apiVersions: SwiftGuestPoolV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftGuestPoolDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftImageV1alpha1.kind,
      apiVersions: SwiftImageV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftImageDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftSeedProfileV1alpha1.kind,
      apiVersions: SwiftSeedProfileV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftSeedProfileDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftKernelV1alpha1.kind,
      apiVersions: SwiftKernelV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftKernelDetailsV1alpha1 {...props} extension={this} />
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
    {
      id: "swiftguestclasses",
      components: {
        Page: () => <SwiftGuestClassesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftguestpools",
      components: {
        Page: () => <SwiftGuestPoolsPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftimages",
      components: {
        Page: () => <SwiftImagesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftseedprofiles",
      components: {
        Page: () => <SwiftSeedProfilesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftkernels",
      components: {
        Page: () => <SwiftKernelsPageV1alpha1 extension={this} />,
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
    // Sub-items of a sidebar group are rendered without their own icon.
    {
      id: "swiftguests",
      parentId: "kubeswift",
      title: SwiftGuestV1alpha1.crd.title,
      target: { pageId: "swiftguests" },
      components: {},
    },
    {
      id: "swiftguestclasses",
      parentId: "kubeswift",
      title: SwiftGuestClassV1alpha1.crd.title,
      target: { pageId: "swiftguestclasses" },
      components: {},
    },
    {
      id: "swiftguestpools",
      parentId: "kubeswift",
      title: SwiftGuestPoolV1alpha1.crd.title,
      target: { pageId: "swiftguestpools" },
      components: {},
    },
    {
      id: "swiftimages",
      parentId: "kubeswift",
      title: SwiftImageV1alpha1.crd.title,
      target: { pageId: "swiftimages" },
      components: {},
    },
    {
      id: "swiftseedprofiles",
      parentId: "kubeswift",
      title: SwiftSeedProfileV1alpha1.crd.title,
      target: { pageId: "swiftseedprofiles" },
      components: {},
    },
    {
      id: "swiftkernels",
      parentId: "kubeswift",
      title: SwiftKernelV1alpha1.crd.title,
      target: { pageId: "swiftkernels" },
      components: {},
    },
  ];
}

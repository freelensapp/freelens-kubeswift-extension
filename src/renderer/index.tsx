/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Renderer } from "@freelensapp/extensions";
// The kind is `Cluster`; the class is `FleetCluster` because an import named
// `Cluster` here would shadow the most overloaded noun in the host's vocabulary
// for every future reader of this file (SPEC-0009).
import { FleetCluster as FleetClusterV1alpha1 } from "./api/kubeswift/fleetcluster-v1alpha1";
import { SwiftGPUNode as SwiftGPUNodeV1alpha1 } from "./api/kubeswift/swiftgpunode-v1alpha1";
import { SwiftGPUProfile as SwiftGPUProfileV1alpha1 } from "./api/kubeswift/swiftgpuprofile-v1alpha1";
import { SwiftGuest as SwiftGuestV1alpha1 } from "./api/kubeswift/swiftguest-v1alpha1";
import { SwiftGuestClass as SwiftGuestClassV1alpha1 } from "./api/kubeswift/swiftguestclass-v1alpha1";
import { SwiftGuestPool as SwiftGuestPoolV1alpha1 } from "./api/kubeswift/swiftguestpool-v1alpha1";
import { SwiftImage as SwiftImageV1alpha1 } from "./api/kubeswift/swiftimage-v1alpha1";
import { SwiftKernel as SwiftKernelV1alpha1 } from "./api/kubeswift/swiftkernel-v1alpha1";
import { SwiftMigration as SwiftMigrationV1alpha1 } from "./api/kubeswift/swiftmigration-v1alpha1";
import { SwiftRestore as SwiftRestoreV1alpha1 } from "./api/kubeswift/swiftrestore-v1alpha1";
import { SwiftSandbox as SwiftSandboxV1alpha1 } from "./api/kubeswift/swiftsandbox-v1alpha1";
import { SwiftSandboxPool as SwiftSandboxPoolV1alpha1 } from "./api/kubeswift/swiftsandboxpool-v1alpha1";
import { SwiftSeedProfile as SwiftSeedProfileV1alpha1 } from "./api/kubeswift/swiftseedprofile-v1alpha1";
import { SwiftSnapshot as SwiftSnapshotV1alpha1 } from "./api/kubeswift/swiftsnapshot-v1alpha1";
import { SwiftSnapshotSchedule as SwiftSnapshotScheduleV1alpha1 } from "./api/kubeswift/swiftsnapshotschedule-v1alpha1";
import { FleetClusterDetails as FleetClusterDetailsV1alpha1 } from "./details/fleetcluster-details-v1alpha1";
import { SwiftGPUNodeDetails as SwiftGPUNodeDetailsV1alpha1 } from "./details/swiftgpunode-details-v1alpha1";
import { SwiftGPUProfileDetails as SwiftGPUProfileDetailsV1alpha1 } from "./details/swiftgpuprofile-details-v1alpha1";
import { SwiftGuestDetails as SwiftGuestDetailsV1alpha1 } from "./details/swiftguest-details-v1alpha1";
import { SwiftGuestClassDetails as SwiftGuestClassDetailsV1alpha1 } from "./details/swiftguestclass-details-v1alpha1";
import { SwiftGuestPoolDetails as SwiftGuestPoolDetailsV1alpha1 } from "./details/swiftguestpool-details-v1alpha1";
import { SwiftImageDetails as SwiftImageDetailsV1alpha1 } from "./details/swiftimage-details-v1alpha1";
import { SwiftKernelDetails as SwiftKernelDetailsV1alpha1 } from "./details/swiftkernel-details-v1alpha1";
import { SwiftMigrationDetails as SwiftMigrationDetailsV1alpha1 } from "./details/swiftmigration-details-v1alpha1";
import { SwiftRestoreDetails as SwiftRestoreDetailsV1alpha1 } from "./details/swiftrestore-details-v1alpha1";
import { SwiftSandboxDetails as SwiftSandboxDetailsV1alpha1 } from "./details/swiftsandbox-details-v1alpha1";
import { SwiftSandboxPoolDetails as SwiftSandboxPoolDetailsV1alpha1 } from "./details/swiftsandboxpool-details-v1alpha1";
import { SwiftSeedProfileDetails as SwiftSeedProfileDetailsV1alpha1 } from "./details/swiftseedprofile-details-v1alpha1";
import { SwiftSnapshotDetails as SwiftSnapshotDetailsV1alpha1 } from "./details/swiftsnapshot-details-v1alpha1";
import { SwiftSnapshotScheduleDetails as SwiftSnapshotScheduleDetailsV1alpha1 } from "./details/swiftsnapshotschedule-details-v1alpha1";
import { KubeSwiftIcon } from "./icons/kubeswift";
import { SwiftGuestStartMenuItem as SwiftGuestStartMenuItemV1alpha1 } from "./menus/swiftguest-start-menu-item-v1alpha1";
import { SwiftGuestStopMenuItem as SwiftGuestStopMenuItemV1alpha1 } from "./menus/swiftguest-stop-menu-item-v1alpha1";
import { FleetClustersPage as FleetClustersPageV1alpha1 } from "./pages/fleetclusters-page-v1alpha1";
import { SwiftGPUNodesPage as SwiftGPUNodesPageV1alpha1 } from "./pages/swiftgpunodes-page-v1alpha1";
import { SwiftGPUProfilesPage as SwiftGPUProfilesPageV1alpha1 } from "./pages/swiftgpuprofiles-page-v1alpha1";
import { SwiftGuestClassesPage as SwiftGuestClassesPageV1alpha1 } from "./pages/swiftguestclasses-page-v1alpha1";
import { SwiftGuestPoolsPage as SwiftGuestPoolsPageV1alpha1 } from "./pages/swiftguestpools-page-v1alpha1";
import { SwiftGuestsPage as SwiftGuestsPageV1alpha1 } from "./pages/swiftguests-page-v1alpha1";
import { SwiftImagesPage as SwiftImagesPageV1alpha1 } from "./pages/swiftimages-page-v1alpha1";
import { SwiftKernelsPage as SwiftKernelsPageV1alpha1 } from "./pages/swiftkernels-page-v1alpha1";
import { SwiftMigrationsPage as SwiftMigrationsPageV1alpha1 } from "./pages/swiftmigrations-page-v1alpha1";
import { SwiftRestoresPage as SwiftRestoresPageV1alpha1 } from "./pages/swiftrestores-page-v1alpha1";
import { SwiftSandboxesPage as SwiftSandboxesPageV1alpha1 } from "./pages/swiftsandboxes-page-v1alpha1";
import { SwiftSandboxPoolsPage as SwiftSandboxPoolsPageV1alpha1 } from "./pages/swiftsandboxpools-page-v1alpha1";
import { SwiftSeedProfilesPage as SwiftSeedProfilesPageV1alpha1 } from "./pages/swiftseedprofiles-page-v1alpha1";
import { SwiftSnapshotsPage as SwiftSnapshotsPageV1alpha1 } from "./pages/swiftsnapshots-page-v1alpha1";
import { SwiftSnapshotSchedulesPage as SwiftSnapshotSchedulesPageV1alpha1 } from "./pages/swiftsnapshotschedules-page-v1alpha1";

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
    {
      kind: SwiftSnapshotV1alpha1.kind,
      apiVersions: SwiftSnapshotV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftSnapshotDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftRestoreV1alpha1.kind,
      apiVersions: SwiftRestoreV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftRestoreDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftSnapshotScheduleV1alpha1.kind,
      apiVersions: SwiftSnapshotScheduleV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftSnapshotScheduleDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftMigrationV1alpha1.kind,
      apiVersions: SwiftMigrationV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftMigrationDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftGPUProfileV1alpha1.kind,
      apiVersions: SwiftGPUProfileV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftGPUProfileDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftGPUNodeV1alpha1.kind,
      apiVersions: SwiftGPUNodeV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftGPUNodeDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftSandboxV1alpha1.kind,
      apiVersions: SwiftSandboxV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftSandboxDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftSandboxPoolV1alpha1.kind,
      apiVersions: SwiftSandboxPoolV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <SwiftSandboxPoolDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
    // The one registration in this list whose kind is not unique in the
    // Kubernetes ecosystem. The host matches on kind AND apiVersion
    // (`kubeObjectMatchesToKindAndApiVersion`), so a Cluster API
    // (`cluster.x-k8s.io`) or a Rancher Fleet (`fleet.cattle.io`) object of the
    // same kind never receives this drawer, and ours never receives theirs.
    {
      kind: FleetClusterV1alpha1.kind,
      apiVersions: FleetClusterV1alpha1.crd.apiVersions,
      priority: 10,
      components: {
        Details: (props: Renderer.Component.KubeObjectDetailsProps<any>) => (
          <FleetClusterDetailsV1alpha1 {...props} extension={this} />
        ),
      },
    },
  ];

  // The extension's first write surface (M6, SPEC-0010). Two registrations
  // rather than one component emitting two items: the host's optional `visible`
  // flag is a registration-level `IComputedValue` with no access to the object,
  // so it cannot express a per-object guard anyway, and one file per verb keeps
  // each guard, each dialog and each error message next to the code that uses
  // it. The host renders one registration in BOTH surfaces - the list row kebab
  // (`renderItemMenu`) and the detail drawer's toolbar (`toolbar={true}`) - so
  // the two can never drift apart.
  //
  // No Delete of our own: the host already renders one for every kind this
  // extension registers a store for, in both surfaces, and two items labelled
  // Delete in one kebab is a worse outcome than one generic message. What the
  // extension adds instead - who owns this guest, and what its deletion
  // cascades to - lives in the drawer, where it owns the surface.
  //
  // Matching is on kind AND full apiVersion, so no other project's SwiftGuest
  // could ever receive these.
  kubeObjectMenuItems = [
    {
      kind: SwiftGuestV1alpha1.kind,
      apiVersions: SwiftGuestV1alpha1.crd.apiVersions,
      components: {
        MenuItem: (props: { object: any; toolbar?: boolean }) => (
          <SwiftGuestStartMenuItemV1alpha1 {...props} extension={this} />
        ),
      },
    },
    {
      kind: SwiftGuestV1alpha1.kind,
      apiVersions: SwiftGuestV1alpha1.crd.apiVersions,
      components: {
        MenuItem: (props: { object: any; toolbar?: boolean }) => (
          <SwiftGuestStopMenuItemV1alpha1 {...props} extension={this} />
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
    {
      id: "swiftsnapshots",
      components: {
        Page: () => <SwiftSnapshotsPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftrestores",
      components: {
        Page: () => <SwiftRestoresPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftsnapshotschedules",
      components: {
        Page: () => <SwiftSnapshotSchedulesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftmigrations",
      components: {
        Page: () => <SwiftMigrationsPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftgpuprofiles",
      components: {
        Page: () => <SwiftGPUProfilesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftgpunodes",
      components: {
        Page: () => <SwiftGPUNodesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftsandboxes",
      components: {
        Page: () => <SwiftSandboxesPageV1alpha1 extension={this} />,
      },
    },
    {
      id: "swiftsandboxpools",
      components: {
        Page: () => <SwiftSandboxPoolsPageV1alpha1 extension={this} />,
      },
    },
    // `fleetclusters` rather than `clusters`: page ids are already namespaced
    // per extension by the host (`/extension/<id>/<pageId>`), so this is not a
    // collision fix but a readability one - the E2E and pre-review test ids
    // read unambiguously in failure output.
    {
      id: "fleetclusters",
      components: {
        Page: () => <FleetClustersPageV1alpha1 extension={this} />,
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
    // Group parents never navigate on click (they only expand), but each one
    // still needs a target so the page-top tab bar (which shows the visible
    // children of the active root item) has somewhere to send the click: it
    // points at the group's first leaf page. Sub-items are rendered without
    // their own icon.
    {
      id: "kubeswift-guests",
      parentId: "kubeswift",
      title: "Guests",
      target: { pageId: "swiftguests" },
      components: {},
    },
    {
      id: "swiftguests",
      parentId: "kubeswift-guests",
      title: SwiftGuestV1alpha1.crd.title,
      target: { pageId: "swiftguests" },
      components: {},
    },
    {
      id: "swiftguestclasses",
      parentId: "kubeswift-guests",
      title: SwiftGuestClassV1alpha1.crd.title,
      target: { pageId: "swiftguestclasses" },
      components: {},
    },
    {
      id: "swiftguestpools",
      parentId: "kubeswift-guests",
      title: SwiftGuestPoolV1alpha1.crd.title,
      target: { pageId: "swiftguestpools" },
      components: {},
    },
    {
      id: "kubeswift-boot-and-images",
      parentId: "kubeswift",
      title: "Boot and Images",
      target: { pageId: "swiftimages" },
      components: {},
    },
    {
      id: "swiftimages",
      parentId: "kubeswift-boot-and-images",
      title: SwiftImageV1alpha1.crd.title,
      target: { pageId: "swiftimages" },
      components: {},
    },
    {
      id: "swiftkernels",
      parentId: "kubeswift-boot-and-images",
      title: SwiftKernelV1alpha1.crd.title,
      target: { pageId: "swiftkernels" },
      components: {},
    },
    {
      id: "swiftseedprofiles",
      parentId: "kubeswift-boot-and-images",
      title: SwiftSeedProfileV1alpha1.crd.title,
      target: { pageId: "swiftseedprofiles" },
      components: {},
    },
    {
      id: "kubeswift-data-protection",
      parentId: "kubeswift",
      title: "Data Protection",
      target: { pageId: "swiftsnapshots" },
      components: {},
    },
    {
      id: "swiftsnapshots",
      parentId: "kubeswift-data-protection",
      title: SwiftSnapshotV1alpha1.crd.title,
      target: { pageId: "swiftsnapshots" },
      components: {},
    },
    {
      id: "swiftrestores",
      parentId: "kubeswift-data-protection",
      title: SwiftRestoreV1alpha1.crd.title,
      target: { pageId: "swiftrestores" },
      components: {},
    },
    {
      id: "swiftsnapshotschedules",
      parentId: "kubeswift-data-protection",
      title: SwiftSnapshotScheduleV1alpha1.crd.title,
      target: { pageId: "swiftsnapshotschedules" },
      components: {},
    },
    {
      id: "kubeswift-migrations",
      parentId: "kubeswift",
      title: "Migrations",
      target: { pageId: "swiftmigrations" },
      components: {},
    },
    {
      id: "swiftmigrations",
      parentId: "kubeswift-migrations",
      title: SwiftMigrationV1alpha1.crd.title,
      target: { pageId: "swiftmigrations" },
      components: {},
    },
    // Appended after the existing groups, in the order the roadmap introduces
    // the domains: every entry a user found here last time stays where it was
    // (SPEC-0007).
    {
      id: "kubeswift-gpu",
      parentId: "kubeswift",
      title: "GPU",
      target: { pageId: "swiftgpuprofiles" },
      components: {},
    },
    {
      id: "swiftgpuprofiles",
      parentId: "kubeswift-gpu",
      title: SwiftGPUProfileV1alpha1.crd.title,
      target: { pageId: "swiftgpuprofiles" },
      components: {},
    },
    // Profiles come first inside the group (and are therefore its target): a
    // profile is the object a user authors and looks for by name, while the
    // node inventory is consulted when something does not schedule (SPEC-0007).
    {
      id: "swiftgpunodes",
      parentId: "kubeswift-gpu",
      title: SwiftGPUNodeV1alpha1.crd.title,
      target: { pageId: "swiftgpunodes" },
      components: {},
    },
    // The sixth group, appended after "GPU" for the same reason "GPU" was
    // appended after the first four (SPEC-0008). Its title repeats its first
    // leaf's, deliberately: the group is the domain and the leaf is the kind,
    // and here the domain is named after its principal kind - the same shape as
    // the "Migrations" group shipped in M2, and as core's own "Config" holding
    // "Config Maps".
    {
      id: "kubeswift-sandboxes",
      parentId: "kubeswift",
      title: "Sandboxes",
      target: { pageId: "swiftsandboxes" },
      components: {},
    },
    // Sandboxes come first inside the group (and are therefore its target): the
    // sandbox is the object a user creates, watches and troubleshoots, while a
    // pool is infrastructure consulted when checkouts are slow.
    {
      id: "swiftsandboxes",
      parentId: "kubeswift-sandboxes",
      title: SwiftSandboxV1alpha1.crd.title,
      target: { pageId: "swiftsandboxes" },
      components: {},
    },
    {
      id: "swiftsandboxpools",
      parentId: "kubeswift-sandboxes",
      title: SwiftSandboxPoolV1alpha1.crd.title,
      target: { pageId: "swiftsandboxpools" },
      components: {},
    },
    // The seventh group, appended after "Sandboxes" for the same reason every
    // group since "GPU" was appended after the last one (SPEC-0009). It holds a
    // single leaf, which SPEC-0007 rejected elsewhere: the M3 objection was to
    // splitting a two-CRD domain across two groups, and the one-leaf group was
    // the symptom. Nothing is split here - `fleet.kubeswift.io` contains
    // exactly one CRD, and no other group could hold it without misfiling it.
    {
      id: "kubeswift-fleet",
      parentId: "kubeswift",
      title: "Fleet",
      target: { pageId: "fleetclusters" },
      components: {},
    },
    // Titled "Member Clusters" and not the plain humanization of the kind: core
    // registers a root sidebar item titled exactly "Cluster", and the catalog
    // outside the cluster frame calls kubeconfig entries "Clusters", so a leaf
    // titled "Clusters" would sit a few pixels from both. The qualifier is the
    // schema's own first words (declared deviation, SPEC-0009, written into
    // DESIGN.md section 4 by the same PR).
    {
      id: "fleetclusters",
      parentId: "kubeswift-fleet",
      title: FleetClusterV1alpha1.crd.title,
      target: { pageId: "fleetclusters" },
      components: {},
    },
  ];
}

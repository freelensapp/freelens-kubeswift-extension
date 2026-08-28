/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The KubeSwift views the pre-review pass (SPEC-0006) walks through, one
// entry per `clusterPages`/`clusterPageMenus` registration of
// src/renderer/index.tsx, in menu order.
//
// This list is hand-maintained rather than imported from that file: it is
// JSX bundled for the renderer process and is not reachable from the
// Node/Playwright context that drives a *built* Freelens (this suite runs
// inside a checkout of freelensapp/freelens, against the packed extension
// tarball, not against this repository's TypeScript sources). Keeping the
// two in sync is a manual step for now - see "Notes and deviations" in
// docs/specs/SPEC-0006-pre-review-agent-pass.md for the plan to close this
// gap (e.g. a small views manifest emitted at build time).

export interface KubeSwiftView {
  /** `clusterPages`/`clusterPageMenus` id in src/renderer/index.tsx. */
  menuId: string;
  /** Page header title (`h5`), also `clusterPageMenus[].title`. */
  title: string;
  /** Name of one fixture object of this kind (see e2e/fixtures), whose detail drawer the pass opens. */
  fixtureObject: string;
}

export const KUBESWIFT_VIEWS: KubeSwiftView[] = [
  { menuId: "swiftguests", title: "Guests", fixtureObject: "e2e-guest-running" },
  { menuId: "swiftguestclasses", title: "Guest Classes", fixtureObject: "e2e-small" },
  { menuId: "swiftguestpools", title: "Guest Pools", fixtureObject: "e2e-pool" },
  { menuId: "swiftimages", title: "Images", fixtureObject: "e2e-ubuntu-2404" },
  { menuId: "swiftseedprofiles", title: "Seed Profiles", fixtureObject: "e2e-seed-basic" },
  { menuId: "swiftkernels", title: "Kernels", fixtureObject: "e2e-kernel-6-12" },
  { menuId: "swiftsnapshots", title: "Snapshots", fixtureObject: "e2e-snapshot-ready" },
  { menuId: "swiftrestores", title: "Restores", fixtureObject: "e2e-restore-clone" },
  { menuId: "swiftsnapshotschedules", title: "Snapshot Schedules", fixtureObject: "e2e-schedule-nightly" },
  { menuId: "swiftmigrations", title: "Migrations", fixtureObject: "e2e-migration-completed" },
];

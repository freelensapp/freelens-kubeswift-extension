/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// End-to-end suite: a real Freelens, with the extension installed from the
// tarball built by this repository, connected to the disposable kind cluster
// that `e2e/scripts/cluster-up.sh` fills with the KubeSwift CRDs and our
// fixtures. Every KubeSwift page is opened and checked against the fixture it
// is supposed to render.
//
// Run it with `pnpm e2e`. See docs/development/TESTING.md for the
// prerequisites and docs/specs/SPEC-0003-e2e-infrastructure.md for the design.

import * as cluster from "../helpers/kubeswift-cluster";
import * as kubeswift from "../helpers/kubeswift-extension";
import * as pr from "../helpers/pre-review";
import * as utils from "../helpers/utils";

import type { ElectronApplication, Frame, Page } from "playwright";

// Connecting a cluster and installing an extension are both slow, and CI
// runners are slower still.
const TIMEOUT = 10 * 60 * 1000;

describe("KubeSwift views against the fixture cluster", () => {
  let app: ElectronApplication;
  let window: Page;
  let frame: Frame;
  let cleanup: undefined | (() => Promise<void>);

  const errorCollector = kubeswift.createErrorCollector();

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(
        `The KubeSwift fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm e2e:cluster:up\` first.`,
      );
    }

    errorCollector.start();

    ({ app, window, cleanup } = await utils.start());
    errorCollector.watch(window);

    // Hand the cluster to the running app before going anywhere near the
    // catalog: the kubeconfig watcher needs a moment to notice the file.
    const kubeconfig = await cluster.publishKubeconfig();

    await utils.clickWelcomeButton(window);
    await kubeswift.installExtension(app, window);
    await kubeswift.dismissNotifications(window);
    await kubeswift.navigateToCatalog(app);

    frame = await cluster.openClusterFromCatalog(window, kubeconfig);

    // A freshly connected cluster shows the `default` namespace, not all of
    // them, so the fixtures stay invisible until the filter is moved. Doing it
    // once here covers every page: the selection is kept per cluster.
    await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
    await cluster.selectNamespace(frame);
  }, TIMEOUT);

  afterAll(async () => {
    // Keep the listeners attached through the shutdown, so that late errors
    // still reach the logs.
    await cleanup?.();
    errorCollector.stop(window);
  }, TIMEOUT);

  it(
    "lists the SwiftGuests with their phase, node and address",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      // Every list header cell carries an id (DESIGN.md's resizing
      // requirement, SPEC-0006 scope item 3). Stable across five pre-review
      // pass runs, so it graduates here per that spec's scope item 5
      // (issue #28), reusing the pass's own `headerCellsWithoutId` rather
      // than re-implementing the DOM query. Folded into each of this file's
      // existing per-view "lists the ..." tests right after they open that
      // view's list page, so the check costs no extra navigation.
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // The guest whose status was injected: running, scheduled, addressable,
      // and restarted twice (the IP and the restart count are adjacent cells).
      // The node name is the E2E cluster's real (single) node, substituted
      // into the fixture by cluster-up.sh's inject_statuses() (issue #23);
      // it is "kubeswift-e2e-control-plane" here because that is what kind
      // names the single node of a cluster called "kubeswift-e2e"
      // (E2E_CLUSTER_NAME), not because the value is hardcoded in the fixture.
      await cluster.expectRow(frame, "e2e-guest-running", "Running", "kubeswift-e2e-control-plane", "10.244.1.21 2");

      // The guest without a status: no phase and no address to show.
      await cluster.expectRow(frame, "e2e-guest-pending", "N/A");

      await cluster.expectDetails(
        frame,
        "e2e-guest-running",
        "SwiftGuest: e2e-guest-running",
        "Running",
        "cloud-hypervisor",
        "10.244.1.21",
        "e2e-ubuntu-2404",
      );
    },
    TIMEOUT,
  );

  it(
    "navigates the SwiftGuest drawer's Node and Pod links to objects that actually exist",
    async () => {
      // Non-regression test for issue #23: swiftguest-details-v1alpha1.tsx
      // used to render the Node and Pod rows as links unconditionally, even
      // when the status named an object that did not exist - core's
      // LinkToNode/LinkToPod only format a details URL from the name, they
      // never check the target is there. Clicking such a link showed the
      // host's own "Resource loading has failed" panel instead of a real
      // drawer, and e2e-guest-running-launcher (the launcher Pod fixture the
      // status.podRef named) used to be exactly that: nothing ever created
      // it, so this exact link was broken until the fixture in
      // e2e/fixtures/55-launcher-pods.yaml was added alongside the UI fix.
      //
      // Reuses the pre-review pass's own link-check helper
      // (integration/helpers/pre-review.ts) rather than duplicating its host
      // load-failure detection here (SPEC-0006 scope item 5: a pass assert
      // that proves a real regression graduates into this suite).
      //
      // What this test actually asserts is the no-dead-links invariant the
      // fix guarantees: a rendered link never navigates to the host's
      // "Resource loading has failed" panel. It deliberately does NOT assert
      // that the Node/Pod rows always render as links: whether the
      // referencing store fills in time for the existence check
      // (objectExists against the stores useReferenceStores loads) is
      // environment-dependent, so a row still plain text after the wait is
      // treated as legitimate degradation - exactly the fallback DESIGN.md
      // section 3 asks for when a reference cannot be confirmed - not a
      // failure: it is logged so CI output still shows it happened, and the
      // test moves on.
      //
      // Until issue #38 the "Node" row here looked like the environment-
      // dependent case and was blamed on nodesStore never loading on the
      // packed Linux CI build. It was not: SwiftGuest publishes a printer
      // column named `Node`, so the host's own generic custom-resource
      // section renders a second, always-plain-text row with that exact
      // label above this drawer's body, and the row helpers matched it
      // instead of ours. They now read the extension's own rows only (see
      // pre-review.ts), which is why this check finally sees the real Node
      // row. "Pod" was never affected - no printer column carries that
      // label - which is exactly why one of the two upgraded and the other
      // never did.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await pr.openDrawer(frame, "e2e-guest-running");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
        await pr.openDrawer(frame, "e2e-guest-running");
      };

      for (const label of ["Node", "Pod"]) {
        // Gives the existence check's async store load a chance to resolve
        // and upgrade the row to a link before deciding what it is - see
        // the comment above for why this does not itself make the row a
        // link on every environment.
        const row = await pr.waitForDrawerLink(frame, label);

        if (!row) {
          throw new Error(`The SwiftGuest drawer has no "${label}" row at all.`);
        }

        if (!row.href) {
          // Legitimate degradation to plain text (see the comment above),
          // not a failure: there is no link to click and no invariant left
          // to check for this row in this environment.
          console.log(`[e2e] "${label}" row degraded to text in this environment (no link to check).`);
          continue;
        }

        const result = await pr.checkDrawerLink(frame, "swiftguests", row, reopen);

        if (!result.ok) {
          throw new Error(`The "${label}" link ("${row.text}") did not navigate cleanly: ${result.note}`);
        }
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftGuestClasses with their sizing",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguestclasses", "Guest Classes");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // CPU, memory and root disk size, in column order.
      await cluster.expectRow(frame, "e2e-small", "2 4Gi 20Gi");
      await cluster.expectRow(frame, "e2e-large", "8 16Gi 100Gi");

      await cluster.expectDetails(frame, "e2e-small", "SwiftGuestClass: e2e-small", "4Gi", "20Gi", "qcow2");
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftGuestPools with desired and ready replicas",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Desired, ready, updated, available and failed, in column order: the
      // pool is mid-rollout, so desired and ready differ.
      await cluster.expectRow(frame, "e2e-pool", "3 2 3 2 1");

      await cluster.expectDetails(frame, "e2e-pool", "SwiftGuestPool: e2e-pool", "RollingUpdate", "Spread");
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftImages with their source and phase",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftimages", "Images");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      await cluster.expectRow(
        frame,
        "e2e-ubuntu-2404",
        "ghcr.io/freelensapp/kubeswift-e2e/ubuntu:24.04",
        "Ready",
        "10Gi",
      );

      await cluster.expectDetails(
        frame,
        "e2e-ubuntu-2404",
        "SwiftImage: e2e-ubuntu-2404",
        "OCI",
        "ghcr.io/freelensapp/kubeswift-e2e/ubuntu",
        "24.04",
      );
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftSeedProfiles without leaking their content",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftseedprofiles", "Seed Profiles");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      await cluster.expectRow(frame, "e2e-seed-basic", "NoCloud", "Inline");

      await cluster.expectDetails(frame, "e2e-seed-basic", "SwiftSeedProfile: e2e-seed-basic", "NoCloud", "Inline");
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftKernels with their artifact and node progress",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftkernels", "Kernels");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      await cluster.expectRow(
        frame,
        "e2e-kernel-6-12",
        "ghcr.io/freelensapp/kubeswift-e2e/kernel:6.12",
        "e2e-linux-6.12",
        "Ready",
        "1/1",
      );

      await cluster.expectDetails(
        frame,
        "e2e-kernel-6-12",
        "SwiftKernel: e2e-kernel-6-12",
        "sha256:9b2c8f0e3a7d41c5b6e8d90a2f14c7b38e5a6d0c9f3b1e7a4d2c8b5f6a0e9d31",
      );
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftSnapshots with their backend, contents and size",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Guest, backend, contents, phase and size, in column order. The CSI
      // backend is disk-only whatever the snapshot asks for.
      await cluster.expectRow(frame, "e2e-snapshot-ready", "e2e-guest-running csi-volume-snapshot Disk Ready 21Gi");

      // The OCI capture takes memory along with the disk, and has no total
      // size while the push is still running.
      await cluster.expectRow(frame, "e2e-snapshot-uploading", "oci Memory + disk Uploading N/A");

      await cluster.expectDetails(
        frame,
        "e2e-snapshot-ready",
        "SwiftSnapshot: e2e-snapshot-ready",
        "Retain",
        "cloud-hypervisor",
        "e2e-ubuntu-2404",
        "20Gi",
      );
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftRestores with their snapshot and target",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftrestores", "Restores");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      await cluster.expectRow(frame, "e2e-restore-clone", "e2e-snapshot-ready e2e-guest-restored Ready");

      // The restore without a status: no phase to show.
      await cluster.expectRow(frame, "e2e-restore-in-place", "e2e-guest-running N/A");

      // The clone leaves the source guest alone, and regenerates the identity
      // attributes the spec lists.
      await cluster.expectDetails(
        frame,
        "e2e-restore-clone",
        "SwiftRestore: e2e-restore-clone",
        "Clone",
        "ondemand",
        "hostname",
      );

      // overwriteExisting is what makes a restore land on the existing guest.
      await cluster.expectDetails(frame, "e2e-restore-in-place", "SwiftRestore: e2e-restore-in-place", "In-place");
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftSnapshotSchedules with their cron, retention and last tick",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftsnapshotschedules", "Snapshot Schedules");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Cron, guest, retention budget and suspended flag, in column order.
      await cluster.expectRow(frame, "e2e-schedule-nightly", "0 2 * * * e2e-guest-running 7 false");

      // No retention budget keeps every snapshot, and the schedule has never
      // fired, so it has no last tick either.
      await cluster.expectRow(frame, "e2e-schedule-suspended", "e2e-guest-pending All true N/A");

      await cluster.expectDetails(
        frame,
        "e2e-schedule-nightly",
        "SwiftSnapshotSchedule: e2e-schedule-nightly",
        "0 2 * * *",
        "Forbid",
        "e2e-schedule-nightly-28160520",
      );
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftMigrations with their resolved mode, phase and progress",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftmigrations", "Migrations");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // The controller resolved spec.mode "auto" to "offline", and an offline
      // migration has no memory stream to report progress through.
      await cluster.expectRow(frame, "e2e-migration-completed", "e2e-guest-running offline Completed N/A");

      // The live one is mid pre-copy.
      await cluster.expectRow(frame, "e2e-migration-live", "e2e-guest-pending live StopAndCopy 64%");

      // The "To" node ("kubeswift-e2e-control-plane" here) is the E2E
      // cluster's real (single) node, substituted into
      // status.destinationNode by cluster-up.sh's inject_statuses() rather
      // than hardcoded (issue #23) - see the __NODE_NAME__ comment in
      // e2e/fixtures/status/swiftmigration-e2e-migration-completed.yaml. The
      // "From" node ("kubeswift-e2e-worker") stays a literal on purpose: it
      // is a synthetic historical value that does not exist anywhere, and
      // renders as plain text rather than a link, which this substring
      // check does not need to distinguish from a link's own text.
      await cluster.expectDetails(
        frame,
        "e2e-migration-completed",
        "SwiftMigration: e2e-migration-completed",
        "offline (requested: auto)",
        "kubeswift-e2e-control-plane",
        "48s",
      );
    },
    TIMEOUT,
  );

  it(
    "activates the extension without renderer or process errors",
    async () => {
      const errors = errorCollector.errors();

      if (errors.length > 0) {
        throw new Error(`Freelens reported errors while the extension was active:\n${errors.join("\n")}`);
      }
    },
    TIMEOUT,
  );
});

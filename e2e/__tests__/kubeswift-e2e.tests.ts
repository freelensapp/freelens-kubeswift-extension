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
      // Both rows must be links, and both links must land on real content.
      // The fixture guarantees the two referenced objects exist: the guest's
      // status.nodeName is substituted with the E2E cluster's real node by
      // cluster-up.sh's inject_statuses(), and its status.podRef names the
      // launcher Pod of e2e/fixtures/55-launcher-pods.yaml. So there are two
      // stacked asserts here - the row upgraded to a link at all (the
      // reference store behind objectExists really loaded), and the link
      // navigates to a real drawer rather than the host's "Resource loading
      // has failed" panel (the no-dead-links invariant of the fix above).
      //
      // This test used to let a row that stayed plain text pass, logging it
      // as environment-dependent degradation, because the "Node" row never
      // upgraded on the packed Linux CI build and nobody knew why. Issue #38
      // found two independent reasons and fixed both: the row helpers were
      // matching the host's own copy of the "Node" label (Freelens core
      // renders one always-plain-text row per CRD additionalPrinterColumns
      // entry above this drawer's body, and SwiftGuest publishes a column
      // named `Node`; "Pod" has no such column, which is exactly why only
      // one of the two ever looked broken), and the one-shot store load
      // behind the existence check could silently load nothing. pre-review.ts
      // now reads the extension's own rows only, and useReferenceStores
      // retries and subscribes until the store fills. The CI run of that fix
      // showed both rows upgrading and navigating cleanly, so the allowance
      // is gone: a missing link here is a regression, not the environment.
      //
      // What this does NOT tighten: references that point at objects which
      // do not exist by fixture design must still degrade to plain text
      // (DESIGN.md section 3). SwiftMigration's "From" node is the
      // deliberate case (see the comment in
      // e2e/fixtures/status/swiftmigration-e2e-migration-completed.yaml and
      // the SwiftMigration test below); the decision itself is unit-tested
      // in src/renderer/components/object-existence.test.ts. Only rows whose
      // target the fixture guarantees are held to the stricter rule here.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await pr.openDrawer(frame, "e2e-guest-running");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
        await pr.openDrawer(frame, "e2e-guest-running");
      };

      for (const label of ["Node", "Pod"]) {
        // Bounded wait for the existence check's async store load to resolve
        // and upgrade the row to a link, so a slow runner is not read as a
        // missing link.
        const row = await pr.waitForDrawerLink(frame, label);

        if (!row) {
          throw new Error(`The SwiftGuest drawer has no "${label}" row at all.`);
        }

        if (!row.href) {
          throw new Error(
            `The SwiftGuest drawer's "${label}" row ("${row.text}") stayed plain text: the fixture makes the referenced object exist, so the row must render as a link.`,
          );
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
    "navigates the SwiftGuest drawer's GPU Profile and GPU Node links to the objects M3 registers",
    async () => {
      // The rows M1 rendered as plain text because their kinds were not
      // registered yet, and M3 turned into existence-checked links
      // (SPEC-0007's "reach into the existing views"). Both are checked here
      // rather than left to the pre-review pass, because between them they
      // cover the two shapes of a `LinkToObject` target this extension builds:
      // GPU Profile is namespaced, GPU Node is the first cluster-scoped one,
      // and a cluster-scoped ref carries no namespace at all - which core's
      // `lookupApiLink` fills in from the parent object before handing it to
      // the api, so nothing but a real click proves the resulting URL is the
      // cluster-scoped one.
      //
      // e2e-guest-gpu is the fixture that has both: a gpuProfileRef to
      // e2e-gpu-profile-hgx, and an injected status.gpu.nodeName pointing at
      // the cluster's real node, which is also the name of the SwiftGPUNode
      // fixture (see 120-swiftgpunodes.yaml).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await pr.openDrawer(frame, "e2e-guest-gpu");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
        await pr.openDrawer(frame, "e2e-guest-gpu");
      };

      for (const label of ["GPU Profile", "GPU Node"]) {
        const row = await pr.waitForDrawerLink(frame, label);

        if (!row) {
          throw new Error(`The SwiftGuest drawer has no "${label}" row at all.`);
        }

        if (!row.href) {
          throw new Error(
            `The SwiftGuest drawer's "${label}" row ("${row.text}") stayed plain text: the fixture makes the referenced object exist, so the row must render as a link.`,
          );
        }

        const result = await pr.checkDrawerLink(frame, "swiftguests", row, reopen);

        if (!result.ok) {
          throw new Error(`The "${label}" link ("${row.text}") did not navigate cleanly: ${result.note}`);
        }
      }

      // The rest of the GPU section, which M1 typed and never showed.
      await cluster.closeDetails(frame);
      await cluster.expectDetails(
        frame,
        "e2e-guest-gpu",
        "SwiftGuest: e2e-guest-gpu",
        "0000:41:00.0",
        "GPU Hypervisor",
        "qemu",
        "0, 1",
      );
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
    "lists the SwiftGPUProfiles with their count, model and tier",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftgpuprofiles", "GPU Profiles");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Count, model, partition mode and tier, in column order: the CRD's own
      // printer columns. The profile has no status at all (the CRD declares
      // `subresources: {}`), so this list has no Condition and no Status
      // column to assert - see SPEC-0007 for that declared deviation.
      await cluster.expectRow(frame, "e2e-gpu-profile-pcie", "1 L40S isolated pcie");

      // The full profile's model filter is the empty string, which the schema
      // uses for "any model matches": a fact, not a missing value, so the cell
      // reads "Any" rather than "N/A".
      await cluster.expectRow(frame, "e2e-gpu-profile-hgx", "4 Any shared hgx-shared");

      // "Guests Using This Profile" renders only once the SwiftGuest store
      // reports isLoaded for this namespace (SPEC-0007: a section that renders
      // nothing while the store fills, rather than claiming the profile is
      // unused), so its row is waited for instead of being read in one shot,
      // which would race that load on a slow runner. Once the row is there the
      // store is filled and the whole-drawer read below is deterministic.
      await pr.openDrawer(frame, "e2e-gpu-profile-hgx");
      await frame
        .locator(".Drawer.KubeObjectDetails .TableRow", { hasText: "e2e-guest-gpu" })
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      await cluster.closeDetails(frame);

      // The full drawer: the humanized reading next to each enum, the
      // per-socket memory converted from the MiB the schema counts in (256Gi,
      // never the raw 262144), and where Fabric Manager runs.
      await cluster.expectDetails(
        frame,
        "e2e-gpu-profile-hgx",
        "SwiftGPUProfile: e2e-gpu-profile-hgx",
        "Any",
        "hgx-shared (tier 2",
        "256Gi",
        "Host",
        "Guests Using This Profile",
        "e2e-guest-gpu",
      );

      // The minimal profile carries no optional block: the two sections that
      // guard themselves are gone, and the NUMA one says what an absent block
      // means instead of showing four empty rows.
      await cluster.expectDetails(
        frame,
        "e2e-gpu-profile-pcie",
        "SwiftGPUProfile: e2e-gpu-profile-pcie",
        "L40S",
        "pcie (tier 1",
        "Flat: the guest gets a single NUMA node",
      );
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftGPUNodes with their inventory and condition",
    async () => {
      // The ready node is named after the cluster's real (single) node, since
      // that is what a SwiftGPUNode is: the substitution happens in
      // cluster-up.sh's apply_fixtures(), because `metadata.name` cannot be
      // patched afterwards. Read from the cluster rather than hardcoded, as
      // the whole row identity depends on it.
      const nodeName = cluster.clusterNodeName();

      await cluster.openKubeSwiftPage(frame, "swiftgpunodes", "GPU Nodes");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // GPUs, free, model, VFIO and the condition badge, in column order. The
      // list is cluster-scoped, so there is no Namespace cell between the name
      // and the counts.
      await cluster.expectRow(frame, nodeName, "8 3 H200-SXM True Ready", "vfio-pci is loaded");

      // Discovery failed on the other one and reported no inventory at all, so
      // every domain cell falls back to "N/A" and the condition is the
      // classifier's Error, with the explanation it generates in place of the
      // condition message this CRD does not have.
      await cluster.expectRow(frame, "e2e-gpu-node-absent", "N/A N/A N/A False Error", "Discovery reported an error");

      // The whole drawer of the ready node: the per-device table read against
      // lspci, the largest BAR and the NUMA memory humanized from the MiB the
      // schema counts in (128Gi and 512Gi, never the raw digit runs), the
      // hugepages pair, and the Fabric Manager partition with the guest
      // holding it.
      await cluster.expectDetails(
        frame,
        nodeName,
        `SwiftGPUNode: ${nodeName}`,
        "Ready",
        "H200-SXM",
        "12 of 64",
        "0000:41:00.0",
        "128Gi",
        "512Gi",
        "560.35.03",
        "kubeswift-e2e/e2e-guest-gpu",
      );

      // Every section of the drawer guards itself, so the node that reported
      // nothing but a phase shows the two that always apply and none of the
      // four that describe an inventory it does not have.
      await pr.openDrawer(frame, "e2e-gpu-node-absent");

      const sections = await frame.$$eval(".Drawer.KubeObjectDetails .DrawerTitle", (elements) =>
        elements.map((element) => element.textContent?.trim() ?? ""),
      );

      for (const present of ["Discovery", "Inventory"]) {
        if (!sections.includes(present)) {
          throw new Error(
            `The SwiftGPUNode drawer should always have a "${present}" section, got: ${sections.join(", ")}`,
          );
        }
      }

      for (const absent of ["GPUs", "Host", "NVSwitches", "Fabric Manager"]) {
        if (sections.includes(absent)) {
          throw new Error(
            `The "${absent}" section must guard itself away on a node that reports no inventory, got: ${sections.join(", ")}`,
          );
        }
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "navigates the SwiftGPUNode drawer's Node and guest links to objects that actually exist",
    async () => {
      // Same shape as the SwiftGuest case above, on the two reference kinds
      // this drawer resolves: the Node the object is named after, and the
      // SwiftGuest an `allocatedTo` value names. Both are guaranteed by the
      // fixtures, so a row that stays plain text here is a regression.
      //
      // The third assert is the opposite one, and it is what makes the fixture
      // pair worth having: the GPU allocated to a guest that deliberately does
      // not exist must stay plain text. `allocatedTo` is a "namespace/name"
      // string rather than an object reference, so nothing in the host would
      // stop the drawer from rendering a link to a guest that was deleted
      // (DESIGN.md section 3, the rule issue #23 established for Node and Pod).
      const nodeName = cluster.clusterNodeName();
      const allocatedGuest = "kubeswift-e2e/e2e-guest-gpu";
      const deletedGuest = "kubeswift-e2e/e2e-guest-deleted";

      await cluster.openKubeSwiftPage(frame, "swiftgpunodes", "GPU Nodes");
      await pr.openDrawer(frame, nodeName);

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftgpunodes", "GPU Nodes");
        await pr.openDrawer(frame, nodeName);
      };

      const nodeRow = await pr.waitForDrawerLink(frame, "Node");

      if (!nodeRow) {
        throw new Error('The SwiftGPUNode drawer has no "Node" row at all.');
      }

      if (!nodeRow.href) {
        throw new Error(
          `The SwiftGPUNode drawer's "Node" row ("${nodeRow.text}") stayed plain text: the object is named after a node that exists, so the row must render as a link.`,
        );
      }

      const nodeResult = await pr.checkDrawerLink(frame, "swiftgpunodes", nodeRow, reopen);

      if (!nodeResult.ok) {
        throw new Error(`The "Node" link ("${nodeRow.text}") did not navigate cleanly: ${nodeResult.note}`);
      }

      // The guest links live in the nested per-device table, not in a
      // `DrawerItem` row, so they are read from the drawer directly rather
      // than through the row helpers. The wait is the same bounded one those
      // helpers do: the link appears once the SwiftGuest store has filled.
      const guestLink = frame.locator(".Drawer.KubeObjectDetails a", { hasText: allocatedGuest }).first();

      await guestLink.waitFor({ state: "visible", timeout: 60_000 });

      const guestHref = await guestLink.getAttribute("href");
      const guestResult = await pr.checkDrawerLink(
        frame,
        "swiftgpunodes",
        { label: "Allocated To", text: allocatedGuest, href: guestHref },
        reopen,
      );

      if (!guestResult.ok) {
        throw new Error(`The "Allocated To" link ("${allocatedGuest}") did not navigate cleanly: ${guestResult.note}`);
      }

      const deletedCell = frame.locator(".Drawer.KubeObjectDetails .TableCell", { hasText: deletedGuest }).first();

      await deletedCell.waitFor({ state: "visible", timeout: 60_000 });

      const deletedLinks = await deletedCell.locator("a").count();

      if (deletedLinks !== 0) {
        throw new Error(`"${deletedGuest}" names a guest the fixtures never create, so it must stay plain text.`);
      }

      await cluster.closeDetails(frame);
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

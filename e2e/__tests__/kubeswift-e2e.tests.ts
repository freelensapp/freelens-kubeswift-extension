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
    "lists the SwiftSandboxes with their image, node and condition",
    async () => {
      // The node the running sandbox was scheduled on is the E2E cluster's real
      // (single) node, substituted into the fixture by cluster-up.sh's
      // inject_statuses() rather than hardcoded (issue #23).
      const nodeName = cluster.clusterNodeName();

      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Image, node, IP and the condition badge, in column order. The Status
      // column carries the controller's own words - here the message of the
      // newest condition, since this fixture writes no status.message - which
      // is what makes M4 the first milestone to implement DESIGN.md section 2's
      // two-column pattern literally (SPEC-0008).
      await cluster.expectRow(
        frame,
        "e2e-sandbox-running",
        "kubeswift-e2e/sandbox@sha256:3f7a1c9e",
        nodeName,
        "10.244.3.17 Running",
        "The guest booted and the workload is running",
      );

      // The minimal sandbox: no node, and an IP cell that reads "None" rather
      // than "N/A" because network mode "none" means the absent address is a
      // chosen configuration and not a missing value. Its Status column shows
      // the controller's own status.message, the first rung of the ladder.
      await cluster.expectRow(frame, "e2e-sandbox-failed", "N/A None Failed", "Materializing the rootfs failed");

      // The pooled one wrote neither a message nor a condition, so the Status
      // column falls all the way back to the classifier's own explanation - the
      // last rung - and Completed is a success, not a warning.
      await cluster.expectRow(
        frame,
        "e2e-sandbox-pooled",
        "Completed",
        "The workload ran to completion with exit code 0",
      );

      // Neither a running nor a completed sandbox is a warning: they share the
      // host's `success` class and the badge word carries the difference. That
      // is the SPEC-0008 judgement call, and this is what pins it.
      //
      // The badge is found by the class the classifier hands it, not by a
      // `.Badge` selector: core's `Badge` is a CSS-module component, so its own
      // class name is hashed at build time and only the `className` the
      // extension passes survives verbatim. `allInnerTexts` does not wait, so a
      // regression reports the classes that are there instead of timing out.
      const successBadges = await frame
        .locator(".TableRow", { hasText: "e2e-sandbox-pooled" })
        .first()
        .locator(".success")
        .allInnerTexts();

      if (!successBadges.some((text) => text.trim() === "Completed")) {
        throw new Error(
          `The Completed badge must carry the host's "success" class, got: ${JSON.stringify(successBadges)}`,
        );
      }

      // The full drawer: the rootfs size humanized from the int64 byte count
      // (1.5Gi, never the raw digit run), the scratch disk named by its source,
      // the GPU backend stated rather than inferred, the derived Duration the
      // CRD does not report, and the environment table.
      await cluster.expectDetails(
        frame,
        "e2e-sandbox-running",
        "SwiftSandbox: e2e-sandbox-running",
        "1.5Gi",
        "Blank",
        "100Gi",
        "Native SwiftGPU",
        "0000:41:00.0",
        "SANDBOX_MODE",
        "e2e-sandbox-cosign",
      );

      // The completed one is where the derived Duration renders at all: it is
      // computed from startedAt and terminalAt, which nothing else reports.
      await cluster.expectDetails(
        frame,
        "e2e-sandbox-pooled",
        "SwiftSandbox: e2e-sandbox-pooled",
        "Completed",
        "48s",
        // The claimed slot's pod, named after the POOL: a checkout injects this
        // sandbox into a pre-booted slot, so the launcher pod is not named
        // after the sandbox and the drawer never derives the name.
        "e2e-sandbox-pool-slot-1",
      );

      // Every section of the drawer guards itself, so the sandbox that carries
      // nothing but its two required fields shows the two that always apply and
      // none of the six that describe a block it does not have.
      await pr.openDrawer(frame, "e2e-sandbox-failed");

      const sections = await frame.$$eval(".Drawer.KubeObjectDetails .DrawerTitle", (elements) =>
        elements.map((element) => element.textContent?.trim() ?? ""),
      );

      for (const present of ["Sandbox", "Guest"]) {
        if (!sections.includes(present)) {
          throw new Error(
            `The SwiftSandbox drawer should always have a "${present}" section, got: ${sections.join(", ")}`,
          );
        }
      }

      for (const absent of ["Runtime", "Rootfs", "Model", "Scratch Disk", "GPU", "Environment"]) {
        if (sections.includes(absent)) {
          throw new Error(
            `The "${absent}" section must guard itself away on a sandbox that has no such block, got: ${sections.join(", ")}`,
          );
        }
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "navigates the SwiftSandbox drawer's pool, kernel, GPU and launcher pod links to objects that actually exist",
    async () => {
      // Same shape as the SwiftGuest and SwiftGPUNode cases above, on the four
      // reference kinds this drawer resolves and whose targets the fixtures
      // guarantee: the SwiftKernel of spec.kernelProfileRef, the
      // SwiftGPUProfile of spec.gpuProfileRef, the SwiftGPUNode named by
      // status.gpu.nodeName, and the launcher Pod named by status.podRef.
      //
      // The launcher pod is the one worth spelling out: status.podRef is a
      // bare string on this CRD, not the ObjectReference SwiftGuest carries, so
      // nothing in the host would stop the drawer from building a link to a pod
      // that is not there.
      //
      // Storage Class is the fifth kind, added by the M4 milestone review: the
      // scratch disk's spec.scratchDisk.blank.storageClassName is "standard",
      // the StorageClass every kind cluster ships, so the row must be a live
      // link rather than the plain text it rendered when the slice merged
      // (SPEC-0008, "Milestone review follow-up").
      //
      // The Pool row is checked further down, on e2e-sandbox-pooled: poolRef is
      // exclusive with both GPU backends by the documented webhook rules, so
      // the sandbox that has a pool is never the one that has a GPU and the two
      // halves cannot share a fixture.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await pr.openDrawer(frame, "e2e-sandbox-running");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
        await pr.openDrawer(frame, "e2e-sandbox-running");
      };

      for (const label of ["Kernel Profile", "GPU Profile", "GPU Node", "Node", "Launcher Pod", "Storage Class"]) {
        const row = await pr.waitForDrawerLink(frame, label);

        if (!row) {
          throw new Error(`The SwiftSandbox drawer has no "${label}" row at all.`);
        }

        if (!row.href) {
          throw new Error(
            `The SwiftSandbox drawer's "${label}" row ("${row.text}") stayed plain text: the fixture makes the referenced object exist, so the row must render as a link.`,
          );
        }

        const result = await pr.checkDrawerLink(frame, "swiftsandboxes", row, reopen);

        if (!result.ok) {
          throw new Error(`The "${label}" link ("${row.text}") did not navigate cleanly: ${result.note}`);
        }
      }

      await cluster.closeDetails(frame);

      // The Pool row, on the sandbox that has one. M4 slice 1 rendered it as
      // plain text because SwiftSandboxPool was not a registered kind yet;
      // slice 2 registers it and adds the e2e-sandbox-pool fixture this
      // sandbox's spec.poolRef already named, so the row must now be a live
      // link. A pooled sandbox routinely outlives the pool it claimed a slot
      // from, which is exactly why the row is existence-checked rather than
      // linked unconditionally.
      await pr.openDrawer(frame, "e2e-sandbox-pooled");

      const reopenPooled = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
        await pr.openDrawer(frame, "e2e-sandbox-pooled");
      };

      const poolRow = await pr.waitForDrawerLink(frame, "Pool");

      if (!poolRow) {
        throw new Error('The SwiftSandbox drawer has no "Pool" row at all.');
      }

      if (!poolRow.href) {
        throw new Error(
          `The SwiftSandbox drawer's "Pool" row ("${poolRow.text}") stayed plain text: the fixture makes the pool exist, so the row must render as a link.`,
        );
      }

      const poolResult = await pr.checkDrawerLink(frame, "swiftsandboxes", poolRow, reopenPooled);

      if (!poolResult.ok) {
        throw new Error(`The "Pool" link ("${poolRow.text}") did not navigate cleanly: ${poolResult.note}`);
      }

      await cluster.closeDetails(frame);

      // The opposite assert, and what makes the fixture pair worth having: the
      // minimal sandbox names no kernel profile at all, so its row must read
      // the controller-applied default as plain text rather than link to a
      // namespace this extension would have had to guess (SPEC-0008).
      await pr.openDrawer(frame, "e2e-sandbox-failed");

      const rows = await pr.inspectDrawerRows(frame);
      const kernelRow = rows.find((row) => row.label === "Kernel Profile");

      if (!kernelRow) {
        throw new Error('The SwiftSandbox drawer has no "Kernel Profile" row at all.');
      }

      if (kernelRow.href) {
        throw new Error(
          `"${kernelRow.text}" is the controller-applied default, which no object in this namespace corresponds to, so it must stay plain text.`,
        );
      }

      if (!kernelRow.text.includes("sandbox (default)")) {
        throw new Error(`The "Kernel Profile" row should read the default, got "${kernelRow.text}".`);
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "lists the SwiftSandboxPools with their warm and claimed counts",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Image, then the three counts in the CRD's own printer-column order -
      // desired, actual, in use - then the condition badge. The gap between the
      // first two is the health of the pool, which is why they are adjacent
      // (SPEC-0008). Warm plus claimed is not a conserved total: a claimed slot
      // is never returned to the pool, so 2 warm and 1 claimed is not a
      // contradiction.
      await cluster.expectRow(
        frame,
        "e2e-sandbox-pool",
        "kubeswift-e2e/sandbox:warm",
        "2 2 1 Ready",
        "Two warm slots are ready and one is checked out",
      );

      // The degraded one holds no warm slot at all against the minWarm of 1 the
      // API server defaulted (the fixture declares none, which is what makes
      // this row also the assert that the default arrives). Its Status column is
      // the second rung of the message ladder, and the only place in this suite
      // that exercises it: the newest condition is the True one, and the False
      // one is still what an operator needs to read.
      await cluster.expectRow(frame, "e2e-sandbox-pool-degraded", "1 0 0 Degraded", "No schedulable kernel node");

      // Degraded is an error, not a warning: the pool's whole purpose is the
      // sub-second checkout, and one that is not holding its warm buffer is not
      // delivering it. That is the SPEC-0008 judgement call, and this is what
      // pins it.
      //
      // The badge is found by the class the classifier hands it, not by a
      // `.Badge` selector: core's `Badge` is a CSS-module component, so its own
      // class name is hashed at build time and only the `className` the
      // extension passes survives verbatim.
      const errorBadges = await frame
        .locator(".TableRow", { hasText: "e2e-sandbox-pool-degraded" })
        .first()
        .locator(".error")
        .allInnerTexts();

      if (!errorBadges.some((text) => text.trim() === "Degraded")) {
        throw new Error(`The Degraded badge must carry the host's "error" class, got: ${JSON.stringify(errorBadges)}`);
      }

      // "Sandboxes Using This Pool" renders only once the SwiftSandbox store
      // reports isLoaded for this namespace (the SPEC-0007 pattern: a section
      // that renders nothing while the store fills, rather than claiming the
      // pool is unused), so its row is waited for instead of being read in one
      // shot, which would race that load on a slow runner.
      await pr.openDrawer(frame, "e2e-sandbox-pool");
      await frame
        .locator(".Drawer.KubeObjectDetails .TableRow", { hasText: "e2e-sandbox-pooled" })
        .first()
        .waitFor({ state: "visible", timeout: 60_000 });
      await cluster.closeDetails(frame);

      // The full drawer: the shared rootfs size humanized from the int64 byte
      // count (768Mi, never the raw digit run), the slot selector the scale
      // subresource exposes, the image environment split on the FIRST `=` of
      // each entry, and the sandbox that claimed a slot.
      await cluster.expectDetails(
        frame,
        "e2e-sandbox-pool",
        "SwiftSandboxPool: e2e-sandbox-pool",
        "Ready",
        "Every warm slot of this image on the same node",
        "768Mi",
        "sandbox.kubeswift.io/pool=e2e-sandbox-pool",
        "Image Environment",
        // Splitting this entry on its last `=` would corrupt it into
        // "SANDBOX_OPTS=--warm" plus "true".
        "SANDBOX_OPTS",
        "--warm=true",
        "Sandboxes Using This Pool",
        "e2e-sandbox-pooled",
      );

      // The minimal pool: maxWarm is absent, which the schema defines as "no
      // cap beyond minWarm" rather than as a missing value, so the row must
      // read the sentinel and not a bare 0. Nothing references it, so the last
      // section says so explicitly instead of rendering an empty table.
      await cluster.expectDetails(
        frame,
        "e2e-sandbox-pool-degraded",
        "SwiftSandboxPool: e2e-sandbox-pool-degraded",
        "Degraded",
        "No cap",
        "No sandbox in this namespace references this pool",
      );

      // Every section of the drawer guards itself, so the pool that carries
      // nothing but its two required fields and a phase shows the two that
      // always apply and none of the four that describe a block it does not
      // have.
      await pr.openDrawer(frame, "e2e-sandbox-pool-degraded");

      const sections = await frame.$$eval(".Drawer.KubeObjectDetails .DrawerTitle", (elements) =>
        elements.map((element) => element.textContent?.trim() ?? ""),
      );

      for (const present of ["Pool", "Slot Shape"]) {
        if (!sections.includes(present)) {
          throw new Error(
            `The SwiftSandboxPool drawer should always have a "${present}" section, got: ${sections.join(", ")}`,
          );
        }
      }

      for (const absent of ["Rootfs", "Model", "GPU", "Image Environment"]) {
        if (sections.includes(absent)) {
          throw new Error(
            `The "${absent}" section must guard itself away on a pool that has no such block, got: ${sections.join(", ")}`,
          );
        }
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "navigates the SwiftSandboxPool drawer's kernel, secret and sandbox links to objects that actually exist",
    async () => {
      // The three reference kinds this drawer resolves through a DrawerItem row
      // and whose targets the fixtures guarantee: the SwiftKernel of
      // spec.kernelProfileRef and the two Secrets of spec.imagePullSecret and
      // spec.verifyKeySecretRef, which 125-sandbox-references.yaml creates for
      // the sandbox fixtures and this pool deliberately reuses.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");
      await pr.openDrawer(frame, "e2e-sandbox-pool");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");
        await pr.openDrawer(frame, "e2e-sandbox-pool");
      };

      for (const label of ["Kernel Profile", "Image Pull Secret", "Verify Key Secret"]) {
        const row = await pr.waitForDrawerLink(frame, label);

        if (!row) {
          throw new Error(`The SwiftSandboxPool drawer has no "${label}" row at all.`);
        }

        if (!row.href) {
          throw new Error(
            `The SwiftSandboxPool drawer's "${label}" row ("${row.text}") stayed plain text: the fixture makes the referenced object exist, so the row must render as a link.`,
          );
        }

        const result = await pr.checkDrawerLink(frame, "swiftsandboxpools", row, reopen);

        if (!result.ok) {
          throw new Error(`The "${label}" link ("${row.text}") did not navigate cleanly: ${result.note}`);
        }
      }

      // The sandbox link lives in the nested "Sandboxes Using This Pool" table
      // rather than in a `DrawerItem` row, so it is read from the drawer
      // directly rather than through the row helpers. The wait is the same
      // bounded one those helpers do: the link appears once the SwiftSandbox
      // store has filled.
      const sandboxLink = frame.locator(".Drawer.KubeObjectDetails a", { hasText: "e2e-sandbox-pooled" }).first();

      await sandboxLink.waitFor({ state: "visible", timeout: 60_000 });

      const sandboxHref = await sandboxLink.getAttribute("href");
      const sandboxResult = await pr.checkDrawerLink(
        frame,
        "swiftsandboxpools",
        { label: "Sandboxes Using This Pool", text: "e2e-sandbox-pooled", href: sandboxHref },
        reopen,
      );

      if (!sandboxResult.ok) {
        throw new Error(`The pooled sandbox link did not navigate cleanly: ${sandboxResult.note}`);
      }

      await cluster.closeDetails(frame);

      // The opposite assert: the minimal pool names no kernel profile at all,
      // so its row must read the controller-applied default as plain text
      // rather than link to a namespace this extension would have had to guess
      // (SPEC-0008), exactly as the minimal sandbox's does.
      await pr.openDrawer(frame, "e2e-sandbox-pool-degraded");

      const rows = await pr.inspectDrawerRows(frame);
      const kernelRow = rows.find((row) => row.label === "Kernel Profile");

      if (!kernelRow) {
        throw new Error('The SwiftSandboxPool drawer has no "Kernel Profile" row at all.');
      }

      if (kernelRow.href) {
        throw new Error(
          `"${kernelRow.text}" is the controller-applied default, which no object in this namespace corresponds to, so it must stay plain text.`,
        );
      }

      if (!kernelRow.text.includes("sandbox (default)")) {
        throw new Error(`The "Kernel Profile" row should read the default, got "${kernelRow.text}".`);
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "opens the launcher pod's logs from the SwiftSandbox drawer",
    async () => {
      // The roadmap's "Sandbox logs" row, and the only place this extension
      // reaches into the host's dock. `logTabStore.createPodTab` is a
      // documented export of the renderer extension API that no freelensapp
      // extension had used before; it was proven live against this very fixture
      // cluster before the drawer was wired (SPEC-0008), and this case is what
      // keeps it proven.
      //
      // It asserts the tab, not log content: the fixture launcher pods are
      // deliberately unschedulable, so they have no logs to show. What this
      // protects is the wiring - the podRef resolves, a container is picked,
      // and the host API is called with a shape it accepts - which is exactly
      // the part that can regress silently.
      //
      // Last of the view cases on purpose: it leaves the host's dock open, and
      // the dock covers the lower half of every list page underneath it.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await pr.openDrawer(frame, "e2e-sandbox-running");

      const viewLogs = frame.locator('[data-testid="swiftsandbox-view-logs"]');

      await viewLogs.waitFor({ state: "visible", timeout: 60_000 });
      await viewLogs.click();

      const logTab = frame.locator(".Dock .Tab", { hasText: "e2e-sandbox-running-launcher" }).first();

      await logTab.waitFor({ state: "visible", timeout: 60_000 });

      // The drawer is deliberately left open. Once the log panel is up the
      // host's dock owns the keyboard - its own search field handles Escape -
      // so `closeDetails`, which presses Escape, cannot shut the drawer from
      // here. That is why this case is the last one that touches the UI:
      // nothing after it reads the DOM, and the app is torn down immediately
      // afterwards.
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

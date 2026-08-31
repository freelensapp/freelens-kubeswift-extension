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

/**
 * The control of the Take Snapshot dialog's backend select.
 *
 * The host's `Select` spends its `id` on react-select's `inputId`, not on the
 * container, so the control is reached through the input it holds - which is
 * also what makes the menu addressable as `<inputId>-options`.
 */
function backendControl(frame: Frame) {
  return frame.locator(".Select:has(#snapshot-backend) .Select__control");
}

/** The SwiftSnapshots the cluster holds, by name: the only way to see a create that did not happen. */
function snapshotNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftsnapshots.snapshot.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/** The same, for the objects the Restore dialog creates. */
function restoreNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftrestores.snapshot.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/** The same, for the objects the Migrate dialog creates. */
function migrationNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftmigrations.migration.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * The two selects of the Migrate dialog.
 *
 * Reached through the input they hold, for the reason `backendControl` is: the
 * host's `Select` spends its `id` on react-select's `inputId` rather than on the
 * container - which is also what makes each menu addressable as
 * `<inputId>-options`, portalled to `document.body` so the dialog never clips it.
 */
function modeControl(frame: Frame) {
  return frame.locator(".Select:has(#migration-mode) .Select__control");
}

function nodeControl(frame: Frame) {
  return frame.locator(".Select:has(#migration-target-node) .Select__control");
}

/**
 * One mode radio of the Restore dialog.
 *
 * The host's `Radio` takes no test id - its props are `className`, `label`,
 * `value` and `disabled` - so the form puts one on the span it renders inside
 * the label, and the row is the ancestor that holds the input. Matching on the
 * visible text would not do: a refused option's reason names the other mode.
 */
function modeRadio(frame: Frame, mode: "in-place" | "clone") {
  return frame.locator(`[data-testid="restore-mode"] .Radio:has([data-testid="restore-mode-${mode}"])`).first();
}

/** The SwiftGuests the cluster holds, by name: the only way to see a create that did not happen. */
function guestNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftguests.swift.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * The host's own create control, on whichever list page is open.
 *
 * Not a test id: the button is the host's floating "+" (`AddRemoveButtons`,
 * the idiom core's Namespaces page uses for "Add Namespace"), and the extension
 * passes it only an `onAdd` and a tooltip - so the stable selector is the host's
 * own markup, which is exactly what makes it the native control (SPEC-0013).
 * Three pages carry it since SPEC-0014: Guests, Guest Classes and Kernels.
 */
function pageCreateControl(frame: Frame) {
  return frame.locator(".AddRemoveButtons .add-button");
}

/** One select of a create form, reached through the input it holds. */
function createFormControl(frame: Frame, id: string) {
  return frame.locator(`.Select:has(#${id}) .Select__control`);
}

/**
 * One boot-source radio of the Create Guest form.
 *
 * The host's `Radio` takes no test id of its own - the same fact the Restore
 * dialog's mode radios work around - so the form puts one on the span inside the
 * label, and the row is the ancestor that holds the input.
 */
function bootSourceRadio(frame: Frame, source: "image" | "kernel" | "clone") {
  return frame
    .locator(`[data-testid="guest-create-boot-source"] .Radio:has([data-testid="guest-create-boot-source-${source}"])`)
    .first();
}

/** Picks one option of a create form's select, by the text of the option. */
async function pickCreateOption(frame: Frame, id: string, text: string): Promise<void> {
  await createFormControl(frame, id).click();
  await frame.locator(`.${id}-options .Select__option`, { hasText: text }).first().click();
}

/** Opens the create dialog from the page's own control and waits for its reads to answer. */
async function openCreateGuestDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftguest-create-form"]', { state: "visible", timeout: 60_000 });
  // The class picker is a text input until the cluster's guest classes answer,
  // so waiting for the select is waiting for the read rather than racing it.
  await frame.waitForSelector(".Select:has(#guest-create-class)", { state: "visible", timeout: 60_000 });
}

/**
 * Opens (or shuts) one of the Create Guest form's collapsed sections.
 *
 * The header is the section's own first child button - the disclosure the
 * `CollapsibleSection` primitive renders - and it is a real button so the
 * section is reachable by keyboard as well as by this.
 */
async function openGuestSection(frame: Frame, testId: string): Promise<void> {
  await frame.locator(`[data-testid="${testId}"] > button`).first().click();
}

/** One source radio of a data-disk row, reached the way every host `Radio` is. */
function dataDiskSourceRadio(frame: Frame, index: number, source: "image" | "pvc" | "blank") {
  return frame
    .locator(
      `[data-testid="guest-create-disk-${index}-source"] .Radio:has([data-testid="guest-create-disk-${index}-source-${source}"])`,
    )
    .first();
}

/** One binding radio of the network section. */
function bindingRadio(frame: Frame, binding: "nat" | "bridge") {
  return frame
    .locator(`[data-testid="guest-create-binding"] .Radio:has([data-testid="guest-create-binding-${binding}"])`)
    .first();
}

/** One backend radio of the GPU section. */
function gpuBackendRadio(frame: Frame, backend: "none" | "profile" | "claim") {
  return frame
    .locator(`[data-testid="guest-create-gpu-backend"] .Radio:has([data-testid="guest-create-gpu-backend-${backend}"])`)
    .first();
}

/**
 * An object name no earlier run can have taken.
 *
 * These cases create for real, and `pnpm e2e:cluster:up` is idempotent rather
 * than destructive, so a fixed name would make the second run of a kept cluster
 * fail on an AlreadyExists that says nothing about the code.
 */
function createdObjectName(prefix: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${prefix}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** The SwiftGuestClasses the cluster holds, by name. Cluster-scoped, so no namespace. */
function guestClassNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftguestclasses.swift.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/** The same, for the objects the Create Kernel dialog creates. */
function kernelNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftkernels.kernel.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * Opens the Create Guest Class dialog from the page's own control, and waits for
 * its reads to answer.
 *
 * The storage-class field is a text input until the cluster's StorageClasses
 * come back, so waiting for the select is waiting for the read rather than
 * racing it (the idiom the Create Guest opener established).
 */
async function openCreateGuestClassDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftguestclass-create-form"]', { state: "visible", timeout: 60_000 });
  await frame.waitForSelector(".Select:has(#guestclass-create-storage-class)", {
    state: "visible",
    timeout: 60_000,
  });
}

/** The same, for the Create Kernel dialog, whose picker is the namespace's Secrets. */
async function openCreateKernelDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftkernel-create-form"]', { state: "visible", timeout: 60_000 });
  await frame.waitForSelector(".Select:has(#kernel-create-pull-secret)", { state: "visible", timeout: 60_000 });
}

/**
 * The name the Restore dialog will give the SwiftRestore it creates.
 *
 * The dialog names the object in the one line W1 requires, and that line is the
 * contract this reads: there is no separate place the name is published, and
 * parsing it here asserts the write line at the same time.
 */
function plannedRestoreName(dialog: string): string {
  const match = dialog.match(/Create SwiftRestore kubeswift-e2e\/([a-z0-9.-]+)/);

  if (!match) {
    throw new Error(`The Restore dialog must name the object it creates, got: ${dialog}`);
  }

  return match[1];
}

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
    "lists the SwiftGuests with their condition, node and address",
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
      // "Running" is read from the Condition badge since M6 replaced the plain
      // Phase column with the classifier's Condition/Status pair (SPEC-0010).
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
        // What deleting this one destroys, computed from its own backend and
        // policy (SPEC-0011): on csi the Retain above decides nothing, and the
        // VolumeSnapshotClass does.
        "follows the VolumeSnapshotClass",
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
        // The On Delete row (SPEC-0012), computed from this object's own phase
        // and mode: a finished migration is a record, and this one carries a
        // ttl, so it says when it will remove itself.
        "removes the record and nothing else",
        "self-deletes 24h",
      );

      // The same row on an unfinished LIVE migration, where deleting the object
      // is the one deletion in this CRD that cleans up nothing at all - and
      // where the safe lever has a name no upstream surface mentions.
      await cluster.expectDetails(
        frame,
        "e2e-migration-live",
        "SwiftMigration: e2e-migration-live",
        "cleans up nothing",
        "spec.cancelRequested: true",
      );

      // And on the pre-cutover offline one, where it is the opposite: deleting
      // it rolls the guest back.
      await cluster.expectDetails(
        frame,
        "e2e-migration-inflight",
        "SwiftMigration: e2e-migration-inflight",
        "aborts it and rolls the guest back",
        "source pod comes back",
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
    "lists the fleet Clusters with their server, version and condition",
    async () => {
      await cluster.openKubeSwiftPage(frame, "fleetclusters", "Member Clusters");
      expect(await pr.headerCellsWithoutId(frame)).toEqual([]);

      // Server, K8s version, guest count and the condition badge, in column
      // order. The healthy remote member is the only fixture with all four.
      await cluster.expectRow(
        frame,
        "e2e-fleet-edge-1",
        "https://edge-1.kubeswift-e2e.internal:6443",
        "v1.34.3 7 Ready",
        "The API server answered the last probe.",
      );

      // The hub's own entry, and the two readings that make this view's Server
      // and Guests cells worth their code: it federates itself through its
      // in-cluster ServiceAccount, so it holds no server URL - "In-cluster",
      // never "N/A" - and its guestCount of 0 is a synced cluster running no
      // VMs, which the schema distinguishes from a member that has never been
      // reached (SPEC-0009).
      await cluster.expectRow(frame, "e2e-fleet-hub", "In-cluster", "v1.33.4 0 Ready");

      // The unreachable one: the third reading of the Server cell (the URL is
      // inside a credential Secret this extension does not read), the two cells
      // that really are missing values, the Unreachable verdict, and the
      // gateway's own dial-timeout text in the Status column - which is the
      // message ladder's second rung, on a status that has no top-level
      // message field at all.
      await cluster.expectRow(
        frame,
        "e2e-fleet-edge-down",
        "From kubeconfig N/A N/A Unreachable",
        "dial tcp 10.10.0.9:6443: i/o timeout",
      );

      // The member no gateway has ever reconciled. It is the expected steady
      // state on any KubeSwift cluster that is not a hub, so the explanation
      // says exactly that instead of promising a transition.
      await cluster.expectRow(frame, "e2e-fleet-pending", "N/A N/A Unknown", "No gateway has reported on this member");

      // Unreachable is an error and Not Ready would be a warning: the member's
      // API server did not answer a probe, an operator has to act, and the
      // cause is outside the gateway. That is the SPEC-0009 judgement call, and
      // this is what pins it.
      //
      // The badge is found by the class the classifier hands it, not by a
      // `.Badge` selector: core's `Badge` is a CSS-module component, so its own
      // class name is hashed at build time and only the `className` the
      // extension passes survives verbatim.
      const errorBadges = await frame
        .locator(".TableRow", { hasText: "e2e-fleet-edge-down" })
        .first()
        .locator(".error")
        .allInnerTexts();

      if (!errorBadges.some((text) => text.trim() === "Unreachable")) {
        throw new Error(
          `The Unreachable badge must carry the host's "error" class, got: ${JSON.stringify(errorBadges)}`,
        );
      }
    },
    TIMEOUT,
  );

  it(
    "opens a fleet Cluster drawer and links its credential Secret",
    async () => {
      // The credential Secret is the only reference this CRD declares, and the
      // one row of this drawer that resolves anything. It is named and linked,
      // never read: the hub holds a credential to every member, and pulling
      // those contents into a renderer process to pretty-print a hostname would
      // widen exactly that blast radius (SPEC-0009). The fixture Secret exists
      // and carries no credential-shaped data at all, which is all the row
      // needs.
      await cluster.openKubeSwiftPage(frame, "fleetclusters", "Member Clusters");
      await pr.openDrawer(frame, "e2e-fleet-edge-1");

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, "fleetclusters", "Member Clusters");
        await pr.openDrawer(frame, "e2e-fleet-edge-1");
      };

      const secretRow = await pr.waitForDrawerLink(frame, "Credential Secret");

      if (!secretRow) {
        throw new Error('The fleet Cluster drawer has no "Credential Secret" row at all.');
      }

      if (!secretRow.href) {
        throw new Error(
          `The fleet Cluster drawer's "Credential Secret" row ("${secretRow.text}") stayed plain text: the fixture makes the Secret exist, so the row must render as a link.`,
        );
      }

      const secretResult = await pr.checkDrawerLink(frame, "fleetclusters", secretRow, reopen);

      if (!secretResult.ok) {
        throw new Error(
          `The "Credential Secret" link ("${secretRow.text}") did not navigate cleanly: ${secretResult.note}`,
        );
      }

      await cluster.closeDetails(frame);

      // The whole drawer: the section that removes the ambiguity of the host's
      // own "Cluster: name" title from inside, the federation role named rather
      // than left as a boolean, the certificate row, and the Telemetry
      // section's Resolution row reading the humanized `Explicit` reason.
      await cluster.expectDetails(
        frame,
        "e2e-fleet-edge-1",
        "Cluster: e2e-fleet-edge-1",
        "Member Cluster",
        "Remote member",
        "Certificate Verification",
        "v1.34.3",
        "Last Connected",
        "Telemetry",
        "Explicit",
      );

      // Every section guards itself, so the member no gateway has reported on
      // shows the one that always applies and not the Telemetry block, which
      // would otherwise read as a Freelens metrics problem rather than as the
      // absence of a gateway.
      await pr.openDrawer(frame, "e2e-fleet-pending");

      const sections = await frame.$$eval(".Drawer.KubeObjectDetails .DrawerTitle", (elements) =>
        elements.map((element) => element.textContent?.trim() ?? ""),
      );

      if (!sections.includes("Member Cluster")) {
        throw new Error(
          `The fleet Cluster drawer should always have a "Member Cluster" section, got: ${sections.join(", ")}`,
        );
      }

      if (sections.includes("Telemetry")) {
        throw new Error(
          `The "Telemetry" section must guard itself away on a member with no endpoint asked for or resolved, got: ${sections.join(", ")}`,
        );
      }

      await cluster.closeDetails(frame);

      // The counter-assert every link case in this suite carries: the
      // unreachable member names a Secret the fixtures never create, so its row
      // must degrade to plain text rather than render a dead link (DESIGN.md
      // section 3). It is also the normal outcome for a hub operator whose RBAC
      // lets them list Clusters without listing the credential Secrets next to
      // them.
      await pr.openDrawer(frame, "e2e-fleet-edge-down");

      const rows = await pr.inspectDrawerRows(frame);
      const missingSecretRow = rows.find((row) => row.label === "Credential Secret");

      if (!missingSecretRow) {
        throw new Error('The fleet Cluster drawer has no "Credential Secret" row at all.');
      }

      if (missingSecretRow.href) {
        throw new Error(
          `"${missingSecretRow.text}" names a Secret the fixtures never create, so it must stay plain text.`,
        );
      }

      if (!missingSecretRow.text.includes("e2e-fleet-edge-down-credential")) {
        throw new Error(`The "Credential Secret" row should name the Secret, got "${missingSecretRow.text}".`);
      }

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  // ---------------------------------------------------------------------------
  // M6 (SPEC-0010): the first cases in this suite that WRITE.
  //
  // What the fixture cluster proves: the CRDs are real and the API server
  // validates and stores patches exactly as it would in production, so these
  // cases prove the patch is well formed and accepted, that the object changed,
  // that the pod was deleted, that the watch carried the change back into the
  // list without a reload, and that the derived `Stopping` state renders. They
  // also prove the negatives that matter most: that cancelling writes nothing,
  // that a disabled action cannot be clicked, and that a failed write is
  // reported.
  //
  // What it cannot prove, and what therefore stays in the spec's manual
  // verification list: anything a controller would do next. No reconciler runs
  // here, so a stopped guest never reaches `phase: Stopped` and a started one
  // never boots. These cases must not assert otherwise - and the `Stopping`
  // badge a real cluster would show for a few seconds is PERMANENT here, which
  // is what makes it cheap to assert. Nobody should later "fix" the missing
  // phase change.
  //
  // They run in this order because they mutate their own subjects: the cancel
  // case needs e2e-guest-action-running untouched, and the stale-object case
  // deletes e2e-guest-action-orphanref after its own read-only case is done.
  // `e2e/scripts/cluster-up.sh` is idempotent, so a second run starts clean.
  it(
    "shows the guest actions in the row menu and in the drawer toolbar",
    async () => {
      // One registration reaches both surfaces (W5), and the guard decides per
      // object, in both of them. No writes here.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-action-running");

      const runningRowItems = await cluster.actionMenuItems(frame, ".Menu");

      // Four registrations since SPEC-0012 added the Migrate surface. Take
      // Snapshot is never disabled: there is a valid snapshot for every settled
      // guest state, and the gating that matters is per-backend, inside the
      // dialog, where the backend choice exists. Migrate is disabled only for a
      // guest that forbids migration and for an SR-IOV one, neither of which
      // this subject is.
      expect(runningRowItems.map((item) => item.testId).sort()).toEqual([
        "swiftguest-migrate-action",
        "swiftguest-start-action",
        "swiftguest-stop-action",
        "swiftguest-take-snapshot-action",
      ]);
      expect(runningRowItems.find((item) => item.testId === "swiftguest-take-snapshot-action")?.disabled).toBe(false);
      expect(runningRowItems.find((item) => item.testId === "swiftguest-migrate-action")?.disabled).toBe(false);

      const runningStart = runningRowItems.find((item) => item.testId === "swiftguest-start-action");
      const runningStop = runningRowItems.find((item) => item.testId === "swiftguest-stop-action");

      // A guest that is set to run cannot be started, and says why (B5). The
      // reason is read from the item's own tooltip attribute rather than from a
      // hover: a disabled `MenuItem` carries `pointer-events: none`, so the
      // host's hover tooltip cannot be shown for it in either surface (spike
      // S7, recorded in SPEC-0010).
      expect(runningStart?.disabled).toBe(true);
      expect(runningStart?.title).toContain("already set to run");
      expect(runningStop?.disabled).toBe(false);

      // The E2E half of W4: the click is stopped by the stylesheet, not only by
      // the handler, so Playwright's actionability check refuses it.
      let clickWasRefused = false;

      try {
        await frame.locator('.Menu [data-testid="swiftguest-start-action"]').click({ timeout: 3000 });
      } catch {
        clickWasRefused = true;
      }

      if (!clickWasRefused) {
        throw new Error("A disabled action item must not be clickable.");
      }

      await cluster.closeRowMenu(frame);

      // The same registration, in the drawer toolbar.
      await pr.openDrawer(frame, "e2e-guest-action-running");

      const toolbarItems = await cluster.actionMenuItems(frame, ".Drawer.KubeObjectDetails .MenuActions");

      expect(toolbarItems.map((item) => item.testId).sort()).toEqual([
        "swiftguest-migrate-action",
        "swiftguest-start-action",
        "swiftguest-stop-action",
        "swiftguest-take-snapshot-action",
      ]);
      expect(toolbarItems.find((item) => item.testId === "swiftguest-start-action")?.disabled).toBe(true);
      expect(toolbarItems.find((item) => item.testId === "swiftguest-start-action")?.title).toContain(
        "already set to run",
      );

      await cluster.closeDetails(frame);

      // And the reverse verdict on the stopped subject: Start offered, Stop
      // refused with the reason that makes the refusal legible.
      await cluster.openRowMenu(frame, "e2e-guest-action-stopped");

      const stoppedRowItems = await cluster.actionMenuItems(frame, ".Menu");
      const stoppedStop = stoppedRowItems.find((item) => item.testId === "swiftguest-stop-action");

      expect(stoppedRowItems.find((item) => item.testId === "swiftguest-start-action")?.disabled).toBe(false);
      expect(stoppedStop?.disabled).toBe(true);
      expect(stoppedStop?.title).toContain("already stopped, and no launcher pod is recorded");

      await cluster.closeRowMenu(frame);
    },
    TIMEOUT,
  );

  it(
    "cancels an action without writing anything",
    async () => {
      // The cheapest honest test of "nothing happens on a single click": the
      // dialog is not decoration, it is the gate.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-action-running");
      await frame.locator('.Menu [data-testid="swiftguest-stop-action"]').click();
      await cluster.confirmDialogText(frame);
      await cluster.cancelDialog(frame);

      expect(
        cluster.kubectlField("swiftguests.swift.kubeswift.io", "e2e-guest-action-running", "{.spec.runPolicy}"),
      ).toBe("Always");
      expect(cluster.kubectlExists("pods", "e2e-guest-action-running-launcher")).toBe(true);

      // The same gate on the create surface (SPEC-0011): a cancelled form is an
      // object that was never created, which is only observable by counting.
      const before = snapshotNames();

      await cluster.openRowMenu(frame, "e2e-guest-action-running");
      await frame.locator('.Menu [data-testid="swiftguest-take-snapshot-action"]').click();
      await cluster.confirmDialogText(frame);
      await cluster.cancelDialog(frame);

      expect(snapshotNames()).toEqual(before);

      // And on the other create surface, which writes a different kind from a
      // different page.
      const restoresBefore = restoreNames();

      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");
      await cluster.openRowMenu(frame, "e2e-snapshot-ready");
      await frame.locator('.Menu [data-testid="swiftsnapshot-restore-action"]').click();
      await cluster.confirmDialogText(frame);
      await cluster.cancelDialog(frame);

      expect(restoreNames()).toEqual(restoresBefore);

      // And on the third one (SPEC-0012), whose dialog opens with a required
      // field nobody has filled: a cancelled form writes nothing either way.
      const migrationsBefore = migrationNames();

      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-migrate-running");
      await frame.locator('.Menu [data-testid="swiftguest-migrate-action"]').click();
      await cluster.confirmDialogText(frame);
      await cluster.cancelDialog(frame);

      expect(migrationNames()).toEqual(migrationsBefore);
    },
    TIMEOUT,
  );

  it(
    "stops a guest, patching the run policy and deleting the launcher pod",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);
      await cluster.openRowMenu(frame, "e2e-guest-action-running");
      await frame.locator('.Menu [data-testid="swiftguest-stop-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      // Both writes, each with its field path and value transition or its kind
      // and name (W1).
      expect(dialog).toContain("spec.runPolicy: Always -> Stopped");
      expect(dialog).toContain("Delete Pod kubeswift-e2e/e2e-guest-action-running-launcher");
      // The pod was READ before being offered for deletion (B3), so the dialog
      // describes the cluster rather than the status. The phase it names is
      // Pending rather than Running because the fixture launcher pods are
      // deliberately unschedulable (55-launcher-pods.yaml) - what this asserts
      // is that a real read happened, not a phase this cluster cannot produce.
      expect(dialog).toContain("will be deleted");
      // What the stop costs (B6, B7), each line true of this subject.
      expect(dialog).toContain("run policy Always is replaced");
      expect(dialog).toContain("10.244.1.31 goes with the pod");
      expect(dialog).toContain("stopping is not deleting");

      await cluster.confirmDialog(frame);

      // The success notification names what was written, not what is hoped for
      // (B11).
      await cluster.expectNotification(frame, "ok", "Run policy set to Stopped and launcher pod");

      // The cluster really changed: both writes landed.
      expect(
        cluster.kubectlField("swiftguests.swift.kubeswift.io", "e2e-guest-action-running", "{.spec.runPolicy}"),
      ).toBe("Stopped");
      expect(cluster.kubectlExists("pods", "e2e-guest-action-running-launcher")).toBe(false);

      // And the derived state renders, from the watch, with no reload (B12).
      // It is permanent here because no controller ever writes `phase: Stopped`
      // in this cluster - see the note above this block.
      await cluster.expectRow(frame, "e2e-guest-action-running", "Stopping");

      const stoppingBadges = await frame
        .locator(".TableRow", { hasText: "e2e-guest-action-running" })
        .first()
        .locator(".warning")
        .allInnerTexts();

      if (!stoppingBadges.some((text) => text.trim() === "Stopping")) {
        throw new Error(
          `The Stopping badge must carry the host's "warning" class, got: ${JSON.stringify(stoppingBadges)}`,
        );
      }

      // The drawer tells the whole story without a toast: the field the click
      // wrote, next to the state that field produced.
      await pr.openDrawer(frame, "e2e-guest-action-running");

      const rows = await pr.inspectDrawerRows(frame);

      expect(rows.find((row) => row.label === "Run Policy")?.text).toBe("Stopped");
      expect(rows.find((row) => row.label === "Condition")?.text).toBe("Stopping");

      await cluster.closeDetails(frame);
      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "offers only the missing write when a guest is already half-stopped",
    async () => {
      // The state a stop whose second write failed leaves behind, which the
      // fixtures ship directly (`runPolicy: Stopped` with the launcher pod still
      // there): re-stopping it must patch nothing and delete the pod, which is
      // what makes "run it again, it will finish the job" a true statement
      // rather than a hopeful one (B4, W9).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-action-halfstopped");

      const items = await cluster.actionMenuItems(frame, ".Menu");

      expect(items.find((item) => item.testId === "swiftguest-stop-action")?.disabled).toBe(false);

      await frame.locator('.Menu [data-testid="swiftguest-stop-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("Delete Pod kubeswift-e2e/e2e-guest-action-halfstopped-launcher");
      expect(dialog).not.toContain("spec.runPolicy");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", "Launcher pod e2e-guest-action-halfstopped-launcher deleted");

      expect(cluster.kubectlExists("pods", "e2e-guest-action-halfstopped-launcher")).toBe(false);
      expect(
        cluster.kubectlField("swiftguests.swift.kubeswift.io", "e2e-guest-action-halfstopped", "{.spec.runPolicy}"),
      ).toBe("Stopped");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "says the launcher pod is already gone when it is",
    async () => {
      // The counter-case of the stop above: this subject's `status.podRef` names
      // a pod the fixtures deliberately never create, so the click-time read
      // finds nothing and the dialog lists only the patch (B3). Together the two
      // pin the rule that the dialog describes the cluster, not the status.
      // Nothing is written: the case cancels.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-action-orphanref");
      await frame.locator('.Menu [data-testid="swiftguest-stop-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("already gone");
      expect(dialog).toContain("spec.runPolicy: Running -> Stopped");
      expect(dialog).not.toContain("Delete Pod");

      await cluster.cancelDialog(frame);

      expect(
        cluster.kubectlField("swiftguests.swift.kubeswift.io", "e2e-guest-action-orphanref", "{.spec.runPolicy}"),
      ).toBe("Running");
    },
    TIMEOUT,
  );

  it(
    "starts a stopped guest",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);
      await cluster.openRowMenu(frame, "e2e-guest-action-stopped");
      await frame.locator('.Menu [data-testid="swiftguest-start-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("spec.runPolicy: Stopped -> Running");
      // What the start will schedule (B8): the guest class that decides the
      // sizing, the GPU the profile will claim, and the node the guest is
      // pinned to.
      expect(dialog).toContain("guest class e2e-large");
      expect(dialog).toContain("claim a GPU through the profile e2e-gpu-profile-hgx");
      expect(dialog).toContain(`pinned to the node ${cluster.clusterNodeName()}`);

      await cluster.confirmDialog(frame);

      // The whole point of B11 is here: without this notification the case
      // would be asserting that a successful action produced no visible change
      // at all.
      await cluster.expectNotification(frame, "ok", "Run policy set to Running");

      expect(
        cluster.kubectlField("swiftguests.swift.kubeswift.io", "e2e-guest-action-stopped", "{.spec.runPolicy}"),
      ).toBe("Running");

      // The honest assert: nothing in this cluster boots a VM, so the badge
      // still reads Stopped. The action changed the policy and nothing else.
      await cluster.expectRow(frame, "e2e-guest-action-stopped", "Stopped");
      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "reports a failed action instead of failing silently",
    async () => {
      // The case that pins W9, and the one behaviour no sibling extension has
      // today: they `await store.patch(...)` with no `try`/`catch`, so a
      // rejected write is an unhandled promise rejection and a UI that appears
      // to have done nothing.
      //
      // The object is deleted from under an OPEN dialog rather than before it,
      // which is both deterministic and the real shape of the race: the row
      // itself disappears within a watch round-trip, so a stale row cannot be
      // clicked reliably, while a dialog built from a snapshot stays.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);
      await cluster.openRowMenu(frame, "e2e-guest-action-orphanref");
      await frame.locator('.Menu [data-testid="swiftguest-stop-action"]').click();
      await cluster.confirmDialogText(frame);

      expect(cluster.kubectlE2E("delete", "swiftguests.swift.kubeswift.io", "e2e-guest-action-orphanref").status).toBe(
        0,
      );

      await cluster.confirmDialog(frame);

      // The API server's own words, prefixed with the one sentence that says
      // what happens next (B10), never replaced by ours.
      const message = await cluster.expectNotification(frame, "error", "not found");

      expect(message).toContain("gone from the cluster");
      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "deletes a guest and drops its row",
    async () => {
      // Through the HOST's Delete, which it renders in both surfaces for every
      // kind this extension registers a store for - proven live before the
      // implementation (spike S3), which is why the extension registers no
      // Delete of its own.
      //
      // Honest because SwiftGuest has no finalizers: in a cluster with no
      // controller a finalized kind would hang in `Terminating` forever, and
      // this case would be asserting the opposite of what a real cluster does.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-action-delete");
      await frame.locator(".Menu .MenuItem", { hasText: "Delete" }).first().click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("Delete SwiftGuest kubeswift-e2e/e2e-guest-action-delete");

      await cluster.confirmDialog(frame);

      // The row goes when the DELETED watch event arrives, through the host's
      // own one-second debounce, which is why this waits rather than reads.
      await frame
        .locator(".TableRow", { hasText: "e2e-guest-action-delete" })
        .first()
        .waitFor({ state: "detached", timeout: 60_000 });
      await cluster.expectNoRow(frame, "e2e-guest-action-delete");

      expect(cluster.kubectlExists("swiftguests.swift.kubeswift.io", "e2e-guest-action-delete")).toBe(false);
    },
    TIMEOUT,
  );

  // ---------------------------------------------------------------------------
  // M6 (SPEC-0011): the first cases in this suite that CREATE.
  //
  // What the fixture cluster proves: the API server admits the object the form
  // built, fills its schema defaults, and refuses a second one under the same
  // name - so these cases prove the payload is exactly what the write summary
  // enumerated and nothing more, that the gating refuses what upstream would
  // park in `Pending` forever, and that a 409 leaves the form on screen instead
  // of losing it.
  //
  // What it cannot prove stays in the spec's manual verification list: no
  // capture ever runs here, so a created snapshot has no status at all and never
  // reaches `Ready`. The cases must not assert otherwise.
  it(
    "takes a csi snapshot of a running guest",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      // From the drawer toolbar, which is the second surface of the same
      // registration (W5).
      await pr.openDrawer(frame, "e2e-guest-running");
      await frame.locator('.Drawer.KubeObjectDetails [data-testid="swiftguest-take-snapshot-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);
      const name = await frame.locator('[data-testid="snapshot-name"]').inputValue();

      // The default name is the guest's plus the wall-clock instant of the
      // click, which is what keeps the second snapshot of one guest from
      // colliding with the first (C6).
      expect(name).toMatch(/^e2e-guest-running-\d{8}-\d{6}$/);

      // The one write, and the facts that are true of it: what csi captures,
      // where it lands, and the deletion truth of this backend. No pause line -
      // a csi capture never pauses the VM - and no wait line, because this guest
      // is Running.
      expect(dialog).toContain(`Create SwiftSnapshot kubeswift-e2e/${name}`);
      expect(dialog).toContain("root disk only");
      expect(dialog).toContain("default VolumeSnapshotClass");
      expect(dialog).toContain("follows the VolumeSnapshotClass");
      expect(dialog).not.toContain("paused for the whole capture");
      expect(dialog).not.toContain("waits in Pending");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSnapshot ${name} created`);

      // The object the API server stored is the object the summary enumerated,
      // plus the three schema defaults it fills itself (spike T2) - and nothing
      // else. `includeMemory` is a documented no-op the dialog never sends, and
      // `includeDisk` is a different verb entirely.
      const spec = JSON.parse(cluster.kubectlField("swiftsnapshots.snapshot.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "backend",
        "deletionPolicy",
        "guestRef",
        "includeMemory",
        "resumeAfterSnapshot",
      ]);
      expect(spec.backend).toEqual({ type: "csi-volume-snapshot" });
      expect(spec.guestRef).toEqual({ name: "e2e-guest-running" });
      expect(spec.deletionPolicy).toBe("Delete");

      // The row exists on the page the object belongs to, without a reload -
      // which is exactly why the create is acknowledged with a notification: it
      // was fired from a page that does not show it.
      await cluster.closeDetails(frame);
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");
      await cluster.expectRow(frame, name, "csi-volume-snapshot");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a memory snapshot of a stopped guest, with the reason",
    async () => {
      // The gating that a menu-item guard cannot express, because the backend is
      // a field: upstream would admit this snapshot and park it in `Pending`
      // forever, requeuing every five seconds with no deadline (C3).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = snapshotNames();

      await cluster.openRowMenu(frame, "e2e-guest-action-stopped");
      await frame.locator('.Menu [data-testid="swiftguest-take-snapshot-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("local, s3, oci");
      expect(dialog).toContain("park the snapshot in Pending forever");
      expect(dialog).toContain("no launcher pod is recorded");

      // csi stays offered, and the form stays submittable on it: a disk capture
      // of a stopped guest is legitimate, its root PVC being populated.
      expect(dialog).toContain("root disk only");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The same three refusals inside the select itself, where the option a
      // user would have clicked is. The menu is portalled to `document.body`
      // (the host's own default, so it is never clipped by the dialog) and
      // carries `<inputId>-options`, which is how it is addressed from here.
      await backendControl(frame).click();

      const options = await frame.locator(".snapshot-backend-options .Select__option").allInnerTexts();

      expect(options).toHaveLength(4);
      expect(options.filter((option) => option.includes("park the snapshot in Pending forever"))).toHaveLength(3);

      // Closed by clicking the control again: react-select stops the Escape key
      // from propagating, precisely so that it never closes the dialog around it.
      await backendControl(frame).click();
      await cluster.cancelDialog(frame);

      expect(snapshotNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns about the frozen VM when resume is unchecked",
    async () => {
      // The single most dangerous control in the dialog: swiftletd skips the
      // resume and returns, the snapshot still reaches `Ready`, and nothing
      // anywhere ever resumes the guest again (C4).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = snapshotNames();

      await cluster.openRowMenu(frame, "e2e-guest-running");
      await frame.locator('.Menu [data-testid="swiftguest-take-snapshot-action"]').click();
      await cluster.confirmDialogText(frame);

      // A memory backend is offered for this guest: it is Running and its status
      // records the launcher pod.
      await backendControl(frame).click();
      await frame.locator(".snapshot-backend-options .Select__option", { hasText: "local" }).first().click();

      // The webhook rule enforced inline, in the place the webhook would have
      // spoken from if this install had one enabled - and the submit-disabled
      // sentence naming the field and the reason (W4).
      const withoutPath = await cluster.confirmDialogText(frame);

      expect(withoutPath).toContain("Take Snapshot is disabled - Host path");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await frame.locator('[data-testid="snapshot-host-path"]').fill("/var/lib/kubeswift/snapshots/e2e-frozen");

      const withPath = await cluster.confirmDialogText(frame);

      expect(withPath).toContain("paused for the whole capture");
      expect(withPath).not.toContain("Take Snapshot is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await frame.locator('[data-testid="snapshot-resume-after-capture"] .Checkbox').click();

      const frozen = await cluster.confirmDialogText(frame);

      expect(frozen).toContain("nothing in the cluster ever resumes this VM");

      // And the button takes the accent styling Stop uses, because this
      // combination terminates service until a human intervenes.
      expect(await frame.locator('[data-testid="confirm"]').getAttribute("class")).toContain("accent");

      await cluster.cancelDialog(frame);

      expect(snapshotNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns on a colliding name and surfaces the 409 when submitted anyway",
    async () => {
      // The collision warning does not block: the store can be stale and the API
      // server is the authority, so an ignored warning has to come back as a
      // usable failure rather than a lost form.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);
      await cluster.openRowMenu(frame, "e2e-guest-running");
      await frame.locator('.Menu [data-testid="swiftguest-take-snapshot-action"]').click();
      await cluster.confirmDialogText(frame);

      await frame.locator('[data-testid="snapshot-name"]').fill("e2e-snapshot-ready");

      const warned = await cluster.confirmDialogText(frame);

      expect(warned).toContain("already exists in this namespace");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // Submitted anyway. `confirmDialog` is deliberately not used here: it waits
      // for the dialog to disappear, and the whole point of this path is that it
      // comes back.
      await frame.locator('[data-testid="confirm"]').click();

      const message = await cluster.expectNotification(frame, "error", "already exists");

      expect(message).toContain("Change the name");

      // The dialog is back, with everything the user typed still in it - which
      // is only true because the form model lives outside React (spike T1).
      await frame.waitForSelector('[data-testid="confirmation-dialog"]', { state: "visible", timeout: 60_000 });
      expect(await frame.locator('[data-testid="snapshot-name"]').inputValue()).toBe("e2e-snapshot-ready");

      await cluster.cancelDialog(frame);

      // And the snapshot that was already there is untouched: a refused create
      // writes nothing.
      expect(
        cluster.kubectlField("swiftsnapshots.snapshot.kubeswift.io", "e2e-snapshot-ready", "{.spec.deletionPolicy}"),
      ).toBe("Retain");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "restores a memory snapshot as a clone",
    async () => {
      // The second create verb, and the one whose object upstream's own UI
      // cannot show at all: it has no restore surface, so a SwiftRestore is
      // invisible there from the moment it is created.
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");
      await cluster.clearNotifications(frame);

      // From the drawer toolbar, which is the second surface of the same
      // registration (W5).
      await pr.openDrawer(frame, "e2e-snapshot-memory-ready");
      await frame.locator('.Drawer.KubeObjectDetails [data-testid="swiftsnapshot-restore-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);
      const name = plannedRestoreName(dialog);
      const target = await frame.locator('[data-testid="restore-target-name"]').inputValue();

      // The dialog opens on the mode that destroys nothing, with the two default
      // names the spec fixes: the restore's own carries the date, the clone's
      // carries the time of day because it becomes a guest's hostname.
      expect(name).toMatch(/^e2e-snapshot-memory-ready-restore-\d{8}-\d{6}$/);
      expect(target).toMatch(/^e2e-guest-restore-source-restore-\d{6}$/);

      // The MAC rewrite is checked AND locked, because upstream requires it when
      // a memory snapshot is cloned to another name - the likeliest rejection
      // this dialog prevents (C13). The rule is both the row's tooltip and a
      // visible line, since a locked control cannot be hovered.
      const mac = frame.locator('[data-testid="restore-rewrite-mac"]');

      expect(await mac.locator("input").isChecked()).toBe(true);
      expect(await mac.locator("input").isDisabled()).toBe(true);
      expect(await mac.getAttribute("title")).toContain("same MAC addresses");
      expect(dialog).toContain("same MAC addresses");

      // The disclosure upstream documents nowhere, said before the click (C12).
      expect(dialog).toContain(`deleting the restore later deletes the guest ${target}`);
      expect(dialog).toContain("current spec");
      expect(dialog).toContain("fresh disk cloned from the image");
      // A clone overwrites nothing, so the consent field is not on this path.
      expect(dialog).not.toContain("overwriteExisting");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftRestore ${name} created`);

      // The object the API server stored is the object the summary enumerated,
      // plus the two schema defaults it fills itself - and nothing else.
      const spec = JSON.parse(cluster.kubectlField("swiftrestores.snapshot.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "identity",
        "memoryRestoreMode",
        "resumeAfterRestore",
        "snapshotRef",
        "targetGuest",
      ]);
      expect(spec.snapshotRef).toEqual({ name: "e2e-snapshot-memory-ready" });
      // No overwriteExisting at all: the CRD declares no default for it, so a
      // clone leaves the key absent rather than sending false.
      expect(spec.targetGuest).toEqual({ name: target });
      expect(spec.identity).toEqual({ regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"] });
      // The two the API server defaulted, which is exactly why the dialog does
      // not send them: copy is the hypervisor default upstream never propagates,
      // and true is the schema's own value.
      expect(spec.memoryRestoreMode).toBe("copy");
      expect(spec.resumeAfterRestore).toBe(true);

      // The row exists on the page the object belongs to, without a reload.
      await cluster.closeDetails(frame);
      await cluster.openKubeSwiftPage(frame, "swiftrestores", "Restores");
      await cluster.expectRow(frame, name, "e2e-snapshot-memory-ready", target);

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "disables in-place for a csi snapshot, with the no-op reason",
    async () => {
      // A verb that succeeds while doing nothing is a dead control (W4): the csi
      // restore path returns early when the PVC and the guest already exist, and
      // the SwiftRestore marches to Ready having changed nothing (C11).
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");

      const before = restoreNames();

      await cluster.openRowMenu(frame, "e2e-snapshot-ready");
      await frame.locator('.Menu [data-testid="swiftsnapshot-restore-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("restores nothing");
      expect(dialog).toContain("marches the restore to Ready having changed nothing");

      expect(await modeRadio(frame, "in-place").locator("input").isDisabled()).toBe(true);
      expect(await modeRadio(frame, "clone").locator("input").isDisabled()).toBe(false);

      // The clone path stays fully usable, which is what the refusal points at.
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);
      // And the MAC rewrite is free here, because a csi snapshot holds no memory.
      expect(await frame.locator('[data-testid="restore-rewrite-mac"] input').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(restoreNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "disables Restore on a Failed snapshot, with the terminal reason",
    async () => {
      // The one phase from which a restore is guaranteed never to resolve:
      // Failed is terminal, so the snapshot never becomes Ready and upstream's
      // own controller would requeue the restore every ten seconds forever.
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");
      await cluster.openRowMenu(frame, "e2e-snapshot-failed");

      const items = await cluster.actionMenuItems(frame, ".Menu", "swiftsnapshot-");
      const restore = items.find((item) => item.testId === "swiftsnapshot-restore-action");

      expect(restore?.disabled).toBe(true);
      expect(restore?.title).toContain("terminal");
      expect(restore?.title).toContain("Pending forever");

      // The E2E half of W4: the click is stopped by the stylesheet, not only by
      // the handler, so Playwright's actionability check refuses it.
      let clickWasRefused = false;

      try {
        await frame.locator('.Menu [data-testid="swiftsnapshot-restore-action"]').click({ timeout: 3000 });
      } catch {
        clickWasRefused = true;
      }

      if (!clickWasRefused) {
        throw new Error("A disabled action item must not be clickable.");
      }

      await cluster.closeRowMenu(frame);

      // And the Ready snapshot next to it is offered, so the assert above is
      // about the phase rather than about the registration.
      await cluster.openRowMenu(frame, "e2e-snapshot-ready");

      const ready = await cluster.actionMenuItems(frame, ".Menu", "swiftsnapshot-");

      expect(ready.find((item) => item.testId === "swiftsnapshot-restore-action")?.disabled).toBe(false);

      await cluster.closeRowMenu(frame);
    },
    TIMEOUT,
  );

  it(
    "warns that an in-place restore of a stopped guest will wedge",
    async () => {
      // The verified wedge: the restore never touches spec.runPolicy, so the
      // guest controller will not recreate the launcher pod and the restore
      // waits in Restoring with no timeout. A warning and not a block, because
      // the policy can change between this dialog and the reconcile (C11).
      await cluster.openKubeSwiftPage(frame, "swiftsnapshots", "Snapshots");

      const before = restoreNames();

      await cluster.openRowMenu(frame, "e2e-snapshot-memory-ready");
      await frame.locator('.Menu [data-testid="swiftsnapshot-restore-action"]').click();
      await cluster.confirmDialogText(frame);

      await modeRadio(frame, "in-place").click();

      const dialog = await cluster.confirmDialogText(frame);

      // The target is fixed to the snapshot's source guest, not a text field:
      // upstream reads the mode off the name match, so the name IS the mode.
      expect(await frame.locator('[data-testid="restore-target-guest"]').innerText()).toBe("e2e-guest-restore-source");
      expect(await frame.locator('[data-testid="restore-target-name"]').count()).toBe(0);

      // What the click would do, from the one cheap read on open.
      expect(dialog).toContain("deleted with no grace period");
      expect(dialog).toContain("disks are untouched");
      expect(dialog).toContain("spec.targetGuest.overwriteExisting: true");
      expect(dialog).toContain("The guest is Stopped and no launcher pod is recorded");

      // The warning, and the fix it names.
      expect(dialog).toContain("will wedge");
      expect(dialog).toContain("Start the guest first");

      // In place terminates a running workload, so the button takes the accent
      // styling Stop uses; the clone path does not.
      expect(await frame.locator('[data-testid="confirm"]').getAttribute("class")).toContain("accent");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The identity checkboxes are gone: upstream defines in place as a name
      // match AND an empty regenerate, so there is nothing to offer here.
      expect(await frame.locator('[data-testid="restore-regenerate-identity"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="restore-rewrite-mac"]').count()).toBe(0);

      await cluster.cancelDialog(frame);

      expect(restoreNames()).toEqual(before);
    },
    TIMEOUT,
  );

  // The M6 Migrate cases (SPEC-0012). Same honest split as the two create verbs
  // before them: no controller runs here, so a created SwiftMigration stays
  // phaseless forever - which is exactly what makes it provable that the
  // extension wrote what the summary enumerated and nothing else.
  //
  // The E2E cluster has ONE node, which is the fixture design of these cases:
  // the picker never offers the node a guest is already on, so a subject whose
  // status names a synthetic other node has the real one to move to, and the
  // subject that really is on the real node has nothing - and says so.
  it(
    "starts an offline migration of a running guest",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      // From the drawer toolbar, which is the second surface of the same
      // registration (W5).
      await pr.openDrawer(frame, "e2e-guest-migrate-running");
      await frame.locator('.Drawer.KubeObjectDetails [data-testid="swiftguest-migrate-action"]').click();

      await cluster.confirmDialogText(frame);

      const name = await frame.locator('[data-testid="migration-name"]').inputValue();

      // The default name is the guest's plus the wall-clock time of the click.
      expect(name).toMatch(/^e2e-guest-migrate-running-migrate-\d{6}$/);

      // The picker offers the cluster's node and nothing else: this guest's own
      // node is excluded, which is upstream's same-node refusal - a rule that
      // lives in a webhook that ships disabled, and without which the migration
      // is a reboot in place.
      await nodeControl(frame).click();

      const nodeOptions = await frame.locator(".migration-target-node-options .Select__option").allInnerTexts();

      expect(nodeOptions).toHaveLength(1);
      expect(nodeOptions[0]).toContain(cluster.clusterNodeName());

      await frame
        .locator(".migration-target-node-options .Select__option", { hasText: cluster.clusterNodeName() })
        .first()
        .click();

      // The dialog opens on auto, and for this guest - running, no VFIO, no
      // node-local backend, storage two nodes can hold at once - auto resolves
      // to live, which is why the live-only fields are on screen right now.
      const predicted = await cluster.confirmDialogText(frame);

      expect(predicted).toContain("auto will resolve to: live");
      expect(await frame.locator('[data-testid="migration-timeout"]').count()).toBe(1);

      await modeControl(frame).click();
      await frame.locator(".migration-mode-options .Select__option", { hasText: "offline" }).first().click();

      const dialog = await cluster.confirmDialogText(frame);

      // The one write, and the offline truths that are true of this guest.
      expect(dialog).toContain(`Create SwiftMigration kubeswift-e2e/${name}`);
      expect(dialog).toContain("is stopped for the move");
      expect(dialog).toContain("30-second grace period");
      expect(dialog).toContain("reattached, not copied");
      expect(dialog).toContain("nothing upstream verifies it");
      expect(dialog).toContain("no timeout in offline mode");
      expect(dialog).toContain("fresh IP");

      // Option dropping (M10): upstream reads spec.timeout in live mode only,
      // so the field is gone rather than present and ignored.
      expect(await frame.locator('[data-testid="migration-timeout"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="migration-downtime-target"]').count()).toBe(0);

      // Stopping a running guest is the same class of consequence as Stop, and
      // takes the same accent button.
      expect(await frame.locator('[data-testid="confirm"]').getAttribute("class")).toContain("accent");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftMigration ${name} created`);

      // The object the API server stored is the object the summary enumerated,
      // plus the two schema defaults it fills itself - and nothing else. No
      // nodeSelector (upstream-unshipped, and an infinite retry without the
      // webhook), and no timeoutStrategy of ours (never read by any handler).
      const spec = JSON.parse(cluster.kubectlField("swiftmigrations.migration.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "allowIPChange",
        "guestRef",
        "mode",
        "target",
        "timeout",
        "timeoutStrategy",
      ]);
      expect(spec.guestRef).toEqual({ name: "e2e-guest-migrate-running" });
      expect(spec.target).toEqual({ nodeName: cluster.clusterNodeName() });
      expect(spec.mode).toBe("offline");
      // The consent this guest's default networking makes meaningful, sent
      // exactly because the dialog showed it.
      expect(spec.allowIPChange).toBe(true);
      // The two the API server defaulted, which is why the dialog sends neither.
      expect(spec.timeout).toBe("30m0s");
      expect(spec.timeoutStrategy).toBe("cancel");

      // The row exists on the page the object belongs to, without a reload -
      // which is exactly why the create is acknowledged with a notification: it
      // was fired from a page that does not show it.
      await cluster.closeDetails(frame);
      await cluster.openKubeSwiftPage(frame, "swiftmigrations", "Migrations");
      await cluster.expectRow(frame, name, "e2e-guest-migrate-running offline");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "explains what auto will resolve to, and blocks live on RWO storage",
    async () => {
      // Drift D1, closed client-side: upstream's resolver promotes an eligible
      // guest to live WITHOUT ever consulting storage, and the RWX+Block gate
      // exists only in the webhook, only for an explicit mode: live, and only
      // when that webhook is enabled - which by default it is not. So a
      // default-mode migration of this guest walks into two launcher pods
      // contending for one ReadWriteOnce volume, and this dialog is what stops
      // it.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = migrationNames();

      await cluster.openRowMenu(frame, "e2e-guest-migrate-rwo");
      await frame.locator('.Menu [data-testid="swiftguest-migrate-action"]').click();

      const dialog = await cluster.confirmDialogText(frame);

      // The prediction is the controller's own answer, not ours: it says live,
      // with the because-clause and the assumption it rests on.
      expect(dialog).toContain("auto will resolve to: live");
      expect(dialog).toContain("user-defined network");

      // And the block that follows from it, naming the choice.
      expect(dialog).toContain("ReadWriteOnce/Filesystem");
      expect(dialog).toContain("two launcher pods would contend for this guest's ReadWriteOnce/Filesystem volume");
      expect(dialog).toContain("Pick offline, or fix the storage");
      expect(dialog).toContain("Migrate is disabled - Mode:");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // The same refusal inside the select, on the option a user would have
      // clicked, with the reason and with who enforces it.
      await modeControl(frame).click();

      const options = await frame.locator(".migration-mode-options .Select__option").allInnerTexts();

      expect(options).toHaveLength(3);
      expect(options.filter((option) => option.includes("ReadWriteMany and Block"))).toHaveLength(1);
      expect(options.filter((option) => option.includes("ships disabled"))).toHaveLength(1);

      // Taking the choice the block names unblocks the form: the offline path
      // is fully usable, which is the whole point of naming it.
      await frame.locator(".migration-mode-options .Select__option", { hasText: "offline" }).first().click();
      await nodeControl(frame).click();
      await frame
        .locator(".migration-target-node-options .Select__option", { hasText: cluster.clusterNodeName() })
        .first()
        .click();

      const offline = await cluster.confirmDialogText(frame);

      expect(offline).not.toContain("Migrate is disabled");
      expect(offline).toContain("reattached, not copied");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(migrationNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "refuses migration of an SR-IOV guest, with the reason",
    async () => {
      // The webhook rule with no controller re-check at all: with the webhook
      // off - the default - this guard is the only thing between an operator and
      // a migration that cannot work in any mode.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-migrate-sriov");

      const items = await cluster.actionMenuItems(frame, ".Menu");
      const migrate = items.find((item) => item.testId === "swiftguest-migrate-action");

      expect(migrate?.disabled).toBe(true);
      expect(migrate?.title).toContain("SR-IOV");
      expect(migrate?.title).toContain("vf0");
      expect(migrate?.title).toContain("webhook is off");

      // The E2E half of W4: the click is stopped by the stylesheet, not only by
      // the handler, so Playwright's actionability check refuses it.
      let clickWasRefused = false;

      try {
        await frame.locator('.Menu [data-testid="swiftguest-migrate-action"]').click({ timeout: 3000 });
      } catch {
        clickWasRefused = true;
      }

      if (!clickWasRefused) {
        throw new Error("A disabled action item must not be clickable.");
      }

      await cluster.closeRowMenu(frame);

      // The same verdict in the drawer toolbar: one registration, both surfaces
      // (W5), and the reason reachable in both.
      await pr.openDrawer(frame, "e2e-guest-migrate-sriov");

      const toolbarItems = await cluster.actionMenuItems(frame, ".Drawer.KubeObjectDetails .MenuActions");
      const toolbarMigrate = toolbarItems.find((item) => item.testId === "swiftguest-migrate-action");

      expect(toolbarMigrate?.disabled).toBe(true);
      expect(toolbarMigrate?.title).toContain("SR-IOV");

      await cluster.closeDetails(frame);

      // And the guest next to it is offered, so the assert above is about the
      // interface rather than about the registration.
      await cluster.openRowMenu(frame, "e2e-guest-migrate-stopped");

      const stoppedItems = await cluster.actionMenuItems(frame, ".Menu");

      expect(stoppedItems.find((item) => item.testId === "swiftguest-migrate-action")?.disabled).toBe(false);

      await cluster.closeRowMenu(frame);
    },
    TIMEOUT,
  );

  it(
    "warns about an in-flight migration of the same guest",
    async () => {
      // A guard no upstream surface has at all: nothing refuses a second
      // migration of one guest at admission, the in-progress annotation is
      // controller-side and offline-only, and only a client holding every
      // SwiftMigration can see the conflict coming.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = migrationNames();

      await cluster.openRowMenu(frame, "e2e-guest-migrate-inflight");
      await frame.locator('.Menu [data-testid="swiftguest-migrate-action"]').click();

      // The node picker is filled by a read on open, and until it answers the
      // field is a text input (SPEC-0011's degradation, unchanged here). This
      // case is about what the picker says once it HAS answered, so it waits for
      // that rather than racing it.
      await frame.waitForSelector('[data-testid="migration-no-nodes"]', { state: "visible", timeout: 60_000 });

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("e2e-migration-inflight");
      expect(dialog).toContain("is Preparing");
      expect(dialog).toContain("claim conflict");
      expect(dialog).toContain("warning and not a block");

      // Named AND linked: the other migration's drawer is one click away.
      expect(await frame.locator('[data-testid="migration-in-flight"] a').first().innerText()).toBe(
        "e2e-migration-inflight",
      );

      // This subject really is on the cluster's only node, so the picker has
      // nothing left to offer - and says which node it dropped and why, instead
      // of rendering an empty control.
      expect(dialog).toContain("No node in this cluster can take this guest");
      expect(dialog).toContain(`${cluster.clusterNodeName()} is the node this guest is already on`);
      expect(await frame.locator('[data-testid="migration-no-nodes"]').count()).toBe(1);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await cluster.cancelDialog(frame);

      expect(migrationNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "discloses that migrating a stopped guest boots it",
    async () => {
      // The behaviour nobody would guess and upstream documents nowhere: the
      // cutover patches runPolicy back to Running, so moving a guest an operator
      // chose to keep down starts it on the target.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = migrationNames();

      await cluster.openRowMenu(frame, "e2e-guest-migrate-stopped");
      await frame.locator('.Menu [data-testid="swiftguest-migrate-action"]').click();
      await cluster.confirmDialogText(frame);

      await nodeControl(frame).click();
      await frame
        .locator(".migration-target-node-options .Select__option", { hasText: cluster.clusterNodeName() })
        .first()
        .click();

      const dialog = await cluster.confirmDialogText(frame);

      // auto resolves to offline here, and says why; live is refused with the
      // rule an operator can act on.
      expect(dialog).toContain("auto will resolve to: offline");
      expect(dialog).toContain("is Stopped");
      expect(dialog).toContain("non-running guest");

      expect(dialog).toContain(`will start the guest on ${cluster.clusterNodeName()}`);
      expect(dialog).toContain("moving a stopped guest means booting it");
      // Nothing is stopped by this migration, so nothing is accented: booting a
      // guest is a commitment, not a termination.
      expect(dialog).not.toContain("is stopped for the move");
      expect(await frame.locator('[data-testid="confirm"]').getAttribute("class")).not.toContain("accent");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);
      // The live-only fields are dropped with the predicted mode, not with the
      // selected one.
      expect(await frame.locator('[data-testid="migration-timeout"]').count()).toBe(0);

      await cluster.cancelDialog(frame);

      expect(migrationNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a guest from the page's own create button, and writes exactly what it enumerated",
    async () => {
      // The first M6 create whose entry point is not a menu item on an object:
      // there is no object yet, so the page carries the host's own floating "+"
      // (SPEC-0013's Registration, rewritten to the native control).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created");

      await openCreateGuestDialog(frame);

      // The namespace is the page's own filter, which names exactly one: the
      // write line is where that shows, and it is also the W1 enumeration.
      expect(await cluster.confirmDialogText(frame)).toContain("Create SwiftGuest kubeswift-e2e/");

      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");

      // The class is never auto-selected, and choosing it is what makes its
      // sizing visible - the decision upstream makes by sort order (G3).
      const sizing = await frame.locator('[data-testid="guest-create-class-sizing"]').innerText();

      expect(sizing.replace(/\s+/g, " ")).toContain("Root disk 20Gi qcow2");
      expect(sizing.replace(/\s+/g, " ")).toContain("Live migration offline only (ReadWriteOnce/Filesystem)");

      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");
      await pickCreateOption(frame, "guest-create-seed", "e2e-seed-basic");
      await pickCreateOption(frame, "guest-create-run-policy", "Stopped");
      await pickCreateOption(frame, "guest-create-node", cluster.clusterNodeName());

      // The storage section ships collapsed: it is opened here, and the pair it
      // holds is the one the CRD's own CEL rule is about.
      await frame.locator('[data-testid="guest-create-storage-section"] button').click();
      await pickCreateOption(frame, "guest-create-access-mode", "ReadWriteMany");
      await pickCreateOption(frame, "guest-create-volume-mode", "Block");

      await frame.locator('[data-testid="guest-create-guest-agent"] .Checkbox').click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftGuest kubeswift-e2e/${name}`);
      expect(dialog).toContain("The guest class e2e-small sizes it: 2 vCPU, 4Gi, 20Gi qcow2");
      expect(dialog).toContain("cloned from the image e2e-ubuntu-2404");
      expect(dialog).toContain("The seed profile e2e-seed-basic is rendered into a Secret");
      expect(dialog).toContain("Run policy Stopped");
      expect(dialog).toContain("No launcher pod is created now");
      expect(dialog).toContain(`pinned to the node ${cluster.clusterNodeName()}`);
      // Both overrides together turn the storage line over: this guest CAN be
      // live-migrated, which the same sentence denied before they were set.
      expect(dialog).toContain("ReadWriteMany/Block, which two launcher pods can hold at once");
      expect(dialog).toContain("vsock device");
      // A create commits resources and destroys nothing, so it keeps the
      // default styling rather than the accent one a stop takes.
      expect(await frame.locator('[data-testid="confirm"]').getAttribute("class")).not.toContain("accent");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);

      // The row arrives on the very page the dialog was opened from, through
      // that page's own store: no optimistic write of ours (W2).
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      // The object the API server stored is the object the summary enumerated,
      // and nothing else: no empty-name references, no fields this form does not
      // own, and no schema default beyond the osType it sends itself.
      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "guestAgent",
        "guestClassRef",
        "imageRef",
        "nodeName",
        "osType",
        "runPolicy",
        "seedProfileRef",
        "storage",
      ]);
      expect(spec.guestClassRef).toEqual({ name: "e2e-small" });
      expect(spec.imageRef).toEqual({ name: "e2e-ubuntu-2404" });
      expect(spec.seedProfileRef).toEqual({ name: "e2e-seed-basic" });
      expect(spec.osType).toBe("linux");
      expect(spec.runPolicy).toBe("Stopped");
      expect(spec.nodeName).toBe(cluster.clusterNodeName());
      expect(spec.storage).toEqual({ accessMode: "ReadWriteMany", volumeMode: "Block" });
      expect(spec.guestAgent).toEqual({ enabled: true });

      // No controller runs here, so the guest stays phaseless - which is the
      // proof that everything above was written by this dialog and by nothing
      // else.
      expect(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.status.phase}")).toBe("");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "offers an image that is not Ready, and says the guest will wait for it",
    async () => {
      // G2: upstream's picker discards the readiness its own gateway returns.
      // This one shows it, offers the image anyway, and says what creating
      // against it means - because the guest is born Failed and then heals by
      // itself, which makes "create it now" a legitimate thing to do.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-waiting");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await createFormControl(frame, "guest-create-image").click();

      const options = await frame.locator(".guest-create-image-options .Select__option").allInnerTexts();

      expect(options.some((option) => option.includes("e2e-image-importing - Importing"))).toBe(true);
      expect(options.some((option) => option.includes("e2e-ubuntu-2404 - Ready"))).toBe(true);
      // Dimmed, never disabled: the wait is a consequence, not a refusal.
      expect(await frame.locator(".guest-create-image-options .Select__option--is-disabled").count()).toBe(0);

      await frame
        .locator(".guest-create-image-options .Select__option", { hasText: "e2e-image-importing" })
        .first()
        .click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("The image e2e-image-importing is Importing, not Ready");
      expect(dialog).toContain("born Failed");
      expect(dialog).toContain("Resolved=False");
      expect(dialog).toContain("Images are watched");
      // A wait never blocks the submit.
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "syncs the OS type from a windows image, and creates the guest with it",
    async () => {
      // G4, the born-Failed trap closed: the CRD defaults spec.osType to linux
      // and the resolver cross-checks it against the image's own, so a Windows
      // guest created with the field untouched is born Failed. The form reads
      // the image and sends what it says.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-win");

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-windows-2022");

      // A fact, not a control: there is no osType select to disagree with.
      const osType = await frame.locator('[data-testid="guest-create-os-type"]').innerText();

      expect(osType).toContain("windows");
      expect(osType).toContain("read from the image e2e-windows-2022");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("This is a Windows image");
      expect(dialog).toContain("no GPU profile");
      expect(dialog).toContain("mounts no filesystems");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual(["guestClassRef", "imageRef", "osType", "runPolicy"]);
      expect(spec.osType).toBe("windows");
      expect(spec.imageRef).toEqual({ name: "e2e-windows-2022" });
      // Sent explicitly although the schema does not default it: the mutating
      // webhook that would have is disabled on a normal install (G8).
      expect(spec.runPolicy).toBe("Running");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a name that is not a DNS label, and warns about one that is taken",
    async () => {
      // G12: upstream validates neither. The refusal blocks and names the field
      // at the field and at the button (W4); the collision only warns, because
      // the store can be stale and the API server is the authority.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");
      await frame.locator('[data-testid="guest-create-name"]').fill("Bad_Name");

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("A guest name is lowercase letters, digits and '-'");
      expect(refused).toContain("Create Guest is disabled - Name:");
      expect(await frame.locator('[data-testid="guest-create-submit-blocked"]').count()).toBe(1);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // A name that is only too long is refused by the same field, with the
      // count rather than the pattern.
      await frame.locator('[data-testid="guest-create-name"]').fill("a".repeat(64));
      expect(await cluster.confirmDialogText(frame)).toContain("at most 63 characters; this one is 64");

      // The fixture whose whole purpose is to have its name taken.
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-guest-create-taken");

      const warned = await cluster.confirmDialogText(frame);

      expect(warned).toContain("A SwiftGuest with this name already exists in this namespace");
      expect(warned).toContain("the fix is a different name");
      expect(warned).not.toContain("Create Guest is disabled");
      // A warning never blocks: the submit stays available and the API server's
      // own AlreadyExists is what the failure path is designed to carry.
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "cancels the create dialog without writing anything",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-never");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
      expect(cluster.kubectlExists("swiftguests.swift.kubeswift.io", "e2e-created-never")).toBe(false);
      await cluster.expectNoRow(frame, "e2e-created-never");
    },
    TIMEOUT,
  );

  it(
    "creates a kernel-boot guest, and refuses the node that cannot run one",
    async () => {
      // SPEC-0013 slice 2. Everything about this create differs from the image
      // one: no root disk is cloned, the OS type is a property of the boot
      // source rather than a reading, the seed profile and the storage
      // overrides are dropped because upstream ignores them, and the only node
      // of this cluster is offered disabled because it does not carry the
      // kernel-node label.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-kernel");

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "kernel").click();

      // The image field is gone with its source, and so is the seed profile -
      // with what it would have configured said in its place (W12).
      expect(await frame.locator(".Select:has(#guest-create-image)").count()).toBe(0);
      expect(await frame.locator(".Select:has(#guest-create-seed)").count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-seed-dropped"]').innerText()).toContain("disk boot");
      expect(await frame.locator('[data-testid="guest-create-storage-dropped"]').innerText()).toContain(
        "no root disk of its own",
      );

      await createFormControl(frame, "guest-create-kernel").click();

      const kernels = await frame.locator(".guest-create-kernel-options .Select__option").allInnerTexts();

      expect(kernels.some((option) => option.includes("e2e-kernel-6-12 - Ready"))).toBe(true);
      expect(kernels.some((option) => option.includes("e2e-kernel-pulling - Pulling"))).toBe(true);
      // Dimmed, never disabled: a kernel that is still being pulled is a wait.
      expect(await frame.locator(".guest-create-kernel-options .Select__option--is-disabled").count()).toBe(0);

      await frame
        .locator(".guest-create-kernel-options .Select__option", { hasText: "e2e-kernel-6-12" })
        .first()
        .click();

      // The kernel's own command line is shown as the default this field
      // replaces, which is the one thing a user cannot guess here.
      expect(await frame.locator('[data-testid="guest-create-boot-source"]').count()).toBe(1);
      await frame.locator('[data-testid="guest-create-kernel-cmdline"]').fill("console=ttyS0 quiet");

      const osType = await frame.locator('[data-testid="guest-create-os-type"]').innerText();

      expect(osType).toContain("linux");
      expect(osType).toContain("Linux only");

      // The SPEC-0012 rule from the other end: this cluster's single node has no
      // kernel-node label, so it is offered disabled with the reason rather than
      // dropped - the fix is a label on a node the operator can see.
      await createFormControl(frame, "guest-create-node").click();
      expect(await frame.locator(".guest-create-node-options .Select__option--is-disabled").count()).toBe(1);
      expect(
        await frame.locator(".guest-create-node-options .Select__option span").first().getAttribute("title"),
      ).toContain("kubeswift.io/kernel-node: true");
      // Closed by clicking the control again, the idiom the Take Snapshot case
      // established: react-select stops Escape from propagating so it never
      // closes the dialog around it, but a second click is unambiguous.
      await createFormControl(frame, "guest-create-node").click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftGuest kubeswift-e2e/${name}`);
      expect(dialog).toContain("It boots the kernel e2e-kernel-6-12 and its initramfs directly");
      expect(dialog).toContain("no image is cloned and no root disk is created");
      expect(dialog).toContain('Its kernel command line is "console=ttyS0 quiet"');
      expect(dialog).toContain("console=ttyS0 reboot=k panic=1");
      expect(dialog).toContain("kubeswift.io/kernel-node: true");
      expect(dialog).toContain("exempts it from that rule");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      // The exact key set: no imageRef, no seedProfileRef, no storage - and the
      // osType this form sends itself rather than letting the schema default it.
      expect(Object.keys(spec).sort()).toEqual(["guestClassRef", "kernelCmdline", "kernelRef", "osType", "runPolicy"]);
      expect(spec.kernelRef).toEqual({ name: "e2e-kernel-6-12" });
      expect(spec.kernelCmdline).toBe("console=ttyS0 quiet");
      expect(spec.osType).toBe("linux");
      expect(spec.runPolicy).toBe("Running");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "offers a kernel that is not Ready, and says the guest waits for the resync",
    async () => {
      // The same shape as the image will-wait case and deliberately not the same
      // sentence: kernels are not watched, so the recovery is the controller's
      // periodic resync rather than the instant an artifact lands.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-kernel-waiting");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "kernel").click();
      await pickCreateOption(frame, "guest-create-kernel", "e2e-kernel-pulling");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("The kernel e2e-kernel-pulling is Pulling, not Ready");
      expect(dialog).toContain("born Failed");
      expect(dialog).toContain("30-second resync");
      expect(dialog).toContain("not watched the way images are");
      // A wait never blocks the submit.
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "clones a local memory snapshot, with the MAC lock and the explicit regenerate list",
    async () => {
      // The clone grammar on the tier that needs no node: a local capture lives
      // on one node and pins the clone to it, so the target node field is not
      // rendered at all and the node it will run on is stated instead (W12).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-clone");

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "clone").click();
      await pickCreateOption(frame, "guest-create-snapshot", "e2e-snapshot-memory-ready");

      // No target node field, and the node the capture lives on named where it
      // would have been.
      expect(await frame.locator(".Select:has(#guest-create-clone-target-node)").count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-clone-node-fact"]').innerText()).toContain(
        `runs on ${cluster.clusterNodeName()}`,
      );
      // The node pin is dropped too: the snapshot places this guest.
      expect(await frame.locator(".Select:has(#guest-create-node)").count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-node-dropped"]').innerText()).toContain(
        "placed by its snapshot",
      );

      // The MAC rewrite is a fact, not a checkbox that cannot be unticked.
      const macLock = await frame.locator('[data-testid="guest-create-mac-locked"]').innerText();

      expect(macLock).toContain("always regenerated");
      expect(macLock).toContain("cannot be turned off");

      // The class is stored and inert: the snapshot's own sizing is what the
      // resumed VM comes up with, and it is rendered next to the class block.
      const sizing = await frame.locator('[data-testid="guest-create-class-sizing"]').innerText();

      expect(sizing.replace(/\s+/g, " ")).toContain("Resumed CPU 2 (from e2e-snapshot-memory-ready)");
      expect(sizing.replace(/\s+/g, " ")).toContain("Resumed memory 4096Mi (from e2e-snapshot-memory-ready)");
      expect(await frame.locator('[data-testid="guest-create-inert-class"]').innerText()).toContain(
        "does not size this clone",
      );

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("It resumes the memory state of the local snapshot e2e-snapshot-memory-ready");
      expect(dialog).toContain("regenerate is sent as hostname, machineId, sshHostKeys, macAddresses");
      expect(dialog).toContain("An empty list means all four");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual(["cloneFromSnapshot", "guestClassRef", "osType", "runPolicy"]);
      // The list the form showed is the list the object carries: an empty one
      // would have meant all four items to upstream, which is the opposite of
      // what an unticked checkbox would have said.
      expect(spec.cloneFromSnapshot).toEqual({
        snapshotRef: { name: "e2e-snapshot-memory-ready" },
        regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"],
      });
      expect(spec.osType).toBe("linux");
      expect(spec.runPolicy).toBe("Running");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "requires a target node for an s3 snapshot, and writes it into the clone",
    async () => {
      // G10: the requirement is computed from the snapshot's own backend rather
      // than asked of the user, and the submit says which field and why until a
      // node is picked (W12).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-s3clone");

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "clone").click();
      await pickCreateOption(frame, "guest-create-snapshot", "e2e-snapshot-create-s3");

      const blocked = await cluster.confirmDialogText(frame);

      expect(blocked).toContain("Create Guest is disabled - Target node:");
      expect(blocked).toContain("s3 capture");
      expect(blocked).toContain("downloaded");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);
      // Only this tier asks: the local case above renders no such control.
      expect(await frame.locator(".Select:has(#guest-create-clone-target-node)").count()).toBe(1);

      await pickCreateOption(frame, "guest-create-clone-target-node", cluster.clusterNodeName());

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Its artifacts are downloaded onto ${cluster.clusterNodeName()}`);
      expect(dialog).not.toContain("Create Guest is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      expect(spec.cloneFromSnapshot).toEqual({
        snapshotRef: { name: "e2e-snapshot-create-s3" },
        regenerate: ["hostname", "machineId", "sshHostKeys", "macAddresses"],
        targetNode: cluster.clusterNodeName(),
      });

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "leaves the snapshots a clone cannot resume out of the picker, and says how many",
    async () => {
      // The one picker of this form that filters rather than dims, because
      // neither rejected kind is a wait: a disk-only capture has nothing to
      // resume and never will, and the CRD requires a Ready snapshot. What was
      // left out is counted under the control, so an empty picker is never
      // mistaken for a broken one.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "clone").click();
      await createFormControl(frame, "guest-create-snapshot").click();

      const options = await frame.locator(".guest-create-snapshot-options .Select__option").allInnerTexts();

      expect(options.some((option) => option.includes("e2e-snapshot-memory-ready - local, Ready"))).toBe(true);
      expect(options.some((option) => option.includes("e2e-snapshot-create-s3 - s3, Ready"))).toBe(true);
      // The csi capture is disk-only and the oci one is still uploading.
      expect(options.some((option) => option.includes("e2e-snapshot-ready"))).toBe(false);
      expect(options.some((option) => option.includes("e2e-snapshot-uploading"))).toBe(false);
      expect(await frame.locator(".guest-create-snapshot-options .Select__option--is-disabled").count()).toBe(0);

      await createFormControl(frame, "guest-create-snapshot").click();

      const excluded = await frame.locator('[data-testid="guest-create-snapshot-excluded"]').innerText();

      // The counts themselves are deliberately not asserted: the Take Snapshot
      // case writes a snapshot of its own into this namespace, and a kept
      // cluster accumulates them, so the numbers depend on what else ran. The
      // exact arithmetic is a unit test; what this case owns is that both rules
      // are reported and that the sentence says what a clone needs.
      expect(excluded).toContain("no memory image (a disk-only capture has nothing to resume)");
      expect(excluded).toContain("not Ready yet");
      expect(excluded).toContain("a clone needs a Ready one that captured memory");
      // The seed profile is gone with the boot source, and says why.
      expect(await frame.locator(".Select:has(#guest-create-seed)").count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-seed-dropped"]').innerText()).toContain("already seeded");

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a clone's source guest is gone, and submits anyway",
    async () => {
      // A warning never blocks (W12): the store can be stale, and the only
      // authority on whether this create works is the API server and the
      // controller behind it.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-orphan-clone");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "clone").click();
      await pickCreateOption(frame, "guest-create-snapshot", "e2e-snapshot-create-orphan");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("The guest e2e-guest-create-vanished");
      expect(dialog).toContain("is gone from kubeswift-e2e");
      expect(dialog).toContain("full-state oci capture");
      expect(dialog).not.toContain("Create Guest is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a guest with data disks, ports, an interface and a GPU, and reads back what the server stamped",
    async () => {
      // SPEC-0013 slice 3, the whole collapsed tail on one guest. The readback
      // asserts two different things on purpose: the keys the FORM sent, and
      // the keys the API SERVER stamped into them (network.binding, the port
      // protocol, the interface type, the blank disk's volume mode). The form
      // deliberately sends none of the second set - a re-sent default is a
      // value it would be claiming to own - so the only way to keep that
      // decision honest is to assert both halves here.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-tail");

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill(name);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      // Section 8: one image-backed disk and one blank one.
      await openGuestSection(frame, "guest-create-data-disks-section");
      await frame.locator('[data-testid="guest-create-add-disk"]').click();
      await frame.locator('[data-testid="guest-create-disk-0-name"]').fill("extra");
      await pickCreateOption(frame, "guest-create-disk-0-image", "e2e-ubuntu-2404");

      await frame.locator('[data-testid="guest-create-add-disk"]').click();
      await frame.locator('[data-testid="guest-create-disk-1-name"]').fill("scratch");
      await dataDiskSourceRadio(frame, 1, "blank").click();
      await frame.locator('[data-testid="guest-create-disk-1-size"]').fill("20Gi");

      // Section 9: two exposed ports and one additional interface.
      await openGuestSection(frame, "guest-create-network-section");
      await frame.locator('[data-testid="guest-create-add-port"]').click();
      await frame.locator('[data-testid="guest-create-port-0-port"]').fill("80");
      await frame.locator('[data-testid="guest-create-port-0-name"]').fill("http");
      await pickCreateOption(frame, "guest-create-port-0-expose", "NodePort");

      await frame.locator('[data-testid="guest-create-add-port"]').click();
      await frame.locator('[data-testid="guest-create-port-1-port"]').fill("443");
      await frame.locator('[data-testid="guest-create-port-1-name"]').fill("https");
      await frame.locator('[data-testid="guest-create-port-1-target-port"]').fill("8443");
      await pickCreateOption(frame, "guest-create-port-1-expose", "NodePort");

      await frame.locator('[data-testid="guest-create-add-interface"]').click();
      await frame.locator('[data-testid="guest-create-nic-0-name"]').fill("net1");
      await frame.locator('[data-testid="guest-create-nic-0-primary"] .Checkbox').click();

      // Section 10: the native GPU backend.
      await openGuestSection(frame, "guest-create-gpu-section");
      await gpuBackendRadio(frame, "profile").click();
      await pickCreateOption(frame, "guest-create-gpu-profile", "e2e-gpu-profile-pcie");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftGuest kubeswift-e2e/${name}`);
      expect(dialog).toContain("Data disk extra: the image e2e-ubuntu-2404 is cloned into a PVC of this guest");
      expect(dialog).toContain("Data disk scratch: a blank 20Gi Block PVC of this guest is created");
      expect(dialog).toContain("One Service of type NodePort is created for this guest");
      expect(dialog).toContain("The primary NIC is net1");
      expect(dialog).toContain("It asks for the GPU profile e2e-gpu-profile-pcie");
      // G11: the one thing on this form that makes a guest wait without failing.
      expect(dialog).toContain("parks in Pending on its GPUAllocated condition");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuest kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftguests.swift.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "dataDiskRefs",
        "gpuProfileRef",
        "guestClassRef",
        "imageRef",
        "interfaces",
        "network",
        "osType",
        "runPolicy",
      ]);

      // What the form sent, key by key.
      expect(spec.dataDiskRefs[0]).toEqual({ name: "extra", imageRef: { name: "e2e-ubuntu-2404" } });
      expect(spec.dataDiskRefs[1].name).toBe("scratch");
      expect(spec.dataDiskRefs[1].blank.size).toBe("20Gi");
      expect(spec.interfaces[0].name).toBe("net1");
      expect(spec.interfaces[0].primary).toBe(true);
      expect(spec.gpuProfileRef).toEqual({ name: "e2e-gpu-profile-pcie" });
      expect(spec.network.ports[0].port).toBe(80);
      expect(spec.network.ports[0].name).toBe("http");
      expect(spec.network.ports[0].expose).toBe("NodePort");
      expect(spec.network.ports[1].targetPort).toBe(8443);

      // And what the API server stamped into it, which the form never sends.
      expect(spec.network.binding).toBe("nat");
      expect(spec.network.ports[0].protocol).toBe("TCP");
      expect(spec.network.ports[1].protocol).toBe("TCP");
      expect(spec.interfaces[0].type).toBe("bridge");
      expect(spec.dataDiskRefs[1].blank.volumeMode).toBe("Block");
      // Not defaulted anywhere, so absent is the proof the form sent nothing:
      // `attachAsDisk` has no schema default, and `targetPort` is only filled
      // in by the controller at runtime rather than by the API server.
      expect(spec.dataDiskRefs[0].attachAsDisk).toBeUndefined();
      expect(spec.network.ports[0].targetPort).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses the port rules with their reasons, and keeps the section open on one",
    async () => {
      // Three webhook-only rules whose controller failure modes are all silent:
      // a second port without a name, a mixed expose, and an expose under a
      // bridge binding. On a default install nobody but this form ever says so.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-ports-never");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      await openGuestSection(frame, "guest-create-network-section");
      await frame.locator('[data-testid="guest-create-add-port"]').click();
      await frame.locator('[data-testid="guest-create-port-0-port"]').fill("80");
      await frame.locator('[data-testid="guest-create-add-port"]').click();
      await frame.locator('[data-testid="guest-create-port-1-port"]').fill("443");

      const unnamed = await cluster.confirmDialogText(frame);

      expect(unnamed).toContain("A name is required once a guest declares more than one port");
      expect(unnamed).toContain("Create Guest is disabled - Port 1 name:");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // The section holds the error, so it stays open even when the user shuts
      // it: a submit blocked on a field nobody can see is the dead control W4
      // forbids. Shut again afterwards, because the moment the error is fixed
      // the section really does close - which is the other half of the rule.
      await openGuestSection(frame, "guest-create-network-section");
      expect(await frame.locator('[data-testid="guest-create-port-0-port"]').count()).toBe(1);
      await openGuestSection(frame, "guest-create-network-section");

      await frame.locator('[data-testid="guest-create-port-0-name"]').fill("http");
      await frame.locator('[data-testid="guest-create-port-1-name"]').fill("https");
      await pickCreateOption(frame, "guest-create-port-0-expose", "NodePort");
      await pickCreateOption(frame, "guest-create-port-1-expose", "ClusterIP");

      const mixed = await cluster.confirmDialogText(frame);

      expect(mixed).toContain("this port asks for ClusterIP while another asks for NodePort");
      expect(mixed).toContain("silently mints a Service");
      expect(mixed).toContain("Create Guest is disabled - Port 2 expose:");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await pickCreateOption(frame, "guest-create-port-1-expose", "NodePort");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The third rule: a bridge-bound guest gets no Service at all, and
      // upstream reports nothing when it is asked for one.
      await bindingRadio(frame, "bridge").click();

      const bridged = await cluster.confirmDialogText(frame);

      expect(bridged).toContain("A bridge-bound guest exposes nothing");
      expect(bridged).toContain("mints no Service and reports no error");
      expect(bridged).toContain("Create Guest is disabled - Port 1 expose:");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "refuses the data-disk rules, and offers attachAsDisk on a PVC row alone",
    async () => {
      // The rules that read an object KubeSwift did not create: attachAsDisk is
      // decided by the claim's own volumeMode, which is why this case needs two
      // real PVCs. The ninth disk is the section's own guard (W4).
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await frame.locator('[data-testid="guest-create-name"]').fill("e2e-created-disks-never");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      await openGuestSection(frame, "guest-create-data-disks-section");
      await frame.locator('[data-testid="guest-create-add-disk"]').click();

      // An image row is attached as a raw disk anyway, so the checkbox is not
      // rendered at all and what it would have configured is stated instead.
      expect(await frame.locator('[data-testid="guest-create-disk-0-attach"] .Checkbox').count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-disk-0-attach-dropped"]').innerText()).toContain(
        "always attached as a raw VM disk",
      );

      await frame.locator('[data-testid="guest-create-disk-0-name"]').fill("vol");
      await pickCreateOption(frame, "guest-create-disk-0-image", "e2e-ubuntu-2404");

      // Two sources on one row are inexpressible rather than validated: moving
      // the row to another source empties the one it leaves, so the image
      // control is gone the moment the PVC one appears.
      await dataDiskSourceRadio(frame, 0, "pvc").click();
      expect(await frame.locator(".Select:has(#guest-create-disk-0-image)").count()).toBe(0);
      expect(await frame.locator(".Select:has(#guest-create-disk-0-pvc)").count()).toBe(1);

      await pickCreateOption(frame, "guest-create-disk-0-pvc", "e2e-data-filesystem");
      await frame.locator('[data-testid="guest-create-disk-0-attach"] .Checkbox').click();

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("The claim e2e-data-filesystem is Filesystem");
      expect(refused).toContain("needs a Block claim");
      expect(refused).toContain("Create Guest is disabled - Data disk 1 attach as disk:");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // The same row against the Block claim is accepted: the rule is about the
      // claim, not about the checkbox.
      await pickCreateOption(frame, "guest-create-disk-0-pvc", "e2e-data-block");

      const accepted = await cluster.confirmDialogText(frame);

      // Matched on the refusal's own opening rather than on the phrase "needs a
      // Block claim", which the checkbox's hint says on every PVC row: an
      // assertion that cannot tell the rule from the explanation of the rule
      // would pass on a form that had stopped enforcing it.
      expect(accepted).not.toContain("The claim e2e-data-filesystem is Filesystem");
      expect(accepted).not.toContain("Create Guest is disabled");
      expect(accepted).toContain("the existing claim e2e-data-block (Block) is attached to the guest as a raw VM");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The ninth disk: the add control is disabled WITH its reason, never
      // hidden and never silently inert.
      for (let index = 1; index < 8; index += 1) {
        await frame.locator('[data-testid="guest-create-add-disk"]').click();
        await frame.locator(`[data-testid="guest-create-disk-${index}-name"]`).fill(`filler-${index}`);
      }

      expect(await frame.locator('[data-testid="guest-create-disk-7-name"]').count()).toBe(1);
      expect(await frame.locator('[data-testid="guest-create-add-disk"]').isDisabled()).toBe(true);

      const full = await frame.locator('[data-testid="guest-create-add-disk-blocked"]').innerText();

      expect(full).toContain("at most 8 data disks");
      expect(full).toContain("already has 8");

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "replaces the GPU section with the guard's reason on kernel boot and on a windows image",
    async () => {
      // Two of the three exclusions, and they are different kinds of fact: the
      // kernel one is upstream's documented-but-unenforced rule (G6), which no
      // webhook and no controller anywhere rejects, and the Windows one follows
      // the picked image rather than the boot source.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const before = guestNames();

      await openCreateGuestDialog(frame);
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await bootSourceRadio(frame, "kernel").click();

      expect(await frame.locator('[data-testid="guest-create-gpu-section"]').count()).toBe(0);

      const kernelReason = await frame.locator('[data-testid="guest-create-gpu-dropped"]').innerText();

      expect(kernelReason).toContain("A kernel-boot guest takes no GPU");
      expect(kernelReason).toContain("mutually exclusive");
      expect(kernelReason).toContain("nothing in the API server, the webhook or the controller enforces it");

      // Back to disk boot, on the Windows image: the section is refused again,
      // for a reason about the OS rather than about the boot source.
      await bootSourceRadio(frame, "image").click();
      await pickCreateOption(frame, "guest-create-image", "e2e-windows-2022");

      expect(await frame.locator('[data-testid="guest-create-gpu-section"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-gpu-dropped"]').innerText()).toContain(
        "A Windows guest takes no GPU profile",
      );

      // And the section is back on a linux image, with nothing asked for.
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");
      expect(await frame.locator('[data-testid="guest-create-gpu-section"]').count()).toBe(1);
      expect(await frame.locator('[data-testid="guest-create-gpu-dropped"]').count()).toBe(0);

      await cluster.cancelDialog(frame);

      expect(guestNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a cluster-scoped guest class, and reads back the leaves it sent",
    async () => {
      // SPEC-0014 slice 1, and the first create of this suite that writes a
      // cluster-scoped object: the dialog has no namespace control at all, the
      // store's create sends no namespace, and the readback is by name alone.
      // Nothing reconciles it - the kind has no controller and no status - so
      // what lands is exactly what was sent plus what the API server stamped.
      await cluster.openKubeSwiftPage(frame, "swiftguestclasses", "Guest Classes");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-class");

      await openCreateGuestClassDialog(frame);
      await frame.locator('[data-testid="guestclass-create-name"]').fill(name);
      await frame.locator('[data-testid="guestclass-create-cpu"]').fill("2");
      await frame.locator('[data-testid="guestclass-create-memory"]').fill("4Gi");
      await frame.locator('[data-testid="guestclass-create-root-disk-size"]').fill("30Gi");
      await pickCreateOption(frame, "guestclass-create-root-disk-format", "qcow2");

      // The one pair the CRD's CEL rule allows, on a StorageClass the fixtures
      // provide: the picker is a picker because the cluster read answered.
      await pickCreateOption(frame, "guestclass-create-access-mode", "ReadWriteMany");
      await pickCreateOption(frame, "guestclass-create-volume-mode", "Block");
      await pickCreateOption(frame, "guestclass-create-storage-class", "e2e-migratable");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftGuestClass ${name}`);
      expect(dialog).toContain("Creating a guest class creates nothing else");
      expect(dialog).toContain("2 cpu, 4Gi of memory and a 30Gi qcow2 root disk");
      expect(dialog).toContain("StorageClass e2e-migratable");
      // The live-migration derivation, named for the object being written
      // rather than for a guest that does not exist yet (F10).
      expect(dialog).toContain("a guest of this class can be live-migrated");
      // The two rules nothing enforces, stated where the operator sets them.
      expect(dialog).toContain("No webhook exists for this kind at all");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuestClass ${name} created`);
      await cluster.expectRow(frame, name, "2 4Gi 30Gi");

      const spec = JSON.parse(cluster.kubectlField("swiftguestclasses.swift.kubeswift.io", name, "{.spec}"));

      // The exact key set. `coreScheduling` is in it and the form never sent it:
      // the CRD carries `default: "off"`, so this is the API server's own stamp,
      // asserted explicitly for the reason SPEC-0013's cases assert theirs.
      expect(Object.keys(spec).sort()).toEqual(["coreScheduling", "cpu", "memory", "rootDisk", "storage"]);
      expect(spec.coreScheduling).toBe("off");
      expect(spec.cpu).toBe("2");
      expect(spec.memory).toBe("4Gi");
      expect(spec.rootDisk).toEqual({ format: "qcow2", size: "30Gi" });
      expect(spec.storage).toEqual({
        accessMode: "ReadWriteMany",
        volumeMode: "Block",
        storageClassName: "e2e-migratable",
      });

      // Cluster-scoped for real: the object carries no namespace, which is the
      // request path upstream's own catalog gets wrong (F3).
      expect(cluster.kubectlField("swiftguestclasses.swift.kubeswift.io", name, "{.metadata.namespace}")).toBe("");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses ReadWriteMany without Block, and again with the volume mode empty",
    async () => {
      // The CRD's only CEL rule, mirrored client-side with its true shape (F9).
      // Upstream offers ReadWriteMany with Filesystem and lets the API server
      // answer with a decoded CEL message; the shape it misses entirely is the
      // second half of this case, where the volume mode is not set at all.
      await cluster.openKubeSwiftPage(frame, "swiftguestclasses", "Guest Classes");

      const before = guestClassNames();

      await openCreateGuestClassDialog(frame);
      await frame.locator('[data-testid="guestclass-create-name"]').fill("e2e-class-refused");
      await frame.locator('[data-testid="guestclass-create-cpu"]').fill("2");
      await frame.locator('[data-testid="guestclass-create-memory"]').fill("4Gi");
      await frame.locator('[data-testid="guestclass-create-root-disk-size"]').fill("30Gi");
      await pickCreateOption(frame, "guestclass-create-root-disk-format", "raw");

      // First shape: ReadWriteMany on a Filesystem volume.
      await pickCreateOption(frame, "guestclass-create-access-mode", "ReadWriteMany");
      await pickCreateOption(frame, "guestclass-create-volume-mode", "Filesystem");

      const refusal = await cluster.confirmDialogText(frame);

      expect(refusal).toContain("ReadWriteMany requires volumeMode Block");
      expect(refusal).toContain("not live-migration-capable");
      // W4 and W12: the reason is at the field AND next to the disabled button.
      const blocked = await frame.locator('[data-testid="guestclass-create-submit-blocked"]').innerText();

      expect(blocked).toContain("Access mode");
      expect(blocked).toContain("volumeMode Block");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // Second shape: the volume mode cleared entirely, which the CEL rule
      // refuses just as hard because it tests `has(volumeMode)` as well.
      await createFormControl(frame, "guestclass-create-volume-mode").locator(".Select__clear-indicator").click();

      const cleared = await cluster.confirmDialogText(frame);

      expect(cleared).toContain("volume mode left empty is refused");
      expect(await frame.locator('[data-testid="guestclass-create-submit-blocked"]').innerText()).toContain(
        "Access mode",
      );
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // And it clears the moment the allowed pair is chosen.
      await pickCreateOption(frame, "guestclass-create-volume-mode", "Block");
      expect(await frame.locator('[data-testid="guestclass-create-submit-blocked"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(guestClassNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "offers no namespace control on the cluster-scoped kind, and says why",
    async () => {
      // F3. The absence is the feature, so the case asserts both halves: no
      // control, and the fact standing where it would have been. Upstream's own
      // sample sets a `metadata.namespace` on this kind, and its catalog marks
      // it namespaced while the CRD is `scope: Cluster`.
      await cluster.openKubeSwiftPage(frame, "swiftguestclasses", "Guest Classes");

      const before = guestClassNames();

      await openCreateGuestClassDialog(frame);

      // Scoped to the form: the list page behind the dialog has a namespace
      // filter of its own, and this is about the form rather than the screen.
      const form = frame.locator('[data-testid="swiftguestclass-create-form"]');

      expect(await form.locator(".Select:has(#guestclass-create-namespace)").count()).toBe(0);
      expect(await form.locator(".NamespaceSelect").count()).toBe(0);

      const scope = await frame.locator('[data-testid="guestclass-create-scope"]').innerText();

      expect(scope).toContain("cluster-scoped");
      expect(scope).toContain("metadata.namespace");

      // The write line names no namespace either, which is the same fact one
      // layer down (W1).
      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("Create SwiftGuestClass <name>");
      expect(dialog).not.toContain("kubeswift-e2e/");

      await cluster.cancelDialog(frame);

      expect(guestClassNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a kernel and reads back its ociRef, kernelCmdline and profile",
    async () => {
      // SPEC-0014 slice 1. Four leaves, no CEL, no defaults: what the form sends
      // is exactly what the object holds, which makes this the cleanest readback
      // in the suite.
      await cluster.openKubeSwiftPage(frame, "swiftkernels", "Kernels");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-kernel-obj");

      await openCreateKernelDialog(frame);
      await frame.locator('[data-testid="kernel-create-name"]').fill(name);
      await frame.locator('[data-testid="kernel-create-image"]').fill("ghcr.io/freelensapp/kubeswift-e2e/kernel:6.13");
      await pickCreateOption(frame, "kernel-create-pull-secret", "e2e-kernel-registry");
      await frame.locator('[data-testid="kernel-create-cmdline"]').fill("console=ttyS0 reboot=k panic=1");
      await frame.locator('[data-testid="kernel-create-profile"]').fill("e2e-linux-6.13");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftKernel kubeswift-e2e/${name}`);
      expect(dialog).toContain("ghcr.io/freelensapp/kubeswift-e2e/kernel:6.13");
      // F19, at the field and in the summary: the secret authenticates the ORAS
      // container image, not the artifact pull.
      expect(dialog).toContain("not the oras pull of the kernel artifact");
      // SPEC-0013's sentence from the other end.
      expect(dialog).toContain("replaces this line");
      // The profile's own honest description.
      expect(dialog).toContain("no code consumers");
      // F13, and deliberately not SPEC-0013's self-heal sentence.
      expect(dialog).toContain("Failed is terminal");
      expect(dialog).toContain("Deleting the pull Job");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftKernel kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftkernels.kernel.kubeswift.io", name, "{.spec}"));

      // The exact key set: the schema stamps nothing on this kind, so what the
      // form sent is the whole object.
      expect(Object.keys(spec).sort()).toEqual(["kernelCmdline", "ociRef", "profile"]);
      expect(spec.ociRef).toEqual({
        image: "ghcr.io/freelensapp/kubeswift-e2e/kernel:6.13",
        pullSecret: "e2e-kernel-registry",
      });
      expect(spec.kernelCmdline).toBe("console=ttyS0 reboot=k panic=1");
      expect(spec.profile).toBe("e2e-linux-6.13");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a padded image reference and a command line with a newline, each with its reason",
    async () => {
      // Two of the five webhook-only rules, and the webhook ships disabled, so
      // this form is the only thing between the operator and a pull that fails
      // on every labelled node at once (F5).
      await cluster.openKubeSwiftPage(frame, "swiftkernels", "Kernels");

      const before = kernelNames();

      await openCreateKernelDialog(frame);
      await frame.locator('[data-testid="kernel-create-name"]').fill("e2e-kernel-refused");
      await frame.locator('[data-testid="kernel-create-image"]').fill(" ghcr.io/freelensapp/kubeswift-e2e/kernel:6.12");

      const padded = await cluster.confirmDialogText(frame);

      expect(padded).toContain("whitespace around it");
      expect(padded).toContain("a name nobody typed");
      expect(await frame.locator('[data-testid="kernel-create-submit-blocked"]').innerText()).toContain("OCI image");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // Trimmed by hand, which is what upstream's validator refuses to do for
      // the user: the field goes quiet and the command line takes over.
      await frame.locator('[data-testid="kernel-create-image"]').fill("ghcr.io/freelensapp/kubeswift-e2e/kernel:6.12");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The fifth rule, and the reason this control is a textarea: a single-line
      // <input> applies the browser's own value sanitization, which strips a
      // pasted newline instead of refusing it, so the two arguments would arrive
      // joined into one nonsense token and the rule could never fire.
      await frame.locator('[data-testid="kernel-create-cmdline"]').fill("console=ttyS0\nquiet");

      const newline = await cluster.confirmDialogText(frame);

      expect(newline).toContain("newline, a carriage return or a NUL");
      expect(newline).toContain("hypervisor argument");
      expect(await frame.locator('[data-testid="kernel-create-submit-blocked"]').innerText()).toContain(
        "Kernel command line",
      );
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await cluster.cancelDialog(frame);

      expect(kernelNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "says no node carries the kernel-node label, and creates anyway",
    async () => {
      // F12 and W12's warning-never-blocks, in one place. The single-node E2E
      // cluster carries no `kubeswift.io/kernel-node` label, so the count read
      // on open is a real zero: the kernel will sit in Pending with no Job at
      // all, the summary says so before the write, and the write happens
      // anyway - because labelling a node afterwards starts the pull, and a
      // client-side guess is not a reason to refuse a legal object.
      await cluster.openKubeSwiftPage(frame, "swiftkernels", "Kernels");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-kernel-pending");

      await openCreateKernelDialog(frame);
      await frame.locator('[data-testid="kernel-create-name"]').fill(name);
      await frame.locator('[data-testid="kernel-create-image"]').fill("ghcr.io/freelensapp/kubeswift-e2e/kernel:6.14");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("No node in this cluster carries kubeswift.io/kernel-node: true");
      expect(dialog).toContain("sits in Pending");
      expect(dialog).toContain("labelling a node afterwards starts the pull");
      // Never "unverified": the read answered, and it answered zero.
      expect(dialog).not.toContain("unverified - not zero");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftKernel kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftkernels.kernel.kubeswift.io", name, "{.spec}"));

      // Nothing optional was typed, so nothing optional was sent - and above
      // all no empty-name pull secret, which the schema would have accepted
      // (G7).
      expect(Object.keys(spec)).toEqual(["ociRef"]);
      expect(spec.ociRef).toEqual({ image: "ghcr.io/freelensapp/kubeswift-e2e/kernel:6.14" });

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "keeps the last row's menu clear of the host's floating create button",
    async () => {
      // The page fix of SPEC-0013 slice 3. The host draws the "+" over the
      // bottom-right corner of the list, which is where the kebab of the last
      // row lands once the list scrolls - and the button wins the click, with
      // no way for the user to tell why. The list is virtualized, so the fix is
      // block-end padding on the scroll container itself; this asserts the
      // padding, the geometry it buys, and that the menu opens from a plain
      // click with no scrolling of ours.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      const list = frame.locator(".VirtualList .list").first();

      await list.waitFor({ state: "visible", timeout: 60_000 });

      const padding = await list.evaluate((element) => getComputedStyle(element).paddingBottom);

      expect(padding).toBe("80px");

      // All the way down, which is where the collision used to be. The case is
      // only worth anything on a list that really scrolls - the collision needs
      // the last row to reach the bottom of the viewport - so a list that fits
      // is a failure rather than a pass: by this point the create cases above
      // have added six guests to the sixteen the fixtures carry.
      const scrolls = await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;

        return element.scrollHeight > element.clientHeight;
      });

      expect(scrolls).toBe(true);
      await frame.waitForTimeout(500);

      const kebab = frame.locator(".TableRow").last().locator(".TableCell.menu .Icon").first();
      const addButton = frame.locator(".AddRemoveButtons .add-button");
      const kebabBox = await kebab.boundingBox();
      const addBox = await addButton.boundingBox();

      if (!kebabBox || !addBox) {
        throw new Error("Both the last row's kebab and the create button must be on screen");
      }

      const overlaps =
        kebabBox.x < addBox.x + addBox.width &&
        addBox.x < kebabBox.x + kebabBox.width &&
        kebabBox.y < addBox.y + addBox.height &&
        addBox.y < kebabBox.y + kebabBox.height;

      expect(overlaps).toBe(false);

      // Clicked as it is, without the centring `openRowMenu` does: that helper
      // keeps its scroll because it protects every case in this suite, and this
      // one exists to prove the product no longer needs it.
      await kebab.click();
      await frame.waitForSelector(".Menu .MenuItem", { state: "visible", timeout: 60_000 });
      await cluster.closeRowMenu(frame);
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

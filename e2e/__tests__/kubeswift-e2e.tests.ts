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
 * Asserts that a create dialog the API server's `AlreadyExists` sent back is
 * really ON SCREEN, and not merely present.
 *
 * Waiting for it to DETACH first is what makes the second wait meaningful: the
 * host's own close is still on screen when the notification lands, so a bare
 * `visible` wait matches the dialog that is on its way out rather than the one
 * coming back.
 *
 * The class and the opacity are the part no `inputValue()` can see, which is
 * why nobody caught the defect before SPEC-0016 slice 2: the host's `Animate`
 * (Freelens 1.10.3) clears its `leave` class in a `setTimeout(leaveDuration)`
 * that its own effect CANCELS when the dialog is reopened inside that 100ms
 * window, so a reopen at zero delay keeps BOTH classes and
 * `.opacity-scale.leave` wins the cascade - a form nobody can see, over a page
 * nobody can click, because it still intercepts every pointer event.
 * `dialogReopenDelay` (`create-dialog.tsx`) is the fix, and this is the assert
 * that keeps it, on every dialog of this repository that reopens on a 409.
 */
async function expectReopenedDialogVisible(frame: Frame): Promise<void> {
  await frame.waitForSelector('[data-testid="confirmation-dialog"]', { state: "detached", timeout: 60_000 });
  await frame.waitForSelector('[data-testid="confirmation-dialog"]', { state: "visible", timeout: 60_000 });
  await frame.waitForTimeout(500);

  const reopened = await frame.evaluate(() => {
    const dialog = document.querySelector('[data-testid="confirmation-dialog"]');

    return dialog
      ? { className: dialog.className, opacity: getComputedStyle(dialog).opacity }
      : { className: "(absent)", opacity: "(absent)" };
  });

  expect(reopened.className).not.toContain("leave");
  expect(reopened.opacity).toBe("1");
}

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
 * Five pages carry it since SPEC-0014: Guests, Guest Classes, Kernels, Images
 * and Seed Profiles.
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
 * Opens (or shuts) one collapsed section of any create form.
 *
 * The header is the section's own first child button - the disclosure the
 * `CollapsibleSection` primitive renders - and it is a real button so the
 * section is reachable by keyboard as well as by this.
 */
async function openFormSection(frame: Frame, testId: string): Promise<void> {
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

/** The SwiftGuestPools the cluster holds, by name: the only way to see a create that did not happen. */
function poolNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftguestpools.swift.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * Opens the Create Guest Pool dialog from the page's own control, and waits for
 * its reads to answer.
 *
 * The reads are the Create Guest form's own - the pool dialog embeds that form
 * as its template - so the class picker turning into a select is what says they
 * have answered, exactly as it does for the standalone form.
 */
async function openCreatePoolDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftguestpool-create-form"]', { state: "visible", timeout: 60_000 });
  await frame.waitForSelector(".Select:has(#guest-create-class)", { state: "visible", timeout: 60_000 });
}

/** One spread-policy radio of the Create Guest Pool form, reached the way every host `Radio` is. */
function spreadRadio(frame: Frame, policy: "pack" | "spread") {
  return frame
    .locator(`[data-testid="pool-create-spread"] .Radio:has([data-testid="pool-create-spread-${policy}"])`)
    .first();
}

/**
 * The key set a template of a guest class, an image and a seed profile
 * produces.
 *
 * Asserted from this one constant by the standalone Create Guest case and by
 * the Create Guest Pool case, which is the composition property of SPEC-0015
 * stated where it can be checked against the API server: the pool's
 * spec.template.spec is what the Create Guest form would have sent for the same
 * choices, key for key.
 */
const guestTemplateKeys = ["guestClassRef", "imageRef", "osType", "runPolicy", "seedProfileRef"];

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

/** The SwiftImages the cluster holds, by name. */
function imageNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftimages.image.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/** The same, for the objects the Create Seed Profile dialog creates. */
function seedProfileNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftseedprofiles.seed.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * Opens the Create Image dialog from the page's own control.
 *
 * Nothing is waited for beyond the form itself: the form opens on the HTTP
 * source, whose one field is a text input, and both of this dialog's pickers
 * live on the other branch or inside the collapsed section. The cases that need
 * a read wait for it where they need it.
 */
async function openCreateImageDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftimage-create-form"]', { state: "visible", timeout: 60_000 });
}

/** Moves the open Create Image form to the OCI source, and waits for its Secret read to answer. */
async function useImageOciSource(frame: Frame): Promise<void> {
  await imageSourceRadio(frame, "oci").click();
  await frame.waitForSelector(".Select:has(#image-create-credentials-secret)", {
    state: "visible",
    timeout: 60_000,
  });
}

/** One source radio of the Create Image form, reached the way every host `Radio` is. */
function imageSourceRadio(frame: Frame, source: "http" | "oci") {
  return frame
    .locator(`[data-testid="image-create-source"] .Radio:has([data-testid="image-create-source-${source}"])`)
    .first();
}

/** One pin-by radio of the Create Image form's OCI branch. */
function imagePinByRadio(frame: Frame, pinBy: "tag" | "digest") {
  return frame
    .locator(`[data-testid="image-create-pin-by"] .Radio:has([data-testid="image-create-pin-by-${pinBy}"])`)
    .first();
}

/** Opens the Create Seed Profile dialog from the page's own control. */
async function openCreateSeedProfileDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftseedprofile-create-form"]', { state: "visible", timeout: 60_000 });
}

/** One origin radio of one document group of the Create Seed Profile form. */
function seedOriginRadio(frame: Frame, document: string, origin: "inline" | "secret" | "config-map") {
  return frame
    .locator(
      `[data-testid="seedprofile-create-${document}-origin"] .Radio:has([data-testid="seedprofile-create-${document}-origin-${origin}"])`,
    )
    .first();
}

/**
 * Moves one document group to a reference origin, and waits for the read behind
 * it to answer.
 *
 * The object control is a text input until the namespace's Secrets or
 * ConfigMaps come back, so waiting for the select is waiting for the read rather
 * than racing it.
 */
async function useSeedReference(frame: Frame, document: string, origin: "secret" | "config-map"): Promise<void> {
  await seedOriginRadio(frame, document, origin).click();
  await frame.waitForSelector(`.Select:has(#seedprofile-create-${document}-object)`, {
    state: "visible",
    timeout: 60_000,
  });
}

/** The SwiftSandboxPools the cluster holds, by name: the only way to see a create that did not happen. */
function sandboxPoolNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftsandboxpools.sandbox.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * Opens the Create Sandbox Pool dialog from the page's own control, and waits
 * for its reads to answer.
 *
 * The kernel-profile picker is a text input until the namespace's SwiftKernels
 * come back, so waiting for the select is waiting for the read rather than
 * racing it - the idiom every create opener of this suite uses.
 */
async function openCreateSandboxPoolDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftsandboxpool-create-form"]', { state: "visible", timeout: 60_000 });
  await frame.waitForSelector(".Select:has(#sandbox-create-kernel-profile)", { state: "visible", timeout: 60_000 });
}

/** The SwiftSandboxes the cluster holds, by name: the only way to see a create that did not happen. */
function sandboxNames(): string[] {
  const { stdout } = cluster.kubectlE2E("get", "swiftsandboxes.sandbox.kubeswift.io", "--output", "name");

  return stdout ? stdout.split("\n").sort() : [];
}

/**
 * Opens the Create Sandbox dialog from the page's own control, and waits for its
 * reads to answer.
 *
 * The kernel-profile picker is a text input until the namespace's SwiftKernels
 * come back, so waiting for the select is waiting for the read rather than
 * racing it - the idiom every create opener of this suite uses.
 */
async function openCreateSandboxDialog(frame: Frame): Promise<void> {
  await pageCreateControl(frame).click();
  await frame.waitForSelector('[data-testid="swiftsandbox-create-form"]', { state: "visible", timeout: 60_000 });
  await frame.waitForSelector(".Select:has(#sandbox-create-kernel-profile)", { state: "visible", timeout: 60_000 });
}

/** One source radio of the Create Sandbox form, reached the way every host `Radio` is. */
function sandboxSourceRadio(frame: Frame, source: "new" | "checkout") {
  return frame
    .locator(`[data-testid="sandbox-create-source"] .Radio:has([data-testid="sandbox-create-source-${source}"])`)
    .first();
}

/** One scratch-disk source radio, which is the control that makes an empty block unbuildable. */
function scratchSourceRadio(frame: Frame, source: "none" | "blank" | "existing") {
  return frame
    .locator(
      `[data-testid="sandbox-create-scratch-source"] .Radio:has([data-testid="sandbox-create-scratch-source-${source}"])`,
    )
    .first();
}

/** One GPU backend radio of the Create Sandbox form. */
function sandboxGpuBackendRadio(frame: Frame, backend: "none" | "profile" | "dra") {
  return frame
    .locator(
      `[data-testid="sandbox-create-gpu-backend"] .Radio:has([data-testid="sandbox-create-gpu-backend-${backend}"])`,
    )
    .first();
}

/** Switches the form to a checkout, and waits for the pool read to have answered. */
async function useSandboxCheckout(frame: Frame): Promise<void> {
  await sandboxSourceRadio(frame, "checkout").click();
  await frame.waitForSelector(".Select:has(#sandbox-create-pool)", { state: "visible", timeout: 60_000 });
}

/** Adds one argv row to a list of the Create Sandbox form and fills it. */
async function addArgvRow(frame: Frame, list: "command" | "args", index: number, value: string): Promise<void> {
  await frame.locator(`[data-testid="sandbox-create-add-${list}"]`).click();
  await frame.locator(`[data-testid="sandbox-create-${list}-${index}-value"]`).fill(value);
}

/** Adds one environment row of the Create Sandbox form and fills both of its fields. */
async function addEnvRow(frame: Frame, index: number, name: string, value: string): Promise<void> {
  await frame.locator('[data-testid="sandbox-create-add-env"]').click();
  await frame.locator(`[data-testid="sandbox-create-env-${index}-name"]`).fill(name);
  await frame.locator(`[data-testid="sandbox-create-env-${index}-value"]`).fill(value);
}

/** The digest the image cases pin by: a well-formed sha256 that names nothing. */
const e2eImageDigest = `sha256:${"1234567890abcdef".repeat(4)}`;

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

/**
 * The dock tab a console open produced, by the title the extension chose.
 *
 * The precedent is the M4 log-dock case, which asserts `.Dock .Tab` by text for
 * the same reason: the tab is the host's own markup and the title is the only
 * part of it this extension owns.
 */
function consoleTab(frame: Frame, guestName: string) {
  return frame.locator(".Dock .Tab", { hasText: `Console: ${guestName}` }).first();
}

/**
 * The terminal's visible text, with every whitespace removed.
 *
 * Freelens's terminal loads no canvas or WebGL renderer, so xterm uses its DOM
 * renderer and the typed line is real text in `.xterm-rows` (SPEC-0017,
 * digest C4). A row is a fixed number of columns wide, so a command line as long
 * as this one WRAPS mid-token and a naive `toContain` on a path would fail on a
 * terminal that is working perfectly; dropping the whitespace rejoins the token
 * across the wrap. It also means the needles below are written without spaces.
 */
async function terminalText(frame: Frame): Promise<string> {
  const rows = frame.locator(".xterm-rows").first();

  await rows.waitFor({ state: "visible", timeout: 60_000 });

  return (await rows.innerText()).replace(/\s+/g, "");
}

/**
 * Waits until the terminal shows `needle`, and returns everything it showed.
 *
 * Polled rather than awaited on a selector, because what arrives in a terminal
 * is text inside one element rather than an element of its own. The failure
 * message carries the whole screen, which is the only useful thing to look at
 * when a console does not do what it was asked.
 */
async function expectTerminalText(frame: Frame, needle: string, timeout = 60_000): Promise<string> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const seen = await terminalText(frame);

    if (seen.includes(needle)) {
      return seen;
    }

    if (Date.now() > deadline) {
      const screenshot = await cluster.captureScreenshot(frame, `terminal-${needle.slice(0, 24)}`);

      throw new Error(
        `The terminal never showed "${needle}". What it showed: ${seen || "(nothing)"}.` +
          (screenshot ? ` Screenshot: ${screenshot}` : ""),
      );
    }

    await frame.waitForTimeout(500);
  }
}

/**
 * Closes a console tab once its command has ended, so the case after this one
 * finds the dock as it was.
 *
 * The dock covers the lower half of every list page underneath it, and the M4
 * log-dock case at the end of this file is written on the assumption that it is
 * the one that opens it.
 *
 * The wait for `[Process exited with code` before the click is not politeness.
 * Closing a tab whose `kubectl exec` is still alive kills the shell process
 * while the `pods/exec` upgrade is in flight, and the HOST's kubectl proxy then
 * logs the abandoned dial - `[UPGRADE-PIPE] dial 127.0.0.1:NNNNN failed: ...
 * operation was canceled` - at error level, which this suite's error collector
 * reads as a process error and fails the activation case with it. That is what
 * the host does whenever a connected console is closed, not a defect of this
 * extension (recorded in SPEC-0017's notes, and a candidate for the
 * upstream-Freelens feedback list), so the rule lives on this side: a console
 * tab is closed only after its command has ended, and then the proxy has no
 * upgrade left to cancel. It is also why the defect was invisible on macOS,
 * where kubectl had already exited by the time the tab was closed, and
 * deterministic on the CI Linux runner, where it had not.
 *
 * Every console case can obey the rule, because every one of them ends: the
 * fixture launcher pods are unschedulable, so kubectl exits by itself with
 * "unable to upgrade connection: pod ... does not have a host assigned", and
 * the transport case's exec ends with code 0. A shell that exits leaves its tab
 * open and writes `[Process exited with code N]` into the terminal (SPEC-0017's
 * host fact 2), which is what makes the end of a command observable at all.
 */
async function closeDockTab(frame: Frame, guestName: string): Promise<void> {
  const tab = consoleTab(frame, guestName);

  await expectTerminalText(frame, "[Processexitedwithcode", 60_000);

  await tab.locator('[data-testid^="dock-tab-close-for-"]').first().click();
  await tab.waitFor({ state: "detached", timeout: 60_000 });
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

      // Five registrations since SPEC-0017 added the Serial Console surface.
      // Take Snapshot is never disabled: there is a valid snapshot for every
      // settled guest state, and the gating that matters is per-backend, inside
      // the dialog, where the backend choice exists. Migrate is disabled only
      // for a guest that forbids migration and for an SR-IOV one, neither of
      // which this subject is; Serial Console is enabled for this one because
      // it is Running and its status names a launcher pod.
      expect(runningRowItems.map((item) => item.testId).sort()).toEqual([
        "swiftguest-console-action",
        "swiftguest-migrate-action",
        "swiftguest-start-action",
        "swiftguest-stop-action",
        "swiftguest-take-snapshot-action",
      ]);
      expect(runningRowItems.find((item) => item.testId === "swiftguest-console-action")?.disabled).toBe(false);
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
        "swiftguest-console-action",
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

      // The dialog is back, on screen rather than merely present, with
      // everything the user typed still in it - which is only true because the
      // form model lives outside React (spike T1).
      await expectReopenedDialogVisible(frame);
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

      // The template key set, plus the three keys this case adds to it: the
      // Create Guest Pool case asserts the same constant for the same choices
      // (SPEC-0015's composition property, against the API server).
      expect(Object.keys(spec).sort()).toEqual([...guestTemplateKeys, "guestAgent", "nodeName", "storage"].sort());
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
      await openFormSection(frame, "guest-create-data-disks-section");
      await frame.locator('[data-testid="guest-create-add-disk"]').click();
      await frame.locator('[data-testid="guest-create-disk-0-name"]').fill("extra");
      await pickCreateOption(frame, "guest-create-disk-0-image", "e2e-ubuntu-2404");

      await frame.locator('[data-testid="guest-create-add-disk"]').click();
      await frame.locator('[data-testid="guest-create-disk-1-name"]').fill("scratch");
      await dataDiskSourceRadio(frame, 1, "blank").click();
      await frame.locator('[data-testid="guest-create-disk-1-size"]').fill("20Gi");

      // Section 9: two exposed ports and one additional interface.
      await openFormSection(frame, "guest-create-network-section");
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
      await openFormSection(frame, "guest-create-gpu-section");
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

      await openFormSection(frame, "guest-create-network-section");
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
      await openFormSection(frame, "guest-create-network-section");
      expect(await frame.locator('[data-testid="guest-create-port-0-port"]').count()).toBe(1);
      await openFormSection(frame, "guest-create-network-section");

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

      await openFormSection(frame, "guest-create-data-disks-section");
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
    "creates an OCI image pinned by digest, and reads back what the server stamped into it",
    async () => {
      // SPEC-0014 slice 2. The OCI source is the one upstream's own API
      // reference omits entirely, and the only one with supply-chain features:
      // this writes both of its Secret references and pins the artifact by
      // digest, then asserts the exact key set - including the two values the
      // form deliberately never sends and the CRD's own defaults put there.
      await cluster.openKubeSwiftPage(frame, "swiftimages", "Images");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-image-oci");

      await openCreateImageDialog(frame);
      await frame.locator('[data-testid="image-create-name"]').fill(name);
      await useImageOciSource(frame);
      await frame.locator('[data-testid="image-create-repository"]').fill("ghcr.io/freelensapp/kubeswift-e2e/golden");
      // The form opens pinned by digest, which is what upstream's own CRD
      // comment recommends, so no radio has to move for this case.
      await frame.locator('[data-testid="image-create-digest"]').fill(e2eImageDigest);
      await pickCreateOption(frame, "image-create-credentials-secret", "e2e-kernel-registry");
      await pickCreateOption(frame, "image-create-verify-key-secret", "e2e-cosign-key");
      await pickCreateOption(frame, "image-create-format", "raw");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftImage kubeswift-e2e/${name}`);
      expect(dialog).toContain(`ghcr.io/freelensapp/kubeswift-e2e/golden@${e2eImageDigest}`);
      // The one supply-chain check anywhere in this kind, when a key is named.
      expect(dialog).toContain("before its bytes are trusted");
      // The privileged root import Job, which upstream documents nowhere.
      expect(dialog).toContain("privileged and as root");
      // The controller's own 10Gi, stated as not sent - the distinction from
      // the format, which the API server really does require.
      expect(dialog).toContain("which is not sent and never appears in the stored object");
      expect(dialog).toContain("The walk is Pending, Importing, Validating, Preparing, Ready.");
      // F13, and deliberately not SPEC-0013's self-heal sentence.
      expect(dialog).toContain("Failed is terminal");
      expect(dialog).toContain("delete-and-recreate");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftImage kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftimages.image.kubeswift.io", name, "{.spec}"));

      // The exact key set. `osType` and `cloneStrategy` are in it and the form
      // sent neither: the CRD carries `default: linux` and `default: copy`, so
      // both are the API server's own stamp, asserted explicitly for the reason
      // every other stamped default in this suite is (F17).
      expect(Object.keys(spec).sort()).toEqual(["cloneStrategy", "format", "osType", "source"]);
      expect(spec.osType).toBe("linux");
      expect(spec.cloneStrategy).toBe("copy");
      expect(spec.format).toBe("raw");
      expect(spec.source).toEqual({
        oci: {
          repository: "ghcr.io/freelensapp/kubeswift-e2e/golden",
          digest: e2eImageDigest,
          credentialsSecretRef: { name: "e2e-kernel-registry" },
          verifyKeySecretRef: { name: "e2e-cosign-key" },
        },
      });
      // The XOR, in the object rather than in the form: no tag, and no
      // `insecure: false` either, which the schema does not default.
      expect(spec.source.oci.tag).toBeUndefined();
      expect(spec.source.oci.insecure).toBeUndefined();
      // 10Gi is a controller constant, so the stored object carries no rootDisk
      // at all, and no cloneStorageClassName, which the controller reads
      // nowhere (F15).
      expect(spec.rootDisk).toBeUndefined();
      expect(spec.cloneStorageClassName).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a snapshot strategy with no volume snapshot class",
    async () => {
      // F8. Upstream checks this only on reaching `Snapshotting`, having already
      // downloaded, converted and measured the whole artifact, and the rule that
      // would have caught it at admission lives in a webhook that ships
      // disabled. The requirement is created INSIDE the collapsed section, by
      // choosing the strategy that needs it, which is what makes the section
      // legal under DESIGN.md section 12.
      await cluster.openKubeSwiftPage(frame, "swiftimages", "Images");

      const before = imageNames();

      await openCreateImageDialog(frame);
      await frame.locator('[data-testid="image-create-name"]').fill("e2e-image-refused-snapshot");
      await frame
        .locator('[data-testid="image-create-url"]')
        .fill("https://images.example.invalid/noble-cloudimg-amd64.img");
      await pickCreateOption(frame, "image-create-format", "raw");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The section ships collapsed and hides nothing that is required before it
      // is opened: the volume snapshot class field does not exist yet.
      await frame.locator('[data-testid="image-create-storage-section"] > button').first().click();
      expect(await frame.locator('[data-testid="image-create-volume-snapshot-class"]').count()).toBe(0);

      await pickCreateOption(frame, "image-create-clone-strategy", "snapshot");

      const refusal = await cluster.confirmDialogText(frame);

      expect(refusal).toContain("downloaded, converted and measured");
      expect(await frame.locator('[data-testid="image-create-submit-blocked"]').innerText()).toContain(
        "Volume snapshot class",
      );
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await frame.locator('[data-testid="image-create-volume-snapshot-class"]').fill("csi-hostpath-snapclass");

      const named = await cluster.confirmDialogText(frame);

      expect(await frame.locator('[data-testid="image-create-submit-blocked"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);
      // Unverified for a reason of its own: the host exposes no
      // VolumeSnapshotClass API, so there is no read to make from here.
      expect(named).toContain("no VolumeSnapshotClass API is exported");
      expect(named).toContain("Snapshotting");

      await cluster.cancelDialog(frame);

      expect(imageNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "refuses an OCI source with neither a tag nor a digest",
    async () => {
      // F7, the gap NO layer closes: not the schema, not the webhook, not the
      // controller. An OCI source with neither is admitted without a word and
      // then hands the puller an empty reference. The pin-by radio makes
      // "neither" unreachable, and this asserts it from both sides - including
      // that switching the pin clears the other field, which is what makes the
      // tag/digest exclusivity a property of the payload rather than a rule.
      await cluster.openKubeSwiftPage(frame, "swiftimages", "Images");

      const before = imageNames();

      await openCreateImageDialog(frame);
      await frame.locator('[data-testid="image-create-name"]').fill("e2e-image-refused-pin");
      await pickCreateOption(frame, "image-create-format", "qcow2");
      await useImageOciSource(frame);
      await frame.locator('[data-testid="image-create-repository"]').fill("ghcr.io/freelensapp/kubeswift-e2e/golden");

      const unpinned = await cluster.confirmDialogText(frame);

      expect(unpinned).toContain("empty reference");
      expect(await frame.locator('[data-testid="image-create-submit-blocked"]').innerText()).toContain("Digest");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // The other side of the same gap: a tag pin with no tag is refused just
      // as hard, and there is no third state in which neither is asked for.
      await imagePinByRadio(frame, "tag").click();
      expect(await frame.locator('[data-testid="image-create-digest"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="image-create-submit-blocked"]').innerText()).toContain("Tag");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await frame.locator('[data-testid="image-create-tag"]').fill("24.04");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // And moving the pin back empties the tag, so the two can never both be
      // in the payload - the exclusivity, made inexpressible (F6).
      await imagePinByRadio(frame, "digest").click();
      expect(await frame.locator('[data-testid="image-create-tag"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await imagePinByRadio(frame, "tag").click();
      expect(await frame.locator('[data-testid="image-create-tag"]').inputValue()).toBe("");

      await cluster.cancelDialog(frame);

      expect(imageNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a .qcow2 URL is declared raw, and submits anyway",
    async () => {
      // The sharpest fact on this kind, and the one warning upstream has nothing
      // like. Nothing reads the bytes - not the schema, not the webhook, not the
      // controller - so an image declared raw whose bytes are qcow2 reaches
      // Ready and every guest built from it boots garbage. The client never sees
      // the bytes either, so this is a guess about a filename and says so, and
      // W12's warning-never-blocks rule means it submits all the same.
      await cluster.openKubeSwiftPage(frame, "swiftimages", "Images");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-image-http");
      const url = "https://images.example.invalid/noble-server-cloudimg-amd64.qcow2";

      await openCreateImageDialog(frame);
      await frame.locator('[data-testid="image-create-name"]').fill(name);
      await frame.locator('[data-testid="image-create-url"]').fill(url);
      await pickCreateOption(frame, "image-create-format", "raw");

      const warned = await cluster.confirmDialogText(frame);

      expect(warned).toContain("looks like qcow2 and the format says raw");
      expect(warned).toContain("GUESS about a filename");
      expect(warned).toContain("boots garbage");
      // The HTTP path's own absence, stated at the field and in the summary.
      expect(warned).toContain("no checksum field");
      // A warning never blocks (W12).
      expect(await frame.locator('[data-testid="image-create-submit-blocked"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftImage kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftimages.image.kubeswift.io", name, "{.spec}"));

      expect(spec.format).toBe("raw");
      expect(spec.source).toEqual({ http: { url } });
      expect(spec.source.oci).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "creates a seed profile whose user data is a Secret key, and reads back a selector with a name",
    async () => {
      // F14: the credential-safe path is authorable at all. Upstream offers
      // three textareas and its own class comment calls YAML the escape hatch
      // for references, so the path its API comments and GitOps docs prefer is
      // the one path its GUI cannot express. The readback is what proves the
      // key-in-object selector never emits the core API's `""` default (G7).
      await cluster.openKubeSwiftPage(frame, "swiftseedprofiles", "Seed Profiles");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-seed-secret");

      await openCreateSeedProfileDialog(frame);
      await frame.locator('[data-testid="seedprofile-create-name"]').fill(name);

      // The key control does not exist until an object is named: a key with no
      // object is a selector with an empty name, and this form never offers one.
      await seedOriginRadio(frame, "user-data", "secret").click();
      expect(await frame.locator('[data-testid="seedprofile-create-user-data-key-blocked"]').count()).toBe(1);

      await useSeedReference(frame, "user-data", "secret");
      await pickCreateOption(frame, "seedprofile-create-user-data-object", "e2e-seed-user-data");
      await pickCreateOption(frame, "seedprofile-create-user-data-key", "user-data");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftSeedProfile kubeswift-e2e/${name}`);
      expect(dialog).toContain("the key user-data of the Secret e2e-seed-user-data");
      expect(dialog).toContain("Creating a seed profile creates nothing else");
      // The Secret a guest renders later, and the doc error about it.
      expect(dialog).toContain("<guest name>-seed");
      expect(dialog).toContain("still calls it a ConfigMap");
      // The two effective values the form shows rather than fills in.
      expect(dialog).toContain("discards the user data WHOLESALE");
      expect(dialog).toContain("dual-match DHCP netplan");
      // The cross-reference SPEC-0013 already acts on.
      expect(dialog).toContain("created and never mounted");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSeedProfile kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "NoCloud");

      const spec = JSON.parse(cluster.kubectlField("swiftseedprofiles.seed.kubeswift.io", name, "{.spec}"));

      // The exact key set: the datasource this form always sends explicitly
      // (F16), and one reference. No inline document beside it, no empty
      // `metaDataFrom`, no `networkDataFrom`.
      expect(Object.keys(spec).sort()).toEqual(["datasource", "userDataFrom"]);
      expect(spec.datasource).toBe("NoCloud");
      expect(spec.userDataFrom).toEqual({ secretKeyRef: { name: "e2e-seed-user-data", key: "user-data" } });
      expect(spec.userData).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses empty user data in the CEL rule's own words",
    async () => {
      // The one rule on this kind the API server really enforces, and it is CEL
      // rather than webhook on purpose: upstream's own reasoning is DESIGN.md
      // W12's, that a rule holding only when the webhook is enabled is not a
      // rule. The form refuses it in the rule's terms rather than as the API
      // server's decoded CEL message.
      await cluster.openKubeSwiftPage(frame, "swiftseedprofiles", "Seed Profiles");

      const before = seedProfileNames();

      await openCreateSeedProfileDialog(frame);
      await frame.locator('[data-testid="seedprofile-create-name"]').fill("e2e-seed-refused");

      const refusal = await cluster.confirmDialogText(frame);

      expect(refusal).toContain("either an inline document that is not empty, or a reference");
      expect(refusal).toContain("not a webhook rule");
      expect(await frame.locator('[data-testid="seedprofile-create-submit-blocked"]').innerText()).toContain(
        "User data",
      );
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // A document of whitespace satisfies the API server's own `size() > 0` and
      // means nothing, so the form is stricter than the rule it mirrors.
      await frame.locator('[data-testid="seedprofile-create-user-data-inline"]').fill("   ");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await frame.locator('[data-testid="seedprofile-create-user-data-inline"]').fill("#cloud-config\npackages: []");
      expect(await frame.locator('[data-testid="seedprofile-create-submit-blocked"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(seedProfileNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "cannot express an inline value beside a reference",
    async () => {
      // F20, the first of the four silent precedences: an inline document beside
      // a `*From` resolves to the reference, nothing enforces it, both upstream
      // documents forbid it, and upstream's own edit path actively produces it -
      // opening a reference-backed profile and pressing Apply writes a stub
      // inline value next to the reference. Here it is inexpressible: one origin
      // control per document, and switching it empties what it left behind.
      await cluster.openKubeSwiftPage(frame, "swiftseedprofiles", "Seed Profiles");

      const before = seedProfileNames();

      await openCreateSeedProfileDialog(frame);
      await frame.locator('[data-testid="seedprofile-create-name"]').fill("e2e-seed-exclusive");
      await frame.locator('[data-testid="seedprofile-create-user-data-inline"]').fill("#cloud-config\npackages: []");

      await useSeedReference(frame, "user-data", "secret");

      // The inline control is gone rather than ignored, which is what makes the
      // pair inexpressible rather than merely invalid (W12 option dropping).
      expect(await frame.locator('[data-testid="seedprofile-create-user-data-inline"]').count()).toBe(0);

      await pickCreateOption(frame, "seedprofile-create-user-data-object", "e2e-seed-user-data");
      await pickCreateOption(frame, "seedprofile-create-user-data-key", "network-config");

      const referenced = await cluster.confirmDialogText(frame);

      expect(referenced).toContain("the key network-config of the Secret e2e-seed-user-data");
      expect(referenced).not.toContain("stored inline, in spec.userData");

      // And back: the reference controls disappear and the document the user
      // typed before is gone from the model as well as from the payload.
      await seedOriginRadio(frame, "user-data", "inline").click();
      expect(await frame.locator(".Select:has(#seedprofile-create-user-data-object)").count()).toBe(0);
      expect(await frame.locator('[data-testid="seedprofile-create-user-data-inline"]').inputValue()).toBe("");

      // The four shapes this form cannot produce, stated in its footer.
      const footer = await frame.locator('[data-testid="seedprofile-create-footer"]').innerText();

      expect(footer).toContain("inline document beside a reference");
      expect(footer).toContain("Secret key beside a ConfigMap key");
      expect(footer).toContain("empty reference block");
      expect(footer).toContain("reference with an empty name");

      await cluster.cancelDialog(frame);

      expect(seedProfileNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "never sends optional, and says why",
    async () => {
      // F15. Neither resolver reads the flag, upstream documents that nowhere,
      // and what it looks like it controls happens either way: a missing object
      // or key returns the error raw, so the guest retries with backoff with no
      // Resolved=False and no Failed phase. The field is not rendered and the
      // consequence stands in its place - and the readback proves the selector
      // carries exactly the two keys it was given.
      await cluster.openKubeSwiftPage(frame, "swiftseedprofiles", "Seed Profiles");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-created-seed-configmap");

      await openCreateSeedProfileDialog(frame);
      await frame.locator('[data-testid="seedprofile-create-name"]').fill(name);
      await useSeedReference(frame, "user-data", "config-map");
      await pickCreateOption(frame, "seedprofile-create-user-data-object", "e2e-seed-config");
      await pickCreateOption(frame, "seedprofile-create-user-data-key", "user-data");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("the key user-data of the ConfigMap e2e-seed-config");
      expect(dialog).toContain("optional flag is not offered");
      expect(dialog).toContain("neither resolver reads it");
      expect(dialog).toContain("retries with backoff");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSeedProfile kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftseedprofiles.seed.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual(["datasource", "userDataFrom"]);
      // The selector carries a name and a key and nothing else: no `optional`,
      // which nothing reads, and no `secretKeyRef` beside it either.
      expect(Object.keys(spec.userDataFrom.configMapKeyRef).sort()).toEqual(["key", "name"]);
      expect(spec.userDataFrom.configMapKeyRef).toEqual({ name: "e2e-seed-config", key: "user-data" });
      expect(spec.userDataFrom.secretKeyRef).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "creates a pool of three, and reads back a template key-exact with a standalone guest's",
    async () => {
      // SPEC-0015's headline: the pool's template is the Create Guest form's
      // own payload, so the key set stored under spec.template.spec is the key
      // set that form produces for the same choices - the composition property
      // of the unit suite, proved here against the API server itself. Around it
      // is the pool's own surface: the replica count, a ClusterIP Service in
      // front of every replica, and a per-replica claim template, none of which
      // upstream's own wizard can express at all.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-pool");

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill(name);
      await frame.locator('[data-testid="pool-create-replicas"]').fill("3");

      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");
      await pickCreateOption(frame, "guest-create-seed", "e2e-seed-basic");
      await pickCreateOption(frame, "guest-create-run-policy", "Always");

      // The per-replica storage, which is the whole stateful-pool feature.
      await openFormSection(frame, "pool-create-storage-section");
      await frame.locator('[data-testid="pool-create-add-claim"]').click();
      await frame.locator('[data-testid="pool-create-claim-0-name"]').fill("state");
      await frame.locator('[data-testid="pool-create-claim-0-size"]').fill("10Gi");
      await frame.locator('[data-testid="pool-create-claim-0-storage-class"]').fill("e2e-pool-storage");

      // The real PVC name order, which both of upstream's own documents have
      // backwards.
      expect(await frame.locator('[data-testid="pool-create-claim-0-pvc-name"]').innerText()).toContain(
        `state-${name}-0`,
      );

      // One Service in front of every replica.
      await openFormSection(frame, "pool-create-service-section");
      await frame.locator('[data-testid="pool-create-service-enabled"] .Checkbox').click();
      await frame.locator('[data-testid="pool-create-add-service-port"]').click();
      await frame.locator('[data-testid="pool-create-service-port-0-port"]').fill("80");
      await frame.locator('[data-testid="pool-create-service-port-0-name"]').fill("http");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftGuestPool kubeswift-e2e/${name}`);
      expect(dialog).toContain(`3 guests are created, named ${name}-0 to ${name}-2`);
      // D4: the summary multiplies, and it names the real PVCs.
      expect(dialog).toContain("3 launcher pods");
      expect(dialog).toContain("3 root-disk clones of e2e-ubuntu-2404");
      expect(dialog).toContain("3 seed Secrets");
      expect(dialog).toContain(`state-${name}-0`);
      expect(dialog).toContain("Deleting this pool deletes the per-replica PVCs it owns, and their data with them");
      expect(dialog).toContain("ONE unbatched pass");
      // The embedded form's own lines, read as N times themselves.
      expect(dialog).toContain("Each of the 3 replicas is a full SwiftGuest");
      expect(dialog).toContain("The guest class e2e-small sizes it");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuestPool kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftguestpools.swift.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "replicas",
        "service",
        "spreadPolicy",
        "template",
        "volumeClaimTemplates",
      ]);
      // Sent explicitly although the schema defaults it, for the reason the
      // guest form sends runPolicy: required and defaulted at once.
      expect(spec.replicas).toBe(3);
      expect(spec.service.ports).toEqual([{ port: 80, name: "http", protocol: "TCP" }]);
      expect(spec.volumeClaimTemplates).toHaveLength(1);
      expect(spec.volumeClaimTemplates[0].metadata.name).toBe("state");
      expect(spec.volumeClaimTemplates[0].spec.resources.requests.storage).toBe("10Gi");
      expect(spec.volumeClaimTemplates[0].spec.storageClassName).toBe("e2e-pool-storage");
      // What the API server stamped, which the form never sends: the Service
      // type, the port protocol and the spread policy.
      expect(spec.service.type).toBe("ClusterIP");
      expect(spec.spreadPolicy).toBe("Pack");
      // `updateStrategy` has no default of its own, so its absence is the proof
      // that the form sent no rollout at all.
      expect(spec.updateStrategy).toBeUndefined();

      // The composition property, against the API server: the template is the
      // Create Guest form's payload for these choices, key for key.
      expect(Object.keys(spec.template.spec).sort()).toEqual([...guestTemplateKeys].sort());
      expect(spec.template.spec.guestClassRef).toEqual({ name: "e2e-small" });
      expect(spec.template.spec.imageRef).toEqual({ name: "e2e-ubuntu-2404" });
      expect(spec.template.spec.seedProfileRef).toEqual({ name: "e2e-seed-basic" });
      expect(spec.template.spec.osType).toBe("linux");
      expect(spec.template.spec.runPolicy).toBe("Always");
      // Nothing of the pool's own leaked into the template, and no metadata was
      // sent with it: the pool hashes template.spec only.
      expect(spec.template.metadata).toBeUndefined();
      expect(spec.template.spec.topologySpreadConstraints).toBeUndefined();

      // No controller runs here, so the pool fans out into nothing - which is
      // what makes the readback a proof of what the form sent.
      expect(cluster.kubectlField("swiftguestpools.swift.kubeswift.io", name, "{.status.replicas}")).toBe("");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a template MAC on a pool of more than one, and offers it again at one replica",
    async () => {
      // D2. The pool copies interfaces[].mac verbatim into every replica, so N
      // machines come up holding one address; nothing rejects it anywhere - the
      // schema checks the format, the guest webhook's rule is per-object and
      // ships disabled, and a pool has no webhook at all. It is a refusal
      // rather than a warning because the form is reading its own two fields.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");

      const before = poolNames();

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill("e2e-pool-mac");
      await frame.locator('[data-testid="pool-create-replicas"]').fill("2");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      await openFormSection(frame, "guest-create-network-section");
      await frame.locator('[data-testid="guest-create-add-interface"]').click();
      await frame.locator('[data-testid="guest-create-nic-0-name"]').fill("net1");
      await frame.locator('[data-testid="guest-create-nic-0-mac"]').fill("52:54:00:12:34:56");

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("Create Guest Pool is disabled - Interface 1 MAC address:");
      expect(refused).toContain("the pool copies it into all 2 replicas unchanged");
      expect(refused).toContain("a pool has no webhook at all");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // The count is a field the user changes, so the refusal has to release
      // when it comes back down: at one replica a MAC is as legitimate here as
      // it is on the Create Guest form.
      await frame.locator('[data-testid="pool-create-replicas"]').fill("1");

      const offered = await cluster.confirmDialogText(frame);

      expect(offered).not.toContain("Create Guest Pool is disabled");
      expect(await frame.locator('[data-testid="pool-create-submit-blocked"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(poolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a pinned pool puts every replica on one node, and submits anyway",
    async () => {
      // D1, the highest-value thing this extension adds here: nodeName is
      // copied verbatim into every replica and never uniquified, so a pinned
      // template collapses the whole fleet onto one node - and the spread
      // policy cannot save it, because a pin bypasses the scheduler the
      // constraints act on. A warning never blocks: a pinned pool is
      // legitimate on a single-node cluster, or on the node with the devices.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-pool-pinned");
      const node = cluster.clusterNodeName();

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill(name);
      await frame.locator('[data-testid="pool-create-replicas"]').fill("3");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");
      await pickCreateOption(frame, "guest-create-node", node);

      // Spread, so the summary can say the two halves contradict each other.
      await openFormSection(frame, "pool-create-spread-section");
      await spreadRadio(frame, "spread").click();

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`All 3 replicas are pinned to ${node}`);
      expect(dialog).toContain("there is no node-name logic in the controller");
      expect(dialog).toContain("the Spread policy cannot save it");
      // The constraints discard, stated on the control an operator looks at.
      expect(dialog).toContain("discarded rather than merged");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuestPool kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftguestpools.swift.kubeswift.io", name, "{.spec}"));

      // Warned about, and sent unchanged.
      expect(spec.template.spec.nodeName).toBe(node);
      expect(spec.spreadPolicy).toBe("Spread");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "drops the template's ports when the pool has a Service of its own",
    async () => {
      // D3. The controller replaces spec.network.ports wholly on every replica,
      // with expose cleared, whenever spec.service is set - so offering the
      // control would be collecting a value the form knows will be discarded,
      // which is the same dishonesty as re-sending a schema default. The ports
      // already typed go with it.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-pool-ports");

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill(name);
      await frame.locator('[data-testid="pool-create-replicas"]').fill("2");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      // A per-replica port first, so the case proves the control is dropped
      // rather than merely never offered.
      await openFormSection(frame, "guest-create-network-section");
      await frame.locator('[data-testid="guest-create-add-port"]').click();
      await frame.locator('[data-testid="guest-create-port-0-port"]').fill("9090");
      expect(await frame.locator('[data-testid="guest-create-ports-dropped"]').count()).toBe(0);

      await openFormSection(frame, "pool-create-service-section");
      await frame.locator('[data-testid="pool-create-service-enabled"] .Checkbox').click();
      await frame.locator('[data-testid="pool-create-add-service-port"]').click();
      await frame.locator('[data-testid="pool-create-service-port-0-port"]').fill("8080");

      // The control is gone, and the fact stands in its place (W12).
      expect(await frame.locator('[data-testid="guest-create-add-port"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="guest-create-port-0-port"]').count()).toBe(0);

      const dropped = await frame.locator('[data-testid="guest-create-ports-dropped"]').innerText();

      expect(dropped).toContain("replaces spec.network.ports wholly");
      expect(dropped).toContain("expose cleared");
      expect(dropped).toContain("8080/TCP");

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftGuestPool kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftguestpools.swift.kubeswift.io", name, "{.spec}"));

      // What the readback proves: the pool's own ports are there, and the
      // template carries no network block at all.
      expect(spec.service.ports[0].port).toBe(8080);
      expect(spec.template.spec.network).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a rollout that can never progress, and releases it when either pace moves",
    async () => {
      // P10. maxUnavailable: 0 with maxSurge: 0 is schema-legal, coupled by no
      // rule and reported by no condition: the pool may take no replica down
      // and may create no extra one, so a template change stalls forever with
      // nothing saying why. This form makes the pair inexpressible.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");

      const before = poolNames();

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill("e2e-pool-deadlock");
      await frame.locator('[data-testid="pool-create-replicas"]').fill("3");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      await openFormSection(frame, "pool-create-rollout-section");
      await frame.locator('[data-testid="pool-create-max-unavailable"]').fill("0");

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("Create Guest Pool is disabled - Max unavailable:");
      expect(refused).toContain("can never progress");
      expect(refused).toContain("reported by no condition");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // Released by the surge, and refused again when it goes back to zero.
      await frame.locator('[data-testid="pool-create-max-surge"]').fill("1");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await frame.locator('[data-testid="pool-create-max-surge"]').fill("0");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // And released by the other one, which is the half a coupled rule would
      // have got wrong.
      await frame.locator('[data-testid="pool-create-max-unavailable"]').fill("1");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(poolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a guest already holds one of the replica names, and does not block",
    async () => {
      // P14. An existing guest is not adopted - ownership is by owner reference
      // only - so the pool's create fails with AlreadyExists and, the first
      // error aborting the reconcile, the pool never fans out at all. A warning
      // rather than a block: the read behind it can be stale, and a refused
      // read must never accuse.
      await cluster.openKubeSwiftPage(frame, "swiftguestpools", "Guest Pools");

      const before = poolNames();

      await openCreatePoolDialog(frame);
      await frame.locator('[data-testid="pool-create-name"]').fill("e2e-pool-taken");
      await frame.locator('[data-testid="pool-create-replicas"]').fill("3");
      await pickCreateOption(frame, "guest-create-class", "e2e-small");
      await pickCreateOption(frame, "guest-create-image", "e2e-ubuntu-2404");

      const warned = await cluster.confirmDialogText(frame);

      // The fixture guest holds index 1, so the warning has to name that index
      // rather than the first one.
      expect(warned).toContain("e2e-pool-taken-1");
      expect(warned).toContain("not adopted");
      expect(warned).toContain("aborts the reconcile");
      expect(warned).not.toContain("Create Guest Pool is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // A smaller pool never reaches that index, so the warning goes away.
      await frame.locator('[data-testid="pool-create-replicas"]').fill("1");
      expect(await cluster.confirmDialogText(frame)).not.toContain("e2e-pool-taken-1");

      await cluster.cancelDialog(frame);

      expect(poolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a sandbox pool from the page's own create button, and reads back what the server stamped",
    async () => {
      // SPEC-0016 slice 1. Two things are proved here that no unit test can:
      // that a create which never mentions `memory` is ADMITTED although the
      // schema calls it required - the API server applies structural-schema
      // defaults before it validates `required` - and that every value this
      // form deliberately does not send comes back stamped anyway.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-sbxpool");

      await openCreateSandboxPoolDialog(frame);
      await frame.locator('[data-testid="sandbox-pool-create-name"]').fill(name);
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");
      await frame.locator('[data-testid="sandbox-pool-create-min-warm"]').fill("2");
      await frame.locator('[data-testid="sandbox-pool-create-max-warm"]').fill("4");
      await pickCreateOption(frame, "sandbox-create-kernel-profile", "e2e-kernel-6-12");

      await frame.locator('[data-testid="sandbox-create-add-node-selector"]').click();
      await frame.locator('[data-testid="sandbox-create-node-selector-0-key"]').fill("disk");
      await frame.locator('[data-testid="sandbox-create-node-selector-0-value"]').fill("nvme");

      // The collapsed tail, whose three fields are what every claiming sandbox
      // inherits.
      await openFormSection(frame, "sandbox-create-registry-section");
      await pickCreateOption(frame, "sandbox-create-pull-secret", "e2e-sandbox-registry");
      await pickCreateOption(frame, "sandbox-create-verify-key", "e2e-sandbox-cosign");
      await frame
        .locator('[data-testid="sandbox-create-model-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/model:v1");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftSandboxPool kubeswift-e2e/${name}`);
      // What warms, what it is called, and what it costs.
      expect(dialog).toContain("2 warm slots are asked for");
      expect(dialog).toContain("a runtime-intent ConfigMap");
      expect(dialog).toContain("a deny-ingress NetworkPolicy");
      expect(dialog).toContain(`${name}-slot-`);
      expect(dialog).toContain("2 x 512Mi = 1Gi");
      // The four facts nothing on the cluster will ever tell an operator.
      expect(dialog).toContain("no phase at all, and then Warming");
      expect(dialog).toContain("NOT a conserved total");
      expect(dialog).toContain("keep the shape they booted with");
      expect(dialog).toContain("spec.poolRef");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSandboxPool kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftsandboxpools.sandbox.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "cpu",
        "image",
        "imagePullSecret",
        "kernelProfileRef",
        "maxWarm",
        "memory",
        "minWarm",
        "model",
        "nodeSelector",
        "rootfsMode",
        "verifyKeySecretRef",
      ]);

      // What the form sent.
      expect(spec.image).toBe("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");
      expect(spec.minWarm).toBe(2);
      expect(spec.maxWarm).toBe(4);
      expect(spec.kernelProfileRef).toEqual({ name: "e2e-kernel-6-12" });
      expect(spec.nodeSelector).toEqual({ disk: "nvme" });
      expect(spec.imagePullSecret).toBe("e2e-sandbox-registry");
      expect(spec.verifyKeySecretRef).toEqual({ name: "e2e-sandbox-cosign" });
      expect(spec.model.imageRef).toBe("ghcr.io/freelensapp/kubeswift-e2e/model:v1");

      // What the API server stamped, which the form never sends: `memory` above
      // all, because it is required AND defaulted and this create omitted it.
      expect(spec.memory).toBe("512Mi");
      expect(spec.cpu).toBe(1);
      expect(spec.rootfsMode).toBe("block");
      expect(spec.model.mountPath).toBe("/model");
      // And what it does NOT stamp: `network.mode` has a default INSIDE a
      // `network` block, so an absent block stays absent - which is the proof
      // that the form sent no network at all.
      expect(spec.network).toBeUndefined();

      // No controller runs here, so the pool warms nothing - which is what
      // makes the readback a proof of what the form sent.
      expect(cluster.kubectlField("swiftsandboxpools.sandbox.kubeswift.io", name, "{.status.phase}")).toBe("");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses a warm cap below the floor, and releases it when either count moves",
    async () => {
      // B3. The controller folds a cap below the floor to the larger of the
      // two, its own comment saying that bounds are the webhook's job - and
      // there is no webhook for a pool at all, so the number typed here would
      // simply not be the number that caps anything.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");

      const before = sandboxPoolNames();

      await openCreateSandboxPoolDialog(frame);
      await frame.locator('[data-testid="sandbox-pool-create-name"]').fill("e2e-sandbox-pool-fold");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");
      await frame.locator('[data-testid="sandbox-pool-create-min-warm"]').fill("3");
      await frame.locator('[data-testid="sandbox-pool-create-max-warm"]').fill("2");

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("Create Sandbox Pool is disabled - Maximum warm slots:");
      expect(refused).toContain("A cap of 2 is below this pool's floor of 3");
      expect(refused).toContain("silently folded to the larger of the two");
      expect(refused).toContain("no webhook for a pool at all");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // Released by the cap, and refused again when it goes back under.
      await frame.locator('[data-testid="sandbox-pool-create-max-warm"]').fill("3");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await frame.locator('[data-testid="sandbox-pool-create-max-warm"]').fill("2");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // And released by the other one, which is the half a one-sided rule would
      // have got wrong.
      await frame.locator('[data-testid="sandbox-pool-create-min-warm"]').fill("2");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(sandboxPoolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "refuses an HGX GPU profile with the reason upstream never reports, and accepts the pcie one",
    async () => {
      // B4 and S11. Upstream rejects the tier when the first slot is allocated,
      // on a path that returns before the status update: the pool never reaches
      // Degraded, never gets a message, and error-backoffs forever with an
      // empty phase. This is the only place that is ever said.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");

      const before = sandboxPoolNames();

      await openCreateSandboxPoolDialog(frame);
      await frame.locator('[data-testid="sandbox-pool-create-name"]').fill("e2e-sandbox-pool-hgx");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");

      await openFormSection(frame, "sandbox-create-gpu-section");
      await pickCreateOption(frame, "sandbox-create-gpu-profile", "e2e-gpu-profile-hgx");

      const refused = await cluster.confirmDialogText(frame);

      expect(refused).toContain("Create Sandbox Pool is disabled - GPU profile:");
      expect(refused).toContain("a pool cannot warm a slot on an HGX tier");
      expect(refused).toContain("BEFORE the status update");
      expect(refused).toContain("never reaches Degraded");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // A collapsed section that holds an error opens itself and stays open:
      // a submit blocked on a field nobody can see is the dead control W4
      // forbids, so the header click cannot shut it while the refusal stands.
      await openFormSection(frame, "sandbox-create-gpu-section");
      expect(await frame.locator(".Select:has(#sandbox-create-gpu-profile)").count()).toBe(1);

      await pickCreateOption(frame, "sandbox-create-gpu-profile", "e2e-gpu-profile-pcie");

      const accepted = await cluster.confirmDialogText(frame);

      expect(accepted).not.toContain("Create Sandbox Pool is disabled");
      expect(accepted).toContain("warm GPU pool");
      expect(accepted).toContain("keep the floor at or below N");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.cancelDialog(frame);

      expect(sandboxPoolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a sandbox pool name is taken, and writes nothing when the dialog is cancelled",
    async () => {
      // S1 and the cancel path in one case, because they are the same fact from
      // two sides: the collision is a warning rather than a block - the read
      // behind it can be stale, and only the API server can answer - and a
      // dialog that is dismissed has written nothing at all, which only
      // kubectl can prove.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxpools", "Sandbox Pools");

      const before = sandboxPoolNames();

      await openCreateSandboxPoolDialog(frame);
      await frame.locator('[data-testid="sandbox-pool-create-name"]').fill("e2e-sandbox-pool-create-taken");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");

      const warned = await cluster.confirmDialogText(frame);

      expect(warned).toContain(
        "A SwiftSandboxPool named e2e-sandbox-pool-create-taken already exists in kubeswift-e2e",
      );
      expect(warned).toContain("this form stays open when it is");
      expect(warned).not.toContain("Create Sandbox Pool is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // A free name is not warned about at all.
      await frame.locator('[data-testid="sandbox-pool-create-name"]').fill("e2e-sandbox-pool-free");
      expect(await cluster.confirmDialogText(frame)).not.toContain("already exists in kubeswift-e2e");

      await cluster.cancelDialog(frame);

      expect(sandboxPoolNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "creates a cold sandbox with its whole workload, and reads back what the server stamped",
    async () => {
      // SPEC-0016 slice 2, the cold path end to end. What it proves that no unit
      // test can: the argv arrays reach the API server exactly as they were
      // typed - one row is one element, so a quoted argument stays whole - and
      // every value this form deliberately does not send comes back stamped
      // anyway, including the `volumeMode: Block` that the scratch disk's own
      // control never asks about.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-sbx");

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill(name);
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");

      // The workload: one row per argv element, which is what makes upstream's
      // whitespace splitting inexpressible here.
      await addArgvRow(frame, "command", 0, "/bin/sh");
      await addArgvRow(frame, "args", 0, "-c");
      await addArgvRow(frame, "args", 1, "echo hello world");
      await frame.locator('[data-testid="sandbox-create-working-dir"]').fill("/workspace");
      await addEnvRow(frame, 0, "SANDBOX_MODE", "fast");
      await addEnvRow(frame, 1, "SANDBOX_SEED", "7");

      await frame.locator('[data-testid="sandbox-create-timeout"]').fill("30m");
      await frame.locator('[data-testid="sandbox-create-ttl"]').fill("1h");

      await openFormSection(frame, "sandbox-create-scratch-section");
      await scratchSourceRadio(frame, "blank").click();
      await frame.locator('[data-testid="sandbox-create-scratch-size"]').fill("100Gi");
      await frame.locator('[data-testid="sandbox-create-scratch-storage-class"]').fill("e2e-fast");

      await openFormSection(frame, "sandbox-create-model-section");
      await frame
        .locator('[data-testid="sandbox-create-model-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/model:v1");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain(`Create SwiftSandbox kubeswift-e2e/${name}`);
      // What the create makes, and what it never makes.
      expect(dialog).toContain("a runtime-intent ConfigMap");
      expect(dialog).toContain(`a Pod named exactly ${name}`);
      expect(dialog).toContain("a NetworkPolicy");
      expect(dialog).toContain(`a claim named ${name}-scratch`);
      expect(dialog).toContain("No Service and no Secret are EVER created");
      // The workload, as argv rather than as a string.
      expect(dialog).toContain("The workload is /bin/sh -c echo hello world");
      expect(dialog).toContain("nothing is split on whitespace");
      // The will-not-heal vocabulary, and the phase honesty behind it.
      expect(dialog).toContain("EMPTY phase, not Pending");
      expect(dialog).toContain("empty phase with one False condition");
      expect(dialog).toContain("delete and a re-create");
      expect(dialog).toContain("DELETES the SwiftSandbox object itself");
      expect(dialog).toContain("only ttl actually changes anything");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSandbox kubeswift-e2e/${name} created`);
      await cluster.expectRow(frame, name, "kubeswift-e2e");

      const spec = JSON.parse(cluster.kubectlField("swiftsandboxes.sandbox.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual([
        "args",
        "command",
        "cpu",
        "env",
        "image",
        "memory",
        "model",
        "rootfsMode",
        "scratchDisk",
        "timeout",
        "ttl",
        "workingDir",
      ]);

      // What the form sent.
      expect(spec.image).toBe("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");
      expect(spec.command).toEqual(["/bin/sh"]);
      expect(spec.args).toEqual(["-c", "echo hello world"]);
      expect(spec.workingDir).toBe("/workspace");
      expect(spec.env).toEqual([
        { name: "SANDBOX_MODE", value: "fast" },
        { name: "SANDBOX_SEED", value: "7" },
      ]);
      expect(spec.timeout).toBe("30m");
      expect(spec.ttl).toBe("1h");
      expect(spec.scratchDisk.blank.size).toBe("100Gi");
      expect(spec.scratchDisk.blank.storageClassName).toBe("e2e-fast");
      expect(spec.model.imageRef).toBe("ghcr.io/freelensapp/kubeswift-e2e/model:v1");

      // What the API server stamped, which this form never sends - `volumeMode`
      // above all, because the control that would have carried it does not
      // exist: the disk is Block whatever any client says.
      expect(spec.cpu).toBe(1);
      expect(spec.memory).toBe("512Mi");
      expect(spec.rootfsMode).toBe("block");
      expect(spec.model.mountPath).toBe("/model");
      expect(spec.scratchDisk.blank.volumeMode).toBe("Block");
      // And what it does NOT stamp: `network.mode`'s default lives INSIDE a
      // block this form omits, so the absence is a proof of what was sent.
      expect(spec.network).toBeUndefined();

      // No controller runs here, so the sandbox stays phaseless - which is what
      // a REAL cluster shows first too, and what the summary promised.
      expect(cluster.kubectlField("swiftsandboxes.sandbox.kubeswift.io", name, "{.status.phase}")).toBe("");

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "checks a slot out of a warm pool, with the shape read from it rather than asked for",
    async () => {
      // A2 and S3, the centre of this spec. `spec.poolRef.name` is the WHOLE
      // client-side protocol - no claim field, no lease, no annotation and no
      // gateway RPC - so a CRD-native client really can check a slot out, which
      // is the question this milestone carried. What an E2E can prove is the
      // protocol and the derivation; the claim itself, the re-parented ownerRef
      // and the counts moving are manual, because no controller runs here.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-sbx-claim");

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill(name);
      await useSandboxCheckout(frame);
      // The option text carries the phase and both counts, which upstream's own
      // cluster-wide picker shows nowhere although its gateway returns them.
      await pickCreateOption(frame, "sandbox-create-pool", "e2e-sandbox-pool - Ready");
      await addArgvRow(frame, "command", 0, "/usr/bin/env");

      const dialog = await cluster.confirmDialogText(frame);

      expect(dialog).toContain("e2e-sandbox-pool - Ready, 2 warm, 1 claimed");
      // The four are facts read from the pool, not controls: the image input and
      // the vCPU input of the cold path are gone entirely.
      expect(await frame.locator('[data-testid="sandbox-create-derived-shape"]').count()).toBe(1);
      expect(await frame.locator('[data-testid="sandbox-create-image"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="sandbox-create-cpu"]').count()).toBe(0);
      expect(dialog).toContain("Slot shape, read from the pool");
      expect(dialog).toContain("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");
      expect(dialog).toContain("SENT from it");
      expect(dialog).toContain("silently runs this workload inside the pool image's rootfs");
      // GPU is inexpressible with a pool, so the section is replaced by the
      // reason rather than rendered and ignored (W12 option dropping).
      expect(await frame.locator('[data-testid="sandbox-create-gpu-section"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="sandbox-create-gpu-dropped"]').count()).toBe(1);
      expect(dialog).toContain("mutually exclusive with BOTH GPU backends");
      expect(dialog).toContain("the checkout runs first and the GPU request is silently ignored");
      // And the checkout's own promise, which is that a miss is not a failure.
      expect(dialog).toContain("cold-boots if none is");
      expect(dialog).toContain("NOT a failure");
      expect(dialog).not.toContain("always cold-fall-back");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSandbox kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftsandboxes.sandbox.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual(["command", "cpu", "image", "memory", "poolRef", "rootfsMode"]);
      // The one field that is the whole protocol.
      expect(spec.poolRef).toEqual({ name: "e2e-sandbox-pool" });
      // And the four the schema says a claimant must match and nothing compares.
      expect(spec.image).toBe("ghcr.io/freelensapp/kubeswift-e2e/sandbox:warm");
      expect(spec.cpu).toBe(1);
      expect(spec.memory).toBe("512Mi");
      expect(spec.rootfsMode).toBe("block");
      expect(spec.command).toEqual(["/usr/bin/env"]);
      // No GPU reached the object, whatever the form was holding.
      expect(spec.gpuProfileRef).toBeUndefined();
      expect(spec.gpuResourceClaim).toBeUndefined();
      expect(spec.network).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "warns that a command-less checkout always cold-falls-back, and submits it anyway",
    async () => {
      // S5, which upstream warns about nowhere at all: only the cold path
      // resolves the image's own entrypoint, so a pooled sandbox with no command
      // never uses a warm slot however many are free. It is a warning, so it
      // never blocks (W12).
      //
      // This is also where the derivation is PROVED rather than merely
      // asserted: `e2e-sandbox-pool-cold` carries cpu 2, 1Gi and virtiofs, three
      // values the API server would never stamp, so a readback that shows them
      // can only have got them from the pool.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await cluster.clearNotifications(frame);

      const name = createdObjectName("e2e-sbx-cold");

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill(name);
      await useSandboxCheckout(frame);
      await pickCreateOption(frame, "sandbox-create-pool", "e2e-sandbox-pool-cold");

      const warned = await cluster.confirmDialogText(frame);

      // A pool nothing has reconciled reports no phase and no counts, and the
      // option says so rather than leaving a blank.
      expect(warned).toContain("e2e-sandbox-pool-cold - no phase yet, 0 warm, 0 claimed");
      expect(warned).toContain("This checkout names no command, so it will always cold-fall-back");
      expect(warned).toContain("Adding one argv row is what makes the checkout a checkout");
      expect(warned).not.toContain("Create Sandbox is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await cluster.confirmDialog(frame);
      await cluster.expectNotification(frame, "ok", `SwiftSandbox kubeswift-e2e/${name} created`);

      const spec = JSON.parse(cluster.kubectlField("swiftsandboxes.sandbox.kubeswift.io", name, "{.spec}"));

      expect(Object.keys(spec).sort()).toEqual(["cpu", "image", "memory", "poolRef", "rootfsMode"]);
      expect(spec.poolRef).toEqual({ name: "e2e-sandbox-pool-cold" });
      // Three values no default could have produced, which is what makes this a
      // proof that the shape was read from the pool and sent from it.
      expect(spec.cpu).toBe(2);
      expect(spec.memory).toBe("1Gi");
      expect(spec.rootfsMode).toBe("virtiofs");
      expect(spec.image).toBe("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");
      expect(spec.command).toBeUndefined();

      await cluster.clearNotifications(frame);
    },
    TIMEOUT,
  );

  it(
    "refuses the scratch disk, the model path and the two expiries, each with its reason",
    async () => {
      // The webhook-only rules of A5, A7 and A9, which on a normal install
      // nobody else enforces at all: the sandbox webhook ships disabled, so
      // these messages are the only ones an operator will ever see.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");

      const before = sandboxNames();

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill("e2e-sandbox-refusals");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");

      // A zero scratch size: the schema has no minimum, so it is stored happily
      // and then fails at the PVC create, with the sandbox parked on Binding.
      await openFormSection(frame, "sandbox-create-scratch-section");
      await scratchSourceRadio(frame, "blank").click();
      await frame.locator('[data-testid="sandbox-create-scratch-size"]').fill("0");

      const zeroSize = await cluster.confirmDialogText(frame);

      expect(zeroSize).toContain("Create Sandbox is disabled - Scratch disk size:");
      expect(zeroSize).toContain("A size of zero is accepted by the API server and honoured by nothing");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // A collapsed section that holds an error opens itself and cannot be shut
      // while it does: a submit blocked on a field nobody can see is the dead
      // control W4 forbids.
      await openFormSection(frame, "sandbox-create-scratch-section");
      expect(await frame.locator('[data-testid="sandbox-create-scratch-size"]').count()).toBe(1);

      await frame.locator('[data-testid="sandbox-create-scratch-size"]').fill("100Gi");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // A relative model mount path, which is not a mount point at all.
      await openFormSection(frame, "sandbox-create-model-section");
      await frame
        .locator('[data-testid="sandbox-create-model-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/model:v1");
      await frame.locator('[data-testid="sandbox-create-model-mount-path"]').fill("weights");

      const relativePath = await cluster.confirmDialogText(frame);

      expect(relativePath).toContain("Create Sandbox is disabled - Model mount path:");
      expect(relativePath).toContain("A mount path is absolute");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      await frame.locator('[data-testid="sandbox-create-model-mount-path"]').fill("/models");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // A negative run cap, which force-terminates the sandbox on the first poll.
      await frame.locator('[data-testid="sandbox-create-timeout"]').fill("-5m");

      const negativeTimeout = await cluster.confirmDialogText(frame);

      expect(negativeTimeout).toContain("Create Sandbox is disabled - Timeout:");
      expect(negativeTimeout).toContain("first five-second poll");
      expect(negativeTimeout).toContain("the workload never runs");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // And a retention of zero, whose consequence is sharper: it deletes the
      // object itself before anyone reads the result.
      await frame.locator('[data-testid="sandbox-create-timeout"]').fill("30m");
      await frame.locator('[data-testid="sandbox-create-ttl"]').fill("0");

      const zeroTtl = await cluster.confirmDialogText(frame);

      expect(zeroTtl).toContain("Create Sandbox is disabled - TTL:");
      expect(zeroTtl).toContain("DELETES the SwiftSandbox object itself");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // A duration that is not a Go duration at all is a different refusal.
      await frame.locator('[data-testid="sandbox-create-ttl"]').fill("1 day");

      const badDuration = await cluster.confirmDialogText(frame);

      expect(badDuration).toContain("This is not a Go duration");
      expect(badDuration).toContain("Neither field carries a schema pattern or a format");

      await cluster.cancelDialog(frame);

      expect(sandboxNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "makes a GPU and a pool inexpressible, and refuses a DRA claim that names both",
    async () => {
      // The two exclusivities of A6. One is made inexpressible by the control -
      // a checkout has no GPU section at all - and the other cannot be, because
      // a claim name and a template name are two objects an operator types the
      // name of, so that half is a refusal that names both fields.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");

      const before = sandboxNames();

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill("e2e-sandbox-gpu");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");

      // The native backend, with the profile picked: legal, and the header line
      // carries the park rather than a refusal - an unsupported tier parks a
      // sandbox where it makes a pool error-backoff with no status at all.
      await openFormSection(frame, "sandbox-create-gpu-section");
      await sandboxGpuBackendRadio(frame, "profile").click();
      await pickCreateOption(frame, "sandbox-create-gpu-profile", "e2e-gpu-profile-hgx");

      const parked = await cluster.confirmDialogText(frame);

      expect(parked).toContain("parks this sandbox forever");
      expect(parked).toContain("gpu-sandbox kernel");
      expect(parked).not.toContain("Create Sandbox is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // The DRA branch: exactly one of the two names.
      await sandboxGpuBackendRadio(frame, "dra").click();

      const neither = await cluster.confirmDialogText(frame);

      expect(neither).toContain("Create Sandbox is disabled - Resource claim:");
      expect(neither).toContain("allocates nothing at all");

      await frame.locator('[data-testid="sandbox-create-gpu-claim"]').fill("e2e-shared-claim");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      await frame.locator('[data-testid="sandbox-create-gpu-claim-template"]').fill("e2e-claim-template");

      const both = await cluster.confirmDialogText(frame);

      expect(both).toContain("Create Sandbox is disabled - Resource claim:");
      expect(both).toContain("never both");
      expect(both).toContain("a webhook that ships disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(true);

      // And the pair a pool makes inexpressible: switching to a checkout takes
      // the whole section away and leaves the reason in its place.
      await useSandboxCheckout(frame);

      expect(await frame.locator('[data-testid="sandbox-create-gpu-section"]').count()).toBe(0);
      expect(await frame.locator('[data-testid="sandbox-create-gpu-dropped"]').count()).toBe(1);

      const dropped = await cluster.confirmDialogText(frame);

      expect(dropped).toContain("A GPU sandbox always boots cold");
      expect(dropped).toContain("Choose New microVM to ask for a GPU");
      // The refusal went with the section, because the section is gone.
      expect(dropped).not.toContain("Create Sandbox is disabled - Resource claim:");

      await cluster.cancelDialog(frame);

      expect(sandboxNames()).toEqual(before);
    },
    TIMEOUT,
  );

  it(
    "warns that a sandbox name is taken, and keeps the whole form when the 409 arrives",
    async () => {
      // S1 and the reopen. The collision warning does not block - the read
      // behind it can be stale and only the API server can answer - so an
      // ignored warning has to come back as a usable failure rather than as a
      // lost form, which is only true because the form model lives outside
      // React (SPEC-0011 spike T1). This form is the tallest one that reopen
      // has ever had to protect.
      await cluster.openKubeSwiftPage(frame, "swiftsandboxes", "Sandboxes");
      await cluster.clearNotifications(frame);

      const before = sandboxNames();

      await openCreateSandboxDialog(frame);
      await frame.locator('[data-testid="sandbox-create-name"]').fill("e2e-sandbox-create-taken");
      await frame
        .locator('[data-testid="sandbox-create-image"]')
        .fill("ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold");
      await addArgvRow(frame, "command", 0, "/bin/sh");
      await frame.locator('[data-testid="sandbox-create-working-dir"]').fill("/workspace");
      await frame.locator('[data-testid="sandbox-create-ttl"]').fill("1h");

      const warned = await cluster.confirmDialogText(frame);

      expect(warned).toContain("A SwiftSandbox named e2e-sandbox-create-taken already exists in kubeswift-e2e");
      expect(warned).toContain("this form stays open when it is");
      expect(warned).not.toContain("Create Sandbox is disabled");
      expect(await frame.locator('[data-testid="confirm"]').isDisabled()).toBe(false);

      // Submitted anyway. `confirmDialog` is deliberately not used here: it
      // waits for the dialog to disappear, and the whole point of this path is
      // that it comes back.
      await frame.locator('[data-testid="confirm"]').click();

      const message = await cluster.expectNotification(frame, "error", "already exists");

      expect(message).toContain("Change the name and try again");

      // The dialog really goes away, really comes back, and really is on screen.
      await expectReopenedDialogVisible(frame);

      // Everything the user typed is still there, across the whole form and not
      // just its first field.
      expect(await frame.locator('[data-testid="sandbox-create-name"]').inputValue()).toBe("e2e-sandbox-create-taken");
      expect(await frame.locator('[data-testid="sandbox-create-image"]').inputValue()).toBe(
        "ghcr.io/freelensapp/kubeswift-e2e/sandbox:cold",
      );
      expect(await frame.locator('[data-testid="sandbox-create-command-0-value"]').inputValue()).toBe("/bin/sh");
      expect(await frame.locator('[data-testid="sandbox-create-working-dir"]').inputValue()).toBe("/workspace");
      expect(await frame.locator('[data-testid="sandbox-create-ttl"]').inputValue()).toBe("1h");

      await cluster.cancelDialog(frame);

      // And the sandbox that was already there is untouched: a refused create
      // writes nothing, and there is no second object.
      expect(sandboxNames()).toEqual(before);
      expect(
        cluster.kubectlField("swiftsandboxes.sandbox.kubeswift.io", "e2e-sandbox-create-taken", "{.spec.image}"),
      ).toBe("ghcr.io/freelensapp/kubeswift-e2e/sandbox:taken");

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

  // ---------------------------------------------------------------------------
  // M7 (SPEC-0017 slice 1): the SwiftGuest serial console.
  //
  // What the fixture cluster proves, and the split is stated once because it is
  // the honest half of this milestone: no KubeSwift controller runs here and no
  // real launcher image exists, so what the first two cases prove is the wiring
  // and the words - the guard's verdict in both surfaces, and the exact command
  // line the extension types into a terminal tab Freelens spawned. The third
  // case proves the TRANSPORT, against the one schedulable pod of the fixture
  // set (215-console-transport.yaml): that a `kubectl exec` issued from that tab
  // really reaches into a container and brings its output back. Without it the
  // suite would prove that we type the right string and never that the string
  // works.
  //
  // The technique, and why it works: Freelens's terminal loads only the fit and
  // web-links addons and no canvas or WebGL renderer, so xterm uses its DOM
  // renderer and the typed line is real text in `.xterm-rows`, readable by
  // Playwright. The text is compared with every whitespace removed, because a
  // terminal row is a fixed number of columns wide and a long command line wraps
  // mid-token: joining the rows and dropping the spaces is what makes a token
  // that straddles a wrap boundary readable again.
  //
  // These are the last cases that need an uncovered page, which is why they sit
  // here rather than earlier: the dock covers the lower half of every list page
  // underneath it. Each one closes the tab it opened, so the M4 log-dock case
  // below still finds an empty dock and keeps its own place as the last case
  // that touches the UI - and each one closes it only AFTER its command has
  // ended, which is `closeDockTab`'s job and is explained there: a tab closed
  // over a live `kubectl exec` makes the host's proxy log the cancelled upgrade
  // at error level, and the activation case collects that as a failure.
  it(
    "opens a serial console from the row kebab and types the exec line into the terminal",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-running");

      const items = await cluster.actionMenuItems(frame, ".Menu");
      const consoleItem = items.find((item) => item.testId === "swiftguest-console-action");

      // An enabled item says what is about to happen, and then what to expect
      // from it: the Linux blank-console causes are the improvement no upstream
      // surface carries (K5).
      expect(consoleItem?.disabled).toBe(false);
      expect(consoleItem?.title).toContain("kubectl exec into the launcher container of");
      expect(consoleItem?.title).toContain("kubeswift-e2e/e2e-guest-running-launcher");
      expect(consoleItem?.title).toContain("getty@ttyS0");

      await frame.locator('.Menu [data-testid="swiftguest-console-action"]').click();

      // The tab, by the title the extension chose: the guest, and not its pod,
      // whose name is a migration artefact the drawer already shows.
      const tab = consoleTab(frame, "e2e-guest-running");

      await tab.waitFor({ state: "visible", timeout: 60_000 });

      // The command line itself, which is the assertion that protects the whole
      // design: the pod name, the container and the composed socket path are
      // exactly what a regression would break. This subject's status publishes
      // `console.serialSocket`, so what the line must carry is that value and
      // not the derived convention (K2) - the transport case below is the one
      // that proves the other branch.
      const typed = await expectTerminalText(frame, "e2e-guest-running-launcher");

      // The socket is quoted twice over - once for the remote `sh -c`, once for
      // the local shell that types the line - so the needles are the path and
      // the relay verb rather than the exact quoting, which the unit tests own.
      expect(typed).toContain("-c'launcher'--");
      expect(typed).toContain("UNIX-CONNECT:");
      expect(typed).toContain("/var/run/kubeswift/e2e-guest-running/serial.sock");
      expect(typed).toContain("foriin$(seq115);dotest-S");

      await closeDockTab(frame, "e2e-guest-running");

      // And the second surface the reason has to reach, for the user who never
      // hovers anything (W4): the drawer's own row, which says the console is
      // available and what it will connect to.
      await pr.openDrawer(frame, "e2e-guest-running");

      const rows = await pr.inspectDrawerRows(frame);
      const consoleRow = rows.find((row) => row.label === "Serial Console");

      expect(consoleRow?.text).toContain("Available:");
      expect(consoleRow?.text).toContain("/var/run/kubeswift/e2e-guest-running/serial.sock");
      expect(rows.find((row) => row.label === "Serial Socket")?.text).toBe(
        "/var/run/kubeswift/e2e-guest-running/serial.sock",
      );

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "disables the serial console with its reason, in the kebab and in the drawer",
    async () => {
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");

      // A stopped guest is told the MECHANISM, not the symptom: it has no
      // launcher pod either, and the sentence that helps is the one saying why
      // (K3). Read from the item's own tooltip attribute rather than from a
      // hover, because a disabled `MenuItem` carries `pointer-events: none` and
      // the host's hover tooltip can never be shown for it (spike S7).
      await cluster.openRowMenu(frame, "e2e-guest-action-stopped");

      const stoppedItem = (await cluster.actionMenuItems(frame, ".Menu")).find(
        (item) => item.testId === "swiftguest-console-action",
      );

      expect(stoppedItem?.disabled).toBe(true);
      expect(stoppedItem?.title).toContain("stopping deletes its launcher pod");

      // The E2E half of W4: the click is stopped by the stylesheet, not only by
      // the handler, so Playwright's actionability check refuses it.
      let clickWasRefused = false;

      try {
        await frame.locator('.Menu [data-testid="swiftguest-console-action"]').click({ timeout: 3000 });
      } catch {
        clickWasRefused = true;
      }

      if (!clickWasRefused) {
        throw new Error("A disabled console item must not be clickable.");
      }

      await cluster.closeRowMenu(frame);

      // And the other refusal: a guest nothing has reconciled, whose status
      // names no pod at all. That is the state every guest is in between
      // creation and the first reconciliation.
      await cluster.openRowMenu(frame, "e2e-guest-pending");

      const pendingItem = (await cluster.actionMenuItems(frame, ".Menu")).find(
        (item) => item.testId === "swiftguest-console-action",
      );

      expect(pendingItem?.disabled).toBe(true);
      expect(pendingItem?.title).toContain("names no launcher pod yet");

      await cluster.closeRowMenu(frame);

      // The same verdict in the drawer toolbar - one registration, both
      // surfaces (W5) - and in the drawer's own row, which is where a user who
      // never opens a menu finds it.
      await pr.openDrawer(frame, "e2e-guest-action-stopped");

      const toolbarItem = (await cluster.actionMenuItems(frame, ".Drawer.KubeObjectDetails .MenuActions")).find(
        (item) => item.testId === "swiftguest-console-action",
      );

      expect(toolbarItem?.disabled).toBe(true);
      expect(toolbarItem?.title).toContain("stopping deletes its launcher pod");

      const consoleRow = (await pr.inspectDrawerRows(frame)).find((row) => row.label === "Serial Console");

      expect(consoleRow?.text).toContain("Unavailable:");
      expect(consoleRow?.text).toContain("stopping deletes its launcher pod");

      await cluster.closeDetails(frame);
    },
    TIMEOUT,
  );

  it(
    "reaches into the launcher container: the exec typed into the tab really connects",
    async () => {
      // THE transport case (SPEC-0017 open item O5, accepted at approval), and
      // the only one in this suite that depends on a pod that really runs.
      //
      // What it proves that nothing else can: the line the extension composes,
      // typed into a terminal tab Freelens spawned, is picked up by the tab's
      // own shell, resolves kubectl and the cluster's kubeconfig from the
      // session the host prepared, opens the `pods/exec` stream, runs the wait
      // loop inside the container, and brings the container's own bytes back
      // into the DOM. The marker it looks for appears NOWHERE in the composed
      // command line, so it can only have come from inside the pod, and it
      // carries the container's hostname, so it can only have come from THAT
      // pod (the stub is explained in 215-console-transport.yaml).
      //
      // It is also the fixture with no `status.console.serialSocket`, so the
      // path the terminal reads back is the DERIVED CONVENTION - keyed on the
      // guest, not on the pod - which is the branch the case above cannot see.
      await cluster.openKubeSwiftPage(frame, "swiftguests", "Guests");
      await cluster.openRowMenu(frame, "e2e-guest-console");

      const consoleItem = (await cluster.actionMenuItems(frame, ".Menu")).find(
        (item) => item.testId === "swiftguest-console-action",
      );

      expect(consoleItem?.disabled).toBe(false);

      await frame.locator('.Menu [data-testid="swiftguest-console-action"]').click();
      await consoleTab(frame, "e2e-guest-console").waitFor({ state: "visible", timeout: 60_000 });

      const conventionPath = "/var/lib/kubeswift/run/kubeswift-e2e-e2e-guest-console/serial.sock";

      // The line first, so a failure below is unambiguous about which half
      // broke.
      const typed = await expectTerminalText(frame, "e2e-guest-console-launcher");

      expect(typed).toContain(conventionPath);

      // Then the answer. The wait loop runs its fifteen seconds first, because
      // the socket a real hypervisor would have created is not there - which is
      // itself worth seeing happen rather than assuming.
      const answered = await expectTerminalText(frame, "KUBESWIFT-E2E-CONSOLE-OK", 120_000);

      expect(answered).toContain("KUBESWIFT-E2E-CONSOLE-OKe2e-guest-console-launcher");
      expect(answered).toContain(`UNIX-CONNECT:${conventionPath}`);

      // And the session ended with the tab still there: `exec` replaced the
      // tab's shell, so this line is the host reporting the exec's own exit.
      // `closeDockTab` waits for the same line before it clicks, but this case
      // states it as its own assertion: the exec is claimed to have RUN, and a
      // run that never ends would be a different result from the one asserted
      // above.
      await expectTerminalText(frame, "[Processexitedwithcode", 60_000);

      await closeDockTab(frame, "e2e-guest-console");
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

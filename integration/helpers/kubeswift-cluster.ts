/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers for driving a connected cluster: putting the E2E kubeconfig where
// Freelens finds it, opening the cluster from the catalog, navigating the
// KubeSwift sidebar group and asserting list rows and detail panels.
//
// See `kubeswift-extension.ts` for why these files live next to the Freelens
// integration helpers at run time.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { EXTENSION_NAME } from "./kubeswift-extension";

import type { Frame, Locator, Page } from "playwright";

/** Cluster provisioned by `e2e/scripts/cluster-up.sh`. */
export const E2E_CLUSTER_NAME = process.env.E2E_CLUSTER_NAME || "kubeswift-e2e";
export const E2E_KUBE_CONTEXT = process.env.E2E_KUBE_CONTEXT || `kind-${E2E_CLUSTER_NAME}`;
export const E2E_NAMESPACE = process.env.E2E_NAMESPACE || "kubeswift-e2e";

/** Connecting a cluster involves starting a proxy, so it is not quick. */
const CLUSTER_TIMEOUT = 5 * 60 * 1000;
const ELEMENT_TIMEOUT = 60 * 1000;

/**
 * Where failure screenshots go. run-suite.sh points this at the repository
 * root so that CI can upload the directory as an artifact.
 */
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts");

/**
 * Screenshots the window. Never throws: a failed screenshot must not replace
 * the failure that asked for it.
 */
export async function captureScreenshot(frame: Frame, name: string): Promise<string | undefined> {
  const file = path.join(ARTIFACTS_DIR, `${name.replace(/[^a-zA-Z0-9-]+/g, "-")}.png`);

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await frame.page().screenshot({ path: file, fullPage: true });

    return file;
  } catch {
    return undefined;
  }
}

/** The rows the page currently shows, for failure messages. */
async function visibleRows(frame: Frame): Promise<string[]> {
  try {
    const texts = await frame.locator(".TableRow").allInnerTexts();

    return texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** The sidebar test ids currently in the DOM, for failure messages. */
async function sidebarTestIds(frame: Frame): Promise<string[]> {
  try {
    return await frame.$$eval("[data-testid^='sidebar-item-']", (elements) =>
      elements.map((element) => element.getAttribute("data-testid") ?? ""),
    );
  } catch {
    return [];
  }
}

export function kubeconfigPath(): string {
  const value = process.env.E2E_KUBECONFIG;

  if (!value) {
    throw new Error("E2E_KUBECONFIG is not set. Run the suite through `pnpm e2e` or e2e/scripts/run-suite.sh.");
  }

  return value;
}

/**
 * True when the cluster is up and the fixtures have been applied to it.
 *
 * One fixture per milestone is probed, so that a cluster left over from an
 * older checkout is reported as not ready instead of failing later as a page
 * full of missing rows.
 */
export function fixturesReady(): boolean {
  const probes: [resource: string, name: string][] = [
    ["swiftguests.swift.kubeswift.io", "e2e-guest-running"],
    ["swiftmigrations.migration.kubeswift.io", "e2e-migration-completed"],
    ["swiftgpuprofiles.gpu.kubeswift.io", "e2e-gpu-profile-hgx"],
    // Cluster-scoped, and probed by the one name of the pair that is not the
    // cluster's own node name: `kubectl` ignores `--namespace` for a
    // cluster-scoped resource, so the call shape below covers it unchanged.
    ["swiftgpunodes.gpu.kubeswift.io", "e2e-gpu-node-absent"],
    ["swiftsandboxes.sandbox.kubeswift.io", "e2e-sandbox-running"],
    ["swiftsandboxpools.sandbox.kubeswift.io", "e2e-sandbox-pool"],
    ["clusters.fleet.kubeswift.io", "e2e-fleet-edge-1"],
    // M6: the guest action subjects the write cases patch and delete
    // (SPEC-0010). Probing one of them keeps a cluster left over from an older
    // checkout from being reported as ready.
    ["swiftguests.swift.kubeswift.io", "e2e-guest-action-running"],
  ];

  return probes.every(([resource, name]) => {
    const { status } = spawnSync(
      "kubectl",
      [
        "--kubeconfig",
        kubeconfigPath(),
        "--context",
        E2E_KUBE_CONTEXT,
        "--namespace",
        E2E_NAMESPACE,
        "get",
        resource,
        name,
      ],
      { stdio: "ignore" },
    );

    return status === 0;
  });
}

/**
 * Runs `kubectl` against the E2E cluster and returns its exit status and
 * output, without ever touching the developer's own kubeconfig.
 *
 * The read-only cases of this suite never needed it - what the UI showed was the
 * assertion - but the M6 write cases do: the point of a write case is that the
 * cluster changed, and only the API server can say so (SPEC-0010).
 */
export function kubectlE2E(...args: string[]): { status: number; stdout: string; stderr: string } {
  const { status, stdout, stderr } = spawnSync(
    "kubectl",
    ["--kubeconfig", kubeconfigPath(), "--context", E2E_KUBE_CONTEXT, "--namespace", E2E_NAMESPACE, ...args],
    { encoding: "utf8" },
  );

  return { status: status ?? 1, stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim() };
}

/** One field of one object, read with a jsonpath. Throws when the object is not there. */
export function kubectlField(resource: string, name: string, jsonPath: string): string {
  const { status, stdout, stderr } = kubectlE2E("get", resource, name, "--output", `jsonpath=${jsonPath}`);

  if (status !== 0) {
    throw new Error(`Could not read ${jsonPath} of ${resource}/${name}: ${stderr || "kubectl failed"}`);
  }

  return stdout;
}

/** True when the object is still in the cluster. The negative half of a write assert. */
export function kubectlExists(resource: string, name: string): boolean {
  return kubectlE2E("get", resource, name).status === 0;
}

let cachedNodeName: string | undefined;

/**
 * The real name of the cluster's single node, read the same way the fixtures
 * are: `e2e/scripts/cluster-up.sh` substitutes it into every `__NODE_NAME__`
 * placeholder, so anything named after the node (the SwiftGPUNode fixture) can
 * only be addressed by asking the cluster. It is `kubeswift-e2e-control-plane`
 * on the E2E cluster and `kubeswift-demo-control-plane` on the demo one the
 * pre-review pass uses, which is exactly why it is not a literal here.
 */
export function clusterNodeName(): string {
  if (cachedNodeName) {
    return cachedNodeName;
  }

  const { status, stdout } = spawnSync(
    "kubectl",
    [
      "--kubeconfig",
      kubeconfigPath(),
      "--context",
      E2E_KUBE_CONTEXT,
      "get",
      "nodes",
      "--output",
      "jsonpath={.items[0].metadata.name}",
    ],
    { encoding: "utf8" },
  );

  const name = status === 0 ? stdout.trim() : "";

  if (!name) {
    throw new Error(`Could not read the node name of ${E2E_CLUSTER_NAME}. Run \`pnpm e2e:cluster:up\` first.`);
  }

  cachedNodeName = name;

  return name;
}

/**
 * Copies the kubeconfig of the E2E cluster where the running Freelens picks it
 * up by itself, and returns the path it now has.
 *
 * Freelens resolves `~/.kube` through `os.userInfo().homedir`, which reads the
 * passwd entry and ignores `$HOME`, so a sandboxed HOME cannot redirect
 * kubeconfig discovery. What Freelens does always watch is
 * `<userData>/kubeconfigs`, and under `--integration-testing` the user data
 * directory lives inside `FREELENS_INTEGRATION_TESTING_DIR`. Dropping the file
 * there adds the cluster to the catalog without reading or writing anything in
 * the developer's own `~/.kube`.
 */
export async function publishKubeconfig(fileName = "kubeswift-e2e"): Promise<string> {
  const testingDirectory = process.env.FREELENS_INTEGRATION_TESTING_DIR;

  if (!testingDirectory) {
    throw new Error("FREELENS_INTEGRATION_TESTING_DIR is not set. Launch the app with the Freelens `start()` helper.");
  }

  // The user data directory is <testing dir>/<app name>, and the app name is
  // the product name of the packaged build.
  const appName = process.env.FREELENS_APP_NAME || "Freelens";
  const directory = path.join(testingDirectory, appName, "kubeconfigs");

  await mkdir(directory, { recursive: true });

  const destination = path.join(directory, fileName);

  await copyFile(kubeconfigPath(), destination);

  return destination;
}

/**
 * Id Freelens gives to a cluster entity: the md5 of the kubeconfig path and the
 * context name. It ends up in the id of the cluster iframe.
 */
export function clusterEntityId(kubeconfigFilePath: string, contextName: string): string {
  return createHash("md5").update(`${kubeconfigFilePath}:${contextName}`).digest("hex");
}

/** Clicks the cluster in the catalog and waits for its frame to be usable. */
export async function openClusterFromCatalog(
  window: Page,
  kubeconfigFilePath: string,
  contextName = E2E_KUBE_CONTEXT,
): Promise<Frame> {
  const rowSelector = `div.TableCell >> text='${contextName}'`;

  // The catalog only lists the cluster once the kubeconfig watcher has seen the
  // file, which happens shortly after it is written.
  await window.waitForSelector(rowSelector, { timeout: CLUSTER_TIMEOUT });
  await window.click(rowSelector);

  const frameElement = await window.waitForSelector(
    `#cluster-frame-${clusterEntityId(kubeconfigFilePath, contextName)}`,
    { timeout: CLUSTER_TIMEOUT },
  );
  const frame = await frameElement.contentFrame();

  if (!frame) {
    throw new Error(`No iframe found for cluster ${contextName}`);
  }

  await frame.waitForSelector("[data-testid=cluster-sidebar]", { timeout: CLUSTER_TIMEOUT });

  return frame;
}

// Freelens derives the sidebar test ids from the extension name, dropping the
// leading "@" and turning the "/" into "--".
const SANITIZED_EXTENSION_ID = EXTENSION_NAME.replace("@", "").replace("/", "--");

export function sidebarItemTestId(menuId: string): string {
  return `sidebar-item-${SANITIZED_EXTENSION_ID}-${menuId}`;
}

export function sidebarLinkTestId(menuId: string): string {
  return `link-for-${sidebarItemTestId(menuId)}`;
}

/**
 * Clicks a sidebar entry by dispatching the event on the anchor.
 *
 * The sidebar links navigate from their `onClick` handler, and the cluster
 * overview keeps re-laying itself out for a while after a connection, so a real
 * click can land on a transient overlay instead. Dispatching the event runs the
 * handler whatever is on top.
 */
export async function clickSidebarItem(frame: Frame, testId: string): Promise<void> {
  const selector = `[data-testid="${testId}"]`;

  await frame.waitForSelector(selector, { timeout: ELEMENT_TIMEOUT });
  await frame.dispatchEvent(selector, "click");
}

/** True when at least one sidebar item is currently rendered as a child of `parentTestId`. */
async function hasVisibleChild(frame: Frame, parentTestId: string): Promise<boolean> {
  return (await frame.$(`[data-parent-id-test="${parentTestId}"]`)) !== null;
}

/**
 * Full test ids of every sidebar group currently rendered but not yet
 * expanded (Freelens shows their expand arrow pointing down, see
 * `sidebar-item.tsx`'s `expand-icon-for-<id>` and `data-icon-name`).
 */
async function collapsedGroupTestIds(frame: Frame): Promise<string[]> {
  try {
    return await frame.$$eval(
      '[data-testid^="expand-icon-for-"] .icon[data-icon-name="keyboard_arrow_down"]',
      (icons) =>
        icons
          .map((icon) => icon.closest('[data-testid^="expand-icon-for-"]')?.getAttribute("data-testid") ?? "")
          .map((testId) => testId.replace(/^expand-icon-for-/, ""))
          .filter(Boolean),
    );
  } catch {
    return [];
  }
}

// Bounds how many rounds of "expand every still-collapsed group, then
// recheck" expandSidebarAncestors runs. The sidebar is not nested more than a
// couple of levels deep in practice; this only guards against looping forever
// if `targetTestId` never appears (e.g. a typo'd menu id).
const MAX_EXPAND_ATTEMPTS = 6;

/**
 * Expands sidebar groups until the item `targetTestId` is rendered, without
 * needing to know the sidebar's taxonomy.
 *
 * A group's children only exist in the DOM once the group itself is expanded
 * (see Freelens's `sidebar-item.tsx`: `renderSubMenu` returns `null` while
 * collapsed), so with nested groups a leaf's test id is invisible until every
 * ancestor group on its branch has been clicked open first, and those
 * ancestors are themselves invisible until *their* ancestors are open. This
 * walks the sidebar breadth-first: on each round it expands every group that
 * is currently visible and still collapsed, then rechecks for the target,
 * which converges regardless of how deep the target sits. With a flat
 * sidebar (the target is a direct, already-visible child of the root) the
 * very first check succeeds and no group is ever clicked, so this is safe to
 * call unconditionally from both the flat and the grouped shape.
 */
export async function expandSidebarAncestors(frame: Frame, targetTestId: string): Promise<void> {
  const targetSelector = `[data-testid="${targetTestId}"]`;

  for (let attempt = 0; attempt < MAX_EXPAND_ATTEMPTS; attempt++) {
    if (await frame.$(targetSelector)) {
      return;
    }

    const collapsed = await collapsedGroupTestIds(frame);

    if (collapsed.length === 0) {
      break;
    }

    for (const groupTestId of collapsed) {
      if (await frame.$(targetSelector)) {
        return;
      }

      await clickSidebarItem(frame, `link-for-${groupTestId}`);
      // Wait for that group's own children to land in the DOM before either
      // expanding the next collapsed group or rechecking, instead of racing
      // the mobx-driven re-render.
      await frame
        .waitForSelector(`[data-parent-id-test="${groupTestId}"]`, { timeout: ELEMENT_TIMEOUT })
        .catch(() => {});
    }
  }

  if (!(await frame.$(targetSelector))) {
    const screenshot = await captureScreenshot(frame, `expand-ancestors-${targetTestId}`);
    const testIds = await sidebarTestIds(frame);

    throw new Error(
      `Could not expand the sidebar down to "${targetTestId}". ` +
        `Sidebar test ids present: ${testIds.length > 0 ? testIds.join(", ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

/** Expands the KubeSwift group, unless it already is. */
export async function openKubeSwiftGroup(frame: Frame): Promise<void> {
  const rootTestId = sidebarItemTestId("kubeswift");

  if (await hasVisibleChild(frame, rootTestId)) {
    return;
  }

  await clickSidebarItem(frame, sidebarLinkTestId("kubeswift"));
  await frame.waitForSelector(`[data-parent-id-test="${rootTestId}"]`, { timeout: ELEMENT_TIMEOUT });
}

/** Opens one of the KubeSwift pages and waits for its header title. */
export async function openKubeSwiftPage(frame: Frame, menuId: string, title: string): Promise<void> {
  await openKubeSwiftGroup(frame);
  // The target may sit under an intermediate group (the tab-bar grouping),
  // not directly under the root: make sure every ancestor along its branch
  // is expanded before clicking its own link.
  await expandSidebarAncestors(frame, sidebarItemTestId(menuId));
  await clickSidebarItem(frame, sidebarLinkTestId(menuId));

  try {
    await frame.waitForSelector(`h5 >> text="${title}"`, { timeout: ELEMENT_TIMEOUT });
  } catch {
    const screenshot = await captureScreenshot(frame, `page-${menuId}`);
    const testIds = await sidebarTestIds(frame);

    throw new Error(
      `The "${title}" page never rendered after clicking ${sidebarLinkTestId(menuId)}. ` +
        `Sidebar test ids present: ${testIds.length > 0 ? testIds.join(", ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

/**
 * Points the namespace filter at one namespace.
 *
 * Freelens does not show all namespaces by default: a fresh profile selects
 * the `default` namespace (`selectedNamespacesStorageInjectable`), so fixtures
 * living anywhere else are filtered out of every namespaced list until the
 * filter is moved. The selection is kept per cluster, so one call covers every
 * page of the run. Cluster-scoped resources are unaffected either way.
 */
export async function selectNamespace(frame: Frame, namespace = E2E_NAMESPACE): Promise<void> {
  const select = await frame.waitForSelector(".NamespaceSelect", { timeout: ELEMENT_TIMEOUT });

  await select.click();
  await select.type(namespace);
  await select.press("Enter");
  // The menu does not close on select, and would cover the table underneath.
  await select.click();

  // The filter renders its selection as "Namespace: <name>", so waiting for
  // that both settles the change and fails loudly if it never happened,
  // instead of leaving every later row assertion to time out.
  try {
    await frame.waitForSelector(`[data-testid="namespace-select-filter"] >> text="Namespace: ${namespace}"`, {
      timeout: ELEMENT_TIMEOUT,
    });
  } catch {
    const screenshot = await captureScreenshot(frame, `namespace-${namespace}`);

    throw new Error(
      `The namespace filter never moved to "${namespace}".` + (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

function tableRow(frame: Frame, name: string): Locator {
  return frame.locator(".TableRow", { hasText: name }).first();
}

/** The cells of a row, as one line, so that adjacent columns can be matched. */
async function rowText(row: Locator): Promise<string> {
  return (await row.innerText()).replace(/\s+/g, " ").trim();
}

/**
 * Asserts that the list has a row for `name` and that the row shows every one
 * of the given values. Cells are joined by single spaces, so a value may span
 * several adjacent columns, for example "3 2 3 2 1".
 */
export async function expectRow(frame: Frame, name: string, ...cells: string[]): Promise<void> {
  const row = tableRow(frame, name);

  try {
    await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  } catch {
    const screenshot = await captureScreenshot(frame, `missing-row-${name}`);
    const rows = await visibleRows(frame);

    throw new Error(
      `Row "${name}" never appeared. Rows on the page: ${rows.length > 0 ? rows.join(" | ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  const text = await rowText(row);

  for (const cell of cells) {
    if (!text.includes(cell)) {
      throw new Error(`Row "${name}" should show "${cell}", got "${text}"`);
    }
  }
}

/** Asserts that the list has no row for `name`. */
export async function expectNoRow(frame: Frame, name: string): Promise<void> {
  const count = await frame.locator(".TableRow", { hasText: name }).count();

  if (count !== 0) {
    throw new Error(`Expected no row for "${name}", found ${count}`);
  }
}

/**
 * Opens the detail panel of a row and asserts that it shows every one of the
 * given texts, then closes it again.
 */
export async function expectDetails(frame: Frame, name: string, ...texts: string[]): Promise<void> {
  // Click the name cell rather than the row: other cells hold links to nodes
  // and namespaces, which would navigate away instead of opening the panel.
  await tableRow(frame, name).locator(".TableCell", { hasText: name }).first().click();

  const drawer = frame.locator(".Drawer.KubeObjectDetails");

  await drawer.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  const text = (await drawer.innerText()).replace(/\s+/g, " ").trim();

  for (const expected of texts) {
    if (!text.includes(expected)) {
      throw new Error(`Details of "${name}" should show "${expected}", got "${text}"`);
    }
  }

  await closeDetails(frame);
}

/**
 * Opens a row's kebab menu and waits for its items.
 *
 * The menu is rendered through a portal (`MenuActions` passes `usePortal` for
 * every non-toolbar menu), so its items are not inside the row: they are matched
 * frame-wide under `.Menu`.
 */
export async function openRowMenu(frame: Frame, name: string): Promise<void> {
  const row = tableRow(frame, name);

  await row.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  await row.locator(".TableCell.menu .Icon").first().click();
  await frame.waitForSelector(".Menu .MenuItem", { state: "visible", timeout: ELEMENT_TIMEOUT });
}

/** Closes an open row menu without clicking any of its items. */
export async function closeRowMenu(frame: Frame): Promise<void> {
  await frame.press("body", "Escape");
  await frame.waitForSelector(".Menu .MenuItem", { state: "hidden", timeout: ELEMENT_TIMEOUT }).catch(() => {});
}

/** One action menu item, in whichever surface it was read from. */
export interface ActionMenuItem {
  testId: string | null;
  /** The item's own tooltip text: the verb, or the verb and the guard's reason. */
  title: string | null;
  disabled: boolean;
}

/**
 * The extension's action items of the currently open menu or toolbar.
 *
 * `title` is where the guard's reason is read from: a disabled `MenuItem`
 * carries `pointer-events: none`, so the host's hover tooltip cannot be shown
 * for it in either surface (spike S7), and the attribute is the channel that
 * survives.
 *
 * `prefix` selects the kind whose items are wanted, since the extension names
 * every test id after the kind it registered the item on: the guest actions
 * (SPEC-0010, SPEC-0011) and the SwiftSnapshot Restore action (SPEC-0011) share
 * one menu with the host's own items and with nothing else.
 */
export async function actionMenuItems(frame: Frame, root: string, prefix = "swiftguest-"): Promise<ActionMenuItem[]> {
  const selector = `${root} .MenuItem[data-testid^="${prefix}"]`;

  // The host renders its own items and the extension's in the same menu, and in
  // the toolbar it builds them from a reaction that fires on mount, so a caller
  // that reads the DOM in the same tick can race an empty list. A caller that
  // expects none gets one bounded wait and an empty array, which is the same
  // answer it would have had.
  await frame.waitForSelector(selector, { state: "attached", timeout: ELEMENT_TIMEOUT }).catch(() => {});

  return frame.$$eval(selector, (elements) =>
    elements.map((element) => ({
      testId: element.getAttribute("data-testid"),
      title: element.getAttribute("title"),
      disabled: element.classList.contains("disabled"),
    })),
  );
}

/** The text of the open confirmation dialog, as one line. */
export async function confirmDialogText(frame: Frame): Promise<string> {
  const dialog = frame.locator('[data-testid="confirmation-dialog"]');

  await dialog.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });

  return (await dialog.innerText()).replace(/\s+/g, " ").trim();
}

/** Confirms the open dialog, and waits for it to go away. */
export async function confirmDialog(frame: Frame): Promise<void> {
  await frame.locator('[data-testid="confirm"]').click();
  await frame.waitForSelector('[data-testid="confirmation-dialog"]', { state: "hidden", timeout: ELEMENT_TIMEOUT });
}

/** Dismisses the open dialog without confirming it. */
export async function cancelDialog(frame: Frame): Promise<void> {
  await frame.locator('[data-testid="confirmation-dialog"] .cancel').click();
  await frame.waitForSelector('[data-testid="confirmation-dialog"]', { state: "hidden", timeout: ELEMENT_TIMEOUT });
}

/**
 * Waits for a notification of `status` ("ok" or "error") whose text contains
 * `expected`, and returns it.
 *
 * Every write in M6 ends with one, which is the point: an action that changed
 * nothing visible must still answer, and a failed one must never be silent.
 */
export async function expectNotification(frame: Frame, status: "ok" | "error", expected: string): Promise<string> {
  const notification = frame.locator(`.Notifications .notification.${status}`, { hasText: expected }).first();

  try {
    await notification.waitFor({ state: "visible", timeout: ELEMENT_TIMEOUT });
  } catch {
    const all = await frame.locator(".Notifications .notification").allInnerTexts();
    const screenshot = await captureScreenshot(frame, `notification-${status}-${expected.slice(0, 20)}`);

    throw new Error(
      `No ${status} notification containing "${expected}". Notifications on screen: ` +
        `${all.length > 0 ? all.map((text) => text.replace(/\s+/g, " ").trim()).join(" | ") : "(none)"}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  return (await notification.innerText()).replace(/\s+/g, " ").trim();
}

/** Closes every notification on screen, so the next case reads its own. */
export async function clearNotifications(frame: Frame): Promise<void> {
  const closers = frame.locator(".Notifications .notification .close");

  for (let remaining = await closers.count(); remaining > 0; remaining--) {
    await closers
      .first()
      .click()
      .catch(() => {});
  }

  await frame.waitForTimeout(500);
}

/** Closes the detail panel: the drawer listens for Escape. */
export async function closeDetails(frame: Frame): Promise<void> {
  await frame.press("body", "Escape");
  await frame.waitForSelector(".Drawer.KubeObjectDetails", { state: "hidden", timeout: ELEMENT_TIMEOUT });
}

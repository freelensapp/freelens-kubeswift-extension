/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The session layer shared by the integration test, the E2E suite and the
// pre-review pass (`integration/__tests__`). The suites run in
// this repository under `vitest.integration.config.ts` and attach to Freelens
// started with `pnpm dev` from a freelensapp/freelens checkout, over the Chrome
// DevTools Protocol port that script opens, as the integration tests of
// freelensapp/freelens-example-extension do. They drive the renderer only:
// the application menu belongs to the main process, which CDP does not reach,
// so navigation goes through `Renderer.Navigation.navigate` of the extension
// API.

import * as fs from "node:fs";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { chromium } from "playwright";

import type { Browser, ConsoleMessage, Page } from "playwright";

/** Name of this extension, as published and as shown by the extensions page. */
export const EXTENSION_NAME = "@freelensapp/kubeswift-extension";

/** The root of this checkout, installed in place. */
const EXTENSION_DIR = path.resolve(import.meta.dirname, "..", "..");

/** The CDP endpoint of Freelens dev: `pnpm dev` of Freelens starts Electron with `--remoteDebuggingPort 9223`. */
const CDP_URL = process.env.FREELENS_CDP_URL || "http://127.0.0.1:9223";

/**
 * The log of the main process, which CDP does not carry: the output of
 * `pnpm dev` of Freelens. Without it only the renderer's errors are checked.
 */
const MAIN_LOG_FILE = process.env.FREELENS_MAIN_LOG;

const ELEMENT_TIMEOUT = 60 * 1000;
const INSTALL_TIMEOUT = 90 * 1000;

/**
 * Where failure screenshots go. run-suite.sh points this at the repository
 * root so that CI can upload the directory as an artifact.
 */
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts");

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

// The Kubernetes proxy of Freelens logs a request that the renderer aborts as
// an error. Freelens dev renders in React.StrictMode, which mounts every view
// twice and aborts the requests of the first mount, so the line comes and goes
// with the timing of a run. It names no request, and says nothing about the
// extension.
const ABORTED_PROXY_REQUEST_PATTERN = /proxy_server\.go:\d+\] Error while proxying request: context canceled$/;

/**
 * Screenshots the whole app window. Never throws: a failed screenshot must
 * not replace the failure that asked for it.
 */
export async function captureWindowScreenshot(window: Page, name: string): Promise<string | undefined> {
  const file = path.join(ARTIFACTS_DIR, `${name.replace(/[^a-zA-Z0-9-]+/g, "-")}.png`);

  try {
    await mkdir(ARTIFACTS_DIR, { recursive: true });
    await window.screenshot({ path: file, fullPage: true });

    return file;
  } catch {
    return undefined;
  }
}

/** The text of every notification currently shown, for failure messages. */
async function notificationTexts(window: Page): Promise<string[]> {
  try {
    const texts = await window.$$eval('[class*="Notification"], [class*="notification"]', (elements) =>
      elements.map((element) => element.textContent ?? ""),
    );

    return texts.map((text) => text.replace(/\s+/g, " ").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** A connection to Freelens dev, with the errors that either process logs. */
export interface AppSession {
  browser: Browser;
  /** The root frame's page: the catalog, the extensions and the preferences render there. */
  window: Page;
  /** The errors logged so far. */
  errors(): string[];
  /** Stops collecting errors and closes the connection (the app keeps running); returns every error logged. */
  close(): Promise<string[]>;
}

/**
 * Whether Freelens dev answers on its CDP endpoint. Outside CI a suite skips
 * with a warning otherwise; in CI the run fails, so that a mistake in the
 * workflow does not turn into a silent skip.
 */
export async function appReady(): Promise<boolean> {
  let reason: string | undefined;

  try {
    const response = await fetch(new URL("/json/version", CDP_URL), { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      reason = `${CDP_URL} answered ${response.status}`;
    }
  } catch (error) {
    reason = `Freelens dev does not answer on ${CDP_URL}: ${error instanceof Error ? error.message : error}`;
  }

  if (!reason) {
    return true;
  }

  if (process.env.CI) {
    throw new Error(`Cannot run the suite: ${reason}`);
  }

  console.warn(`Skipping the suite: ${reason}`);

  return false;
}

/**
 * Collects the errors of the renderer's console, of every frame, and the
 * error lines of the main log written after the session started.
 */
function collectErrors(window: Page) {
  const errorLogs: string[] = [];
  let mainLogOffset = MAIN_LOG_FILE && fs.existsSync(MAIN_LOG_FILE) ? fs.statSync(MAIN_LOG_FILE).size : 0;

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() === "error") {
      // A failed request says only its status; the location names the URL.
      const { url } = message.location();

      errorLogs.push(`[renderer] ${message.text().replaceAll(ANSI_ESCAPE_PATTERN, "")}${url ? ` (${url})` : ""}`);
    }
  };

  const onPageError = (error: Error) => {
    errorLogs.push(`[renderer] ${error.stack ?? error.message}`);
  };

  // A line of the main log starts with its level, after the task prefix that
  // turbo adds to the output of `pnpm dev` (`freelens:dev: `).
  const readMainLog = () => {
    if (!MAIN_LOG_FILE || !fs.existsSync(MAIN_LOG_FILE)) {
      return;
    }

    const size = fs.statSync(MAIN_LOG_FILE).size;

    if (size < mainLogOffset) {
      mainLogOffset = 0;
    }

    if (size === mainLogOffset) {
      return;
    }

    const fd = fs.openSync(MAIN_LOG_FILE, "r");

    try {
      const buffer = Buffer.alloc(size - mainLogOffset);

      fs.readSync(fd, buffer, 0, buffer.length, mainLogOffset);
      mainLogOffset = size;

      for (const line of buffer.toString("utf8").split("\n")) {
        const text = line.replaceAll(ANSI_ESCAPE_PATTERN, "");

        if (/^(?:[\w@/.-]+:[\w:-]+: )?\s*error:/.test(text) && !ABORTED_PROXY_REQUEST_PATTERN.test(text.trim())) {
          errorLogs.push(`[main] ${text.trim()}`);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  window.on("console", onConsole);
  window.on("pageerror", onPageError);

  return {
    errors: () => {
      readMainLog();

      return [...errorLogs];
    },
    stop: () => {
      window.off("console", onConsole);
      window.off("pageerror", onPageError);
    },
  };
}

/**
 * The page of the root frame: `https://renderer.freelens.app`, on the port of
 * the app's proxy. A cluster renders in an iframe of it.
 */
async function rootPage(browser: Browser): Promise<Page> {
  const deadline = Date.now() + ELEMENT_TIMEOUT;

  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((page) => URL.canParse(page.url()) && new URL(page.url()).hostname === "renderer.freelens.app");

    if (page) {
      await page.waitForFunction(() => globalThis.FreelensExtensionApi?.Renderer !== undefined, null, {
        timeout: ELEMENT_TIMEOUT,
      });

      return page;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`No Freelens window on ${CDP_URL}`);
}

/**
 * Connects to Freelens dev and collects the errors either process logs until
 * the session is closed. Closing a browser connected over CDP closes only the
 * connection; the app keeps running.
 */
export async function connectApp(): Promise<AppSession> {
  const browser = await chromium.connectOverCDP(CDP_URL);

  try {
    const window = await rootPage(browser);
    const collector = collectErrors(window);

    return {
      browser,
      window,
      errors: collector.errors,
      close: async () => {
        const errors = collector.errors();

        collector.stop();
        await browser.close();

        return errors;
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

/** Navigates the root frame with `Renderer.Navigation.navigate` of the extension API. */
export async function navigate(window: Page, url: string): Promise<void> {
  await window.evaluate((target) => {
    const renderer = globalThis.FreelensExtensionApi.Renderer;

    if (!renderer) {
      throw new Error("The page has no Renderer API");
    }

    renderer.Navigation.navigate(target);
  }, url);
}

/**
 * Dismisses the notifications, so that one still in its enter animation does
 * not intercept pointer events on the elements behind it.
 */
export async function dismissNotifications(window: Page): Promise<void> {
  const notificationCloseSelector =
    'i[data-testid*="close-notification-for-notification_"], div[class*="close-button-module__closeButton--"][aria-label="Close"]';

  for (let attempt = 0; attempt < 10; attempt++) {
    const closeButtons = await window.$$(notificationCloseSelector);

    if (closeButtons.length === 0) break;

    for (const closeButton of closeButtons) {
      await closeButton.click({ force: true }).catch(() => {});
    }

    await window.waitForTimeout(200);
  }
}

/**
 * Installs this checkout in place from the Extensions page and waits until it
 * is enabled. An installation of the checkout that is already enabled is kept,
 * unless `reinstall` is set; any other installation of the extension is
 * uninstalled first. The checkout must be built (`pnpm build`): Freelens loads
 * it from `dist/`.
 *
 * On failure, screenshots the window and reports every notification, so a
 * stuck install is never a blind timeout.
 */
export async function installExtension({ window }: AppSession, { reinstall = false } = {}): Promise<void> {
  await navigate(window, "/extensions");

  const table = window.getByTestId("extensions-table");
  const row = table.locator("tbody tr", { hasText: EXTENSION_NAME });
  const enabled = row.locator("td").nth(2).getByText("Enabled", { exact: true });

  // Once the extensions are discovered, the page shows the table, or a notice
  // in its place when no extension is installed, as in a fresh profile.
  await table
    .or(window.getByText("There are no extensions installed.", { exact: true }))
    .waitFor({ timeout: ELEMENT_TIMEOUT });

  if (await row.count()) {
    // An extension loaded in place reads "development" in the version column,
    // with the directory in its title.
    const inPlace = await row.locator(`[title="Loaded from ${EXTENSION_DIR}"]`).count();

    if (!reinstall && inPlace && (await enabled.count())) {
      return;
    }

    await row.locator('[id^="menu-actions-for-installed-extensions-for-"]').click();
    await window.locator(".MenuActions .MenuItem").getByText("Uninstall", { exact: true }).click();
    await window.getByTestId("confirmation-dialog").getByTestId("confirm").click();
    await row.waitFor({ state: "detached", timeout: ELEMENT_TIMEOUT });
  }

  await window.getByPlaceholder("Name, URL, or path to a package or directory").fill(EXTENSION_DIR);
  await window.getByRole("button", { name: "Install", exact: true }).click();

  try {
    // A directory is loaded in place only after a confirmation.
    await window.getByTestId("confirmation-dialog").getByTestId("confirm").click({ timeout: ELEMENT_TIMEOUT });
    // The status column reads "Incompatible" if the host refuses `engines.freelens`.
    await enabled.waitFor({ timeout: INSTALL_TIMEOUT });
  } catch (error) {
    const screenshot = await captureWindowScreenshot(window, "install-timed-out");
    const notifications = await notificationTexts(window);

    throw new Error(
      `"${EXTENSION_NAME}" was not installed in place from ${EXTENSION_DIR}: ${error}.` +
        (notifications.length > 0 ? ` Notifications: ${notifications.join(" | ")}.` : "") +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  await dismissNotifications(window);
}

export type ColorTheme = "Dark" | "Light";

/**
 * Selects the colour theme in the application preferences and goes back to
 * `returnTo`, the route the caller was on (for a suite in a cluster, its
 * `/cluster/<id>`): the cluster's frame stays loaded meanwhile.
 */
export async function setColorTheme(window: Page, theme: ColorTheme, returnTo: string): Promise<void> {
  await navigate(window, "/preferences/app");

  const themeInput = await window.waitForSelector("#theme-input", { timeout: ELEMENT_TIMEOUT });

  await themeInput.click();
  await window.click(`.Select__option >> text="${theme}"`, { timeout: ELEMENT_TIMEOUT });
  await navigate(window, returnTo);
}

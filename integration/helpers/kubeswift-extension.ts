/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers shared by the integration smoke test (`integration/__tests__`) and
// the E2E suite (`e2e/__tests__`).
//
// Both suites run inside a checkout of freelensapp/freelens: their files are
// copied next to the Freelens ones, under `integration/__tests__` and
// `integration/helpers`, and are run by the Freelens `test:integration` script,
// which owns the Playwright/Electron launch helpers (`../helpers/utils`) these
// suites build on. That is why relative imports of `../helpers/*` resolve when
// the tests run but not inside this repository.

import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import type { ConsoleMessage, ElectronApplication, Page } from "playwright";

/** Name of this extension, as published and as shown by the extensions page. */
export const EXTENSION_NAME = "@freelensapp/kubeswift-extension";

const ELEMENT_TIMEOUT = 60 * 1000;

/**
 * Where failure screenshots go. run-suite.sh points this at the repository
 * root so that CI can upload the directory as an artifact. Mirrors the
 * ARTIFACTS_DIR of kubeswift-cluster.ts, duplicated here rather than shared
 * because this module screenshots the top-level Page, not a cluster Frame.
 */
const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts");

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

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;
const OUTPUT_ERROR_PATTERN = /\[out\]\s*error:/i;

/**
 * Collects everything that looks like an error while the app runs: renderer
 * console messages and the process output of the main process, which reports
 * extension failures as plain `[out] error:` lines rather than as exceptions.
 */
export interface ErrorCollector {
  /** Starts capturing the process output. Call it before launching the app. */
  start: () => void;
  /** Starts capturing the renderer console of a window. */
  watch: (window: Page) => void;
  /** Stops capturing both. */
  stop: (window: Page) => void;
  /** Everything captured so far. */
  errors: () => string[];
}

export function createErrorCollector(): ErrorCollector {
  const consoleErrors: string[] = [];
  const outputErrors: string[] = [];

  let outputBuffer = "";
  let restoreOutputHooks: undefined | (() => void);

  const collectOutputErrors = (chunk: string | Uint8Array) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

    outputBuffer += text;

    // Keep the buffer bounded while preserving enough tail to match patterns
    // split across chunks.
    if (outputBuffer.length > 200_000) {
      outputBuffer = outputBuffer.slice(-20_000);
    }

    const normalizedOutput = outputBuffer.replace(ANSI_ESCAPE_PATTERN, "");

    if (OUTPUT_ERROR_PATTERN.test(normalizedOutput)) {
      outputErrors.push(normalizedOutput.trim());
      outputBuffer = "";
    }
  };

  const logger = (message: ConsoleMessage) => {
    const text = message.text();
    const normalizedText = text.replace(ANSI_ESCAPE_PATTERN, "");

    console.log(text);

    // Some app logs are emitted as "log" messages, so inspect both the console
    // type and the message content.
    if (message.type() === "error" || OUTPUT_ERROR_PATTERN.test(normalizedText)) {
      consoleErrors.push(`[${message.type()}] ${normalizedText}`);
    }
  };

  return {
    start: () => {
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      process.stdout.write = ((chunk, encoding, callback) => {
        collectOutputErrors(chunk);

        return originalStdoutWrite(chunk, encoding as never, callback as never);
      }) as typeof process.stdout.write;

      process.stderr.write = ((chunk, encoding, callback) => {
        collectOutputErrors(chunk);

        return originalStderrWrite(chunk, encoding as never, callback as never);
      }) as typeof process.stderr.write;

      restoreOutputHooks = () => {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      };
    },

    watch: (window: Page) => {
      window.on("console", logger);
    },

    stop: (window: Page) => {
      window.off("console", logger);
      restoreOutputHooks?.();
      restoreOutputHooks = undefined;
    },

    errors: () => [...consoleErrors, ...outputErrors],
  };
}

/** Opens the extensions page through the application menu. */
export async function navigateToExtensions(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app }) => {
    await app.applicationMenu
      ?.getMenuItemById(process.platform === "darwin" ? "mac" : "file")
      ?.submenu?.getMenuItemById("navigate-to-extensions")
      ?.click();
  });
}

/** Opens the catalog through the application menu. */
export async function navigateToCatalog(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app }) => {
    await app.applicationMenu?.getMenuItemById("view")?.submenu?.getMenuItemById("navigate-to-catalog")?.click();
  });
}

/** Opens the preferences page through the application menu. */
export async function navigateToPreferences(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ app }) => {
    await app.applicationMenu
      ?.getMenuItemById(process.platform === "darwin" ? "mac" : "file")
      ?.submenu?.getMenuItemById("navigate-to-preferences")
      ?.click();
  });
}

export type ColorTheme = "Dark" | "Light";

/**
 * Switches the app-wide color theme through the preferences page, then
 * closes preferences again (its close button navigates back in history,
 * landing on whatever was open before, e.g. a connected cluster).
 *
 * A connected cluster's iframe is not reloaded by this round trip - it keeps
 * its own route and state - so callers can keep using a `Frame` obtained
 * before calling this.
 */
export async function setColorTheme(app: ElectronApplication, window: Page, theme: ColorTheme): Promise<void> {
  await navigateToPreferences(app);

  await window.waitForSelector("[data-preference-tab-link-test=app]", { timeout: ELEMENT_TIMEOUT });
  await window.click("[data-preference-tab-link-test=app]");

  const themeInput = await window.waitForSelector("#theme-input", { timeout: ELEMENT_TIMEOUT });

  await themeInput.click();
  await window.click(`.Select__option >> text="${theme}"`, { timeout: ELEMENT_TIMEOUT });

  await window.click('[data-testid="close-preferences"]', { timeout: ELEMENT_TIMEOUT });
}

// Freelens's own install pipeline gives up waiting for the extension loader to
// pick up the unpacked files after 10s (unpack-extension.injectable.tsx) and
// shows an error notification instead. Everything after that point (registry
// lookup, download, tar extraction, the loader's file-watch detection) can
// occasionally take longer than that under load or on a cold filesystem-event
// cache (observed on a fresh macOS checkout, where the very first launch of a
// newly built, unsigned app bundle can be slow for reasons entirely outside
// this code, e.g. Gatekeeper's on-first-run scan). This wait is kept
// deliberately generous, and identical on every platform, rather than
// special-cased per OS: a slow-but-eventually-successful install should not
// be reported as a real failure on any platform, macOS included.
const INSTALL_TIMEOUT = 90 * 1000;

/**
 * Installs the packed extension and waits for it to be listed as enabled.
 *
 * `EXTENSION_PATH` points at the tarball built from this repository; without it
 * the extension is installed from the registry by name.
 *
 * On failure, screenshots the window and reports every notification and the
 * state of the install button, so a stuck install is never a blind timeout.
 */
export async function installExtension(
  app: ElectronApplication,
  window: Page,
  extensionPath = process.env.EXTENSION_PATH || EXTENSION_NAME,
): Promise<void> {
  await navigateToExtensions(app);

  const textbox = window.getByPlaceholder("Name or file path or URL");

  try {
    await textbox.waitFor({ state: "visible", timeout: INSTALL_TIMEOUT });
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-no-extensions-page");

    throw new Error(
      `The Extensions page never showed its install field (menu navigation may have failed). Current URL: ${window.url()}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  await textbox.fill(extensionPath);

  const installButtonSelector = 'button[class*="Button install-module__button--"]';

  await window.click(installButtonSelector.concat("[data-waiting=false]"), { timeout: INSTALL_TIMEOUT });

  const extensionNameSelector = 'div[class*="installed-extensions-module__extensionName--"]';

  let installedExtensionName: string | null;

  try {
    installedExtensionName = await (
      await window.waitForSelector(extensionNameSelector, { timeout: INSTALL_TIMEOUT })
    ).textContent();
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-timed-out");
    const notifications = await notificationTexts(window);

    throw new Error(
      `"${EXTENSION_NAME}" never appeared as installed within ${INSTALL_TIMEOUT}ms.` +
        (notifications.length > 0
          ? ` Notifications shown: ${notifications.join(" | ")}.`
          : " No notifications shown.") +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  if (installedExtensionName !== EXTENSION_NAME) {
    const screenshot = await captureWindowScreenshot(window, "install-wrong-name");

    throw new Error(
      `Expected ${EXTENSION_NAME} to be installed, found ${String(installedExtensionName)}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  let installedExtensionState: string | null;

  try {
    installedExtensionState = await (
      await window.waitForSelector('div[class*="installed-extensions-module__enabled--"]', {
        timeout: INSTALL_TIMEOUT,
      })
    ).textContent();
  } catch {
    const screenshot = await captureWindowScreenshot(window, "install-not-enabled");

    throw new Error(
      `"${EXTENSION_NAME}" was installed but never showed its enabled state within ${INSTALL_TIMEOUT}ms.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }

  if (installedExtensionState !== "Enabled") {
    const screenshot = await captureWindowScreenshot(window, "install-not-enabled-state");

    throw new Error(
      `Expected ${EXTENSION_NAME} to be enabled, found ${String(installedExtensionState)}.` +
        (screenshot ? ` Screenshot: ${screenshot}` : ""),
    );
  }
}

/**
 * Dismisses every notification, so that one still in its enter animation does
 * not intercept pointer events meant for the elements behind it.
 */
export async function dismissNotifications(window: Page): Promise<void> {
  const notificationCloseSelector =
    'i[data-testid*="close-notification-for-notification_"], div[class*="close-button-module__closeButton--"][aria-label="Close"]';

  for (let attempt = 0; attempt < 10; attempt++) {
    const closeButtons = await window.$$(notificationCloseSelector);

    if (closeButtons.length === 0) {
      return;
    }

    for (const closeButton of closeButtons) {
      await closeButton.click({ force: true }).catch(() => {});
    }

    await window.waitForTimeout(200);
  }
}

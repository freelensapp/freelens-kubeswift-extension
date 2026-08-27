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

import type { ConsoleMessage, ElectronApplication, Page } from "playwright";

/** Name of this extension, as published and as shown by the extensions page. */
export const EXTENSION_NAME = "@freelensapp/kubeswift-extension";

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

/**
 * Installs the packed extension and waits for it to be listed as enabled.
 *
 * `EXTENSION_PATH` points at the tarball built from this repository; without it
 * the extension is installed from the registry by name.
 */
export async function installExtension(
  app: ElectronApplication,
  window: Page,
  extensionPath = process.env.EXTENSION_PATH || EXTENSION_NAME,
): Promise<void> {
  await navigateToExtensions(app);

  const textbox = window.getByPlaceholder("Name or file path or URL");

  await textbox.fill(extensionPath);

  const installButtonSelector = 'button[class*="Button install-module__button--"]';

  await window.click(installButtonSelector.concat("[data-waiting=false]"));

  const installedExtensionName = await (
    await window.waitForSelector('div[class*="installed-extensions-module__extensionName--"]')
  ).textContent();

  if (installedExtensionName !== EXTENSION_NAME) {
    throw new Error(`Expected ${EXTENSION_NAME} to be installed, found ${String(installedExtensionName)}`);
  }

  const installedExtensionState = await (
    await window.waitForSelector('div[class*="installed-extensions-module__enabled--"]')
  ).textContent();

  if (installedExtensionState !== "Enabled") {
    throw new Error(`Expected ${EXTENSION_NAME} to be enabled, found ${String(installedExtensionState)}`);
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

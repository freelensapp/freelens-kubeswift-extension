/**
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import * as kubeswift from "../helpers/kubeswift-extension";
import * as utils from "../helpers/utils";

import type { ElectronApplication, Page } from "playwright";

// Smoke test for the packed extension: Freelens starts and renders, the
// tarball built from this repository installs, the extension is listed as
// enabled, and neither the renderer console nor the process output reports an
// error while it activates. The assertions on the KubeSwift resource views
// live in the E2E suite, which needs a cluster with the CRDs and the fixtures
// (see `e2e/` and docs/development/TESTING.md).
describe("kubeswift extension", () => {
  let app: ElectronApplication;
  let window: Page;
  let cleanup: undefined | (() => Promise<void>);

  const errorCollector = kubeswift.createErrorCollector();

  beforeAll(async () => {
    // Hook the process output before the app starts, so that failures during
    // its startup are captured too.
    errorCollector.start();

    ({ app, window, cleanup } = await utils.start());
    errorCollector.watch(window);

    await utils.clickWelcomeButton(window);
    await kubeswift.installExtension(app, window);
    await kubeswift.dismissNotifications(window);
  }, 120 * 1000);

  afterAll(
    async () => {
      // Keep the listeners active through cleanup, so that late shutdown errors
      // still reach the CI logs.
      await cleanup?.();
      errorCollector.stop(window);
      assertNoErrors();
    },
    10 * 60 * 1000,
  );

  it(
    "installs and activates without errors",
    async () => {
      assertNoErrors();
    },
    100 * 60 * 1000,
  );

  function assertNoErrors() {
    const errors = errorCollector.errors();

    if (errors.length > 0) {
      throw new Error(`Freelens reported errors while the extension was active:\n${errors.join("\n")}`);
    }
  }
});

/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Installs this checkout in place in Freelens dev, uninstalling whatever
// installation of the extension the app had, and checks that neither process
// logs an error while it activates. The assertions on the KubeSwift views are
// in the E2E suite, which needs the lab cluster with the CRDs and the fixtures
// (see `e2e/` and docs/development/TESTING.md).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appReady, connectApp, installExtension } from "../helpers/kubeswift-extension";

import type { AppSession } from "../helpers/kubeswift-extension";

describe.skipIf(!(await appReady()))("kubeswift extension", () => {
  let session: AppSession | undefined;

  beforeAll(async () => {
    session = await connectApp();
    await installExtension(session, { reinstall: true });
  }, 180 * 1000);

  afterAll(async () => {
    expect((await session?.close()) ?? []).toEqual([]);
  });

  it("installs in place and activates without errors", () => {
    expect(session?.errors()).toEqual([]);
  });
});

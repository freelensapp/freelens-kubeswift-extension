/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Pre-review agent pass (SPEC-0006): drives a real Freelens, with the
// extension installed from the tarball built by this repository, against the
// local DEMO cluster (`e2e/scripts/pre-review.sh`, reusing the demo cluster
// of SPEC-0005). For every registered KubeSwift view it opens the list page,
// screenshots it, opens one detail drawer per fixture object and screenshots
// it, runs the DOM asserts of the statically checkable DESIGN.md rules, then
// does it all again in the light theme. A markdown report is written to
// e2e-artifacts/pre-review/REPORT.md.
//
// Run it with `pnpm pre-review`. See
// docs/specs/SPEC-0006-pre-review-agent-pass.md for the design and
// docs/development/TESTING.md for how it fits the test layers.
//
// Screenshots and DOM asserts are run once per view in the dark theme; the
// light-theme pass only re-takes the screenshots. The asserts are structural
// (header ids, link hrefs, byte-formatted text, section titles), not visual,
// so they do not depend on the theme - re-running them a second time would
// not find anything a human could not already see from the dark-theme
// results, and would double the number of preferences round-trips this pass
// needs. See "Notes and deviations" in SPEC-0006.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as cluster from "../helpers/kubeswift-cluster";
import * as kubeswift from "../helpers/kubeswift-extension";
import { KUBESWIFT_VIEWS } from "../helpers/kubeswift-views";
import * as pr from "../helpers/pre-review";

import type { Frame, Page } from "playwright";

// Connecting a cluster, installing an extension, and walking ten views twice
// (both themes, with drawer links each re-navigating and reopening) is slow,
// and this pass is meant to run before a milestone review, not on every PR.
const TIMEOUT = 20 * 60 * 1000;

// Run only by `pnpm pre-review`, against the demo cluster: `pnpm test:integration` runs the other suites, against
// the E2E cluster.
const preReview = process.env.KUBESWIFT_PRE_REVIEW === "1";

describe.skipIf(!preReview || !(await kubeswift.appReady()))("Pre-review agent pass against the demo cluster", () => {
  let session: kubeswift.AppSession | undefined;
  let window: Page;
  let frame: Frame;
  let clusterRoute: string;

  const views: pr.ViewReport[] = [];

  beforeAll(async () => {
    if (!cluster.fixturesReady()) {
      throw new Error(
        `The KubeSwift fixtures are missing from ${cluster.E2E_CLUSTER_NAME}. Run \`pnpm demo:up\` first (or ` +
          "pnpm pre-review, which brings the demo cluster up itself).",
      );
    }

    session = await kubeswift.connectApp();
    window = session.window;
    await kubeswift.installExtension(session);
    ({ frame, route: clusterRoute } = await cluster.openKubeSwiftCluster(window));
    // The first pass is the dark one whatever theme the profile had: a fresh
    // profile follows the system's.
    await kubeswift.setColorTheme(window, "Dark", clusterRoute);

    // See kubeswift-e2e.tests.ts: a freshly connected cluster only shows the
    // `default` namespace until the filter is moved once.
    await cluster.openKubeSwiftPage(frame, KUBESWIFT_VIEWS[0].menuId, KUBESWIFT_VIEWS[0].title);
    await cluster.selectNamespace(frame);
  }, TIMEOUT);

  afterAll(async () => {
    await session?.close();
  }, TIMEOUT);

  /**
   * Opens `view`'s list page and detail drawer, screenshots both, and - only
   * on the first (dark) pass - runs the DOM asserts and records a new report
   * entry. On the second (light) pass, appends the two screenshots to the
   * entry the dark pass already created.
   */
  async function captureView(view: (typeof KUBESWIFT_VIEWS)[number], theme: pr.Theme, runAsserts: boolean) {
    await cluster.openKubeSwiftPage(frame, view.menuId, view.title);

    const listShot = await pr.screenshotView(frame, view.menuId, `list-${theme}`);
    const headerMissingIds = runAsserts ? await pr.headerCellsWithoutId(frame) : [];
    const listRowTexts = runAsserts ? await frame.locator(".TableRow").allInnerTexts() : [];
    const nonHumanizedListValues = runAsserts ? pr.nonHumanizedByteValues(listRowTexts.join(" ")) : [];

    await pr.openDrawer(frame, view.fixtureObject);
    const drawerShot = await pr.screenshotView(frame, view.menuId, `drawer-${theme}`);

    let links: pr.LinkCheckResult[] = [];
    let possibleUnlinkedReferences: pr.DrawerRow[] = [];
    let conditionsSectionCount = 0;
    let nonHumanizedDrawerValues: string[] = [];
    let actionControls: pr.ActionControl[] = [];
    let actionControlsCollectedAsLinks: string[] = [];

    if (runAsserts) {
      // Read before anything is clicked, and never hovered: the pass reports
      // the write actions and their disabled reasons, and asserts that none of
      // them was collected as a link (SPEC-0010).
      actionControls = await pr.actionControls(frame);
      actionControlsCollectedAsLinks = await pr.actionControlsCollectedAsLinks(frame);
    }

    if (runAsserts) {
      const rows = await pr.inspectDrawerRows(frame);
      const classified = pr.classifyDrawerReferences(rows);

      possibleUnlinkedReferences = classified.possibleUnlinkedReferences;

      const reopen = async () => {
        await cluster.openKubeSwiftPage(frame, view.menuId, view.title);
        await pr.openDrawer(frame, view.fixtureObject);
      };

      for (const row of classified.links) {
        links.push(await pr.checkDrawerLink(frame, view.menuId, row, reopen));
      }

      conditionsSectionCount = (await pr.conditionsSectionTitles(frame)).length;

      const drawerText = await pr.extensionDrawerText(frame);

      nonHumanizedDrawerValues = pr.nonHumanizedByteValues(drawerText);
    }

    await cluster.closeDetails(frame);

    if (runAsserts) {
      views.push({
        menuId: view.menuId,
        title: view.title,
        fixtureObject: view.fixtureObject,
        screenshots: [
          { theme, kind: "list", path: listShot },
          { theme, kind: "drawer", path: drawerShot },
        ],
        asserts: {
          headerMissingIds,
          links,
          possibleUnlinkedReferences,
          conditionsSectionCount,
          nonHumanizedListValues,
          nonHumanizedDrawerValues,
          actionControls,
          actionControlsCollectedAsLinks,
        },
      });
    } else {
      const existing = views.find((entry) => entry.menuId === view.menuId);

      existing?.screenshots.push({ theme, kind: "list", path: listShot }, { theme, kind: "drawer", path: drawerShot });
    }
  }

  it(
    "screenshots and DOM-checks every KubeSwift view in both themes, and writes the report",
    async () => {
      for (const view of KUBESWIFT_VIEWS) {
        await captureView(view, "dark", true);
      }

      await kubeswift.setColorTheme(window, "Light", clusterRoute);

      for (const view of KUBESWIFT_VIEWS) {
        await captureView(view, "light", false);
      }

      // Leave the app in its default theme for whoever inspects it next.
      await kubeswift.setColorTheme(window, "Dark", clusterRoute);

      const reportPath = await pr.writeReport(views);

      console.log(`[pre-review] report written to ${reportPath}`);

      expect(views).toHaveLength(KUBESWIFT_VIEWS.length);
    },
    TIMEOUT,
  );
});

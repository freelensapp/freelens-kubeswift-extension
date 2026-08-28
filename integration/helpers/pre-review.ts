/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Helpers for the pre-review agent pass (docs/specs/SPEC-0006-pre-review-agent-pass.md):
// screenshotting every KubeSwift view in both themes and running the DOM-level
// asserts of the statically checkable DESIGN.md rules. Reuses the cluster and
// extension helpers of kubeswift-cluster.ts / kubeswift-extension.ts; see the
// latter for why these files live next to the Freelens integration helpers at
// run time.

import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { Frame } from "playwright";

/**
 * Where the pass writes its screenshots and report. `e2e/scripts/pre-review.sh`
 * points E2E_ARTIFACTS_DIR at `e2e-artifacts/pre-review` so a pass never mixes
 * its output with a plain `pnpm e2e` failure screenshot.
 */
export const ARTIFACTS_DIR = process.env.E2E_ARTIFACTS_DIR || path.join(process.cwd(), "e2e-artifacts", "pre-review");

export type Theme = "dark" | "light";

/**
 * Screenshots the window into `<ARTIFACTS_DIR>/<view>/<name>.png`. Never
 * throws: a failed screenshot must not abort the rest of the pass.
 */
export async function screenshotView(frame: Frame, view: string, name: string): Promise<string | undefined> {
  const dir = path.join(ARTIFACTS_DIR, view);
  const file = path.join(dir, `${name}.png`);

  try {
    await mkdir(dir, { recursive: true });
    await frame.page().screenshot({ path: file, fullPage: true });

    return file;
  } catch {
    return undefined;
  }
}

/** Opens the detail drawer of `objectName` and leaves it open (unlike `kubeswift-cluster.ts`'s `expectDetails`, which asserts and closes it). */
export async function openDrawer(frame: Frame, objectName: string): Promise<void> {
  const row = frame.locator(".TableRow", { hasText: objectName }).first();

  await row.waitFor({ state: "visible", timeout: 60_000 });
  await row.locator(".TableCell", { hasText: objectName }).first().click();
  await frame.waitForSelector(".Drawer.KubeObjectDetails", { state: "visible", timeout: 60_000 });
}

/** A `DrawerItem` row of the open detail drawer: label, rendered text, and the href of its link if it has one. */
export interface DrawerRow {
  label: string;
  text: string;
  href: string | null;
}

/** Reads every `DrawerItem` row of the currently open detail drawer. */
export async function inspectDrawerRows(frame: Frame): Promise<DrawerRow[]> {
  return frame.$$eval(".Drawer.KubeObjectDetails .DrawerItem", (elements) =>
    elements.map((element) => {
      const label = element.querySelector(".name")?.textContent?.trim() ?? "";
      const valueElement = element.querySelector(".value");
      // Only the first link of a row is inspected: DrawerItem rows with
      // several object references (e.g. a badge list) are a known MVP gap,
      // see "Notes and deviations" in SPEC-0006.
      const link = valueElement?.querySelector("a[href]") ?? null;

      return {
        label,
        text: (valueElement?.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: link ? link.getAttribute("href") : null,
      };
    }),
  );
}

// Field labels that typically hold a cross-reference to another object.
// Deliberately broad: a false positive only adds a line to "for human
// judgment" in the report, a false negative would silently hide a real
// DESIGN.md violation (a dead reference rendered as plain text).
const REFERENCE_LABEL_PATTERN =
  /node|namespace|guest|image|kernel|class|pool|snapshot|schedule|profile|restore|migration|pod|service|secret|configmap|pvc|owner|source|target|cluster/i;

export interface ReferenceAssertResult {
  /** Rows whose value is a link: what DESIGN.md requires for object references. */
  links: DrawerRow[];
  /** Rows whose label looks like a reference but whose value is plain text: DESIGN.md allows this only when the target does not exist, which needs a human to confirm. */
  possibleUnlinkedReferences: DrawerRow[];
}

/** Splits drawer rows into links (compliant) and possible unlinked references (need human confirmation). */
export function classifyDrawerReferences(rows: DrawerRow[]): ReferenceAssertResult {
  const links = rows.filter((row) => row.href);
  const possibleUnlinkedReferences = rows.filter(
    (row) => !row.href && row.text && row.text !== "N/A" && row.text !== "-" && REFERENCE_LABEL_PATTERN.test(row.label),
  );

  return { links, possibleUnlinkedReferences };
}

export interface LinkCheckResult extends DrawerRow {
  ok: boolean;
  note?: string;
}

// The extension's own error-page component (src/renderer/components/error-page.tsx)
// renders this class (CSS-module hashed by Vite, "_errorPage_<hash>" - not
// Freelens core's webpack "*-module__*--<hash>" pattern).
const ERROR_PAGE_SELECTOR = '[class*="_errorPage_"]';

/**
 * Clicks a drawer link found by `inspectDrawerRows`/`classifyDrawerReferences`
 * and checks that it landed on real content, then calls `reopen` to bring the
 * caller back to a known state (the original view and drawer) so the next
 * link can be checked the same way.
 *
 * Freelens renders every object reference (ours or a core kind, e.g. the
 * Node or Pod a SwiftGuest names) the same way: the href only changes the
 * `kube-details` query parameter, which opens that object's own
 * `.Drawer.KubeObjectDetails` on top of the current page. So the check here
 * is deliberately positive (did a real, non-empty drawer appear) rather than
 * a search for negative-sounding text, which risks matching a core object's
 * own legitimate field values (a Pod's status message, for example) instead
 * of an actual failure. The one thing this pass can name for certain as
 * "wrong" is our own extension's error-page component
 * (src/renderer/components/error-page.tsx, matched by ERROR_PAGE_SELECTOR
 * below); an empty or missing drawer otherwise is reported too, but more
 * cautiously, since it could also mean the click did not navigate at all.
 */
export async function checkDrawerLink(
  frame: Frame,
  view: string,
  row: DrawerRow,
  reopen: () => Promise<void>,
): Promise<LinkCheckResult> {
  if (!row.href) {
    return { ...row, ok: false, note: "no href to check" };
  }

  try {
    await frame.click(`a[href="${row.href}"]`, { timeout: 15_000 });
    await frame.waitForTimeout(1000);

    const errorPage = await frame.$(ERROR_PAGE_SELECTOR);

    if (errorPage) {
      await screenshotView(frame, view, `link-error-${slugify(row.text)}`);

      return { ...row, ok: false, note: "the extension's own error page appeared after clicking the link" };
    }

    const drawer = frame.locator(".Drawer.KubeObjectDetails").first();
    const drawerVisible = await drawer.isVisible().catch(() => false);
    const drawerText = drawerVisible ? (await drawer.innerText().catch(() => "")).trim() : "";

    if (!drawerVisible || drawerText.length === 0) {
      await screenshotView(frame, view, `link-error-${slugify(row.text)}`);

      return { ...row, ok: false, note: "no detail drawer content appeared after clicking the link" };
    }

    return { ...row, ok: true };
  } catch (error) {
    return { ...row, ok: false, note: `click failed: ${String(error)}` };
  } finally {
    await reopen();
  }
}

function slugify(text: string): string {
  return text.replace(/[^a-zA-Z0-9-]+/g, "-");
}

/** Section titles (`.DrawerTitle`) of the open drawer that read "Conditions", case-insensitively - DESIGN.md gap 5 asks whether this ever duplicates the host's own conditions table. */
export async function conditionsSectionTitles(frame: Frame): Promise<string[]> {
  const titles = await frame.$$eval(".Drawer.KubeObjectDetails .DrawerTitle", (elements) =>
    elements.map((element) => element.textContent?.trim() ?? ""),
  );

  return titles.filter((title) => title.toLowerCase() === "conditions");
}

/** Header cell labels (`.TableHead .TableCell`) missing the `id` DESIGN.md requires for column resizing. */
export async function headerCellsWithoutId(frame: Frame): Promise<string[]> {
  const cells = await frame.$$eval(".TableHead .TableCell", (elements) =>
    elements
      .filter((element) => !element.classList.contains("checkbox") && !element.classList.contains("menu"))
      .map((element) => ({
        id: element.id,
        label: element.querySelector(".content")?.textContent?.trim() || element.textContent?.trim() || "",
      })),
  );

  return cells.filter((cell) => !cell.id).map((cell) => cell.label);
}

// Byte-like quantities must be humanized (DESIGN.md): a run of more than 4
// digits that stands alone as its own token - not embedded in a larger
// identifier - is a value that likely was not passed through a humanizer.
// The lookaround requires an identifier boundary on both sides (not a
// letter, digit, hyphen, underscore or dot), which is stricter than a plain
// `\b`: a hyphen or dot is not a `\w` character, so `\b` alone would still
// treat the digits on either side of one as a standalone "word" even though
// they read as part of the same token. This keeps catching bare raw byte
// counts (a host printer column's "22548578304") and hex digests (still
// broken up by letters, as before), while no longer flagging a digit run
// that is part of a generated identifier, such as the Unix-style suffix in
// SwiftSnapshotSchedule's CronJob-style snapshot names
// ("e2e-schedule-nightly-28160520": the hyphen right before the digits
// means the run is not a standalone token).
const RAW_DIGIT_RUN_PATTERN = /(?<![A-Za-z0-9_.-])\d{5,}(?![A-Za-z0-9_.-])/g;

/** Raw digit runs of more than 4 digits found in `text`, deduplicated. */
export function nonHumanizedByteValues(text: string): string[] {
  const matches = text.match(RAW_DIGIT_RUN_PATTERN) ?? [];

  return [...new Set(matches)];
}

// Every CR drawer also carries Freelens core's own generic detail item
// (`custom-resource-detail-item`, `orderNumber: 100`, `NonInjectedCustomResourceDetails`
// in `@freelensapp/core`), which renders a `<div class="CustomResourceDetails ...">`
// wrapper with one `DrawerItem` per CRD `additionalPrinterColumns` entry, read
// with `safeJSONPathValue` and rendered verbatim - it has no way to know a
// given column is a byte count, so it never humanizes one. When a CRD
// publishes a raw byte count as a printer column (SwiftSnapshot's `SIZE`, for
// example), this host section shows it unhumanized, and this extension has no
// hook to change that rendering. See "Notes and deviations" in SPEC-0006.
const HOST_GENERIC_CR_SECTION_SELECTOR = ".CustomResourceDetails";

/**
 * Text content of the open detail drawer, excluding Freelens core's generic
 * `.CustomResourceDetails` printer-column section (see
 * `HOST_GENERIC_CR_SECTION_SELECTOR` above). Walks text nodes directly
 * instead of cloning the subtree, so it does not depend on the clone being
 * laid out (a detached clone's `innerText` is unreliable across browsers).
 * Used by the byte-humanization assert, which only holds the extension
 * responsible for what it renders itself.
 */
export async function extensionDrawerText(frame: Frame): Promise<string> {
  return frame.$eval(
    ".Drawer.KubeObjectDetails",
    (root, hostSectionSelector) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest(hostSectionSelector) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
      });

      const parts: string[] = [];

      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        parts.push(node.textContent ?? "");
      }

      return parts.join(" ");
    },
    HOST_GENERIC_CR_SECTION_SELECTOR,
  );
}

export interface ViewAssertResults {
  headerMissingIds: string[];
  links: LinkCheckResult[];
  possibleUnlinkedReferences: DrawerRow[];
  conditionsSectionCount: number;
  nonHumanizedListValues: string[];
  nonHumanizedDrawerValues: string[];
}

export interface ViewScreenshot {
  theme: Theme;
  kind: "list" | "drawer";
  path: string | undefined;
}

export interface ViewReport {
  menuId: string;
  title: string;
  fixtureObject: string;
  screenshots: ViewScreenshot[];
  asserts: ViewAssertResults;
}

function assertLine(label: string, pass: boolean, detail?: string): string {
  return `- ${label}: ${pass ? "PASS" : "FAIL"}${!pass && detail ? ` - ${detail}` : ""}`;
}

/** Renders the markdown report: one section per view (screenshots, DOM assert results, for-human-judgment list). */
export function renderReport(views: ViewReport[], generatedAt = new Date()): string {
  const lines: string[] = [
    "# Pre-review agent pass report",
    "",
    `Generated ${generatedAt.toISOString()} by \`pnpm pre-review\`.`,
    "",
    "See [SPEC-0006](../../docs/specs/SPEC-0006-pre-review-agent-pass.md) for what this pass covers, and " +
      "[DESIGN.md](../../docs/development/DESIGN.md) for the rules behind each assert. Every FAIL below is a " +
      "candidate for a permanent E2E non-regression test once confirmed as a real bug (SPEC-0006 scope item 5).",
    "",
    'The "Byte-like values are humanized" assert only scans this extension\'s own drawer content: it excludes ' +
      "Freelens core's generic `.CustomResourceDetails` printer-column section (host printer column, upstream " +
      "CRD defines raw bytes - out of extension control), present in every CR drawer regardless of what an " +
      "extension registers. A CRD that publishes a raw byte count as a printer column (SwiftSnapshot's `SIZE`, " +
      'for example) always shows it unhumanized there; see "Notes and deviations" in SPEC-0006.',
    "",
  ];

  for (const view of views) {
    lines.push(`## ${view.title} (\`${view.menuId}\`)`, "");

    lines.push("### Screenshots", "");
    for (const shot of view.screenshots) {
      if (!shot.path) {
        lines.push(`- ${shot.theme} ${shot.kind}: screenshot failed`);
        continue;
      }

      const relativePath = path.relative(ARTIFACTS_DIR, shot.path);

      lines.push(`- ${shot.theme} ${shot.kind}: [${relativePath}](${relativePath})`);
    }
    lines.push("");

    lines.push("### DOM asserts", "");

    lines.push(
      assertLine(
        "Every list header cell has an id",
        view.asserts.headerMissingIds.length === 0,
        `missing on: ${view.asserts.headerMissingIds.join(", ")}`,
      ),
    );

    if (view.asserts.links.length === 0) {
      lines.push("- Drawer object references are links: no links found in this drawer");
    } else {
      const failing = view.asserts.links.filter((link) => !link.ok);

      lines.push(
        assertLine(
          `Drawer object references are links (${view.asserts.links.length} found) and load without an error`,
          failing.length === 0,
          failing.map((link) => `"${link.text}" -> ${link.href} (${link.note})`).join("; "),
        ),
      );
      for (const link of view.asserts.links) {
        lines.push(
          `  - ${link.ok ? "ok" : "FAIL"}: "${link.text}" -> \`${link.href}\`${link.note ? ` (${link.note})` : ""}`,
        );
      }
    }
    lines.push("");

    lines.push(
      assertLine(
        "No duplicated Conditions section in the drawer",
        view.asserts.conditionsSectionCount <= 1,
        `found ${view.asserts.conditionsSectionCount} sections titled "Conditions"`,
      ),
    );

    const nonHumanized = [...view.asserts.nonHumanizedListValues, ...view.asserts.nonHumanizedDrawerValues];

    lines.push(
      assertLine(
        "Byte-like values are humanized (no raw digit run above 4 digits)",
        nonHumanized.length === 0,
        `list: ${view.asserts.nonHumanizedListValues.join(", ") || "none"}; drawer: ${view.asserts.nonHumanizedDrawerValues.join(", ") || "none"}`,
      ),
    );
    lines.push("");

    lines.push("### For human judgment", "");

    const judgment = view.asserts.possibleUnlinkedReferences.map(
      (row) => `Confirm "${row.label}: ${row.text}" really has no link target (rendered as plain text).`,
    );

    judgment.push("Visual balance, spacing and wording in both themes (see the screenshots above).");

    for (const item of judgment) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Writes the report to `<ARTIFACTS_DIR>/REPORT.md` and returns its path. */
export async function writeReport(views: ViewReport[]): Promise<string> {
  const file = path.join(ARTIFACTS_DIR, "REPORT.md");

  await mkdir(ARTIFACTS_DIR, { recursive: true });
  await writeFile(file, renderReport(views), "utf8");

  return file;
}

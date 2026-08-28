# SPEC-0006: Pre-review agent pass

- **Status:** Implemented
- **Milestone:** Cross-cutting (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12`
- **Author / date:** Roberto Bandini with Claude / 2026-08-28
- **Tracking issue:** #28 (part of the #29 retrofit)

## Goal

Before every human milestone review session, an agent verifies everything
that can be verified about the UI against a real Freelens: every view and
every drawer, in both themes, with DOM-level checks of the statically
checkable DESIGN.md rules. The human session then covers only judgment
calls and what cannot be automated. Standing rule behind this spec
(Roberto, 2026-08-28): the agent tests everything testable first, and
every check that can be codified becomes a permanent E2E non-regression
test - nothing is verified only once.

## Upstream reference

None (process/infrastructure feature). Builds on the E2E infrastructure
of [SPEC-0003](SPEC-0003-e2e-infrastructure.md) and the demo cluster of
[SPEC-0005](SPEC-0005-local-demo-cluster.md). Motivated by the findings
of the first review session (2026-08-28): 4 of its 5 findings were
automatable (#23 dead links, #26 reference rendered as text, #27 missing
column ids, #25 unreadable blobs).

## Scope

Included:

1. **Local harness**: a documented, repeatable way to run the Playwright
   harness against a locally built Freelens on the developer machine
   (today only CI has the `./freelens` checkout and build). The checkout
   lives in `./freelens` (already gitignored), pinned to the Freelens
   version in the E2E workflow matrix; TRY-IT.md gains a section on
   preparing it.
2. **The pass itself** (`pnpm pre-review`): drives the built Freelens
   with Playwright against the demo (or E2E) cluster and, for every
   registered KubeSwift view: opens the list page, screenshots it in the
   dark theme, opens one detail drawer per fixture object and screenshots
   it, switches to the light theme and repeats, and runs the DOM asserts
   below. Artifacts land in `e2e-artifacts/pre-review/` with a summary
   report (markdown) listing what passed, what failed, and what is left
   to human judgment.
3. **DOM asserts** (the statically checkable DESIGN.md rules):
   - every object reference in a drawer is rendered as a link, or as
     plain text only when the target does not exist (never a link that
     errors);
   - clicking every rendered link navigates without a load error;
   - byte quantities are humanized, never raw digit runs above 4 digits;
   - every list header cell carries an `id` (resizing enabled);
   - inline blob editors are at least N lines tall and use the host
     theme colors;
   - empty states: with a namespace filter that matches nothing, the
     list shows the host empty state, not a blank area.
4. **Report as gate precondition**: PROCESS.md's milestone review gate
   requires the pass report before the human session; TESTING.md gains
   the pass as a layer, replacing the looser "agent-driven testing"
   wording.
5. **Consolidation**: every assert of the pass that proves stable
   graduates into `e2e/__tests__/` as a permanent non-regression test in
   the same PR that stabilizes it.

Excluded:

- Aesthetic judgment (spacing, wording, visual balance): stays human.
- Platforms other than the developer machine and CI (the Windows/Linux
  look stays in the human session when relevant).
- Real KVM behavior (manual-only area, unchanged).

## Design

- New Playwright suite `e2e/__tests__/pre-review.tests.ts` (or a script
  under `e2e/scripts/pre-review.sh` orchestrating it), reusing the
  SPEC-0003 helpers: extension install flow, cluster connect, sidebar and
  table helpers. Theme switching goes through the Freelens preferences
  page. The suite enumerates the views from the same registration data
  the extension uses (single source of truth) rather than a hardcoded
  list, so new views are covered automatically.
- The report generator writes `e2e-artifacts/pre-review/REPORT.md` with
  one section per view: screenshots (both themes), assert results, and
  an explicit "for human judgment" list.
- `pnpm pre-review` wires cluster-up (demo), the suite, and the report.

## Tests (non-regression list)

- The pass IS a test layer; its stable asserts graduate to the E2E suite
  (scope item 5). The suite must stay green in CI on every PR.
- Unit: report generator formatting, if implemented as a module.
- Manual verification: Roberto receives and reads the first REPORT.md and
  confirms it lets him skip the procedural walkthrough. Recorded result:
  pending.

## Notes and deviations

First implementation pass (2026-08-28), covering scope items 2 and 3 (the
pass itself and its DOM asserts) plus a macOS-specific fix the pass
uncovered a need for. Item 1 (documenting the local harness setup in
TRY-IT.md), item 4 (wiring the report into the PROCESS.md gate and
TESTING.md wording) and item 5 (graduating stable asserts into the E2E
suite) are left for a follow-up: PROCESS.md already names this spec as a
precondition of the milestone review gate, but TRY-IT.md does not yet walk
through preparing `./freelens` on a developer machine, and none of the
asserts below have been promoted to `e2e/__tests__/kubeswift-e2e.tests.ts`
yet - they should stay exploratory in the pre-review pass until a milestone
review confirms which failures are real regressions worth locking in
permanently, per the standing rule in this spec's Goal.

**macOS install failure, diagnosed while preparing the local harness.**
Before this pass could be written, `pnpm e2e` was run locally on macOS (arm)
for the first time and all 11 tests failed identically in `beforeAll`, at
`installExtension` (30s timeout waiting for the installed-extension row,
after the tgz path was filled and Install was clicked). The suite was
green in CI (ubuntu-24.04-arm) throughout. Root-caused as follows:

- The macOS-specific hypotheses were ruled out first: `app.applicationMenu`
  on darwin does expose a top-level `"mac"` item whose submenu has
  `"navigate-to-extensions"`, identical in effect to the `"file"` item used
  on other platforms (verified by dumping `menu.items` and their submenu
  ids from a real launch, and by two clean reproductions of the full
  `run-suite.sh` afterwards). The install form, the Install button, and the
  installed-extension row all use the same selectors and the same code path
  on every platform - nothing in Freelens' own source branches on
  `process.platform` in this flow beyond the menu id already handled.
- Freelens' own install pipeline
  (`unpack-extension.injectable.tsx` in the `freelensapp/freelens` checkout)
  waits at most 10 seconds for the extension loader to notice the unpacked
  files before giving up and showing an error notification instead of
  adding the row our helper polls for - a much tighter budget than our
  outer 30s wait, so anything that pushes unpack-plus-detection past 10s
  can surface as our 30s timeout instead of a visible error.
  A standalone reproduction script (outside the test framework, with a
  screenshot and a DOM dump after every step) completed the same install in
  about 5 seconds on the same machine, both in isolation and inside the
  real suite, every time after the first run. The most consistent
  explanation left is a one-time, environment-level delay on the very first
  launch of a freshly built, unsigned/ad-hoc-signed `Freelens.app` bundle
  and the files it unpacks (macOS Gatekeeper/XProtect's first-run scan is
  the standard culprit for exactly this symptom on a cold cache), not
  something reproducible on demand once that cache is warm.
- Fix applied in `integration/helpers/kubeswift-extension.ts`
  (`installExtension`): the wait for each install milestone (the form
  appearing, the Install button, the installed row, the enabled row) was
  made generous and explicit (90s, `INSTALL_TIMEOUT`) and kept identical on
  every platform rather than special-cased for macOS - the fix is about
  tolerating a slow-but-eventually-successful install, not about a
  platform-specific code path, since none was found. On any failure the
  helper now screenshots the window (`captureWindowScreenshot`, into
  `E2E_ARTIFACTS_DIR`) and reports every visible notification, so a future
  stuck install is never a blind timeout again. Verified with two full
  `run-suite.sh` runs (11/11 passing, ~21-23s) and one full `pnpm e2e`
  (cluster up, suite, cluster down; 11/11 passing, 21.4s), all on the same
  macOS machine that produced the original failure.

**Pre-review pass implementation choices:**

- **View list is a hand-maintained constant, not read from
  `src/renderer/index.tsx`.** That file is JSX bundled for the renderer
  process and is not reachable from the Node/Playwright context that
  drives a *built* Freelens (the suite runs inside a checkout of
  `freelensapp/freelens`, against the packed extension tarball). Per the
  MVP allowance in this spec's Design section, the list lives once in
  `integration/helpers/kubeswift-views.ts` (menu id, page title, one
  fixture object name per view) and is used by the suite only; keeping it
  in sync with `index.tsx`'s `clusterPages`/`clusterPageMenus` is a manual
  step for now. Closing this gap for real (e.g. a small JSON manifest of
  registered views emitted by `pnpm build`, read by both) is left as
  follow-up work.
- **Theme is switched twice total, not per view.** The scope text describes
  dark screenshots, then light screenshots, for every view. Toggling the
  theme after each of the 10 views (20 preferences round-trips) was
  measured as materially slower with no offsetting benefit, since the DOM
  asserts are structural (header ids, link hrefs, byte-formatted text,
  section titles) and do not depend on the theme. Implemented instead as:
  all 10 views in the dark theme first (screenshots plus every assert),
  then the theme switched once to light, then all 10 views again
  (screenshots only). The theme is switched through
  `Renderer` preferences exactly as a human would (`app`-tab, the
  `#theme-input` select, "Dark"/"Light"), and a connected cluster's iframe
  was confirmed to survive the round trip without losing its route or
  drawer state (`close-preferences` calls `history.goBack()`, which does
  not reload the cluster frame).
- **Drawer link verification is a positive check, not a text search.**
  The first pass flagged several Node/Pod reference links (via the
  generic `?kube-details=` overlay mechanism Freelens uses for every
  object reference, ours or a core kind) as errors, based on a search for
  text like "not found" or "failed to load" anywhere on the page. That
  regressed to false positives: a core Node/Pod's own, entirely normal
  field values can contain similar wording. The check now instead clicks
  the link and requires a non-empty `.Drawer.KubeObjectDetails` to appear,
  plus a specific check for the extension's own error-page marker
  (`_errorPage_...`, the Vite-hashed class of
  `src/renderer/components/error-page.tsx` - not Freelens core's
  webpack-hashed pattern, which looks different). Re-running the full pass
  after this fix moved every drawer-link assert from FAIL to PASS across
  all views that have links, which matches every fixture reference
  actually resolving; a screenshot is still taken on failure
  (`link-error-<slug>.png`) for whichever case trips this next.
- **Byte-humanization regex** flags digit runs of 5+ with a word boundary
  on both sides (`/\b\d{5,}\b/g`), so it does not misfire on IPs, dates,
  4-digit counters, or hex digests (letters break the boundary inside a
  digest). First run found real violations: `SwiftImage` and
  `SwiftSnapshot` show a raw byte count in their drawers (`10737418240`,
  `22548578304`) and `SwiftSnapshotSchedule` shows a raw Unix-style
  revision suffix (`28160520`, from the CronJob-style generated name, a
  false positive worth a follow-up look since it is not a byte value at
  all - the assert is about digit runs, not specifically about the field
  being byte-shaped).
- **"Possible unlinked reference" is a broad heuristic**, matching any
  `DrawerItem` label against a word list (node, namespace, guest, image,
  kernel, class, pool, snapshot, schedule, profile, restore, migration,
  pod, service, secret, configmap, pvc, owner, source, target, cluster)
  when the value has no link. It over-reports by design (every plain-text
  field whose label merely contains one of those words lands in "for human
  judgment", for example "Guest Class" or "Resume After Snapshot"): a false
  positive costs one extra line in the report, a false negative would hide
  a real DESIGN.md violation silently. The first report needs a human to
  separate genuine unlinked references (there are some real ones, e.g.
  `SwiftGuestPool`'s "Guest Class"/"Image" fields) from incidental label
  matches.
- Only the first `<a>` inside a `DrawerItem`'s `.value` is inspected; rows
  with more than one reference (e.g. a badge list) are not fully covered.
  Not observed in the M1/M2 fixtures used so far.
- First full run: 10/10 views captured, both themes, 40 screenshots plus
  `REPORT.md` in ~55s end to end (cluster already warm). Header-cell ids
  are FAIL on all 10 views (`DESIGN.md` section 1's resizing requirement -
  matches this spec's motivating finding #27, not a regression introduced
  here). Conditions-section duplication is PASS on all 10 (no view found
  with two "Conditions" titled sections in the same drawer, answering this
  spec's motivating DESIGN.md gap 5 question, at least for the fixtures
  exercised so far). Manual verification with Roberto (this spec's "Tests"
  section) is still pending - his review of the first `REPORT.md` was not
  part of this implementation pass.

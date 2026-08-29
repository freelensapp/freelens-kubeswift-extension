# Testing strategy

Every feature ships with tests at every layer that applies. A feature
without its non-regression tests is not done (see
[PROCESS.md](PROCESS.md)).

## Layers

### 1. Unit tests (vitest, `pnpm test:unit`)

- Every CRD model: construction from a realistic fixture object, helpers
  (phase, refs, derived values), edge cases (empty refs, missing status).
- Every pure helper and every component with logic worth isolating.
- Fixtures are hand-written from the CRD schemas, never copied from
  KubeSwift code or docs verbatim.

### 2. Integration tests (existing harness, `integration/`)

The harness downloads a real Freelens, installs the built extension, and
drives it (`integration/__tests__/extensions.tests.ts`: the extension
installs, is listed as enabled, and activates without errors). Keep it green
on every PR.

Both this suite and the E2E one run **inside a checkout of
`freelensapp/freelens`**: their files are copied next to the Freelens ones,
under `integration/__tests__` and `integration/helpers`, and are run by the
Freelens `test:integration` script, which owns the Playwright/Electron launch
helpers (`../helpers/utils`). That is why relative imports of `../helpers/*`
resolve when the tests run but not inside this repository, and why
`integration/` is outside the `tsconfig.json` include list.

`integration/helpers/` holds what the two suites share: the error collector,
the extension install flow, and the cluster, sidebar and table helpers.

### 3. E2E tests (Playwright, against a kind cluster)

A disposable `kind` cluster with the KubeSwift CRDs applied and **fake
resources with simulated statuses** written by our fixtures (no KVM, no real
VMs), driven through a real Freelens by Playwright's Electron API.

#### Prerequisites

- A running Docker daemon, plus `kind` and `kubectl` on `PATH`.
- A checkout of `freelensapp/freelens` in `./freelens` (gitignored), with the
  app already built (`pnpm build` and the electron-builder step, as in
  `.github/workflows/e2e-tests.yaml`). Point `FREELENS_DIR` elsewhere to use
  another checkout.

#### Commands

| Command | What it does |
| --- | --- |
| `pnpm e2e:cluster:up` | Creates the cluster, applies the CRDs, the fixtures and their statuses |
| `pnpm e2e:cluster:down` | Deletes the cluster and its kubeconfig |
| `pnpm e2e` | Cluster up, run the suite, cluster down |

`E2E_KEEP_CLUSTER=1 pnpm e2e` leaves the cluster running for inspection.
`pnpm e2e:cluster:up` is idempotent, so it doubles as "re-apply the fixtures".

#### Layout

- `e2e/scripts/` — cluster lifecycle. `lib.sh` is the single place where the
  KubeSwift version, the kind and Kubernetes versions, the cluster name and
  the kubeconfig path are pinned.
- `e2e/fixtures/` — hand-written custom resources for the six M1 and the four
  M2 CRDs, in numbered files applied together. `fixtures/status/` holds the
  merge patches applied to the status subresources with `kubectl patch
  --subresource=status`, since no KubeSwift controller runs in the cluster.
  Each pair of fixtures is chosen to cover a state its views distinguish, so
  the suite can assert both branches (a Ready snapshot and an uploading one, a
  finished migration and one mid transfer, and so on).
- `e2e/__tests__/kubeswift-e2e.tests.ts` — the suite: it installs the packed
  extension, connects the cluster, points the namespace filter at the fixture
  namespace, then opens every KubeSwift page and asserts the fixture rows and
  one detail panel per CRD.

A freshly connected cluster shows the `default` namespace only, not all of
them, so the suite moves the namespace filter once after connecting.
Otherwise every namespaced list looks empty while cluster-scoped ones (the
SwiftGuestClasses page) still fill, which is the signature of that mistake.

When an assertion fails the suite screenshots the window into
`e2e-artifacts/` and reports the rows, or the sidebar test ids, it did find.
CI uploads that directory as an artifact when the job fails.

The CRDs are fetched from `kubeswift-io/kubeswift` at the pinned tag when the
cluster is created. Nothing from KubeSwift is vendored into this repository
(it is AGPL-3.0, this extension is MIT — see
[ARCHITECTURE.md](ARCHITECTURE.md)).

#### What the suite never touches

- The developer's `~/.kube/config`: `kind` writes to a dedicated kubeconfig
  under `.e2e/`, and the suite copies it into the sandboxed Freelens user data
  directory (`<FREELENS_INTEGRATION_TESTING_DIR>/Freelens/kubeconfigs`), which
  Freelens always watches. Freelens resolves `~/.kube` through
  `os.userInfo().homedir`, which ignores `$HOME`, so a sandboxed HOME would
  not have been enough.
- The Freelens checkout's own tests: our files are copied in under their own
  names and selected by name when the runner starts.

Runs in CI on every PR through `.github/workflows/e2e-tests.yaml`.

### 4. Agent-driven testing during development, and the pre-review pass

While developing, coding agents must verify their UI changes live, not just
by compiling: launch Freelens with the extension and the kind fixture
cluster, then drive it with Playwright to inspect the rendered pages
(assert the list shows the fixture guests, open the detail panel, screenshot
for the PR). Findings go into the PR description.

Before every human milestone review session, the same machinery runs as the
**pre-review agent pass** (`pnpm pre-review`, see
[SPEC-0006](../specs/SPEC-0006-pre-review-agent-pass.md)): every view and
every drawer, both themes, screenshots plus DOM asserts of the statically
checkable [DESIGN.md](DESIGN.md) rules, with a report handed to the
reviewer. The human session covers only judgment calls and what cannot be
automated (rule set by Roberto on 2026-08-28, after the first review
session found that 4 of its 5 findings were automatable).

Nothing is verified only once: every check of the pass that can be
codified graduates into the E2E suite (layer 3) as a permanent
non-regression test. Exploratory verification is allowed to stay
exploratory only until it stabilizes.

## Non-regression policy

- Each spec lists its regression tests by name (test file + case).
- CI runs all layers on every PR; a red layer blocks merge.
- When a bug is found (by CI, manual testing, or in the field), the fix PR
  must add a test that fails without the fix. No silent fixes.
- A test weakened to tolerate an unexplained difference (a platform, a
  timing, a runner) carries that tolerance only until the difference is
  explained. Once the cause is found and fixed, the tolerance is removed in
  the follow-up, or the weakened assert silently becomes the contract. The
  E2E drawer-link check is the worked example: it accepted a reference row
  that stayed plain text while the packed Linux build's behavior was a
  mystery (issue #38), and stopped accepting it the moment the cause was
  understood.

## Manual testing

What cannot be automated is escalated to Roberto following the protocol in
[PROCESS.md](PROCESS.md) ("Manual testing escalation"), and its outcome is
recorded in the spec. Current known manual-only areas: behavior against a
real KVM cluster with running VMs, GPU views with real hardware, console
interaction latency, and the overall look and feel inside a real Freelens
on Windows, Linux, and macOS (agents verify rendering via Playwright
screenshots, not the lived experience).

In addition to ad-hoc escalations, every milestone ends with a structured
manual review session in a real Freelens: see "Milestone manual review
gate" in [PROCESS.md](PROCESS.md) and the procedure in
[TRY-IT.md](TRY-IT.md) (`pnpm demo:up`).

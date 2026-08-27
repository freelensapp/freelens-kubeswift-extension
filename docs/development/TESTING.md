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

The scaffold's harness downloads a real Freelens, installs the built
extension, and drives it. Keep it green on every PR; extend it when a
feature adds a new page (page opens, list renders).

### 3. E2E tests (Playwright, against a kind cluster)

Planned infrastructure (prerequisite for completing M1):

- A `kind` cluster with the KubeSwift CRDs applied and **fake resources
  with simulated statuses** written by our fixtures (no KVM, no real VMs).
  The CRDs are applied from the upstream repo at a pinned version at test
  runtime; the YAML is not vendored into this repository.
  Hypothesis to confirm with William Rizzo: statuses are fully simulable
  because the CRDs do not prune unknown status fields (initial check on
  SwiftGuest suggests yes; verify per CRD).
- Playwright drives the real Freelens (Electron) with the extension
  installed against that cluster: navigation, list contents, detail
  panels, actions (from M6 on).
- Runs in CI on Linux runners; also runnable locally.

### 4. Agent-driven testing during development (Playwright MCP)

While developing, coding agents must verify their UI changes live, not just
by compiling: launch Freelens with the extension and the kind fixture
cluster, then use the Playwright MCP server to inspect the rendered pages
(assert the list shows the fixture guests, open the detail panel, screenshot
for the PR). Findings go into the PR description. This is exploratory
verification; the durable guarantees belong in layers 1-3.

## Non-regression policy

- Each spec lists its regression tests by name (test file + case).
- CI runs all layers on every PR; a red layer blocks merge.
- When a bug is found (by CI, manual testing, or in the field), the fix PR
  must add a test that fails without the fix. No silent fixes.

## Manual testing

What cannot be automated is escalated to Roberto following the protocol in
[PROCESS.md](PROCESS.md) ("Manual testing escalation"), and its outcome is
recorded in the spec. Current known manual-only areas: behavior against a
real KVM cluster with running VMs, GPU views with real hardware, console
interaction latency.

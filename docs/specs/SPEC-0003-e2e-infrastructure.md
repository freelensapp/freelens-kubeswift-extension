# SPEC-0003: E2E test infrastructure (kind + fixtures + Playwright)

- **Status:** Approved (Roberto's standing go-ahead for M1; formal review in
  the implementation PR)
- **Milestone:** M1 (closing item)
- **KubeSwift version reviewed:** v0.13.12
- **Author / date:** Claude with Roberto, 2026-08-27

## Goal

CI (and any developer machine) can start a disposable Kubernetes cluster
with the KubeSwift CRDs and realistic fake resources, launch the real
Freelens with the built extension connected to that cluster, and assert
through Playwright that the KubeSwift pages show the fixture data. This is
the non-regression backbone every view spec plugs into, and what closes M1.

## Upstream reference

None visual. Prior art to study (all ours, MIT): the existing
`integration/` harness in this repo (already drives Freelens through
Playwright's Electron API) and the integration tests of
`freelensapp/freelens` (cluster connection flows). KubeSwift enters only as
CRD YAML applied at a pinned version, fetched at test runtime, never
vendored.

## Scope

Included: kind-based cluster provisioning scripts; fixture manifests for
the six M1 CRDs with injected statuses; a Playwright E2E suite (launch,
connect cluster, per-page assertions for list rows and one detail panel per
CRD); a CI workflow running the suite on Linux against Freelens v1.10.3;
documentation of how to run it locally.

Excluded: testing against real KubeSwift controllers or KVM (manual-only
area); actions (M6); performance testing.

## Design

- **Cluster:** `kind` with a dedicated cluster name and kubeconfig file
  (never touching the developer's default kubeconfig). pnpm scripts:
  `e2e:cluster:up`, `e2e:cluster:down`, `e2e` (up, run suite, down).
- **CRDs:** applied from
  `https://raw.githubusercontent.com/kubeswift-io/kubeswift/<PINNED>/config/crd/bases/`,
  with the pin (`v0.13.12` initially) in one place. Nothing vendored.
- **Fixtures:** hand-written CRs of ours under `e2e/fixtures/` for
  SwiftGuest, SwiftGuestClass, SwiftGuestPool, SwiftImage,
  SwiftSeedProfile, SwiftKernel, covering the states the views
  distinguish (e.g. a Running guest with IP and a Pending one without).
  Statuses are injected with
  `kubectl apply/patch --subresource=status` after creation, since no
  controller runs in the cluster. Working hypothesis to confirm here, per
  CRD: the schemas accept arbitrary status writes (still to be confirmed
  against a real KubeSwift installation for edge cases; record findings below).
- **Suite:** `e2e/` Playwright tests reusing the launch utilities of the
  existing `integration/` harness (extracted into a shared helper if
  needed). Freelens runs with an isolated `HOME` and the kind kubeconfig
  placed where Freelens picks it up; the test connects to the cluster from
  the catalog, opens the KubeSwift sidebar group, and asserts per page:
  the fixture rows (name + one significant column each) and, for one
  object per CRD, the detail panel content.
- **CI:** a new `e2e-tests.yaml` workflow, `ubuntu-24.04-arm` if kind and
  the Freelens build work there, otherwise `ubuntu-24.04` (record the
  choice and why). Freelens version matrix aligned with the integration
  workflow (v1.10.3).
- **Local run:** documented in TESTING.md (prerequisites: docker + kind).

## Tests (non-regression list)

This spec IS test infrastructure. Its own acceptance:

- `pnpm e2e` green locally and in CI, with per-CRD assertions for all six
  M1 views.
- The suite fails when a fixture row is absent (verified once by mutating
  a fixture in a scratch run, not committed).
- SPEC-0001 and SPEC-0002 gain their E2E bullet points referencing the
  actual test cases (updated in this PR).
- Manual verification: if catalog connection automation proves flaky in
  CI, escalate to Roberto per PROCESS.md before merging workarounds.

## Notes and deviations

### Status injection: the hypothesis, per CRD

Confirmed on a real cluster (kind, KubeSwift CRDs at v0.13.12). The
hypothesis as worded above is **wrong in its reason and right in its
conclusion**: the schemas do prune unknown status fields, but every field the
M1 views read is declared in them, so every status those views need can be
injected.

| CRD | Status subresource | Injection | Outcome |
| --- | --- | --- | --- |
| SwiftGuest | yes | `kubectl patch --subresource=status` | Works. `phase`, `nodeName`, `restartCount`, `lastRestartTime`, `network` (`primaryIP`, `interfaces`, `exposedPorts`, `serviceRef`), `runtime`, `storage`, `podRef`, `console` and `conditions` all read back unchanged |
| SwiftGuestPool | yes (plus `scale`) | same | Works. All five replica counters, `serviceRef`, `currentTemplateHash` and `conditions` read back unchanged |
| SwiftImage | yes | same | Works. `phase`, `sourceFormat`, `preparedFormat`, `preparedArtifact` (with `pvcRef` and `size`), `cloneSeed` and `conditions` read back unchanged |
| SwiftKernel | yes | same | Works. `phase`, `kernelDigest`, `initramfsDigest`, `nodeStatuses` and `conditions` read back unchanged |
| SwiftGuestClass | **no** | not applicable | The schema declares no `status` at all, and the CRD no subresource, so `--subresource=status` answers `NotFound`. Also cluster-scoped. The views read the spec only |
| SwiftSeedProfile | **no** | not applicable | Same: no `status` in the schema, `--subresource=status` answers `NotFound` |

Three limits found while probing, all worth knowing before writing a fixture
for a later milestone:

- **Unknown status fields are pruned.** Patching `status.madeUpField` logs
  `Warning: unknown field` and changes nothing. None of the six schemas sets
  `x-kubernetes-preserve-unknown-fields` on `status`.
- **Enums are validated on status writes.** `status.phase: NotARealPhase` is
  rejected with the list of supported values.
- **The subresource is mandatory.** A `kubectl patch` without
  `--subresource=status` on a CRD that has the subresource reports
  `patched (no change)` and silently drops the status.

So a fixture status must match the published schema exactly; there is no
escape hatch. That answers the question the spec left open, at least for the six M1 CRDs: no follow-up is needed.

### Kubeconfig discovery: isolated HOME does not work

The design above assumed "an isolated `HOME` and the kind kubeconfig placed
where Freelens picks it up". The first half is not achievable: Freelens
resolves `~/.kube` through `os.userInfo().homedir`, which reads the passwd
entry and **ignores `$HOME`**, so a sandboxed HOME cannot redirect kubeconfig
discovery (`packages/core/src/common/os/kube-directory-path.injectable.ts`).

What is implemented instead: the suite copies the kind kubeconfig into
`<FREELENS_INTEGRATION_TESTING_DIR>/Freelens/kubeconfigs`, a directory
Freelens always adds to its sync set, inside the per-run sandbox the launch
helper already creates. The result is the same isolation the spec asked for,
by a different route: the developer's `~/.kube/config` is never read nor
written, and the catalog entry disappears with the sandbox.

### Runner: the Freelens harness rather than a standalone Playwright

No `@playwright/test` dependency was added, so the lockfile is untouched.
The suite reuses the existing integration harness: like
`integration/__tests__`, the `e2e/` files are copied into a Freelens checkout
and run by its `test:integration` script, which owns the Playwright Electron
launch helpers (`utils.start`, `clickWelcomeButton`). Consequences:

- The suite always uses the Playwright and Electron versions of the Freelens
  under test, which is what the version matrix is for.
- Our own suite is selected by name (`pnpm test:integration kubeswift-e2e`)
  instead of deleting the Freelens tests, so pointing `FREELENS_DIR` at a
  working checkout is not destructive. The name filter works both with the
  jest runner of v1.10.3 and with the vitest runner on Freelens main.
- Shared code lives in `integration/helpers/`, used by both suites, and the
  integration workflow now copies it too.
- Cost: `e2e/` and `integration/` stay outside the `tsconfig.json` include
  list (as `integration/` already was), so `pnpm type:check` does not cover
  them and type errors there surface only in CI. Making them type-checkable
  would mean adding a `playwright` dependency and stubbing the Freelens
  helpers, which is more machinery than the guarantee is worth today.

### CI runner

`ubuntu-24.04-arm`, the same as `integration-tests.yaml`, with no fallback to
x64 needed: that workflow already starts a kind cluster on this image (so a
Docker daemon is available) and already builds and runs the arm64 Freelens
there. The Electron build cache key is shared with the integration workflow
on purpose, since both build the same application.

### What was verified locally, and what was left to CI

Run on macOS during implementation:

- `pnpm e2e:cluster:up` end to end, twice (fresh and reusing): cluster
  created, the 15 CRDs applied at the pin and Established, the 8 fixtures
  accepted by the API server, the 4 status patches injected, and every
  readback assertion green. The fixtures are therefore schema-valid against
  the real CRDs, not just against a reading of them.
- The probes reported above, `pnpm e2e:cluster:down`, the failure paths of
  `run-suite.sh`, `bash -n` and shellcheck on every script (shellcheck and
  shfmt were added to the trunk linters in this PR).

Not run locally, and therefore what the CI workflow is the proof of: the
Playwright half. It needs a packaged Freelens build, and the local checkout
has an empty `dist/`; building it here was out of proportion to the check.
Two circumstances of this machine are worth recording: Docker Hub was
unreachable from the daemon, so the cluster was created from a node image
already present (Kubernetes 1.34 rather than the pinned 1.36.1, which is what
CI pulls), and no Freelens app was available to drive.

### What the first CI run settled

The first run (33102790430) failed 5 of 7 cases, and the shape of the failure
answered every open assumption at once: the only list case that passed was
**SwiftGuestClasses, the one cluster-scoped CRD**, while all five namespaced
ones timed out waiting for their rows.

Confirmed by that run, so no longer assumptions:

- the extension sidebar test ids are exactly
  `sidebar-item-freelensapp--kubeswift-extension-<menu id>`; the app log even
  dumps `'sidebar-item-freelensapp--kubeswift-extension': 9999` in
  `clusterPageMenuOrder`. Navigation, group expansion and the page headers all
  worked;
- the detail drawer opens on a name-cell click and closes on Escape: the
  SwiftGuestClasses case exercises both and passed;
- the kubeconfig hand-off works: the cluster connected from the catalog with
  the file dropped in the sandbox (`allowedNamespaces` in the log lists
  `kubeswift-e2e`).

Wrong, and the cause of the failure:

- **the list pages do not show all namespaces by default.** A fresh profile
  selects a single namespace, `default`
  (`selectedNamespacesStorageInjectable`: `allowedNamespaces.includes("default")
  ? ["default"] : allowedNamespaces.slice(0, 1)`), and
  `KubeObjectStore.filterItemsByNamespaces` then drops every object outside
  it, keeping cluster-scoped ones (`!itemNamespace`). That is exactly the
  observed split. The suite now moves the namespace filter to
  `kubeswift-e2e` once, right after connecting, with the same interaction the
  Freelens integration tests use on the Pods page; the selection is stored per
  cluster, so it holds for every page afterwards.

Worth keeping in mind beyond the tests: this is also what a user sees. Guests
in an application namespace are invisible on a freshly connected cluster until
the namespace filter is moved, which is standard Freelens behaviour for every
resource type, not something the extension can or should override.

To keep the next failure cheap to read, a failing row assertion now
screenshots the window and lists the rows that *are* on the page, a failing
page assertion lists the sidebar test ids present, and the workflow uploads
`e2e-artifacts/` when the job fails.

Still open: the acceptance item "the suite fails when a fixture row is absent"
is to be exercised by mutating a fixture in a scratch run once the suite is
green.

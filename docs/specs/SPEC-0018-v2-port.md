# SPEC-0018: Port to the Freelens v2 extension API

- **Status:** Approved (Roberto, 2026-10-19)
- **Milestone:** v2 port (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (raised to `v0.18.0` by [SPEC-0019](SPEC-0019-kubeswift-v0.18.md))
- **Freelens pin:** freelensapp/freelens@f95000fc4ec90099b53920712ed2b9a52cddfd92, `@freelensapp/extensions@2.0.0-0-nightly-2026-10-17`
- **Tracking issues:** #130 (the migration, from the migration issue template of the `port-freelens-extension-to-v2` skill of freelensapp/freelens-example-extension) and the feature issues #131 (A, data layer), #132 (B, read-only views), #133 (C, writes), #134 (D, console and exec), #135 (E, test suites), #136 (F, KubeSwift v0.18.0, SPEC-0019)
- **Author / date:** Roberto Bandini, with a coding agent, 2026-10-19

## Goal

The extension loads and works on Freelens 2.x as 0.1.0 does on Freelens
1.x, every view, action, form and console of milestones M1-M7, built and
tested the way the reference template builds and tests a v2 extension. It is
released as 1.0.0, the release the roadmap aims at.

## Upstream reference

- Freelens: `docs/extensions/migrating-from-v1.md` and
  `docs/extensions/api.md` (contracts C1-C15) at the pin; the template
  freelensapp/freelens-example-extension at `main`, its `AGENTS.md` and its
  `port-freelens-extension-to-v2` skill.
- KubeSwift: none beyond the specs of each feature (SPEC-0001 to SPEC-0017);
  the port changes no behaviour.

## Scope

Included: everything 0.1.0 does, on the v2 API: the 15 models, their pages
and details, the three-level sidebar, the guest actions, the eleven creation
forms, the two consoles; an error boundary around every page, details panel
and menu item; the 15 kinds as the extension's custom resources; the build
stack of the template; the unit tests, and the integration, E2E and
pre-review suites on the template's pattern.

Excluded: any change of behaviour v2 does not require, except what SPEC-0019
brings for KubeSwift v0.18.0. Bugs the parity baseline finds in 0.1.0 are
fixed here only when the port touches their code; the others get issues of
their own.

## Design

### Layout after the port

```text
src/
  main/index.ts              KubeSwiftMain (no behaviour), ESM
  renderer/index.tsx         KubeSwiftRenderer: clusterPages, clusterPageMenus,
                             kubeObjectDetailItems, kubeObjectMenuItems, customResources
  renderer/api/kubeswift/    one model per kind, with its test; types.ts
  renderer/pages/            one list page per kind
  renderer/details/          one details panel per kind
  renderer/menus/            the menu items of the actions and consoles
  renderer/components/       forms, classifiers, loaders, error boundary and page
  renderer/icons/            kubeswift.svg
  common/                    code main and renderer share
test/freelens-extensions.ts  stub of @freelensapp/extensions for the unit tests
integration/                 the suites on Freelens dev over CDP (feature E)
e2e/                         the kind lab and its fixtures (SPEC-0003, SPEC-0005)
build/                       the Vite plugins of the template
environment-tests/           the per-environment type checks of the template
```

### Registration

- `kubeObjectDetailItems` and `kubeObjectMenuItems` through
  `Renderer.K8sApi.detailsFor` and `menuItemFor` with the model classes,
  whose `kind` and `apiVersion` are declared as literals; menu item props
  from `Common.Types.KubeObjectMenuItemProps`.
- Every page, details panel and menu item inside the template's error
  boundary; an error shows the extension's error page in its own place.
- `customResources`: the 15 models, each has its own page and sidebar entry. SPEC-0019 adds four more kinds, for nineteen.
- `clusterPageMenus` unchanged: the root "KubeSwift", seven groups, 15 leaves.

### Data layer (feature A)

The models stay as they are (typed spec and status, static metadata and
helpers, no instance method), with `declare kind` and `declare apiVersion`
added. Stores are the host's, from `getStore()`, read in `observer`
components; the reference loader keeps its subscribe-after-first-load and
unsubscribe-on-unmount behaviour.

### Read-only views (feature B)

Pages on `KubeObjectListLayout`, details on the host's drawer components, as
SPEC-0001, SPEC-0002, SPEC-0004, SPEC-0007, SPEC-0008 and SPEC-0009 specify.
One stylesheet, `dist/renderer.css`, in place of the per-component `<style>`
elements.

### Writes (feature C)

The actions and forms of SPEC-0010 to SPEC-0016, with their ground rules:
confirmation dialogs that list their writes, no optimistic UI, explicit patch
types, failures reported. Forms stay the `message` of `ConfirmDialog.open`.

### Console and exec (feature D)

SPEC-0017, with the platform from `Common.App` instead of `node:os`. The
command line names the kubectl of 0.1.0 (decided in D0): the user's "Path to
kubectl binary" preference (`Common.App.Preferences.getKubectlPath()`), else
`kubectl` by name, which the cluster terminal's `PATH` resolves (C15: the
version-matched kubectl when downloading is on, the user's own, the bundled
one last). It differs from what the terminal itself runs only when the
preference is set and downloading is on, as in v1; naming the kubectl of
`Main.Shell.getKubectlPath(clusterId)` would need a main-process entry and an
IPC channel for no difference a user meets otherwise.

### Test suites (feature E)

Vitest in this repository drives Freelens dev over CDP: the integration test,
the 97 E2E cases and the pre-review pass, all under `integration/__tests__`
with the template's `vitest.integration.config.ts`. `pnpm test:integration`
runs the first two; the pre-review pass runs only with `KUBESWIFT_PRE_REVIEW=1`,
which `pnpm pre-review` sets. The scripts of `e2e/scripts/` build the checkout,
which the suites install in place, instead of packing it and copying the
suites into a Freelens checkout. Locally Freelens dev is started by
`pnpm e2e:freelens`, on a fresh profile that syncs the lab kubeconfigs alone.
`integration-tests.yaml` (proposed in `github-workflow-fix/`) is the
template's workflow with the lab of `pnpm e2e:cluster:up` instead of
`helm/kind-action`, and replaces `e2e-tests.yaml`.

### Safety

- Writes reach only the kind cluster `kubeswift-e2e`, through
  `.e2e/kubeconfig` and an explicit context; the developer's kubeconfig is
  never read by the lab scripts.
- Freelens dev used by the suites or a manual check is started isolated, by
  `pnpm e2e:freelens`: `pnpm dev` alone ignores
  `FREELENS_INTEGRATION_TESTING_DIR` (turbo's strict environment mode) and
  would sync the developer's own `~/.kube`. The script runs turbo in loose
  mode, writes a fresh profile whose only synced files are the lab
  kubeconfigs, and refuses a kubeconfig whose server is not on this machine.

## Tests (non-regression list)

- Unit: the 42 test files of 0.1.0 green on the new stack, plus
  `error-boundary.test.tsx` from the template and the tests of the code each
  feature adds.
- Type check: sources, tests, tooling, integration and environment programs
  (`pnpm type:check`).
- Build output: no `global.` reference, no second React or mobx, no Node
  builtin in the renderer bundle, one `renderer.css`, `dist/main.js` loads
  with a stand-in host API.
- Integration: `integration/__tests__/extensions.tests.ts` (install in place,
  enabled, activated, no error).
- E2E: the 97 cases of `integration/__tests__/kubeswift-e2e.tests.ts`, green
  against the lab.
- Pre-review: `pnpm pre-review`, both themes, no FAIL.

### Manual verification

To be run before the PR leaves draft; results recorded here (date, tester).

1. The functional checks of the migration issue and of each feature issue,
   in Freelens dev against the lab (maintainer).
2. On a real KubeSwift installation: every page and
   drawer with running guests and sandboxes, Start and Stop of a guest, a
   snapshot and a restore, a migration if the cluster has two nodes, the
   serial console of a running guest, the workload console of a sandbox, GPU
   views on a node with a GPU.
3. macOS and Windows: install the build, open every page, open a console
   (the Windows command line has no `exec` prefix).

## Notes and deviations

- **Surface check (step 0, 2026-10-19).** A copy of the 0.1.0 source compiles against
  `@freelensapp/extensions@2.0.0-0-nightly-2026-10-17` except for five known causes: the CSS module
  declarations need `allowArbitraryExtensions` (step 3), `observable.ref` is `observableRef` in mobx 7 (19
  uses in the forms), `getStore<X>()` types its `api` as `any` (the forms name the store type,
  `getStore<X, XStore>()`), `node:os` in the two console items, and the global `JSX` namespace. No host
  symbol or component prop is missing. v2 registers a `clusterPageMenus` tree at any depth with code
  equivalent to v1's, so the three-level sidebar stays as it is.
- **Test suites on Freelens 2 (feature E, 2026-10-19).** The three suites pass against Freelens dev of
  `main`: the integration test, the 97 E2E cases on a new lab and a new profile, and the pre-review pass
  (74 PASS, 0 FAIL, as on 1.10.3). What changed besides the move:
  - Chromium reports every failed request of the renderer on the console, which Freelens 1 did not (it
    sent them from Node). The activation case ignores only the ones listed in `EXPECTED_FAILED_REQUESTS`,
    by status and URL path: the 404s of the guest deleted under the open Stop dialog, the 409s of the
    create forms' AlreadyExists cases, and the host's pod metrics, which kind has no server for.
  - The first terminal of a new profile downloads kubectl before the shell starts, and the host's
    `sendCommand` sends the line after 10 seconds whether the shell is there or not, so a slow download
    loses the serial console's command. The setup opens a host terminal first and waits for its shell
    (`warmUpTerminal`). The same loss reaches a user who opens a console, or the host's own Pod Shell, as
    the first terminal of a new profile on a slow network: a host matter, for an upstream issue.
  - The app is not new for every run any more. A rerun needs a new lab and a new Freelens dev: the
    guests the first run created push fixture rows out of the rendered part of the Guests list.
  - The pre-review pass sets the Dark theme before the dark screenshots (on 1.10.3 they were taken with
    the default theme, which was light), and waits for the drawer to stop sliding in before each drawer
    screenshot.
  - The workflow runs the suites once, as the template does: the E2E suite changes its cluster, so the
    retry of `e2e-tests.yaml` would need a new cluster and a new app.
- **Test file paths (2026-10-20).** Feature E moved the suites from `e2e/__tests__/` to `integration/__tests__/`;
  the earlier specs name the two suites by their new paths. Spike suites deleted at the time keep their old ones.

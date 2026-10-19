# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

> **Tip**: If you find yourself correcting the agent during interactive work, suggest adding a new rule to this file so the lesson is captured for future sessions.

## Project Overview

This repository contains the official Freelens extension for KubeSwift
(github.com/kubeswift-io), which shows KubeSwift virtual machine resources
(SwiftGuest, SwiftGuestPool, SwiftSnapshot, SwiftMigration, and the other
CRDs) inside Freelens. It was scaffolded from freelens-example-extension;
the example content has been removed and the KubeSwift views are being
implemented milestone by milestone (see `docs/development/ROADMAP.md`).

- **Language**: TypeScript 7.0.2
- **Runtime**: Node.js >= 24.0.0, Freelens >= 2.0.0 (the v2 extension API)
- **Package manager**: pnpm 12.x (locked in `packageManager`)
- **License**: MIT

## KubeSwift Licensing Constraints (critical)

The KubeSwift repositories (`kubeswift-io/kubeswift`, `kubeswift-io/kubeswift-ui`)
are AGPL-3.0; this extension is MIT. They are a visual and domain reference,
NEVER a source of code:

- Do not copy components, CSS, templates, UI strings, status mapping logic,
  proto files, or generated clients from the KubeSwift repositories.
- Reading their documentation and CRD schemas to understand fields and
  semantics is fine, but do not reproduce texts verbatim.
- Views are reimplemented from scratch, based on the running UI or
  screenshots.
- TypeScript types for the CRDs are defined in this extension from the CRD
  schemas, never imported or copied from the KubeSwift repositories.
- The extension is CRD-native: it reads resources directly from the
  Kubernetes API and must not depend on the kubeswift-ui Connect RPC gateway.

## Common Commands

```bash
# Type checking
pnpm type:check                # All of the programs below, in this order
pnpm type:check:sources        # main and renderer, each with src/common/
pnpm type:check:tests          # Tests and test support
pnpm type:check:tooling        # Vite and Vitest configs, build plugins
pnpm type:check:environments   # Environment tests

# Linting & formatting
pnpm biome:check          # TypeScript/TSX, JS, JSON, CSS, HTML (biome)
pnpm biome:fix            # Auto-fix the formats above
pnpm trunk:check          # Markdown, YAML, TOML, SCSS, workflows, and Biome again (changed files)
pnpm trunk:fix            # Auto-fix Markdown, YAML, SCSS, etc.
pnpm lint:check           # Alias for biome:check
pnpm lint:fix             # Alias for biome:fix
pnpm knip:check           # Unused files, unused and unlisted dependencies (knip)

# Tests
pnpm test:unit            # vitest

# Local lab (kind cluster with the KubeSwift CRDs and fixtures, see docs/development/TESTING.md)
pnpm e2e:cluster:up       # Create or re-provision the kubeswift-e2e cluster (own kubeconfig in .e2e/)
pnpm e2e:cluster:down     # Delete it
pnpm demo:up              # The kubeswift-demo cluster for manual review (docs/development/TRY-IT.md)
pnpm demo:down            # Delete it

# Build
pnpm build                # Both Vite runs, without the type check
pnpm dev                  # Both Vite runs in watch mode, for a directory install

# Pack for testing
pnpm pack:dev             # Bump prerelease version, build, and create .tgz for install in Freelens app

# Clean
pnpm clean                # Clean dist/
pnpm clean:dts            # Remove generated *.d.scss.ts files
pnpm clean:all            # Clean everything (dist, dts, node_modules, tgz)
```

## Development process (binding)

This repository is developed spec-first. Before implementing anything, read:

- `docs/development/PROCESS.md` — the spec-driven workflow (spec before
  code, docs updated in the same PR, manual-testing escalation to Roberto)
- `docs/development/ROADMAP.md` — scope and progress toward v1.0.0
- `docs/development/ARCHITECTURE.md` — CRD-native architecture, licensing
  boundary, reference repositories
- `docs/development/DESIGN.md` — binding UI/UX directives (native-first
  components, status color semantics, theming, non-happy states); no UI
  work without reading it
- `docs/development/TESTING.md` — required test layers (unit, integration,
  Playwright E2E, agent-driven checks via Playwright MCP) and the
  non-regression policy
- `docs/specs/` — one spec per feature; no feature PR without one

## Architecture

```text
src/
  main/index.ts                  # Main entry (Main.LensExtension), ESM; no behaviour
  renderer/index.tsx             # Renderer entry (Renderer.LensExtension): every registration
  renderer/api/kubeswift/        # One model per KubeSwift kind (v1alpha1), with its test; types.ts
  renderer/pages/                # One list page per kind, and its CSS module
  renderer/details/              # One details panel per kind, and its CSS module
  renderer/menus/                # The menu items of the guest, snapshot and sandbox actions
  renderer/components/           # Creation forms, status classifiers, loaders, ErrorBoundary and its
                                 # registration wrappers, ErrorPage
  renderer/icons/                # SVG icons (original, never copied), imported with ?raw
  renderer/utils.ts              # Renderer utilities
  renderer/vars.scss             # SCSS variables
  common/utils.ts                # Utilities for main and renderer (e.g., maybe)
test/freelens-extensions.ts      # Runtime stub of @freelensapp/extensions for Vitest
environment-tests/               # Probes for the per-environment programs
build/                           # Vite plugins: host modules, standard decorators, CSS module declarations
e2e/                             # The local kind lab (scripts, fixtures) and its Playwright suites
integration/                     # The integration test and the helpers the suites share
docs/                            # Development process, roadmap, design, testing, specs
```

Build output goes to `dist/`: `main.js`, `renderer.js` and `renderer.css`, with
source maps. `main` and `renderer` in `package.json` point at the two entries.

## CRD KubeObject Pattern

A model is a subclass of `Renderer.K8sApi.LensExtensionKubeObject`, one file
per kind and API version, in `src/renderer/api/kubeswift/`: for example
`swiftkernel-v1alpha1.ts` exports `SwiftKernel`. Every KubeSwift kind is
`v1alpha1` today.

The host reads the model's metadata from the class, through `static readonly`
properties. The objects it hands to the extension, in a list, a details panel
or a menu item, come from the host's store for the resource: they are instances
of the host's `KubeObject`, not of the extension's subclass. The methods of
`KubeObject` itself are there (`getName()`, `getNs()`,
`getCreationTimestamp()`, `getSearchFields()`); a method the subclass defines
is not, and calling it throws. So:

- **Metadata**: `static readonly` `kind`, `namespaced`, `apiBase` and `crd`
  (`KubeSwiftKubeObjectCRD`: the host's `apiVersions`, `plural`, `singular`,
  `shortNames`, plus the `title` of the page and the sidebar entry).
- **Instance type**: `declare kind` and `declare apiVersion`, with the class's
  kind and version as literals, which `detailsFor` and `menuItemFor` use to
  tell the model apart from any other (see "Renderer Components"). `declare`
  emits nothing, so the runtime object is the host's as before.
- **Per-object logic**: a `static` method that takes the object, such as
  `SwiftKernel.getReadyNodeCount(object)`, or a helper of `types.ts`.
- **Fields**: read `object.spec` and `object.status` through the model's typed
  spec and status interfaces, written from the CRD schemas of the KubeSwift
  version the specs name (never copied from KubeSwift's code).
- **Forbidden**: instance methods on the subclass; a fallback such as
  `typeof (object as any).getPhase === "function" ? ...`, which always takes
  the fallback; `as any`.

```typescript
export class SwiftKernel extends Renderer.K8sApi.LensExtensionKubeObject<
  Renderer.K8sApi.NamespaceScopedMetadata,
  SwiftKernelStatus,
  SwiftKernelSpec
> {
  declare kind: "SwiftKernel";
  declare apiVersion: "kernel.kubeswift.io/v1alpha1";

  static readonly kind = "SwiftKernel";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/kernel.kubeswift.io/v1alpha1/swiftkernels";

  static readonly crd: KubeSwiftKubeObjectCRD = {
    apiVersions: ["kernel.kubeswift.io/v1alpha1"],
    plural: "swiftkernels",
    singular: "swiftkernel",
    shortNames: ["sk"],
    title: "Kernels",
  };

  static getReadyNodeCount(object: SwiftKernel): { ready: number; total: number } {
    // ...
  }
}

export class SwiftKernelApi extends Renderer.K8sApi.KubeApi<SwiftKernel> {}
export class SwiftKernelStore extends Renderer.K8sApi.KubeObjectStore<SwiftKernel, SwiftKernelApi> {}
```

The file also exports a `KubeApi` and a `KubeObjectStore` subclass. Neither is
instantiated: the store comes from the host, through `SwiftKernel.getStore()`.
They are the types the extension names: the list page passes the `KubeApi`
type to `KubeObjectListLayout`, and code that calls the store's API names the
store type, `SwiftKernel.getStore<SwiftKernel, SwiftKernelStore>()`, because
the default store type of `getStore<SwiftKernel>()` has an untyped `api`.

`src/renderer/index.tsx` registers each model's details panel
(`kubeObjectDetailItems`) and menu items (`kubeObjectMenuItems`), its page
(`clusterPages`) and its sidebar entry (`clusterPageMenus`).

`customResources` lists the 15 model classes. The host reads the group and
plural from each class's `crd`, and while the extension is enabled it leaves
the resource out of the Custom Resources tree of the cluster sidebar, where it
would otherwise be listed a second time next to the extension's own page. The
definition stays in the Definitions list, and the host's own list and details
stay reachable by URL and from the command palette. The host rejects an entry
it cannot read (no `kind`, no `crd` or `apiBase`, a core-group resource) with
an error in the log, and the resource stays in the tree (contract C6 of
`api.md`).

`getStore()` throws until the host has registered the kind's API, which it does
only after the cluster frame has loaded the CRDs. Freelens restores the last
page when a cluster is opened, so a page often renders before that. A component
that calls `getStore()` while it renders is an `observer`, so that it renders
again once the API is registered, and it does not let the error escape:
details panels and menus reach other kinds' stores through
`maybe(() => Kind.getStore())`.

## Renderer Components

- Components are function components wrapped in `observer` from `mobx-react` (the host's copy, see "Modules provided by the host").
- Every page, details panel and menu item is inside the error boundary of `components/error-boundary.tsx`: `clusterPages`, `kubeObjectDetailItems` and `kubeObjectMenuItems` are mapped through `withPageErrorBoundary`, `withDetailsErrorBoundary` and `withMenuItemErrorBoundary`. A component does not catch its own render errors.
- Details panels are registered with `Renderer.K8sApi.detailsFor(Model, { priority, Details })`; their props are `Renderer.Component.KubeObjectDetailsProps<Model>`, and they get nothing else from the registration.
- Every list page is made by `createAvailableVersionPage` (`components/available-version.tsx`, through `availablePage` in `index.tsx`): it renders the page once the host serves the kind, and a "not available" panel until then. A cluster page gets only `params` from the host; the page component gets the extension from its registration (`Page: () => <SwiftGuestsPage extension={this} />`).
- Styles come from the component's CSS module only: no `?inline` import and no `<style>` element (see "CSS").
- SCSS modules have generated declarations (`*.module.d.scss.ts`), written by the renderer build (see "CSS module declarations"); commit them with the stylesheet.

## Rules That Fail Silently

Each of these compiles when it is broken, and breaks the extension at runtime
or not visibly at all. The sections named in parentheses explain the
mechanism; this is the list to check a change against.

- **The host's React and mobx, one copy each.** Import `react`, `react-dom`,
  `mobx` and `mobx-react` by their bare module ids. A second React throws
  `invalid hook call`; a second mobx throws nothing, and the host never reacts
  to its observables. The build fails on the ways a second copy gets in
  ("Modules provided by the host").
- **Standard decorators.** An observable field is `@observable accessor`, and
  the class does not call `makeObservable(this)`. Without `accessor` the
  production build of mobx leaves the field unobservable; a unit test that
  imports the class fails ("Decorators").
- **No Node or Electron in renderer and common code.** They are `undefined` in
  the renderer. The build fails on an import, `pnpm type:check` on a global
  ("Process-specific settings").
- **One CSS asset, `dist/renderer.css`.** Any other name, or a second asset,
  leaves the extension unstyled. Nothing checks it; look at `dist/` after a
  change to the CSS setup ("CSS").
- **One tsconfig per environment.** Each program has only its runtime's `lib`
  and `types`, and no declaration may load Node into the renderer or the DOM
  into main; otherwise a wrong API type-checks and is `undefined` at runtime.
  The environment tests fail on a leak ("TypeScript").
- **No instance method on a KubeObject subclass.** The objects from the host
  do not have it, and the call throws. Nothing checks it
  ("CRD KubeObject Pattern").
- **A component that chooses the version through `getStore()` is an
  `observer`.** The host registers a CRD's APIs after the cluster frame has
  loaded the CRDs; a component that is not an `observer` and rendered before
  then shows the kind as not installed until the user navigates away and back.
  Only a test whose `getStore` reads an observable shows it
  ("CRD KubeObject Pattern").
- **`this.props` of an `@observer` class component only in its `render()`.**
  Under mobx-react 10 they are not observable. A `@computed` getter that reads
  them, or a method the host calls from its own derivations (`getItems` and
  `customizeHeader` of `KubeObjectListLayout`), throws
  `[mobx-react] Cannot read "X.props" in a reactive context` when the page
  renders, and the host shows its "App crash" page. The type check, the build
  and unit tests in a Node environment pass. Read the values in `render()` and
  hand them to the callback, or make the component a function component
  ("MobX 7 and mobx-react 10 (standard decorators only)" in Freelens's
  `migrating-from-v1.md`).
- **A memo over a store's items is keyed on something that changes with
  them.** The host keeps one observable array per store and updates it in
  place, with `replace` and `splice`, so `store.items` stays the same array
  while the objects in it change. A `useMemo` keyed on it, or on a prop that
  holds it, is computed once, and an open view keeps the objects it was opened
  with. An `observer` that reads the items while it renders follows them; a
  memo needs a key such as the ids and `resourceVersion`s of the objects. It
  shows only on a cluster whose objects change while the view is open.
- **Every page, details panel and menu item inside an error boundary.** A
  `try`/`catch` around the call of a component catches only what the call
  throws, not what a child throws when React renders it or what a callback of
  `KubeObjectListLayout` throws from the host's render. Such an error replaces
  the main area with the host's error, or, from a details panel or a menu item,
  the whole cluster view with the host's crash page. Map `clusterPages`,
  `kubeObjectDetailItems` and `kubeObjectMenuItems` through their wrappers in
  `error-boundary.tsx` ("Renderer Components").
- **A cluster page gets the extension from its registration.** The host passes
  `params` only. The type check rejects a page that requires another prop, but
  not one that declares it optional ("Renderer Components").
- **An ESM `main`, and the entries in `package.json` unchanged while
  `pnpm dev` runs.** The host refuses to reload a CommonJS main and logs why,
  and it watches only the entries it started with, so a manifest change needs
  Freelens restarted.

Neither `pnpm build` nor `pnpm dev` runs the type check, so a Node global in
renderer code passes them; `pnpm type:check` and `type-check.yaml` catch it.

## Build

`vite.config.mjs` builds one entry point per run, in library mode, as ESM:
`vite build` builds the renderer and empties `dist/`, and `vite build --mode
main` builds main next to it. The two runs share no chunk; each bundle carries
its own copy of the `src/common/` code it imports. Nothing is minified.

`pnpm dev` runs the same two builds in watch mode, side by side, for a
directory install: the host reloads the extension when either entry is
rewritten. Its renderer run passes `--no-emptyOutDir`. In watch mode Vite
empties the output directory again before every rebuild, so a renderer rebuild
would delete `dist/main.js`, and the host would have no main entry to reload.

### Modules provided by the host

The host publishes its singletons on `globalThis.FreelensExtensionApi`, and
each process publishes only the ones it has. This is contract C3 of the
Freelens extension API (`docs/extensions/api.md`):

| Module id           | Global            | Published in |
| ------------------- | ----------------- | ------------ |
| `react`             | `React`           | renderer     |
| `react-dom`         | `ReactDom`        | renderer     |
| `react/jsx-runtime` | `ReactJsxRuntime` | renderer     |
| `mobx`              | `Mobx`            | both         |
| `mobx-react`        | `MobxReact`       | renderer     |
| `monaco-editor`     | `MonacoEditor`    | renderer     |

`build/vite-plugin-host-modules.mjs` replaces a bare import of one of these
with a module that reads the global, in the extension's code and in every
library it bundles. Its named exports are the members of the copy installed as
a devDependency, which is pinned to the host's version, so an import of a name
the host's version lacks fails the build. The plugin also fails the build on an
import of a host module that the process does not publish (`react` in main),
and on a subpath of a host package that the host does not publish
(`react-dom/client`, `react/jsx-dev-runtime`). Both would otherwise either read
`undefined` at runtime or bundle a second copy. A second React throws
`invalid hook call`; a second mobx throws nothing, and the host simply never
reacts to its observables.

Everything else is bundled. That includes `@freelensapp/extensions`, a shim of
three lines that reads `Common`, `Main` and `Renderer` off the same global; it
must not be mapped. The host installs no dependencies of an extension, so
whatever the code needs at runtime and the host does not provide has to be in
the bundle.

### Process-specific settings

- **Renderer**: nothing is external. Renderer code gets no Node or Electron, and
  an import of a Node builtin or of `electron` fails the build (Vite would
  otherwise replace it with an empty module and only warn).
  `process.env.NODE_ENV` is replaced at build time, because library mode
  leaves it for a consumer's bundler and the page has no `process`.
- **Main**: Node builtins (`node:*` and bare) and `electron` stay external.
  Bundled packages resolve with Vite's server conditions, so main gets their
  Node builds rather than their browser builds. Main is built for Rolldown's
  `node` platform (`build.rolldownOptions.platform`), the renderer for
  `browser`, the default of a Vite client build. A bundled CommonJS package
  `require()`s the builtins, and an ES module has no `require`: for the
  `browser` platform Rolldown turns the call into a `__require` shim that
  throws ``Calling `require` for "node:assert" in an environment that doesn't
  expose the `require` function`` as soon as the bundle is evaluated, and for
  `node` it defines `__require` with `createRequire(import.meta.url)`.
  `pnpm build` and `pnpm type:check` pass either way, and nothing before
  Freelens evaluates `dist/main.js`, so on the wrong platform the extension
  fails only when Freelens loads it. A main bundle without CommonJS is the
  same on both platforms, byte for byte.

### Decorators

MobX 7 supports standard decorators only, and Oxc, which transpiles TypeScript
for Vite, passes them through unlowered, while neither Node nor Chromium runs
them yet. `build/vite-plugin-standard-decorators.mjs`, copied from Freelens,
hands every module with a decorator to esbuild first, which lowers the
decorators and their `accessor` fields. Both `vite.config.mjs` and
`vitest.config.ts` use it. A decorator that reaches the host or a test
unlowered is a syntax error when the module is evaluated.

An observable field is an `accessor` (`@observable accessor enabled = false;`),
and the class does not call `makeObservable(this)`. `@observable` on a plain
field type-checks and builds; the development build of mobx throws when the
class is defined, and the production build leaves the field unobservable.

### CSS

The host links the stylesheet named after the renderer entry, `renderer.css`
next to `renderer.js`. Library mode extracts the CSS of the whole bundle into
that one file (`build.lib.cssFileName`). A build that emits more than one CSS
asset, or a differently named one, leaves the extension unstyled. A component
imports its CSS module for the class names only and renders no `<style>` tag;
the rules reach the page through `renderer.css`. CSS modules
use `camelCaseOnly` class names.

### CSS module declarations

`build/vite-plugin-css-module-declarations.mjs` writes `x.module.d.scss.ts`
next to every `x.module.scss` the renderer build imports, in `vite build` and
in watch mode. It takes the class names from Vite's own `preprocessCSS`, with
the build's resolved config, so they are the names the bundle exports, after
`localsConvention`; a class inside `:global(...)` is not one of them.

The plugin is written so that a build cannot leave a committed declaration
empty or partial, whether it fails, is interrupted or is killed:

- it awaits its work in `transform`, so the build does not end while a write is
  pending;
- it writes a declaration only when the content changed, so a build that
  changes no stylesheet touches no file;
- it writes to a temporary `*.tmp` file next to the declaration and renames it
  over the declaration, which replaces it whole or not at all.

The plugin has no options and no dependency other than Vite, and it refers to
no path of this repository, so other extensions copy it unchanged.

## TypeScript

Main code runs in Node, renderer code in a browser page, and common code in
both. Each is type-checked in a program of its own, so that an API the runtime
does not have fails `pnpm type:check` rather than the extension:

| Config                       | lib                       | types                             | Files                                                              |
| ---------------------------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------ |
| `src/main/tsconfig.json`     | ES2024                    | `node`                            | `src/main/`, `src/common/`                                         |
| `src/renderer/tsconfig.json` | ES2024, DOM, DOM.Iterable | `vite/client`                     | `src/renderer/`, `src/common/`                                     |
| `src/common/tsconfig.json`   | ES2024, WebWorker         | none                              | `src/common/`                                                      |
| `src/tsconfig.json`          | ES2024, DOM, DOM.Iterable | `node`, `vite/client`             | `*.test.ts(x)` under `src/`, and `test/`                           |
| `tsconfig.json`              | ES2024                    | `node`                            | `vite.config.mjs`, the Vitest configs, `svgo.config.mjs`, `build/` |

All of them extend `tsconfig.base.json`, which has the compiler options of
Freelens's fixture extension: `strict`, `moduleResolution: Bundler`,
`useDefineForClassFields`, `noUncheckedSideEffectImports` and `skipLibCheck`
among them. `skipLibCheck` is required: `extension-api.d.ts` is one declaration
for both processes and names DOM types and the `Electron` namespace, which no
single program has. Write `types` in every config; it decides which `@types`
packages a program sees.

### Main, renderer and common

The main and renderer configs both include `src/common/`. Compiled as main,
common code fails on the DOM; compiled as renderer, it fails on Node. What
passes both is valid in both, and that is the check that decides. Common code
uses only what both runtimes have: `globalThis.crypto`, `TextEncoder` and
`TextDecoder`, `URL` and `URLSearchParams`, `AbortController`,
`structuredClone`, and the timers, with the timer handle kept opaque.

`src/common/tsconfig.json` is for the editor, which gives a file to one config
only. Its `WebWorker` lib is the closest single match and an approximation:
`self` and `postMessage` compile there and fail in the main program.

The common program is not compiled on its own. `environment-tests/tsconfig.json`
extends `src/common/tsconfig.json` and keeps its `include`, so
`tsc -p environment-tests`, in `pnpm type:check:environments`, compiles
`src/common/` with the common settings, together with the probes. A program of
`src/common/` alone has no input when the directory has no source file, and
`tsc` stops on that (TS18003); the environment tests always have their probes,
so `pnpm type:check` passes with an empty `src/common/`. Keep
`src/common/tsconfig.json` even then: the editor uses it, and the environment
tests extend it.

The split does not cover the API namespaces: `Main` and `Renderer` compile in
every program, and the one the process does not have is `undefined` at runtime.
Common code uses `Common`.

### Asset imports

The renderer program has `vite/client`, which declares `*?raw`, `*?inline` and
the CSS modules and brings no Node into the program. With
`allowArbitraryExtensions`, `import styles from "./x.module.scss"` resolves to
the generated `x.module.d.scss.ts`, so a class name that the stylesheet lacks
fails the check. Without that file, after `pnpm clean:dts`, the import falls
back to the untyped declaration of `vite/client`.

### Environment tests

`types` and `lib` alone do not keep an environment pure. A declaration file
with `/// <reference types="node" />` loads all of `@types/node` into any
program that reaches it, whatever `types` says, and one with
`/// <reference lib="dom" />` loads the DOM. `environment-tests/` proves the
split holds:

| File             | Compiled with          | Must                      |
| ---------------- | ---------------------- | ------------------------- |
| `node-apis.ts`   | renderer, common       | fail on every marked line |
| `dom-apis.ts`    | main, common           | fail on every marked line |
| `worker-apis.ts` | main                   | fail on every marked line |
| `shared-apis.ts` | main, renderer, common | pass                      |

Each line that must fail carries `// @ts-expect-error`, so a program that
starts accepting it fails with an unused directive. The configs there extend
the source configs and keep their `include`, so the probes are compiled
together with the sources and every declaration the sources reach. Compiled
alone, they would not see a declaration that a dependency of the sources brings
in.

When a declaration leaks, the environment tests fail; keep the leak out rather
than relax a probe. For Node
in the renderer, point `typeRoots` of the renderer config at a directory with
an empty `node` package, which a reference directive resolves to first. For
the DOM in main, remove the directive from the declaration with `pnpm patch`.

### Tests and tooling

Tests are not in the environment programs. Vitest runs them in Node, with
jsdom for files that ask for it, so `src/tsconfig.json` gives them the DOM and
Node. It sits in `src/` so that an editor finds it for a test file: the
environment config next to the test excludes it, and the editor goes on to the
next `tsconfig.json` up the tree. Tests compile against the real
`@freelensapp/extensions` declaration, while Vitest replaces the package with
`test/freelens-extensions.ts` at runtime.

No config declares the Vitest globals. TypeScript has no per-file globals, so
declaring `describe` or `vi` for tests would declare them for every file in the
program. Test and test-support files import what they use:

```ts
import { describe, expect, it, vi } from "vitest";
```

The module resolves from every program, so Biome keeps it out of the
extension's code: `style/noRestrictedImports` rejects an import of `vitest`
outside `src/**/*.test.*`, `test/` and `integration/`. The same rule rejects
there the testing helpers of React: the `act` named import of `react`,
`react-dom/test-utils` and `@testing-library/*`. They type-check, build and
pass the unit tests, which run the development build of React, but `act`
delegates to `React.act`, which the production build that Freelens runs leaves
out, so the call throws only in the host. `globals: true` stays on in
`vitest.config.ts` at runtime only, because React Testing Library registers its
automatic cleanup only when `afterEach` is a global.

`@freelensapp/extensions` is stubbed because the real package cannot run in a
test: it is a shim that reads `Common`, `Main` and `Renderer` off
`globalThis.FreelensExtensionApi`, which only the host sets, and it ships no
mocks. The `alias` in `vitest.config.ts` points the import at
`test/freelens-extensions.ts`, for the tests and for the extension code they
import. The stub covers only what the tests use, at runtime only; the type
check still uses the real declaration. So a test that reaches a member the stub
lacks compiles and fails on `undefined`: add the member to the stub, as small as
the test needs. The other host modules are not stubbed: `react`, `mobx` and
`mobx-react` resolve to the devDependencies, the host's versions.

Vitest runs the development build of mobx, so a test that imports
a class with `@observable` on a field without `accessor` fails when the class
is defined. The extension declares no such class today; its forms build their
models with the function forms of mobx (`observable()`, `observableRef`).

The root `tsconfig.json` checks the tooling files. It has `checkJs`, so the
Vite config and the build plugins are type-checked too; give their function
parameters JSDoc types.

## Lint and CI

### Biome

`biome.jsonc` has the formatter, import groups and rules of Freelens. Two
overrides are specific to how the extension is laid out:

- `style/noRestrictedImports` keeps `vitest` and the testing helpers of React
  out of the extension's code (see "Tests and tooling").
- `correctness/noNodejsModules` rejects a Node builtin import in
  `src/renderer/` and `src/common/`, tests left out. It flags the import in the
  editor, before `pnpm type:check` does; it does not see Node globals such as
  `Buffer` or `process`, which only the type check catches.

Every path in an override starts with `**/`. Trunk runs Biome from a sandbox
outside the repository, with `--config-path` pointing back at `biome.jsonc`,
and there a path anchored at the repository root matches no file, so the
override silently does nothing. A plain `biome check` matches both forms, so
only `trunk check` shows the difference.

In that sandbox, Biome also cannot apply `vcs.useIgnoreFile`: since 2.5.15 it
matches every target against the repository's `.gitignore` and panics on a
path outside the repository root, so every file fails. The Biome commands in
`.trunk/trunk.yaml` pass `--vcs-use-ignore-file=false`, because Trunk applies
`.gitignore` itself before it picks the targets; `biome.jsonc` keeps the
setting on for `pnpm biome` and editors.

Renovate updates Biome, in the `biome` script and in `.trunk/trunk.yaml`, but
cannot run `biome migrate`. `biome-migrate.yaml` runs it on the Renovate
branch and commits the migrated `biome.jsonc` there, so that the update and its
migration are one pull request. The commit is by `github-actions[bot]`, which
`gitIgnoredAuthors` in `.renovaterc.json` lists, so that Renovate does not take
it for a manual edit and stop updating the branch.

Biome does not read SCSS; Trunk formats it with Prettier.

### Knip

`pnpm knip:check` runs knip twice, for unused files and for dependencies: a
development pass over everything, and a `--production --strict` pass over the
code that reaches the bundles, which are the entries marked with `!` in
`knip.jsonc`. In the production pass only `dependencies` count, so a bundled
library that the extension's code imports belongs there. The host-provided
modules are devDependencies, for their types, and are ignored.

A file is unused when no entry reaches it: a leftover module, a barrel that
nothing imports. The production pass starts from the `!` entries only, so it
also reports a module that only tests import. The fix is to remove the file,
not to ignore it. The check does not include unused exports and types: on this
tree they are mostly the exported spec and status types of the models.

`knip.jsonc` lists the entries knip cannot find: the two source entries, the
Vitest alias target `test/freelens-extensions.ts` and the probes in
`environment-tests/`. Its Vite plugin is off: it adds the renderer entry of
`vite.config.mjs` as a development entry, which displaces
`src/renderer/index.tsx!`, and the production pass then skips the renderer.
`--no-config-hints` is set because one config serves both passes, and an entry
that only the production pass needs is reported as redundant by the other.

Two more settings keep the file check to real findings. `project` leaves out
the CSS module declarations with `!src/**/*.d.scss.ts`: TypeScript reaches them
through `allowArbitraryExtensions`, while knip resolves
`import styles from "./x.module.scss"` to the stylesheet, so nothing would
import them. The negation has no trailing `!`, which would apply it to the
production pass only. And the SVGO plugin is on (`"svgo": true`), so that
`svgo.config.mjs` is an entry: Trunk runs SVGO, and no dependency turns the
plugin on.

`ignore` leaves out `dist/**`. The `main` field of `package.json` makes
`dist/main.js` an entry once it exists, and the `knip` script runs with
`--no-gitignore`, so after `pnpm build`, which `check.yaml` runs first, knip
would analyse the bundle and report what it inlines from the libraries it
bundles: a `spawnSync("wsl.exe")` in a bundled `@kubernetes/client-node` comes
out as `Unlisted binaries: wsl.exe dist/main.js`. Run `pnpm knip:check` after a
build when changing `knip.jsonc`, as `check.yaml` does; without `dist/` the
problem does not show.

### Workflows

| Workflow                 | Runs                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `type-check.yaml`        | `pnpm type:check`                                                             |
| `check.yaml`             | `pnpm build`, `pnpm lint:check`, `pnpm knip:check`                            |
| `unit-tests.yaml`        | `pnpm test:unit`                                                              |
| `trunk-check.yaml`       | `trunk check --all`                                                           |
| `integration-tests.yaml` | the integration test, against Freelens                                        |
| `e2e-tests.yaml`         | the E2E suite, against Freelens and the kind lab                              |
| `mise-lock-check.yaml`   | on a change to `mise.lock`: no checksum changed for an unchanged tool version |
| `osv-scanner.yaml`       | the OSV scanner over the lock file                                            |

The type check has a workflow of its own, on pull requests and on pushes to
`main`, as in Freelens. It runs every program, tests, tooling and environment
tests included, which no build reaches, and a type error shows as its own
failed check rather than as a failed build. `check.yaml` builds without the
type check for the same reason, so it does not run twice.

The integration and E2E suites still run inside a freelensapp/freelens
checkout, as `docs/development/TESTING.md` describes, and knip leaves `e2e/`
and `integration/` out until they move to the template's pattern (Vitest in
this repository, driving Freelens dev over CDP).

## Code Style

- **Biome** formats **TypeScript/TSX, JS, JSON, CSS, HTML**: double quotes, semicolons, trailing commas, 2-space indent, 120 char line width — use `pnpm biome:fix`
- **SCSS has no formatter**: biome 2.5.2 dropped scss support (it skips the files during its walk and rejects them as explicit targets), so keep `*.module.scss` tidy by hand, following the style of the existing modules
- **Trunk** formats **Markdown, YAML**, and other formats not covered by biome — use `pnpm trunk:fix`
- Import order (enforced by biome organizeImports): built-in modules → `@freelensapp/**` → packages → relative paths
- React 19 with the automatic JSX runtime (`jsx: react-jsx`): no `React` import for JSX, `React.JSX.Element` for an element type
- **No emoji** in Markdown files (`.md`), comments, or any source code

## Security

Never read, display, reference, or include the contents of the following files in any response or context, even if they are open in the editor:

- `.env`
- `.env.*`
- `.envrc`
- `.npmrc`
- `*.jks`
- `*.keystore`
- `*.p12`
- `*.pfx`
- `*.pem`
- `*.key`

The same list is git-ignored in `.gitignore` and enforced for Claude Code by
the `permissions.deny` rules in `.claude/settings.json`, which block reading
and editing these files. Change all three together. The rules are native
permissions rather than a hook on purpose: a hook runs a process in the
working tree, which may be an untrusted pull request, and an interpreter such
as `python3 -c` imports modules from that tree before the hook's own code.

## Electron Multi-Process

Extensions run in the same multi-process model as the Freelens host:

- **Main process** (`src/main/`) — Node.js environment, extension lifecycle, cluster connectivity
- **Renderer process** (`src/renderer/`) — Chromium browser, UI components

Code in `src/common/` is shared between both processes.

## Troubleshooting

### Changes Not Appearing

1. Check that files are not in ignored output directories (`dist/`, `node_modules/`)
2. Full clean and rebuild: `pnpm clean:all && pnpm build`
3. Reinstall the extension in Freelens (or restart the app in dev mode)

### Build Failures

1. Check for TypeScript errors: `pnpm type:check`
2. Check for linting errors: `pnpm lint:check`
3. Verify dependencies: `pnpm install`
4. Check Node.js version matches the `engines` field in `package.json`

### Runtime Errors

1. Open Freelens DevTools and check the Console tab for renderer errors
2. Check the terminal where Freelens was launched for main process errors
3. Look for stack traces with file:line numbers
4. Verify all CRD objects have proper `static readonly` properties (kind, apiBase, crd)
5. Validate both with `pnpm type:check` **and** `pnpm build` — runtime failures can appear only in bundled `dist/` code

## Best Practices

0. **New package.json script that runs a repo shell script?** List the
   script path in `ignoreBinaries` in `knip.jsonc`, or the Check workflow
   fails with "Unlisted binaries" (this has bitten twice: demo:up/down and
   pre-review).
1. **Use semantic search** to find examples and patterns in the codebase
2. **Follow existing patterns** — grep for similar implementations before creating new ones
3. **Test changes** before committing
4. **Run validation before committing:** `pnpm lint:fix && pnpm type:check && pnpm test:unit`
5. **For TypeScript/TSX, JS, JSON, CSS, HTML files:** run `pnpm biome:fix` (or `biome check` directly if `biome` is installed locally)
6. **For Markdown, YAML, and other formats:** run `pnpm trunk:fix` (or `trunk check` directly if `trunk` is installed locally)
7. **Full build** when in doubt about cached state: `pnpm clean:all && pnpm build`
8. **Do not use Anthropic Fable for coding tasks** — Fable may be used only for planning,
   analysis, and thinking through problems. When writing or editing code,
   use standard editing tools instead.

## GitHub Actions (Claude Code Action) Rules

This project has a Claude Code workflow (`.github/workflows/claude.yaml`) triggered
via `@claude` comments on issues, PR comments, and reviews. When operating via that
workflow, follow these rules:

### Code Review

When reviewing code and proposing fixes:

1. **Show the diff first** — present every proposed change as a unified diff
   block using the `diff` language tag:

   ```diff
   --- a/path/to/file.ts
   +++ b/path/to/file.ts
   @@ -10,7 +10,7 @@
    const oldLine = "before";
   -const changedLine = "after";
   +const changedLine = "the fix";
    const unchangedLine = "same";
   ```

   You can generate this from the terminal with:
   ```bash
   git diff -u -- path/to/file
   ```

   If the change spans multiple files, group them under a single commit
   subject and show each file's diff sequentially.

2. **Propose a commit subject first** — before any code change, output a
   single line with the proposed commit subject:

   ```text
   **Proposed commit:** <short description>
   ```

   Do **not** use Conventional Commits prefixes (e.g. `fix:`, `feat:`,
   `chore:`, `refactor:`, `docs:`, `test:`, `ci:`). This project prefers
   plain, descriptive commit messages and PR titles without any prefix.

   Wait for the user to confirm (or adjust) the subject before applying the
   change.

3. **Comment style:**
   - Keep review comments concise and actionable
   - Reference specific lines (file + line number) when pointing out issues
   - Offer a concrete fix suggestion rather than just flagging a problem
   - Do **not** use emoji in any Markdown, comments, commit messages, or
     PR descriptions. The only exception is emoji that already appears
     inside code strings (e.g. application logs, user-facing messages).
   - Use GitHub's `suggestion` block for small targeted fixes so the PR
     author can accept the change with a single click:

     ````suggestion
     <same unified-diff format as shown above>
     ````

   - For larger multi-file changes, use `diff -u` blocks in a regular
     comment instead, with the proposed commit subject shown first

### Making Changes to a PR

When asked to implement a change on a PR:

1. Propose the commit subject (as above)
2. Describe what will change and why
3. After confirmation, apply the changes with commits on the PR branch
4. **One commit per fix** — when a review surfaces more than one issue or
   the plan includes more than one fix, apply and commit each fix
   separately. Do not batch multiple independent fixes into a single
   commit. This keeps the history bisectable and makes each change easy
   to revert individually.

### Branch Naming Conventions

When creating a branch from an issue, use a human-readable name that includes
the issue number and a short slug derived from the issue title:

```text
claude/issue-<number>-<short-slug>
```

- `<number>` is the GitHub issue number
- `<short-slug>` is a kebab-case summary of the issue title, kept short
  (3–6 words maximum, omit articles and filler words)

Do **not** use auto-generated timestamp suffixes (e.g.
`claude/issue-1957-20260612-2108`) — these are not human-readable and make
branch lists hard to scan.

### Fork PRs: Review Only

A PR from a fork (different owner than `freelensapp`) gets a review and
nothing else: no commits, no pushes, no branches. Its code is untrusted, and
the head of a fork PR can change between the moment a maintainer looks at it
and the moment the workflow checks it out, so nothing taken from the checkout
may reach `freelensapp/freelens-kubeswift-extension`.

When a fork PR needs changes, a maintainer first copies the exact commit they
reviewed to a branch in this repository. From then on it is a
same-repository PR, which gets the full setup and the normal workflow. The
copy is made either locally (`gh pr checkout <N>`, then push the branch) or
by the Claude Task workflow, following "Copying a Fork PR" below.

### Copying a Fork PR

This applies to a Claude Task run whose prompt asks to copy a fork PR and
names the PR number and the full commit SHA to copy. It is a git-only task:
do not check out, read, build or run any of the PR's files, and do not
describe its changes, because they are untrusted input.

1. `git fetch origin refs/pull/<N>/head`.
2. Verify that `FETCH_HEAD` equals the given SHA. If it does not, or no full
   SHA was given, stop and report the actual head without pushing anything.
3. `git push origin <sha>:refs/heads/claude/pr-<N>`.
4. Open a PR from `claude/pr-<N>` to `main`. It MUST use the **exact same
   title** as the original PR, copied verbatim with no prefix, and its body
   is `Copy of #<N> at <sha>.` followed by the usual footer.
5. Comment on the original PR with a link to the new one.

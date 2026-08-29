# UI/UX design directives

Binding for every contributor, human or agent, like
[PROCESS.md](PROCESS.md). These directives encode two commitments:

1. **Native-first.** The extension must feel like a part of Freelens, not
   a website embedded in it. Freelens core and the most mature freelensapp
   extensions define the patterns; this file names the canonical ones and
   forbids the known deviations. When a core component exists, custom code
   is not an alternative.
2. **Desktop-grade experience.** Freelens is an Electron desktop app used
   daily by operators. Views are optimized for scanability (state visible
   at a glance), keyboard and mouse ergonomics, perceived performance, and
   correctness on both dark and light themes at any window size.

Sources surveyed for these rules: Freelens core (`packages/core`,
`packages/ui-components`), freelens-fluxcd-extension (the reference
implementation, 44 list pages), gateway-api, resource-map, sveltos,
kamaji, karpenter, agentbridge. File references below point into those
repositories.

## 1. List pages

- Every list page uses `Renderer.Component.KubeObjectListLayout`. Custom
  tables at page level are forbidden.
- Canonical file shape (see fluxcd `pages/kustomize/kustomizations-v1.tsx`
  and our `pages/swiftguests-page-v1alpha1.tsx`):
  1. destructured `Renderer.Component` imports at module top;
  2. `const KubeObject = X; type KubeObject = X;` alias so the body stays
     version-agnostic;
  3. module-scope `sortingCallbacks`;
  4. `renderTableHeader` typed as
     `{ title: string; sortBy: keyof typeof sortingCallbacks; className?: string }[]`
     so a header cannot reference a missing sort callback;
  5. the layout call with a `tableId` derived from `KubeObject.crd.plural`,
     plus `store`, `sortingCallbacks`, `searchFilters`,
     `renderHeaderTitle`, `renderTableHeader`, `renderTableContents`.
- **Column grammar** (fixed order, no deviations):
  `Name | Namespace | <domain columns> | Condition | Status | Age`.
  - Name: `<WithTooltip>{object.getName()}</WithTooltip>`, no link (the
    row click opens the drawer).
  - Namespace: `<NamespaceSelectBadge namespace={...} />` (clickable
    namespace filter, the core idiom), not plain text.
  - Age: `<KubeObjectAge object={object} key="age" />`, sorting callback
    on `getCreationTimestamp()`.
  - Domain columns carry the resource's day-to-day operational fields
    (phase, node, IP, replicas, revision...), most important first.
- `searchFilters` is always `[(object) => object.getSearchFields()]`;
  extend it only when a column shows data not covered by the search
  fields.
- Give every non-default column a `className`; the header class is copied
  onto body cells automatically (`copyClassNameFromHeadCells`), so column
  widths are styled once as `.page :global(.TableCell).<name>`.
- Cells are single-line: the list is virtualized with a fixed row height,
  multi-line content breaks row measurement. Long values get truncation
  plus `WithTooltip`, never wrapping.
- Every cell in `renderTableContents` gets a React `key` (all of them,
  not just some).
- Missing values render as `"N/A"` in lists.

## 2. Status semantics

- Each CRD family has a **pure, unit-tested status classifier** module
  (model: fluxcd `components/status-conditions.ts` + test): functions
  from the object/conditions to a small closed set of display states
  (for example `Running | Pending | Failed | Suspended | Unknown`), with
  no JSX and no colors inside.
- Lists show state in **two columns**: `Condition` renders
  `<Badge className={conditionClass} label={conditionText} />` (short
  scannable word), `Status` renders the raw condition message truncated
  with `WithTooltip`. Both sortable.
- Colors are never authored by the extension. The classifier maps states
  to the host's global classes `success | warning | error | info`
  (defined in core `app.scss` on top of `--colorSuccess` etc.), or, for
  custom elements, to the semantic theme tokens:

  | Meaning | Token |
  | --- | --- |
  | healthy / running / ready | `--colorOk` |
  | completed / succeeded | `--colorSuccess` |
  | pending / waiting / in progress | `--colorWarning` |
  | failed / error | `--colorError` |
  | terminated / terminating / suspended | `--colorTerminated` |
  | informational / neutral | `--colorInfo` |
  | unknown | `--colorVague` |

  This mirrors core's `workloads-mixins.scss`, the canonical status
  color map extensions must not contradict.
- Boolean facts use `<BadgeBoolean />`. Prefer positive phrasing so green
  means healthy (fluxcd renders suspension as a "Resumed" column).
- `StatusBrick` is reserved for dense per-unit galleries (e.g. one brick
  per replica), following core's container-column encoding.

## 3. Detail drawers

- Registered via `kubeObjectDetailItems`; the component renders content
  only (the host draws the title bar, toolbar, and close affordance).
- Structure, in order: guard clauses (`!object` and wrong-class check),
  then `DrawerTitle` sections with `DrawerItem` rows, then related-object
  tables, then large blobs.
- `DrawerItem` conventions: `hidden={!value}` for optional rows instead
  of JSX conditionals; `labelsOnly` when the children are `Badge`s;
  values that must show as absent use `"N/A"`.
- **Do not re-render what the host already renders.** Metadata
  (`KubeObjectMeta`) is added by the host at the top of every drawer, and
  the generic custom-resource item may already include the conditions
  table; before adding a `KubeObjectConditionsDrawer`, verify in a real
  Freelens that conditions are not shown twice.
- **The host's printer-column block is accepted duplication (decision of
  2026-08-29, issue #52).** Freelens core injects a generic
  `.CustomResourceDetails` section into every CR drawer - one plain-text
  row per `additionalPrinterColumns` entry, above the extension's
  content, with no hook to suppress or reformat it. The rule for every
  view is therefore: build the full enriched section, do not trim rows to
  dodge a host printer-column row, and never hide the host block with CSS
  (the anti-pattern already rejected in issue #24). A section that tells
  the whole story of the resource, with links, humanized values and
  badges, is worth more than a partial deduplication that cannot be
  completed without the host's cooperation, and it keeps one simple rule
  across all CRDs instead of a different enriched-vs-plain split per
  kind. Letting an extension suppress the generic block for the kinds it
  registers detail items for is candidate upstream feedback, to be
  proposed after v1.0.0. This exception is about those printer-column
  rows only; whole sections the host already draws (conditions, metadata)
  stay covered by the rule above.
- References to other objects are links, never plain text:
  `LinkToNamespace`, `LinkToNode`, `LinkToPod`, `LinkToSecret`... for
  well-known kinds, `LinkToObject` for arbitrary refs, and
  `MaybeLink` + a URL helper that returns `""` for unresolvable refs so
  they degrade to text instead of dead links. Always `stopPropagation`
  on link clicks.
- A reference is linked only when the target is actually in its store
  (`objectExists`, `components/object-existence.ts`); otherwise the row
  degrades to `WithTooltip` plain text. The stores behind those checks are
  filled by `useReferenceStores` (`components/reference-loader.ts`), which
  asks for the namespaces the references live in, retries, watches, and
  reports each attempt on one line - never by an ad-hoc one-shot
  `loadAll()` in the component, which fails silently when the namespace
  filter does not cover the reference (issue #38).
- Repeated sub-objects (devices, interfaces, history entries) either
  render as a nested core `Table` (`sortSyncWithUrl={false}`,
  `scrollable={false}`) or as self-guarding section components that
  return `null` when their data is absent, so the parent reads as a flat
  declarative list.
- Timestamps: `LocaleDate` for absolute dates (honors the user's
  timezone preference; never `toLocaleString()`), `ReactiveDuration` /
  `KubeObjectAge` for ages.
- YAML or JSON blobs use a read-only `MonacoEditor` with a clamped
  initial height and `scrollbar.alwaysConsumeMouseWheel: false` so page
  scrolling is not trapped.

## 4. Navigation and sidebar

- One root menu entry for the extension with an icon; group parents and
  leaves below it are text-only (`components: {}`), mirroring core's
  sidebar (icon on "Workloads", none on "Pods").
- **Two-level grouping is the standard** (decision of 2026-08-28, issue
  #24): the root's children are a few domain groups (Guests, Boot and
  Images, Data Protection, Migrations - future milestones add their own,
  e.g. GPU, Sandbox, Fleet), each with a `target` pointing at its first
  leaf, and the resource pages hang under the groups. The host's page-top
  tab bar shows the visible children of the active root item, so with
  grouping it shows the few group tabs instead of duplicating every
  resource entry (the fluxcd precedent). Never flatten all resources
  directly under the root once a milestone brings the count past a
  handful.
- **One menu leaf per resource, not per API version** (a fluxcd defect to
  avoid: duplicated ids and repeated sidebar entries per version).
  Version selection happens inside the page (probe the store per
  version, newest first, and fall back).
- Icons are original monochrome SVGs (never copied), square
  `viewBox="0 0 24 24"`, no hardcoded `fill`/`stroke` (the host applies
  `fill: currentColor`), imported with `?raw` and passed to
  `Renderer.Component.Icon` via `svg=`. No `<img>` icons, no
  `filter: invert()` hacks (they break the light theme).
- Titles come from the model: the `crd` static block (`title`, `plural`)
  is the single source of truth feeding the menu title, the page header
  and the `tableId`.
- **Fix (decision of 2026-08-28, issues #24, #29):** navigation display
  names (`crd.title`) are humanized Title Case with spaces, dropping the
  redundant "Swift" prefix (e.g. "Guest Pools", not "SwiftGuestPools") -
  the KubeSwift root already gives the context, and this is how core
  spells its own sidebar ("Replica Sets", "Config Maps"). The kind stays
  technical everywhere it is a kind: drawer titles (`Kind: name`) and
  other data contexts are unaffected.

## 5. Theming

- **No hardcoded colors anywhere** (SCSS, TSX, inline styles). Semantic
  colors use the tokens from section 2; text and chrome use
  `--textColorPrimary/Secondary/Tertiary`, `--borderColor`,
  `--borderFaintColor`, `--contentColor`, `--layoutBackground`, etc.
- Derived accents (tinted backgrounds, borders, pills) are computed from
  tokens with `color-mix(in srgb, var(--colorInfo) 20%, transparent)`
  (the kamaji empty-state technique), never authored as hex.
- When a `var()` fallback is unavoidable, it is theme-neutral
  (`rgba(127, 127, 127, 0.25)`), never a dark-only or light-only hex.
- Spacing and typography use the host scale: `--unit` (8px) and
  multiples, `--border-radius`, `--font-size-*`; the local `vars.scss`
  only aliases that scale.
- Every view must be checked on **both themes** before a PR is opened
  (switch in Freelens preferences); the milestone review does the same.

## 6. States: loading, empty, error, absent

Every page handles four non-happy states, none of which may render a
blank area:

- **Loading**: the layout's spinner is enough for lists; custom pages
  show a centered message or skeleton.
- **Empty list**: delegated to `KubeObjectListLayout` (`NoItems`).
- **Render error**: every page and details component is wrapped in
  `withErrorPage` so a throw renders a readable error, not a blank
  drawer.
- **CRDs not installed / version drift**: the page probes the store and
  renders an explanatory panel (which CRDs are missing, which API
  versions were tried) with a link to the docs, in the style of
  gateway-api's `createAvailableVersionPage` and kamaji's empty state.
  Tri-state logic (`unknown | absent | present`) so "still probing" is
  not rendered as "not installed".

## 7. Interaction and performance

- Row click opens the drawer; links inside rows and drawers call
  `stopPropagation` so navigation never fights selection.
- Keep the UI responsive: no work in render paths, MobX `observer` on
  every component that reads stores, virtualized lists untouched (do not
  disable `virtual`).
- Tooltips (`WithTooltip`, `Icon tooltip=`) carry the full value or the
  explanation; nothing important lives only in a tooltip.
- Destructive or state-changing actions (from M6 on) go through
  `ConfirmDialog.confirm` and notify outcomes via `Notifications`;
  buttons disable while an operation is in flight.
- Respect platform conventions Freelens already implements (menus,
  shortcuts, scrolling); the extension adds no global key bindings that
  could shadow the host's.

## 8. SCSS rules

- CSS Modules only (`*.module.scss` + generated `*.module.d.scss.ts`),
  one module per component, plus the `?inline` + `<style>` injection
  idiom required by the v1 extension API (already used across the
  codebase). When the project migrates to the v2 API, the injection
  idiom is removed (v2 auto-injects the built CSS) — track it in the
  migration, do not mix styles of the two eras.
- Page modules contain column sizing almost exclusively, as
  `.page { :global(.TableCell) { &.<column> { flex-grow: ...; } } }`.
  Host class selectors must be wrapped in `:global()` (without it the
  class name is hashed and the rule is dead code — a real kamaji bug).
- Width scale reference (from fluxcd): `age 0.3`, `condition 0.7`,
  `status 1.5`, boolean columns `0.5`, URLs/revisions `1.3-1.5`.
- Inline `style={{}}` is allowed only for one-off computed values (a bar
  width percentage), never for static styling.
- Do not override host chrome (`.TabLayout`, `.Tabs`, global element
  rules): extensions style their own subtree only.

## 9. Forbidden (summary)

- Custom tables where `KubeObjectListLayout` fits; pages without drawer
  integration.
- Hardcoded colors of any kind; dark-only fallbacks; PNG/`<img>` icons;
  `filter: invert()`.
- Inline-style systems (recipes duplicated across call sites) and global
  CSS leaks (unscoped host selectors, missing `:global()`).
- `(object as any)` chains — type the CRD instead (see AGENTS.md for the
  static-properties rule).
- Copy-paste identifiers from template repos; dead files in `src/`;
  duplicated menu ids across API versions.
- Copying anything (code, CSS, strings, mapping logic) from the AGPL
  KubeSwift repositories (see ARCHITECTURE.md); their UI is a visual
  reference only.

## 10. Enforcement

- Every spec's Design section describes columns, status mapping, drawer
  sections, and the four non-happy states, and declares any deviation
  from this file (which requires updating this file in the same PR or
  dropping the deviation).
- Every UI PR states in its description: themes checked (dark and
  light), states checked (loading, empty, error, absent), and includes a
  screenshot from the live verification (TESTING.md, Playwright MCP).
- The milestone manual review gate (PROCESS.md) walks the TRY-IT.md
  checklist, which mirrors these directives.

## 11. Known gaps against these directives (retrofit backlog)

Recorded at the time this file was introduced (2026-08-28), to be fixed
in a dedicated retrofit pass on the M1/M2 views before M3 replicates the
patterns:

1. Phase/state columns render as plain text; the two-column
   Condition+Status pattern with the tested classifier and `Badge` is
   missing in all 10 views.
2. Namespace cells use `LinkToNamespace`; the directive is
   `NamespaceSelectBadge`.
3. Column order in some views places domain columns after
   phase; re-check each view against the column grammar.
4. Some cells in `renderTableContents` lack React `key`s.
5. Details components add `KubeObjectConditionsDrawer`; the pre-review
   pass found no drawer with two "Conditions" sections across the 10
   M1/M2 views (SPEC-0006), so no retrofit is due for the fixtures
   exercised so far - re-check when a new CRD arrives. The printer-column
   rows of the same host block are settled by section 3's stance (issue
   #52): they stay duplicated, the extension's sections stay complete.
6. No CRD-absent state: pages assume the KubeSwift CRDs exist; add the
   probing panel (section 6).
7. Both themes were never verified by a human; first milestone review
   covers this.

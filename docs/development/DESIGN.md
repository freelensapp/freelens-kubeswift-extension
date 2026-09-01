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
  and the `tableId`. **Exception (decision of 2026-08-29, SPEC-0009):**
  core persists sort preferences under a **globally keyed**
  `table_settings` map shared by itself and every extension, so a
  `tableId` derived from a plural that another extension could plausibly
  pick (`clusters`, `nodes`, `events`...) is written as a qualified
  literal instead (`fleetclustersTable`). The sveltos extension's
  `capiclustersTable` is the precedent. Only the id changes; the menu
  title and the page header still come from `crd.title`.
- **Fix (decision of 2026-08-28, issues #24, #29):** navigation display
  names (`crd.title`) are humanized Title Case with spaces, dropping the
  redundant "Swift" prefix (e.g. "Guest Pools", not "SwiftGuestPools") -
  the KubeSwift root already gives the context, and this is how core
  spells its own sidebar ("Replica Sets", "Config Maps"). The kind stays
  technical everywhere it is a kind: drawer titles (`Kind: name`) and
  other data contexts are unaffected. **When the humanized kind would
  collide with a name the host already uses in the same sidebar
  (`Cluster`, `Node`, `Event`, `Service`...), the title is qualified with
  the resource's own domain word taken from its schema, not left
  ambiguous** (decision of 2026-08-29, SPEC-0009: `fleet.kubeswift.io`'s
  `Cluster` is titled "Member Clusters", the schema's own first words,
  because core registers a root sidebar item titled exactly "Cluster").
  The rule and its exception are the same rule stated once: a navigation
  title says which resource this is, in the vocabulary of the sidebar it
  lives in.

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
  `ConfirmDialog.open({ ok })` and notify outcomes via `Notifications`;
  buttons disable while an operation is in flight. **`open` rather than
  `confirm` (decision of 2026-08-29, SPEC-0010):** `open` keeps the dialog
  on screen and its OK button in the host's `waiting` state until the
  promise settles, which is what actually delivers the in-flight
  disabling this bullet asks for, while `confirm` returns a boolean
  immediately and would leave the extension to invent an in-flight state
  of its own. Section 12 states the full rules for every write.
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
   missing in all 10 views. **Closed for the Guests view only**
   (2026-08-29, SPEC-0010): a stop is a policy change that the controller
   resolves later, the API has no phase for that interval, and without a
   derived reading the list would show `Running` for a guest the user had
   just stopped, so M6 gave SwiftGuest its classifier and its
   Condition/Status pair. Nine views still render a phase as plain text,
   and this entry stays open for them.
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

## 12. Write actions

Binding from M6 on, for every action, form and dialog that changes
anything in a cluster (decision of 2026-08-29, SPEC-0010, which applies
them to guest start and stop). Sections 1-11 describe views that read;
this one describes surfaces that write, and it is stricter because a
misread view is a nuisance while a mistaken write is an outage.

**Standing directive (Roberto, 2026-08-29): parity with kubeswift-ui is
the floor, not the ceiling.** Where the upstream UI is poor, ambiguous,
silent or wrong, and the CRD-native position lets this extension do
better for an operator, it does better and records why (W11).

**W1. Every action is behind a confirmation that enumerates its writes.**
Not "are you sure": the dialog names the kind, the namespace and the
name, and then lists one line per API call, with the field path and the
value transition for a patch (`spec.runPolicy: Always -> Stopped`) and
the kind and name for a delete. An action that writes two objects says so
on two lines. The dialog quotes **live facts**, built when the item is
clicked from the object as the store holds it at that moment - the same
snapshot the guard is re-evaluated against - it warns when a fact looks
stale or unverifiable, and a write that would be a no-op is dropped from
the list rather than shown as `X -> X`. Where one cheap read makes a fact
certain instead of assumed, the dialog does that read on open (never per
row, never on render) and degrades to a weaker sentence if the read is
refused.

**W2. No optimistic UI, ever.** The extension never writes into a store
to make the screen say what it hopes the cluster will do. What changes
immediately is what the API server echoed back; everything else arrives
through the watch. A corollary not to "fix": `KubeObjectStore.remove`
does not drop the row from `items` - the row disappears when the
`DELETED` watch event arrives, through a reaction debounced by one
second, which is the host's behaviour for every kind.

**W3. A state the API cannot express is derived, named, and explained.**
Where a write leaves the object in an interval the CRD has no vocabulary
for, the status classifier of section 2 derives a state from the
disagreement between `spec` and `status`, gives it a name, and explains
it in the tooltip. It never invents a value that could be mistaken for
something a controller wrote (`Stopping` is the first one).

**W4. No dead controls, and no control that lies about being dead.** An
action whose write would change nothing is rendered **disabled with a
reason**, not hidden. Two host facts come with it: core's `MenuItem`
accepts `disabled`, but the prop only adds a class and sets
`tabIndex: -1` - what actually stops the click is the stylesheet's
`.MenuItem.disabled { pointer-events: none }` - so the extension passes
`disabled` for the styling and the pointer-events guard, **and the click
handler re-evaluates the guard before writing anything**. Exception: when
the object carries a `deletionTimestamp`, action items are absent rather
than disabled. Unknown or unparseable state permits the action rather
than blocking it: the guard is a convenience, and the controller and RBAC
are the authority.

**A guard cannot disable a control without producing the reason.** The
guard is one pure function returning `{ enabled, reason }`, never a bare
boolean, and a unit test asserts over every input it distinguishes that a
disabled outcome always carries a non-empty reason. The reason is
reachable in both surfaces: the item's own tooltip attribute (a disabled
`MenuItem` cannot be hovered, so the host's hover tooltip does not show
for it - SPEC-0010 spike S7), and the drawer's Condition row explanation,
which is where a user who never hovers anything finds it.

**A disabled toolbar icon is visibly dimmed** (decision of 2026-09-01, M7
milestone review, applied to all seven actions registered since
SPEC-0010). The host's `.MenuItem.disabled` puts `opacity: 0.5` on the
whole item in both surfaces, which in the row kebab greys the icon AND
its label and is the right answer there; in the drawer toolbar the label
is hidden, half opacity on that title bar reads as a slightly different
shade, and the reason then reaches the user only through the `title`
attribute and the drawer's explanation row - neither of which is visible
until someone goes looking. So the extension dims the icon itself on that
surface, through the one shared class in `menus/action-icon.module.scss`,
and the kebab is left exactly as the host renders it (dimming it twice
would leave an icon darker than its own words). Opacity only, no colour:
the drawer title bar is one of the surfaces the host hardcodes, and its
`--drawerTitleText` is white in both themes. The host `Icon`'s own
`disabled` prop is NOT the vehicle - its stylesheet answers it with
`color: inherit !important`, which would trade that white for
`--textColorPrimary` and so recolour the icon differently per theme on a
background that does not change.

**W5. One registration, both surfaces.** Actions are
`kubeObjectMenuItems`. The host renders the same registration in the list
row kebab and in the detail drawer's toolbar, so one component satisfies
"available from both surfaces" and the two can never drift apart. The
component receives exactly `{ object, toolbar }` and uses the host idiom:
`<Icon interactive={toolbar} tooltip={title} />` plus a
`<span className="title">` that the toolbar layout hides.

**W6. The patch type is always explicit, and it is `merge`.** Both host
defaults are wrong for custom resources: `KubeApi.patch` defaults to
`strategic`, which the API server rejects for CRs, and
`KubeObjectStore.patch` defaults to `json`. Patches carry only the field
they change, never a read-modify-write of a whole spec.

**W7. No RBAC pre-flight: attempt, then report.** The extension does not
grey out an action because the user might lack permission.
`isAllowedResource` keys on built-in resource names and answers
permissively for anything it does not know, and the only correct check is
a `SelfSubjectAccessReview`, which is itself a write and is not exported
to extensions. A 403 arrives as a clear message from the API server and
is shown as one.

**W8. Concurrency is last-write-wins, and the spec says so out loud.**
The host sends no `resourceVersion` on a merge patch and has no 409
handling in its write path. For a single enum field whose transition the
dialog just showed the user, that is acceptable. Where it stops being
acceptable (forms that write many fields), the escape hatch is a `json`
patch with a `test` operation on the field, or a `PUT` carrying the
`resourceVersion` that was read.

**W9. Failure is always reported, and the report says what did and did
not happen.** Every write is wrapped in its own `try`/`catch` **inside**
the dialog's `ok` callback, never left to the host: `ConfirmDialog`'s own
catch only unwraps `Error` and `string`, and a Kubernetes error arrives
as a `JsonApiErrorParsed`, which is neither. Errors are surfaced with
`Notifications.checkedError(err, "<specific fallback>")`, whose fallback
string is per call site, never a generic "something went wrong".

- **A failure message says what to do next, and never replaces the API
  server's words with its own:** one actionable sentence is prefixed to
  the message the API returned, for the failures that are predictable
  (a 403 names the verb, the resource and the namespace; a 404 says the
  object is gone and the list is about to catch up); anything else is
  passed through as it arrived.
- **The host toasts every 403 from `apiKube` itself** and marks the error
  with `isUsedForNotification`; an extension that toasts again produces
  two notifications for one failure, so it reads that flag and stays
  quiet when it is set (SPEC-0010 spike S4).
- **A partially applied compound action reports the state it left
  behind, and how to finish the job**, which is only honest because such
  actions are built to be idempotent (W1's no-op dropping).
- **Success is acknowledged when, and only when, the screen would not say
  so on its own.** Core toasts nothing for suspend, scale or restart,
  because a column flips under the user's cursor within a watch
  round-trip; where an action changes nothing visible until a controller
  acts, silence is indistinguishable from an action that did nothing, and
  a short auto-dismissing `Notifications.ok` names the fact that was
  written (not a prediction).

**W10. The extension writes only the object the action is about, and its
controller-owned children, and it names the children in the dialog.**

**W11. Parity with the upstream UI is the floor, not the ceiling.** Every
action is audited against three questions before its spec is approved:
what does upstream leave the operator to guess, what does it get wrong,
and what can a CRD-native client know that a gateway client cannot. Each
answer is either implemented or rejected **in writing**, in the spec's
"Better than upstream" subsection, with the rejected candidates listed
next to the adopted ones so the bar is visible. Two limits keep this from
becoming scope creep: an improvement must serve an action already in
scope (a better verb is not a new verb), and it must not invent behaviour
the recon could not confirm - where upstream is merely unverified rather
than wrong, the honest move is to say less, not to promise more.

**W12. A create is a form, and the form is the confirmation** (decision of
2026-08-30, SPEC-0011, which applies it to Take Snapshot). A create needs
input before it can be confirmed, and stacking a second modal on top of a
form would be ceremony rather than safety. So one dialog per verb: the top
is the form, the bottom is the **live write summary** - the same enumerated
writes W1 requires, rebuilt from the current field values on every change,
with the one `Create <Kind> <ns>/<name>` line followed by the consequence
lines that are true of this object in this state. The OK button carries the
verb.

- **Inline validation replaces the absent webhook.** Every cross-field rule
  the API's admission webhook would enforce is enforced at the field,
  before submit, whenever that webhook can be off (KubeSwift ships its
  validating webhook disabled by default, so on a normal install nobody
  else would ever produce those messages, and the mistake surfaces much
  later as a `Failed` phase or a permanent `Pending`).
- **Option dropping replaces no-op dropping.** A field whose value would
  change nothing for the current choice is not rendered at all, rather than
  rendered and ignored. A field the API documents as a no-op is not
  rendered either; what it claims to control is stated as a derived fact
  instead.
- **A disabled submit always names the field and the reason**, in the form
  (next to the offending field) and once more next to the button. W4
  applies to submit buttons: a mute grey button is a dead control.
- **A warning never blocks.** Where the client can only guess - a name
  collision read from a store that may be stale, a reference that may have
  been created since - the dialog warns and submits, and the API server's
  refusal is what the failure path is designed to carry.
- **A section ships collapsed only when it is optional, consequence-bearing
  and hides no required field** (decision of 2026-08-31, SPEC-0013, whose
  Create Guest form is the first large enough to need one). The three
  conditions are cumulative: every field inside it has a default the object
  would get anyway, what it changes is a consequence rather than a value the
  create needs, and that consequence is stated in the open - on the section's
  own header line, which is visible whether it is open or shut. A collapsed
  section that holds an error **opens itself**, because a submit blocked on a
  field nobody can see is the dead control W4 forbids. Its open state lives in
  the form model, not in the DOM: the 409 reopen remounts the whole message,
  and a section the user had opened must not close under them. Nothing else
  may be collapsed - a form does not hide a decision to look shorter.

**Host facts this pattern rests on** (measured in SPEC-0011's spikes, on
Freelens 1.10.3; they are not obvious and each one has a wrong-looking
alternative):

- `ConfirmDialog.open` is the dialog host for every form, including in the
  list row kebab. A self-rendered `Dialog` works in the drawer toolbar and
  is unmounted ~100 ms after the kebab closes (`MenuActions` renders that
  menu `animated`, and `Animate`'s leave path returns `null`), so it cannot
  satisfy W5.
- **The form model lives outside React**, in a per-open MobX observable the
  menu item creates, with the message component an `observer` over it.
  `ConfirmDialog.ok` closes the dialog in a `finally` on both outcomes, so
  "the dialog stays open after a 409" is implemented as catch-in-`ok`
  (never rethrow: a rethrown `JsonApiErrorParsed` also triggers the host's
  own "Unknown error occurred while ok-ing" toast) plus
  `setTimeout(() => ConfirmDialog.open(sameParams), dialogReopenDelay)`, and
  that reopen remounts the message. React-local state would be wiped exactly
  when the user needs it most.
- **The reopen must wait out the host's `leaveDuration`** (SPEC-0016
  slice 2 and its follow-up, 2026-09-01). `@freelensapp/animate` clears the
  `leave` class it adds on close in a `setTimeout(leaveDuration)` that its own
  effect CANCELS when the dialog reopens inside that 100 ms window, so a
  reopen at zero delay keeps both classes, `.opacity-scale.leave` wins the
  cascade, and the form sits at `opacity: 0` forever over a page it still
  intercepts every click on. `dialogReopenDelay` (250 ms, `create-dialog.tsx`)
  is the one constant every create dialog reopens through.
- **`okButtonProps` must be a MobX observable object** whose fields are
  mutated as validity changes. A plain object is inert: nothing re-renders
  the host's button.
- **The `ConfirmDialog` box is hardcoded `#fff` in both themes**, and
  `.Dialog h5` is styled white on it. A form inside it therefore carries no
  `h5`, and sets its own text colour on its container instead of following
  `--textColorPrimary`, which in the dark theme measures roughly 3:1
  against that box. This is the one place a hardcoded colour is allowed
  under section 5, because the surface it sits on is itself hardcoded and
  theme-independent; the host's `Select` is put in its `light` theme there
  for the same reason. The limitation is upstream-Freelens feedback, next
  to the kebab-unmount finding and the absence of a `pinned` option on
  `ConfirmDialogParams` (a backdrop click discards the form, and no
  extension can prevent it).

**The pre-review agent pass stays read-only** (SPEC-0006, SPEC-0010): it
runs against the demo cluster a reviewer is about to walk through by
hand, it never opens a row kebab, it clicks only drawer rows that have an
`href`, and it asserts that no action control was collected as a link.
Mandatory confirmation (W1) is the second gate: even a stray click opens
a dialog and stops there. Any check that needs a write belongs in the E2E
suite, which owns a disposable cluster.

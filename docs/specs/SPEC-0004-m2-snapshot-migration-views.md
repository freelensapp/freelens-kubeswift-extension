# SPEC-0004: Read-only snapshot and migration views (M2)

- **Status:** Verified (merged; the non-regression suites run green in CI on
  main, E2E included)
- **Milestone:** M2
- **KubeSwift version reviewed:** v0.13.12
- **Author / date:** Claude with Roberto, 2026-08-27

## Goal

An operator sees the data-protection and mobility side of KubeSwift:
snapshots and their schedules, restores, and live/offline migrations, with
their progress and outcomes.

## Upstream reference

kubeswift-ui: `snapshot-detail`, `schedule-drawer`, `migrations`,
`restore-dialog`, `migrate-dialog` (read-only aspects only). KubeSwift
docs: `docs/crds.md` and `docs/snapshots/`, `docs/migration/`. Schemas:
`config/crd/bases/snapshot.kubeswift.io_swiftsnapshots.yaml`,
`_swiftrestores.yaml`, `_swiftsnapshotschedules.yaml`,
`migration.kubeswift.io_swiftmigrations.yaml`. Visual and domain reference
only; no code copying (AGPL boundary).

## Scope

Included: typed models (full schema), list pages, detail panels, sidebar
entries, unit tests, and E2E fixtures plus assertions for
**SwiftSnapshot** (`ssnap`), **SwiftRestore** (`srst`),
**SwiftSnapshotSchedule** (`sss`), **SwiftMigration** (`smig`), all
namespaced.

Excluded: creating snapshots/restores/schedules and starting migrations
(M6 dialogs); any write action.

## Design

Common: SPEC-0001/0002 patterns; conditions via the host drawer where
present; "N/A" fallbacks; columns below are starting points — the schema
wins and deviations are recorded here.

- **SwiftSnapshot**: list Name, Namespace, Guest (source ref), Kind
  (disk-only vs memory+disk per schema), Phase, Age. Detail: source guest,
  contents/artifacts the status exposes, size fields if present,
  timestamps, conditions.
- **SwiftRestore**: list Name, Namespace, Snapshot (ref), Target, Phase,
  Age. Detail: snapshot ref, target guest handling (in-place vs clone as
  the schema defines), phase/progress, conditions.
- **SwiftSnapshotSchedule**: list Name, Namespace, Schedule (cron), Keep,
  Suspended (if in schema), Last Snapshot (time), Age. Detail: schedule
  spec, retention, target guest(s), last/next run info the status exposes,
  conditions.
- **SwiftMigration**: list Name, Namespace, Guest, Mode (auto/live/offline),
  Phase, Progress, Age. Detail: source/target node, mode, phase with
  progress detail the status exposes, timings, failure reason, conditions.

Sidebar: continue the "kubeswift" group after Kernels, order: Snapshots,
Restores, Snapshot Schedules, Migrations.

## Tests (non-regression list)

- Unit: one test file per model, SPEC-0002 style.
- E2E: extend `e2e/fixtures/` with CRs for the four CRDs (numbered files
  continuing the existing sequence) and injected statuses (all four CRDs
  are expected to have a status subresource — verify and record); extend
  the E2E suite with per-page row assertions and one detail panel per CRD,
  reusing the existing helpers. The kind provisioning scripts need no
  change (they already apply all 15 CRDs).
- Integration: unchanged (install + activation).
- Manual verification: none expected for fixture-based rendering.

## Notes and deviations

Schemas fetched from `kubeswift-io/kubeswift@main` during implementation and
treated as authoritative over the design sketch above.

### Sidebar and titles

The design says "Snapshots, Restores, Snapshot Schedules, Migrations". That
order is implemented, but the labels follow the M1 convention of using the CRD
kind's plural (`SwiftSnapshots`, `SwiftRestores`, `SwiftSnapshotSchedules`,
`SwiftMigrations`), since the sidebar entry reuses `crd.title`.

- 2026-08-28: superseded by the humanization decision (issues #24, #29):
  `crd.title` now reads Snapshots, Restores, Snapshot Schedules and
  Migrations, dropping the "Swift" prefix the M1 convention above used; the
  kind is unchanged everywhere it is a kind (drawer titles, YAML).

- 2026-08-28: header cells gained explicit column ids to enable the host's
  column resizing (issue #27); the Last Schedule column width was fixed in
  the schedules page.

### SwiftSnapshot

- The design's "Kind (disk-only vs memory+disk)" column has no field behind it.
  The schema documents `spec.includeMemory` as **a no-op on every backend** (the
  captured set is backend-determined; the webhook warns for `local`/`s3`), so
  the column is derived from `spec.backend.type` instead and named **Contents**:
  `csi-volume-snapshot` gives "Disk", `local`/`s3` give "Memory + disk", `oci`
  gives "Memory" or, with `spec.includeDisk`, "Memory + disk". An unknown
  backend renders "N/A", following the schema's instruction to treat unknown
  phase values as opaque.
- The backend enum has a fourth member, `oci`, that `docs/crds.md` does not
  mention (it lists only `csi-volume-snapshot`, `local` and `s3`). The schema
  wins: `oci` is modelled, and it is the only backend that carries
  `spec.includeDisk` and the `status.oci` artifact block.
- Columns: Name, Namespace, Guest, Backend, Contents, Phase, Size, Age. Backend,
  Guest, Phase and Size are the CRD's own printer columns.
- `status.totalSizeBytes`, `status.memorySnapshot.sizeBytes`,
  `status.disks[].sizeBytes`, `status.oci.pushedBytes` and
  `status.s3.uploadedBytes` are plain `int64` byte counts, not quantities. A
  shared `formatBytes` helper in `api/kubeswift/types.ts` renders them the way
  Kubernetes writes quantities ("21Gi"), keeping a zero size distinct from an
  absent one.
- Detail: phase, guest, backend, contents, deletion policy, TTL, resume and
  include flags; capture timings and size, node, hypervisor, observed pause
  window, per-disk badges; the artifact location (OCI reference, S3 URI or local
  host path) with digest, signature and pushed size; and the guest spec frozen
  at capture time.

### SwiftRestore

- List matches the CRD printer columns exactly: Name, Namespace, Snapshot,
  Target, Phase, Age.
- In-place versus clone is not a field: the schema defines it through
  `spec.targetGuest.overwriteExisting`, which "must be true to restore over a
  SwiftGuest that already exists". `getTargetMode` maps that to "In-place" or
  "Clone", shown in the detail panel rather than in the list, which keeps the
  list identical to `kubectl get swiftrestores`.
- `status.downloadedBytes` only exists for `s3` restores, so the detail row is
  hidden for the other backends rather than showing a misleading zero.

### SwiftSnapshotSchedule

- `spec.template.spec` is the SwiftSnapshot spec schema verbatim, so the model
  reuses `SwiftSnapshotSpec` instead of restating it, the way `SwiftGuestPool`
  reuses `SwiftGuestSpec`.
- The design's "Last Snapshot (time)" is two distinct fields in the schema:
  `status.lastScheduleTime` (when a tick fired) and `status.lastSuccessfulTime`
  (when a scheduled snapshot last reached Ready). The list shows the former,
  matching the CRD's `Last-Schedule` printer column; the detail panel shows
  both.
- The guest is not a top-level field: it is read through
  `spec.template.spec.guestRef.name`, exactly as the CRD's Guest printer column
  does.
- `spec.retention.keepLast` unset means "keep all", which has no numeric value.
  The Keep column renders it as "All" and sorts it after every schedule that
  does have a budget.
- Columns: Name, Namespace, Schedule, Guest, Keep, Suspended, Last Schedule,
  Age.

### SwiftMigration

- The only CRD of this milestone outside `snapshot.kubeswift.io`: it lives in
  `migration.kubeswift.io/v1alpha1`.
- `spec.mode` is the request and `status.mode` is what the controller resolved
  (`auto` resolves to `offline` in the shipped phase). The Mode column shows the
  resolved value and falls back to the request before the first reconciliation;
  the detail panel shows "resolved (requested: x)" when the two disagree.
- `status.transferProgress` is only populated for live migrations, so an offline
  migration shows "N/A" rather than 0%. The schema is explicit that the value is
  a bandwidth heuristic, not a byte-exact counter.
- Source and destination nodes are CRD printer columns but are rendered as node
  links, which need more room than a list cell affords, so they are in the
  detail panel. Columns stay as designed: Name, Namespace, Guest, Mode, Phase,
  Progress, Age.
- `status.failureReason` is a 14-value enum, all of which are typed;
  `status.observedDowntime` is documented as the cutover-orchestration window
  rather than the guest's own stopped-the-world time, and the detail panel keeps
  it separate from `status.observedTransferDuration`.

### Status subresources

All four CRDs declare `subresources: status: {}`, as the spec expected. Verified
in the schemas and live against the kind cluster: each fixture status was
injected with `kubectl patch --subresource=status` and read back unchanged by
`cluster-up.sh`, which now asserts one field per CRD (snapshot phase and total
size, restore `status.guestRef.name`, schedule `lastScheduleTime`, migration
resolved mode and transfer progress).

### Local validation of the cluster half

`cluster-up.sh` was run locally end to end: the 15 CRDs were established, all
20 fixtures were accepted by the API server, the ten status patches were
injected and every readback assertion passed, and `cluster-down.sh` removed the
cluster. `kubectl get` on the four new CRDs returned exactly the values the E2E
row assertions expect.

One deviation: the pinned `kindest/node:v1.36.1` image could not be pulled on
the machine that ran this (the download stalled at a few KB/s after more than an
hour), so the local run used the v1.34.0 node image already present, via the
`KIND_NODE_IMAGE` override that `lib.sh` already supports. Nothing in the pins
was changed, and CRD schema validation and status subresources do not depend on
the Kubernetes patch version. CI runs the suite on the pinned image.

The Playwright half was not run locally: it needs a built `freelensapp/freelens`
checkout in `./freelens`, which is not present here. It is delegated to
`.github/workflows/e2e-tests.yaml`.

### E2E fixtures

`e2e/fixtures/` continues the numbered sequence with `70-swiftsnapshots.yaml`,
`80-swiftrestores.yaml`, `90-swiftsnapshotschedules.yaml` and
`100-swiftmigrations.yaml`, two resources each, chosen so every fixture pair
exercises a state the views distinguish: a Ready CSI snapshot against an
Uploading OCI full-state capture, a clone restore against an in-place one left
without a status, a nightly schedule with a retention budget against a suspended
one without, and a Completed offline migration against a live one mid pre-copy.
`fixturesReady()` now probes one fixture per milestone, so a cluster left over
from an older checkout is reported as not ready instead of failing later as a
page full of missing rows.

### Object reference links

2026-08-28: object references in the four detail drawers are rendered as
links (issue #26), per DESIGN.md section 3.

2026-08-28 follow-up (issue #23): those links did not check that the
referenced object still existed - `Renderer.Component.LinkToObject` only
formats a details URL from the ref, exactly like core's `LinkToNode`/
`LinkToPod` (see SPEC-0001 "Notes and deviations" for the SwiftGuest drawer
fix this generalizes). The `SwiftRestore` drawer's "Restored Guest" row was
the case that surfaced it live: `status.guestRef` named
`e2e-guest-restored`, a guest the E2E fixtures never create, so the link
showed the host's "Resource loading has failed" panel. All four drawers now
resolve the target kind's own store via `<Kind>.getStore()` (wrapped in
`maybe()` from `src/common/utils.ts`, since `getStore()` throws rather than
returning `undefined` when it cannot resolve one) and the shared
`objectExists`/`ensureLoaded` helpers from
`src/renderer/components/object-existence.ts`, rendering `LinkToObject`
only when the target resolves and plain text with `WithTooltip` otherwise:
`SwiftSnapshot`'s Guest (against the `SwiftGuest` store), `SwiftRestore`'s
Snapshot (`SwiftSnapshot` store), Guest and Restored Guest (both against the
`SwiftGuest` store - a "Clone" restore's target guest legitimately does not
exist until the restore creates it, which this now renders correctly as
plain text instead of a dead link), `SwiftSnapshotSchedule`'s Guest, and
`SwiftMigration`'s Guest (both `SwiftGuest` store again).

Reconciliation of the two 2026-08-28 notes above, now closed: the Captured
Guest Image and Storage Class rows were linked and the existence
degradation was written in parallel, so those two links initially did not
carry the existence check (the captured values are historical and their
targets may be gone). Closed by the 2026-08-28 #29 follow-up note below,
which applies `objectExists` to both rows.

Deliberately out of scope here: the `LinkToNode`/`LinkToPod` references in
these same four drawers (`SwiftSnapshot`'s Node, `SwiftRestore`'s Target
Node, `SwiftMigration`'s From/To nodes and Source/Destination Pod) share the
same root cause but were not part of this pass, which targeted the
`LinkToObject`-based CRD refs specifically; left as a follow-up.

2026-08-28 follow-up (issue #23, closing the previous entry's deliberate
gap): the `LinkToNode`/`LinkToPod` references above were live dead links too.
`SwiftMigration`'s drawer was the case that surfaced it: the fixtures
hardcode `kubeswift-e2e-worker` and `kubeswift-e2e-control-plane` as
source/target nodes, and neither exists on the demo cluster while only the
control-plane one exists on the E2E cluster. All of `SwiftSnapshot`'s Node,
`SwiftRestore`'s Target Node, and `SwiftMigration`'s From/To nodes and
Source/Destination Pod now go through the same `objectExists`/`ensureLoaded`
pair against `nodesStore`/`podsStore` (exactly the SwiftGuest drawer's
pattern), degrading to `WithTooltip` plain text instead of a dead link.

The E2E fixture change that goes with this: `status.destinationNode` of
`e2e-migration-completed` (`e2e/fixtures/status/swiftmigration-e2e-migration-completed.yaml`)
now uses the `__NODE_NAME__` placeholder cluster-up.sh's `inject_statuses()`
substitutes with the real node - the same mechanism SPEC-0001 introduced for
the SwiftGuest fixture's `nodeName` - so the drawer's "To" link is genuinely
alive on any cluster, not only one whose single node happens to be named
`kubeswift-e2e-control-plane`. `status.sourceNode` for that same migration
stays the literal `kubeswift-e2e-worker` deliberately: a migration's source
node may legitimately no longer exist by the time anyone looks at a finished
migration, and the drawer now renders that correctly as plain text rather
than papering over it with a link. `e2e-migration-live`'s source/destination
nodes and its pod refs are untouched (still literal, still may or may not
resolve depending on the cluster) - it is not the fixture `expectDetails`
opens in `kubeswift-e2e.tests.ts`, so nothing there depended on it being
alive everywhere. `lib.sh` gained `E2E_NODE_NAME_FIELDS`, generalizing the
readback verification `cluster-up.sh` already did for the SwiftGuest
`nodeName` substitution to cover this second field.

2026-08-28: the SwiftSnapshot "Captured Guest" section still had two
unlinked references, a pre-review pass finding (part of #29). "Image" now
links to the SwiftImage object via a new `SwiftSnapshot.getCapturedImageRef`
helper (same `toKubeObjectRef`/`LinkToObject` pattern as `getGuestRef`), and
"Storage Class" now uses the core `LinkToStorageClass` component instead of
plain text.

2026-08-28 follow-up (issue #29, closing the residual noted above): those
two rows were linked without the existence check every other reference in
these four drawers already carries. "Image" now resolves the `SwiftImage`
store via `SwiftImage.getStore<SwiftImage>()` (wrapped in `maybe()`, same
as the `SwiftGuest` store above) and only renders `LinkToObject` when
`objectExists` finds the captured image name, falling back to plain text
with `WithTooltip` otherwise. "Storage Class" does the same against core's
`storageClassStore`. That store turned out to be reachable: inspecting
`@freelensapp/core`'s `renderer-api/k8s-api.d.ts` shows it exports
`storageClassStore`/`StorageClassStore` directly (the same shape as
`nodesStore`, not per-kind `getStore()`, since `StorageClass` is a core
kind, not an extension CRD), so no fallback to leaving `LinkToStorageClass`
unchecked was needed. Because `StorageClass` is cluster-scoped,
`objectExists` is called without a namespace argument. Both stores are
loaded through the same `ensureLoaded` `useEffect` as `guestStore`/
`nodesStore`. The stale comment in the drawer claiming these two rows were
"plain text with nothing to degrade" (left over from the note two
paragraphs above, written before the links landed) is removed.

### Loading the reference stores

2026-08-29 (issue #38, superseding the `ensureLoaded` calls the notes above
describe): every existence check in these four drawers depends on the
referenced kind's store being populated, and the one-shot fire-and-forget
`loadAll()` that filled it was not reliable. On the packed Linux app in CI
the reference rows stayed plain text forever - CRD guests included, while
the list pages of the very same kinds loaded and watched fine through the
core's `KubeObjectListLayout` subscription - and nothing was logged to
explain it. See SPEC-0001 "Notes and deviations" for the two host behaviors
that produce that silence (a `loadAll()` with no `namespaces` falling back
to the namespace filter, which can list nothing and still set `isLoaded`;
and a failure without `onLoadFailure` leaving `isLoaded` false after one
warning).

All four drawers now declare what they need through `useReferenceStores`
(`src/renderer/components/reference-loader.ts`) instead: one entry per
store, with the namespaces the references live in and the names that will
be looked up. `SwiftSnapshot` asks the `SwiftGuest` and `SwiftImage` stores
for the guest/captured-image ref's namespace (the snapshot's own when the
ref carries none) and leaves `nodesStore`/`storageClassStore` cluster-wide;
`SwiftRestore` asks the `SwiftSnapshot` store for the snapshot ref's
namespace and the `SwiftGuest` store for both guest refs' namespaces plus
the restore's own; `SwiftMigration` asks `podsStore` for the migration's
namespace, where both launcher pods live; `SwiftSnapshotSchedule` asks the
`SwiftGuest` store for the guest ref's namespace. Each entry loads with
`merge: true` (never clobbering namespaces loaded by a list page) and an
`onLoadFailure`, retries up to 5 times 2-8 seconds apart while the drawer
stays open, subscribes to the store after the first successful load so
objects appearing later upgrade their row to a link, and logs one terse
`console.info` line per attempt with a stable
`[kubeswift-extension] reference store ...` prefix that the E2E error
collector echoes into the CI job log (as `info`, so it does not count as a
captured error). A `lookup=miss` is not by itself a defect - a snapshot's
guest or a clone restore's target guest may legitimately not exist - it
only drives the bounded retries.

The second failure mode these drawers could hit, now visible as
`store=unavailable` in the same lines, is a CRD store that
`maybe(() => <Kind>.getStore())` cannot resolve when the drawer opens: the
render-time `objectExists` on a `null` store observes nothing, so no MobX
change would ever trigger the re-render that resolves it again. The loader
nudges one itself on each attempt that found no store, and takes over
normally once the store appears.

Rendering is deliberately unchanged: `objectExists` remains the render-time
lookup and every row still degrades to `WithTooltip` plain text when the
target is absent.

2026-08-29 (issue #38 follow-up, closing the tightening this section left
open): the CI run of the loader PR confirmed the fix on the packed Linux
app, so the E2E degradation allowance is gone for the rows whose target the
fixtures guarantee - concretely the SwiftGuest drawer's Node and Pod rows,
the only ones the suite clicks through today (see SPEC-0001). The four
drawers of this spec are unaffected in behavior: their references still
degrade to `WithTooltip` plain text when the target is absent, which several
fixtures make happen on purpose (a "Clone" restore's target guest, a
finished migration's source node), and that stays the expected rendering.

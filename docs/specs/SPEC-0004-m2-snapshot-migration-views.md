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

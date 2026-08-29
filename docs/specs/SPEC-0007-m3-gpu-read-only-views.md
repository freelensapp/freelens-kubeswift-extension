# SPEC-0007: Read-only GPU views (M3)

- **Status:** Approved (Roberto, 2026-08-29, in chat)
- **Milestone:** M3
- **KubeSwift version reviewed:** `v0.13.12`
- **Author / date:** Claude with Roberto, 2026-08-29

## Goal

An operator sees the GPU side of KubeSwift: which GPU passthrough profiles
exist and what they ask for, and which nodes actually have GPUs, how many of
them are free, whether the host is ready to hand one to a VM, and which guest
is holding each device.

## Upstream reference

kubeswift-ui: `gpu-node-drawer` (the only read-only GPU screen it has) and
`create-gpuprofile` (a create form, so it belongs to M6 here, not to this
spec). KubeSwift docs: `docs/crds.md` sections for SwiftGPUProfile and
SwiftGPUNode, and `docs/gpu-passthrough.md` for the tier model, the discovery
DaemonSet, the field ownership split and Fabric Manager partitions. Schemas:
`config/crd/bases/gpu.kubeswift.io_swiftgpuprofiles.yaml` and
`gpu.kubeswift.io_swiftgpunodes.yaml`. Visual and domain reference only; no
code copying (AGPL boundary, see ARCHITECTURE.md).

There is no upstream read-only screen for SwiftGPUProfile, so that view is
designed from the schema alone rather than mirrored.

## Scope

Included: typed models (full schema), list pages, detail drawers, a new
sidebar group, the first status classifier of the repository, unit tests, and
E2E fixtures plus assertions for **SwiftGPUProfile** (`sgp`, namespaced) and
**SwiftGPUNode** (`sgn`, cluster-scoped).

Also included, because M3 is where the references become resolvable: the GPU
rows the M1 drawers already render as plain text (`SwiftGuest`'s "GPU
Profile", `SwiftGuestPool`'s template "GPU Profile", and the `SwiftGuest` GPU
section) become existence-checked links to the objects this milestone
registers, and the SwiftGuest GPU section is completed with the fields its
model already types but never shows.

Excluded: creating or editing profiles (M6 forms), any write action, any
allocation or binding action, the DRA path's `SwiftGuest.spec.gpuResourceClaim`
views beyond what the SwiftGuest drawer already shows (it is a SwiftGuest
field, not a GPU CRD, and its ResourceClaim objects are core Kubernetes
resources Freelens renders natively), and the CRD-absent probing panel of
DESIGN.md section 6, which stays the cross-cutting retrofit of gap #6 rather
than being invented per milestone.

Columns and sections below are a starting point: the implementation verifies
every field against the CRD schema (the schema wins over this spec and over
`docs/crds.md`) and records deviations in this file.

## Design

Common: one model file per CRD in `src/renderer/api/kubeswift/`, statics
pattern (no instance methods), full spec/status typed from the schema, pages
and drawers following the M1/M2 files, `"N/A"` fallbacks in lists, values the
schema declares without an `enum` typed as plain strings so an unexpected
value from a cluster cannot break a view.

Two properties of this pair of CRDs shape everything below and are unlike
anything in M1/M2:

- **SwiftGPUProfile is spec-only.** The CRD declares `subresources: {}` and
  the schema has no `status` property at all: no phase, no conditions, no
  observed generation. It is a request, and nothing writes back to it. The
  precedent is SwiftGuestClass and SwiftSeedProfile (SPEC-0002).
- **SwiftGPUNode is status-only.** The CRD declares
  `subresources: {status: {}}` and the schema has no `spec` property at all
  ("the spec is intentionally empty"). Everything an operator reads is written
  by the discovery DaemonSet and by the SwiftGPU controller, which own
  different fields of the same status (see Notes). It is the first
  cluster-scoped KubeSwift object with a status in this extension.

### Navigation and sidebar placement

A new group **GPU** (`kubeswift-gpu`), appended after "Migrations" as the
fifth child of the `kubeswift` root, with the two resource pages under it:

| Menu id | Title | Page id |
| --- | --- | --- |
| `kubeswift-gpu` | GPU | (group, `target` = `swiftgpuprofiles`) |
| `swiftgpuprofiles` | GPU Profiles | `swiftgpuprofiles` |
| `swiftgpunodes` | GPU Nodes | `swiftgpunodes` |

Justification. DESIGN.md section 4 already names GPU as one of the groups
future milestones add, and two-level grouping is the standard, so flattening
these two leaves under the root is not an option. Appending the group after
the existing four keeps every current entry where users found it last time
and follows the order the roadmap introduces the domains in. Profiles come
first inside the group (and are therefore the group's `target`): a profile is
the object a user authors and looks for by name, while the node inventory is
consulted when something does not schedule. The alternative considered and
rejected was hanging "GPU Profiles" under the existing "Guests" group, next to
Guest Classes, since both are guest-shaping templates: it would split the two
GPU CRDs across two groups and leave a one-leaf GPU group, which is worse than
the small conceptual overlap.

Titles are humanized Title Case without the "Swift" prefix (DESIGN.md section
4, issues #24 and #29), keeping GPU as an initialism: "GPU Profiles" and "GPU
Nodes", never "Gpu Profiles". The kind stays technical wherever it is a kind
(drawer titles `SwiftGPUProfile: name`, YAML, search).

### SwiftGPUProfile: list

Namespaced, so the full column grammar applies minus the state columns:

| Column | id | Source | Notes |
| --- | --- | --- | --- |
| Name | `name` | `metadata.name` | `WithTooltip`, no link |
| Namespace | `namespace` | `metadata.namespace` | `NamespaceSelectBadge` |
| Count | `count` | `spec.count` | printer column; 1, 2, 4 or 8 |
| Model | `model` | `spec.model` | printer column; empty means any model, rendered as "Any" |
| Partition Mode | `partitionMode` | `spec.partitionMode` | printer column (upstream calls it `Mode`) |
| Tier | `tier` | `spec.tier` | printer column |
| Age | `age` | `getCreationTimestamp()` | `KubeObjectAge` |

The four domain columns are exactly the CRD's printer columns, so the list
reads like `kubectl get swiftgpuprofiles`, with two adjustments. The upstream
`Mode` header becomes **Partition Mode**: on a row that already carries a Tier
column, a bare "Mode" is ambiguous, and the humanized navigation decision
applies to headers too. An empty `spec.model` is the schema's way of saying
"any model matches", which is a fact and not a missing value, so it renders as
**Any** rather than as `"N/A"`; a genuinely absent field still renders
`"N/A"`.

**No Condition and no Status column**, because the CRD has no status to
classify: a state pair here would render `"N/A"` on every row of every
cluster. This is a declared deviation from DESIGN.md section 2's two-column
pattern, of the same kind SwiftGuestClass and SwiftSeedProfile already are,
and it needs no change to DESIGN.md: the pattern applies to CRDs that report
state.

Tier and partition mode render as the raw enum values (the list matches
`kubectl`), with the schema's own explanation of each value in the cell
tooltip; the humanized reading lives in the drawer.

### SwiftGPUProfile: detail drawer

Sections in order, each self-guarding (a section component returns `null` when
its block is absent, so the drawer reads as a flat declarative list):

1. **GPU Profile**: Count, Model (or "Any"), Tier, Partition Mode, Hugepages
   (`spec.hugepages`; the empty string means no hugepages and renders as
   "None"), vCPU Pinning (`BadgeBoolean`). Tier and Partition Mode carry the
   humanized reading next to the value ("pcie (Cloud Hypervisor, flat PCI
   topology)"), written from the schema's field descriptions.
2. **PCIe Topology** (`spec.pcieTopology`): Root Port Per Device
   (`BadgeBoolean`), GPUDirect Clique, No Mmap (`BadgeBoolean`).
3. **NUMA Topology** (`spec.numaTopology`): Sockets, Cores Per Socket, Threads
   Per Core, Memory Per Socket. The last one is `memoryPerSocketMi`, a count of
   **MiB**, not of bytes: it goes through a new `formatMebibytes` helper (see
   below), never through `formatBytes`, and the raw value stays in the
   tooltip. When the block is absent the guest gets a flat, single-node
   topology, which the section says instead of rendering four empty rows.
4. **Fabric Manager** (`spec.fabricManager`): Runs In (Guest / Host, from
   `runInGuest`, phrased as a location rather than as a bare boolean because
   that is what the field decides), Required Driver Version.
5. **Guests Using This Profile**: a nested core `Table`
   (`sortSyncWithUrl={false}`, `scrollable={false}`) of the SwiftGuests in the
   profile's namespace whose `spec.gpuProfileRef.name` is this profile, with
   Name (existence-checked link), Phase and Node. `gpuProfileRef` is a
   `LocalObjectReference`, so the search is namespace-local by construction.
   The section renders only once the SwiftGuest store reports `isLoaded` for
   that namespace; while the store is still filling it renders nothing rather
   than claiming the profile is unused, and once loaded with no match it says
   so explicitly.

No conditions drawer: there are no conditions. The host's generic
`.CustomResourceDetails` block will show Count, Model, Mode and Tier as plain
rows above our sections; that duplication is accepted and our sections stay
complete (DESIGN.md section 3, issue #52). Nothing is trimmed to dodge it and
nothing is hidden with CSS.

### SwiftGPUNode: list

Cluster-scoped, so no Namespace column:

| Column | id | Source | Notes |
| --- | --- | --- | --- |
| Name | `name` | `metadata.name` | the node's own name (see below) |
| GPUs | `gpus` | `status.gpuCount` | printer column |
| Free | `free` | `status.freeGPUs` | printer column |
| Model | `model` | `status.gpuModel` | printer column |
| VFIO | `vfio` | `status.vfioReady` | printer column, `BadgeBoolean` |
| Condition | `condition` | classifier | `Badge` with the host's status class |
| Status | `status` | classifier | one-line explanation, `WithTooltip` |
| Age | `age` | `getCreationTimestamp()` | `KubeObjectAge` |

A SwiftGPUNode is named after the node it describes (the discovery DaemonSet
creates one per node labelled for GPU work), so the Name column is also the
node name; the drawer turns it into a Node link, the list does not (row click
opens the drawer, DESIGN.md section 1).

`vfioReady` deliberately appears twice: as its own boolean column, because it
is the single most decisive fact about a GPU node (allocation and the
migration GPU pre-flight both refuse a node whose host has not loaded
`vfio-pci`), and folded into the Condition verdict, because a node that is
`Ready` without VFIO must not read as healthy at a glance. The boolean column
is the fact, the condition is the verdict.

The two state columns follow DESIGN.md section 2 with one adaptation, declared
here: the CRD has no `conditions[]` and no message field anywhere, so the
Status column cannot render "the raw condition message". It renders instead a
short generated explanation of the same state, in our own words, built from
the fields the badge was derived from: what is wrong when something is (the
host has not loaded `vfio-pci`, discovery is still running, discovery
reported an error, an unknown phase value), and, when nothing is, when the
inventory was last refreshed. Both columns are sortable. If upstream later
adds conditions to this CRD, this column becomes the raw message and the
adaptation goes away.

### SwiftGPUNode: detail drawer

1. **Discovery**: Condition (the same classifier badge), Node (`LinkToNode`
   when the node exists, plain text otherwise), VFIO Ready (`BadgeBoolean`),
   Phase (the raw `status.phase` string, since the badge above is a verdict and
   the raw value is what `kubectl` shows), Last Discovery (`LocaleDate` plus
   the elapsed time; a stale timestamp is the signal that the DaemonSet
   stopped).
2. **Inventory**: Vendor (`status.gpuVendor`), Model, GPUs, Free, Allocated
   (derived as `gpuCount - freeGPUs`, hidden when either is absent rather than
   rendering a misleading zero), and a `StatusBrick` gallery with one brick per
   entry of `status.gpus[]`. This is the dense per-unit case DESIGN.md section
   2 reserves `StatusBrick` for: healthy colour for a free GPU bound to
   `vfio-pci`, informational for an allocated one, warning for a GPU whose
   driver is not the passthrough one, with the index, model and holder in each
   brick's tooltip.
3. **GPUs**: a nested core `Table`, one row per device: Index, Model, Vendor,
   PCI Address, Device ID, NUMA, IOMMU Group, Driver, BARs, Allocated
   (`BadgeBoolean`), Allocated To. `allocatedTo` is a `"namespace/name"`
   string, not an object reference: it is split, existence-checked against the
   SwiftGuest store for that namespace, and rendered as a link or as plain
   text. BARs shows the largest region humanized (the >64GB case is what
   drives `noMmap`) with the full per-region list in the tooltip; `sizeMi` is
   MiB, so it goes through `formatMebibytes`.
4. **Host** (`status.host`): IOMMU Enabled (`BadgeBoolean`), Sockets, Cores
   Per Socket, Threads Per Core, Total CPUs, 1Gi Hugepages (free over total),
   and a nested `Table` of the NUMA nodes: ID, CPUs (the mask string),
   Memory (`memoryMi`, humanized).
5. **NVSwitches** (`status.nvSwitches`, HGX nodes only): a nested `Table` with
   PCI Address, Device ID, NUMA. Absent on every non-HGX node, so the section
   guards itself.
6. **Fabric Manager** (`status.fabricManager`): Installed (`BadgeBoolean`),
   Running (`BadgeBoolean`), Version, and a nested `Table` of partitions: ID,
   GPU Indices, Active (`BadgeBoolean`), Allocated To (same
   `"namespace/name"` handling as above).

No conditions drawer here either. The host's printer-column block will repeat
Phase, GPUs, Free, Model and VfioReady above our sections: accepted, per the
same stance.

### Status classification

A pure module `src/renderer/components/gpu-status.ts`, no JSX and no colours
inside, mapping a SwiftGPUNode to a small closed set of display states and to
one of the host's global classes:

| State | When | Class |
| --- | --- | --- |
| `Ready` | phase `Ready` and `vfioReady` | `success` |
| `No VFIO` | phase `Ready`, `vfioReady` false or absent | `warning` |
| `Discovering` | phase `Discovering` | `warning` |
| `Error` | phase `Error` | `error` |
| `Unknown` | no phase at all | `info` |
| the raw value | any other phase string | `info` |

The last row matters: `status.phase` has no `enum` in the schema, so an
unrecognized value is displayed opaquely rather than forced into one of the
buckets (the SPEC-0001/SPEC-0004 stance on unknown phases).

This is the first status classifier in the repository, so it also sets the
shape for the M1/M2 retrofit that DESIGN.md section 11 gap #1 tracks: a pure
function from the object to `{ state, className, explanation }`, unit-tested
in isolation, with the components doing nothing but rendering what it
returns. SwiftGPUProfile gets no classifier, having no state.

### References and reference loading

Every reference is a link only when the target is actually in its store
(`objectExists`), and degrades to `WithTooltip` plain text otherwise; the
stores behind those checks are declared through `useReferenceStores` with the
namespaces the references live in, never through an ad-hoc `loadAll()`
(DESIGN.md section 3, issue #38).

| Drawer | Store | Namespaces | Lookups |
| --- | --- | --- | --- |
| SwiftGPUNode | `nodesStore` | cluster-wide (omitted) | the object's own name |
| SwiftGPUNode | SwiftGuest | every distinct namespace parsed out of `gpus[].allocatedTo` and `fabricManager.partitions[].allocatedTo` | the parsed name/namespace pairs |
| SwiftGPUProfile | SwiftGuest | the profile's own namespace | the guests the section lists |
| SwiftGuest (existing) | SwiftGPUProfile | the guest's own namespace | `spec.gpuProfileRef.name` |
| SwiftGuest (existing) | SwiftGPUNode | cluster-wide (omitted) | `status.gpu.nodeName` |
| SwiftGuestPool (existing) | SwiftGPUProfile | the pool's own namespace | `spec.template.spec.gpuProfileRef.name` |

A `lookup=miss` is expected here more often than anywhere else in the
extension and is not a defect: a GPU can stay recorded as allocated to a guest
that was just deleted, and a profile can name a model no node carries. Those
rows render as plain text, which is the correct outcome, and the loader's
bounded retries and one-line diagnostics are unchanged.

### Reach into the existing views

Three rows the M1 drawers render as plain text become links now that their
targets are registered kinds, which is the rule of DESIGN.md section 3 rather
than an extension of scope:

- `SwiftGuest` "GPU Profile" (`spec.gpuProfileRef.name`).
- `SwiftGuestPool` "GPU Profile" (`spec.template.spec.gpuProfileRef.name`).
- `SwiftGuest`'s GPU section gains a **GPU Node** row linking
  `status.gpu.nodeName` to the SwiftGPUNode object (the core Node link stays
  in the Runtime section, pointing at the Node itself), plus the Hypervisor
  and NUMA Nodes values from `status.gpu` that `SwiftGuestGpuStatus` already
  types and the drawer never showed.

### Non-happy states

- **Loading**: the `KubeObjectListLayout` spinner, unchanged.
- **Empty list**: delegated to the layout (`NoItems`). This is the normal
  state of both pages on most clusters, not an edge case: a cluster with no
  GPU nodes and no profiles is a working cluster. The milestone review
  explicitly checks that the host empty state reads acceptably here; a custom
  message is a follow-up if it does not, not something invented in advance.
- **Render error**: both pages and both drawers wrapped in `withErrorPage`.
- **CRDs not installed**: unchanged from M1/M2 (DESIGN.md section 11 gap #6,
  cross-cutting).
- **Absent references**: covered above; every reference degrades to text.

### DESIGN.md conformance

Column grammar, `NamespaceSelectBadge` for the namespace cell (the M1/M2
retrofit item #2 does not apply to new views: they are written with it from
the start), a React `key` on every cell, single-line cells with truncation
plus tooltip, explicit column ids, per-column `className` and widths in the
page SCSS module, no hardcoded colours, both themes checked before the PR.

Declared deviations, all argued above: no Condition and no Status column on
SwiftGPUProfile (no status exists); a generated explanation instead of a raw
condition message in SwiftGPUNode's Status column (no conditions exist); and
`vfioReady` shown both as a fact column and folded into the verdict. None of
them requires a change to DESIGN.md.

## Tests (non-regression list)

- **Unit** (`pnpm test:unit`):
  - `src/renderer/api/kubeswift/swiftgpuprofile-v1alpha1.test.ts`:
    construction from a realistic fixture, every helper, a profile with only
    the required `count` (every optional block absent), the empty-model "Any"
    case, the empty-hugepages "None" case.
  - `src/renderer/api/kubeswift/swiftgpunode-v1alpha1.test.ts`: construction,
    the derived Allocated count, the `"namespace/name"` split (including a
    malformed value with no slash), the largest-BAR selection, an object with
    no status at all, and a status with `gpus[]` but no `host`/`nvSwitches`/
    `fabricManager`.
  - `src/renderer/components/gpu-status.test.ts`: one case per row of the
    classifier table, plus an unknown phase string and a missing status.
  - `formatMebibytes` cases alongside the model tests that use it, in the
    style the existing models test `formatBytes` through their own helpers.
- **Integration**: unchanged (the harness keeps asserting install, listing as
  enabled, and activation without errors).
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), two new cases plus one
  link case, each also asserting `headerCellsWithoutId(frame)` is empty for
  the view it opens:
  - "lists the SwiftGPUProfiles with their count, model and tier": the two
    profile fixtures, one minimal and one full.
  - "lists the SwiftGPUNodes with their inventory and condition": the ready
    node (counts, model, VFIO yes, Ready badge) and the degraded one (VFIO no,
    the No VFIO badge and its explanation), then one detail drawer with the
    per-GPU table and the Fabric Manager partition.
  - "navigates the SwiftGPUNode drawer's Node and guest links to objects that
    actually exist": reusing the pre-review link helper, as the SwiftGuest
    Node/Pod case does today; the ready node's Node row must be a live link,
    and the GPU allocated to a deleted guest must stay plain text.
- **Fixtures and status injection** (`e2e/fixtures/`, numbering continued):
  - `110-swiftgpuprofiles.yaml`: `e2e-gpu-profile-pcie` (count 1, tier `pcie`,
    partition mode `isolated`, a model filter, no optional blocks) and
    `e2e-gpu-profile-hgx` (count 4, tier `hgx-shared`, partition mode
    `shared`, hugepages `1Gi`, vCPU pinning, and all three optional blocks
    populated), so every optional section is exercised in both branches.
    **No status patch**: SwiftGPUProfile declares `subresources: {}` and has
    no status property, so there is nothing to inject. It joins
    SwiftGuestClass and SwiftSeedProfile as a fixture whose whole view comes
    from the spec.
  - `120-swiftgpunodes.yaml`: cluster-scoped, so no namespace in the manifest.
    Two objects: one named after the cluster's real node, so the drawer's Node
    link is genuinely alive, and one named `e2e-gpu-node-absent`, describing a
    node that is no longer in the cluster, so the degrade-to-text branch is
    covered. **Status patches for both** (`subresources: {status: {}}` is
    declared): a Ready node with 8 GPUs, 3 free, `vfioReady: true`, a full
    `host` block, eight `gpus[]` entries of which five are allocated (one to a
    guest the fixtures do create, one to a guest they deliberately do not),
    NVSwitches and two Fabric Manager partitions; and an Error node with
    `vfioReady: false` and an empty inventory.
  - Naming an object after the cluster's node needs the `__NODE_NAME__`
    substitution `inject_statuses()` already does for status patches to also
    run over the fixture manifests in `apply_fixtures()`. The `sed` is a no-op
    for every file without the placeholder, so this generalizes the existing
    mechanism rather than adding a second one, and `metadata.name` cannot be
    patched afterwards. A readback assert proves the substitution landed.
  - `lib.sh`: two entries in `E2E_STATUS_PATCHES`, and assertions in
    `E2E_STATUS_ASSERTIONS` for the node phase, `freeGPUs` and `vfioReady`.
    **To verify while implementing**: `inject_statuses()` and
    `verify_statuses()` pass `--namespace "${E2E_NAMESPACE}"` unconditionally,
    and SwiftGPUNode is the first cluster-scoped object to be patched
    (SwiftGuestClass is cluster-scoped but has no status). `kubectl` is
    expected to ignore the flag for a cluster-scoped resource; if it does not,
    the entry format gains an optional scope marker instead of the flag being
    dropped for everyone.
  - `50-swiftguests.yaml` gains `e2e-guest-gpu`, a disk-boot guest with
    `spec.gpuProfileRef` (mutually exclusive with `kernelRef`, so it cannot be
    folded into the existing kernel-boot fixture) and an injected `status.gpu`
    with devices, partition id, NUMA nodes, hypervisor and
    `nodeName: __NODE_NAME__`. It gives the SwiftGPUNode drawer a live
    `allocatedTo` target and lights up the SwiftGuest drawer's GPU section,
    which no fixture exercises today.
  - `fixturesReady()` gains an M3 probe, so a cluster left over from an older
    checkout is reported as not ready instead of failing later as a page full
    of missing rows.
- **Pre-review agent pass** (SPEC-0006, `pnpm pre-review`): two entries in
  `integration/helpers/kubeswift-views.ts`
  (`swiftgpuprofiles` / "GPU Profiles" / `e2e-gpu-profile-hgx`, and
  `swiftgpunodes` / "GPU Nodes" / the real node's name, which the helper reads
  the same way the fixtures do). The pass's existing asserts then cover the
  new views for free: header ids, every drawer link clicked and checked for
  the host's load-failure panel, references rendered as links or as text but
  never as dead links, byte values humanized (this is what will catch a MiB
  field rendered as a raw digit run), the conditions-section count (0 for both
  GPU views), and both themes. The pass runs before the M3 review session and
  its report is the precondition for it (PROCESS.md).
- **Manual verification**: fixture-based rendering needs none. Real GPU
  hardware stays a known manual-only area (TESTING.md): what a human with an
  HGX node must confirm is that the discovery-populated inventory reads
  correctly against `nvidia-smi` and `lspci` on that node (device order, BAR
  sizes, IOMMU groups, NUMA attachment), that Fabric Manager partitions and
  their allocations match `fmpm`, and that a node whose host has not loaded
  `vfio-pci` shows as No VFIO. Record date, tester and result here when it
  happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan. What
follows is the recon that produced this spec.

### Implementation, slice 1 of 2: SwiftGPUProfile (2026-08-29)

The milestone lands in two PRs, one per CRD, because each is a complete
vertical slice (model, page, drawer, unit tests, fixtures, E2E asserts) and
the second one is the larger by far. This is a split of the work, not of the
design: nothing below changes what the spec asks for.

- **What slice 1 contains**: the SwiftGPUProfile model, list page and detail
  drawer, `formatMebibytes`, the `kubeswift-gpu` sidebar group with "GPU
  Profiles" as its only leaf (and therefore its `target`), the unit tests,
  the `110-swiftgpuprofiles.yaml` fixtures, the `e2e-guest-gpu` SwiftGuest
  fixture with its injected status, the E2E case and the pre-review entry.
- **What slice 2 contains**: everything about SwiftGPUNode, plus the whole of
  "Reach into the existing views". The three rows that become links are kept
  together in the second PR even though the two profile ones would already
  resolve here: the third (the SwiftGuest GPU section, which gains the GPU
  Node link and the fields its model already types) needs SwiftGPUNode
  registered, and changing one drawer's GPU rows twice in two PRs is worse
  than changing them once. "GPU Nodes" joins the group created here.
- The spec Status stays `Approved` until both slices are merged.

Details the spec left open, settled while implementing:

- `e2e-gpu-profile-hgx` carries `model: ""` (the schema's "any model
  matches") while `e2e-gpu-profile-pcie` carries a real filter, so the two
  row asserts of the E2E case cover both branches of the Model cell, "Any"
  and the value.
- The model types its metadata as `NamespaceScopedMetadata` rather than the
  generic `KubeObjectMetadata` the M1/M2 models use: it makes `getNs()` a
  `string`, which is what `NamespaceSelectBadge` needs, and it states in the
  type what `namespaced = true` states next to it. New namespaced models
  should follow it.
- The `Guests Using This Profile` rows are read straight from the SwiftGuest
  store, so their existence check can only ever pass; it is kept anyway, so
  that every reference in the extension goes through the same rule.

### Upstream recon (2026-08-29)

Per PROCESS.md's upstream drift watch, at the start of the milestone:

- The latest KubeSwift release is still **v0.13.12** (2026-08-24), the version
  M1 and M2 were written against. Its notes are about
  `SwiftSeedProfile.spec.userDataFrom` (a CRD schema fix), a chart image-tag
  defect and a sample manifest; nothing GPU related.
- The 13 commits on `main` after the release tag are eleven dependency bumps
  and two documentation commits. One of the two ("remove third-party project
  references across the tree") edits Go doc comments, so three regenerated
  manifests under `config/crd/bases/` did change: `swiftguests`,
  `swiftguestclasses` and `swiftguestpools`, in two `description` strings
  each, dropping a comparison to another virtualization project. No field,
  enum, default or required list changes; nothing an extension reads at
  runtime, and nothing the M1 models restate.
- The two GPU CRD manifests at `main` are byte-identical to the ones at tag
  `v0.13.12`, verified by diff. No drift, no issue to file, and the E2E
  version pin in `e2e/scripts/lib.sh` stays as it is.

### Schema facts that drive the design

- **SwiftGPUProfile**: `gpu.kubeswift.io/v1alpha1`, namespaced, short name
  `sgp`, printer columns Count / Model / Mode / Tier, `subresources: {}`, no
  `status` in the schema. `spec.count` is the only field a user must author
  (enum 1, 2, 4, 8); `partitionMode` (`isolated` | `shared` | `full`), `tier`
  (`pcie` | `hgx-shared` | `hgx-full`) and `vcpuPinning` are listed as
  required but all three carry defaults, so the API server fills them in.
  Optional blocks: `pcieTopology` (all three fields required inside, all
  defaulted), `numaTopology` (all four required inside, only `threadsPerCore`
  defaulted), `fabricManager` (`runInGuest` required inside). `model` and
  `hugepages` are free strings with no default in the schema.
- **SwiftGPUNode**: `gpu.kubeswift.io/v1alpha1`, cluster-scoped, short name
  `sgn`, printer columns Phase / GPUs / Free / Model / VfioReady,
  `subresources: {status: {}}`, no `spec` in the schema. Status blocks:
  `phase`, `lastDiscovery`, `gpuCount`, `freeGPUs`, `gpuModel`, `gpuVendor`,
  `vfioReady`, `gpus[]`, `host`, `nvSwitches[]`, `fabricManager`. No
  `conditions[]` and no message field anywhere in the status.

### Docs versus schema discrepancies

Recorded for upstream feedback, as SPEC-0002 and SPEC-0004 did. In every case
the schema wins.

1. `docs/crds.md`'s SwiftGPUNode status table omits three fields the schema
   defines: `status.gpuVendor`, `status.vfioReady` and `gpus[].vendor`.
   `vfioReady` is not a minor omission: it is a published printer column and
   the field allocation and the migration pre-flight both gate on.
2. `docs/gpu-passthrough.md`'s sample `kubectl get sgn` output shows only
   NAME / PHASE / GPUS / FREE / MODEL, so it predates the VfioReady printer
   column; its own status table omits `vfioReady`, `gpuVendor` and
   `lastDiscovery` too.
3. `docs/crds.md` lists `vcpuPinning` as not required while the schema puts it
   in `spec.required`. The practical behaviour matches the docs (the field is
   defaulted), but the two statements disagree; the same applies to `tier` and
   `partitionMode`, documented as required and defaulted at once.
4. `docs/crds.md` gives `model` and `hugepages` a default of `""`; the schema
   declares no default for either, so an object can legitimately arrive
   without the field, which is why the views distinguish "empty means any"
   from "absent".
5. `docs/crds.md` documents the three `phase` values (`Discovering`, `Ready`,
   `Error`) but the schema declares `phase` as a plain string with no enum, so
   the views treat unknown values as opaque.
6. Neither doc mentions that SwiftGPUProfile has no status at all; it is
   stated only by omission (the SwiftGPUNode section has a "Subresource:
   status" line and the profile section has none).

### Domain facts recorded, deliberately not encoded in the UI

- **Field ownership is split.** `docs/gpu-passthrough.md` documents that the
  discovery DaemonSet owns `phase`, `host`, most of `gpus[]`, `nvSwitches` and
  the Fabric Manager inventory, while the SwiftGPU controller owns
  `gpus[].allocated`, `gpus[].allocatedTo`, `partitions[].allocatedTo`,
  `freeGPUs`, `gpuCount` and `gpuModel`. Two writers on one status is why the
  derived Allocated count can momentarily disagree with `gpus[]`, and why
  `lastDiscovery` deserves its place in the drawer.
- **Tier 3 is not implemented in v0.13.12.** `tier: hgx-full` and
  `partitionMode: full` are documented as rejected at allocation. The views do
  not badge them as unsupported: that is a controller-version fact, not a
  schema fact, and it would go stale the moment upstream ships the phase. A
  profile that asks for them renders exactly what it asks for; the guest that
  references it will show the failure on its own conditions.
- `status.gpu.partitionId == -1` on SwiftGuest means "no partition" and is
  already handled by `SwiftGuest.getGpuPartitionId` (SPEC-0001);
  `fabricManager.partitions[].id` on SwiftGPUNode has no such sentinel.

### Units

`memoryPerSocketMi` (profile), `host.numaNodes[].memoryMi` and
`gpus[].barSizes[].sizeMi` (node) are counts of **MiB**. The shared
`formatBytes` helper takes bytes, so passing these to it would under-report by
a factor of 1048576. A sibling `formatMebibytes` in
`api/kubeswift/types.ts` converts and delegates, keeping one formatting rule
in one place, and keeps a zero distinct from an absent value the way
`formatBytes` does.

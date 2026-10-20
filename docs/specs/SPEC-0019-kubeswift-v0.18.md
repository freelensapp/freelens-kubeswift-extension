# SPEC-0019: Alignment to KubeSwift v0.18.0

- **Status:** Implemented (approved: all four tiers, Roberto, 2026-10-19)
- **Milestone:** v2 port (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.18.0` (from `v0.13.12`)
- **Tracking issue:** feature F of the v2 migration ([SPEC-0018](SPEC-0018-v2-port.md))
- **Author / date:** Roberto Bandini, with a coding agent, 2026-10-19

## Goal

On a cluster running KubeSwift v0.18.0, every write of the extension
succeeds and every state is explained correctly, and the views show what
v0.18.0 adds to the kinds the extension presents.

## Upstream reference

The CRDs of `config/crd/bases/` of kubeswift-io/kubeswift at `v0.13.12` and
`v0.18.0`, and the "Upgrade" sections of the release notes from `v0.13.13` to
`v0.18.0`. Read for schema facts and semantics only (AGPL boundary, see
ARCHITECTURE.md): types, texts and fixtures are written here.

## Scope

The changes since `v0.13.12`, in four tiers, all carried by the PR of the v2
port.

| Tier | Content | In this PR |
| --- | --- | --- |
| T1, compatibility | what a write or a state explanation of the extension gets wrong on v0.18.0 | yes |
| T2, new fields | the new spec and status fields of the kinds already presented, read-only | yes |
| T3, new kinds | read-only pages and details for the four kinds added since | yes |
| T4, forms | the new fields offered in the creation forms | yes |

Approved: T1, T2, T3 and T4 (Roberto, 2026-10-19).

## Design

### Changes found

Schemas (the kinds without changes are `Cluster`, `SwiftGPUNode`,
`SwiftGPUProfile`, `SwiftGuestPool`, `SwiftKernel`, `SwiftMigration`,
`SwiftRestore`, `SwiftSeedProfile`):

- `SwiftGuestClass`: `spec.cpuPinning` (`none`, `static`; default `none`),
  `spec.hugepages` (`2Mi`, `1Gi`, unset), `spec.smtPolicy` (`spread`, `pack`;
  default `spread`), `spec.sharedBaseDisk` (default `false`).
- `SwiftGuest`: `status.network.podIP`, `status.network.primaryIPScope`
  (`Pod`, `Network`), `status.sharedBaseDisk` (`node`, `baseKey`, `created`,
  `sizeBytes`).
- `SwiftImage`: `spec.source.upload` removed.
- `SwiftSnapshot`: `spec.backend.locationRef` (`kind`
  `SwiftStorageLocation` or `SwiftClusterStorageLocation`, `name`),
  `status.location`, `status.captureStartedAt`, `status.guestSpec.primaryIP`.
- `SwiftSnapshotSchedule`: `spec.template.spec.backend.locationRef`.
- `SwiftSandbox`: `spec.network` (ingress, egress, ports), `livenessProbe`,
  `readinessProbe`, `termination`, artifacts (optional, claims, pull and
  verification secrets), secret file items; `status.artifacts`,
  `status.network.podIP`, `primaryIPScope`, `egressAllowed`.
- `SwiftSandboxPool`: `spec.network`, `status.warmingReplicas`.
- New: `SwiftStorageLocation` (namespaced) and `SwiftClusterStorageLocation`
  (cluster-scoped), `storage.kubeswift.io/v1alpha1`;
  `SwiftArtifactPlacement` (namespaced) and `SwiftArtifactVerificationPolicy`
  (cluster-scoped), `sandbox.kubeswift.io/v1alpha1`.

Behaviour:

- v0.15.0: a local snapshot's `hostPath` must be omitted or
  `/var/lib/kubeswift/snapshots/<namespace>_<name>`, else the snapshot fails;
  schedules may not set it.
- v0.15.0: `runPolicy: Stopped` makes the controller delete the launcher pod.
- v0.15.0: a missing reference keeps a guest `Pending` with
  `Resolved=False`, no longer `Failed`.
- v0.16.0: two `oci` snapshots may not share `repository:tag` (`TagInUse`);
  a snapshot's spec is immutable except `deletionPolicy` and `ttl`.

### T1, compatibility

- "Take snapshot" (SPEC-0011): the local backend writes no `hostPath`; the
  form shows the derived directory instead of asking for one. The payload
  test proves it.
- "Take snapshot": an `oci` backend whose `repository:tag` another
  `SwiftSnapshot` of the cluster already records is flagged before the write,
  with the snapshot that holds it.
- Guest classification (SPEC-0001): `Pending` with `Resolved=False` reads as
  waiting for a missing reference, with the condition's message.
- Stop (SPEC-0010): both writes kept (the launcher pod's deletion is needed
  before v0.15.0 and harmless after); the confirmation says why.
- `SwiftImage` type: `upload` removed, and the form's footer no longer
  mentions it.
- Lab: `KUBESWIFT_VERSION` `v0.18.0`, all its CRDs applied, the fixtures
  without a free host path; the integration workflow on the same version.

### T2, new fields

Each in the drawer section its meaning belongs to, following DESIGN.md (empty
values hidden, enums as badges where they are states, quantities formatted):
the guest class's CPU, memory and disk sections; the guest's network and disk
sections; the snapshot's backend section with a link to its location; the
sandbox's network, health, lifecycle and artifacts sections; the pool's
replicas. A list page gains a column only where the CRD added a printer
column whose information the page does not show yet.

### T3, new kinds

After "Adding an API" of the template's `AGENTS.md`, each with a model, a
list page, a details panel and `customResources`: the two storage locations
under "Data Protection", the artifact placement and verification policy under
"Sandboxes". Read-only; the links from a snapshot to its location and from a
sandbox's artifacts to their placement and policies.

### T4, forms

The creation forms offer the new fields, with the ground rules of SPEC-0010
(the confirmation lists every write, no field the controller ignores, a
choice the cluster cannot satisfy is blocked with its reason) and the form
patterns of SPEC-0013 to SPEC-0016:

- "Take snapshot" (SPEC-0011): a storage location as the backend, picked from
  the `SwiftStorageLocation` objects of the guest's namespace and the
  `SwiftClusterStorageLocation` objects (`spec.backend.locationRef`), next to
  the backends the form already has.
- "Create guest class" (SPEC-0014): CPU pinning, hugepages, SMT policy and the
  shared base disk, each left unset unless changed (the CRD defaults stand).
- "Create sandbox" and "Create sandbox pool" (SPEC-0016): the network (ports,
  ingress and egress rules), liveness and readiness probes, the termination
  drain period, and for artifacts the optional flag, claims and the pull and
  verification secrets; for a sandbox, the items of a secret file.

Each form's section of this spec gets its field list, validation and write
summary, from the v0.18.0 schema, and is reviewed before its step is coded;
a field whose meaning the schema and the release notes leave unclear is
asked about, not guessed.

### T4 form designs (for review before coding)

Common to all four: the ground rules of SPEC-0010 and the form patterns of
SPEC-0013 to SPEC-0016 apply unchanged. A new field is omitted from the
payload while it holds its default or is empty, so the API server's defaults
stand and the read-back of an untouched form is the same as today's (the CRD
stamps its own defaults, as the guest class case shows). Every rule below that
the admission webhook would enforce is enforced inline, because the webhook
is off by default. Each field adds its line to the write summary only when it
is set.

**Correction to the T4 scope above.** On `SwiftSandbox`, `artifacts`,
`secretFiles`, the probes, `termination`, `podMetadata` and
`readinessStartup` are all new since v0.13.12 (the form offers none of
them today), and `network` gains `ports`, `ingress` and `egress` next to the
`mode` the form already has. The designs below cover what T4 names; the two
it does not name, `podMetadata` and `readinessStartup`, are open question Q1.

#### Take Snapshot: storage locations (SPEC-0011)

- **Where it applies.** The `oci` and `csi-volume-snapshot` backends. A
  location is not valid with `backend.oci` or with
  `csiVolumeSnapshot.volumeSnapshotClassName`, so each of the two gets a
  "Destination" choice of three, and the fields of the other two are hidden:
  - "Default location" (the new default for `oci`): no `locationRef` and no
    `backend.oci`; KubeSwift resolves the namespace's default location, else
    the cluster's. The choice names the location that would be used, from
    the lists below, or says that none is marked default, in which case the
    snapshot would wait `Pending` with `NoStorageLocation` (a warning, not a
    block: the lists can be stale). For `csi-volume-snapshot` this is today's
    empty class, and the hint changes to "the location's class (the
    namespace default, else the cluster default), else the cluster's default
    VolumeSnapshotClass".
  - "Storage location": a picker of the guest namespace's
    `SwiftStorageLocation` objects and every `SwiftClusterStorageLocation`
    (shown as `cluster/<name>`), written as
    `backend.locationRef: {kind, name}` (`kind` always written). A location
    without the part the backend needs (no `oci` for `oci`, no `csi` for
    csi) is listed disabled with that reason; one whose `Ready` condition is
    `False` is listed with its message and a warning.
  - "Registry" (`oci`) or "Class" (csi): today's fields, unchanged.
- **Warnings, never blocks.** For `oci` through a location (picked or
  default): its `credentialsSecretName` missing from the guest's namespace,
  unless the location is `anonymous` (the snapshot waits with
  `RegistryCredentialsMissing`); its `signingKeySecretName` missing (waits
  with `SigningKeyMissing`). Both read from the namespace's Secret names the
  dialog already loads.
- **Summary.** "The artifact is pushed through the storage location X, under
  `<repository>/<namespace>/snapshots` (cluster location) or
  `<repository>/snapshots` (namespace location), tagged `<name>-<uid>`."
  The TagInUse check of T1 does not apply: that tag carries the object's uid.
- **Lists.** Read on open, as the Secret names are; a list the user may not
  read leaves the "Storage location" choice with a sentence saying so, and
  the other two choices work.
- **Tests.** Payload: each destination of both backends, `locationRef` never
  with `oci` or a class. Picker states. E2E: a location snapshot written and
  read back, and a disabled csi-only location for `oci` (fixtures of T3).

#### Create Guest Class (SPEC-0014)

- **Fields**, in a collapsed "CPU and memory placement" section:
  - CPU pinning: `none` (default) or `static`. With `static`, the summary
    says that each vCPU is pinned to its own host CPU from the launcher
    pod's cpuset, and that the launcher refuses to start when the cpuset
    holds fewer CPUs than the class's vCPUs, rather than pin some of them.
  - SMT policy: `spread` (default) or `pack`, enabled only with `static`
    pinning (ignored otherwise, so not offered).
  - Hugepages: none (default), `2Mi` or `1Gi`. The summary says that the
    launcher pod then requests `hugepages-<size>` equal to the memory instead
    of ordinary memory, so the node must have that many pages reserved, or
    the guest does not schedule.
- **Shared base disk**, its own checkbox, unchecked by default. When checked,
  the summary carries the cost as a warning: the root disk is node-local and
  not replicated (losing the node loses the guest), the guest cannot be
  migrated in any mode, CSI and full-state snapshots are refused (memory
  snapshots work), and the setting cannot be changed later.
- **Tests.** Payload per field and the omissions; the summary lines.
  E2E: a class with every field set, read back key-exact.

#### Create Sandbox and Create Sandbox Pool (SPEC-0016)

Both forms, in new collapsed sections; on a sandbox that checks out of a pool
the pool decides the network (as it decides the mode today), so the Network
section is hidden there (open question Q2 for the rest).

- **Network** (sandbox and pool), next to today's mode:
  - Ports: rows of name (IANA service name: lowercase letters, digits and
    `-`, at most 15, at least one letter, unique) and port (1-65535); TCP is
    the only protocol, so not asked. At most 16. Blocked with mode `none`.
  - Ingress: who may reach the ports; rows of one source each: a CIDR
    (`ipBlock.cidr`, with optional exceptions), a namespace by name (a
    `namespaceSelector` on `kubernetes.io/metadata.name`), or pod labels
    (`podSelector.matchLabels`). At most 16; without rows, any source may.
    Offered only when ports are set.
  - Egress allow list: rows of a destination, a CIDR (IPv4) or a Service by
    name and optional namespace, each with optional ports (port and
    TCP/UDP). At most 32. Only with mode `restricted` (blocked otherwise);
    the summary says that the metadata range and IPv6 stay blocked, and that
    a missing or headless Service keeps the sandbox `Pending`.
- **Probes** (sandbox only): readiness and liveness, each off by default; a
  probe is HTTP GET (path, port) or TCP (port), the only two supported, the
  port a number or the name of a port above; period, timeout, failure
  threshold and initial delay left empty for the defaults. Blocked with mode
  `none`. The summary says what each does: readiness gates the Service and
  the `WorkloadReady` condition; liveness ends the sandbox `Failed` after the
  threshold, and nothing restarts it.
- **Termination** (sandbox only): drain period, a duration between `0s` and
  `10m`, empty for the default (5s with ports, else 0s).
- **Artifacts** (sandbox only): rows of name (DNS label, at most 40, unique),
  reference (a digest pins it; a tag is resolved at start, with a note),
  mount path (absolute, not `/`, `/proc`, `/sys`, `/dev`, not inside another
  mount), layout (`oci` default or `unpacked`), optional (with its fetch
  timeout, `0s` to `5m`, empty for 10s), pull Secret and verify-key Secret
  (pickers of the namespace's Secrets, with today's missing-Secret warning),
  require platform verification, and claims (key-value rows; claims that no
  policy governs make the artifact refused, said in the summary). A note
  that artifacts need a sandbox kernel whose bridge supports them.
- **Secret files** (sandbox only): rows of a Secret (picker), its default
  mode (octal, empty for 0400), optional, and items (key, absolute path with
  no `.` or `..` and not under `/proc`, `/sys`, `/dev`, optional mode); at
  most 32 items. A note on the kernel requirement and that a missing Secret
  or key keeps the sandbox `Pending` unless optional.
- **Tests.** Payload per field and per rule, both forms; E2E: a sandbox and
  a pool with ports, ingress and egress written and read back, a sandbox
  with both probes, an artifact and a secret file read back.

#### Decisions on the open points (2026-10-19)

Taken by the implementer under the maintainer's delegation of the Phase 4
decisions, and listed in the phase report for confirmation:

- **D1.** `podMetadata` labels are offered on the sandbox form (rows of key
  and value; keys under `kubeswift.io` or any `*.kubeswift.io` domain are
  blocked, as the schema refuses them): without them, the ports cannot be
  reached through a Service. Its annotations and `readinessStartup` are not
  offered.
- **D2.** On a pool checkout, probes, termination, artifacts, secret files
  and labels are offered (they belong to the workload, and the schema says a
  checkout applies the labels to the slot it claims); the Network section is
  hidden (the pool's).
- **D3.** Ingress sources are the three shapes above; no `matchExpressions`
  and no combined namespace and pod selector.

## Tests (non-regression list)

- Unit: the payload builders of the T4 forms with each new field set and
  unset; the snapshot payload without `hostPath`; the tag conflict check; the
  guest classification of `Pending` with `Resolved=False`; the models of T2
  and T3 from fixtures written from the v0.18.0 schemas.
- E2E: the snapshot form's local and `oci` cases; the drawers of T2; the
  pages and drawers of T3; each form field of T4 and the object it writes;
  the lab on v0.18.0.
- Manual verification: on a real KubeSwift v0.18.0, a
  local snapshot taken from the extension captures, and a sandbox with
  network and artifacts shows them.

## Notes and deviations

- **T1 (2026-10-19).**
  - The local backend writes `hostPath` as exactly the derived directory,
    `/var/lib/kubeswift/snapshots/<namespace>_<name>`, rather than omitting it:
    v0.15.0 and later accept that value as they accept an omitted one, and the
    versions before require a directory under the prefix, which an omitted
    field would not give them. The form shows the directory, following the
    name; it asks for nothing.
  - The repository:tag check is a warning on the Tag field, like the name
    collision: the second snapshot is created and then fails, so the store or
    the list can be stale without harm. The dialog lists the snapshots of the
    whole cluster, and of the guest's namespace when the user may not.
  - The `Resolved=False` explanation is the classifier's one reading of a
    condition type, on the word of the v0.15.0 upgrade notes; the state stays
    `Pending` and the Status column already quotes the condition's message.
  - The image form's footer also says that v0.16.0 refuses `pvcClone`.
  - Found while coding T4 and added to T1: since v0.14.1 an `oci` snapshot
    with `deletionPolicy: Delete` has its registry artifacts deleted, and
    since v0.16.0 by the digest recorded at push time (one without it, or a
    registry that refuses deletes, keeps them). The Take Snapshot summary and
    the drawer's "On Delete" row said that nothing purges them (SPEC-0011's
    finding on v0.13.12); both now follow the policy.
  - On the v0.18.0 lab the CRDs stamp `cpuPinning`, `smtPolicy` and
    `sharedBaseDisk` on a guest class the form creates; the E2E case reads
    them back with their defaults. Every other fixture and case passed on the
    new CRDs unchanged.
- **T2, guest class, guest, snapshot and schedule (2026-10-19).**
  - Columns, where the CRD added a printer column the page did not show:
    Guests "Guest IP" (was "IP") and "Pod IP"; Snapshots "Location" (a
    location by name, `cluster/<name>` for a cluster one, `Explicit`, or
    `Default class`); Snapshot Schedules "Ready", one badge for the CRD's
    Ready and Reason columns, the reason being the label when not ready, read
    from the `Ready` condition the manifest publishes (the SPEC-0009
    exception). The new columns sit where the rows' existing adjacent-cell
    assertions stay meaningful.
  - Drawers: the guest class's CPU pinning, SMT policy (only under static
    pinning), hugepages and shared base disk; the guest's IP scope, pod IP and
    a Shared Base Disk section; the snapshot's Location section (resolved
    location, repository, tag, class, secrets, insecure, CA bundle), capture
    start and the captured primary IP; the schedule template's storage
    location.
- **T4, Take Snapshot (2026-10-20).** As designed: a Destination select for
  `oci` and csi (Default storage location, which is the form's default;
  Storage location; Registry or VolumeSnapshotClass), the picker listing the
  namespace's locations and the cluster's as `cluster/<name>`, with a location
  lacking the backend's part disabled and one not ready flagged. A
  VolumeSnapshotClass is now required for its explicit destination, since
  "Default" covers the empty class. The TagInUse check applies to the
  Registry destination only. When the locations cannot be listed (a refused
  list, or a cluster before v0.16.0), the picker says so and the other two
  destinations work; the Default destination of an `oci` snapshot is then
  warned about, pointing at Registry, not refused, because the form cannot
  tell the two causes apart.
- **T3 (2026-10-20).** Sidebar: Data Protection gains "Storage Locations" and
  "Cluster Storage Locations", Sandboxes gains "Artifact Placements" and
  "Verification Policies"; each page has a Condition badge and a Status column
  like the other kinds, the printer columns, and a drawer whose references
  are links when the object exists (pool, Secrets, policies, nodes) and plain
  text otherwise. A cluster location's Secrets are never links: they are
  looked up in the namespace of each object that uses the location. PEM keys
  and CA bundles are shown in a read-only block. The snapshot drawer links its
  storage location. Fixtures: `220-storage-locations.yaml` and
  `225-artifact-placements.yaml`, with their statuses.
- **T2 and T4, sandbox and pool (2026-10-20).** The drawers show the network
  (ports, ingress, egress and the enforced egress), the probes, the drain
  period, the pod labels and annotations, each artifact with its state and
  governing policies, and the secret files; the pool shows its network and
  warming slots; the Sandboxes page gains Guest IP and Pod IP. The forms
  follow the T4 design and D1-D3. Interpretations:
  - the refused pod-network prefixes, which the schema lists for
    annotations, are refused as label keys too;
  - on a checkout a probe port by name is refused (the pool decides the
    network), and with a pool in mode `none` any probe is;
  - an artifact mounted inside or at another artifact's path is blocked; an
    overlap with the model's mount is only a warning;
  - two secret-file items on one path, and a path ending in `/`, are blocked;
  - defaults are not sent (mode 0400, layout `oci`, protocol TCP, scheme
    HTTP), and the API server stamps them; caps where the schema has none:
    16 claims per artifact, 32 pod labels;
  - the sandbox footer no longer says that `env[].valueFrom` is ignored:
    v0.18.0 reads `secretKeyRef` (and refuses the other sources), which the
    form does not offer yet; the pool footer counts thirteen spec fields.
- **Lab.** `pnpm e2e:cluster:up` cannot re-apply a changed snapshot fixture on
  a cluster that holds it (the spec is immutable since v0.16.0): recreate the
  cluster (TESTING.md, TRY-IT.md).
- **Validation (2026-10-20).** On the v0.18.0 lab: integration 1/1, E2E
  107/107, pre-review 92 PASS / 0 FAIL over 19 views in both themes.

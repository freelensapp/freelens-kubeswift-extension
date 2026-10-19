# SPEC-0019: Alignment to KubeSwift v0.18.0

- **Status:** Approved (all four tiers, Roberto, 2026-10-19)
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
  - On the v0.18.0 lab the CRDs stamp `cpuPinning`, `smtPolicy` and
    `sharedBaseDisk` on a guest class the form creates; the E2E case reads
    them back with their defaults. Every other fixture and case passed on the
    new CRDs unchanged.

# SPEC-0002: Read-only views for the remaining M1 core CRDs

- **Status:** Verified (merged; the non-regression suites run green in CI on
  main)
- **Milestone:** M1
- **KubeSwift version reviewed:** v0.13.12
- **Author / date:** Claude with Roberto, 2026-08-27

## Goal

An operator sees, alongside the SwiftGuest views from SPEC-0001, the other
core workload resources of KubeSwift: guest classes, guest pools, images,
seed profiles, and kernels, each with a list page and a detail panel.

## Upstream reference

kubeswift-ui explorer/drawers (`pool-drawer`, `image-drawer`,
`kernel-drawer`). KubeSwift docs: `docs/crds.md` sections for
SwiftGuestClass, SwiftGuestPool, SwiftImage, SwiftSeedProfile, SwiftKernel.
Schemas: `config/crd/bases/swift.kubeswift.io_swiftguestclasses.yaml`,
`swift.kubeswift.io_swiftguestpools.yaml`,
`image.kubeswift.io_swiftimages.yaml`,
`seed.kubeswift.io_swiftseedprofiles.yaml`,
`kernel.kubeswift.io_swiftkernels.yaml`. Visual and domain reference only;
no code copying (AGPL boundary, see ARCHITECTURE.md).

## Scope

Included: typed models (full schema), list pages, detail panels, and
sidebar entries for the five CRDs above, following the SPEC-0001 pattern.

Excluded: any write action (M6), SwiftGuestPool scale action (M6), image
upload flows. Column choices below are a starting point: the implementation
verifies every field against the CRD schema (the schema wins over this spec
and over docs/crds.md) and records deviations in this file.

## Design

Common: one model file per CRD in `src/renderer/api/kubeswift/`, statics
pattern, full spec/status typed; pages and details follow the SwiftGuest
files; conditions via the host `KubeObjectConditionsDrawer` where the CRD
has conditions; "N/A" fallbacks for missing status fields.

- **SwiftGuestClass** (cluster-scoped, short `sgc`): list Name, CPU,
  Memory, Disk, Age. Detail: full resource template and any policy fields
  the schema defines.
- **SwiftGuestPool** (namespaced, `sgpool`): list Name, Namespace, Desired,
  Ready, Age. Detail: replica counts, guest template summary (refs), rollout
  state, conditions.
- **SwiftImage** (namespaced, `si`): list Name, Namespace, Source (concise:
  registry/URL/PVC per schema), Ready/Phase, Age. Detail: source spec,
  size/format fields if present, status.
- **SwiftSeedProfile** (namespaced, `ssp`): list Name, Namespace, Age.
  Detail: summary of the cloud-init configuration structure. Do not dump
  raw user-data verbatim in a table; render it as a read-only code block
  (it may embed credentials — display is fine, but no truncation surprises
  and no logging of its content).
- **SwiftKernel** (namespaced, `sk`): list Name, Namespace, Artifact (OCI
  ref), Age. Detail: OCI artifact, default cmdline, initramfs info, status.

Sidebar: children of the existing "kubeswift" parent, order: SwiftGuests,
Guest Classes, Guest Pools, Images, Seed Profiles, Kernels.

## Tests (non-regression list)

- Unit: one test file per model, following
  `swiftguest-v1alpha1.test.ts` (construction from fixture, helpers,
  empty/missing status). Target: comparable coverage per CRD.
- Integration: harness keeps asserting install + activation (extending to
  page assertions is tracked as an M1 follow-up together with SPEC-0001).
- E2E: `e2e/__tests__/kubeswift-e2e.tests.ts`, one case per CRD, each
  asserting the fixture rows and one detail panel: "lists the
  SwiftGuestClasses with their sizing" (CPU, memory, root disk), "lists the
  SwiftGuestPools with desired and ready replicas" (a pool mid-rollout,
  desired 3 and ready 2), "lists the SwiftImages with their source and
  phase" (OCI reference, `Ready`, prepared size), "lists the
  SwiftSeedProfiles without leaking their content" (datasource and
  `Inline`, never the user data itself) and "lists the SwiftKernels with
  their artifact and node progress" (artifact, profile, `Ready`, `1/1`).
  Fixtures: `e2e/fixtures/`.
- Manual verification: none for fixture-based rendering; real-cluster
  behavior stays in the known manual-only areas (TESTING.md).

## Notes and deviations

Recorded during implementation. The CRD schemas were read from
`kubeswift-io/kubeswift` `main` on 2026-08-27; where they disagree with the
Design section above or with `docs/crds.md`, the schema wins and the
difference is listed here.

### Cross-cutting

- Sidebar labels use the plural CRD kind (SwiftGuestClasses, SwiftGuestPools,
  SwiftImages, SwiftSeedProfiles, SwiftKernels) instead of the friendlier
  names used in the Design section, so that every entry matches the existing
  SwiftGuests one and the names `kubectl` prints. The order is the one the
  spec asks for.
- Every quantity in these schemas is `x-kubernetes-int-or-string`, so a bare
  number is as valid on the wire as a string. The models share a `Quantity`
  type and a `formatQuantity` helper instead of assuming strings.
- Fields the schema declares without an `enum` stay plain strings in the
  models, as in SPEC-0001, so an unexpected value from a cluster cannot break
  a view.
- 2026-08-28: header cells gained explicit column ids to enable the host's
  column resizing (issue #27).

### SwiftGuestClass

- The CRD declares no status subresource at all: no phase, no conditions, so
  the detail panel has no conditions drawer.
- There is no flat `disk` field: the Disk column is `spec.rootDisk.size`, and
  `spec.rootDisk.format` is a required sibling shown in the detail panel.
- The schema has two fields `docs/crds.md` does not document: `coreScheduling`
  (`off`, `vm`, `vcpu`, defaulted to `off`, with an empty value documented as
  equivalent to `off`) and `storage` (`accessMode`, `volumeMode`,
  `storageClassName`), the cluster default for the PVCs the SwiftGuest
  controller creates. Both are in the detail panel.
- `docs/crds.md` says the root disk format is `raw` only at runtime, but the
  schema enum allows `raw` and `qcow2`; the model follows the enum.
- The published printer columns are CPU, Memory, AccessMode and VolumeMode.
  The list keeps the columns of this spec (Name, CPU, Memory, Disk, Age):
  neither storage field has a schema default, so both are empty on most
  classes and are more useful in the detail panel.

### SwiftGuestPool

- `spec.template.spec` is the SwiftGuest spec schema verbatim (compared
  property by property against `swift.kubeswift.io_swiftguests.yaml`), and so
  is `spec.topologySpreadConstraints`. The model reuses `SwiftGuestSpec` and
  `SwiftGuestTopologySpreadConstraint` rather than restating them, which keeps
  the two in step by construction.
- `status.serviceRef` is a plain Service name, not an object reference.
- The list shows the replica counters the CRD publishes as printer columns
  (Desired, Ready, Updated, Available, Failed) instead of the Desired/Ready
  pair of this spec, so it reads like `kubectl get swiftguestpools`. Service
  is a priority-1 printer column, that is wide output only, and stays in the
  detail panel.
- `spec.updateStrategy.rollingUpdate` requires both `maxSurge` (default 0) and
  `maxUnavailable` (default 1) once the struct is present.
- `spec.volumeClaimTemplates` are full PVC templates (access modes, resources,
  data sources, selector, volume attributes class). The detail panel
  summarizes each one as size, storage class and volume mode.
- The CRD has a `scale` subresource. Scaling stays out of scope, as M6.

### SwiftImage

- The source has four variants, not the two `docs/crds.md` documents: `http`,
  `oci`, `pvcClone` and `upload`. `upload` is an empty placeholder the schema
  itself marks as not yet implemented, so the views report it as a source kind
  without a reference.
- The OCI variant carries `repository` plus `tag` or `digest` (mutually
  exclusive), `insecure`, `credentialsSecretRef` and `verifyKeySecretRef` (a
  cosign public key). The list renders the reference as `repository:tag` or
  `repository@digest`; the detail panel links both Secrets.
- The schema has four more fields absent from `docs/crds.md`: `cloneStrategy`
  (`copy` by default, `snapshot`), `cloneStorageClassName`,
  `importStorageClassName` and `volumeSnapshotClassName`, plus `osType`
  (`linux` by default, `windows`).
- `status.phase` includes `Snapshotting`, which `docs/crds.md` omits.
- `status.cloneSeed` describes the VolumeSnapshot per-guest cloning references
  under the snapshot strategy; it is shown only when present.
- `status.sizeHint` is documented as an internal hand-off between phases, so
  it is typed but never displayed.
- The list adds Size, a published printer column. Format and Strategy are
  priority-1 printer columns and stay in the detail panel. The "Ready/Phase"
  column of this spec is `status.phase`, so the column is Phase.

### SwiftSeedProfile

- The CRD declares no status subresource: no conditions drawer here either.
- `spec.datasource` is required and its enum has exactly one value,
  `NoCloud`. The schema also enforces, in CEL, that a profile sets either
  `userData` or `userDataFrom`.
- The list gains two columns over the Name/Namespace/Age of this spec:
  Datasource (a published printer column) and User Data, which reports only
  where the document comes from (Inline, Secret or ConfigMap). No cloud-init
  content ever reaches a table cell.
- User-data, meta-data and network-data are rendered as read-only code blocks
  in the detail panel, in full and without truncation, and are never logged.
  The host `MonacoEditor` was considered and set aside: a read-only display
  needs no editor, and its behavior inside a details drawer cannot be verified
  without a real cluster.
- `metaData` is optional in the schema but defaulted by the controller, not by
  the API server. The panel reports it as not set rather than showing a
  default the object does not carry.
- The `name` of the Secret and ConfigMap key selectors has a schema default of
  the empty string, inherited from the upstream Kubernetes types, so the model
  types it as optional.

### SwiftKernel

- `spec.ociRef.image` is required; `pullSecret`, `profile` and `kernelCmdline`
  are optional.
- The only initramfs information the status carries is `initramfsDigest`, a
  content digest. The on-node artifact paths are computed at runtime and,
  as the documentation states, never stored in the status, so the views do not
  show them.
- The list adds Profile and Phase (both published printer columns) and Nodes
  to the Name/Namespace/Artifact/Age of this spec. Nodes is the ready over
  reported ratio from `status.nodeStatuses`: the controller only pulls onto
  the nodes labelled for kernel boot, so the total is the number of candidate
  nodes and not the size of the cluster.

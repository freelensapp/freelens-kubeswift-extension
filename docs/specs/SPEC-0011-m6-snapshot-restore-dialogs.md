# SPEC-0011: Snapshot and restore dialogs (M6)

- **Status:** Approved (Roberto, 2026-08-30, in chat)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (latest release, 2026-08-24;
  the three `snapshot.kubeswift.io` CRD manifests are byte-identical at
  upstream `main` `d66cff5`, so there is no unreleased schema drift either;
  controller, webhook, `swiftctl` and docs recon run at `d66cff5` on
  2026-08-30). UX reference kubeswift-ui `main` `c4e53ce` (2026-08-30).
- **Author / date:** Claude with Roberto, 2026-08-30

## Goal

An operator can take a snapshot of a SwiftGuest and restore a SwiftSnapshot -
in place over the guest it came from, or as a clone under a new name - from
inside Freelens, without hand-writing YAML for either. Both verbs are dialogs
that build one `create` each, enumerate that write and its consequences from
live facts before anything happens, refuse nothing the cluster would accept,
and warn about everything the cluster would accept and then regret.

This is the extension's **first create surface**. SPEC-0010 established the
write ground rules (DESIGN.md section 12) on two patches and a delete; this
spec applies them to object creation, where the confirmation has to carry a
form, and settles that pattern for the remaining M6 rows (creation forms,
migration dialog, sandbox creation).

## Upstream reference

- `config/crd/bases/snapshot.kubeswift.io_swiftsnapshots.yaml` and
  `_swiftrestores.yaml` at `v0.13.12` (byte-identical at `main`): required
  fields, schema defaults, enums, printer columns, status subresources.
  Neither file carries a single `x-kubernetes-validations` rule - every
  cross-field rule lives in the validating webhook.
- `internal/webhook/swiftsnapshot/validator.go` and
  `internal/webhook/swiftrestore/validator.go` - read to establish the
  admission rules this spec mirrors client-side. There is **no mutating
  webhook** for either kind (`config/webhook/mutating-webhook.yaml` registers
  guest, image and seedprofile only): every default the dialogs rely on is a
  schema default. And the validating webhook itself ships **disabled by
  default** (`charts/kubeswift/values.yaml`, `webhook.enabled: false`), so on
  a default install the admission messages this spec cites never fire and the
  same mistakes surface later, as a `Failed` phase or as a permanent
  `Pending`. That fact drives more of this design than any other.
- `internal/controller/swiftsnapshot/` and `internal/controller/swiftrestore/`
  plus `rust/swiftletd/src/action.rs` - read to establish what a snapshot
  capture and a restore mechanically are: what pauses, what is killed, what
  is copied, what is left behind, and which states park forever instead of
  failing.
- `cmd/swiftctl/snapshot.go`, `restore.go`, `snapshot_manifest.go`,
  `guest_coldmig.go` - the CLI baseline. It never reads an object before
  writing, never waits, defaults the backend to `csi-volume-snapshot`, and
  refuses `s3`/`oci` outright; `ttl`, `deletionPolicy`, `includeDisk`,
  `targetNode` and `memoryRestoreMode` are not exposed at all.
- `docs/snapshots/` (all pages), `docs/crds.md`, `docs/swiftctl.md` - the
  promises. The recon found substantial doc/code drift, recorded under
  "Upstream drift found by this recon".
- kubeswift-ui `main` `c4e53ce`, `src/app/snapshot-dialog/`,
  `restore-dialog/`, `snapshot-detail/`, `guest-detail/` - visual and UX
  reference only, for which fields exist, how they are gated, and what is
  confirmed. No string, no component, no mapping logic is taken from it
  (AGPL boundary, see [ARCHITECTURE.md](../development/ARCHITECTURE.md)).

Freelens host references (MIT, at the pinned `v1.10.3`):
`confirm-dialog/`, `dialog/`, `input/` under
`packages/core/src/renderer/components/`, `KubeObjectStore.create`,
`kube-object-menu/`, and the SPEC-0010 implementation in this repository,
whose machinery (menu registration, guard shape, `ConfirmDialog.open`,
`Notifications.checkedError`) is reused wholesale.

## Scope

This spec covers **one** of the remaining five M6 rows: the "Snapshot now /
restore dialogs" row. Two verbs:

1. **Take Snapshot** on a SwiftGuest, from the list row kebab and the drawer
   toolbar: a dialog that builds and creates one SwiftSnapshot.
2. **Restore** on a SwiftSnapshot, from the list row kebab and the drawer
   toolbar: a dialog that builds and creates one SwiftRestore, in place or
   as a clone.

Also included, because the objects these dialogs create carry deletion
semantics a user cannot guess (the SPEC-0010 "On Delete" precedent):

3. **On Delete rows** in the SwiftSnapshot and SwiftRestore drawers, stating
   permanently what deleting each object does and does not destroy. For
   SwiftRestore this discloses the sharpest fact this recon produced:
   deleting a restore that performed a clone **garbage-collects the cloned
   guest** (the controller sets a controller `ownerReference` from the new
   SwiftGuest to the SwiftRestore, `internal/controller/swiftrestore/local.go:678`,
   `csi.go:140`). Upstream documents this nowhere.
4. **The create-dialog pattern**: form and confirmation as one surface, with
   a live write summary (details under "The W1 pattern for creates"), to be
   recorded in DESIGN.md section 12 by the implementation PR.

Excluded, with where each one goes instead:

- **SwiftSnapshotSchedule creation and editing.** A full form with cron,
  retention and concurrency; it belongs to the "creation forms" row.
  kubeswift-ui treats it the same way (its schedule form is a separate
  guided-form surface).
- **`includeDisk: true` (the oci full-state export).** It is not a snapshot:
  the controller force-flips the source guest to `runPolicy: Stopped` and
  deletes its launcher pod with grace 0 to release the root PVC
  (`internal/controller/swiftsnapshot/coldmig.go:87-104`), because the
  feature is a cold migration (`swiftctl guest export` says so: "The source
  is stopped at the snapshot instant and stays down"). Putting that behind a
  checkbox in a dialog titled Take Snapshot would make one control mean two
  verbs, which is the exact reason SPEC-0010 rejected folding Restart into
  Start. It gets its own spec (Export / cold migration) if and when that row
  is wanted; the rejected-candidates table records it.
- **Snapshot and restore deletion.** The host's generic Delete already
  serves both kinds (SPEC-0010, Delete section); this spec adds the drawer
  consequence rows and changes nothing about the verb itself.
- **A migration dialog, sandbox creation, guest creation.** Their own rows.
- **In-dialog Secret creation** (for s3/oci credentials). The dialogs
  reference existing Secrets; creating one is the host's own New resource
  editor's job.
- **Progress reporting for a running capture or restore.** The list and
  drawer views from SPEC-0004 already render phases and sizes live; the
  dialog's job ends when the API server accepts the create (W2). What the
  views cannot show - pause-window duration promises - this spec refuses to
  invent (see the rejected-candidates table).

## Design

### What creating a SwiftSnapshot actually does

The schema does not say; the controller and swiftletd do. Facts the dialog
is built on, each with its source:

- **The backend decides the contents; `includeMemory` decides nothing.** The
  captured set is backend-determined and the field is a documented no-op on
  every backend (`api/snapshot/v1alpha1/swiftsnapshot_types.go:183-191`,
  advisory warning at `internal/webhook/swiftsnapshot/validator.go:105-110`).
  `csi-volume-snapshot` captures the root disk only, crash-consistent, and
  **never pauses the VM** (`docs/snapshots/csi-snapshots.md:7`); `local` and
  `s3` capture memory and device state on top of the guest's existing disk
  (no disk copy: `status.disks` stays empty); `oci` captures memory and
  pushes it to a registry. SPEC-0004's Contents derivation already encodes
  exactly this, and the dialog reuses it.
- **A memory capture pauses the VM for the whole write.** swiftletd calls
  `pause`, writes the snapshot, then `resume`
  (`rust/swiftletd/src/action.rs:1841-1866`). The guest is unresponsive on
  the network for the entire window; upstream's own measurements disagree
  with each other (2.8 s/GiB, 0.16 s/GiB and 2.5 s/GiB across three docs
  pages), so the dialog states the pause and its shape - seconds, growing
  with guest RAM - and promises no number. The measured window lands in
  `status.observedPauseWindowMs` afterwards, which our drawer already shows.
- **`resumeAfterSnapshot: false` leaves the VM paused forever.** swiftletd
  skips the resume and returns; the snapshot still reaches `Ready`; nothing
  anywhere ever resumes the guest (`action.rs:1865-1888`). The phase stays
  `Running` while the vCPUs are frozen. This is the single most dangerous
  checkbox in the dialog and it is labelled accordingly.
- **A memory capture of a not-running guest does not fail - it parks.** The
  controller requires a launcher pod in `Running`; otherwise the snapshot
  sits in `Pending` (`Ready=False`, reason `GuestNotFound` or
  `GuestNotReady`) and requeues every 5 s forever
  (`internal/controller/swiftsnapshot/local.go:119-136`). There is no
  deadline until `Capturing` is reached. A dialog that let a user snapshot a
  stopped guest with a memory backend would create an object that never
  resolves and never explains itself.
- **A csi snapshot of a `Stopped` guest is legitimate** - the root PVC is
  populated and the controller accepts `Running` or `Stopped`
  (`controller.go:352-359`); every other phase parks in `Pending` with
  reason `GuestNotReady` until the guest settles.
- **The webhook (when enabled) rejects memory captures of guests it cannot
  pause safely**: a `gpuProfileRef`, an SR-IOV interface, or the
  `kubeswift.io/hypervisor-override: qemu` annotation
  (`validator.go:160-175`). With the webhook off (the default) the same
  snapshot is admitted and fails or wedges later. The dialog enforces the
  same three rules client-side, with the reason.
- **Backend field rules** (all webhook-side, all mirrored client-side
  because the webhook is off by default): `local` requires `hostPath` under
  `/var/lib/kubeswift/snapshots/` with no `..` (`validator.go:292-307`);
  `s3` requires `bucket` and `credentialsSecretRef.name`, and `region`
  unless `endpoint` is set (`:243-259`); `oci` requires `repository`, and
  its `tag` must be a bare tag - no `:`, `@` or `/` (`:265-285`). Carrier
  sub-objects are mutually exclusive with the other types' (`:219-227`).
- **A reused `hostPath` destroys the previous artifacts.** Before capturing,
  swiftletd wipes the destination directory (`remove_dir_all`,
  `action.rs:1826-1834`), so two snapshots pointing at one path means the
  second capture silently destroys the first's data while the first object
  still reads `Ready`. The extension can see this coming - the snapshot
  store holds every SwiftSnapshot in the namespace - and warns.
- **`ttl` is a Go duration.** The field is a bare string in the schema but
  deserializes to `metav1.Duration`, so `30m` and `72h` parse and `7d` is
  rejected - by the API server's decoder, with a message no user should have
  to read. The dialog validates the format and says why days do not work.
- **`deletionPolicy` does not mean what it says on two backends.** On
  `csi-volume-snapshot` the artifact's fate belongs to the
  VolumeSnapshotClass and `Retain` is ignored (webhook advisory,
  `validator.go:95-100`); on `oci` there is **no cleanup path at all** - the
  finalizer dispatcher covers `local` and `s3` only
  (`internal/controller/swiftsnapshot/cleanup.go:46-55`) - so registry
  artifacts survive deletion under both policies, silently. The dialog's
  per-backend note and the drawer's On Delete row both say so.
- **Nothing owns a hand-created snapshot.** The controller sets owner
  references outward (to VolumeSnapshots, cleanup pods, upload jobs), never
  on the SwiftSnapshot itself; only schedule-created snapshots get an owner.
  A manual snapshot survives its guest's deletion, which is what SPEC-0010's
  On Delete row for guests already tells the user from the other side.
- **The spec is immutable after creation** (`validator.go:70-72`), with
  deliberate holes (`deletionPolicy`, and unvalidated: `backend.s3`,
  `backend.oci`, `includeDisk`, `ttl`). The dialogs only ever create;
  editing is the YAML editor's job.

### What creating a SwiftRestore actually does

- **In-place means: kill and replace.** In-place is target name equal to the
  snapshot's source guest **and** an empty `identity.regenerate`
  (`internal/controller/swiftrestore/local.go:201-209`). With
  `overwriteExisting: true` the controller merge-patches restore annotations
  onto the live guest and **deletes its launcher pod with
  `gracePeriodSeconds: 0`** (`local.go:637-650`; the code comment is candid:
  the operator opted in). There is no phase precondition and no graceful
  shutdown; everything not in the snapshot's memory image is lost. The
  guest's spec and disks are untouched - the memory state is restored on top
  of the existing root disk.
- **In-place on a csi snapshot restores nothing.** The csi path returns
  early when the PVC and the guest already exist
  (`csi.go:64-69`, `:124-128`); the SwiftRestore marches to `Ready` having
  changed nothing. A verb that succeeds while doing nothing is exactly what
  W4 calls a dead control, so the dialog disables the in-place option for
  csi snapshots, with that sentence as the reason.
- **An in-place restore of a `Stopped` guest wedges.** The restore path
  never touches `spec.runPolicy` on the existing guest; with the policy
  `Stopped` the guest controller will not recreate the launcher pod, and the
  restore waits in `Restoring` forever ("waiting for target SwiftGuest to
  bind CH socket", `local.go:388-390`) - there is no timeout on the restore
  side. The dialog reads the live guest and warns before the click.
- **A clone copies the source guest's current spec, not the captured one.**
  `ensureCloneTargetGuest` builds the new guest from `source.Spec` as it is
  at restore time (`local.go:682`) and - on the memory backends - boots the
  snapshot's memory on a **fresh image-cloned disk**, not a copy of the
  source's disk (`internal/controller/swiftguest/restore.go:36-43`). Both
  facts are stated in the dialog: a source guest edited since the capture
  produces a clone with the edited spec, and filesystem state newer than
  the image is not in the clone.
- **The clone belongs to the restore.** The new SwiftGuest carries a
  controller `ownerReference` to the SwiftRestore (`local.go:678-680`,
  `csi.go:140-142`; the restore controller `Owns()` guests, PVCs and jobs).
  **Deleting the SwiftRestore later garbage-collects the cloned guest**, and
  on the csi path its restored root PVC too. Undocumented upstream; the
  dialog says it once at create time and the drawer's On Delete row says it
  permanently.
- **The source guest must still exist, on every backend** - the memory tail
  needs its spec, and the csi path checks too (`local.go:296-305`,
  `controller.go:288-295`). A restore whose source guest is gone goes
  `Failed`/`SourceGuestGone`. The dialog reads the guest store and warns
  when the source is already missing.
- **Identity regeneration has two real knobs, not four.** `macAddresses`
  maps to a deterministic per-NIC MAC rewrite annotation; `hostname`,
  `machineId` and `sshHostKeys` collapse into **one** marker annotation that
  appends `kubeswift.clone=true` to the kernel cmdline and relies on
  in-guest cloud-init to do the work (`local.go:539-548`,
  `internal/controller/swiftguest/restore.go:86-91`). Rendering four
  checkboxes would promise a granularity the implementation does not have.
- **The MAC rule is the likeliest rejection.** Cloning a memory snapshot to
  a different name requires `macAddresses` in `identity.regenerate`
  (webhook `validator.go:157-162`; the controller re-checks and fails,
  `local.go:281-291`). The dialog pre-selects and locks it in exactly that
  case, with the rule as the explanation.
- **`targetGuest.name == snapshotRef.name` is rejected as a typo**
  (webhook `validator.go:72-76`). Validated inline.
- **A restore against a not-Ready snapshot waits, it does not fail** -
  `Pending`/`SnapshotNotReady`, requeued every 10 s forever
  (`controller.go:206-211`). Except a `Failed` snapshot, which is terminal
  and will never become Ready: a restore from it waits forever by
  construction, so the action is disabled there, with that as the reason.
- **`targetNode` is required exactly when the controller cannot infer a
  node**: an `s3` or `oci` restore whose target guest does not exist yet
  and names no node goes `Failed` with an explicit message
  (`s3.go:97-119`; the oci path calls the same resolver, `oci.go:76`, and
  its failure message says "s3 restore" - recorded as upstream feedback).
  `local` restores are pinned to the capture node; `csi` ignores the field.
  The dialog shows a node picker only where the field means something, and
  computes required-ness from the same live facts.
- **`memoryRestoreMode` only exists on the memory tail.** Only `ondemand`
  is ever propagated (`copy` is the hypervisor default; `local.go:528-530`),
  it needs Cloud Hypervisor v52+, and on a csi restore it is silently
  ignored. Shown only for memory snapshots.
- **`resumeAfterRestore: false` behaves differently per backend, and on the
  memory tail it looks broken.** The csi path has an explicit skip-to-Ready
  branch; the memory tail forces the clone to `runPolicy: Stopped`, which
  means no launcher pod, which means `handleResumingLocal` waits forever -
  the code comment claims the flag is consulted there and it is not
  (`local.go:684-699` vs `:407-498`). The dialog keeps the checkbox (a
  stopped clone is a legitimate DR shape) and carries a warning line on the
  memory tail, and the finding is a candidate upstream issue.
- **Failure is a phase, never an event.** Neither controller wires an
  EventRecorder; `status.phase` plus one `Ready` condition is the entire
  observable surface. Our SPEC-0004 views already render both, which is
  what makes "create and watch it in the list" an honest answer.

### The W1 pattern for creates

SPEC-0010's dialogs confirm a fixed set of writes. A create needs input
first, and stacking a second confirmation modal on top of a form would be
ceremony, not safety. The pattern this spec sets, to be recorded in
DESIGN.md section 12 by the implementation PR:

**The form is the confirmation.** One dialog per verb. The top is the form;
the bottom is a live **write summary** - the same enumerated-writes block W1
requires, rebuilt from the current field values on every change: the one
`Create SwiftSnapshot <ns>/<name>` line, followed by the consequence lines
that apply to this object in this state (the same conditional-fact style as
SPEC-0010's Stop dialog). The OK button carries the verb (`Take Snapshot`,
`Restore`), stays disabled while a required field is missing or invalid -
with the reason next to the field, never a mute grey button (the W4
sentence applies to submit buttons too) - and uses `ConfirmDialog.open`'s
in-flight behaviour via the same machinery SPEC-0010 proved (or the host
`Dialog` directly, see spike T1). Validation failures the webhook would
produce are rendered inline at the field, before submit, because on a
default install there is no webhook to produce them.

No-op dropping (W1) appears here as **option dropping**: a field whose value
would change nothing for the chosen backend is not rendered at all
(`resumeAfterSnapshot` for csi, `memoryRestoreMode` for csi restores,
`targetNode` where it is ignored), rather than rendered and ignored, which
is upstream's shape and the reason its two forms contradict each other
about `includeMemory`.

Everything else is SPEC-0010 unchanged: live facts at click time, one cheap
read on open where it makes a fact certain, no optimistic UI, explicit
`try`/`catch` in `ok` with `Notifications.checkedError` and per-site
fallbacks, 403/404 prefix sentences, success toast naming the fact written.

### Take Snapshot

**Registration.** `kubeObjectMenuItems` for `SwiftGuest.kind`, title
`Take Snapshot`, Material ligature `photo_camera`, test id
`swiftguest-take-snapshot-action`, both surfaces from one registration
(W5). Absent when the guest carries a `deletionTimestamp` (SPEC-0010 rule).

**Guard.** Always enabled otherwise - there is a valid snapshot for every
settled guest state (csi accepts `Running` and `Stopped`), and for the
unsettled ones creating early is safe: the object waits in `Pending`. The
gating that matters is per-backend and lives inside the dialog, where the
backend choice exists (a menu-item guard cannot see a field the user has
not chosen yet). The guard function still exists and still returns
`{ enabled, reason }` - it owns the `deletionTimestamp` absence and keeps
the unit-test shape uniform.

**Fields**, with their write targets:

| Field | Widget | Default | Notes |
| --- | --- | --- | --- |
| Name | text | `<guest>-<yyyymmdd-hhmmss>` | Collision-checked live against the snapshot store; a colliding name warns inline but does not block (the store can be stale; the API server is the authority, and the 409 path is W9's job) |
| Backend | select: csi-volume-snapshot / local / s3 / oci | `csi-volume-snapshot` | The `swiftctl` default, and the only backend that neither pauses the VM nor needs credentials. Each option carries its Contents reading (SPEC-0004 derivation) and its pause consequence |
| VolumeSnapshotClass | text, csi only | empty | Empty means the cluster default class |
| Host path | text, local only | empty | Required; validated against the `/var/lib/kubeswift/snapshots/` prefix and the `..` rule client-side; warns when another SwiftSnapshot in the namespace already uses the same path (the capture wipes the directory) |
| Bucket / Region / Endpoint / Prefix / Credentials secret / Path-style / Insecure | s3 only | empty | `bucket` and the credentials secret name required; `region` required unless `endpoint` is set - the exact webhook rules, enforced inline. The credentials secret is a picker over the namespace's Secrets when the store answers cheaply (spike T3), a text input otherwise |
| Repository / Tag / Credentials secret / Signing key secret / Insecure | oci only | empty | `repository` required; `tag` validated as a bare tag (no `:` `@` `/`); empty tag noted as defaulting to `<namespace>-<name>` server-side |
| Resume after capture | checkbox, memory backends only | checked | Unchecking swaps the summary line for the frozen-VM warning below |
| Deletion policy | select Delete / Retain | Delete | With the per-backend truth as the option note: ignored on csi (the VolumeSnapshotClass governs the artifact), meaningless on oci (artifacts are always retained) |
| TTL | text, optional | empty | Go-duration validated inline; the error names the accepted units and that days are not one of them |

Not rendered, with the reason recorded here: `includeMemory` (a documented
no-op; the derived Contents line says what is actually captured, which is
more than upstream's checkbox says and cannot contradict itself),
`includeDisk` (a different verb - see Scope), `spec.backend.local` for
non-local types and the other carrier exclusivity cases (impossible to
express in this form by construction).

**Per-backend gating inside the dialog**, each disabled option carrying its
reason (W4):

| Situation | Memory backends (local / s3 / oci) | csi |
| --- | --- | --- |
| Guest `Running` with a recorded launcher pod | enabled | enabled |
| Guest `Stopped`, or no launcher pod recorded | disabled: a memory capture needs the running VM; upstream would park this snapshot in `Pending` forever, not fail it | enabled |
| Guest `Pending` / `Scheduling` / `Failed` | disabled: same reason | enabled, with a summary line saying the snapshot will wait in `Pending` until the guest settles |
| Guest has a GPU profile, an SR-IOV interface, or the qemu override | disabled: upstream cannot pause this guest safely (its own admission rule, enforced here because the webhook ships disabled) | enabled |

**The write summary**, one `Create SwiftSnapshot <ns>/<name>` line plus the
conditional facts, each rendered only when true of this object:

- What is captured, from the backend (the Contents derivation), and where
  it lands (the class, the path, the bucket, the repository).
- **The VM pauses for the whole capture** (memory backends): unresponsive on
  the network, a window that grows with guest RAM, measured afterwards in
  the drawer's pause-window row. No number is promised; upstream's three
  published figures disagree by an order of magnitude.
- **The VM stays paused indefinitely** when Resume after capture is
  unchecked: nothing in the cluster ever resumes it, and the snapshot will
  still read `Ready`. Rendered in the warning style; this line is the
  checkbox's cost made visible at the moment it is chosen (the B6
  precedent).
- **The snapshot will wait** (csi, guest unsettled): created now, captured
  when the guest reaches `Running` or `Stopped`.
- **Deletion note** for the chosen policy on this backend, when the policy
  will not do what its name says (csi and oci cases).

`labelOk: "Take Snapshot"`, default button styling - a snapshot is not
destructive. The exception: with Resume after capture unchecked the button
switches to the accent styling Stop uses, because that combination
terminates service until a human intervenes.

**Outcome** (W9). `Notifications.ok`: "SwiftSnapshot `<name>` created". The
toast matters here more than anywhere so far: fired from the Guests page,
the created object is not on screen at all - its row exists on the
Snapshots page, where the watch delivers it. Failure: `checkedError` with
the per-site fallback; the 409 an ignored collision warning produces
arrives here as the API server's own AlreadyExists message with the W9
prefix.

### Restore

**Registration.** `kubeObjectMenuItems` for `SwiftSnapshot.kind`, title
`Restore`, Material ligature `settings_backup_restore`, test id
`swiftsnapshot-restore-action`, both surfaces (W5). Absent on
`deletionTimestamp`.

**Guard.** Disabled when `status.phase` is `Failed`, with the reason: the
phase is terminal, the snapshot will never become `Ready`, and a restore
created from it waits in `Pending` forever by upstream's own construction.
Every other phase is enabled - a not-yet-Ready snapshot is a legitimate
early restore, and the summary says it will wait. (Upstream gates nothing
here; its Restore button is live on a `Failed` snapshot.)

**Mode is an explicit choice**, the first control in the dialog: **Restore
in place** over the source guest, or **Clone** to a new guest. Upstream
infers the mode from whether the typed name happens to equal the source
guest's, surfaces it as a hint, and hides the overwrite consent on the path
where a typo silently turns one mode into the other. An explicit control
costs one radio row and removes the whole failure class.

- **In place**: the target name is fixed to the source guest's name and not
  editable; `overwriteExisting: true` is set by the dialog and named in the
  write summary (it is the consent field, and the consent is this dialog).
  Disabled - with reasons, W4 - when the snapshot's backend is csi (the
  in-place path verifiably restores nothing and marches to `Ready`), and
  when the source guest no longer exists (nothing to restore over; the
  clone path is offered instead).
- **Clone**: target name text, default `<source-guest>-restore-<hhmmss>`,
  validated inline against the webhook's typo rule (name equal to the
  snapshot's is rejected) and collision-checked against the guest store
  (warn, not block - same stance as the snapshot name).

**Fields beyond mode and name:**

| Field | Widget | Shown when | Default | Notes |
| --- | --- | --- | --- | --- |
| Regenerate machine identity | checkbox | clone | checked | One checkbox for the hostname / machine-id / SSH-host-keys trio, labelled as such, with the honest caveat that the work happens in-guest via cloud-init and needs a seed profile that cooperates. Three checkboxes would promise granularity upstream does not have |
| Rewrite MAC addresses | checkbox | clone | checked | Pre-selected and **locked** when the snapshot captures memory (the webhook rule; the lock's tooltip cites it). Free on csi clones |
| Memory restore mode | select copy / ondemand | memory snapshots | copy | `ondemand` noted as needing Cloud Hypervisor v52+ |
| Resume after restore | checkbox | always | checked | On the memory tail, unchecking adds the recorded-upstream-hang warning line (see below) |
| Target node | node picker (spike T3; text fallback) | s3 / oci snapshots | empty | Required-ness computed live: required when the target guest does not exist (the controller fails without it), optional and annotated "defaults to `<node>`" when the target exists with a node |

**The write summary**, one `Create SwiftRestore <ns>/<name>` line plus the
mode's facts:

In place:

- The launcher pod of `<guest>` is **deleted with no grace period** and the
  VM's memory is replaced by the snapshot's; there is no graceful shutdown,
  and everything since the capture is lost. The guest's spec and disks are
  untouched. (The one cheap read on open, B3-style: the guest from its
  store, so the summary names its live phase and pod.)
- **This restore will wedge** when the live guest's `runPolicy` is
  `Stopped`: the restore never touches the policy, the controller will not
  recreate the pod, and upstream waits in `Restoring` with no timeout. The
  line names the fix (start the guest first) - a warning, not a block,
  because the policy can change between this dialog and the reconcile.

Clone:

- A new SwiftGuest `<name>` is created **from the source guest's current
  spec** - not the spec captured in the snapshot - and, on memory
  snapshots, boots the captured memory **on a fresh disk cloned from the
  image**, so filesystem changes since the image are not in it. Both
  sentences render only on the paths where they are true.
- **The clone's life is tied to this SwiftRestore**: deleting the restore
  object later deletes the cloned guest with it (and, on csi, its restored
  disk). The drawer's On Delete row repeats this permanently.
- The clone starts `Running` (or `Stopped` with Resume after restore
  unchecked); the source guest's own policy is not inherited on the memory
  tail.

Both modes, conditionally:

- **Will wait**: the snapshot is `<phase>`, not `Ready`; the restore sits
  in `Pending` until it is.
- **Source guest is gone**: rendered when the guest store has no
  `<source>`; upstream fails this restore (`SourceGuestGone`) on every
  backend. A warning, not a block - the store may be stale.
- **Hang risk on the memory tail with resume unchecked**: recorded upstream
  behaviour is a restore that never leaves `Restoring`; the clone exists and
  stays `Stopped`. Offered anyway (the stopped-clone DR shape is real), but
  never silently.

`labelOk: "Restore"`. Accent styling for the in-place mode (it terminates a
running workload, the Stop precedent exactly); default styling for a clone.

**Outcome** (W9). `Notifications.ok`: "SwiftRestore `<name>` created" -
again fired from a page that does not show the created row; the Restores
page does, live, phase by phase, which is more than upstream offers for
this object (it has no restore surface at all: the object it creates is
invisible in its own UI). Failures: `checkedError`, W9 prefixes, the
webhook's or controller's own words.

### On Delete rows

The SPEC-0010 Delete stance, applied to the two kinds this spec creates:
the host's Delete stays the host's; the extension states the consequences
permanently in the drawer, where it owns the surface.

- **SwiftSnapshot drawer**: what the policy will and will not purge, from
  this object's own backend - the hostPath directory or the S3 prefix goes
  (policy `Delete`) or stays (`Retain`); on csi the VolumeSnapshot goes
  with the object and the underlying content follows the
  VolumeSnapshotClass, not this field; on oci the registry artifacts stay
  **regardless of the policy**. Plus one fact from the retention machinery:
  an operator delete is never blocked, even mid-restore - upstream's
  reference guard protects TTL and keep-N reaping only
  (`retention.go:86-109`), so deleting a snapshot a restore is using makes
  that restore fail on its next reconcile.
- **SwiftRestore drawer**: for a clone restore, the restored guest (named,
  linked - `status.guestRef` when set, the target name before that) **is
  deleted with this object**, csi restores taking the restored root PVC
  too; for an in-place restore, deleting the object deletes nothing else.
  Rendered from the object's own mode, the same computed-not-abstract rule
  as SPEC-0010's guest On Delete row.

### Better than upstream

The W11 audit. "Upstream" is kubeswift-ui `c4e53ce` and `swiftctl` at
`d66cff5`; both were read during the recon, neither is copied.

The baseline measured against: upstream's snapshot dialog fires on submit
with no confirmation and no gating - a stopped guest can be
memory-snapshotted into a permanent `Pending`; its default name collides on
the second snapshot of the same guest; its default backend (`local`) omits
the `hostPath` its own webhook requires; its `includeMemory` checkbox
contradicts its own schedule form. The restore dialog infers in-place vs
clone from the typed name, hides the overwrite consent on the clone path,
gates nothing on snapshot phase, exposes neither `memoryRestoreMode` nor
`resumeAfterRestore` nor a node picker, warns about none of the
consequences, and creates an object that is invisible everywhere in its
own UI. Success, in both dialogs, is indistinguishable from cancellation.
`swiftctl` writes without reading, waits for nothing, and cannot express
s3, oci, ttl, deletionPolicy, targetNode or memoryRestoreMode at all.

Adopted:

| # | Improvement | Where |
| --- | --- | --- |
| C1 | Both verbs confirm: the form carries a live write summary enumerating the create and its consequences, rebuilt from live facts (W1) | The W1 pattern |
| C2 | The webhook's rules enforced inline with reasons, because upstream ships the webhook disabled and the errors otherwise arrive late or never | Both dialogs |
| C3 | Memory-backend options gated on the live guest state with the parks-forever fact as the reason, instead of an enabled control that creates a permanent `Pending` | Take Snapshot |
| C4 | The frozen-VM cost of `resumeAfterSnapshot: false` stated at the moment it is chosen, with the accent styling | Take Snapshot |
| C5 | Contents derived from the backend instead of the no-op `includeMemory` checkbox upstream renders (and contradicts itself on) | Take Snapshot |
| C6 | Non-colliding default names, and a live collision warning from the store (warn, never block) | Both dialogs |
| C7 | The hostPath-reuse warning: the capture wipes the directory, and only a client that already holds the namespace's snapshots can see the collision coming | Take Snapshot |
| C8 | `ttl` exposed, with the Go-duration rule explained instead of the decoder's error | Take Snapshot |
| C9 | The per-backend deletion truth on the policy field and permanently in the drawer, including the undocumented oci never-purges gap | Take Snapshot, On Delete |
| C10 | Mode as an explicit control, overwrite consent visible exactly on the path that overwrites | Restore |
| C11 | In-place on csi disabled as a verified no-op; in-place on a stopped guest warned as a verified wedge, with the fix named | Restore |
| C12 | The clone-ownership disclosure: deleting the restore deletes the clone - at create time and permanently in the drawer | Restore, On Delete |
| C13 | Identity regeneration at its real granularity (two knobs), the MAC rule pre-applied and explained where it binds | Restore |
| C14 | `targetNode` as a node picker with live required-ness, `memoryRestoreMode` and `resumeAfterRestore` exposed where they act and hidden where they are ignored | Restore |
| C15 | The current-spec / fresh-disk clone semantics stated before the click | Restore |
| C16 | Success acknowledged, and the created object observable: our Snapshots and Restores pages show its phases live, where upstream has no restore surface at all | Both, SPEC-0004 views |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| An `includeDisk` checkbox (oci full-state export) | A different verb wearing a checkbox: it stops the source guest by force. Cold migration gets its own spec or none (the SPEC-0010 Restart precedent) |
| A pause-window estimate ("about N seconds for this guest") | Upstream's three published figures disagree by 17x; W11's own limit says where the recon cannot confirm, promise less. The dialog states the shape, the drawer shows the measurement |
| Waiting/polling the created object from the dialog, or a progress bar | W2; the views own the lifecycle, and they already show it |
| Blocking on name collisions or a missing source guest | The store can be stale and the API server is the authority; a warned submit that 409s is honest, a blocked one is a client-side heuristic in the driver's seat (the W4 stance) |
| Four identity checkboxes | Three of them are one annotation upstream; fake granularity is a lie in checkbox form |
| In-dialog Secret creation for s3/oci credentials | Out of scope; the host's editor exists. The picker (spike T3) is as far as this goes |
| Exposing the `skip-hypervisor-version-check` annotation | An escape hatch for a mismatch the client cannot detect; YAML territory. The version-gate failure passes through W9 with upstream's own message |
| A schedule-creation shortcut in the snapshot dialog | The forms row owns it |
| Suppressing or rewriting the host's Delete for these kinds | No hook; same verdict and same upstream-feedback item as SPEC-0010 |

### Where the code lives

```text
src/renderer/menus/
  swiftguest-take-snapshot-menu-item-v1alpha1.tsx
  swiftsnapshot-restore-menu-item-v1alpha1.tsx
src/renderer/components/
  snapshot-create.ts        (pure: guards, per-backend gating, validation,
                             payload builder, summary facts)
  restore-create.ts         (pure: mode logic, guards, validation, payload
                             builder, summary facts)
  snapshot-create-dialog.tsx / restore-create-dialog.tsx
                            (thin: form state, field rendering, submit)
```

The SPEC-0010 split, unchanged: every decision - which options are
disabled and why, which summary lines render, what the payload is - lives
in the pure modules as functions over structural inputs, unit-tested
without a host global. The dialog components render what the pure half
decided and own only field state and the `create` call. `ARCHITECTURE.md`
gains the two component files in the implementation PR.

Writes go through `store.create(...)` (spike T2), wrapped per W9. No
patches exist in this spec; both specs are immutable upstream anyway.

### Non-happy states

The SPEC-0010 catalogue applies unchanged (403 with the verb/resource/
namespace prefix, webhook rejection verbatim, stale object 404, store
resolution failure reported from the click handler). New in this spec:

- **409 AlreadyExists** after an ignored collision warning: the API
  server's message with a W9 prefix naming the object; the dialog stays
  open with the form intact, so the fix is a rename, not a re-entry.
- **Invalid field values**: caught inline before submit (the webhook is off
  by default; there may be nobody else to catch them). The submit button's
  disabled state always names the offending field (W4 applied to submit).
- **The dialog's read on open fails** (guest store empty from a cold page):
  the summary degrades to the weaker sentence exactly as SPEC-0010's B3
  table does - facts the store cannot supply are stated as unverified, and
  the create is never blocked by a failed read.

### DESIGN.md conformance

Both dialogs and both drawer rows follow section 12 in full. Declared
additions, to be written into DESIGN.md by the implementation PR:

1. **Section 12 gains the create pattern** ("The W1 pattern for creates"
   above): the form is the confirmation, the live write summary is the
   enumeration, inline validation replaces the absent webhook, option
   dropping replaces no-op dropping, submit-disabled always carries the
   field and the reason.
2. Nothing else changes; sections 1-11 are untouched (the dialogs are not
   list pages or drawers, and the two On Delete rows follow section 3's
   existing drawer grammar).

### Feasibility gates (live spikes before the implementation PR)

The SPEC-0008/0010 discipline: cheap, settled with a throwaway Playwright
harness against a packed Freelens and the fixture cluster before the
implementation PR opens, verdicts recorded here.

| # | Question | Fallback if it fails |
| --- | --- | --- |
| T1 | Can `ConfirmDialog.open` host a stateful form as its `message` (controlled inputs keep state across the dialog's renders, the OK button reflects our validity state)? SPEC-0010 proved static content only. | Render the host's `Dialog` component directly with our own footer buttons, keeping `open`'s in-flight semantics by disabling them while the promise settles; if `Dialog` is not usable from an extension either, a plain fixed-position panel - and the finding is the headline for every remaining M6 form |
| T2 | Does `KubeObjectStore.create` work for extension-registered CRDs end-to-end (create -> API server -> watch delivers the row on the kind's own page)? No sibling extension creates. | `api.create` directly, with an explicit note that the store learns of the object only via the watch; if that fails too, M6's remaining rows are blocked and this is the milestone's headline |
| T3 | Can the dialog cheaply list namespace Secrets (for the s3/oci credential pickers) and Nodes (for `targetNode`) on open - one list call on click, degrading gracefully when refused? The reference-loader pattern (issue #38) exists for drawers; this is its first dialog use. | Text inputs; the summary marks the values as unverified, exactly like a refused B3 read |
| T4 | Does the row menu open reliably for a kind whose page the user is *not* on (Restore fired from a Snapshots list reached via a drawer link), with the guest store possibly cold - i.e. do the live-fact reads degrade rather than throw? | The degraded-sentence path of the summary is the design for this; the spike just proves no throw escapes `withErrorPage` |

## Tests (non-regression list)

- **Unit** (target files under the components above):
  - `snapshot-create.test.ts`: the per-backend gating table, every row,
    every disabled outcome asserted to carry a non-empty reason (the W4
    contract test, SPEC-0010's shape); the three memory-unsafe guest rules
    (GPU, SR-IOV, qemu override); payload building per backend - required
    fields present, carrier exclusivity impossible, no `includeMemory`,
    no `includeDisk` ever; hostPath prefix and `..` validation; the s3
    region-unless-endpoint rule; the oci bare-tag rule; Go-duration
    validation accepting `30m`/`72h`/`1h30m` and rejecting `7d`/garbage;
    name collision detection against a store snapshot; the conditional
    summary lines (pause line only for memory backends, frozen-VM line
    only when resume is unchecked, wait line only for unsettled csi,
    deletion-truth lines only for csi/oci);
  - `restore-create.test.ts`: mode availability (in-place disabled on csi
    with the no-op reason; disabled when the source guest is absent);
    the guard (`Failed` snapshot disabled with the terminal reason, every
    other phase enabled); the typo rule and the collision warning; the MAC
    lock (locked and pre-selected for memory snapshots, free for csi);
    identity payload building (the trio collapsing to its real annotation
    semantics is upstream's job - what is asserted is that the two
    checkboxes produce exactly the four enum values or the one, and never
    an empty `regenerate` with the memory lock on); `targetNode`
    required-ness per the live-facts table; the wedge warning (in-place +
    live policy `Stopped`), the hang warning (memory tail + resume
    unchecked), the wait line (non-Ready), the gone-source warning; the
    clone summary's current-spec and fresh-disk lines rendering only where
    true; `overwriteExisting` present and true exactly in in-place mode;
  - the two dialog components stay thin enough that their only unit
    surface is the pure modules above (the SPEC-0010 stance).
- **Integration**: unchanged (install, listed as enabled, activation
  without errors).
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), same honest split as
  SPEC-0010: no controller runs, so a created snapshot stays phaseless
  and a created restore stays phaseless - which the cases assert as the
  proof that the extension wrote exactly the object it enumerated and
  nothing else. New cases:
  - "takes a csi snapshot of a running guest": open from the drawer
    toolbar, summary shows the one create line and the csi contents line
    and no pause line; confirm; `kubectl` reads back the SwiftSnapshot
    with the expected `guestRef`, backend, policy and no
    `includeMemory`/`includeDisk` keys in the spec beyond the schema
    defaults; the Snapshots page shows the new row without a reload; a
    success notification names the object;
  - "refuses a memory snapshot of a stopped guest, with the reason": the
    stopped fixture guest's dialog has local/s3/oci disabled, each
    carrying the parks-forever reason; csi stays enabled. No writes;
  - "warns about the frozen VM when resume is unchecked": memory backend
    on the running guest, uncheck resume, the warning line appears and
    the OK button switches to accent; cancel; no writes;
  - "warns on a colliding name and surfaces the 409 when submitted
    anyway": type the existing fixture snapshot's name, the inline
    warning appears, submit, the API server's AlreadyExists arrives with
    the W9 prefix and the dialog survives with the form intact;
  - "restores a memory snapshot as a clone": from the Ready memory
    fixture snapshot, mode Clone, the MAC checkbox is locked on with the
    rule as tooltip, the ownership line is in the summary; confirm;
    `kubectl` reads back the SwiftRestore with `overwriteExisting`
    absent/false, the four (or one) regenerate values, and the expected
    target; the Restores page shows the row; a notification names it;
  - "disables in-place for a csi snapshot, with the no-op reason";
  - "disables Restore on a Failed snapshot, with the terminal reason"
    (fixture: the existing failed snapshot, or one added);
  - "warns that an in-place restore of a stopped guest will wedge": the
    fixture pairing a Ready memory snapshot with a `runPolicy: Stopped`
    source guest; the warning names the fix; cancel; no writes;
  - "cancels both dialogs without writing anything" (the SPEC-0010
    cancel case, extended to creates: object counts unchanged).
  - Fixture additions: a Ready memory-backend snapshot whose source guest
    is stopped, and a `Failed` snapshot, if the current set lacks them.
    The pre-review pass stays read-only (SPEC-0006): it will report the
    two new action controls and their disabled reasons, and click
    neither.
- **Manual verification** (escalated to Roberto, PROCESS.md). Everything a
  reconciler-less cluster structurally cannot show, on a real KVM-backed
  KubeSwift:
  1. A local-backend snapshot of a running guest: the pause is real, the
     VM resumes, `observedPauseWindowMs` lands, the artifacts exist under
     the hostPath.
  2. `resumeAfterSnapshot: false`: the VM is verifiably frozen after
     `Ready`, and nothing resumes it - the dialog's harshest claim,
     confirmed or softened.
  3. An in-place restore over a running guest: the pod dies without
     grace, the memory state reverts, the disks survive.
  4. The in-place wedge: a stopped target really does hang the restore in
     `Restoring`, and starting the guest un-wedges it (or does not -
     either answer reshapes the warning's fix sentence).
  5. The memory-tail hang with `resumeAfterRestore: false` (the suspected
     upstream bug): confirm, then decide whether the checkbox stays on
     the memory tail or the warning becomes a block.
  6. A clone restore end-to-end: MAC rewrite visible in the clone,
     identity regeneration observed (or not, per the cloud-init caveat),
     the fresh-disk semantics confirmed.
  7. Deleting a clone's SwiftRestore: the guest really is
     garbage-collected (the On Delete row's central claim).
  8. `deletionPolicy: Delete` on local and s3: the cleanup pod/job runs
     and the artifacts go; on oci: they verifiably stay.
  9. An s3 and an oci snapshot end-to-end (needs a reachable bucket and
     registry): the credential secret shapes, the targetNode rule on a
     clone restore, and the version-gate failure message pass-through.

  Record date, tester and result here when it happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Upstream drift found by this recon (2026-08-30)

Recorded here so the feedback survives; the actionable copies live in the
local feedback draft. Highest-value items: the CRD field doc for
`resumeAfterSnapshot` describes a csi stop/restart behaviour no code
implements; `deletionPolicy` silently has no effect on the oci backend
(and the webhook's advisory warning covers only the csi case);
`memoryRestoreMode` is a shipped, enum-validated field with zero prose
anywhere in `docs/`; `docs/crds.md` omits the `oci` backend member,
`includeDisk`, `resumeAfterSnapshot`, `resumeAfterRestore` and the MAC
rule, and mis-describes `includeMemory` and `targetNode`; the oci restore
path reuses the s3 node resolver and fails with a message that says "s3
restore"; `docs/swiftctl.md` documents none of the snapshot/restore/
schedule/export verbs; `docs/snapshots/csi-snapshots.md` still describes
the Phase-1 webhook that rejected `local`/`s3`; the s3 page says deletion
cleanup is unimplemented (it is implemented); three docs pages give
mutually inconsistent pause-window figures (2.8 s/GiB, 0.16 s/GiB,
2.5 s/GiB); the memory tail of `resumeAfterRestore: false` appears to
hang in `Restoring` against the code comment's claim (suspected live
bug); the snapshot-spec immutability check omits `backend.s3`,
`backend.oci`, `includeDisk` and `ttl`; and the schedule-name length rule
exists only in the webhook, so the default no-webhook install accepts
names whose derived Job names later break.

# SPEC-0012: Start migration dialog (M6)

- **Status:** Approved (Roberto, 2026-08-30, in chat)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (the `migration.kubeswift.io`
  CRD manifest and `api/migration/` are byte-identical at upstream `main`
  `d66cff5`; the only code delta since the tag is comment/message
  rewording. Controller, webhook, `swiftctl` and docs recon run at
  `d66cff5` on 2026-08-30). UX reference kubeswift-ui `main` `c4e53ce`.
- **Author / date:** Claude with Roberto, 2026-08-30

## Goal

An operator can start a migration of a SwiftGuest to another node from
inside Freelens: one dialog, one `create` of a SwiftMigration, with the
mode explained instead of guessed, the target chosen from nodes that can
actually take the guest, and the consequences - what stops, what moves,
what the guest loses, and what can park forever - stated before the click.
The SwiftMigration drawer gains the On Delete row that this recon proved
matters more here than anywhere else: deleting the wrong migration at the
wrong moment either rolls a guest back, orphans it forward, or - for an
in-flight live migration - cleans up nothing at all.

## Upstream reference

- `config/crd/bases/migration.kubeswift.io_swiftmigrations.yaml`: required
  fields (`guestRef`, `target` - but both of `target`'s properties are
  optional, so `target: {}` passes schema validation and only the webhook
  catches it), the three schema defaults (`mode: auto`, `timeout: 30m0s`,
  `timeoutStrategy: cancel`), the enums, the 14-value `failureReason`,
  printer columns, status subresource. Zero `x-kubernetes-validations`.
- `internal/webhook/swiftmigration/validator.go` - the admission rules
  this spec mirrors client-side. As with the snapshot kinds there is **no
  mutating webhook**, and the validating webhook ships **disabled by
  default** (`webhook.enabled: false`). Here that matters even more than
  it did for SPEC-0011, because this recon catalogued **thirteen rules
  that exist only in the webhook**, with no controller re-check at all:
  among them the same-node refusal (without it an offline migration
  reboots the guest in place), the `allowIPChange` consent (without it a
  default-networking guest silently loses its IP), the SR-IOV refusal,
  the live-mode storage gate, every input bound, spec immutability, and
  the per-source-node live concurrency guard.
- `internal/controller/swiftmigration/` (17k lines) - what each mode
  mechanically is; what fails terminally vs what requeues forever; the
  cancellation and deletion semantics; the fact that - unlike the
  snapshot and restore controllers - this one **does** emit Events,
  though never on the terminal `Failed` transition.
- `cmd/swiftctl/migration.go` and `migration_check.go` - the CLI
  baseline: `--to` required, no read-before-write on the normal path, no
  wait; `--check` is a read-only advisory preflight; `swiftctl migration
  cancel` deletes the CR rather than setting `spec.cancelRequested`,
  against the CRD's own advice.
- `docs/migration/` and `docs/crds.md` - a full release behind the code
  (they still describe live migration as unshipped); the twelve drift
  items are recorded under "Upstream drift found by this recon".
- kubeswift-ui `main` `c4e53ce`, `src/app/migrate-dialog/`,
  `guest-detail/`, `migrations/` - UX reference only (AGPL boundary, see
  [ARCHITECTURE.md](../development/ARCHITECTURE.md)). One genuine
  strength to match: the target-node control is the app's only validated
  picker (schedulable nodes, current node excluded, honest empty state).

Freelens host references: the SPEC-0011 implementation, reused wholesale
(the W12 create-dialog pattern, `snapshot-create`/`restore-create` as the
module template, the shared `create-dialog` primitives, the spike T1-T4
verdicts). This spec introduces **no new host machinery**, so it carries
**no feasibility gates**: every leg - form in `ConfirmDialog.open`,
`store.create`, the nodes picker via `nodesApi.list()`, degraded reads
from cold stores - is already proven and shipped twice.

## Scope

One M6 row: the "Start migration dialog".

1. **Migrate** on a SwiftGuest, from the list row kebab and the drawer
   toolbar: a dialog that builds and creates one SwiftMigration.
2. **On Delete row** in the SwiftMigration drawer, computed from the
   object's own phase and mode (the consequences differ radically).

Excluded, with where each one goes instead:

- **A Cancel action on migrations.** It is a real verb with its own
  asymmetries (`spec.cancelRequested` is honored in live mode pre-cutover
  only; offline cancellation is deletion; `swiftctl migration cancel`
  deletes, against the CRD's advice) and its own guard, and kubeswift-ui
  does not ship it at all. Own spec if wanted; the On Delete row
  meanwhile names `spec.cancelRequested` as the safe lever for a live
  migration, which is more than any upstream surface says.
- **`spec.target.nodeSelector`.** The webhook rejects it as not yet
  shipped and the controller does not implement it; with the webhook off
  it produces an infinite Validating retry. Not rendered.
- **`spec.timeoutStrategy`.** The webhook rejects `ignore` for every
  mode and the controller never reads the field in any mode. Not
  rendered; the schema default rides along.
- **Changes to the migration list/drawer views** beyond the On Delete
  row: they shipped read-only in SPEC-0004. The recon's findings about
  upstream's migrations page (inert rows, tooltip-only failure detail,
  no age/duration) are already answered by our existing views.
- **Node drain.** The drain controller creates its own migrations with
  its own defaults; nothing for a dialog to do.
- **Bulk migration** over the list selection: same verdict as SPEC-0010.

## Design

### What creating a SwiftMigration actually does

The recon's load-bearing facts, each with its source, in the order they
shape the dialog:

- **`auto` is the default and resolves to `live` whenever the guest looks
  eligible - without ever consulting storage.** The resolver checks VFIO,
  node-local virtio backends, networking and namespace UDN, defaults to
  `offline`, and promotes to `live` when all pass
  (`auto_mode.go:53-116`); its own comment claims the live path will
  catch non-live-capable storage, and it does not - the RWX+Block gate
  exists only in the webhook, and only for an **explicit** `mode: live`
  (`validator.go:489`). A default-mode migration of an eligible guest on
  RWO storage therefore proceeds into a live migration whose two
  launcher pods contend for one RWO PVC. This is the recon's
  highest-severity find (drift D1), and the dialog closes it client-side:
  it computes the same resolution the controller will, shows it ("auto
  will resolve to: live, because..."), and applies the storage gate to
  the *resolved* mode, not just the selected one.
- **`offline` means: stop, move nothing, restart.** Preparing patches
  `runPolicy: Stopped` plus a claim annotation in one write and deletes
  the launcher pod (grace 30 s); no data is copied anywhere - the same
  root-disk PVC is reattached on the target because the guest controller
  rebuilds the pod with the new `nodeName`. **The StorageClass must
  support cross-node attach and nothing upstream checks that** (the docs
  claim a local-path rejection that does not exist - drift D7).
  StopAndCopy then patches `runPolicy: Running` + `nodeName: <target>`.
- **`offline` of a stopped guest boots it on the target.** The stop
  patch is a no-op, the pod is already gone, and StopAndCopy's
  `runPolicy: Running` patch starts a guest the operator had chosen to
  keep stopped. Real behaviour, worth a sentence, not a block.
- **Offline has no timeout, and its parks are forever.** `spec.timeout`
  is enforced in exactly two places, both live-mode; no offline handler
  reads it, and no handler in any mode reads `timeoutStrategy`. An
  offline migration can wait indefinitely in Preparing (volume detach)
  or Resuming (guest health), with the guest stopped and claimed the
  whole time. The upstream docs admit the Resuming park is expected.
- **`live` runs two launcher pods for the same guest concurrently**, on
  both nodes, for the whole transfer; the controller orchestrates
  swiftletd via pod annotations, the cutover swaps `status.podRef` and
  deletes the source pod, and `observedDowntime` measures dispatch of
  that delete to `GuestRunning=True` on the destination. Live requires:
  a running source pod (a stopped guest fails with "cannot live-migrate
  a non-running guest"), RWX+Block storage (webhook-only; kernel-boot
  guests exempt), no VFIO, no node-local virtio backends, timeout of at
  least 60 s when set.
- **SR-IOV guests cannot migrate at all** (webhook, every mode), and the
  controller never re-checks it. **VFIO/GPU guests cannot live-migrate**
  but offline ships a full GPU release-and-reallocate. Both rules are
  enforced in the dialog with their reasons, because on a default
  install nobody else will.
- **Same-node target is webhook-only.** Without admission the controller
  happily stops the guest and restarts it on the same node - a reboot
  disguised as a migration. The dialog's node picker simply never offers
  the current node (upstream's picker does the same).
- **On default node-local networking the guest's IP does not survive**
  a cross-node move, full stop. `spec.allowIPChange` is pure consent:
  with the webhook on, `false` is rejected; with it off, the migration
  proceeds and the IP changes anyway. The dialog renders it as a locked
  checked consent with the fresh-IP fact as its reason, only for guests
  whose primary interface has no `networkRef` (the others keep their IP
  and see nothing).
- **Nothing stops two migrations of one guest at admission.** The
  in-progress annotation guard is controller-side, Preparing-phase,
  offline-only; live migrations never write it, so live+anything is
  unguarded and offline losers fail only after admission. The extension
  holds every SwiftMigration in a store, so the dialog warns - from live
  data no other client has - when a non-terminal migration already
  references the guest.
- **`migration.enabled: false` on the guest is refused by webhook and
  controller both** - the one precondition that fails cleanly
  everywhere. It is the menu item's guard.
- **Deletion is three different verbs wearing one trash icon** (the On
  Delete row's content): deleting a **pre-cutover offline** migration
  aborts and rolls back - annotation cleared, `runPolicy` restored to
  `Running`, the source pod comes back; deleting a **post-cutover**
  migration orphans forward - the guest continues on the destination and
  nothing is rolled back; deleting an **in-flight live** migration
  cleans up **nothing** - the annotation was never written, so the
  cleanup no-ops, the destination pod and the transfer continue, and
  only the record disappears. A **completed live** migration owns the
  scoped RBAC grant of what is now the guest's canonical pod (bites only
  with `scopedLauncherRBAC.enabled`, default off) - deleting the record
  garbage-collects the grant under a running pod. And `spec.ttl` deletes
  the record automatically after the terminal phase, which makes that
  RBAC edge reachable by timer (recorded as upstream feedback).
- **Terminal failures carry `failureReason` only in live mode**; every
  offline failure sets a bare message. Events exist (this controller
  wires a Recorder) but none fires on the `Failed` transition. Our views
  already render message and conditions, which is what makes "create it
  and watch the row" honest here too.

### Start Migration

**Registration.** `kubeObjectMenuItems` for `SwiftGuest.kind`, title
`Migrate`, Material ligature `swap_horiz` (upstream's icon for the same
verb; it is a Material name, not their asset), test id
`swiftguest-migrate-action`, both surfaces from one registration (W5).
Absent on `deletionTimestamp`.

**Guard** (`{ enabled, reason }`, W4 contract test):

| Situation | Outcome |
| --- | --- |
| `spec.migration.enabled === false` | disabled: migrations are not permitted for this guest; upstream refuses it at admission and in the controller |
| guest has an SR-IOV interface | disabled: upstream's admission rule refuses migration of SR-IOV guests in every mode, and nothing re-checks it when the webhook is off |
| everything else, including stopped and unsettled guests | enabled - offline migration of a stopped guest is legitimate (and disclosed), and unknown state permits (W4) |

**Fields**, top to bottom:

| Field | Widget | Shown when | Default | Notes |
| --- | --- | --- | --- | --- |
| Target node | picker over `nodesApi.list()` on open | always | none - required | Options: Ready, schedulable, not the guest's current node. A node lacking `kubeswift.io/kernel-node: "true"` is disabled with the reason when the guest boots a kernel (`kernelRef`). Empty result renders the honest empty sentence, not an empty control. Degrades to a text input when the list is refused (T3 verdict), with the summary marking the node as unverified |
| Mode | select `auto` / `live` / `offline` | always | `auto` | Each option carries one sentence of what it means to this guest (not generic prose): auto shows its **predicted resolution** live, recomputed from the same inputs the controller uses; live and offline carry their per-guest availability (below) |
| IP consent | locked checked checkbox | primary interface has no `networkRef` | checked, locked | "The guest's address does not survive a cross-node move on default networking: it will get a fresh IP." Locked because consent is the only thing the flag controls - refusing it changes the outcome only into a rejection (webhook on) or a silent IP change (webhook off). Hidden entirely for guests whose IP is preserved |
| Timeout | text, Go duration | mode live (selected or predicted) | empty = schema default `30m` | Validated: at least `60s`, at most `24h` (the webhook's bounds). Hidden for offline, where upstream never reads it - rendering it would be the option-dropping violation W12 forbids |
| Downtime target | text, Go duration | mode live | empty | Validated to the webhook's `[10ms, 10s]` window; explained as the CH pause-window hint, echoed back in `status.appliedDowntimeMs` |
| Parallel connections | number | mode live | empty | 0-16 (webhook bound); 2+ becomes CH `connections` |
| Reason | text | always | empty | Max 256 chars, no control characters (webhook rules, validated inline); lands in `spec.reason` for the audit trail |
| TTL | text, Go duration | always | empty | Must be positive; explained as "the record self-deletes this long after finishing", with the scoped-RBAC caveat sentence when it applies |

Not rendered, with the reason recorded here: `target.nodeSelector`
(upstream-unshipped, webhook-refused, infinite-retry without the
webhook), `timeoutStrategy` (never read by any handler),
`cancelRequested` (not a create-time field; the On Delete row names it).

**Per-guest mode availability**, every disabled option carrying its
reason (W4), evaluated live from the guest, its class and the stores:

| Situation | live | offline |
| --- | --- | --- |
| Guest not `Running`, or no launcher pod recorded | disabled: upstream fails a live migration of a non-running guest | enabled, with the boots-it-on-the-target summary line for a stopped guest |
| Guest has VFIO devices (`gpuProfileRef` or GPU claim) | disabled: upstream's rule; GPU guests move offline, with the GPU released and re-reserved | enabled |
| Guest has node-local virtio backends (filesystems, vhost-user) | disabled: upstream's rule | enabled |
| Resolved storage is not RWX+Block (from the guest class merge; kernel-boot guests exempt) | disabled: live migration needs storage both nodes can hold at once - **the rule upstream enforces only at admission, which ships disabled** | enabled |
| Class not in the store / storage unresolvable | enabled with a warning line (a refused read never blocks - the W4 stance), the summary marking the storage as unverified | enabled |

The `auto` option's predicted-resolution line is derived from the same
table plus upstream's own resolver order, and it is exactly the
protection D1 needs: when the prediction is `live` and the storage gate
above fails, the dialog says so and the submit is blocked with the
choice named ("pick offline, or fix the storage") rather than letting
the default mode walk into the RWO contention upstream permits today.
The one resolver input the extension cannot see - a primary OVN-K UDN in
the namespace - is declared here as a known limitation: the prediction
line says "assuming no primary user-defined network" when it matters.

**The in-flight warning.** On open, one pass over the SwiftMigration
store: any non-terminal migration referencing this guest produces a
warning line naming it and linking it - for offline the newcomer will
fail at Preparing with the claim conflict; for live upstream has **no
guard at all**, which is precisely why this line exists. Warn, never
block: the store can be stale, and the terminal check is upstream's job
where it exists.

**The write summary** (W12: one `Create SwiftMigration <ns>/<name>`
line - the name is generated `<guest>-migrate-<hhmmss>`, editable, with
the usual collision warning - plus the facts of this object):

- Mode line: the selected mode, or auto with its predicted resolution
  and the because-clause.
- **Offline, running guest**: the guest is stopped (`runPolicy` patched
  and the launcher pod deleted with a 30-second grace), its disk is
  **reattached, not copied** - the StorageClass must support attach on
  `<target>`, which nothing verifies - and the guest restarts there.
  There is **no timeout in offline mode**: a migration that cannot
  detach the volume or boot the guest waits forever, with the guest
  stopped and claimed the whole time.
- **Offline, stopped guest**: this migration will **start** the guest on
  `<target>` - moving a stopped guest means booting it.
- **Live**: a second launcher pod runs on `<target>` for the whole
  transfer; the VM keeps serving until the cutover, which deletes the
  source pod and costs a short measured downtime (the drawer shows it
  afterwards); a failure after the cutover point can need operator
  intervention (upstream's own message for the orphaned case).
- **IP line** (default networking): the fresh-IP fact, once, in the
  summary too.
- Conditional cost lines only when true: the kernel-node constraint, the
  in-flight warning, the unverified-storage or unverified-node
  degradations.

`labelOk: "Migrate"`. Accent styling when the summary contains a stop
(offline of a running guest); default styling otherwise - a live
migration and a boot-on-target are commitments, not terminations.

**Outcome** (W9). `Notifications.ok`: "SwiftMigration `<name>` created" -
fired from the Guests page, where the created row is not visible; the
Migrations page shows it live, phase by phase, with the progress and
downtime columns SPEC-0004 already ships. Failures: `checkedError` with
the W9 prefixes; the webhook's messages (when enabled) pass through
verbatim, and they are good messages.

### On Delete row (SwiftMigration drawer)

Computed from the object's own phase and mode, one sentence each,
rendered only where true:

- **Non-terminal, offline, pre-cutover** (Pending/Validating/Preparing):
  deleting this migration aborts it and rolls the guest back - the claim
  is cleared, the run policy restored, and the source pod comes back.
- **Non-terminal, post-cutover** (StopAndCopy onward): deleting does
  not roll back - the guest continues on the destination.
- **Non-terminal, live**: deleting this migration cleans up **nothing**:
  the destination pod and the transfer continue and only this record
  disappears. To stop a live migration safely, set
  `spec.cancelRequested: true` (the YAML editor can; pre-cutover it
  aborts cleanly, post-cutover it is acknowledged and ignored).
- **Terminal**: deleting removes the record only - and, when the
  cluster runs with scoped launcher RBAC, a completed live migration's
  record still owns the running pod's RBAC grant, which goes with it.
- When `spec.ttl` is set, the row adds that the record self-deletes
  `<ttl>` after finishing.

### Better than upstream

The W11 audit. Upstream baseline, measured: kubeswift-ui's migrate
button is dead without explanation on every non-Running guest, gated on
nothing else (not on an in-flight migration, not on storage, not on
another action in flight); its dialog offers three bare enum words with
no semantics, pre-checks the IP consent so the default path consents to
an address change unread, fires with no confirmation and less ceremony
than its own delete, says nothing about downtime or stopping, discards
the created object's reference, and succeeds silently; the mode's single
strength is the filtered node picker. `swiftctl` writes without reading
and its `cancel` deletes the CR against the CRD's own advice. The docs
describe the previous release.

Adopted:

| # | Improvement | Where |
| --- | --- | --- |
| M1 | The create confirms, enumerating the write and the per-mode consequences from live facts (W12) | Dialog |
| M2 | Mode semantics stated per guest, not per enum - and `auto` shows its predicted resolution with the because-clause, computed from the controller's own inputs | Fields |
| M3 | The storage gate applied client-side to the **resolved** mode, closing upstream's auto-into-RWO hole (D1) on every install, webhook or not | Mode availability |
| M4 | SR-IOV, VFIO, virtio-backend and non-running refusals enforced with reasons where upstream enforces them only in a webhook that ships disabled | Guard, mode availability |
| M5 | The node picker matches upstream's one strength and adds the kernel-node constraint, the same-node exclusion as a hard rule, and honest degradation when nodes cannot be listed | Fields |
| M6 | The in-flight-migration warning from the extension's own store - a guard no upstream surface has at all | Dialog |
| M7 | The IP consent shown only where it means something, locked where refusing it changes nothing, with the fresh-IP fact as its reason | Fields |
| M8 | Offline truths disclosed at the moment they are chosen: stop + reattach-not-copy + unverified StorageClass, no timeout ever, and boots-a-stopped-guest | Write summary |
| M9 | Live truths disclosed: two pods, measured downtime, post-cutover orphan risk | Write summary |
| M10 | Option dropping instead of dead inputs: no `nodeSelector`, no `timeoutStrategy`, no timeout field in offline mode where upstream never reads it | Fields |
| M11 | Success acknowledged and the created object observable in the shipped Migrations views (upstream discards the reference its own RPC returns) | Outcome |
| M12 | The On Delete row distinguishing the three deletion outcomes and naming `cancelRequested` as the safe live-mode lever - none of which any upstream surface states | On Delete |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| A Cancel action | A separate verb with its own spec (see Scope); the On Delete row carries the interim knowledge |
| Capacity display in the node picker (allocatable vs class request) | The controller re-checks capacity and fails cleanly with a good message; duplicating the arithmetic client-side invents a second source of truth for a case that already fails honestly. Revisit if the review finds the failure loop too slow |
| A downtime estimate | Nothing in the recon supports predicting it; the system measures it afterwards and our views show it (the SPEC-0011 pause-window stance) |
| Blocking on the in-flight warning or on collisions | Store staleness; warn-and-permit is the W4 stance throughout |
| Detecting primary-UDN namespaces for the auto prediction | The extension would need to read NAD kinds it does not model; declared as the prediction's stated assumption instead of half-implemented |
| Rendering `spec.cancelRequested` as a create-time toggle | Meaningless at create; it is a lever for later, documented where the user will look later |
| A migrations-page Cancel/rollback affordance | Same verb question, same future spec |

### Where the code lives

```text
src/renderer/components/
  migration-create.ts          (pure: guard, mode availability, auto
                                prediction, validation, payload, summary
                                facts, delete consequences)
  migration-create-dialog.tsx  (thin observer form, W12 machinery)
src/renderer/menus/
  swiftguest-migrate-menu-item-v1alpha1.tsx
```

The SPEC-0011 split and machinery, unchanged: MobX model outside React,
observable `okButtonProps`, catch-never-rethrow with the 409 reopen,
`store.create`, `apiFailureFacts`, the shared `create-dialog` primitives
and stylesheet. The storage-capability reader (`AccessMode
ReadWriteMany` and `VolumeMode Block` from the guest-class merge) is a
pure function in `migration-create.ts` over the typed class/guest specs.
`ARCHITECTURE.md` gains the two files in the implementation PR.

### Non-happy states

The SPEC-0011 catalogue applies unchanged. Specific here:

- **Node list refused**: text-input fallback, summary marks the node
  unverified (T3's degradation, now on the primary required field).
- **Class missing from the store**: live stays enabled with the
  unverified-storage warning; the guard never blocks on a failed read.
- **Webhook enabled**: its rejections arrive as good messages and pass
  through with the W9 prefix; the dialog's inline validation means a
  user normally never sees them.
- **Webhook disabled** (the default): the dialog is the only validation
  there is; that is most of why this spec exists.

### DESIGN.md conformance

W1-W12 in full, no new rules and no deviations: this is the third
application of the create pattern and the first with zero feasibility
gates. The On Delete row follows the drawer grammar of the two SPEC-0011
rows.

## Tests (non-regression list)

- **Unit** (`migration-create.test.ts`): the guard table with the W4
  non-empty-reason loop; the mode-availability table, every row, both
  columns; the auto prediction against upstream's resolver order
  (VFIO, virtio backends, default networking without consent, the
  UDN assumption) including the predicted-live-but-storage-fails
  blocked-submit case; storage capability over class merges (RWX+Block
  true/false, kernel-boot exemption, unresolvable class); the IP-consent
  visibility rule (networkRef present vs absent); node option filtering
  (Ready, schedulable, current node excluded, kernel label rule); every
  webhook bound mirrored inline (timeout min/max, downtime window,
  parallel connections, reason length and control chars, positive ttl);
  the in-flight warning (non-terminal match, terminal ignored); payload
  building per mode (nothing beyond the schema defaults, no
  `nodeSelector`, no `timeoutStrategy`, timeout omitted for offline,
  consent only for default networking); every conditional summary line;
  the On Delete sentences per phase-and-mode combination.
- **Integration**: unchanged.
- **E2E**, the honest split as ever (no controller runs, so a created
  migration stays phaseless - which is the proof the extension wrote
  exactly what it enumerated). New cases:
  - "starts an offline migration of a running guest": dialog from the
    drawer toolbar, node picker excludes the current node, summary
    carries the stop and reattach-not-copy lines, accent button;
    confirm; `kubectl` reads back the SwiftMigration with the expected
    `guestRef`, `target.nodeName`, mode, and nothing beyond the schema
    defaults; the Migrations page shows the row without a reload; the
    notification names it;
  - "explains what auto will resolve to, and blocks live on RWO
    storage": on a fixture guest whose class resolves RWO/Filesystem,
    the live option is disabled with the storage reason, and auto's
    prediction line names offline with its because-clause;
  - "refuses migration of an SR-IOV guest, with the reason" (menu item
    disabled in both surfaces - the fixture set has a GPU/SR-IOV guest);
  - "warns about an in-flight migration of the same guest": fixture
    adds a non-terminal SwiftMigration; the dialog warns and links it;
    cancel; no writes;
  - "discloses that migrating a stopped guest boots it": stopped
    fixture guest, offline summary carries the boots-it line;
  - "cancels the dialog without writing anything" (extending the
    SPEC-0011 cancel case to the third dialog).
  - Fixture additions: a non-terminal SwiftMigration referencing an
    existing guest, and - if the current classes lack one - a guest
    class resolving RWO storage. The pre-review pass stays read-only
    and will report the new action control and its disabled reasons.
- **Manual verification** (escalated to Roberto, PROCESS.md), on a real
  multi-node KVM cluster:
  1. An offline migration end-to-end: the stop, the reattach, the
     restart on the target, the events, and the claim annotation
     lifecycle.
  2. An offline migration of a stopped guest: it boots on the target,
     as disclosed.
  3. A live migration end-to-end on RWX+Block storage: two pods, the
     cutover, the measured downtime, `status.targetIP`.
  4. The D1 reproduction, carefully: `mode: auto` on an eligible RWO
     guest with the webhook off - confirm upstream really walks into
     the RWO contention (this validates the client-side gate's
     severity and makes the upstream issue reproducible).
  5. The fresh-IP behaviour on default networking, and its absence for
     a `networkRef` guest.
  6. Deleting a pre-cutover offline migration: the rollback restores
     the source pod. Deleting an in-flight live one: nothing is
     cleaned up, as the On Delete row claims. `spec.cancelRequested`
     pre- and post-cutover.
  7. The offline parks: volume that cannot detach (Preparing) and a
     guest that cannot boot on the target (Resuming), with the guest
     claimed and stopped throughout - the dialog's harshest offline
     claims.

  Record date, tester and result here when it happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Start migration as implemented (2026-08-30)

The spec ships in one PR: **Migrate** on SwiftGuest and the **SwiftMigration
On Delete row** (`components/migration-create.ts`,
`components/migration-create-dialog.tsx`,
`menus/swiftguest-migrate-menu-item-v1alpha1.tsx`, the drawer row), on the
SPEC-0011 machinery unchanged - the W12 create pattern, the MobX model outside
React, the observable `okButtonProps`, the catch-never-rethrow with the 409
reopen, `apiFailureFacts`, `store.create`, and the shared `create-dialog`
primitives and stylesheet, which needed **no change at all** for a third
dialog. The typed models needed none either: `migration.enabled`,
`gpuProfileRef`, `gpuResourceClaim`, `interfaces[].type`,
`interfaces[].networkRef`, `kernelRef`, `filesystems`, `vhostUserDevices`,
`spec.storage` on the guest and `spec.storage` on the class were all already
declared from the CRD schemas. Nothing in the design changed, and these are the
places the implementation is more specific than the text above:

- **The `auto` prediction checks the live state first**, before VFIO, the
  virtio backends and the networking consent. The Design section lists
  upstream's resolver order and does not place the running check; the
  mode-availability table does put it first, and predicting `live` for a guest
  that cannot be live-migrated would be predicting a failure. A stopped guest
  therefore reads "auto will resolve to: offline, because this guest is
  Stopped", which is also the outcome an operator gets either way - if upstream
  resolved `live` there it would fail immediately with its own non-running
  message.
- **The prediction on the RWO fixture says `live`, and the submit is blocked** -
  which is the Design section's D1 closure, and the one place this spec allows a
  block. The Tests section's second E2E bullet says that case's prediction line
  "names offline"; it cannot, without the prediction lying about what the
  controller will do (upstream's resolver never consults storage, which is
  exactly drift D1). The E2E case asserts the live prediction, the storage
  reason on the refused `live` option, the block with the choice named, and that
  taking that choice unblocks the form. The offline prediction is asserted in
  the same suite on the stopped-guest case, and in the unit tests over every
  resolver input.
- **The consent is a locked, checked checkbox and the payload always carries
  `allowIPChange: true` where it is shown**, so upstream's
  "default networking without consent" resolver branch can never fire from this
  dialog. `autoPrediction` still takes the consent as a parameter, defaulted
  from the guest, so that branch stays reachable and unit-tested: it is what
  upstream does for a client that does not consent (`swiftctl`, a hand-written
  manifest), and a prediction function that could not express it would be
  modelling this dialog rather than the resolver.
- **The storage capability is the guest-spec-over-class merge, and
  `status.storage` is deliberately not consulted.** It is the controller's
  record of the same merge, it does not exist before the first reconcile, and
  two sources for one fact is how a client starts disagreeing with itself.
- **The dialog owns a Name field, rendered first.** The field table starts at
  Target node and does not place the object's own name; the name is generated
  `<guest>-migrate-<hhmmss>`, editable, warned against the namespace's
  SwiftMigrations, and first - where both SPEC-0011 dialogs put theirs, and
  where the 409 path's "the fix is a rename" needs it to be.
- **The node picker has three renderings, not two**: the select, the text input
  (the read was refused, or the value is not in the list), and an honest
  sentence that counts what it dropped and why ("No node in this cluster can
  take this guest. It has 1 node: `node-a` is the node this guest is already
  on."). The third one is what a single-node cluster produces, and an empty
  select with no explanation is exactly the degradation the M5 improvement
  exists to avoid.
- **The in-flight warning is rendered twice**, at the top of the form (named and
  linked, through the host's `showDetails`) and in the write summary - the same
  deviation, for the same reason, that the frozen-VM and wedge warnings took in
  SPEC-0011: this form is tall enough that the summary sits below the fold of
  the dialog's own scroll area.
- **The On Delete row has a fifth branch: an unresolved `auto`.** A migration
  the controller has not reached yet - which is exactly what this dialog's own
  create produces - has no resolved mode, so the row states both futures rather
  than picking one. An absent or unknown phase is classified pre-cutover, on the
  same principle: nothing has moved yet, and an unknown phase is not a reason to
  claim the cutover happened.
- **The submit-disabled sentence reports the mode before the required node.**
  Both are wrong at once on the D1 fixture - a freshly opened dialog has no node
  yet either - and picking a node would not fix the mode, while the mode's
  message names the choice that does. Every other form has no mode error at all,
  so the node keeps that sentence there.
- **The reason's control-character rule** refuses C0 and DEL and allows space
  and tab, written as escapes rather than as literal characters.
- **The dialog renders no icon**, as in SPEC-0011: `ConfirmDialog`'s default is a
  warning triangle, and a migration is a commitment rather than a termination.
  What IS a termination here - an offline move of a running guest, which stops
  it - says so in the summary and turns the OK button to the accent styling.
- **One host finding, dark-theme only, caught by the screenshots and fixed in
  the shared stylesheet**: core's global `label { color: var(--textColorSecondary) }`
  paints the `<label>` the host's `Input` wraps its field in, and the input is
  `color: inherit`, so every typed value on the hardcoded white `ConfirmDialog`
  box renders as a light grey in the dark theme and near-black in the light one.
  It is the third of its family, after the checked-radio label and the select's
  single value recorded in SPEC-0011, and the fix in `create-dialog.module.scss`
  applies to **all three** create dialogs - Take Snapshot and Restore included.
  It goes on the upstream-Freelens feedback list with the rest.
- **The E2E fixtures are shaped by the cluster having one node.** The picker
  never offers the node a guest is on, so the create and D1 subjects declare a
  synthetic source node (`e2e-migrate-source`) and the in-flight subject
  declares the real one - which is how the same-node exclusion becomes visible
  as the empty-picker sentence. The created spec's key set is asserted to be
  exactly `allowIPChange`, `guestRef`, `mode`, `target` plus the two defaults
  the API server fills (`timeout: 30m0s`, `timeoutStrategy: cancel`), confirmed
  against the `v0.13.12` CRD - so no `nodeSelector`, no `timeoutStrategy` of
  ours, no `cancelRequested`, and no timeout in an offline migration.

### Upstream drift found by this recon (2026-08-30)

Twelve items, recorded in full in the local feedback draft; the headline
five: (D1) `auto` resolves to live without the storage gate the webhook
applies to explicit live - the comment in the resolver claims a check
that does not exist, and RWO guests can walk into a two-pods-one-PVC
live migration by default; (D2) the live-mode guest-name cap is 242 at
admission but really 53 (the destination pod name limit), so names in
between pass admission and fail at Preparing; (D3) offline
`observedDowntime` is the whole wall-clock, not the documented
Preparing-to-healthy window; (D4) `spec.timeout` is documented as
bounding the entire operation but is never read in offline mode, and
`timeoutStrategy` is never read at all; (D5/D6) `failureReason` values
`DstScheduleFailed` (never set anywhere) and `EligibilityMismatch`
(set only for `migration.enabled=false`, not the documented storage/VFIO
cases); plus the docs describing live migration as unshipped a release
after it shipped, the phantom local-path rejection, the dead
`SwiftGuest.spec.migration.preferredMode` field, the stale CRD docstring
that `kubectl explain` prints today, and `swiftctl migration cancel`
deleting the CR against the CRD's own recommendation of
`cancelRequested`.

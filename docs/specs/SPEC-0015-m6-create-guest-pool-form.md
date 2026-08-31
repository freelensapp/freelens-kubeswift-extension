# SPEC-0015: Create SwiftGuestPool form (M6)

- **Status:** Approved (Roberto, 2026-08-31, in chat: the completion of
  M6 was delegated in conversation; drafted and reviewed under that
  delegation)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (`724b5ef`; at `main`
  `d66cff5` the pool CRD differs by two description lines inside its own
  copy of the guest schema, no schema change at all). UX reference
  kubeswift-ui `main` `c4e53ce`. Recon date 2026-08-31.
- **Author / date:** Claude with Roberto, 2026-08-31

## Goal

An operator can create a SwiftGuestPool from a form: how many replicas,
and what each one is - a whole SwiftGuest, authored by the Create Guest
form this dialog embeds rather than by a reduced copy of it. The four
things the pool controller silently does to a template are named where
the decision is made, the two that are traps rather than choices are
refused or warned about by the count that makes them traps, and the write
summary multiplies.

## Upstream reference

- `swift.kubeswift.io_swiftguestpools.yaml` (1746 lines) - **119 spec
  leaves, depth 6, the largest kind in the API**, of which **70 are the
  SwiftGuest spec verbatim**. Not an impression: a mechanical leaf-set
  comparison of the two CRDs at `v0.13.12` gives 70 leaves on each side
  with an **empty symmetric difference**, every nested enum, default,
  pattern, `required` list and CEL rule matching exactly, and the Go type
  is literally `SwiftGuestSpec`. The pool's own surface is the other 49:
  `replicas`, `service` (9), `spreadPolicy`, the constraints (11),
  `updateStrategy` (3), `volumeClaimTemplates` (21), metadata (3).
- **There is no webhook for SwiftGuestPool** - `internal/webhook/` covers
  nine kinds and the pool is not one - so the CRD's schema is the entire
  server-side validation on every install, with **one CEL rule** and
  **zero pool-level cross-field validation**. The guest's own ~40 rules
  reach the replicas only where the webhook was enabled (it ships
  `webhook.enabled: false`), and even there the denial lands N times in
  controller logs with **no pool condition**. A pool template is the
  largest unvalidated surface in the API, which is the argument for
  reusing SPEC-0013's rule set rather than shipping a thinner one.
- `internal/controller/swiftguestpool/` - the four mutations on a deep
  copy of the template, and the semantics in Design. `cmd/swiftctl/` has
  **no pool command of any kind** and no scale, so unlike SPEC-0013 every
  defaulting decision here is argued from the schema rather than from
  upstream's own client.
- kubeswift-ui `src/app/create-guestpool/` and `src/app/pool-drawer/` -
  UX reference only (AGPL boundary,
  [ARCHITECTURE.md](../development/ARCHITECTURE.md)). The framing finding
  inverts SPEC-0013's headline: pools **are** in the gateway's explorer
  catalog, so upstream has a Form/YAML toggle and an edit mode for them,
  and "upstream has no YAML path" is not an argument this spec may reuse.
  What it may use is what that path does. Their wizard models **6 of the
  70 template leaves**, and their edit step **replaces `spec.template`
  wholesale** instead of merging onto the loaded object as their own
  shared base requires - so an edit deletes the other 64 leaves and,
  `template.spec` being what the hash covers, **rolls the fleet onto the
  truncated template**; the toggle round-trips through the same step, so
  there is no lossless YAML path to a pool there either. Kept: pickers
  correctly scoped here (the one wizard that is), errors surfaced
  verbatim, and an invented `runPolicy: Running` default that is a good
  one. The rest is the baseline below.

Freelens host references: the SPEC-0013 machinery in full, plus the
host's `addRemoveButtons` create affordance. **No new host machinery and
no feasibility gates.**

## Scope

One M6 row: "Create SwiftGuestPool (form)", split out of the five-kinds
row it currently shares. **Create Guest Pool** on the Guest Pools page,
through the host's own floating create control, opening a dialog that
carries the pool's own surface - namespace, name, replicas,
`spreadPolicy`, `updateStrategy`, `service` (ports, type, headless), and
`volumeClaimTemplates` reduced to the vocabulary the guest form's blank
data disk already uses - around **the Create Guest form, embedded as the
template**, reusing `guest-create.ts` and the section components of
`guest-create-dialog.tsx` rather than a second copy of them, with four
divergences and one lifted rule.

Excluded and named in the form's footer rather than silently absent:
pool-level `topologySpreadConstraints`, `service.annotations`,
`service.loadBalancerClass`, `service.ports[].expose`,
`template.metadata`, the claim template's five reference and selector
fields, and everything SPEC-0013's own footer names. Excluded with
destinations: **editing an existing pool** (the host's YAML editor
already does it, losslessly, which is more than upstream's edit path
manages); **scaling**, its own M6 row, which SPEC-0008 already recorded
the `scale` subresource as belonging to; the other creation-form rows;
any bulk creation.

## Design

### What creating a SwiftGuestPool actually does

- **`spec.template.spec` is a full SwiftGuest spec, not a subset.** The
  controller performs **exactly four mutations** on a deep copy and
  copies the rest byte for byte: `topologySpreadConstraints`
  unconditionally overwritten - by the pool's own, by a synthesized
  hostname constraint under `spreadPolicy: Spread`, or by **nil under the
  default `Pack`**; `network.ports` **wholly replaced** by the pool's
  service ports with `expose` cleared, whenever `spec.service` is set and
  the primary binding is not bridge; `cloneFromSnapshot.targetNode`
  **overwritten** by a round-robin over sorted Ready, schedulable,
  non-control-plane workers by replica index; and `dataDiskRefs` given
  the per-replica claim-template references, **appended**.
- **Two fields are copied unchanged that must not be.** `nodeName` is
  copied verbatim and never uniquified - there is no node-name logic at
  all - so a pinned template puts **all N replicas on one node**, and a
  pin bypassing the scheduler makes the stamped constraints irrelevant
  too. `interfaces[].mac` is copied verbatim, giving **every replica the
  same MAC**. Nothing rejects either.
- **Replicas are named `<pool>-<index>`**, zero-based, stable and reused
  after deletion; per-replica PVCs are named
  **`<template>-<pool>-<index>`** - that order, which both documents have
  backwards - and are **controller-owned by the pool**, so garbage
  collection **deletes them with the pool**, the opposite of what the
  guide says. The pool never patches a guest and the hash covers
  `template.spec` only, so template metadata edits are a permanent no-op.
- **`runPolicy` is the only template field with feedback into pool
  behaviour**: a Failed replica is replaced only if the **live guest's**
  policy is Running, Always or RestartOnFailure, and a `Stopped` one is
  parked forever with its index never refilled - so a template with no
  policy is a pool that will not self-heal, which is why upstream's
  invented default is a good one and why this form keeps G8.
- **Scale-up creates every gap in one unbatched pass**, no rate limit and
  no surge cap, and the first create error aborts the reconcile, so a
  partial fan-out is normal. **The rollout can also deadlock:**
  `maxUnavailable: 0` with `maxSurge: 0` is schema-legal, uncoupled by
  any rule, and can never progress, with **no condition reporting it**.
- **The status counters do not mean what they look like**
  (`availableReplicas` is a copy of `readyReplicas`, `Available` is
  `ready > 0`, `Progressing` never consults `updatedReplicas`), and the
  **`scale` subresource carries no `labelSelectorPath`**, there being no
  `spec.selector`, so `kubectl scale` works and a resource-metric
  autoscaler cannot. This form writes rather than reads, so the summary
  never promises a rollout gate the API cannot express.

### The form

**Registration.** The Guest Pools page passes
`{ onAdd, addTooltip: "Create Guest Pool" }` to the same
`addRemoveButtons` prop the Guests page uses: one line, the shipped
idiom, DESIGN.md pillar 1. It also needs the 80px scroll clearance
SPEC-0013 measured for that floating button, a page-local SCSS variable
today, so that value moves to the shared stylesheet or is repeated.

**Sections**, one dialog, W12. The required head is short - namespace,
name, replicas, then the template's own - and everything optional is
collapsed, the recon's named mitigation for a form strictly taller than
the Create Guest form. Field dropping is not the mitigation.

1. **Identity**: namespace (the host's `NamespaceSelect`, defaulted from
   the page's filter only when it names exactly one namespace - upstream
   pre-fills the literal string `default`, which looks deliberate and is
   worse than an empty required field); name.
2. **Replicas**: integer, minimum 0, **default 1** (the schema's, not
   upstream's 2), sent explicitly, which is the G8 argument again: it is
   required and defaulted at once, so the API server fills it before
   validation. `0` is legal and means a pool that owns nothing yet, so it
   is accepted with its meaning stated. No upper bound is invented - the
   schema has none and the right cap is a cluster fact - so the summary
   multiplies by N and the numbers are the warning.
3. **The template**: the Create Guest form's sections, under D1-D4.
4. Four collapsed sections follow: **Spread** (`spreadPolicy`, carrying
   the discard, since this is where an operator looks for it);
   **Service** (ports, type, headless, dropped on a bridge-bound
   template); **Per-replica storage** (claim templates - name, size,
   storage class, access mode, volume mode - with the resulting PVC name
   for index 0 as a fact); **Rollout**. Then the **YAML footer**.

**D1. `nodeName` is warned about, not dropped.** Above one replica the
pin warns, at the field and in the summary, that it puts every replica on
one node and that `spreadPolicy` cannot save it, a pin bypassing the
scheduler the constraints act on. It is not dropped and not refused: a
pinned pool is legitimate on a single-node cluster, on the node with the
local storage, or on the node with the devices, and W12's option dropping
is for no-ops, not consequences - a warning never blocks. Per the recon
this is the highest-value thing this extension can add here.

**D2. `interfaces[].mac` is refused above one replica.** Unlike the pin,
a duplicate MAC has no valid outcome: the field exists to pin one
interface to one address, and N replicas sharing it on one L2 segment is
a collision. Nothing rejects it - the pattern is format-only, the guest
webhook's rule is per-object, there is no pool webhook - so the form is
the only thing that can. It is conditional on `replicas > 1`, at one
replica the MAC being as legitimate as on the Create Guest form; and it
is a refusal rather than a warning because the form is reading its own
two fields, not guessing at a cluster.

**D3. The three overwrites are stated where they happen, and the
overwritten controls are dropped.** *Ports*: with a pool Service
configured, the template's ports control is not rendered and the payload
carries no `network.ports`; the pool's service ports becoming every
replica's, with `expose` cleared, is stated in its place. Sending ports
the controller will replace is the same dishonesty as re-sending a schema
default. *Bridge*: with a bridge-bound template the Service section is
dropped instead, with what upstream does - the pool **admitted**, the
Service garbage-collected, port injection skipped, a `ServiceReady=False`
condition reported; the CRD description asserts admission refuses it, and
that describes a webhook that does not exist. *Clone target node*: a
derived preview, not an input, and **G10's rule is lifted**, since
keeping the guest form's block would block on a field the controller
supplies; the preview carries the round-robin's ordering and the fact
that **zero schedulable workers aborts the whole reconcile**. *Topology
constraints*: nothing to drop, SPEC-0013 having routed them to the
footer; the discard is stated on the spread control.

**D4. The summary tells the truth per replica.** Replica names
`<pool>-0 .. <pool>-<N-1>`; the PVC names in the real
`<template>-<pool>-<index>` order; the multiplication of everything the
Create Guest summary enumerates (N launcher pods, N root-disk clones, N
seed Secrets, N of each blank data disk); the single-pass fan-out with
partial creation as a normal outcome; and one line with no equivalent
upstream: **deleting the pool deletes the per-replica claims and their
data.**

**The shared-referent rules**, where the embedded form's per-source rules
meet pool semantics. Each is a stated rule, not an assumption.

- The **kernel-node rule** is unchanged, with D1's warning on top of it.
  The **GPU guard** is unchanged too, but a DRA `resourceClaimName` is
  **one shared object** while `resourceClaimTemplateName` is the
  per-replica-correct choice and nothing upstream steers an operator to
  it: above one replica the claim-name field warns and names the other.
  `gpuProfileRef` capacity is never consulted, so over-subscription parks
  replicas in Pending - a summary line, not a block.
- **`seedProfileRef` is one profile shared by every replica**, no
  substitution mechanism existing at any layer, so per-replica identity
  comes from the seed's own logic or from cloud-init reading the
  hostname, which derives from `<pool>-<index>`. **A data disk naming an
  existing PVC is likewise one claim shared by N replicas**, so a
  `ReadWriteOnce` one lets exactly one replica schedule: above one
  replica the row warns and names the claim templates as the alternative
  (*derivation note*: the recon states this mechanism for `filesystems`,
  and this is the same one). A claim template whose name collides with a
  template data disk's produces a duplicate-name spec that only the
  disabled guest webhook catches: refused across both.
- **The replica names are checked against the namespace's existing
  guests.** A guest already named `<pool>-<index>` is **not adopted** -
  ownership is by owner reference only - so the create fails on
  `AlreadyExists` and, the first error aborting the reconcile, the pool
  never fans out. The form warns with the indices named and does not
  block: that read can be stale or refused, and a refused read must never
  accuse.

**Name length.** A replica's name is the stem of its launcher pod, its
cloned root-disk PVC and its per-guest Service, all DNS-1123 labels
capped at 63, so the pool name is capped at
`63 - 1 - digits(replicas - 1)` and the message says which objects the
name becomes. **The write summary** (W12) is the
`Create SwiftGuestPool <ns>/<name>` line, then D4's facts, then the
Create Guest summary's own lines, each read as N times itself;
**Outcome** (W9) is unchanged, `AlreadyExists` reopen included.

### Better than upstream

Baseline, measured, beyond the edit and toggle losses already recorded:
6 of the 70 template leaves modelled, and no `updateStrategy`,
pool-level constraints, Service annotations, load balancer class or
**`volumeClaimTemplates` at all**, so the whole stateful-pool feature is
unreachable there; a forced apply, so a name clash silently overwrites; a
namespace pre-filled to literal `default`; a picker helper that swallows
every error, making an RBAC denial, a gateway outage and an empty
namespace indistinguishable; one boolean of validation with no per-field
reason; a scale control that can wipe the spec; a blank Phase column; and
a drawer with no rollout state, conditions or replicas.

Adopted:

| # | Improvement | Where |
| --- | --- | --- |
| P1 | The whole template authorable - the operator surface in the form, the tail routed to the YAML editor - against upstream's 6 of 70, and by embedding the shipped form so the two can never drift | Scope, section 3 |
| P2 | `store.create`, so a name clash is `AlreadyExists` instead of a forced overwrite that also rolls the existing fleet | Outcome |
| P3 | The node pin's collapse-onto-one-node consequence named at the field and in the summary | D1 |
| P4 | A template MAC refused above one replica - the L2 collision nothing else rejects | D2 |
| P5 | The ports the controller would replace neither offered nor sent, with the replacement stated; the Service section dropped on a bridge-bound template, with what actually happens instead of the CRD's false admission claim | D3 |
| P6 | The clone target node rendered as derived and G10's block lifted - the mirror image of the guest form, where the same field is required because nothing else supplies it | D3 |
| P7 | Replica names, real PVC names and the per-replica multiplication in the summary | D4 |
| P8 | `volumeClaimTemplates` reachable at all, with `metadata.name` required (the schema does not require it, and an empty one yields an invalid PVC name and a reconcile that errors forever with nothing explaining it) and the true name order shown | Per-replica storage |
| P9 | The summary says deleting the pool deletes the per-replica claims and their data - the guide says the opposite, and following the guide destroys data | D4 |
| P10 | The rollout deadlock made inexpressible: `maxUnavailable: 0` with `maxSurge: 0` refused with its reason, because it is schema-legal, uncoupled by any rule, and reported by no condition | Rollout |
| P11 | `replicas` and `runPolicy` sent explicitly, the second with the pool's own reason: the live guest's policy decides whether a Failed replica is replaced or parked forever | Sections 2, 3 |
| P12 | The Service's port-name-above-one rule enforced (enforced for a standalone guest, nowhere for a pool, where it becomes the controller failing to create the Service on every reconcile); `headless` made inexpressible against NodePort and LoadBalancer, which it silently overrides; `expose` not offered, because the controller accepts it and drops it | Service |
| P13 | Pickers scoped, readiness-aware, and degrading to a text input with an unverified marker rather than to an empty dropdown that means three different things | Section 3 |
| P14 | The replica-name collision against existing guests warned about with the indices named - a failure that otherwise appears as a pool that simply never fans out | Design |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| Editing an existing pool through the form | The YAML editor edits, losslessly, which upstream's own edit path does not manage; this spec does not need to win that twice |
| Per-replica overrides of any kind | No mechanism exists at any layer - no index token, no downward API, and the controller never patches a guest at all - so offering one would be inventing behaviour, the limit W11 puts on this exercise |
| Capacity math against `replicas` x the class request | The SPEC-0012 and SPEC-0013 verdict unchanged: the controller parks over-subscribed replicas in Pending honestly, and a second source of truth client-side is not worth its drift |
| A scale control, stepper or Scale dialog | Its own M6 row; SPEC-0008 already recorded the `scale` subresource as M6 territory. This form decides the initial count, not the later ones |
| Pool-level `topologySpreadConstraints` | 11 leaves at depth 6 of a core Kubernetes type; `spreadPolicy` covers what an operator reaches for, the footer routes the rest, and the fact that explicit constraints take precedence over the policy is stated rather than hidden |
| `service.annotations`, `service.loadBalancerClass` | YAML territory. Annotations have overlay semantics - removing a key from the spec does not remove it from the Service - which the form would have to explain in full to be honest about |
| A rollout or readiness preview | `Available` is `ready > 0`, `Progressing` never consults `updatedReplicas`, and `availableReplicas` is a copy of `readyReplicas`; predicting from those would repeat the error upstream's own documentation makes |
| CanI / RBAC pre-flight gating of the button | W7 unchanged. Worth recording that upstream does pre-flight, and that its own curated capability catalog never grants `create` on `swiftguestpools` - so on a cluster set up through upstream's UI, its gate hides the button for this very kind |
| SPEC-0013's own rejections, repeated here | Auto-selecting a class, image or namespace, and a "duplicate this pool" prefill: the same arguments, now with a template to be lossy about |

### Where the code lives

```text
src/renderer/components/
  pool-create.ts           (pure: the pool's fields, the divergence
                            rules, the payload, the summary)
  pool-create-dialog.tsx   (the pool sections, plus the guest sections
                            rendered from guest-create-dialog)
src/renderer/pages/        (Guest Pools page gains the create control)
```

**The pure model composes with no seam at all.** `guestCreatePayload`
already returns `{ spec: Partial<SwiftGuestSpec> }`, exactly the shape of
`spec.template.spec`; every validator, picker and summary function
already takes `(inputs, values)`; and `GuestFormValues`'s `namespace` and
`name` are the only fields that do not belong in a template, and are
already outside the payload. So `pool-create.ts` holds a
`GuestFormValues` inside its own values, calls the shipped functions
against it, and adds the pool's fields, the divergence rules and the
multiplication. `guestCreateBlockingIssues` is the shape D2 and the
claim-template rules extend, so the disabled submit keeps naming its row.

**The dialog needs one extraction, and it is the whole risk of this
spec.** Every section component in `guest-create-dialog.tsx` takes
`{ model }: { model: GuestCreateDialogModel }` and reaches through that
one object for the values, the picker facts, the collapsed-section state
and the update action. Embedding needs those components to take a
**values owner** instead - whatever shape exposes those four things - so
a pool dialog model can own a `GuestFormValues` and hand the same
components the same contract. What that shape is, is an implementation
decision; what this spec requires is **one implementation of each
section**, because a second copy drifts at the next SwiftGuest field
addition, which is the mistake upstream made and pays for on every edit.

### Implementation slices

**One slice.** Every field is already shipped and tested - the template's
are SPEC-0013's, the pool's own are the primitives the four shipped
dialogs use. What is new is the composition and the rules that hang off
it, and those do not split along any honest line: a slice shipping the
template without the Service would ship the ports section under rules the
second slice then changes (D3), and a slice shipping the pool's fields
without the template would have nothing to create. The seam in
`guest-create-dialog.tsx` is the risk, and shipping half the pool's
fields first does not reduce it. What may land ahead of the form is the
values-owner extraction itself, as a **refactor PR with no behaviour
change** proved by the existing suites - a PR, not a slice.

### Non-happy states and DESIGN.md conformance

The W12 catalogue unchanged: every picker degrades to a text input on a
refused list (T3) with the summary marking the value unverified, the
existing-guest read keeps SPEC-0013's unverified recording, and the 409
reopen carries the pool's fields and the template's twelve sections.
W1-W12 in full, the collapsed-section rule applied four more times with
its three conditions met each time.

## Tests (non-regression list)

- **Unit** (`pool-create.test.ts`):
  - **The composition properties**, which are why this file exists. Over
    a corpus of `GuestFormValues` covering all three boot sources and the
    collapsed tail, the pool payload's `spec.template.spec` is deep-equal
    to `guestCreatePayload(inputs, values).spec` - **minus**
    `network.ports` exactly when a pool Service is configured, **minus**
    `cloneFromSnapshot.targetNode` always, and with `dataDiskRefs`
    unchanged, the controller appending rather than the form pre-empting.
    A property asserts neither form emits `topologySpreadConstraints`.
  - **The two traps.** A pinned template above one replica produces
    exactly one warning, non-empty, naming the node and the count, and
    **never** a blocking issue; at one replica, neither. A template MAC
    above one replica produces a blocking issue with a non-empty reason
    naming the interface row, and none at one replica - including the
    transition, since the count is a field the user changes.
  - The pool's own fields: the name budget at the `9`/`10` and `99`/`100`
    boundaries; replicas accepting `0` and refusing negatives; `replicas`
    and `runPolicy` in every payload; the deadlock refused and released
    when either pace field moves; the Service rules (port name above one
    port, `expose` never emitted, headless inexpressible against the two
    types, the section dropped on a bridge-bound template); the claim
    templates (name required and DNS-label validated, the PVC name
    preview in the real order, the collision with a data disk refused).
  - The shared-referent rules, each firing only above one replica; the
    replica-name collision including its unverified branch; every summary
    line, including the multiplication and the PVC-deletion warning; and
    the W4 contract, that a disabling outcome always carries a non-empty
    reason. The bar: proportional to SPEC-0013's, itself proportional to
    SPEC-0012's 223.
- **Integration**: unchanged.
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), writing for real. No
  controller runs there, so a created pool fans out into nothing, which
  is what makes the readback a proof of what the form sent.
  1. *"creates a pool and reads back its template key-exact"*: replicas
     3, an image-boot template with class, seed profile and run policy,
     one claim template, a ClusterIP Service. The readback asserts
     `spec.replicas`, the service ports, the claim template, the stamped
     defaults - and that `spec.template.spec`'s key set is **exactly**
     the key set the standalone Create Guest case asserts, the
     composition property proved against the API server itself.
  2. *"refuses a MAC on a pool of more than one, and offers it again at
     one replica"*: the blocking sentence names the row and the count.
  3. *"warns that a pinned pool puts every replica on one node, and
     submits anyway"*: the warning at the pin and in the summary, with
     `nodeName` unchanged in the readback.
  4. *"drops the template's ports when the pool has a Service"*: the
     readback carries no `network.ports` and the pool's own ports.
  5. *"refuses a rollout that can never progress"*: `0`/`0`, the reason,
     and the submit released when either moves.
  6. *"warns that a guest already holds a replica name"*: the indices
     named, the submit not blocked.
- **Fixtures**: one new file, `205-swiftguestpool-create.yaml`,
  carrying a SwiftGuest at a replica name for case 6 and a claim-template
  storage class that does not exist, so nothing provisions and nothing
  needs cleaning up. Everything else is reused: the M1 image and guest
  class, the seed profile, the M3 GPU profiles, SPEC-0013's volume
  fixtures. Pools are named after the wall clock, these cases writing for
  real against a cluster `pnpm e2e:cluster:up` keeps.
- **Manual verification** (escalated to Roberto, PROCESS.md) on a real KVM
  cluster with the controller running - all of it invisible without one:
  a pool fanning out into `<pool>-0..N-1` with its PVCs named
  `<template>-<pool>-<index>` and collected when the pool is deleted; a
  rollout on a `template.spec` change, highest index first, and a
  metadata-only change rolling nothing; `kubectl scale` working while an
  autoscaler on CPU never acts; a pin collapsing a three-replica fleet
  with `Spread` not saving it; template ports replaced and constraints
  discarded under `Pack`; a bridge-bound template plus a Service admitted
  with only a condition; the clone round-robin with more replicas than
  schedulable workers, and with zero; a Failed replica with `Stopped`
  never replaced; a shared `ReadWriteOnce` PVC leaving replicas Pending;
  and the guest webhook both ways. Record date, tester, result.

## Open items

1. **Legibility.** This form is strictly taller than the Create Guest
   form, whose own legibility SPEC-0013 left to the screenshot pass. The
   mitigation is the short required head and four more collapsed
   sections; whether that is enough is judged there.
2. **Whether `spreadPolicy: Spread` plus a node pin escalates** from D1's
   warning to a refusal, the two halves contradicting each other, and
   **whether replicas wants a soft upper warning threshold** - the
   summary's multiplication being the current answer, since a number
   would be invented. Both are judgements for the review pass.
3. **The data-disk `pvcRef` sharing rule is derived**, not quoted, as its
   own note records; the manual pass confirms it.
4. **Two upstream findings need one live confirmation each** before they
   are reported upstream: that editing a pool upstream truncates the
   template and rolls the fleet, and that the drawer's scale button fails
   on a wizard-created pool. Both are confident code reads of `c4e53ce`,
   and both are inferences about runtime behaviour.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Upstream drift found by this recon (2026-08-31)

Three documents, 1465 lines, a dozen contradictions - the richest drift
of any kind in this recon, recorded in full in the local feedback draft.
The three that this spec's own text depends on:

- **The PVC deletion claim is exactly backwards, and it is a data-loss
  claim.** The guide says the per-replica claims survive scale-down,
  rollout and pool deletion; the controller sets a controller owner
  reference, so deleting the pool deletes them. Following the guide
  destroys the data. **PVC naming is backwards too**
  (`<pool>-<template>-<index>` for the real `<template>-<pool>-<index>`),
  and **`dataDiskRef` is misused in two worked examples** to attach a
  claim-template PVC, which it cannot reference and does not need to.
- **Every rollout and status sentence is wrong somewhere**: pace fields
  documented as integer-or-percentage that are plain int32, an
  `availableReplicas` stability window that exists nowhere, `Available`
  and `Progressing` wrong in both directions, wrong metric names, a
  self-contradicting index-reuse claim, a label-change claim no update
  path could honour, autoscaling oversold in three places, and a
  `Recreate` barrier that does not exist.
- **The three per-replica overwrites, the node-pin trap and the
  park-versus-fail rule are documented nowhere**, and neither is
  `spec.service` in its whole - a headline feature with its own 263-line
  controller file - nor the automatic data-disk injection that makes
  stateful pools work. A Go comment copied into the CRD also says a
  bridge-bound template is refused by admission, when no pool webhook
  exists to refuse it.

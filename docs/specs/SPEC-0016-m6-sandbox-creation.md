# SPEC-0016: Create forms for SwiftSandbox and SwiftSandboxPool (M6)

- **Status:** Approved (Roberto, 2026-08-31, in chat: the completion of
  M6 was delegated in conversation; drafted and reviewed under that
  delegation)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md), the
  "Sandbox / SandboxPool creation" row)
- **KubeSwift version reviewed:** `v0.13.12` (`724b5ef`). Both sandbox
  CRDs are **byte-identical** between the tag and `main` (`d66cff5`),
  so the tag is the whole basis and there is no drift caveat to carry.
  UX reference kubeswift-ui `main` `c4e53ce`, the commit SPEC-0013
  reviewed. Recon date 2026-08-31.
- **Author / date:** Claude with Roberto, 2026-08-31

## Goal

An operator can create a SwiftSandbox and a SwiftSandboxPool from a
form: a one-shot microVM with its workload, sizing, scratch disk and
two expiries, and the warm buffer a sandbox checks a slot out of. The
checkout is the centre of this spec - one field, `spec.poolRef.name`,
is the whole client-side protocol, and nothing upstream checks that a
claimant matches the pool it claims from, so the form derives the shape
from the pool rather than asking for it. Every rule that lives in a
webhook which ships disabled - and, for the pool, in one that does not
exist - is enforced at the field, and the summary says which failures
are terminal and which park forever, because nothing here self-heals.

## Upstream reference

- The two CRDs - **44 spec leaves** for the sandbox (16 of them the
  `env[].valueFrom` boilerplate) and **14** for the pool; `image` and
  `memory` required on both, `memory` required *and* defaulted so the
  API server always fills it; **zero CEL rules on either**; `status` on
  both and `scale` on the pool alone (`specReplicasPath:
  .spec.minWarm`). SPEC-0008 records every field, default and enum, and
  both models are field-complete, so this spec needs no model work.
- `internal/webhook/swiftsandbox/validator.go` - validating only
  (neither kind has a mutating webhook), **sixteen rules**, eleven
  **webhook-only**: no schema pattern, no CEL, no controller re-check.
  It ships disabled (`webhook.enabled: false`). **There is no webhook
  for SwiftSandboxPool at all** - verified three ways - so for the pool
  the CRD's own types are the entire server-side validation.
- `internal/controller/swiftsandbox/` (`controller.go`, `checkout.go`,
  `pod.go`, `gpu.go`, `scratchdisk.go`, `image.go`, `netpol.go`) and
  `cmd/sandbox-materialize/` - the behaviour summarized below.
- `cmd/swiftctl/sandbox.go` - `logs`, `exec`, `attach`, nothing else.
  **No create, run, checkout, delete or scale command for either
  kind**: unlike SPEC-0013, which cited `swiftctl guest import` as its
  precedent for sending `runPolicy` explicitly, this spec has **no
  client-side precedent to mirror**, and every defaulting decision is
  argued from the schema.
- kubeswift-ui `main` `c4e53ce`, `src/app/create-sandbox/` - UX
  reference only (AGPL boundary,
  [ARCHITECTURE.md](../development/ARCHITECTURE.md)). **Both kinds are
  in the gateway's Explorer catalog**, so upstream lists them, shows
  their YAML and offers a Form/YAML toggle and an edit mode: SPEC-0013's
  "upstream has no YAML path" was true of guests and **is not true
  here**. What is true is worse for them - those wizards write through
  `ApplyResource`, a **server-side apply with `Force: true`**, so
  typing the name of an existing sandbox or pool **overwrites it and
  reports success**. The namespace is prefilled with the literal
  `default`, the YAML side is a bare textarea, validation is one
  boolean with no per-field error channel, the pickers are cluster-wide
  for namespace-local references, and `canCreate()` pre-flights against
  a permission set upstream's own RBAC presets never grant. What they
  get right - errors verbatim, server metadata stripped, unmodelled
  fields preserved on an edit - is kept or credited below.
- **The dead proto.** `proto/kubeswift/v1/sandbox.proto` declares a
  sandbox service with a sixteen-field create message and an
  eleven-field create-pool message, and **nothing implements it in Go
  or wires a client in Angular**. The sixteen is therefore *not* a live
  baseline the way SPEC-0013's fifteen-field guest RPC was.

Host references: the four shipped M6 dialogs and the W12 create
pattern, reused wholesale. **No new host machinery, no feasibility
gates.**

## Scope

One M6 row: "Sandbox / SandboxPool creation".

1. **Create Sandbox** on the Sandboxes page and **Create Sandbox Pool**
   on the Sandbox Pools page, each the host's own floating "+"
   (`addRemoveButtons`, the SPEC-0013 idiom), opening **two separate
   dialogs** (W12): two objects with two lifetimes, where one dialog
   would be a create whose verb changes under the OK button.
2. **The sandbox form authors twenty-six of the forty-four leaves.**
   Left out, each named in the form's footer as YAML-editor territory
   rather than silently absent: `env[].valueFrom` (sixteen of the
   forty-four, and behaviourally ignored), `scratchDisk.blank.volumeMode`
   (a no-op) and `gpuResourceClaim.hugepages`. Upstream reaches eleven
   real leaves, plus one the CRD does not declare.
3. **The pool form authors all fourteen**; upstream's misses three.

Excluded, with destinations. **Editing either kind**: the host's YAML
editor edits, and what an edit can and cannot do is said in the write
summary instead. **A scale stepper on the pool**: `spec.minWarm` is the
`scale` subresource's spec path, so `kubectl scale` and an HPA move the
number this form sets, but changing it later is an action with its own
findings - among them that upstream's drawer stepper does *not* use the
subresource but applies a four-key object through the generic apply.
SPEC-0008 deferred the stepper to M6; it is the actions row. **A
warm-slot table**: SPEC-0008's deferral stands. **Exec, attach and the
workload console**: M7.

## Design

### What creating each kind actually does

**SwiftSandbox, the cold path.** Namespace launcher RBAC and a per-pod
scoped grant; native GPU allocation behind a finalizer; the scratch
disk (a PVC named `<sandbox>-scratch`, `ReadWriteOnce`, **always
`Block`**, owner-referenced, refusing a same-named claim it does not
own, gated on Bound); a registry resolve. Then, **all owned by the
sandbox: a runtime-intent ConfigMap, a Pod named exactly `<sandbox>`,
and a NetworkPolicy when `network.mode` is not `none`. No Service and
no Secret are ever created.** The pod is `RestartPolicy: Never`,
node-selected on the kernel-node label merged with `spec.nodeSelector`,
with init containers for materialize, the model and the GPU before a
privileged launcher holding `/dev/kvm`. Six facts shape the form, four
of them existing only because the webhook ships disabled:

| Fact | Consequence for the form |
| --- | --- |
| **The first observable state is an empty `status.phase`, not `Pending`** - that phase is in the enum, the metrics labels and a test, and is written by no controller, while both upstream docs and SPEC-0008's manual-check sentence present it as the first state | No summary line may promise a `Pending` row (correction 3, open item O2) |
| **Nothing self-heals.** **Terminal**: an invalid pull secret, an image or model resolve failure, a non-zero materialize exit, a `timeout` breach, a Failed pod. **Parks and never turns terminal on its own**: a GPU profile missing, out of capacity or on an unsupported tier (30-second requeue), and a scratch PVC missing or not Bound (3-second requeue) - indefinitely, as an **empty phase with one False condition** | SPEC-0013's "create early, it heals" sentence must not be borrowed: terminal says delete-and-recreate, parked says it waits forever and names the pair a reader will see |
| **The whole spec except `ttl` is immutable** - webhook-only, no CEL, no controller check - so with the webhook off every field becomes mutable and the edit is a **silent no-op**: the launch is built only when the launcher pod is missing | The summary says what an edit can and cannot do; no edit path is offered |
| **`spec.scratchDisk: {}` makes the controller dereference a nil pointer**, the sharpest webhook-off consequence in the domain | The object must be inexpressible, not validated (A5) |
| **`env[].valueFrom` is schema-complete and behaviourally ignored**: the merge takes the literal value only, for an in-code reason - a microVM has no downward-API or Secret path - so a `secretKeyRef` variable reaches the guest **empty** | Not offered, with the reason in its place (A3) |
| **`scratchDisk.blank.volumeMode` is a no-op on three legs**: enum-allowed, webhook-rejected, controller-hardcoded to `Block`; SPEC-0008 has the first two | Not offered; "always Block" is stated as a derived fact (A5) |

**Checkout.** Setting `spec.poolRef.name` at create time **is the
entire client-side protocol**: no claim field, no lease, no annotation
or label a client sets, and no gateway RPC - so a CRD-native client
with only the Kubernetes API can check a slot out, which is the
question this milestone carried.

- **A warm slot is a Pod, not a custom resource**, named
  `<pool>-slot-<five random lowercase alphanumerics>`, labelled with the
  pool and a warm/claimed slot-state and owned by it. The claim is a
  label flip plus the pool's ownerRef **stripped and re-parented to the
  SwiftSandbox**, under an optimistic update where a conflict means
  another claim won. The workload rides three pod annotations (an exec
  action, an id equal to the sandbox UID, JSON arguments), and the
  **terminal signal is the exec-status annotation, not pod
  termination**, because the slot's idle keeper keeps running.
- **A miss is never a failure**: `status.podRef` becomes the sandbox's
  own name, a cold-fallback event fires, the cold path runs. **A
  command-less pooled sandbox always cold-falls-back**, because only
  the cold path resolves the image's entrypoint; upstream warns
  nowhere.
- **Nothing verifies that the claimant's shape matches the slot's.**
  Four schema descriptions and the warm-pool doc say a claimant "must
  match" the pool's `image`, `cpu`, `memory` and `rootfsMode`. No
  webhook (there is none for the pool) and no controller compares them:
  **a mismatched image silently runs your command inside the pool
  image's rootfs.** This is the headline improvement of this spec.
- **What a client cannot do**: choose a slot, see its identity except
  through `status.podRef` after the fact, or return one - a consumed
  slot is deleted and a fresh one warms. Two webhook-only rules make
  `poolRef` exclusive with either GPU backend; with the webhook off
  **the checkout runs first and the GPU request is silently ignored**.

**The two expiries**, and there is no third: **no idle timeout distinct
from the hard TTL** exists for either kind, since pool scale-to-zero is
HPA-on-`minWarm`, which the code says is not a pool-side idle timer.

| Field | Enforcer | Effect |
| --- | --- | --- |
| `timeout` | the controller, on every five-second poll from `status.startedAt`; on a checkout the node agent enforces it in-guest too | deletes the launcher or slot pod and marks the sandbox Failed with a deadline reason |
| `ttl` | the controller, once the sandbox has been terminal that long, requeue capped at one hour | **deletes the SwiftSandbox object itself**, not just its pod. Unset means keep forever |

Neither carries a schema pattern or format, and the rules refusing a
non-positive duration are webhook-only: a negative `timeout`
force-terminates on the first poll, a negative `ttl` deletes the object
on the first terminal reconcile.

**Materialize** is a privileged init container in the launcher pod, not
a Job and not a daemon, running as root to preserve ownership and
setuid bits. With a verify key it resolves the digest, verifies, and
**re-pins to the verified digest**, so a tag swap between verify and
pull cannot happen. Its JSON result becomes `status.rootfs`, and its
logs are one container switch away in the tab SPEC-0008's launcher-pod
affordance opens.

**SwiftSandboxPool.** A GPU finalizer before any GPU slot warms;
namespace launcher RBAC plus a per-slot scoped grant; an image resolve
only when slots are being created. Per slot: an intent ConfigMap and a
launcher Pod, both pool-owned, plus a deny-ingress NetworkPolicy when
the slot is networked, with a **soft** spread over hostname.

| Fact | Consequence for the form |
| --- | --- |
| **The pool is not a template of a sandbox**: it flattens a subset of the shape and **deliberately omits every workload field** (`command`, `args`, `env`, `workingDir`, `timeout`, `ttl`), which belong to the claiming sandbox | Every pool field except the two warm-buffer counts is a sandbox field, so the two forms share one section and one pure module |
| **`memory` is per slot**: N warm slots hold N times it, idle, and a warm GPU pool holds one whole GPU idle per slot | The sizing line, arithmetic on the form's own values (B3) |
| **`maxWarm: 0` or absent means no cap beyond `minWarm`**, and a cap *below* the floor is silently folded to the larger of the two - the controller's comment says bounds are the webhook's job, and there is no webhook | Both zeroes explained; the fold named as the reason for the refusal (B3) |
| **No immutability at all**: every field is editable, the controller re-resolves, new slots take the new shape and **existing slots keep the old one** | Said in the pool's summary, and it is why the sandbox's derivation is a snapshot |
| **Replica naming is `<pool>-slot-<five lowercase alphanumerics>`** - not ordinal, not stable across recreation, unlike SwiftGuestPool's ordinals; scale-down prefers not-launcher-ready slots and never drains claimed ones | The naming fact in the summary, and the 242-character name cap (B1) |
| **Status honesty**: `Pending` is never written here either; a reconcile that errors before the status update **writes no phase at all**; `warmReplicas` counts launcher-ready slots only against a `claimedReplicas` counting every live non-warm one, so **warm plus claimed is not a conserved total**; `observedGeneration` is stale on a Degraded pool | The summary promises no phase, and the picker's counts are read as what they are |
| **An HGX GPU profile has no status surface at all**: the tier is rejected when the first slot is allocated, on a path that returns before the status update, so the pool never reaches Degraded, never gets a message, and error-backoffs forever with an empty phase | The form refuses it (B4, S11) |

### The forms

**Registration.** One line per page, the shipped SPEC-0013 idiom:
`addRemoveButtons={{ onAdd, addTooltip }}` renders the host's floating
"+". Both pages also take SPEC-0013's clearance rule, since the host
renders Edit and Delete for every registered kind and the last row's
kebab would otherwise sit under the button.

**Dialog A: Create Sandbox** (sectioned scroll, W12), in reading order.
A collapsed section states its consequence on the header line whether
it is open or shut.

| # | Section | Fields, rules and facts |
| --- | --- | --- |
| A1 | Identity | Namespace (`NamespaceSelect`, `light` theme, prefilled only when the page filter names exactly one namespace - never the literal `default` upstream stamps); name as a DNS-1123 **subdomain**, not the label SPEC-0013 argued for a guest, because the name becomes a Pod name and a PVC stem and **no Service is ever created** - capped at 245 on the blank-scratch branch, since the claim is `<name>-scratch` and a sandbox whose PVC cannot be created is admitted and then waits on Binding forever; the store collision warning, which warns and never blocks |
| A2 | Source | The two modes, below |
| A3 | Workload | `command` and `args` as **repeatable argv rows**, one row per argument, which makes upstream's whitespace-splitting bug inexpressible; `workingDir`; `env` rows of name and literal value, with **`valueFrom` not offered** and the reason in its place. An absent command says what the schema says: the image's own entrypoint runs |
| A4 | Slot shape and placement | `cpu`, `memory`, `rootfsMode`, `network.mode`, `kernelProfileRef` (namespace-scoped picker), `nodeSelector` rows merged with the kernel-node label. Replaced in checkout mode by the pool's shape as read (O4) |
| A5 | Scratch disk (collapsed) | A three-way control - **None** / **Blank** / **Existing claim** - so `spec.scratchDisk: {}`, the nil dereference, cannot be built at all, and `None` omits the block. Blank takes a size (refused when not positive: the schema has no minimum, and a zero request fails at the PVC create and hangs the sandbox on Binding) and a storage class, with **`volumeMode` not offered** and "always Block" in its place. Existing claim is the host's `pvcApi` picker with SPEC-0013's T3 degradation, never emitting an empty name (an empty one is looked up and reported not-found forever), warning rather than refusing on a `Filesystem` claim, because that is a schema description enforced nowhere |
| A6 | GPU (collapsed, new-microVM only) | One control chooses the native profile **or** the DRA claim, so the exclusivity cannot be violated; inside the DRA branch, exactly one of claim name and template name is a refusal naming both fields. No empty-name profile reference is ever emitted. The parks-forever expectation sits on the header line |
| A7 | Lifecycle | `timeout` and `ttl`, validated as positive Go durations with their consequences as the reason. **TTL's sentence is the one this form exists to say**: the object being created deletes itself once it has been terminal that long, and unset means kept forever. Upstream offers neither field |
| A8 | Registry and verification (collapsed) | `imagePullSecret` and `verifyKeySecretRef` as Secret pickers with T3 degradation, the verify block emitted only with a name, and the re-pin fact stated |
| A9 | Model (collapsed) | `imageRef` (the block is emitted only with one) and `mountPath`, refused when relative, `/model` shown as the effective value rather than re-sent |
| A10 | YAML footer | Scope's three exclusions, each with its reason |

**A2, the two modes**, is a radio group (the host's `Radio`, the
SPEC-0013 slice-2 precedent): **New microVM** and **Check out a warm
slot**. Checkout renders a pool picker over **the sandbox's own
namespace** - upstream's is cluster-wide while `poolRef` is a local
reference - carrying phase, warm and claimed on every option, and
disabling none, because a cold or empty pool is a slower boot rather
than an error.

- **The shape is derived, not asked for.** With a pool picked, `image`,
  `cpu`, `memory` and `rootfsMode` are rendered as facts read from the
  pool and sent from it: the four fields upstream documents as having
  to match and compares nowhere. Upstream prefills the image and
  **leaves it editable**, which is the trap itself. Making the mismatch
  inexpressible is stronger than validating it, and an operator who
  wants a different shape wants the other radio option. The derivation
  is a snapshot, since the pool has no immutability, so the summary
  says when the values were read.
- **When the pool read is refused** (T3) the derivation cannot happen:
  the picker degrades to a text input, the four fields are asked for,
  and the form **warns** that it could not compare them against the
  pool and that nothing on the cluster will either.
- **A command-less checkout warns** that it always cold-falls-back, and
  never blocks. GPU is dropped here, with the two exclusivity rules and
  the silent ignore on a pool hit as its reason.

**The sandbox write summary** (W12): `Create SwiftSandbox <ns>/<name>`,
then what this configuration creates - the intent ConfigMap, a Pod
named exactly `<name>`, a NetworkPolicy unless the network is `none`, a
`<name>-scratch` claim on the blank branch - and that no Service and no
Secret are ever created. Then: the first observable state is an **empty
phase**; a checkout claims a warm slot if one is free and otherwise
cold-boots, which is not a failure; what parks, and what is terminal
and needs delete-and-recreate; what `ttl` will do to this object; and
that only `ttl` can be changed afterwards - silently ignored on a
webhook-off cluster.

**Dialog B: Create Sandbox Pool** (flat, two collapsed sections).

| # | Section | Fields, rules and facts |
| --- | --- | --- |
| B1 | Identity | Namespace and name, DNS-1123 subdomain capped at 242, because every slot pod is `<name>-slot-<five characters>` |
| B2 | Slot shape | A4 minus the workload - `image`, `cpu`, `memory`, `rootfsMode`, `network.mode`, `kernelProfileRef`, `nodeSelector` - with `memory` labelled per slot |
| B3 | Warm buffer | `minWarm` and `maxWarm`, below |
| B4 | GPU (collapsed) | The native profile picker only - the pool schema has no DRA backend at all. An **HGX-tier profile is refused**, with what upstream does about it: the rejection happens when the first slot is allocated, on a path that writes no status, so the pool never reaches Degraded and reports nothing at all. When the profile could not be read the refusal degrades to a warning |
| B5 | Registry, verification and model (collapsed) | Pull secret, verify key (every slot verifies), model image ref and mount path |

**B3, the warm buffer.** A cap below the floor is **refused**, with
both halves of the fact: upstream's own wizard refuses it too, and
upstream's controller would silently fold it to the larger of the two.
`0` is explained on both fields - a `minWarm` of zero warms nothing
until an HPA scales it, a `maxWarm` of zero is the no-cap sentinel. The
sizing line is arithmetic on the form's own values: `minWarm` times
`memory` held idle, one whole GPU per slot on a GPU pool. `minWarm` is
named as the `scale` subresource's spec path.

**The pool write summary**: `Create SwiftSandboxPool <ns>/<name>`, then
what warms - one intent ConfigMap and one launcher Pod per slot, both
pool-owned, plus a deny-ingress NetworkPolicy per networked slot - the
naming fact, the idle-memory arithmetic, that the first observable
phase may be empty and then `Warming`, that warm plus claimed is not a
conserved total, that every field stays editable while live slots keep
the shape they booted with, and the relationship: a SwiftSandbox claims
a slot by naming this pool, a miss is a cold boot, and nothing upstream
checks that the claimant matches - which is why the sandbox form
derives its shape from here.

### Better than upstream

Baseline at `c4e53ce`: two wizards writing through a forced
server-side apply, so a name clash overwrites silently and reports
success; the namespace prefilled with `default`; cluster-wide pickers
for namespace-local references; a pool dropdown blind to phase and warm
count; the command split on whitespace; a field written that the CRD
does not declare; presence-only validation; and an Edit mode for an
immutable kind that omits its one mutable field.

| # | Improvement | Where |
| --- | --- | --- |
| S1 | `store.create`, so a name clash is the API server's own `AlreadyExists` reopened with the form intact, where upstream's forced apply overwrites the existing object and reports success | Outcome |
| S2 | The namespace never guessed: prefilled only from a single-namespace page filter, never the literal `default` | A1, B1 |
| S3 | The claimant's shape **derived from the picked pool** and sent from it, closing the "must match" rule four schema descriptions state and nothing enforces; upstream prefills the image and leaves it editable | A2 |
| S4 | The pool picker scoped to the sandbox's own namespace, carrying phase, warm and claimed on every option, and never disabled - a miss is a cold boot | A2 |
| S5 | A command-less checkout warned about, since it always cold-falls-back; upstream warns nowhere | A2 |
| S6 | `command` and `args` authored as argv arrays, so upstream's whitespace-splitting of a quoted argument is inexpressible | A3 |
| S7 | `spec.scratchDisk: {}` - the nil dereference in the reconcile loop - made unbuildable by a three-way control rather than validated | A5 |
| S8 | Every other webhook-only rule inline (the sixteen-row matrix), because the sandbox webhook ships disabled and the pool has none at all | A5-A9, B3, B4 |
| S9 | Only declared fields written and no empty-name reference ever emitted (SPEC-0013's G7 in a new place), against upstream's phantom `scratchDisk.mountPath`; and the two no-ops not offered at all - `scratchDisk.blank.volumeMode` stated as always `Block`, `env[].valueFrom` with the literal-only merge as its reason | Payload, A5, A3 |
| S10 | `timeout` and `ttl` offered at all, validated positive, with the expiry consequences named - including that `ttl` deletes the object itself | A7 |
| S11 | An HGX pool refused at the form (upstream's own rejection writes no status at all), and `maxWarm` below `minWarm` refused with the silent fold stated as the reason - upstream's wizard agrees, its controller does not | B3, B4 |
| S12 | The will-not-heal vocabulary: terminal failures say delete-and-recreate, parked ones say they wait forever with an empty phase and one False condition, and no line promises a `Pending` row | Summaries |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| CanI / RBAC pre-flight, which upstream does have here | W7 unchanged: `SelfSubjectAccessReview` is itself a write and is not exported to extensions. It also pre-flights against a permission set upstream's own RBAC presets never grant |
| A slot picker, or a "return this slot" control | The API has neither: no slot custom resource, no claim field, no way to choose or release. Inventing one would be inventing behaviour (W11) |
| Blocking a checkout against an empty or cold pool | A miss is never a failure upstream, and making it one here would be a worse product rather than a stricter one |
| A scale stepper, or any edit path, in these dialogs | Creation is the row; the sandbox is immutable except `ttl`, and the pool's stepper is an action with its own findings |
| Cluster capacity math against `minWarm` x `memory` or the GPU count | The SPEC-0012/0013 verdict unchanged. Arithmetic on the form's own values is stated; a second source of truth about the cluster is not |
| Re-sending values the API server stamps | The SPEC-0013 rule: `cpu`, `memory`, `rootfsMode`, `network.mode`, `model.mountPath`, `gpuResourceClaim.tier` and `minWarm` are effective values, not sent |
| Warning that a pooled sandbox's `model` or `scratchDisk` is ignored | The recon settles the GPU case only. O3 stays an open item rather than a sentence the product cannot support |

### Where the code lives

`components/sandbox-create.ts` (pure: the shared slot-shape model, both
payload builders, every webhook rule, the pool derivation and the
summary facts), `components/sandbox-create-dialog.tsx` and
`components/sandbox-pool-create-dialog.tsx` (the two W12 forms), plus
the create control and the clearance rule on both pages. **One pure
module for both kinds**, deliberately: every pool field except the two
counts is a sandbox field, and the sandbox form *reads the pool's
shape*, so two modules would be one rule with two implementations. The
models need **no field work**; the PR adds the schema defaults as
constants and the immutability boundary as one exported fact, and types
the pool's verify-key reference by reusing the sandbox's.
`ARCHITECTURE.md` gains the files per slice.

### Implementation slices

**Two, and the pool goes first.**

1. **Slice 1 - Create Sandbox Pool**: fourteen flat fields, no webhook
   anywhere, two collapsed sections. It builds the slot-shape section,
   the quantity / Secret / kernel / GPU-profile pickers with their T3
   degradations and the summary vocabulary on the smaller form - the
   SPEC-0013 slice-1 logic, where everything after the first slice is
   fields - and lands the two self-contained refusals.
2. **Slice 2 - Create Sandbox**: the workload, the two expiries, the
   scratch disk, the GPU exclusivities and the checkout, which *derives
   from* the section slice 1 built and can be demonstrated against a
   pool the extension itself created.

The alternative (sandbox first, as the milestone's real subject) is
rejected: the derivation reads the pool's shape, so the pool's section
would be written twice and the first slice would be the larger form
carrying machinery it also had to invent.

### Non-happy states

The W12 catalogue unchanged. Specific here: **every picker degrades to
a text input on a refused list** (T3), and the pool one degrades
furthest, because the derivation depends on it. **A cold sandbox
store** makes the collision warning *unverifiable* rather than absent
(SPEC-0013's `existingNamesUnverified`): an empty list from a refused
read is never "the name is free". **403 is the expected failure on a
well-run cluster**, since upstream's RBAC presets grant only read on
both kinds, so W9's prefix names the verb, the plural and the
namespace. **AlreadyExists** reopens with the form intact.

### DESIGN.md conformance

W1-W12 in full, with no new host machinery and no feasibility gates.
Section 12's collapsed-section rule is honoured literally: the
collapsed sections are optional, consequence-bearing, hide no required
field, state their consequence on the header line, and open themselves
when they hold an error. The shared quantity field and pickers
are defined by SPEC-0014, which landed first (O5, resolved).

## Tests (non-regression list)

- **Unit** (`sandbox-create.test.ts`): the sixteen-row webhook matrix
  as sixteen cases, each with its consequence and, where it refuses, a
  non-empty reason (W4); the pool's always-on consequences; the payload
  properties (no empty-name reference, no empty `scratchDisk`, no
  undeclared key, never `poolRef` together with a GPU backend); the
  pool derivation and its degraded branch; the command-less warning;
  the duration and name-length rules; `maxWarm`/`minWarm` and its fold;
  the HGX refusal; and every conditional summary line, including the
  empty-phase fact and the will-not-heal vocabulary. One case per rule
  row plus one per summary line is the bar, which puts these two forms
  between the shipped one-field dialogs and Create Guest's figure.
- **Integration**: unchanged.
- **E2E**, per slice, with the honest split stated once: **no
  controller runs in the E2E cluster**, so a created sandbox stays
  phaseless, no pod is built and no slot is claimed - unusually kind
  here, since a phaseless sandbox is what a *real* cluster shows first.
  A checkout case **can** prove the whole client protocol: a create
  carrying `spec.poolRef.name` admitted and read back with exactly that
  field, against the `e2e-sandbox-pool` fixture, plus the shape derived
  from it. It **cannot** prove the claim, the re-parent, the
  cold-fallback event or the counts moving; those are manual.
  - *Slice 1*: creates a pool, read back key-exact with the stamped
    defaults asserted; refuses `maxWarm` below `minWarm` with the fold
    as its reason; refuses an HGX profile with the no-status reason;
    cancel writes nothing.
  - *Slice 2*: creates a cold sandbox with the workload, a blank
    scratch disk and a model, read back key-exact with the sent keys
    and the stamped defaults; creates a checkout and asserts `poolRef`
    and the derived shape, with the four controls rendered as facts;
    warns on a command-less checkout and submits anyway; refuses the
    scratch-disk rules (a zero size, and the empty block asserted as
    unbuildable rather than validated), the GPU exclusivity, the DRA
    one-of, a relative mount path and a negative duration, each with
    its reason; and the `AlreadyExists` reopen that keeps the form.
  - *Fixture additions*: `210-sandbox-create.yaml` with
    `e2e-sandbox-pool-cold` (no status injected, so the no-warm-slot
    branch and the cold-boot warning have something real to render),
    `e2e-sandbox-create-taken` and `e2e-sandbox-pool-create-taken` for
    the collision warnings. Reused as they stand: `e2e-sandbox-pool`,
    `e2e-gpu-profile-hgx` and `e2e-gpu-profile-pcie`, `e2e-kernel-6-12`,
    the two Secrets of `125-sandbox-references.yaml` and the two claims
    of `195-swiftguest-create-volumes.yaml`. Created objects are named
    after the wall clock, as the shipped write cases are.
- **Manual verification** (escalated to Roberto, PROCESS.md), on a real
  KVM cluster - where the checkout gets proved: a warm slot **actually
  checked out** (`status.podRef` naming a slot pod, the checked-out
  versus cold-fallback events, the counts moving as it is consumed and
  replenished, and the slot pods visible in the Pods list under their
  slot names - the only way a user ever sees one); a command-less
  pooled sandbox cold-falling-back and reading as a normal boot; a
  fresh sandbox's **first phase being empty, not `Pending`** (O2), and
  a parked one showing an empty phase with one False condition;
  **`ttl` expiry**, the object vanishing from the list while a drawer
  is open on it, against `timeout` expiry, which leaves it behind; the
  **materialize logs** through SPEC-0008's affordance; whether the
  webhook is on or off (O1), and `spec.scratchDisk: {}` applied by
  `kubectl` in a throwaway namespace to confirm the nil dereference
  parks the sandbox rather than crash-looping the manager (S7 rests on
  it); and, on the pool, `Warming` to `Ready` counting launcher-ready
  slots only, `kubectl scale` draining not-ready slots and never
  claimed ones, and an HGX pool writing no status at all. Record date,
  tester and result here.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Create Sandbox Pool as implemented (2026-09-01)

Slice 1, as planned, on the SPEC-0011/0013 machinery unchanged for the
seventh time: the W12 create pattern, the MobX model outside React, the
observable `okButtonProps`, the catch-never-rethrow submit with the 409
reopen, `store.create`, the host's own `addRemoveButtons`, and the shared
`create-dialog` primitives - which needed **no addition and no change**,
as they did not for SPEC-0015.

**The typed models needed nothing at all**, for the fifth time:
`swiftsandboxpool-v1alpha1.ts` already declared all fourteen leaves,
including the `verifyKeySecretRef` this spec expected to have to type
from the sandbox's (it carries its own `{ name: string }`, and the
sandbox's `SwiftSandboxVerifyKeySecretRef` is the same shape by
coincidence rather than by sharing - neither was touched). What the PR
adds to the domain is what the spec asked for: the schema defaults as
constants and the immutability boundary as one exported fact,
`sandboxImmutabilityBoundary`, whose `pool` half is a summary line and
whose `sandbox` half is there for slice 2.

**Two facts about the API server were proved on the E2E cluster before
they were asserted**, because the spec asked for the first one and the
second one fell out of it:

1. **A create that never mentions `memory` is admitted**, although the
   CRD lists it as required: structural-schema defaults are applied
   before `required` is validated, so the stored object carries `512Mi`.
   The same probe showed `cpu: 1`, `minWarm: 1` and `rootfsMode: block`
   stamped from the schema. No deviation follows: the form omits all of
   them.
2. **`spec.network` stays absent entirely.** `network.mode`'s default
   lives INSIDE the `network` block, so an object that omits the block
   gets no `mode` at all - unlike `model.mountPath`, which IS stamped
   into a `model` block that carries an `imageRef`. The tests section
   above says "`network.mode` as the schema defaults them"; the E2E case
   therefore asserts `spec.network` **undefined**, which is the stronger
   assertion of the two, since it is also the proof that the form sent no
   network block.

These are the places the implementation is more specific than, or
different from, the text above:

- **The slot-shape sections take a shape owner, and there is no
  `embedding` callback.** SPEC-0015's extraction is reused in shape but
  not in full: the components take a `SandboxShapeOwner` - values with a
  `namespace` and a `shape`, the picker facts, the two collapsed
  sections' open state and one `onValuesChanged` hook - which both this
  form's values and slice 2's satisfy structurally. The optional
  divergence callback the guest pair needed is NOT added, because slice 1
  has no divergence to route through one; slice 2 adds it if its
  derivation needs more than a transformation of `values.shape`.
- **One rule for every stamped value, rather than two.** A value is
  omitted from the payload when the field is empty AND when the operator
  typed exactly the value the schema defaults to: the stored object is
  the same either way, and one rule is testable where "empty means
  omitted, typed means sent" would have made `cpu: 1` a key the form
  sometimes writes and sometimes does not.
- **`maxWarm` is the exception, and `0` is sent when it is typed.** It
  has no schema default at all, so an explicit `0` is not a re-sent
  default: it is the schema's own no-cap sentinel, chosen by the
  operator, and the readback matches what the summary said. Both zeroes
  are explained on their own field, as B3 requires.
- **The image field carries two rules the spec does not name**: it is
  required (the schema's own) and it refuses whitespace. Neither is a
  webhook rule - there is no webhook - and the second is the kernel
  form's padded-reference argument in a new place: a reference that
  reaches the pull with a leading space is a registry lookup that fails,
  on every node, about a name nobody typed.
- **The node selector gained per-row rules the spec does not
  enumerate**: a value with no key is refused (a map has no such entry,
  so the value would simply not be sent), a duplicate key is refused (the
  second row would silently replace the first), and a malformed label key
  or value is refused with what it really produces - a `nodeSelector` is
  a plain map in this schema, so nothing refuses it here, and what fails
  is the launcher Pod the controller builds, on every reconcile. An
  entirely empty row is not an error; it is dropped from the payload.
- **The model mount path is option-dropped rather than validated.** The
  control is not rendered until a model image is named, since the `model`
  block is emitted only with an `imageRef` and a lone mount path could
  never be sent; the sentence stands in the control's place (W12). The
  relative-path refusal therefore exists only on the branch where it can
  matter.
- **The two collapsed sections' open predicates are keyed on the shape,
  not on the pool** (`slotGpuSectionHasError`,
  `slotRegistrySectionHasError`), for the same reason the sections are:
  slice 2 calls them unchanged.
- **The pool gets a footer although it authors all fourteen fields.**
  Scope says nothing is left to the YAML editor here, which is true and
  is exactly why the footer says something else: the editor is what
  **edits** a pool, since no edit path is offered, and `minWarm`
  additionally moves through the `scale` subresource without anyone
  touching the spec by hand. A footer that said "nothing is missing"
  would have been the only line of this form that taught nothing.
- **`GuestGpuProfileFacts` and `gpuProfileSummary` are reused from
  `guest-create.ts`** rather than re-declared. It is the same CRD, read
  the same way, and a second reading of one object is the drift this
  repository removes elsewhere.
- **The name budget is 242 and the arithmetic is in the refusal**:
  `253 - len("-slot-") - 5`, with the boundary pinned at 242 and 243 in
  the unit suite. The refusal names the slot pod's shape and the fact
  that nothing upstream checks any of it.
- **The E2E "cancel writes nothing" case is folded into the collision
  one.** The spec lists them as two bullets; they are the same fact from
  two sides - the warning never blocks, and the dialog that is dismissed
  wrote nothing - and one case asserts both with `kubectl` as the
  authority.
- **The suite's section opener is renamed `openFormSection`.** It was
  `openGuestSection` and is generic; it now serves two forms.
- **The 80px create-button clearance is repeated a third time**, in the
  Sandbox Pools stylesheet, with the comment saying where the other two
  are. The SPEC-0015 argument is unchanged: the value is measured against
  the host's own button, and a shared partial for three declarations is
  indirection without a reader.
- **The registry section's header line is capitalized**, which came out
  of the screenshot pass rather than the plan: it read as a sentence
  fragment, and the fix is that each of its three clauses now begins with
  a word of prose rather than with a value, so whichever comes first can
  be capitalized without corrupting an image reference.

### Open items after slice 1

- **O1 is untouched and unaffected for the pool.** There is no webhook
  for SwiftSandboxPool at all, so every refusal this form makes is ours
  whatever the cluster's webhook setting is. It still decides the sandbox
  half, in slice 2.
- **O2, O3 and O4 are sandbox-side** and are untouched by this slice.
- **O5 was already resolved at approval time**, and the shared primitives
  were consumed exactly as it says: the quantity field and the T3 object
  picker are used unchanged, and the key-in-object selector is not needed
  by this form.

### Create Sandbox as implemented (2026-09-01)

Slice 2, as planned, and the last implementation slice of M6. The machinery
is the SPEC-0011/0013 one unchanged for the eighth time: the W12 create
pattern, the MobX model outside React, the observable `okButtonProps`, the
catch-never-rethrow submit with the 409 reopen, `store.create`, the host's
own `addRemoveButtons`, and the shared `create-dialog` primitives - which
needed no new CONTROL, for the third slice running, and one addition that is
not a control at all: `dialogReopenDelay`, the constant the 409 reopen waits
out, whose reason is the finding below.

**The typed models needed nothing at all**, for the sixth time:
`swiftsandbox-v1alpha1.ts` already declared all forty-four leaves from the
CRD schema, including `SwiftSandboxScratchDisk`,
`SwiftSandboxGpuResourceClaim`, `SwiftSandboxEnvVar` and the
`SwiftSandboxVerifyKeySecretRef` whose `name` is genuinely required. The
schema was re-read at `v0.13.12` while this form was written and matched
the model field for field; the only thing this PR adds to the domain is the
sandbox half of the pure module.

**What the E2E proves about the checkout, and what it cannot.** The whole
client-side protocol is one field, and a case proves it end to end: a create
carrying `spec.poolRef.name` is admitted, read back with exactly that field,
and carries the four "must match" values read from the pool. The proof needed
a pool whose shape is NOT the schema's defaults, which is why
`e2e-sandbox-pool-cold` carries `cpu: 2`, `1Gi` and `virtiofs` - three values
the API server would never stamp, so a readback that shows them can only have
got them from the pool. What no E2E here can prove, and what stays manual:
the claim itself, the label flip, the ownerRef re-parenting, the
cold-fallback event, and the counts moving as a slot is consumed and
replenished. No controller runs in this cluster, so every sandbox it creates
stays phaseless - which is, unusually, exactly what a real cluster shows
first.

These are the places the implementation is more specific than, or different
from, the text above:

- **The two forms share their FIELDS, not their sections.** Slice 1 exported
  `SlotImageField`, `SlotShapeFields`, `SlotGpuSection` and
  `SlotRegistrySection`, and slice 2 was expected to render all four. Two of
  them could not be: this spec's own A8 and A9 are **two** collapsed sections
  where B5 is one, and A6 is a three-way backend control with a DRA branch
  that a checkout removes entirely, where B4 is a profile picker alone. So
  the picker and the three registry controls were extracted -
  `SlotGpuProfileField`, `SlotPullSecretField`, `SlotVerifyKeyField`,
  `SlotModelFields` - and the two section wrappers stay the pool's. The rule
  is unchanged and is better served: there is exactly one implementation of
  each control, its validation, its T3 degradation and its payload, which is
  what would drift at the next field these CRDs gain; a section wrapper is
  four lines of grouping and the two kinds genuinely group differently.
- **There is still no `embedding` callback, and what the components take is a
  `wording`.** Slice 1 left the SPEC-0015 callback out and said slice 2 would
  add it "if its derivation needs more than a transformation of
  `values.shape`". It does not: the derivation is exactly that. What the two
  forms disagree about inside the shared controls is the SENTENCES - every
  one of them has a warm slot as its subject on a pool and the object being
  created on a sandbox - so `SlotShapeWording` is a record of those
  sentences, with `poolSlotShapeWording` as the default, and slice 1's
  rendering is byte-identical. `slotShapeWarnings` takes the same treatment
  for the same reason, through `SlotShapeWarningWording`.
- **The sandbox does NOT inherit the pool's HGX refusal, and that is the
  sharpest divergence in this slice.** B4 refuses an HGX-tier profile because
  a pool's controller rejects the tier on a path that returns before the
  status update, so the pool reports nothing at all, forever. A sandbox on an
  unsupported tier does something different: it **parks**, as an empty phase
  with one False condition and a thirty-second requeue, which A6 asks to be
  stated on the header line rather than refused. `sandboxShapeErrors`
  therefore calls the individual rule functions (`slotImageError`,
  `slotCpuError`, `slotMemoryError`, `modelMountPathError`) rather than
  `slotShapeErrors`, which is the pool's aggregation and keeps its rule
  untouched. A unit case asserts both halves side by side.
- **The derived shape IS sent even when it equals a schema default**, which
  is the one deliberate exception to slice 1's "one rule for every stamped
  value". On the cold path the rule is unchanged. On the derived branch the
  four values are neither this operator's choice nor the schema's: they are a
  reading of another object at a point in time, and what makes the claim
  auditable afterwards is that the stored sandbox records what was compared,
  rather than carrying a default that looks identical to it. The pool has no
  immutability, so a sandbox that omitted `memory` because the pool happened
  to say `512Mi` would be indistinguishable from one that never looked.
- **The name has two caps and two messages**: 253 normally, and 245 on the
  blank-scratch branch, where the claim is `<name>-scratch`. The refusal
  carries the arithmetic and the consequence - a sandbox past the budget is
  admitted and then waits on Binding forever - and a unit case pins both
  boundaries and asserts that the same name is legal without the branch,
  which is what makes the cap a consequence of a choice rather than a
  preference.
- **An empty argv row is REFUSED, where an empty node-selector row is
  dropped.** The two rules look inconsistent and are not: a map loses nothing
  when an unfilled row is dropped, while an argv array shifts every element
  after it, so the row is named and refused and removing it is one click.
- **The environment rows gained three rules the spec does not enumerate**:
  the name is required (the schema's own), it carries no whitespace and no
  `=` (the variables are merged over the image config's environment as
  `NAME=value` lines, so either character corrupts the line it lands in), and
  two rows cannot share a name (the merge keeps one and says nothing). An
  empty VALUE is not an error and is sent as one: a variable that is set and
  empty is a real variable.
- **`workingDir` gets no rule at all**, only a hint. A relative working
  directory is resolved against the image's own, which this form cannot read,
  and refusing or warning about it would be inventing behaviour the recon
  could not confirm - the limit W11 puts on this whole exercise.
- **A checkout drops the network mode, the kernel profile and the node
  selector as well as A4's four fields**, and `switchSandboxSource` clears
  them. O4's answer is that the documented match set is the four only, and
  not asking for the other three cannot produce a wrong object; the YAML
  editor is the escape hatch. What the switch does NOT clear is the image,
  the vCPUs and the memory, because the degraded branch asks for exactly
  those three again.
- **The degraded branch asks for the four and nothing more.** When the pool
  list read is refused the picker becomes a text input and the image, vCPUs,
  memory and root filesystem come back as controls, with a warning that names
  what nothing on the cluster will check. It does not bring back the kernel
  profile or the network mode: one failed read is not a reason to ask for
  fields the object does not need.
- **The degraded branch has unit coverage only, deliberately.** Making the
  pool list read fail on the E2E cluster would mean revoking a permission from
  the kubeconfig the whole suite shares, which would break every other case;
  the branch is a pure function of `poolsUnverified` and is covered by six unit
  cases, including that the image comes back as a refusal there and that the
  warning names what nothing on the cluster will check. This is the same
  treatment every T3 degradation in this repository has.
- **A8 can never hold an error, so it has no self-opening predicate.** The
  pull secret and the verification key have warnings and no refusals - a name
  that resolves to nothing is a terminal failure at materialize time, not an
  admission error - so the registry section opens only when the user opens
  it. A5, A6 and A9 each have one.
- **`gpuResourceClaim.requestName` and `.tier` are offered**, and
  `hugepages` is not. That is what scope's twenty-six leaves means in
  practice, and `tier` follows the effective-values rule: the control exists,
  and `pcie` is never re-sent.
- **The 80px create-button clearance is repeated a fourth time**, in the
  Sandboxes stylesheet, with the comment naming the other three. The
  SPEC-0015 argument is unchanged.
- **The pool read's timestamp is part of the model**, because the derivation
  is a snapshot of an object nothing makes immutable. It is shown under the
  four facts and again in the summary, in the sentence that says what a later
  edit of the pool does and does not do to this sandbox.
- **A7 is rendered before A5 rather than between A6 and A8.** The section
  table's reading order puts the two expiries between the GPU section and the
  registry one, which would leave two always-visible text inputs sitting
  between two collapsed sections and break the four-section tail in half. The
  form reads identity, source, what it runs, what it runs in, how it ENDS,
  and then the collapsed tail - which is the same narrative and keeps every
  collapsed section adjacent, the way every shipped form of this repository
  ends. Nothing else moved.
- **The write summary states the timeout and the TTL as two separate
  facts**, always, whether they are set or not. They are the two ways a
  sandbox ends and they are routinely confused: one deletes a pod and leaves
  the object, the other deletes the object itself. Saying nothing when the
  field is empty would drop the sentence exactly when the operator has not
  thought about it.

**What the screenshot pass caught**, both themes, 42 shots in
`e2e-artifacts/spec-0016-slice-2/` (gitignored):

- **The 409 reopen was leaving the dialog at `opacity: 0`, forever, on every
  create dialog this repository ships** - and this is the finding of the
  slice. The mechanism is in `@freelensapp/animate` (Freelens 1.10.3): when
  its `enter` prop goes false it adds a `leave` class and schedules a
  `setTimeout(leaveDuration)` that clears `isVisible`, `enter` and `leave`
  together, and its effect's own cleanup CANCELS that timeout when `enter`
  goes true again. The W12 reopen is `setTimeout(() =>
  ConfirmDialog.open(params), 0)`, which always lands inside that 100ms
  window, so the reopened dialog keeps BOTH classes and
  `.opacity-scale.leave` wins the cascade: a form nobody can see, over a page
  nobody can click, because it still intercepts every pointer event.
  Measured on the E2E cluster in both themes, at one second and again at five
  seconds after the reopen, and then measured again on the **shipped Take
  Snapshot dialog**, which reproduces it identically. Nobody caught it before
  because every E2E assertion on a reopen reads `inputValue()`, and an
  `opacity: 0` element answers that perfectly.
  - **Fixed here** by `dialogReopenDelay` (250ms, in `create-dialog.tsx` with
    the mechanism and the measurement next to it), and the E2E case now waits
    for the dialog to DETACH before waiting for it to come back, then asserts
    that it carries no `leave` class and computes `opacity: 1`. That assert is
    what stops the fix regressing, and the follow-up below factored it into the
    one `expectReopenedDialogVisible` helper every 409 case now shares.
  - **The other ten create dialogs carried it too**, because their `reopen`
    closures were their own. **The follow-up landed on 2026-09-01**: all ten
    reopen through `dialogReopenDelay`, none of them declares a delay of its
    own, and the shared assert runs on the shipped Take Snapshot dialog as well
    - the one this pass reproduced the defect on, which failed that assert
    before the fix and passes it after. The `Animate` bug itself goes on the
    upstream-Freelens list next to the kebab-unmount finding and the hardcoded
    white box.
- **The scratch-disk section's header line was saying, in the same screen,
  what its three radio descriptions and its always-Block fact say one scroll
  below.** That is the duplication SPEC-0013 slice 3 removed from the GPU
  section, made a second time. The three header lines are now short - what the
  disk IS and what happens to it - and the always-Block fact stands alone
  where the control would have been.
- **Five shared REFUSALS were telling a sandbox operator what a pool would
  do**, which is the same class of defect one level deeper than the warnings:
  the image was required because "every warm slot boots" it, a padded
  reference was excused because "the pool has no admission webhook", a zero
  vCPU count ended "a pool of them warms nothing", a malformed node-selector
  key said "the pool stores whatever is typed", and a relative model mount
  path said "there is no pool webhook" and produced "a slot". They are one
  `SlotShapeRefusalWording` record now, with the pool's as the default so
  slice 1 is byte-identical, and a unit property asserts that no sandbox
  message contains the word "pool" while the pool's still do - which is what
  keeps the two from being swapped back.
- **The pull secret's warning was reaching the sandbox form in the POOL's
  words** ("the pool never warms one"), because `SlotPullSecretField`
  computed it itself instead of taking it. It takes it now, like the
  verification key beside it.
- **SPEC-0014's shared zero-quantity refusal was talking about a class and
  its guests** ("so a class with a zero here is stored happily and produces
  guests that cannot start") on a form about neither, which slice 1's pool
  form already did and nobody had seen rendered. It is one sentence in
  `guestclass-create.ts`, every reference to it is by constant rather than by
  text, and the neutral form is true of all five forms that render it, so it
  is fixed here rather than left: "a zero here is stored happily and produces
  an object nothing can start".
- **The scratch section's header line was quoting a size that was being
  refused**, so a typed `0` read as "A new 0 claim named ...". It quotes the
  size only when the size is a quantity; the red line under the field is what
  says the rest.
- **Three header lines were repeating, in the same screen, what the controls
  under them already said**: the scratch section's (its three radio
  descriptions and the always-Block fact), the model section's (how the model
  is mounted) and the verification key's (when the check happens). All three
  are short now, and the mechanism lives on the field and in the summary,
  which is the grammar SPEC-0015 settled. None of this was caught by a test,
  which is what the screenshot pass is for.

### Open items after slice 2

- **O1 is still open and is still not observable from here.** Every rule this
  form makes is inline whatever the cluster's webhook setting is; what O1
  decides is only whether a refused create was refused by us or by the API
  server, and it needs a live cluster to answer.
- **O2 is settled as far as static recon can settle it**, and the form now
  says so in three places: the summary's first-state sentence, the E2E
  readback that asserts an empty phase, and correction 3 to SPEC-0008. One
  live sandbox still closes it.
- **O3 is unchanged and both sections stay offered in checkout mode.** The
  recon settles the GPU case only, and the form claims nothing about `model`
  or `scratchDisk` on a checkout. If the answer turns out to be "ignored"
  they become option-dropped, with the fact in their place, which is a
  one-function change here.
- **O4 is settled for this form's purposes**: the documented match set is
  `image`, `cpu`, `memory` and `rootfsMode`, so the checkout asks for none of
  `network.mode`, `kernelProfileRef` and `nodeSelector` and sends none of
  them. Not asking cannot produce a wrong object; the YAML editor covers the
  case where a claim ever needs more.
- **O5 stayed resolved.** The shared primitives were consumed exactly as they
  stand: the quantity field, the T3 object picker and the collapsible section
  are used unchanged, and the key-in-object selector is not needed by this
  form either.

### Corrections owed to SPEC-0008, in scope for this spec's PRs

Three, **all three made in the slice-2 PR** (2026-09-01) and recorded in
SPEC-0008's own Notes under "Corrections from SPEC-0016", with each
corrected sentence marked in place with that date. The upstream-side drift
this recon found - twelve schema and doc items plus six UI defects, all
argued above - is candidate upstream feedback.

1. **`RootfsReady` is declared in Go and written by nothing.** The
   carrier of a materialize failure is `GuestRunning: False` with a
   materialize-failed reason plus `status.message`, while SPEC-0008's
   fixture (`e2e-sandbox-failed`'s condition in
   `130-swiftsandboxes.yaml`, patched in `lib.sh`) and its copy lean on
   `RootfsReady: False` carrying the detail. **No code changes**:
   `sandboxMessage` deliberately hardcodes no condition type, which is
   why this is a fixture and documentation fix.
2. **SPEC-0008's note that the gateway's `SandboxService` was retired,
   "which is why kubeswift-ui has no sandbox route today", is wrong on
   both halves.** The proto still declares the service - unimplemented
   and unwired, dead code rather than a retirement - and the upstream
   UI has two wizards, two drawers and two terminals for sandboxes.
3. **`Pending` is never written for either kind**, so SPEC-0008's
   manual-check sentence promising `Pending -> Materializing ->
   Running -> Completed` starts at an empty phase instead. The
   classifiers keep their `Pending` rows: the enum still declares it,
   and removing one would be a guess about a future controller.

### Open items

- **O1. Webhook on or off** on the target cluster. It changes nothing
  in the form - every rule is inline regardless - but it decides
  whether a refused create is refused by us or by the API server, and
  it is not observable from the CRDs.
- **O2. The first observable phase.** Static recon says empty, not
  `Pending`; one live sandbox settles it, and it decides a summary
  line, our list rendering and correction 3.
- **O3. Whether a checkout honours `model` and `scratchDisk`.** The
  recon settles the GPU answer only, and records that upstream's wizard
  hides all three in pool mode. Until it is settled both sections stay
  offered in checkout mode and the form claims nothing about them; if
  the answer is "ignored" they become option-dropped, with the fact in
  their place.
- **O4. Whether a claimant's `network.mode`, `kernelProfileRef` and
  `nodeSelector` are honoured on a claim.** The documented "must match"
  set is `image`, `cpu`, `memory` and `rootfsMode` only. Not asking for
  them cannot produce a wrong object and leaves the YAML editor as the
  escape hatch; revisited if it settles otherwise.
- **O5, resolved at approval time.** SPEC-0014 landed first and
  defines the shared primitives (the quantity field, the T3 object
  picker and the key-in-object selector in `create-dialog.tsx`); this
  spec consumes them.

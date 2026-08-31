# SPEC-0013: Create SwiftGuest form (M6)

- **Status:** Approved (Roberto, 2026-08-31, in chat)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (the SwiftGuest CRD at
  upstream `main` `d66cff5` differs from the tag by two description
  lines only; CRD, webhook, controller, resolver, `swiftctl` and docs
  recon run at `d66cff5` on 2026-08-30). UX reference kubeswift-ui
  `main` `c4e53ce`.
- **Author / date:** Claude with Roberto, 2026-08-30

## Goal

An operator can create a SwiftGuest from a form: pick what it boots
from, what sizes it, what seeds it and where it runs, with every picker
scoped and readiness-aware, the class's sizing visible at the moment it
is chosen, the traps that upstream leaves to a disabled webhook closed
inline, and a write summary that says what the create sets in motion -
including which missing pieces make the guest wait and self-heal, and
which make it fail. The form covers the fields an operator reaches for;
the exotic tail stays authorable in Freelens' own YAML editor, which is
an escape hatch the upstream UI does not have at all.

## Upstream reference

- `config/crd/bases/swift.kubeswift.io_swiftguests.yaml` - the full
  field inventory this spec maps to form sections. Schema facts that
  shape everything: the only required spec field is `guestClassRef`
  (whose `.name` sub-field defaults to `""`, so `guestClassRef: {}`
  passes the API server); the only CEL rule in the CRD is the storage
  one (`ReadWriteMany` requires `volumeMode: Block`); boot-source
  exclusivity is nowhere in the schema; and the API server's structural
  defaulting stamps `osType: linux`, `interfaces[].type: bridge`,
  `network.binding: nat`, `ports[].protocol: TCP` and the migration
  sub-defaults with or without any webhook.
- `internal/webhook/swiftguest/` - the one kind with a **mutating**
  webhook, whose entire defaulting is `runPolicy: Running` when empty,
  and a validating webhook with thirty-seven CREATE rules - of which
  the recon classified the majority as **webhook-only**, with no
  controller re-check: boot-source exclusivity by name, every GPU
  exclusivity, the Windows rules, every data-disk shape rule, every
  port/expose rule, the interface-primary rules, and
  `guestClassRef.name` being non-empty. The webhook ships disabled
  (`webhook.enabled: false`), and the mutating one is `failurePolicy:
  Ignore` besides. The form is, on most installs, the only validation
  there is.
- `internal/resolved/` and `internal/controller/swiftguest/` - what a
  create sets in motion: the class merge (CPU/memory/root disk are
  class-only, storage merges per-field guest over class, osType comes
  from the **image** and the guest's value is only a cross-check), the
  objects created (seed Secret, intent ConfigMap, root-disk clone PVC
  and Job, blank data-disk PVCs, launcher pod, per-guest Service and
  PDB), and the park-versus-fail split: a missing or not-Ready image,
  class, kernel or seed produces `Resolved=False` and `phase: Failed` -
  but the failure **self-heals**, immediately for images (watched) and
  within the 30-second resync for the others, which makes
  "create early, let it catch up" a safe and stateable pattern. GPU
  profile problems park in `Pending` instead.
- `cmd/swiftctl/` - there is **no `guest create`**; the closest thing
  is `guest import` (the cloneFromSnapshot minimum: snapshot, target
  node, class), which also sets `runPolicy: Running` explicitly - the
  client-side mirror of the mutating webhook this spec adopts.
- `docs/crds.md` and `docs/api/swiftguest.md` - both list a fraction of
  the spec surface and both claim a `gpuProfileRef`/`kernelRef` mutual
  exclusion that **no code enforces**; drift recorded under "Upstream
  drift found by this recon".
- kubeswift-ui `main` `c4e53ce`, `src/app/create-guest/` - UX reference
  only (AGPL boundary, [ARCHITECTURE.md](../development/ARCHITECTURE.md)).
  The structural finding that frames the whole audit: their wizard
  writes through a gateway RPC that carries **fifteen fields**, guests
  are absent from their Explorer catalog, so their UI has **no YAML
  path for a SwiftGuest at all** - `spec.storage`, interfaces, data
  disks, migration and the DRA GPU backend are unreachable from their
  product. Their pickers are cluster-wide (namespaced kinds!), discard
  the readiness the gateway already returns, auto-select the
  alphabetically first guest class with its sizing invisible, validate
  nothing about names or ports client-side, and carry a stale-selection
  bug across cluster switches. Their genuinely good habits - typed
  create-not-apply so a name clash is an `AlreadyExists`, errors never
  swallowed, clone-as-prefill - are adopted below.

Freelens host references: the three shipped M6 dialogs and the W12
create pattern, reused wholesale. No new host machinery and **no
feasibility gates**: stateful forms in `ConfirmDialog.open`,
`store.create`, cheap picker reads and degraded cold-store reads are
all proven and shipped three times. Two host surfaces are new to this
repository but not to the host - the list layout's create affordance
and the `NamespaceSelect` component - and both were read off the
1.10.3 typings before this spec was written (Registration and section
1 below). The one open UX question a form
this size adds - legibility of a long sectioned form inside the
host's scrolling dialog box - is judged by the screenshot pass, as the
smaller dialogs' issues were.

## Scope

One M6 row: "Create SwiftGuest (form)".

1. **Create Guest** on the Guests page toolbar area and cluster page
   context (registration detail settled in Design), opening the form
   dialog; **all three boot sources** (image, kernel, clone from
   snapshot), delivered across three implementation slices.
2. **The form covers the operator surface; the YAML editor covers the
   tail.** Included fields: identity, guest class (with its sizing
   shown), boot source and its per-source fields, seed profile, OS
   type (synced from the image), run policy, node pin, storage
   overrides, data disks, network binding and ports, GPU (both
   backends, minimally), guest agent, and basic bridge interfaces.
   Excluded fields, each named in the form's own footer as
   YAML-editor territory rather than silently absent: `filesystems`,
   `vhostUserDevices` (and with them the sriov/vhost-user interface
   types), `topologySpreadConstraints`, `schedulerName`,
   `network.serviceAnnotations`, `network.loadBalancerClass`, and the
   `migration` block (its defaults are what an operator wants until
   the day they do not, and that day involves reading SPEC-0012).
3. **Clone-as-prefill**: a "Duplicate" affordance is explicitly out of
   this spec (a fourth entry point with its own questions); recorded
   as a candidate follow-up, with upstream's lossy prefill as the
   cautionary reference.

Also excluded, with destinations: editing an existing guest (the
host's YAML editor already does it; upstream cannot edit at all);
the other creation-form rows (guest class / pool / image / kernel /
seed profile - their own M6 row); sandbox creation (own row); any
bulk creation.

## Design

### What creating a SwiftGuest actually does

The recon facts the form is built on:

- **One required field, and a trap inside it.** The schema requires
  only `guestClassRef`, and `guestClassRef: {}` passes the API server
  because the `LocalObjectReference` name defaults to `""`. Only the
  webhook demands a non-empty name, and only on installs that enabled
  it. The form never emits an empty-name reference for anything - the
  same rule also avoids the resolver/webhook disagreement where
  `imageRef: {}` counts as "has an image" to one and "no source" to
  the other.
- **Boot-source exclusivity lives in the webhook, not the schema.**
  Exactly one of image, kernel, clone. The form's segmented control
  makes violating it inexpressible, which is stronger than validating
  it.
- **The class is the sizing.** CPU, memory, root-disk size and format
  come from the SwiftGuestClass only; the guest cannot override them.
  Classes are cluster-scoped, spec-only, and valid the moment they
  exist. The form therefore shows the chosen class's cpu / memory /
  root disk / storage / core scheduling next to the picker, plus the
  derived live-migratability of its storage (`ReadWriteMany` +
  `Block`), and it never auto-selects one: upstream defaults to the
  alphabetically first class with the sizing invisible, which is a
  sizing decision made by sort order.
- **The image is authoritative for the OS, and the schema default
  fights it.** The resolved OS comes from the SwiftImage; the guest's
  `spec.osType` is only a cross-check - but the CRD defaults it to
  `linux`, so a guest created from a Windows image with the field
  untouched is born `Failed` with an osType mismatch. The form reads
  the picked image's `osType` and keeps the guest's field synced,
  showing it as a fact, not a choice; Windows then activates its
  webhook rules client-side (disk boot only, no GPU, no filesystems).
- **Missing referents fail, then heal.** A referenced image, class,
  kernel or seed that is missing or not Ready produces
  `Resolved=False`, `phase: Failed` - and recovers by itself: images
  are watched (immediate re-reconcile on readiness), the others catch
  the 30-second resync. The form's pickers filter and mark readiness,
  but a user who creates against a still-importing image is doing
  something safe, and the write summary says so instead of blocking.
  GPU-profile problems behave differently - the guest parks in
  `Pending` on `GPUAllocated` - and the summary says that too.
- **The mutating webhook sets `runPolicy: Running` and nothing else**,
  and it ships off. The form sends `runPolicy` explicitly (default
  `Running`, the select the user can flip to `Stopped` /
  `RestartOnFailure` / `Always`), exactly as `swiftctl guest import`
  does, so the stored object reads the same on every install.
- **The seed can silently not run.** SwiftSeedProfile's `datasource`
  is defaulted to `NoCloud` by *its* mutating webhook; on a
  webhook-off cluster a profile created without it stays empty and
  the guest's seed is skipped without a word. When the picked
  profile's `datasource` is empty, the form says so.
- **Ports and data disks are all-webhook territory.** Every shape rule
  (exactly one disk source, `attachAsDisk` needs a `pvcRef` - and a
  Block-mode one, at most 8 disks, port names required above one
  port, one `expose` value for all ports, no `expose` under `bridge`
  binding or an sriov primary, duplicate detection) is enforced
  inline, because on a default install nobody else will, and the
  controller's failure modes for these are the silent kind - a bad
  `expose` mix quietly yields a Service of the wrong type, `expose`
  under bridge yields no Service and no error.
- **The documented-but-unenforced rule.** `gpuProfileRef` with
  `kernelRef` is declared mutually exclusive in upstream's docs and
  type comments and rejected by no code anywhere. The form enforces
  it, citing upstream's own documentation as the reason - and the gap
  is a candidate upstream issue.
- **cloneFromSnapshot is a real third boot source** with its own
  grammar: a Ready snapshot of a memory backend, a `targetNode`
  required exactly when the snapshot's backend is `s3` or `oci`
  (readable from the snapshot object in our store - upstream asks the
  user to know the tier), a guest class that is schema-required but
  inert for sizing (the resumed VM's resources come from the
  snapshot - said inline), `regenerate` where the empty list means
  all four items and `macAddresses` cannot be turned off, hard
  exclusivity with GPU, and run policy owned by the clone. A clone
  whose source guest is gone works only from a full-state oci
  snapshot; the form warns from the store when the source is missing.

### The form

**Registration.** The host renders extension pages, not toolbar
buttons, and it already has a create affordance for a list page: the
floating "+" of `AddRemoveButtons`, which every `KubeObjectListLayout`
renders from the `addRemoveButtons` prop and which core's own Namespaces
page uses for "Add Namespace". The Guests page passes
`{ onAdd, addTooltip: "Create Guest" }` and the host draws the button in
the same corner of the window as on every other list page in the app -
native-first (DESIGN.md pillar 1), where the header button this spec
first planned would have been a second idiom for something Freelens
already does. It renders whether or not the list has rows, so it is the
entry point on an empty page too; the host's own empty-list rendering
(`renderNoItems`) is a class method with no prop behind it, so it is left
alone rather than fought. The control carries no test id of ours - the
host spreads none of the props it is given onto the button - so the E2E
suite locates it through the host's own markup
(`.AddRemoveButtons .add-button`), which is the point rather than a
limitation. This is the first M6 surface not registered through
`kubeObjectMenuItems` - there is no object yet to attach a menu to - and
the dialog machinery is unchanged.

**Sections and fields.** One dialog, the W12 pattern, sections in
reading order. Defaults never fight the schema: what the API server
will stamp anyway is shown as the effective value, not silently
re-sent (except `runPolicy`, argued above).

1. **Identity**: namespace (the host's own `NamespaceSelect`, exported
   to extensions and fed by the host's namespace store, in its `light`
   theme inside the `ConfirmDialog` box as W12 requires; defaulted from
   `namespaceStore.contextNamespaces` when the page's filter names
   exactly one namespace, otherwise left for the user to pick), name
   (text, DNS-1123 validated inline - upstream validates nothing - with
   the collision warning from the guest store).
2. **Guest class**: picker over cluster-scoped classes, no
   auto-selection, with the chosen class's sizing block (cpu, memory,
   root disk size and format, storage mode with the live-migratable
   derivation, core scheduling). A missing class list degrades to a
   text input, T3-style.
3. **Boot source**: segmented image / kernel / clone from snapshot.
   - *Image*: picker over the namespace's SwiftImages showing each
     option's phase and greying non-Ready ones (selectable, with the
     will-wait note - creating early is safe and the guest self-heals
     when the image turns Ready). OS type shown as a synced fact from
     the image, activating the Windows rules when `windows`.
   - *Kernel*: picker over the namespace's Ready SwiftKernels (phase
     shown), cmdline override text; kernel boot disables GPU (the
     documented-unenforced rule) and Windows.
   - *Clone*: picker over the namespace's Ready memory-backend
     SwiftSnapshots (backend shown), conditional target node (node
     picker, required exactly for `s3`/`oci` - computed from the
     picked snapshot, not asked of the user), identity regeneration
     with the SPEC-0011 honest granularity (machine-identity trio +
     MAC, MAC locked on), the inert-class note, the gone-source
     warning from the store, GPU excluded with the VFIO reason.
4. **Seed profile**: picker over the namespace's profiles (optional);
   a clone-boot seed pick is refused with the upstream fact that the
   clone path ignores it. (The empty-`datasource` warning this section
   planned is G9, dropped in slice 1: the schema makes the field
   required.)
5. **Run policy**: select, default `Running`, each option one
   sentence (the SPEC-0010 vocabulary).
6. **Placement**: optional node pin (the SPEC-0012 node picker,
   kernel-node label rule applied for kernel boot).
7. **Storage overrides** (collapsed by default): accessMode /
   volumeMode / storageClassName over the class's values, with the
   CEL rule enforced inline (`ReadWriteMany` requires `Block`) and
   the live-migratability consequence stated both ways.
8. **Data disks** (collapsed): repeatable rows, each exactly one of
   image (Ready-filtered picker) / existing PVC (picker) / blank
   (size + class + volume mode), `attachAsDisk` only on PVC rows
   with the Block-mode requirement checked from the picked PVC when
   readable; all shape rules inline; at most 8.
9. **Network** (collapsed): binding nat / bridge with one sentence
   each (bridge disables `expose` and the per-guest Service);
   repeatable ports (port, name - required above one, target,
   protocol, expose - one value for all, the rules inline); basic
   additional interfaces (bridge type only: name, networkRef,
   primary - one only, and never on the excluded types, mac
   pattern-validated); sriov and vhost-user named as YAML territory.
10. **GPU** (collapsed, image boot only): profile picker XOR a
    minimal DRA claim (claim name or template name - exactly one),
    with the parks-in-Pending expectation stated; excluded for
    Windows, kernel and clone with reasons.
11. **Guest agent**: one checkbox (it decides how a future clone
    regenerates identity - the cross-reference is the help text).
12. **The YAML footer**: one line naming the excluded fields and the
    host's YAML editor as their home.

**The write summary** (W12): the one `Create SwiftGuest <ns>/<name>`
line plus the facts of this configuration - what the controller will
create (launcher pod, root-disk clone from `<image>`, seed Secret,
per-guest Service when ports are exposed, data-disk PVCs), the
will-wait lines (image not Ready; GPU profile allocation parks in
`Pending`), the Windows constraint line, the storage/live-migration
line, and for clone boot the SPEC-0011-style restore facts (MAC
rewrite always; the source guest's current spec is the template when
the source is alive). `labelOk: "Create Guest"`, default styling - a
create commits resources but destroys nothing.

**Outcome** (W9): `Notifications.ok` naming the object; the row
appears on the very page the dialog was opened from, via that page's
own store - the first M6 create where the user is already looking at
the right list. Failures: unchanged W9 machinery; `store.create` means
a name clash is the API server's own `AlreadyExists` (the
create-not-apply property upstream got right), reopened with the form
intact.

### Better than upstream

Baseline, measured: upstream's wizard writes 15 fields through a
gateway RPC; guests have no YAML path in their UI at all, so
everything else is unreachable; pickers are cluster-wide for
namespaced kinds, readiness-blind (discarding the phase their own
gateway returns), and carry a stale-selection bug across cluster
switches; the guest class defaults to the alphabetically first with
its sizing invisible; names, ports and namespaces are unvalidated;
ports with zero values are silently dropped at submit; osType defaults
into a Failed mismatch against Windows images; there is no
confirmation, no summary, no CanI gating, and success is a drawer that
disappears. What it gets right - typed create, verbatim errors,
clone-as-prefill, letting the watch deliver the row - is kept.

Adopted:

| # | Improvement | Where |
| --- | --- | --- |
| G1 | The whole operator surface authorable, with the exotic tail named and routed to the YAML editor instead of silently missing | Scope, YAML footer |
| G2 | Pickers scoped to the namespace and readiness-aware, showing the phase upstream discards; non-Ready images selectable with the self-heals fact instead of a guess | Sections 3, 8 |
| G3 | The class chosen explicitly, with its sizing and live-migratability visible at the moment of choice | Section 2 |
| G4 | osType synced from the image, closing the born-Failed Windows trap, and activating the Windows rules client-side | Section 3 |
| G5 | Every webhook-only rule inline - boot-source exclusivity by construction, GPU exclusivities, Windows rules, all data-disk and port/expose rules - because the webhook ships disabled | Sections 3, 8, 9, 10 |
| G6 | The documented-but-unenforced `gpuProfileRef`+`kernelRef` exclusion enforced, citing upstream's own docs | Section 10 |
| G7 | No empty-name references, ever - the schema quirk and the resolver/webhook nil-ness disagreement both closed by construction | Payload |
| G8 | `runPolicy` sent explicitly (the `swiftctl guest import` precedent), so the stored object is identical with and without the mutating webhook | Section 5 |
| G9 | ~~The seed empty-`datasource` silent-no-op warned at pick time~~ **Dropped during slice 1**: the SwiftSeedProfile schema makes `spec.datasource` required, with a single-member enum (`NoCloud`), so a stored profile cannot have an empty datasource and the warning could never fire on any cluster | - |
| G10 | Clone boot with the target-node requirement computed from the snapshot's backend instead of asked of the user, the inert class explained, and the SPEC-0011 identity granularity | Section 3 |
| G11 | Park-versus-fail expectations in the summary: what waits and self-heals, what fails and why, what parks in Pending | Write summary |
| G12 | DNS-1123 name validation and the store collision warning (warn, never block) | Section 1 |
| G13 | Success lands on the page the user is on, with the row delivered by the page's own store | Outcome |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| A multi-step wizard | The host dialog has no stepper idiom and the three shipped dialogs prove a sectioned scroll; steps would add state for no protection. Revisit only if the screenshot pass says the form is illegible |
| Exposing `filesystems`, `vhostUserDevices`, sriov interfaces, topology, scheduler, service annotations | Niche, webhook-rule-heavy, and reachable via the YAML editor Freelens already has; the footer names them so the absence is a pointer, not a wall |
| Exposing the `migration` block | Its defaults are right until the operator has read SPEC-0012's recon; a half-understood `drainPolicy` select is a trap, not a feature |
| A "Duplicate guest" prefill entry point | A fourth entry point with its own lossiness questions (upstream's drops half the spec); candidate follow-up, recorded |
| CanI/RBAC pre-flight gating of the button | W7 unchanged |
| Auto-selecting any class or image | The two decisions with resource consequences stay explicit; upstream's alphabetical class default is the anti-pattern |
| Editing an existing guest through the form | The YAML editor edits; upstream cannot edit at all and this spec does not need to win that twice |
| Capacity math against the class request | The SPEC-0012 verdict, unchanged: the controller fails and heals honestly; a second source of truth client-side is not worth its drift |

### Where the code lives

```text
src/renderer/components/
  guest-create.ts            (pure: section models, validation, payload,
                              summary facts, park/fail expectations)
  guest-create-dialog.tsx    (sectioned observer form, W12 machinery)
src/renderer/pages/          (Guests page gains the Create Guest button)
```

The W12 split at a larger scale: `guest-create.ts` owns every decision
as pure functions over typed inputs (guest class sizing block, image
osType sync, per-source field visibility, all validation rules, the
payload builder that never emits empty-name refs, the summary facts);
the dialog renders sections from it. Shared `create-dialog` primitives
extended only mechanically (a collapsible section primitive is the one
expected addition). `ARCHITECTURE.md` gains the files per slice.

### Implementation slices

1. **Slice 1 - the core create**: sections 1-7 and 11-12 with image
   boot only, the write summary, the page button, unit and E2E
   coverage, fixtures (a non-Ready SwiftImage joins the set). This is
   the machinery slice; everything after it is fields.
2. **Slice 2 - kernel and clone boot**: section 3's other two
   segments, their rules and warnings, clone fixtures reused from
   SPEC-0011's set.
3. **Slice 3 - the collapsed tail**: data disks, network, GPU
   (sections 8-10), their rule matrices and fixtures.

Each slice lands green through the full DoD; the ROADMAP row reads
"In PR" from slice 1 until the post-merge closure after slice 3.

### Non-happy states

The W12 catalogue unchanged. Specific here: every picker degrades to
a text input on a refused list (T3), with the summary marking the
value unverified; a cold guest-class store never blocks (the class is
cluster-scoped and cheap to list on open); the AlreadyExists reopen
carries the whole form state (the SPEC-0011 machinery, now protecting
twelve sections instead of six fields).

### DESIGN.md conformance

W1-W12 in full. One expected addition, declared: the collapsible
section as a shared form primitive (a DESIGN.md section 12 note on
when a section ships collapsed - optional, consequence-bearing, and
never hiding a required field).

## Tests (non-regression list)

- **Unit** (`guest-create.test.ts`): the payload builder never
  emitting empty-name refs across every section combination; the
  boot-source visibility matrix; the osType sync including the
  Windows activation and the mismatch-impossible property; the class
  sizing block and live-migratability derivation; the storage CEL
  rule; every port rule and every data-disk rule from the webhook
  list, each with the W4 non-empty-reason contract where it disables;
  the GPU exclusivity matrix including G6; the clone grammar
  (target-node requirement per backend, regenerate semantics, inert
  class, gone-source warning); the seed datasource warning; DNS-1123
  and collision; every conditional summary line including the
  park/fail expectations. The bar: proportional to SPEC-0012's 223.
- **Integration**: unchanged.
- **E2E** per slice, the honest split as ever (no controller: created
  guests stay phaseless, which is the proof of exactly-what-was-
  enumerated). Slice 1 cases: create an image-boot guest end-to-end
  (kubectl readback of the exact key set, row on the page, toast);
  the non-Ready image selectable with the will-wait line; osType
  synced from a windows fixture image and the GPU section absent;
  DNS-1123 and collision warnings; cancel writes nothing. Slice 2:
  kernel boot readback; clone boot readback with MAC lock and
  conditional target node per backend. Slice 3: port-rule and
  data-disk-rule refusals with reasons; a full guest with disks and
  ports read back key-exact. Fixture additions per slice, named in
  the slice PRs.
- **Manual verification** (escalated to Roberto, PROCESS.md), on a
  real KVM cluster: a form-created guest boots end-to-end; the
  create-early-against-an-importing-image self-heal; a Windows image
  create with the synced osType; a clone-boot create resuming with
  rewritten MACs; a ports+expose guest getting its Service; a
  GPU-profile guest parking and then allocating. Record date, tester
  and result here.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Create Guest slice 1 as implemented (2026-08-31)

Slice 1 ships sections 1-7 and 11-12 with image boot only
(`components/guest-create.ts`, `components/guest-create-dialog.tsx`, the
Guests page's create control, and the collapsible section added to
`components/create-dialog.tsx`), on the SPEC-0011/0012 machinery
unchanged: the W12 create pattern, the MobX model outside React, the
observable `okButtonProps`, the catch-never-rethrow with the 409 reopen,
`apiFailureFacts`, `store.create`, and the shared `create-dialog`
primitives and stylesheet - which needed one addition and no change. The
typed models needed nothing at all: `nodeName`, `guestAgent`, `storage`,
`osType` and the `runPolicy` enum were already declared on
`SwiftGuestSpec` from the CRD schema, and `SwiftImage`, `SwiftGuestClass`
and `SwiftSeedProfile` already exposed every field the pickers read.
These are the places the implementation is more specific than, or
different from, the text above:

- **The entry point is the host's own floating create button, not a
  header button** (the Registration paragraph above is rewritten to
  match). `KubeObjectListLayout` accepts `addRemoveButtons`, the prop
  core's Namespaces page uses for "Add Namespace", and it renders the
  same "+" in the same corner on an extension page, which was verified
  live on the Guests page before any of this form was written. DESIGN.md's first pillar
  settles it: never a custom control where a native one exists. The
  consequence for the tests is that the control carries no test id of
  ours (the host spreads none of the props it is handed onto the
  button), so the E2E suite locates it as `.AddRemoveButtons
  .add-button`. The `customizeHeader` fallback was not needed and is not
  implemented.
- **There is no boot-source control, because there is one boot source.**
  The spec's section 3 describes a segmented image/kernel/clone control;
  with two of the three segments unimplemented, a segmented control with
  one enabled option is a decoration, and a disabled segment labelled
  with a future release is a promise the product would be making on the
  roadmap's behalf. The field is therefore labelled **Boot image** and
  says what this form creates - "This form creates a disk-boot guest:
  the controller clones the image below into the guest's own root
  disk" - a sentence that stays true when slices 2 and 3 add the
  segmented control next to it. No "coming soon" string exists in the
  product. The pure model already carries the three-member
  `GuestBootSource` type and the payload builder already branches on it,
  so the later slices add fields rather than reshape these.
- **G9 is retired.** The SwiftSeedProfile schema declares
  `spec.datasource` as **required**, with a single-member enum
  (`NoCloud`), so a stored profile cannot have an empty datasource and
  the warning the improvement promised could never fire on any cluster,
  webhook or not. The row is struck through in the table above with the
  reason. The `datasource` field is still carried in the picker's fact
  shape, because it is what the option would show if upstream ever
  widened the enum.
- **The guest name is validated as a DNS-1123 LABEL**, not as the
  RFC-1123 subdomain the other three dialogs accept for their own
  objects: a guest's name is the stem of its launcher pod, its cloned
  root-disk PVC and its per-guest Service, each of which is a label, so
  dots are refused and the cap is 63 rather than 253. The message says
  which objects the name becomes, so the rule reads as a consequence
  rather than as a preference. `objectNameError` is deliberately not
  reused for it.
- **The namespace defaults from the page's filter only when that filter
  names exactly one namespace.** Anything else - all namespaces, a
  multi-selection, none - leaves the field empty and required, because a
  guest created in a guessed namespace is a guest in the wrong place.
- **The class sizing block carries a sixth row, `Live migration`**, and
  the long sentence lives under the storage section and in the write
  summary. The spec asks for the derived live-migratability next to the
  class (section 2) and the consequence stated both ways next to the
  storage overrides (section 7); rendering the same paragraph in both
  places, plus the summary, was three copies of one sentence in one
  scroll area. The short form (`offline only (ReadWriteOnce/Filesystem)`)
  is computed from the same function as the long one, and a unit test
  asserts the two never disagree. The long sentence has two offline
  forms, because the two ways of missing live migration are different
  facts: a `ReadWriteOnce` disk is held by one node at a time, while a
  `ReadWriteMany` disk on a `Filesystem` volume is held by as many nodes
  as need it and still needs a `Block` volume to move without stopping.
  The short form names the mode rather than the reason, so it stays one
  sentence.
- **The storage CEL rule is enforced on the guest's own storage block,
  which is stricter than the merge and is what the CRD does.** The rule
  is `!(accessMode == 'ReadWriteMany' && (!has(volumeMode) || volumeMode
  == 'Filesystem'))` on `spec.storage` itself, so a guest that overrides
  the access mode to `ReadWriteMany` and inherits `Block` from its class
  is refused by the API server. The inline message says exactly that -
  "the rule is evaluated on this guest's own storage block, so
  inheriting Block from the guest class does not satisfy it" - which is
  the kind of rejection an operator otherwise meets as a decoded CEL
  error.
- **The collapsed section opens by itself when it holds an error**, and
  its open state lives in the MobX model rather than in the DOM. A
  submit blocked on a field nobody can see is the dead control W4
  forbids, and a `<details>` element would collapse on the remount the
  409 reopen performs.
- **The image picker's not-Ready options are dimmed, and the dimming is
  the only signal that they are different.** They are never `isDisabled`
  - a not-Ready image is a legitimate choice whose consequence is a wait
  - and the wait is stated under the control and again in the summary,
  in the warning style. The phase rides on every option's label, so the
  distinction survives a user who cannot see the dimming.
- **The osType degradation has its own sentence.** When an image is
  named but could not be read (the T3 text-input path), the fact reads
  "linux, assumed" and says that a Windows image would make the guest
  born Failed on the mismatch, with the YAML editor as the fix. The
  spec's G4 covers the read case only.
- **The form shows its required-field errors on open**, as the Migrate
  dialog does: the submit is disabled from the first frame, and W12
  requires a disabled submit to name the field and the reason at the
  field and next to the button. Three red lines on an untouched form is
  the cost of that rule, and it is the shipped behaviour of the third
  dialog too.
- **The write summary repeats the name collision and every unverified
  value**, for the reason the two SPEC-0011 dialogs repeat their sharpest
  sentence: this form is taller than any of them, and the summary sits
  below the fold of the dialog's own scroll area.
- **The success notification names the object although the row lands on
  the very page the dialog was opened from** (the spec's G13). The row
  arrives at its sorted position in a list of sixteen, which is not where
  the user is looking; a create that says nothing is a create nobody is
  sure happened.
- **The E2E case asserts the created spec's key set is exactly
  `guestAgent`, `guestClassRef`, `imageRef`, `nodeName`, `osType`,
  `runPolicy`, `seedProfileRef` and `storage`** - all eight sent by the
  dialog, with no schema default riding along: `osType` is the only
  defaulted field at the top level of the spec and this form sends it
  itself, and neither `storage` nor `guestAgent` declares a default
  inside, confirmed against the `v0.13.12` CRD. The windows case asserts
  the four-key minimum (`guestClassRef`, `imageRef`, `osType`,
  `runPolicy`) with `osType: windows`.
- **One host finding, in both themes, caught by the screenshots and fixed in
  the shared stylesheet**: core's global rule for `code` is
  `color: #b4b5b4`, a light grey chosen for a dark surface, and the write
  summary renders its one W1 line inside a `<code>` - so on the hardcoded
  white `ConfirmDialog` box the single line the user is required to read
  measured about 1.8:1 against the summary's own background, paler than
  every sentence around it. It is the fourth of its family, after the
  select's single value, the input's label and the checked radio's label
  recorded in SPEC-0011 and SPEC-0012, and the fix in
  `create-dialog.module.scss` applies to **all four** create dialogs -
  Take Snapshot, Restore and Migrate included. It goes on the
  upstream-Freelens feedback list with the rest.
- **The created guests are named after the wall clock**
  (`e2e-created-<hhmmss>`), like the Migrate dialog's migrations: these
  cases write for real and `pnpm e2e:cluster:up` is idempotent rather
  than destructive, so a fixed name would make the second run against a
  kept cluster fail on an AlreadyExists that says nothing about the code.

### Upstream drift found by this recon (2026-08-30)

The headline items, recorded in full in the local feedback draft:
`docs/crds.md` and `docs/api/swiftguest.md` document a fraction of the
SwiftGuest spec (no `cloneFromSnapshot`, `storage`, `interfaces`,
`network`, `dataDiskRefs`, `migration`, `guestAgent` among others) and
both assert a `gpuProfileRef`/`kernelRef` mutual exclusion that no
webhook or controller enforces; the `LocalObjectReference` `""`
default lets `guestClassRef: {}` through the API server with the
webhook off; `spec.osType`'s `linux` schema default guarantees a
born-Failed mismatch for Windows images unless every client
compensates; the sriov interface's required `resourceName` is
documented but not validated; `docs/snapshots/clone-from-snapshot.md`
still calls source-independent clones a future enhancement (shipped)
and omits the oci tier from its table; the CRD YAML carries two
truncated field descriptions relative to the Go sources; and the
schedule form's guest picker in kubeswift-ui is permanently empty
because `swiftguests` is missing from the gateway's own resource
catalog (an upstream-UI bug worth a gentle report on its own).

# SPEC-0014: Create forms for SwiftGuestClass, SwiftImage, SwiftKernel and SwiftSeedProfile (M6)

- **Status:** Approved (Roberto, 2026-08-31, in chat: the completion of
  M6 was delegated in conversation; drafted and reviewed under that
  delegation)
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (`724b5ef`), the newest
  tag; `main` (`d66cff5`) is ahead of it and carries no release. The
  four CRDs in scope were diffed against `main`: the SwiftGuestClass
  schema differs by one description line and the other three are
  byte-identical, so the tag is the basis exactly as it was for
  SPEC-0013. UX reference kubeswift-ui `main` `c4e53ce`, the same
  commit SPEC-0013 reviewed. Recon date 2026-08-31.
- **Author / date:** Claude with Roberto, 2026-08-31

## Goal

An operator can create the four inputs the Create Guest form already
reads - the sizing class, the disk image, the kernel artifact and the
cloud-init seed - from four small dialogs, one per list page, so every
picker SPEC-0013 shipped becomes reachable from a create button. Each
form carries the rules upstream leaves to a webhook that ships
disabled, states what the create sets in motion, and - for the two
kinds whose `Failed` phase is terminal - says a failure needs
delete-and-recreate rather than borrowing SPEC-0013's self-heal
sentence. The seed profile's reference path, which upstream's GUI
cannot express at all, becomes authorable.

## Upstream reference

- `..._swiftguestclasses.yaml` - cluster-scoped, eight leaves, no
  status, no controller and **no webhook of any kind**, so the schema
  is the entire rule set. Its one CEL rule is the guest's:
  `ReadWriteMany` requires `volumeMode` present and equal to `Block`,
  so RWX with the mode absent is also rejected. `coreScheduling`
  defaults to `off`.
- `..._swiftimages.yaml` with its webhook and controller - seventeen
  leaves, **zero CEL rules**, twelve validating rules that exist only
  in the webhook (exactly-one-source, the OCI tag/digest XOR, the
  snapshot strategy's dependency on `volumeSnapshotClassName`).
  `format` is the inverted case: the mutating webhook defaults it and
  the schema requires it, so a manifest omitting it is accepted on a
  webhook-on cluster and rejected on a webhook-off one.
- `..._swiftkernels.yaml` with its webhook and controller - four
  leaves, no CEL, no defaults, no patterns; five of the validator's
  six rules are webhook-only. `spec.profile` is free text with **zero
  code consumers**; `spec.kernelProfileRef` selects on `metadata.name`.
- `..._swiftseedprofiles.yaml` with `internal/seed/` - twenty-two
  leaves, eighteen of them the six selectors' sub-fields, and one CEL
  rule (user data inline and non-empty, or a `userDataFrom` block),
  moved out of the webhook into CEL deliberately because a rule that
  only holds when the webhook is enabled is not a rule - DESIGN.md
  W12's reasoning, upstream.
- `charts/kubeswift/values.yaml` sets `webhook.enabled: false`,
  unchanged from SPEC-0013, so every webhook-only rule above is in
  practice unenforced; and `cmd/swiftctl/` has **no create command for
  any of the four kinds** (its one image verb, `image publish`, never
  writes a SwiftImage and never talks to a cluster), so unlike
  SPEC-0013 this spec has **no client-side precedent to mirror**.
- kubeswift-ui `main` `c4e53ce` - UX reference only (AGPL boundary,
  [ARCHITECTURE.md](../development/ARCHITECTURE.md)). All four kinds
  sit in the gateway's browsable catalog, so upstream lists them,
  shows their YAML and offers a Form/YAML toggle and an edit mode for
  each: **the "upstream has no YAML path" argument SPEC-0013 used for
  guests does not apply here and is not reused.** What replaces it is
  sharper. Their four wizards derive from one shared base that writes
  through `ApplyResource`, a **server-side apply with `Force: true`**,
  so typing an existing name replaces that object's fields and reports
  success; the base pre-fills the namespace with the literal
  `default`, contracts validation as one `canSave()` boolean with no
  per-field error channel, and renders YAML as a bare `<textarea>`.
  Kept from it: unmodelled fields survive an edit, errors are surfaced
  verbatim, defaults the server would stamp are deleted. Their curated
  RBAC catalog grants these kinds `get`/`list`/`watch` only, so their
  `canCreate()` gate hides the New button for every kind in this spec.

Freelens host references: the shipped W12 create machinery reused
wholesale, and **no feasibility gates**. `create-dialog.tsx` already
exports `Field`, `CollapsibleSection`, `FormRow`, `AddRowButton` and
`WriteSummary`; the W12 pattern (MobX model outside React, observable
`okButtonProps`, catch-never-rethrow with the 409 reopen,
`store.create`) has shipped four times; `NamespaceSelect` in `light`
theme with `namespaceStore.contextNamespaces` defaulting, DNS
validation with its collision warning, the T3 degraded picker and the
stamped-defaults-never-re-sent rule are SPEC-0013 as implemented. The
four reads these forms need are all exported from `Renderer.K8sApi`,
checked in the 1.10.3 typings: `storageClassApi`, `secretsApi`,
`configMapApi`, `nodesApi`. The one they cannot have is a
VolumeSnapshotClass API.

## Scope

Part of one M6 row, "Create SwiftGuestClass / Pool / Image / Kernel /
SeedProfile (forms)", which this spec splits (below).

1. **Four flat dialogs** on the SPEC-0011 scale, one per kind, each
   opened from its own list page's floating "+" - the SPEC-0013
   entry-point idiom, no new host machinery, no registration question
   to settle. Two implementation slices.
2. **The forms cover the operator surface; the YAML editor covers the
   tail.** The class and the kernel are covered leaf for leaf. The
   image excludes the `upload` and `pvcClone` sources and the inert
   `cloneStorageClassName`; the seed profile excludes the ignored
   `optional` flag. Each exclusion is named in its form's own footer
   with its reason, rather than being silently absent.
3. **Create only.** Editing is the host's YAML editor - a real editor
   with schema awareness, one click away on all four kinds.

Also excluded, with destinations: SwiftGuestPool (SPEC-0015, below);
SwiftSandbox and SwiftSandboxPool (their own M6 row); bulk creation;
a "duplicate this object" prefill (the SPEC-0013 verdict, unchanged).

**ROADMAP re-scope.** The row above splits in two. This spec takes the
four simple kinds; the pool moves to **SPEC-0015** on its own, because
`spec.template.spec` **is** the SwiftGuest spec verbatim - 119 leaves
against this spec's largest 22, seventy of them the guest's - so the
decision that spec exists to make is whether the shipped Create Guest
form is embedded inside it, an architecture question about existing
code rather than a field list.

## Design

### What creating each kind actually does

**SwiftGuestClass - nothing at all.** No controller is registered and
no status exists, so a class is valid the moment it exists. Nothing
checks `rootDisk.format` against the referenced image's real format
(the docs call it mandatory; a mismatch is a boot failure, not an
admission failure), nothing checks `rootDisk.size` against the image's
(the docs and the Go comment assert it in opposite directions), and
`cpu` and `memory` have no minimum, so `cpu: "0"` passes. Deleting a
class in use is completely unguarded.

**SwiftImage - four objects and a long walk.** The controller creates
an import **PVC** named after the image (hardcoded RWO/Filesystem,
sized from `rootDisk.size` or 10Gi), an import **Job** running as uid
0 and **`privileged: true` for `osType: linux`** (that path
loop-mounts the disk to patch the bootloader and serial console), a
measure **Job** read out of the pod's logs, and for
`cloneStrategy: snapshot` a **VolumeSnapshot** clone seed with
finalizers. No Job sets a TTL, backoff limit or deadline. The walk is
`Pending` -> `Importing` -> `Validating` -> `Preparing` -> `Ready`,
with `Snapshotting` inserted for the snapshot strategy. **`Failed` is
terminal and never self-heals** - the reconciler returns on the phase
before it reads the spec - and `Ready` is short-circuited the same
way, so edits to a Ready image are stored and ignored. The controller
emits **no Events at all**, and two failures produce no condition
either: a storage class that cannot bind and a pull secret that cannot
mount both hang in `Importing` forever with no requeue. The sharpest
is silent the other way: **an image declared `raw` whose bytes are
qcow2 reaches `Ready`** - no conversion is attempted, the file is
renamed in place, the bootloader patch finds no partitions - and every
guest built from it boots garbage. No magic-byte check exists in the
controller, though upstream's own CLI does exactly that check on the
producer side.

**SwiftKernel - one Job per labelled node.** The controller lists
nodes carrying **`kubeswift.io/kernel-node=true`** (an equality match
on the literal string) and creates one Job per node, not a DaemonSet.
`Pending` means only "no node carries the label"; `Ready` means every
labelled node's Job exited zero, **not** that the kernel and initramfs
files landed, which nothing verifies. **`Failed` is terminal and
enforced as terminal**, so a node labelled afterwards never gets a Job
while the scheduler will still place kernel-boot pods on it, and
recovery needs `status.phase` cleared rather than the Job deleted,
which is what the docs prescribe. Two more facts:
`spec.ociRef.pullSecret` is wired to the pod's image-pull secrets,
which authenticate the ORAS **container image** and not the `oras
pull` of the artifact, so a private artifact cannot be pulled through
the field that appears to solve it; and re-pointing `ociRef.image` is
a silent no-op, because the Job's name carries no image or digest.

**SwiftSeedProfile - nothing now, one Secret later.** No controller
and no status schema; a profile is inert until a SwiftGuest points at
it, and the rendering happens inside the **SwiftGuest** reconcile from
the **guest's** namespace, producing one Secret named
`<guest-name>-seed` with up to three keys (a ConfigMap before v0.13.4,
which the docs still say). Three defaults the form shows rather than
asks for: with `NoCloud` and both metadata fields empty the renderer
synthesizes an instance id of `<namespace>-<name>` and a hostname of
`<name>` - and the rationale matters, because a NoCloud disk with no
metadata file is not recognised as a datasource at all, so cloud-init
**discards the user data entirely** while the guest still boots and
reports Running and Ready; an empty rendered network config is
replaced by a built-in dual-match DHCP netplan; and `datasource` is
stamped by a mutating webhook that ships off and is
`failurePolicy: Ignore` besides, so omitting it is a **hard
rejection** on every default install. Four precedences are silent and
unenforced: inline beside a `*From` resolves to the reference;
`secretKeyRef` beside `configMapKeyRef` resolves to the Secret by
statement order; an empty `userDataFrom: {}` satisfies the CEL and
renders nothing; and a selector's `name` carries the core API's `""`
default. A missing referenced object or key is worse than a missing
profile: the error returns raw, so the guest **retries with backoff**
with no `Resolved=False` and no `Failed` phase. `optional: true` is
**ignored**. And a profile edit after the guest exists rewrites bytes
nobody will read: the seed is consumed once at first boot.

### The forms

**The entry points.** Four floating "+" buttons, one per page, the
SPEC-0013 idiom exactly: `addRemoveButtons={{ onAdd, addTooltip }}` on
each page's `KubeObjectListLayout`, the prop core's Namespaces page
uses for "Add Namespace" (DESIGN.md pillar 1). The control carries no
test id of ours, so E2E locates it as `.AddRemoveButtons .add-button`.
**All four pages also take the 80px clearance rule**
(`.page :global(.VirtualList .list) { padding-bottom: 80px }`): the
collision SPEC-0013 slice 3 measured belongs to the host's list layout
rather than to the kind - the "+" covers the last 61.6px of the list's
scroll box at `z-index: 99`, and the host renders its Edit/Delete
kebab on the last row of every registered kind - so any page that
gains the "+" gains the collision as soon as its list scrolls. At the
E2E fixture counts none of these four lists scrolls, so the rule ships
on all four as a copy of a measured fix and the assertion that proves
it stays on the Guests page.

**Shared shape.** One dialog per kind, the W12 pattern, flat sections
in reading order, at most one collapsed section, a live write summary,
the OK button carrying the verb. What the API server will stamp is
shown as the effective value and never re-sent. Names use
`objectNameError` plus the store's collision warning, which warns and
never blocks. Each summary opens with its `Create <Kind> ...` line and
then carries, from the section above, only the facts true of the
object being written.

**1. Create Guest Class.** **No namespace control at all** - the kind
is cluster-scoped, and the fact is stated where the field would have
been, because upstream's own sample sets `metadata.namespace` on one.

- Name; cpu, memory and root disk size (required quantities); format.
  All four start **empty**: there is no default to inherit, since
  upstream's wizard says `20Gi` for the root disk, its docs `10Gi` and
  its own sample `40Gi`. The quantity field refuses zero and negatives
  with the reason the schema will not give. The two unenforced sizing
  rules are stated under the format control.
- **Storage**: access mode, volume mode, storage-class picker (T3).
  `storageCelRule` reused verbatim, its shape said out loud - RWX with
  `volumeMode` **absent** is also rejected. Live-migratability from
  the shipped `liveMigrationFact` / `liveMigrationLabel`; RWX +
  `Block` warns that the class still needs a genuinely
  migration-capable storage class, a controller-time
  storage-not-ready condition rather than admission.
- **Core scheduling** (`off` / `vm` / `vcpu`), one sentence each,
  named as the hypervisor's SMT side-channel mitigation. `off` is
  never sent and an all-empty `storage` is dropped rather than emitted
  as `{}` - both habits upstream got right here.
- **Summary**: nothing is created and the class is usable the moment
  it exists, plus the live-migration sentence and anything a refused
  read left unverified.

**2. Create Kernel.** Namespace (`NamespaceSelect`, `light` theme,
defaulted from `namespaceStore.contextNamespaces` when the page's
filter names exactly one) and name.

- **OCI image** (required) with four webhook-only rules inline:
  non-empty after trimming, no surrounding whitespace, no shell
  metacharacters, no `..`, each refusal naming what it prevents.
- **Pull secret**: a namespace Secret picker (T3), warning at the
  field how far it reaches. Offered rather than dropped because it is
  not a no-op: it answers a private ORAS image and not a private
  kernel artifact, and only one of those is what an operator reaching
  for it expects.
- **Kernel command line** (optional), with the fifth webhook-only rule
  inline (no newline, carriage return or NUL, which otherwise reach
  the hypervisor argument unvalidated) and SPEC-0013's sentence about
  a guest's own value **replacing** this line rather than appending.
- **Profile** (optional), stated as a label with zero code consumers
  whose only effects are a printer column and a drawer row, while
  `spec.kernelProfileRef` selects on `metadata.name`. The samples'
  values are a hint, not an enum.
- **Summary**: one Job per labelled node, with **the labelled-node
  count read on open** through `nodesApi` and the shipped
  `isKernelNode`, so a kernel that will park in `Pending` says so
  before the write; then the two terminal facts.

**3. Create Image.** Namespace and name, then a source branch.

- **Source** (radio, `HTTP URL` / `OCI artifact`): exactly-one is
  webhook-only and the control makes violating it inexpressible, which
  is stronger than validating it.
  - *HTTP*: the URL, required and non-empty (the webhook rule), plus a
    scheme check upstream has nowhere, and one fact - there is **no
    checksum field and no verification of any kind** here; integrity
    exists only on the OCI path.
  - *OCI*: repository (required); a **pin-by** control (`tag` /
    `digest`) that makes the XOR inexpressible **and** closes the gap
    no layer closes, since with neither set the puller is handed an
    empty reference and fails opaquely; an `insecure` checkbox noting
    that a verify key plus `insecure` fails closed only inside the
    puller pod; and two Secret pickers, registry credentials and
    cosign verify key, both T3 and both refusing an empty name.
    Upstream's wizard offers neither.
- **Format** (required, **always sent explicitly**), carrying the
  silent-corruption fact in the form's own terms, plus one warning
  upstream has nothing like - when the http URL's filename disagrees
  with the declared format - which says in the warning that it is a
  guess about a filename, not the check of content no client can do.
- **OS type**, effective `linux`, sent only when `windows`, with the
  privileged-and-root Linux import Job carried into the summary.
- **Root disk size** (optional), effective `10Gi` applied by the
  controller and therefore **not** sent. The distinction from `format`
  is stated: `format` is required by the API server, while `10Gi` is a
  controller constant the stored object never carries. One line says
  the PVC request and the measured artifact size are different numbers
  and this form sends only the request.
- **Storage and clone strategy** (collapsed): clone strategy
  (effective `copy`, sent only when `snapshot`) with one sentence each
  including `docs/images/clone-strategies.md`'s own warning that
  snapshot can be slower than copy on full-copy drivers; the **volume
  snapshot class**, required exactly when the strategy is `snapshot`,
  a text input because the host exposes no VolumeSnapshotClass API and
  marked unverified in the summary; and the **import storage class**
  picker. The section satisfies DESIGN.md's collapsed rule because it
  hides no field required before it is opened - the requirement is
  created **inside** it - and the shipped auto-open-on-error behaviour
  covers a reopened form already holding `snapshot`.
- **Excluded, named in the footer** (W12 option dropping, each with
  what it claims to control stated in its place): `upload`,
  implemented on no side - an empty Go struct, a property-less CRD
  object, a controller that parks it as not-implemented with a pinning
  test, no gateway endpoint, no RPC, no CLI path - whose object would
  sit with a Failed condition and a permanently blank phase;
  `pvcClone`, a stub that always fails, which the docs present as
  working with a worked example and the upstream wizard offers as a
  first-class button; and `cloneStorageClassName`, read nowhere in the
  controller.
- **Summary**: the four objects, the phase walk, and the honest tail -
  **`Failed` is terminal**, so recovery is delete-and-recreate and no
  edit to this object restarts anything; a `raw` declaration is taken
  on trust, so qcow2 bytes reach `Ready` and boot garbage; the two
  silent indefinite `Importing` hangs; the missing TTLs; and a
  diagnostic surface of one phase and one condition message.

**4. Create Seed Profile.** Namespace and name, with one fact: the
profile is resolved from the **guest's** namespace, so a profile a
guest cannot see is a hard resolution error.

- **Datasource** is rendered as a stamped fact, not a control (the
  schema declares it required with a single-member enum, `NoCloud`),
  and is nevertheless **sent explicitly**, because the webhook that
  would default it ships off and is `failurePolicy: Ignore` besides.
  This is SPEC-0013's retired G9 seen from the other side.
- **Three document groups** - user data, metadata, network config -
  each one origin control (`Inline` / `Secret key` / `ConfigMap key`)
  and then either a multi-line document field or an object picker
  (`secretsApi` / `configMapApi`, T3) plus a key. The XOR is made
  **inexpressible** rather than validated, which is also the
  correction of our own model: `swiftseedprofile-v1alpha1.ts`'s header
  comment says the schema keeps the pair mutually exclusive and **no
  layer does**. The comment is corrected in the same PR; its "requires
  either `userData` or `userDataFrom`" half is right.
- Four payload rules follow from the four silent precedences: never an
  empty selector `name` (SPEC-0013's G7 in a new place), never both
  refs in one block, never an empty `*From: {}` (an unfilled group is
  dropped), never an inline value beside a reference.
- **User data** carries the CEL rule inline, refused in the rule's own
  terms rather than as the API server's decoded CEL message.
  **Metadata** and **network config**, left empty, show their
  effective values as facts and are not re-sent. **`optional` is not
  rendered**: neither resolver reads the flag, and the consequence - a
  **silent retry loop with no guest condition** - is stated in its
  place.
- **Summary**: nothing is created now, then the `<guest>-seed`
  **Secret** a guest will render (the docs still call it a ConfigMap),
  where inline documents land if they carry credentials, that a
  profile edit after the guest exists rewrites bytes nobody reads,
  and the cross-reference SPEC-0013 already acts on - a **kernel-boot**
  guest's seed Secret is created and never mounted, which is why the
  Create Guest form refuses a seed on kernel boot.

### Better than upstream

Baseline, measured: four wizards behind one shared base that writes
through a forced apply, so a name clash silently overwrites; a
namespace pre-filled with the literal `default`; one boolean with no
per-field reason; presence-only validation with **none** of the
webhook rules mirrored anywhere; free text where a picker belongs in
every case; a class wizard whose create cannot succeed on any cluster;
an image wizard that promotes a dead source and omits every
storage-topology and supply-chain field; a seed wizard that cannot
express the reference path and whose edit path injects a stub inline
value next to a reference; drawers that show no conditions for either
kind that can fail; and a New button their own RBAC presets never
unlock.

Adopted:

| # | Improvement | Where |
| --- | --- | --- |
| F1 | `store.create` instead of a forced apply: a name clash is the API server's own `AlreadyExists`, reopened with the form intact, where upstream replaces the object's fields and reports success | All four |
| F2 | The namespace comes from the page's own filter when it names exactly one, and is otherwise empty and required - never the literal `default`, which looks deliberate and is not | Kernel, Image, Seed |
| F3 | No namespace control at all on the cluster-scoped kind, where upstream's own create cannot write on any cluster: its catalog marks `swiftguestclasses` namespaced while the CRD is `scope: Cluster`, so the apply builds a namespaced request path | Guest Class |
| F4 | Per-field errors that name their reason, against one boolean with no per-field channel and no reason attached to a disabled save (W4, W12) | All four |
| F5 | Every webhook-only rule inline, because the webhook ships disabled: twelve for the image, five for the kernel, plus the class's one CEL rule, which upstream mirrors nowhere | All four |
| F6 | Exclusivities made inexpressible rather than validated: one source control for the image, one pin-by control for the OCI reference, one origin control per seed document | Image, Seed |
| F7 | The OCI reference gap **no layer closes** - neither tag nor digest is checked by schema, webhook or controller, and the puller is handed an empty reference - closed by requiring one | Image |
| F8 | `cloneStrategy: snapshot` without a `volumeSnapshotClassName` refused at the field, where upstream checks it only on reaching `Snapshotting`, having already downloaded, converted and measured | Image |
| F9 | The class's CEL rule mirrored client-side with its true shape (RWX with the mode **absent** is also rejected), where upstream offers RWX + Filesystem and lets the API server answer with a raw CEL message | Guest Class |
| F10 | Live-migratability derived from the storage trio and shown at the moment of choice, which upstream's wizard does not compute and its API reference does not mention (`storage` is omitted from it entirely) | Guest Class |
| F11 | Storage-class, Secret and ConfigMap pickers with T3 degradation, where upstream is free text in every one of those places and a typo is undetectable until a claim hangs or a credential volume is silently skipped | All four |
| F12 | Consequence facts upstream discards: what the create sets in motion, the phase walk, and - read on open - the count of nodes carrying `kubeswift.io/kernel-node=true`, so a kernel that will park in `Pending` says so before the write | Kernel, Image |
| F13 | Terminal-`Failed` vocabulary: the image and the kernel say a failure needs delete-and-recreate, and the kernel adds that deleting the Job (which the docs prescribe) does nothing on its own. SPEC-0013's self-heal sentence is **not** reused | Image, Kernel |
| F14 | The credential-safe seed path is authorable at all - upstream offers three textareas and its own class comment calls YAML the escape hatch for references, so the path its API comments and GitOps docs prefer is the one path its GUI cannot express | Seed |
| F15 | Documented-but-inert fields are not rendered and what they claim to control is stated instead (W12 option dropping): the image's `cloneStorageClassName` and the seed selectors' `optional` | Image, Seed |
| F16 | `format` and `datasource` always sent explicitly, closing the two behaviours that differ between a webhook-on and a webhook-off cluster. SPEC-0013's G8 move, in two places where the divergence is inverted | Image, Seed |
| F17 | Values the API server would stamp are never re-sent and are shown as effective: `osType: linux`, `cloneStrategy: copy`, `coreScheduling: off`, and an empty `storage` object dropped rather than emitted as `{}` | Guest Class, Image |
| F18 | Names validated (RFC-1123) with the store's collision warning, which warns and never blocks, against presence-only validation on all four wizards | All four |
| F19 | The pull secret's real reach stated at the field: it authenticates the ORAS container image, not the `oras pull` of the artifact. Upstream offers it as the answer to private registries and documents the limit nowhere | Kernel |
| F20 | The seed's four silent precedences made unreachable by construction, one of which upstream's own edit path actively produces | Seed |
| F21 | The two unenforced sizing rules named where the operator sets them: nothing checks the class's root disk format against the image's, and nothing checks the size, although the docs assert both - in opposite directions | Guest Class |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| A Form/YAML toggle inside the dialog | The host's YAML editor is a real editor and is one click away on all four kinds; upstream's YAML side is a bare `<textarea>`. The "upstream has no YAML path" argument SPEC-0013 used for guests does not apply here and is not reused |
| An edit mode in these forms | The host's YAML editor edits, and upstream's edit mode is where its worst bugs live. A create form that also edited would inherit the merge-preservation problem upstream solved with a deep-clone merge; if an edit form is ever added, that merge is the pattern to copy |
| The image `upload` source | It exists on no side: an empty Go struct, a property-less CRD object, a controller that parks it as not-implemented with a pinning test, no gateway endpoint, no RPC, no CLI path. Offering it produces an object with a Failed condition and a permanently blank phase. **Not a place the MIT extension is at a disadvantage** |
| The image `pvcClone` source | A stub that always fails. Offering it is offering a button that produces a `Failed` object, which is exactly what upstream's wizard does because its own docs present the path as working |
| CanI / RBAC pre-flight of the create buttons | W7 unchanged, and a deliberate divergence rather than an oversight: `SelfSubjectAccessReview` is itself a write and is not exported to extensions. Worth saying too that upstream's pre-flight guards a permission set upstream never grants |
| Prefilling the class's cpu / memory / root disk | Three upstream sources give three numbers for one field (20Gi, 10Gi, 40Gi), so there is nothing to inherit, and a sizing decision made by a prefill is the anti-pattern SPEC-0013 rejected for the class picker |
| A magic-byte check on the image source | The client never sees the bytes. Upstream's own CLI does the check on the producer side and the controller does not, which is what makes the corruption possible; the form warns from the URL's filename and says it is a guess |
| A cloud-init linter or template library | Beyond W11: upstream has none, and inventing one is inventing behaviour the recon could not confirm. Candidate follow-up, with upstream's own undocumented serial-getty requirement as the strongest case for it |
| Counting the guests that reference a class, or reconciling the image's three size representations | Both are second sources of truth on a create surface. The reference count belongs to the class detail view, and the form sends one size and says which of the three it is |

### Where the code lives

```text
src/renderer/components/
  guestclass-create.ts   / guestclass-create-dialog.tsx
  kernel-create.ts       / kernel-create-dialog.tsx
  image-create.ts        / image-create-dialog.tsx
  seedprofile-create.ts  / seedprofile-create-dialog.tsx
  create-dialog.tsx      (shared primitives, extended twice)
  kube-storage.ts        (the live-migration derivation, extracted)
src/renderer/pages/      (four pages gain the create control and the
                          clearance rule in their own module)
```

The SPEC-0010/0011 split at four small scales: every decision lives in
the pure module as functions over typed inputs. Shipped functions are
**reused, not copied**, because one rule with two implementations is a
rule that drifts: `storageCelRule` and the `resolvedStorage` /
`liveMigrationFact` / `liveMigrationLabel` trio out of
`guest-create.ts` (extracted in slice 1, since a class has no guest to
override it), `isKernelNode`, and `objectNameError`.
`create-dialog.tsx` gains, in slice 1, a **quantity field** and an
**object picker with T3 degradation** instantiated for storage classes
and Secrets; in slice 2, a **key-in-object selector** that can never
emit an empty name - the component upstream's UI does not have at all
- and a **multi-line document field**. `ARCHITECTURE.md` gains the
files per slice, and `swiftseedprofile-v1alpha1.ts`'s header comment
is corrected in slice 2.

### Implementation slices

Two, and the pairing is the shared primitive each pair introduces
rather than the kind.

1. **Slice 1 - SwiftGuestClass and SwiftKernel**, the two smallest
   (eight and four leaves) and the machinery slice: the quantity
   field, the T3 object picker in its two instantiations, the create
   control and the clearance rule on two pages, the extraction of the
   live-migration derivation. The cluster-scoped kind goes first
   deliberately - it is the only one of the four with no namespace
   question, no status, no controller and **no webhook**, so the
   schema is the whole rule set and the slice is about the sizing
   vocabulary rather than about standing in for absent admission. The
   kernel rides with it: five of its six controls are text with one
   rule each, and its only new read is `nodesApi`.
2. **Slice 2 - SwiftImage and SwiftSeedProfile**, the two that need
   new form shapes - the image source-branched with one collapsed
   section and twelve webhook-only rules, the seed profile three
   repeated groups needing the key-in-object selector. They pair
   because both turn on a reference the payload must never emit empty,
   and both drop a documented-but-inert field.

The recon recommends four slices, one per kind. Two is the same work
in two PRs and keeps each primitive's first and second use inside one
review; if slice 1 finds the class and the kernel pulling the shared
primitives in different directions, the fallback is the recon's four.

### Non-happy states

The W12 catalogue unchanged. Specific here: every picker degrades to a
text input on a refused list (T3) with the summary marking the value
unverified, and this reaches further than on any shipped form -
`storageClassApi` is a cluster read while `secretsApi` and
`configMapApi` are namespace reads a namespaced role may well not
carry, SPEC-0013 slice 3's `pvcApi` lesson in three more places. A
refused `nodesApi` read makes the kernel's labelled-node count
**unverified, never zero** (the `existingNamesUnverified` lesson of
slice 2). The class store is cluster-scoped and cheap to list on open,
so a cold one never blocks. And the 409 reopen carries the whole form
state, which is worth naming here for what it protects: the same
keystrokes upstream would have applied over an existing object.

### DESIGN.md conformance

W1-W12 in full, and **no additions expected** - the shared primitives
are components rather than rules. Section 12's collapsed-section rule
is exercised once, by the image's storage-and-clone-strategy section,
with the three cumulative conditions argued in place. If a reviewer
reads the conditional requirement differently, the fallback is to lift
the clone strategy out and collapse the import storage class alone.

## Tests (non-regression list)

- **Unit**, one `*-create.test.ts` per pure module. The bar is
  proportional to the shipped dialogs, counted as `it(...)` blocks in
  this repository: 65 for Take Snapshot, 83 for Restore, 117 for
  Migrate. The class and the kernel sit at the first two, the image
  and the seed profile at the third, because each row of the webhook
  matrices above is a case and W4 requires every refusal to carry a
  non-empty reason. Named properties: the payload never emits an
  empty-name reference or an empty `*From` block; a form that held two
  sources or two origins names exactly one; a value the API server
  stamps is never in the payload while `format` and `datasource`
  always are; the CEL rule's three input shapes; and the
  live-migration short and long forms never disagreeing.
- **Integration**: unchanged.
- **E2E**, per slice, on dedicated fixtures, with the honest split as
  ever - no controller runs on the E2E cluster, so a created object
  keeps exactly the keys it was sent plus the ones the server stamped.
  One real create per kind, read back key-exact with the stamped
  defaults asserted explicitly, plus the refusals.
  - *Slice 1*: "creates a cluster-scoped guest class, and reads back
    the leaves it sent with `coreScheduling` absent"; "refuses
    ReadWriteMany without Block, and again with the volume mode
    empty"; "offers no namespace control, and says why"; "creates a
    kernel and reads back `ociRef`, `kernelCmdline` and `profile`";
    "refuses a padded image reference and a command line with a
    newline, each with its reason"; "says no node carries the
    kernel-node label, and creates anyway".
  - *Slice 2*: "creates an OCI image pinned by digest, and reads back
    the keys it sent with `osType` and `cloneStrategy` stamped by the
    server"; "refuses a snapshot strategy with no volume snapshot
    class"; "refuses an OCI source with neither a tag nor a digest";
    "warns that a `.qcow2` URL is declared raw, and submits anyway";
    "creates a seed profile whose user data is a Secret key, and reads
    back a selector with a name"; "refuses empty user data in the CEL
    rule's own words"; "cannot express an inline value beside a
    reference"; "never sends `optional`, and says why".
  - **Fixture additions**: one new file,
    `e2e/fixtures/200-create-form-references.yaml`, in the style of
    `125-sandbox-references.yaml` and `145-fleet-references.yaml` -
    two StorageClasses with a fictional provisioner, a
    `dockerconfigjson` Secret and an opaque cosign-key Secret in
    `kubeswift-e2e`, and a Secret plus a ConfigMap carrying
    `user-data` and `network-config` keys. Nothing binds and nothing
    needs to for a picker and a readback, so no `lib.sh` status
    patches are needed. The single-node E2E cluster carries no
    `kubeswift.io/kernel-node` label, which is an assert rather than a
    problem. Created objects are named after the wall clock.
- **Manual verification** (escalated to Roberto, PROCESS.md), on a
  real KVM cluster with the controllers running. The first three are
  the **open items** this spec carries: the recon read the code and
  inferred the behaviour, and only a cluster settles it.
  1. **The guest class scope bug**: that upstream's create, edit and
     get really do 404 on the namespaced path. It is the evidence for
     F3 and for the candidate upstream issue; until it lands, both are
     written as a code reading rather than as an observation.
  2. **A `raw`-declared, qcow2-carrying image reaching `Ready`**, and
     a guest built from it failing to boot.
  3. **Whether `ociRef.pullSecret` can pull a private kernel
     artifact** (predicted no), the fact F19 states at the field.
  4. A real http import: the phase walk, the privileged Linux import
     pod, `preparedArtifact.size` as the measured raw size against a
     PVC request that stays at `rootDisk.size`; then a missing storage
     class producing the silent indefinite `Importing`.
  5. A kernel artifact pull on a labelled node: one Job per node, the
     phase walk, the two files on disk; then an artifact missing the
     kernel file, confirming `Ready` regardless.
  6. Editing a `Failed` image and a `Failed` kernel, confirming
     nothing restarts.
  7. A seed rendering into a booted guest: the synthesized instance id
     and hostname, the built-in netplan, and **three flat plain-text
     files** rather than the ConfigDrive tree the docs describe; then
     a missing referenced key, confirming the guest neither fails nor
     reports a condition while a missing profile does set `Failed`.
  8. Kernel boot with a seed profile: the `<guest>-seed` Secret
     created and never mounted.

  Record date, tester and result here.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Guest class and kernel forms as implemented (2026-08-31)

Slice 1 shipped as specified, with the deviations below. Everything the
"Create Guest Class" and "Create Kernel" sections describe is in place,
including F1-F5, F9-F13 and F17-F21 as they apply to these two kinds, the
create control and the 80px clearance on both pages, and the extraction of
the live-migration derivation.

**1. The extraction is a split rather than a move.** `kube-storage.ts`
owns everything below the merge - `resolveStorage`,
`resolvedStorageText`, `liveMigrationFact`, `liveMigrationLabel`,
`kernelLiveMigrationFact`, the two live-migration constants (moved out of
`migration-create.ts`), the two API-server defaults, and the StorageClass
name rule (moved out of `guest-create.ts`, where it was private).
`guest-create.ts` keeps `resolvedStorage(inputs, values)`, which is the
guest-specific per-field merge with the class, and delegates the verdict.
Two smaller consequences: `liveMigrationFact` gained a third parameter,
the **subject** of the sentence, defaulted to the guest form's own words
so every shipped string is byte-identical, because a class is a template
and "this guest" would be false on it; and `GuestBootSource` is now an
alias of `kube-storage.ts`'s `StorageBootSource`, so the three-member
union has one declaration rather than two. No behaviour changed and the
1492 shipped unit tests pass unmodified apart from their import lines.

**2. `storageCelRule` is shared as a rule, not as a sentence.** The spec
says the class reuses it verbatim. Its shipped text ends with "the rule
is evaluated on this guest's own storage block, so inheriting `Block`
from the guest class does not satisfy it", which is a fact about a merge
a class does not have. So what is shared is the **predicate**
(`violatesStorageCelRule`, one implementation, used by both forms) and
the **headline** sentence; the guest's message is reconstructed from that
headline plus its own tail and is byte-identical to what shipped, and the
class gets `guestClassStorageCelRule`, whose tail is the shape the spec
asks to be said out loud - `ReadWriteMany` with the volume mode left
empty is refused exactly as `Filesystem` is. Alternative rejected:
rewording the guest's message, which would have changed a shipped string
and two of its unit tests for no user-visible gain.

**3. The quantity primitive splits across two files.** The **component**
(`QuantityField`) is in `create-dialog.tsx` as the spec says; the
**rule** (`quantityError`, with the three refusals and the schema's own
pattern) is in `guestclass-create.ts`. It cannot be in `create-dialog.tsx`:
that file imports a stylesheet and, since this slice, the host's
components, and a pure form module importing it would invert the layering
the SPEC-0010/0011 split exists to keep. It lives in the module of the
form that needed it first, which is exactly where `objectNameError` lives
relative to the three dialogs that import it from `snapshot-create.ts`.
Slice 2's image form imports it from `guestclass-create.ts`. The
`ObjectPickerField` has no such problem - its one decision
(`objectPickerIsUsable`) is about the read on open rather than about the
object being written - and it stays whole in `create-dialog.tsx`, with
its cases in a new `create-dialog.test.ts`.

**4. `create-dialog.tsx` now reaches the host, so the unit-test stub
grew.** The object picker renders the host's `Select` and `Input`, which
are destructured at module scope; `test/freelens-extensions.ts` gained a
`Component` entry with those two names, which is what its own header
comment invites.

**5. `coreScheduling` is NOT absent from the created object.** The spec's
slice-1 E2E case is titled "reads back the leaves it sent with
`coreScheduling` absent". It is not absent: the CRD carries
`default: "off"`, so the API server stamps it - verified on the E2E
cluster with a `kubectl apply` that omitted it. What is true, and what
the form guarantees, is that the payload never carries it. The case
asserts the stamped value explicitly, which is this spec's own rule for
every other stamped default ("read back key-exact with the stamped
defaults asserted explicitly"), and its title says "reads back the leaves
it sent" without the second clause.

**6. The kernel command line is a `multiLine` input.** A single-line
`<input>` applies the browser's own value-sanitization algorithm, which
**strips** CR and LF from an assigned value rather than keeping them. A
pasted two-line command line would therefore arrive as
`console=ttyS0quiet` - two arguments silently joined into one nonsense
token - and the fifth webhook-only rule could never fire from the
control at all. A textarea makes the paste visible and lets the refusal
say what is wrong with it, which is also what makes the spec's E2E case
("refuses ... a command line with a newline") expressible.

**7. Two warnings the spec does not name, both W11-shaped and neither
blocking.** A unitless `memory` or root disk size is a plain **byte**
count in the Kubernetes quantity grammar, so `memory: 4` is four bytes
and reads as `4Gi` to anyone scanning the list; the field says so and
submits anyway. And a StorageClass name the cluster read did not return
is warned about at the field, with the consequence named - nothing
refuses the class, the PVC of the first guest built from it never binds -
while a **refused** read produces "unverified" instead, never "missing".

**8. The class form's storage trio is flat, not collapsed.** DESIGN.md
section 12 allows a collapsed section only when what it hides is a
consequence rather than a decision. This block decides whether every
guest of the class can ever be live-migrated, which is a decision. The
spec's "at most one collapsed section" is satisfied by having none here;
the image form in slice 2 is where the collapsed-section rule is
exercised.

**9. The slice-1 fixture is the slice-1 subset.**
`200-create-form-references.yaml` carries the two StorageClasses (behind
a provisioner that does not exist, `WaitForFirstConsumer`, so nothing can
even try to bind) and the `kubernetes.io/dockerconfigjson` pull Secret.
Its auth map is `{"auths":{}}` - the type the field really wants, with no
credential-shaped payload, which is `145-fleet-references.yaml`'s rule.
The cosign-key Secret and the user-data Secret and ConfigMap the spec
lists are slice 2's and are added when slice 2's cases read them.

**10. Two smaller shapes.** `guestClassCreateErrors` takes only the form
values, with no `inputs` parameter, because every rule on this kind is
the schema's own and nothing it refuses depends on a read. And
`liveMigrationFact`'s unresolved branch still says "this guest": it is
unreachable from the class form, which always resolves, since there is no
read above a class whose failure could leave the answer a guess.

### Upstream drift found by this recon (2026-08-31)

The headline items, recorded in full in the local feedback draft. The
guest class API reference documents four of its eight leaves, dropping
the whole `storage` block and with it the CRD's only CEL rule, and
dropping `coreScheduling`, a security-relevant enum; three sources
give three root-disk defaults (doc 10Gi, sample 40Gi, wizard 20Gi);
the format-match and size-at-least rules are presented as hard
requirements, enforced nowhere, and stated in opposite directions by
the docs and the Go comment; and the shipped sample sets
`metadata.namespace` on a cluster-scoped object. The gateway's catalog
marks `swiftguestclasses` namespaced while the CRD is `scope:
Cluster`, so create, edit, get and namespaced list all take a request
path the API server has no route for, nothing tests it, and the
catalog's other cluster-scoped kind is marked correctly. The image API
reference documents only `http` and `pvcClone` - omitting `oci`, the
one source with supply-chain features - presents `pvcClone` as working
with a worked example when it is a stub that always fails (the
upstream wizard inherited the error as a button), omits `Snapshotting`
from both phase lists, and says nothing about the privileged root
import Job, the absent TTLs, the terminal `Failed`, or the two silent
`Importing` hangs. The kernel quickstart finds pull Jobs by a
managed-by selector when the Job carries no labels at all, the
webhook's warning publishes a second non-existent selector, the docs
say a Failed kernel recovers by deleting the Job when the phase must
also be cleared, the two digest status fields are called reserved in
one document and real in another (upstream's drawer believed the wrong
one), and nothing anywhere records that `ociRef.pullSecret` does not
authenticate the artifact pull, that a succeeded pull is never
content-verified, or that `spec.profile` has no code consumers. The
seed profile reference still says the seed renders into a ConfigMap
(a Secret since v0.13.4), `docs/seed-rendering.md` contradicts itself
within four lines, and its contract table describes an OpenStack
ConfigDrive layout with JSON wrapping while the node agent writes
three flat plain-text files at the output root - the most damaging doc
error in this recon, because anyone implementing against it produces
an unbootable seed; both documents forbid inline plus reference, which
no layer enforces; and `optional` being ignored is documented nowhere.
Upstream's curated RBAC catalog grants all four kinds read verbs only,
so its own New button is hidden for every kind in this spec. Finally,
three UI bugs worth a gentle report: the image drawer reads the
PVC-clone source under a field name the CRD does not have and the size
from the scratch field the controller zeroes, so a Ready image always
shows zero; neither the image nor the kernel drawer displays
conditions, and the image controller emits no Events, so a failed
import is effectively undiagnosable from upstream's UI; and the seed
profile's edit path writes `spec.userData` unconditionally onto the
preserved base, so opening a reference-backed profile and pressing
Apply produces one carrying both the reference and a stub inline
value - harmless today, live the moment anyone removes the reference.

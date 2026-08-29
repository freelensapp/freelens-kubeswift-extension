# SPEC-0008: Read-only sandbox views (M4)

- **Status:** Verified (2026-08-29: non-regression tests green in CI on
  main; pre-review pass PASS on 14/14 views in both themes; milestone
  review by Roberto on the pass artifacts and screenshots with one
  coherence ruling, applied in PR #65; KVM-only checks listed in Manual
  verification stay open for a real-cluster session)
- **Milestone:** M4
- **KubeSwift version reviewed:** `v0.13.12`
- **Author / date:** Claude with Roberto, 2026-08-29

## Goal

An operator sees the ephemeral side of KubeSwift: which sandboxes are running
an OCI image as a microVM, how each one is doing (materializing, running,
finished, failed, and with which exit code), what it was given (image, command,
resources, model, scratch disk, GPU), and which warm pools are holding
pre-booted slots ready for a sub-second checkout. When a sandbox is stuck or
failed, its launcher pod's logs are one click away in Freelens' own log dock.

## Upstream reference

kubeswift-ui (v0.12.3): there is no `/sandbox` route at all. Both kinds are
reached through the generic **Explorer** screen, whose column projection comes
from the gateway's resource catalog, and their detail views are slide-over
drawers (`sandbox-drawer`, `sandboxpool-drawer`) with a Status / Spec / Runtime
split, a phase chip, an exit-code chip, and — on the pool — an inline scale
stepper. The `sandbox-logs` and `sandbox-exec` modals are terminals over the
gateway's raw-WebSocket planes; the `create-sandbox` / `create-sandboxpool`
forms are create wizards, so they belong to M6 here, not to this spec.

KubeSwift docs: `docs/sandbox/overview.md` (the mode-3 boot, the lifecycle, the
troubleshooting steps), `docs/sandbox/warm-pool.md` (checkout, consume-and-
replenish, cold fallback), `docs/sandbox/gpu-sandboxes.md`,
`docs/sandbox/scratch-disks.md`, `docs/crds.md`, `docs/ui/gateway.md` (the two
WebSocket planes). Schemas: `config/crd/bases/sandbox.kubeswift.io_swiftsandboxes.yaml`
and `sandbox.kubeswift.io_swiftsandboxpools.yaml`.

Visual and domain reference only; no code copying (AGPL boundary, see
ARCHITECTURE.md). This milestone is the first where the upstream UI is a
**weaker** reference than the schema: its sandbox tables are a generic CR
projection, so both lists below are designed from the printer columns and the
schema rather than mirrored.

## Scope

Included: typed models (full schema), list pages, detail drawers, a new sidebar
group, the repository's second and third status classifiers, unit tests, and
E2E fixtures plus assertions for **SwiftSandbox** (`sbox`, namespaced) and
**SwiftSandboxPool** (`sboxpool`, namespaced).

Also included, and the answer to the roadmap's "Sandbox logs — Planned
(feasibility: read via launcher pod)" row: the SwiftSandbox drawer resolves
`status.podRef` to the launcher pod and offers a **View logs** affordance that
opens Freelens' own log dock on it. This covers the launcher container and the
`sandbox-materialize` init container — exactly the artefacts upstream's
troubleshooting section tells operators to read. It does **not** cover the
workload's console; see "Sandbox logs: the feasibility verdict" in the Notes
for why that half is deferred to M7 rather than attempted here.

Excluded: creating, editing, deleting or scaling sandboxes and pools (M6 forms
and actions — note the pool's `scale` subresource makes a stepper trivially
implementable, which is precisely why it must wait for the M6 spec rather than
sneak into a read-only milestone); the interactive shell (M7); the workload
console tail (M7, argued in the Notes); the DRA `ResourceClaim` objects a
sandbox may reference, which are core Kubernetes resources Freelens renders
natively; and the CRD-absent probing panel of DESIGN.md section 6, which stays
the cross-cutting retrofit of gap #6 rather than being invented per milestone.

Columns and sections below are a starting point: the implementation verifies
every field against the CRD schema (the schema wins over this spec and over
`docs/crds.md`) and records deviations in this file.

## Design

Common: one model file per CRD in `src/renderer/api/kubeswift/`, statics
pattern (no instance methods), full spec/status typed from the schema,
`NamespaceScopedMetadata` on both models (the SPEC-0007 slice-1 rule for new
namespaced models), pages and drawers following the M1/M2/M3 files, `"N/A"`
fallbacks in lists, and values the schema declares without an `enum` typed as
plain strings so an unexpected value from a cluster cannot break a view.

Three properties of this pair shape everything below:

- **Both CRDs report real `conditions[]`.** They carry the standard
  `metav1.Condition` shape, with `message`, plus a top-level `status.message`.
  This is the first milestone in which DESIGN.md section 2's two-column
  `Condition` + `Status` pattern can be honoured **literally**: the Status
  column renders a raw message written by the controller, not the generated
  explanation SwiftGPUNode had to fall back on (SPEC-0007's declared
  deviation). M4 is therefore the reference implementation of that pattern for
  the M1/M2 retrofit of DESIGN.md gap #1.
- **Both phases are real `enum`s**, unlike every phase the extension has met so
  far (`Pending | Materializing | Running | Completed | Failed` and
  `Pending | Warming | Ready | Degraded`). The classifiers still pass an
  unrecognized value through opaquely: an enum constrains what the API server
  accepts today, not what a future controller writes, and the
  SPEC-0001/SPEC-0004/SPEC-0007 stance on unknown phases is unchanged.
- **Neither CRD carries a single CEL rule** (`x-kubernetes-validations` count:
  zero in both files). Every constraint the docs state — `gpuProfileRef`
  exclusive with `gpuResourceClaim`, either exclusive with `poolRef`, the whole
  spec immutable except `ttl`, scratch disks Block-only — is enforced by an
  admission webhook, not by the schema. The views must therefore render an
  object that breaks those rules rather than assume them: no section is coded
  as "if not GPU then pool", every block guards itself independently, and the
  GPU section names which backend it is reading instead of inferring one from
  the absence of the other.

### Navigation and sidebar placement

A new group **Sandboxes** (`kubeswift-sandboxes`), appended after "GPU" as the
sixth child of the `kubeswift` root, with the two resource pages under it:

| Menu id | Title | Page id |
| --- | --- | --- |
| `kubeswift-sandboxes` | Sandboxes | (group, `target` = `swiftsandboxes`) |
| `swiftsandboxes` | Sandboxes | `swiftsandboxes` |
| `swiftsandboxpools` | Sandbox Pools | `swiftsandboxpools` |

Justification. DESIGN.md section 4 names Sandbox as one of the groups future
milestones add, and two-level grouping is the standard, so flattening these two
leaves under the root is not an option. Appending after the existing five keeps
every current entry where users found it last time and follows the order the
roadmap introduces the domains in — the rule SPEC-0007 set and this spec
inherits rather than reopens. Sandboxes come first inside the group (and are
therefore the group's `target`): the sandbox is the object a user creates,
watches and troubleshoots, while a pool is infrastructure consulted when
checkouts are slow.

The alternative considered and rejected was hanging both leaves under the
existing "Guests" group, on the grounds that a sandbox is a microVM like a
guest. It is rejected because the two are different resources with different
lifecycles (ephemeral, PVC-free, OCI-rootfs, immutable-after-create), because
"Guests" would then hold five leaves and stop being scannable, and because the
sandbox domain owns its own API group and will grow its own leaves in M6/M7.

The group's title collides with its first leaf's title ("Sandboxes" twice, at
two levels). This is deliberate and matches core's own sidebar, where
"Workloads" is not repeated but "Config" holds "Config Maps": the group name is
the domain, the leaf is the kind, and here the domain is named after its
principal kind. The precedent inside this extension is "Migrations" (group)
containing "Migrations" (leaf), already shipped in M2. No new rule is needed.

Titles are humanized Title Case without the "Swift" prefix (DESIGN.md section
4, issues #24 and #29): "Sandboxes" and "Sandbox Pools". The kind stays
technical wherever it is a kind (drawer titles `SwiftSandbox: name`, YAML,
search).

### SwiftSandbox: list

Namespaced, so the full column grammar applies:

| Column | id | Source | Notes |
| --- | --- | --- | --- |
| Name | `name` | `metadata.name` | `WithTooltip`, no link |
| Namespace | `namespace` | `metadata.namespace` | `NamespaceSelectBadge` |
| Image | `image` | `spec.image` | printer column; digests are long, so truncation plus `WithTooltip` |
| Node | `node` | `status.nodeName` | printer column; plain text here, a link in the drawer |
| IP | `ip` | `status.network.primaryIP` | printer column; see below |
| Condition | `condition` | classifier | `Badge` with the host's status class |
| Status | `status` | raw message | `WithTooltip`, the controller's own words |
| Age | `age` | `getCreationTimestamp()` | `KubeObjectAge` |

The three domain columns are exactly the CRD's printer columns minus Phase,
which the Condition/Status pair says better; the raw phase stays in the drawer,
where `kubectl`'s own value belongs, and the host's printer-column block shows
it above our sections anyway. This is the SPEC-0007 rule applied unchanged.

The IP cell distinguishes three states rather than two, the way SPEC-0007's
Model cell distinguishes "any" from "absent". A `spec.network.mode` of `none`
means the sandbox deliberately has no network and `status.network.primaryIP` is
legitimately absent, so the cell renders **None** with a tooltip saying so; a
sandbox that should have an IP but has not been given one yet renders `"N/A"`;
otherwise it renders the address. Rendering `"N/A"` for a `network: none`
sandbox would read as a missing value when it is a chosen configuration.

Column widths (DESIGN.md section 8 scale): `image 1.5`, `node 1.0`, `ip 0.7`,
`condition 0.7`, `status 1.5`, `age 0.3`.

### SwiftSandbox: detail drawer

Sections in order, each self-guarding (a section component returns `null` when
its block is absent, so the drawer reads as a flat declarative list):

1. **Sandbox**: Condition (the classifier badge), Phase (the raw
   `status.phase`), Image, Command, Args, Working Dir, Pool, Exit Code,
   Started, Finished, Duration, Timeout, TTL.
   - Command absent is not a missing value: the schema says the image's
     `Entrypoint`+`Cmd` are used, so the row renders **Image entrypoint**.
     Command and Args are string arrays, rendered as `Badge`s in a
     `labelsOnly` `DrawerItem`.
   - Pool links `spec.poolRef.name` to the SwiftSandboxPool this milestone
     registers; the row's tooltip states the cold-fallback rule (a checkout
     that finds no free slot is not an error, it just loses the speedup), which
     is the single fact that stops a reader misreading a pooled sandbox that
     booted cold.
   - Exit Code is shown only for the terminal phases and keeps `0` (a
     successful run is a fact, the `formatBytes` zero rule applied to a
     different field).
   - Started and Finished are `LocaleDate` over `status.startedAt` and
     `status.terminalAt`. **Duration** is derived: `terminalAt - startedAt` for
     a finished sandbox, a `ReactiveDuration` from `startedAt` for a running
     one, hidden when `startedAt` is absent. For the CI-runner and
     code-interpreter use cases the docs name, how long it ran is the number
     the user came for, and neither the CRD nor `kubectl` reports it.
   - Timeout and TTL render the raw duration strings with a tooltip explaining
     the two different mechanisms they drive (a run cap that force-terminates
     to `Failed`, versus post-terminal retention anchored on `terminalAt`).
     They are not parsed; see "Durations" in the Notes.
2. **Guest**: CPU, Memory (`formatQuantity`), Rootfs Mode, Kernel Profile,
   Network Mode, Node Selector (badges).
   - Kernel Profile links `spec.kernelProfileRef.name` to the SwiftKernel of
     the same namespace when it is set and resolvable. When it is unset the row
     renders **sandbox (default)** as plain text with a tooltip: the default is
     applied by the controller, not by the schema, and this extension cannot
     know which namespace the controller resolves it in, so linking a guess
     would be a dead link.
   - Rootfs Mode and Network Mode render the raw enum values with the schema's
     own explanation of each in the tooltip, the SPEC-0007 treatment of tier
     and partition mode.
3. **Runtime**: Node (`LinkToNode` when the node exists, plain text
   otherwise), Launcher Pod (`LinkToPod` plus the View logs affordance, see
   below), IP, Hypervisor (`status.runtime.hypervisor`), PID.
4. **Rootfs** (`status.rootfs`): Digest, Size (`formatBytes` over `sizeBytes`,
   an int64 byte count), Cache Path.
5. **Model** (`spec.model` + `status.model`): Image Ref, Mount Path, Digest,
   Cache Path.
6. **Scratch Disk** (`spec.scratchDisk` + `status.scratchDisk`): Source
   (`Blank` or `Existing PVC`, named rather than inferred by the reader), Size,
   Storage Class, Volume Mode, PVC, Bound (`BadgeBoolean`), Device Path.
   Core exports no `LinkToPersistentVolumeClaim` (the `kube-object-link`
   family covers Pod, Node, Namespace, Secret, ConfigMap, Job, Role and a few
   more, but not PVCs), so the PVC row is the generic path DESIGN.md section 3
   prescribes for arbitrary refs: `existingObjectRef(pvcStore,
   "PersistentVolumeClaim", ...)` into a `LinkToObject`, degrading to plain
   text like every other reference.
   Storage Class does have a core link component, so
   `spec.scratchDisk.blank.storageClassName` is an existence-checked
   `LinkToStorageClass` (`objectExists(storageClassStore, ...)`, cluster-scoped
   so no namespace), degrading to plain text when the class is gone. It is the
   same row the SwiftSnapshot drawer's "Captured Guest" section renders the same
   way, and the same row SwiftGuestClass and SwiftImage link: a Storage Class
   must read the same in every drawer of this extension (see "Milestone review
   follow-up" in the Notes).
7. **GPU** (`spec.gpuProfileRef` or `spec.gpuResourceClaim`, plus
   `status.gpu`): Backend (**Native SwiftGPU** or **DRA ResourceClaim**, stated
   explicitly because the two populate different fields and, with no CEL rule
   enforcing exclusivity, both can be present), GPU Profile (existence-checked
   link to the SwiftGPUProfile M3 registered), Tier, Resource Claim / Claim
   Template, Request Name, Hugepages, Devices, GPU Node (existence-checked link
   to the SwiftGPUNode M3 registered), GPU Hypervisor, NUMA Nodes, Partition.
   The row labels and the `partitionId == -1` sentinel follow the SwiftGuest
   GPU section shipped in SPEC-0007 slice 2, including calling the row "GPU
   Hypervisor" so it cannot be confused with the Runtime section's Hypervisor.
8. **Environment** (`spec.env`): a nested core `Table`
   (`sortSyncWithUrl={false}`, `scrollable={false}`), one row per variable:
   Name, Value, Source. A literal `value` fills Value; a `valueFrom` fills
   Source with the kind and key it reads (`Secret my-secret/key`,
   `ConfigMap ...`, `field spec.nodeName`, `resource limits.memory`), with
   Secret and ConfigMap names rendered as existence-checked links.
   **Values are shown as they arrive and are never masked**: a `secretKeyRef`
   carries no value in the object, so there is nothing to leak, and masking a
   literal the author typed into the spec would hide data the YAML tab shows
   anyway.
9. `KubeObjectConditionsDrawer`, as the eight M1/M2 drawers already do. The
   pre-review pass counts conditions sections per drawer and found no
   duplication with the host's block across those views (SPEC-0006); both new
   drawers join that assertion, which is what re-checks the DESIGN.md section 3
   rule for the first CRDs with conditions since it was written.

The host's generic `.CustomResourceDetails` block will repeat Phase, Image,
Node and IP as plain rows above our sections. That duplication is accepted and
our sections stay complete (DESIGN.md section 3, issue #52): nothing is trimmed
to dodge it and nothing is hidden with CSS.

### SwiftSandboxPool: list

Namespaced:

| Column | id | Source | Notes |
| --- | --- | --- | --- |
| Name | `name` | `metadata.name` | `WithTooltip`, no link |
| Namespace | `namespace` | `metadata.namespace` | `NamespaceSelectBadge` |
| Image | `image` | `spec.image` | printer column |
| Min Warm | `minWarm` | `spec.minWarm` | printer column; the desired count |
| Warm | `warm` | `status.warmReplicas` | printer column; the actual count |
| Claimed | `claimed` | `status.claimedReplicas` | printer column |
| Condition | `condition` | classifier | `Badge` |
| Status | `status` | raw message | `WithTooltip` |
| Age | `age` | `getCreationTimestamp()` | `KubeObjectAge` |

The domain columns are the CRD's printer columns minus Phase, in the CRD's own
order, so the list reads like `kubectl get sboxpool`. Upstream's Explorer
projects this table differently (it drops Image and reorders to Phase / Warm /
Claimed / Min); the divergence is deliberate. The extension's rule since M1 is
that a list matches `kubectl`, and desired-then-actual-then-in-use (Min Warm,
Warm, Claimed) is the reading order an operator checking a pool wants: the gap
between the first two columns *is* the health of the pool, and putting them
side by side is what makes it scannable.

`maxWarm` is not a printer column and does not become one: it is a cap that
matters when you are sizing a pool, not when you are scanning a list, and it
would push the two counts that matter apart. It has a row in the drawer.

Column widths: `image 1.5`, `minWarm 0.5`, `warm 0.5`, `claimed 0.5`,
`condition 0.7`, `status 1.5`, `age 0.3`.

### SwiftSandboxPool: detail drawer

1. **Pool**: Condition, Phase, Image, Min Warm, Max Warm, Warm, Claimed,
   Observed Generation, Slot Selector.
   - Max Warm renders **No cap** when the value is `0` or absent, with the
     schema's wording in the tooltip. `0` here is not a count, it is a sentinel
     meaning "no cap beyond minWarm", and rendering a bare `0` next to
     `Min Warm: 2` would read as a contradiction.
   - Slot Selector is the raw `status.selector` string. It exists so
     `kubectl scale` and an HPA can target the pool, and showing it tells an
     operator which pods are this pool's slots. It is displayed, not parsed:
     see the warm-slot table decision below.
2. **Slot Shape**: CPU, Memory, Rootfs Mode, Network Mode, Kernel Profile,
   Node Selector, Image Pull Secret, Verify Key Secret. The section is named
   after what the schema calls it — these fields describe the shape of every
   warm slot, and a claiming sandbox must match them — so a reader does not
   take them for the pool's own resources. Both secrets are existence-checked
   `LinkToSecret` rows in the pool's namespace.
3. **Rootfs** (`status.rootfs`): Digest, Size (`formatBytes`), Cache Path.
   The pool's rootfs is shared by every slot on a node, which the section's
   first row states.
4. **Model** (`spec.model`): Image Ref, Mount Path.
5. **GPU** (`spec.gpuProfileRef`): GPU Profile (existence-checked link), plus
   one line of context — a warm GPU pool holds one whole GPU idle per slot, so
   `minWarm` should not exceed the cluster's GPU count. That is a sizing fact
   an operator cannot recover from the numbers alone.
6. **Image Environment** (`status.imageEnv`): a nested `Table` of the image
   config's environment, split into Name and Value on the first `=` (a value
   may itself contain `=`; splitting on the last would corrupt it). This is
   what a checkout merges the sandbox's own `env` over, so it explains what a
   sandbox will actually see.
7. **Sandboxes Using This Pool**: a nested `Table` of the SwiftSandboxes in the
   pool's namespace whose `spec.poolRef.name` is this pool, with Name
   (existence-checked link), Condition and Node. `poolRef` is a
   `LocalObjectReference`, so the search is namespace-local by construction.
   The section renders only once the SwiftSandbox store reports `isLoaded` for
   that namespace; while the store is still filling it renders nothing rather
   than claiming the pool is unused, and once loaded with no match it says so
   explicitly. This is the SPEC-0007 "Guests Using This Profile" pattern,
   reused rather than reinvented.
8. `KubeObjectConditionsDrawer`.

**Not included: a table of the warm slot pods.** `status.selector` would let
the drawer list the pool's slot pods, and they are the most concrete thing a
pool has. It is left out of M4 for two reasons: it needs a label-selector
parser this repository does not have (and the schema promises only "serialized
as a string", so hardcoding the documented `sandbox.kubeswift.io/pool=<name>`
form would be guessing at a contract), and the slots are an implementation
detail of the pool rather than an object a user reasons about — the sandboxes
that claimed them, which section 7 does list, are. If the milestone review asks
for it, it becomes a follow-up with the parser specified, not an improvisation.

### Status classification

A pure module `src/renderer/components/sandbox-status.ts`, no JSX and no colours
inside, exporting two classifiers because the two CRDs have different phase
vocabularies, plus the message selector they share.

`classifySandbox`:

| State | When | Class |
| --- | --- | --- |
| `Running` | phase `Running` | `success` |
| `Completed` | phase `Completed` | `success` |
| `Materializing` | phase `Materializing` | `warning` |
| `Pending` | phase `Pending` | `warning` |
| `Failed` | phase `Failed` | `error` |
| `Unknown` | no phase at all | `info` |
| the raw value | any other phase string | `info` |

`classifySandboxPool`:

| State | When | Class |
| --- | --- | --- |
| `Ready` | phase `Ready` | `success` |
| `Warming` | phase `Warming` | `warning` |
| `Pending` | phase `Pending` | `warning` |
| `Degraded` | phase `Degraded` | `error` |
| `Unknown` | no phase at all | `info` |
| the raw value | any other phase string | `info` |

Two judgement calls, both recorded for the milestone review:

- **`Completed` is `success`, the same class as `Running`.** A finished
  sandbox that did its job is not a warning, and DESIGN.md's colour table maps
  both "healthy/running" and "completed/succeeded" to green tokens. The badge
  word carries the difference between the two, which is what the word is for.
- **`Degraded` is `error`, not `warning`.** A degraded pool still works — a
  checkout that finds no free slot falls back to the cold path automatically —
  so the case for `warning` is real. It is rejected because the pool's entire
  purpose is the sub-second checkout, and a pool that is not holding its warm
  buffer is not delivering it. The consequence is named in the message so the
  colour is never read as an outage.

The exit code deliberately does **not** enter the verdict. A `Completed`
sandbox with a non-zero `status.exitCode` would be a contradiction — the docs
say a non-zero exit is what makes a sandbox `Failed` — and the honest response
to a contradiction is to show both facts, not to invent a third state. The exit
code is in the drawer and in the message; if a real controller is ever seen
producing that pair, the classifier gets a case and a test, not a guess now.

**The message selector**, `sandboxMessage(status)`, is what fills the Status
column, and it is the first implementation of DESIGN.md section 2's "raw
condition message" in this repository. In order:

1. `status.message`, when non-empty — the controller's own summary.
2. otherwise the `message` of the newest condition (by `lastTransitionTime`)
   whose `status` is not `"True"` — a problem being reported outranks a
   success being reported.
3. otherwise the `message` of the newest condition.
4. otherwise the classifier's generated explanation, so the column is never
   blank on an object whose controller has not written anything yet.

It deliberately **does not hardcode any condition type**. The schema constrains
conditions only to the `metav1.Condition` shape; the type names come from
`docs/sandbox/overview.md` (`Resolved`, `RootfsReady`, `GuestRunning`,
`GPUAllocated`, `ScratchDiskReady` for a sandbox; `Resolved`, `Warm` for a
pool) and are documentation, not API. A selector keyed on them would silently
fall through the day the controller adds a sixth. Ordering by transition time
and by "not True" is derived from the shape the API guarantees.

The module keeps the SPEC-0007 contract: a pure function from a structurally
declared status to `{ state, className, explanation }`, no dates formatted
inside (`startedAt`/`terminalAt`/`lastTransitionTime` are returned as they
arrived and rendered by `LocaleDate`/`ReactiveDuration` in the view), and unit
tests that need no host global.

### Launcher pod logs (the roadmap's "Sandbox logs" row)

`status.podRef` is the launcher pod's **name** — a bare string, not the
`ObjectReference` SwiftGuest's `status.podRef` carries — and the pod lives in
the sandbox's own namespace. For a pool checkout it names the *claimed slot's*
pod (`<pool>-slot-<n>`), not a pod named after the sandbox, so the name is
always read from the field and never derived.

The Runtime section's **Launcher Pod** row therefore:

- resolves the name against `podsStore` through `useReferenceStores`, scoped to
  the sandbox's namespace, exactly as the SwiftGuest drawer already does;
- renders `LinkToPod` when the pod exists and `WithTooltip` plain text when it
  does not (a terminal sandbox's pod is routinely gone, and `spec.ttl` deletes
  the record afterwards — a miss here is the normal case, not a defect);
- when the pod exists, adds an interactive `Icon material="subject"` with the
  tooltip "View logs", which calls
  `Renderer.Component.logTabStore.createPodTab({ selectedPod, selectedContainer })`
  and `stopPropagation`s the click. The affordance is absent — not disabled —
  when the pod is not in the store, so there is no dead control.

This opens the host's own log dock tab. The extension renders no log viewer,
streams nothing itself, and adds no new permission: it is the same read the
user could do from core's Pods page, reached from the object that explains it.
Core's own pods list does exactly this from its logs column.

The container is chosen by a small pure helper,
`src/renderer/components/pod-logs.ts`: the container named by the pod's
`kubectl.kubernetes.io/default-container` annotation, falling back to the first
of `pod.getAllContainers()`. Core has this logic but does **not** export it
through the extension API, so it is reimplemented here (both codebases are MIT,
so this is a convenience question, not a licensing one) and unit-tested.
`getAllContainers()` includes init containers, which is what puts the
`sandbox-materialize` logs — the artefact upstream's troubleshooting section
points at for a stuck `Materializing` or a failed image pull — one container
switch away inside the tab the button opens.

**Risk, and the fallback.** `logTabStore` is a documented export of the
renderer extension API, but no freelensapp extension uses it today; this would
be the first. The implementation PR is therefore gated on a live spike (launch
Freelens with the fixture cluster, open a sandbox drawer, click the icon,
confirm a log tab opens in the dock) **before** the PR is opened, per
TESTING.md layer 4. If the call turns out not to work from an extension
context, the row degrades to the `LinkToPod` link alone — which already lands
the user on core's Pod page, where core's own logs button lives — and the
roadmap row moves to M7 with the finding recorded here. The spike is cheap and
the fallback costs nothing, which is why this is in scope rather than deferred
wholesale.

### References and reference loading

Every reference is a link only when the target is actually in its store
(`existingObjectRef` for `LinkToObject` targets, `objectExists` for the rows
that only need the boolean), and degrades to `WithTooltip` plain text
otherwise; the stores behind those checks are declared through
`useReferenceStores` with the namespaces the references live in, never through
an ad-hoc `loadAll()` (DESIGN.md section 3, issue #38).

| Drawer | Store | Namespaces | Lookups |
| --- | --- | --- | --- |
| SwiftSandbox | `nodesStore` | cluster-wide (omitted) | `status.nodeName`, `status.gpu.nodeName` |
| SwiftSandbox | `podsStore` | the sandbox's own namespace | `status.podRef` |
| SwiftSandbox | `secretsStore` | the sandbox's own namespace | `spec.imagePullSecret`, `spec.verifyKeySecretRef.name`, every `env[].valueFrom.secretKeyRef.name` |
| SwiftSandbox | `configMapStore` | the sandbox's own namespace | every `env[].valueFrom.configMapKeyRef.name` |
| SwiftSandbox | `pvcStore` | the sandbox's own namespace | `status.scratchDisk.pvcName`, `spec.scratchDisk.pvcRef.name` |
| SwiftSandbox | `storageClassStore` | cluster-wide (omitted) | `spec.scratchDisk.blank.storageClassName` |
| SwiftSandbox | SwiftSandboxPool | the sandbox's own namespace | `spec.poolRef.name` |
| SwiftSandbox | SwiftKernel | the sandbox's own namespace | `spec.kernelProfileRef.name` |
| SwiftSandbox | SwiftGPUProfile | the sandbox's own namespace | `spec.gpuProfileRef.name` |
| SwiftSandbox | SwiftGPUNode | cluster-wide (omitted) | `status.gpu.nodeName` |
| SwiftSandboxPool | `secretsStore` | the pool's own namespace | `spec.imagePullSecret`, `spec.verifyKeySecretRef.name` |
| SwiftSandboxPool | SwiftKernel | the pool's own namespace | `spec.kernelProfileRef.name` |
| SwiftSandboxPool | SwiftGPUProfile | the pool's own namespace | `spec.gpuProfileRef.name` |
| SwiftSandboxPool | SwiftSandbox | the pool's own namespace | the sandboxes the section lists |

The SwiftSandbox drawer asks for more stores than any drawer in the extension
so far. The loader is built for this (one request per store, explicit
namespaces, bounded retries, one diagnostic line each), but the request list is
assembled **conditionally**: a store whose references are all absent
contributes no request, so a plain sandbox with no secrets, no scratch disk and
no GPU loads exactly what the SwiftGuest drawer loads today. This has to be
verified in the live spike, not assumed: the drawer's `useReferenceStores`
call is the one place where a read-only view can make the app feel slow.

`status.gpu.nodeName` appears twice on purpose, resolved once against
`nodesStore` (the Kubernetes node) and once against the SwiftGPUNode store (the
GPU inventory object named after it), which is the pairing SPEC-0007 settled in
the SwiftGuest drawer.

A `lookup=miss` is expected here more often than anywhere else in the
extension, and is not a defect: a terminal sandbox's launcher pod is gone, a
scratch PVC provisioned as `blank` is deleted with its sandbox, and a pooled
sandbox may name a pool that was removed. Those rows render as plain text,
which is the correct outcome.

### Reach into the existing views

None. Unlike M3, this milestone registers no kind that an already-shipped
drawer renders as plain text: no M1/M2/M3 CRD references a SwiftSandbox or a
SwiftSandboxPool. The reference flow is one-way — sandboxes point at kernels,
GPU profiles and GPU nodes, all of which are already registered kinds, so all
three of those rows are links from the first commit of this milestone. This is
worth stating because it is the reason M4 is a smaller change than M3 despite
having the larger schema.

The one reach that does happen is **inside** the milestone rather than back into
a shipped one: slice 2 turns the SwiftSandbox drawer's Pool row into a link once
SwiftSandboxPool is a registered kind (see "Implementation slices" in the
Notes). It is the same shape of change M3 made to the SwiftGuest drawer, one
slice apart instead of one milestone apart.

### Non-happy states

- **Loading**: the `KubeObjectListLayout` spinner, unchanged.
- **Empty list**: delegated to the layout (`NoItems`). This is the normal state
  of both pages on most clusters — sandboxes are ephemeral by definition, so an
  empty Sandboxes page is the resting state of a healthy cluster, not an edge
  case. The milestone review explicitly checks that the host empty state reads
  acceptably here.
- **Render error**: both pages and both drawers wrapped in `withErrorPage`.
- **CRDs not installed**: unchanged from M1/M2/M3 (DESIGN.md section 11 gap #6,
  cross-cutting).
- **Absent references**: covered above; every reference degrades to text, and
  the View logs affordance disappears rather than pointing at a pod that is
  gone.

### DESIGN.md conformance

Column grammar, `NamespaceSelectBadge` for the namespace cell, a React `key` on
every cell, single-line cells with truncation plus tooltip, explicit column
ids, per-column `className` and widths in the page SCSS modules, no hardcoded
colours, both themes checked before the PR.

**No declared deviations.** This is the first milestone that needs none: both
CRDs report conditions and messages, so the two-column pattern is implemented
as written, and neither list has to drop a state column the way SwiftGPUProfile
did. The two judgement calls in the classifier table (`Completed` as success,
`Degraded` as error) are choices inside the pattern, not departures from it.

## Tests (non-regression list)

- **Unit** (`pnpm test:unit`):
  - `src/renderer/api/kubeswift/swiftsandbox-v1alpha1.test.ts`: construction
    from a realistic fixture, every helper, a sandbox with only the required
    `image` and `memory` (every optional block absent), the empty-command
    "Image entrypoint" case, the `network: none` IP case, the derived duration
    for both a running and a terminal sandbox, an `exitCode` of `0`, the DRA
    branch (`spec.gpuResourceClaim`, which no E2E fixture carries), and an
    object with no status at all.
  - `src/renderer/api/kubeswift/swiftsandboxpool-v1alpha1.test.ts`:
    construction, the `maxWarm: 0` "No cap" case, the `imageEnv` split on the
    first `=` including a value that itself contains `=`, a pool with no
    status, and a status with counts but no `rootfs`/`imageEnv`/`selector`.
  - `src/renderer/components/sandbox-status.test.ts`: one case per row of both
    classifier tables, plus an unknown phase string and a missing status for
    each; and for `sandboxMessage`, one case per rung of the four-step ladder,
    including two conditions where the newer non-`True` one wins over a newer
    `True` one, and a condition type this extension has never heard of being
    selected on its merits.
  - `src/renderer/components/pod-logs.test.ts`: the annotation names a real
    container; the annotation names an unknown container (falls back to the
    first); no annotation; a pod whose only containers are init containers; an
    empty container list (returns nothing, so the caller renders no
    affordance).
- **Integration**: unchanged (the harness keeps asserting install, listing as
  enabled, and activation without errors).
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), three new cases plus one
  link case, each also asserting `headerCellsWithoutId(frame)` is empty for the
  view it opens:
  - "lists the SwiftSandboxes with their image, node and condition": the
    running fixture (image, node, IP, the Running badge) and the failed one
    (the Failed badge, its raw message in the Status column, and the **None**
    IP cell), then the running sandbox's drawer with its scratch disk, model
    and GPU sections.
  - "lists the SwiftSandboxPools with their warm and claimed counts": the ready
    pool (min 2, warm 2, claimed 1, the Ready badge) and the degraded one (warm
    0, the Degraded badge and its message), then the ready pool's drawer with
    its image-environment table and its "Sandboxes Using This Pool" row for the
    pooled sandbox fixture.
  - "opens the launcher pod's logs from the SwiftSandbox drawer": clicks the
    View logs affordance on the running sandbox and asserts a log tab named
    after the launcher pod appears in the dock. **It asserts the tab, not log
    content**: the fixture launcher pods are deliberately unschedulable (the
    `55-launcher-pods.yaml` technique, so no image is ever pulled), so they
    have no logs to show. What this test protects is the wiring — the podRef
    resolves, a container is picked, the host API is called with a shape it
    accepts — which is exactly the part that can regress silently.
  - "navigates the SwiftSandbox drawer's pool, kernel and GPU links to objects
    that actually exist": the pre-review link helper, as the SwiftGuest and
    SwiftGPUNode cases already do. The pooled sandbox's Pool row must be a live
    link, and the failed sandbox's absent references must stay plain text. The
    running sandbox's **Storage Class** row joins the checked labels: its
    `scratchDisk.blank.storageClassName` is `standard`, the StorageClass every
    kind cluster ships, so the link resolves (see "Milestone review follow-up"
    in the Notes).
- **Fixtures and status injection** (`e2e/fixtures/`, numbering continued):
  - Both CRDs are already applied by `cluster-up.sh`: `KUBESWIFT_CRD_FILES`
    lists all 15 upstream CRDs, so M4 needs no change there — only fixtures.
  - `130-swiftsandboxes.yaml`, three objects so that every branch has a row:
    - `e2e-sandbox-running`: the full one. Image with a digest, `cpu: 2`,
      `memory: 1Gi`, command, args, env (a literal, a `secretKeyRef` and a
      `configMapKeyRef`), `workingDir`, `timeout`, `ttl`, `rootfsMode: block`,
      `network.mode: restricted`, `kernelProfileRef` at the M1 kernel fixture,
      `imagePullSecret` and `verifyKeySecretRef` at Secret fixtures,
      `scratchDisk.blank`, `model`, and `gpuProfileRef` at
      `e2e-gpu-profile-pcie` (the native GPU backend; `gpuResourceClaim` and
      `poolRef` are both excluded by the documented webhook rules, so no
      fixture may combine them — the DRA branch is covered by unit tests
      instead, and that gap is deliberate).
    - `e2e-sandbox-failed`: the minimal one. Only `image` and `memory`, plus
      `network.mode: none`. Every optional section of the drawer must guard
      itself away, and the IP cell must read **None**.
    - `e2e-sandbox-pooled`: `poolRef` at the pool fixture, no GPU, no scratch
      disk. Its injected `podRef` names the pool's slot pod rather than a pod
      named after the sandbox, which is the one fixture that pins the "podRef
      is the claimed slot's pod" fact.
  - `140-swiftsandboxpools.yaml`: `e2e-sandbox-pool` (`minWarm: 2`,
    `maxWarm: 4`, model, `imagePullSecret`) and `e2e-sandbox-pool-degraded`
    (only `image` and `memory`, so `maxWarm` is absent and the drawer must read
    **No cap**).
  - **Status patches for all five** (`subresources: {status: {}}` is declared
    on both CRDs). The running sandbox gets phase `Running`,
    `nodeName: __NODE_NAME__`, `podRef`, `network.primaryIP`, `runtime`,
    `rootfs` (with `sizeBytes`, so the humanized-bytes assert of the pre-review
    pass has something to catch), `model`, `scratchDisk`, `gpu` with
    `nodeName: __NODE_NAME__`, `startedAt`, and four `True` conditions. The
    failed one gets phase `Failed`, a non-zero `exitCode`, `terminalAt`, a
    `message`, and a `RootfsReady: False` condition carrying the text the
    Status column must show. The pooled one gets phase `Completed`,
    `exitCode: 0`, `startedAt`/`terminalAt` (so the derived Duration is
    exercised) and its slot `podRef`. The ready pool gets phase `Ready`,
    `warmReplicas: 2`, `claimedReplicas: 1`, `rootfs`, `imageEnv`, `selector`,
    `observedGeneration` and two `True` conditions; the degraded pool gets
    phase `Degraded`, `warmReplicas: 0` and a `Warm: False` condition.
  - `55-launcher-pods.yaml` gains two pods, `e2e-sandbox-running-launcher` and
    `e2e-sandbox-pool-slot-1`, built with the same deliberately-unschedulable
    technique as the existing one and named to match the injected `podRef`s.
    Their file comment says why they exist, as the existing one does.
  - `lib.sh`: five entries in `E2E_STATUS_PATCHES`; assertions in
    `E2E_STATUS_ASSERTIONS` for the sandbox phase, the failed exit code, the
    pool's warm and claimed counts; and two entries in `E2E_NODE_NAME_FIELDS`
    for the running sandbox's `status.nodeName` and `status.gpu.nodeName`. No
    new mechanism is needed: SwiftSandboxPool's extra `scale` subresource does
    not affect `kubectl patch --subresource=status`, and both kinds are
    namespaced, so the unconditional `--namespace` is correct for them.
  - `fixturesReady()` gains an M4 probe
    (`swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running`), so a cluster
    left over from an older checkout is reported as not ready instead of
    failing later as a page full of missing rows.
- **Pre-review agent pass** (SPEC-0006, `pnpm pre-review`): two entries in
  `integration/helpers/kubeswift-views.ts` (`swiftsandboxes` / "Sandboxes" /
  `e2e-sandbox-running`, and `swiftsandboxpools` / "Sandbox Pools" /
  `e2e-sandbox-pool`), both plain literals — neither needs the lazy
  cluster-node-name getter the SwiftGPUNode entry uses. The pass's existing
  asserts then cover the new views for free: header ids, every drawer link
  clicked and checked for the host's load-failure panel, references rendered as
  links or as text but never as dead links, byte values humanized (this is what
  catches `rootfs.sizeBytes` rendered as a raw digit run), the
  conditions-section count (which must be 1, not 2, for both new drawers — the
  first re-test of the DESIGN.md section 3 rule on CRDs that actually report
  conditions), and both themes. The pass runs before the M4 review session and
  its report is the precondition for it (PROCESS.md).
- **Manual verification**: fixture-based rendering needs none. What stays
  manual-only (TESTING.md) is a real KVM-backed cluster with the sandbox
  SwiftKernel installed: that a sandbox actually transitions
  `Pending → Materializing → Running → Completed` with the phases and messages
  the classifier maps; that the launcher pod's logs opened from the drawer are
  the ones the operator needed (in particular that the `sandbox-materialize`
  init container is reachable in the same tab); that a warm-pool checkout shows
  the claimed slot's pod in the Launcher Pod row; and that a `spec.timeout`
  expiry renders as `Failed` with the `DeadlineExceeded` reason in the Status
  column. Record date, tester and result here when it happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan. The recon that
produced this spec follows the implementation notes.

### Implementation slices

The milestone is implemented in two PRs, split along the two kinds rather than
along the layers, so each slice is a whole working view with its own tests:

- **Slice 1 — SwiftSandbox.** The model, `classifySandbox`, the shared message
  selector, the container-picking helper, the list page, the detail drawer with
  the launcher-pod logs affordance, the new **Sandboxes** sidebar group with its
  single Sandboxes leaf, the three sandbox fixtures with their status patches,
  the two sandbox launcher pods, and the pre-review entry for the sandbox view.
- **Slice 2 — SwiftSandboxPool.** The pool model, `classifySandboxPool` and its
  message selector, the pool list page and drawer, the Sandbox Pools leaf under
  the group slice 1 created, the two pool fixtures with their status patches,
  and the pre-review entry for the pool view.

Three consequences inside slice 1, all of them temporary and all now closed by
slice 2 (each one is recorded below with what closed it):

1. `src/renderer/components/sandbox-status.ts` ships `classifySandbox`,
   `conditionMessage` and `sandboxMessage` only. `classifySandboxPool` and the
   pool's own message selector join the same module in slice 2, which is why
   the shared rungs were factored out from the start (see below).
2. The **Pool** row of the SwiftSandbox drawer renders `spec.poolRef.name` as
   plain text with its cold-fallback tooltip. SwiftSandboxPool is not a
   registered kind until slice 2, so there is no store to resolve the reference
   in, and plain text is what every unresolvable reference degrades to. Slice 2
   turns it into an existence-checked link and adds the `e2e-sandbox-pool`
   fixture that `e2e-sandbox-pooled` already names.
3. The spec's fourth E2E case ("navigates the SwiftSandbox drawer's pool,
   kernel and GPU links") therefore covers Kernel Profile, GPU Profile, GPU
   Node, Node and Launcher Pod in slice 1, and gains the Pool row in slice 2.
   Its counter-assert — a reference that must stay plain text — is the minimal
   sandbox's controller-applied `sandbox (default)` kernel row.

### Schema verification: SwiftSandbox (2026-08-29)

`config/crd/bases/sandbox.kubeswift.io_swiftsandboxes.yaml` was re-read at tag
`v0.13.12` while writing the model. Every field, default, enum and required
marker this spec's Design section states is what the schema declares; no
correction was needed. Three details the spec did not spell out, recorded
because the model types them:

- `spec.verifyKeySecretRef` is **not** a `LocalObjectReference`: its `name` is
  genuinely `required` and carries no `""` default, unlike every other ref on
  this CRD. `spec.scratchDisk.blank.size` and `spec.model.imageRef` are required
  too.
- `spec.rootfsMode` carries its `enum` twice, nested under an `allOf` — a
  controller-gen artefact rather than a constraint. It is read as one enum.
- `spec.env[].valueFrom.fileKeyRef` (the alpha `EnvFiles` gate) is the fifth
  source the schema declares; the Environment table renders it as
  `file <volume>/<path> (<key>)`, with no linkable referent.

### Declared deviations and additions (slice 1)

1. **The message selector is exported as two functions, not one.** The Design
   section names `sandboxMessage(status)` and calls it the selector the two
   kinds share, but its fourth rung is each kind's own classifier explanation,
   which cannot be shared. The implementation therefore exports
   `conditionMessage(status)` — rungs 1 to 3, keyed on no condition type, used
   by both kinds — and `sandboxMessage(status)`, which is
   `conditionMessage(status) ?? classifySandbox(status).explanation`. Slice 2's
   pool selector is the same two lines over `classifySandboxPool`. The ladder
   itself is unchanged.
2. **A condition whose `message` is the empty string is skipped**, whatever its
   `lastTransitionTime` and whatever its `status`. `metav1.Condition` allows an
   empty message, and selecting one would leave the Status column blank, which
   is the single outcome the ladder exists to prevent. This is a refinement of
   rungs 2 and 3, not a change of their order, and it has its own unit test.
3. **Two Secret rows were added to the SwiftSandbox drawer.** The Design
   section's drawer list omits `spec.imagePullSecret` and
   `spec.verifyKeySecretRef`, while the reference table one section below
   declares `secretsStore` lookups for both — so the drawer would have been
   loading a store for rows that did not exist. Both are rendered as
   existence-checked `LinkToSecret` rows at the end of the **Guest** section,
   which is the same grouping the SwiftSandboxPool's "Slot Shape" section already
   prescribes for the same two fields, so the two M4 drawers read the same way.
4. **The derived Duration of a finished sandbox is formatted with
   `Common.Util.formatDuration`, not with `ReactiveDuration`.** The spec asks
   for `ReactiveDuration` and for no hand-rolled formatter; the first half is
   impossible for a terminal sandbox, because `ReactiveDuration` only ever
   measures a timestamp against *now* and cannot express
   `terminalAt - startedAt`. `Common.Util.formatDuration` is the host's own
   formatter and is the very function `ReactiveDuration` calls internally, so
   the intent of the rule — no formatter written in this repository — holds. A
   running sandbox still goes through `ReactiveDuration` from `startedAt`, as
   written.
5. **Two fixture files the spec did not name.** `125-sandbox-references.yaml`
   adds two Secrets and a ConfigMap in the fixture namespace, so that the two
   Secret rows above and the environment table's `secretKeyRef` and
   `configMapKeyRef` sources resolve to objects that exist and render as links
   rather than all degrading to text. The two sandbox pods added to
   `55-launcher-pods.yaml` carry a `sandbox-materialize` init container and the
   `kubectl.kubernetes.io/default-container` annotation, so the container-picking
   helper is exercised against the shape a real launcher pod has.
6. **Which rung each sandbox fixture exercises.** `e2e-sandbox-running` writes
   no `status.message`, so its Status column is the newest condition's message
   (rung 3); `e2e-sandbox-failed` writes one, so its column is that summary
   (rung 1) while its `RootfsReady: False` condition carries the detail behind
   it; `e2e-sandbox-pooled` writes neither, so its column falls back to the
   classifier's explanation (rung 4). Rung 2 — a problem outranking a more
   recent success — is unit-tested only: it needs two conditions in a specific
   temporal order, which is a shape a static fixture cannot make more convincing
   than the unit test already does. **Superseded by slice 2**, whose degraded
   pool fixture carries exactly that pair, so rung 2 is now covered end to end
   as well.

### Schema verification: SwiftSandboxPool (2026-08-29)

`config/crd/bases/sandbox.kubeswift.io_swiftsandboxpools.yaml` was re-read at
tag `v0.13.12` while writing the pool model. Every field, default, enum and
required marker this spec's Design section states is what the schema declares;
no correction was needed. Four details recorded because the model types them:

- The **`scale` subresource surfaced in no view.** It is an API-server-side
  projection of three fields the model already types (`spec.minWarm`,
  `status.warmReplicas`, `status.selector`), it adds no field of its own, and
  M4 never writes. `kubectl patch --subresource=status` addresses the status
  subresource by name and is unaffected by it, so the fixture mechanism needed
  no change either. Its only trace in the code is the comment saying so on the
  model and on the Slot Selector row, which explains why a pool publishes a
  serialized selector at all. What `scale` makes possible — `kubectl scale`, an
  HPA, and the inline stepper upstream's drawer has — belongs to M6.
- `spec.verifyKeySecretRef` is **not** a `LocalObjectReference` here either: its
  `name` is genuinely `required`. `spec.model.imageRef` is required too, and
  `spec.image` and `spec.memory` are the only required fields of the spec.
- `spec.rootfsMode` carries the same doubled `enum` under an `allOf` that the
  sandbox schema does, and the same `restricted | open | none` network modes.
  The pool schema says in as many words that these are "the same modes as
  SwiftSandbox", so the pool drawer reads their humanized readings from the
  sandbox model rather than restating them.
- The pool status has **no `model` block**, unlike the sandbox: its Model
  section is the spec's two fields only. It does have `observedGeneration`,
  which the sandbox status does not.

### Declared deviations and additions (slice 2)

1. **The pool's Kernel Profile row reads the controller-applied default.** The
   Design section lists "Kernel Profile" under Slot Shape without saying what an
   unset one renders as. It renders `sandbox (default)` as unlinked text, with
   the same tooltip the SwiftSandbox drawer uses, because the pool schema
   documents the same controller-applied default for the same field and the same
   reasoning applies: the schema declares no default, so a guessed namespace
   would be a dead link. The two constants moved from the sandbox drawer to the
   sandbox model so both drawers say it in one place.
2. **Three rows the Design section did not name.** The Rootfs section opens with
   a **Shared By** row stating that the rootfs is materialized once per node and
   shared by every slot of the image — the spec asks for that fact "in the
   section's first row", and it is what makes a single size correct for a pool
   of N slots. The GPU section's line of sizing context is a **Sizing** row
   rather than a tooltip, for the same reason: a fact an operator cannot recover
   from the numbers should not be reachable only by hovering (DESIGN.md section
   7). The Slot Shape section's CPU and Memory rows carry a tooltip saying the
   values are per slot, which is the whole point of the section's name.
3. **`getMinWarm` does not apply the schema's default of 1.** The schema
   defaults `minWarm` to `1`, but the default is applied by the API server, so
   an object that reached this extension always carries it and one that did not
   is better reported as absent than as an invented `1`. This is the stance the
   SwiftSandbox model already takes for its own defaulted fields (`cpu`,
   `rootfsMode`), and it differs from `SwiftGuestPool.getDesiredReplicas`, which
   does default. The M1 model is the outlier; nothing is changed there in this
   slice.
4. **The pool fixtures carry no `gpuProfileRef`, so the pool's GPU section has
   no E2E coverage.** A warm GPU pool is valid and documented, but making
   `e2e-sandbox-pool` one would contradict `e2e-sandbox-pooled`, which has no
   GPU and could then never claim a slot from it — a claiming sandbox must match
   the pool's image and slot shape. The fixture pair that pins the
   pooled-sandbox relationship is worth more than the section's link check, so
   the GPU section is covered by unit tests only. This is the same deliberate
   gap the sandbox's DRA branch has, for the same kind of reason.
5. **The pool fixtures match the pooled sandbox's image and slot shape.** The
   spec's fixture description names only `minWarm`, `maxWarm`, the model and the
   image pull secret. The implementation additionally gives `e2e-sandbox-pool`
   the image (`...sandbox:warm`), CPU and memory `e2e-sandbox-pooled` requests,
   so the pair describes a checkout that could really happen rather than one the
   webhook would reject.
6. **Which rung each pool fixture exercises.** `e2e-sandbox-pool` writes no
   `status.message` and two `True` conditions, so its Status column is the
   newest condition's message (rung 3). `e2e-sandbox-pool-degraded` writes no
   message either and two conditions ordered against each other in time — the
   `True` one newer, the `False` one still the one that matters — so its column
   is **rung 2**, which slice 1 could only unit-test.
7. **The Sandboxes Using This Pool table shows a classifier badge, not a raw
   phase.** The Design section says "Name, Condition and Node", and the
   SPEC-0007 table it reuses shows a raw Phase because SwiftGuest has no
   classifier. SwiftSandbox does, so the column is the same `Badge` the list
   renders, with the classifier's explanation in its tooltip.

No deviation from DESIGN.md was needed in this slice either.

No deviation from DESIGN.md was needed: the two-column Condition + Status
pattern is implemented as written, with the controller's own words in the
Status column, which is what this milestone was expected to be the reference
implementation of.

### Milestone review follow-up (2026-08-29)

The M4 milestone review asked for one change, recorded here because it departs
from what the Design section said when the slices were merged.

1. **The Scratch Disk section's Storage Class row is an existence-checked link,
   not plain text (Roberto's coherence ruling, 2026-08-29).** As merged, the row
   rendered `spec.scratchDisk.blank.storageClassName` as a bare `WithTooltip`
   string. Three other drawers in this extension already render the same field
   as a link — SwiftGuestClass ("Storage Defaults"), SwiftImage ("Import Storage
   Class" and "Clone Storage Class") and SwiftSnapshot ("Captured Guest") — and
   the ruling is that the same row must read the same way in every drawer: a
   StorageClass is a real cluster object, and a reader who can click through to
   it from a snapshot should be able to click through to it from a sandbox.
   The implementation takes the SwiftSnapshot form, which is the strictest of
   the three and the only one that existence-checks: `objectExists(storageClassStore,
   ...)` guarding a `LinkToStorageClass`, degrading to the original plain text
   when the class is gone (DESIGN.md section 3, issue #23). `storageClassStore`
   is cluster-scoped, so it is requested without namespaces, and it joins the
   drawer's **conditional** request list rather than its unconditional part
   (issue #38): only a `blank` scratch disk names a class, so a sandbox with no
   scratch disk, or one attaching an existing PVC, still asks for exactly what
   it asked for before. The E2E link case gained the "Storage Class" label,
   which the fixture's `standard` class — present in every kind cluster — makes
   a resolvable link.

   The two unlinked Storage Class rows the review did **not** change are the
   SwiftGuestClass and SwiftImage ones, which link unconditionally rather than
   existence-checked. Bringing those up to the same check is a separate,
   pre-existing gap and is not part of this milestone.

### The `logTabStore` spike: verdict PASS (2026-08-29)

The spec gated this milestone on proving live, before the drawer was wired, that
`Renderer.Component.logTabStore.createPodTab` works from an extension context —
it is a documented export of the renderer extension API that no freelensapp
extension had used before. A throwaway Playwright harness was run against a real
packed Freelens with the extension installed and the E2E fixture cluster
connected, and evaluated inside the cluster frame:

```text
{"hasGlobal":true,"hasRenderer":true,"hasComponent":true,"hasLogTabStore":true,
 "createPodTabType":"function","hasPodsStore":true,"podFound":true,
 "containers":["launcher","sandbox-materialize"],
 "tabId":"log-tab-8b2b30f9-6c78-4237-bf87-6d90bff8445e"}
```

The host's dock then read `Pod e2e-sandbox-running-launcher` as a tab title,
with `Namespace kubeswift-e2e / Pod e2e-sandbox-running-launcher / Container
launcher` and a container selector inside it. Three things are settled by that
output:

- the call is reachable and returns a real tab id, so the affordance ships as
  designed and the fallback (the `LinkToPod` row alone) is not needed;
- `getAllContainers()` really does report the init container next to the
  launcher, so the `sandbox-materialize` logs are one container switch away
  inside the tab the button opens — the half of the feasibility question the
  roadmap cared about;
- the container the tab opens on is the annotated one, which is what the
  reimplemented `findDefaultContainer` decides.

The harness was deleted once the verdict was recorded; what keeps it proven is
the permanent E2E case "opens the launcher pod's logs from the SwiftSandbox
drawer".

### Upstream recon (2026-08-29)

Per PROCESS.md's upstream drift watch, at the start of the milestone:

- The latest KubeSwift release is still **v0.13.12** (2026-08-24), the version
  M1, M2 and M3 were written against.
- `main` is the same 13 commits ahead of the tag that SPEC-0007 recorded
  (eleven dependency bumps and two documentation commits); nothing has landed
  upstream since that recon.
- **Both sandbox CRD manifests at `main` are byte-identical to the ones at tag
  `v0.13.12`**, verified by diff. No drift, no issue to file, and the E2E
  version pin in `e2e/scripts/lib.sh` stays as it is.
- The sandbox domain has never been analysed in depth by this project before,
  so the CHANGELOG was read end to end for it rather than only since the last
  milestone. `sandbox.kubeswift.io` did not appear in one release: it grew
  across v0.13.x, and three of those steps are what the schema now shows —
  v0.13.1 added the gateway's `/sandbox-logs` and `/sandbox-exec` WebSocket
  planes (a gateway-only release: no CRD change), an earlier v0.13.x step added
  `rootfsMode: virtiofs`, `verifyKeySecretRef`, `scratchDisk`,
  `imagePullSecret` and honoured `workingDir` on the cold path, and another
  added the GPU story (`gpuResourceClaim` and `gpuProfileRef` on the sandbox,
  `gpuProfileRef` on the pool) together with `model` preload on both kinds. The
  same release retired the gateway's dedicated `SandboxService` in favour of
  the generic Explorer, which is why kubeswift-ui has no sandbox route today.

### Schema facts that drive the design

- **SwiftSandbox**: `sandbox.kubeswift.io/v1alpha1`, namespaced, short name
  `sbox`, plural `swiftsandboxes`, printer columns Phase / Image / Node / IP /
  Age, `subresources: {status: {}}`. `spec.required` is `image` and `memory`
  only (`memory` is required *and* defaulted to `512Mi`, so the API server
  fills it). Defaults in the schema: `cpu: 1`, `memory: 512Mi`,
  `rootfsMode: block`, `network.mode: restricted`, `model.mountPath: /model`,
  `scratchDisk.blank.volumeMode: Block`, `gpuResourceClaim.tier: pcie`. Enums:
  `rootfsMode`, `network.mode`, `scratchDisk.blank.volumeMode`,
  `gpuResourceClaim.tier`, and `status.phase`. `spec.env` is the full core
  `EnvVar` shape including `valueFrom` with all five sources. Status blocks:
  `phase`, `message`, `conditions[]`, `nodeName`, `podRef`, `exitCode`,
  `startedAt`, `terminalAt`, `rootfs`, `runtime`, `network`, `model`,
  `scratchDisk`, `gpu`. There is **no** `observedGeneration` in the sandbox
  status.
- **SwiftSandboxPool**: same group and version, namespaced, short name
  `sboxpool`, plural `swiftsandboxpools`, printer columns Image / MinWarm /
  Warm / Claimed / Phase / Age, and **two** subresources: `status: {}` and
  `scale` (`specReplicasPath: .spec.minWarm`,
  `statusReplicasPath: .status.warmReplicas`,
  `labelSelectorPath: .status.selector`). It is the first KubeSwift CRD this
  extension models that declares `scale`. `spec.required` is again `image` and
  `memory`. Status blocks: `phase`, `message`, `conditions[]`, `warmReplicas`,
  `claimedReplicas`, `observedGeneration`, `rootfs`, `imageEnv[]`, `selector`.
- **`status.podRef` is a plain string on SwiftSandbox** ("the launcher pod
  name"), where SwiftGuest's `status.podRef` is a full core `ObjectReference`.
  The shared `ObjectReference` type in `api/kubeswift/types.ts` therefore does
  **not** apply here, and the sandbox model must not reuse it. This is the kind
  of near-miss that produces an `undefined.name` at runtime, so it is called
  out rather than left to be discovered.
- **Neither CRD declares a single `x-kubernetes-validations` rule.** Every
  documented constraint is webhook-enforced; the design section says what the
  views do about it.

### Sandbox logs: the feasibility verdict in full

The roadmap asked whether sandbox logs can be read via the launcher pod. The
answer is **yes for the diagnostic logs, no for the workload console**, and the
two halves land in different milestones.

What makes it a split rather than a yes or a no is how the sandbox emits
output. The guest's console is written **to a file inside the launcher pod**
(the changelog calls it the "sandbox serial-to-file" behaviour, and describes
the gateway's `/sandbox-logs` plane as tailing "the microVM console log" with
`tail -F`). It does not go to the launcher container's stdout. So:

- **In scope, M4.** `kubectl logs` on the launcher pod — which is what the
  host's log dock shows — yields the launcher's own output and, via the same
  tab's container switch, the `sandbox-materialize` init container's. That is
  the pull, the cosign verification and the extract: precisely what
  `docs/sandbox/overview.md`'s troubleshooting section sends operators to read
  when a sandbox is stuck `Materializing` or went `Failed`. It needs no new
  streaming code, no gateway, and no permission the user does not already have.
  Designed above.
- **Deferred to M7.** The workload console needs a `pods/exec` stream
  (`tail -F` on that file), which is the same machinery as the sandbox shell —
  and the roadmap already puts "Sandbox exec" in M7 with "feasibility study
  required". Building a streaming exec client inside a read-only milestone
  would be the wrong shape of change, and building it twice would be worse.
  The lead for that study, found while writing this spec and recorded so it is
  not re-derived: the renderer extension API exports `createTerminalTab` and
  `terminalStore.sendCommand`, so a Freelens terminal tab driven with the
  user's own kubectl is a plausible path for both the console tail and the
  shell, with no gateway and no AGPL surface involved.

The honest framing for the UI, and the reason the M4 affordance is labelled
"View logs" on the **Launcher Pod** row rather than "Sandbox logs" anywhere: it
is not the same thing upstream's Logs button shows, and naming it after the pod
is what keeps that clear. The roadmap row is updated to say so too.

### Docs versus schema discrepancies

Recorded for upstream feedback, as SPEC-0002, SPEC-0004 and SPEC-0007 did. In
every case the schema wins.

1. **The scratch-disk `volumeMode` contradicts itself inside one file.** The
   `scratchDisk.blank` description states "VolumeMode must be Block (Filesystem
   is not supported for sandbox scratch disks in v1)", while the `volumeMode`
   field nested inside that same block declares `enum: [Block, Filesystem]` and
   describes Filesystem as a supported escape hatch for Block-incapable
   clusters. `docs/sandbox/scratch-disks.md` repeats the Block-only claim. The
   views render whatever the object carries and do not badge `Filesystem` as
   invalid.
2. `docs/crds.md`'s SwiftSandboxPool status table omits `rootfs.sizeBytes`,
   which the schema does define on the pool exactly as it does on the sandbox.
   The pool drawer shows it.
3. `docs/crds.md` and `docs/sandbox/overview.md` document
   `kernelProfileRef` as defaulting to the `sandbox` kernel, but the schema
   declares no default for it (the `name` field carries the `""` boilerplate
   default of every `LocalObjectReference`). The default is controller-applied,
   which is why the drawer shows it as an unlinked "sandbox (default)".
4. `maxWarm` is described two ways: `docs/crds.md` and the schema say `0` means
   no cap beyond `minWarm`, while `docs/sandbox/warm-pool.md` says the
   effective cap is `max(maxWarm, minWarm)`. The two are reconcilable but not
   obviously the same statement. The drawer renders the field and the sentinel,
   and does not compute an effective cap it cannot verify.
5. The condition types (`Resolved`, `RootfsReady`, `GuestRunning`,
   `GPUAllocated`, `ScratchDiskReady`; `Resolved`, `Warm`) exist only in the
   docs — the schema constrains conditions to the generic `metav1.Condition`
   shape. The message selector deliberately keys on none of them.
6. `status.runtime.hypervisor` is documented, and described in the schema, as
   "always cloud-hypervisor for a sandbox", yet `gpuResourceClaim.tier` accepts
   `hgx-shared` and `hgx-full`, which the same schema says resolve to QEMU, and
   `status.gpu.hypervisor` is a separate field whose description admits both
   values. The drawer shows both fields as they arrive rather than asserting
   either claim.
7. `spec.gpuResourceClaim` is never expanded field by field in the docs; the
   schema is the only source for `hugepages`, `requestName`,
   `resourceClaimName`, `resourceClaimTemplateName` and `tier`.
8. Neither doc mentions that the pool has a `scale` subresource in the same
   breath as its `status` one; it is stated only in the warm-pool page's
   `kubectl scale` example.

### Domain facts recorded, deliberately not encoded in the UI

- **The whole spec is immutable after create, except `ttl`.** It is a strong
  fact for M6's forms (an "edit sandbox" screen is nearly meaningless) and
  irrelevant to M4's read-only views, which is why no row is badged
  "immutable": that would be 20 badges saying the same thing.
- **A pooled sandbox that boots cold is not an error.** The checkout falls back
  automatically, and upstream emits a `CheckedOut` or `PoolColdFallback` event
  to say which happened. Events are core Kubernetes objects Freelens already
  renders, so the drawer does not restate them; the Pool row's tooltip carries
  the rule so the fallback is not misread as a failure.
- **Consume-and-replenish**: a claimed slot is never returned to the pool. This
  is why `claimedReplicas` can exceed nothing in particular and why warm plus
  claimed is not a conserved total — worth knowing before anyone adds a
  "utilization" bar in a later milestone.
- **Restricted networking is enforced by in-pod iptables, not by a
  NetworkPolicy** (a policy blocking cluster egress would also cut swiftletd's
  own status reporting, since VM traffic and swiftletd share the pod IP after
  MASQUERADE). The Network Mode row's tooltip states what each mode allows and
  does not promise a NetworkPolicy the user could go and inspect.
- **`status.gpu.partitionId == -1` means "no partition"**, the same sentinel
  SwiftGuest carries and SPEC-0001 already handles.

### Durations

`spec.timeout` and `spec.ttl` are plain strings in the schema (Go duration
syntax, e.g. `30m`), with no `format` and no pattern. They are rendered raw,
with the semantics in the tooltip, rather than parsed: a parser would have to
be written for a value that is already human-readable in every documented
example, and a wrong parse of a run cap is worse than no parse. The derived
**Duration** row is a different thing — it is computed from two RFC3339
timestamps the status reports, which is arithmetic the extension can do
correctly — and it goes through `ReactiveDuration`, never through a hand-rolled
formatter.

`status.rootfs.sizeBytes` on both kinds is an int64 **byte** count, so it goes
through `formatBytes`. There is no MiB field in either schema, so
`formatMebibytes` (SPEC-0007) is not needed here.

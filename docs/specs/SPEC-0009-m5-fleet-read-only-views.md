# SPEC-0009: Read-only fleet views (M5)

- **Status:** Approved (Roberto, 2026-08-29, in chat)
- **Milestone:** M5
- **KubeSwift version reviewed:** `v0.13.12`
- **Author / date:** Claude with Roberto, 2026-08-29

## Goal

An operator connected to a KubeSwift **hub** sees the member clusters the
kubeswift-gateway federates: which ones are registered, whether the gateway
holds a healthy client for each, whether the member's API server answers,
what Kubernetes version it runs, how many SwiftGuests it held at the last
sync, which credential Secret joins it, and whether its telemetry endpoint
was configured, discovered, or never resolved. When a member is down, the
reason the gateway recorded is in the list, not two clicks away.

## Upstream reference

kubeswift-ui (v0.12.3) has **no Cluster management screen at all**. Its
`/fleet` route is a cross-cluster *VM inventory*: a cluster selector built
from `displayName || name` plus a Ready flag, a per-cluster error list, and
one table of guests aggregated across every member. There is no
`cluster-drawer`, no `clusters` list, and no create-cluster wizard next to
the twenty-five `create-*` wizards it does ship. That screen is the multi-cluster
fleet aggregation UI the roadmap excludes from v1 (Freelens is inherently
multi-cluster), and it is gateway-only besides, so it is not what this
milestone builds.

The reference for this spec is therefore the schema and `kubectl`, more
completely than in any previous milestone:

- `config/crd/bases/fleet.kubeswift.io_clusters.yaml` at tag `v0.13.12` —
  the authoritative and, for the status, nearly the only source.
- `docs/ui/gateway.md` — what a member is, how it is joined, what the
  gateway writes back, and the `kubectl -n kubeswift-system get clusters`
  sample output whose columns match the CRD's printer columns exactly.
- `docs/crds.md` (the Cluster entry) and `docs/architecture.md` (the API
  group table).
- `proto/kubeswift/v1/cluster.proto` — read only to establish what the
  gateway adds on top of the CRD, which is what the "Gateway-only
  information" note below excludes.

Visual and domain reference only; no code copying (AGPL boundary, see
ARCHITECTURE.md). M4 was the first milestone where the upstream UI was a
weaker reference than the schema; M5 is the first where it is **not a
reference at all**.

## Scope

Included: the typed model (full schema), the list page, the detail drawer,
a new sidebar group, the repository's fourth status classifier, the
extraction of the shared condition-message ladder M4 introduced, unit tests,
and E2E fixtures plus assertions for **Cluster** (`fleet.kubeswift.io`,
short name `ksc`, namespaced).

Excluded:

- **Cross-cluster aggregation of any kind** (a fleet-wide guest inventory,
  fleet-wide counts, a cluster switcher): the roadmap's "Out of scope for
  v1" entry, and gateway-only besides. Freelens already federates clusters
  by connecting to them; see "Gateway-only information" in the Notes for the
  full list of what that excludes and why.
- **Registering, editing, unregistering or otherwise writing a member**
  (M6 forms and actions). Joining a member is a two-object operation (a
  Secret holding a credential, then a Cluster naming it) that the upstream
  chart already automates through `federation.role=edge`; a create form for
  it needs its own spec and its own thinking about where the credential
  comes from.
- **Reading the credential Secret's contents.** The extension resolves
  `spec.credentialSecretRef` to a link and stops there. See "The credential
  Secret is named, never read" below; this is a stance, not an omission.
- **Querying the member's Prometheus.** The endpoint is displayed as the
  fact it is. See "Gateway-only information".
- The CRD-absent probing panel of DESIGN.md section 6, which stays the
  cross-cutting retrofit of gap #6 rather than being invented per milestone.

Columns and sections below are a starting point: the implementation verifies
every field against the CRD schema (the schema wins over this spec and over
`docs/crds.md`, which for this CRD is wrong on two counts) and records
deviations in this file.

## Design

Common: one model file in `src/renderer/api/kubeswift/`, statics pattern
(no instance methods), full spec/status typed from the schema,
`NamespaceScopedMetadata` (the SPEC-0007 slice-1 rule for new namespaced
models), a page and a drawer following the M1-M4 files, `"N/A"` fallbacks in
lists, and values the schema declares without an `enum` typed as plain
strings so an unexpected value from a cluster cannot break a view.

Four properties of this CRD shape everything below, and three of them are
unlike anything the extension has modelled so far:

- **There is no `phase`.** Every KubeSwift CRD this extension has classified
  so far reports a phase, whether enum-constrained (M4) or free (M1/M2), or
  reports nothing at all (SwiftGPUProfile). This one reports **conditions
  only**: `Ready`, `Reachable` and `PrometheusEndpointResolved`. The
  classifier is therefore the first in this repository that reads conditions
  rather than a phase string, and the first whose verdict can disagree with
  itself (a `Ready` that is True next to a `Reachable` that is False).
- **`Ready` is part of the published API, not of the documentation.** The
  CRD manifest itself embeds
  `.status.conditions[?(@.type=="Ready")].status` as a printer-column
  jsonPath. That is a materially stronger contract than the sandbox
  condition types SPEC-0008 refused to key on, which existed only in prose,
  and it is what makes a condition-keyed classifier defensible here. The
  distinction is argued in "Status classification".
- **The reconciler is the gateway, not the controller-manager.** The CRD's
  own description says so in as many words. The chart installs all fifteen
  CRDs unconditionally from `charts/kubeswift/crds/`, while the gateway is
  deployed only for `gateway.enabled=true` or `federation.role=hub`. So on
  the majority of KubeSwift clusters this page exists, is empty, and would
  stay empty even if objects were created: nothing would ever write their
  status. "Empty" and "Unknown" are the **expected** readings of this view,
  not its edge cases, and the design says so out loud rather than treating
  them as failures.
- **The kind is literally `Cluster`.** This is a naming problem before it is
  a rendering problem, and it is handled first.

### The kind is `Cluster`: collisions and how each one is handled

Freelens is an application whose central noun is "cluster". A CRD kind of
`Cluster` therefore collides with the host at several surfaces, and with
other extensions at one more. Each was checked against the host's source
(`freelensapp/freelens`, `main`) rather than assumed:

| Surface | Collides? | Handling |
| --- | --- | --- |
| Sidebar leaf title | **Yes.** Core registers a root sidebar item titled exactly **"Cluster"** (`cluster-overview-sidebar-item.injectable.tsx`), and the catalog outside the cluster frame calls kubeconfig entries "Clusters". A KubeSwift leaf titled "Clusters" would sit a few pixels from both. | The leaf is titled **"Member Clusters"**, the schema's own first words ("Cluster is a member cluster federated by the kubeswift-gateway hub"). Declared deviation, argued below. |
| Sidebar menu id | No. The host renders `data-testid="sidebar-item-<sanitizedExtensionId>-<menuId>"`, so ids are namespaced per extension. | The id is `fleetclusters` anyway, so the E2E and pre-review test ids read unambiguously in failure output. |
| Page id / route | No. Routes are `/extension/<sanitizedExtensionId>/<pageId>` (`getExtensionRoutePath`). | `fleetclusters`, matching the menu id. |
| `kubeObjectDetailItems` | No. The host matches on kind **and** apiVersion (`kubeObjectMatchesToKindAndApiVersion`: `item.kind === kind && apiVersions.includes(item.apiVersion)`). | Registered with `apiVersions: ["fleet.kubeswift.io/v1alpha1"]`, so a Cluster API (`cluster.x-k8s.io`) or a Rancher Fleet (`fleet.cattle.io`) `Cluster` object in the same cluster never receives this drawer, and ours never receives theirs. |
| `getApi()` / `getStore()` | No. `apiManager.getApiByKind` compares `api.kind === kind && api.apiVersionWithGroup === apiVersion`, and `apiVersionWithGroup` carries the group. | Nothing to do, but the model must never acquire a kind-only lookup path. |
| Drawer title | **Yes, and not fixable.** The host writes the title itself as `` `${kind}: ${name}` ``, so the drawer reads **"Cluster: edge-1"**. There is no hook to change it, and DESIGN.md section 4 says the kind stays technical wherever it is a kind. | Accepted, and mitigated from inside the content: the drawer's first `DrawerTitle` is **"Member Cluster"** and its second row states the federation role, so the first two lines under the host's title remove the ambiguity. |
| `tableId` (core's `table_settings` storage) | Possible. Sort preferences are persisted under a **globally keyed** map (`createStorage<TableStorageModel>("table_settings")`), shared by core and every extension. `clustersTable`, the value DESIGN.md section 4's rule would produce, is a plausible id for another extension to pick. | The literal `fleetclustersTable`. Declared deviation, and exactly what the sveltos extension already does (`capiclustersTable`). |
| Another freelensapp extension | **Yes, today.** `freelens-sveltos-extension` already models `cluster.x-k8s.io/v1beta1` `Cluster`, and a Sveltos-managed KubeSwift hub would have both extensions installed. | Nothing to coordinate: the apiVersion guard above keeps the two apart. The precedent is also the answer to the two deviations: sveltos names its class `CapiCluster`, titles it "ClusterAPI Clusters", and uses `capiclustersTable`. This spec is doing what a sibling MIT extension already did when it met the same word. |

Two consequences on names inside the repository, both to keep an English
word from becoming ambiguous in a file that also imports host types:

- The TypeScript class is **`FleetCluster`**, with
  `static readonly kind = "Cluster"`. The kind is what the API says; the
  identifier is ours. `src/renderer/index.tsx` imports fourteen models
  today, and an import named `Cluster` there would shadow the most
  overloaded noun in the host's vocabulary for every future reader.
- The files follow the class, not the plural:
  `api/kubeswift/fleetcluster-v1alpha1.ts`,
  `pages/fleetclusters-page-v1alpha1.tsx`,
  `details/fleetcluster-details-v1alpha1.tsx`,
  `components/fleet-status.ts`.

`crd.plural` stays `clusters` and `crd.shortNames` stays `["ksc"]`: those are
API facts, they feed `apiBase`, and renaming them would be a lie. Only the
display and persistence identifiers are qualified.

### Navigation and sidebar placement

A new group **Fleet** (`kubeswift-fleet`), appended after "Sandboxes" as the
seventh child of the `kubeswift` root, with one resource page under it:

| Menu id | Title | Page id |
| --- | --- | --- |
| `kubeswift-fleet` | Fleet | (group, `target` = `fleetclusters`) |
| `fleetclusters` | Member Clusters | `fleetclusters` |

**A one-leaf group, and why that is right here.** SPEC-0007 rejected an
arrangement precisely because it "would leave a one-leaf GPU group", so this
placement has to answer that objection rather than ignore it. It does,
because the M3 objection was not to one-leaf groups: it was to **splitting a
two-CRD domain across two groups** in order to move one leaf somewhere it
read slightly better. The cost there was the split, and the one-leaf group
was the symptom. Here nothing is split: `fleet.kubeswift.io` contains
exactly one CRD, it is the only CRD of its API group, and no other group
could hold it without misfiling it.

The alternatives were considered and rejected:

- **Hang the leaf directly under the `kubeswift` root**, as a seventh child
  next to six groups. Rejected: DESIGN.md section 4 makes two-level grouping
  the standard and forbids flattening resources under the root, and the
  host's page-top tab bar shows the visible children of the active root
  item, so a bare leaf among six groups would put one resource page in a tab
  bar otherwise made of domains. It would also be the sidebar's only
  exception, which costs every reader a moment of "why is this one
  different".
- **Fold it into an existing group.** There is no candidate. A federated
  member cluster is not a Guest, an Image, a Snapshot, a Migration, a GPU or
  a Sandbox; it is the container all of those live in, one level up.
- **Defer the group until a second fleet CRD exists.** Rejected: DESIGN.md
  section 4 already names Fleet as one of the groups future milestones add
  ("GPU, Sandbox, Fleet"), which is a directive written before this spec and
  not by it. Building the group now costs one entry and means a future fleet
  CRD lands without moving anything a user has learned.

The group's title and its leaf's title differ, so this group has none of the
"Sandboxes inside Sandboxes" repetition M4 had to justify. The kind stays
technical wherever it is a kind (the host's drawer title, YAML, search).

### Cluster: list

Namespaced, so the full column grammar applies:

| Column | id | Source | Notes |
| --- | --- | --- | --- |
| Name | `name` | `metadata.name` | `WithTooltip`, no link |
| Namespace | `namespace` | `metadata.namespace` | `NamespaceSelectBadge` |
| Server | `server` | `spec.server` | printer column; four readings, see below |
| K8s | `k8s` | `status.kubernetesVersion` | printer column |
| Guests | `guests` | `status.guestCount` | printer column; `0` kept, absent is `"N/A"` |
| Condition | `condition` | classifier | `Badge` with the host's status class |
| Status | `status` | condition message | `WithTooltip`, the gateway's own words |
| Age | `age` | `getCreationTimestamp()` | `KubeObjectAge` |

The domain columns are the CRD's printer columns minus **Ready**, which the
Condition/Status pair says better and in more detail, and minus
**Prometheus**. Dropping Ready is the SPEC-0007 rule applied unchanged.
Dropping Prometheus needs no rule of ours at all: the schema marks it
`priority: 1`, which is upstream saying it is a `kubectl get -o wide` column
and not a default one. It is a long URL that would crowd out the version and
the guest count an operator scans a fleet for; it has a section in the drawer.

**The Server cell reads four ways, not two**, the way SPEC-0008's IP cell
reads three. `spec.server` is optional by design, and each reason it can be
absent is a different fact:

1. a value is present: render it, truncated with `WithTooltip` (API server
   URLs are long);
2. absent and `spec.local` is true: **In-cluster** — the gateway federates
   its own cluster through its ServiceAccount and there is no server URL to
   hold, with the tooltip saying so;
3. absent and `spec.credentialSecretRef` names a Secret: **From
   kubeconfig** — the server lives in the Secret's kubeconfig, which this
   extension deliberately does not read (see below), with the tooltip saying
   both halves;
4. absent with neither: `"N/A"`, which is the only one of the four that is
   actually a missing value.

Rendering `"N/A"` for cases 2 and 3 would report a correctly configured
member as incomplete.

**Guests keeps `0`.** The schema says `guestCount` is "omitted until the
gateway has synced the member at least once", so `0` means a synced member
running no VMs and absent means never synced. Collapsing them would hide the
one number that says whether the gateway has ever talked to this member.
This is the `formatBytes` zero rule applied to a count.

`searchFilters` stays `[(object) => object.getSearchFields()]`, unchanged.
The host's `getSearchFields()` covers name, namespace, id and labels;
`spec.displayName` is not in it and is deliberately not added, because
DESIGN.md section 1 allows extending the filters only for data a **column**
shows, and the display name is not a column (see the drawer section for why).

Column widths (DESIGN.md section 8 scale): `server 1.5`, `k8s 0.5`,
`guests 0.5`, `condition 0.7`, `status 1.5`, `age 0.3`.

### Cluster: detail drawer

Sections in order, each self-guarding (a section component returns `null`
when its block is absent, so the drawer reads as a flat declarative list):

1. **Member Cluster** — always rendered; a Cluster object always has a
   federation role and a verdict to report, even when the verdict is
   "nothing has reported on it".
   - **Condition**: the classifier badge, with its explanation as the
     tooltip.
   - **Federation**: **Local (the hub's own cluster)** when `spec.local` is
     true, **Remote member** otherwise. Named rather than left as a boolean:
     this is a topology fact where neither value is healthier, so it is
     deliberately **not** a `BadgeBoolean` — that component's green/red
     encodes health (DESIGN.md section 2, "prefer positive phrasing so green
     means healthy"), and colouring "local" green would invent a meaning.
   - **Display Name** (`spec.displayName`), `hidden` when unset, with a
     tooltip saying it is the label the gateway's own cluster selector shows
     and that the gateway falls back to `metadata.name`. It is not a column:
     the list is keyed on `metadata.name`, which is what `kubectl`, the
     Secret's namespace and every reference use, and a second name column
     that usually repeats the first is noise. It is not in `searchFilters`
     either, for the reason given above.
   - **Server**: the same four readings as the list cell.
   - **Credential Secret**: an existence-checked `LinkToSecret` in the
     object's own namespace when `spec.credentialSecretRef.name` is set,
     degrading to `WithTooltip` plain text when the Secret is not in the
     store. When `spec.local` is true the row instead reads **In-cluster
     ServiceAccount (no credential stored)**: the absence of a Secret on a
     local entry is the design, not a misconfiguration, and a bare `"N/A"`
     would read as the opposite.
   - **Certificate Verification**: a `BadgeBoolean` over
     `!spec.insecureSkipTLSVerify`, so green means the member's API server
     certificate is verified. This is the positive phrasing DESIGN.md
     prescribes (fluxcd's "Resumed" precedent) and the one place in this
     drawer where a boolean genuinely encodes health: the schema calls the
     opposite setting UNSAFE, and its warning is the row's tooltip. A
     read-only view that can surface a fleet-wide trust decision at a glance
     should.
   - **Kubernetes Version** (`status.kubernetesVersion`).
   - **Guests** (`status.guestCount`, `0` kept), with a tooltip carrying the
     "omitted until the first sync" rule **and** the fact that these VMs
     live on the member and are not the ones this Freelens window is showing.
     The value is deliberately **not a link**: linking it would land the
     reader on this cluster's SwiftGuests page, which lists different
     objects. The way to see a member's VMs is to connect Freelens to the
     member — which is the roadmap's whole argument for excluding fleet
     aggregation, made visible at the one place a user would otherwise
     expect a link.
   - **Last Connected**: `<LocaleDate date={...} /> (<ReactiveDuration
     timestamp={...} /> ago)`, the idiom the SwiftGPUNode drawer's "Last
     Discovery" row already uses for the same kind of field.
   - **Observed Generation** (`status.observedGeneration`), `hidden` when
     absent.
2. **Telemetry** — rendered when `spec.prometheusEndpoint`,
   `status.prometheusEndpoint` or the `PrometheusEndpointResolved` condition
   exists; `null` otherwise.
   - **Endpoint**: `status.prometheusEndpoint`, the effective value the
     gateway resolved.
   - **Configured Endpoint**: `spec.prometheusEndpoint`, `hidden` when
     unset, so an operator can see at a glance whether the effective value
     was theirs or discovered.
   - **Resolution**: the `PrometheusEndpointResolved` condition's `reason`,
     humanized for the four documented values (`Explicit`, `Discovered`,
     `NotFound`, `DiscoveryError`) and passed through raw for anything else,
     with the condition's `message` in the tooltip.
   - **One line of context**, as a row rather than a tooltip (the DESIGN.md
     section 7 rule SPEC-0008 applied to the pool's GPU sizing): this
     endpoint is queried by the **gateway**, for the per-VM telemetry of its
     own UI, and never by this extension or by Freelens. Without that
     sentence an empty Telemetry section reads as a Freelens metrics
     problem, which is a different subsystem entirely.
3. `KubeObjectConditionsDrawer`, as the ten M1-M4 drawers whose CRDs report
   conditions already do (the other four — SwiftGuestClass, SwiftSeedProfile,
   SwiftGPUProfile and SwiftGPUNode — have none to draw). It is where `Ready`,
   `Reachable` and `PrometheusEndpointResolved` appear in full with their
   reasons and transition times, and it is why no section above restates a
   condition's raw fields.

The host's generic `.CustomResourceDetails` block will repeat Server, Ready,
K8s, Guests and Prometheus as plain rows above our sections. That
duplication is accepted and our sections stay complete (DESIGN.md section 3,
issue #52): nothing is trimmed to dodge it and nothing is hidden with CSS.

**The credential Secret is named, never read.** `secretsStore` would let the
drawer fetch the Secret and resolve the server URL, the CA and the token out
of the member's kubeconfig, and one of those would even improve the Server
row. It is not done, and this is a stance rather than an oversight:
`docs/ui/gateway.md` calls the hub "the fleet's blast radius" because it
holds a credential to every member, and an extension that pulls those
credentials into a renderer process to pretty-print a hostname would be
widening exactly that radius for a cosmetic gain. The row shows the Secret's
name and links to it; a reader who needs the contents opens the Secret in
Freelens, where the host's own reveal affordance and the user's own RBAC
apply.

### Status classification

A pure module `src/renderer/components/fleet-status.ts`, no JSX and no
colours inside, exporting one classifier and one message selector — the
fourth classifier of this repository (after `gpu-status`, `classifySandbox`
and `classifySandboxPool`) and the first that reads conditions instead of a
phase.

`classifyFleetCluster`, evaluated in this order:

| State | When | Class |
| --- | --- | --- |
| `Ready` | the `Ready` condition is `"True"` | `success` |
| `Unreachable` | not Ready, and the `Reachable` condition is `"False"` | `error` |
| `Not Ready` | not Ready, not unreachable, and `Ready` is `"False"` | `warning` |
| `Unknown` | anything else, including no conditions at all | `info` |

Four judgement calls, all recorded for the milestone review:

- **The classifier keys on condition types, which SPEC-0008 refused to do.**
  The refusal there was correct and this is not a reversal of it: the sandbox
  condition types exist only in `docs/sandbox/overview.md`, so a selector
  keyed on them would have gone silently blank the day a sixth was added.
  `Ready` here is embedded in the **CRD manifest**, as the jsonPath of a
  printer column that `kubectl get clusters` prints for every user. A type
  the API publishes as a column is a contract; a type a Markdown file
  mentions is not. `Reachable` sits between the two — a Go constant with a
  documented meaning, no manifest standing — so it is read only to
  *refine* a failure that `Ready` has already established, never to produce
  a verdict on its own. Nothing in the classifier depends on
  `PrometheusEndpointResolved`.
- **A `Ready: True` next to a `Reachable: False` is shown as Ready.** The
  two conditions can contradict each other, and the honest response to a
  contradiction is to show both facts rather than invent a third state (the
  SPEC-0008 exit-code stance). The badge follows the condition the API
  publishes as a column, and the Status column then carries the
  `Reachable: False` message, because the message ladder's second rung
  prefers a condition that is reporting a problem. The two columns
  disagreeing is the correct rendering of an object that disagrees with
  itself.
- **`Not Ready` is `warning`, while `Unreachable` is `error`.** The two
  failures are different in kind. Unreachable means the member's API server
  did not answer a probe: an operator has to act, and the cause is outside
  the gateway. `Ready: False` on a member that *is* reachable covers both a
  normal few seconds while the gateway builds its client and syncs its
  informer cache, and a permanent RBAC or credential problem — and the API
  gives no vocabulary to tell them apart, since the condition `reason`
  strings are not in the schema. Colouring an ordinary post-registration
  window red would be crying wolf, so the ambiguous case takes the
  ambiguous colour and the condition's own message, which the Status column
  shows, carries the detail. The rejected alternative (`error`, on the
  grounds that a not-Ready member is out of the fleet either way) is
  recorded here so that it can be revisited cheaply: if a real gateway is
  observed writing a stable reason vocabulary, the classifier gains cases
  and tests rather than a re-argument.
- **`Unknown` is the resting state, and its explanation says so.** With no
  conditions at all, the explanation is that no gateway has reported on this
  member yet — **not** "pending". On any cluster where KubeSwift is
  installed but the gateway is not (`federation.role: standalone`, the chart
  default), that is permanent and correct, and a word like "pending" would
  promise a transition that will never come. A `Ready` condition whose
  status is neither `True` nor `False` (the `metav1` enum allows `Unknown`,
  and a future controller could write something else) lands in the same
  state with a different explanation, which is the same
  unrecognized-value stance every classifier in this repository takes.

**The message selector** is the M4 ladder, reused rather than rewritten, and
this milestone is what turns it into a shared component:

- `conditionMessage`, its `ConditionFacts` input shape and the two private
  helpers behind it (`newestCondition`, `transitionTime`) **move out of
  `sandbox-status.ts` into a new `src/renderer/components/condition-message.ts`**.
  `sandbox-status.ts` imports them, and its `SandboxStatusFacts` /
  `SandboxPoolStatusFacts` interfaces reuse `ConditionFacts` instead of
  declaring their own. No behaviour changes; the `conditionMessage` unit
  cases move with it into `condition-message.test.ts`.
- `fleetClusterMessage(status)` is then two lines:
  `conditionMessage(status) ?? classifyFleetCluster(status).explanation`.

The move is worth its diff because the ladder is now proven across two CRD
families with different shapes, and because importing a function called
`conditionMessage` from a module called `sandbox-status` into a fleet drawer
would be the kind of name that outlives its excuse. It also validates the
M4 design: the fleet status has **no top-level `message` field at all**, so
the ladder's first rung is structurally absent and the selector degrades to
rungs 2-4 with no code change, because it was written keyed on no condition
type and with an optional `message`.

The module keeps the SPEC-0007 contract: a pure function from a structurally
declared status to `{ state, className, explanation }`, no dates formatted
inside, and unit tests that need no host global.

### References and reference loading

The schema declares exactly one reference: `spec.credentialSecretRef`, a
`LocalObjectReference` (an optional `name` and nothing else — there is no
`namespace` field, whatever `docs/crds.md` calls the type), so it is
namespace-local by construction.

| Drawer | Store | Namespaces | Lookups |
| --- | --- | --- | --- |
| Cluster | `secretsStore` | the object's own namespace | `spec.credentialSecretRef.name` |

This is the smallest reference table in the extension, and the request is
still assembled **conditionally**: a `spec.local` entry names no Secret and
therefore issues no request at all (DESIGN.md section 3, issue #38). The
link is existence-checked with `objectExists(secretsStore, name, namespace)`
and degrades to `WithTooltip` plain text otherwise — a normal outcome here,
since a hub operator's RBAC may let them list Clusters without listing the
credential Secrets next to them.

Nothing else on this CRD is a reference. `status.prometheusEndpoint` is a
URL, not an object ref; `status.kubernetesVersion` is a string; `guestCount`
counts objects in a different cluster that this Freelens window cannot
address at all.

### Reach into the existing views

None, in either direction. No M1-M4 CRD references a fleet Cluster, and a
fleet Cluster references only a core Secret, which the host has always
rendered. M4 could say the same about its inbound direction; M5 is the first
milestone that is genuinely isolated on both, which is why it is a
single-slice milestone with no ordering constraint inside it.

### Non-happy states

- **Loading**: the `KubeObjectListLayout` spinner, unchanged.
- **Empty list**: delegated to the layout (`NoItems`), and **the expected
  state for most users**, more so than the Sandboxes page. Three different
  situations produce it, and the milestone review checks that the host's
  empty state reads acceptably for all three: the cluster is not a hub (the
  chart installs the CRD everywhere, so the page exists on every KubeSwift
  cluster); the cluster is a hub but the namespace filter does not include
  the KubeSwift system namespace, which is where Cluster objects live and
  which is never the `default` namespace a freshly connected Freelens
  selects (the trap TESTING.md already documents for the E2E suite); or the
  hub genuinely has no members registered yet. TRY-IT.md's checklist gains
  the reading so a reviewer is not left guessing which of the three they are
  looking at.
- **Render error**: page and drawer wrapped in `withErrorPage`.
- **CRDs not installed**: unchanged from M1-M4 (DESIGN.md section 11 gap #6,
  cross-cutting).
- **Absent references**: the credential Secret degrades to plain text; a
  `spec.local` entry has no Secret row to degrade.
- **Status never written**: the `Unknown` badge, the classifier's
  explanation in the Status column, and `"N/A"` in K8s and Guests. This is
  the only view in the extension where that combination is a correct
  steady state rather than a symptom, and it has its own E2E fixture for
  exactly that reason.

### DESIGN.md conformance

Column grammar, `NamespaceSelectBadge` for the namespace cell, a React `key`
on every cell, single-line cells with truncation plus tooltip, explicit
column ids, per-column `className` and widths in the page SCSS module, no
hardcoded colours, both themes checked before the PR.

**Two declared deviations, both from DESIGN.md section 4, both caused by the
same fact (the kind is a colliding English word), and both to be written
into DESIGN.md section 4 by the implementation PR** (section 10: a deviation
either updates DESIGN.md in the same PR as the code or is dropped):

1. **The navigation title is not the plain humanization of the kind.**
   Section 4's rule is Title Case with spaces, dropping the redundant
   "Swift" prefix, "because the KubeSwift root already gives the context".
   Here the kind carries no prefix to drop and the root does **not** give
   enough context, because the host's own sidebar already contains an item
   titled "Cluster" one level up. Humanizing to "Clusters" would produce the
   very ambiguity the rule exists to prevent, so the schema's own qualifier
   is added instead: **"Member Clusters"**. The rule and its exception are
   the same rule stated once: *a navigation title says which resource this
   is, in the vocabulary of the sidebar it lives in*. Proposed DESIGN.md
   wording, to be added to section 4: "When the humanized kind would collide
   with a name the host already uses in the same sidebar (`Cluster`,
   `Node`, `Event`, `Service`...), the title is qualified with the
   resource's own domain word taken from its schema, not left ambiguous."
2. **`tableId` is a literal, not derived from `crd.plural`.** Section 4
   makes the `crd` block the single source of truth for the menu title, the
   page header and the `tableId`. The first two still come from it
   (`crd.title`); the third would produce `clustersTable`, which is a
   plausible collision in core's globally keyed `table_settings` storage,
   so the page passes `"fleetclustersTable"`. The alternative considered was
   adding an optional `tableId` to this repository's
   `KubeSwiftKubeObjectCRD`, which keeps the rule literally true; it is
   rejected as machinery built for one call site. The sveltos extension's
   `capiclustersTable` is the precedent for the literal.

Everything else in section 4 holds: one menu leaf for the one API version,
group parents text-only with a `target`, titles from the model.

No deviation from section 2 is needed: this CRD reports conditions and the
two-column Condition + Status pattern is implemented as written, with the
gateway's own words in the Status column.

## Tests (non-regression list)

- **Unit** (`pnpm test:unit`):
  - `src/renderer/api/kubeswift/fleetcluster-v1alpha1.test.ts`:
    construction from a realistic fixture; every helper; the four readings
    of the Server value (present, `local` with no server, a
    `credentialSecretRef` with no server, neither); a `guestCount` of `0`
    kept distinct from an absent one; `spec.local` true with no
    `credentialSecretRef`; an object with **no `spec` at all** (every field
    of the spec is optional, so the API server accepts one); and an object
    with no status at all.
  - `src/renderer/components/fleet-status.test.ts`: one case per row of the
    classifier table; the `Ready: True` next to `Reachable: False`
    contradiction resolving to Ready; a `Ready` condition whose status is
    `Unknown`; a status with conditions of types this extension has never
    heard of and no `Ready` among them; an empty `conditions` array; no
    status at all (the "no gateway has reported" explanation); and
    `fleetClusterMessage` falling through to the classifier explanation when
    no condition carries a message.
  - `src/renderer/components/condition-message.test.ts`: the
    `conditionMessage` cases moved from `sandbox-status.test.ts` unchanged
    (each rung of the ladder, the newer non-`True` condition winning over a
    newer `True` one, the empty-message condition being skipped, an unknown
    condition type being selected on its merits), plus one new case for a
    status object that has **no `message` property at all**, which is the
    shape this CRD gives it and the reason the extraction is safe.
  - `src/renderer/components/sandbox-status.test.ts`: keeps the two
    classifiers, loses the `conditionMessage` block, and must stay green
    unchanged otherwise — that it does is the non-regression proof of the
    extraction.
- **Integration**: unchanged (the harness keeps asserting install, listing
  as enabled, and activation without errors).
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), two new cases, each also
  asserting `headerCellsWithoutId(frame)` is empty for the view it opens:
  - "lists the fleet Clusters with their server, version and condition": the
    healthy remote member (server, `v1.34.3`, 7 guests, the Ready badge),
    the local hub entry (the **In-cluster** server reading and a `guestCount`
    of `0` rendered as `0` and not as `"N/A"`), the unreachable one (the
    Unreachable badge in the `error` class, the gateway's dial-timeout
    message in the Status column, `"N/A"` in K8s and Guests, and the **From
    kubeconfig** server reading), and the never-reconciled one (the Unknown
    badge and the classifier's "no gateway has reported" explanation). The
    badge classes are read the way the M4 case reads them, by the class the
    classifier passes rather than by a `.Badge` selector.
  - "opens a fleet Cluster drawer and links its credential Secret": the
    remote member's drawer, asserting the Member Cluster section (Federation
    "Remote member", Certificate Verification, Kubernetes Version, Guests,
    Last Connected) and the Telemetry section's Resolution row reading
    "Explicit"; the credential Secret row as a live link checked with the
    pre-review link helper; and, as the counter-assert every link case in
    this suite carries, the unreachable member's credential Secret row —
    which names a Secret that does not exist — staying plain text.
- **Fixtures and status injection** (`e2e/fixtures/`, numbering continued):
  - The CRD is already applied by `cluster-up.sh`: `KUBESWIFT_CRD_FILES`
    lists all fifteen upstream CRDs, and `fleet.kubeswift.io_clusters.yaml`
    is its first entry, so M5 needs no change there — only fixtures. The
    comment above that array, which says fleet's Cluster is "the last one
    still waiting for its milestone", is updated.
  - `145-fleet-references.yaml`: one Secret, `e2e-fleet-edge-1-credential`,
    in the fixture namespace, so the drawer's Secret row resolves to a link.
    It carries **no credential-shaped data at all** (an empty `data: {}`
    and a comment saying why): the extension never reads the contents, so
    the fixture only has to exist, and a repository that ships an MIT
    extension has no business carrying a plausible-looking kubeconfig or
    token in its test data. This is the `125-sandbox-references.yaml`
    pattern, with a stricter rule about what goes inside.
  - `150-fleet-clusters.yaml`, four objects so that every branch of the
    classifier and every reading of the Server cell has a row:
    - `e2e-fleet-hub`: `local: true`, a `displayName`, no
      `credentialSecretRef`, no `server`. The In-cluster server reading, the
      "no credential stored" Secret row, and the `guestCount: 0` assert.
    - `e2e-fleet-edge-1`: a remote member with `server`, `displayName`,
      `credentialSecretRef` at the Secret above, and an explicit
      `prometheusEndpoint`. The happy path and the drawer case's subject.
    - `e2e-fleet-edge-down`: a remote member with
      `insecureSkipTLSVerify: true`, **no** `server`, and a
      `credentialSecretRef` naming a Secret that does not exist. It carries
      the From-kubeconfig reading, the unverified-certificate badge, the
      unreachable verdict, and the plain-text counter-assert, all on one
      object.
    - `e2e-fleet-pending`: a remote member with a `server` and a
      `credentialSecretRef`, and **no status patch at all**. It is the
      cheapest fixture in the repository and it pins the state most real
      users will see first.
  - **Status patches for three of the four**
    (`subresources: {status: {}}` is declared on the CRD). The hub gets
    `Ready`/`Reachable` `True`, a `PrometheusEndpointResolved` `True` with
    reason `Discovered`, `kubernetesVersion`, `guestCount: 0`,
    `lastConnected`, `observedGeneration` and a discovered
    `prometheusEndpoint`. `e2e-fleet-edge-1` gets the same conditions with
    reason `Explicit`, `guestCount: 7` and `kubernetesVersion: v1.34.3`.
    `e2e-fleet-edge-down` gets `Reachable: False` carrying the dial-timeout
    text the Status column must show, `Ready: False` with an older
    `lastTransitionTime` than it, a `PrometheusEndpointResolved: False` with
    reason `NotFound`, no `kubernetesVersion` and no `guestCount`. Its two
    conditions are ordered so that the newest non-`True` one is the one an
    operator needs, which is the ladder's second rung exercised end to end
    for a second CRD family.
  - `lib.sh`: three entries in `E2E_STATUS_PATCHES`; assertions in
    `E2E_STATUS_ASSERTIONS` for `e2e-fleet-hub`'s `{.status.guestCount}=0`
    (the readback that keeps a dropped zero from looking like an absent
    value, the M4 degraded-pool assert applied to a different field),
    `e2e-fleet-edge-1`'s `{.status.kubernetesVersion}=v1.34.3` and
    `{.status.guestCount}=7`, and `e2e-fleet-edge-down`'s
    `{.status.conditions[?(@.type=="Reachable")].status}=False` — which is
    deliberately the same jsonPath shape the CRD's own Ready printer column
    uses, so the assert proves the condition-keyed reading the classifier
    depends on. No `E2E_NODE_NAME_FIELDS` entry: this CRD names no node.
  - `fixturesReady()` gains an M5 probe
    (`clusters.fleet.kubeswift.io/e2e-fleet-edge-1`), so a cluster left over
    from an older checkout is reported as not ready instead of failing later
    as a page full of missing rows.
- **Pre-review agent pass** (SPEC-0006, `pnpm pre-review`): one entry in
  `integration/helpers/kubeswift-views.ts`
  (`fleetclusters` / "Member Clusters" / `e2e-fleet-edge-1`), a plain
  literal, taking the pass from 14 views to 15. The pass's existing asserts
  then cover the new view for free: header ids, every drawer link clicked
  and checked for the host's load-failure panel, references rendered as
  links or as text but never as dead links, byte values humanized (this view
  has none, which is itself worth having in the report), the
  conditions-section count (which must be 1, not 2), and both themes. The
  pass runs before the M5 review session and its report is the precondition
  for it (PROCESS.md).
- **Manual verification**: fixture-based rendering needs none. What stays
  manual-only (TESTING.md) is a **real hub with a running
  kubeswift-gateway**, which no fixture can simulate because no controller
  in the E2E cluster writes this status: that a member registered with
  `federation.role=edge` appears and reaches `Ready` on its own; that
  unplugging it flips `Reachable` to `False` with a message the Status
  column renders usefully; that Prometheus auto-discovery lands as
  `PrometheusEndpointResolved` with reason `Discovered` and fills
  `status.prometheusEndpoint`; that `guestCount` tracks the member's real
  SwiftGuests after a sync; and that a hub's self-registered `spec.local`
  entry renders as designed. Record date, tester and result here when it
  happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan. The recon
that produced this spec follows the implementation notes.

### Upstream recon (2026-08-29)

Per PROCESS.md's upstream drift watch, at the start of the milestone:

- The latest KubeSwift release is still **v0.13.12** (2026-08-24), the
  version M1-M4 were written against.
- `main` is the same 13 commits ahead of the tag that SPEC-0007 and
  SPEC-0008 recorded (eleven dependency bumps and two documentation
  commits); nothing has landed upstream since those recons.
- **The fleet CRD manifest at `main` is byte-identical to the one at tag
  `v0.13.12`**, verified by diff. No drift, no issue to file, and the E2E
  version pin in `e2e/scripts/lib.sh` stays as it is.
- The fleet domain has never been analysed by this project before, so the
  CHANGELOG was read end to end for it. Its history is short and, unusually
  for KubeSwift, finished: **the schema has not changed since v0.8.0**
  (2026-07-08), and the manifests at v0.8.0, v0.13.0 and v0.13.12 are
  byte-identical. Three steps produced it:
  - **v0.6.0** (2026-06-25) introduced the kubeswift-gateway and the
    `fleet.kubeswift.io/v1alpha1` Cluster CRD together (#259), with five
    spec fields, five status fields and five printer columns.
  - **v0.8.0** (2026-07-08) made federation near-zero-config (#335): it
    added `spec.local` (so the hub can federate its own cluster through its
    in-cluster ServiceAccount), made `spec.credentialSecretRef` optional as
    a consequence, and added gateway Prometheus auto-discovery, which is
    what `status.prometheusEndpoint`, the `Prometheus` printer column and
    the `PrometheusEndpointResolved` condition exist for. Those two fields
    are the entire diff between v0.6.0 and today.
  - Everything after that is gateway-side or UI-side and left the CRD
    alone: **v0.13.3** fixed `ListClusters`/`WatchClusters` being
    unauthenticated (#434, a real leak of every member's API server URL and
    condition messages to any caller that could reach the port), and
    **v0.13.5** fixed the kubeswift-ui fleet view reporting an unreachable
    member as an empty one. That second one is worth recording even though
    no code of ours is affected: it was a *fan-out* bug, in which a partial
    RPC answer was rendered as a confident empty state. A CRD-native view
    has no fan-out and structurally cannot reproduce it — the list either
    watches the API or does not — which is a small piece of evidence for
    the architecture this extension chose.

### Schema facts that drive the design

- **Cluster**: `fleet.kubeswift.io/v1alpha1`, `Namespaced`, short name
  `ksc`, plural `clusters`, singular `cluster`, listKind `ClusterList`,
  one served and stored version, `subresources: {status: {}}` (no `scale`).
- **Printer columns**: `Server` (`.spec.server`), `Ready`
  (`.status.conditions[?(@.type=="Ready")].status`), `K8s`
  (`.status.kubernetesVersion`), `Guests` (`.status.guestCount`, integer),
  `Prometheus` (`.status.prometheusEndpoint`, **`priority: 1`**, so
  wide-only), `Age`. `docs/ui/gateway.md`'s sample `kubectl` output shows
  exactly the five non-wide ones, which is the confirmation that the
  priority marker behaves as read.
- **`spec` has no required fields at all**, and no `x-kubernetes-validations`
  rule anywhere in the file. Every documented constraint — `local` mutually
  exclusive with `credentialSecretRef`, a credential required for a remote
  member, the Secret carrying either a `kubeconfig` key or a `token` (+
  optional `ca.crt`) — is enforced by the gateway or by nothing. The views
  therefore render an object that breaks those rules rather than assuming
  them: every block guards itself, and the Server cell names which reading
  it is showing instead of inferring one from the absence of another. This
  is the SPEC-0008 stance, and it applies harder here, because an object
  with a completely empty `spec` is a valid object.
- **`spec` fields**: `credentialSecretRef` (a `LocalObjectReference` — an
  optional `name` with the usual `""` default and
  `x-kubernetes-map-type: atomic`, and **no** `namespace`), `displayName`,
  `insecureSkipTLSVerify`, `local`, `prometheusEndpoint`, `server`.
- **`status` fields**: `conditions[]` (the standard `metav1.Condition`
  shape, `required` on `lastTransitionTime`, `message`, `reason`, `status`,
  `type`), `guestCount` (int32), `kubernetesVersion`, `lastConnected`
  (date-time), `observedGeneration` (int64), `prometheusEndpoint`. There is
  **no `phase` and no top-level `message`** — the two fields every previous
  classifier and message selector in this repository started from.
- **The three condition types**, in descending order of how much the API
  guarantees them: `Ready` (in the manifest, as a printer-column jsonPath),
  `Reachable` (a Go constant with a documented meaning, plus a mention in
  the `conditions` field description), `PrometheusEndpointResolved` (a Go
  constant, plus `docs/ui/gateway.md`, plus a reference inside the
  `status.prometheusEndpoint` field description; its four reasons —
  `Explicit`, `Discovered`, `NotFound`, `DiscoveryError` — appear only in
  prose). The classifier's use of each is calibrated to that order.
- **The reconciler is the gateway**, stated twice in the schema, once
  emphatically ("the kubeswift-gateway — NOT the controller-manager — is
  the reconciler for this resource; the controller-manager merely needs the
  type registered for serialization"). The chart nevertheless ships this CRD
  in `charts/kubeswift/crds/` alongside the other fourteen, and Helm applies
  that directory unconditionally, while the gateway is deployed only for
  `gateway.enabled=true` or `federation.role=hub`.

### Gateway-only information, and why it is out of scope

The extension is CRD-native and never talks to the gateway
(ARCHITECTURE.md). For this milestone that boundary is unusually sharp,
because the gateway is this CRD's own controller. What the gateway knows and
this view therefore does not:

1. **The cross-cluster guest inventory.** `GuestService.ListGuests` /
   `WatchGuests` fan out across members and stamp a `cluster` dimension on
   every row; nothing of it is written back to any object. This is the
   kubeswift-ui `/fleet` screen, and it is excluded twice over — by the
   roadmap's "Out of scope for v1" (Freelens federates clusters by
   connecting to them) and by the no-gateway rule.
2. **Per-cluster query errors and the live / degraded / stale state of a
   fan-out.** `ListGuests` is partial-fleet: a failing member yields an
   `errors[]` entry while the RPC still returns OK, and v0.13.5's fix taught
   the UI to keep stale rows and call a partial answer "degraded". Those are
   properties of one RPC response, not of any Kubernetes object, so they
   cannot be read from the API at all. The nearest CRD-visible equivalent is
   the `Reachable` condition, which this view does render.
3. **`ClusterService.ListNodes`.** The gateway can enumerate a member's
   nodes using the member credential. Freelens shows the nodes of the
   cluster it is connected to; enumerating another cluster's nodes would
   need either the gateway or the credential, and the extension uses
   neither.
4. **Per-VM telemetry.** The gateway queries the member's Prometheus and
   joins series on the `swift.kubeswift.io/guest` label. The endpoint is a
   member-side URL that the Freelens process may not even be able to reach,
   Freelens has its own metrics stack, and a second one inside an extension
   would be a different product. The Telemetry section shows the endpoint
   and how it was resolved, and says whose it is.
5. **The credential Secret's contents.** Argued in the Design section: the
   hub is the fleet's blast radius, and a cosmetic gain does not justify
   widening it.
6. **`displayName` as a cluster selector.** It is a label for the gateway
   UI's own switcher. Freelens has a cluster switcher, populated from the
   user's kubeconfig; the two are not the same list and merging them is the
   aggregation UI the roadmap excludes. The field is shown as a fact, in the
   drawer.

The proto file was read only to establish (1)-(3). Its `Cluster` message is
a strict subset of the CRD — `name`, `namespace`, `display_name`, `server`,
`kubernetes_version`, `ready`, `reachable` — which is a useful negative
result: the gateway adds **no field** to what an operator can already read
from the API. Everything it adds is fan-out and transport.

### Docs versus schema discrepancies

Recorded for upstream feedback, as SPEC-0002, SPEC-0004, SPEC-0007 and
SPEC-0008 did. In every case the schema wins. This CRD has the worst
docs-to-schema ratio the project has met so far: the `docs/crds.md` entry is
five rows long, and two of the five are wrong.

1. **`docs/crds.md` says `credentialSecretRef` is "Required".** The schema
   marks nothing in the spec as required, and the field's own description
   says to omit it together with `local: true` for the hub's own cluster.
   v0.8.0's CHANGELOG announced the change explicitly ("`spec.credentialSecretRef`
   is now optional"); the docs table was not updated with it. A view written
   from the docs would render an entire legitimate class of member — the
   self-registered hub, which `federation.role=hub` creates automatically —
   as misconfigured.
2. **`docs/crds.md` types it as a `SecretReference`.** The schema is a
   `LocalObjectReference`: one optional `name`, no `namespace`. A model
   written from the docs would type a `namespace` that never arrives and a
   drawer would resolve the Secret in `undefined`.
3. **`docs/crds.md` omits `spec.local` entirely**, which is the field that
   makes (1) true.
4. **`docs/crds.md` documents no status field whatsoever** for this CRD —
   no conditions, no `guestCount`, no `kubernetesVersion`, no
   `lastConnected`, no `observedGeneration`, no `prometheusEndpoint` —
   although it gives full status detail for the core workload CRDs. Every
   status fact in this spec comes from the schema, from
   `docs/ui/gateway.md`'s `kubectl` sample, or from the printer columns.
   The doc's own preamble explains why (it promises "concise reference
   entries" for the fleet CRD), which makes this a scoping decision rather
   than an oversight — but it means the schema is the only description of
   the half of the object a read-only view is entirely made of.
5. **The condition types exist only outside the schema**, except `Ready`.
   Same class of discrepancy as SPEC-0008's item 5, with the material
   difference that here one of the three is embedded in the manifest as a
   printer-column jsonPath. That difference is load-bearing for this
   milestone and is argued in "Status classification".
6. **Nothing outside the CRD description says the controller-manager does
   not reconcile this CRD.** `docs/crds.md` does not mention it, and
   `docs/architecture.md`'s API-group table lists Cluster next to the
   fourteen CRDs the controller-manager does own. It is the single fact that
   explains why a KubeSwift cluster can hold Cluster objects whose status is
   permanently empty, and it is only in the schema and in
   `docs/ui/gateway.md`.
7. **`docs/ui/gateway.md` promises UI behaviour that is the gateway UI's,
   not an API contract**: "Empty means telemetry is unavailable for this
   member; the UI degrades that panel, it does not fail the view." Recorded
   so the Telemetry section is not mistaken for an implementation of it.

### Domain facts recorded, deliberately not encoded in the UI

- **Cluster objects live in the hub cluster, next to their credential
  Secret** — the Cluster API model, stated in the schema. That is why the
  CRD is namespaced despite describing something as un-namespaced as a
  cluster, and it is why the namespace filter matters more on this page than
  on any other in the extension.
- **The gateway impersonates the end user against each member** (decision
  D1), so a member's RBAC authorizes the person, not the gateway. Where
  members do not share an identity provider this degrades per cluster, which
  the schema calls "documented degradation, surfaced per-cluster". It is a
  gateway-side behaviour with no CRD field, so no row states it; it is
  recorded because it is the reason `insecureSkipTLSVerify` and the
  credential's capabilities matter more here than the fields alone suggest.
- **`federation.role=edge` mints its own join credential** and prints the
  ready-to-apply hub-side Cluster and Secret in its Helm NOTES. This is the
  supported way to register a member, and it is the reason M6's "create
  member" form is a genuine design question rather than an obvious next
  step: the form would compete with a mechanism that already avoids
  hand-crafting an admin kubeconfig.
- **An explicit `spec.prometheusEndpoint` always wins over discovery**, and
  discovery scans only `gateway.prometheusDiscovery.namespaces`. The
  Telemetry section shows both values and the reason, and computes nothing:
  the effective value is the gateway's to decide, and re-deriving it here
  would produce a second opinion, the same stance the pool classifier takes
  toward its counts.
- **Staleness is not computed from `lastConnected`.** The row shows the
  timestamp and its age, but the badge never reads "stale" because the
  gateway already publishes that judgement as `Reachable`. Deriving a
  second one from arithmetic would contradict the controller on exactly the
  objects where it matters.

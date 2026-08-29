# SPEC-0010: Guest actions - start, stop, delete (M6)

- **Status:** Approved (Roberto, 2026-08-29, in chat, with the standing
  directive to outdo the upstream UI where possible; better-than-upstream pass
  folded in before merge); implementation in PR
- **Milestone:** M6 (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12` (schema re-read at `main`, see
  "Upstream recon"); UX reference kubeswift-ui `v0.12.3`
- **Author / date:** Claude with Roberto, 2026-08-29

## Goal

An operator can start and stop a SwiftGuest, and delete one, from inside
Freelens - from the row menu of the Guests list and from the detail drawer's
toolbar, never by hand-editing YAML. Every action states, before it runs,
exactly which objects it will write and what the write is; nothing happens on
a single click; a refused or rejected write is reported instead of failing
silently; and while the controller catches up, the list says so rather than
showing a state that is no longer true.

This is the extension's **first write surface**. Everything shipped through M5
reads. The rules that transition establishes are written here once, for the
whole of M6, and are absorbed into [DESIGN.md](../development/DESIGN.md) by the
implementation PR.

## Upstream reference

- `config/crd/bases/swift.kubeswift.io_swiftguests.yaml` at tag `v0.13.12`,
  re-read against `main` for this spec: the `spec.runPolicy` enum and its long
  field description, the `status.phase` enum, the printer columns, the single
  `x-kubernetes-validations` rule, `subresources: {status: {}}`.
- `internal/controller/swiftguest/`, `internal/actions/`, `cmd/swiftctl/` -
  read to establish what a start and a stop mechanically **are**, since the
  schema alone does not say. This is the first spec in this repository whose
  central question is a controller behaviour rather than a field.
- `docs/swiftctl.md` - the CLI's user-facing verb list. It is **stale** on both
  verbs this spec implements; the discrepancies are recorded below.
- kubeswift-ui `v0.12.3`, `src/app/guest-detail/` - visual and UX reference
  only, for which actions exist, how they are gated, and what is confirmed. No
  string, no component, no mapping logic is taken from it (AGPL boundary, see
  [ARCHITECTURE.md](../development/ARCHITECTURE.md)).

Freelens host references, all MIT and therefore copyable, all read at the
version this repository pins (`v1.10.3`):
`packages/core/src/renderer/components/kube-object-menu/`,
`components/menu/menu.tsx`, `components/confirm-dialog/`,
`components/workloads-cronjobs/cron-job-menu.tsx` (the closest model in core to
what this spec builds), `extensions/renderer-api/components.ts`, and the
sibling extensions listed under "Precedent in the freelensapp extensions".

## Scope

This spec covers **one** of the six M6 rows: guest start, stop and delete. The
other five (creation forms, snapshot/restore dialogs, migration dialog, sandbox
creation) each need their own spec and are untouched here, except that the
ground rules below are written to serve all of them.

Included:

1. **The write-surface ground rules for M6** (section "Ground rules for every
   write"), proposed as a new DESIGN.md section 12 and as one amendment to its
   section 7.
2. **Start** and **Stop** as `kubeObjectMenuItems`, present in both the list row
   menu and the drawer toolbar from one registration, each behind a confirmation
   that names every write it performs.
3. **Delete**: the decision, argued below, that the extension registers **no**
   Delete of its own because the host already renders one for every kind the
   extension registers a store for, plus what the extension adds instead (the
   consequences of a guest deletion, which only KubeSwift knows, surfaced in the
   drawer).
4. **The first SwiftGuest status classifier**, and with it the DESIGN.md section
   2 Condition/Status column pair on the Guests list. This is scoped in, not
   scope creep: a stop is a policy change that the controller resolves later,
   the API has no phase for that interval, and without a derived reading the
   list would show `Running` for a guest the user has just stopped. The
   retrofit of the other nine views (DESIGN.md gap #1) stays open.
5. **Unit and E2E coverage**, including E2E cases that perform **real writes**
   against the disposable kind cluster, and the rule that keeps the pre-review
   pass read-only.
6. **The better-than-upstream pass** the standing directive requires (W11):
   fourteen improvements over what kubeswift-ui and `swiftctl` do with these
   same three verbs, and eight candidates rejected in writing, all listed in
   "Better than upstream". Every one of them serves an action already in scope -
   the audit sharpens the three verbs, it does not add a fourth.

Excluded, with where each one goes instead:

- **Restart** (delete the launcher pod, leave the policy alone). It is a real
  verb - `swiftctl` has it, and it is the only way to bring back a guest that
  exited on its own while still set to run - but it is a third action with its
  own guard (`swiftctl` refuses it on a stopped guest) and its own confirmation,
  and kubeswift-ui does not ship it at all. It gets its own spec, which adds its
  own row to M6 when it is written. The Start guard's tooltip names the two-step
  workaround (Stop, then Start) so the gap is signposted rather than silent.
- **Pause / resume.** They exist in KubeSwift only as internal Cloud Hypervisor
  calls inside the snapshot and migration machinery, with no CRD field, no CLI
  verb and no UI. There is nothing to expose.
- **Console, snapshot-now, clone, migrate.** Other M6 and M7 rows.
- **Editing the guest spec** beyond `runPolicy`. The host's own YAML editor
  (the pencil next to the trash in the drawer toolbar) already does it; a form
  is the "Create SwiftGuest" row's problem.
- **An RBAC pre-flight check.** Argued under ground rule W7.
- **Bulk actions** over the list's checkbox selection. The host owns that
  surface (`removeSelectedItems`); a bulk stop would need a confirmation that
  enumerates writes across many objects, which is a different design.

## Design

### Ground rules for every write (M6 and after)

Eleven rules. They are stated here in full because they are what the milestone
actually decides; the three actions below are their first application. The
implementation PR copies them into DESIGN.md as a new section 12 and amends
section 7's existing forward-looking bullet.

**Standing directive (Roberto, 2026-08-29): parity with kubeswift-ui is the
floor, not the ceiling.** Where the upstream UI is poor, ambiguous, silent or
wrong, and the CRD-native position lets this extension do better for an
operator, it does better and records why. This is W11 below; it binds every
M6 spec, not only this one, and the "Better than upstream" subsection is the
form the answer takes - including the candidates that were considered and
rejected, so the bar is visible rather than implied.

**W1. Every action is behind a confirmation that enumerates its writes.** Not
"are you sure": the dialog names the kind, the namespace and the name, and then
lists one line per API call, with the field path and the value transition for a
patch (`spec.runPolicy: Always -> Stopped`) and the kind and name for a delete.
An action that writes two objects says so on two lines. The user should never
have to know which fields an action touches to predict what it does.

**The dialog quotes live facts, not a render-time snapshot, and lists only the
writes that will actually change something.** It is built when the item is
clicked, from the object as the store holds it at that moment - the same
snapshot the guard is re-evaluated against (W4), so a dialog can never quote a
value the guard did not see. It names the current state the action starts from
(the phase, the policy, the exact name of any secondary object it will touch),
it warns when one of those facts looks stale or unverifiable, and a write that
would be a no-op is dropped from the list rather than shown as
`X -> X`. Where one cheap read makes a fact certain instead of assumed, the
dialog does that read on open (never per row, never on render) and degrades to
a weaker sentence if the read is refused. This is where the extension is most
clearly ahead of kubeswift-ui, which confirms nothing for these two verbs, and
of `swiftctl`, which deletes a pod it never looked at.

This is stricter than kubeswift-ui, which fires Start and Stop immediately and
confirms only Delete, and it is deliberate. In Freelens the same control sits in
a kebab menu one item away from Delete; the extension is CRD-native, so every
action is a real API call the user may not be allowed to make; and Stop writes
two objects of two different kinds. It is also exactly what Freelens core does
with its own state-changing menu items - CronJob suspend/resume and Deployment
restart both open a confirm dialog - so the strict rule is the host-consistent
one.

**W2. No optimistic UI, ever.** The extension never writes into a store to make
the screen say what it hopes the cluster will do. What changes immediately is
what the API server echoed back (`KubeObjectStore.patch` replaces the item with
the server's own object); everything else arrives through the watch. This is
also upstream's stance in its own UI, and it is forced here by a fact about
KubeSwift: a stop changes `spec.runPolicy` and deletes a pod, but `status.phase`
is written by a controller that has not run yet, and there is no `Stopping`
phase for it to write. Faking one in the store would produce a value no
`kubectl` would ever show. The honest alternative is W3.

A corollary the implementation must not "fix": `KubeObjectStore.remove` does
**not** drop the row from `items`; the row disappears when the `DELETED` watch
event arrives, through a reaction debounced by one second
(`kube-object.store.ts`). A deleted object staying visible for up to a second is
the host's behaviour for every kind, and the extension leaves it alone.

**W3. A state the API cannot express is derived, named, and explained.** Where a
write leaves the object in an interval the CRD has no vocabulary for, the
extension's status classifier derives a state from the disagreement between
`spec` and `status`, gives it a name, and explains it in the tooltip. It never
invents a value that could be mistaken for something the controller wrote. For
guests this produces exactly one new state, `Stopping`; see "The transition
reading".

**W4. No dead controls, and no control that lies about being dead.** An action
whose write would change nothing is rendered **disabled with a tooltip that says
why**, not hidden: hiding it makes the menu jump between objects and leaves the
user hunting for a verb they know exists. This follows kubeswift-ui's own
choice, and it is the opposite of the SPEC-0008 rule for the launcher-pod logs
icon (absent when there is no pod), because that was an affordance with no verb
behind it, while these are verbs whose absence would be read as "this guest
cannot be stopped".

Two hard requirements come with it, both from the host's implementation
(verified in `menu.tsx`): core's `MenuItem` accepts `disabled`, but the prop
only adds a class and sets `tabIndex: -1` - the click handler still fires, and
what actually stops the click is the stylesheet's
`.MenuItem.disabled { pointer-events: none }`. So (a) the extension passes
`disabled` for the styling and the pointer-events guard, and (b) **the click
handler re-evaluates the guard before writing anything** and returns without
opening the dialog if it no longer holds. A guard that lives only in CSS is not
a guard on a write surface. The re-evaluation also covers the case the guard was
computed from a stale object.

Exception: when the object carries a `deletionTimestamp`, action items are
absent rather than disabled. A terminating object is not a thing you act on, and
the host's own delete-mode logic already keys on the same field.

Unknown or unparseable state permits the action rather than blocking it: the
guard is a convenience, and the controller and RBAC are the real authority. A
client-side heuristic must never be the reason a user cannot recover an object.

**A guard cannot disable a control without producing the reason.** The guard is
one pure function returning `{ enabled, reason }`, never a bare boolean: a
disabled outcome with an empty reason is impossible to express, and a unit test
asserts exactly that over every input the guard distinguishes. The reason then
has to be reachable in **both** surfaces, which the toolbar makes non-trivial
because it hides the item's title span: it is passed as the host `Icon`'s own
`tooltip`, which the toolbar renders, and the drawer additionally carries the
same sentence in its Condition row explanation, so a user who never hovers
anything still finds it. Upstream's UI disables actions with no explanation at
all, which is the version of this rule that teaches a user nothing.

**W5. One registration, both surfaces.** Actions are `kubeObjectMenuItems`. The
host renders the same registration in the list row kebab
(`kube-object-list-layout.tsx`, `renderItemMenu`, no `toolbar` prop) and in the
detail drawer's toolbar (`kube-object-details.tsx`, `toolbar={true}`), so one
component satisfies "available from both surfaces" and the two can never drift
apart. The component receives exactly `{ object, toolbar }` and uses the host
idiom: `<Icon interactive={toolbar} tooltip={title} />` plus a
`<span className="title">` that the toolbar layout hides.

**W6. The patch type is always explicit, and it is `merge`.** Both host defaults
are wrong here: `KubeApi.patch` defaults to `strategic`, which the API server
rejects for custom resources, and `KubeObjectStore.patch` defaults to `json`,
which would need an RFC 6902 document. Every write in this milestone passes
`"merge"` explicitly, and patches carry only the field they change - never a
read-modify-write of a whole spec, which would clobber a field a controller or
another user wrote between the read and the write.

**W7. No RBAC pre-flight: attempt, then report.** The extension does not grey
out an action because the user might lack permission. `Renderer.K8sApi.isAllowedResource`
keys on a fixed table of built-in resource names and answers permissively for
anything it does not know, so it is useless for CRDs; the only correct check is
a `SelfSubjectAccessReview`, which is itself a write, is not exported to
extensions, and would fire on every render of every row. A 403 arrives as a
clear message from the API server and is shown as one. This is what core does
for its own actions.

**W8. Concurrency is last-write-wins, and the spec says so out loud.** The host
sends no `resourceVersion` on a merge patch and has no 409 handling anywhere in
its write path, so two operators stopping and starting the same guest at the
same time cannot conflict - the second write wins. For a single enum field whose
transition the dialog just showed the user, that is acceptable, and pretending
otherwise would be theatre. Where it stops being acceptable (the M6 forms, which
write many fields), the escape hatch is a `json` patch with a `test` operation
on the field, or a `PUT` carrying the `resourceVersion` that was read; it is
named here so a future spec does not have to rediscover it. The alternative of
using a `test` operation already in this milestone was considered and rejected:
it converts a benign race into a 422 whose message says nothing a user could
act on.

**W9. Failure is always reported, and the report says what did and did not
happen.** Every write is wrapped in its own `try`/`catch` **inside** the
dialog's `ok` callback, never left to the host: `ConfirmDialog`'s own catch only
unwraps `Error` and `string`, and a Kubernetes error arrives as a
`JsonApiErrorParsed`, which is neither, so an uncaught rejection degrades to
"Confirmation action failed: Unknown error occurred while ok-ing". Errors are
surfaced with `Notifications.checkedError(err, "<specific fallback>")`, which
forwards the API server's own `Status.message` verbatim.

**A failure message says what to do next, and never replaces the API server's
words with its own.** One actionable sentence is prefixed to the message the
API returned, for the three failures that are predictable: a 403 says which
verb on which resource in which namespace was refused; a 404 says the object is
gone and the list is about to catch up; anything else is passed through as it
arrived. `checkedError`'s fallback string is per call site, never a generic
"something went wrong".

**A partially applied compound action reports the state it left behind, and how
to finish the job.** Naming both halves is not enough: the message says what is
now true of the cluster (for a half-done stop: the policy is `Stopped`, so the
controller will not bring the guest back once it exits, but the launcher pod is
still there and the VM is still running), and it says that running the same
action again is safe and will retry only what is missing. That last clause is
only honest because the actions are built to be idempotent - see W1's
no-op-dropping rule and the Stop section - and it is what turns an error toast
into a recovery instruction. `swiftctl` reports the same failure as an error and
stops there.

**Success is acknowledged when, and only when, the screen would not say so on
its own.** Core toasts nothing for suspend, scale or restart, because in each of
those a column flips under the user's cursor within a watch round-trip, and this
spec follows that reasoning rather than its conclusion. Here the reasoning gives
a different answer for one of the two verbs: a stop changes the Condition badge
to `Stopping` immediately in both surfaces, but a **start changes nothing
visible at all** - `spec.runPolicy` is not a column, and the phase will not move
until a controller boots the guest, which on a busy cluster is seconds and on a
broken one is never. Silence there is indistinguishable from an action that did
nothing. So both actions end with a short auto-dismissing `Notifications.ok`
naming the fact that was written (not a prediction): "Run policy set to
Running", "Run policy set to Stopped and launcher pod `<name>` deleted". Two
lines of code, and the difference between a write surface that answers and one
that does not.

**W10. The extension writes only the object the action is about, and its
controller-owned children, and it names the children in the dialog.** Stop
deletes a launcher pod, which is a `Pod` and not a KubeSwift kind; that is
legitimate because the pod is the guest's controlled child and because it is
what the action means, and it is legitimate **only** because the dialog says so.

**W11. Parity with the upstream UI is the floor, not the ceiling** (standing
directive, Roberto, 2026-08-29). kubeswift-ui and `swiftctl` establish what an
action *is*; they do not establish how well it has to be done. Every action in
M6 is audited against three questions before its spec is approved: what does
upstream leave the operator to guess, what does it get wrong, and what can a
CRD-native client know that a gateway client cannot. Each answer is either
implemented or rejected in writing, in the spec's "Better than upstream"
subsection, with the rejected candidates listed next to the adopted ones so the
bar is visible. Two limits keep this from becoming scope creep: an improvement
must serve one of the actions already in scope (a better verb is not a new
verb), and it must not invent behaviour the recon could not confirm - where
upstream is merely unverified rather than wrong, the honest move is to say less,
not to promise more.

### Better than upstream

The audit W11 requires, run section by section over this spec. "Upstream" here
means kubeswift-ui `v0.12.3` for the UI and `swiftctl` for the mechanics; both
were read during the recon, neither is copied.

What upstream does today, as the baseline this measures against: Start and Stop
fire on a single click with no confirmation; Delete confirms with a generic
prompt; a guarded action is hidden or inert with no explanation; a stop deletes
a pod the client never looked at, and reports a half-done stop as a bare error;
nothing is said about what a stop costs (the address, the auto-restart policy)
or what it preserves (the disks); and success is silent.

Adopted, each one implemented in the section named:

| # | Improvement | Where | Why it is better |
| --- | --- | --- | --- |
| B1 | Every action confirms, and the dialog enumerates each write with its field path and value transition | W1, Start, Stop | Upstream fires Start and Stop blind; here the user reads the two API calls a stop makes before making them |
| B2 | Dialogs are built from a live snapshot at click time and name the object's current phase, policy and the exact pod they will delete | W1, Stop | A dialog that quotes stale render-time state is worse than none; this one and the guard see the same object |
| B3 | One `GET` on the launcher pod when the Stop dialog opens, so the pod's existence and phase are facts rather than assumptions | Stop | `swiftctl` deletes by label without looking; the dialog can say "already gone" or "still Running", and degrades to a weaker sentence if the read is refused |
| B4 | A no-op write is dropped from the dialog and from the request sequence | W1, Stop | Re-stopping a half-stopped guest patches nothing and deletes the pod, so the retry is genuinely idempotent instead of noisy |
| B5 | Disabled controls always carry their reason, produced by the same function as the guard and reachable in both surfaces | W4, Start, Stop | Upstream hides or greys with no explanation; a guard that cannot express a disabled state without a reason cannot ship a mute one |
| B6 | The Stop dialog warns that stopping **replaces** an `Always` or `RestartOnFailure` policy, which a later Start will not restore | Stop | The one piece of information the user loses irreversibly, stated at the moment it is lost rather than explained afterwards |
| B7 | The Stop dialog says what stopping costs and what it preserves: the address is released with the pod (only where that is true), the root and data disks are kept | Stop | Both are asked on every first stop; both are knowable from the object; upstream says neither |
| B8 | The Start dialog says what the start will schedule: the guest class, and that a GPU-profiled guest claims a device | Start | Starting is a resource commitment on a shared cluster, and the reference is already in the spec we render |
| B9 | Partial failure reports the resulting cluster state and that the same action retried finishes the job | W9, Stop | `swiftctl` errors and stops; here the toast is a recovery instruction |
| B10 | Predictable failures get one actionable sentence prefixed to the API server's own message, never replacing it | W9 | A 403 that names the verb, resource and namespace is the difference between a shrug and a ticket |
| B11 | Success is acknowledged where the screen would not say so on its own | W9 | A start changes nothing visible until a controller acts; silence there reads as a failure |
| B12 | The `Stopping` derived state, so the interval the API has no phase for is legible everywhere, for every client, not only for the window that clicked | The transition reading | Upstream shows `Running` for a guest that is being stopped |
| B13 | The delete consequences (what cascades, what is retained, that a pool-owned guest returns) rendered permanently in the drawer | Delete | Upstream's confirmation is generic and the ownership trap is invisible until the row comes back |
| B14 | The extension refuses to promise a graceful in-guest shutdown that the code does not show | Stop | Upstream's own documentation over-promises here; saying less is the improvement |

Considered and rejected, with the reason, because the bar is only visible if the
refusals are too:

| Candidate | Rejected because |
| --- | --- |
| A **Restart** verb, or folding the pod deletion into Start so a self-stopped guest can be revived in one click | Out of this spec's scope by instruction, and it would make one control mean two things depending on state. The Start guard's reason names the two-click path instead, and the case is recorded as the strongest argument for the Restart spec |
| A **force stop** (`deleteOptions.gracePeriodSeconds: 0`) next to the normal one | Nothing in the recon shows what the default grace period does for a VM in the first place (B14); adding a "force" variant would invent a semantic difference this project cannot yet describe. Revisit after the manual KVM check |
| **Greying out actions the user lacks RBAC for**, via a `SelfSubjectAccessReview` | W7: it is a write per row, it is not exported to extensions, and W4 forbids a client-side heuristic from being the reason a user cannot act. The 403 path is fast and truthful |
| **Bulk start/stop** over the list's checkbox selection | Out of scope by instruction, and a confirmation that enumerates writes across many objects is a different design problem, not a polish item |
| **Polling or an explicit reload after a write**, so the row updates even if the watch is broken | W2: it would hide exactly the failure worth seeing, and spike S5 exists to find out whether the watch delivers |
| **Restoring the pre-stop policy on Start**, from an annotation stash | The extension does not write bookkeeping into a user's objects. B6 solves the same problem by warning before the value is lost |
| **A progress indicator following the pod's termination** | The dialog already blocks until the writes settle, and the durable version of that information is B12, which every window shows and a reload survives |
| **Rewriting the host's Delete confirmation** to carry the cascade facts | No hook exists; inventing one by rendering over the host's dialog would be the CSS-suppression anti-pattern this repository already rejected. B13 puts the facts where the extension owns the surface, and the hook becomes upstream feedback |

### What a start and a stop actually are

The schema does not answer this, and the answer is the reason this spec is long.

`spec.runPolicy` is an optional string, `enum: [Running, Stopped,
RestartOnFailure, Always]`, with **no `default:` in the CRD**. Its own field
description is unusually explicit: it "governs what the controller does when the
launcher POD reaches a terminal state", it is not a power switch, and a guest
reboot never reaches it (on Cloud Hypervisor v52 a reboot resets the VM in place
and the pod survives).

| Value | What the controller does |
| --- | --- |
| `Running` | Ensure a launcher pod exists. If Cloud Hypervisor exits, do not recreate it. |
| `Stopped` | Do not create a pod; when the pod is absent or terminal, report `status.phase: Stopped`. |
| `RestartOnFailure` | Recreate the pod when it ends `Failed`, with a `10s * 2^restartCount` backoff capped at `300s`. |
| `Always` | Recreate the pod when it ends `Failed` **or** `Succeeded`. |

Three consequences drive every decision below.

**Patching `runPolicy: Stopped` does not stop a running VM.** The `Stopped`
branch is a guard against *recreation*: a pod that is currently `Running` falls
straight through it. Upstream says as much in the doc comment on its own stop
primitive, and its CLI acts accordingly - `swiftctl stop` patches the policy
**and then deletes the launcher pod**, and reports an explicit error if the
second half fails, saying the policy was patched but the guest was not stopped.
An extension that only patched would ship a Stop button that does nothing to a
running VM until the guest shuts itself down. So Stop is two writes, and W1
exists partly because of this: the only honest way to ship a two-write verb is
to say it is one.

**The empty value behaves as `Running`, and can legitimately be stored.** The
default is applied by the mutating webhook, not by the schema, so on a cluster
installed with `webhook.enabled=false` an object can be stored with the field
absent. The controller's own predicate is `runPolicy == "Stopped"`, everything
else meaning "run", so every guard in this spec tests for `Stopped` explicitly
and never for `!= "Running"`.

**There is no transitional phase.** `status.phase` is
`enum: [Pending, Scheduling, Running, Stopped, Failed]`. `Scheduling` covers a
pod being scheduled, which is close enough to "starting"; **nothing covers
stopping**. A guest reads `Running` from the moment the user stops it until the
pod actually goes away. That interval is what the derived state in "The
transition reading" exists for.

Two more facts, both used below. Deleting a SwiftGuest is unguarded and
immediate: **the kind carries no finalizers**, the validating webhook registers
no `DELETE` rule, and the reconciler has no deletion branch at all - cleanup is
pure owner-reference garbage collection. And a guest that a `SwiftGuestPool`
owns is recreated by the pool as soon as it is deleted, because the pool sets a
controller reference on the guests it creates.

### Start

**Guard.** Enabled when `spec.runPolicy === "Stopped"`. Every other value,
including absent, means the guest is already meant to run, and the patch would
be a no-op.

**Write.** One merge patch on the guest:

```json
{ "spec": { "runPolicy": "Running" } }
```

**Confirmation.** Names the kind and `namespace/name`, then the one write, as
`spec.runPolicy: Stopped -> Running`, plus one sentence saying the controller
will create a launcher pod and boot the VM. `labelOk: "Start"`, the default
button styling: starting a guest is a resource commitment, not a destructive
act.

**And it says what the start will schedule** (B8). Starting a guest on a shared
cluster commits real capacity, and every fact needed to say so is already in the
spec this drawer renders: the dialog names the **guest class**
(`spec.guestClassRef.name`), which is what decides the vCPU and memory the
launcher pod will request, and, when `spec.gpuProfileRef` or
`spec.gpuResourceClaim` is set, it adds that the start will **claim a GPU** and
names the profile. When the guest class object happens to be in its store, the
sizing itself is shown next to the name; when it is not, the name alone is shown
and nothing is fetched - this is a one-line context, not a reason to issue a
request. `spec.nodeName`, when the user pinned one, is named too, because a
start that cannot be scheduled anywhere else is worth knowing about before the
click rather than from a `Pending` phase afterwards.

kubeswift-ui's Start button says none of this, and cannot easily: the sizing
lives in a second CRD that a gateway client would have to fetch. A CRD-native
extension already has both objects in the same store.

**Start does not restore the previous policy.** A guest that was `Always` before
being stopped comes back as `Running`. The alternative - stashing the old value
in an annotation on the user's object and restoring it - is rejected: an
extension that writes its own bookkeeping into someone's resources is worse than
one that is explicit about what it does. The dialog shows `Stopped -> Running`,
so the value the guest will have is on screen before the click, and the only way
to reach `Running` from `Always` is through two dialogs that each showed their
own transition.

**Outcome.** `Notifications.ok`, "Run policy set to Running" (W9): a start is the
one action in this milestone with no visible effect anywhere until a controller
acts, so it is the one that must answer.

**The disabled reasons carry the two cases that matter** - and they are reasons,
not decorations: the guard returns them (W4), so neither can go missing, and
both are readable in the kebab and in the toolbar.

| Situation | Reason shown |
| --- | --- |
| policy is `Running`/`Always`/`RestartOnFailure`, phase is `Running`/`Scheduling`/`Pending` | The guest is already set to run. |
| policy is `Running`/`Always`/`RestartOnFailure`, phase is `Stopped`/`Failed` | The guest is already set to run but has exited. Bringing it back means recreating its launcher pod: stop it, then start it. |

The second row is a real gap in the API's shape, not a limitation of this
design: with the policy already at `Running`, there is no patch that changes
anything, because what blocks the boot is a terminal pod the controller will not
replace. `swiftctl` solves it with `restart`, which this milestone excludes; the
tooltip therefore names the two-click path that this milestone does provide.
Adding the pod deletion silently inside Start was considered and rejected: it
would make one button mean two different things depending on state, and W1's
dialog would have to say so anyway, at which point it is a separate verb with a
separate name.

### Stop

**Guard.** Enabled when `spec.runPolicy !== "Stopped"` **or** the status names a
launcher pod. The second half is what makes the recovery path in the Start table
work: a guest whose policy is already `Stopped` but which still has a pod (the
policy was patched by someone else, or by a Stop whose second write failed) can
still be stopped, and the retry W9's partial-failure message promises is
therefore reachable. Disabled only when the policy is `Stopped` and no pod is
recorded, with the guard's own reason (W4): "The guest is already stopped, and
no launcher pod is recorded."

**Writes, in this order.** The order is upstream's own and it matters: patching
first means the controller never has a window in which it could recreate the pod
this action is about to delete.

1. Merge patch on the guest:

   ```json
   { "spec": { "runPolicy": "Stopped" } }
   ```

   **Skipped entirely when the policy is already `Stopped`** (B4). This is the
   half-stopped guest - a stop whose second write failed, or a `kubectl patch`
   somebody else ran - and re-patching it would be a request that changes
   nothing, listed in a dialog as `Stopped -> Stopped`. The dialog and the
   request sequence both drop it, which is what makes "run it again, it will
   finish the job" (W9) a true statement rather than a hopeful one.

2. Delete the launcher pod named by `status.podRef` (`status.podRef.namespace`,
   falling back to the guest's own namespace). A `404` is treated as success:
   the pod being gone is the outcome this write wanted.

**Confirmation.** Two numbered lines, one per write, with the current policy
value spelled out (`spec.runPolicy: Always -> Stopped`, `Delete Pod
kubeswift-e2e/e2e-guest-running-launcher`), and one sentence on what that does
to the VM: the pod's containers are terminated with the pod, under the default
30-second grace period, and **the guest is not asked to shut down cleanly**.
`labelOk: "Stop"` with `okButtonProps: { primary: false, accent: true }` - the
host's accent styling, used by core's catalog and hotbar removals, because this
action terminates a running workload without a clean guest shutdown. Core's own
kube-object Delete uses the plain primary button, which this spec treats as an
inconsistency in core rather than a convention to copy.

That sentence is a deliberate refusal to promise more than upstream delivers.
Upstream documentation describes pod deletion as a graceful SIGTERM shutdown,
but the recon found no ACPI power-button call, no call site for the hypervisor
client's `shutdown` method, no shutdown operation in the guest agent, and no
signal handling compiled into the node daemon. Until a live KVM cluster proves
otherwise (recorded under "Manual verification"), the dialog describes a
termination, not a shutdown. If the manual check shows a clean in-guest
shutdown, the sentence is softened in a follow-up - which is the cheap direction
to be wrong in.

**The dialog reads the pod before it offers to delete it** (B3). When the
dialog opens it issues one `podsApi.get({ name, namespace })` - one request, on
an explicit click, never per row and never on render - and the host's API
returns `null` rather than throwing for a pod that is not there. Four readings
follow, and each one changes what the dialog says:

| What the read found | What the dialog says |
| --- | --- |
| the pod, `Running` | it will delete `<ns>/<name>`, and the VM goes with it |
| the pod, `Succeeded`/`Failed` | the guest has already exited; the pod is only being cleared away, and the policy change is what keeps it from coming back |
| `null` (the recorded pod is gone) | the launcher pod is already gone; only the policy will be patched, and the delete is dropped from the sequence |
| the read failed (a 403 on pods, or any error) | the pod name is shown as the status records it, with one sentence saying it could not be verified; the action is offered anyway |

The last row is the rule that keeps this from being a regression: **a read that
fails never blocks a write the user is allowed to make**. It degrades the
sentence, not the action.

This is the clearest single place where the extension is ahead of both upstream
clients. `swiftctl stop` deletes by label selector without looking at what it is
deleting; kubeswift-ui does not confirm at all. Here the user is told, before
committing, whether they are stopping a running VM or tidying up a pod that
already exited - two situations that feel identical from the list and are not.

**When the status names no pod at all**, the second write is skipped, the dialog
shows one line instead of two, and it adds that no launcher pod is recorded on
this guest, so only the policy will change - and, when the phase still says
`Running`, that a guest which really is running will therefore not be stopped by
this action. A guest with no `podRef` is either not running or has a status too
stale to act on, and in both cases inventing a pod name to delete would be worse
than doing less; saying which of the two the user is looking at is better than
either.

**The dialog states what a stop costs and what it keeps** (B6, B7). Three
conditional lines, each rendered only when it is true of this object:

- **The auto-restart policy is replaced.** When the current policy is `Always`
  or `RestartOnFailure`, stopping overwrites it, and Start will set `Running` -
  no auto-restart - unless the user edits the guest afterwards. This is the only
  information a stop destroys irreversibly, and the moment to say so is the
  moment before it happens, not in the Start tooltip afterwards.
- **The address is released.** When `status.network.primaryIP` is set and the
  guest uses the default `nat` binding, the guest lives behind the pod IP, so
  that address goes with the pod and the next start will get a different one.
  The line is deliberately **not** shown for a `bridge`-bound guest, whose
  address comes from a network attachment and may well be stable: an
  unconditional version of this sentence would be wrong for exactly the users
  who care most about addresses.
- **The disks are kept.** The root disk and every data disk survive a stop;
  stopping is not deleting. It is the reassurance that stops a hesitant operator
  from going to look for a snapshot first, and it costs one line.

**Outcome.** `Notifications.ok` naming what was written - "Run policy set to
Stopped and launcher pod `<name>` deleted", or "Launcher pod `<name>` deleted"
when the policy was already `Stopped` - and, in both surfaces, the Condition
badge flipping to `Stopping` within a watch round-trip (B12). The drawer, if
that is where the action was fired, shows the whole story without a toast:
`Run Policy: Stopped` next to `Condition: Stopping`.

**When only the patch lands** (the pod delete is refused or fails), the error
message is a recovery instruction, per W9: the policy is now `Stopped`, so the
controller will not bring the guest back once it exits, but the launcher pod is
still there and the VM is still running; running Stop again retries just the
deletion, because the patch has become a no-op and is dropped (B4). The guard is
built to keep Stop enabled in exactly that state, so the retry the message
promises is actually reachable - which is the part `swiftctl` leaves to the
operator to work out.

**Selecting the pod by `status.podRef` rather than by label** is a deliberate
deviation from `swiftctl`, which selects by `swift.kubeswift.io/guest=<name>`.
Three reasons: the field is the controller's own published pointer to the pod it
created; the drawer already reads it, so the row menu and the drawer agree
without either issuing a request; and from a list row the extension has no pods
loaded for that namespace at all, so a label selection would mean a list request
on every render rather than one `GET` on a click.

The risk of the field - a `podRef` that lags behind a recreated pod - is
half-answered by B3 rather than merely accepted: the dialog's read turns "the
status says there is a pod" into "there is, or there is not, a pod by that name,
and here is its phase", so a `podRef` pointing at something gone is caught
before a delete is offered. What the read cannot catch is a `podRef` pointing at
a **stale but existing** pod while a newer launcher runs under a different name,
which is what spike S6 exists to rule out on a real cluster. If S6 shows it can
happen, the implementation switches to the label selector for the same single
request, keeping B3 - the read stops being a `GET` by name and becomes a `LIST`
by label, and every reading in the table above still holds.

### Delete

**The host already ships it, in both surfaces.** `KubeObjectMenu` computes
`isRemovable` from the presence of `store.remove` on the store the api manager
resolves for the object, and every KubeSwift kind has one, because this
extension registers it. This is not an inference: the pre-review pass's own
SwiftGuest drawer screenshot from the M5 run shows the pencil and the trash in
the drawer's title bar, and the host renders the identical menu in the list row
kebab from `renderItemMenu`.

**So the extension registers no Delete of its own.** Two items labelled Delete
in one seven-item kebab is a worse outcome than one generic message, and there
is no hook to suppress, reorder or enrich the host's. This is the same stance
this repository already took toward the host's generic printer-column block
(DESIGN.md section 3, issue #52): what the host owns stays the host's, the
extension makes its own surfaces complete instead, and the missing hook becomes
upstream feedback after v1.0.0. The feedback to propose is narrow and concrete:
let an extension that registers `kubeObjectDetailItems` for a kind contribute a
consequence list to that kind's delete confirmation.

**What the extension adds instead**, in the drawer, where it owns the surface -
and permanently, not only at the moment of deletion, which is when it is least
useful:

- **Managed By** - rendered when the guest carries a controller owner reference
  of kind `SwiftGuestPool`: a link to the pool, and the fact that the pool
  recreates a guest deleted on its own. This is the single most valuable thing
  the extension can say about deleting a guest, it is knowable only from
  KubeSwift's ownership model, and it turns a confusing outcome (the row comes
  back) into an expected one.
- **On Delete** - one row summarising the cascade for this guest, computed from
  its own spec rather than stated in the abstract: the launcher pod, the seed
  and runtime ConfigMaps, the cloned root disk, blank data disks and their
  fill jobs, the per-guest Service and PodDisruptionBudget all go, because the
  controller owns them; a data disk attached through an explicit `pvcRef`, the
  shared SwiftImage the guest booted from, and every SwiftSnapshot taken of it
  all stay, because nothing owns them. Snapshots in particular reference their
  guest by name with no owner reference, which is the behaviour a backup
  deserves and the one a user is most likely to guess wrong.

**Fallback (gated on spike S3).** If the host's Delete turns out not to reach
the list row kebab for extension-registered kinds - the drawer is proven by
screenshot, the kebab is proven only by reading the host's source - the
extension registers its own Delete item, using core's own message shape
(`Delete <Kind> <ns/name> from <cluster>?`) plus the consequence list above, and
`store.remove(object)`. A registration cannot target one surface (W5), so that
branch necessarily puts a second delete entry in the drawer next to the host's;
it is therefore titled **Delete Guest** rather than Delete, so the drawer shows
two legible entries instead of two identical ones, and the choice is recorded
here with the spike's verdict.

### The transition reading

A stop patches the spec and deletes a pod; the phase is written by a controller
that has not run yet, and there is no phase for "stopping". Between the click
and the reconcile, the Guests list would say `Running` about a guest the user
has just stopped. That is the state W3 exists for.

**A new pure module `src/renderer/components/guest-status.ts`** - the fifth
classifier of this repository, after `gpu-status`, the two in `sandbox-status`
and `fleet-status`, and the first for a CRD whose views were written before the
classifier convention existed. Structural inputs, no JSX, no colours, no dates
formatted inside, unit tests that need no host global.

`classifyGuest`, evaluated in this order:

| State | When | Class |
| --- | --- | --- |
| `Stopping` | `spec.runPolicy` is `Stopped` **and** phase is `Running`, `Scheduling` or `Pending` | `warning` |
| `Running` | phase `Running` | `success` |
| `Scheduling` | phase `Scheduling` | `warning` |
| `Pending` | phase `Pending` | `warning` |
| `Failed` | phase `Failed` | `error` |
| `Stopped` | phase `Stopped` | `info` |
| `Unknown` | no phase, or a value this extension does not know | `info` |

Four decisions inside that table:

- **`Stopping` is the only invented state, and it is invented from a
  disagreement, not from a click.** It is computed from the object alone, so it
  is identical in every window, survives a reload, and appears for a guest
  stopped by `kubectl` or by `swiftctl` exactly as for one stopped from
  Freelens. An in-flight flag kept in the component would have none of those
  properties and would be the optimistic UI W2 forbids.
- **There is no `Starting`.** The API already has `Scheduling` for that
  interval, and a start is a single patch whose effect the controller produces
  by creating a pod - there is no window where spec and status disagree in a way
  the phase does not already describe. Inventing a symmetric name for symmetry's
  sake would put a word on screen that no `kubectl` shows.
- **`Stopped` while the policy still says run is still `Stopped`**, with the
  nuance in the explanation rather than in a sixth state: the guest exited on
  its own and the policy has not asked for it back. That explanation is what the
  Start guard's second tooltip says, in the one place a user is looking when
  they wonder why Start is greyed.
- **`Stopped` is `info`, not `error` or `terminated`.** A stopped guest is a
  resting state an operator chose, not a fault. `Failed` is the only `error`.

**The message selector** is the shared ladder introduced by M4 and extracted by
M5: `guestMessage(status) = conditionMessage(status) ?? classifyGuest(...).explanation`.
SwiftGuest reports `metav1.Condition`s (`Resolved`, `PodScheduled`,
`GuestRunning`, `StorageReady`, `NetworkReady`, `GPUAllocated` and others) and
has **no top-level `status.message`**, which is the fleet Cluster's shape
exactly, so the ladder starts at its second rung with no code change. Nothing in
the classifier keys on a condition type: as in SPEC-0008 and SPEC-0009, these
type names live in Go constants and prose, not in the CRD manifest, and the one
exception that justified keying on `Ready` for the fleet CRD - a printer column
whose jsonPath names the condition - does not exist here. SwiftGuest's printer
columns key on `status.phase`, so the classifier does too.

**The Guests list gains the DESIGN.md section 2 column pair.** The grammar
becomes:

`Name | Namespace | Node | IP | Restarts | Condition | Status | Age`

The plain `Phase` column is dropped, exactly as SPEC-0007 dropped a raw column
the classifier says better and SPEC-0009 dropped `Ready`: the Condition badge
carries the same information plus the derived state, and the Status column
carries the controller's own words. The host's generic printer-column block
still shows `Phase` in the drawer, and that duplication stays accepted
(DESIGN.md section 3). Column widths follow the section 8 scale:
`node 1`, `ip 1`, `restarts 0.5`, `condition 0.7`, `status 1.5`, `age 0.3`.

The drawer's existing **Phase** row becomes a **Condition** row carrying the
badge and its explanation as the tooltip, and the **Run Policy** row stays and
gains its meaning: it is now the field the user's own clicks write, and a
drawer showing `Run Policy: Stopped` next to `Condition: Stopping` is the
complete and truthful account of a guest mid-transition.

### Where the actions live

Two registrations in `kubeObjectMenuItems`, one per verb, both for
`SwiftGuest.kind` with `apiVersions: SwiftGuest.crd.apiVersions` - the same
kind-plus-apiVersion matching the detail items already use, so no other
project's `SwiftGuest` could ever receive them.

Two registrations rather than one component emitting two items: the host's
optional `visible` flag is a registration-level `IComputedValue` with no access
to the object, so it cannot express a per-object guard anyway, and one file per
verb keeps each guard, each dialog and each error message next to the code that
uses it.

```text
src/renderer/menus/                          (new directory, the sibling-extension convention)
  swiftguest-start-menu-item-v1alpha1.tsx
  swiftguest-stop-menu-item-v1alpha1.tsx
src/renderer/components/
  guest-actions.ts                           (pure: guards, patch payloads, dialog facts)
  guest-status.ts                            (pure: the classifier and the message selector)
```

`ARCHITECTURE.md`'s source-layout block gains the `renderer/menus/` line in the
implementation PR.

All the decision logic lives in `guest-actions.ts` as pure functions over
structurally declared inputs - `canStart`, `canStop`, `startPatch`, `stopPatch`,
`launcherPodTarget`, and one function per dialog that returns the facts the
message is built from (never the JSX). The menu components are then thin: read
the object, call a guard, build a dialog, call the store, catch, notify. That
split is what makes the interesting half of this milestone unit-testable without
a host global or a cluster.

Icons are host Material ligatures, `play_arrow` for Start and `stop` for Stop -
two of the oldest names in the set, chosen because an unknown ligature does not
fail loudly, it renders its own name as a word (the same property that made the
pre-review helper exclude `.Icon` text from drawer rows). Test ids
`swiftguest-start-action` and `swiftguest-stop-action`, following
`swiftsandbox-view-logs`.

`ConfirmDialog.open({ ok })` is used rather than `ConfirmDialog.confirm()`. This
is a **declared deviation from DESIGN.md section 7**, which names `confirm`, and
it exists to satisfy that same bullet's other half: `open` keeps the dialog on
screen and its OK button in the host's `waiting` state until the promise
settles, which is the "buttons disable while an operation is in flight" the rule
asks for, while `confirm` returns a boolean immediately and would leave the
extension to invent an in-flight state of its own. The write is still wrapped in
its own `try`/`catch` inside `ok`, per W9.

### Non-happy states

- **Loading**: unchanged; the list layout's spinner.
- **Empty list**: unchanged, delegated to the layout.
- **Render error**: `withErrorPage` already wraps pages and drawers, and wraps
  the new menu components too - but note it guards **render**, not the async
  click handler, which is precisely why W9 requires a `try`/`catch` inside `ok`.
  Every sibling extension that patches today omits both, which is how a webhook
  rejection becomes an unhandled promise rejection and a UI that appears to have
  done nothing.
- **CRDs not installed**: unchanged (DESIGN.md gap #6, cross-cutting). One new
  edge belongs here though: `LensExtensionKubeObject.getStore()` throws when the
  api manager has no store for the kind, which for a CRD deleted from the
  cluster while Freelens is open is reachable from a click handler. The handler
  reports it like any other failure rather than letting it escape (spike S5).
- **Forbidden**: the API server's own message, in a sticky error notification,
  prefixed with the one sentence naming the verb, the resource and the namespace
  that were refused (W9).
- **Rejected by a webhook or by validation**: same, with the webhook's message
  verbatim. This milestone cannot produce one on purpose - it only ever writes
  values the enum allows - but the path is the one every M6 form will use.
- **Stale object**: an action fired from a row whose object was deleted
  elsewhere fails with a `404`, and that message is shown. There is an E2E case
  for exactly this, because it is the cheapest honest test of "never fails
  silently".
- **The dialog's own read fails** (B3): a user allowed to patch guests but not
  to read pods gets the dialog with the pod name as the status records it and
  one sentence saying it could not be verified. A refused read never blocks a
  permitted write, and it is never reported as an action failure - nothing has
  been attempted yet.
- **Partially applied compound action**: its own message, naming both halves,
  the resulting cluster state, and the fact that repeating the action retries
  only what is missing (W9).

### DESIGN.md conformance

Column grammar with the Condition/Status pair, `NamespaceSelectBadge` for the
namespace cell when the Guests page is touched, a React `key` on every cell,
single-line cells, explicit column ids and per-column widths, no hardcoded
colours, both themes checked before the PR.

Three declared deviations, all to be written into DESIGN.md by the
implementation PR (section 10: a deviation either updates DESIGN.md in the same
PR as the code, or is dropped):

1. **A new section 12, "Write actions".** The eleven ground rules above,
   including W11, which is the standing directive of 2026-08-29 and therefore
   binds every future extension surface, not only M6's. Section 7
   keeps its one-line forward reference and gains a pointer to it.
2. **Section 7's `ConfirmDialog.confirm` becomes `ConfirmDialog.open({ ok })`**,
   with the reason given above (it is what actually delivers the in-flight
   disabling the same bullet requires).
3. **Section 11's gap #1 is closed for the Guests view only**, and the entry
   says so rather than being deleted: nine views still render a phase as plain
   text, and this milestone had a specific reason to fix one of them.

### Feasibility gates (live spikes before the implementation PR)

The precedent is SPEC-0008's `logTabStore` gate: every one of these is cheap,
each has a fallback that costs little, and each is settled with a throwaway
Playwright harness against a real packed Freelens and the fixture cluster,
**before** the implementation PR is opened, with the verdict recorded in this
file. The recon established that every individual API below is exported and used
by some sibling extension; what has no precedent anywhere in the freelensapp
org is the **combination**.

| # | Question | Fallback if it fails |
| --- | --- | --- |
| S1 | Does the whole chain work from an extension menu item: `kubeObjectMenuItems` -> `ConfirmDialog.open` -> `store.patch(..., "merge")` -> `Notifications.checkedError`? The dialog is mounted as a cluster-frame child component and reached through the legacy global DI; every leg is proven separately, no extension chains them. | If the dialog does not open from an extension context, fall back to a locally rendered `Dialog`; if that fails too, M6 is blocked and the finding is the milestone's headline. |
| S2 | Does the API server accept a `merge` patch on `swiftguests`, and does it reject `strategic` as expected? Confirms W6 rather than assuming a Kubernetes rule. | `json` patch with a single `replace` operation. |
| S3 | Does the host's generic Delete appear in the **list row kebab** for our kinds, as it demonstrably does in the drawer toolbar? | The extension registers its own Delete (see "Delete", fallback branch). |
| S4 | Does a 403 produce one notification or two? The host auto-toasts non-GET 403s globally, and `checkedError` would toast again. | Read `isUsedForNotification` on the caught error and skip our own toast when it is set; if the flag is not reachable, accept the duplicate and record it. |
| S5 | Does the row update from the watch after our own write, without a manual reload, and how long does the deleted row linger? Also: what does `getStore()` do from a click handler when the CRD is gone? | If the watch does not deliver, the fallback is an explicit `store.loadAll` after the write - which would be a real regression against W2 and is worth knowing before, not after. |
| S6 | On a real cluster, does `status.podRef` name the live launcher pod whenever one exists, and does exactly one pod carry `swift.kubeswift.io/guest=<name>`? And does `podsApi.get` return `null` (rather than throwing) for a pod that is gone, which is what B3's four readings are built on? | Select the pod by label and pay for a `LIST` instead of a `GET`; if `get` throws instead of returning `null`, the not-found case is read from the caught error's code. |
| S7 | How does a `disabled` MenuItem read in both surfaces, and does the guard's reason reach the user in toolbar mode, where the title span is hidden? B5 requires it to, through the `Icon`'s own `tooltip`. | The drawer's Condition row carries the same sentence, which B5 already requires as the second channel; if neither works in the toolbar, the toolbar item is hidden while the kebab item stays disabled with its reason, and the split is recorded. |

## Tests (non-regression list)

- **Unit** (`pnpm test:unit`):
  - `src/renderer/components/guest-actions.test.ts`:
    - `canStart` true only for `runPolicy: "Stopped"`; false for `Running`,
      `Always`, `RestartOnFailure`, **and for an absent policy** (the
      webhook-disabled case, which is the one a naive `!== "Running"` gets
      wrong);
    - `canStop` true for every non-`Stopped` policy; true for a `Stopped` policy
      that still names a pod; false for `Stopped` with no pod; true for an
      absent policy;
    - both guards on an object with no `spec` and on one with no `status`;
    - `startPatch` and `stopPatch` produce exactly `{ spec: { runPolicy } }` and
      nothing else (the assert that keeps a read-modify-write from creeping in);
    - `launcherPodTarget` reads `status.podRef.name` with the namespace from
      `podRef.namespace`, falls back to the guest's namespace, and returns
      `undefined` when no pod is named;
    - the dialog fact builders: the `from -> to` pair for each verb, the
      two-write shape of a stop with a pod against the one-write shape without,
      and the cascade summary for a guest with an explicit `pvcRef` data disk
      against one with only a blank disk;
    - **the guard invariant of B5**: over every input the guard distinguishes, a
      disabled outcome always carries a non-empty reason. Written as a loop over
      a table of cases rather than one assertion per case, so a future guard
      branch cannot be added without one;
    - **the no-op dropping of B4**: a stop on a guest whose policy is already
      `Stopped` produces a write sequence with the patch absent and the pod
      delete present, and a dialog with one line; the same guest with no pod
      produces no writes at all and is guarded off instead;
    - **the four pod readings of B3**, as a pure function from
      `(guest, podLookupResult)` to the dialog's pod sentence: pod running, pod
      terminal, pod absent (`null`), lookup failed. The lookup itself is the
      component's job; what is unit-tested is that each outcome produces its own
      wording and that only the "absent" one drops the delete from the sequence;
    - **the conditional cost lines of B6 and B7**: the auto-restart warning
      appears for `Always` and `RestartOnFailure` and not for `Running`; the
      address line appears for a guest with a `primaryIP` and `nat` or absent
      binding, and **not** for a `bridge`-bound one (the case an unconditional
      version would get wrong); the disks line is unconditional;
    - **the Start context line of B8**: the guest class name always, the GPU
      sentence only when `gpuProfileRef` or `gpuResourceClaim` is set, the
      pinned node only when `spec.nodeName` is set;
    - **the outcome and failure messages of W9**: the success sentence for each
      verb and for the policy-already-`Stopped` variant; the partial-failure
      message naming the resulting state and the retry; the 403 and 404
      prefixes, each asserted to **contain** the API server's original message
      rather than replace it.
  - `src/renderer/components/guest-status.test.ts`: one case per row of the
    classifier table; `Stopping` for each of the three phases it covers;
    `Running` **not** becoming `Stopping` when the policy is absent; `Stopped`
    with a non-`Stopped` policy keeping the state and getting the "exited on its
    own" explanation; an unknown phase string; no status at all; and
    `guestMessage` preferring a condition message over the classifier
    explanation and falling back to it when no condition carries one.
  - `src/renderer/api/kubeswift/swiftguest-v1alpha1.test.ts`: extended for the
    owner-reference reader behind the Managed By row (a controller reference of
    kind `SwiftGuestPool`; a non-controller reference ignored; an owner of
    another kind ignored; no owners at all).
- **Integration**: unchanged (install, listed as enabled, activation without
  errors).
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`). This suite has only ever
  read; these cases are the first that write, and the split between what they
  can honestly prove and what they cannot is the point:

  **What the fixture cluster proves.** The CRDs are real and the API server
  validates and stores patches exactly as it would in production, so a case can
  prove the patch is well-formed and accepted, that the object changed, that the
  pod was deleted, that the watch carried the change back into the list without
  a reload, and that the derived `Stopping` state renders. It can also prove the
  negatives that matter most: that cancelling writes nothing, that a disabled
  action cannot be clicked, and that a failed write is reported.

  **What it cannot prove**, and what therefore stays in "Manual verification":
  anything a controller would do next. No reconciler runs, so a stopped guest
  never reaches `phase: Stopped` and a started one never boots. The suite must
  not assert otherwise, and the `Stopping` badge that a real cluster would show
  for a few seconds is **permanent** here - which is what makes it cheap to
  assert, and which the case comments must say so that nobody later "fixes" the
  missing phase change.

  New cases, placed after every existing read case and before the log-dock case
  that must stay last:
  - "shows the guest actions in the row menu and in the drawer toolbar": both
    surfaces carry Start and Stop for the same guest; on a running subject Start
    is disabled and Stop is not; on a stopped subject the reverse. No writes.
    Also asserts that the disabled item cannot be clicked (Playwright's
    actionability check fails on `pointer-events: none`), which is the E2E half
    of W4, and that **the disabled item carries its reason** in both surfaces,
    which is the E2E half of B5.
  - "stops a guest, patching the run policy and deleting the launcher pod": the
    dialog lists both writes, names the pod **and reports that the pod is there
    and running** (B3), warns that the `Always` policy of this subject will be
    replaced (B6) and that its address is released (B7); after confirming,
    `kubectl` reads back `{.spec.runPolicy}=Stopped`, the launcher pod is gone,
    a success notification names both writes (B11), the row's Condition badge
    reads `Stopping` in the `warning` class, and the drawer's Run Policy row
    reads `Stopped` without a reload.
  - "offers only the missing write when a guest is already half-stopped" (B4):
    the subject is patched to `runPolicy: Stopped` with `kubectl` while its
    launcher pod is left in place - which is exactly the state a failed second
    write leaves behind. Stop stays enabled, its dialog shows **one** line and
    no `Stopped -> Stopped` patch, and confirming deletes the pod and leaves the
    policy untouched. This is the case that proves the retry W9's partial-failure
    message promises actually works, and it can be set up honestly here because
    a fixture cluster is the one place that state is cheap to create.
  - "says the launcher pod is already gone when it is" (B3): the subject's
    `status.podRef` names a pod the fixtures deliberately never create, so the
    dialog reports it as already gone and lists only the patch. No `kubectl`
    setup and no ordering dependency - the same "name something that does not
    exist" idiom the M5 credential-Secret counter-assert already uses. Together
    with the case above it pins the rule that the dialog describes the cluster
    rather than the status.
  - "starts a stopped guest": the dialog names the guest class the start will
    schedule (B8); after confirming, `{.spec.runPolicy}=Running`, a success
    notification says so (B11), and the badge still reads `Stopped` - the honest
    assert that this action changed the policy and nothing else, since nothing
    in this cluster boots a VM. The notification is the whole point of B11 here:
    without it this case would be asserting that a successful action produced no
    visible change at all.
  - "cancels an action without writing anything": open Stop, dismiss the dialog,
    read back the unchanged policy and the still-present pod.
  - "reports a failed action instead of failing silently": `kubectl delete` the
    subject guest, then fire Stop from the stale row; an error notification
    appears carrying the API server's own not-found message. This is the case
    that pins W9, and it is the one behaviour no sibling extension has today.
  - "deletes a guest and drops its row": through the host's Delete (or the
    extension's, in the S3 fallback branch); `expectNoRow`, and `kubectl` says
    NotFound. Honest because SwiftGuest has no finalizers - in a cluster with no
    controller, a finalized kind would hang in `Terminating` forever, and this
    case would be asserting the opposite of what a real cluster does.
- **Fixtures** (`e2e/fixtures/`, numbering continued). Dedicated subjects, not
  the M1 guests: these objects are mutated and destroyed by the suite, and every
  earlier case reads `e2e-guest-running`. `e2e/scripts/cluster-up.sh` is
  idempotent and re-applies everything, so a second run starts clean.
  - `160-swiftguest-actions.yaml`, five subjects, one per branch the cases need:
    - `e2e-guest-action-running` - the Stop subject. `runPolicy: Always` and the
      default `nat` binding, with a status carrying `phase: Running`, a
      `primaryIP` and a `podRef` to a real fixture pod, so that one object
      exercises the two-write sequence, the auto-restart warning (B6) and the
      address line (B7) at once.
    - `e2e-guest-action-halfstopped` - `runPolicy: Stopped` with a status that
      still reports `phase: Running` and a `podRef` to a real fixture pod: the
      state a failed second write leaves behind, and the B4 subject. It is also
      the fixture that renders `Stopping` before any test has clicked anything,
      which is the cheapest possible check of the classifier.
    - `e2e-guest-action-orphanref` - `runPolicy: Running` with a `podRef` naming
      a pod the fixtures never create: the B3 "already gone" subject.
    - `e2e-guest-action-stopped` - `runPolicy: Stopped`, `phase: Stopped`, no
      `podRef`: the Start subject and the Stop-disabled subject.
    - `e2e-guest-action-delete` - no status: the Delete subject and, after it,
      the stale-object subject.
  - `55-launcher-pods.yaml` gains `e2e-guest-action-running-launcher` and
    `e2e-guest-action-halfstopped-launcher`, matching the existing
    unschedulable-launcher pattern.
  - `e2e-guest-pooled`, owned by `e2e-pool`, for the Managed By row. It is the
    one fixture in this repository that cannot be written as a literal: an
    owner reference carries a `uid`, and a wrong one makes the garbage collector
    delete the object outright. It needs a `__POOL_UID__` substitution resolved
    by `cluster-up.sh` at apply time, modelled on the existing `__NODE_NAME__`
    one. If that turns out to be more machinery than the row is worth, the
    Managed By logic is covered by unit tests alone and this fixture is dropped;
    the decision is recorded here either way.
  - `E2E_STATUS_PATCHES` and `E2E_STATUS_ASSERTIONS` gain the two patched
    subjects, including `{.spec.runPolicy}` readbacks - the first entries in
    that array that assert a **spec** field, because they are the ones the suite
    will later overwrite from the UI.
  - `fixturesReady()` gains an M6 probe (`e2e-guest-action-running`).
- **Pre-review agent pass** (SPEC-0006, `pnpm pre-review`): **the pass stays
  read-only, by construction and by assert.** This is a rule for all of M6, not
  a note about this spec:
  - The pass runs against the **demo** cluster, which is the cluster a reviewer
    then walks through by hand. A pass that stopped a guest would corrupt the
    session it exists to prepare. Any check that needs a write belongs in the
    E2E suite, which owns a disposable cluster.
  - It cannot reach an action by accident today: it clicks only drawer rows that
    have an `href` (`classifyDrawerReferences` filters on it), action items are
    `MenuItem` elements with no `href`, and they render in the drawer's toolbar
    and in the row kebab - neither of which is inside the `.DrawerItem` rows
    `inspectDrawerRows` reads. The pass never opens a kebab.
  - W1 is the second gate: even a stray click opens a dialog and stops there.
    Mandatory confirmation is not only a UX rule, it is what makes an automated
    read-only pass safe on a write surface.
  - Belt and braces, added by the implementation PR: one assert per view that no
    element whose test id ends in `-action` was collected as a link, and a
    report line naming the action controls the view exposes **together with the
    disabled reason each one carries** (read from the tooltip, not clicked), so
    the reviewer sees them in the screenshots (both themes) and can judge wording
    and icons, which is the part no assert can cover. The reasons are the text
    B5 promises a user will find, so putting them in the report is what lets a
    human check that promise without opening a menu.
- **Manual verification** (escalated to Roberto, PROCESS.md). Everything the
  fixture cluster structurally cannot show, on a real KVM-backed KubeSwift:
  1. Stop on a running VM: the policy is patched, the pod goes, the guest
     reaches `phase: Stopped`, and the `Stopping` badge resolves on its own.
  2. **Whether the guest shuts down cleanly or is killed** - the open question
     from the recon, and the one that decides the wording of the Stop dialog.
  3. Start on that guest: a new launcher pod, `Scheduling` then `Running`.
  4. Start on a guest that exited on its own with `runPolicy: Running`: the
     action is disabled and the tooltip's advice (stop, then start) actually
     works.
  5. A 403: a user with read-only RBAC on `swiftguests` sees a clear refusal,
     once, not twice (spike S4 in the field), with the verb, the resource and
     the namespace named (B10).
  6. Delete: the launcher pod and the cloned root disk go, an explicitly
     referenced PVC and the guest's SwiftSnapshots stay, and a pool-owned guest
     comes back.
  7. **The two claims the Stop dialog makes about consequences** (B7), which are
     the only sentences in this milestone that describe what the cluster will do
     rather than what the extension will write: that a `nat`-bound guest comes
     back with a different address after a stop and a start, and that its disks
     survive untouched. Both are read from the schema and from the ownership
     model, and both would be embarrassing to be wrong about in a dialog. If
     either fails, the line is removed rather than reworded.
  8. **A user allowed to patch guests but not to list pods** (B3's fourth
     reading): the Stop dialog still opens, names the pod as the status records
     it, says it could not be verified, and the action still works.

  Record date, tester and result here when it happens.

## Notes and deviations

Filled during implementation when reality diverges from the plan. The recon that
produced this spec follows the implementation notes.

### Feasibility gates: the verdicts (2026-08-29)

All seven were run before the implementation was finished, as throwaway
Playwright suites (`e2e/__tests__/spike-m6.tests.ts`, deleted afterwards)
against a packed Freelens `v1.10.3` and the `kubeswift-e2e` fixture cluster -
the SPEC-0008 `logTabStore` precedent. Two of them made the implementation
change; both changes are the fallback this spec had already named.

| # | Verdict | Evidence |
| --- | --- | --- |
| S1 | **PASS.** The whole chain works from an extension menu item | Stop on `e2e-guest-action-running`: the dialog opened from `ConfirmDialog.open`, `store.patch(..., "merge")` was accepted, the pod delete went through, and one `Notifications.ok` said "Run policy set to Stopped and launcher pod e2e-guest-action-running-launcher deleted". `kubectl` read back `{.spec.runPolicy}=Stopped` and the pod gone, 4.3s after the click |
| S2 | **PASS, and the assumption behind W6 is confirmed rather than assumed** | `kubectl patch --type=merge` on a `swiftguest` is accepted; `--type=strategic` is refused by the API server with "application/strategic-merge-patch+json is not supported by swift.kubeswift.io/v1alpha1, Kind=SwiftGuest"; an out-of-enum value is refused with the enum listed; and the W8 escape hatch (`json` patch with a `test` op) works, which is worth knowing for the M6 forms |
| S3 | **PASS. The host's Edit and Delete reach the list row kebab too** | The kebab of every guest row holds four items: our Start and Stop, then `menu-action-edit-for-<selfLink>` and `menu-action-delete-for-<selfLink>`. The host's confirmation reads "Delete SwiftGuest kubeswift-e2e/e2e-guest-action-delete from kind-kubeswift-e2e?" and the object was really deleted. **The fallback branch (an extension Delete titled "Delete Guest") is therefore NOT taken**, and no Delete of our own is registered |
| S4 | **A 403 produces TWO notifications unless the flag is read; the named fallback is implemented** | With a read-only ServiceAccount kubeconfig, a refused pod delete produced exactly one notification once the extension skipped its own: the host's global toast, carrying the API server's own words ("pods ... is forbidden: User ... cannot delete resource ... in the namespace ..."). `isUsedForNotification` is a public property of `JsonApiErrorParsed` and is reachable, so `apiFailureFacts` reads it and the menu items stay quiet when it is set |
| S5 | **PASS. The watch delivers, and no reload is needed** | After our own write the row read `Stopping` **350 ms** after the click, and the drawer read `Condition: Stopping` next to `Run Policy: Stopped`. A deleted row lingered **1168 ms** before disappearing, which is the host's own one-second debounce (W2's corollary) and not something to fix. `getStore()` was not observed throwing, and the click handler guards it anyway |
| S6 | **The `podsApi.get` half FAILED as specified, and the named fallback is implemented** | For a `podRef` naming a pod that does not exist, `podsApi.get` **throws** rather than returning `null`: `KubeApi.get` calls `request.get`, and `JsonApi` rejects on every non-2xx, so the documented `null` is only ever an empty body. The first spike run showed the "could not be verified" wording where "already gone" was expected; after reading the caught error's `code` the same subject reads "The launcher pod ... is already gone, so only the run policy will change" and the delete is dropped from the sequence. **The other half of S6 - whether `status.podRef` always names the live launcher pod - cannot be answered on a reconciler-less cluster** and is escalated to Manual verification (item 9); the pod selection therefore stays on `status.podRef`, with B3 catching the stale-name case that this cluster can produce |
| S7 | **PARTIAL, and the spec's own fallback is refused for a better one** | A disabled `MenuItem` carries `pointer-events: none`, so it cannot be hovered **in either surface**: neither the host `Icon` tooltip (even with `tooltipOverrideDisabled`) nor a native `title` tooltip can appear for it. The enabled toolbar item's tooltip does work ("Start"). The reason is nevertheless carried in the DOM in both surfaces, as the item's `title` attribute ("Start: The guest is already set to run.", "Stop: The guest is already stopped, and no launcher pod is recorded."), which the E2E and the pre-review report read without hovering and which assistive technology announces. See the deviation below for why the toolbar item is not hidden |

### Deviations from the spec, and why

1. **B5's tooltip channel is replaced by the item's `title` attribute plus the
   drawer's Condition row** (spike S7). The spec's fallback - hide the toolbar
   item, keep the kebab item disabled with its reason - was refused: the kebab
   item is affected by exactly the same `pointer-events: none`, so hiding the
   toolbar item would violate W4's no-hiding rule **and** still leave no
   hoverable reason anywhere. What ships instead keeps the control visible and
   disabled in both surfaces, carries the reason in the DOM of both, and relies
   on B5's own second channel (the Condition row explanation, which the
   classifier writes for exactly the case that matters: a guest that exited on
   its own). Candidate upstream feedback, narrow and concrete: core's `MenuItem`
   should render a reason for a disabled item, since `tooltipOverrideDisabled`
   cannot work under `pointer-events: none`.
2. **The launcher pod's "already gone" reading comes from the caught error's
   status code** rather than from a `null` return (spike S6, the fallback this
   spec named). Both readings are kept in the code, so a host that starts
   returning `null` needs no change.
3. **A third file in `renderer/menus/`**, `guest-action-menu-item.tsx`, holds
   what the two verbs would otherwise copy verbatim: the host idiom, the live
   click-time snapshot, the guard re-evaluation, the dialog rendering. Each
   verb's own file still owns its guard, its dialog facts, its writes and its
   messages, which is what "one file per verb" was for.
4. **`SwiftGuest`'s metadata type became `NamespaceScopedMetadata`**, matching
   every model written since M3. It is a namespaced kind, so `getNs()` now
   returns a string and the new code carries no fallback for a case the API
   cannot produce.
5. **The half-stopped E2E subject is shipped as a fixture rather than produced
   with `kubectl` inside the case.** The spec suggested patching a subject at
   run time; a dedicated fixture in that exact state is simpler, has no ordering
   dependency, and doubles as the cheapest possible check of the `Stopping`
   derived state (it renders it before any test has clicked anything).
6. **The stale-object case uses `e2e-guest-action-orphanref` and deletes the
   object from under an OPEN dialog**, rather than firing from a stale row of
   `e2e-guest-action-delete`. A stale row cannot be clicked reliably - it
   disappears within a watch round-trip (S5: 1168 ms) - while a dialog built
   from a snapshot stays, which is both deterministic and the real shape of the
   race. `e2e-guest-action-delete` keeps the Delete case to itself.
7. **The pooled-guest fixture was kept, not dropped.** The spec allowed
   dropping it if the `__POOL_UID__` substitution proved to be more machinery
   than the row is worth. It cost ~20 lines in `cluster-up.sh`
   (`apply_owned_fixtures`, a second apply pass with the owner's uid resolved
   from the cluster, plus a readback assert), and it buys a live check that the
   Managed By row resolves and links: the drawer of `e2e-guest-pooled` reads
   `Managed By: e2e-pool` as a real link to the pool.
8. **Four status patches, not two.** The spec spoke of "the two patched
   subjects" in `E2E_STATUS_PATCHES`; four of the five subjects need a status
   (the fifth has none on purpose). The `{.spec.runPolicy}` readbacks - the
   first entries in `E2E_STATUS_ASSERTIONS` that assert a spec field - are on
   the two subjects the suite later overwrites from the UI.

### Readings worth recording

- **The Status column can disagree with the Condition badge, and that is the
  design working.** A half-stopped guest shows `Condition: Stopping` next to
  `Status: The guest is running.` - the derived state next to the controller's
  own last word, which the message ladder always prefers. The extension never
  replaces the controller's words with its own; on a real cluster the condition
  catches up seconds later.
- **The fixture launcher pods are `Pending`, not `Running`** (they are
  deliberately unschedulable), so the Stop dialog reads
  "(Pending) will be deleted". The E2E asserts that a real read happened rather
  than a phase this cluster cannot produce.
- **The host toasts nothing for its own Delete**, which is why B11's success
  notification exists for our two verbs and why the delete case asserts the row
  and the API server rather than a toast.

### Manual verification, item 9 (added by the implementation)

9. **Whether `status.podRef` ever lags behind a recreated launcher pod** (the
   half of spike S6 a reconciler-less cluster cannot answer), and whether
   exactly one pod carries `swift.kubeswift.io/guest=<name>`. If a stale
   `podRef` pointing at an existing but superseded pod turns out to be
   reachable, the implementation switches to the label selector for the same
   single request, keeping B3: the read stops being a `GET` by name and becomes
   a `LIST` by label, and every reading of the four-row table still holds.

### Upstream recon (2026-08-29)

Per PROCESS.md's upstream drift watch, at the start of the milestone:

- The latest KubeSwift release is still **v0.13.12** (2026-08-24), the version
  M1-M5 were written against. kubeswift-ui is still **v0.12.3** (2026-08-11).
- **The SwiftGuest CRD manifest at `main` is not byte-identical to the one at
  the tag** - the first time this project has seen the file it depends on move
  since a milestone's recon. The diff was fetched and read in full: it is
  **two lines, both inside field descriptions**, removing a mention of another
  virtualization project from the `network.binding` and `storage.volumeMode`
  docs. Same line count, no schema change, no enum change, no new field, no new
  validation rule. No drift for this spec's purposes, nothing to file upstream,
  and the E2E version pin stays as it is. Recorded because "identical" was
  becoming an assumption in these recons, and this is the first time the honest
  answer required reading a diff rather than comparing two hashes.
- Schema facts re-verified field by field for this milestone:
  - `spec.runPolicy`: optional, `enum: [Running, Stopped, RestartOnFailure,
    Always]`, **no `default:` in the schema** (the mutating webhook supplies
    `Running`), with a field description that states in as many words that it
    governs what happens when the launcher pod terminates rather than acting as
    a power switch.
  - `status.phase`: `enum: [Pending, Scheduling, Running, Stopped, Failed]`. No
    transitional value.
  - Printer columns: `Phase`, `Node`, `IP`, then `priority: 1` (wide-only)
    `Hypervisor`, `OS`, `Service`, `Egress`, then `Age`. The four wide-only
    columns are why the drawer's host-rendered block shows more than the list
    does.
  - `subresources: {status: {}}` only - **no `scale`, no custom action
    subresource**. Start and stop are ordinary patches on the object; there is
    no VirtualMachineInstance-style second kind and no start/stop endpoint.
  - Exactly one `x-kubernetes-validations` rule in the whole file, on
    `spec.storage` (`ReadWriteMany` requires `volumeMode: Block`). Nothing
    constrains a `runPolicy` transition, so no state machine is enforced by the
    API - which is why the guards in this spec are a convenience and RBAC is the
    authority (W4, W7).
  - `spec.guestClassRef` is the only required field of the spec.
- Controller behaviour, read from `internal/controller/swiftguest/`,
  `internal/actions/` and `cmd/swiftctl/`, because no document states it:
  patching `runPolicy: Stopped` guards against **recreation** and does not
  terminate a running pod; `swiftctl stop` therefore patches and then deletes
  the launcher pod selected by `swift.kubeswift.io/guest=<name>`, and reports an
  explicit error when only the first half succeeded; `swiftctl restart` deletes
  the pod and refuses on a stopped guest; the internal resolver collapses the
  four policy values to a two-valued intent whose "stop" branch is exactly
  `runPolicy == "Stopped"`.
- Deletion: **SwiftGuest carries no finalizers**, the validating webhook
  registers no `DELETE` rule, and the reconciler has no deletion branch;
  everything that goes, goes by owner reference. Controller-owned and therefore
  cascaded: the launcher pod, seed and runtime ConfigMaps, the cloned root-disk
  PVC and its job, blank data-disk PVCs and their fill jobs, the per-guest
  Service, PodDisruptionBudget, Role/RoleBinding and migration identity Secret.
  Not owned and therefore retained: a data disk attached through an explicit
  `pvcRef`, the shared SwiftImage PVC, and every SwiftSnapshot, SwiftMigration
  and SwiftRestore that names the guest - all of which reference it by name
  only. The one inverse relationship is `SwiftGuestPool`, which **owns** its
  guests: deleting a pool cascades to them, and deleting one of them
  individually is futile.
- The pods/eviction webhook (`spec.migration.drainPolicy`) guards node **drain**,
  not deletion. An explicit delete bypasses it. Worth knowing so that nobody
  expects a `Block` drain policy to protect a guest from the trash icon.

### Docs versus code discrepancies

Recorded for upstream feedback, as every milestone since SPEC-0002 has. This is
the first milestone where the discrepancies are between the docs and the
**code** rather than between the docs and the schema, because the behaviour this
spec needed is not in any schema.

1. **`docs/swiftctl.md` describes a `stop` that no longer exists.** It documents
   an exec into the pod, a SIGTERM to the hypervisor process, a 30-second wait
   and then a force delete. The implementation patches the policy and deletes
   the pod, with no exec and no wait. A UI written from that page would promise
   a graceful shutdown it does not perform.
2. **`docs/swiftctl.md` describes a `start` that deletes the launcher pod.** The
   implementation only patches. This one matters more than it looks: if start
   really did delete a terminal pod, the Start guard in this spec would be wrong
   and the second tooltip in its table would be unnecessary. It was checked
   against the code, not the page.
3. **Upstream documentation calls the stop path a graceful SIGTERM shutdown of
   the guest.** The recon found no ACPI power-button call, no call site for the
   hypervisor client's `shutdown` method, no shutdown operation in the guest
   agent, and no signal handling compiled into the node daemon. The evidence is
   negative and therefore not conclusive - it is a live-cluster question, and it
   is item 2 of the manual verification list. Until it is answered, the Stop
   dialog describes a termination.
4. **Nothing outside the `runPolicy` field description says that a stop needs
   two operations.** `docs/crds.md` presents `runPolicy` as the desired run
   state, which reads as a power switch. The field's own description in the CRD
   is accurate and is the only accurate source.

### Host recon (2026-08-29)

Read against the pinned host (`freelens` `v1.10.3`, matching the installed
`@freelensapp/extensions`), and split into what is proven and what needs the
live spikes above.

Proven from the host's source, its shipped type declarations, and shipping
sibling extensions:

- `kubeObjectMenuItems` takes `{ kind, apiVersions, components: { MenuItem },
  visible? }`, matches on kind **and** full apiVersion, and passes the component
  exactly `{ object, toolbar }`.
- **One registration reaches both surfaces**: the list layout renders
  `<KubeObjectMenu object={item} />` from `renderItemMenu` (no `toolbar`), the
  details view renders `<KubeObjectMenu object={...} toolbar={true} />`. Read in
  both files.
- `Renderer.Component.ConfirmDialog` exports `open` and `confirm`;
  `Notifications` exports `ok`, `error`, `checkedError`, `info`, `shortInfo`,
  with error notifications sticky by default. `checkedError` takes an `unknown`
  and a fallback string, which is the right shape for a `catch`.
- `KubeObjectStore` exposes `create`, `patch`, `update`, `remove`,
  `removeWithOptions`; `KubeApi` exposes `patch` with an explicit
  `"merge" | "json" | "strategic"` strategy. `patch`/`update` update the local
  item from the server's response; `remove` does not, and waits for the watch.
- A Kubernetes error reaches a `catch` as `JsonApiErrorParsed`, which is **not**
  an `Error`, and whose `toString()` is the API server's own `Status.message`. A
  non-GET **403 is toasted by the host globally**; **422, 400 and 409 are not
  toasted by anyone**.
- Core's model for exactly this kind of action is the CronJob suspend/resume
  menu item: confirm, `try`/`catch`, `checkedError`, no success toast, and a
  bare `{ spec: { <field> } }` patch with no read-modify-write. The success
  toast is the one point where this spec knowingly diverges from that model, and
  W9 argues it from core's own reasoning rather than against it: core's action
  flips a visible column, a start here flips nothing.
- The host already renders Edit and Delete for our kinds: `isRemovable` and
  `isEditable` are derived from the store's own methods. Visible in this
  repository's own M5 pre-review screenshot of the SwiftGuest drawer.
- `MenuItem` accepts `disabled`, but the prop does not block `onClick` - only
  the stylesheet's `pointer-events: none` does. This is why W4 requires the
  handler to re-check its own guard.

Needing a live spike: the seven gates above.

### Precedent in the freelensapp extensions

Six sibling extensions register `kubeObjectMenuItems`, and four write. The
scaffold this repository came from - `freelens-example-extension` - has a
suspend/resume menu item that patches `{ spec: { active } }` with `"merge"`, and
`freelens-fluxcd-extension` and `freelens-sveltos-extension` ship the same shape
at scale, fluxcd's reconcile item patching an annotation with a timestamp.
`freelens-kamaji-extension` creates, `freelens-ai-extension` creates, updates,
patches and removes, and `freelens-agentbridge-extension` is the one place where
`ConfirmDialog.confirm` and `Notifications.error` are already used by an
extension.

So this milestone breaks no new ground on any single API. What it does not
inherit is a pattern, and the gaps are the reason the ground rules above are
written as strictly as they are:

- **none of those extensions confirms** before patching - a suspend fires on one
  click;
- **none of them catches or notifies** - `await store.patch(...)` with no
  `try`/`catch`, so a rejected write is an unhandled promise rejection and a UI
  that appears to have done nothing;
- **none of them deletes** from a menu item.

The pattern being adopted here is therefore core's, not the extensions'. Where
this spec is stricter than core too - it catches inside `ok` where core's own
generic delete does not, and it enumerates writes where core's messages name
only the object - the reason is in W1 and W9, and both are cheap.

### Rejected alternatives

Recorded so they can be revisited cheaply rather than re-argued. These are the
design alternatives inside the three actions; the candidates rejected by the
better-than-upstream audit are in the second table of "Better than upstream",
and the two lists deliberately do not repeat each other.

- **A single "Power" toggle item** instead of Start and Stop. Rejected: the two
  verbs have different guards, different numbers of writes and different risk,
  and a toggle whose label depends on state is the control users misclick.
- **A `json` patch with a `test` on `/spec/runPolicy`**, making the dialog's
  `from -> to` claim atomically true. Rejected for v1 under W8: it turns a
  harmless race into an unhelpful 422.
- **Selecting the launcher pod by label**, as `swiftctl` does. Rejected for now
  under "Stop", with spike S6 as the trigger to reconsider - and note that B3
  removes most of what made the label attractive, since the dialog now verifies
  the pod it names either way.
- **Registering the extension's own Delete** next to the host's. Rejected under
  "Delete", with spike S3 as the trigger to reconsider.
- **Suppressing the host's generic printer-column block** in the guest drawer
  now that the drawer carries a Condition row that says more than the `Phase`
  row above it. Rejected: it is settled repository stance (DESIGN.md section 3,
  issue #52), there is still no hook, and the only way to do it would be the CSS
  suppression already rejected in issue #24.

The candidates the better-than-upstream audit turned down - a Restart verb, a
force stop, an RBAC pre-flight, bulk actions, polling after a write, the
annotation stash that would restore a pre-stop policy, a termination progress
indicator, and rewriting the host's delete confirmation - are in the second
table of "Better than upstream", with their reasons.

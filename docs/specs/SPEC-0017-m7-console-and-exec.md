# SPEC-0017: VM serial console and the sandbox workload console (M7)

- **Status:** Approved (Roberto, 2026-09-01, in chat: the reduced scope
  with the in-guest sandbox shell excluded, the transport E2E fixture of
  O5 and the `swiftctl` sentence of O6 all accepted at approval)
- **Milestone:** M7 (see [ROADMAP.md](../development/ROADMAP.md), the "VM
  serial console" and "Sandbox exec, and the workload console tail" rows)
- **KubeSwift version reviewed:** `v0.13.12` (`724b5ef`). Every console
  and exec path is **byte-identical** between the tag and `main`
  (`d66cff5`) - `cmd/swiftctl/console.go`, `cmd/swiftctl/sandbox.go`,
  `internal/gateway/console_ws.go` and `internal/cli/guest.go` all diff
  clean - so the tag is the whole basis and there is no drift caveat to
  carry (digest, Sources). UX reference kubeswift-ui `main` `c4e53ce`,
  the commit SPEC-0013 and SPEC-0016 reviewed. Host facts read in the
  Freelens `v1.10.3` checkout (`3da7441`), never from memory. Recon date
  2026-09-01.
- **Author / date:** Claude with Roberto, 2026-09-01
- **Recon digest:** `DIGEST-m7-console.md` (sections A-E). Every claim
  below carries its pointer into that digest.

## Goal

An operator can open a KubeSwift guest's **serial console**, and follow a
sandbox's **workload console**, from the drawer or the row kebab, in a
Freelens terminal tab, against the cluster Freelens is already connected
to - with no gateway, no bundled terminal, no new credential path and no
byte of the session passing through this extension. And, where a console
cannot exist or cannot be reached, the control says so instead of opening
a black rectangle.

## Upstream reference

- `cmd/swiftctl/console.go` - the guest console: resolve the guest,
  refuse unless `Running`, resolve the launcher pod from `status.podRef`,
  then a **`pods/exec` stream into the `launcher` container running a
  socket relay against the guest's serial Unix socket**. SPDY
  `remotecommand`, no port-forward, no gRPC, no gateway (digest A3).
- `cmd/swiftctl/sandbox.go` - `logs`, `exec`, `attach`. `logs` is the
  same exec shape with `tail -n +1 -F` on a **file**; `exec`/`attach`
  are a different channel entirely (digest B2, B4).
- `internal/gateway/console_ws.go`, `sandbox_logs_ws.go`,
  `sandbox_exec_ws.go` - the gateway's three raw-WebSocket planes. They
  perform **the same `pods/exec`** and add no transport the Kubernetes
  API does not already offer; they exist because a browser cannot speak
  the exec subresource (digest A5).
- `rust/swift-ch-client/src/config.rs` - the fork this whole spec turns
  on: a guest gets an interactive serial **socket**, a sandbox gets a
  serial **file** (digest B1).
- `rust/swiftletd/src/report.rs`, `internal/controller/swiftguest/status.go`
  - the launcher-pod annotation that becomes `status.console.serialSocket`
  (digest A2).
- kubeswift-ui `main` `c4e53ce`: `src/app/console/`,
  `src/app/sandbox-logs/`, `src/app/sandbox-exec/` - three xterm.js
  overlays over the gateway's WebSockets. **UX reference only.**

**The AGPL boundary, restated for this spec.** `kubeswift-io/kubeswift`
and `kubeswift-io/kubeswift-ui` are AGPL-3.0 and this repository is MIT
([ARCHITECTURE.md](../development/ARCHITECTURE.md), AGENTS.md). They were
read to learn **what the console mechanically is** - which socket, which
container, which file, which guard - and nothing else. No component, CSS,
UI string, status-mapping logic, proto or generated client is copied, and
the one place where copying would have been tempting is refused outright:
the guest agent's vsock frame protocol is upstream's wire format, and
this spec does not reimplement it (Scope, exclusion 3).

Host references, all MIT and copyable: the host's own **Pod Shell** menu
item (`packages/core/src/renderer/components/node-pod-menu/pod-shell-menu.tsx`),
which is the exact three-step recipe this spec restates, and the shipped
M4 log-dock affordance in `details/swiftsandbox-details-v1alpha1.tsx`.

## Scope

The two M7 rows, and an honest split inside the second one.

1. **VM serial console.** A `Serial Console` action on SwiftGuest, in
   the row kebab and the drawer toolbar (W5), that opens a Freelens
   terminal tab connected to the guest's serial socket through the
   launcher pod.
2. **The sandbox workload console tail.** A `Workload Console` action on
   SwiftSandbox, same two surfaces, that opens a terminal tab following
   the sandbox's console file inside its launcher pod - which is the
   half SPEC-0008 deferred here, and the reason it deferred it
   (digest E9).

Excluded, each with its destination:

3. **The sandbox's interactive in-guest shell (`swiftctl sandbox
   exec/attach`, upstream's "Shell" terminal) is NOT feasible from this
   extension and is not attempted.** Saying it plainly, as the brief
   requires: reaching a shell inside the microVM means opening a byte
   pipe to Cloud Hypervisor's vsock socket, performing the hypervisor's
   `CONNECT` handshake, sending a JSON request and then speaking a
   **length-prefixed binary frame protocol in both directions** (digest
   B4). None of that is expressible as a command line, no binary on the
   launcher pod's PATH speaks it (digest A3), and implementing it would
   mean reimplementing upstream's AGPL wire format inside an MIT
   repository. It goes nowhere: it returns only if upstream ships a
   client binary inside the launcher image, or if this extension one day
   grows a real stream client for other reasons. Open item O6 records
   the one honest interim answer (`swiftctl`, documented, not wired).
4. **A shell into the launcher container.** Already shipped - by the
   **host**. Freelens renders Pod Shell on every pod, and both drawers
   already link the launcher pod (`swiftguest-details-v1alpha1.tsx`,
   `swiftsandbox-details-v1alpha1.tsx`). A second control for the host's
   own feature is duplication, not parity (digest D, rejected).
5. **An extension-owned terminal widget.** Rejected in Design, not
   deferred: the host's terminal is better in every dimension that
   matters here.
6. **Restart, and any other verb.** Unchanged from SPEC-0010's
   deferral.

## Design

### What a console open mechanically IS

**For a guest.** swiftletd starts the hypervisor with serial redirected
to a Unix socket in the guest's runtime directory inside the launcher
pod; the same is true on both hypervisors, Cloud Hypervisor and the QEMU
path the HGX tiers use (digest A1, A6). Reaching it is a `pods/exec` into
the `launcher` container running a socket relay in raw, echo-off mode -
literally what upstream's own troubleshooting page tells an operator to
type from a debug shell (digest A4). Expressed against the host's
terminal:

```text
kubectl exec -i -t -n <ns> <launcherPod> -c launcher -- \
  sh -c 'for i in $(seq 1 15); do test -S <sock> && break; sleep 1; done; \
         exec socat -,raw,echo=0 UNIX-CONNECT:<sock>'
```

The wait loop is kept because upstream keeps it and it turns the one
common race - attaching while the hypervisor is still creating the socket
- into a wait instead of an error (digest A3.6). `socat` is in the
launcher image (digest A3).

**For a sandbox.** There is no socket to connect to and there never will
be: for a sandbox the hypervisor is told to write the guest console **to
a file**, deliberately, because swiftletd re-reads that file after the
hypervisor exits to recover the workload's exit code, and a socket does
not survive that exit (digest B1). So the sandbox console is **read-only
by construction**, and following it is:

```text
kubectl exec -n <ns> <targetPod> -c launcher -- \
  sh -c 'tail -n +1 -F <consoleFile>'
```

No `-i`, no `-t`, no stdin: this is a read and the command line says so
(digest B2).

**The two path rules are inverses, and this is the single easiest thing
in the milestone to get backwards** (digest A2, B3):

| Kind | Run-directory key | Because |
| --- | --- | --- |
| SwiftGuest | `<ns>-<guestName>` | keyed on the **guest**, so it survives the `<guest>-mig-<uid>` pod rename a live migration produces |
| SwiftSandbox | `<ns>-<podName>` | keyed on the **launcher pod**, so a warm-slot checkout's directory lives in the claimed slot's pod (`<pool>-slot-xxxxx`), not in a pod named after the sandbox |

The pure module owns both rules and a unit test pins each, including the
case where they coincide (a cold sandbox, whose pod is named after
itself) - which is exactly the case that hides the mistake.

**Where the guest's path comes from.** Not the convention, when the
cluster will tell us: `status.console.serialSocket` is published by
swiftletd onto the launcher pod and mapped into the CR by the controller
(digest A2), this extension already models it and the guest drawer
already renders it as the "Serial Socket" row. The convention is the
fallback. One guard on top, which the digest raises and which upstream
never has to face because neither of its clients reads the field: **that
string is a pod annotation, and it is about to be interpolated into a
command line the host types into a shell.** So the value is accepted only
if it is an absolute path with no shell metacharacter, and anything else
falls back to the derived convention. A pure predicate, one unit test per
branch.

**Every interpolated value is quoted, not only the socket.** The
namespace, the pod name, the container name, the socket path and the
console file path all end up inside a command line the host types into a
shell. Kubernetes names are DNS-1123 labels or subdomains, which the API
server already enforces and which carry no shell metacharacter, but the
pure module does not rely on that: it single-quotes every value it
interpolates, and the socket string additionally carries the stricter
absolute-path rule above. One unit case per field feeds an adversarial
value and asserts it is either quoted inert or refused (K13).

### Why a host terminal tab, and not our own terminal

Freelens exports exactly two functions for this and no third
(digest C1, all verified in the `v1.10.3` checkout):

- `Renderer.Component.createTerminalTab(tabParams?)` - opens a dock tab
  of kind terminal, taking a title and an id.
- `Renderer.Component.terminalStore.sendCommand(command, { enter, tabId })`
  - waits for that tab's shell to be ready and writes the string on its
  stdin.

Nothing else is exported: not the host's own `PodShellMenu`, not
`dockStore`, not `TerminalApi`, not `WebSocketApi`, and no `pods/exec`
client anywhere in `Renderer.K8sApi` (digest C1). So the brief's option 2
- reusing the host's pod-shell affordance for an arbitrary pod - **is
impossible as reuse**; what is reusable is its *recipe*, which is MIT,
and which this repository already has a precedent for restating rather
than importing (`components/pod-logs.ts` does exactly that for the
default-container rule).

The recipe (digest C2): compose the command line, `createTerminalTab`
with a generated id and a title, `sendCommand(line, { enter: true, tabId })`.
On non-Windows the line is prefixed with `exec` so the shell process is
replaced and the tab closes with the session - the host's own detail,
kept.

**A terminal tab is already the cluster.** The host's shell session
exports `KUBECONFIG` pointing at that cluster's proxy kubeconfig and
prepends the bundled kubectl directory to `PATH` (digest C2). So the
command runs against the connected cluster, under the user's own
credentials, with no configuration and **no permission the user does not
already have** - the same sentence SPEC-0008 earned for the log dock.

Option 3, an extension-owned xterm streaming `pods/exec` itself, is
**rejected, not deferred** (digest C3): it needs a bundled terminal, a
stream client the host does not export, the exec channel framing, a
credential path of its own, and - for the sandbox shell it still could
not deliver - upstream's AGPL frame protocol. Several times M6's entire
machinery, for affordances the host's own terminal already serves.

### The affordances (W5)

Two `kubeObjectMenuItems` registrations, one per kind, each rendered by
the host in **both** the list row kebab and the drawer toolbar, with the
`{ object, toolbar }` contract and the `<Icon interactive={toolbar} />`
plus hidden-title idiom the shipped M6 items use.

| Kind | Title | Icon | Tab title |
| --- | --- | --- | --- |
| SwiftGuest | `Serial Console` | `terminal` | `Console: <guest>` |
| SwiftSandbox | `Workload Console` | `subject` | `Console: <sandbox> (<pod>)` |

The sandbox tab title names the **pod** as well as the sandbox, because
for a checkout they differ and that difference is otherwise invisible
(digest D/S6). The guest tab title does not: its pod name is a migration
artefact, and the drawer already shows it.

These are **not** built on `menus/guest-action-menu-item.tsx`. That shell
exists to carry a confirmation dialog and a write plan (SPEC-0010); a
console item has neither. What it does share is the shape of the guard
and the click-time re-evaluation, and those come from the pure module.

### The guards (W4), and what each disabled state says

One pure function per kind, returning the shipped `ActionGuard` union
(`{ enabled: true } | { enabled: false; reason: string }`,
`components/guest-actions.ts`) so that a disabled outcome can never exist
without a reason, and a unit test asserts that over every distinguished
input. The reason is reachable in both surfaces exactly as SPEC-0010
established: the item's own `tooltip` attribute, plus the drawer's
explanation row.

**The guard reads the custom resource only, never the pod store.** This
is SPEC-0010's spike S6 verdict unchanged (`guest-actions.ts:226-231`):
from a list row the extension has no pods loaded for that namespace, so a
pod-backed guard would mean a list request per render. `launcherPodTarget`
is already written and tested for exactly this and is reused.

**SwiftGuest:**

| State | Outcome | Reason |
| --- | --- | --- |
| `phase: Running` and `status.podRef` set | enabled | - |
| `phase` anything else | disabled | names the phase, and for `Stopped` adds that a stop deletes the launcher pod, so no socket exists |
| `phase: Migrating` | disabled | the launcher pod is being replaced; the socket path does not change, so retry when the phase settles (digest A7) |
| `status.podRef` absent | disabled | the status names no launcher pod yet |
| `deletionTimestamp` present | **absent**, not disabled | DESIGN.md section 12's stated exception |
| unknown or unparseable phase | **enabled** | W4: the guard is a convenience, the API server is the authority |

Windows guests are **not** disabled. `osType: windows` skips the image
import's serial-console patch and upstream manages Windows over RDP
(digest A6), so the console is expected to be silent - but "expected" is
not "impossible", and a guest built from a serial-enabled Windows image
would work. The fact is stated in the tooltip instead of taken as a veto.

**SwiftSandbox:**

| State | Outcome | Reason |
| --- | --- | --- |
| `status.podRef` set | enabled | - |
| `status.podRef` absent | disabled | no launcher pod yet; a sandbox's first observable phase is empty, not `Pending` (SPEC-0016 correction 3) |
| `deletionTimestamp` present | absent | as above |

Deliberately **not** gated on the phase. A terminal sandbox whose pod
still exists has the most interesting console in the milestone - the
workload's whole output plus its exit marker - and upstream's Logs button
is ungated too. Where upstream is wrong is the other direction: it is
ungated even when there is *no pod*, which is the S1 improvement.

**Every guard is re-evaluated inside the click handler before anything
opens.** `MenuItem`'s `disabled` prop only adds a class and sets
`tabIndex`; what stops the click is a stylesheet rule (DESIGN.md section
12, SPEC-0010 spike S7), and a guard that lives only in CSS is not a
guard.

### The confirmation, and why there is none (W1)

W1 governs **the writes the extension performs**. Here it performs none:
no patch, no create, no delete, not one API call. What it does is compose
a command line and hand it to a terminal the host owns, where it runs
under the user's own kubectl and the user's own credentials.

The two rows still deserve separate answers, because they are not the
same act:

- **The sandbox workload console is unambiguously a read.** `tail` on a
  file, no stdin, no TTY (digest B2). It is the same standing as the M4
  "View logs" affordance, which has no confirmation either.
- **The guest serial console opens a bidirectional channel**, and what
  the user types afterwards goes to the guest's TTY. That is a way to
  change things - but it changes things **inside the guest**, which is
  not a Kubernetes object, which no controller reconciles, and which the
  extension neither performs nor observes. The extension's own act ends
  at "a terminal is now connected". Wrapping that in a modal would be
  ceremony rather than safety: a user who opens a console and types
  nothing has changed nothing, and the host itself puts no confirmation
  in front of Pod Shell, which is strictly more powerful.

What stands in the confirmation's place, and is required rather than
optional:

1. **The guard, with its reason** (W4) - which is where a mistaken click
   is actually caught.
2. **The pod named** - in the tab title for a sandbox, in the tooltip for
   both.
3. **The command line visible.** `sendCommand` types it into a shell, so
   the user sees exactly what ran, before its output, and can re-run or
   edit it. This is a stronger disclosure than any dialog: it is the
   literal act, not a description of it.
4. **The tooltip sentence**, which says what is about to happen in one
   line - and, for the cases the recon settled, what to expect from it
   (a Windows guest's silence, a checkout's buffered tail).

Considered and rejected: `sendCommand(..., { enter: false })`, which
would type the line and leave the user to press Enter - a zero-ceremony
confirmation. Rejected because it diverges from the host's own idiom for
the identical act, and a half-typed line in a fresh tab reads as a bug
rather than as a prompt.

**No RBAC pre-flight** (W7). `pods/exec` may be forbidden, and upstream
says outright that clusters restricting it do not support console access
(digest A4). The refusal arrives from the user's own kubectl, in their
own terminal, in the API server's own words - which is W9's requirement
met by construction rather than by a notification.

### What the terminal shows first

- **A guest, healthy:** the composed command line, then the socket wait
  (silent, up to fifteen seconds), then the serial stream. On Cloud
  Hypervisor v53 - the version the launcher image pins - the socket
  **buffers output written before any client connects**, so attaching
  after boot replays the boot log rather than showing an empty screen
  (digest A1). A user attaching to an idle, already-booted Linux guest
  still sees nothing until Enter, which is the guest's getty, not a
  defect, and is what the tooltip says.
- **A guest, blank forever:** one cause dominates and it is guest-side -
  no `console=ttyS0` in the kernel cmdline, or no `getty@ttyS0` enabled
  by the seed profile (digest A6). The tooltip names it. This is D/C5.
- **A sandbox, cold:** `tail -n +1 -F` starts at the first line of the
  file, so the whole console to date arrives at once and then follows
  live.
- **A sandbox, checked out from a warm pool:** *nothing, until the
  workload finishes.* A checkout's workload runs over vsock and its
  output is appended to the console file in one lump when the call
  returns (digest B5). The tooltip says so. This is the milestone's
  single most valuable sentence and no upstream surface contains it.
- **A completed sandbox:** the last line is `KUBESWIFT-EXIT-CODE=<n>`,
  emitted by the guest's bridge-init and parsed by swiftletd into the
  exit code the drawer already shows (digest B1). Named where the
  affordance is offered, so it reads as machinery rather than as output.

The extension prints **no banner into the stream**. Anything it echoed
would be indistinguishable from guest output in a terminal it does not
own; the tab title and the tooltip carry that weight instead.

### Stopped, migrating, and a replaced pod (W3)

- **Stopped** is a guard refusal with a mechanism in the reason: a stop
  is two writes and the second deletes the launcher pod (SPEC-0010), so
  there is no pod to exec into and no socket to connect to.
- **Migrating** is a guard refusal that says what *does* survive: the
  socket path is keyed on the guest, not the pod, so the same console
  returns at the destination once the phase settles (digest A2, A7).
- **A replaced or Terminating pod** is not guessed at. `status.podRef`
  can transiently name a pod that is `NotFound`, and both upstream
  clients handle it differently and imperfectly (digest A7). The
  extension does what W4 prescribes for unknown state: it permits the
  action, and kubectl reports what it finds. What it does **not** do is
  upstream's gateway behaviour of silently substituting a different pod
  (digest D/C1).
- **`status.console.serialSocket` is never used as a liveness signal.**
  The controller sets it and never clears it, so a stopped guest can
  still carry it (digest A7). It answers "where", never "whether".

### Better than upstream (W11)

Baseline: `swiftctl` v0.13.12 and kubeswift-ui `c4e53ce` - one guest
console guarded on phase alone with no explanation when disabled, one
sandbox shell that vanishes when the phase is not Running, and one
sandbox logs button with no guard at all.

| # | Improvement | Where |
| --- | --- | --- |
| K1 | The launcher pod resolved from `status.podRef`, as `swiftctl` does, where the gateway resolves by label selector only and can hand back a Terminating pod without saying so | Guest guard |
| K2 | The socket path **read from `status.console.serialSocket`** rather than reconstructed, with the convention as fallback - upstream's own code warns the convention can be wrong after a restore whose snapshot points at another run dir | Guest command |
| K3 | A disabled console **names its reason** - the phase, and for a stop the fact that the launcher pod is gone - where upstream greys the button and explains nothing | Guest guard |
| K4 | A Windows guest told, before the terminal opens, that the serial console is expected to be silent because the import skips the GRUB serial patch | Guest tooltip |
| K5 | A blank Linux console explained once, at the point of use, with the two guest-side causes named | Guest tooltip |
| K6 | The sandbox console **guarded on having a pod at all**, where upstream's Logs button is ungated and will happily open a terminal against a pod that does not exist | Sandbox guard |
| K7 | The sandbox control **disabled with a reason rather than removed**, where upstream's Shell button disappears - the vanishing control W4 forbids | Sandbox guard |
| K8 | **A checkout's tail declared non-live**: its workload runs over vsock and its output is appended only when the workload ends, so the terminal is empty until then. Three upstream surfaces present it as a live tail | Sandbox tooltip |
| K9 | The read-only-ness **explained by its mechanism**: a sandbox's hypervisor writes serial to a file, never to a socket, so there is nothing to type into - upstream says "read-only" without saying why | Sandbox tooltip |
| K10 | The `KUBESWIFT-EXIT-CODE=` marker named where the tail is offered, next to the `status.exitCode` the drawer already shows, so the last line reads as machinery | Sandbox tooltip |
| K11 | The **slot pod named in the tab title** for a checkout, which is otherwise the only place a user ever sees a slot pod (SPEC-0016's own manual list makes the same point) | Sandbox tab title |
| K12 | The command line itself visible and re-runnable, so a failure is diagnosable and a session is reproducible outside Freelens - a property no WebSocket overlay can offer | Both |
| K13 | The serial-socket string **validated before interpolation** into a shell command line, and **every interpolated value quoted**. The socket is a pod annotation; upstream never reads it and so never faces the question, and this extension will not introduce a command-injection path in exchange for K2 | Both commands |

Considered and rejected:

| Candidate | Rejected because |
| --- | --- |
| An extension-owned xterm over a `pods/exec` stream | No exported client, no exported WebSocket helper, a credential path of its own, and for the sandbox shell it still ends at reimplementing upstream's AGPL frame protocol. Several times M6's total machinery for one affordance (digest C3) |
| A "Sandbox shell" into the microVM | Not expressible as a command line at all (digest B4). Shipping a control that cannot work would be worse than saying it needs `swiftctl` |
| Composing the vsock handshake and frame protocol as an inline `python3` script - the launcher image has `python3` | It is *technically* expressible, and that is the whole trap: it would embed upstream's wire format in our source, in a form nobody can review, depending on an interpreter in an image we do not control. The recon went to the bottom of this one so it need not be revisited |
| Shelling out to `swiftctl sandbox attach` from the tab | Depends on a CLI we neither ship nor can detect; its absence is a bare "command not found" in a tab we opened. If it appears at all it is a documented note (O6), never a control |
| A "Launcher shell" item | The host already renders Pod Shell on the launcher pod, and both drawers link it. Duplicating the host is not parity |
| A confirmation dialog before opening a console | Argued above: no API call is made, the command line is its own disclosure, and the host puts no dialog in front of the strictly more powerful Pod Shell |
| Reproducing `swiftctl`'s Ctrl+O detach | The escape byte lives inside `swiftctl`'s own stdin wrapper. The terminal is the host's; we do not bind keys in it, and promising one would be inventing behaviour (W11's own limit) |
| Disabling the console for Windows guests | "Expected to be silent" is not "impossible"; a serial-enabled Windows image would work. State the fact, do not veto |
| Gating the sandbox console on `phase: Running` | A terminal sandbox with a surviving pod has the most complete console there is. Upstream's mistake here is the missing pod check, not the missing phase check |
| Using `status.console.serialSocket`'s presence as the guard | Set and never cleared, so a stopped guest still carries it (digest A7). Right for "where", wrong for "whether" |
| Streaming the console into a drawer panel instead of the dock | The dock is where Freelens users already look for terminals and logs, it survives navigation, and M4 already put this extension's other stream there |

### Where the code lives

- `components/console-commands.ts` - **pure, and the whole of the
  thinking**: both guards, both run-directory key rules, the
  serial-socket validation and its convention fallback, the composed
  command lines, the tab titles and every tooltip sentence. Structurally
  typed with no `Renderer` import, like `object-existence.ts` and
  `pod-logs.ts`, so it is unit-testable with plain objects.
- `menus/swiftguest-console-menu-item-v1alpha1.tsx` and
  `menus/swiftsandbox-console-menu-item-v1alpha1.tsx` - thin: the host
  `MenuItem` idiom, the click-time guard re-evaluation, and the two host
  calls. No dialog, so neither is built on
  `menus/guest-action-menu-item.tsx`.
- `index.tsx` - two `kubeObjectMenuItems` registrations.
- The models gain two statics only (`SwiftGuest.getPodName`,
  `SwiftGuest.getSerialSocket`); the sandbox model already has
  `getPodName`, and both status shapes are already field-complete.
- `ARCHITECTURE.md` gains the new files; `ROADMAP.md`'s two M7 rows gain
  their spec link, and the second row gains the exclusion of item 3.

### Implementation slices

**Two, and the guest goes first.**

1. **Slice 1 - the SwiftGuest serial console.** It builds everything
   that is not a command string: the pure module's shape, the guard
   union and its reason vocabulary, the serial-socket validation, the
   terminal-tab recipe, the menu-item shell for a dialog-less action,
   and the E2E technique for asserting a terminal tab and its typed
   line. It is also the row with the richest status vocabulary to guard
   against - a phase, a podRef, a hypervisor, an OS type - so the guard
   is designed against its hardest case first.
2. **Slice 2 - the SwiftSandbox workload console.** Then it is a second
   command string, the inverted run-directory rule, one extra guard
   branch and the cold-versus-checkout sentence - content rather than
   machinery, on top of a shell that already exists.

The alternative - sandbox first, on the grounds that it is a pure read
and therefore the safer thing to build first - is rejected: the safety
question is settled in this spec, not by build order, and starting with
the sandbox would mean inventing the terminal machinery on the affordance
with the weaker status vocabulary, then revisiting every guard when the
guest's four states arrive.

### Non-happy states

DESIGN.md section 6's four states, plus what is specific here.

- **No pod, no phase, nothing yet:** guard disabled with the reason. For
  a sandbox this is the *normal* first state, because its first
  observable phase is empty (SPEC-0016 correction 3).
- **`pods/exec` forbidden:** the expected failure on a locked-down
  cluster. It arrives as kubectl's own 403 in the terminal, naming the
  verb and the resource, and the extension neither pre-flights it (W7)
  nor rewrites it (W9).
- **The pod is gone between render and click:** the click-time guard
  re-evaluation catches the CR's own view of it; anything later is
  kubectl's `NotFound`, in the terminal.
- **The socket never appears:** the wait loop expires and upstream's own
  diagnostic path takes over - the guest is not writing to ttyS0
  (digest A6).
- **A store that never loads:** the guard reads the object it was handed,
  so a cold store degrades to "enabled, and kubectl will say", never to a
  silent no-op.
- **The terminal tab fails to open:** the one failure that is *ours*, and
  the only one that produces a `Notifications.checkedError` with a
  call-site-specific fallback (W9). Everything past `sendCommand` belongs
  to the terminal.
- **Both themes:** nothing new is rendered. The affordances are host
  `MenuItem`s and a host `Icon`; the terminal is the host's own,
  themed by the host.

### DESIGN.md conformance

- **W1** - argued in full above: no API write, therefore no enumerating
  dialog, with four substitutes named and one alternative (`enter: false`)
  considered and rejected in writing.
- **W2** - nothing is written into any store; there is nothing to be
  optimistic about.
- **W3** - `Migrating` and a stopped guest's dead socket are derived
  states, named, and explained in the reason rather than invented as
  values.
- **W4** - guards return the union, every disabled outcome carries a
  reason, both surfaces reach it, the click handler re-evaluates, and a
  `deletionTimestamp` makes the item absent rather than disabled.
- **W5** - one `kubeObjectMenuItems` registration per kind, both
  surfaces, the `{ object, toolbar }` contract.
- **W6, W8, W10, W12** - not engaged: no patch, no concurrency, no
  second object, no form.
- **W7** - no RBAC pre-flight; the API server answers.
- **W9** - only the tab-open failure is the extension's to report, and it
  reports it with a specific fallback. Every other failure is already in
  the user's terminal in the API server's own words, which is the rule's
  intent rather than an exception to it.
- **W11** - the two tables above.
- **Sections 4 and 6** - no new page, no new sidebar leaf, the four
  non-happy states covered.
- **The pre-review pass stays read-only** (SPEC-0006): these are action
  controls, they live in the kebab and the toolbar, and the pass does not
  open kebabs or click controls that carry no `href`. Since a console
  open has no confirmation, the second gate SPEC-0010 relied on is
  absent - so this spec's E2E cases, which own a disposable cluster, are
  the only automated surface that clicks them.

## Tests (non-regression list)

- **Unit** (`components/console-commands.test.ts`):
  - The guest guard over every distinguished state: Running with a
    podRef, each non-Running phase, a missing podRef, an unknown phase
    (permitted), a `deletionTimestamp`. Plus the invariant test
    SPEC-0010 established - **every disabled outcome carries a non-empty
    reason**.
  - The sandbox guard: podRef present, podRef absent, terminal phases
    permitted, `deletionTimestamp`.
  - **The two run-directory rules, and their inversion**: a guest's key
    from the guest name (including one whose pod name differs, the
    migration case); a sandbox's key from the pod name (including the
    checkout, where the two differ, and the cold case, where they
    coincide).
  - The serial-socket source: the status field preferred; the convention
    used when it is absent; and **the validation** - an absolute clean
    path accepted, a value carrying a shell metacharacter rejected in
    favour of the convention (K13), one case per rejection class.
  - The composed command line for both kinds, asserted as a string:
    container, namespace, pod, the `-i -t` on the guest and its absence
    on the sandbox, the wait loop, the path, and the quoting of every
    interpolated value with one adversarial input per field.
  - Tab titles, including the checkout's pod suffix.
  - Every conditional tooltip sentence: the Windows one, the blank-console
    one, the cold-versus-checkout pair, the exit-code marker.
- **Integration**: unchanged.
- **E2E** (`e2e/__tests__/kubeswift-e2e.tests.ts`), per slice. The honest
  split, stated once: **no KubeSwift controller runs in the E2E cluster
  and the shipped launcher-pod fixtures are deliberately unschedulable**
  (`e2e/fixtures/55-launcher-pods.yaml`), so a `kubectl exec` against
  them cannot connect. What the suite proves is therefore the wiring and
  the words, plus one case that proves the transport - which is the part
  that can regress silently.
  - The technique, and why it works: Freelens's terminal loads no
    canvas or WebGL renderer, so xterm uses its DOM renderer and **the
    typed command line is real text in the DOM**, readable by Playwright
    (digest C4). The M4 log-dock case is the precedent for asserting the
    dock tab itself (`.Dock .Tab` by text) and for being the last UI case
    in the file, because the dock covers the page underneath it.
  - *Slice 1*: the Serial Console item on `e2e-guest-running` opens a
    terminal tab titled after the guest and types a command naming
    `e2e-guest-running-launcher`, the `launcher` container and the
    guest-keyed socket path; the item is **disabled with its reason** on
    a stopped fixture and on one whose status names no pod; and the
    reason is present in both the kebab and the drawer toolbar.
  - *Slice 2*: the Workload Console item on `e2e-sandbox-running` types
    a `tail -n +1 -F` command naming the sandbox's own launcher pod and
    the pod-keyed path; on `e2e-sandbox-pooled` it names
    **`e2e-sandbox-pool-slot-1`** and *not* the sandbox - the B3
    inversion asserted as a string, which is the one assertion that
    would catch the milestone's likeliest bug; and it is disabled with
    its reason on a sandbox with no podRef.
  - *One transport case, and one new fixture* (O5): a single schedulable
    pod running a sleeping shell, with a file the case can tail, so that
    exactly one assertion proves that a `kubectl exec` **issued from a
    terminal tab Freelens spawned actually connects and echoes**. Without
    it the suite proves that we type the right string and never that the
    string works. Cost, stated because it is a first for this suite: it
    is the only fixture that pulls an image, and `cluster-up.sh`
    preloads none today.
- **Manual verification** (escalated to Roberto, PROCESS.md), on a real
  KVM cluster - which is where everything that matters is actually
  proved: a Linux guest's console reaching a login prompt and accepting
  keystrokes; the **boot-log replay** on an attach after boot (the CH v53
  buffering); a guest with no `getty@ttyS0` staying blank, matching what
  the tooltip predicts; a **Windows** guest's silence; a **live
  migration** followed by a reconnect, confirming the pod name changed
  and the socket path did not; a **stop** making the control disabled
  with the right reason; a cold sandbox's console following **live**; a
  **warm-slot checkout's** console staying empty until the workload ends
  and then arriving whole (K8 rests on this, and it is the single most
  important manual check in the milestone); the `KUBESWIFT-EXIT-CODE=`
  line present on a completed sandbox; and, if a guest is available whose
  `status.console.serialSocket` disagrees with the convention, that K2
  is the one that works. Record date, tester and result here.

## Open items

- **O1. Can `status.console.serialSocket` actually go stale in
  practice?** Static reading says yes - it is set and never cleared, and
  the code path that sets it is skipped when the pod is absent (digest
  A7). It changes nothing in the design, which already refuses to use the
  field as a guard, but a live confirmation would let the tooltip be
  blunter.
- **O2. Is the fifteen-second socket wait the right number?** It is
  upstream's. If a real attach shows the socket is always already there,
  the loop is noise on the command line and could go.
- **O3. Is a Windows guest's console always silent?** The import skips
  the serial patch; whether the firmware or a serial-enabled image
  produces anything is unverified. K4's sentence is worded as an
  expectation, not a fact, until this is settled.
- **O4. Does a checkout's console file really stay empty until the
  workload ends?** The mechanism is unambiguous in the source (digest
  B5); the observation is not yet made. K8 is the improvement that rests
  most heavily on a single manual check.
- **O5. The transport E2E fixture.** Whether to add the one schedulable
  pod and accept the first image pull in the E2E cluster, or to keep the
  suite wiring-only. Recommendation: add it, for one pod and one case.
  **Accepted at approval (2026-09-01)**: slice 1 adds the pod and the
  case.
- **O6. `swiftctl` as the documented answer for the in-guest sandbox
  shell.** Whether TRY-IT.md should say "for a shell inside the microVM,
  use `swiftctl sandbox attach`" - a documentation sentence, not a
  control. It is the only honest answer this extension has for the
  excluded row, and it costs nothing. **Accepted at approval
  (2026-09-01)**: slice 2 adds the sentence.
- **O7. Whether the two rows want a third: a guest console that is
  read-only.** Not proposed. Recorded because the recon makes it
  possible (`socat` can be told not to forward stdin) and someone will
  ask. It would need a reason a plain console does not already serve.

## Notes and deviations

Filled during implementation when reality diverges from the plan.

### Serial console as implemented (2026-09-01)

Slice 1, as planned. The M6 machinery was reused unchanged where it fits
and deliberately not reused where it does not: the `ActionGuard` union,
`launcherPodTarget` and the phase constants of `guest-status.ts` are the
shipped ones, the `{ object, toolbar }` contract and the
`<Icon interactive={toolbar} />` idiom are SPEC-0010's, and the click-time
guard re-evaluation is the same three lines - but the item is **not**
built on `menus/guest-action-menu-item.tsx`, because that shell exists to
carry a confirmation and a write plan and this action makes no API call
at all. Nothing in `components/create-dialog.tsx` is touched; nothing in
`guest-actions.ts` changed.

**The typed model needed two statics and no field.** `SwiftGuestStatus`
already declared `console.serialSocket`, `podRef` and `phase`, and the
drawer already rendered the Serial Socket row, so the spec's "the models
gain two statics only" was exact: `SwiftGuest.getPodName` and
`SwiftGuest.getSerialSocket`, both used by the drawer.

**Three host facts were read in the `v1.10.3` checkout and then proved
live in the E2E run, never recalled:**

1. `Renderer.Component.createTerminalTab(tabParams?)` and
   `Renderer.Component.terminalStore.sendCommand(command, { enter, tabId })`
   are exported, take the shapes the digest recorded, and the tab's shell
   session really carries the cluster's kubeconfig and the bundled
   kubectl on its `PATH` - the transport case is the proof, since the
   line it types resolves `kubectl` and reaches the cluster with no
   configuration of ours.
2. **A shell that exits does not close the tab.** The session writes
   `[Process exited with code N]` into the terminal and leaves the
   websocket open; only a closed websocket makes the terminal dock tab
   close itself. This is what makes the E2E cases possible at all: the
   `exec` prefix means the session ends within a second or two of the
   command, and a tab that vanished with it could not be read.
3. `Common.App.Preferences.getKubectlPath()` is empty on a default
   install, so the bare name is what the line carries.
4. **The host renumbers the tab title.** `dockStore.createTab` appends a
   parenthesised counter when the new tab is the Nth of its kind, and Freelens always
   keeps one `Terminal` tab in the dock, so a console tab is titled
   `Console: <guest> (2)` on a fresh window. The title this spec chose is
   the prefix; the suffix is the host's, it is what Pod Shell gets too,
   and the E2E cases match on the prefix rather than fighting it.

These are the places the implementation is more specific than, or
different from, the text above:

- **The guard tests the two explaining phases BEFORE the pod reference.**
  The Design's table lists `Running` + `podRef` first and `podRef`
  absent as its own row, which leaves the overlap unstated: a stopped
  guest has no `podRef` either, and both rows are true of it. The
  implementation answers with the sentence that carries the mechanism
  (`Stopped`: a stop deletes the launcher pod) rather than the one that
  reports the symptom, and the unit test pins that order. Same for
  `Migrating`.
- **An absent phase with a pod named is treated as unknown, and
  permitted.** The table has a row for "unknown or unparseable phase" and
  a row for "phase anything else", and an absent phase is arguably in
  neither. W4 settles it: unknown state permits the action, so a guest
  whose status names a pod but carries no phase gets the console and
  kubectl says what it finds. A guest with no `podRef` is still disabled,
  because without a pod name there is no command to compose.
- **`Migrating` is not a phase this KubeSwift version can report.** The
  `v0.13.12` SwiftGuest enum allows `Pending`, `Scheduling`, `Running`,
  `Stopped` and `Failed` and nothing else, so during a live migration the
  phase stays `Running` and the branch cannot fire. It is implemented
  anyway, as the spec names it: if a controller ever reports the
  interval, the console says what survives it instead of falling through
  to the unknown-phase permit and saying nothing. Recorded here because
  the Design section reads as though the phase existed.
- **The socket validation is an allowlist, not a metacharacter
  denylist.** The spec says "an absolute path with no shell
  metacharacter"; the code accepts `[A-Za-z0-9._/-]` only. Stricter on
  purpose, and one class it excludes is not a shell character at all: a
  comma or a colon in the path would smuggle an extra option into
  `UNIX-CONNECT:<path>` through **socat's own address grammar**, without
  touching the shell. Everything a real KubeSwift path contains is inside
  the allowlist.
- **Both surfaces of the reason, and a third.** The item's `title`
  attribute reaches the kebab and the drawer toolbar, as SPEC-0010
  established. The drawer's own explanation is a **new row**, `Serial
  Console`, rather than the Condition row SPEC-0010 used: the Condition
  row explains the phase, and this reason is about the launcher pod and
  the socket inside it, which the phase does not say. The whole sentence
  is the row's text and not only its tooltip (DESIGN.md section 7).
- **W9's boundary is one `try`, not two.** The spec says the tab-open
  failure is the only failure the extension reports. `sendCommand`
  returns a promise, so leaving it outside the `try` would turn a
  rejection into an unhandled one nobody attributes to the click. Both
  calls sit in the same `try` with a single call-site fallback, which
  keeps one notification per failed console open. Everything past a
  successful send is still the terminal's.
- **The E2E transport fixture ships a stub `socat`.** O5 asked for one
  schedulable pod so that a case could prove the exec connects. The pod
  is `docker.io/library/busybox` pinned by tag, in a container named
  `launcher`; its startup writes a `socat` that prints a marker and its
  own arguments, because the real relay lives in KubeSwift's launcher
  image, which this cluster has no copy of and no licence to build. The
  case therefore proves the transport - a `kubectl exec` typed into a
  Freelens terminal tab reaches into a container and brings its output
  back, carrying the relay arguments the extension composed - and not
  what socat does with them, which stays in the manual list. Same
  fixture, second job: it carries no `status.console.serialSocket`, so it
  is also the end-to-end proof of the derived-convention branch.
- **The image is pulled by the kind node, not loaded into it.** The spec
  suggested considering `docker pull` plus `kind load docker-image` in
  `cluster-up.sh`. Rejected: it reaches the same registry while adding a
  dependency on the developer's docker credential store (which hangs on
  a macOS Docker Desktop configured with `credsStore: desktop`) and on
  the host already having the image. `cluster-up.sh` waits for the pod to
  be Ready instead, so the pull fails loudly at setup rather than
  flakily inside a case.
- **Closing a console while its command still runs makes the HOST log an
  error (host fact, 2026-09-01).** Killing the shell process of a tab
  whose `kubectl exec` is mid-upgrade leaves the host's kubectl proxy
  with a dial nobody awaits, and it reports that at error level:
  `[UPGRADE-PIPE] dial 127.0.0.1:NNNNN failed: dial tcp ...: operation
  was canceled`, printed at the same instant as the host's own
  `[SHELL-SESSION]: Killing shell process (pid=...)` and `shell has
  exited`. Nothing in this extension emits it and nothing in this
  extension can suppress it - it is what Freelens does whenever a
  **connected** console is closed, so a user who closes a live serial
  console in the real app produces the same line. Worth raising with
  upstream Freelens (candidate for the feedback list): an expected
  cancellation logged at error level is a level question, not an error.
  The E2E rule that follows: **a console tab is closed only after its
  command has ended**, otherwise the host proxy logs the cancelled
  upgrade at error level and the activation case - whose collector reads
  every `error:` line of the main process - fails with it. `closeDockTab`
  therefore waits for `[Process exited with code` before it clicks the
  close control, which every console case can satisfy: the unschedulable
  launcher pods make kubectl exit by itself ("unable to upgrade
  connection: pod ... does not have a host assigned") and the transport
  case's exec ends with code 0. Found on Linux CI, where the exec was
  still connecting when the tab closed; on macOS kubectl had already
  exited, so the same suite passed there - the usual shape of a
  timing-dependent defect.

Open items touched: **O5 is done** - the fixture and the case are in.
**O2 stays open**: the fifteen-second wait is still upstream's number,
and the transport case watches it expire rather than measuring what a
real hypervisor needs. O1, O3, O4 and O7 are untouched, and O6 belongs to
slice 2.

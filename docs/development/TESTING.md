# Testing strategy

Every feature ships with tests at every layer that applies. A feature
without its non-regression tests is not done (see
[PROCESS.md](PROCESS.md)).

## Layers

### 1. Unit tests (vitest, `pnpm test:unit`)

- Every CRD model: construction from a realistic fixture object, helpers
  (phase, refs, derived values), edge cases (empty refs, missing status).
- Every pure helper and every component with logic worth isolating.
- Fixtures are hand-written from the CRD schemas, never copied from
  KubeSwift code or docs verbatim.

### 2. Integration tests (existing harness, `integration/`)

The harness downloads a real Freelens, installs the built extension, and
drives it (`integration/__tests__/extensions.tests.ts`: the extension
installs, is listed as enabled, and activates without errors). Keep it green
on every PR.

Both this suite and the E2E one run **inside a checkout of
`freelensapp/freelens`**: their files are copied next to the Freelens ones,
under `integration/__tests__` and `integration/helpers`, and are run by the
Freelens `test:integration` script, which owns the Playwright/Electron launch
helpers (`../helpers/utils`). That is why relative imports of `../helpers/*`
resolve when the tests run but not inside this repository, and why
`integration/` is outside the `tsconfig.json` include list.

`integration/helpers/` holds what the two suites share: the error collector,
the extension install flow, and the cluster, sidebar and table helpers.

### 3. E2E tests (Playwright, against a kind cluster)

A disposable `kind` cluster with the KubeSwift CRDs applied and **fake
resources with simulated statuses** written by our fixtures (no KVM, no real
VMs), driven through a real Freelens by Playwright's Electron API.

#### Prerequisites

- A running Docker daemon, plus `kind` and `kubectl` on `PATH`.
- A checkout of `freelensapp/freelens` in `./freelens` (gitignored), with the
  app already built (`pnpm build` and the electron-builder step, as in
  `.github/workflows/e2e-tests.yaml`). Point `FREELENS_DIR` elsewhere to use
  another checkout.

#### Commands

| Command | What it does |
| --- | --- |
| `pnpm e2e:cluster:up` | Creates the cluster, applies the CRDs, the fixtures and their statuses |
| `pnpm e2e:cluster:down` | Deletes the cluster and its kubeconfig |
| `pnpm e2e` | Cluster up, run the suite, cluster down |

`E2E_KEEP_CLUSTER=1 pnpm e2e` leaves the cluster running for inspection.
`pnpm e2e:cluster:up` is idempotent, so it doubles as "re-apply the fixtures".

#### Layout

- `e2e/scripts/` — cluster lifecycle. `lib.sh` is the single place where the
  KubeSwift version, the kind and Kubernetes versions, the cluster name and
  the kubeconfig path are pinned.
- `e2e/fixtures/` — hand-written custom resources for the six M1 and the four
  M2 CRDs, in numbered files applied together. `fixtures/status/` holds the
  merge patches applied to the status subresources with `kubectl patch
  --subresource=status`, since no KubeSwift controller runs in the cluster.
  Each pair of fixtures is chosen to cover a state its views distinguish, so
  the suite can assert both branches (a Ready snapshot and an uploading one, a
  finished migration and one mid transfer, and so on).
- `e2e/__tests__/kubeswift-e2e.tests.ts` — the suite: it installs the packed
  extension, connects the cluster, points the namespace filter at the fixture
  namespace, then opens every KubeSwift page and asserts the fixture rows and
  one detail panel per CRD.

**Since M6 the suite also writes** (SPEC-0010, SPEC-0011, SPEC-0012,
SPEC-0013, SPEC-0014, SPEC-0015, SPEC-0016): a handful of cases patch `spec.runPolicy`, delete a
launcher pod, delete a guest, create a SwiftSnapshot, create a SwiftRestore,
create a SwiftMigration and create SwiftGuests, SwiftGuestClasses,
SwiftKernels, SwiftImages and SwiftSeedProfiles from those pages' own create
buttons, for real, against dedicated
fixtures nothing else reads (`160-swiftguest-actions.yaml`,
`170-swiftrestore-actions.yaml`, `180-swiftmigration-actions.yaml`,
`190-swiftguest-create.yaml`, `195-swiftguest-create-volumes.yaml`,
`200-create-form-references.yaml`, `205-swiftguestpool-create.yaml`,
`210-sandbox-create.yaml`). They
assert the UI **and** read the result back with `kubectl`, because the point of
a write case is that the cluster changed. What they must never assert is what a
controller would do next: no reconciler runs here, so a stopped guest never
reaches `phase: Stopped`, the derived `Stopping` badge is permanent, and a guest
created from the form stays phaseless forever - which is what makes them cheap
to assert, and what nobody should later "fix". The create cases name the guests
they write after the wall clock, because `pnpm e2e:cluster:up` is idempotent
rather than destructive and a second run against a kept cluster must not collide
with what the first one wrote.

The Create Guest cases cover all three boot sources, one create per source read
back key-exact: an image-boot guest with its eight fields, a kernel-boot one
(`kernelRef` plus the `kernelCmdline` override, `osType: linux`, no seed and no
storage - a kernel-boot guest clones no root disk), and two clones, one from a
`local` capture (no target node, the explicit `regenerate` list) and one from an
`s3` capture (submit disabled with its reason until a node is picked, then
`targetNode` in the object). The rest of the slice-2 cases assert what the form
refuses or explains: the not-Ready kernel's will-wait line, the snapshot picker
that leaves the disk-only and not-Ready captures out and counts them, the
gone-source warning that never blocks, and the node the kernel-node label rule
disables. Their fixtures are `e2e-kernel-pulling`, `e2e-snapshot-create-s3` and
`e2e-snapshot-create-orphan` in `190-swiftguest-create.yaml`, with SPEC-0011's
`e2e-snapshot-memory-ready` reused for the local clone.

The slice-3 cases cover the form's collapsed tail. One writes a whole guest -
two data disks (one image-backed, one blank), two `NodePort` ports, an
additional bridge interface and a GPU profile - and reads it back key-exact,
asserting both the keys the form sent and the ones the API server stamped into
them (`network.binding`, `ports[].protocol`, `interfaces[].type`,
`blank.volumeMode`), because the form deliberately sends none of the second set.
Three assert what it refuses and why: the port rules (a second port without a
name, a mixed `expose`, an `expose` under a `bridge` binding, with the section
staying open while it holds an error), the data-disk rules (`attachAsDisk`
against a `Filesystem` claim, a source that cannot be doubled, the ninth disk),
and the GPU section replaced by its guard's reason on kernel boot and on the
Windows image. The fifth asserts the Guests page fix: the virtualized list's
clearance, that the last row's kebab no longer intersects the host's floating
create button, and that it opens from a plain click. Their fixtures are
`e2e-data-block` and `e2e-data-filesystem` in
`195-swiftguest-create-volumes.yaml` - the first objects in this suite that are
not custom resources, because `attachAsDisk` is the one rule that reads an
object KubeSwift did not create - with the M3 GPU profiles and the M1
`e2e-ubuntu-2404` image reused as they are.

The SPEC-0014 slice-1 cases add the two smallest create forms. Two write and
read back key-exact: a **cluster-scoped** guest class, which is the first object
this suite creates with no namespace at all, asserting the storage trio it sent
and the `coreScheduling: off` the API server stamps from the CRD's own default
(the form never sends it); and a kernel, whose four leaves are exactly what was
typed because nothing is stamped on that kind. Two assert refusals with their
reasons: the class's CEL rule in both of its shapes, including the one upstream
misses where the volume mode is not set at all, and the kernel's padded image
reference and newline command line. One asserts an absence and the sentence
standing in its place - the cluster-scoped kind offers no namespace control -
and the last asserts that a warning does not block: no node of the E2E cluster
carries `kubeswift.io/kernel-node`, the summary says so before the write, and
the write happens anyway. Their fixture is `200-create-form-references.yaml`:
two StorageClasses behind a provisioner that does not exist, and an image-pull
Secret whose auth map is empty rather than fake. No status patches are needed,
because nothing has to bind for a picker and a readback.

The SPEC-0014 slice-2 cases add the two forms that needed new shapes. Three
write and read back key-exact: an **OCI image pinned by digest**, asserting the
two Secret references it sent, the absent tag, the absent `rootDisk` (10Gi is a
controller constant, not a stamped value) and the `osType: linux` and
`cloneStrategy: copy` the API server stamps from the CRD's own defaults; an
image whose `.qcow2` URL is declared `raw`, which is warned about as a guess
about a filename and submitted anyway (W12); and two seed profiles, one whose
user data is a **Secret key** and one whose user data is a **ConfigMap key**,
each read back as a selector carrying exactly a name and a key - no `optional`,
which nothing reads, and no empty name, which the core API would have defaulted
in. Four assert what the forms refuse or cannot express: the snapshot strategy
without a volume snapshot class (with the field created inside the collapsed
section rather than hidden by it), an OCI source with neither a tag nor a digest
in both directions of the pin-by control, the CEL rule's own words for empty
user data, and the inline-beside-a-reference shape upstream's own edit path
produces, which here has no state to exist in. Their fixture is the slice-2 half
of `200-create-form-references.yaml`: an opaque cosign-key Secret, and a Secret
and a ConfigMap carrying `user-data` and `network-config` keys - the keys are
what the key-in-object selector's second control is a picker over, so their
names are part of the fixture's contract. The slice-1 `dockerconfigjson` Secret
is reused as the image's registry credentials, because that is exactly the type
that field wants. No status patches are needed here either.

The SPEC-0015 cases add the form that embeds another one. One writes a pool of
three - an image-boot template with a class, a seed profile and a run policy,
one per-replica claim template and a ClusterIP Service - and reads it back
key-exact, asserting the pool's own fields, the `spreadPolicy: Pack`,
`service.type: ClusterIP` and `ports[].protocol: TCP` the API server stamps, the
absent `updateStrategy` that proves the form sent no rollout, and above all that
`spec.template.spec`'s key set is **the same constant** the standalone Create
Guest case asserts for the same choices: the composition property of the unit
suite, proved against the API server itself. Two assert the traps the pool
controller's verbatim copying creates and the count that makes them traps: a
template MAC is refused above one replica, named with the row and the count, and
offered again the moment the count comes back to one; and a node pin only warns,
in the summary and at the field, with `nodeName` unchanged in the readback,
because a pinned pool is legitimate and a warning never blocks. The other three
assert what the form drops, refuses and cannot know: the template's ports
control replaced by the fact that the pool's Service ports become every
replica's, with no `network` block at all in the readback; the `0`/`0` rollout
refused with its reason and released when either pace field moves; and a guest
that already holds the replica name `e2e-pool-taken-1` warned about with its
index and not blocked. Their fixture is `205-swiftguestpool-create.yaml`: that
one guest, and a storage class behind a provisioner that does not exist, so
nothing is ever provisioned and nothing has to be cleaned up.

The SPEC-0016 slice-1 cases add the Create Sandbox Pool form, and the first of
them proves something on the API server that no unit test can: a create that
never mentions `memory` is **admitted**, although the CRD lists it as required,
because structural-schema defaults are applied before `required` is validated -
so the readback carries the `512Mi`, the `cpu: 1` and the `rootfsMode: block`
the form deliberately never sends, plus the `mountPath: /model` stamped inside
the model block it does. `spec.network` is asserted **absent** in the same
breath, because `network.mode`'s default lives inside a block this form omits,
which is what makes the absence a proof of what was sent rather than an
accident. The other three assert what the form refuses and warns: the warm cap
below the floor, refused with the silent fold as its reason and released the
moment either count moves; the HGX-tier GPU profile, refused with the reason
upstream reports nowhere at all, with the collapsed section that opens itself
and cannot be shut while it holds the refusal; and the name a pool already
holds, warned about and never blocked, with `kubectl` proving that a cancelled
dialog wrote nothing at all. Their fixture is `210-sandbox-create.yaml`, whose
one object is the pool whose name is taken - no status is injected for it,
because a pool nothing has reconciled is exactly what this form creates on a
cluster with no controller, and nothing is registered in `lib.sh`. Everything
else they need is reused as it stands: the two Secrets of
`125-sandbox-references.yaml`, the kernel of `30-swiftkernels.yaml` and both
GPU profiles of `110-swiftgpuprofiles.yaml`, whose `hgx-shared` tier is what
the refusal is measured against.

The pre-review pass (layer 4) stays read-only by construction and by assert,
because it runs against the demo cluster a human reviewer is about to walk
through.

A freshly connected cluster shows the `default` namespace only, not all of
them, so the suite moves the namespace filter once after connecting.
Otherwise every namespaced list looks empty while cluster-scoped ones (the
SwiftGuestClasses page) still fill, which is the signature of that mistake.

When an assertion fails the suite screenshots the window into
`e2e-artifacts/` and reports the rows, or the sidebar test ids, it did find.
CI uploads that directory as an artifact when the job fails.

The CRDs are fetched from `kubeswift-io/kubeswift` at the pinned tag when the
cluster is created. Nothing from KubeSwift is vendored into this repository
(it is AGPL-3.0, this extension is MIT — see
[ARCHITECTURE.md](ARCHITECTURE.md)).

#### What the suite never touches

- The developer's `~/.kube/config`: `kind` writes to a dedicated kubeconfig
  under `.e2e/`, and the suite copies it into the sandboxed Freelens user data
  directory (`<FREELENS_INTEGRATION_TESTING_DIR>/Freelens/kubeconfigs`), which
  Freelens always watches. Freelens resolves `~/.kube` through
  `os.userInfo().homedir`, which ignores `$HOME`, so a sandboxed HOME would
  not have been enough.
- The Freelens checkout's own tests: our files are copied in under their own
  names and selected by name when the runner starts.

Runs in CI on every PR through `.github/workflows/e2e-tests.yaml`.

### 4. Agent-driven testing during development, and the pre-review pass

While developing, coding agents must verify their UI changes live, not just
by compiling: launch Freelens with the extension and the kind fixture
cluster, then drive it with Playwright to inspect the rendered pages
(assert the list shows the fixture guests, open the detail panel, screenshot
for the PR). Findings go into the PR description.

Before every human milestone review session, the same machinery runs as the
**pre-review agent pass** (`pnpm pre-review`, see
[SPEC-0006](../specs/SPEC-0006-pre-review-agent-pass.md)): every view and
every drawer, both themes, screenshots plus DOM asserts of the statically
checkable [DESIGN.md](DESIGN.md) rules, with a report handed to the
reviewer. The human session covers only judgment calls and what cannot be
automated (rule set by Roberto on 2026-08-28, after the first review
session found that 4 of its 5 findings were automatable).

Nothing is verified only once: every check of the pass that can be
codified graduates into the E2E suite (layer 3) as a permanent
non-regression test. Exploratory verification is allowed to stay
exploratory only until it stabilizes.

## Non-regression policy

- Each spec lists its regression tests by name (test file + case).
- CI runs all layers on every PR; a red layer blocks merge.
- When a bug is found (by CI, manual testing, or in the field), the fix PR
  must add a test that fails without the fix. No silent fixes.
- A test weakened to tolerate an unexplained difference (a platform, a
  timing, a runner) carries that tolerance only until the difference is
  explained. Once the cause is found and fixed, the tolerance is removed in
  the follow-up, or the weakened assert silently becomes the contract. The
  E2E drawer-link check is the worked example: it accepted a reference row
  that stayed plain text while the packed Linux build's behavior was a
  mystery (issue #38), and stopped accepting it the moment the cause was
  understood.

## Manual testing

What cannot be automated is escalated to Roberto following the protocol in
[PROCESS.md](PROCESS.md) ("Manual testing escalation"), and its outcome is
recorded in the spec. Current known manual-only areas: behavior against a
real KVM cluster with running VMs, GPU views with real hardware, console
interaction latency, and the overall look and feel inside a real Freelens
on Windows, Linux, and macOS (agents verify rendering via Playwright
screenshots, not the lived experience).

In addition to ad-hoc escalations, every milestone ends with a structured
manual review session in a real Freelens: see "Milestone manual review
gate" in [PROCESS.md](PROCESS.md) and the procedure in
[TRY-IT.md](TRY-IT.md) (`pnpm demo:up`).

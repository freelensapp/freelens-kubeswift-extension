# SPEC-0001: SwiftGuest read-only list and detail views

- **Status:** Verified (merged; the non-regression suites run green in CI on
  main)
- **Milestone:** M1
- **KubeSwift version reviewed:** v0.13.12
- **Author / date:** Claude with Roberto, 2026-08-27

## Goal

An operator opens a cluster in Freelens and sees the KubeSwift virtual
machines (SwiftGuest) of the cluster: which exist, their phase, where they
run, their IP, and full per-guest detail.

## Upstream reference

kubeswift-ui: guest list (explorer/overview) and `guest-detail`. KubeSwift
docs: `docs/crds.md` (SwiftGuest section). Schema:
`config/crd/bases/swift.kubeswift.io_swiftguests.yaml`.

## Scope

Included: typed model for the full `swiftguests.swift.kubeswift.io/v1alpha1`
schema; cluster page with the SwiftGuest list; detail panel; "KubeSwift"
sidebar group with its icon.

Excluded: any write action (start/stop, delete → M6), console (M7),
wide-view columns (Hypervisor, OS, Service, Egress — possible later
addition for `kubectl get sg -o wide` parity).

## Design

- List columns: Name, Namespace, Phase, Node (host `LinkToNode`,
  `status.nodeName`), IP (`status.network.primaryIP`), Restarts
  (`status.restartCount`), Age. Fallback "N/A" for missing phase/IP.
- Detail panel: phase, runPolicy, osType, referenced objects
  (guestClassRef, imageRef or kernelRef, seedProfileRef, gpuProfileRef),
  runtime (hypervisor, pid), network (primaryIP, interfaces), restart
  info, conditions via the host `KubeObjectConditionsDrawer`.
- Model: KubeObject + KubeApi + KubeObjectStore statics pattern; the whole
  spec/status typed (including fields not yet rendered: cloneFromSnapshot,
  dataDisks, filesystems, migration, network, storage, vhostUserDevices,
  gpu) so later specs reuse the model unchanged.
- Fields without an enum in the CRD schema are typed as `string` even when
  docs list known values (e.g. `runtime.hypervisor`).
- `status.gpu.partitionId === -1` means "no partition"; hidden by the
  `getGpuPartitionId` helper (single place to change if the sentinel
  changes upstream).

## Tests (non-regression list)

- Unit: `src/renderer/api/kubeswift/swiftguest-v1alpha1.test.ts` — 11 cases
  (construction from fixture, phase/node/IP/restart helpers, boot source
  resolution with empty-string refs, osType default, GPU partition
  sentinel).
- Integration: `integration/__tests__/extensions.tests.ts` — the packed
  extension installs, is listed as enabled, and activates without renderer
  or process errors. Asserting that the KubeSwift page opens and the guest
  list renders is a follow-up on top of this harness.
- E2E: `e2e/__tests__/kubeswift-e2e.tests.ts` — "lists the SwiftGuests with
  their phase, node and address" asserts the row of the running fixture
  guest (phase `Running`, node, IP and restart count), the row of the guest
  left without a status (`N/A`), and its detail panel (phase, hypervisor,
  primary IP, boot image). Fixtures: `e2e/fixtures/50-swiftguests.yaml` and
  `e2e/fixtures/status/swiftguest-e2e-guest-running.yaml`.
  "navigates the SwiftGuest drawer's Node and Pod links to objects that
  actually exist" (added for issue #23) asserts two things per row: that the
  row renders as a link at all, and that clicking it lands on a real,
  non-error detail drawer (the no-dead-links invariant the fix guarantees).
  It waits (bounded) for the existence check to upgrade the row before
  deciding, so a slow runner is not read as a missing link, but a row still
  plain text after that wait fails the test: both referenced objects are
  guaranteed by the fixtures (the node name is substituted with the real
  cluster node, the launcher pod is created), so nothing here has a reason
  to degrade. Fixture: `e2e/fixtures/55-launcher-pods.yaml`.
- Manual verification: none required for read-only views against the
  fixture cluster; behavior against a real KVM cluster is a known
  manual-only area (TESTING.md).

## Notes and deviations

- This spec is the first one of the repository and was written after the
  implementation, from the code that is being merged with it.
- The scaffold's AGENTS.md described `renderer/api/gateway-api/` paths that
  do not exist; the implementation followed the real repo layout
  (`renderer/api/<group>/`, flat `pages/`, flat `details/`).
- Every ref `name` in the schema has `default: ""`; the model treats empty
  string as unset.
- 2026-08-28: header cells gained explicit column ids to enable the host's
  column resizing (issue #27).
- 2026-08-28: fixed the detail drawer's Node and Pod rows always rendering as
  links, even when the status named an object that did not exist (issue #23,
  found by the pre-review pass of SPEC-0006). Core's `LinkToNode`/`LinkToPod`
  only format a details URL from the name, never checking the target is
  there, so clicking such a link surfaced the host's own
  "Resource loading has failed" panel. `swiftguest-details-v1alpha1.tsx` now
  looks the name up in `Renderer.K8sApi.nodesStore`/`podsStore` (via the new
  pure helper `src/renderer/components/object-existence.ts`, unit-tested) and
  degrades to plain text with `WithTooltip` when the object is absent. The
  E2E fixture that exposed this (`e2e-guest-running`'s injected `podRef`
  named a launcher pod nothing ever created) now has a real, deliberately
  unschedulable `Pod` fixture
  (`e2e/fixtures/55-launcher-pods.yaml`), and its injected `nodeName` is
  substituted with the real cluster node rather than hardcoded (see
  SPEC-0006 "Notes and deviations" for the pass-side detection this
  regression exposed).
- 2026-08-28: sidebar/page-header title humanized to "Guests" (`crd.title`),
  dropping the redundant "Swift" prefix (issues #24, #29); the `SwiftGuest`
  kind is unchanged in drawer titles and data contexts.
- 2026-08-29 (issue #38): the existence check above only works if the store
  it reads is actually populated, and the `ensureLoaded` one-shot that filled
  it did not do so reliably. On the packed Linux app in CI the Node and Pod
  rows stayed plain text forever, while the same build filled the stores
  within seconds on a locally built macOS app - with no
  `[KubeObjectStore] loadAll failed` warning to explain the difference. Two
  host behaviors make that silent outcome possible: `loadAll()` called
  without `namespaces` falls back to the cluster frame's context namespaces
  (the UI namespace filter), and for a namespaced store listing an empty
  namespace list loads nothing while still setting `isLoaded`, after which an
  `isLoaded`-guarded one-shot never retries; and a load that fails without an
  `onLoadFailure` callback leaves `isLoaded` false forever after a single
  warning. The drawers now use `useReferenceStores`
  (`src/renderer/components/reference-loader.ts`): it asks for the namespace
  the reference actually lives in (here, `status.podRef.namespace`, falling
  back to the guest's own; `nodesStore` stays cluster-wide), passes
  `merge: true` so other namespaces are never clobbered and an
  `onLoadFailure` so a failure is data rather than a swallowed rejection,
  retries up to 5 times 2-8 seconds apart while the drawer stays open,
  subscribes to the store after the first successful load so an object
  appearing later upgrades the row to a link, and logs one line per attempt
  (`[kubeswift-extension] reference store <apiBase>: attempt N ns=... isLoaded=... items=... lookup=hit|miss|n/a`)
  which the E2E error collector echoes into the CI job log. `objectExists`
  is unchanged and still decides link versus text at render time, so the
  degradation behavior this spec describes is the same.
- 2026-08-29 (issue #38, correcting the entry above): the symptom that
  motivated the issue for this drawer - "the Node row never upgrades" - was
  a test-side false negative, not a store that never filled. SwiftGuest
  publishes an `additionalPrinterColumns` entry named `Node`, so Freelens
  core's generic custom-resource section renders a second, always-plain-text
  row labelled exactly "Node" above this drawer's body, and the E2E and
  pre-review row helpers matched that one instead of the extension's linked
  row, on every platform. The "Pod" row has no printer column behind it and
  was never affected, which is exactly why one of the two upgraded and the
  other never did. The helpers now read the extension's own rows only (see
  SPEC-0006 "Notes and deviations" for the mechanism and the evidence). The
  loader work above stands on its own: the silent empty load, the swallowed
  load failure and the store that cannot be resolved are real host
  behaviors, and the per-attempt diagnostics are what made this collision
  provable in the first place.
- 2026-08-29 (issue #38, follow-up to the two entries above): the E2E
  degradation allowance for this drawer's Node and Pod rows is removed. It
  existed only while the platform asymmetry was unexplained; both causes are
  now fixed, and the CI run of the loader PR on the packed Linux app showed
  both rows upgrading to links and navigating cleanly, with no
  "degraded to text" line. A row that stays plain text there is now a test
  failure. This tightens nothing else: a reference whose target does not
  exist by fixture design must still render as plain text (DESIGN.md
  section 3), and the rendering code is untouched.

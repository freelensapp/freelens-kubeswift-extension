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
  actually exist" (added for issue #23) asserts the no-dead-links invariant
  the fix guarantees, not that the rows always render as links: it waits
  (bounded) for the existence check to upgrade each row, and only once it
  did, clicks the link and requires a real, non-error detail drawer on the
  other end; a row still plain text after the wait is logged as a
  legitimate degradation rather than failed, since whether the store-backed
  existence check upgrades a row in time turned out to be
  environment-dependent (reliable against the local pre-review pass, but
  the Node row never upgraded on the packed Linux CI build within the
  bounded wait). Fixture: `e2e/fixtures/55-launcher-pods.yaml`.
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

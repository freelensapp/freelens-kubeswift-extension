# SPEC-0001: SwiftGuest read-only list and detail views

- **Status:** Implemented (this PR)
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

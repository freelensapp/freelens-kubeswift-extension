# Roadmap to v1.0.0

Goal for v1.0.0: functional parity with the official KubeSwift web console
([kubeswift-ui](https://github.com/kubeswift-io/kubeswift-ui)) wherever that
makes sense inside Freelens, reimplemented from scratch as a CRD-native
Freelens extension (see [ARCHITECTURE.md](ARCHITECTURE.md) for the licensing
and architecture boundaries).

This file is the single source of truth for scope and progress. Update it in
every PR that starts, completes, or re-scopes a feature.

## Feature inventory and milestones

Derived from the kubeswift-ui application structure (recon 2026-08-27,
KubeSwift v0.13.12, 15 CRDs across 9 API groups).

### M1 — Read-only core workload views

| Feature | Spec | Status |
| --- | --- | --- |
| SwiftGuest list + detail | [SPEC-0001](../specs/SPEC-0001-swiftguest-read-only-views.md) | Done |
| SwiftGuestClass list + detail | [SPEC-0002](../specs/SPEC-0002-m1-remaining-core-views.md) | Done |
| SwiftGuestPool list + detail (replicas, rollout) | [SPEC-0002](../specs/SPEC-0002-m1-remaining-core-views.md) | Done |
| SwiftImage list + detail | [SPEC-0002](../specs/SPEC-0002-m1-remaining-core-views.md) | Done |
| SwiftSeedProfile list + detail | [SPEC-0002](../specs/SPEC-0002-m1-remaining-core-views.md) | Done |
| SwiftKernel list + detail | [SPEC-0002](../specs/SPEC-0002-m1-remaining-core-views.md) | Done |

### M2 — Snapshots and migrations (read-only)

| Feature | Spec | Status |
| --- | --- | --- |
| SwiftSnapshot list + detail | [SPEC-0004](../specs/SPEC-0004-m2-snapshot-migration-views.md) | Done |
| SwiftRestore list + detail | [SPEC-0004](../specs/SPEC-0004-m2-snapshot-migration-views.md) | Done |
| SwiftSnapshotSchedule list + detail | [SPEC-0004](../specs/SPEC-0004-m2-snapshot-migration-views.md) | Done |
| SwiftMigration list + detail (status, progress) | [SPEC-0004](../specs/SPEC-0004-m2-snapshot-migration-views.md) | Done |

### M3 — GPU views (read-only)

| Feature | Spec | Status |
| --- | --- | --- |
| SwiftGPUProfile list + detail | [SPEC-0007](../specs/SPEC-0007-m3-gpu-read-only-views.md) | Done |
| SwiftGPUNode list + detail (per-node inventory) | [SPEC-0007](../specs/SPEC-0007-m3-gpu-read-only-views.md) | Done |

### M4 — Sandbox views (read-only)

| Feature | Spec | Status |
| --- | --- | --- |
| SwiftSandbox list + detail | [SPEC-0008](../specs/SPEC-0008-m4-sandbox-read-only-views.md) | Done |
| SwiftSandboxPool list + detail | [SPEC-0008](../specs/SPEC-0008-m4-sandbox-read-only-views.md) | Done |
| Launcher pod logs from the sandbox drawer | [SPEC-0008](../specs/SPEC-0008-m4-sandbox-read-only-views.md) | Done |

M4 ships in two slices: SwiftSandbox (with the launcher-pod logs affordance and
the new Sandboxes sidebar group) first, SwiftSandboxPool second. See
"Implementation slices" in SPEC-0008 for what each one carries.

The feasibility question this milestone carried ("Sandbox logs — read via
launcher pod") is answered in SPEC-0008 and splits in two. The launcher pod's
own logs, including the `sandbox-materialize` init container, are reachable
through Freelens' log dock and are in M4. The workload's **console** is not:
the sandbox writes it to a file inside the launcher pod, so reading it needs a
`pods/exec` stream — the same machinery as the sandbox shell, which M7 already
owns.

### M5 — Fleet view (read-only)

| Feature | Spec | Status |
| --- | --- | --- |
| Cluster (fleet.kubeswift.io) list + detail | [SPEC-0009](../specs/SPEC-0009-m5-fleet-read-only-views.md) | Done |

M5 is one CRD and ships in a single slice. It is the view of the KubeSwift
fleet that the Kubernetes API can serve on its own: which member clusters a
hub has registered and what the gateway last recorded about each. It is not
the cross-cluster inventory of the kubeswift-ui `/fleet` screen, which is
excluded below and is gateway-only besides — see "Gateway-only information"
in SPEC-0009 for the full boundary.

Two facts about this CRD shape the milestone and are argued in the spec: its
kind is literally `Cluster`, which collides with the host's own vocabulary in
the same sidebar (the leaf is therefore titled "Member Clusters"), and its
reconciler is the kubeswift-gateway rather than the controller-manager, so on
a cluster without a gateway the page exists, stays empty, and is right to.

### M6 — Actions and creation forms

kubeswift-ui offers create wizards and action dialogs. For the extension this
means (each item needs its own spec before implementation):

| Feature | Spec | Status |
| --- | --- | --- |
| Guest actions: start/stop (runPolicy), delete | [SPEC-0010](../specs/SPEC-0010-m6-guest-actions.md) | Done |
| Create SwiftGuest (form) | [SPEC-0013](../specs/SPEC-0013-m6-create-guest-form.md) | Done |
| Create SwiftGuestClass / Image / Kernel / SeedProfile (forms) | [SPEC-0014](../specs/SPEC-0014-m6-simple-creation-forms.md) | Done |
| Create SwiftGuestPool (form) | [SPEC-0015](../specs/SPEC-0015-m6-create-guest-pool-form.md) | Done |
| Snapshot now / restore dialogs | [SPEC-0011](../specs/SPEC-0011-m6-snapshot-restore-dialogs.md) | Done |
| Start migration dialog | [SPEC-0012](../specs/SPEC-0012-m6-start-migration-dialog.md) | Done |
| Sandbox / SandboxPool creation | [SPEC-0016](../specs/SPEC-0016-m6-sandbox-creation.md) | In PR |

M6 is where the extension starts writing. Everything through M5 reads, so the
first row carries more than its own feature: SPEC-0010 sets the ground rules
for every action and form of this milestone (confirmation dialogs that
enumerate the writes they perform, no optimistic UI, explicit patch types,
failures reported rather than swallowed, no dead controls), to be absorbed into
[DESIGN.md](DESIGN.md) as a new section by the implementation PR.

Two findings shape the first row and are argued in the spec. Stopping a guest
is **two** writes, not one: patching `spec.runPolicy` to `Stopped` only stops
the controller from recreating the launcher pod, so the pod has to be deleted
as well, exactly as `swiftctl stop` does. And Delete is already there - Freelens
renders its own Edit and Delete for every kind an extension registers a store
for - so the spec adds the KubeSwift-specific consequences of deleting a guest
(what cascades, what is retained, and that a pool-owned guest comes back)
rather than a second Delete entry.

Restart (recreate the launcher pod without changing the policy) is deliberately
not in SPEC-0010: it is a third verb with its own guard, `swiftctl` has it and
kubeswift-ui does not. It is left for a spec of its own, which adds its row
here when it is written.

### M7 — Console and exec

| Feature | Spec | Status |
| --- | --- | --- |
| VM serial console | — | Planned (feasibility: via launcher pod, no gateway) |
| Sandbox exec, and the workload console tail | — | Planned (feasibility study required; lead recorded in [SPEC-0008](../specs/SPEC-0008-m4-sandbox-read-only-views.md)) |

### Cross-cutting

| Item | Status |
| --- | --- |
| E2E test infrastructure (kind + CRDs + simulated statuses + Playwright) | [SPEC-0003](../specs/SPEC-0003-e2e-infrastructure.md) — Done (see [TESTING.md](TESTING.md)) |
| Local demo cluster for manual testing (`pnpm demo:up`, milestone review gate) | [SPEC-0005](../specs/SPEC-0005-local-demo-cluster.md) — Done (see [TRY-IT.md](TRY-IT.md)) |
| Overview/dashboard page (counts, phases) | Planned, after M2 |

## Out of scope for v1

- Create wizards for generic Kubernetes resources (Deployment, Service,
  ConfigMap, Secret, Ingress, Job, CronJob, DaemonSet, StatefulSet,
  ReplicaSet, RBAC, ServiceAccount): Freelens covers these natively.
- Gateway, auth, and RBAC screens of kubeswift-ui: they belong to the
  gateway architecture the extension deliberately does not use.
- Multi-cluster fleet aggregation UI: Freelens is inherently multi-cluster
  (one extension instance per cluster connection); the fleet CRD view (M5)
  covers the KubeSwift-specific part.

## Release criteria for v1.0.0

- All milestones M1-M7 implemented, each behind an approved spec.
- Every feature covered by non-regression tests (unit + E2E) green in CI.
- Docs (specs, architecture, roadmap) aligned with the shipped behavior.

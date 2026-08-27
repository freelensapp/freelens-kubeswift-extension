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
|---|---|---|
| SwiftGuest list + detail | [SPEC-0001](../specs/SPEC-0001-swiftguest-read-only-views.md) | Implemented on held branch `add-swiftguest-views`, to be rebased |
| SwiftGuestClass list + detail | — | Planned |
| SwiftGuestPool list + detail (replicas, rollout) | — | Planned |
| SwiftImage list + detail | — | Planned |
| SwiftSeedProfile list + detail | — | Planned |
| SwiftKernel list + detail | — | Planned |

### M2 — Snapshots and migrations (read-only)

| Feature | Spec | Status |
|---|---|---|
| SwiftSnapshot list + detail | — | Planned |
| SwiftRestore list + detail | — | Planned |
| SwiftSnapshotSchedule list + detail | — | Planned |
| SwiftMigration list + detail (status, progress) | — | Planned |

### M3 — GPU views (read-only)

| Feature | Spec | Status |
|---|---|---|
| SwiftGPUProfile list + detail | — | Planned |
| SwiftGPUNode list + detail (per-node inventory) | — | Planned |

### M4 — Sandbox views (read-only)

| Feature | Spec | Status |
|---|---|---|
| SwiftSandbox list + detail | — | Planned |
| SwiftSandboxPool list + detail | — | Planned |
| Sandbox logs | — | Planned (feasibility: read via launcher pod) |

### M5 — Fleet view (read-only)

| Feature | Spec | Status |
|---|---|---|
| Cluster (fleet.kubeswift.io) list + detail | — | Planned |

### M6 — Actions and creation forms

kubeswift-ui offers create wizards and action dialogs. For the extension this
means (each item needs its own spec before implementation):

| Feature | Spec | Status |
|---|---|---|
| Guest actions: start/stop (runPolicy), delete | — | Planned |
| Create SwiftGuest (form) | — | Planned |
| Create SwiftGuestClass / Pool / Image / Kernel / SeedProfile (forms) | — | Planned |
| Snapshot now / restore dialogs | — | Planned |
| Start migration dialog | — | Planned |
| Sandbox / SandboxPool creation | — | Planned |

### M7 — Console and exec

| Feature | Spec | Status |
|---|---|---|
| VM serial console | — | Planned (feasibility: via launcher pod, no gateway) |
| Sandbox exec | — | Planned (feasibility study required) |

### Cross-cutting

| Item | Status |
|---|---|
| E2E test infrastructure (kind + CRDs + simulated statuses + Playwright) | Planned, prerequisite for M1 completion (see [TESTING.md](TESTING.md)) |
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

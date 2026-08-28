# SPEC-0005: Local demo cluster for manual testing

- **Status:** Draft
- **Milestone:** Cross-cutting (see [ROADMAP.md](../development/ROADMAP.md))
- **KubeSwift version reviewed:** `v0.13.12`
- **Author / date:** Roberto Bandini with Claude / 2026-08-28

## Goal

Anyone on Windows, Linux, or macOS can run a single command and get a local
Kubernetes cluster with the KubeSwift CRDs, realistic fixture objects with
simulated statuses, and a freshly packed build of the extension, ready to be
tried inside a real Freelens installation. This is the procedure behind the
per-milestone manual review gate in
[PROCESS.md](../development/PROCESS.md).

## Upstream reference

None (infrastructure feature). The cluster layout mirrors the E2E
infrastructure from
[SPEC-0003](SPEC-0003-e2e-infrastructure.md); the CRDs are fetched from
`kubeswift-io/kubeswift` at the pinned version, never vendored (AGPL
boundary, see ARCHITECTURE.md).

## Scope

Included:

- `pnpm demo:up`: creates (or reuses) a dedicated kind cluster named
  `kubeswift-demo`, applies the 15 KubeSwift CRDs at the pinned version,
  applies the E2E fixtures and injects their statuses, builds and packs the
  extension, and prints the exact steps to connect from Freelens (path of
  the dedicated kubeconfig and of the `.tgz` to install).
- `pnpm demo:down`: deletes the demo cluster and its state directory.
- `docs/development/TRY-IT.md`: the human-facing procedure for the three
  platforms, including the Windows-via-WSL2 path.
- Reuse of `e2e/scripts/lib.sh` and `cluster-up.sh` via environment
  overrides: the demo does not duplicate cluster logic.

Excluded:

- Running real VMs (needs Linux x86_64 with KVM and a real KubeSwift
  installation; tracked as a manual-only area in TESTING.md).
- Automatic installation of the extension into the user's Freelens (the
  extension is installed manually from the packed `.tgz`; automating this
  would mean writing into the user's Freelens profile).
- Touching the developer's default kubeconfig (`~/.kube/config`): the demo
  writes only its own kubeconfig under `.demo/`, same policy as the E2E
  scripts.

## Design

- `e2e/scripts/demo-up.sh`: thin wrapper that sets
  `E2E_CLUSTER_NAME=kubeswift-demo` and `E2E_STATE_DIR=<repo>/.demo`, then
  runs the existing `cluster-up.sh` (cluster + CRDs + fixtures + status
  injection + readback verification), then packs the extension
  (`pnpm clean:tgz && pnpm build && pnpm pack`), and finally prints:
  - the absolute path of the demo kubeconfig;
  - the absolute path of the packed `.tgz`;
  - the Freelens steps (add cluster from the kubeconfig file, install the
    extension from the `.tgz`, where the KubeSwift pages appear);
  - platform notes (on Windows the script runs inside WSL2 and the printed
    paths must be translated to `\\wsl.localhost\...` for the Freelens app
    running on the host).
- `e2e/scripts/demo-down.sh`: same overrides, runs `cluster-down.sh`.
- `package.json`: `demo:up` and `demo:down` scripts.
- The demo cluster is separate from the E2E cluster (`kubeswift-e2e`), so
  running the E2E suite never tears down a demo session and vice versa.
- Prerequisites (checked by the script with clear error messages): Docker
  daemon running, `kind`, `kubectl`, `curl`.
- Idempotent: re-running `demo:up` re-applies CRDs and fixtures and repacks
  the extension.

### Cadence (process decision)

The manual review runs at the end of every milestone, not once at the end
of the project: feedback on `M(n)` must arrive before its patterns are
replicated in `M(n+1)`. The first session covers M1+M2 retroactively. The
gate is defined in PROCESS.md ("Milestone manual review gate").

## Tests (non-regression list)

- Unit: none (shell wrapper; the wrapped `cluster-up.sh` logic is already
  exercised by the E2E suite on every PR).
- Integration: none.
- E2E: the demo reuses the same fixtures and status patches as the E2E
  suite, which asserts them on every PR.
- Manual verification: on each platform, run `pnpm demo:up`, connect
  Freelens to the printed kubeconfig, install the printed `.tgz`, and check
  that the KubeSwift sidebar entry appears and the fixture objects are
  listed with their statuses. Expected: all 10 implemented views show the
  fixture data. Recorded results:
  - macOS: script verified end-to-end on 2026-08-28 (Claude): cluster,
    15 CRDs, fixtures and injected statuses confirmed via kubectl from the
    demo kubeconfig, tarball packed, summary printed. The in-Freelens
    walkthrough by a human tester is still pending.
  - Linux: pending
  - Windows (WSL2): pending

## Notes and deviations

Filled during implementation when reality diverges from the plan.

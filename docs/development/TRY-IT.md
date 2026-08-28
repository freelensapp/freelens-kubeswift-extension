# Try the extension locally

One command brings up a local Kubernetes cluster with the KubeSwift CRDs,
realistic fixture objects with simulated statuses, and a freshly packed
build of the extension, ready to be tried in a real Freelens installation.
No KVM, no real VMs: statuses are injected exactly like in the E2E suite
(see [TESTING.md](TESTING.md) and
[SPEC-0005](../specs/SPEC-0005-local-demo-cluster.md)).

This procedure backs the per-milestone manual review gate described in
[PROCESS.md](PROCESS.md).

## Prerequisites

- A running Docker daemon (Docker Desktop, docker-ce, OrbStack, ...)
- `kind`, `kubectl`, `curl`
- Node.js >= 22 with `pnpm` (the same toolchain used to build the
  extension), and `pnpm install` already run once in the repo
- The Freelens app installed

## Quick start (macOS and Linux)

```bash
pnpm demo:up
```

When it finishes, the script prints the two paths you need:

1. The demo kubeconfig (`.demo/kubeconfig`, context `kind-kubeswift-demo`).
   Add it to Freelens as a new cluster (File > Add Cluster, or copy it into
   a folder Freelens syncs kubeconfigs from). Your `~/.kube/config` is
   never touched.
2. The packed extension (`freelensapp-kubeswift-extension-<version>.tgz` in
   the repo root). Install it from the Freelens Extensions page (paste the
   path or pick the file).

Then connect to the cluster: the KubeSwift entry appears in the cluster
sidebar and the fixture objects live in the `kubeswift-e2e` namespace.

Tear everything down with:

```bash
pnpm demo:down
```

Both commands are idempotent: `demo:up` re-applies CRDs and fixtures and
repacks the extension on every run, and reuses the cluster if it already
exists.

## Windows (via WSL2)

Docker without administrator rights exists only inside WSL2, so the script
runs there while the Freelens app runs on the Windows side:

1. Inside a WSL2 distribution with docker-ce (or Docker Desktop's WSL2
   integration), clone the repo and run `pnpm demo:up` as above.
2. In the Freelens app on Windows, use the WSL paths of the two files the
   script printed, in the `\\wsl.localhost\<distro>\...` form (for example
   `\\wsl.localhost\Ubuntu\home\<user>\freelens-kubeswift-extension\.demo\kubeconfig`).
   The cluster API server on `127.0.0.1` is reachable from Windows thanks
   to WSL2 localhost forwarding.

## What to look at during a milestone review

The reviewer walks through every view implemented in the milestone under
review and checks, for each list page and detail drawer:

- the sidebar entry and page titles;
- columns: content, sorting, the search box filtering;
- status semantics: do phases/conditions read correctly at a glance;
- the detail drawer: field grouping, references to other objects,
  conditions;
- empty states (delete a fixture with `kubectl` and look at the page) and
  the N/A fallbacks;
- both dark and light Freelens themes.

Feedback goes into one issue per finding (or one umbrella issue per
session), referenced from the spec of the feature it concerns; the spec's
"Manual verification" section records date, tester, and result.

## Limits

- No real VMs: a `SwiftGuest` here never boots. Behavior against a real
  KVM-backed KubeSwift installation is a manual-only area (see
  [TESTING.md](TESTING.md)).
- The statuses are frozen: no controller reconciles them, so nothing
  changes over time unless you patch it with `kubectl`.

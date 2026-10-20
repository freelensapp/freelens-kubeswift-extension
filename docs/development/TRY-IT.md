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
  extension; `corepack install` provides the right pnpm, see the README's
  "Build from the source" section), and `pnpm install` already run once in
  the repo
- Freelens 2.0.0 or later installed. Until it is released, Freelens dev
  from a checkout of `main` (`pnpm e2e:freelens`, see "Preparing the local
  Freelens harness" below)

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
   path or pick the file). Freelens notes that nothing vouches for the
   integrity of a local package: expected for a build of your own.

Then connect to the cluster: the KubeSwift entry appears in the cluster
sidebar and the fixture objects live in the `kubeswift-e2e` namespace.

Tear everything down with:

```bash
pnpm demo:down
```

Both commands are idempotent: `demo:up` re-applies CRDs and fixtures and
repacks the extension on every run, and reuses the cluster if it already
exists. A snapshot fixture whose spec changed is the exception: KubeSwift
v0.16.0 and later refuse to change a SwiftSnapshot's spec, so run
`pnpm demo:down` first.

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

**Fleet > Member Clusters reads differently from every other page**, and
the reviewer should know which of three situations an empty one means
(SPEC-0009): the cluster is not a KubeSwift **hub** (the chart installs
this CRD everywhere, so the page exists on every KubeSwift cluster and
nothing ever writes a status on it); the cluster is a hub but the
namespace filter does not include the KubeSwift system namespace, which
is where Cluster objects live and which is never the `default` namespace
a freshly connected Freelens selects; or the hub genuinely has no members
registered yet. On the demo cluster the fixtures make the page non-empty,
and an "Unknown" badge with "N/A" in K8s and Guests is a **correct steady
state** there rather than a symptom: it is the member no gateway has
reported on.

**From M6 on the Guests page WRITES** (SPEC-0010), and the demo cluster is
a real cluster: Start and Stop are in the row kebab and in the drawer
toolbar, and confirming their dialog really patches `spec.runPolicy` and
really deletes a launcher pod. Nothing happens on a single click - every
action opens a dialog that lists the API calls it is about to make, and
cancelling writes nothing - so the surface is safe to explore, and the
dialogs are the part worth reading closely: they are where this extension
is furthest ahead of the upstream UI. Three things to look at that no
assert covers: the wording of the dialogs, the reason a disabled Start or
Stop gives (it is in the item's tooltip attribute and, durably, in the
drawer's Condition row), and whether `Stopping` reads correctly at a
glance next to `Run Policy: Stopped`. The demo cluster has no KubeSwift
controller, so a stopped guest stays `Stopping` forever there: that is
the fixture, not a bug.

Feedback goes into one issue per finding (or one umbrella issue per
session), referenced from the spec of the feature it concerns; the spec's
"Manual verification" section records date, tester, and result.

## Preparing the local Freelens harness

`pnpm e2e` and `pnpm pre-review` drive Freelens dev, `pnpm dev` of a
freelensapp/freelens checkout, over CDP, and `pnpm e2e:freelens` starts it on
a fresh profile that sees the lab clusters alone (see "Running locally" in
[TESTING.md](TESTING.md)). Prepare the checkout once:

```bash
git clone --depth 1 https://github.com/freelensapp/freelens.git freelens
cd freelens
nvm install "$(cat .nvmrc)" && corepack enable
pnpm install --frozen-lockfile
pnpm build:resources
```

`./freelens` is gitignored; set `FREELENS_DIR` to use a checkout living
elsewhere. Then, from the repo root, with the demo cluster up:

```bash
pnpm e2e:freelens > /tmp/freelens-dev.log 2>&1 &
FREELENS_MAIN_LOG=/tmp/freelens-dev.log pnpm pre-review
```

The same Freelens dev serves a review by hand: install the checkout in place
from its Extensions page (the repository's directory, after `pnpm build`) and
open `kind-kubeswift-demo` from the catalog.

## Limits

- No real VMs: a `SwiftGuest` here never boots. Behavior against a real
  KVM-backed KubeSwift installation is a manual-only area (see
  [TESTING.md](TESTING.md)).
- The statuses are frozen: no controller reconciles them, so nothing
  changes over time unless you patch it with `kubectl`.
- **A sandbox's Workload Console follows its console file and can never be
  typed into**: for a sandbox the hypervisor writes the guest's serial
  line to a file rather than to a socket, so the console is read-only by
  construction (SPEC-0017). For a shell *inside* a sandbox's microVM, use
  `swiftctl sandbox attach` (or `swiftctl sandbox exec`): that channel is
  the guest agent's vsock protocol, which is not expressible as a command
  line in a terminal tab, so this extension deliberately offers no control
  for it rather than a broken one.

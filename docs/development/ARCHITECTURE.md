# Architecture

## What this extension is

A Freelens extension that shows KubeSwift resources (VMs as Kubernetes
workloads) inside Freelens. It is **CRD-native**: it reads the KubeSwift
custom resources directly from the Kubernetes API of the active cluster,
through the Freelens extension framework.

## What it deliberately is not

kubeswift-ui is an Angular application that talks to a dedicated
`kubeswift-gateway` over Connect RPC. This extension replicates its **views**,
not its architecture: there is no gateway dependency, no Connect RPC, no
proto-generated client. Anything in kubeswift-ui that exists only because of
the gateway (auth screens, fleet aggregation transport, WebSocket console
proxy) is either out of scope or reimplemented on top of the Kubernetes API.

## Licensing boundary (critical)

The KubeSwift repositories (`kubeswift-io/kubeswift`,
`kubeswift-io/kubeswift-ui`) are AGPL-3.0. This repository is MIT. The
KubeSwift repositories are a visual and domain reference, never a source of
code. See the "KubeSwift Licensing Constraints" section of
[AGENTS.md](../../AGENTS.md) for the binding rules. In short: CRD schemas and
documentation may be read to understand fields and semantics; components,
CSS, UI strings, status-mapping logic, protos, and generated clients must
never be copied; views are reimplemented from scratch.

## Upstream facts (verify on every milestone, KubeSwift moves fast)

- KubeSwift API version: `v1alpha1` on every CRD, explicitly unstable between
  releases. Recon 2026-08-27: KubeSwift v0.13.12, 15 CRDs across 9 API
  groups.
- Authoritative CRD schemas: `config/crd/bases/*.yaml` in
  `kubeswift-io/kubeswift`. TypeScript types in this extension are written
  from those schemas (by hand or generated), never imported from KubeSwift
  code.
- Field semantics: `docs/crds.md` in `kubeswift-io/kubeswift`.

## Source layout

```text
src/
  main/index.ts              # Extension entry point (main process)
  renderer/index.tsx         # Extension entry point (renderer): registers
                             # kubeObjectDetailItems, kubeObjectMenuItems,
                             # clusterPages, clusterPageMenus
  renderer/api/kubeswift/    # One file per CRD: KubeObject + KubeApi +
                             # KubeObjectStore, typed Spec/Status interfaces
                             # (full schema, not only rendered fields)
  renderer/pages/            # Cluster pages (list views); the Guests page
                             # also carries the create entry point, through
                             # the host's own addRemoveButtons
  renderer/details/          # Detail panels (kubeObjectDetailItems)
  renderer/menus/            # Write actions (kubeObjectMenuItems): one file
                             # per verb, rendered by the host in both the list
                             # row kebab and the detail drawer's toolbar
  renderer/components/       # Shared pure modules: status classifiers, the
                             # action guards and payloads, the create dialogs'
                             # gating, validation, payloads and write
                             # summaries (snapshot-create.ts,
                             # restore-create.ts, migration-create.ts,
                             # guest-create.ts), reference loading; plus the
                             # form components the dialogs render
                             # (snapshot-create-dialog.tsx,
                             # restore-create-dialog.tsx,
                             # migration-create-dialog.tsx,
                             # guest-create-dialog.tsx) and the form grammar
                             # they share (create-dialog.tsx and its module:
                             # the labelled field, the write summary, the
                             # collapsible section)
  renderer/icons/            # Original SVG icons (never copied)
  common/                    # Code shared between main and renderer
```

Pattern rules (KubeObject statics, no instance methods, host-provided
globals, SCSS modules) are in [AGENTS.md](../../AGENTS.md).

## Sidebar structure

One "KubeSwift" parent entry in the cluster sidebar; one child entry per
resource page, grouped to mirror the KubeSwift API groups where that helps
navigation (workloads, snapshots, GPU, sandbox, fleet).

## Reference code

When implementing views, study these repositories for patterns (all MIT,
copying allowed and encouraged):

- `freelensapp/freelens` — the host application; list/detail components,
  stores, conditions rendering, drawer layout.
- `freelensapp/freelens-example-extension` — the scaffold this repo started
  from.
- The other extensions in the freelensapp org (for example
  `freelens-ai-extension`) — real-world extension patterns.

On Roberto's Mac, local checkouts live under `~/repo/freelensapp/`.

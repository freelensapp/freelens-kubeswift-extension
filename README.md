# @freelensapp/kubeswift-extension

> [!WARNING]
> **Work in progress.** This extension is under active development toward its
> first release, v1.0.0, and is not ready for use yet. Scope and progress are
> tracked in the [roadmap](docs/development/ROADMAP.md).

<!-- markdownlint-disable MD013 -->

[![Home](https://img.shields.io/badge/%F0%9F%8F%A0-freelens.app-02a7a0)](https://freelens.app)
[![GitHub](https://img.shields.io/github/stars/freelensapp/freelens?style=flat&label=GitHub%20%E2%AD%90)](https://github.com/freelensapp/freelens)
[![DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/freelensapp/freelens-kubeswift-extension)
[![Release](https://img.shields.io/github/v/release/freelensapp/freelens-kubeswift-extension?display_name=tag&sort=semver)](https://github.com/freelensapp/freelens-kubeswift-extension)
[![Integration tests](https://github.com/freelensapp/freelens-kubeswift-extension/actions/workflows/integration-tests.yaml/badge.svg?branch=main)](https://github.com/freelensapp/freelens-kubeswift-extension/actions/workflows/integration-tests.yaml)
[![npm](https://img.shields.io/npm/v/@freelensapp/kubeswift-extension.svg)](https://www.npmjs.com/package/@freelensapp/kubeswift-extension)

<!-- markdownlint-enable MD013 -->

## Overview

Official [Freelens](https://freelens.app) extension for
[KubeSwift](https://github.com/kubeswift-io/kubeswift), the Kubernetes-native
virtual machine runtime.

The extension adds cluster pages, list views, and detail panels for the
KubeSwift Custom Resource Definitions (SwiftGuest, SwiftGuestPool,
SwiftSnapshot, SwiftMigration, and more), reading the resources directly from
the Kubernetes API.

Design, workflow, and test strategy are documented under
[docs/development/](docs/development/):
[ARCHITECTURE.md](docs/development/ARCHITECTURE.md) describes the CRD-native
design and the licensing boundary with the KubeSwift repositories,
[PROCESS.md](docs/development/PROCESS.md) the spec-driven development process,
and [TESTING.md](docs/development/TESTING.md) the test layers every feature
ships with.

Visit the wiki page about [creating
extensions](https://github.com/freelensapp/freelens/wiki/Creating-extensions)
for more information.

## Requirements

- Kubernetes >= 1.24
- Freelens >= 1.10.3

## Supported APIs

The views for the KubeSwift custom resources are being implemented milestone
by milestone. The kinds covered by each milestone, and the ones still to
come, are tracked in the [roadmap](docs/development/ROADMAP.md); this section
lists the supported API versions as the views land.

## Install

To install, open Freelens and go to Extensions (`ctrl`+`shift`+`E` or
`cmd`+`shift`+`E`), then search for and install
`@freelensapp/kubeswift-extension`.

Alternatively, open the following URL in the browser to install directly:

[freelens://app/extensions/install/%40freelensapp%2Fkubeswift-extension](freelens://app/extensions/install/%40freelensapp%2Fkubeswift-extension)

## Build from the source

You can build the extension from this repository.

### Prerequisites

Use [NVM](https://github.com/nvm-sh/nvm),
[mise-en-place](https://mise.jdx.dev/), or
[windows-nvm](https://github.com/coreybutler/nvm-windows) to install the
required Node.js version.

From the root of this repository:

```sh
nvm install
# or
mise install
# or
winget install CoreyButler.NVMforWindows
nvm install 24.15.0
nvm use 24.15.0
```

Install pnpm:

```sh
corepack install
# or
curl -fsSL https://get.pnpm.io/install.sh | sh -
# or
winget install pnpm.pnpm
```

### Build extension

```sh
pnpm i
pnpm build
pnpm pack
```

One script to build and pack the extension for testing:

```sh
pnpm pack:dev
```

### Install built extension

The tarball will be placed in the current directory. In Freelens, navigate
to the Extensions page and provide the path to the tarball, or drag and
drop the `.tgz` file into the Freelens window.

### Check code statically

```sh
pnpm lint:check
```

or

```sh
pnpm trunk:check
```

and

```sh
pnpm build
pnpm knip:check
```

### Testing the extension with unpublished Freelens

In the Freelens working repository:

```sh
rm -f *.tgz
pnpm i
pnpm build
pnpm pack -r
```

Then in the extension repository:

```sh
echo "overrides:" >> pnpm-workspace.yaml
for i in ../freelens/*.tgz; do
  name=$(tar zxOf $i package/package.json | yq -r .name)
  echo "  \"$name\": $i" >> pnpm-workspace.yaml
done

pnpm clean:node_modules
pnpm build
```

## License

Copyright (c) 2025-2026 Freelens Authors.

[MIT License](https://opensource.org/licenses/MIT)

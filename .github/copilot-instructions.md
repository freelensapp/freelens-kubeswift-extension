# Instructions for GitHub Copilot and other coding agents

The canonical agent guide for this repository is [AGENTS.md](../AGENTS.md)
in the repository root. Read it first and follow it strictly, in particular:

- the spec-driven development process (`docs/development/PROCESS.md`):
  no feature implementation without an approved spec in `docs/specs/`,
  docs updated in the same PR as the code;
- the KubeSwift licensing constraints: the kubeswift-io repositories are
  AGPL-3.0 and this repository is MIT — never copy code, styles, or UI
  strings from them;
- the testing requirements (`docs/development/TESTING.md`): every feature
  ships with unit, integration, and E2E non-regression tests;
- the CRD KubeObject pattern and code style rules in AGENTS.md.

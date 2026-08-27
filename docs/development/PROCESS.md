# Development process (spec-driven)

This repository is developed spec-first. The process below is binding for
every contributor, human or agent (Claude, Copilot, or any other coding
agent). Agents discover it via [AGENTS.md](../../AGENTS.md) and
`.github/copilot-instructions.md`, which both point here.

## The loop

1. **Spec before code.** Every feature starts as a spec file in
   `docs/specs/`, numbered `SPEC-NNNN-short-slug.md`, written from
   [TEMPLATE.md](../specs/TEMPLATE.md). No implementation PR without an
   approved spec.
2. **Approval.** Roberto (or a core team maintainer) approves the spec, in
   the PR that introduces it or by saying so in the tracking issue.
3. **Implementation.** One PR per feature slice. The PR links the spec. The
   implementation must not silently diverge from the spec: if reality forces
   a change, update the spec in the same PR and call the change out in the
   PR description.
4. **Tests are part of the feature.** See [TESTING.md](TESTING.md). A
   feature without its non-regression tests is not done.
5. **Docs updated in the same PR.** ROADMAP.md status, the spec's status
   field, and ARCHITECTURE.md (when structure changed) are updated in the
   same PR as the code. A PR that leaves docs stale is incomplete.
6. **Verification.** After merge, the spec status moves to Verified only
   when the non-regression tests run green in CI on main, plus a manual
   check when the spec requires one.

## Spec statuses

`Draft` → `Approved` → `Implemented` → `Verified`. Superseded specs get
status `Superseded` with a pointer to the replacement; nothing is deleted.

## Manual testing escalation

Some behavior cannot be verified automatically (for example: rendering
inside a real Freelens against a real KVM-backed cluster, GPU passthrough
views, console interaction). In that case:

1. The spec lists the manual test steps under "Manual verification".
2. The agent or contributor asks Roberto to run them, providing exact steps
   and expected outcomes.
3. The result is recorded in the spec (date, result, tester) before the
   feature is marked Verified.

## Upstream drift watch

KubeSwift's API is v1alpha1 and changes between releases. At the start of
every milestone (and before every release of the extension):

1. Check the latest KubeSwift release and CHANGELOG.
2. Diff `config/crd/bases/` against the versions the types were written
   from; record the reviewed KubeSwift version in the affected specs.
3. File an issue for any breaking change.

## Working agreements

- Branch names: short kebab-case (`add-swiftguest-views`, `bootstrap-v1`);
  `claude/issue-N-slug` when starting from an issue (see AGENTS.md).
- Plain commit messages, no conventional-commit prefixes, no emoji.
- PRs against `main`, squash merge, CI green required.
- External contributions follow the same spec-first loop; maintainers help
  contributors write the spec when needed.

## Reuse beyond this repository

These practices are meant to be generalized: the core team plans to extract
them into a shared repository for all freelensapp extensions. Keep this file
self-contained (no references to details that only exist in this repo,
except in examples) so extraction stays cheap.

#!/usr/bin/env bash
#
# Runs the pre-review agent pass (docs/specs/SPEC-0006-pre-review-agent-pass.md)
# against the local DEMO cluster: for every registered KubeSwift view, opens
# the list page and one detail drawer, screenshots both in the dark and the
# light theme, and runs the DOM asserts of the statically checkable
# DESIGN.md rules. Writes everything under e2e-artifacts/pre-review/,
# including the summary REPORT.md.
#
# Composition of the existing scripts rather than a rewrite:
# - DEMO_CLUSTER_NAME/DEMO_STATE_DIR pick the same demo cluster demo-up.sh
#   manages (state under .demo/, kept separate from the disposable E2E
#   cluster of cluster-up.sh/e2e.sh) - see docs/specs/SPEC-0005-local-demo-cluster.md.
# - cluster-up.sh brings it up (idempotent, so this doubles as "re-apply the
#   fixtures").
# - The build/run steps mirror run-suite.sh, pointed at the pre-review suite
#   (integration/__tests__/pre-review.tests.ts, which runs only with
#   KUBESWIFT_PRE_REVIEW=1) and its own artifacts subdirectory. Freelens dev
#   must be running with the demo cluster in its catalog.

set -euo pipefail

PRE_REVIEW_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Must be exported before lib.sh is sourced: it derives E2E_KUBE_CONTEXT,
# E2E_KUBECONFIG and E2E_ARTIFACTS_DIR from these two.
export E2E_CLUSTER_NAME="${DEMO_CLUSTER_NAME:-kubeswift-demo}"
export E2E_STATE_DIR="${DEMO_STATE_DIR:-$(cd -- "${PRE_REVIEW_SCRIPTS_DIR}/../.." && pwd)/.demo}"

# shellcheck source=e2e/scripts/lib.sh
source "${PRE_REVIEW_SCRIPTS_DIR}/lib.sh"

# Its own artifacts subdirectory, so a pre-review run never mixes its report
# and screenshots with a plain `pnpm e2e` failure run (both read
# E2E_ARTIFACTS_DIR from the environment, kubeswift-extension.ts and
# kubeswift-cluster.ts included, so this one export routes every screenshot
# this run takes, including failure ones).
export E2E_ARTIFACTS_DIR="${REPO_ROOT}/e2e-artifacts/pre-review"
E2E_TEST_PATTERN="pre-review"

build_extension() {
  log "building the extension, which Freelens dev loads in place from dist/"
  (cd "${REPO_ROOT}" && pnpm build)
}

run_pass() {
  log "running the pre-review pass (pattern: ${E2E_TEST_PATTERN})"
  (
    cd "${REPO_ROOT}"
    KUBESWIFT_PRE_REVIEW=1 \
      E2E_KUBECONFIG="${E2E_KUBECONFIG}" \
      E2E_CLUSTER_NAME="${E2E_CLUSTER_NAME}" \
      E2E_KUBE_CONTEXT="${E2E_KUBE_CONTEXT}" \
      E2E_NAMESPACE="${E2E_NAMESPACE}" \
      E2E_ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR}" \
      pnpm test:integration "${E2E_TEST_PATTERN}"
  )
}

main() {
  require_command kubectl pnpm
  require_docker

  log "bringing up the demo cluster ${E2E_CLUSTER_NAME}"
  "${PRE_REVIEW_SCRIPTS_DIR}/cluster-up.sh"

  build_extension
  run_pass

  log "report: ${E2E_ARTIFACTS_DIR}/REPORT.md"
}

main "$@"

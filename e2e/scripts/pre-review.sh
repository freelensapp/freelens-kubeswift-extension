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
# - The pack/copy/run steps mirror run-suite.sh, pointed at the pre-review
#   suite (e2e/__tests__/pre-review.tests.ts) and its own artifacts
#   subdirectory instead of the E2E one.

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

FREELENS_DIR="${FREELENS_DIR:-${REPO_ROOT}/freelens}"
FREELENS_APP_DIR="${FREELENS_DIR}/freelens"

require_freelens_checkout() {
  [ -d "${FREELENS_APP_DIR}/integration/__tests__" ] ||
    die "no Freelens checkout at ${FREELENS_DIR}. See docs/development/TESTING.md."

  # Linux builds land in dist/linux*-unpacked, macOS ones in dist/mac*.
  compgen -G "${FREELENS_APP_DIR}/dist/*unpacked" >/dev/null ||
    compgen -G "${FREELENS_APP_DIR}/dist/mac*" >/dev/null ||
    die "Freelens is not built in ${FREELENS_APP_DIR}/dist. See docs/development/TESTING.md."
}

pack_extension() {
  if [ -n "${EXTENSION_PATH-}" ]; then
    log "using the extension tarball from EXTENSION_PATH: ${EXTENSION_PATH}"
    return
  fi

  log "building and packing the extension"
  (cd "${REPO_ROOT}" && pnpm build && pnpm clean:tgz && pnpm pack >/dev/null)

  EXTENSION_PATH="$(find "${REPO_ROOT}" -maxdepth 1 -name '*.tgz' | head -n 1)"
  [ -n "${EXTENSION_PATH}" ] || die "pnpm pack produced no tarball"
  export EXTENSION_PATH
}

copy_suite() {
  log "copying the E2E and pre-review suites into ${FREELENS_APP_DIR}/integration"
  mkdir -p "${FREELENS_APP_DIR}/integration/helpers"
  cp "${E2E_DIR}"/__tests__/*.tests.ts "${FREELENS_APP_DIR}/integration/__tests__/"
  cp "${REPO_ROOT}"/integration/helpers/*.ts "${FREELENS_APP_DIR}/integration/helpers/"
}

run_pass() {
  local -a runner=()

  # Electron needs a display. On a headless Linux box, wrap the run in Xvfb.
  if [ "$(uname -s)" = "Linux" ] && [ -z "${DISPLAY-}" ] && command -v xvfb-run >/dev/null 2>&1; then
    runner=(xvfb-run -a)
  fi

  log "running the pre-review pass (pattern: ${E2E_TEST_PATTERN})"
  (
    cd "${FREELENS_APP_DIR}"
    E2E_KUBECONFIG="${E2E_KUBECONFIG}" \
      E2E_CLUSTER_NAME="${E2E_CLUSTER_NAME}" \
      E2E_KUBE_CONTEXT="${E2E_KUBE_CONTEXT}" \
      E2E_NAMESPACE="${E2E_NAMESPACE}" \
      E2E_ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR}" \
      EXTENSION_PATH="${EXTENSION_PATH}" \
      ${runner[@]+"${runner[@]}"} pnpm test:integration "${E2E_TEST_PATTERN}"
  )
}

main() {
  require_command kubectl pnpm
  require_docker

  log "bringing up the demo cluster ${E2E_CLUSTER_NAME}"
  "${PRE_REVIEW_SCRIPTS_DIR}/cluster-up.sh"

  require_freelens_checkout
  pack_extension
  copy_suite
  run_pass

  log "report: ${E2E_ARTIFACTS_DIR}/REPORT.md"
}

main "$@"

#!/usr/bin/env bash
#
# Runs the Playwright E2E suite (integration/__tests__/kubeswift-e2e.tests.ts)
# against the disposable kind cluster.
#
# The suite runs in this repository, under `vitest.integration.config.ts`, and
# attaches over CDP to Freelens started with `pnpm dev` from a
# freelensapp/freelens checkout, which must already be running and have the
# E2E cluster in its catalog (see docs/development/TESTING.md). It installs
# this checkout in place, so the extension is built first.

set -euo pipefail

# shellcheck source=e2e/scripts/lib.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Name pattern selecting the suite among the files of integration/__tests__.
E2E_TEST_PATTERN="${E2E_TEST_PATTERN:-kubeswift-e2e}"

require_cluster() {
  [ -f "${E2E_KUBECONFIG}" ] ||
    die "no kubeconfig at ${E2E_KUBECONFIG}. Run \`pnpm e2e:cluster:up\` first."

  kubectl_e2e get crd swiftguests.swift.kubeswift.io >/dev/null 2>&1 ||
    die "the KubeSwift CRDs are missing from ${E2E_CLUSTER_NAME}. Run \`pnpm e2e:cluster:up\` first."
}

build_extension() {
  log "building the extension, which Freelens dev loads in place from dist/"
  (cd "${REPO_ROOT}" && pnpm build)
}

run_suite() {
  log "running the E2E suite (pattern: ${E2E_TEST_PATTERN})"
  (
    cd "${REPO_ROOT}"
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
  require_cluster
  build_extension
  run_suite
}

main "$@"

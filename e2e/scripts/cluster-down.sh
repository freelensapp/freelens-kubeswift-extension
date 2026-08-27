#!/usr/bin/env bash
#
# Deletes the disposable kind cluster and its dedicated kubeconfig.

set -euo pipefail

# shellcheck source=e2e/scripts/lib.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

main() {
  require_docker
  require_command kind

  if kind get clusters 2>/dev/null | grep -qx "${E2E_CLUSTER_NAME}"; then
    log "deleting cluster ${E2E_CLUSTER_NAME}"
    kind delete cluster --name "${E2E_CLUSTER_NAME}" --kubeconfig "${E2E_KUBECONFIG}"
  else
    log "cluster ${E2E_CLUSTER_NAME} does not exist, nothing to delete"
  fi

  rm -f "${E2E_KUBECONFIG}"
}

main "$@"

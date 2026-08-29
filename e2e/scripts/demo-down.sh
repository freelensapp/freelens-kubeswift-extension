#!/usr/bin/env bash
#
# Deletes the local DEMO cluster and its state directory (see
# docs/specs/SPEC-0005-local-demo-cluster.md and
# docs/development/TRY-IT.md).
#
# Thin wrapper around cluster-down.sh: DEMO_CLUSTER_NAME and DEMO_STATE_DIR
# are translated into E2E_CLUSTER_NAME and E2E_STATE_DIR before anything
# reads them, so this only ever tears down the demo cluster (kubeswift-demo,
# state under .demo/), never the E2E cluster (kubeswift-e2e).

set -euo pipefail

DEMO_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_REPO_ROOT="$(cd -- "${DEMO_SCRIPTS_DIR}/../.." && pwd)"

export E2E_CLUSTER_NAME="${DEMO_CLUSTER_NAME:-kubeswift-demo}"
export E2E_STATE_DIR="${DEMO_STATE_DIR:-${DEMO_REPO_ROOT}/.demo}"

# shellcheck source=e2e/scripts/lib.sh
source "${DEMO_SCRIPTS_DIR}/lib.sh"

main() {
	log "tearing down the demo cluster ${E2E_CLUSTER_NAME}"
	"${DEMO_SCRIPTS_DIR}/cluster-down.sh"
}

main "$@"

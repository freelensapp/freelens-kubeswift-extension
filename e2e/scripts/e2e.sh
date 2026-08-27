#!/usr/bin/env bash
#
# Creates the cluster, runs the E2E suite and tears the cluster down again.
#
# Set E2E_KEEP_CLUSTER=1 to keep the cluster around for debugging, then delete
# it with `pnpm e2e:cluster:down`.

set -euo pipefail

E2E_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  local status=$?

  if [ "${E2E_KEEP_CLUSTER:-0}" = "1" ]; then
    printf '[e2e] E2E_KEEP_CLUSTER=1, leaving the cluster running\n' >&2
  else
    "${E2E_SCRIPT_DIR}/cluster-down.sh" || true
  fi

  return "${status}"
}

trap cleanup EXIT

"${E2E_SCRIPT_DIR}/cluster-up.sh"
"${E2E_SCRIPT_DIR}/run-suite.sh"

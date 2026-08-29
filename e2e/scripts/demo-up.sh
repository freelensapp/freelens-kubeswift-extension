#!/usr/bin/env bash
#
# Creates the local DEMO cluster for manual testing in a real Freelens
# installation (see docs/specs/SPEC-0005-local-demo-cluster.md and
# docs/development/TRY-IT.md).
#
# Thin wrapper around cluster-up.sh: DEMO_CLUSTER_NAME and DEMO_STATE_DIR are
# translated into E2E_CLUSTER_NAME and E2E_STATE_DIR before anything reads
# them, so the demo cluster (kubeswift-demo, state under .demo/) is entirely
# separate from the E2E cluster (kubeswift-e2e) and reuses the same
# cluster-up.sh logic instead of duplicating it. Once the cluster is up, the
# extension is built and packed so the printed .tgz can be installed straight
# into a real Freelens.
#
# Idempotent: running it again against an existing cluster re-applies the
# CRDs and fixtures and repacks the extension.

set -euo pipefail

DEMO_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEMO_REPO_ROOT="$(cd -- "${DEMO_SCRIPTS_DIR}/../.." && pwd)"

export E2E_CLUSTER_NAME="${DEMO_CLUSTER_NAME:-kubeswift-demo}"
export E2E_STATE_DIR="${DEMO_STATE_DIR:-${DEMO_REPO_ROOT}/.demo}"

# shellcheck source=e2e/scripts/lib.sh
source "${DEMO_SCRIPTS_DIR}/lib.sh"

pack_extension() {
	log "building and packing the extension"
	(cd "${REPO_ROOT}" && pnpm clean:tgz && pnpm build && pnpm pack >/dev/null)
}

resolve_tgz_path() {
	local tgz_path
	tgz_path="$(find "${REPO_ROOT}" -maxdepth 1 -name '*.tgz' | head -n 1)"
	[ -n "${tgz_path}" ] || die "pnpm pack produced no tarball in ${REPO_ROOT}"
	printf '%s' "${tgz_path}"
}

print_summary() {
	local tgz_path
	tgz_path="$(resolve_tgz_path)"

	[ -f "${E2E_KUBECONFIG}" ] || die "no kubeconfig at ${E2E_KUBECONFIG}"

	cat <<SUMMARY

Demo cluster ready
===================

Kubeconfig: ${E2E_KUBECONFIG}
Context: ${E2E_KUBE_CONTEXT}
Extension tarball: ${tgz_path}

Next steps in Freelens:
  1. Open Freelens.
  2. Add the cluster from the kubeconfig file above (File > Add Cluster, or
     copy it into a synced kubeconfig folder).
  3. Install the extension from the tgz above (Extensions page > install
     from file).
  4. Connect to the cluster and find the KubeSwift entry in the cluster
     sidebar. The fixture objects live in namespace ${E2E_NAMESPACE}.

Windows note: run this script inside WSL2. From the Windows-side Freelens,
use the \\\\wsl.localhost\<distro>\... form of the two paths above.

Teardown: pnpm demo:down
SUMMARY
}

main() {
	require_command pnpm

	"${DEMO_SCRIPTS_DIR}/cluster-up.sh"
	pack_extension
	print_summary
}

main "$@"

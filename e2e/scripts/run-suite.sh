#!/usr/bin/env bash
#
# Runs the Playwright E2E suite against the disposable kind cluster.
#
# The suite drives a real Freelens through Playwright's Electron API, so it runs
# inside a Freelens checkout: its `test:integration` script owns the runner and
# the launch helpers this repository reuses (see docs/development/TESTING.md).
# Our test and helper files are copied next to the Freelens ones and selected by
# name, so nothing in the Freelens checkout is deleted.

set -euo pipefail

# shellcheck source=e2e/scripts/lib.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Checkout of freelensapp/freelens with the app already built. Defaults to the
# gitignored ./freelens directory, which is where CI checks it out.
FREELENS_DIR="${FREELENS_DIR:-${REPO_ROOT}/freelens}"
FREELENS_APP_DIR="${FREELENS_DIR}/freelens"

# Name pattern selecting our suite among the tests of the Freelens checkout.
E2E_TEST_PATTERN="${E2E_TEST_PATTERN:-kubeswift-e2e}"

require_freelens_checkout() {
	[ -d "${FREELENS_APP_DIR}/integration/__tests__" ] ||
		die "no Freelens checkout at ${FREELENS_DIR}. See docs/development/TESTING.md."

	# Linux builds land in dist/linux*-unpacked, macOS ones in dist/mac*.
	compgen -G "${FREELENS_APP_DIR}/dist/*unpacked" >/dev/null ||
		compgen -G "${FREELENS_APP_DIR}/dist/mac*" >/dev/null ||
		die "Freelens is not built in ${FREELENS_APP_DIR}/dist. See docs/development/TESTING.md."
}

require_cluster() {
	[ -f "${E2E_KUBECONFIG}" ] ||
		die "no kubeconfig at ${E2E_KUBECONFIG}. Run \`pnpm e2e:cluster:up\` first."

	kubectl_e2e get crd swiftguests.swift.kubeswift.io >/dev/null 2>&1 ||
		die "the KubeSwift CRDs are missing from ${E2E_CLUSTER_NAME}. Run \`pnpm e2e:cluster:up\` first."
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
	log "copying the E2E suite into ${FREELENS_APP_DIR}/integration"
	mkdir -p "${FREELENS_APP_DIR}/integration/helpers"
	cp "${E2E_DIR}"/__tests__/*.tests.ts "${FREELENS_APP_DIR}/integration/__tests__/"
	cp "${REPO_ROOT}"/integration/helpers/*.ts "${FREELENS_APP_DIR}/integration/helpers/"
}

run_suite() {
	local -a runner=()

	# Electron needs a display. On a headless Linux box, wrap the run in Xvfb.
	if [ "$(uname -s)" = "Linux" ] && [ -z "${DISPLAY-}" ] && command -v xvfb-run >/dev/null 2>&1; then
		runner=(xvfb-run -a)
	fi

	log "running the E2E suite (pattern: ${E2E_TEST_PATTERN})"
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
	require_freelens_checkout
	require_cluster
	pack_extension
	copy_suite
	run_suite
}

main "$@"

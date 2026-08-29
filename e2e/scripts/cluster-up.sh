#!/usr/bin/env bash
#
# Creates the disposable kind cluster the E2E suite runs against: applies the
# KubeSwift CRDs at the pinned version, applies our fixtures and injects the
# statuses no controller is there to write.
#
# Idempotent: running it against an existing cluster re-applies everything.

set -euo pipefail

# shellcheck source=e2e/scripts/lib.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

create_cluster() {
	if kind get clusters 2>/dev/null | grep -qx "${E2E_CLUSTER_NAME}"; then
		log "cluster ${E2E_CLUSTER_NAME} already exists, reusing it"
	else
		log "creating cluster ${E2E_CLUSTER_NAME} (${KIND_NODE_IMAGE})"
		kind create cluster \
			--name "${E2E_CLUSTER_NAME}" \
			--image "${KIND_NODE_IMAGE}" \
			--kubeconfig "${E2E_KUBECONFIG}" \
			--wait 5m
	fi

	# Also covers the reuse path, where the kubeconfig file may have been removed.
	kind export kubeconfig --name "${E2E_CLUSTER_NAME}" --kubeconfig "${E2E_KUBECONFIG}"
	chmod 600 "${E2E_KUBECONFIG}"
}

apply_crds() {
	local download_dir file crd_name
	download_dir="$(mktemp -d)"
	# shellcheck disable=SC2064 # the directory is expanded now on purpose
	trap "rm -rf '${download_dir}'" RETURN

	log "fetching the KubeSwift CRDs at ${KUBESWIFT_VERSION}"
	for file in "${KUBESWIFT_CRD_FILES[@]}"; do
		curl --fail --silent --show-error --location --retry 3 \
			--output "${download_dir}/${file}" \
			"${KUBESWIFT_CRD_BASE_URL}/${file}"
	done

	# Server-side apply: the SwiftGuest and SwiftGuestPool schemas are large
	# enough that the client-side last-applied annotation is best avoided.
	log "applying ${#KUBESWIFT_CRD_FILES[@]} CRDs"
	kubectl_e2e apply --server-side --force-conflicts -f "${download_dir}"

	for file in "${KUBESWIFT_CRD_FILES[@]}"; do
		crd_name="$(crd_name_from_file "${file}")"
		kubectl_e2e wait --for=condition=Established --timeout=120s "crd/${crd_name}" >/dev/null
	done
	log "all CRDs established"
}

apply_fixtures() {
	local substituted_dir file

	# The same __NODE_NAME__ substitution inject_statuses() does for the status
	# patches, one step earlier: a SwiftGPUNode is named after the node it
	# describes, and `metadata.name` cannot be patched after the object exists,
	# so a fixture that has to carry the cluster's real node name must carry it
	# before it is created (see 120-swiftgpunodes.yaml and E2E_NODE_NAME_FIELDS
	# in lib.sh, which asserts the readback). The `sed` is a no-op for every
	# file without the placeholder, so this generalizes the existing mechanism
	# rather than adding a second one.
	substituted_dir="$(mktemp -d)"
	# shellcheck disable=SC2064 # the directory is expanded now on purpose
	trap "rm -rf '${substituted_dir}'" RETURN

	# Not recursive on purpose: fixtures/status holds patches, not resources.
	for file in "${E2E_FIXTURES_DIR}"/*.yaml; do
		sed "s/__NODE_NAME__/${E2E_NODE_NAME}/g" "${file}" >"${substituted_dir}/$(basename "${file}")"
	done

	log "applying the fixtures in namespace ${E2E_NAMESPACE} (node name: ${E2E_NODE_NAME})"
	kubectl_e2e apply -f "${substituted_dir}"
}

inject_statuses() {
	local entry target patch_file resource name substituted_file json_path actual_node_name

	# A handful of fixtures spell the cluster's real (single) node name as the
	# __NODE_NAME__ placeholder rather than a literal such as
	# "kubeswift-e2e-control-plane": that string is only the real node name of
	# a single-node kind cluster created with E2E_CLUSTER_NAME set to its
	# default "kubeswift-e2e" (kind names such a node
	# "<cluster-name>-control-plane"), so hardcoding it broke the fixtures (and
	# any drawer link built from them) for any other cluster the patch was
	# applied to (issue #23). See E2E_NODE_NAME_FIELDS in lib.sh for which
	# fields use it. Substituting the actual node name keeps the fixtures
	# correct everywhere, the E2E cluster included.
	substituted_file="$(mktemp)"
	# shellcheck disable=SC2064 # the file path is expanded now on purpose
	trap "rm -f '${substituted_file}'" RETURN

	log "injecting the fixture statuses (node name: ${E2E_NODE_NAME})"
	for entry in "${E2E_STATUS_PATCHES[@]}"; do
		target="${entry%%=*}"
		patch_file="${E2E_FIXTURES_DIR}/status/${entry#*=}"
		resource="${target%%/*}"
		name="$(substitute_node_name "${target#*/}")"

		[ -f "${patch_file}" ] || die "missing status patch ${patch_file}"

		# A no-op for every patch file that does not contain the placeholder.
		sed "s/__NODE_NAME__/${E2E_NODE_NAME}/g" "${patch_file}" >"${substituted_file}"

		# `--namespace` is passed for every target, cluster-scoped ones (the
		# SwiftGPUNodes) included: `kubectl` resolves the scope from the
		# resource's own REST mapping and ignores the flag when that scope is
		# cluster, so one call shape covers both kinds of fixture (verified
		# against this cluster, SPEC-0007).
		kubectl_e2e patch "${resource}" "${name}" \
			--namespace "${E2E_NAMESPACE}" \
			--subresource=status \
			--type=merge \
			--patch-file "${substituted_file}" >/dev/null
	done

	# The generic readback loop in verify_statuses() only compares against
	# values known statically in E2E_STATUS_ASSERTIONS, so it cannot cover a
	# value computed at runtime; verify every __NODE_NAME__ substitution here
	# instead.
	for entry in "${E2E_NODE_NAME_FIELDS[@]}"; do
		target="${entry%%=*}"
		json_path="${entry#*=}"
		resource="${target%%/*}"
		name="$(substitute_node_name "${target#*/}")"

		actual_node_name="$(kubectl_e2e get "${resource}" "${name}" \
			--namespace "${E2E_NAMESPACE}" \
			--output "jsonpath=${json_path}")"

		[ "${actual_node_name}" = "${E2E_NODE_NAME}" ] ||
			die "status readback mismatch for ${resource}/${name} ${json_path}: expected '${E2E_NODE_NAME}', got '${actual_node_name}'"
	done
}

verify_statuses() {
	local entry target rest json_path expected actual resource name

	log "verifying that the injected statuses were persisted"
	for entry in "${E2E_STATUS_ASSERTIONS[@]}"; do
		# The jsonpath itself may contain "=" - a condition filter such as
		# {.status.conditions[?(@.type=="Reachable")].status} does, and M5 needs
		# exactly that shape because it is the one the fleet CRD's own Ready
		# printer column uses. So the expected value is taken from the LAST "="
		# and the path is everything between the first and the last, instead of
		# splitting on the first two (SPEC-0009). No expected value in this
		# file contains an "=", which is what makes the split unambiguous.
		target="${entry%%=*}"
		rest="${entry#*=}"
		expected="${rest##*=}"
		json_path="${rest%=*}"
		resource="${target%%/*}"
		name="$(substitute_node_name "${target#*/}")"

		actual="$(kubectl_e2e get "${resource}" "${name}" \
			--namespace "${E2E_NAMESPACE}" \
			--output "jsonpath=${json_path}")"

		[ "${actual}" = "${expected}" ] ||
			die "status readback mismatch for ${resource}/${name} ${json_path}: expected '${expected}', got '${actual}'"
	done
	log "all injected statuses read back unchanged"
}

main() {
	require_docker
	require_command kind kubectl curl

	mkdir -p "${E2E_STATE_DIR}"

	create_cluster
	apply_crds

	# Read once, here: every step below substitutes it into a fixture name, a
	# patch target or a patch body.
	E2E_NODE_NAME="$(cluster_node_name)"

	apply_fixtures
	inject_statuses
	verify_statuses

	log "cluster ready: kubeconfig=${E2E_KUBECONFIG} context=${E2E_KUBE_CONTEXT}"
}

main "$@"

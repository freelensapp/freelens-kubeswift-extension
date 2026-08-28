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
  log "applying the fixtures in namespace ${E2E_NAMESPACE}"
  # Not recursive on purpose: fixtures/status holds patches, not resources.
  kubectl_e2e apply -f "${E2E_FIXTURES_DIR}"
}

inject_statuses() {
  local entry target patch_file resource name node_name substituted_file json_path actual_node_name

  # A handful of status patches spell the cluster's real (single) node name
  # as the __NODE_NAME__ placeholder rather than a literal such as
  # "kubeswift-e2e-control-plane": that string is only the real node name of
  # a single-node kind cluster created with E2E_CLUSTER_NAME set to its
  # default "kubeswift-e2e" (kind names such a node
  # "<cluster-name>-control-plane"), so hardcoding it broke the fixtures (and
  # any drawer link built from them) for any other cluster the patch was
  # applied to (issue #23). See E2E_NODE_NAME_FIELDS in lib.sh for which
  # fields use it. Substituting the actual node name here keeps the fixtures
  # correct everywhere, the E2E cluster included.
  node_name="$(kubectl_e2e get nodes -o jsonpath='{.items[0].metadata.name}')"
  [ -n "${node_name}" ] || die "could not determine the node name of the ${E2E_CLUSTER_NAME} cluster"

  substituted_file="$(mktemp)"
  # shellcheck disable=SC2064 # the file path is expanded now on purpose
  trap "rm -f '${substituted_file}'" RETURN

  log "injecting the fixture statuses (node name: ${node_name})"
  for entry in "${E2E_STATUS_PATCHES[@]}"; do
    target="${entry%%=*}"
    patch_file="${E2E_FIXTURES_DIR}/status/${entry#*=}"
    resource="${target%%/*}"
    name="${target#*/}"

    [ -f "${patch_file}" ] || die "missing status patch ${patch_file}"

    # A no-op for every patch file that does not contain the placeholder.
    sed "s/__NODE_NAME__/${node_name}/g" "${patch_file}" >"${substituted_file}"

    kubectl_e2e patch "${resource}" "${name}" \
      --namespace "${E2E_NAMESPACE}" \
      --subresource=status \
      --type=merge \
      --patch-file "${substituted_file}" >/dev/null
  done

  # The generic readback loop in verify_statuses() only compares against
  # values known statically in E2E_STATUS_ASSERTIONS, so it cannot cover a
  # value computed at runtime; verify every __NODE_NAME__ substitution here
  # instead, right where node_name is in scope.
  for entry in "${E2E_NODE_NAME_FIELDS[@]}"; do
    target="${entry%%=*}"
    json_path="${entry#*=}"
    resource="${target%%/*}"
    name="${target#*/}"

    actual_node_name="$(kubectl_e2e get "${resource}" "${name}" \
      --namespace "${E2E_NAMESPACE}" \
      --output "jsonpath=${json_path}")"

    [ "${actual_node_name}" = "${node_name}" ] ||
      die "status readback mismatch for ${resource}/${name} ${json_path}: expected '${node_name}', got '${actual_node_name}'"
  done
}

verify_statuses() {
  local entry target json_path expected actual resource name

  log "verifying that the injected statuses were persisted"
  for entry in "${E2E_STATUS_ASSERTIONS[@]}"; do
    target="${entry%%=*}"
    json_path="${entry#*=}"
    expected="${json_path#*=}"
    json_path="${json_path%%=*}"
    resource="${target%%/*}"
    name="${target#*/}"

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
  apply_fixtures
  inject_statuses
  verify_statuses

  log "cluster ready: kubeconfig=${E2E_KUBECONFIG} context=${E2E_KUBE_CONTEXT}"
}

main "$@"

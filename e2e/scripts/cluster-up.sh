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
  local entry target patch_file resource name

  log "injecting the fixture statuses"
  for entry in "${E2E_STATUS_PATCHES[@]}"; do
    target="${entry%%=*}"
    patch_file="${E2E_FIXTURES_DIR}/status/${entry#*=}"
    resource="${target%%/*}"
    name="${target#*/}"

    [ -f "${patch_file}" ] || die "missing status patch ${patch_file}"

    kubectl_e2e patch "${resource}" "${name}" \
      --namespace "${E2E_NAMESPACE}" \
      --subresource=status \
      --type=merge \
      --patch-file "${patch_file}" >/dev/null
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

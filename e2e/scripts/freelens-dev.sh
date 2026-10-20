#!/usr/bin/env bash
#
# Starts Freelens dev (`pnpm dev` of a freelensapp/freelens checkout) on a
# fresh profile that syncs the kubeconfigs of the local labs alone, for the
# suites of integration/__tests__ and for checks by hand or by an agent.
#
# Freelens dev otherwise syncs ~/.kube of the user, whose contexts can be real
# clusters, one click away from a suite or an agent that drives the UI. The
# profile goes in FREELENS_INTEGRATION_TESTING_DIR, which the app accepts only
# under the system's temporary directory, and its preferences are written
# before the start with the lab kubeconfigs as the only synced files. Turbo
# runs the `dev` task in loose environment mode, because its strict mode would
# not pass that variable on, and the app would use the developer's own profile.
#
# The profile is created anew on every start, as the suites expect: the E2E
# suite leaves the dock and the namespace filter of its cluster as it found
# them only when it passes. Its output is the main log of the suites
# (FREELENS_MAIN_LOG): redirect it to a file.
#
# Env: FREELENS_DIR         the freelensapp/freelens checkout (default: ./freelens)
#      FREELENS_DEV_PROFILE the profile directory (default: <tmp>/freelens-kubeswift-dev)

set -euo pipefail

# shellcheck source=e2e/scripts/lib.sh
source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FREELENS_DIR="${FREELENS_DIR:-${REPO_ROOT}/freelens}"
SYSTEM_TMP_DIR="${TMPDIR:-/tmp}"
SYSTEM_TMP_DIR="${SYSTEM_TMP_DIR%/}"
FREELENS_DEV_PROFILE="${FREELENS_DEV_PROFILE:-${SYSTEM_TMP_DIR}/freelens-kubeswift-dev}"
DEMO_KUBECONFIG="${DEMO_STATE_DIR:-${REPO_ROOT}/.demo}/kubeconfig"

lab_kubeconfigs() {
  local kubeconfig

  for kubeconfig in "${E2E_KUBECONFIG}" "${DEMO_KUBECONFIG}"; do
    [ -f "${kubeconfig}" ] || continue

    # A lab kubeconfig names one kind cluster on this machine; anything else
    # is refused rather than synced.
    if grep -E '^[[:space:]]*server:' "${kubeconfig}" | grep -qvE 'https://(127\.0\.0\.1|localhost|\[::1\]):'; then
      die "${kubeconfig} names a server that is not on this machine"
    fi

    printf '%s\n' "${kubeconfig}"
  done
}

write_profile() {
  local user_data="${FREELENS_DEV_PROFILE}/FreelensDev"
  local entries="" kubeconfig

  while IFS= read -r kubeconfig; do
    [ -n "${kubeconfig}" ] || continue
    entries="${entries:+${entries}, }{\"filePath\": \"${kubeconfig}\"}"
  done

  [ -n "${entries}" ] ||
    die "no lab kubeconfig at ${E2E_KUBECONFIG} or ${DEMO_KUBECONFIG}. Run \`pnpm e2e:cluster:up\` or \`pnpm demo:up\` first."

  # Deleted on every start, so it has to be a directory of its own under the
  # temporary directory, which is also the only place the app accepts it.
  case "${FREELENS_DEV_PROFILE}" in
    "${SYSTEM_TMP_DIR}"/?*) ;;
    *) die "FREELENS_DEV_PROFILE must be a directory under ${SYSTEM_TMP_DIR}" ;;
  esac

  rm -rf "${FREELENS_DEV_PROFILE}"
  mkdir -p "${user_data}"
  printf '{\n  "preferences": {\n    "allowErrorReporting": false,\n    "syncKubeconfigEntries": [%s]\n  }\n}\n' \
    "${entries}" >"${user_data}/lens-user-store.json"

  log "fresh profile in ${FREELENS_DEV_PROFILE}, syncing: ${entries}"
}

main() {
  require_command pnpm
  [ -f "${FREELENS_DIR}/turbo.json" ] ||
    die "no freelensapp/freelens checkout at ${FREELENS_DIR}. Set FREELENS_DIR (docs/development/TESTING.md)."

  local kubeconfigs

  kubeconfigs="$(lab_kubeconfigs)"
  write_profile <<<"${kubeconfigs}"

  cd "${FREELENS_DIR}"
  unset KUBECONFIG
  export FREELENS_INTEGRATION_TESTING_DIR="${FREELENS_DEV_PROFILE}"
  exec pnpm exec turbo run dev --parallel --env-mode=loose
}

main "$@"

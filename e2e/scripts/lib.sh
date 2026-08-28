# shellcheck shell=bash
#
# Shared settings and helpers for the KubeSwift E2E scripts.
#
# Sourced by cluster-up.sh, cluster-down.sh, run-suite.sh and e2e.sh. This file
# is not executable on its own.
#
# SC2034 is disabled for the whole file: everything defined here is read by the
# scripts that source it, which ShellCheck cannot see from this file alone.
# shellcheck disable=SC2034

# The single place where the KubeSwift version is pinned. The CRDs are fetched
# from the upstream repository at this tag when the cluster is created and are
# never vendored into this repository: kubeswift-io/kubeswift is AGPL-3.0 and
# this extension is MIT (see docs/development/ARCHITECTURE.md).
KUBESWIFT_VERSION="${KUBESWIFT_VERSION:-v0.13.12}" # datasource=github-releases depName=kubeswift-io/kubeswift

# Pins of the disposable cluster, aligned with .github/workflows/integration-tests.yaml.
KIND_VERSION="${KIND_VERSION:-0.32.0}"             # datasource=github-releases depName=kubernetes-sigs/kind
KUBERNETES_VERSION="${KUBERNETES_VERSION:-1.36.1}" # datasource=docker depName=kindest/node
KIND_NODE_IMAGE="${KIND_NODE_IMAGE:-kindest/node:v${KUBERNETES_VERSION}}"

E2E_SCRIPTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd -- "${E2E_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd -- "${E2E_DIR}/.." && pwd)"
E2E_FIXTURES_DIR="${E2E_DIR}/fixtures"

# Name of the disposable cluster. Deliberately not "kind", so that it never
# collides with the cluster the Freelens integration tests use.
E2E_CLUSTER_NAME="${E2E_CLUSTER_NAME:-kubeswift-e2e}"
E2E_KUBE_CONTEXT="kind-${E2E_CLUSTER_NAME}"

# Dedicated kubeconfig. The developer's default kubeconfig (~/.kube/config) is
# never read and never written by these scripts: kind writes only here, and the
# test suite copies this file into the sandboxed Freelens user-data directory.
E2E_STATE_DIR="${E2E_STATE_DIR:-${REPO_ROOT}/.e2e}"
E2E_KUBECONFIG="${E2E_KUBECONFIG:-${E2E_STATE_DIR}/kubeconfig}"

# Screenshots taken when an assertion fails. Kept in the repository root rather
# than in the Freelens checkout, so that CI can upload the directory.
E2E_ARTIFACTS_DIR="${E2E_ARTIFACTS_DIR:-${REPO_ROOT}/e2e-artifacts}"

# Namespace of the namespaced fixtures. Not configurable: the fixture manifests
# declare it explicitly so that they stay valid when applied by hand.
E2E_NAMESPACE="kubeswift-e2e"

KUBESWIFT_CRD_BASE_URL="https://raw.githubusercontent.com/kubeswift-io/kubeswift/${KUBESWIFT_VERSION}/config/crd/bases"

# The 15 CRDs KubeSwift ships, across its 9 API groups. All of them are applied
# so that the cluster matches a real KubeSwift installation, even though only
# the six M1 and the four M2 CRDs carry fixtures today.
KUBESWIFT_CRD_FILES=(
  fleet.kubeswift.io_clusters.yaml
  gpu.kubeswift.io_swiftgpunodes.yaml
  gpu.kubeswift.io_swiftgpuprofiles.yaml
  image.kubeswift.io_swiftimages.yaml
  kernel.kubeswift.io_swiftkernels.yaml
  migration.kubeswift.io_swiftmigrations.yaml
  sandbox.kubeswift.io_swiftsandboxes.yaml
  sandbox.kubeswift.io_swiftsandboxpools.yaml
  seed.kubeswift.io_swiftseedprofiles.yaml
  snapshot.kubeswift.io_swiftrestores.yaml
  snapshot.kubeswift.io_swiftsnapshots.yaml
  snapshot.kubeswift.io_swiftsnapshotschedules.yaml
  swift.kubeswift.io_swiftguestclasses.yaml
  swift.kubeswift.io_swiftguestpools.yaml
  swift.kubeswift.io_swiftguests.yaml
)

# Statuses of the fixtures, injected with `kubectl patch --subresource=status`
# because no KubeSwift controller runs in the cluster. Only the CRDs that
# declare a status subresource appear here: of the M1 six, SwiftGuestClass and
# SwiftSeedProfile have no status at all in their schemas, while all four M2
# CRDs do declare one.
#
# Format: <resource>/<name>=<patch file, relative to fixtures/status>
E2E_STATUS_PATCHES=(
  "swiftguests.swift.kubeswift.io/e2e-guest-running=swiftguest-e2e-guest-running.yaml"
  "swiftguestpools.swift.kubeswift.io/e2e-pool=swiftguestpool-e2e-pool.yaml"
  "swiftimages.image.kubeswift.io/e2e-ubuntu-2404=swiftimage-e2e-ubuntu-2404.yaml"
  "swiftkernels.kernel.kubeswift.io/e2e-kernel-6-12=swiftkernel-e2e-kernel-6-12.yaml"
  "swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready=swiftsnapshot-e2e-snapshot-ready.yaml"
  "swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-uploading=swiftsnapshot-e2e-snapshot-uploading.yaml"
  "swiftrestores.snapshot.kubeswift.io/e2e-restore-clone=swiftrestore-e2e-restore-clone.yaml"
  "swiftsnapshotschedules.snapshot.kubeswift.io/e2e-schedule-nightly=swiftsnapshotschedule-e2e-schedule-nightly.yaml"
  "swiftmigrations.migration.kubeswift.io/e2e-migration-completed=swiftmigration-e2e-migration-completed.yaml"
  "swiftmigrations.migration.kubeswift.io/e2e-migration-live=swiftmigration-e2e-migration-live.yaml"
)

# Readback assertions proving that the injected statuses survived the API
# server, one significant field per CRD.
#
# Format: <resource>/<name>=<jsonpath>=<expected value>
E2E_STATUS_ASSERTIONS=(
  "swiftguests.swift.kubeswift.io/e2e-guest-running={.status.phase}=Running"
  "swiftguests.swift.kubeswift.io/e2e-guest-running={.status.network.primaryIP}=10.244.1.21"
  "swiftguestpools.swift.kubeswift.io/e2e-pool={.status.readyReplicas}=2"
  "swiftimages.image.kubeswift.io/e2e-ubuntu-2404={.status.phase}=Ready"
  "swiftkernels.kernel.kubeswift.io/e2e-kernel-6-12={.status.kernelDigest}=sha256:9b2c8f0e3a7d41c5b6e8d90a2f14c7b38e5a6d0c9f3b1e7a4d2c8b5f6a0e9d31"
  "swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready={.status.phase}=Ready"
  "swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready={.status.totalSizeBytes}=22548578304"
  "swiftrestores.snapshot.kubeswift.io/e2e-restore-clone={.status.guestRef.name}=e2e-guest-restored"
  "swiftsnapshotschedules.snapshot.kubeswift.io/e2e-schedule-nightly={.status.lastScheduleTime}=2026-08-27T02:00:00Z"
  "swiftmigrations.migration.kubeswift.io/e2e-migration-completed={.status.mode}=offline"
  "swiftmigrations.migration.kubeswift.io/e2e-migration-live={.status.transferProgress}=64"
)

# Status fields whose status patch file spells the cluster's real (single)
# node name as the __NODE_NAME__ placeholder rather than a literal, so that
# the fixture stays correct (and any drawer link built from it stays alive)
# on a cluster whose node is not named "kubeswift-e2e-control-plane" (issue
# #23). cluster-up.sh's inject_statuses() substitutes the placeholder before
# patching and then verifies the readback here by name: unlike
# E2E_STATUS_ASSERTIONS above, the expected value is only known at runtime
# (it is whatever `kubectl get nodes` returns), so it cannot be a literal in
# this file.
#
# Format: <resource>/<name>=<jsonpath>
E2E_NODE_NAME_FIELDS=(
  "swiftguests.swift.kubeswift.io/e2e-guest-running={.status.nodeName}"
  "swiftmigrations.migration.kubeswift.io/e2e-migration-completed={.status.destinationNode}"
)

log() {
  printf '[e2e] %s\n' "$*" >&2
}

die() {
  printf '[e2e] error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name
  for command_name in "$@"; do
    command -v "${command_name}" >/dev/null 2>&1 ||
      die "\`${command_name}\` is not on PATH. See docs/development/TESTING.md for the prerequisites."
  done
}

require_docker() {
  require_command docker
  docker info >/dev/null 2>&1 ||
    die "the Docker daemon is not reachable. Start Docker (or Docker Desktop) and try again."
}

kubectl_e2e() {
  kubectl --kubeconfig "${E2E_KUBECONFIG}" --context "${E2E_KUBE_CONTEXT}" "$@"
}

# Turns an upstream CRD file name into the name of the CRD it defines, for
# example swift.kubeswift.io_swiftguests.yaml -> swiftguests.swift.kubeswift.io
crd_name_from_file() {
  local file="${1%.yaml}"
  printf '%s.%s' "${file#*_}" "${file%%_*}"
}

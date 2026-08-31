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

# The SwiftGuestPool whose uid `cluster-up.sh` substitutes into the owner
# reference of the pooled guest fixture (`fixtures/owned/`, SPEC-0010).
E2E_OWNER_POOL_NAME="e2e-pool"

# Real name of the cluster's node, filled in by cluster-up.sh once the cluster
# exists (see cluster_node_name below). Declared here so that every helper that
# substitutes it can be read under `set -u`.
E2E_NODE_NAME="${E2E_NODE_NAME:-}"

KUBESWIFT_CRD_BASE_URL="https://raw.githubusercontent.com/kubeswift-io/kubeswift/${KUBESWIFT_VERSION}/config/crd/bases"

# The 15 CRDs KubeSwift ships, across its 9 API groups. All of them are applied
# so that the cluster matches a real KubeSwift installation. Since M5 every one
# of them carries fixtures: fleet's Cluster was the last one waiting for its
# milestone, and it needed no change here because it has always been the first
# entry of this array.
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
# CRDs do declare one. SwiftGPUProfile (M3) has none either, so its fixtures
# never appear below, while SwiftGPUNode (M3) does - and is the first
# cluster-scoped object patched here. `kubectl` ignores `--namespace` for a
# cluster-scoped resource (verified against the E2E cluster while implementing
# SPEC-0007), so the flag inject_statuses()/verify_statuses() pass
# unconditionally needs no scope marker in this format.
#
# A `__NODE_NAME__` in the name is substituted the same way it is inside the
# patch files (see E2E_NODE_NAME_FIELDS below).
#
# Format: <resource>/<name>=<patch file, relative to fixtures/status>
E2E_STATUS_PATCHES=(
	"swiftguests.swift.kubeswift.io/e2e-guest-running=swiftguest-e2e-guest-running.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-gpu=swiftguest-e2e-guest-gpu.yaml"
	"swiftguestpools.swift.kubeswift.io/e2e-pool=swiftguestpool-e2e-pool.yaml"
	"swiftimages.image.kubeswift.io/e2e-ubuntu-2404=swiftimage-e2e-ubuntu-2404.yaml"
	"swiftkernels.kernel.kubeswift.io/e2e-kernel-6-12=swiftkernel-e2e-kernel-6-12.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready=swiftsnapshot-e2e-snapshot-ready.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-uploading=swiftsnapshot-e2e-snapshot-uploading.yaml"
	"swiftrestores.snapshot.kubeswift.io/e2e-restore-clone=swiftrestore-e2e-restore-clone.yaml"
	"swiftsnapshotschedules.snapshot.kubeswift.io/e2e-schedule-nightly=swiftsnapshotschedule-e2e-schedule-nightly.yaml"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-completed=swiftmigration-e2e-migration-completed.yaml"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-live=swiftmigration-e2e-migration-live.yaml"
	"swiftgpunodes.gpu.kubeswift.io/__NODE_NAME__=swiftgpunode-cluster-node.yaml"
	"swiftgpunodes.gpu.kubeswift.io/e2e-gpu-node-absent=swiftgpunode-e2e-gpu-node-absent.yaml"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running=swiftsandbox-e2e-sandbox-running.yaml"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-failed=swiftsandbox-e2e-sandbox-failed.yaml"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-pooled=swiftsandbox-e2e-sandbox-pooled.yaml"
	# SwiftSandboxPool declares a `scale` subresource next to its `status` one,
	# which changes nothing here: `kubectl patch --subresource=status` addresses
	# the status subresource by name, and `scale` is a separate projection the
	# API server serves from fields this patch writes (SPEC-0008).
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool=swiftsandboxpool-e2e-sandbox-pool.yaml"
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool-degraded=swiftsandboxpool-e2e-sandbox-pool-degraded.yaml"
	# Three of the four M5 fleet Clusters. The fourth, e2e-fleet-pending, gets
	# no patch on purpose: an object no gateway has ever reconciled is the state
	# most real users see first, and it is the only fixture in this suite whose
	# point is the absence of a status (SPEC-0009). The patch files are named
	# after the model's class, FleetCluster, since the kind is literally
	# `Cluster`.
	"clusters.fleet.kubeswift.io/e2e-fleet-hub=fleetcluster-e2e-fleet-hub.yaml"
	"clusters.fleet.kubeswift.io/e2e-fleet-edge-1=fleetcluster-e2e-fleet-edge-1.yaml"
	"clusters.fleet.kubeswift.io/e2e-fleet-edge-down=fleetcluster-e2e-fleet-edge-down.yaml"
	# The four M6 guest action subjects (SPEC-0010). The fifth,
	# e2e-guest-action-delete, gets no patch on purpose: the case deletes it, and
	# a guest with no status at all is also what one looks like between creation
	# and the first reconciliation.
	"swiftguests.swift.kubeswift.io/e2e-guest-action-running=swiftguest-e2e-guest-action-running.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-halfstopped=swiftguest-e2e-guest-action-halfstopped.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-orphanref=swiftguest-e2e-guest-action-orphanref.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-stopped=swiftguest-e2e-guest-action-stopped.yaml"
	# The M6 restore subjects (SPEC-0011): a Ready memory snapshot whose source
	# guest is stopped - the pair that wedges an in-place restore - and the one
	# terminal snapshot, which the Restore guard refuses.
	"swiftguests.swift.kubeswift.io/e2e-guest-restore-source=swiftguest-e2e-guest-restore-source.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-memory-ready=swiftsnapshot-e2e-snapshot-memory-ready.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-failed=swiftsnapshot-e2e-snapshot-failed.yaml"
	# The M6 Migrate subjects (SPEC-0012). The fifth, e2e-guest-migrate-sriov,
	# gets no patch on purpose: its guard reads the spec alone, and a guest
	# nothing has reconciled is the state most objects are in first. The three
	# running ones differ only in the node their status names, which is what
	# decides whether the picker has anything left to offer on a single-node
	# cluster.
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-running=swiftguest-e2e-guest-migrate-running.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-rwo=swiftguest-e2e-guest-migrate-rwo.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-stopped=swiftguest-e2e-guest-migrate-stopped.yaml"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-inflight=swiftguest-e2e-guest-migrate-inflight.yaml"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-inflight=swiftmigration-e2e-migration-inflight.yaml"
	# The M6 Create Guest images (SPEC-0013). The dialog offers every image of
	# the namespace and shows the phase of each, so the two that matter are the
	# one that is not Ready - selectable, with the will-wait line - and the
	# Windows one, whose own osType is what the created guest carries. The third
	# subject of those cases, e2e-guest-create-taken, gets no patch on purpose:
	# it exists to have its name taken, and a guest with no status at all is what
	# every guest this form creates looks like on a cluster with no controller.
	"swiftimages.image.kubeswift.io/e2e-image-importing=swiftimage-e2e-image-importing.yaml"
	"swiftimages.image.kubeswift.io/e2e-windows-2022=swiftimage-e2e-windows-2022.yaml"
	# The M6 Create Guest kernel and clone subjects (SPEC-0013 slice 2). The
	# kernel that is still Pulling is what the will-wait line is computed from -
	# and it says something different from the image one, because kernels are not
	# watched. The two snapshots are the tiers the clone grammar turns on: an s3
	# capture, which has to be told which node to download onto, and a local one
	# whose source guest is not in this namespace at all.
	"swiftkernels.kernel.kubeswift.io/e2e-kernel-pulling=swiftkernel-e2e-kernel-pulling.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-s3=swiftsnapshot-e2e-snapshot-create-s3.yaml"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-orphan=swiftsnapshot-e2e-snapshot-create-orphan.yaml"
)

# Readback assertions proving that the injected statuses survived the API
# server, one significant field per CRD.
#
# Format: <resource>/<name>=<jsonpath>=<expected value>
#
# The jsonpath may itself contain "=" (a condition filter does), so
# verify_statuses() takes the expected value from the LAST "=" of the entry and
# the path from everything in between. An expected value containing an "=" would
# therefore be ambiguous; none does.
E2E_STATUS_ASSERTIONS=(
	"swiftguests.swift.kubeswift.io/e2e-guest-running={.status.phase}=Running"
	"swiftguests.swift.kubeswift.io/e2e-guest-running={.status.network.primaryIP}=10.244.1.21"
	"swiftguests.swift.kubeswift.io/e2e-guest-gpu={.status.gpu.partitionId}=3"
	"swiftguestpools.swift.kubeswift.io/e2e-pool={.status.readyReplicas}=2"
	"swiftimages.image.kubeswift.io/e2e-ubuntu-2404={.status.phase}=Ready"
	"swiftkernels.kernel.kubeswift.io/e2e-kernel-6-12={.status.kernelDigest}=sha256:9b2c8f0e3a7d41c5b6e8d90a2f14c7b38e5a6d0c9f3b1e7a4d2c8b5f6a0e9d31"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready={.status.phase}=Ready"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-ready={.status.totalSizeBytes}=22548578304"
	"swiftrestores.snapshot.kubeswift.io/e2e-restore-clone={.status.guestRef.name}=e2e-guest-restored"
	"swiftsnapshotschedules.snapshot.kubeswift.io/e2e-schedule-nightly={.status.lastScheduleTime}=2026-08-27T02:00:00Z"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-completed={.status.mode}=offline"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-live={.status.transferProgress}=64"
	"swiftgpunodes.gpu.kubeswift.io/__NODE_NAME__={.status.phase}=Ready"
	"swiftgpunodes.gpu.kubeswift.io/__NODE_NAME__={.status.freeGPUs}=3"
	"swiftgpunodes.gpu.kubeswift.io/__NODE_NAME__={.status.vfioReady}=true"
	"swiftgpunodes.gpu.kubeswift.io/e2e-gpu-node-absent={.status.phase}=Error"
	"swiftgpunodes.gpu.kubeswift.io/e2e-gpu-node-absent={.status.vfioReady}=false"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running={.status.phase}=Running"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running={.status.podRef}=e2e-sandbox-running-launcher"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-failed={.status.phase}=Failed"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-failed={.status.exitCode}=1"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-pooled={.status.podRef}=e2e-sandbox-pool-slot-1"
	# The two counts the pool list puts side by side, because the gap between
	# them is the health of the pool. The degraded one reads back a literal 0,
	# which is the assert that keeps a dropped zero from looking like an absent
	# value.
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool={.status.warmReplicas}=2"
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool={.status.claimedReplicas}=1"
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool-degraded={.status.phase}=Degraded"
	"swiftsandboxpools.sandbox.kubeswift.io/e2e-sandbox-pool-degraded={.status.warmReplicas}=0"
	# The hub's literal 0, which is the readback that keeps a dropped zero from
	# looking like an absent value (the M4 degraded-pool assert applied to a
	# different field): the schema omits guestCount until the first sync, so 0
	# and absent are different facts.
	"clusters.fleet.kubeswift.io/e2e-fleet-hub={.status.guestCount}=0"
	"clusters.fleet.kubeswift.io/e2e-fleet-edge-1={.status.kubernetesVersion}=v1.34.3"
	"clusters.fleet.kubeswift.io/e2e-fleet-edge-1={.status.guestCount}=7"
	# Deliberately the same jsonPath shape the CRD's own Ready printer column
	# uses, so the assert proves the condition-keyed reading the M5 classifier
	# depends on survives the API server (SPEC-0009).
	'clusters.fleet.kubeswift.io/e2e-fleet-edge-down={.status.conditions[?(@.type=="Reachable")].status}=False'
	# The M6 subjects (SPEC-0010). The two `{.spec.runPolicy}` entries are the
	# first in this array to assert a SPEC field rather than a status one,
	# because they are the ones the E2E suite later overwrites from the UI: they
	# pin the value each write case starts from, so a case that appears to do
	# nothing is told apart from one that ran against an already-patched object.
	"swiftguests.swift.kubeswift.io/e2e-guest-action-running={.spec.runPolicy}=Always"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-running={.status.podRef.name}=e2e-guest-action-running-launcher"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-halfstopped={.spec.runPolicy}=Stopped"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-halfstopped={.status.phase}=Running"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-stopped={.status.phase}=Stopped"
	# The M6 restore subjects (SPEC-0011). The `{.spec.runPolicy}` entry is the
	# fact the in-place wedge warning is computed from, so it is pinned here the
	# same way the two SPEC-0010 policies are: a case that stops warning would
	# otherwise look like a UI regression rather than a mutated fixture.
	"swiftguests.swift.kubeswift.io/e2e-guest-restore-source={.spec.runPolicy}=Stopped"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-memory-ready={.status.phase}=Ready"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-memory-ready={.status.memorySnapshot.sizeBytes}=4294967296"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-failed={.status.phase}=Failed"
	# The M6 Migrate subjects (SPEC-0012). The node of the create subject is the
	# fact the picker's exclusion is measured against, the storage of the create
	# subject is what makes the live mode genuinely available on it, and the RWO
	# class is the one drift D1 is reproduced with - all three are read at click
	# time, so a fixture that did not land would look like a UI regression.
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-running={.status.nodeName}=e2e-migrate-source"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-running={.spec.storage.accessMode}=ReadWriteMany"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-rwo={.status.phase}=Running"
	"swiftguestclasses.swift.kubeswift.io/e2e-migrate-rwo={.spec.storage.volumeMode}=Filesystem"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-stopped={.status.phase}=Stopped"
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-sriov={.spec.interfaces[0].type}=sriov"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-inflight={.status.phase}=Preparing"
	# The M6 Create Guest subjects (SPEC-0013). The phase of the importing image
	# is what the will-wait line is computed from, and the Windows image's own
	# spec.osType is what the created guest's osType is asserted against - both
	# are read at click time, so a fixture that did not land would look like a UI
	# regression rather than a missing status.
	"swiftimages.image.kubeswift.io/e2e-image-importing={.status.phase}=Importing"
	"swiftimages.image.kubeswift.io/e2e-windows-2022={.status.phase}=Ready"
	"swiftimages.image.kubeswift.io/e2e-windows-2022={.spec.osType}=windows"
	# The slice-2 subjects, for the same reason: all four facts are read at click
	# time, and a fixture that did not land would look like a UI regression. The
	# backend of the s3 snapshot is what makes the target node required, and the
	# memory image of each is what makes them offerable at all - a snapshot with
	# no memorySnapshot is not in the picker.
	"swiftkernels.kernel.kubeswift.io/e2e-kernel-pulling={.status.phase}=Pulling"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-s3={.spec.backend.type}=s3"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-s3={.status.phase}=Ready"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-s3={.status.memorySnapshot.sizeBytes}=8589934592"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-orphan={.status.phase}=Ready"
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-orphan={.spec.guestRef.name}=e2e-guest-create-vanished"
)

# Fields whose fixture spells the cluster's real (single) node name as the
# __NODE_NAME__ placeholder rather than a literal, so that the fixture stays
# correct (and any drawer link built from it stays alive) on a cluster whose
# node is not named "kubeswift-e2e-control-plane" (issue #23). cluster-up.sh
# substitutes the placeholder - in the fixture manifests before applying them,
# and in the status patches and their targets before patching - and then
# verifies the readback here by name: unlike E2E_STATUS_ASSERTIONS above, the
# expected value is only known at runtime (it is whatever `kubectl get nodes`
# returns), so it cannot be a literal in this file.
#
# The SwiftGPUNode entry reads back `metadata.name` of the object the manifest
# named __NODE_NAME__: a SwiftGPUNode is named after the node it describes, and
# `metadata.name` cannot be patched after the fact, so that substitution has to
# happen in apply_fixtures() and this is the assert proving it landed.
#
# Format: <resource>/<name>=<jsonpath>
E2E_NODE_NAME_FIELDS=(
	"swiftguests.swift.kubeswift.io/e2e-guest-running={.status.nodeName}"
	"swiftguests.swift.kubeswift.io/e2e-guest-gpu={.status.gpu.nodeName}"
	"swiftmigrations.migration.kubeswift.io/e2e-migration-completed={.status.destinationNode}"
	"swiftgpunodes.gpu.kubeswift.io/__NODE_NAME__={.metadata.name}"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running={.status.nodeName}"
	"swiftsandboxes.sandbox.kubeswift.io/e2e-sandbox-running={.status.gpu.nodeName}"
	"swiftguests.swift.kubeswift.io/e2e-guest-action-running={.status.nodeName}"
	# The first entry of this array that reads a SPEC field: the M6 Start subject
	# pins itself to a node so the Start dialog's context line has a node to name
	# (B8), and a pin to a node that does not exist would be a different fact
	# from the one that line is meant to state.
	"swiftguests.swift.kubeswift.io/e2e-guest-action-stopped={.spec.nodeName}"
	# A `local` capture lives on exactly one node, and the snapshot drawer links
	# to it (SPEC-0011's memory fixture).
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-memory-ready={.status.nodeName}"
	# The one Migrate subject that really is on this cluster's node (SPEC-0012):
	# the picker excludes the node a guest is already on, so this substitution is
	# what makes the empty-picker case empty.
	"swiftguests.swift.kubeswift.io/e2e-guest-migrate-inflight={.status.nodeName}"
	# The clone's own local capture (SPEC-0013 slice 2): the Create Guest form
	# names this node where the target node picker would otherwise be, so the
	# substitution is what makes that sentence true rather than fictional.
	"swiftsnapshots.snapshot.kubeswift.io/e2e-snapshot-create-orphan={.status.nodeName}"
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

# The real name of the cluster's single node, which several fixtures are named
# after or point at through the __NODE_NAME__ placeholder. Read once by
# cluster-up.sh into E2E_NODE_NAME, since every substitution needs it.
cluster_node_name() {
	local node_name
	node_name="$(kubectl_e2e get nodes -o jsonpath='{.items[0].metadata.name}')"
	[ -n "${node_name}" ] || die "could not determine the node name of the ${E2E_CLUSTER_NAME} cluster"
	printf '%s' "${node_name}"
}

# Expands the __NODE_NAME__ placeholder in a fixture name or in a resource
# target. A no-op for every value that does not contain it, which is what makes
# this the same mechanism for all of them.
substitute_node_name() {
	printf '%s' "${1//__NODE_NAME__/${E2E_NODE_NAME}}"
}

# Turns an upstream CRD file name into the name of the CRD it defines, for
# example swift.kubeswift.io_swiftguests.yaml -> swiftguests.swift.kubeswift.io
crd_name_from_file() {
	local file="${1%.yaml}"
	printf '%s.%s' "${file#*_}" "${file%%_*}"
}

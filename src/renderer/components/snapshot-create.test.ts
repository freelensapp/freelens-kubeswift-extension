import { describe, expect, it } from "vitest";
import {
  backendChoices,
  backendWithArticle,
  canTakeSnapshot,
  createFailureMessage,
  csiCaptureWaits,
  defaultSnapshotForm,
  defaultSnapshotName,
  frozenVmWarning,
  memoryCaptureGuard,
  snapshotCreatePayload,
  snapshotDeleteConsequences,
  snapshotErrors,
  snapshotSuccessMessage,
  snapshotSummary,
  snapshotWarnings,
  submitBlockReason,
  submitIsAccented,
} from "./snapshot-create";

import type { SnapshotFormValues, SnapshotGuestFacts } from "./snapshot-create";

const guest = (
  spec?: SnapshotGuestFacts["spec"],
  status?: SnapshotGuestFacts["status"],
  annotations?: Record<string, string | undefined>,
): SnapshotGuestFacts => ({
  name: "demo",
  namespace: "vms",
  annotations,
  spec,
  status,
});

/** A guest a memory capture is offered for: running, with the launcher pod its controller recorded. */
const runningGuest = guest({}, { phase: "Running", podRef: { name: "demo-launcher" } });

/** The form as the dialog opens it, at a fixed instant. */
const form = (patch: Partial<SnapshotFormValues> = {}): SnapshotFormValues => ({
  ...defaultSnapshotForm(runningGuest, new Date(2026, 7, 30, 14, 5, 9)),
  ...patch,
});

const summaryText = (facts: { notes: string[]; warnings: string[] }) => [...facts.notes, ...facts.warnings].join(" ");

describe("backendWithArticle", () => {
  it("gives the two names that are read out letter by letter their vowel article", () => {
    expect(backendWithArticle("s3")).toBe("an s3");
    expect(backendWithArticle("oci")).toBe("an oci");
  });

  it("leaves the two that are read as words on 'a'", () => {
    expect(backendWithArticle("local")).toBe("a local");
    expect(backendWithArticle("csi-volume-snapshot")).toBe("a csi-volume-snapshot");
  });
});

describe("canTakeSnapshot", () => {
  // The verb has no state in which it writes nothing: csi accepts a running and
  // a stopped guest, and for every unsettled phase the object waits in Pending
  // instead of failing. The gating that matters is per-backend, inside the
  // dialog, where the backend choice exists.
  it.each([
    guest(),
    guest({}, { phase: "Running", podRef: { name: "demo-launcher" } }),
    guest({}, { phase: "Stopped" }),
    guest({}, { phase: "Failed" }),
  ])("offers the action for every guest state (%#)", (subject) => {
    expect(canTakeSnapshot(subject).enabled).toBe(true);
  });
});

describe("the per-backend gating table", () => {
  const backends = (subject: SnapshotGuestFacts) =>
    Object.fromEntries(backendChoices(subject).map((choice) => [choice.type, choice.guard.enabled]));

  it("offers every backend for a running guest with a recorded launcher pod", () => {
    expect(backends(runningGuest)).toEqual({
      "csi-volume-snapshot": true,
      local: true,
      s3: true,
      oci: true,
    });
  });

  it.each([
    ["Stopped", { phase: "Stopped" }],
    ["Pending", { phase: "Pending" }],
    ["Scheduling", { phase: "Scheduling" }],
    ["Failed", { phase: "Failed" }],
    ["absent", {}],
  ])("refuses the memory backends and keeps csi for a %s guest", (_label, status) => {
    expect(backends(guest({}, status))).toEqual({
      "csi-volume-snapshot": true,
      local: false,
      s3: false,
      oci: false,
    });
  });

  // The state the controller cannot capture from and does not fail either: it
  // requeues every 5 seconds forever, with no deadline until `Capturing`.
  it("says a memory capture would park in Pending forever rather than fail", () => {
    const verdict = memoryCaptureGuard(guest({}, { phase: "Stopped" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("park the snapshot in Pending forever");
    expect(verdict.reason).toContain("is Stopped");
    expect(verdict.reason).toContain("no launcher pod is recorded");
  });

  // A guest whose phase says Running while no pod is recorded is the same
  // situation for a capture: swiftletd is reached through that pod.
  it("refuses a memory capture of a Running guest with no launcher pod recorded", () => {
    const verdict = memoryCaptureGuard(guest({}, { phase: "Running" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("no launcher pod is recorded");
  });

  it("says which situation an object with no status at all is in", () => {
    expect(memoryCaptureGuard(guest()).reason).toContain("has no phase yet");
  });
});

// The three rules upstream's own validating webhook enforces, and which nobody
// enforces on a default install because that webhook ships disabled.
describe("the guests a memory capture cannot pause safely", () => {
  const running = { phase: "Running", podRef: { name: "demo-launcher" } };

  it("refuses a guest with a GPU profile, naming the profile", () => {
    const verdict = memoryCaptureGuard(guest({ gpuProfileRef: { name: "hgx" } }, running));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("GPU");
    expect(verdict.reason).toContain("hgx");
  });

  it("refuses a guest with an SR-IOV interface, naming the interface", () => {
    const verdict = memoryCaptureGuard(
      guest(
        {
          interfaces: [
            { name: "eth0", type: "bridge" },
            { name: "vf0", type: "sriov" },
          ],
        },
        running,
      ),
    );

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("SR-IOV");
    expect(verdict.reason).toContain("vf0");
  });

  it("does not refuse a guest whose interfaces are all bridges", () => {
    expect(memoryCaptureGuard(guest({ interfaces: [{ name: "eth0", type: "bridge" }] }, running)).enabled).toBe(true);
  });

  it("refuses a guest pinned to qemu by annotation", () => {
    const verdict = memoryCaptureGuard(guest({}, running, { "kubeswift.io/hypervisor-override": "qemu" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("kubeswift.io/hypervisor-override");
  });

  it("ignores a hypervisor override that is not qemu, and unrelated annotations", () => {
    expect(
      memoryCaptureGuard(guest({}, running, { "kubeswift.io/hypervisor-override": "cloud-hypervisor" })).enabled,
    ).toBe(true);
    expect(memoryCaptureGuard(guest({}, running, { "example.com/owner": "qemu" })).enabled).toBe(true);
  });

  // The live-state rule is deliberately checked first: it is the refusal an
  // operator can act on, and starting the guest would not change the other three.
  it("reports the state before the shape, because the state is the fixable one", () => {
    const verdict = memoryCaptureGuard(guest({ gpuProfileRef: { name: "hgx" } }, { phase: "Stopped" }));

    expect(verdict.reason).toContain("park the snapshot in Pending forever");
  });
});

// W4, written as a loop over a table rather than one assertion per case, so a
// future branch cannot be added without a reason.
describe("the gating invariant", () => {
  const cases: SnapshotGuestFacts[] = [
    guest(),
    guest({}, {}),
    guest({}, { phase: "Running" }),
    guest({}, { phase: "Running", podRef: { name: "p" } }),
    guest({}, { phase: "Stopped" }),
    guest({}, { phase: "Pending" }),
    guest({}, { phase: "Scheduling" }),
    guest({}, { phase: "Failed" }),
    guest({}, { phase: "Hibernating" }),
    guest({ gpuProfileRef: { name: "hgx" } }, { phase: "Running", podRef: { name: "p" } }),
    guest({ interfaces: [{ name: "vf0", type: "sriov" }] }, { phase: "Running", podRef: { name: "p" } }),
    guest({}, { phase: "Running", podRef: { name: "p" } }, { "kubeswift.io/hypervisor-override": "qemu" }),
  ];

  it.each(cases)("never disables a backend without saying why (%#)", (subject) => {
    for (const choice of backendChoices(subject)) {
      if (!choice.guard.enabled) {
        expect(choice.guard.reason.length).toBeGreaterThan(0);
      }
    }

    expect(canTakeSnapshot(subject).enabled).toBe(true);
  });

  it("gives every backend its Contents reading, whether or not it is offered", () => {
    expect(backendChoices(guest({}, { phase: "Stopped" })).map((choice) => choice.contents)).toEqual([
      "Disk",
      "Memory + disk",
      "Memory + disk",
      "Memory",
    ]);
  });
});

describe("the defaults", () => {
  it("names the snapshot after the guest and the local wall clock, to the second", () => {
    expect(defaultSnapshotName("demo", new Date(2026, 7, 30, 14, 5, 9))).toBe("demo-20260830-140509");
  });

  it("opens on csi, resuming after the capture, with the Delete policy and no TTL", () => {
    const values = defaultSnapshotForm(runningGuest, new Date(2026, 7, 30, 14, 5, 9));

    expect(values.backend).toBe("csi-volume-snapshot");
    expect(values.resumeAfterSnapshot).toBe(true);
    expect(values.deletionPolicy).toBe("Delete");
    expect(values.ttl).toBe("");
    expect(submitBlockReason(values)).toBeUndefined();
  });
});

describe("the validation that replaces the absent webhook", () => {
  it("requires a name, and requires it to be a legal object name", () => {
    expect(snapshotErrors(form({ name: "" })).name).toContain("required");
    expect(snapshotErrors(form({ name: "Demo Snapshot" })).name).toContain("lowercase");
    expect(snapshotErrors(form({ name: "-demo" })).name).toBeDefined();
    expect(snapshotErrors(form({ name: "demo.snap-1" })).name).toBeUndefined();
  });

  describe("the local backend", () => {
    const local = (hostPath: string) => snapshotErrors(form({ backend: "local", hostPath })).hostPath;

    it("requires a host path", () => {
      expect(local("")).toContain("/var/lib/kubeswift/snapshots/");
    });

    it("requires the upstream prefix", () => {
      expect(local("/tmp/snapshots/demo")).toContain("must be under /var/lib/kubeswift/snapshots/");
      expect(local("/var/lib/kubeswift/snapshots/demo")).toBeUndefined();
    });

    it("refuses a path that climbs out of the prefix", () => {
      expect(local("/var/lib/kubeswift/snapshots/../../demo")).toContain("'..'");
    });

    it("is silent about the host path on every other backend", () => {
      expect(snapshotErrors(form({ backend: "csi-volume-snapshot" })).hostPath).toBeUndefined();
      expect(
        snapshotErrors(form({ backend: "s3", bucket: "b", s3CredentialsSecret: "s", region: "r" })).hostPath,
      ).toBeUndefined();
    });
  });

  describe("the s3 backend", () => {
    const s3 = (patch: Partial<SnapshotFormValues>) => snapshotErrors(form({ backend: "s3", ...patch }));

    it("requires a bucket and a credentials Secret", () => {
      const errors = s3({});

      expect(errors.bucket).toContain("required");
      expect(errors.s3CredentialsSecret).toContain("required");
    });

    it("requires a region unless an endpoint is set", () => {
      expect(s3({ bucket: "b", s3CredentialsSecret: "s" }).region).toContain("unless an endpoint");
      expect(s3({ bucket: "b", s3CredentialsSecret: "s", region: "eu-west-1" }).region).toBeUndefined();
      expect(s3({ bucket: "b", s3CredentialsSecret: "s", endpoint: "https://minio" }).region).toBeUndefined();
    });
  });

  describe("the oci backend", () => {
    const oci = (patch: Partial<SnapshotFormValues>) => snapshotErrors(form({ backend: "oci", ...patch }));

    it("requires a repository", () => {
      expect(oci({}).repository).toContain("required");
      expect(oci({ repository: "registry.example.com/snapshots/demo" }).repository).toBeUndefined();
    });

    it("accepts a bare tag and nothing else", () => {
      const repository = "registry.example.com/snapshots/demo";

      expect(oci({ repository, tag: "nightly" }).tag).toBeUndefined();
      expect(oci({ repository, tag: "" }).tag).toBeUndefined();
      expect(oci({ repository, tag: "demo:nightly" }).tag).toContain("bare tag");
      expect(oci({ repository, tag: "demo@sha256:abc" }).tag).toContain("bare tag");
      expect(oci({ repository, tag: "team/nightly" }).tag).toContain("bare tag");
    });
  });

  // The field is a bare string in the schema and a `metav1.Duration` in Go, so
  // the API server's own decoder is the thing being mirrored here (C8).
  describe("the TTL", () => {
    const ttlError = (ttl: string) => snapshotErrors(form({ ttl })).ttl;

    it.each(["30m", "72h", "1h30m", "1h30m10s", "500ms", "0s", "1.5h"])("accepts the Go duration %s", (ttl) => {
      expect(ttlError(ttl)).toBeUndefined();
    });

    it.each(["7d", "1w", "forever", "30", "30 m", "h", "-"])("rejects %s", (ttl) => {
      expect(ttlError(ttl)).toBeDefined();
    });

    it("says which units exist, and that days are not one of them", () => {
      const message = ttlError("7d");

      expect(message).toContain("ns, us, ms, s, m and h");
      expect(message).toContain("168h");
    });

    it("accepts an empty TTL, because the field is optional", () => {
      expect(ttlError("")).toBeUndefined();
    });
  });
});

describe("the submit verdict", () => {
  it("names the field and the reason, never just refusing", () => {
    const reason = submitBlockReason(form({ backend: "local", hostPath: "" }));

    expect(reason).toContain("Host path");
    expect(reason).toContain("/var/lib/kubeswift/snapshots/");
  });

  it("reports the first offending field in a stable order", () => {
    expect(submitBlockReason(form({ name: "", backend: "local", hostPath: "" }))).toContain("Name");
  });

  it("is silent when the form is valid", () => {
    expect(submitBlockReason(form())).toBeUndefined();
    expect(
      submitBlockReason(form({ backend: "s3", bucket: "b", s3CredentialsSecret: "s", region: "eu-west-1" })),
    ).toBeUndefined();
  });

  // The one combination that terminates service until a human intervenes, and
  // the only one that earns the accent styling Stop uses.
  it("accents the button only for a memory capture that will not resume", () => {
    expect(submitIsAccented(form({ backend: "local", resumeAfterSnapshot: false }))).toBe(true);
    expect(submitIsAccented(form({ backend: "local", resumeAfterSnapshot: true }))).toBe(false);
    expect(submitIsAccented(form({ backend: "csi-volume-snapshot", resumeAfterSnapshot: false }))).toBe(false);
  });
});

// Warnings never block: the store can be stale, the API server is the authority,
// and the 409 path is what a warned submit runs into.
describe("the collision warnings", () => {
  const existing = [
    { name: "demo-20260830-120000", hostPath: "/var/lib/kubeswift/snapshots/demo-noon" },
    { name: "other" },
  ];

  it("warns about a name the store already holds, without making it an error", () => {
    const values = form({ name: "demo-20260830-120000" });

    expect(snapshotWarnings(values, existing).name).toContain("already exists");
    expect(snapshotErrors(values).name).toBeUndefined();
    expect(submitBlockReason(values)).toBeUndefined();
  });

  it("says nothing about a name nothing holds, or when the store answered with nothing", () => {
    expect(snapshotWarnings(form({ name: "demo-20260830-140509" }), existing).name).toBeUndefined();
    expect(snapshotWarnings(form({ name: "demo-20260830-120000" }), []).name).toBeUndefined();
  });

  // The capture wipes its destination directory before writing, so a reused path
  // destroys the previous snapshot's artifacts while that object still reads
  // Ready. Only a client holding the namespace's snapshots can see it coming.
  it("warns that a reused host path destroys the other snapshot's artifacts", () => {
    const values = form({ backend: "local", hostPath: "/var/lib/kubeswift/snapshots/demo-noon" });
    const warning = snapshotWarnings(values, existing).hostPath;

    expect(warning).toContain("demo-20260830-120000");
    expect(warning).toContain("wipes the destination directory");
    expect(snapshotErrors(values).hostPath).toBeUndefined();
  });

  it("says nothing about a host path no other snapshot uses", () => {
    expect(
      snapshotWarnings(form({ backend: "local", hostPath: "/var/lib/kubeswift/snapshots/fresh" }), existing).hostPath,
    ).toBeUndefined();
  });

  it("does not look for a host path collision on the other backends", () => {
    expect(snapshotWarnings(form({ backend: "csi-volume-snapshot" }), existing).hostPath).toBeUndefined();
  });
});

describe("the payload", () => {
  it("never sends includeMemory or includeDisk, on any backend", () => {
    for (const backend of ["csi-volume-snapshot", "local", "s3", "oci"] as const) {
      const { spec } = snapshotCreatePayload(runningGuest, form({ backend }));

      expect(spec).not.toHaveProperty("includeMemory");
      expect(spec).not.toHaveProperty("includeDisk");
    }
  });

  it("sends the guest, the backend and the policy, and nothing else, for a plain csi capture", () => {
    expect(snapshotCreatePayload(runningGuest, form()).spec).toEqual({
      guestRef: { name: "demo" },
      backend: { type: "csi-volume-snapshot" },
      deletionPolicy: "Delete",
    });
  });

  it("omits the VolumeSnapshotClass when the field is empty, so the cluster default applies", () => {
    expect(snapshotCreatePayload(runningGuest, form({ volumeSnapshotClassName: " " })).spec.backend).toEqual({
      type: "csi-volume-snapshot",
    });
    expect(
      snapshotCreatePayload(runningGuest, form({ volumeSnapshotClassName: "csi-hostpath" })).spec.backend
        .csiVolumeSnapshot,
    ).toEqual({ volumeSnapshotClassName: "csi-hostpath" });
  });

  it("sends the host path of a local capture, trimmed", () => {
    const { spec } = snapshotCreatePayload(
      runningGuest,
      form({ backend: "local", hostPath: " /var/lib/kubeswift/snapshots/demo " }),
    );

    expect(spec.backend.local).toEqual({ hostPath: "/var/lib/kubeswift/snapshots/demo" });
    expect(spec.resumeAfterSnapshot).toBe(true);
  });

  it("sends resumeAfterSnapshot only where the field means something", () => {
    expect(snapshotCreatePayload(runningGuest, form()).spec).not.toHaveProperty("resumeAfterSnapshot");
    expect(
      snapshotCreatePayload(runningGuest, form({ backend: "local", hostPath: "/var/lib/kubeswift/snapshots/d" })).spec
        .resumeAfterSnapshot,
    ).toBe(true);
    expect(
      snapshotCreatePayload(runningGuest, form({ backend: "oci", repository: "r", resumeAfterSnapshot: false })).spec
        .resumeAfterSnapshot,
    ).toBe(false);
  });

  it("sends the s3 fields that are filled in, and omits the ones that are not", () => {
    const { spec } = snapshotCreatePayload(
      runningGuest,
      form({ backend: "s3", bucket: "backups", s3CredentialsSecret: "s3-creds", endpoint: "https://minio" }),
    );

    expect(spec.backend.s3).toEqual({
      bucket: "backups",
      credentialsSecretRef: { name: "s3-creds" },
      endpoint: "https://minio",
    });
  });

  it("sends the s3 booleans only when they are on", () => {
    const values = {
      backend: "s3" as const,
      bucket: "backups",
      s3CredentialsSecret: "s3-creds",
      region: "eu-west-1",
      prefix: "nightly",
    };

    expect(snapshotCreatePayload(runningGuest, form(values)).spec.backend.s3).toEqual({
      bucket: "backups",
      credentialsSecretRef: { name: "s3-creds" },
      region: "eu-west-1",
      prefix: "nightly",
    });
    expect(
      snapshotCreatePayload(runningGuest, form({ ...values, forcePathStyle: true, s3Insecure: true })).spec.backend.s3,
    ).toMatchObject({ forcePathStyle: true, insecure: true });
  });

  it("sends the oci repository, and the tag only when one was typed", () => {
    const repository = "registry.example.com/snapshots/demo";

    expect(snapshotCreatePayload(runningGuest, form({ backend: "oci", repository })).spec.backend.oci).toEqual({
      repository,
    });
    expect(
      snapshotCreatePayload(
        runningGuest,
        form({ backend: "oci", repository, tag: "nightly", ociCredentialsSecret: "pull", signingKeySecret: "cosign" }),
      ).spec.backend.oci,
    ).toEqual({
      repository,
      tag: "nightly",
      credentialsSecretRef: { name: "pull" },
      signingKeySecretRef: { name: "cosign" },
    });
  });

  // Carrier exclusivity is a webhook rule this form cannot break: the backend
  // type picks exactly one carrier, so the invalid combinations are unreachable
  // rather than validated.
  it.each(["csi-volume-snapshot", "local", "s3", "oci"] as const)(
    "builds exactly one carrier object, for the %s backend",
    (backend) => {
      const { spec } = snapshotCreatePayload(
        runningGuest,
        form({
          backend,
          hostPath: "/var/lib/kubeswift/snapshots/demo",
          volumeSnapshotClassName: "csi-hostpath",
          bucket: "backups",
          s3CredentialsSecret: "s3-creds",
          region: "eu-west-1",
          repository: "registry.example.com/snapshots/demo",
        }),
      );
      const carriers = ["csiVolumeSnapshot", "local", "s3", "oci"].filter(
        (carrier) => spec.backend[carrier as "local"] !== undefined,
      );

      expect(spec.backend.type).toBe(backend);
      expect(carriers).toHaveLength(1);
    },
  );

  it("sends a TTL only when one was typed, trimmed", () => {
    expect(snapshotCreatePayload(runningGuest, form()).spec).not.toHaveProperty("ttl");
    expect(snapshotCreatePayload(runningGuest, form({ ttl: " 72h " })).spec.ttl).toBe("72h");
  });

  it("sends the chosen deletion policy", () => {
    expect(snapshotCreatePayload(runningGuest, form({ deletionPolicy: "Retain" })).spec.deletionPolicy).toBe("Retain");
  });
});

describe("the write summary", () => {
  it("names the one API call it makes, with the namespace and the name", () => {
    expect(snapshotSummary(runningGuest, form({ name: "demo-snap" })).write).toBe("Create SwiftSnapshot vms/demo-snap");
  });

  it("says what each backend captures", () => {
    expect(summaryText(snapshotSummary(runningGuest, form()))).toContain("root disk only");
    expect(
      summaryText(
        snapshotSummary(runningGuest, form({ backend: "local", hostPath: "/var/lib/kubeswift/snapshots/d" })),
      ),
    ).toContain("memory and device state");
    expect(summaryText(snapshotSummary(runningGuest, form({ backend: "oci", repository: "r" })))).toContain(
      "pushes it to the registry",
    );
  });

  it("names where the artifacts land, once the field says where", () => {
    expect(summaryText(snapshotSummary(runningGuest, form()))).toContain("default VolumeSnapshotClass");
    expect(summaryText(snapshotSummary(runningGuest, form({ volumeSnapshotClassName: "csi-hostpath" })))).toContain(
      "class csi-hostpath",
    );
    expect(
      summaryText(
        snapshotSummary(runningGuest, form({ backend: "local", hostPath: "/var/lib/kubeswift/snapshots/d" })),
      ),
    ).toContain("/var/lib/kubeswift/snapshots/d");
    expect(
      summaryText(snapshotSummary(runningGuest, form({ backend: "s3", bucket: "backups", prefix: "nightly" }))),
    ).toContain("bucket backups, under nightly");
    expect(summaryText(snapshotSummary(runningGuest, form({ backend: "oci", repository: "reg/demo" })))).toContain(
      "tagged <namespace>-<name> by the server",
    );
  });

  // The pause is the fact a memory capture costs, and upstream's own three
  // published figures for its length disagree by an order of magnitude, so the
  // line states the shape and promises no number.
  it("states the pause for the memory backends, and for those only", () => {
    for (const backend of ["local", "s3", "oci"] as const) {
      expect(summaryText(snapshotSummary(runningGuest, form({ backend })))).toContain("paused for the whole capture");
    }

    const csi = summaryText(snapshotSummary(runningGuest, form()));

    expect(csi).not.toContain("paused for the whole capture");
    expect(csi).toContain("never pauses the VM");
  });

  it("promises no pause duration", () => {
    const text = summaryText(snapshotSummary(runningGuest, form({ backend: "local" })));

    expect(text).toContain("grows with the guest's memory");
    expect(text).not.toMatch(/\d+\s*(second|s\/GiB)/);
  });

  it("warns that an unresumed VM stays paused, only when resume is unchecked", () => {
    const frozen = snapshotSummary(runningGuest, form({ backend: "local", resumeAfterSnapshot: false }));

    // The same sentence the checkbox itself carries: the summary has to
    // enumerate the whole write, and the cost has to be visible where it is
    // chosen, so the two render one shared constant rather than two wordings.
    expect(frozen.warnings).toEqual([frozenVmWarning]);
    expect(frozenVmWarning).toContain("nothing in the cluster ever resumes this VM");
    expect(snapshotSummary(runningGuest, form({ backend: "local" })).warnings).toEqual([]);
    // The checkbox is not rendered for csi, and its value must not leak into the
    // summary either.
    expect(snapshotSummary(runningGuest, form({ resumeAfterSnapshot: false })).warnings).toEqual([]);
  });

  it("says a csi capture of an unsettled guest will wait, and nothing of a settled one", () => {
    const waiting = summaryText(snapshotSummary(guest({}, { phase: "Pending" }), form()));

    expect(waiting).toContain("waits in Pending");
    expect(summaryText(snapshotSummary(runningGuest, form()))).not.toContain("waits in Pending");
    expect(summaryText(snapshotSummary(guest({}, { phase: "Stopped" }), form()))).not.toContain("waits in Pending");
  });

  it("knows which phases are settled for a csi capture", () => {
    expect(csiCaptureWaits(runningGuest)).toBe(false);
    expect(csiCaptureWaits(guest({}, { phase: "Stopped" }))).toBe(false);
    expect(csiCaptureWaits(guest({}, { phase: "Failed" }))).toBe(true);
    expect(csiCaptureWaits(guest())).toBe(true);
  });

  // The deletion policy means what it says on local and s3, and does not on the
  // other two - which is the only reason the note exists at all (C9).
  it("corrects the deletion policy exactly where it lies", () => {
    expect(summaryText(snapshotSummary(runningGuest, form()))).toContain("follows the VolumeSnapshotClass");
    expect(summaryText(snapshotSummary(runningGuest, form({ backend: "oci", repository: "r" })))).toContain(
      "nothing purges registry artifacts",
    );

    for (const backend of ["local", "s3"] as const) {
      expect(summaryText(snapshotSummary(runningGuest, form({ backend })))).not.toContain("Deletion policy");
    }
  });
});

describe("the outcome and failure messages", () => {
  it("names the object that was created", () => {
    expect(snapshotSuccessMessage("demo-20260830-140509")).toBe("SwiftSnapshot demo-20260830-140509 created");
  });

  const context = { namespace: "vms", name: "demo-snap" };

  it("turns the 409 of an ignored collision warning into a rename instruction", () => {
    const alreadyExists = 'swiftsnapshots.snapshot.kubeswift.io "demo-snap" already exists';
    const message = createFailureMessage({ code: 409, message: alreadyExists, alreadyNotified: false }, context);

    expect(message).toContain("already exists in the namespace vms");
    expect(message).toContain("Change the name");
    expect(message).toContain(alreadyExists);
  });

  it("prefixes a 403 with the verb, the resource and the namespace", () => {
    const message = createFailureMessage({ code: 403, message: "is forbidden", alreadyNotified: false }, context);

    expect(message).toContain("not allowed to create swiftsnapshots in the namespace vms");
  });

  it("says what a 404 on a create really means", () => {
    const message = createFailureMessage({ code: 404, message: "not found", alreadyNotified: false }, context);

    expect(message).toContain("the namespace vms or the SwiftSnapshot CRD is gone");
  });

  it("passes anything else through exactly as the API server said it", () => {
    const webhook = "admission webhook denied the request: hostPath must be under /var/lib/kubeswift/snapshots/";

    expect(createFailureMessage({ code: 422, message: webhook, alreadyNotified: false }, context)).toBe(webhook);
  });
});

// The drawer's On Delete row: what deleting THIS snapshot destroys, computed
// from its own backend and policy rather than stated in the abstract.
describe("the delete consequences", () => {
  it("hands the artifact's fate to the VolumeSnapshotClass on csi, under either policy", () => {
    for (const policy of ["Delete", "Retain"] as const) {
      const text = snapshotDeleteConsequences("csi-volume-snapshot", policy).join(" ");

      expect(text).toContain("VolumeSnapshot goes with this object");
      expect(text).toContain("follows the VolumeSnapshotClass");
    }
  });

  it("purges or keeps the host path directory, per the policy", () => {
    expect(snapshotDeleteConsequences("local", "Delete").join(" ")).toContain("directory on the node is purged");
    expect(snapshotDeleteConsequences("local", "Retain").join(" ")).toContain("directory on the node is kept");
  });

  it("purges or keeps the S3 prefix, per the policy", () => {
    expect(snapshotDeleteConsequences("s3", "Delete").join(" ")).toContain("S3 prefix are purged");
    expect(snapshotDeleteConsequences("s3", "Retain").join(" ")).toContain("S3 prefix are kept");
  });

  // The gap upstream documents nowhere: the finalizer dispatcher covers local
  // and s3 only, so registry artifacts survive both policies.
  it("keeps the registry artifacts on oci regardless of the policy", () => {
    for (const policy of ["Delete", "Retain"] as const) {
      expect(snapshotDeleteConsequences("oci", policy).join(" ")).toContain("stay regardless of the");
    }
  });

  it("says a delete is never blocked, whatever the backend", () => {
    for (const backend of ["csi-volume-snapshot", "local", "s3", "oci", undefined] as const) {
      expect(snapshotDeleteConsequences(backend, "Delete").join(" ")).toContain("never blocked");
    }
  });

  it("admits it does not know an unknown backend rather than inventing one", () => {
    expect(snapshotDeleteConsequences(undefined, "Delete").join(" ")).toContain("unverified");
  });
});

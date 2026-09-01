import { describe, expect, it } from "vitest";
import {
  canOpenGuestConsole,
  canOpenSandboxConsole,
  conventionalSandboxConsoleFile,
  conventionalSerialSocket,
  guestConsoleCommand,
  guestConsoleDrawerExplanation,
  guestConsoleTabTitle,
  guestConsoleTooltip,
  guestConsoleTooltipSentences,
  guestRunDirectoryKey,
  guestSerialSocket,
  isSandboxCheckout,
  isSandboxColdFallback,
  isUsableSocketPath,
  sandboxConsoleCommand,
  sandboxConsoleDrawerExplanation,
  sandboxConsoleFile,
  sandboxConsoleTabTitle,
  sandboxConsoleTooltip,
  sandboxConsoleTooltipSentences,
  sandboxLauncherPodName,
  sandboxRunDirectoryKey,
  shellQuote,
} from "./console-commands";

import type { GuestConsoleFacts, SandboxConsoleFacts } from "./console-commands";

type ConsoleSpec = NonNullable<GuestConsoleFacts["spec"]>;
type ConsoleStatus = NonNullable<GuestConsoleFacts["status"]>;

const guest = (status?: ConsoleStatus, spec?: ConsoleSpec): GuestConsoleFacts => ({
  name: "demo",
  namespace: "vms",
  spec,
  status,
});

const podRef = { name: "demo-launcher", namespace: "vms" };
const running: ConsoleStatus = { phase: "Running", podRef };

/** The path the convention derives for the `vms/demo` guest of these tests. */
const conventionPath = "/var/lib/kubeswift/run/vms-demo/serial.sock";

describe("canOpenGuestConsole", () => {
  it("is enabled for a Running guest whose status names a launcher pod", () => {
    expect(canOpenGuestConsole(guest(running)).enabled).toBe(true);
  });

  it("names the stop mechanism rather than the missing pod for a stopped guest", () => {
    // The order the guard tests in is the point: a stopped guest has no podRef
    // either, and the useful sentence is the one that says WHY there is none.
    const verdict = canOpenGuestConsole(guest({ phase: "Stopped" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("stopping deletes its launcher pod");
  });

  it("says what survives a migration", () => {
    const verdict = canOpenGuestConsole(guest({ phase: "Migrating", podRef }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("socket path is keyed on the guest and does not change");
  });

  it.each(["Pending", "Scheduling", "Failed"])("names the phase %s", (phase) => {
    const verdict = canOpenGuestConsole(guest({ phase, podRef }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain(`its phase is ${phase}`);
  });

  it("is disabled when the status names no launcher pod", () => {
    const verdict = canOpenGuestConsole(guest({ phase: "Running" }));

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("names no launcher pod yet");
  });

  it("is disabled for a guest with no status at all", () => {
    // The state every guest is in between creation and the first
    // reconciliation: there is no pod to exec into, so there is nothing to say
    // beyond that.
    const verdict = canOpenGuestConsole(guest());

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("names no launcher pod yet");
  });

  // W4: unknown or unparseable state permits the action rather than blocking
  // it. The guard is a convenience; the controller and RBAC are the authority,
  // and kubectl will say what it finds.
  it.each(["Terminating", "Paused", "", undefined])("permits the unknown phase %s when a pod is named", (phase) => {
    expect(canOpenGuestConsole(guest({ phase: phase as string | undefined, podRef })).enabled).toBe(true);
  });

  it("is not disabled for a Windows guest", () => {
    // "Expected to be silent" is not "impossible": a serial-enabled Windows
    // image would work, so the fact goes in the tooltip and not in a veto.
    expect(canOpenGuestConsole(guest(running, { osType: "windows" })).enabled).toBe(true);
  });

  // The invariant SPEC-0010 established, asserted over every input this guard
  // distinguishes: a disabled outcome can never exist without a reason.
  it("never disables without a reason", () => {
    const inputs: GuestConsoleFacts[] = [
      guest(),
      guest({}),
      guest({ phase: "Running" }),
      guest({ phase: "Running", podRef }),
      guest({ phase: "Pending", podRef }),
      guest({ phase: "Pending" }),
      guest({ phase: "Scheduling", podRef }),
      guest({ phase: "Stopped" }),
      guest({ phase: "Stopped", podRef }),
      guest({ phase: "Failed", podRef }),
      guest({ phase: "Migrating", podRef }),
      guest({ phase: "Whatever", podRef }),
      guest(running, { osType: "windows" }),
      guest(running, { osType: "linux" }),
    ];

    for (const input of inputs) {
      const verdict = canOpenGuestConsole(input);

      if (!verdict.enabled) {
        expect(verdict.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("the run-directory key rules", () => {
  // The inversion, pinned as a pair because reading either rule alone is
  // exactly how it gets implemented backwards.
  it("keys a guest on the guest name, even when its pod is named differently", () => {
    expect(guestRunDirectoryKey("vms", "demo")).toBe("vms-demo");
    // The live-migration case: the pod is `demo-mig-<uid>` and the directory,
    // and therefore the socket path, does not move.
    expect(guestRunDirectoryKey("vms", "demo")).not.toContain("mig");
  });

  it("keys a sandbox on the pod name, which for a checkout is the slot's pod", () => {
    expect(sandboxRunDirectoryKey("vms", "pool-slot-1")).toBe("vms-pool-slot-1");
    expect(sandboxRunDirectoryKey("vms", "pool-slot-1")).not.toContain("build-42");
  });

  it("produces the same key for a cold sandbox, whose pod is named after itself", () => {
    // The case that hides the mistake: when the two coincide, a backwards
    // implementation is indistinguishable from a correct one.
    expect(sandboxRunDirectoryKey("vms", "build-42")).toBe(guestRunDirectoryKey("vms", "build-42"));
  });

  it("inverts for the same objects: a guest keyed on the pod would be wrong", () => {
    const guestKey = guestRunDirectoryKey("vms", "demo");
    const sandboxKey = sandboxRunDirectoryKey("vms", "demo-mig-9f2c");

    expect(guestKey).not.toBe(sandboxKey);
    expect(conventionalSerialSocket(guestKey)).toBe(conventionPath);
  });
});

describe("isUsableSocketPath", () => {
  it("accepts an absolute path made of path characters", () => {
    expect(isUsableSocketPath("/var/lib/kubeswift/run/vms-demo/serial.sock")).toBe(true);
    expect(isUsableSocketPath("/var/run/kubeswift/demo-1.2_3/serial.sock")).toBe(true);
  });

  it.each([
    ["a relative path", "var/lib/kubeswift/run/vms-demo/serial.sock"],
    ["a command separator", "/var/lib/x/serial.sock; rm -rf /"],
    ["a command substitution", "/var/lib/$(id)/serial.sock"],
    ["a backtick", "/var/lib/`id`/serial.sock"],
    ["a single quote", "/var/lib/x'/serial.sock"],
    ["a double quote", '/var/lib/x"/serial.sock'],
    ["a newline", "/var/lib/x\n/serial.sock"],
    ["a space", "/var/lib/x /serial.sock"],
    ["a comma, which is a socat option separator", "/var/lib/x,fork/serial.sock"],
    ["a colon, which is a socat address separator", "/var/lib/x:EXEC/serial.sock"],
    ["an empty string", ""],
  ])("rejects %s", (_case, value) => {
    expect(isUsableSocketPath(value)).toBe(false);
  });

  it("rejects an absent value", () => {
    expect(isUsableSocketPath(undefined)).toBe(false);
  });
});

describe("guestSerialSocket", () => {
  it("prefers the path the cluster published", () => {
    const published = "/var/run/kubeswift/demo/serial.sock";

    expect(guestSerialSocket(guest({ ...running, console: { serialSocket: published } }))).toBe(published);
  });

  it("falls back to the convention when the status publishes none", () => {
    expect(guestSerialSocket(guest(running))).toBe(conventionPath);
  });

  it("falls back to the convention when the published value is not usable", () => {
    // The path is a pod annotation and it is about to be interpolated into a
    // command line: a value that cannot be trusted is replaced, not escaped
    // into the line anyway (K13).
    const facts = guest({ ...running, console: { serialSocket: "/var/lib/$(id)/serial.sock" } });

    expect(guestSerialSocket(facts)).toBe(conventionPath);
  });
});

describe("shellQuote", () => {
  it("quotes a plain value", () => {
    expect(shellQuote("kubeswift-e2e")).toBe("'kubeswift-e2e'");
  });

  it("closes, escapes and reopens an embedded single quote", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

/**
 * The words a POSIX shell would hand to `execve` for this line.
 *
 * The command line is a string the host TYPES INTO A SHELL, so the only
 * assertion that means anything about the quoting is what that shell would make
 * of it: a value is inert when it comes back as exactly one word, unchanged, no
 * matter what it contains. This models the two constructs the composed line
 * uses - single quotes, and the backslash-escaped quote the closing-and-
 * reopening idiom produces - and nothing else, because nothing else may appear.
 */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let started = false;
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (quoted) {
      if (character === "'") {
        quoted = false;
      } else {
        current += character;
      }
    } else if (character === "'") {
      quoted = true;
      started = true;
    } else if (character === "\\") {
      index += 1;

      if (index < line.length) {
        current += line[index];
        started = true;
      }
    } else if (character === " ") {
      if (started) {
        words.push(current);
        current = "";
        started = false;
      }
    } else {
      current += character;
      started = true;
    }
  }

  if (started) {
    words.push(current);
  }

  return words;
}

/** The remote script, as the words above deliver it to `sh -c`. */
function relayScript(line: string): string {
  const words = shellWords(line);

  return words[words.length - 1];
}

describe("guestConsoleCommand", () => {
  const command = (facts: GuestConsoleFacts, platform = "darwin", kubectlPath?: string) =>
    guestConsoleCommand({ guest: facts, platform, kubectlPath });

  it("composes the whole line for a macOS or Linux host", () => {
    expect(command(guest(running))).toBe(
      "exec kubectl exec -i -t -n 'vms' 'demo-launcher' -c 'launcher' -- sh -c " +
        `'for i in $(seq 1 15); do test -S '\\''${conventionPath}'\\'' && break; sleep 1; done; ` +
        `exec socat -,raw,echo=0 UNIX-CONNECT:'\\''${conventionPath}'\\'''`,
    );
  });

  it("delivers exactly the words upstream's own recipe uses", () => {
    expect(shellWords(command(guest(running)))).toEqual([
      "exec",
      "kubectl",
      "exec",
      "-i",
      "-t",
      "-n",
      "vms",
      "demo-launcher",
      "-c",
      "launcher",
      "--",
      "sh",
      "-c",
      `for i in $(seq 1 15); do test -S '${conventionPath}' && break; sleep 1; done; ` +
        `exec socat -,raw,echo=0 UNIX-CONNECT:'${conventionPath}'`,
    ]);
  });

  it("does not prefix exec on Windows", () => {
    // The host's own detail: `exec` replaces the tab's shell process so the tab
    // dies with the session, and Windows has no such shell built-in.
    const line = command(guest(running), "win32");

    expect(shellWords(line)[0]).toBe("kubectl");
    expect(line.startsWith("kubectl exec -i -t -n 'vms' 'demo-launcher'")).toBe(true);
  });

  it("uses the configured kubectl path when there is one", () => {
    expect(shellWords(command(guest(running), "linux", "/opt/bin/kubectl"))[1]).toBe("/opt/bin/kubectl");
  });

  it("uses the pod's own namespace when the reference names one", () => {
    const facts = guest({ phase: "Running", podRef: { name: "demo-launcher", namespace: "elsewhere" } });

    expect(shellWords(command(facts)).slice(6, 8)).toEqual(["elsewhere", "demo-launcher"]);
  });

  it("keeps the interactive TTY and the launcher container", () => {
    // Both are load-bearing: the serial console is bidirectional, and the
    // launcher container is the one the hypervisor runs in.
    expect(command(guest(running))).toContain("exec -i -t -n");
    expect(shellWords(command(guest(running))).slice(8, 11)).toEqual(["-c", "launcher", "--"]);
  });

  it("keeps upstream's fifteen-second socket wait", () => {
    expect(relayScript(command(guest(running)))).toContain("for i in $(seq 1 15); do test -S ");
  });

  it("relays the socket the status published, when it published a usable one", () => {
    const published = "/var/run/kubeswift/demo/serial.sock";
    const script = relayScript(command(guest({ ...running, console: { serialSocket: published } })));

    expect(script).toContain(`UNIX-CONNECT:'${published}'`);
  });

  it("quotes an adversarial namespace inert", () => {
    // The pod reference carries no namespace of its own here, which is also the
    // fallback branch: the guest's namespace is what the command names.
    const facts: GuestConsoleFacts = {
      name: "demo",
      namespace: "vms'; rm -rf /; '",
      status: { phase: "Running", podRef: { name: "demo-launcher" } },
    };
    const words = shellWords(command(facts));

    expect(words[6]).toBe("vms'; rm -rf /; '");
    expect(words).toHaveLength(14);
  });

  it("quotes an adversarial pod name inert", () => {
    const facts = guest({ phase: "Running", podRef: { name: "demo$(id)", namespace: "vms" } });
    const words = shellWords(command(facts));

    expect(words[7]).toBe("demo$(id)");
    expect(words).toHaveLength(14);
  });

  it("quotes an adversarial socket path inert on both levels", () => {
    // A published path carrying a metacharacter never reaches the line at all -
    // it is replaced by the convention (K13) - so the adversarial value that
    // CAN reach it is the guest name the convention is derived from, and it has
    // to survive TWO shells: the local one that types the line, and the remote
    // `sh -c` the line runs.
    const facts: GuestConsoleFacts = { ...guest(running), name: "demo'; id; '" };
    const injected = "/var/lib/kubeswift/run/vms-demo'; id; '/serial.sock";
    const script = relayScript(command(facts));

    expect(shellWords(command(facts))).toHaveLength(14);
    expect(shellWords(script)).toContain(`UNIX-CONNECT:${injected}`);
    expect(shellWords(script)).not.toContain("id;");
  });

  it("interpolates nothing outside single quotes", () => {
    // Every value that came from the cluster sits inside quotes; what is left
    // outside them is the fixed vocabulary of the command and nothing else.
    const line = command(guest({ ...running, console: { serialSocket: "/var/run/kubeswift/demo/serial.sock" } }));
    const unquoted = line.replace(/'(?:[^']|'\\'')*'/g, "");

    expect(unquoted).toBe("exec kubectl exec -i -t -n   -c  -- sh -c ");
  });
});

describe("guestConsoleTabTitle", () => {
  it("names the guest and not its pod", () => {
    // A guest's pod name is a migration artefact, and the drawer already shows
    // it. (The sandbox title of slice 2 does name its pod, because for a
    // checkout the two differ.)
    expect(guestConsoleTabTitle(guest(running))).toBe("Console: demo");
  });
});

describe("guestConsoleTooltipSentences", () => {
  const sentences = (facts: GuestConsoleFacts) => guestConsoleTooltipSentences(facts, canOpenGuestConsole(facts));

  it("says what opens, naming the pod, the container and the socket", () => {
    expect(sentences(guest(running))[0]).toBe(
      `Opens a terminal tab that runs kubectl exec into the launcher container of vms/demo-launcher and relays ` +
        `the guest's serial socket ${conventionPath}.`,
    );
  });

  it("tells a Windows guest that silence is expected", () => {
    const windows = sentences(guest(running, { osType: "windows" }));

    expect(windows.some((sentence) => sentence.includes("skips the serial-console patch"))).toBe(true);
    expect(windows.some((sentence) => sentence.includes("managed over RDP"))).toBe(true);
  });

  it("does not offer the Linux blank-console causes to a Windows guest", () => {
    expect(sentences(guest(running, { osType: "windows" })).join(" ")).not.toContain("getty@ttyS0");
  });

  it("names the getty wait and both blank-console causes for a Linux guest", () => {
    const linux = sentences(guest(running, { osType: "linux" })).join(" ");

    expect(linux).toContain("shows nothing until you press Enter");
    expect(linux).toContain("console=ttyS0");
    expect(linux).toContain("getty@ttyS0");
  });

  it("treats a guest with no osType as Linux, which is the CRD's own default", () => {
    expect(sentences(guest(running)).join(" ")).toContain("getty@ttyS0");
  });

  it("says only the guard's reason when the item is disabled", () => {
    const facts = guest({ phase: "Stopped" });

    expect(sentences(facts)).toEqual([canOpenGuestConsole(facts).reason]);
  });

  it("joins its sentences into the tooltip the item carries", () => {
    const facts = guest(running);

    expect(guestConsoleTooltip(facts, canOpenGuestConsole(facts))).toBe(sentences(facts).join(" "));
  });
});

describe("guestConsoleDrawerExplanation", () => {
  const explain = (facts: GuestConsoleFacts) => guestConsoleDrawerExplanation(facts, canOpenGuestConsole(facts));

  it("says what the console will do when it is available", () => {
    expect(explain(guest(running))).toBe(
      "Available: Serial Console opens a terminal tab that runs kubectl exec into the launcher container of " +
        `vms/demo-launcher and relays ${conventionPath}.`,
    );
  });

  it("carries the guard's own reason when it is not", () => {
    // The second surface W4 requires, and the durable one: it is on screen
    // without opening a menu.
    const facts = guest({ phase: "Stopped" });

    expect(explain(facts)).toBe(`Unavailable: ${canOpenGuestConsole(facts).reason}`);
  });
});

// ---------------------------------------------------------------------------
// The sandbox half (SPEC-0017 slice 2).
// ---------------------------------------------------------------------------

type SandboxSpec = NonNullable<SandboxConsoleFacts["spec"]>;
type SandboxStatus = NonNullable<SandboxConsoleFacts["status"]>;

/** A COLD sandbox: its launcher pod is named after itself, so the two key rules coincide. */
const sandbox = (status?: SandboxStatus, spec?: SandboxSpec): SandboxConsoleFacts => ({
  name: "build-42",
  namespace: "vms",
  spec,
  status,
});

/** The console file of that cold sandbox, keyed on a pod that happens to share its name. */
const coldConsolePath = "/var/lib/kubeswift/run/vms-build-42/serial.sock.log";

/** A CHECKOUT: the claimed slot's pod belongs to the pool, and the key follows the pod. */
const checkout: SandboxConsoleFacts = {
  name: "build-42",
  namespace: "vms",
  spec: { poolRef: { name: "warm" } },
  status: { phase: "Completed", podRef: "warm-slot-xk29f" },
};

const checkoutConsolePath = "/var/lib/kubeswift/run/vms-warm-slot-xk29f/serial.sock.log";

describe("canOpenSandboxConsole", () => {
  it("is enabled as soon as the status names a launcher pod", () => {
    expect(canOpenSandboxConsole(sandbox({ phase: "Running", podRef: "build-42" })).enabled).toBe(true);
  });

  it("is disabled when the status names no launcher pod, and says why that is the FIRST state", () => {
    // A sandbox's first observable phase is empty rather than Pending
    // (SPEC-0016 correction 3), so "no pod yet" is the normal beginning of every
    // sandbox and not an error state.
    const verdict = canOpenSandboxConsole(sandbox());

    expect(verdict.enabled).toBe(false);
    expect(verdict.reason).toContain("names no launcher pod yet");
    expect(verdict.reason).toContain("first observable phase is empty rather than Pending");
  });

  it("is disabled for an empty podRef, which is what a patched-then-cleared status leaves", () => {
    expect(canOpenSandboxConsole(sandbox({ phase: "Running", podRef: "" })).enabled).toBe(false);
  });

  // The deliberate NON-gate, and the inversion of upstream's mistake: upstream
  // hides its Shell on a terminal sandbox and leaves its Logs button ungated
  // even with no pod. A terminal sandbox whose pod survives has the most
  // complete console in the milestone - the whole output plus the exit marker.
  it.each([
    "Completed",
    "Failed",
    "Running",
    "Materializing",
    "",
    undefined,
  ])("is not gated on the phase %s", (phase) => {
    expect(canOpenSandboxConsole(sandbox({ phase: phase as string | undefined, podRef: "build-42" })).enabled).toBe(
      true,
    );
  });

  it("enables a checkout, whose pod is the pool's", () => {
    expect(canOpenSandboxConsole(checkout).enabled).toBe(true);
  });

  it("never disables without a reason", () => {
    const inputs: SandboxConsoleFacts[] = [
      sandbox(),
      sandbox({}),
      sandbox({ phase: "Running" }),
      sandbox({ phase: "Running", podRef: "build-42" }),
      sandbox({ phase: "Completed", podRef: "build-42" }),
      sandbox({ phase: "Failed" }),
      sandbox({ phase: "", podRef: "" }),
      sandbox({ podRef: "build-42" }, { poolRef: { name: "warm" } }),
      sandbox(undefined, { poolRef: { name: "warm" } }),
      checkout,
    ];

    for (const input of inputs) {
      const verdict = canOpenSandboxConsole(input);

      if (!verdict.enabled) {
        expect(verdict.reason.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("sandboxLauncherPodName", () => {
  it("reads the bare string the status carries and never derives it", () => {
    expect(sandboxLauncherPodName(checkout)).toBe("warm-slot-xk29f");
    expect(sandboxLauncherPodName(sandbox({ phase: "Running" }))).toBeUndefined();
  });
});

describe("sandboxConsoleFile", () => {
  // The inversion, asserted side by side against the guest rule on the SAME
  // objects: this is the single easiest thing in the milestone to get
  // backwards, and the cold case is the one that would hide the mistake.
  it("keys a cold sandbox on its pod, which happens to be its own name", () => {
    expect(sandboxConsoleFile("vms", "build-42")).toBe(coldConsolePath);
    // The trap: for this sandbox the guest rule would produce the same
    // directory, so a backwards implementation is invisible here.
    expect(sandboxRunDirectoryKey("vms", "build-42")).toBe(guestRunDirectoryKey("vms", "build-42"));
  });

  it("keys a checkout on the SLOT's pod, where the guest rule would be wrong", () => {
    const podName = sandboxLauncherPodName(checkout) ?? "";

    expect(sandboxConsoleFile(checkout.namespace, podName)).toBe(checkoutConsolePath);
    // The assertion that catches the milestone's likeliest bug: a path derived
    // from the sandbox's own name points at a run directory that does not exist.
    expect(sandboxConsoleFile(checkout.namespace, podName)).not.toContain("build-42");
    expect(conventionalSandboxConsoleFile(guestRunDirectoryKey(checkout.namespace, checkout.name))).not.toBe(
      sandboxConsoleFile(checkout.namespace, podName),
    );
  });

  it("is the guest's socket path with .log appended, which is upstream's own naming", () => {
    expect(sandboxConsoleFile("vms", "demo")).toBe(
      `${conventionalSerialSocket(guestRunDirectoryKey("vms", "demo"))}.log`,
    );
  });
});

describe("isSandboxCheckout", () => {
  it("is true only when a pool was asked for AND the pod belongs to a slot", () => {
    expect(isSandboxCheckout(checkout)).toBe(true);
  });

  it("is false when the pod is not named after the sandbox but no pool was asked for", () => {
    // Nothing promises that a cold sandbox's launcher pod is named exactly after
    // it - this repository's own fixtures decorate it - so a name mismatch alone
    // must not produce the not-live warning, which would be a lie.
    expect(isSandboxCheckout({ name: "build-42", namespace: "vms", status: { podRef: "build-42-launcher" } })).toBe(
      false,
    );
  });

  it("is false when a pool was asked for but no pod exists yet", () => {
    expect(isSandboxCheckout(sandbox(undefined, { poolRef: { name: "warm" } }))).toBe(false);
  });

  it("is false for a cold sandbox with its own pod and no pool", () => {
    expect(isSandboxCheckout(sandbox({ phase: "Running", podRef: "build-42" }))).toBe(false);
  });

  it("is false for a sandbox nothing has scheduled and that named no pool", () => {
    expect(isSandboxCheckout(sandbox())).toBe(false);
  });
});

describe("isSandboxColdFallback", () => {
  it("is true for a pooled sandbox whose launcher pod is its own", () => {
    // The checkout that found no free warm slot: it boots cold, and its console
    // is followed live like any other cold sandbox's.
    expect(
      isSandboxColdFallback(sandbox({ phase: "Running", podRef: "build-42" }, { poolRef: { name: "warm" } })),
    ).toBe(true);
  });

  it("is false for a real checkout and for a sandbox that named no pool", () => {
    expect(isSandboxColdFallback(checkout)).toBe(false);
    expect(isSandboxColdFallback(sandbox({ phase: "Running", podRef: "build-42" }))).toBe(false);
  });
});

describe("sandboxConsoleCommand", () => {
  const command = (facts: SandboxConsoleFacts, platform = "darwin", kubectlPath?: string) =>
    sandboxConsoleCommand({ sandbox: facts, platform, kubectlPath });

  it("composes the whole line for a macOS or Linux host", () => {
    expect(command(sandbox({ phase: "Running", podRef: "build-42" }))).toBe(
      "exec kubectl exec -n 'vms' 'build-42' -c 'launcher' -- sh -c " + `'tail -n +1 -F '\\''${coldConsolePath}'\\'''`,
    );
  });

  it("delivers exactly the words upstream's own `sandbox logs -f` uses", () => {
    expect(shellWords(command(sandbox({ phase: "Running", podRef: "build-42" })))).toEqual([
      "exec",
      "kubectl",
      "exec",
      "-n",
      "vms",
      "build-42",
      "-c",
      "launcher",
      "--",
      "sh",
      "-c",
      `tail -n +1 -F '${coldConsolePath}'`,
    ]);
  });

  it("carries NO -i and NO -t: this is a read and the command line says so", () => {
    // Not an omission. A sandbox's hypervisor writes serial to a file, so there
    // is no stdin to give and a TTY would promise an interactivity the
    // mechanism cannot have (B1, B2). The guest's line has both, and the two
    // are asserted against each other so neither can drift into the other.
    const words = shellWords(command(sandbox({ phase: "Running", podRef: "build-42" })));

    expect(words).not.toContain("-i");
    expect(words).not.toContain("-t");
    expect(shellWords(guestConsoleCommand({ guest: guest(running), platform: "darwin" }))).toContain("-t");
  });

  it("follows from the first line and keeps waiting for a file that is not there yet", () => {
    // `-n +1` is what makes the whole console to date arrive at once; `-F`
    // rather than `-f` is what survives a file that does not exist yet, which
    // is the normal state of a sandbox that has not booted.
    expect(relayScript(command(sandbox({ phase: "Running", podRef: "build-42" })))).toContain("tail -n +1 -F ");
  });

  it("names the SLOT's pod and the SLOT's path for a checkout", () => {
    const words = shellWords(command(checkout));

    expect(words[5]).toBe("warm-slot-xk29f");
    expect(relayScript(command(checkout))).toContain(`'${checkoutConsolePath}'`);
    expect(command(checkout)).not.toContain("run/vms-build-42");
  });

  it("does not prefix exec on Windows", () => {
    const line = command(sandbox({ phase: "Running", podRef: "build-42" }), "win32");

    expect(shellWords(line)[0]).toBe("kubectl");
    expect(line.startsWith("kubectl exec -n 'vms' 'build-42'")).toBe(true);
    expect(shellWords(line)).not.toContain("-t");
  });

  it("uses the configured kubectl path when there is one", () => {
    expect(shellWords(command(sandbox({ podRef: "build-42" }), "linux", "/opt/bin/kubectl"))[1]).toBe(
      "/opt/bin/kubectl",
    );
  });

  it("keeps the launcher container, which is where the hypervisor runs", () => {
    expect(shellWords(command(sandbox({ podRef: "build-42" }))).slice(6, 9)).toEqual(["-c", "launcher", "--"]);
  });

  it("quotes an adversarial namespace inert", () => {
    const facts: SandboxConsoleFacts = {
      name: "build-42",
      namespace: "vms'; rm -rf /; '",
      status: { podRef: "build-42" },
    };
    const words = shellWords(command(facts));

    expect(words[4]).toBe("vms'; rm -rf /; '");
    expect(words).toHaveLength(12);
  });

  it("quotes an adversarial pod name inert, on both levels", () => {
    // The pod name reaches TWO shells: the local one that types the line, and
    // the remote `sh -c` the line runs, because the console path is built from
    // it. Both have to see one word.
    const facts: SandboxConsoleFacts = { name: "build-42", namespace: "vms", status: { podRef: "slot$(id)" } };
    const words = shellWords(command(facts));

    expect(words[5]).toBe("slot$(id)");
    expect(words).toHaveLength(12);
    expect(shellWords(relayScript(command(facts)))).toContain("/var/lib/kubeswift/run/vms-slot$(id)/serial.sock.log");
    expect(shellWords(relayScript(command(facts)))).not.toContain("id");
  });

  it("quotes an adversarial sandbox name inert - which reaches nothing, and that is the point", () => {
    // The sandbox's own name is NOT part of the command line: the path is keyed
    // on the pod. If it ever appears here, the B3 inversion has been broken.
    const facts: SandboxConsoleFacts = { name: "build'; id; '", namespace: "vms", status: { podRef: "slot-1" } };

    expect(command(facts)).not.toContain("id;");
    expect(shellWords(command(facts))).toHaveLength(12);
  });

  it("interpolates nothing outside single quotes", () => {
    const line = command(checkout);
    const unquoted = line.replace(/'(?:[^']|'\\'')*'/g, "");

    expect(unquoted).toBe("exec kubectl exec -n   -c  -- sh -c ");
  });
});

describe("sandboxConsoleTabTitle", () => {
  it("names the sandbox AND its pod, unlike the guest's title", () => {
    expect(sandboxConsoleTabTitle(sandbox({ podRef: "build-42" }))).toBe("Console: build-42 (build-42)");
  });

  it("makes a checkout's slot pod visible, which is the only place a user ever sees one", () => {
    expect(sandboxConsoleTabTitle(checkout)).toBe("Console: build-42 (warm-slot-xk29f)");
    expect(guestConsoleTabTitle(guest(running))).not.toContain("(");
  });
});

describe("sandboxConsoleTooltipSentences", () => {
  const sentences = (facts: SandboxConsoleFacts) => sandboxConsoleTooltipSentences(facts, canOpenSandboxConsole(facts));

  it("says what opens, naming the pod, the container and the console file", () => {
    expect(sentences(sandbox({ podRef: "build-42" }))[0]).toBe(
      "Opens a terminal tab that runs kubectl exec into the launcher container of vms/build-42 and follows the " +
        `sandbox's console file ${coldConsolePath}.`,
    );
  });

  it("explains the read-only-ness by its MECHANISM, which no upstream surface does", () => {
    const said = sentences(sandbox({ podRef: "build-42" })).join(" ");

    expect(said).toContain("writes the guest's serial line to a file rather than to a socket");
    expect(said).toContain("nothing to type into");
  });

  it("promises a live tail from the first line to a cold sandbox", () => {
    const said = sentences(sandbox({ phase: "Running", podRef: "build-42" })).join(" ");

    expect(said).toContain("booted cold");
    expect(said).toContain("the whole console to date arrives at once");
    expect(said).not.toContain("NOT live");
  });

  it("warns a checkout that its tail is NOT live, and names the slot pod", () => {
    // The milestone's single most valuable sentence: three upstream surfaces
    // present a checkout's buffered dump as a live tail (K8, digest B5).
    const said = sentences(checkout).join(" ");

    expect(said).toContain("warm-slot-xk29f");
    expect(said).toContain("over vsock");
    expect(said).toContain("NOT live");
    expect(said).toContain("stays empty until then");
  });

  it("tells a pooled sandbox whose pod is its own that it fell back to a cold boot, and IS live", () => {
    // The case a blunter rule would warn about wrongly: a checkout that found no
    // free warm slot boots cold and gets a pod of its own, and that console is
    // written by the hypervisor as the workload runs.
    const said = sentences(sandbox({ phase: "Running", podRef: "build-42" }, { poolRef: { name: "warm" } })).join(" ");

    expect(said).toContain("fell back to the cold boot path");
    expect(said).toContain("the tail is live");
    expect(said).not.toContain("NOT live");
  });

  it("does not warn a cold sandbox whose launcher pod carries a suffix", () => {
    // The shape this repository's own fixtures have, and the false positive an
    // either-signal rule would produce: no pool was asked for, so the tail is
    // live whatever the pod is called.
    const said = sentences({
      name: "build-42",
      namespace: "vms",
      status: { phase: "Running", podRef: "build-42-launcher" },
    }).join(" ");

    expect(said).toContain("booted cold");
    expect(said).not.toContain("NOT live");
  });

  it("names the exit-code marker as machinery, wherever the tail is offered", () => {
    expect(sentences(sandbox({ podRef: "build-42" })).join(" ")).toContain(
      "The last line of a finished sandbox is KUBESWIFT-EXIT-CODE=<n>",
    );
    expect(sentences(checkout).join(" ")).toContain("machinery, not workload output");
  });

  it("says only the guard's reason when the item is disabled", () => {
    const facts = sandbox();

    expect(sentences(facts)).toEqual([canOpenSandboxConsole(facts).reason]);
  });

  it("joins its sentences into the tooltip the item carries", () => {
    expect(sandboxConsoleTooltip(checkout, canOpenSandboxConsole(checkout))).toBe(sentences(checkout).join(" "));
  });
});

describe("sandboxConsoleDrawerExplanation", () => {
  const explain = (facts: SandboxConsoleFacts) => sandboxConsoleDrawerExplanation(facts, canOpenSandboxConsole(facts));

  it("says what the console will do when it is available", () => {
    expect(explain(sandbox({ podRef: "build-42" }))).toBe(
      "Available: Workload Console opens a terminal tab that runs kubectl exec into the launcher container of " +
        `vms/build-42 and follows ${coldConsolePath}.`,
    );
  });

  it("names the slot's pod and the slot's path for a checkout", () => {
    expect(explain(checkout)).toContain("vms/warm-slot-xk29f");
    expect(explain(checkout)).toContain(checkoutConsolePath);
  });

  it("carries the guard's own reason when it is not", () => {
    const facts = sandbox();

    expect(explain(facts)).toBe(`Unavailable: ${canOpenSandboxConsole(facts).reason}`);
  });
});

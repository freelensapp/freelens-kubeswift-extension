import { describe, expect, it } from "vitest";
import {
  canOpenGuestConsole,
  conventionalSerialSocket,
  guestConsoleCommand,
  guestConsoleDrawerExplanation,
  guestConsoleTabTitle,
  guestConsoleTooltip,
  guestConsoleTooltipSentences,
  guestRunDirectoryKey,
  guestSerialSocket,
  isUsableSocketPath,
  sandboxRunDirectoryKey,
  shellQuote,
} from "./console-commands";

import type { GuestConsoleFacts } from "./console-commands";

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

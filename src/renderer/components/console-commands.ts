/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Everything the console affordances decide, as pure functions over
// structurally declared inputs (SPEC-0017, "Where the code lives"): the guards,
// the run-directory key rules, the serial-socket source and its validation, the
// composed command lines, the tab titles and every sentence the tooltips and the
// drawer carry. The menu component in `src/renderer/menus/` is then thin - read
// the object, call the guard, compose a string, hand it to the host's terminal -
// which is what makes the interesting half of this milestone unit-testable
// without a host global, without a cluster and without a terminal.
//
// Declared structurally (no `Renderer` import) so it stays testable with plain
// objects, the same shape as `object-existence.ts` and `pod-logs.ts`.
//
// What a console open mechanically IS is the reason this module exists, and it
// is not in the schema. swiftletd starts the hypervisor with the guest's serial
// line redirected to a Unix socket inside the launcher pod's runtime directory,
// on both hypervisors; reaching it is a `pods/exec` into the `launcher`
// container running a socket relay in raw, echo-off mode. This extension issues
// no API call for it at all: it composes the command line the host's own
// terminal tab types into a shell that already has the cluster's kubeconfig and
// the bundled kubectl on its PATH, so the session runs under the user's own
// credentials and not one byte of it passes through here (SPEC-0017, W1/W7/W9).
//
// The one thing this module refuses to be relaxed about is quoting. The socket
// path can arrive from `status.console.serialSocket`, which is a pod annotation
// swiftletd writes, and it is about to be interpolated into a command line that
// will be typed into a shell. So every interpolated value is single-quoted, and
// the socket string additionally has to survive a strict character allowlist
// before it is used at all (K13).

import { launcherPodTarget } from "./guest-actions";
import {
  guestFailedPhase,
  guestPendingPhase,
  guestRunningPhase,
  guestSchedulingPhase,
  guestStoppedPhase,
} from "./guest-status";

import type { ActionGuard, GuestActionFacts, GuestActionSpecFacts, GuestActionStatusFacts } from "./guest-actions";

/**
 * The container every KubeSwift launcher pod runs the hypervisor in.
 *
 * A constant upstream, not a field: the controller emits it under this name on
 * every pod-building path, and both upstream clients hardcode it.
 */
export const launcherContainerName = "launcher";

/** The image's default runtime root, under which every guest and sandbox gets a directory. */
export const runDirectoryRoot = "/var/lib/kubeswift/run";

/** The file the hypervisor's serial line is bound to inside that directory. */
export const serialSocketFileName = "serial.sock";

/**
 * How long the relay waits for the socket to appear before giving up.
 *
 * Upstream's number, kept because it turns the one common race - attaching while
 * the hypervisor is still creating the socket - into a wait instead of an error.
 * SPEC-0017's open item O2 asks whether a real attach ever needs it; until that
 * is measured, saying less would mean guessing.
 */
export const socketWaitSeconds = 15;

/**
 * A phase the SwiftGuest enum does not declare today.
 *
 * `v0.13.12` allows `Pending`, `Scheduling`, `Running`, `Stopped` and `Failed`
 * and nothing else, so on that version this branch cannot fire and a guest whose
 * live migration is in flight simply stays `Running`. It is written anyway
 * because SPEC-0017's guard table names it: if a controller ever reports the
 * interval, the console says what survives it (the socket path, which is keyed
 * on the guest) instead of falling through to the unknown-phase permit and
 * saying nothing at all.
 */
export const guestMigratingPhase = "Migrating";

/** The `osType` whose image import skips the serial-console patch. */
export const windowsOsType = "windows";

/** What a SwiftGuest must look like for the console functions to read it. */
export interface GuestConsoleFacts extends GuestActionFacts {
  spec?: GuestActionSpecFacts & { osType?: string };
  status?: GuestActionStatusFacts & { console?: { serialSocket?: string } };
}

const enabled: ActionGuard = { enabled: true };

function disabled(reason: string): ActionGuard {
  return { enabled: false, reason };
}

/**
 * The run-directory key of a GUEST: namespace and guest name, joined with a
 * hyphen.
 *
 * Keyed on the guest and never on the pod, which is the whole point: a live
 * migration renames the launcher pod (`<guest>-mig-<uid>`) and the directory,
 * and therefore the socket path, does not move. A console reconnect after a
 * migration needs a new pod name and the same path.
 *
 * **This is the inverse of the sandbox rule below, and it is the single easiest
 * thing in this milestone to get backwards**, which is why both live here, next
 * to each other, with a unit test pinning each - including the case where they
 * coincide, which is exactly the case that would hide the mistake.
 */
export function guestRunDirectoryKey(namespace: string, guestName: string): string {
  return `${namespace}-${guestName}`;
}

/**
 * The run-directory key of a SANDBOX: namespace and LAUNCHER POD name.
 *
 * Keyed on the pod because a warm-slot checkout claims a pre-booted slot, so its
 * runtime directory lives in the slot's pod (`<pool>-slot-xxxxx`) and not in a
 * pod named after the sandbox. A cold sandbox's pod is named after the sandbox
 * itself, so for it the two rules produce the same string - which is why the
 * inversion has to be pinned by a test rather than trusted to a reading.
 *
 * Consumed by SPEC-0017 slice 2, which adds the Workload Console; it lives here
 * with its inverse so that the two rules can never be read apart.
 */
export function sandboxRunDirectoryKey(namespace: string, podName: string): string {
  return `${namespace}-${podName}`;
}

/** The serial socket the convention puts in a run directory with the given key. */
export function conventionalSerialSocket(key: string): string {
  return `${runDirectoryRoot}/${key}/${serialSocketFileName}`;
}

/**
 * The characters a path may contain before this module will interpolate it.
 *
 * An allowlist rather than a list of shell metacharacters, because the set of
 * things a shell (or `socat`'s own address grammar) treats specially is not
 * closed and a denylist is only ever as good as its last review. Everything a
 * real KubeSwift path contains is here - the run root, a DNS-1123 namespace and
 * name joined by a hyphen, and the file name - and nothing else is: no
 * whitespace, no quote, no `;`, no `$`, no backtick, no newline, and
 * deliberately no comma or colon either, which are what would let a value
 * smuggle an extra option into `UNIX-CONNECT:<path>` without touching the shell
 * at all.
 */
const pathCharacters = /^[A-Za-z0-9._/-]+$/;

/**
 * Whether a published path may be interpolated into the command line (K13).
 *
 * Absolute, and made only of the characters above. Anything else is not
 * rejected loudly: it falls back to the derived convention, because a guest
 * whose annotation is malformed still deserves a console, and because the
 * convention is what upstream's own clients use unconditionally.
 */
export function isUsableSocketPath(value: string | undefined): value is string {
  return typeof value === "string" && value.startsWith("/") && pathCharacters.test(value);
}

/**
 * Where a guest's serial socket is: the path the cluster published, when it
 * published a usable one, and the derived convention otherwise (K2).
 *
 * Read from `status.console.serialSocket` rather than reconstructed because
 * upstream's own code warns that the convention can be wrong after a restore
 * whose snapshot points at another run directory - and because the extension
 * already models the field and the drawer already shows it. It answers
 * **where**, never **whether**: the controller sets it and never clears it, so a
 * stopped guest can still carry it, and no guard reads it.
 */
export function guestSerialSocket(guest: GuestConsoleFacts): string {
  const published = guest.status?.console?.serialSocket;

  if (isUsableSocketPath(published)) {
    return published;
  }

  return conventionalSerialSocket(guestRunDirectoryKey(guest.namespace, guest.name));
}

/**
 * One value, quoted so that a shell hands it to `kubectl` (or to the remote
 * `sh`) exactly as it arrived.
 *
 * Single quotes, with the only character they cannot contain closed, escaped
 * and reopened in the POSIX way. Kubernetes names are DNS-1123 labels or
 * subdomains and carry no metacharacter, so this is belt and braces for the
 * namespace, the pod and the container - but the socket path is a pod
 * annotation, and belt and braces is the point (K13).
 */
export function shellQuote(value: string): string {
  return `'${value.split("'").join("'\\''")}'`;
}

/**
 * Whether a serial console can be opened on this guest, and why not when it
 * cannot (W4).
 *
 * Reads the custom resource only, never the pod store: from a list row the
 * extension has no pods loaded for that namespace, so a pod-backed guard would
 * mean a list request per render (SPEC-0010, spike S6). `launcherPodTarget` is
 * already written and tested for exactly this and is reused.
 *
 * The two phases that explain the missing pod themselves are tested BEFORE the
 * pod reference, so that a stopped guest is told the mechanism ("a stop deletes
 * the launcher pod") rather than the symptom ("the status names no pod"). A
 * phase this extension does not know, and an absent phase, both permit the
 * action as long as a pod is named: the guard is a convenience, and the API
 * server is the authority.
 */
export function canOpenGuestConsole(guest: GuestConsoleFacts): ActionGuard {
  const phase = guest.status?.phase;

  if (phase === guestStoppedPhase) {
    return disabled(
      "The guest is stopped, and stopping deletes its launcher pod: the serial socket lives inside that pod, so " +
        "there is nothing to connect to until the guest is started again.",
    );
  }

  if (phase === guestMigratingPhase) {
    return disabled(
      "The guest is migrating and its launcher pod is being replaced. The socket path is keyed on the guest and " +
        "does not change, so the same console is there again once the phase settles.",
    );
  }

  if (!launcherPodTarget(guest)) {
    return disabled("The status names no launcher pod yet, so there is nothing to open a console into.");
  }

  if (phase === guestRunningPhase) {
    return enabled;
  }

  if (phase === guestPendingPhase || phase === guestSchedulingPhase || phase === guestFailedPhase) {
    return disabled(
      `The guest is not running: its phase is ${phase}. The serial socket exists only while the hypervisor does.`,
    );
  }

  return enabled;
}

/** What `guestConsoleCommand` needs beyond the guest itself. */
export interface GuestConsoleCommandInput {
  guest: GuestConsoleFacts;
  /**
   * The user's configured kubectl path (`Common.App.Preferences.getKubectlPath()`),
   * which is empty on a default install. The bare name is then used, and the
   * host's own shell session has already put its bundled kubectl on the PATH.
   */
  kubectlPath?: string;
  /**
   * `os.platform()`. Taken as a parameter rather than read here so this module
   * stays pure and both branches are unit-testable on either machine.
   */
  platform: string;
}

/** The platform on which a command line is NOT prefixed with `exec`. */
const windowsPlatform = "win32";

/**
 * The line the terminal tab types, in full.
 *
 * The host's own Pod Shell recipe, restated rather than imported: it is not
 * exported through the extension API, and both codebases are MIT, so this is a
 * convenience question rather than a licensing one (the precedent is
 * `pod-logs.ts`, which restates core's default-container rule for the same
 * reason). On anything but Windows the whole line is prefixed with `exec`, so
 * the tab's shell process is replaced and the tab dies with the session - the
 * host's own detail, kept.
 *
 * The payload is upstream's, minus the client-side niceties a terminal we do not
 * own cannot have: the socket wait is kept because it turns a race into a wait,
 * and `swiftctl`'s Ctrl+O detach is not reproduced because binding a key in the
 * host's terminal is not ours to promise.
 */
export function guestConsoleCommand({ guest, kubectlPath, platform }: GuestConsoleCommandInput): string {
  const target = launcherPodTarget(guest);
  const podName = target?.name ?? "";
  const namespace = target?.namespace ?? guest.namespace;
  const socket = shellQuote(guestSerialSocket(guest));
  const relay =
    `for i in $(seq 1 ${socketWaitSeconds}); do test -S ${socket} && break; sleep 1; done; ` +
    `exec socat -,raw,echo=0 UNIX-CONNECT:${socket}`;

  const parts = [
    kubectlPath || "kubectl",
    "exec",
    "-i",
    "-t",
    "-n",
    shellQuote(namespace),
    shellQuote(podName),
    "-c",
    shellQuote(launcherContainerName),
    "--",
    "sh",
    "-c",
    shellQuote(relay),
  ];

  if (platform !== windowsPlatform) {
    parts.unshift("exec");
  }

  return parts.join(" ");
}

/**
 * The dock tab's title.
 *
 * The guest, and deliberately not its pod: a guest's pod name is a migration
 * artefact, and the drawer already shows it. (The sandbox title of slice 2 does
 * name its pod, because for a checkout the two differ and that difference is
 * otherwise invisible.)
 */
export function guestConsoleTabTitle(guest: GuestConsoleFacts): string {
  return `Console: ${guest.name}`;
}

/**
 * What the console item says, sentence by sentence, so each conditional can be
 * asserted on its own.
 *
 * A disabled item says only the guard's reason: that is the sentence the user
 * needs, and a disabled `MenuItem` carries `pointer-events: none`, so the host's
 * hover tooltip never shows for it and this text reaches the screen through the
 * item's own `title` attribute instead (SPEC-0010, spike S7).
 *
 * An enabled item says what is about to happen and then what to expect from it,
 * which is where the milestone's cheapest improvements live: a Windows guest's
 * console is expected to be silent, and a blank Linux console is a guest-side
 * kernel-cmdline problem rather than a broken connection (K4, K5). Both are
 * worded as expectations, not as facts, because SPEC-0017's open item O3 has not
 * been settled on real hardware.
 */
export function guestConsoleTooltipSentences(guest: GuestConsoleFacts, verdict: ActionGuard): string[] {
  if (!verdict.enabled) {
    return [verdict.reason];
  }

  const target = launcherPodTarget(guest);
  const sentences = [
    `Opens a terminal tab that runs kubectl exec into the ${launcherContainerName} container of ` +
      `${target?.namespace ?? guest.namespace}/${target?.name ?? "the launcher pod"} and relays the guest's serial ` +
      `socket ${guestSerialSocket(guest)}.`,
  ];

  if (guest.spec?.osType === windowsOsType) {
    sentences.push(
      "This guest is Windows: the image import skips the serial-console patch that a Linux image gets, so the " +
        "console is expected to stay silent. Windows is managed over RDP instead.",
    );

    return sentences;
  }

  sentences.push(
    "An already-booted guest shows nothing until you press Enter: that is its getty waiting, not a failure.",
  );
  sentences.push(
    "A console that stays blank afterwards is the guest and not the connection: either the kernel cmdline has no " +
      "console=ttyS0, or the seed profile never enabled getty@ttyS0.",
  );

  return sentences;
}

/** The tooltip as the item carries it: the sentences above, as one string. */
export function guestConsoleTooltip(guest: GuestConsoleFacts, verdict: ActionGuard): string {
  return guestConsoleTooltipSentences(guest, verdict).join(" ");
}

/**
 * What the drawer says about the console, for the user who never hovers
 * anything.
 *
 * W4 requires the reason to be reachable in both surfaces. The item's own
 * `title` attribute is one of them and reaches the kebab and the drawer toolbar
 * alike; this row is the other, and it is the durable one - it is on screen
 * without opening a menu, exactly as SPEC-0010's Condition row is for Start and
 * Stop. The full sentence is the row's own text rather than only its tooltip,
 * because DESIGN.md section 7 does not let anything important live in a tooltip
 * alone.
 */
export function guestConsoleDrawerExplanation(guest: GuestConsoleFacts, verdict: ActionGuard): string {
  if (!verdict.enabled) {
    return `Unavailable: ${verdict.reason}`;
  }

  const target = launcherPodTarget(guest);

  return (
    `Available: Serial Console opens a terminal tab that runs kubectl exec into the ${launcherContainerName} ` +
    `container of ${target?.namespace ?? guest.namespace}/${target?.name ?? "the launcher pod"} and relays ` +
    `${guestSerialSocket(guest)}.`
  );
}

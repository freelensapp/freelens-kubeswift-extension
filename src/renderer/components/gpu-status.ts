/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The status classifier of the GPU views, and the first one of this repository
// (DESIGN.md section 2, gap #1): a pure function from what a resource reports
// to a small closed set of display states and to one of the host's global
// status classes. No JSX and no colours live here - the components render what
// these functions return and nothing else - and neither does any date
// formatting: a state that refers to a timestamp carries the timestamp as it
// arrived, so the view can put it through `LocaleDate` (DESIGN.md section 3).
//
// The inputs are declared structurally rather than imported from the models, so
// the logic stays unit-testable with plain objects and without stubbing the
// host global (the same shape as `object-existence.ts`).
//
// SwiftGPUNode has no `conditions[]` and no message field anywhere in its
// schema, so there is no raw condition message to show next to the badge: the
// `explanation` below is generated instead, in this extension's own words, out
// of the very fields the badge was derived from (declared deviation, see
// SPEC-0007). If upstream ever adds conditions to the CRD, the Status column
// becomes the raw message and this half of the module goes away.

/** The host's global status classes, defined in core's `app.scss`. */
export type GpuStatusClass = "success" | "warning" | "error" | "info";

/** Phase values the CRD documents. The schema declares no enum, so they are not a type. */
export const gpuNodeReadyPhase = "Ready";
export const gpuNodeDiscoveringPhase = "Discovering";
export const gpuNodeErrorPhase = "Error";

/** The state names the classifier can produce on its own (a raw phase is passed through as it is). */
export const gpuNodeStates = {
  ready: "Ready",
  noVfio: "No VFIO",
  discovering: "Discovering",
  error: "Error",
  unknown: "Unknown",
} as const;

/** What a SwiftGPUNode's status must look like for the classifier to read it. */
export interface GpuNodeStatusFacts {
  phase?: string;
  vfioReady?: boolean;
  lastDiscovery?: string;
}

export interface GpuNodeCondition {
  /** Short scannable word for the `Condition` badge. */
  state: string;
  /** One of the host's global classes; the extension never authors a colour. */
  className: GpuStatusClass;
  /** One line saying how that state was reached, for the `Status` column. */
  explanation: string;
  /**
   * Set only when the explanation ends on a timestamp. The view appends it with
   * `LocaleDate` rather than this module formatting a date itself, so the
   * classifier stays pure and the user's timezone preference is honoured.
   */
  lastDiscovery?: string;
}

/**
 * Classifies a GPU node.
 *
 * `vfioReady` deliberately takes part in the verdict as well as being its own
 * column in the list: a node that reports `Ready` while its host never loaded
 * `vfio-pci` cannot hand a device to a guest (allocation and the migration GPU
 * pre-flight both refuse it), so it must not read as healthy at a glance.
 *
 * A phase this extension does not know is displayed as it arrived rather than
 * forced into one of the buckets: the schema declares `phase` as a plain string
 * with no enum, and the SPEC-0001/SPEC-0004 stance on unknown phases is that
 * they stay opaque.
 */
export function classifyGpuNode(status?: GpuNodeStatusFacts): GpuNodeCondition {
  const phase = status?.phase;

  if (!phase) {
    return {
      state: gpuNodeStates.unknown,
      className: "info",
      explanation: "Discovery has not reported a phase for this node yet",
    };
  }

  if (phase === gpuNodeReadyPhase) {
    if (status?.vfioReady !== true) {
      return {
        state: gpuNodeStates.noVfio,
        className: "warning",
        explanation: "The host has not loaded vfio-pci, so no GPU on this node can be handed to a guest",
      };
    }

    return {
      state: gpuNodeStates.ready,
      className: "success",
      explanation: status.lastDiscovery
        ? "vfio-pci is loaded and the inventory was last refreshed on"
        : "vfio-pci is loaded and discovery has reported the inventory",
      lastDiscovery: status.lastDiscovery,
    };
  }

  if (phase === gpuNodeDiscoveringPhase) {
    return {
      state: gpuNodeStates.discovering,
      className: "warning",
      explanation: "The discovery DaemonSet is still reporting this node's inventory",
    };
  }

  if (phase === gpuNodeErrorPhase) {
    return {
      state: gpuNodeStates.error,
      className: "error",
      explanation: "Discovery reported an error on this node",
    };
  }

  return {
    state: phase,
    className: "info",
    explanation: `Discovery reported the phase "${phase}", which this extension does not know`,
  };
}

/** What a single GPU device must look like for the classifier to read it. */
export interface GpuDeviceFacts {
  allocated?: boolean;
  allocatedTo?: string;
  driver?: string;
  index?: number;
  model?: string;
}

/** The driver a device must be bound to before it can be handed to a guest. */
export const passthroughDriver = "vfio-pci";

export const gpuDeviceStates = {
  free: "Free",
  allocated: "Allocated",
  notBound: "Not bound to vfio-pci",
} as const;

export interface GpuDeviceCondition {
  state: string;
  className: GpuStatusClass;
  /** One line describing the device, used as the tooltip of its brick. */
  explanation: string;
}

/**
 * Classifies one GPU of the inventory, for the per-device `StatusBrick`
 * gallery: healthy for a free device already bound to `vfio-pci`,
 * informational for one that is handed to a guest, warning for one whose
 * driver is not the passthrough one (it is there, but it cannot be given away
 * until the host rebinds it).
 *
 * The allocation wins over the driver: an allocated device is bound to
 * `vfio-pci` by construction, and a guest holding it is the fact worth
 * showing.
 */
export function classifyGpuDevice(device: GpuDeviceFacts): GpuDeviceCondition {
  const identity = [
    device.index === undefined ? undefined : `GPU ${device.index}`,
    device.model,
    device.driver ? `driver ${device.driver}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const describe = (tail: string) => (identity ? `${identity}: ${tail}` : tail);

  if (device.allocated) {
    return {
      state: gpuDeviceStates.allocated,
      className: "info",
      explanation: describe(device.allocatedTo ? `allocated to ${device.allocatedTo}` : "allocated"),
    };
  }

  if (device.driver !== passthroughDriver) {
    return {
      state: gpuDeviceStates.notBound,
      className: "warning",
      explanation: describe(`free, but not bound to ${passthroughDriver}`),
    };
  }

  return {
    state: gpuDeviceStates.free,
    className: "success",
    explanation: describe("free and ready for passthrough"),
  };
}

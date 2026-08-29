import { describe, expect, it } from "vitest";
import { classifyGpuDevice, classifyGpuNode, gpuDeviceStates, gpuNodeStates, passthroughDriver } from "./gpu-status";

// One case per row of the classifier tables of SPEC-0007, plus the two cases
// that keep an unexpected cluster from breaking a view: a phase this extension
// does not know, and a node with no status at all.
describe("classifyGpuNode", () => {
  it("reports a node whose host has vfio-pci loaded as ready", () => {
    const condition = classifyGpuNode({ phase: "Ready", vfioReady: true });

    expect(condition.state).toBe(gpuNodeStates.ready);
    expect(condition.className).toBe("success");
    expect(condition.explanation).toContain("vfio-pci is loaded");
    expect(condition.lastDiscovery).toBeUndefined();
  });

  it("hands the last discovery timestamp to the view instead of formatting it", () => {
    const condition = classifyGpuNode({
      phase: "Ready",
      vfioReady: true,
      lastDiscovery: "2026-08-28T09:15:00Z",
    });

    expect(condition.state).toBe(gpuNodeStates.ready);
    // The classifier stays pure: the date itself never appears in the text it
    // produces, the drawer and the list render it with `LocaleDate`.
    expect(condition.explanation).not.toContain("2026");
    expect(condition.lastDiscovery).toBe("2026-08-28T09:15:00Z");
  });

  it("does not read a node without vfio-pci as healthy, whatever its phase says", () => {
    for (const status of [
      { phase: "Ready", vfioReady: false },
      // Absent is not the same as false in the schema, but it is the same
      // verdict: nothing says the host can bind a device.
      { phase: "Ready" },
    ]) {
      const condition = classifyGpuNode(status);

      expect(condition.state).toBe(gpuNodeStates.noVfio);
      expect(condition.className).toBe("warning");
      expect(condition.explanation).toContain("vfio-pci");
    }
  });

  it("reports a discovery still in flight as a warning, not as an error", () => {
    const condition = classifyGpuNode({ phase: "Discovering" });

    expect(condition.state).toBe(gpuNodeStates.discovering);
    expect(condition.className).toBe("warning");
  });

  it("reports a failed discovery as an error, whatever vfioReady says", () => {
    const condition = classifyGpuNode({ phase: "Error", vfioReady: true });

    expect(condition.state).toBe(gpuNodeStates.error);
    expect(condition.className).toBe("error");
  });

  it("reports a node with no phase at all as unknown", () => {
    for (const status of [undefined, {}, { vfioReady: true }]) {
      const condition = classifyGpuNode(status);

      expect(condition.state).toBe(gpuNodeStates.unknown);
      expect(condition.className).toBe("info");
    }
  });

  it("shows a phase it does not know as it arrived, rather than forcing it into a bucket", () => {
    // `status.phase` has no enum in the schema, so an unrecognized value stays
    // opaque (the SPEC-0001/SPEC-0004 stance on unknown phases).
    const condition = classifyGpuNode({ phase: "Draining", vfioReady: true });

    expect(condition.state).toBe("Draining");
    expect(condition.className).toBe("info");
    expect(condition.explanation).toContain("Draining");
  });
});

describe("classifyGpuDevice", () => {
  it("reports a free device bound to the passthrough driver as healthy", () => {
    const condition = classifyGpuDevice({ index: 0, model: "H200-SXM", driver: passthroughDriver, allocated: false });

    expect(condition.state).toBe(gpuDeviceStates.free);
    expect(condition.className).toBe("success");
    expect(condition.explanation).toContain("GPU 0");
    expect(condition.explanation).toContain("H200-SXM");
  });

  it("names the holder of an allocated device", () => {
    const condition = classifyGpuDevice({
      index: 3,
      model: "H200-SXM",
      driver: passthroughDriver,
      allocated: true,
      allocatedTo: "gpu-lab/trainer-1",
    });

    expect(condition.state).toBe(gpuDeviceStates.allocated);
    expect(condition.className).toBe("info");
    expect(condition.explanation).toContain("gpu-lab/trainer-1");
  });

  it("reports an allocated device without a holder as allocated all the same", () => {
    const condition = classifyGpuDevice({ index: 1, driver: passthroughDriver, allocated: true });

    expect(condition.state).toBe(gpuDeviceStates.allocated);
    expect(condition.explanation).not.toContain("allocated to");
  });

  it("warns about a device the host has not rebound to the passthrough driver", () => {
    const condition = classifyGpuDevice({ index: 2, model: "H200-SXM", driver: "nvidia", allocated: false });

    expect(condition.state).toBe(gpuDeviceStates.notBound);
    expect(condition.className).toBe("warning");
    expect(condition.explanation).toContain(passthroughDriver);
  });

  it("describes a device whose fields are all absent without inventing any", () => {
    const condition = classifyGpuDevice({});

    expect(condition.state).toBe(gpuDeviceStates.notBound);
    expect(condition.explanation).toBe(`free, but not bound to ${passthroughDriver}`);
  });
});

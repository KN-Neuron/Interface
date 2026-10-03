import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceManager } from "../devices/deviceManager";

import { DeviceRegistry } from "../devices/deviceRegistry";

import { SimulationEEGAdapter } from "../devices/adapters/simulation/SimulationEEGAdapter";

import { EEGStreamService } from "./EEGStreamService";

describe("EEGStreamService", () => {
  let registry: DeviceRegistry;

  let manager: DeviceManager;

  let adapter: SimulationEEGAdapter;

  let service: EEGStreamService;

  beforeEach(async () => {
    vi.useFakeTimers();

    registry = new DeviceRegistry();

    manager = new DeviceManager(registry);

    adapter = new SimulationEEGAdapter();

    registry.register(adapter);

    await manager.connect(adapter.info.id);

    service = new EEGStreamService(manager, {
      bufferDurationSeconds: 2,
    });
  });

  afterEach(async () => {
    await service.dispose();

    await manager.disconnect();

    manager.dispose();

    vi.useRealTimers();
  });

  it("starts the EEG stream when the first consumer acquires it", async () => {
    const handle = await service.acquire({
      channels: "all",
    });

    expect(service.isStreaming()).toBe(true);

    expect(service.getConsumerCount()).toBe(1);

    await handle.release();

    // The physical EEG stream remains active while the device is connected.
    expect(service.isStreaming()).toBe(true);
  });

  it("allows selecting six channels from a 32-channel stream", async () => {
    const handle = await service.acquire({
      channels: ["O1", "O2", "Oz", "PO3", "PO4", "POz"],
    });

    expect(handle.channels.map((channel) => channel.label)).toEqual([
      "O1",
      "O2",
      "Oz",
      "PO3",
      "PO4",
      "POz",
    ]);

    await handle.release();
  });

  it("shares one physical stream between multiple consumers", async () => {
    const first = await service.acquire({
      channels: ["O1", "O2", "Oz"],
    });

    const second = await service.acquire({
      channels: "all",
    });

    expect(service.getConsumerCount()).toBe(2);

    expect(adapter.isStreaming()).toBe(true);

    await first.release();

    expect(adapter.isStreaming()).toBe(true);

    await second.release();

    // Releasing the last consumer does not stop the physical device stream.
    expect(adapter.isStreaming()).toBe(true);
  });

  it("delivers only selected channels to a consumer", async () => {
    const listener = vi.fn();

    const handle = await service.acquire({
      channels: ["O1", "Oz", "PO3"],

      onBatch: listener,
    });

    vi.advanceTimersByTime(80);

    expect(listener).toHaveBeenCalled();

    const batch = listener.mock.calls[0][0];

    expect(batch.channels.map((channel: { label: string }) => channel.label)).toEqual([
      "O1",
      "Oz",
      "PO3",
    ]);

    expect(batch.values).toHaveLength(3);

    await handle.release();
  });

  it("provides recent samples through the shared ring buffer", async () => {
    const handle = await service.acquire({
      channels: "all",
    });

    vi.advanceTimersByTime(200);

    const window = service.getLatestWindow(0.2, ["O1", "O2", "Oz", "PO3", "PO4", "POz"]);

    expect(window.sampleRateHz).toBe(250);

    expect(window.channels).toHaveLength(6);

    expect(window.sampleCount).toBe(50);

    expect(window.values).toHaveLength(6);

    expect(window.values[0]).toHaveLength(50);

    await handle.release();
  });

  it("rejects missing channel requirements", async () => {
    await expect(
      service.acquire({
        channels: ["O1", "NOT-A-CHANNEL"],
      }),
    ).rejects.toThrow("Missing required EEG channels: NOT-A-CHANNEL.");
  });
});

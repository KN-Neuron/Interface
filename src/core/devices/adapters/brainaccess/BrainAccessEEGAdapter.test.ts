import { describe, expect, it, vi } from "vitest";

import { BrainAccessEEGAdapter } from "./BrainAccessEEGAdapter";

import type {
  BrainAccessBridgeLike,
  BrainAccessDisconnectListener,
  BrainAccessSampleListener,
} from "./BrainAccessBridge";

import type { EEGSampleBatch } from "../../../eeg/models";

class FakeBridge implements BrainAccessBridgeLike {
  devices = [
    {
      name: "BA MAXI 009",
      macAddress: "00:00:00:00:00:00",
    },
  ];

  sampleListener: BrainAccessSampleListener | null = null;

  disconnectListener: BrainAccessDisconnectListener | null = null;

  readonly start = vi.fn(async () => undefined);

  readonly stop = vi.fn(async () => undefined);

  readonly scan = vi.fn(async () => this.devices);

  readonly connect = vi.fn(async () => ({
    deviceName: "BA MAXI 009",
    sampleRateHz: 250,
    channelCount: 32,
    battery: 80,
  }));

  readonly disconnect = vi.fn(async () => undefined);

  readonly startStream = vi.fn(async () => undefined);

  readonly stopStream = vi.fn(async () => undefined);

  subscribeSamples(listener: BrainAccessSampleListener): () => void {
    this.sampleListener = listener;

    return () => {
      this.sampleListener = null;
    };
  }

  subscribeDisconnected(listener: BrainAccessDisconnectListener): () => void {
    this.disconnectListener = listener;

    return () => {
      this.disconnectListener = null;
    };
  }

  emitSample(batch: EEGSampleBatch): void {
    this.sampleListener?.(batch);
  }

  emitDisconnected(reason: string): void {
    this.disconnectListener?.(reason);
  }
}

describe("BrainAccessEEGAdapter", () => {
  it("starts disconnected", () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    expect(adapter.getStatus().state).toBe("disconnected");
  });

  it("scans and connects to BA MAXI 009", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    expect(bridge.start).toHaveBeenCalledOnce();

    expect(bridge.scan).toHaveBeenCalledOnce();

    expect(bridge.connect).toHaveBeenCalledWith("BA MAXI 009");

    expect(adapter.getStatus().state).toBe("connected");
  });

  it("exposes hardware-reported stream metadata with the 32-channel cap mapping", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    const streamInfo = await adapter.getStreamInfo();

    expect(streamInfo.sampleRateHz).toBe(250);

    expect(streamInfo.channels).toHaveLength(32);

    expect(streamInfo.channels[0]).toMatchObject({
      index: 0,
      sourceIndex: 0,
      label: "AF3",
      type: "eeg",
    });

    expect(streamInfo.channels.find((channel) => channel.label === "AF3")?.sourceIndex).toBe(0);

    expect(streamInfo.channels.find((channel) => channel.label === "AFz")?.sourceIndex).toBe(1);

    expect(streamInfo.channels.find((channel) => channel.label === "AF4")?.sourceIndex).toBe(2);

    expect(streamInfo.channels.find((channel) => channel.label === "PO3")?.sourceIndex).toBe(26);

    expect(streamInfo.channels.find((channel) => channel.label === "POz")?.sourceIndex).toBe(27);

    expect(streamInfo.channels.find((channel) => channel.label === "PO4")?.sourceIndex).toBe(28);

    expect(streamInfo.channels.find((channel) => channel.label === "O1")?.sourceIndex).toBe(29);

    expect(streamInfo.channels.find((channel) => channel.label === "Oz")?.sourceIndex).toBe(30);

    expect(streamInfo.channels.find((channel) => channel.label === "O2")?.sourceIndex).toBe(31);
  });

  it("maps all 32 streamed EEG channels to unique electrode labels", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    const streamInfo = await adapter.getStreamInfo();

    const labels = streamInfo.channels.map((channel) => channel.label);

    expect(labels).toEqual([
      "AF3",
      "AFz",
      "AF4",
      "F7",
      "F3",
      "Fz",
      "F4",
      "F8",
      "FC5",
      "FC1",
      "FC2",
      "FC6",
      "T7",
      "C3",
      "Cz",
      "C4",
      "T8",
      "CP5",
      "CP1",
      "CP2",
      "CP6",
      "P7",
      "P3",
      "Pz",
      "P4",
      "P8",
      "PO3",
      "POz",
      "PO4",
      "O1",
      "Oz",
      "O2",
    ]);

    expect(new Set(labels).size).toBe(32);
  });

  it("rejects connection when the configured device is not discovered", async () => {
    const bridge = new FakeBridge();

    bridge.devices = [];

    const adapter = new BrainAccessEEGAdapter(bridge);

    await expect(adapter.connect()).rejects.toThrow(
      'BrainAccess device "BA MAXI 009" was not found.',
    );

    expect(adapter.getStatus().state).toBe("error");

    expect(bridge.connect).not.toHaveBeenCalled();
  });

  it("starts and stops the live stream", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    await adapter.startStream();

    expect(adapter.isStreaming()).toBe(true);

    expect(bridge.startStream).toHaveBeenCalledOnce();

    await adapter.stopStream();

    expect(adapter.isStreaming()).toBe(false);

    expect(bridge.stopStream).toHaveBeenCalledOnce();
  });

  it("forwards live sample batches", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    await adapter.startStream();

    const listener = vi.fn();

    adapter.subscribeSamples(listener);

    const batch: EEGSampleBatch = {
      sequenceStart: 0,
      timestampStartMs: 0,
      sampleRateHz: 250,
      sampleCount: 2,
      channelCount: 32,
      values: Array.from(
        {
          length: 32,
        },
        () => [0, 1],
      ),
      sourceSampleNumberStart: 100,
    };

    bridge.emitSample(batch);

    expect(listener).toHaveBeenCalledOnce();

    expect(listener).toHaveBeenCalledWith(batch);
  });

  it("does not forward samples before streaming starts", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    const listener = vi.fn();

    adapter.subscribeSamples(listener);

    const batch: EEGSampleBatch = {
      sequenceStart: 0,
      timestampStartMs: 0,
      sampleRateHz: 250,
      sampleCount: 1,
      channelCount: 32,
      values: Array.from(
        {
          length: 32,
        },
        () => [0],
      ),
      sourceSampleNumberStart: 100,
    };

    bridge.emitSample(batch);

    expect(listener).not.toHaveBeenCalled();
  });

  it("marks the adapter as errored when the Bluetooth connection is lost", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    await adapter.startStream();

    bridge.emitDisconnected("Bluetooth connection lost.");

    expect(adapter.isStreaming()).toBe(false);

    expect(adapter.getStatus()).toMatchObject({
      state: "error",
      error: "Bluetooth connection lost.",
      message: "BrainAccess Bluetooth connection was lost.",
    });
  });

  it("disconnects and stops the sidecar", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    await adapter.disconnect();

    expect(bridge.disconnect).toHaveBeenCalledOnce();

    expect(bridge.stop).toHaveBeenCalledOnce();

    expect(adapter.getStatus().state).toBe("disconnected");

    expect(adapter.isStreaming()).toBe(false);
  });
});

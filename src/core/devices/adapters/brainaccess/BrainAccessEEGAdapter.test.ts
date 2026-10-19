import { describe, expect, it, vi } from "vitest";

import { BrainAccessEEGAdapter } from "./BrainAccessEEGAdapter";

import { BRAINACCESS_MIDI_PROFILE } from "./brainAccessProfiles";

import type {
  BrainAccessBridgeLike,
  BrainAccessConnectOptions,
  BrainAccessDisconnectListener,
  BrainAccessSampleListener,
  BrainAccessStreamOptions,
  BrainAccessStreamStartResult,
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

  channelCount = 32;

  streamStartResult: BrainAccessStreamStartResult = {
    streaming: true,
    lsl: true,
    lslError: null,
  };

  readonly connect = vi.fn(async (deviceName: string, _options?: BrainAccessConnectOptions) => ({
    deviceName,
    sampleRateHz: 250,
    channelCount: this.channelCount,
    battery: 80,
  }));

  readonly disconnect = vi.fn(async () => undefined);

  readonly startStream = vi.fn(
    async (_options?: BrainAccessStreamOptions) => this.streamStartResult,
  );

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

    expect(bridge.connect).toHaveBeenCalledWith("BA MAXI 009", { biasElectrodes: undefined });

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

  it("reports channels in microvolts", async () => {
    const adapter = new BrainAccessEEGAdapter(new FakeBridge());

    await adapter.connect();

    const streamInfo = await adapter.getStreamInfo();

    expect(new Set(streamInfo.channels.map((channel) => channel.unit))).toEqual(new Set(["uV"]));
  });

  it("republishes the stream on LSL for neurostate while streaming", async () => {
    const bridge = new FakeBridge();

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    expect(adapter.getLslStream()).toBeNull();

    await adapter.startStream();

    const options = bridge.startStream.mock.calls[0]?.[0];

    expect(options?.lsl).toMatchObject({
      name: "KNeuron BA MAXI 009",
      sourceId: "kneuron-BA MAXI 009",
    });

    expect(options?.lsl?.channelLabels).toHaveLength(32);

    expect(options?.lsl?.channelLabels[0]).toBe("AF3");

    expect(adapter.getLslStream()).toEqual({
      name: "KNeuron BA MAXI 009",
      neurostateProfile: "standard",
    });

    await adapter.stopStream();

    expect(adapter.getLslStream()).toBeNull();
  });

  it("keeps streaming EEG when LSL republishing fails", async () => {
    const bridge = new FakeBridge();

    bridge.streamStartResult = {
      streaming: true,
      lsl: false,
      lslError: "liblsl not found",
    };

    const adapter = new BrainAccessEEGAdapter(bridge);

    await adapter.connect();

    await adapter.startStream();

    expect(adapter.isStreaming()).toBe(true);

    expect(adapter.getLslStream()).toBeNull();

    expect(adapter.getLslError()).toBe("liblsl not found");
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

  describe("with the BrainAccess MIDI profile", () => {
    function midiBridge(): FakeBridge {
      const bridge = new FakeBridge();

      bridge.devices = [
        { name: "BA MAXI 009", macAddress: "00:00:00:00:00:01" },
        { name: "BA MIDI 026", macAddress: "00:00:00:00:00:02" },
      ];

      bridge.channelCount = 16;

      return bridge;
    }

    it("connects to any BA MIDI headset with the bias on pin 0", async () => {
      const bridge = midiBridge();

      const adapter = new BrainAccessEEGAdapter(bridge, BRAINACCESS_MIDI_PROFILE);

      await adapter.connect();

      expect(adapter.info.id).toBe("brainaccess-midi");

      expect(bridge.connect).toHaveBeenCalledWith("BA MIDI 026", { biasElectrodes: [0] });

      expect(adapter.getStatus().message).toContain("Configured 16-channel cap mapping");
    });

    it("labels the 16 channels in Board's MIDI template order", async () => {
      const adapter = new BrainAccessEEGAdapter(midiBridge(), BRAINACCESS_MIDI_PROFILE);

      await adapter.connect();

      const streamInfo = await adapter.getStreamInfo();

      expect(streamInfo.channels.map((channel) => channel.label)).toEqual([
        "P8",
        "O2",
        "P4",
        "C4",
        "F8",
        "F4",
        "Oz",
        "Cz",
        "Fz",
        "Pz",
        "F3",
        "O1",
        "P7",
        "C3",
        "P3",
        "F7",
      ]);
    });

    it("hands neurostate the MIDI profile", async () => {
      const adapter = new BrainAccessEEGAdapter(midiBridge(), BRAINACCESS_MIDI_PROFILE);

      await adapter.connect();

      await adapter.startStream();

      expect(adapter.getLslStream()).toEqual({
        name: "KNeuron BA MIDI 026",
        neurostateProfile: "brainaccess-midi",
      });
    });

    it("does not mistake other headsets for a MIDI", async () => {
      const bridge = new FakeBridge();

      bridge.devices = [{ name: "BA MIDIX 1", macAddress: "00:00:00:00:00:03" }];

      const adapter = new BrainAccessEEGAdapter(bridge, BRAINACCESS_MIDI_PROFILE);

      await expect(adapter.connect()).rejects.toThrow(
        'BrainAccess device "BA MIDI" was not found. Discovered: BA MIDIX 1.',
      );
    });
  });
});

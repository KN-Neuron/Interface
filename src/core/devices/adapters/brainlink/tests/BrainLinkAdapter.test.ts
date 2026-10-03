import { describe, expect, it } from "vitest";

import type { BrainMetricsSnapshot } from "../../../../brainMetrics";

import { BrainLinkAdapter } from "../BrainLinkAdapter";

import type {
  BrainLinkBridgeLike,
  BrainLinkDisconnectListener,
  BrainLinkMetricsListener,
} from "../BrainLinkBridge";

class FakeBrainLinkBridge implements BrainLinkBridgeLike {
  private readonly metricsListeners = new Set<BrainLinkMetricsListener>();
  private readonly disconnectListeners = new Set<BrainLinkDisconnectListener>();

  start = async (): Promise<void> => undefined;
  stop = async (): Promise<void> => undefined;
  disconnect = async (): Promise<void> => undefined;

  scan = async () => [
    {
      port: "COM7",
      description: "Standard Serial over Bluetooth link",
      hwid: "BTHENUM",
      manufacturer: null,
    },
  ];

  connect = async () => ({
    deviceName: "BrainLink Lite",
    model: "BL002 V2.0",
    port: "COM7",
    baudRate: 57600,
  });

  getMetrics = async (): Promise<Readonly<BrainMetricsSnapshot> | null> => null;

  subscribeMetrics(listener: BrainLinkMetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  subscribeDisconnected(listener: BrainLinkDisconnectListener): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  emitMetrics(metrics: BrainMetricsSnapshot): void {
    for (const listener of this.metricsListeners) {
      listener(metrics);
    }
  }
}

describe("BrainLinkAdapter", () => {
  it("starts disconnected", () => {
    const adapter = new BrainLinkAdapter(new FakeBrainLinkBridge());
    expect(adapter.getStatus().state).toBe("disconnected");
  });

  it("connects through the bridge", async () => {
    const adapter = new BrainLinkAdapter(new FakeBrainLinkBridge());
    await adapter.connect();
    expect(adapter.getStatus().state).toBe("connected");
  });

  it("forwards attention metrics", async () => {
    const bridge = new FakeBrainLinkBridge();
    const adapter = new BrainLinkAdapter(bridge);
    await adapter.connect();

    const received: number[] = [];
    adapter.subscribeBrainMetrics((metrics) => {
      if (metrics.attention != null) {
        received.push(metrics.attention);
      }
    });

    bridge.emitMetrics({
      attention: 68,
      meditation: 44,
      poorSignalLevel: 0,
      signalQualityPercent: 100,
      eegPower: null,
      blinkStrength: null,
      timestampMs: 123,
    });

    expect(received).toEqual([68]);
    expect(adapter.getLatestBrainMetrics()?.attention).toBe(68);
  });
});

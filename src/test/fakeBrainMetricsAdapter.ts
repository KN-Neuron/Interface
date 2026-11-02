import type { BrainMetricsDeviceAdapter } from "../core/devices/contracts/BrainMetricsDeviceAdapter";
import type { DeviceStatusListener } from "../core/devices/contracts/DeviceAdapter";
import type { DeviceStatus } from "../core/devices/models/device";
import type { BrainMetricsListener, BrainMetricsSnapshot } from "../core/brainMetrics/models";

/**
 * A device that computes metrics itself and has no raw EEG, like BrainLink.
 */
export class FakeBrainMetricsAdapter implements BrainMetricsDeviceAdapter {
  readonly info = {
    id: "fake-headset",
    name: "Fake Headset",
    kind: "eeg" as const,
    transport: "simulation" as const,
  };

  status: DeviceStatus = { state: "disconnected", updatedAt: 0 };

  latest: Readonly<BrainMetricsSnapshot> | null = null;

  private readonly statusListeners = new Set<DeviceStatusListener>();

  private readonly metricsListeners = new Set<BrainMetricsListener>();

  get listenerCount(): number {
    return this.metricsListeners.size;
  }

  getStatus(): DeviceStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.setState("connected");
  }

  async disconnect(): Promise<void> {
    this.setState("disconnected");
  }

  subscribeStatus(listener: DeviceStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  getLatestBrainMetrics(): Readonly<BrainMetricsSnapshot> | null {
    return this.latest;
  }

  subscribeBrainMetrics(listener: BrainMetricsListener): () => void {
    this.metricsListeners.add(listener);
    return () => this.metricsListeners.delete(listener);
  }

  emit(metrics: Readonly<BrainMetricsSnapshot>): void {
    for (const listener of this.metricsListeners) {
      listener(metrics);
    }
  }

  private setState(state: DeviceStatus["state"]): void {
    this.status = { state, updatedAt: Date.now() };

    for (const listener of this.statusListeners) {
      listener(this.status);
    }
  }
}

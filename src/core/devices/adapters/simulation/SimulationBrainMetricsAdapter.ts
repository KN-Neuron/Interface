import type { DeviceInfo, DeviceStatus } from "../../models/device";

import type { DeviceStatusListener, DeviceUnsubscribe } from "../../contracts/DeviceAdapter";

import type { BrainMetricsDeviceAdapter } from "../../contracts/BrainMetricsDeviceAdapter";

import type { BrainMetricsListener, BrainMetricsSnapshot } from "../../../brainMetrics";

/**
 * eSense-style devices such as BrainLink publish roughly once per second.
 */
const UPDATE_INTERVAL_MS = 1000;

const SIMULATION_INFO: DeviceInfo = {
  id: "simulation-brain-metrics",
  name: "Simulation Brain Metrics",
  kind: "eeg",
  transport: "simulation",
  manufacturer: "KNeuron",
  model: "Attention / meditation simulator",
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Development-only stand-in for BrainLink Lite.
 *
 * Produces slowly drifting attention/meditation values so modules consuming
 * BrainMetricsService (Neuorrun) can be exercised without hardware.
 */
export class SimulationBrainMetricsAdapter implements BrainMetricsDeviceAdapter {
  readonly info: Readonly<DeviceInfo> = SIMULATION_INFO;

  private status: DeviceStatus = {
    state: "disconnected",
    message: "Simulation brain metrics are disconnected.",
    updatedAt: Date.now(),
  };

  private latestMetrics: Readonly<BrainMetricsSnapshot> | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;

  private tick = 0;

  private readonly statusListeners = new Set<DeviceStatusListener>();

  private readonly metricsListeners = new Set<BrainMetricsListener>();

  getStatus(): Readonly<DeviceStatus> {
    return { ...this.status };
  }

  async connect(): Promise<void> {
    if (this.status.state === "connected") {
      return;
    }

    this.tick = 0;
    this.emitMetrics();

    this.timer = setInterval(() => {
      this.tick += 1;
      this.emitMetrics();
    }, UPDATE_INTERVAL_MS);

    this.setStatus({
      state: "connected",
      message: "Simulation brain metrics are streaming.",
      updatedAt: Date.now(),
    });
  }

  async disconnect(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.latestMetrics = null;

    this.setStatus({
      state: "disconnected",
      message: "Simulation brain metrics are disconnected.",
      updatedAt: Date.now(),
    });
  }

  getLatestBrainMetrics(): Readonly<BrainMetricsSnapshot> | null {
    return this.latestMetrics ? { ...this.latestMetrics } : null;
  }

  subscribeBrainMetrics(listener: BrainMetricsListener): DeviceUnsubscribe {
    this.metricsListeners.add(listener);

    return () => {
      this.metricsListeners.delete(listener);
    };
  }

  subscribeStatus(listener: DeviceStatusListener): DeviceUnsubscribe {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private emitMetrics(): void {
    const t = this.tick;

    /**
     * Slow waves plus noise: attention regularly crosses typical game
     * thresholds (40-70) in both directions.
     */
    const attention = clampPercent(55 + 30 * Math.sin(t / 7) + (Math.random() - 0.5) * 16);
    const meditation = clampPercent(50 + 25 * Math.cos(t / 11) + (Math.random() - 0.5) * 12);

    const snapshot: BrainMetricsSnapshot = {
      attention,
      meditation,
      poorSignalLevel: 0,
      signalQualityPercent: 100,
      eegPower: null,
      blinkStrength: null,
      timestampMs: Date.now(),
    };

    this.latestMetrics = snapshot;

    for (const listener of this.metricsListeners) {
      listener({ ...snapshot });
    }
  }

  private setStatus(status: DeviceStatus): void {
    this.status = status;

    const snapshot = { ...status };

    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}

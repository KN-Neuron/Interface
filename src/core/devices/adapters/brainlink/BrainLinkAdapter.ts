import type { DeviceStatus } from "../../models/device";

import type { EEGDeviceInfo } from "../../models/eeg";

import type {
  DeviceAdapter,
  DeviceStatusListener,
  DeviceUnsubscribe,
} from "../../contracts/DeviceAdapter";

import type { BrainMetricsDeviceAdapter } from "../../contracts/BrainMetricsDeviceAdapter";

import type { BrainMetricsListener, BrainMetricsSnapshot } from "../../../brainMetrics";

import { BrainLinkBridge, type BrainLinkBridgeLike } from "./BrainLinkBridge";

const DEVICE_INFO: EEGDeviceInfo = {
  id: "brainlink-lite",
  name: "BrainLink Lite",
  kind: "eeg",
  transport: "bluetooth",
  manufacturer: "Macrotellect",
  model: "BL002 V2.0",
};

/**
 * BrainLink Lite adapter.
 *
 * This adapter intentionally exposes the headset's native eSense-style
 * attention/meditation metrics instead of pretending that Neuorrun requires
 * FBCCA or BrainAccess raw EEG.
 */
export class BrainLinkAdapter implements DeviceAdapter, BrainMetricsDeviceAdapter {
  readonly info: Readonly<EEGDeviceInfo> = DEVICE_INFO;

  private status: DeviceStatus = {
    state: "disconnected",
    message: "BrainLink Lite is disconnected.",
    updatedAt: Date.now(),
  };

  private latestMetrics: Readonly<BrainMetricsSnapshot> | null = null;

  private readonly statusListeners = new Set<DeviceStatusListener>();

  private readonly metricsListeners = new Set<BrainMetricsListener>();

  private readonly bridgeMetricsUnsubscribe: () => void;

  private readonly bridgeDisconnectUnsubscribe: () => void;

  constructor(private readonly bridge: BrainLinkBridgeLike = new BrainLinkBridge()) {
    this.bridgeMetricsUnsubscribe = this.bridge.subscribeMetrics((metrics) => {
      this.latestMetrics = { ...metrics };

      for (const listener of this.metricsListeners) {
        listener({ ...metrics });
      }
    });

    this.bridgeDisconnectUnsubscribe = this.bridge.subscribeDisconnected((reason) => {
      this.latestMetrics = null;

      this.setStatus({
        state: "error",
        error: reason,
        message: "BrainLink Lite Bluetooth connection was lost.",
        updatedAt: Date.now(),
      });
    });
  }

  getStatus(): Readonly<DeviceStatus> {
    return { ...this.status };
  }

  async connect(): Promise<void> {
    if (this.status.state === "connected") {
      return;
    }

    this.setStatus({
      state: "connecting",
      message: "Searching Windows serial ports for BrainLink Lite...",
      updatedAt: Date.now(),
    });

    try {
      await this.bridge.start();

      const ports = await this.bridge.scan();

      this.setStatus({
        state: "connecting",
        message:
          ports.length > 0
            ? `Probing ${ports.length} serial port${ports.length === 1 ? "" : "s"} for BrainLink Lite...`
            : "No serial ports were reported by Windows.",
        updatedAt: Date.now(),
      });

      const connection = await this.bridge.connect();

      this.latestMetrics = await this.bridge.getMetrics();

      this.setStatus({
        state: "connected",
        message: `Connected to BrainLink Lite on ${connection.port} · ${connection.baudRate} baud.`,
        updatedAt: Date.now(),
      });
    } catch (error) {
      this.latestMetrics = null;

      try {
        await this.bridge.stop();
      } catch {
        // Preserve the original connection error.
      }

      const message = error instanceof Error ? error.message : String(error);

      this.setStatus({
        state: "error",
        error: message,
        message: "BrainLink Lite connection failed.",
        updatedAt: Date.now(),
      });

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status.state === "disconnected") {
      return;
    }

    this.setStatus({
      state: "disconnecting",
      message: "Disconnecting BrainLink Lite...",
      updatedAt: Date.now(),
    });

    try {
      await this.bridge.disconnect();
      await this.bridge.stop();

      this.latestMetrics = null;

      this.setStatus({
        state: "disconnected",
        message: "BrainLink Lite is disconnected.",
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.setStatus({
        state: "error",
        error: message,
        message: "BrainLink Lite disconnection failed.",
        updatedAt: Date.now(),
      });

      throw error;
    }
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

  dispose(): void {
    this.bridgeMetricsUnsubscribe();
    this.bridgeDisconnectUnsubscribe();
  }

  private setStatus(status: DeviceStatus): void {
    this.status = status;

    const snapshot = { ...status };

    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}

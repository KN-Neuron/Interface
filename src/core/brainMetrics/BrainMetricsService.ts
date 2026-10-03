import { deviceManager, type DeviceManager } from "../devices/deviceManager";

import { isBrainMetricsDeviceAdapter } from "../devices/contracts/BrainMetricsDeviceAdapter";

import type { BrainMetricsListener, BrainMetricsSnapshot } from "./models";

export interface BrainMetricsHandle {
  readonly deviceId: string;

  release(): void;
}

/**
 * Application-level access to cognitive metrics.
 *
 * Modules depend on this service rather than importing BrainLinkAdapter.
 */
export class BrainMetricsService {
  constructor(private readonly manager: DeviceManager = deviceManager) {}

  acquire(listener: BrainMetricsListener): BrainMetricsHandle {
    const adapter = this.manager.getActiveAdapter();

    if (!adapter) {
      throw new Error("No active brain-metrics device is connected.");
    }

    if (!isBrainMetricsDeviceAdapter(adapter)) {
      throw new Error(
        `Active device "${adapter.info.name}" does not expose attention/meditation metrics.`,
      );
    }

    if (adapter.getStatus().state !== "connected") {
      throw new Error(`Device "${adapter.info.name}" is not connected.`);
    }

    const unsubscribe = adapter.subscribeBrainMetrics(listener);
    const latest = adapter.getLatestBrainMetrics();

    if (latest) {
      listener(latest);
    }

    let released = false;

    return {
      deviceId: adapter.info.id,
      release: () => {
        if (released) {
          return;
        }

        released = true;
        unsubscribe();
      },
    };
  }

  getLatest(): Readonly<BrainMetricsSnapshot> | null {
    const adapter = this.manager.getActiveAdapter();

    if (!adapter || !isBrainMetricsDeviceAdapter(adapter)) {
      return null;
    }

    return adapter.getLatestBrainMetrics();
  }
}

export const brainMetricsService = new BrainMetricsService();

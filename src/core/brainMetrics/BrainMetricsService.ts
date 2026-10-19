import { deviceManager, type DeviceManager } from "../devices/deviceManager";

import { isBrainMetricsDeviceAdapter } from "../devices/contracts/BrainMetricsDeviceAdapter";

import { neuroStateService, type NeuroStateService, type NeuroStateValues } from "../neurostate";

import type { BrainMetricsListener, BrainMetricsSnapshot } from "./models";

export interface BrainMetricsHandle {
  readonly deviceId: string;

  release(): void;
}

/**
 * neurostate's values in the ThinkGear-style shape modules already consume:
 * relaxation becomes meditation, and poorSignalLevel is 0 whenever the values
 * are usable, exactly as on neurostate's ThinkGear output.
 */
export function brainMetricsFromNeuroState(
  values: Readonly<NeuroStateValues>,
): Readonly<BrainMetricsSnapshot> {
  return {
    attention: Math.round(values.attention),
    meditation: Math.round(values.relaxation),
    poorSignalLevel: values.poorSignalLevel,
    signalQualityPercent: Math.round(values.quality),
    eegPower: null,
    blinkStrength: null,
    timestampMs: values.receivedAtMs,
  };
}

/**
 * Application-level access to cognitive metrics.
 *
 * Modules depend on this service rather than importing BrainLinkAdapter.
 *
 * Devices that compute metrics themselves (BrainLink) provide them directly.
 * For raw EEG caps (BrainAccess), neurostate computes them from the EEG.
 */
export class BrainMetricsService {
  constructor(
    private readonly manager: DeviceManager = deviceManager,
    private readonly neuroState: NeuroStateService = neuroStateService,
  ) {}

  acquire(listener: BrainMetricsListener): BrainMetricsHandle {
    const adapter = this.manager.getActiveAdapter();

    if (!adapter) {
      throw new Error("No active brain-metrics device is connected.");
    }

    if (adapter.getStatus().state !== "connected") {
      throw new Error(`Device "${adapter.info.name}" is not connected.`);
    }

    if (this.neuroState.supports(adapter)) {
      const handle = this.neuroState.acquire((values) => {
        listener(brainMetricsFromNeuroState(values));
      });

      return {
        deviceId: adapter.info.id,
        release: handle.release,
      };
    }

    if (!isBrainMetricsDeviceAdapter(adapter)) {
      throw new Error(
        `Active device "${adapter.info.name}" does not expose attention/meditation metrics.`,
      );
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

    if (!adapter) {
      return null;
    }

    if (this.neuroState.supports(adapter)) {
      const latest = this.neuroState.getLatest();

      return latest ? brainMetricsFromNeuroState(latest) : null;
    }

    return isBrainMetricsDeviceAdapter(adapter) ? adapter.getLatestBrainMetrics() : null;
  }
}

export const brainMetricsService = new BrainMetricsService();

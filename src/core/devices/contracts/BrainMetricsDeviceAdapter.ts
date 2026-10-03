import type { BrainMetricsListener, BrainMetricsSnapshot } from "../../brainMetrics/models";

import type { DeviceAdapter, DeviceUnsubscribe } from "./DeviceAdapter";

/**
 * Optional capability implemented by devices that expose already-computed
 * cognitive metrics such as attention and meditation.
 *
 * This contract is deliberately separate from EEGDeviceAdapter: a device can
 * expose eSense-style metrics without KNeuron requiring raw EEG streaming.
 */
export interface BrainMetricsDeviceAdapter extends DeviceAdapter {
  getLatestBrainMetrics(): Readonly<BrainMetricsSnapshot> | null;

  subscribeBrainMetrics(listener: BrainMetricsListener): DeviceUnsubscribe;
}

export function isBrainMetricsDeviceAdapter(
  adapter: DeviceAdapter,
): adapter is BrainMetricsDeviceAdapter {
  const candidate = adapter as Partial<BrainMetricsDeviceAdapter>;

  return (
    typeof candidate.getLatestBrainMetrics === "function" &&
    typeof candidate.subscribeBrainMetrics === "function"
  );
}

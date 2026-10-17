import { SimulationEEGAdapter } from "./adapters/simulation/SimulationEEGAdapter";
import { SimulationBrainMetricsAdapter } from "./adapters/simulation/SimulationBrainMetricsAdapter";

import { BrainAccessEEGAdapter } from "./adapters/brainaccess/BrainAccessEEGAdapter";

import { BrainLinkAdapter } from "./adapters/brainlink/BrainLinkAdapter";

import type { DeviceAdapter } from "./contracts/DeviceAdapter";

import { deviceRegistry } from "./deviceRegistry";

/**
 * Production hardware bundled with KNeuron.
 *
 * Browser container builds expose simulated devices instead of native hardware.
 */
function createBuiltInDevices(): DeviceAdapter[] {
  if (import.meta.env.VITE_RUNTIME === "web") {
    return [new SimulationEEGAdapter(), new SimulationBrainMetricsAdapter()];
  }

  const devices: DeviceAdapter[] = [new BrainAccessEEGAdapter(), new BrainLinkAdapter()];

  return devices;
}

export function registerBuiltInDevices(): void {
  const adapters = createBuiltInDevices();

  for (const adapter of adapters) {
    if (deviceRegistry.has(adapter.info.id)) {
      continue;
    }

    deviceRegistry.register(adapter);
  }
}

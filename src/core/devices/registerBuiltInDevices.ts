import { BrainAccessEEGAdapter } from "./adapters/brainaccess/BrainAccessEEGAdapter";

import { BrainLinkAdapter } from "./adapters/brainlink/BrainLinkAdapter";

import { SimulationBrainMetricsAdapter } from "./adapters/simulation/SimulationBrainMetricsAdapter";

import { SimulationEEGAdapter } from "./adapters/simulation/SimulationEEGAdapter";

import type { DeviceAdapter } from "./contracts/DeviceAdapter";

import { deviceRegistry } from "./deviceRegistry";

import { APP_CONFIG } from "../../config/appConfig";

/**
 * Production hardware bundled with KNeuron.
 *
 * Simulation devices are registered only in development builds so the UI
 * and modules can be worked on without physical hardware.
 */
function createBuiltInDevices(): DeviceAdapter[] {
  const devices: DeviceAdapter[] = [new BrainAccessEEGAdapter(), new BrainLinkAdapter()];

  if (APP_CONFIG.enableSimulationDevices) {
    devices.push(new SimulationEEGAdapter(), new SimulationBrainMetricsAdapter());
  }

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

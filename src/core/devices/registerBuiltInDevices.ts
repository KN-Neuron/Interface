import { BrainAccessBridge } from "./adapters/brainaccess/BrainAccessBridge";

import { BrainAccessEEGAdapter } from "./adapters/brainaccess/BrainAccessEEGAdapter";

import {
  BRAINACCESS_MAXI_PROFILE,
  BRAINACCESS_MIDI_PROFILE,
} from "./adapters/brainaccess/brainAccessProfiles";

import { BrainLinkAdapter } from "./adapters/brainlink/BrainLinkAdapter";

import type { DeviceAdapter } from "./contracts/DeviceAdapter";

import { deviceRegistry } from "./deviceRegistry";

/**
 * Production hardware bundled with KNeuron.
 *
 * Simulation devices are registered only in development builds so the UI
 * and modules can be worked on without physical hardware.
 */
function createBuiltInDevices(): DeviceAdapter[] {
  const devices: DeviceAdapter[] = [
    new BrainAccessEEGAdapter(new BrainAccessBridge(), BRAINACCESS_MAXI_PROFILE),
    new BrainAccessEEGAdapter(new BrainAccessBridge(), BRAINACCESS_MIDI_PROFILE),
    new BrainLinkAdapter(),
  ];

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

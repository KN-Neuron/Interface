import { isBrainMetricsDeviceAdapter } from "../../core/devices/contracts/BrainMetricsDeviceAdapter";

import { deviceRegistry } from "../../core/devices/deviceRegistry";

import type { DeviceManagerSnapshot } from "../../core/devices/deviceManager";

import type { EEGStreamInfo } from "../../core/devices/models/eeg";

import type { KNeuronModuleManifest } from "../../types/module";

export interface ModuleReadiness {
  /**
   * True when the connected device satisfies every declared requirement.
   */
  ready: boolean;

  /**
   * Plain-language requirement, e.g. "Needs EEG with O1, O2, Oz".
   */
  requirement: string;

  /**
   * What is missing right now, or null when ready.
   */
  missing: string | null;
}

/**
 * Compares a module's declared capabilities with the active device.
 *
 * Purely informational: the launcher does not block opening a module.
 */
export function getModuleReadiness(
  manifest: KNeuronModuleManifest,
  snapshot: DeviceManagerSnapshot,
  streamInfo: Readonly<EEGStreamInfo> | undefined,
): ModuleReadiness {
  const connected =
    snapshot.activeDeviceId !== null && snapshot.activeStatus?.state === "connected";

  const eeg = manifest.capabilities.eeg;

  if (eeg?.required) {
    const channels = eeg.requiredChannels ?? [];

    const requirement =
      channels.length > 0 ? `Needs EEG with ${channels.join(", ")}` : "Needs a raw EEG stream";

    if (!connected) {
      return { ready: false, requirement, missing: "No device connected" };
    }

    if (!streamInfo) {
      return {
        ready: false,
        requirement,
        missing: `${snapshot.activeDeviceInfo?.name ?? "This device"} has no raw EEG stream`,
      };
    }

    const available = new Set(streamInfo.channels.map((channel) => channel.label));

    const absent = channels.filter((label) => !available.has(label));

    if (absent.length > 0) {
      return { ready: false, requirement, missing: `Missing ${absent.join(", ")}` };
    }

    return { ready: true, requirement, missing: null };
  }

  if (manifest.capabilities.brainMetrics?.required) {
    const requirement = "Needs attention and meditation metrics";

    if (!connected || !snapshot.activeDeviceId) {
      return { ready: false, requirement, missing: "No device connected" };
    }

    const adapter = deviceRegistry.get(snapshot.activeDeviceId);

    if (!adapter || !isBrainMetricsDeviceAdapter(adapter)) {
      return {
        ready: false,
        requirement,
        missing: `${snapshot.activeDeviceInfo?.name ?? "This device"} does not provide them`,
      };
    }

    return { ready: true, requirement, missing: null };
  }

  return { ready: true, requirement: "Runs without a device", missing: null };
}

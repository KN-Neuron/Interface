import { useCallback, useEffect, useState } from "react";

import { deviceManager } from "../../core/devices/deviceManager";

import { deviceRegistry } from "../../core/devices/deviceRegistry";

import { isEEGDeviceAdapter } from "../../core/devices/contracts/deviceGuards";

import { isBluetoothAddressDeviceAdapter } from "../../core/devices/contracts/BluetoothAddressDeviceAdapter";

import { notificationStore } from "../../lib/notificationStore";

import { logger } from "../../lib/logger";

import type { DeviceManagerSnapshot } from "../../core/devices/deviceManager";

import type { DeviceStatus } from "../../core/devices/models/device";

import type { EEGStreamInfo } from "../../core/devices/models/eeg";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const DISCONNECTED_STATUS: DeviceStatus = {
  state: "disconnected",
  message: "Device is disconnected.",
  updatedAt: 0,
};

/**
 * React adapter for the global KNeuron DeviceManager.
 *
 * UI components should use this hook instead of controlling hardware
 * adapters directly.
 */
export function useDevice() {
  const [snapshot, setSnapshot] = useState<DeviceManagerSnapshot>(() =>
    deviceManager.getSnapshot(),
  );

  const [streamInfoByDeviceId, setStreamInfoByDeviceId] = useState<
    Record<string, Readonly<EEGStreamInfo> | undefined>
  >({});

  useEffect(() => {
    return deviceManager.subscribe((nextSnapshot) => {
      setSnapshot(nextSnapshot);
    });
  }, []);

  /**
   * This key changes only when the set of registered devices changes.
   */
  const registryKey = snapshot.devices
    .map((device) => device.id)
    .sort()
    .join("|");

  const metadataRefreshKey = [
    registryKey,
    snapshot.activeDeviceId ?? "",
    snapshot.activeStatus?.state ?? "",
  ].join("|");

  /**
   * Load optional EEG metadata for registered EEG adapters.
   *
   * DeviceManager itself deliberately remains device-type agnostic.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadStreamInfo(): Promise<void> {
      const next: Record<string, Readonly<EEGStreamInfo>> = {};

      const adapters = deviceRegistry.getAll();

      for (const adapter of adapters) {
        if (!isEEGDeviceAdapter(adapter)) {
          continue;
        }

        try {
          next[adapter.info.id] = await adapter.getStreamInfo();
        } catch (error) {
          logger.warning(
            "DeviceUI",
            `Failed to read stream metadata for "${adapter.info.id}": ${getErrorMessage(error)}`,
          );
        }
      }

      if (!cancelled) {
        setStreamInfoByDeviceId(next);
      }
    }

    void loadStreamInfo();

    return () => {
      cancelled = true;
    };
  }, [metadataRefreshKey]);

  /**
   * Connects a device through DeviceManager.
   *
   * A blank Bluetooth address clears the adapter's saved address. Undefined
   * leaves the adapter untouched.
   */
  const connect = useCallback(
    async (deviceId: string, bluetoothAddress?: string): Promise<boolean> => {
      try {
        const device = deviceRegistry.get(deviceId);

        if (
          bluetoothAddress !== undefined &&
          device !== undefined &&
          isBluetoothAddressDeviceAdapter(device)
        ) {
          device.setBluetoothAddress(bluetoothAddress.trim() || null);
        }

        await deviceManager.connect(deviceId);

        notificationStore.add({
          type: "success",
          title: "Device connected",
          message: device?.info.name ?? deviceId,
        });

        return true;
      } catch (error) {
        const message = getErrorMessage(error);

        notificationStore.add({
          type: "error",
          title: "Device connection failed",
          message,
          durationMs: 6000,
        });

        return false;
      }
    },
    [],
  );

  /**
   * Disconnects the currently active device.
   */
  const disconnect = useCallback(async (): Promise<boolean> => {
    const current = deviceManager.getSnapshot().activeDeviceInfo;

    try {
      await deviceManager.disconnect();

      notificationStore.add({
        type: "info",
        title: "Device disconnected",
        message: current?.name ?? "Device disconnected.",
      });

      return true;
    } catch (error) {
      const message = getErrorMessage(error);

      notificationStore.add({
        type: "error",
        title: "Device disconnection failed",
        message,
        durationMs: 6000,
      });

      return false;
    }
  }, []);

  /**
   * DeviceManager currently allows only one active device.
   *
   * Non-active registered devices therefore have a disconnected state.
   */
  function getStatusForDevice(deviceId: string): Readonly<DeviceStatus> {
    if (snapshot.activeDeviceId === deviceId && snapshot.activeStatus) {
      return snapshot.activeStatus;
    }

    return DISCONNECTED_STATUS;
  }

  /**
   * Returns undefined when the device cannot be addressed by MAC address.
   */
  function getBluetoothAddressForDevice(deviceId: string): string | undefined {
    const device = deviceRegistry.get(deviceId);

    if (!device || !isBluetoothAddressDeviceAdapter(device)) {
      return undefined;
    }

    return device.getBluetoothAddress() ?? "";
  }

  return {
    snapshot,
    streamInfoByDeviceId,

    connect,
    disconnect,

    getStatusForDevice,
    getBluetoothAddressForDevice,
  };
}

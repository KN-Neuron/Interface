import type { DeviceAdapter } from "./DeviceAdapter";

/**
 * Optional capability implemented by devices that can be reached directly by
 * their Bluetooth MAC address.
 *
 * Null means no address is configured and the adapter uses its default
 * discovery behaviour.
 */
export interface BluetoothAddressDeviceAdapter extends DeviceAdapter {
  getBluetoothAddress(): string | null;

  /**
   * Throws when the address is not a valid Bluetooth MAC address.
   */
  setBluetoothAddress(address: string | null): void;
}

export function isBluetoothAddressDeviceAdapter(
  adapter: DeviceAdapter,
): adapter is BluetoothAddressDeviceAdapter {
  const candidate = adapter as Partial<BluetoothAddressDeviceAdapter>;

  return (
    typeof candidate.getBluetoothAddress === "function" &&
    typeof candidate.setBluetoothAddress === "function"
  );
}

/**
 * Returns the canonical AA:BB:CC:DD:EE:FF form, or null for an invalid address.
 */
export function normalizeBluetoothAddress(address: string): string | null {
  const normalized = address.trim().replaceAll("-", ":").toUpperCase();

  return /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/u.test(normalized) ? normalized : null;
}

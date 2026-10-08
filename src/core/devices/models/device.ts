/**
 * High-level category of a device connected to KNeuron.
 *
 * DeviceManager operates on the generic DeviceAdapter contract and therefore
 * must not depend on a particular manufacturer or hardware model.
 */
export type DeviceKind = "eeg" | "eye-tracker" | "emg" | "ecg" | "imu" | "other";

/**
 * Transport used by the adapter to communicate with the device.
 *
 * This describes the logical connection from KNeuron's perspective.
 * For example, a Python process exposing BrainAccess over local IPC may use
 * "network" or another dedicated transport later even if the physical headset
 * itself communicates through Bluetooth.
 */
export type DeviceTransport =
  "simulation" | "bluetooth" | "usb" | "serial" | "network" | "lsl" | "other";

/**
 * Connection lifecycle shared by all KNeuron devices.
 */
export type DeviceConnectionState =
  "disconnected" | "connecting" | "connected" | "disconnecting" | "error";

/**
 * Immutable descriptive information about a device adapter.
 *
 * `id` must uniquely identify this device inside the KNeuron Device Registry.
 *
 * Do not put runtime values such as connection state or battery percentage
 * here. Those belong to runtime status/capability layers.
 */
export interface DeviceInfo {
  /**
   * Stable identifier used by DeviceRegistry and DeviceManager.
   *
   * Example:
   * "simulation-eeg"
   * "brainaccess-maxi-009"
   */
  id: string;

  /**
   * Human-readable name displayed in the UI.
   */
  name: string;

  /**
   * High-level device category.
   */
  kind: DeviceKind;

  /**
   * Communication mechanism used by this adapter.
   */
  transport: DeviceTransport;

  /**
   * Optional hardware manufacturer.
   */
  manufacturer?: string;

  /**
   * Optional hardware model.
   */
  model?: string;

  /**
   * Optional picture of the device shown on the Device page and in the
   * device panel, e.g. "/devices/brainaccess-maxi.webp" (served from public/).
   * A placeholder is shown when it is missing or fails to load.
   */
  thumbnail?: string;
}

/**
 * Runtime connection state of a device.
 *
 * Adapters return snapshots of this structure. Consumers should never mutate
 * an adapter's internal state directly.
 */
export interface DeviceStatus {
  state: DeviceConnectionState;

  /**
   * Optional user-readable status detail.
   *
   * Example:
   * "Searching for device..."
   * "Connected."
   */
  message?: string;

  /**
   * Last runtime error associated with the current state.
   *
   * It should normally be defined only while state === "error".
   */
  error?: string;

  /**
   * Unix timestamp in milliseconds indicating when this snapshot was created
   * or last changed.
   */
  updatedAt: number;
}

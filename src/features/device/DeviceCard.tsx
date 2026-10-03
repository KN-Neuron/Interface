import type { DeviceInfo, DeviceStatus, DeviceTransport } from "../../core/devices/models/device";

import type { EEGStreamInfo } from "../../core/devices/models/eeg";

import { deviceRegistry } from "../../core/devices/deviceRegistry";

import { isEEGDeviceAdapter } from "../../core/devices/contracts/deviceGuards";

import { isBrainMetricsDeviceAdapter } from "../../core/devices/contracts/BrainMetricsDeviceAdapter";

interface DeviceCardProps {
  device: Readonly<DeviceInfo>;

  status: Readonly<DeviceStatus>;

  streamInfo?: Readonly<EEGStreamInfo>;

  active: boolean;

  busy: boolean;

  onConnect: () => void;

  onDisconnect: () => void;
}

const TRANSPORT_LABEL: Record<DeviceTransport, string> = {
  simulation: "Simulated",
  bluetooth: "Bluetooth",
  usb: "USB",
  serial: "Serial",
  network: "Network",
  lsl: "LSL",
  other: "Other",
};

function describeSignal(
  deviceId: string,
  streamInfo: Readonly<EEGStreamInfo> | undefined,
): string | null {
  const adapter = deviceRegistry.get(deviceId);

  if (adapter && isEEGDeviceAdapter(adapter)) {
    return streamInfo
      ? `Raw EEG, ${streamInfo.channels.length} channels at ${streamInfo.sampleRateHz} Hz`
      : "Raw EEG";
  }

  if (adapter && isBrainMetricsDeviceAdapter(adapter)) {
    return "Attention and meditation metrics";
  }

  return null;
}

export function DeviceCard({
  device,
  status,
  streamInfo,
  active,
  busy,
  onConnect,
  onDisconnect,
}: DeviceCardProps) {
  const connected = active && status.state === "connected";

  const connecting = active && status.state === "connecting";

  const disconnecting = active && status.state === "disconnecting";

  const buttonDisabled = busy || connecting || disconnecting;

  const state = active ? status.state : "disconnected";

  const signal = describeSignal(device.id, streamInfo);

  return (
    <li className={active ? "device-row is-active" : "device-row"}>
      <span className={`led led--${state}`} role="img" aria-label={state} />

      <div className="device-row__body">
        <h2>{device.name}</h2>

        <p className="device-row__identity">
          {[device.manufacturer, device.model, TRANSPORT_LABEL[device.transport]]
            .filter(Boolean)
            .join(", ")}
        </p>

        {signal && <p className="device-row__signal">{signal}</p>}

        {active && status.message && <p className="device-row__message">{status.message}</p>}

        {active && status.error && <p className="device-row__error">{status.error}</p>}
      </div>

      {connected ? (
        <button
          type="button"
          className="secondary-button"
          disabled={buttonDisabled}
          onClick={onDisconnect}
        >
          Disconnect
        </button>
      ) : (
        <button
          type="button"
          className="primary-button"
          disabled={buttonDisabled}
          onClick={onConnect}
        >
          {connecting ? "Connecting…" : "Connect"}
        </button>
      )}
    </li>
  );
}

import type { DeviceInfo, DeviceStatus } from "../../core/devices/models/device";

import { ModuleThumbnail } from "../../components/ModuleThumbnail";

interface DeviceCardProps {
  device: Readonly<DeviceInfo>;
  status: Readonly<DeviceStatus>;
  active: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

function formatTransport(transport: string): string {
  return transport.replace("-", " ").toUpperCase();
}

export function DeviceCard({
  device,
  status,
  active,
  busy,
  onConnect,
  onDisconnect,
}: DeviceCardProps) {
  const connected = active && status.state === "connected";
  const connecting = active && status.state === "connecting";
  const disconnecting = active && status.state === "disconnecting";

  const buttonDisabled = busy || connecting || disconnecting;

  return (
    <article className={active ? "device-card device-card--active" : "device-card"}>
      {device.thumbnail ? (
        <ModuleThumbnail
          src={device.thumbnail}
          name={device.name}
          className="device-card__thumbnail"
        />
      ) : null}

      <header className="device-card__header">
        <div>
          <h2>{device.name}</h2>
        </div>

        <span className={`device-status device-status--${status.state}`}>{status.state}</span>
      </header>

      <div className="device-card__identity">
        <span>{device.manufacturer ?? "Unknown manufacturer"}</span>

        {device.model && (
          <>
            <span>·</span>
            <span>{device.model}</span>
          </>
        )}
      </div>

      <div className="device-card__metadata">
        <div>
          <span>Transport</span>
          <strong>{formatTransport(device.transport)}</strong>
        </div>
      </div>

      {active && status.message && <p className="device-card__message">{status.message}</p>}
      {active && status.error && <p className="device-card__error">{status.error}</p>}

      <footer className="device-card__actions">
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
            {connecting ? "Connecting..." : "Connect"}
          </button>
        )}
      </footer>
    </article>
  );
}

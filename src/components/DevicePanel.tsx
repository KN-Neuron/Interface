import { MonitorOff } from "lucide-react";

import { useDevice } from "../features/device/useDevice";

import { ModuleThumbnail } from "./ModuleThumbnail";

/**
 * Right-hand panel with the active device.
 */
export function DevicePanel() {
  const { snapshot, streamInfoByDeviceId } = useDevice();

  const activeDevice = snapshot.activeDeviceInfo;

  const activeStatus = snapshot.activeStatus;

  const state = activeStatus?.state ?? "disconnected";

  const streamInfo = snapshot.activeDeviceId
    ? streamInfoByDeviceId[snapshot.activeDeviceId]
    : undefined;

  return (
    <aside className="device-panel" aria-label="Device">
      <header className="device-panel__header">
        <span className="eyebrow">Device</span>
        <h2>Device</h2>
      </header>

      {!activeDevice ? (
        <div className="device-panel__empty">
          <MonitorOff size={64} strokeWidth={1.25} />

          <strong>No device connected</strong>

          <span>Select a device from the Device page.</span>
        </div>
      ) : (
        <div className="device-panel__active">
          <ModuleThumbnail
            src={activeDevice.thumbnail}
            name={activeDevice.name}
            className="device-panel__thumbnail"
          />

          <strong className="device-panel__name">{activeDevice.name}</strong>

          <span className="device-panel__state">
            <span className={`device-panel__dot device-panel__dot--${state}`} />
            {state}
          </span>

          <dl className="device-panel__details">
            <div>
              <dt>Type</dt>
              <dd>{activeDevice.kind}</dd>
            </div>

            {streamInfo && (
              <>
                <div>
                  <dt>Rate</dt>
                  <dd>{streamInfo.sampleRateHz} Hz</dd>
                </div>

                <div>
                  <dt>Channels</dt>
                  <dd>{streamInfo.channels.length}</dd>
                </div>
              </>
            )}
          </dl>
        </div>
      )}
    </aside>
  );
}

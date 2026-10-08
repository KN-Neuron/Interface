import { DeviceCard } from "./DeviceCard";

import { useDevice } from "./useDevice";

/**
 * Device management screen for the KNeuron Shell.
 *
 * This page knows nothing about individual manufacturers.
 * Every registered adapter is rendered through the same interface.
 */
export function DevicePage() {
  const { snapshot, streamInfoByDeviceId, connect, disconnect, getStatusForDevice } = useDevice();

  return (
    <section className="device-page">
      <header className="device-page__header">
        <h1>Device</h1>

        <p>Manage devices available to KNeuron.</p>
      </header>

      <section className="device-section">
        <div className="device-section__heading">
          <div>
            <h2>Available devices</h2>

            <p>
              {snapshot.devices.length} registered adapter
              {snapshot.devices.length === 1 ? "" : "s"}
            </p>
          </div>

          {snapshot.activeDeviceInfo && (
            <span className="device-active-indicator">
              Active · {snapshot.activeDeviceInfo.name}
            </span>
          )}
        </div>

        {snapshot.devices.length === 0 ? (
          <div className="device-empty-state">
            <strong>No devices available</strong>

            <span>Install or register a KNeuron device adapter.</span>
          </div>
        ) : (
          <div className="device-grid">
            {snapshot.devices.map((device) => {
              const active = snapshot.activeDeviceId === device.id;

              return (
                <DeviceCard
                  key={device.id}
                  device={device}
                  active={active}
                  busy={snapshot.busy}
                  status={getStatusForDevice(device.id)}
                  streamInfo={streamInfoByDeviceId[device.id]}
                  onConnect={() => {
                    void connect(device.id);
                  }}
                  onDisconnect={() => {
                    void disconnect();
                  }}
                />
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}

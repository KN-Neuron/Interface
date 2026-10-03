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
    <section className="page">
      <header className="page__header">
        <h1>Devices</h1>
        <p>One device can be connected at a time. Connecting another one disconnects the first.</p>
      </header>

      {snapshot.devices.length === 0 ? (
        <div className="empty-state">
          <strong>No devices registered</strong>
          <p>Add an adapter in registerBuiltInDevices.ts and it will appear here.</p>
        </div>
      ) : (
        <ul className="device-list">
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
        </ul>
      )}
    </section>
  );
}

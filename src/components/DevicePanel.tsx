import { useState } from "react";

import { useDevice } from "../features/device/useDevice";
import { deviceRegistry } from "../core/devices/deviceRegistry";
import { isEEGDeviceAdapter } from "../core/devices/contracts/deviceGuards";
import { isBrainMetricsDeviceAdapter } from "../core/devices/contracts/BrainMetricsDeviceAdapter";
import type { BrainMetricsSnapshot } from "../core/brainMetrics";
import type { DeviceConnectionState } from "../core/devices/models/device";

import { SignalScope, type ScopeSource } from "./SignalScope";

const STATE_LABEL: Record<DeviceConnectionState, string> = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  disconnecting: "Disconnecting",
  error: "Error",
};

function formatMetric(value: number | null | undefined): string {
  return value === null || value === undefined ? "–" : String(value);
}

/**
 * Right-hand readout: live view of whatever the active device produces.
 */
export function DevicePanel({
  paused,
  onOpenDevices,
}: {
  paused: boolean;
  onOpenDevices: () => void;
}) {
  const { snapshot, streamInfoByDeviceId } = useDevice();

  const [metrics, setMetrics] = useState<Readonly<BrainMetricsSnapshot> | null>(null);

  const activeDevice = snapshot.activeDeviceInfo;
  const state = snapshot.activeStatus?.state ?? "disconnected";
  const connected = activeDevice !== null && state === "connected";

  const streamInfo = snapshot.activeDeviceId
    ? streamInfoByDeviceId[snapshot.activeDeviceId]
    : undefined;

  const adapter = snapshot.activeDeviceId ? deviceRegistry.get(snapshot.activeDeviceId) : undefined;

  let source: ScopeSource = "none";

  if (connected && adapter) {
    if (isEEGDeviceAdapter(adapter)) {
      source = "eeg";
    } else if (isBrainMetricsDeviceAdapter(adapter)) {
      source = "metrics";
    }
  }

  const sessionKey = `${snapshot.activeDeviceId ?? "none"}:${state}`;

  return (
    <aside className="readout" aria-label="Device readout">
      <header className="readout__header">
        <span className={`led led--${state}`} aria-hidden="true" />
        <div>
          <h2>{activeDevice ? activeDevice.name : "No device"}</h2>
          <p>{activeDevice ? STATE_LABEL[state] : "Nothing is connected"}</p>
        </div>
      </header>

      <div className="readout__screen">
        <SignalScope
          source={source}
          sessionKey={sessionKey}
          paused={paused}
          onMetrics={setMetrics}
        />
        <p className="readout__caption">
          {source === "eeg" && "Last 4 seconds, each channel scaled to fit"}
          {source === "metrics" && "Attention (bright) and meditation, last 60 seconds"}
          {source === "none" &&
            (connected ? "This device has no live signal to show" : "No signal")}
        </p>
      </div>

      {source === "eeg" && streamInfo && (
        <dl className="readout__figures">
          <div>
            <dt>Sample rate</dt>
            <dd>
              {streamInfo.sampleRateHz}
              <small>Hz</small>
            </dd>
          </div>
          <div>
            <dt>Channels</dt>
            <dd>{streamInfo.channels.length}</dd>
          </div>
        </dl>
      )}

      {source === "metrics" && (
        <dl className="readout__figures">
          <div>
            <dt>Attention</dt>
            <dd>{formatMetric(metrics?.attention)}</dd>
          </div>
          <div>
            <dt>Meditation</dt>
            <dd>{formatMetric(metrics?.meditation)}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>
              {formatMetric(metrics?.signalQualityPercent)}
              <small>%</small>
            </dd>
          </div>
        </dl>
      )}

      {snapshot.activeStatus?.error && (
        <p className="readout__error">{snapshot.activeStatus.error}</p>
      )}

      {!activeDevice && (
        <button type="button" className="secondary-button readout__action" onClick={onOpenDevices}>
          Choose a device
        </button>
      )}
    </aside>
  );
}

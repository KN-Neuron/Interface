import { useState } from "react";

import { useDevice } from "../features/device/useDevice";
import { deviceRegistry } from "../core/devices/deviceRegistry";
import { isEEGDeviceAdapter } from "../core/devices/contracts/deviceGuards";
import { isBrainMetricsDeviceAdapter } from "../core/devices/contracts/BrainMetricsDeviceAdapter";
import type { BrainMetricsSnapshot } from "../core/brainMetrics";
import type { DeviceConnectionState } from "../core/devices/models/device";

import { SignalScope, type ScopeSource, type ScopeStats } from "./SignalScope";

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
 * Seconds without new data before the link is reported as delayed / lost.
 * BrainLink-style metrics arrive about once a second, raw EEG every ~40 ms.
 */
const DATA_AGE_LIMITS: Record<"eeg" | "metrics", { delayed: number; lost: number }> = {
  eeg: { delayed: 0.5, lost: 2 },
  metrics: { delayed: 3, lost: 6 },
};

type LinkHealth = "waiting" | "ok" | "delayed" | "lost";

function getLinkHealth(source: "eeg" | "metrics", age: number | null): LinkHealth {
  if (age === null) {
    return "waiting";
  }

  const limits = DATA_AGE_LIMITS[source];

  if (age >= limits.lost) {
    return "lost";
  }

  return age >= limits.delayed ? "delayed" : "ok";
}

const LINK_LED: Record<LinkHealth, string> = {
  waiting: "led led--connecting",
  ok: "led led--on",
  delayed: "led led--connecting",
  lost: "led led--error",
};

const LINK_LABEL: Record<LinkHealth, string> = {
  waiting: "Waiting for data",
  ok: "Receiving",
  delayed: "Data delayed",
  lost: "No data",
};

function formatAge(age: number | null): string {
  if (age === null) {
    return "–";
  }

  return age < 10 ? `${age.toFixed(2)} s` : `${Math.round(age)} s`;
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

  const [stats, setStats] = useState<ScopeStats | null>(null);

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
          onStats={setStats}
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

      {source !== "none" && (
        <LinkHealthPanel
          source={source}
          stats={stats}
          batteryPercent={snapshot.activeStatus?.batteryPercent}
        />
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

function LinkHealthPanel({
  source,
  stats,
  batteryPercent,
}: {
  source: "eeg" | "metrics";
  stats: ScopeStats | null;
  batteryPercent: number | null | undefined;
}) {
  const age = stats?.dataAgeSeconds ?? null;
  const health = getLinkHealth(source, age);

  return (
    <dl className="readout__health">
      <div className="readout__health-row">
        <dt>
          <span className={LINK_LED[health]} aria-hidden="true" />
          {LINK_LABEL[health]}
        </dt>
        <dd>last data {formatAge(age)} ago</dd>
      </div>

      {source === "eeg" && (
        <div className="readout__health-row">
          <dt>Dropped samples</dt>
          <dd className={stats && stats.droppedSamples > 0 ? "is-warning" : undefined}>
            {stats?.droppedSamples ?? 0}
          </dd>
        </div>
      )}

      {batteryPercent !== undefined && batteryPercent !== null && (
        <div className="readout__health-row">
          <dt>Battery at connect</dt>
          <dd className={batteryPercent <= 20 ? "is-warning" : undefined}>{batteryPercent}%</dd>
        </div>
      )}
    </dl>
  );
}

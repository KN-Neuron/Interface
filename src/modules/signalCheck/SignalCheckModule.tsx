import { useEffect, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import { deviceManager } from "../../core/devices/deviceManager";

import type { ChannelCheckStatus, CheckRegion } from "../../core/neurostate";

import { SpectrumView } from "./components/SpectrumView";

import { TraceView } from "./components/TraceView";

import { SHOWN_SECONDS, useSignalCheck } from "./hooks/useSignalCheck";

import {
  describeProblems,
  describeStream,
  regionTone,
  STATUS_COLORS,
  STATUS_LABELS,
} from "./summary";

import "./styles/signalCheck.css";

const REGIONS: readonly CheckRegion[] = ["frontal", "parietal", "occipital"];

/**
 * Microvolts between neighbouring channels; 100 µV is neurostate's default.
 */
const SPACINGS_UV = [50, 100, 200] as const;

function useDeviceName(): string | null {
  const [name, setName] = useState(() => deviceManager.getSnapshot().activeDeviceInfo?.name);

  useEffect(() => {
    return deviceManager.subscribe((snapshot) => {
      setName(snapshot.activeDeviceInfo?.name);
    });
  }, []);

  return name ?? null;
}

/**
 * Live view of the connected cap for fitting it: neurostate's `check` inside
 * KNeuron. It shows the filtered signals coloured by channel status, the good
 * channels in each region, gaps in the stream, and the spectrum over the back
 * of the head.
 */
export function SignalCheckModule({ onRequestClose }: KNeuronModuleProps) {
  const check = useSignalCheck();
  const deviceName = useDeviceName();
  const [spacingUv, setSpacingUv] = useState<number>(100);

  const { info, status } = check;
  const statuses: Record<string, ChannelCheckStatus> = {};

  for (const channel of status?.channels ?? []) {
    statuses[channel.label] = channel.status;
  }

  const problems = status && status.channels.length > 0 ? describeProblems(status.channels) : null;

  return (
    <section className="signal-check">
      <header className="signal-check__bar">
        <div className="signal-check__title">
          <small>SIGNAL CHECK</small>
          <strong>{info?.stream ?? deviceName ?? "No cap connected"}</strong>
        </div>

        <div className="signal-check__bar-actions">
          <div className="signal-check__scale" role="group" aria-label="Signal scale">
            {SPACINGS_UV.map((spacing) => (
              <button
                key={spacing}
                type="button"
                className={spacing === spacingUv ? "is-active" : undefined}
                aria-pressed={spacing === spacingUv}
                onClick={() => setSpacingUv(spacing)}
              >
                {spacing} µV
              </button>
            ))}
          </div>

          <button type="button" className="signal-check__exit" onClick={onRequestClose}>
            EXIT MODULE
          </button>
        </div>
      </header>

      {info ? (
        <div className="signal-check__body">
          <div className="signal-check__main">
            <p className="signal-check__stream">
              {describeStream(info, status).map((fact) => (
                <span key={fact.text} className={fact.bad ? "is-bad" : undefined}>
                  {fact.text}
                </span>
              ))}
            </p>

            <TraceView
              signals={check.signals}
              labels={info.labels}
              statuses={statuses}
              shownSeconds={SHOWN_SECONDS}
              spacingUv={spacingUv}
            />
          </div>

          <aside className="signal-check__side">
            <section className="signal-check__panel" aria-labelledby="signal-check-regions">
              <h2 id="signal-check-regions">Regions</h2>

              {status && status.channels.length > 0 ? (
                <>
                  <ul className="signal-check__regions">
                    {REGIONS.map((region) => {
                      const counts = status.regions[region] ?? { good: 0, total: 0 };

                      return (
                        <li key={region} className={`is-${regionTone(counts.good, counts.total)}`}>
                          <span>{region}</span>
                          <strong>
                            {counts.good}/{counts.total} good
                          </strong>
                        </li>
                      );
                    })}
                  </ul>

                  <p className={`signal-check__verdict${problems ? " is-bad" : " is-good"}`}>
                    {problems ? `Problems: ${problems}` : "All channels look fine"}
                  </p>
                </>
              ) : (
                <p className="signal-check__muted">Checking channels...</p>
              )}
            </section>

            <section className="signal-check__panel" aria-labelledby="signal-check-channels">
              <h2 id="signal-check-channels">Channels</h2>

              <ul className="signal-check__channels">
                {(status?.channels ?? []).map((channel) => (
                  <li key={channel.label}>
                    <span
                      className="signal-check__dot"
                      style={{ background: STATUS_COLORS[channel.status] }}
                    />
                    <strong>{channel.label}</strong>
                    <span style={{ color: STATUS_COLORS[channel.status] }}>
                      {STATUS_LABELS[channel.status]}
                    </span>
                    <span className="signal-check__rms">
                      {channel.rmsUv == null ? "--" : `${channel.rmsUv.toFixed(1)} µV`}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="signal-check__muted">
                Flat below {info.thresholds.flatUv} µV, noisy above {info.thresholds.noisyUv} µV
                (1-40 Hz RMS); mains when hum exceeds {info.thresholds.mainsRatio}× the EEG power.
              </p>
            </section>

            <section className="signal-check__panel" aria-labelledby="signal-check-spectrum">
              <h2 id="signal-check-spectrum">Spectrum · {info.spectrumChannels.join(", ")}</h2>

              <SpectrumView spectrum={status?.spectrum ?? null} alphaHz={info.alphaHz} />

              <p className="signal-check__muted">
                Shaded: alpha ({info.alphaHz[0]}-{info.alphaHz[1]} Hz). It should rise clearly when
                you close your eyes.
              </p>
            </section>
          </aside>
        </div>
      ) : (
        <div className="signal-check__empty">
          <span className={check.state.state === "error" ? "is-error" : undefined}>
            {check.state.state === "error"
              ? "SIGNAL CHECK FAILED"
              : check.state.state === "unavailable"
                ? "NO CAP"
                : "STARTING"}
          </span>
          <p>{check.state.message ?? "Starting the signal check..."}</p>
          {check.state.state === "error" ? (
            <button type="button" onClick={check.retry}>
              RETRY
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

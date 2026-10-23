import { useEffect, useMemo, useRef, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import { CortexViewport } from "./components/CortexViewport";
import { useCortexEEG } from "./hooks/useCortexEEG";
import { DEFAULT_CORTEX_PALETTE, loadCortexPalette, saveCortexPalette } from "./models/palette";
import { CortexRenderer } from "./rendering/CortexRenderer";
import { cloneDefaultCortexElectrodes } from "./models/defaultElectrodeLayout";
import type {
  CortexBand,
  CortexElectrode,
  CortexPosition,
  CortexVisualMode,
} from "./models/cortex";

import "./styles/cortex.css";

const STORAGE_KEY = "kneuron.cortex.electrodes.v1";

function isPosition(value: unknown): value is CortexPosition {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function loadSavedElectrodes(): CortexElectrode[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return cloneDefaultCortexElectrodes();
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return cloneDefaultCortexElectrodes();
    }

    const valid = parsed.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "label" in entry &&
        typeof entry.label === "string" &&
        "position" in entry &&
        isPosition(entry.position),
    );

    if (!valid) {
      return cloneDefaultCortexElectrodes();
    }

    return parsed.map((entry) => {
      const electrode = entry as CortexElectrode;
      return {
        label: electrode.label,
        position: [...electrode.position] as CortexPosition,
      };
    });
  } catch {
    return cloneDefaultCortexElectrodes();
  }
}

function formatEEGState(state: string): string {
  return state.toUpperCase();
}

export function CortexModule(_props: KNeuronModuleProps) {
  const eeg = useCortexEEG();
  const rendererRef = useRef<CortexRenderer | null>(null);

  const [palette, setPalette] = useState(loadCortexPalette);
  const [signalRange, setSignalRange] = useState(50);
  useEffect(() => saveCortexPalette(palette), [palette]);

  const [visualMode, setVisualMode] = useState<CortexVisualMode>("fast");
  const [selectedBand, setSelectedBand] = useState<CortexBand>("alpha");
  const [hotspotRadius, setHotspotRadius] = useState(0.38);
  const [deformation, setDeformation] = useState(0.2);
  const [editMode, setEditMode] = useState(false);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [electrodes, setElectrodes] = useState<CortexElectrode[]>(loadSavedElectrodes);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [saveState, setSaveState] = useState<string | null>(null);

  const amplitudes =
    visualMode === "fast" ? eeg.fastActivityByLabel : eeg.bandActivityByLabel[selectedBand];
  const activityByLabel = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(amplitudes).map(([label, amplitude]) => [
          label,
          Math.max(0, Math.min(1, amplitude / signalRange)),
        ]),
      ),
    [amplitudes, signalRange],
  );
  const processingStatus = eeg.started ? "LIVE" : "IDLE";

  const selectedElectrode = useMemo(
    () => (selectedIndex >= 0 ? (electrodes[selectedIndex] ?? null) : null),
    [electrodes, selectedIndex],
  );

  const averageSignalQuality = useMemo(() => {
    const values = Object.values(eeg.signalQualityByLabel);

    if (values.length === 0) {
      return null;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }, [eeg.signalQualityByLabel]);

  const strongestChannels = useMemo(
    () =>
      Object.entries(activityByLabel)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5),
    [activityByLabel],
  );

  function persistLayout(): void {
    const current = rendererRef.current?.getElectrodes() ?? electrodes;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    setElectrodes(current);
    setSaveState(`Saved ${current.length} electrode positions locally.`);
  }

  function resetLayout(): void {
    const defaults = cloneDefaultCortexElectrodes();
    localStorage.removeItem(STORAGE_KEY);
    rendererRef.current?.setElectrodes(defaults);
    setElectrodes(defaults);
    setSelectedIndex(-1);
    setSaveState("Default anatomical layout restored.");
  }

  function updateSelectedCoordinate(axis: 0 | 1 | 2, value: string): void {
    if (!selectedElectrode || selectedIndex < 0) {
      return;
    }

    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return;
    }

    const position = [...selectedElectrode.position] as CortexPosition;
    position[axis] = numeric;

    const updated: CortexElectrode = {
      ...selectedElectrode,
      position,
    };

    rendererRef.current?.updateElectrode(selectedIndex, updated);
  }

  function updateSelectedLabel(value: string): void {
    if (!selectedElectrode || selectedIndex < 0) {
      return;
    }

    const label = value.trim();

    if (!label) {
      return;
    }

    rendererRef.current?.updateElectrode(selectedIndex, {
      ...selectedElectrode,
      label,
    });
  }

  return (
    <section className="cortex-module">
      <div className="cortex-stage">
        <CortexViewport
          initialElectrodes={electrodes}
          activityByLabel={activityByLabel}
          palette={palette}
          hotspotRadius={hotspotRadius}
          deformation={deformation}
          editMode={editMode}
          labelsVisible={labelsVisible}
          onRendererReady={(renderer) => {
            rendererRef.current = renderer;
          }}
          onLayoutChange={(nextElectrodes) => {
            setElectrodes(
              nextElectrodes.map((electrode) => ({
                label: electrode.label,
                position: [...electrode.position] as CortexPosition,
              })),
            );
          }}
          onSelectionChange={setSelectedIndex}
        />

        <div className="cortex-overlay cortex-overlay--status">
          <span className={`cortex-status-dot cortex-status-dot--${eeg.state}`} />
          <strong>{formatEEGState(eeg.state)}</strong>
          <span>
            {eeg.sampleRateHz ? `${eeg.sampleRateHz} Hz` : "—"} · {eeg.channelCount} ch
          </span>
          {eeg.lastSequence !== null && <span>sample {eeg.lastSequence}</span>}
          {eeg.started && <span>{processingStatus}</span>}
        </div>
      </div>

      <aside className="cortex-controls">
        <div className="cortex-controls__title">
          <h2>EEG Cortex</h2>
          <p>Live EEG amplitude · color and shape respond immediately.</p>
        </div>

        <section className="cortex-control-section">
          <div className="cortex-control-section__heading">EEG stream</div>

          <div className="cortex-kv">
            <span>Status</span>
            <strong>{formatEEGState(eeg.state)}</strong>
          </div>
          <div className="cortex-kv">
            <span>Rate</span>
            <strong>{eeg.sampleRateHz ? `${eeg.sampleRateHz} Hz` : "—"}</strong>
          </div>
          <div className="cortex-kv">
            <span>Channels</span>
            <strong>{eeg.channelCount || "—"}</strong>
          </div>
          <div className="cortex-kv">
            <span>Received</span>
            <strong>{eeg.receivedSamples}</strong>
          </div>
          <div className="cortex-kv">
            <span>Dropped</span>
            <strong>{eeg.droppedSamples}</strong>
          </div>

          {eeg.error && (
            <div className="cortex-error">
              <span>{eeg.error}</span>
              <button type="button" onClick={eeg.retry}>
                Retry EEG
              </button>
            </div>
          )}
        </section>

        <section className="cortex-control-section">
          <div className="cortex-control-section__heading">Processing</div>

          <div className="cortex-kv">
            <span>Status</span>
            <strong>{processingStatus}</strong>
          </div>

          <label className="cortex-field">
            <span>Visual mode</span>
            <select
              value={visualMode}
              onChange={(event) => setVisualMode(event.target.value as CortexVisualMode)}
            >
              <option value="fast">FAST · 200 ms RMS</option>
              <option value="bands">BAND AMPLITUDE · RMS</option>
            </select>
          </label>

          {visualMode === "bands" && (
            <label className="cortex-field">
              <span>Band</span>
              <select
                value={selectedBand}
                onChange={(event) => setSelectedBand(event.target.value as CortexBand)}
              >
                <option value="alpha">ALPHA · 8–13 Hz</option>
                <option value="beta">BETA · 13–30 Hz</option>
                <option value="theta">THETA · 4–8 Hz</option>
                <option value="delta">DELTA · 1–4 Hz</option>
                <option value="gamma">GAMMA · 30–45 Hz</option>
              </select>
            </label>
          )}

          {!eeg.started ? (
            <button
              type="button"
              className="cortex-button cortex-button--primary"
              disabled={eeg.state !== "streaming"}
              onClick={eeg.startExperience}
            >
              Start experience
            </button>
          ) : (
            <button type="button" className="cortex-button" onClick={eeg.stopExperience}>
              Stop
            </button>
          )}

          <label className="cortex-field">
            <span>Sensitivity · full scale {signalRange} signal units RMS</span>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              value={signalRange}
              onChange={(event) => setSignalRange(Number(event.target.value))}
            />
          </label>
          <p className="cortex-processing-note">
            Lower full scale makes the visualization more sensitive. The scale stays fixed until you
            change it.
          </p>
          <div className="cortex-kv">
            <span>Sample validity</span>
            <strong>
              {averageSignalQuality === null ? "—" : `${Math.round(averageSignalQuality * 100)}%`}
            </strong>
          </div>

          {eeg.flatChannels.length > 0 && (
            <p className="cortex-warning">Flat channels: {eeg.flatChannels.join(", ")}</p>
          )}

          <p className="cortex-processing-note">
            1–45 Hz filtering · 50 Hz notch when supported · no baseline calibration or waiting.
            Bands use up to 2 seconds of recent samples and respond as data arrives. Sample validity
            checks finite values only; movement and poor contact can still affect the display.
          </p>

          {eeg.started && strongestChannels.length > 0 && (
            <div className="cortex-activity-list">
              <span className="cortex-activity-list__title">Strongest amplitude</span>
              {strongestChannels.map(([label, value]) => (
                <div className="cortex-activity-row" key={label}>
                  <span>{label}</span>
                  <div className="cortex-activity-track">
                    <div
                      className="cortex-activity-fill"
                      style={{ width: `${Math.round(value * 100)}%` }}
                    />
                  </div>
                  <strong>{Math.round(value * 100)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="cortex-control-section">
          <div className="cortex-control-section__heading">Rendering</div>

          {(["medium", "strong"] as const).map((level) => (
            <div className="cortex-color-field" key={level}>
              <label className="cortex-field">
                <span>{level === "medium" ? "Medium signal color" : "Strong signal color"}</span>
                <input
                  type="color"
                  value={palette[level]}
                  onChange={(event) =>
                    setPalette((current) => ({ ...current, [level]: event.target.value }))
                  }
                />
              </label>
              <label className="cortex-field">
                <span>{level === "medium" ? "Medium HEX" : "Strong HEX"}</span>
                <input
                  type="text"
                  key={palette[level]}
                  defaultValue={palette[level]}
                  maxLength={7}
                  pattern="#[0-9a-fA-F]{6}"
                  onBlur={(event) => {
                    const color = event.target.value;
                    if (/^#[0-9a-f]{6}$/i.test(color))
                      setPalette((current) => ({ ...current, [level]: color }));
                    else event.target.value = palette[level];
                  }}
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            className="cortex-button"
            onClick={() => setPalette({ ...DEFAULT_CORTEX_PALETTE })}
          >
            Reset colors
          </button>

          <label className="cortex-field">
            <span>Hotspot radius · {hotspotRadius.toFixed(2)}</span>
            <input
              type="range"
              min="0.2"
              max="0.7"
              step="0.01"
              value={hotspotRadius}
              onChange={(event) => setHotspotRadius(Number(event.target.value))}
            />
          </label>

          <label className="cortex-field">
            <span>Deformation · {deformation.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="0.35"
              step="0.01"
              value={deformation}
              onChange={(event) => setDeformation(Number(event.target.value))}
            />
          </label>

          <button
            type="button"
            className="cortex-button"
            onClick={() => rendererRef.current?.refitCamera()}
          >
            Re-fit camera
          </button>
        </section>

        <section className="cortex-control-section">
          <div className="cortex-control-section__heading">Electrodes</div>

          <button
            type="button"
            className={editMode ? "cortex-button cortex-button--active" : "cortex-button"}
            onClick={() => setEditMode((current) => !current)}
          >
            {editMode ? "Exit edit mode" : "Enter edit mode"}
          </button>

          {editMode && (
            <div className="cortex-editor">
              <label className="cortex-check">
                <input
                  type="checkbox"
                  checked={labelsVisible}
                  onChange={(event) => setLabelsVisible(event.target.checked)}
                />
                <span>Show labels</span>
              </label>

              <label className="cortex-field">
                <span>Selected</span>
                <select
                  value={selectedIndex >= 0 ? String(selectedIndex) : ""}
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    setSelectedIndex(index);
                    rendererRef.current?.selectElectrode(index);
                  }}
                >
                  <option value="" disabled>
                    Select electrode
                  </option>
                  {electrodes.map((electrode, index) => (
                    <option key={`${electrode.label}-${index}`} value={index}>
                      {electrode.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedElectrode && (
                <div className="cortex-coordinate-grid">
                  <label>
                    <span>Name</span>
                    <input
                      defaultValue={selectedElectrode.label}
                      key={`label-${selectedIndex}-${selectedElectrode.label}`}
                      onBlur={(event) => updateSelectedLabel(event.target.value)}
                    />
                  </label>

                  {([0, 1, 2] as const).map((axis) => (
                    <label key={axis}>
                      <span>{["X", "Y", "Z"][axis]}</span>
                      <input
                        type="number"
                        step="0.01"
                        value={selectedElectrode.position[axis]}
                        onChange={(event) => updateSelectedCoordinate(axis, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="cortex-button-row">
                <button
                  type="button"
                  className="cortex-button"
                  onClick={() => rendererRef.current?.addElectrode()}
                >
                  + Add
                </button>
                <button
                  type="button"
                  className="cortex-button"
                  disabled={selectedIndex < 0}
                  onClick={() => rendererRef.current?.deleteSelectedElectrode()}
                >
                  Delete
                </button>
              </div>

              <div className="cortex-button-row">
                <button
                  type="button"
                  className="cortex-button cortex-button--save"
                  onClick={persistLayout}
                >
                  Save layout
                </button>
                <button type="button" className="cortex-button" onClick={resetLayout}>
                  Reset
                </button>
              </div>

              {saveState && <p className="cortex-save-state">{saveState}</p>}
            </div>
          )}
        </section>

        <div className="cortex-note">
          Electrode positions are visualization coordinates only. Hardware channel mapping remains
          the responsibility of the active EEG adapter.
        </div>
      </aside>
    </section>
  );
}

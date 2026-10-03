import { useMemo, useRef, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import { CortexViewport } from "./components/CortexViewport";
import {
  CORTEX_BAND_BASELINE_SECONDS,
  CORTEX_BAND_WINDOW_SECONDS,
  CORTEX_FAST_BASELINE_SECONDS,
  CORTEX_WARMUP_SECONDS,
} from "./eeg/CortexSignalProcessor";
import { useCortexEEG } from "./hooks/useCortexEEG";
import { CortexRenderer, type CortexView } from "./rendering/CortexRenderer";
import { PanelResizer } from "../../components/PanelResizer";
import { usePanelSize } from "../../lib/usePanelSize";
import { cloneDefaultCortexElectrodes } from "./models/defaultElectrodeLayout";
import type {
  CortexBand,
  CortexElectrode,
  CortexPosition,
  CortexQuality,
  CortexVisualMode,
} from "./models/cortex";

import "./styles/cortex.css";

const STORAGE_KEY = "kneuron.cortex.electrodes.v1";

interface CalibrationView {
  visible: boolean;
  title: string;
  hint: string;
  progress: number;
  elapsedSeconds: number;
  totalSeconds: number;
}

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

const CAMERA_VIEWS: ReadonlyArray<{ view: CortexView; label: string }> = [
  { view: "top", label: "Top" },
  { view: "front", label: "Front" },
  { view: "back", label: "Back" },
  { view: "left", label: "Left" },
  { view: "right", label: "Right" },
];

const BAND_NAMES: Record<CortexBand, string> = {
  delta: "Delta",
  theta: "Theta",
  alpha: "Alpha",
  beta: "Beta",
  gamma: "Gamma",
};

function formatEEGState(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function getCalibrationView(
  eeg: ReturnType<typeof useCortexEEG>,
  visualMode: CortexVisualMode,
): CalibrationView {
  if (!eeg.started) {
    return {
      visible: false,
      title: "",
      hint: "",
      progress: 0,
      elapsedSeconds: 0,
      totalSeconds: 0,
    };
  }

  if (eeg.phase === "warmup") {
    return {
      visible: true,
      title: "Warming up filters",
      hint: "Keep still; filter output is not entering the baseline yet.",
      progress: eeg.warmupProgress,
      elapsedSeconds: eeg.warmupProgress * CORTEX_WARMUP_SECONDS,
      totalSeconds: CORTEX_WARMUP_SECONDS,
    };
  }

  if (visualMode === "fast" && !eeg.fastReady) {
    return {
      visible: true,
      title: "Calibrating the fast baseline",
      hint: "Keep still; the robust baseline freezes when calibration completes.",
      progress: eeg.fastCalibrationProgress,
      elapsedSeconds: eeg.fastCalibrationProgress * CORTEX_FAST_BASELINE_SECONDS,
      totalSeconds: CORTEX_FAST_BASELINE_SECONDS,
    };
  }

  if (visualMode === "bands" && !eeg.bandReady) {
    if (eeg.bandWindowProgress < 1 && eeg.bandCalibrationProgress === 0) {
      return {
        visible: true,
        title: "Collecting the band window",
        hint: "Collecting the 2 s filtered window required by Welch PSD.",
        progress: eeg.bandWindowProgress,
        elapsedSeconds: eeg.bandWindowProgress * CORTEX_BAND_WINDOW_SECONDS,
        totalSeconds: CORTEX_BAND_WINDOW_SECONDS,
      };
    }

    return {
      visible: true,
      title: "Calibrating the band baseline",
      hint: "Keep still; the channel × band baseline freezes when complete.",
      progress: eeg.bandCalibrationProgress,
      elapsedSeconds: eeg.bandCalibrationProgress * CORTEX_BAND_BASELINE_SECONDS,
      totalSeconds: CORTEX_BAND_BASELINE_SECONDS,
    };
  }

  return {
    visible: false,
    title: "",
    hint: "",
    progress: 1,
    elapsedSeconds: 0,
    totalSeconds: 0,
  };
}

function getProcessingStatus(
  eeg: ReturnType<typeof useCortexEEG>,
  visualMode: CortexVisualMode,
): string {
  if (!eeg.started) {
    return "Idle";
  }

  if (eeg.phase === "warmup") {
    return "Warming up";
  }

  if (visualMode === "fast" && !eeg.fastReady) {
    return "Calibrating";
  }

  if (visualMode === "bands" && !eeg.bandReady) {
    return "Calibrating";
  }

  return "Live";
}

export function CortexModule(_props: KNeuronModuleProps) {
  const eeg = useCortexEEG();
  const rendererRef = useRef<CortexRenderer | null>(null);

  const [visualMode, setVisualMode] = useState<CortexVisualMode>("fast");
  const [selectedBand, setSelectedBand] = useState<CortexBand>("alpha");
  const [quality, setQuality] = useState<CortexQuality>("medium");
  const [hotspotRadius, setHotspotRadius] = useState(0.38);
  const [deformation, setDeformation] = useState(0.2);
  const [meshLinesVisible, setMeshLinesVisible] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const controlsPanel = usePanelSize({
    storageKey: "kneuron.panel.cortex-controls",
    defaultWidth: 320,
    minWidth: 260,
    maxWidth: 520,
  });
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [electrodes, setElectrodes] = useState<CortexElectrode[]>(loadSavedElectrodes);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [saveState, setSaveState] = useState<string | null>(null);

  const activityByLabel =
    visualMode === "fast" ? eeg.fastActivityByLabel : eeg.bandActivityByLabel[selectedBand];

  const calibration = getCalibrationView(eeg, visualMode);
  const processingStatus = getProcessingStatus(eeg, visualMode);

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
    <section
      className={
        controlsPanel.collapsed
          ? "cortex-module cortex-module--controls-collapsed"
          : "cortex-module"
      }
      style={{
        ["--controls-width" as string]: `${controlsPanel.collapsed ? 0 : controlsPanel.width}px`,
      }}
    >
      <div className="cortex-stage">
        <CortexViewport
          initialElectrodes={electrodes}
          activityByLabel={activityByLabel}
          quality={quality}
          hotspotRadius={hotspotRadius}
          deformation={deformation}
          meshLinesVisible={meshLinesVisible}
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
          {eeg.sampleRateHz !== null && (
            <span>
              {eeg.sampleRateHz} Hz, {eeg.channelCount} channels
            </span>
          )}
          {eeg.started && <span>{processingStatus}</span>}
        </div>

        <div
          className="cortex-overlay cortex-views"
          role="group"
          aria-label="Camera view"
          title="Double-click the brain to return to the top view"
        >
          {CAMERA_VIEWS.map(({ view, label }) => (
            <button key={view} type="button" onClick={() => rendererRef.current?.setView(view)}>
              {label}
            </button>
          ))}
        </div>

        {eeg.started && (
          <div className="cortex-overlay cortex-legend">
            <span className="cortex-legend__title">
              {visualMode === "fast" ? "Activity" : `${BAND_NAMES[selectedBand]} power`} vs.
              baseline
            </span>
            <span className="cortex-legend__bar" aria-hidden="true" />
            <span className="cortex-legend__scale">
              <span>At baseline</span>
              <span>Strongest</span>
            </span>
          </div>
        )}

        {calibration.visible && (
          <div className="cortex-calibration-overlay">
            <div className="cortex-calibration-card">
              <h2>{calibration.title}</h2>
              <p>{calibration.hint}</p>

              <div className="cortex-calibration-track">
                <div
                  className="cortex-calibration-fill"
                  style={{ width: `${Math.round(calibration.progress * 100)}%` }}
                />
              </div>

              <div className="cortex-calibration-time">
                <strong>{Math.round(calibration.progress * 100)}%</strong>
                <span>
                  {calibration.elapsedSeconds.toFixed(1)} / {calibration.totalSeconds.toFixed(1)} s
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <PanelResizer panel={controlsPanel} label="Cortex controls" />

      <aside className="cortex-controls">
        <section className="cortex-control-section">
          <h3 className="cortex-control-section__heading">EEG stream</h3>

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
          <h3 className="cortex-control-section__heading">Processing</h3>

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
              <option value="fast">Fast activity (200 ms RMS)</option>
              <option value="bands">Band power (Welch)</option>
            </select>
          </label>

          {visualMode === "bands" && (
            <label className="cortex-field">
              <span>Band</span>
              <select
                value={selectedBand}
                onChange={(event) => setSelectedBand(event.target.value as CortexBand)}
              >
                <option value="alpha">Alpha, 8–13 Hz</option>
                <option value="beta">Beta, 13–30 Hz</option>
                <option value="theta">Theta, 4–8 Hz</option>
                <option value="delta">Delta, 1–4 Hz</option>
                <option value="gamma">Gamma, 30–45 Hz</option>
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
            <div className="cortex-button-row">
              <button
                type="button"
                className="cortex-button cortex-button--primary"
                onClick={eeg.recalibrate}
              >
                Recalibrate
              </button>
              <button type="button" className="cortex-button" onClick={eeg.stopExperience}>
                Stop
              </button>
            </div>
          )}

          <div className="cortex-kv cortex-kv--spaced">
            <span>Fast baseline</span>
            <strong>
              {eeg.fastReady ? "Frozen" : `${Math.round(eeg.fastCalibrationProgress * 100)}%`}
            </strong>
          </div>
          <div className="cortex-kv">
            <span>Band baseline</span>
            <strong>
              {eeg.bandReady ? "Frozen" : `${Math.round(eeg.bandCalibrationProgress * 100)}%`}
            </strong>
          </div>
          <div className="cortex-kv">
            <span>Signal quality</span>
            <strong>
              {averageSignalQuality === null ? "—" : `${Math.round(averageSignalQuality * 100)}%`}
            </strong>
          </div>

          {eeg.flatChannels.length > 0 && (
            <p className="cortex-warning">Flat channels: {eeg.flatChannels.join(", ")}</p>
          )}

          <p className="cortex-processing-note">
            Filtered 1–45 Hz, with a 50 Hz notch when supported. The baseline freezes after
            calibration. Artifact quality is shown for information only.
          </p>

          {eeg.started && strongestChannels.length > 0 && (
            <div className="cortex-activity-list">
              <span className="cortex-activity-list__title">Strongest activity</span>
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
          <h3 className="cortex-control-section__heading">Rendering</h3>

          <label className="cortex-field">
            <span>Quality</span>
            <select
              value={quality}
              onChange={(event) => setQuality(event.target.value as CortexQuality)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>

          <label className="cortex-field">
            <span>
              Hotspot radius <output>{hotspotRadius.toFixed(2)}</output>
            </span>
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
            <span>
              Deformation <output>{deformation.toFixed(2)}</output>
            </span>
            <input
              type="range"
              min="0"
              max="0.35"
              step="0.01"
              value={deformation}
              onChange={(event) => setDeformation(Number(event.target.value))}
            />
          </label>

          <label className="cortex-check">
            <input
              type="checkbox"
              checked={meshLinesVisible}
              onChange={(event) => setMeshLinesVisible(event.target.checked)}
            />
            <span>Show mesh lines (slower)</span>
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
          <h3 className="cortex-control-section__heading">Electrodes</h3>

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
                  Add electrode
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

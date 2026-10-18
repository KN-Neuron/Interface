import { useEffect, useMemo, useRef, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import type { BrainMetricsSnapshot } from "../../core/brainMetrics";

import { useBrainMetrics } from "./hooks/useBrainMetrics";

import "./styles/neuorrun.css";

import {
  loadUnityRuntime,
  UnityBuildMissingError,
  type UnityInstance,
} from "../../lib/unityRuntime";

function metricsPayload(metrics: Readonly<BrainMetricsSnapshot> | null): string {
  return JSON.stringify({
    attention: metrics?.attention ?? 0,
    meditation: metrics?.meditation ?? 0,
    poorSignalLevel: metrics?.poorSignalLevel ?? 200,
  });
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? "--" : String(value);
}

export function NeuorrunModule({ onRequestClose }: KNeuronModuleProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const unityRef = useRef<UnityInstance | null>(null);

  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing" | "error">("loading");

  const [progress, setProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const brain = useBrainMetrics();

  const signalLabel = useMemo(() => {
    if (!brain.metrics) {
      return "--";
    }

    return `${formatMetric(brain.metrics.signalQualityPercent)}%`;
  }, [brain.metrics]);

  useEffect(() => {
    const controller = new AbortController();
    const canvas = canvasRef.current;
    if (!canvas) return;
    void loadUnityRuntime(canvas, "/neuorrun", controller.signal, setProgress)
      .then(async (instance) => {
        if (controller.signal.aborted) {
          await instance.Quit();
          return;
        }
        unityRef.current = instance;
        setProgress(1);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState(error instanceof UnityBuildMissingError ? "missing" : "error");
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      controller.abort();
      const instance = unityRef.current;
      unityRef.current = null;
      if (instance) void instance.Quit().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const instance = unityRef.current;
    const metrics = brain.metrics;

    if (loadState !== "ready" || !instance) {
      return;
    }

    try {
      instance.SendMessage("KNeuronBridge", "SetMetricsJson", metricsPayload(metrics));
    } catch {
      // Unity may be between scenes for a frame. The next metrics event will
      // retry automatically.
    }
  }, [brain.metrics, loadState]);

  return (
    <section className="neuorrun-module">
      <header className="neuorrun-module__bar">
        <div>
          <strong>Neuorrun</strong>
        </div>

        <div className="neuorrun-module__telemetry">
          <div>
            <small>BRAINLINK</small>
            <span className={brain.state === "live" ? "is-live" : ""}>
              {brain.state === "live" ? "LIVE" : "NOT CONNECTED"}
            </span>
          </div>
          <div>
            <small>ATTENTION</small>
            <span>{formatMetric(brain.metrics?.attention)}</span>
          </div>
          <div>
            <small>MEDITATION</small>
            <span>{formatMetric(brain.metrics?.meditation)}</span>
          </div>
          <div>
            <small>SIGNAL</small>
            <span>{signalLabel}</span>
          </div>
          <button type="button" onClick={onRequestClose}>
            EXIT MODULE
          </button>
        </div>
      </header>

      <div className="neuorrun-module__stage">
        <canvas
          id="unity-canvas"
          ref={canvasRef}
          className="neuorrun-module__canvas"
          tabIndex={0}
          onPointerDown={(event) => {
            event.currentTarget.focus();
          }}
        />

        {loadState === "loading" ? (
          <div className="neuorrun-module__overlay">
            <span>UNITY WEBGL</span>
            <h2>Loading Neuorrun</h2>
            <div className="neuorrun-module__progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p>{Math.round(progress * 100)}%</p>
          </div>
        ) : null}

        {loadState === "missing" ? (
          <div className="neuorrun-module__overlay">
            <span>UNITY BUILD REQUIRED</span>
            <h2>Neuorrun assets are not installed yet</h2>
            <p>
              Build the supplied Unity project for WebGL, then run the package prepare script
              described in INTEGRATION.md.
            </p>
          </div>
        ) : null}

        {loadState === "error" ? (
          <div className="neuorrun-module__overlay neuorrun-module__overlay--error">
            <span>LOAD ERROR</span>
            <h2>Neuorrun could not start</h2>
            <p>{loadError}</p>
          </div>
        ) : null}

        {loadState === "ready" && brain.state === "unavailable" ? (
          <div className="neuorrun-module__brain-warning">
            <strong>BrainLink not connected</strong>
            <span>
              {brain.message ??
                "Connect BrainLink Lite in Device. Keyboard/controller input remains available."}
            </span>
            <button type="button" onClick={brain.retry}>
              RETRY
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

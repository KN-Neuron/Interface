import { useEffect, useMemo, useRef, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import type { BrainMetricsSnapshot } from "../../core/brainMetrics";

import { useBrainMetrics } from "./hooks/useBrainMetrics";

import "./styles/neuorrun.css";

interface UnityBuildManifest {
  ready: boolean;
  loader?: string;
  data?: string;
  framework?: string;
  code?: string;
  symbols?: string | null;
  streamingAssets?: string | null;
  companyName?: string;
  productName?: string;
  productVersion?: string;
}

interface UnityInstance {
  SendMessage(objectName: string, methodName: string, value?: string | number): void;

  Quit(): Promise<void>;
}

type CreateUnityInstance = (
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
  onProgress?: (progress: number) => void,
) => Promise<UnityInstance>;

declare global {
  interface Window {
    createUnityInstance?: CreateUnityInstance;
  }
}

function metricsPayload(metrics: Readonly<BrainMetricsSnapshot>): string {
  return JSON.stringify({
    attention: metrics.attention ?? 0,
    meditation: metrics.meditation ?? 0,
    poorSignalLevel: metrics.poorSignalLevel ?? 200,
  });
}

function formatMetric(value: number | null | undefined): string {
  return value == null ? "--" : String(value);
}

export function NeuorrunModule(_props: KNeuronModuleProps): JSX.Element {
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
    let cancelled = false;
    let loaderScript: HTMLScriptElement | null = null;

    async function startUnity(): Promise<void> {
      try {
        const response = await fetch("/neuorrun/manifest.json", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Neuorrun manifest could not be loaded (${response.status}).`);
        }

        const manifest = (await response.json()) as UnityBuildManifest;

        if (!manifest.ready) {
          if (!cancelled) {
            setLoadState("missing");
          }
          return;
        }

        if (!manifest.loader || !manifest.data || !manifest.framework || !manifest.code) {
          throw new Error("Neuorrun Unity manifest is incomplete.");
        }

        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error("Neuorrun canvas is unavailable.");
        }

        if (!window.createUnityInstance) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `/neuorrun/${manifest.loader}`;
            script.async = true;
            script.dataset.kneuronUnityLoader = "neuorrun";
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Neuorrun Unity loader failed to load."));
            document.body.appendChild(script);
            loaderScript = script;
          });
        }

        if (!window.createUnityInstance) {
          throw new Error("Unity createUnityInstance API is unavailable.");
        }

        const config: Record<string, unknown> = {
          dataUrl: `/neuorrun/${manifest.data}`,
          frameworkUrl: `/neuorrun/${manifest.framework}`,
          codeUrl: `/neuorrun/${manifest.code}`,
          streamingAssetsUrl: manifest.streamingAssets
            ? `/neuorrun/${manifest.streamingAssets}`
            : "/neuorrun/StreamingAssets",
          companyName: manifest.companyName ?? "KNeuron",
          productName: manifest.productName ?? "Neuorrun",
          productVersion: manifest.productVersion ?? "1.0",
          matchWebGLToCanvasSize: true,
          devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        };

        if (manifest.symbols) {
          config.symbolsUrl = `/neuorrun/${manifest.symbols}`;
        }

        const instance = await window.createUnityInstance(canvas, config, (value) => {
          if (!cancelled) {
            setProgress(value);
          }
        });

        if (cancelled) {
          await instance.Quit();
          return;
        }

        unityRef.current = instance;
        setProgress(1);
        setLoadState("ready");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLoadState("error");
        setLoadError(error instanceof Error ? error.message : String(error));
      }
    }

    void startUnity();

    return () => {
      cancelled = true;

      const instance = unityRef.current;
      unityRef.current = null;

      if (instance) {
        void instance.Quit();
      }

      loaderScript?.remove();
    };
  }, []);

  useEffect(() => {
    const instance = unityRef.current;
    const metrics = brain.metrics;

    if (!instance || !metrics) {
      return;
    }

    try {
      instance.SendMessage("KNeuronBridge", "SetMetricsJson", metricsPayload(metrics));
    } catch {
      // Unity may be between scenes for a frame. The next metrics event will
      // retry automatically.
    }
  }, [brain.metrics]);

  return (
    <section className="neuorrun-module">
      <header className="neuorrun-module__bar">
        <dl className="neuorrun-module__telemetry">
          <div>
            <dt>Headset</dt>
            <dd className={brain.state === "live" ? "is-live" : ""}>
              {brain.state === "live" ? "Live" : "Not connected"}
            </dd>
          </div>
          <div>
            <dt>Attention</dt>
            <dd>{formatMetric(brain.metrics?.attention)}</dd>
          </div>
          <div>
            <dt>Meditation</dt>
            <dd>{formatMetric(brain.metrics?.meditation)}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>{signalLabel}</dd>
          </div>
        </dl>
        <p className="neuorrun-module__hint">
          Attention controls the game. Keyboard and controller also work.
        </p>
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
            <h2>Loading Neuorrun</h2>
            <div className="neuorrun-module__progress">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p>{Math.round(progress * 100)}%</p>
          </div>
        ) : null}

        {loadState === "missing" ? (
          <div className="neuorrun-module__overlay">
            <h2>Neuorrun game files are missing</h2>
            <p>
              Build the Unity project for WebGL, then copy it here with
              unity-patch/prepare_webgl_build.py (see README, “Building Neuorrun manually”).
            </p>
          </div>
        ) : null}

        {loadState === "error" ? (
          <div className="neuorrun-module__overlay neuorrun-module__overlay--error">
            <h2>Neuorrun could not start</h2>
            <p>{loadError}</p>
          </div>
        ) : null}

        {loadState === "ready" && brain.state === "unavailable" ? (
          <div className="neuorrun-module__brain-warning">
            <strong>No attention signal</strong>
            <span>
              {brain.message ??
                "Connect BrainLink Lite on the Devices page. Keyboard and controller still work."}
            </span>
            <button type="button" onClick={brain.retry}>
              Try again
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

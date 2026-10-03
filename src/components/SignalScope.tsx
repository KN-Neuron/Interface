import { useEffect, useRef, useState } from "react";

import { eegStreamService } from "../core/eeg";
import type { EEGStreamHandle } from "../core/eeg/EEGStreamService";
import { brainMetricsService, type BrainMetricsHandle } from "../core/brainMetrics";
import type { BrainMetricsSnapshot } from "../core/brainMetrics";

/**
 * Channels shown on the scope, in display order, when the device has them.
 * Midline plus one pair per region gives a quick whole-head signal check.
 */
const PREFERRED_CHANNELS = ["Fz", "C3", "Cz", "C4", "Pz", "O1", "Oz", "O2"];

const MAX_CHANNELS = 8;

const EEG_WINDOW_SECONDS = 4;

const METRICS_HISTORY = 60;

/**
 * How often signal health is reported to the parent (not per batch, to keep
 * React renders cheap).
 */
const STATS_INTERVAL_MS = 250;

export interface ScopeStats {
  /**
   * Seconds since the last batch or metrics update; null before the first one.
   */
  dataAgeSeconds: number | null;

  /**
   * Samples missing from the device's sample counter since the scope started
   * (EEG only).
   */
  droppedSamples: number;
}

export type ScopeSource = "eeg" | "metrics" | "none";

interface SignalScopeProps {
  source: ScopeSource;

  /**
   * Changes whenever the active device or its connection changes, forcing a
   * fresh acquire.
   */
  sessionKey: string;

  /**
   * Stop drawing while hidden (e.g. a module is open). Data is still received.
   */
  paused: boolean;

  onMetrics?: (snapshot: Readonly<BrainMetricsSnapshot>) => void;

  onStats?: (stats: ScopeStats) => void;
}

interface EEGTraceBuffer {
  labels: string[];
  data: Float32Array[];
  length: number;
  head: number;
  filled: number;
}

function readToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Small oscilloscope-style live view of the active device.
 *
 * It is an ordinary EEGStreamService / BrainMetricsService consumer and
 * releases its handle on unmount or device change.
 */
export function SignalScope({ source, sessionKey, paused, onMetrics, onStats }: SignalScopeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const eegRef = useRef<EEGTraceBuffer | null>(null);

  const metricsRef = useRef<{ attention: number[]; meditation: number[] }>({
    attention: [],
    meditation: [],
  });

  const statsRef = useRef<{
    lastDataAtMs: number | null;
    droppedSamples: number;
    expectedNext: number | null;
  }>({ lastDataAtMs: null, droppedSamples: 0, expectedNext: null });

  const onMetricsRef = useRef(onMetrics);
  const onStatsRef = useRef(onStats);

  useEffect(() => {
    onMetricsRef.current = onMetrics;
    onStatsRef.current = onStats;
  }, [onMetrics, onStats]);

  useEffect(() => {
    if (paused || source === "none") {
      return undefined;
    }

    const report = () => {
      const stats = statsRef.current;

      onStatsRef.current?.({
        dataAgeSeconds:
          stats.lastDataAtMs === null
            ? null
            : Math.max(0, (Date.now() - stats.lastDataAtMs) / 1000),
        droppedSamples: stats.droppedSamples,
      });
    };

    report();

    const timer = window.setInterval(report, STATS_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [paused, source]);

  /**
   * Errors are tagged with the acquisition they belong to, so a new device
   * or reconnect hides a stale message without resetting state in an effect.
   */
  const acquisitionKey = `${source}:${sessionKey}`;

  const [error, setError] = useState<{ key: string; message: string } | null>(null);

  /* ---------------------------------------------------------------
     Data acquisition
     --------------------------------------------------------------- */

  useEffect(() => {
    const key = `${source}:${sessionKey}`;

    const reportError = (caught: unknown) => {
      setError({ key, message: caught instanceof Error ? caught.message : String(caught) });
    };

    eegRef.current = null;
    metricsRef.current = { attention: [], meditation: [] };
    statsRef.current = { lastDataAtMs: null, droppedSamples: 0, expectedNext: null };

    if (source === "eeg") {
      let disposed = false;
      let handle: EEGStreamHandle | null = null;

      void (async () => {
        try {
          const probe = await eegStreamService.acquire({ channels: "all" });

          const labels = probe.channels.map((channel) => channel.label);

          const preferred = PREFERRED_CHANNELS.filter((label) => labels.includes(label));

          const selected = (preferred.length >= 4 ? preferred : labels).slice(0, MAX_CHANNELS);

          await probe.release();

          if (disposed) {
            return;
          }

          const length = Math.round(EEG_WINDOW_SECONDS * probe.streamInfo.sampleRateHz);

          const buffer: EEGTraceBuffer = {
            labels: selected,
            data: selected.map(() => new Float32Array(length)),
            length,
            head: 0,
            filled: 0,
          };

          eegRef.current = buffer;

          const acquired = await eegStreamService.acquire({
            channels: selected,
            onBatch: (batch) => {
              if (disposed) {
                return;
              }

              // Gaps in the device's own sample counter mean lost samples.
              const stats = statsRef.current;
              const first = batch.sourceSampleNumberStart ?? batch.sequenceStart;

              if (stats.expectedNext !== null && first > stats.expectedNext) {
                stats.droppedSamples += first - stats.expectedNext;
              }

              stats.expectedNext = first + batch.sampleCount;
              stats.lastDataAtMs = Date.now();

              for (let s = 0; s < batch.sampleCount; s += 1) {
                for (let c = 0; c < buffer.data.length; c += 1) {
                  buffer.data[c][buffer.head] = batch.values[c]?.[s] ?? 0;
                }

                buffer.head = (buffer.head + 1) % buffer.length;
                buffer.filled = Math.min(buffer.filled + 1, buffer.length);
              }
            },
          });

          if (disposed) {
            await acquired.release();
            return;
          }

          handle = acquired;
        } catch (caught) {
          if (!disposed) {
            reportError(caught);
          }
        }
      })();

      return () => {
        disposed = true;

        if (handle) {
          void handle.release();
        }
      };
    }

    if (source === "metrics") {
      let handle: BrainMetricsHandle | null = null;

      try {
        handle = brainMetricsService.acquire((snapshot) => {
          const history = metricsRef.current;

          history.attention.push(snapshot.attention ?? 0);
          history.meditation.push(snapshot.meditation ?? 0);

          if (history.attention.length > METRICS_HISTORY) {
            history.attention.shift();
            history.meditation.shift();
          }

          statsRef.current.lastDataAtMs = snapshot.timestampMs;

          onMetricsRef.current?.(snapshot);
        });
      } catch (caught) {
        reportError(caught);
      }

      return () => {
        handle?.release();
      };
    }

    return undefined;
  }, [source, sessionKey]);

  /* ---------------------------------------------------------------
     Drawing
     --------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || paused) {
      return undefined;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return undefined;
    }

    const traceColor = readToken("--trace", "#8ed9c0");
    const traceDim = readToken("--trace-dim", "#4f7f72");
    const gridColor = readToken("--screen-grid", "#1d2a2b");
    const labelColor = readToken("--screen-label", "#6f8f86");

    let frame = 0;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();

      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));

      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const drawGrid = (width: number, height: number) => {
      context.strokeStyle = gridColor;
      context.lineWidth = 1;
      context.beginPath();

      for (let x = 0; x <= 10; x += 1) {
        const px = Math.round((x / 10) * width) + 0.5;
        context.moveTo(px, 0);
        context.lineTo(px, height);
      }

      for (let y = 0; y <= 8; y += 1) {
        const py = Math.round((y / 8) * height) + 0.5;
        context.moveTo(0, py);
        context.lineTo(width, py);
      }

      context.stroke();
    };

    const drawEeg = (width: number, height: number) => {
      const buffer = eegRef.current;

      if (!buffer || buffer.filled < 2) {
        drawFlatline(width, height);
        return;
      }

      const rows = buffer.data.length;
      const rowHeight = height / rows;
      const labelWidth = 30;
      const plotWidth = width - labelWidth;

      context.font = "500 11px Barlow, sans-serif";
      context.textBaseline = "middle";

      for (let c = 0; c < rows; c += 1) {
        const channel = buffer.data[c];
        const centerY = rowHeight * (c + 0.5);

        let sum = 0;
        for (let i = 0; i < buffer.filled; i += 1) {
          sum += channel[(buffer.head - 1 - i + buffer.length * 2) % buffer.length];
        }
        const mean = sum / buffer.filled;

        let peak = 1e-6;
        for (let i = 0; i < buffer.filled; i += 1) {
          const value = Math.abs(
            channel[(buffer.head - 1 - i + buffer.length * 2) % buffer.length] - mean,
          );
          if (value > peak) peak = value;
        }

        const scale = (rowHeight * 0.42) / peak;

        context.fillStyle = labelColor;
        context.fillText(buffer.labels[c], 6, centerY);

        context.strokeStyle = traceColor;
        context.lineWidth = 1.2;
        context.beginPath();

        const start = buffer.length - buffer.filled;

        for (let i = 0; i < buffer.filled; i += 1) {
          const index = (buffer.head - buffer.filled + i + buffer.length * 2) % buffer.length;
          const x = labelWidth + ((start + i) / (buffer.length - 1)) * plotWidth;
          const y = centerY - (channel[index] - mean) * scale;

          if (i === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.stroke();
      }
    };

    const drawMetricLine = (values: number[], width: number, height: number, color: string) => {
      if (values.length < 2) {
        return;
      }

      context.strokeStyle = color;
      context.lineWidth = 1.6;
      context.beginPath();

      const offset = METRICS_HISTORY - values.length;

      values.forEach((value, i) => {
        const x = ((offset + i) / (METRICS_HISTORY - 1)) * width;
        const y = height - (value / 100) * height;

        if (i === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });

      context.stroke();
    };

    const drawMetrics = (width: number, height: number) => {
      const history = metricsRef.current;

      if (history.attention.length < 2) {
        drawFlatline(width, height);
        return;
      }

      drawMetricLine(history.meditation, width, height, traceDim);
      drawMetricLine(history.attention, width, height, traceColor);
    };

    const drawFlatline = (width: number, height: number) => {
      context.strokeStyle = traceDim;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(0, height / 2 + 0.5);
      context.lineTo(width, height / 2 + 0.5);
      context.stroke();
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      context.clearRect(0, 0, width, height);

      drawGrid(width, height);

      if (source === "eeg") {
        drawEeg(width, height);
      } else if (source === "metrics") {
        drawMetrics(width, height);
      } else {
        drawFlatline(width, height);
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [paused, source]);

  return (
    <div className="scope">
      <canvas ref={canvasRef} className="scope__canvas" aria-hidden="true" />
      {error?.key === acquisitionKey && <p className="scope__error">{error.message}</p>}
    </div>
  );
}

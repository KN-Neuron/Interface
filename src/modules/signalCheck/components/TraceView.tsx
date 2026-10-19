import { useRef, type RefObject } from "react";

import type { ChannelCheckStatus } from "../../../core/neurostate";

import type { SignalRingBuffer } from "../signalRingBuffer";

import { STATUS_COLORS } from "../summary";

import { useCanvas, type CanvasSize } from "./useCanvas";

interface TraceViewProps {
  signals: RefObject<SignalRingBuffer | null>;
  labels: readonly string[];
  statuses: Readonly<Record<string, ChannelCheckStatus>>;
  shownSeconds: number;
  /**
   * Microvolts between neighbouring channels' baselines.
   */
  spacingUv: number;
}

const GUTTER = 52;
const AXIS = 22;

/**
 * The filtered signals, one row per channel, coloured by channel status like
 * neurostate's check window. The newest sample is on the right.
 */
export function TraceView({ signals, labels, statuses, shownSeconds, spacingUv }: TraceViewProps) {
  const drawn = useRef({ version: -1, key: "" });
  const key = `${labels.join(",")}|${JSON.stringify(statuses)}|${spacingUv}`;

  const canvasRef = useCanvas(
    (context: CanvasRenderingContext2D, { width, height }: CanvasSize) => {
      const buffer = signals.current;
      const plotWidth = width - GUTTER;
      const plotHeight = height - AXIS;
      const rowHeight = plotHeight / Math.max(labels.length, 1);
      const pixelsPerUv = rowHeight / spacingUv;

      drawn.current = { version: buffer?.version ?? -1, key };

      context.clearRect(0, 0, width, height);
      context.font = "11px 'Barlow', sans-serif";
      context.textBaseline = "middle";

      // One line per second, labelled underneath.
      context.strokeStyle = "#1d1d1d";
      context.fillStyle = "#6f6f6f";
      context.textAlign = "center";
      context.lineWidth = 1;
      for (let second = 0; second <= shownSeconds; second++) {
        const x = GUTTER + (plotWidth * second) / shownSeconds;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, plotHeight);
        context.stroke();
        context.fillText(`${second - shownSeconds} s`, Math.min(x, width - 14), plotHeight + 12);
      }

      context.textAlign = "right";
      labels.forEach((label, channel) => {
        const baseline = (channel + 0.5) * rowHeight;
        const color = STATUS_COLORS[statuses[label] ?? "ok"];

        context.fillStyle = color;
        context.fillText(label, GUTTER - 10, baseline);
      });

      if (!buffer || buffer.length < 2) {
        return;
      }

      const step = plotWidth / (buffer.capacity - 1);
      const offset = buffer.capacity - buffer.length;
      // At most about two points per pixel.
      const stride = Math.max(1, Math.floor(buffer.length / (plotWidth * 2)));

      context.save();
      context.beginPath();
      context.rect(GUTTER, 0, plotWidth, plotHeight);
      context.clip();
      context.lineWidth = 1;

      labels.forEach((label, channel) => {
        const baseline = (channel + 0.5) * rowHeight;

        context.strokeStyle = STATUS_COLORS[statuses[label] ?? "ok"];
        context.beginPath();

        for (let index = 0; index < buffer.length; index += stride) {
          const x = GUTTER + (offset + index) * step;
          const y = baseline - buffer.read(channel, index) * pixelsPerUv;

          if (index === 0) {
            context.moveTo(x, y);
          } else {
            context.lineTo(x, y);
          }
        }

        context.stroke();
      });

      context.restore();
    },
    () => drawn.current.version !== (signals.current?.version ?? -1) || drawn.current.key !== key,
  );

  return (
    <canvas
      ref={canvasRef}
      className="signal-check__traces"
      role="img"
      aria-label={`Filtered EEG of ${labels.length} channels, last ${shownSeconds} seconds`}
    />
  );
}

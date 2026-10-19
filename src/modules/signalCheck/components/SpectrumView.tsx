import { useRef } from "react";

import { useCanvas, type CanvasSize } from "./useCanvas";

interface SpectrumViewProps {
  spectrum: { hz: readonly number[]; psd: readonly number[] } | null;
  alphaHz: readonly [number, number];
  maxHz?: number;
}

const LEFT = 44;
const BOTTOM = 22;
const TOP = 8;
const RIGHT = 8;

/**
 * "0.01", "1", "100"; "1e-6" once plain numbers get long.
 */
function decadeLabel(exponent: number): string {
  return exponent >= -3 && exponent <= 4 ? String(10 ** exponent) : `1e${exponent}`;
}

/**
 * Power spectrum (µV²/Hz, log scale) over the back of the head, with the
 * alpha band shaded: alpha should rise clearly when the eyes close.
 */
export function SpectrumView({ spectrum, alphaHz, maxHz = 60 }: SpectrumViewProps) {
  const drawnFor = useRef<SpectrumViewProps["spectrum"] | undefined>(undefined);

  const canvasRef = useCanvas(
    (context: CanvasRenderingContext2D, { width, height }: CanvasSize) => {
      drawnFor.current = spectrum;

      const plotWidth = width - LEFT - RIGHT;
      const plotHeight = height - TOP - BOTTOM;
      const xOf = (hz: number) => LEFT + (hz / maxHz) * plotWidth;

      context.clearRect(0, 0, width, height);
      context.font = "10px 'Barlow', sans-serif";

      // Alpha band.
      context.fillStyle = "rgba(90, 150, 255, 0.16)";
      context.fillRect(xOf(alphaHz[0]), TOP, xOf(alphaHz[1]) - xOf(alphaHz[0]), plotHeight);

      context.strokeStyle = "#1d1d1d";
      context.fillStyle = "#6f6f6f";
      context.textAlign = "center";
      context.textBaseline = "top";
      for (let hz = 0; hz <= maxHz; hz += 10) {
        const x = xOf(hz);
        context.beginPath();
        context.moveTo(x, TOP);
        context.lineTo(x, TOP + plotHeight);
        context.stroke();
        context.fillText(`${hz}`, x, TOP + plotHeight + 6);
      }

      if (!spectrum || spectrum.psd.length < 2) {
        return;
      }

      const logs = spectrum.psd.map((value) => Math.log10(value));
      const low = Math.floor(Math.min(...logs));
      const high = Math.max(Math.ceil(Math.max(...logs)), low + 1);
      const yOf = (log: number) => TOP + plotHeight - ((log - low) / (high - low)) * plotHeight;

      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let exponent = low; exponent <= high; exponent++) {
        const y = yOf(exponent);
        context.beginPath();
        context.moveTo(LEFT, y);
        context.lineTo(LEFT + plotWidth, y);
        context.stroke();
        context.fillText(decadeLabel(exponent), LEFT - 6, y);
      }

      context.strokeStyle = "#70a8ff";
      context.lineWidth = 2;
      context.beginPath();
      spectrum.hz.forEach((hz, index) => {
        const x = xOf(hz);
        const y = yOf(logs[index] ?? low);

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      });
      context.stroke();
      context.lineWidth = 1;
    },
    () => drawnFor.current !== spectrum,
  );

  return (
    <canvas
      ref={canvasRef}
      className="signal-check__spectrum"
      role="img"
      aria-label="Power spectrum over the back of the head"
    />
  );
}

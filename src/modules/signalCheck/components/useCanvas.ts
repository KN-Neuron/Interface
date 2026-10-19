import { useEffect, useRef, type RefObject } from "react";

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Keeps a canvas sized to its element at the screen's pixel density, and calls
 * `draw` on every animation frame for which `needsRedraw` says so (and after
 * every resize). `draw` gets a context scaled to CSS pixels.
 */
export function useCanvas(
  draw: (context: CanvasRenderingContext2D, size: CanvasSize) => void,
  needsRedraw: () => boolean,
): RefObject<HTMLCanvasElement> {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  const needsRedrawRef = useRef(needsRedraw);

  useEffect(() => {
    drawRef.current = draw;
    needsRedrawRef.current = needsRedraw;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d") ?? null;

    if (!canvas || !context) {
      return;
    }

    let frame = 0;
    let size: CanvasSize = { width: 0, height: 0 };
    let resized = true;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;

      size = { width: rect.width, height: rect.height };
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      resized = true;
    };

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(canvas);
    measure();

    const tick = () => {
      if ((resized || needsRedrawRef.current()) && size.width > 0 && size.height > 0) {
        resized = false;
        drawRef.current(context, size);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return canvasRef;
}

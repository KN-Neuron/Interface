import { useEffect, useMemo, useRef } from "react";

import type { SsvepTarget } from "../../../core/ssvep";

interface SsvepOverlayProps {
  phase: "countdown" | "stimulating" | "waiting-samples" | "classifying";
  targets: readonly SsvepTarget[];
  countdownRemaining: number;
  trialSeconds: number;
  elapsedSeconds: number;
  onCancel: () => void;
}

function luminanceFor(frequencyHz: number, elapsedSeconds: number): number {
  return Math.trunc((1 + Math.sin(2 * Math.PI * frequencyHz * elapsedSeconds)) * 115 + 25);
}

/**
 * Four-target TaaLON stimulus.
 *
 * During stimulation each square follows the same source equation:
 *
 * value = (1 + sin(2*pi*f*t)) * 115 + 25
 *
 * `t` is real elapsed time, matching the supplied Pygame implementation.
 */
export function SsvepOverlay({
  phase,
  targets,
  countdownRemaining,
  trialSeconds,
  elapsedSeconds,
  onCancel,
}: SsvepOverlayProps) {
  const targetRefs = useRef<Array<HTMLDivElement | null>>([]);

  const elapsedRef = useRef(elapsedSeconds);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  const targetByDirection = useMemo(
    () => new Map(targets.map((target) => [target.direction, target])),
    [targets],
  );

  useEffect(() => {
    if (phase !== "stimulating" && phase !== "waiting-samples") {
      return;
    }

    let frame = 0;

    const startedAt = performance.now() - elapsedRef.current * 1000;

    const animate = (now: number) => {
      const elapsed = (now - startedAt) / 1000;

      targets.forEach((target, index) => {
        const node = targetRefs.current[index];

        if (!node) {
          return;
        }

        const value = luminanceFor(target.frequencyHz, elapsed);

        node.style.backgroundColor = `rgb(${value}, ${value}, ${value})`;
      });

      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [phase, targets]);

  if (phase === "countdown") {
    return (
      <div className="miner-ssvep-overlay">
        <div className="miner-ssvep-overlay__countdown">
          <span>BCI MOVE</span>
          <h2>Focus on one direction</h2>
          <strong>{countdownRemaining}</strong>
          <p>Four targets will start simultaneously.</p>
          <button type="button" onClick={onCancel}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  if (phase === "classifying") {
    return (
      <div className="miner-ssvep-overlay">
        <div className="miner-ssvep-overlay__analyzing">
          <span>FBCCA</span>
          <h2>Classifying EEG</h2>
          <div className="miner-ssvep-overlay__scanner" />
          <p>5 subbands · 5 harmonics · CCA</p>
        </div>
      </div>
    );
  }

  const up = targetByDirection.get("UP");

  const left = targetByDirection.get("LEFT");

  const right = targetByDirection.get("RIGHT");

  const down = targetByDirection.get("DOWN");

  const ordered = [up, left, right, down].filter((target): target is SsvepTarget =>
    Boolean(target),
  );

  const progress = Math.min(1, elapsedSeconds / trialSeconds);

  return (
    <div className="miner-ssvep-overlay miner-ssvep-overlay--stimulus">
      <div className="miner-ssvep-overlay__instruction">FOCUS ON ONE TARGET</div>

      <div className="miner-ssvep-overlay__targets">
        {ordered.map((target, index) => (
          <div
            className={`miner-ssvep-target miner-ssvep-target--${target.direction.toLowerCase()}`}
            key={target.direction}
          >
            <div
              className="miner-ssvep-target__square"
              ref={(node) => {
                targetRefs.current[index] = node;
              }}
            />

            <span>{target.direction}</span>

            <small>{target.frequencyHz.toFixed(2)} Hz</small>
          </div>
        ))}
      </div>

      <div className="miner-ssvep-overlay__footer">
        <div className="miner-ssvep-overlay__progress">
          <div
            style={{
              width: `${progress * 100}%`,
            }}
          />
        </div>

        <span>
          {Math.min(elapsedSeconds, trialSeconds).toFixed(1)}
          {" / "}
          {trialSeconds.toFixed(1)} s
        </span>

        {phase === "waiting-samples" ? <small>Waiting for remaining EEG samples…</small> : null}

        <button type="button" onClick={onCancel}>
          ESC / CANCEL
        </button>
      </div>
    </div>
  );
}

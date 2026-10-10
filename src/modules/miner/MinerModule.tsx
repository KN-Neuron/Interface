import { useCallback, useEffect, useRef, useState } from "react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import {
  ssvepClassifierService,
  TAALON_COUNTDOWN_SECONDS,
  TAALON_DEFAULT_TARGETS,
  TAALON_DEFAULT_TRIAL_SECONDS,
  TAALON_MAX_TRIAL_SECONDS,
  TAALON_MIN_TRIAL_SECONDS,
  TAALON_SAMPLE_TIMEOUT_SECONDS,
  TAALON_TRIAL_STEP_SECONDS,
  validateTaalonFrequencies,
  type SsvepClassification,
  type SsvepDirection,
  type SsvepTarget,
} from "../../core/ssvep";

import { DiamondIcon } from "./components/DiamondIcon";

import { MinerIcon } from "./components/MinerIcon";

import { RockIcon } from "./components/RockIcon";

import { SsvepOverlay } from "./components/SsvepOverlay";

import {
  createInitialMinerGame,
  MINER_BOARD_HEIGHT,
  MINER_BOARD_WIDTH,
  MINER_DIAMONDS,
  MINER_WALLS,
  moveMiner,
} from "./game/minerGame";

import { useMinerEEG } from "./hooks/useMinerEEG";

import type { GridPosition, MinerLastDecision, MinerTrialPhase } from "./models/miner";

import "./styles/miner.css";


function positionKey(position: GridPosition): string {
  return `${position[0]}:${position[1]}`;
}

const wallKeys = new Set(MINER_WALLS.map(positionKey));

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MinerModule(_props: KNeuronModuleProps) {
  const {
    state: eegState,
    error: eegError,
    sampleRateHz,
    channelCount,
    retry: retryEEG,
    beginCapture,
    stopCapture,
    availableCaptureSamples,
    takeLatestCapture,
  } = useMinerEEG();

  const [game, setGame] = useState(createInitialMinerGame);

  const [message, setMessage] = useState(
    "Collect every diamond. One SSVEP decision equals one movement attempt.",
  );

  const [trialSeconds, setTrialSeconds] = useState(TAALON_DEFAULT_TRIAL_SECONDS);

  const [targets, setTargets] = useState<readonly SsvepTarget[]>(TAALON_DEFAULT_TARGETS);

  const [frequencyInputs, setFrequencyInputs] = useState(
    TAALON_DEFAULT_TARGETS.map((target) => target.frequencyHz.toFixed(2)),
  );

  const [trialPhase, setTrialPhase] = useState<MinerTrialPhase>("idle");

  const [countdownRemaining, setCountdownRemaining] = useState(TAALON_COUNTDOWN_SECONDS);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [lastDecision, setLastDecision] = useState<MinerLastDecision | null>(null);

  const [trialError, setTrialError] = useState<string | null>(null);

  const trialStartedAtRef = useRef(0);

  const countdownEndsAtRef = useRef(0);

  const classifyingRef = useRef(false);

  const trialPhaseRef = useRef<MinerTrialPhase>("idle");

  const remainingDiamonds = MINER_DIAMONDS.length - game.collected.length;

  const setPhase = useCallback((phase: MinerTrialPhase) => {
    trialPhaseRef.current = phase;

    setTrialPhase(phase);
  }, []);

  const cancelTrial = useCallback(() => {
    stopCapture();

    classifyingRef.current = false;

    setElapsedSeconds(0);

    setPhase("idle");

    setMessage("SSVEP selection cancelled.");
  }, [setPhase, stopCapture]);

  const applyDecision = useCallback(
    (classification: SsvepClassification) => {
      const direction = classification.direction;

      const result = moveMiner(game, direction);

      setGame(result.state);

      setLastDecision({
        direction,
        classification,
      });

      if (result.state.completed) {
        setMessage(
          `FBCCA: ${direction} (${classification.winnerHz.toFixed(2)} Hz). All diamonds collected.`,
        );
      } else if (result.collectedDiamond) {
        setMessage(
          `FBCCA: ${direction} (${classification.winnerHz.toFixed(2)} Hz). Diamond collected.`,
        );
      } else {
        setMessage(
          `FBCCA: ${direction} (${classification.winnerHz.toFixed(2)} Hz). ${result.message}`,
        );
      }
    },
    [game],
  );

  const classifyCapture = useCallback(async () => {
    if (classifyingRef.current || sampleRateHz === null) {
      return;
    }

    classifyingRef.current = true;

    setPhase("classifying");

    try {
      const requiredSamples = Math.round(trialSeconds * sampleRateHz);

      const window = takeLatestCapture(requiredSamples);

      stopCapture();

      const classification = await ssvepClassifierService.classify(window, sampleRateHz, targets);

      applyDecision(classification);

      setTrialError(null);

      setPhase("idle");
    } catch (error) {
      const text = getErrorMessage(error);

      setTrialError(text);

      setMessage(`No movement: ${text}`);

      setPhase("error");
    } finally {
      classifyingRef.current = false;
    }
  }, [
    applyDecision,
    sampleRateHz,
    setPhase,
    stopCapture,
    takeLatestCapture,
    targets,
    trialSeconds,
  ]);

  const beginTrial = useCallback(() => {
    if (eegState !== "streaming") {
      setMessage("Connect an EEG device before starting an SSVEP movement.");
      return;
    }

    if (game.completed) {
      return;
    }

    setTrialError(null);

    setElapsedSeconds(0);

    setCountdownRemaining(TAALON_COUNTDOWN_SECONDS);

    countdownEndsAtRef.current = performance.now() + TAALON_COUNTDOWN_SECONDS * 1000;

    setPhase("countdown");
  }, [eegState, game.completed, setPhase]);

  const resetGame = useCallback(() => {
    stopCapture();

    setGame(createInitialMinerGame());

    setLastDecision(null);

    setTrialError(null);

    setMessage("New expedition. Collect every diamond.");

    setPhase("idle");
  }, [setPhase, stopCapture]);

  const commitFrequencies = useCallback(() => {
    try {
      const parsed = frequencyInputs.map((value) => Number(value.replace(",", ".")));

      validateTaalonFrequencies(parsed);

      setTargets(
        TAALON_DEFAULT_TARGETS.map((target, index) => ({
          ...target,
          frequencyHz: parsed[index],
        })),
      );

      setFrequencyInputs(parsed.map((value) => value.toFixed(2)));

      setLastDecision(null);

      setMessage("Stimulus and FBCCA frequencies updated together.");
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }, [frequencyInputs]);

  useEffect(() => {
    if (trialPhase === "idle" || trialPhase === "classifying" || trialPhase === "error") {
      return;
    }

    let frame = 0;

    const tick = (now: number) => {
      const phase = trialPhaseRef.current;

      if (phase === "countdown") {
        const remainingMs = countdownEndsAtRef.current - now;

        const remaining = Math.max(1, Math.ceil(remainingMs / 1000));

        setCountdownRemaining(remaining);

        if (remainingMs <= 0) {
          beginCapture();

          trialStartedAtRef.current = now;

          setElapsedSeconds(0);

          setPhase("stimulating");
        }
      } else if (phase === "stimulating" || phase === "waiting-samples") {
        const elapsed = (now - trialStartedAtRef.current) / 1000;

        setElapsedSeconds(elapsed);

        const sampleRate = sampleRateHz;

        if (sampleRate !== null) {
          const required = Math.round(trialSeconds * sampleRate);

          if (elapsed >= trialSeconds && availableCaptureSamples() >= required) {
            void classifyCapture();
            return;
          }

          if (elapsed >= trialSeconds && phase !== "waiting-samples") {
            setPhase("waiting-samples");
          }

          if (elapsed > trialSeconds + TAALON_SAMPLE_TIMEOUT_SECONDS) {
            stopCapture();

            setTrialError("Too few EEG samples; trial cancelled.");

            setMessage("No movement: too few EEG samples.");

            setPhase("error");

            return;
          }
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    availableCaptureSamples,
    beginCapture,
    classifyCapture,
    sampleRateHz,
    setPhase,
    stopCapture,
    trialPhase,
    trialSeconds,
  ]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && trialPhaseRef.current !== "idle") {
        cancelTrial();
        return;
      }

      if (!import.meta.env.DEV || trialPhaseRef.current !== "idle") {
        return;
      }

      const direction: SsvepDirection | null =
        event.key === "ArrowUp"
          ? "UP"
          : event.key === "ArrowLeft"
            ? "LEFT"
            : event.key === "ArrowRight"
              ? "RIGHT"
              : event.key === "ArrowDown"
                ? "DOWN"
                : null;

      if (!direction) {
        return;
      }

      const result = moveMiner(game, direction);

      setGame(result.state);

      setMessage(`DEV keyboard: ${direction}. ${result.message}`);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelTrial, game]);

  const overlayPhase =
    trialPhase === "countdown" ||
    trialPhase === "stimulating" ||
    trialPhase === "waiting-samples" ||
    trialPhase === "classifying"
      ? trialPhase
      : null;

  return (
    <section className="miner-game">
      <header className="miner-game__header">
        <div>
          <h1>Deep Core Expedition</h1>

          <p>Collect all diamonds. Each FBCCA decision moves the miner by one cell.</p>
        </div>

        <div className="miner-game__stream">
          <span className={`miner-game__status-dot miner-game__status-dot--${eegState}`} />

          <div>
            <small>EEG STREAM</small>

            <strong>{eegState.toUpperCase()}</strong>
          </div>

          <div>
            <small>RATE</small>

            <strong>{sampleRateHz ?? "--"} Hz</strong>
          </div>

          <div>
            <small>CHANNELS</small>

            <strong>{channelCount || "--"}</strong>
          </div>
        </div>
      </header>

      <div className="miner-game__layout">
        <main className="miner-game__board-panel">
          <div className="miner-game__mission-bar">
            <div>
              <small>DIAMONDS</small>

              <strong>
                {game.collected.length}
                {" / "}
                {MINER_DIAMONDS.length}
              </strong>
            </div>

            <div>
              <small>MOVES</small>

              <strong>{game.moves}</strong>
            </div>

            <div>
              <small>REMAINING</small>

              <strong>{remainingDiamonds}</strong>
            </div>

            <div className="miner-game__mission-message">{message}</div>
          </div>

          <div
            className="miner-game__board"
            style={{
              gridTemplateColumns: `repeat(${MINER_BOARD_WIDTH}, minmax(0, 1fr))`,
            }}
          >
            {Array.from(
              {
                length: MINER_BOARD_WIDTH * MINER_BOARD_HEIGHT,
              },
              (_, index) => {
                const x = index % MINER_BOARD_WIDTH;

                const y = Math.floor(index / MINER_BOARD_WIDTH);

                const position: GridPosition = [x, y];

                const cellKey = positionKey(position);

                const isWall = wallKeys.has(cellKey);

                const isMiner = game.miner[0] === x && game.miner[1] === y;

                const diamond = MINER_DIAMONDS.find(
                  (candidate) => positionKey(candidate.position) === cellKey,
                );

                const collected = diamond ? game.collected.includes(diamond.id) : false;

                return (
                  <div
                    className={`miner-game__cell ${
                      isWall ? "miner-game__cell--wall" : "miner-game__cell--open"
                    }`}
                    key={cellKey}
                  >
                    {isWall ? (
                      <div className="miner-game__rock">
                        <RockIcon />
                      </div>
                    ) : null}

                    {diamond && !collected ? (
                      <div className="miner-game__diamond">
                        <DiamondIcon />
                      </div>
                    ) : null}

                    {isMiner ? (
                      <div className="miner-game__miner">
                        <MinerIcon />
                      </div>
                    ) : null}
                  </div>
                );
              },
            )}
          </div>

          <div className="miner-game__legend">
            <span>
              <i className="miner-game__legend-miner" />
              MINER
            </span>

            <span>
              <i className="miner-game__legend-diamond" />
              DIAMOND
            </span>

            <span>
              <i className="miner-game__legend-rock" />
              ROCK
            </span>
          </div>
        </main>

        <aside className="miner-game__control-panel">
          <div className="miner-game__section">
            <span className="miner-game__section-label">BCI CONTROL</span>

            <h2>Next movement</h2>

            <button
              className="miner-game__primary"
              disabled={eegState !== "streaming" || game.completed || trialPhase !== "idle"}
              onClick={beginTrial}
              type="button"
            >
              SELECT WITH GAZE
            </button>

            {eegState === "error" ? (
              <div className="miner-game__error">
                <span>EEG ERROR</span>

                <p>{eegError}</p>

                <button type="button" onClick={retryEEG}>
                  RETRY STREAM
                </button>
              </div>
            ) : null}
          </div>

          <div className="miner-game__section">
            <div className="miner-game__section-heading">
              <span className="miner-game__section-label">SSVEP TARGETS</span>

              <button type="button" onClick={commitFrequencies}>
                APPLY
              </button>
            </div>

            <div className="miner-game__frequency-list">
              {targets.map((target, index) => (
                <label key={target.direction}>
                  <span>{target.direction}</span>

                  <input
                    inputMode="decimal"
                    value={frequencyInputs[index]}
                    onChange={(event) => {
                      const next = [...frequencyInputs];

                      next[index] = event.target.value;

                      setFrequencyInputs(next);
                    }}
                  />

                  <small>Hz</small>
                </label>
              ))}
            </div>
          </div>

          <div className="miner-game__section">
            <span className="miner-game__section-label">TRIAL WINDOW</span>

            <div className="miner-game__duration">
              <button
                type="button"
                disabled={trialSeconds <= TAALON_MIN_TRIAL_SECONDS}
                onClick={() => {
                  setTrialSeconds(
                    Math.max(TAALON_MIN_TRIAL_SECONDS, trialSeconds - TAALON_TRIAL_STEP_SECONDS),
                  );
                }}
              >
                −
              </button>

              <strong>{trialSeconds.toFixed(1)} s</strong>

              <button
                type="button"
                disabled={trialSeconds >= TAALON_MAX_TRIAL_SECONDS}
                onClick={() => {
                  setTrialSeconds(
                    Math.min(TAALON_MAX_TRIAL_SECONDS, trialSeconds + TAALON_TRIAL_STEP_SECONDS),
                  );
                }}
              >
                +
              </button>
            </div>

            <p className="miner-game__hint">
              Source game default: 4.0 s. Adjustable 4–10 s in 0.5 s steps.
            </p>
          </div>

          <div className="miner-game__section">
            <span className="miner-game__section-label">LAST FBCCA</span>

            {lastDecision ? (
              <>
                <div className="miner-game__winner">
                  <span>{lastDecision.direction}</span>

                  <strong>{lastDecision.classification.winnerHz.toFixed(2)} Hz</strong>
                </div>

                <div className="miner-game__scores">
                  {targets.map((target) => (
                    <div key={target.direction}>
                      <span>{target.direction}</span>

                      <small>
                        {lastDecision.classification.scores[String(target.frequencyHz)]?.toFixed(
                          4,
                        ) ?? "--"}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="miner-game__hint">No SSVEP decision yet.</p>
            )}
          </div>

          <button className="miner-game__secondary" type="button" onClick={resetGame}>
            NEW EXPEDITION
          </button>

          {import.meta.env.DEV ? (
            <p className="miner-game__dev-note">DEV: arrow keys move the miner without EEG.</p>
          ) : null}
        </aside>
      </div>

      {overlayPhase ? (
        <SsvepOverlay
          phase={overlayPhase}
          targets={targets}
          countdownRemaining={countdownRemaining}
          trialSeconds={trialSeconds}
          elapsedSeconds={elapsedSeconds}
          onCancel={cancelTrial}
        />
      ) : null}

      {trialPhase === "error" ? (
        <div className="miner-game__trial-error-banner">
          <span>SSVEP TRIAL ERROR</span>

          <p>{trialError}</p>

          <button
            type="button"
            onClick={() => {
              setPhase("idle");
            }}
          >
            CLOSE
          </button>
        </div>
      ) : null}

      {game.completed ? (
        <div className="miner-game__complete">
          <div className="miner-game__complete-card">
            <span>EXPEDITION COMPLETE</span>

            <DiamondIcon />

            <h2>All diamonds collected</h2>

            <p>
              {MINER_DIAMONDS.length} / {MINER_DIAMONDS.length} diamonds · {game.moves} moves
            </p>

            <button type="button" onClick={resetGame}>
              PLAY AGAIN
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

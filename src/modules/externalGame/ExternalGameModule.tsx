import { useEffect, useState } from "react";

import { CloudDownload, FolderOpen, Play, RotateCcw, Square } from "lucide-react";

import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";

import { deviceManager } from "../../core/devices/deviceManager";

import type { DeviceInfo } from "../../core/devices/models/device";

import type { NeuroStateStatus, NeuroStateValues } from "../../core/neurostate";

import { chooseGameExecutable } from "../../core/games/gameProcess";

import { loadLocalBuild, saveLocalBuild, type ExternalGame } from "./externalGame";

import { useGameProcess, type GameProcessState } from "./hooks/useGameProcess";

import { useGameRelease, type GameReleaseSnapshot } from "./hooks/useGameRelease";

import { useNeuroState } from "./hooks/useNeuroState";

import "./styles/externalGame.css";

interface ExternalGameModuleProps extends KNeuronModuleProps {
  game: ExternalGame;
  thumbnail?: string;
}

type Tone = "neutral" | "live" | "warning" | "error";

interface SignalSummary {
  label: string;
  tone: Tone;
  detail: string;
}

function summarizeSignal(
  status: Readonly<NeuroStateStatus>,
  values: Readonly<NeuroStateValues> | null,
): SignalSummary {
  switch (status.state) {
    case "idle":
    case "unavailable":
      return {
        label: "NO CAP",
        tone: "neutral",
        detail: `${status.message ?? "Connect an EEG cap on the Device page."} You can still play; the game then behaves as if there were no signal.`,
      };

    case "starting":
      return { label: "STARTING", tone: "neutral", detail: "Starting neurostate..." };

    case "waiting-for-stream":
      return { label: "STARTING", tone: "neutral", detail: "Waiting for the EEG stream..." };

    case "error":
      return {
        label: "ERROR",
        tone: "error",
        detail: status.message ?? "neurostate stopped.",
      };

    case "running":
      break;
  }

  switch (values?.state) {
    case undefined:
    case "no_signal":
      return {
        label: "NO SIGNAL",
        tone: "error",
        detail: "No EEG is arriving. Check that the cap is on and close to the computer.",
      };

    case "poor_signal":
      return {
        label: "POOR SIGNAL",
        tone: "warning",
        detail:
          "The signal is too noisy to use. Adjust the electrodes until the signal quality rises.",
      };

    case "calibrating":
      return {
        label: "BASELINE",
        tone: "warning",
        detail:
          "Measuring your resting baseline. Sit still with your eyes open for about a minute; the game ignores the values until it ends.",
      };

    case "uncalibrated":
    case "ok":
      return {
        label: "LIVE",
        tone: "live",
        detail: "The game is receiving your attention and relaxation.",
      };
  }
}

function launchLabel(state: GameProcessState): string {
  switch (state) {
    case "checking":
      return "CHECKING...";
    case "stopped":
      return "PLAY";
    case "launching":
      return "STARTING...";
    case "running":
      return "QUIT GAME";
    case "stopping":
      return "QUITTING...";
  }
}

function installLabel(release: GameReleaseSnapshot): string {
  if (!release.progress) {
    return "CHECKING FOR UPDATES...";
  }

  if (release.progress.phase === "unpacking") {
    return "UNPACKING...";
  }

  const percent = Math.floor((release.progress.downloaded * 100) / (release.progress.total || 1));

  return `DOWNLOADING ${percent}%`;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/**
 * What PLAY will run, for the latest-release source.
 */
function describeRelease(release: GameReleaseSnapshot, repository: string): string {
  const { installed, latest } = release;

  if (release.checking) {
    return "Checking GitHub for the latest release...";
  }

  if (installed && latest && installed.version !== latest.version) {
    return `${installed.version} installed. PLAY first downloads ${latest.version} (${megabytes(latest.size)}).`;
  }

  if (installed) {
    return latest ? `${installed.version}, the latest release.` : `${installed.version} installed.`;
  }

  if (latest) {
    return `PLAY downloads ${latest.version} (${megabytes(latest.size)}) from ${repository}.`;
  }

  return "Not installed yet.";
}

function splitPath(path: string): { folder: string; file: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

  return {
    folder: index >= 0 ? path.slice(0, index + 1) : "",
    file: index >= 0 ? path.slice(index + 1) : path,
  };
}

function useActiveDevice(): Readonly<DeviceInfo> | null {
  const [device, setDevice] = useState(() => deviceManager.getSnapshot().activeDeviceInfo);

  useEffect(() => {
    return deviceManager.subscribe((snapshot) => {
      setDevice(snapshot.activeDeviceInfo);
    });
  }, []);

  return device;
}

function Meter({ label, value, dim }: { label: string; value: number | null; dim: boolean }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={`game-meter${dim ? " game-meter--dim" : ""}`}>
      <div className="game-meter__label">
        <small>{label}</small>
        <span>{value == null ? "--" : Math.round(value)}</span>
      </div>
      <div className="game-meter__track">
        <div style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Module screen for a native game: install its latest release (or use a local
 * build), run it, and follow the brain metrics neurostate sends it.
 */
export function ExternalGameModule({ game, thumbnail, onRequestClose }: ExternalGameModuleProps) {
  const [localBuild, setLocalBuild] = useState<string | null>(() => loadLocalBuild(game.id));
  const [actionError, setActionError] = useState<string | null>(null);

  const process = useGameProcess(game.id);
  const release = useGameRelease(game.id);
  const brain = useNeuroState();
  const device = useActiveDevice();

  const signal = summarizeSignal(brain.status, brain.values);
  const usable = brain.values != null && brain.values.poorSignalLevel === 0;
  const running = process.state === "running";
  const busy = ["checking", "launching", "stopping"].includes(process.state) || release.installing;

  async function handleChooseLocalBuild(): Promise<void> {
    setActionError(null);

    try {
      const chosen = await chooseGameExecutable(game.name);

      if (chosen) {
        setLocalBuild(chosen);
        saveLocalBuild(game.id, chosen);
      }
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  function handleUseReleases(): void {
    setLocalBuild(null);
    saveLocalBuild(game.id, null);
  }

  async function handlePlay(): Promise<void> {
    if (running) {
      process.stop();
      return;
    }

    setActionError(null);

    if (localBuild) {
      process.launch(localBuild);
      return;
    }

    try {
      const build = await release.ensureLatest();
      process.launch(build.executable);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  }

  const path = localBuild ? splitPath(localBuild) : null;
  const progress = release.progress
    ? Math.floor((release.progress.downloaded * 100) / (release.progress.total || 1))
    : 0;

  // Without GitHub, PLAY still starts the installed release; say so instead of failing.
  const releaseNote =
    !localBuild && release.error
      ? release.installed
        ? `Couldn't check for a newer release (${release.error}). PLAY starts the installed ${release.installed.version}.`
        : release.error
      : null;
  const gameError = actionError ?? process.error;

  return (
    <section className="game-module">
      <header className="game-module__bar">
        <div className="game-module__title">
          <small>NATIVE GAME</small>
          <strong>{game.name}</strong>
        </div>

        <div className="game-module__bar-actions">
          <span className={`game-pill game-pill--${running ? "live" : "neutral"}`}>
            {running ? "RUNNING" : "NOT RUNNING"}
          </span>
          <span className={`game-pill game-pill--${signal.tone}`}>{signal.label}</span>
          <button type="button" className="game-module__exit" onClick={onRequestClose}>
            EXIT MODULE
          </button>
        </div>
      </header>

      <div className="game-module__body">
        <div className="game-module__hero">
          {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}

          <div className="game-module__controls">
            <h2>Brain controls</h2>
            <ul>
              {game.controls.map((control) => (
                <li key={control.metric}>
                  <strong>{control.metric === "attention" ? "Attention" : "Relaxation"}</strong>
                  <span>{control.effect}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="game-module__panels">
          <section className="game-panel" aria-labelledby={`${game.id}-game-heading`}>
            <h2 id={`${game.id}-game-heading`}>Game</h2>

            <div className="game-panel__source">
              <div>
                <small>{path ? "LOCAL BUILD" : "LATEST RELEASE"}</small>

                {path ? (
                  <p className="game-panel__path" title={localBuild ?? undefined}>
                    {/* The paragraph is right-to-left so a long path is cut at its start;
                        the path itself must stay left-to-right. */}
                    <bdi dir="ltr">
                      <span>{path.folder}</span>
                      <strong>{path.file}</strong>
                    </bdi>
                  </p>
                ) : (
                  <p className="game-panel__release">{describeRelease(release, game.repository)}</p>
                )}
              </div>

              {path ? (
                <button
                  type="button"
                  className="game-button game-button--secondary"
                  onClick={handleUseReleases}
                  disabled={running || busy}
                  title={`Play the latest release from ${game.repository} again.`}
                >
                  <CloudDownload size={14} />
                  <span>USE RELEASES</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="game-button game-button--secondary"
                  onClick={() => {
                    void handleChooseLocalBuild();
                  }}
                  disabled={running || busy}
                  title="Play a build from your computer instead, e.g. one not released yet."
                >
                  <FolderOpen size={14} />
                  <span>LOCAL BUILD...</span>
                </button>
              )}
            </div>

            <button
              type="button"
              className={`game-button game-button--primary${running ? " is-running" : ""}`}
              onClick={() => {
                void handlePlay();
              }}
              disabled={busy || (!running && !path && release.checking)}
            >
              {running ? <Square size={16} /> : <Play size={16} />}
              <span>{release.installing ? installLabel(release) : launchLabel(process.state)}</span>
            </button>

            {release.installing ? (
              <div
                className="game-panel__progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div style={{ width: `${progress}%` }} />
              </div>
            ) : null}

            {releaseNote ? (
              <p className={release.installed ? "game-panel__note" : "game-panel__error"}>
                {releaseNote}
              </p>
            ) : null}

            {running ? (
              <p className="game-panel__note">
                The game runs in its own window. It keeps running if you leave this module; it
                closes with KNeuron.
              </p>
            ) : null}

            {process.lastExitCode != null ? (
              <p className="game-panel__error">The game exited with code {process.lastExitCode}.</p>
            ) : null}

            {gameError ? <p className="game-panel__error">{gameError}</p> : null}
          </section>

          <section className="game-panel" aria-labelledby={`${game.id}-signal-heading`}>
            <h2 id={`${game.id}-signal-heading`}>Brain signal</h2>

            <dl className="game-panel__facts">
              <div>
                <dt>EEG cap</dt>
                <dd>{device?.name ?? "None connected"}</dd>
              </div>
              <div>
                <dt>neurostate</dt>
                <dd className={`is-${signal.tone}`}>{signal.label}</dd>
              </div>
            </dl>

            <p className={`game-panel__status game-panel__status--${signal.tone}`}>
              {signal.detail}
            </p>

            <Meter label="ATTENTION" value={brain.values?.attention ?? null} dim={!usable} />
            <Meter label="RELAXATION" value={brain.values?.relaxation ?? null} dim={!usable} />
            <Meter label="SIGNAL QUALITY" value={brain.values?.quality ?? null} dim={false} />

            <div className="game-panel__footer">
              {brain.status.state === "running" || brain.status.state === "error" ? (
                <button
                  type="button"
                  className="game-button game-button--secondary"
                  onClick={brain.restart}
                  title="Restart neurostate: it measures your resting baseline again."
                >
                  <RotateCcw size={14} />
                  <span>{brain.status.state === "error" ? "RETRY" : "NEW BASELINE"}</span>
                </button>
              ) : null}

              {brain.status.outputs.length > 0 ? (
                <ul className="game-panel__outputs" aria-label="neurostate outputs">
                  {brain.status.outputs.map((output) => (
                    <li key={output}>{output}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

/**
 * A native game KNeuron launches as its own process.
 *
 * The game reads attention and relaxation from neurostate itself (JSON over
 * TCP on 127.0.0.1:13855); KNeuron runs neurostate on the connected cap,
 * installs the game's latest GitHub release, starts it, and shows the values
 * the game receives.
 */
export interface ExternalGame {
  /**
   * Module ID, also the game ID the Tauri shell knows.
   */
  id: string;

  name: string;

  /**
   * GitHub repository publishing the game's builds, e.g. "KN-Neuron/Neurosniper".
   */
  repository: string;

  /**
   * What each brain metric does in the game.
   */
  controls: readonly ExternalGameControl[];
}

export interface ExternalGameControl {
  metric: "attention" | "relaxation";
  effect: string;
}

const STORAGE_PREFIX = "kneuron.games.";

/**
 * Before releases were installed automatically, the chosen executable was
 * always used. It is not carried over: releases are now the default.
 */
const LEGACY_EXECUTABLE_SUFFIX = ".executable";

const LOCAL_BUILD_SUFFIX = ".localBuild";

/**
 * A local build the user chose to play instead of the latest release, e.g. to
 * test an unreleased version. Remembered per machine.
 */
export function loadLocalBuild(gameId: string): string | null {
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${gameId}${LEGACY_EXECUTABLE_SUFFIX}`);

    return window.localStorage.getItem(`${STORAGE_PREFIX}${gameId}${LOCAL_BUILD_SUFFIX}`);
  } catch {
    return null;
  }
}

export function saveLocalBuild(gameId: string, executable: string | null): void {
  const key = `${STORAGE_PREFIX}${gameId}${LOCAL_BUILD_SUFFIX}`;

  try {
    if (executable) {
      window.localStorage.setItem(key, executable);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Not remembered; the choice lasts until KNeuron closes.
  }
}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * Native games launched as separate processes by the Tauri shell
 * (src-tauri/src/games.rs). The games read brain metrics from neurostate on
 * their own; KNeuron only starts and stops them.
 */

export interface GameExitedEvent {
  gameId: string;
  /**
   * Exit code, or null when the game was killed by a signal.
   */
  code: number | null;
}

const GAME_EXITED_EVENT = "game-exited";

/**
 * Extension of a Unity player executable on this platform, as the shell expects it.
 */
export const GAME_EXECUTABLE_EXTENSION = navigator.userAgent.includes("Windows") ? "exe" : "x86_64";

/**
 * Starts the game and resolves with its process id.
 *
 * The shell only accepts the game's own player executable, e.g.
 * Neurosniper.x86_64 on Linux or NeuroSniper.exe on Windows.
 */
export function launchGame(gameId: string, executable: string): Promise<number> {
  return invoke<number>("launch_game", { gameId, executable });
}

/**
 * Asks the game to quit; it is killed if it hasn't after a few seconds.
 */
export function stopGame(gameId: string): Promise<void> {
  return invoke<void>("stop_game", { gameId });
}

export function isGameRunning(gameId: string): Promise<boolean> {
  return invoke<boolean>("is_game_running", { gameId });
}

export function onGameExited(listener: (event: GameExitedEvent) => void): Promise<UnlistenFn> {
  return listen<GameExitedEvent>(GAME_EXITED_EVENT, (event) => {
    listener(event.payload);
  });
}

/**
 * A game build installed from the game's GitHub releases
 * (src-tauri/src/releases.rs).
 */
export interface InstalledGame {
  /**
   * Release tag, e.g. "v1.1.0".
   */
  version: string;
  executable: string;
}

export interface LatestGameRelease {
  version: string;
  assetName: string;
  /**
   * Download size in bytes.
   */
  size: number;
  pageUrl: string;
}

export interface GameInstallProgress {
  gameId: string;
  phase: "downloading" | "unpacking";
  downloaded: number;
  total: number;
}

const INSTALL_PROGRESS_EVENT = "game-install-progress";

export function getInstalledGame(gameId: string): Promise<InstalledGame | null> {
  return invoke<InstalledGame | null>("installed_game", { gameId });
}

export function getLatestGameRelease(gameId: string): Promise<LatestGameRelease> {
  return invoke<LatestGameRelease>("latest_game_release", { gameId });
}

/**
 * Installs the game's latest release unless it is already installed, and
 * resolves with it. The download is checked against GitHub's SHA-256 digest.
 */
export function installLatestGame(gameId: string): Promise<InstalledGame> {
  return invoke<InstalledGame>("install_latest_game", { gameId });
}

export function onGameInstallProgress(
  listener: (progress: GameInstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<GameInstallProgress>(INSTALL_PROGRESS_EVENT, (event) => {
    listener(event.payload);
  });
}

/**
 * Lets the user pick the game's executable. Resolves with null if cancelled.
 */
export async function chooseGameExecutable(gameName: string): Promise<string | null> {
  const selected = await open({
    title: `Choose the ${gameName} executable`,
    multiple: false,
    directory: false,
    filters: [
      {
        name: `${gameName} (*.${GAME_EXECUTABLE_EXTENSION})`,
        extensions: [GAME_EXECUTABLE_EXTENSION],
      },
    ],
  });

  return typeof selected === "string" ? selected : null;
}

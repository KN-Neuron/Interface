import { useCallback, useEffect, useState } from "react";

import {
  getInstalledGame,
  getLatestGameRelease,
  installLatestGame,
  onGameInstallProgress,
  type GameInstallProgress,
  type InstalledGame,
  type LatestGameRelease,
} from "../../../core/games/gameProcess";

export interface GameReleaseSnapshot {
  installed: InstalledGame | null;
  latest: LatestGameRelease | null;
  /**
   * Why the latest release could not be checked or installed.
   */
  error: string | null;
  checking: boolean;
  installing: boolean;
  progress: GameInstallProgress | null;
  /**
   * Installs the latest release if it isn't already, and resolves with the
   * build to play. Without GitHub, it falls back to the installed build.
   */
  ensureLatest: () => Promise<InstalledGame>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The game's installed release and its latest one on GitHub.
 */
export function useGameRelease(gameId: string): GameReleaseSnapshot {
  const [installed, setInstalled] = useState<InstalledGame | null>(null);
  const [latest, setLatest] = useState<LatestGameRelease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<GameInstallProgress | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void onGameInstallProgress((next) => {
      if (!disposed && next.gameId === gameId) {
        setProgress(next);
      }
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    });

    void Promise.allSettled([getInstalledGame(gameId), getLatestGameRelease(gameId)]).then(
      ([installedResult, latestResult]) => {
        if (disposed) {
          return;
        }

        if (installedResult.status === "fulfilled") {
          setInstalled(installedResult.value);
        }

        if (latestResult.status === "fulfilled") {
          setLatest(latestResult.value);
        } else {
          setError(errorMessage(latestResult.reason));
        }

        setChecking(false);
      },
    );

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [gameId]);

  const ensureLatest = useCallback(async (): Promise<InstalledGame> => {
    setInstalling(true);
    setProgress(null);
    setError(null);

    try {
      const game = await installLatestGame(gameId);

      setInstalled(game);
      setLatest((current) => (current ? { ...current, version: game.version } : current));

      return game;
    } catch (reason) {
      setError(errorMessage(reason));

      // Offline or rate-limited: play what is installed rather than nothing.
      const fallback = await getInstalledGame(gameId).catch(() => null);

      if (fallback) {
        return fallback;
      }

      throw reason;
    } finally {
      setInstalling(false);
      setProgress(null);
    }
  }, [gameId]);

  return {
    installed,
    latest,
    error,
    checking,
    installing,
    progress,
    ensureLatest,
  };
}

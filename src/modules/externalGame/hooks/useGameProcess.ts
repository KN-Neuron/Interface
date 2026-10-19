import { useCallback, useEffect, useState } from "react";

import { isGameRunning, launchGame, onGameExited, stopGame } from "../../../core/games/gameProcess";

export type GameProcessState = "checking" | "stopped" | "launching" | "running" | "stopping";

export interface GameProcessSnapshot {
  state: GameProcessState;
  /**
   * Exit code of the last run, when it ended with one other than 0.
   */
  lastExitCode: number | null;
  error: string | null;
  launch: (executable: string) => void;
  stop: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The game's process, which keeps running when the module is closed: reopening
 * the module picks it up again.
 */
export function useGameProcess(gameId: string): GameProcessSnapshot {
  const [state, setState] = useState<GameProcessState>("checking");
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void onGameExited((event) => {
      if (disposed || event.gameId !== gameId) {
        return;
      }

      setState("stopped");
      setLastExitCode(event.code === 0 ? null : event.code);
    }).then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    });

    void isGameRunning(gameId)
      .then((running) => {
        if (!disposed) {
          setState(running ? "running" : "stopped");
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setState("stopped");
          setError(errorMessage(reason));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [gameId]);

  const launch = useCallback(
    (executable: string) => {
      setState("launching");
      setError(null);
      setLastExitCode(null);

      launchGame(gameId, executable)
        .then(() => {
          setState("running");
        })
        .catch((reason: unknown) => {
          setState("stopped");
          setError(errorMessage(reason));
        });
    },
    [gameId],
  );

  const stop = useCallback(() => {
    setState("stopping");

    stopGame(gameId).catch((reason: unknown) => {
      setError(errorMessage(reason));
    });
  }, [gameId]);

  return {
    state,
    lastExitCode,
    error,
    launch,
    stop,
  };
}

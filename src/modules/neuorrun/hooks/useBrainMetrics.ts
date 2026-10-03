import { useCallback, useEffect, useState } from "react";

import {
  brainMetricsService,
  type BrainMetricsHandle,
  type BrainMetricsSnapshot,
} from "../../../core/brainMetrics";

export type NeuorrunBrainState = "starting" | "live" | "unavailable";

export interface NeuorrunBrainSnapshot {
  state: NeuorrunBrainState;
  metrics: Readonly<BrainMetricsSnapshot> | null;
  message: string | null;
  retry: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBrainMetrics(): NeuorrunBrainSnapshot {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<NeuorrunBrainState>("starting");
  const [metrics, setMetrics] = useState<Readonly<BrainMetricsSnapshot> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const retry = useCallback(() => {
    setState("starting");
    setMessage(null);
    setMetrics(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handle: BrainMetricsHandle | null = null;

    async function start(): Promise<void> {
      // Keep state transitions out of the synchronous effect body.
      await Promise.resolve();

      try {
        const acquired = brainMetricsService.acquire((snapshot) => {
          if (cancelled) {
            return;
          }

          setMetrics(snapshot);
          setState("live");
          setMessage(null);
        });

        if (cancelled) {
          acquired.release();
          return;
        }

        handle = acquired;
        setState("live");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setState("unavailable");
        setMessage(errorMessage(error));
      }
    }

    void start();

    return () => {
      cancelled = true;
      handle?.release();
      handle = null;
    };
  }, [generation]);

  return {
    state,
    metrics,
    message,
    retry,
  };
}

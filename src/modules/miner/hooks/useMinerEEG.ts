import { useCallback, useEffect, useRef, useState } from "react";

import { eegStreamService, type EEGStreamHandle } from "../../../core/eeg";

import { TAALON_SSVEP_CHANNELS } from "../../../core/ssvep";

import { TrialSampleCollector } from "../eeg/TrialSampleCollector";

export type MinerEEGState = "starting" | "streaming" | "error";

export interface MinerEEGSnapshot {
  state: MinerEEGState;
  error: string | null;
  sampleRateHz: number | null;
  channelCount: number;
  retry: () => void;
  beginCapture: () => void;
  stopCapture: () => void;
  availableCaptureSamples: () => number;
  takeLatestCapture: (sampleCount: number) => number[][];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useMinerEEG(): MinerEEGSnapshot {
  const [retryGeneration, setRetryGeneration] = useState(0);

  const [state, setState] = useState<MinerEEGState>("starting");

  const [error, setError] = useState<string | null>(null);

  const [sampleRateHz, setSampleRateHz] = useState<number | null>(null);

  const [channelCount, setChannelCount] = useState(0);

  const collectorRef = useRef(new TrialSampleCollector());

  const retry = useCallback(() => {
    setState("starting");
    setError(null);
    setSampleRateHz(null);
    setChannelCount(0);

    setRetryGeneration((value) => value + 1);
  }, []);

  const beginCapture = useCallback(() => {
    collectorRef.current.begin(channelCount);
  }, [channelCount]);

  const stopCapture = useCallback(() => {
    collectorRef.current.stop();
  }, []);

  const availableCaptureSamples = useCallback(() => collectorRef.current.sampleCount(), []);

  const takeLatestCapture = useCallback((count: number) => collectorRef.current.latest(count), []);

  useEffect(() => {
    let cancelled = false;

    let handle: EEGStreamHandle | null = null;

    async function start(): Promise<void> {
      try {
        const acquired = await eegStreamService.acquire({
          channels: [...TAALON_SSVEP_CHANNELS],

          onBatch: (batch) => {
            if (cancelled) {
              return;
            }

            try {
              collectorRef.current.push(batch.values);
            } catch (batchError) {
              setState("error");

              setError(errorMessage(batchError));
            }
          },
        });

        if (cancelled) {
          await acquired.release();
          return;
        }

        handle = acquired;

        setSampleRateHz(acquired.streamInfo.sampleRateHz);

        setChannelCount(acquired.channels.length);

        setState("streaming");
      } catch (startError) {
        if (cancelled) {
          return;
        }

        setState("error");

        setError(errorMessage(startError));
      }
    }

    void start();

    const collector = collectorRef.current;

    return () => {
      cancelled = true;

      collector.stop();

      const currentHandle = handle;

      handle = null;

      if (currentHandle) {
        void currentHandle.release();
      }
    };
  }, [retryGeneration]);

  return {
    state,
    error,
    sampleRateHz,
    channelCount,
    retry,
    beginCapture,
    stopCapture,
    availableCaptureSamples,
    takeLatestCapture,
  };
}

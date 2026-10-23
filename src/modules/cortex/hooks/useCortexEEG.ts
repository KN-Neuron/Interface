import { useCallback, useEffect, useRef, useState } from "react";

import { eegStreamService, type EEGStreamHandle } from "../../../core/eeg";

import type { CortexProcessorSnapshot } from "../eeg/CortexSignalProcessor";

import type { CortexWorkerRequest, CortexWorkerResponse } from "../eeg/cortexWorkerProtocol";

import type { CortexEEGState } from "../models/cortex";

const EMPTY_PROCESSOR_SNAPSHOT: CortexProcessorSnapshot = {
  started: false,
  phase: "idle",
  fastActivityByLabel: {},
  bandActivityByLabel: {
    delta: {},
    theta: {},
    alpha: {},
    beta: {},
    gamma: {},
  },
  signalQualityByLabel: {},
  flatChannels: [],
  receivedSamples: 0,
  droppedSamples: 0,
};

export interface CortexEEGSnapshot extends CortexProcessorSnapshot {
  state: CortexEEGState;
  error: string | null;
  sampleRateHz: number | null;
  channelCount: number;
  lastSequence: number | null;
  retry: () => void;
  startExperience: () => void;
  stopExperience: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hardware-independent Cortex EEG hook.
 *
 * Device ownership remains outside Cortex. This hook acquires the global raw
 * EEG stream and forwards it to a worker that runs the visualization-specific
 * amplitude processing, keeping the main thread free for rendering.
 */
export function useCortexEEG(): CortexEEGSnapshot {
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [state, setState] = useState<CortexEEGState>("starting");
  const [error, setError] = useState<string | null>(null);
  const [sampleRateHz, setSampleRateHz] = useState<number | null>(null);
  const [channelCount, setChannelCount] = useState(0);
  const [lastSequence, setLastSequence] = useState<number | null>(null);
  const [processorSnapshot, setProcessorSnapshot] =
    useState<CortexProcessorSnapshot>(EMPTY_PROCESSOR_SNAPSHOT);

  const workerRef = useRef<Worker | null>(null);

  const send = useCallback((request: CortexWorkerRequest) => {
    workerRef.current?.postMessage(request);
  }, []);

  const retry = useCallback(() => {
    setState("starting");
    setError(null);
    setSampleRateHz(null);
    setChannelCount(0);
    setLastSequence(null);
    setProcessorSnapshot(EMPTY_PROCESSOR_SNAPSHOT);

    setRetryGeneration((generation) => generation + 1);
  }, []);

  const startExperience = useCallback(() => {
    send({ type: "start" });
  }, [send]);

  const stopExperience = useCallback(() => {
    send({ type: "stop" });
  }, [send]);

  useEffect(() => {
    let cancelled = false;
    let handle: EEGStreamHandle | null = null;

    const worker = new Worker(new URL("../eeg/cortexProcessorWorker.ts", import.meta.url), {
      type: "module",
    });

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<CortexWorkerResponse>) => {
      if (cancelled) {
        return;
      }

      const response = event.data;

      if (response.type === "snapshot") {
        setLastSequence(response.lastSequence);
        setProcessorSnapshot(response.snapshot);
        return;
      }

      setState("error");
      setError(response.message);
    };

    worker.onerror = (event) => {
      if (cancelled) {
        return;
      }

      setState("error");
      setError(event.message || "Cortex processing worker failed.");
    };

    let workerReady = false;

    async function start(): Promise<void> {
      try {
        const acquiredHandle = await eegStreamService.acquire({
          channels: "all",
          onBatch: (batch) => {
            if (cancelled) {
              return;
            }

            if (!workerReady) {
              return;
            }

            // The worker publishes snapshots at about 10 Hz.
            worker.postMessage({
              type: "batch",
              batch,
            } satisfies CortexWorkerRequest);
          },
        });

        if (cancelled) {
          await acquiredHandle.release();
          return;
        }

        handle = acquiredHandle;

        worker.postMessage({
          type: "init",
          sampleRateHz: acquiredHandle.streamInfo.sampleRateHz,
          channelLabels: acquiredHandle.channels.map((channel) => channel.label),
        } satisfies CortexWorkerRequest);

        workerReady = true;

        setSampleRateHz(acquiredHandle.streamInfo.sampleRateHz);
        setChannelCount(acquiredHandle.channels.length);
        setState("streaming");
      } catch (startError) {
        if (cancelled) {
          return;
        }

        setState("error");
        setError(getErrorMessage(startError));
      }
    }

    void start();

    return () => {
      cancelled = true;

      worker.terminate();

      if (workerRef.current === worker) {
        workerRef.current = null;
      }

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
    lastSequence,
    retry,
    startExperience,
    stopExperience,
    ...processorSnapshot,
  };
}

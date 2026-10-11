import type { EEGConsumerBatch } from "../../../core/eeg";

import type { CortexProcessorSnapshot } from "./CortexSignalProcessor";

/**
 * Messages between useCortexEEG (main thread) and cortexProcessorWorker.
 */
export type CortexWorkerRequest =
  | { type: "init"; sampleRateHz: number; channelLabels: readonly string[] }
  | { type: "batch"; batch: EEGConsumerBatch }
  | { type: "start" }
  | { type: "stop" };

export type CortexWorkerResponse =
  | { type: "snapshot"; snapshot: CortexProcessorSnapshot; lastSequence: number | null }
  | { type: "error"; message: string };

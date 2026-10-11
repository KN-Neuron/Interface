/// <reference lib="webworker" />

/**
 * Runs CortexSignalProcessor off the main thread.
 *
 * Welch band power over 32 channels costs several milliseconds every ~100 ms.
 * On the main thread that lands inside animation frames and makes camera
 * rotation stutter, so the UI thread only forwards batches and receives
 * snapshots here.
 */

import type { EEGConsumerBatch } from "../../../core/eeg";

import { CortexSignalProcessor } from "./CortexSignalProcessor";

import type { CortexWorkerRequest, CortexWorkerResponse } from "./cortexWorkerProtocol";

/**
 * Snapshots are published at about 10 Hz; Three.js interpolates between them.
 */
const PUBLISH_INTERVAL_MS = 90;

const scope = self as unknown as DedicatedWorkerGlobalScope;

let processor: CortexSignalProcessor | null = null;
let lastPublishAt = 0;
let lastSequence: number | null = null;

function publish(): void {
  if (!processor) {
    return;
  }

  lastPublishAt = performance.now();

  const response: CortexWorkerResponse = {
    type: "snapshot",
    snapshot: processor.snapshot(),
    lastSequence,
  };

  scope.postMessage(response);
}

function fail(error: unknown): void {
  const response: CortexWorkerResponse = {
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  };

  scope.postMessage(response);
}

scope.onmessage = (event: MessageEvent<CortexWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case "init":
        processor = new CortexSignalProcessor(request.sampleRateHz, request.channelLabels);
        lastSequence = null;
        publish();
        break;

      case "batch": {
        if (!processor) {
          return;
        }

        const batch: EEGConsumerBatch = request.batch;

        processor.processBatch(batch);
        lastSequence = batch.sequenceStart + batch.sampleCount - 1;

        if (performance.now() - lastPublishAt >= PUBLISH_INTERVAL_MS) {
          publish();
        }
        break;
      }

      case "start":
        processor?.startCalibration();
        publish();
        break;

      case "stop":
        processor?.stopExperience();
        publish();
        break;
    }
  } catch (error) {
    fail(error);
  }
};

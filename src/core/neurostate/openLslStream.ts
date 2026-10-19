import type { DeviceManager } from "../devices/deviceManager";

import {
  isLslStreamSource,
  type LslStreamDescriptor,
  type LslStreamSource,
} from "../devices/contracts/LslStreamSource";

import type { EEGStreamHandle, EEGStreamService } from "../eeg";

/**
 * The connected cap neurostate can read, or why there is none. Having none is
 * not a failure: the UI asks the user to connect a cap.
 */
export function findLslSource(
  manager: DeviceManager,
): { adapter: LslStreamSource } | { unavailable: string } {
  const adapter = manager.getActiveAdapter();

  if (!adapter || adapter.getStatus().state !== "connected") {
    return { unavailable: "Connect an EEG cap on the Device page." };
  }

  if (!isLslStreamSource(adapter)) {
    return { unavailable: `${adapter.info.name} does not provide raw EEG for neurostate.` };
  }

  return { adapter };
}

export interface OpenLslStream {
  stream: Readonly<LslStreamDescriptor>;
  /**
   * Keeps the physical EEG stream, and with it the LSL stream, running.
   * Release it when done.
   */
  handle: EEGStreamHandle;
}

/**
 * Starts the cap's EEG stream and returns its LSL republication, for the
 * neurostate sidecar to read.
 */
export async function openLslStream(
  adapter: LslStreamSource,
  eeg: EEGStreamService,
): Promise<OpenLslStream> {
  const handle = await eeg.acquire({ channels: "all" });
  const stream = adapter.getLslStream();

  if (!stream) {
    await handle.release();
    throw new Error(adapter.getLslError() ?? "The EEG stream is not published on LSL.");
  }

  return { stream, handle };
}

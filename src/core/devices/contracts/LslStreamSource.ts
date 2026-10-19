import type { DeviceAdapter } from "./DeviceAdapter";

import type { EEGDeviceAdapter } from "./EEGDeviceAdapter";

import { isEEGDeviceAdapter } from "./deviceGuards";

/**
 * An EEG stream republished on Lab Streaming Layer (LSL).
 */
export interface LslStreamDescriptor {
  /**
   * LSL stream name, unique to the connected headset.
   */
  name: string;

  /**
   * neurostate profile tuned for the cap, e.g. "brainaccess-midi".
   */
  neurostateProfile: string;
}

/**
 * Optional capability of EEG adapters that republish their stream on LSL while
 * it runs.
 *
 * neurostate reads that stream to compute attention and relaxation, so modules
 * such as the native games get brain metrics from any EEG cap. The physical
 * stream is started through EEGStreamService as usual.
 */
export interface LslStreamSource extends EEGDeviceAdapter {
  /**
   * The published stream, or null while the EEG stream is not running or could
   * not be republished.
   */
  getLslStream(): Readonly<LslStreamDescriptor> | null;

  /**
   * Why the stream could not be republished, or null.
   */
  getLslError(): string | null;
}

export function isLslStreamSource(adapter: DeviceAdapter): adapter is LslStreamSource {
  return (
    isEEGDeviceAdapter(adapter) &&
    typeof (adapter as Partial<LslStreamSource>).getLslStream === "function" &&
    typeof (adapter as Partial<LslStreamSource>).getLslError === "function"
  );
}

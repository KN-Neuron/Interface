/**
 * What neurostate says its values can be trusted for (its `state` field).
 */
export type NeuroStateSignalState =
  "no_signal" | "poor_signal" | "calibrating" | "uncalibrated" | "ok";

/**
 * One update published by neurostate, about four times a second.
 */
export interface NeuroStateValues {
  /**
   * LSL timestamp of the EEG window the values describe.
   */
  t: number;

  /**
   * 0-100, relative to the user's resting baseline (50 means no change).
   */
  attention: number;

  /**
   * 0-100, relative to the user's resting baseline.
   */
  relaxation: number;

  /**
   * Signal quality, 0-100; 0 means no usable signal.
   */
  quality: number;

  state: NeuroStateSignalState;

  calibrated: boolean;

  /**
   * ThinkGear-style signal problem level, 0-200: exactly 0 whenever the values
   * are usable, as on neurostate's ThinkGear output.
   */
  poorSignalLevel: number;

  /**
   * Unix time in milliseconds when KNeuron received the update.
   */
  receivedAtMs: number;
}

export type NeuroStateValuesListener = (values: Readonly<NeuroStateValues>) => void;

/**
 * Lifecycle of the neurostate service run by KNeuron.
 *
 * - idle: not running.
 * - unavailable: no connected device streams raw EEG for neurostate.
 * - starting: starting the EEG stream and the neurostate sidecar.
 * - waiting-for-stream: neurostate is looking for the cap's LSL stream.
 * - running: neurostate publishes values (also to the native games).
 * - error: neurostate could not start or stopped unexpectedly.
 */
export type NeuroStateServiceState =
  "idle" | "unavailable" | "starting" | "waiting-for-stream" | "running" | "error";

export interface NeuroStateStatus {
  state: NeuroStateServiceState;

  message: string | null;

  /**
   * Device whose EEG neurostate reads, while it runs.
   */
  deviceId: string | null;

  /**
   * Where apps can receive the values, e.g. "JSON over TCP on 127.0.0.1:13855".
   */
  outputs: readonly string[];
}

export type NeuroStateStatusListener = (status: Readonly<NeuroStateStatus>) => void;

/**
 * neurostate's verdict on one channel, as in `neurostate check`.
 *
 * - flat: 1-40 Hz RMS below the profile's flat threshold, no signal from the electrode;
 * - noisy: RMS above the noisy threshold, poor contact or movement;
 * - mains: mains hum much stronger than the EEG.
 */
export type ChannelCheckStatus = "ok" | "flat" | "noisy" | "mains";

export type CheckRegion = "frontal" | "parietal" | "occipital";

/**
 * What the signal check reads, sent once when it starts.
 */
export interface SignalCheckInfo {
  stream: string;
  samplingRateHz: number;
  labels: string[];
  regions: Record<CheckRegion, string[]>;
  /**
   * Channels averaged for the spectrum: the back of the head, where alpha shows.
   */
  spectrumChannels: string[];
  alphaHz: [number, number];
  thresholds: {
    flatUv: number;
    noisyUv: number;
    mainsRatio: number;
  };
}

export interface ChannelCheck {
  label: string;
  status: ChannelCheckStatus;
  /**
   * 1-40 Hz RMS in µV; null when it can't be computed.
   */
  rmsUv: number | null;
  /**
   * Mains power relative to 1-40 Hz power; null for a channel without power.
   */
  mainsRatio: number | null;
}

/**
 * The check's assessment, twice a second. Channels, regions and the spectrum
 * stay empty until half a second of data has arrived.
 */
export interface SignalCheckStatus {
  stream: {
    nominalRateHz: number;
    receivedRateHz: number | null;
    gaps: number;
    missingSamples: number;
    secondsSinceData: number | null;
  };
  channels: ChannelCheck[];
  regions: Partial<Record<CheckRegion, { good: number; total: number }>>;
  spectrum: { hz: number[]; psd: number[] } | null;
}

/**
 * Lifecycle of the signal check, like the neurostate service's.
 */
export type SignalCheckState =
  "idle" | "unavailable" | "starting" | "waiting-for-stream" | "running" | "error";

export interface SignalCheckStateSnapshot {
  state: SignalCheckState;
  message: string | null;
}

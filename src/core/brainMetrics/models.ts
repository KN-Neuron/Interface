export interface BrainBandPowers {
  delta: number;
  theta: number;
  lowAlpha: number;
  highAlpha: number;
  lowBeta: number;
  highBeta: number;
  lowGamma: number;
  highGamma: number;
}

/**
 * Hardware-neutral cognitive metrics exposed by a connected device.
 *
 * Neuorrun consumes `attention` from this contract. It does not know whether
 * the value came from BrainLink, NeuroSky-compatible hardware, or another
 * future adapter.
 */
export interface BrainMetricsSnapshot {
  attention: number | null;
  meditation: number | null;
  poorSignalLevel: number | null;
  signalQualityPercent: number | null;
  eegPower: Readonly<BrainBandPowers> | null;
  blinkStrength: number | null;
  timestampMs: number;
}

export type BrainMetricsListener = (snapshot: Readonly<BrainMetricsSnapshot>) => void;

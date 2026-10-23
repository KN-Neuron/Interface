export type CortexPosition = [number, number, number];

export interface CortexElectrode {
  label: string;
  position: CortexPosition;
}

export type CortexEEGState = "starting" | "streaming" | "error";

export type CortexVisualMode = "fast" | "bands";

export type CortexBand = "delta" | "theta" | "alpha" | "beta" | "gamma";

export const CORTEX_BANDS: readonly CortexBand[] = ["delta", "theta", "alpha", "beta", "gamma"];

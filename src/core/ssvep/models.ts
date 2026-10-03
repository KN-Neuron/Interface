export type SsvepDirection = "UP" | "LEFT" | "RIGHT" | "DOWN";

export interface SsvepTarget {
  direction: SsvepDirection;
  frequencyHz: number;
}

export interface SsvepClassification {
  winnerHz: number;
  direction: SsvepDirection;
  scores: Readonly<Record<string, number>>;
  sampleRateHz: number;
  channelCount: number;
  sampleCount: number;
}

import type { SsvepClassification, SsvepDirection } from "../../../core/ssvep";

export type GridPosition = readonly [number, number];

export interface MinerGameState {
  miner: GridPosition;
  collected: readonly string[];
  moves: number;
  completed: boolean;
}

export interface MinerMoveResult {
  state: MinerGameState;
  message: string;
  moved: boolean;
  collectedDiamond: string | null;
}

export type MinerTrialPhase =
  "idle" | "countdown" | "stimulating" | "waiting-samples" | "classifying" | "error";

export interface MinerLastDecision {
  direction: SsvepDirection;
  classification: SsvepClassification;
}

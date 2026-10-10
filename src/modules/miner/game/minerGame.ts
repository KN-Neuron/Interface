import type { MinerGameState, MinerMoveResult, GridPosition } from "../models/miner";

import type { SsvepDirection } from "../../../core/ssvep";

export const MINER_BOARD_WIDTH = 7;

export const MINER_BOARD_HEIGHT = 5;

export const MINER_START: GridPosition = [3, 4];

export const MINER_WALLS: readonly GridPosition[] = [
  [1, 1],
  [2, 1],
  [4, 1],
  [2, 2],
  [4, 2],
  [1, 3],
] as const;

/**
 * The supplied Python game contained one gold target.
 *
 * The requested KNeuron version turns that objective into six diamonds and
 * completes only after every diamond has been collected. The old gold cell
 * (6, 0) remains one of the diamond locations.
 */
export const MINER_DIAMONDS = [
  {
    id: "diamond-a",
    position: [0, 0],
  },
  {
    id: "diamond-b",
    position: [3, 0],
  },
  {
    id: "diamond-c",
    position: [6, 0],
  },
  {
    id: "diamond-d",
    position: [0, 2],
  },
  {
    id: "diamond-e",
    position: [6, 2],
  },
  {
    id: "diamond-f",
    position: [3, 3],
  },
] as const;

const DIRECTION_VECTOR: Readonly<Record<SsvepDirection, GridPosition>> = {
  UP: [0, -1],
  LEFT: [-1, 0],
  RIGHT: [1, 0],
  DOWN: [0, 1],
};

function key(position: GridPosition): string {
  return `${position[0]}:${position[1]}`;
}

const WALL_KEYS = new Set(MINER_WALLS.map(key));

export function createInitialMinerGame(): MinerGameState {
  return {
    miner: MINER_START,
    collected: [],
    moves: 0,
    completed: false,
  };
}

export function moveMiner(state: MinerGameState, direction: SsvepDirection): MinerMoveResult {
  if (state.completed) {
    return {
      state,
      moved: false,
      collectedDiamond: null,
      message: "All diamonds are already collected.",
    };
  }

  const vector = DIRECTION_VECTOR[direction];

  const next: GridPosition = [state.miner[0] + vector[0], state.miner[1] + vector[1]];

  if (next[0] < 0 || next[0] >= MINER_BOARD_WIDTH || next[1] < 0 || next[1] >= MINER_BOARD_HEIGHT) {
    return {
      state,
      moved: false,
      collectedDiamond: null,
      message: "Boundary blocked the move.",
    };
  }

  if (WALL_KEYS.has(key(next))) {
    return {
      state,
      moved: false,
      collectedDiamond: null,
      message: "Rock blocked the move.",
    };
  }

  const diamond = MINER_DIAMONDS.find(
    (candidate) => key(candidate.position) === key(next) && !state.collected.includes(candidate.id),
  );

  const collected = diamond ? [...state.collected, diamond.id] : state.collected;

  const completed = collected.length === MINER_DIAMONDS.length;

  const nextState: MinerGameState = {
    miner: next,
    collected,
    moves: state.moves + 1,
    completed,
  };

  return {
    state: nextState,
    moved: true,
    collectedDiamond: diamond?.id ?? null,
    message: completed
      ? "All diamonds collected."
      : diamond
        ? "Diamond collected."
        : "Miner moved one cell.",
  };
}

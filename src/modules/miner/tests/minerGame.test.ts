import { describe, expect, it } from "vitest";

import { createInitialMinerGame, MINER_DIAMONDS, moveMiner } from "../game/minerGame";

describe("miner game", () => {
  it("starts unfinished with no diamonds collected", () => {
    const state = createInitialMinerGame();

    expect(state.completed).toBe(false);

    expect(state.collected).toHaveLength(0);

    expect(state.moves).toBe(0);
  });

  it("does not move through a rock", () => {
    let state = createInitialMinerGame();

    // Start: (3,4). Move to (3,3), then try LEFT -> (2,3) open,
    // then UP -> (2,2) rock.
    state = moveMiner(state, "UP").state;

    state = moveMiner(state, "LEFT").state;

    const before = state;

    const result = moveMiner(state, "UP");

    expect(result.moved).toBe(false);

    expect(result.state).toBe(before);
  });

  it("finishes only after every diamond is collected", () => {
    // Test the completion invariant directly by pre-populating every diamond
    // except the one at (3,3), which is one move UP from the start.
    const finalDiamond = MINER_DIAMONDS.find(
      (diamond) => diamond.position[0] === 3 && diamond.position[1] === 3,
    );

    expect(finalDiamond).toBeDefined();

    const collected = MINER_DIAMONDS.filter((diamond) => diamond.id !== finalDiamond?.id).map(
      (diamond) => diamond.id,
    );

    const state = {
      ...createInitialMinerGame(),
      collected,
    };

    const result = moveMiner(state, "UP");

    expect(result.collectedDiamond).toBe(finalDiamond?.id);

    expect(result.state.completed).toBe(true);

    expect(result.state.collected).toHaveLength(MINER_DIAMONDS.length);
  });
});

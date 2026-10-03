import { describe, expect, it } from "vitest";

import { TrialSampleCollector } from "../eeg/TrialSampleCollector";

describe("TrialSampleCollector", () => {
  it("clears old samples at the beginning of every trial", () => {
    const collector = new TrialSampleCollector();

    collector.begin(2);

    collector.push([
      [1, 2, 3],
      [4, 5, 6],
    ]);

    expect(collector.sampleCount()).toBe(3);

    collector.begin(2);

    expect(collector.sampleCount()).toBe(0);
  });

  it("returns the latest requested channel-major window", () => {
    const collector = new TrialSampleCollector();

    collector.begin(2);

    collector.push([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);

    expect(collector.latest(2)).toEqual([
      [3, 4],
      [7, 8],
    ]);
  });
});

import { describe, expect, it } from "vitest";

import type { EEGConsumerBatch } from "../../../core/eeg";

import { CortexSignalProcessor } from "../eeg/CortexSignalProcessor";

const SAMPLE_RATE = 64;
const CHANNELS = [
  { index: 0, label: "O1", type: "eeg" as const, unit: "uV" as const },
  { index: 1, label: "O2", type: "eeg" as const, unit: "uV" as const },
];

function feedSeconds(
  processor: CortexSignalProcessor,
  seconds: number,
  startSample: number,
  amplitude = 1,
): number {
  const batchSize = 16;
  const totalSamples = Math.round(seconds * SAMPLE_RATE);
  let cursor = startSample;

  while (cursor < startSample + totalSamples) {
    const count = Math.min(batchSize, startSample + totalSamples - cursor);
    const values = CHANNELS.map((_, channelIndex) =>
      Array.from({ length: count }, (_, offset) => {
        const sample = cursor + offset;
        const time = sample / SAMPLE_RATE;
        return amplitude * Math.sin(2 * Math.PI * 10 * time + channelIndex * 0.2);
      }),
    );

    const batch: EEGConsumerBatch = {
      sequenceStart: cursor,
      sourceSampleNumberStart: cursor,
      timestampStartMs: (cursor / SAMPLE_RATE) * 1000,
      sampleRateHz: SAMPLE_RATE,
      sampleCount: count,
      channels: CHANNELS,
      values,
    };

    processor.processBatch(batch);
    cursor += count;
  }

  return cursor;
}

describe("CortexSignalProcessor", () => {
  it("stays idle until started and reports activity in the first batch", () => {
    const processor = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    feedSeconds(processor, 1, 0);
    expect(processor.snapshot().phase).toBe("idle");
    expect(processor.snapshot().fastActivityByLabel.O1).toBe(0);
    processor.startExperience();
    expect(processor.snapshot().phase).toBe("live");
    feedSeconds(processor, 0.125, 64, 20);
    const snapshot = processor.snapshot();
    expect(snapshot.fastActivityByLabel.O1).toBeGreaterThan(0);
    expect(snapshot.bandActivityByLabel.alpha.O1).toBeGreaterThan(0);
  });

  it("uses an absolute amplitude scale without adapting to the signal", () => {
    const quiet = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    const loud = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    quiet.startExperience();
    loud.startExperience();
    feedSeconds(quiet, 4, 0, 10);
    feedSeconds(loud, 4, 0, 40);
    expect(
      loud.snapshot().fastActivityByLabel.O1 / quiet.snapshot().fastActivityByLabel.O1,
    ).toBeCloseTo(4);
    feedSeconds(loud, 4, 256, 40);
    expect(loud.snapshot().fastActivityByLabel.O1).toBeGreaterThan(20);
  });

  it("shows a 10 Hz signal most strongly in the alpha band", () => {
    const processor = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    processor.startExperience();
    feedSeconds(processor, 4, 0, 20);
    const bands = processor.snapshot().bandActivityByLabel;
    expect(bands.alpha.O1).toBeGreaterThan(bands.delta.O1);
    expect(bands.alpha.O1).toBeGreaterThan(bands.beta.O1);
    expect(bands.gamma.O1).toBe(0); // Above the supported range at 64 Hz.
  });

  it("initializes from the first sample without a large DC startup flash", () => {
    const processor = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    processor.startExperience();
    processor.processBatch({
      sequenceStart: 0,
      timestampStartMs: 0,
      sampleRateHz: SAMPLE_RATE,
      sampleCount: 16,
      channels: CHANNELS,
      values: [Array(16).fill(100000), Array(16).fill(-100000)],
    });
    expect(processor.snapshot().fastActivityByLabel.O1).toBeLessThan(0.001);
    expect(processor.snapshot().flatChannels).toEqual(["O1", "O2"]);
  });

  it("clears activity on stop and restarts without a calibration stage", () => {
    const processor = new CortexSignalProcessor(SAMPLE_RATE, ["O1", "O2"]);
    processor.startExperience();
    feedSeconds(processor, 1, 0, 20);
    processor.stopExperience();
    expect(processor.snapshot().fastActivityByLabel.O1).toBe(0);
    expect(processor.snapshot().bandActivityByLabel.alpha.O1).toBe(0);
    processor.startExperience();
    expect(processor.snapshot().fastActivityByLabel.O1).toBe(0);
    feedSeconds(processor, 0.125, 64, 20);
    expect(processor.snapshot().fastActivityByLabel.O1).toBeGreaterThan(0);
  });
});

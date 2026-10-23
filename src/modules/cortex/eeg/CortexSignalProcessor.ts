import type { EEGConsumerBatch } from "../../../core/eeg";

import { CORTEX_BANDS, type CortexBand } from "../models/cortex";

const BAND_LIMITS: Readonly<Record<CortexBand, readonly [number, number]>> = {
  delta: [1, 4],

  theta: [4, 8],

  alpha: [8, 13],

  beta: [13, 30],

  gamma: [30, 45],
};

function zeros(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

class FilteredRingBuffer {
  private readonly values: Float64Array[];

  private writeIndex = 0;

  private storedSamples = 0;

  constructor(
    private readonly channelCount: number,

    private readonly capacitySamples: number,
  ) {
    this.values = Array.from({ length: channelCount }, () => new Float64Array(capacitySamples));
  }

  get size(): number {
    return this.storedSamples;
  }

  clear(): void {
    this.writeIndex = 0;

    this.storedSamples = 0;
  }

  pushSample(sample: readonly number[]): void {
    if (sample.length !== this.channelCount) {
      throw new Error(
        `Cortex filtered sample contains ${sample.length} channels; expected ${this.channelCount}.`,
      );
    }

    for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
      this.values[channelIndex][this.writeIndex] = finite(sample[channelIndex]);
    }

    this.writeIndex = (this.writeIndex + 1) % this.capacitySamples;

    this.storedSamples = Math.min(this.capacitySamples, this.storedSamples + 1);
  }

  latest(sampleCount: number): number[][] {
    const count = Math.min(Math.max(0, sampleCount), this.storedSamples);

    const output = Array.from({ length: this.channelCount }, () => [] as number[]);

    if (count === 0) {
      return output;
    }

    const start = (this.writeIndex - count + this.capacitySamples) % this.capacitySamples;

    for (let offset = 0; offset < count; offset += 1) {
      const sourceIndex = (start + offset) % this.capacitySamples;

      for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
        output[channelIndex].push(this.values[channelIndex][sourceIndex]);
      }
    }

    return output;
  }
}

interface BiquadCoefficients {
  b0: number;

  b1: number;

  b2: number;

  a1: number;

  a2: number;
}

function normalizeCoefficients(
  b0: number,

  b1: number,

  b2: number,

  a0: number,

  a1: number,

  a2: number,
): BiquadCoefficients {
  return {
    b0: b0 / a0,

    b1: b1 / a0,

    b2: b2 / a0,

    a1: a1 / a0,

    a2: a2 / a0,
  };
}

function createLowPass(fs: number, frequency: number, q: number): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / fs;

  const cosine = Math.cos(omega);

  const sine = Math.sin(omega);

  const alpha = sine / (2 * q);

  return normalizeCoefficients(
    (1 - cosine) / 2,

    1 - cosine,

    (1 - cosine) / 2,

    1 + alpha,

    -2 * cosine,

    1 - alpha,
  );
}

function createHighPass(fs: number, frequency: number, q: number): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / fs;

  const cosine = Math.cos(omega);

  const sine = Math.sin(omega);

  const alpha = sine / (2 * q);

  return normalizeCoefficients(
    (1 + cosine) / 2,

    -(1 + cosine),

    (1 + cosine) / 2,

    1 + alpha,

    -2 * cosine,

    1 - alpha,
  );
}

function createNotch(fs: number, frequency: number, q: number): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / fs;

  const cosine = Math.cos(omega);

  const sine = Math.sin(omega);

  const alpha = sine / (2 * q);

  return normalizeCoefficients(1, -2 * cosine, 1, 1 + alpha, -2 * cosine, 1 - alpha);
}

class MultiChannelBiquad {
  private readonly initialized: boolean[];

  private readonly x1: Float64Array;

  private readonly x2: Float64Array;

  private readonly y1: Float64Array;

  private readonly y2: Float64Array;

  constructor(
    private readonly coefficients: BiquadCoefficients,

    channelCount: number,
  ) {
    this.initialized = Array.from({ length: channelCount }, () => false);
    this.x1 = new Float64Array(channelCount);

    this.x2 = new Float64Array(channelCount);

    this.y1 = new Float64Array(channelCount);

    this.y2 = new Float64Array(channelCount);
  }

  reset(): void {
    this.initialized.fill(false);
    this.x1.fill(0);

    this.x2.fill(0);

    this.y1.fill(0);

    this.y2.fill(0);
  }

  processSample(channelIndex: number, input: number): number {
    const { b0, b1, b2, a1, a2 } = this.coefficients;

    if (!this.initialized[channelIndex]) {
      const steady = (input * (b0 + b1 + b2)) / (1 + a1 + a2);
      this.x1[channelIndex] = this.x2[channelIndex] = input;
      this.y1[channelIndex] = this.y2[channelIndex] = finite(steady);
      this.initialized[channelIndex] = true;
    }
    const output =
      b0 * input +
      b1 * this.x1[channelIndex] +
      b2 * this.x2[channelIndex] -
      a1 * this.y1[channelIndex] -
      a2 * this.y2[channelIndex];

    this.x2[channelIndex] = this.x1[channelIndex];

    this.x1[channelIndex] = input;

    this.y2[channelIndex] = this.y1[channelIndex];

    this.y1[channelIndex] = finite(output);

    return finite(output);
  }
}

/**

  * Browser-side causal EEG filter used only by the Cortex visualization.

  *

  * It follows the BrainDance v5 intent:

  * - optional 50 Hz notch when the Nyquist limit permits it,

  * - causal high-pass around 1 Hz,

  * - causal low-pass around 45 Hz.

  *

  * The implementation uses cascaded biquads and is deliberately isolated from

  * the device adapter. Other KNeuron modules remain free to use their own DSP.

  */

class CortexCausalEEGFilter {
  private readonly sections: MultiChannelBiquad[];

  constructor(
    sampleRateHz: number,

    private readonly channelCount: number,
  ) {
    const high = Math.min(45, sampleRateHz / 2 - 2);

    if (high <= 1) {
      throw new Error(`Sampling rate ${sampleRateHz} Hz is too low for Cortex EEG filtering.`);
    }

    const butterworthQ = [0.5411961, 1.306563];

    const coefficientSets: BiquadCoefficients[] = [];

    if (sampleRateHz / 2 > 52) {
      coefficientSets.push(createNotch(sampleRateHz, 50, 30));
    }

    for (const q of butterworthQ) {
      coefficientSets.push(createHighPass(sampleRateHz, 1, q));
    }

    for (const q of butterworthQ) {
      coefficientSets.push(createLowPass(sampleRateHz, high, q));
    }

    this.sections = coefficientSets.map(
      (coefficients) => new MultiChannelBiquad(coefficients, channelCount),
    );
  }

  reset(): void {
    for (const section of this.sections) {
      section.reset();
    }
  }

  processSample(sample: readonly number[]): number[] {
    if (sample.length !== this.channelCount) {
      throw new Error(`Expected ${this.channelCount} EEG channels, received ${sample.length}.`);
    }

    const output = [...sample];

    for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
      let value = finite(output[channelIndex]);

      for (const section of this.sections) {
        value = section.processSample(channelIndex, value);
      }

      output[channelIndex] = finite(value);
    }

    return output;
  }
}

export interface CortexProcessorSnapshot {
  started: boolean;
  phase: "idle" | "live";
  fastActivityByLabel: Readonly<Record<string, number>>;
  bandActivityByLabel: Readonly<Record<CortexBand, Readonly<Record<string, number>>>>;
  signalQualityByLabel: Readonly<Record<string, number>>;
  flatChannels: readonly string[];
  receivedSamples: number;
  droppedSamples: number;
}

/** Fixed-scale visualization only; the shared raw EEG stream is never modified. */
export class CortexSignalProcessor {
  private readonly filter: CortexCausalEEGFilter;
  private readonly ring: FilteredRingBuffer;
  private readonly bands: Record<
    CortexBand,
    {
      filters: MultiChannelBiquad[];
      ring: FilteredRingBuffer;
    }
  >;
  private started = false;
  private receivedSamples = 0;
  private droppedSamples = 0;
  private lastSourceSampleNumber: number | null = null;
  private quality: number[] = [];
  private flatChannels: string[] = [];

  constructor(
    private readonly sampleRateHz: number,
    private readonly channelLabels: readonly string[],
  ) {
    if (!Number.isFinite(sampleRateHz) || sampleRateHz <= 0 || channelLabels.length === 0)
      throw new Error("Cortex requires a positive sample rate and at least one EEG channel.");
    this.filter = new CortexCausalEEGFilter(sampleRateHz, channelLabels.length);
    this.ring = new FilteredRingBuffer(
      channelLabels.length,
      Math.max(1, Math.round(sampleRateHz * 0.2)),
    );
    this.bands = Object.fromEntries(
      CORTEX_BANDS.map((band) => {
        const [low, limit] = BAND_LIMITS[band];
        const high = Math.min(limit, sampleRateHz / 2 - 2);
        return [
          band,
          {
            filters:
              high > low
                ? [
                    new MultiChannelBiquad(
                      createHighPass(sampleRateHz, low, Math.SQRT1_2),
                      channelLabels.length,
                    ),
                    new MultiChannelBiquad(
                      createLowPass(sampleRateHz, high, Math.SQRT1_2),
                      channelLabels.length,
                    ),
                  ]
                : [],
            ring: new FilteredRingBuffer(
              channelLabels.length,
              Math.max(1, Math.round(sampleRateHz * 2)),
            ),
          },
        ];
      }),
    ) as typeof this.bands;
  }

  startExperience(): void {
    this.started = true;
    this.filter.reset();
    this.ring.clear();
    this.quality = [];
    this.flatChannels = [];
    for (const band of Object.values(this.bands)) {
      band.ring.clear();
      band.filters.forEach((filter) => filter.reset());
    }
  }

  stopExperience(): void {
    this.started = false;
  }

  processBatch(batch: Readonly<EEGConsumerBatch>): void {
    this.receivedSamples += batch.sampleCount;
    if (batch.sourceSampleNumberStart !== undefined) {
      if (this.lastSourceSampleNumber !== null) {
        const gap = batch.sourceSampleNumberStart - this.lastSourceSampleNumber - 1;
        if (gap > 0 && gap < 1_000_000) this.droppedSamples += gap;
      }
      this.lastSourceSampleNumber = batch.sourceSampleNumberStart + batch.sampleCount - 1;
    }
    if (!this.started) return;
    if (
      batch.sampleRateHz !== this.sampleRateHz ||
      batch.channels.length !== this.channelLabels.length
    )
      throw new Error("Cortex stream configuration changed. Retry EEG.");
    this.quality = this.channelLabels.map((_, index) =>
      batch.values[index]?.every(Number.isFinite) ? 1 : 0,
    );
    for (let offset = 0; offset < batch.sampleCount; offset++) {
      const sample = this.filter.processSample(batch.values.map((row) => finite(row[offset])));
      this.ring.pushSample(sample);
      for (const band of Object.values(this.bands)) {
        const filtered = sample.map((value, channel) =>
          band.filters.reduce((current, filter) => filter.processSample(channel, current), value),
        );
        band.ring.pushSample(band.filters.length ? filtered : zeros(sample.length));
      }
    }
    // Basic signal warnings, not a calibrated electrode-contact measurement.
    this.flatChannels = this.channelLabels.filter((_, index) => {
      const row = batch.values[index];
      return row.length > 1 && row.every((value) => value === row[0]);
    });
  }

  private amplitude(ring: FilteredRingBuffer): Readonly<Record<string, number>> {
    const rows = ring.latest(ring.size);
    return Object.fromEntries(
      this.channelLabels.map((label, index) => {
        const row = rows[index] ?? [];
        const rms = row.length
          ? Math.sqrt(row.reduce((sum, value) => sum + value * value, 0) / row.length)
          : 0;
        return [label, this.started ? finite(rms) : 0];
      }),
    );
  }

  snapshot(): CortexProcessorSnapshot {
    return {
      started: this.started,
      phase: this.started ? "live" : "idle",
      fastActivityByLabel: this.amplitude(this.ring),
      bandActivityByLabel: Object.fromEntries(
        CORTEX_BANDS.map((band) => [band, this.amplitude(this.bands[band].ring)]),
      ) as Record<CortexBand, Readonly<Record<string, number>>>,
      signalQualityByLabel: Object.fromEntries(
        this.channelLabels.flatMap((label, index) =>
          this.quality[index] === undefined ? [] : [[label, this.quality[index]]],
        ),
      ),
      flatChannels: this.flatChannels,
      receivedSamples: this.receivedSamples,
      droppedSamples: this.droppedSamples,
    };
  }
}

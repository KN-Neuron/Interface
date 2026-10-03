import type { EEGConsumerBatch } from "../../../core/eeg";

import { CORTEX_BANDS, type CortexBand, type CortexCalibrationPhase } from "../models/cortex";

export const CORTEX_WARMUP_SECONDS = 3;

export const CORTEX_FAST_BASELINE_SECONDS = 10;

export const CORTEX_BAND_BASELINE_SECONDS = 20;

export const CORTEX_FAST_HZ = 20;

export const CORTEX_BAND_HZ = 10;

export const CORTEX_BAND_WINDOW_SECONDS = 2;

const BAND_LIMITS: Readonly<Record<CortexBand, readonly [number, number]>> = {
  delta: [1, 4],

  theta: [4, 8],

  alpha: [8, 13],

  beta: [13, 30],

  gamma: [30, 45],
};

const TINY = 1e-15;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const copy = [...values].sort((left, right) => left - right);

  const middle = Math.floor(copy.length / 2);

  if (copy.length % 2 === 0) {
    return (copy[middle - 1] + copy[middle]) / 2;
  }

  return copy[middle];
}

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
  private readonly x1: Float64Array;

  private readonly x2: Float64Array;

  private readonly y1: Float64Array;

  private readonly y2: Float64Array;

  constructor(
    private readonly coefficients: BiquadCoefficients,

    channelCount: number,
  ) {
    this.x1 = new Float64Array(channelCount);

    this.x2 = new Float64Array(channelCount);

    this.y1 = new Float64Array(channelCount);

    this.y2 = new Float64Array(channelCount);
  }

  reset(): void {
    this.x1.fill(0);

    this.x2.fill(0);

    this.y1.fill(0);

    this.y2.fill(0);
  }

  processSample(channelIndex: number, input: number): number {
    const { b0, b1, b2, a1, a2 } = this.coefficients;

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

class FrozenRobustNormalizer {
  private history: number[][] = [];

  private medianValues: number[] | null = null;

  private sigmaValues: number[] | null = null;

  constructor(
    private readonly channelCount: number,

    private readonly requiredUpdates: number,

    private readonly relativeFloor = 0.02,

    private readonly absoluteFloor = TINY,
  ) {}

  get ready(): boolean {
    return this.medianValues !== null && this.sigmaValues !== null;
  }

  get progress(): number {
    return this.ready ? 1 : Math.min(1, this.history.length / this.requiredUpdates);
  }

  get medians(): readonly number[] | null {
    return this.medianValues;
  }

  reset(): void {
    this.history = [];

    this.medianValues = null;

    this.sigmaValues = null;
  }

  update(values: readonly number[]): { scores: number[]; progress: number } {
    if (values.length !== this.channelCount) {
      throw new Error(
        `Normalizer received ${values.length} values; expected ${this.channelCount}.`,
      );
    }

    const clean = values.map(finite);

    if (!this.ready) {
      this.history.push(clean);

      if (this.history.length >= this.requiredUpdates) {
        this.freeze();
      }

      return {
        scores: zeros(this.channelCount),

        progress: this.progress,
      };
    }

    const zScores = this.zscore(clean);

    return {
      scores: zScores.map((value) => Math.tanh(Math.max(value, 0) / 3)),

      progress: 1,
    };
  }

  zscore(values: readonly number[]): number[] {
    if (!this.ready || !this.medianValues || !this.sigmaValues) {
      return zeros(this.channelCount);
    }

    return values.map(
      (value, index) => (finite(value) - this.medianValues![index]) / this.sigmaValues![index],
    );
  }

  private freeze(): void {
    const medians = zeros(this.channelCount);

    const sigmas = zeros(this.channelCount);

    for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
      const channelValues = this.history.map((row) => row[channelIndex]);

      const channelMedian = median(channelValues);

      const mad = median(channelValues.map((value) => Math.abs(value - channelMedian)));

      const floor = Math.max(Math.abs(channelMedian) * this.relativeFloor, this.absoluteFloor);

      medians[channelIndex] = channelMedian;

      sigmas[channelIndex] = Math.max(1.4826 * mad, floor);
    }

    this.medianValues = medians;

    this.sigmaValues = sigmas;

    this.history = [];
  }
}

class BandFrozenNormalizer {
  private readonly normalizers: Record<CortexBand, FrozenRobustNormalizer>;

  constructor(channelCount: number, requiredUpdates: number) {
    this.normalizers = {
      delta: new FrozenRobustNormalizer(channelCount, requiredUpdates, 0, 1),

      theta: new FrozenRobustNormalizer(channelCount, requiredUpdates, 0, 1),

      alpha: new FrozenRobustNormalizer(channelCount, requiredUpdates, 0, 1),

      beta: new FrozenRobustNormalizer(channelCount, requiredUpdates, 0, 1),

      gamma: new FrozenRobustNormalizer(channelCount, requiredUpdates, 0, 1),
    };
  }

  get ready(): boolean {
    return CORTEX_BANDS.every((band) => this.normalizers[band].ready);
  }

  get progress(): number {
    return Math.min(...CORTEX_BANDS.map((band) => this.normalizers[band].progress));
  }

  reset(): void {
    for (const band of CORTEX_BANDS) {
      this.normalizers[band].reset();
    }
  }

  update(
    powers: Readonly<Record<CortexBand, readonly number[]>>,
  ): Readonly<Record<CortexBand, number[]>> {
    const output = {} as Record<CortexBand, number[]>;

    for (const band of CORTEX_BANDS) {
      output[band] = this.normalizers[band].update(powers[band]).scores;
    }

    return output;
  }
}

class TemporalArtifactDetector {
  private readonly rms: FrozenRobustNormalizer;

  private readonly gradient: FrozenRobustNormalizer;

  constructor(channelCount: number, requiredUpdates: number) {
    this.rms = new FrozenRobustNormalizer(channelCount, requiredUpdates, 0.03, TINY);

    this.gradient = new FrozenRobustNormalizer(channelCount, requiredUpdates, 0.03, TINY);
  }

  get ready(): boolean {
    return this.rms.ready && this.gradient.ready;
  }

  reset(): void {
    this.rms.reset();

    this.gradient.reset();
  }

  updateBaseline(window: readonly (readonly number[])[]): number {
    const { rms, gradient } = calculateWindowMetrics(window);

    const rmsProgress = this.rms.update(rms).progress;

    const gradientProgress = this.gradient.update(gradient).progress;

    return Math.min(rmsProgress, gradientProgress);
  }

  quality(window: readonly (readonly number[])[]): number[] {
    if (!this.ready) {
      return Array.from({ length: window.length }, () => 1);
    }

    const metrics = calculateWindowMetrics(window);

    const rmsZ = this.rms.zscore(metrics.rms);

    const gradientZ = this.gradient.zscore(metrics.gradient);

    return rmsZ.map((rmsValue, index) => {
      const z = Math.max(Math.abs(rmsValue), Math.abs(gradientZ[index]));

      return clamp01(1 - Math.max(0, z - 6) / 6);
    });
  }
}

function calculateWindowMetrics(window: readonly (readonly number[])[]): {
  rms: number[];

  gradient: number[];
} {
  const rms = zeros(window.length);

  const gradient = zeros(window.length);

  window.forEach((samples, channelIndex) => {
    if (samples.length === 0) {
      return;
    }

    let sumSquares = 0;

    const differences: number[] = [];

    for (let index = 0; index < samples.length; index += 1) {
      const value = finite(samples[index]);

      sumSquares += value * value;

      if (index > 0) {
        differences.push(Math.abs(value - finite(samples[index - 1])));
      }
    }

    rms[channelIndex] = Math.sqrt(sumSquares / samples.length + Number.MIN_VALUE);

    gradient[channelIndex] = differences.length > 0 ? median(differences) : 0;
  });

  return { rms, gradient };
}

function calculateFastRms(
  filteredSamples: readonly (readonly number[])[],

  sampleRateHz: number,
): number[] {
  const windowSamples = Math.max(16, Math.round(sampleRateHz * 0.2));

  return filteredSamples.map((channel) => {
    const start = Math.max(0, channel.length - windowSamples);

    let sumSquares = 0;

    let count = 0;

    for (let index = start; index < channel.length; index += 1) {
      const value = finite(channel[index]);

      sumSquares += value * value;

      count += 1;
    }

    return count > 0 ? Math.sqrt(sumSquares / count + Number.MIN_VALUE) : 0;
  });
}

/**

  * Welch PSD estimator following the old BrainDance design:

  * - approximately 2 s input window,

  * - approximately 1 s Hann segments,

  * - 50% overlap,

  * - channel × band dB output.

  *

  * Only the 1..45 Hz range is evaluated, keeping the browser-side work bounded.

  */

class WelchBandPowerEstimator {
  private readonly segmentSamples: number;

  private readonly hopSamples: number;

  private readonly window: Float64Array;

  private readonly windowEnergy: number;

  private readonly evaluatedBins: Array<{
    frequency: number;

    cosine: Float64Array;

    sine: Float64Array;
  }>;

  constructor(private readonly sampleRateHz: number) {
    this.segmentSamples = Math.max(32, Math.round(sampleRateHz));

    this.hopSamples = Math.max(1, Math.floor(this.segmentSamples / 2));

    this.window = new Float64Array(this.segmentSamples);

    let windowEnergy = 0;

    for (let index = 0; index < this.segmentSamples; index += 1) {
      const value =
        this.segmentSamples <= 1
          ? 1
          : 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (this.segmentSamples - 1));

      this.window[index] = value;

      windowEnergy += value * value;
    }

    this.windowEnergy = Math.max(windowEnergy, Number.MIN_VALUE);

    const high = Math.min(45, sampleRateHz / 2 - 2);

    const maxBin = Math.floor((high * this.segmentSamples) / sampleRateHz);

    this.evaluatedBins = [];

    for (let bin = 1; bin <= maxBin; bin += 1) {
      const frequency = (bin * sampleRateHz) / this.segmentSamples;

      const cosine = new Float64Array(this.segmentSamples);

      const sine = new Float64Array(this.segmentSamples);

      for (let sampleIndex = 0; sampleIndex < this.segmentSamples; sampleIndex += 1) {
        const angle = (2 * Math.PI * bin * sampleIndex) / this.segmentSamples;

        cosine[sampleIndex] = Math.cos(angle);

        sine[sampleIndex] = Math.sin(angle);
      }

      this.evaluatedBins.push({ frequency, cosine, sine });
    }
  }

  estimate(samples: readonly (readonly number[])[]): Readonly<Record<CortexBand, number[]>> | null {
    if (
      samples.length === 0 ||
      samples[0].length < Math.max(64, Math.round(this.sampleRateHz * 2))
    ) {
      return null;
    }

    const powers = {} as Record<CortexBand, number[]>;

    for (const band of CORTEX_BANDS) {
      powers[band] = zeros(samples.length);
    }

    for (let channelIndex = 0; channelIndex < samples.length; channelIndex += 1) {
      const channel = samples[channelIndex];

      const psdByFrequency = new Map<number, number>();

      let segmentCount = 0;

      for (
        let segmentStart = 0;
        segmentStart + this.segmentSamples <= channel.length;
        segmentStart += this.hopSamples
      ) {
        segmentCount += 1;

        for (const bin of this.evaluatedBins) {
          let real = 0;

          let imaginary = 0;

          for (let sampleIndex = 0; sampleIndex < this.segmentSamples; sampleIndex += 1) {
            const value = finite(channel[segmentStart + sampleIndex]) * this.window[sampleIndex];

            real += value * bin.cosine[sampleIndex];

            imaginary -= value * bin.sine[sampleIndex];
          }

          const oneSided =
            (2 * (real * real + imaginary * imaginary)) / (this.sampleRateHz * this.windowEnergy);

          psdByFrequency.set(bin.frequency, (psdByFrequency.get(bin.frequency) ?? 0) + oneSided);
        }
      }

      if (segmentCount === 0) {
        continue;
      }

      for (const [frequency, sum] of psdByFrequency) {
        psdByFrequency.set(frequency, sum / segmentCount);
      }

      for (const band of CORTEX_BANDS) {
        const [low, high] = BAND_LIMITS[band];

        const points = [...psdByFrequency.entries()]

          .filter(([frequency]) => frequency >= low && frequency < high)

          .sort(([left], [right]) => left - right);

        if (points.length < 2) {
          powers[band][channelIndex] = 10 * Math.log10(TINY);

          continue;
        }

        let integrated = 0;

        for (let index = 1; index < points.length; index += 1) {
          const [f0, p0] = points[index - 1];

          const [f1, p1] = points[index];

          integrated += ((p0 + p1) / 2) * (f1 - f0);
        }

        powers[band][channelIndex] = 10 * Math.log10(Math.max(integrated, TINY));
      }
    }

    return powers;
  }
}

export interface CortexProcessorSnapshot {
  started: boolean;

  phase: CortexCalibrationPhase;

  warmupProgress: number;

  fastCalibrationProgress: number;

  bandCalibrationProgress: number;

  bandWindowProgress: number;

  fastReady: boolean;

  bandReady: boolean;

  fastActivityByLabel: Readonly<Record<string, number>>;

  bandActivityByLabel: Readonly<Record<CortexBand, Readonly<Record<string, number>>>>;

  signalQualityByLabel: Readonly<Record<string, number>>;

  flatChannels: readonly string[];

  receivedSamples: number;

  droppedSamples: number;
}

/**

  * Cortex-only processing pipeline ported from BrainDance v5.

  *

  * Important ownership rule:

  * - Device adapters provide normalized raw EEG.

  * - EEGStreamService shares that raw stream.

  * - This class owns Cortex visualization calibration/DSP only.

  *

  * Calibration is frozen. Once a baseline is ready it is not continuously

  * adapted; it changes only when `startCalibration()` is called again.

  */

export class CortexSignalProcessor {
  private readonly filter: CortexCausalEEGFilter;

  private readonly ring: FilteredRingBuffer;

  private readonly fastNormalizer: FrozenRobustNormalizer;

  private readonly bandNormalizer: BandFrozenNormalizer;

  private readonly artifacts: TemporalArtifactDetector;

  private readonly bandEstimator: WelchBandPowerEstimator;

  private started = false;

  private warmupRemainingSamples = 0;

  private fastSampleAccumulator = 0;

  private bandSampleAccumulator = 0;

  private fastActivity: number[];

  private bandActivity: Record<CortexBand, number[]>;

  private signalQuality: number[];

  private flatMask: boolean[];

  private receivedSamples = 0;

  private droppedSamples = 0;

  private lastSourceSampleNumber: number | null = null;

  constructor(
    private readonly sampleRateHz: number,

    private readonly channelLabels: readonly string[],
  ) {
    if (sampleRateHz <= 0) {
      throw new Error("Cortex sample rate must be greater than zero.");
    }

    if (channelLabels.length === 0) {
      throw new Error("Cortex requires at least one EEG channel.");
    }

    const channelCount = channelLabels.length;

    this.filter = new CortexCausalEEGFilter(sampleRateHz, channelCount);

    this.ring = new FilteredRingBuffer(channelCount, Math.max(1024, Math.ceil(sampleRateHz * 4)));

    this.fastNormalizer = new FrozenRobustNormalizer(
      channelCount,

      Math.ceil(CORTEX_FAST_HZ * CORTEX_FAST_BASELINE_SECONDS),

      0.02,

      TINY,
    );

    this.bandNormalizer = new BandFrozenNormalizer(
      channelCount,

      Math.ceil(CORTEX_BAND_HZ * CORTEX_BAND_BASELINE_SECONDS),
    );

    this.artifacts = new TemporalArtifactDetector(
      channelCount,

      Math.ceil(CORTEX_FAST_HZ * CORTEX_FAST_BASELINE_SECONDS),
    );

    this.bandEstimator = new WelchBandPowerEstimator(sampleRateHz);

    this.fastActivity = zeros(channelCount);

    this.signalQuality = Array.from({ length: channelCount }, () => 1);

    this.flatMask = Array.from({ length: channelCount }, () => false);

    this.bandActivity = {
      delta: zeros(channelCount),

      theta: zeros(channelCount),

      alpha: zeros(channelCount),

      beta: zeros(channelCount),

      gamma: zeros(channelCount),
    };
  }

  startCalibration(): void {
    this.started = true;

    this.filter.reset();

    this.ring.clear();

    this.fastNormalizer.reset();

    this.bandNormalizer.reset();

    this.artifacts.reset();

    this.warmupRemainingSamples = Math.round(this.sampleRateHz * CORTEX_WARMUP_SECONDS);

    this.fastSampleAccumulator = 0;

    this.bandSampleAccumulator = 0;

    this.fastActivity = zeros(this.channelLabels.length);

    this.signalQuality = Array.from({ length: this.channelLabels.length }, () => 1);

    this.flatMask = Array.from({ length: this.channelLabels.length }, () => false);

    this.bandActivity = {
      delta: zeros(this.channelLabels.length),

      theta: zeros(this.channelLabels.length),

      alpha: zeros(this.channelLabels.length),

      beta: zeros(this.channelLabels.length),

      gamma: zeros(this.channelLabels.length),
    };
  }

  stopExperience(): void {
    this.started = false;

    this.fastActivity = zeros(this.channelLabels.length);

    this.bandActivity = {
      delta: zeros(this.channelLabels.length),

      theta: zeros(this.channelLabels.length),

      alpha: zeros(this.channelLabels.length),

      beta: zeros(this.channelLabels.length),

      gamma: zeros(this.channelLabels.length),
    };
  }

  processBatch(batch: Readonly<EEGConsumerBatch>): void {
    this.trackContinuity(batch);

    if (!this.started) {
      return;
    }

    if (batch.sampleRateHz !== this.sampleRateHz) {
      throw new Error(
        `Cortex sample rate changed from ${this.sampleRateHz} Hz to ${batch.sampleRateHz} Hz.`,
      );
    }

    if (batch.channels.length !== this.channelLabels.length) {
      throw new Error(
        `Cortex channel count changed from ${this.channelLabels.length} to ${batch.channels.length}.`,
      );
    }

    for (let sampleOffset = 0; sampleOffset < batch.sampleCount; sampleOffset += 1) {
      const rawSample = batch.values.map((channel) => finite(channel[sampleOffset]));

      const filteredSample = this.filter.processSample(rawSample);

      if (this.warmupRemainingSamples > 0) {
        this.warmupRemainingSamples -= 1;

        if (this.warmupRemainingSamples === 0) {
          this.ring.clear();

          this.fastSampleAccumulator = 0;

          this.bandSampleAccumulator = 0;
        }

        continue;
      }

      this.ring.pushSample(filteredSample);

      this.fastSampleAccumulator += 1;

      this.bandSampleAccumulator += 1;

      const fastHopSamples = this.sampleRateHz / CORTEX_FAST_HZ;

      const bandHopSamples = this.sampleRateHz / CORTEX_BAND_HZ;

      if (this.fastSampleAccumulator >= fastHopSamples) {
        this.fastSampleAccumulator -= fastHopSamples;

        this.processFastUpdate();
      }

      if (this.bandSampleAccumulator >= bandHopSamples) {
        this.bandSampleAccumulator -= bandHopSamples;

        this.processBandUpdate();
      }
    }
  }

  snapshot(): CortexProcessorSnapshot {
    const warmupProgress = this.started
      ? clamp01(
          1 - this.warmupRemainingSamples / Math.max(1, this.sampleRateHz * CORTEX_WARMUP_SECONDS),
        )
      : 0;

    const bandWindowSamples = Math.max(
      64,

      Math.round(this.sampleRateHz * CORTEX_BAND_WINDOW_SECONDS),
    );

    let phase: CortexCalibrationPhase = "idle";

    if (this.started) {
      if (this.warmupRemainingSamples > 0) {
        phase = "warmup";
      } else if (!this.fastNormalizer.ready || !this.bandNormalizer.ready) {
        phase = "baseline";
      } else {
        phase = "live";
      }
    }

    return {
      started: this.started,

      phase,

      warmupProgress,

      fastCalibrationProgress: this.fastNormalizer.progress,

      bandCalibrationProgress: this.bandNormalizer.progress,

      bandWindowProgress: clamp01(this.ring.size / bandWindowSamples),

      fastReady: this.fastNormalizer.ready,

      bandReady: this.bandNormalizer.ready,

      fastActivityByLabel: this.toLabelMap(this.fastActivity),

      bandActivityByLabel: {
        delta: this.toLabelMap(this.bandActivity.delta),

        theta: this.toLabelMap(this.bandActivity.theta),

        alpha: this.toLabelMap(this.bandActivity.alpha),

        beta: this.toLabelMap(this.bandActivity.beta),

        gamma: this.toLabelMap(this.bandActivity.gamma),
      },

      signalQualityByLabel: this.toLabelMap(this.signalQuality),

      flatChannels: this.channelLabels.filter((_, index) => this.flatMask[index]),

      receivedSamples: this.receivedSamples,

      droppedSamples: this.droppedSamples,
    };
  }

  private processFastUpdate(): void {
    const fastWindowSamples = Math.max(16, Math.round(this.sampleRateHz * 0.2));

    if (this.ring.size < fastWindowSamples) {
      return;
    }

    const window = this.ring.latest(fastWindowSamples);

    const rms = calculateFastRms(window, this.sampleRateHz);

    const normalized = this.fastNormalizer.update(rms);

    if (this.fastNormalizer.ready && this.fastNormalizer.medians) {
      const typical = median(this.fastNormalizer.medians);

      const flatThreshold = Math.max(typical * 1e-4, Number.MIN_VALUE);

      this.flatMask = this.fastNormalizer.medians.map((value) => value <= flatThreshold);
    }

    this.fastActivity = normalized.scores.map((value, index) =>
      this.flatMask[index] ? 0 : finite(value),
    );

    if (!this.artifacts.ready) {
      this.artifacts.updateBaseline(window);
    }

    this.signalQuality = this.artifacts.ready
      ? this.artifacts.quality(window)
      : Array.from({ length: this.channelLabels.length }, () => 1);
  }

  private processBandUpdate(): void {
    const bandWindowSamples = Math.max(
      64,

      Math.round(this.sampleRateHz * CORTEX_BAND_WINDOW_SECONDS),
    );

    if (this.ring.size < bandWindowSamples) {
      return;
    }

    const window = this.ring.latest(bandWindowSamples);

    const powers = this.bandEstimator.estimate(window);

    if (!powers) {
      return;
    }

    const normalized = this.bandNormalizer.update(powers);

    this.bandActivity = {
      delta: normalized.delta.map((value, index) => (this.flatMask[index] ? 0 : finite(value))),

      theta: normalized.theta.map((value, index) => (this.flatMask[index] ? 0 : finite(value))),

      alpha: normalized.alpha.map((value, index) => (this.flatMask[index] ? 0 : finite(value))),

      beta: normalized.beta.map((value, index) => (this.flatMask[index] ? 0 : finite(value))),

      gamma: normalized.gamma.map((value, index) => (this.flatMask[index] ? 0 : finite(value))),
    };

    // BrainDance v5 intentionally used artifact quality as telemetry only.

    // It is not multiplied into visual activity here.

    if (this.artifacts.ready) {
      this.signalQuality = this.artifacts.quality(window);
    }
  }

  private trackContinuity(batch: Readonly<EEGConsumerBatch>): void {
    this.receivedSamples += batch.sampleCount;

    if (batch.sourceSampleNumberStart === undefined) {
      return;
    }

    if (this.lastSourceSampleNumber !== null) {
      const expected = this.lastSourceSampleNumber + 1;

      const gap = batch.sourceSampleNumberStart - expected;

      if (gap > 0 && gap < 1_000_000) {
        this.droppedSamples += Math.max(0, Math.round(gap));
      }
    }

    this.lastSourceSampleNumber = batch.sourceSampleNumberStart + batch.sampleCount - 1;
  }

  private toLabelMap(values: readonly number[]): Readonly<Record<string, number>> {
    const output: Record<string, number> = {};

    this.channelLabels.forEach((label, index) => {
      output[label] = clamp01(finite(values[index]));
    });

    return output;
  }
}

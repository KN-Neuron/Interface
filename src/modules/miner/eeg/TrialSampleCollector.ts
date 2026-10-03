/**
 * Collects channel-major samples only while an SSVEP trial is active.
 *
 * Starting a trial clears the previous capture, mirroring the old Python
 * project's `session.clear()` immediately before flicker onset.
 */
export class TrialSampleCollector {
  private active = false;

  private values: number[][] = [];

  begin(channelCount: number): void {
    this.values = Array.from(
      {
        length: channelCount,
      },
      () => [],
    );

    this.active = true;
  }

  stop(): void {
    this.active = false;
  }

  push(batchValues: readonly (readonly number[])[]): void {
    if (!this.active) {
      return;
    }

    if (batchValues.length !== this.values.length) {
      throw new Error(
        `SSVEP trial expected ${this.values.length} channels but received ${batchValues.length}.`,
      );
    }

    for (let channel = 0; channel < batchValues.length; channel += 1) {
      this.values[channel].push(...batchValues[channel]);
    }
  }

  sampleCount(): number {
    return this.values[0]?.length ?? 0;
  }

  latest(sampleCount: number): number[][] {
    if (sampleCount <= 0) {
      throw new Error("sampleCount must be positive.");
    }

    if (this.sampleCount() < sampleCount) {
      throw new Error(
        `Only ${this.sampleCount()} SSVEP samples are available; ${sampleCount} required.`,
      );
    }

    return this.values.map((channel) => channel.slice(-sampleCount));
  }
}

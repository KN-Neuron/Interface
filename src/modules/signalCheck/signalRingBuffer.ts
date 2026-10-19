/**
 * The most recent samples of every channel, for drawing.
 */
export class SignalRingBuffer {
  private readonly data: Float32Array[];

  private written = 0;

  /**
   * Increases with every push, so a view can tell when to redraw.
   */
  version = 0;

  constructor(
    readonly channelCount: number,
    readonly capacity: number,
  ) {
    this.data = Array.from({ length: channelCount }, () => new Float32Array(capacity));
  }

  /**
   * Number of samples held, at most the capacity.
   */
  get length(): number {
    return Math.min(this.written, this.capacity);
  }

  /**
   * Appends samples given as channels x samples. Extra channels are ignored.
   */
  push(values: readonly (readonly number[])[]): void {
    const count = values[0]?.length ?? 0;

    for (let channel = 0; channel < this.channelCount; channel++) {
      const samples = values[channel];
      const target = this.data[channel];

      if (!samples || !target) {
        continue;
      }

      for (let i = 0; i < count; i++) {
        target[(this.written + i) % this.capacity] = samples[i] ?? 0;
      }
    }

    this.written += count;
    this.version++;
  }

  /**
   * A channel's sample, oldest first: index 0 is the oldest held sample.
   */
  read(channel: number, index: number): number {
    const start = this.written - this.length;

    return this.data[channel]?.[(start + index) % this.capacity] ?? 0;
  }
}

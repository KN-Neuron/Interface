import type { DeviceStatusListener } from "../core/devices/contracts/DeviceAdapter";
import type {
  LslStreamDescriptor,
  LslStreamSource,
} from "../core/devices/contracts/LslStreamSource";
import type { DeviceStatus } from "../core/devices/models/device";

/**
 * An EEG cap that republishes its stream on LSL, for neurostate service tests.
 */
export class FakeLslAdapter implements LslStreamSource {
  readonly info = {
    id: "fake-cap",
    name: "Fake Cap",
    kind: "eeg" as const,
    transport: "simulation" as const,
  };

  status: DeviceStatus = { state: "disconnected", updatedAt: 0 };

  lslStream: LslStreamDescriptor | null = {
    name: "KNeuron Fake Cap",
    neurostateProfile: "brainaccess-midi",
  };

  lslError: string | null = null;

  private readonly listeners = new Set<DeviceStatusListener>();

  getStatus(): DeviceStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.setState("connected");
  }

  async disconnect(): Promise<void> {
    this.setState("disconnected");
  }

  subscribeStatus(listener: DeviceStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getStreamInfo() {
    return { sampleRateHz: 250, channels: [] };
  }

  async startStream(): Promise<void> {}

  async stopStream(): Promise<void> {}

  isStreaming(): boolean {
    return true;
  }

  subscribeSamples(): () => void {
    return () => undefined;
  }

  getLslStream(): LslStreamDescriptor | null {
    return this.lslStream;
  }

  getLslError(): string | null {
    return this.lslError;
  }

  private setState(state: DeviceStatus["state"]): void {
    this.status = { state, updatedAt: Date.now() };
    for (const listener of this.listeners) {
      listener(this.status);
    }
  }
}

import { deviceManager, type DeviceManager } from "../../core/devices/deviceManager";
import { eegStreamService, type EEGStreamHandle, type EEGStreamService } from "../../core/eeg";
import type { EEGConsumerBatch } from "../../core/eeg/models";
import {
  ssvepClassifierService,
  TAALON_SSVEP_CHANNELS,
  type SsvepClassifierService,
} from "../../core/ssvep";

export interface TalonRequest {
  session: string;
  type: string;
  id?: string;
  captureId?: string;
  seconds?: number;
}

export interface TalonReply {
  type: "response" | "lost";
  id?: string;
  ok?: boolean;
  error?: string;
  status?: string;
  simulated?: boolean;
  sampleRateHz?: number;
  winnerHz?: number;
  direction?: string;
}

interface Dependencies {
  stream: Pick<EEGStreamService, "acquire">;
  classifier: Pick<SsvepClassifierService, "classify">;
  manager: Pick<DeviceManager, "getSnapshot" | "subscribe">;
}

interface Capture {
  id: string;
  values: number[][];
  nextSequence?: number;
  nextSource?: number;
  classifying: boolean;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Unity determines stimulus onset/end. Only samples captured after its begin
// request can produce a decision; cancellation invalidates all pending replies.
export class TalonEegBridge {
  private handle: EEGStreamHandle | null = null;
  private capture: Capture | null = null;
  private generation = 0;
  private connectionGeneration = 0;
  private boundDevice: string | null = null;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly send: (reply: TalonReply) => void,
    private readonly dependencies: Dependencies = {
      stream: eegStreamService,
      classifier: ssvepClassifierService,
      manager: deviceManager,
    },
  ) {
    this.unsubscribe = dependencies.manager.subscribe((snapshot) => {
      if (
        this.boundDevice &&
        (snapshot.activeDeviceId !== this.boundDevice ||
          snapshot.activeStatus?.state !== "connected")
      ) {
        this.lose("EEG device disconnected or changed. Reconnect EEG in Interface.");
      }
    });
  }

  async receive(request: TalonRequest): Promise<void> {
    if (this.disposed) return;
    if (request.type === "cancel") {
      this.cancel();
      return;
    }
    if (request.type === "disconnect") {
      this.disconnect();
      return;
    }
    if (!request.id || request.id.length > 128) return;
    const generation = this.generation;
    try {
      switch (request.type) {
        case "connect":
          await this.connect(request.id);
          break;
        case "begin": {
          if (!this.handle || request.captureId !== request.id)
            throw new Error("Connect EEG before starting a trial.");
          this.cancel();
          this.capture = {
            id: request.id,
            values: TAALON_SSVEP_CHANNELS.map(() => []),
            classifying: false,
          };
          this.send({ type: "response", id: request.id, ok: true });
          break;
        }
        case "classify":
          await this.classify(request);
          break;
      }
    } catch (error) {
      // A connect call owns its own generation checks. Other failed operations
      // must never respond to a cancelled or replaced trial.
      if (!this.disposed && generation === this.generation) {
        this.send({ type: "response", id: request.id, ok: false, error: errorText(error) });
      }
    }
  }

  private async connect(id: string): Promise<void> {
    this.disconnect();
    const generation = this.connectionGeneration;
    try {
      const snapshot = this.dependencies.manager.getSnapshot();
      if (!snapshot.activeDeviceId || snapshot.activeStatus?.state !== "connected") {
        throw new Error("Connect an EEG device in Interface's Device page first.");
      }
      this.boundDevice = snapshot.activeDeviceId;
      const handle = await this.dependencies.stream.acquire({
        channels: TAALON_SSVEP_CHANNELS,
        onBatch: (batch) => this.push(batch),
      });
      if (this.disposed || generation !== this.connectionGeneration) {
        await handle.release();
        return;
      }
      if (
        handle.channels.length !== 6 ||
        !Number.isFinite(handle.streamInfo.sampleRateHz) ||
        handle.streamInfo.sampleRateHz <= 200 ||
        handle.streamInfo.sampleRateHz > 2000
      ) {
        await handle.release();
        throw new Error(
          "TALON requires six posterior channels and a sample rate above 200 Hz (maximum 2000 Hz).",
        );
      }
      this.handle = handle;
      const simulated = snapshot.activeDeviceInfo?.transport === "simulation";
      this.send({
        type: "response",
        id,
        ok: true,
        simulated,
        sampleRateHz: handle.streamInfo.sampleRateHz,
        status: `${simulated ? "SIMULATION · " : ""}${snapshot.activeDeviceInfo?.name ?? "EEG"} · ${handle.streamInfo.sampleRateHz} Hz · 6 channels`,
      });
    } catch (error) {
      if (!this.disposed && generation === this.connectionGeneration) {
        this.boundDevice = null;
        this.send({ type: "response", id, ok: false, error: errorText(error) });
      }
    }
  }

  private push(batch: Readonly<EEGConsumerBatch>): void {
    const capture = this.capture;
    const rate = this.handle?.streamInfo.sampleRateHz;
    if (!capture || !rate || this.disposed) return;
    if (
      batch.sampleRateHz !== rate ||
      batch.values.length !== 6 ||
      batch.sampleCount < 1 ||
      batch.values.some(
        (row) => row.length !== batch.sampleCount || row.some((value) => !Number.isFinite(value)),
      ) ||
      (capture.nextSequence !== undefined && batch.sequenceStart !== capture.nextSequence) ||
      (capture.nextSource !== undefined && batch.sourceSampleNumberStart !== capture.nextSource)
    ) {
      this.lose("Invalid or discontinuous EEG samples; the trial was cancelled.");
      return;
    }
    capture.nextSequence = batch.sequenceStart + batch.sampleCount;
    capture.nextSource =
      batch.sourceSampleNumberStart === undefined
        ? undefined
        : batch.sourceSampleNumberStart + batch.sampleCount;
    const count = Math.min(
      batch.sampleCount,
      Math.max(0, Math.ceil(rate * 13) - capture.values[0].length),
    );
    for (let channel = 0; channel < 6; channel++) {
      for (let index = 0; index < count; index++)
        capture.values[channel].push(batch.values[channel][index]);
    }
  }

  private async classify(request: TalonRequest): Promise<void> {
    const capture = this.capture;
    const handle = this.handle;
    const generation = this.generation;
    const seconds = request.seconds;
    if (!capture || !handle || capture.id !== request.captureId || capture.classifying)
      throw new Error("No matching EEG capture is active.");
    if (
      seconds === undefined ||
      !Number.isFinite(seconds) ||
      seconds < 4 ||
      seconds > 10 ||
      seconds * 2 !== Math.round(seconds * 2)
    ) {
      throw new Error("Trial duration must be 4–10 seconds in 0.5 second steps.");
    }
    capture.classifying = true;
    try {
      const count = Math.ceil(handle.streamInfo.sampleRateHz * seconds);
      const deadline = Date.now() + 3000;
      while (capture.values[0].length < count) {
        if (this.disposed || generation !== this.generation) return;
        if (Date.now() >= deadline) throw new Error("Too few EEG samples; no movement.");
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
      if (this.disposed || generation !== this.generation) return;
      const eeg = capture.values.map((row) => row.slice(0, count));
      this.capture = null;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          this.dependencies.classifier.classify(eeg, handle.streamInfo.sampleRateHz),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("EEG classification timed out.")), 15000);
          }),
        ]);
        if (this.disposed || generation !== this.generation) return;
        this.send({
          type: "response",
          id: request.id,
          ok: true,
          direction: result.direction,
          winnerHz: result.winnerHz,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (!this.disposed && generation === this.generation) {
        this.capture = null;
        this.send({ type: "response", id: request.id, ok: false, error: errorText(error) });
      }
    }
  }

  cancel(): void {
    this.generation++;
    this.capture = null;
  }

  private disconnect(): void {
    this.cancel();
    this.connectionGeneration++;
    this.boundDevice = null;
    const handle = this.handle;
    this.handle = null;
    if (handle) void handle.release().catch(() => {});
  }

  private lose(error: string): void {
    this.disconnect();
    if (!this.disposed) this.send({ type: "lost", error });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.disconnect();
  }
}

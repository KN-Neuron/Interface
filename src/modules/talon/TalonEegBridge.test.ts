import { afterEach, expect, it, vi } from "vitest";
import type { DeviceManagerSnapshot } from "../../core/devices/deviceManager";
import type { EEGConsumerBatch } from "../../core/eeg/models";
import type { EEGStreamRequest } from "../../core/eeg/EEGStreamService";
import { TAALON_SSVEP_CHANNELS, type SsvepClassification } from "../../core/ssvep";
import { TalonEegBridge, type TalonReply } from "./TalonEegBridge";

const result: SsvepClassification = {
  direction: "UP",
  winnerHz: 10.25,
  scores: {},
  sampleRateHz: 250,
  channelCount: 6,
  sampleCount: 1000,
};
function setup(rate = 250) {
  let onBatch: EEGStreamRequest["onBatch"];
  let onDevice!: (snapshot: DeviceManagerSnapshot) => void;
  const replies: TalonReply[] = [];
  const channels = TAALON_SSVEP_CHANNELS.map((label, index) => ({
    label,
    index,
    type: "eeg" as const,
    unit: "uV" as const,
  }));
  const release = vi.fn().mockResolvedValue(undefined);
  const snapshot: DeviceManagerSnapshot = {
    devices: [],
    activeDeviceId: "simulation-eeg",
    activeDeviceInfo: {
      id: "simulation-eeg",
      name: "Simulation EEG",
      kind: "eeg",
      transport: "simulation",
    },
    activeStatus: { state: "connected", updatedAt: 0 },
    busy: false,
  };
  const classify = vi.fn().mockResolvedValue(result);
  const acquire = vi.fn(async (request: EEGStreamRequest) => {
    onBatch = request.onBatch;
    return { id: 1, channels, streamInfo: { sampleRateHz: rate, channels }, release };
  });
  const unsubscribe = vi.fn();
  const bridge = new TalonEegBridge((reply) => replies.push(reply), {
    stream: { acquire },
    classifier: { classify },
    manager: {
      getSnapshot: () => snapshot,
      subscribe: (callback) => {
        onDevice = callback;
        return unsubscribe;
      },
    },
  });
  const request = (type: string, id?: string, captureId?: string, seconds?: number) =>
    bridge.receive({ session: "test", type, id, captureId, seconds });
  const batch = (count = 1000, sequence = 0): EEGConsumerBatch => ({
    sequenceStart: sequence,
    timestampStartMs: 0,
    sampleRateHz: rate,
    sampleCount: count,
    channels,
    values: channels.map(() => Array.from({ length: count }, (_, i) => Math.sin(i))),
  });
  return {
    bridge,
    request,
    replies,
    release,
    classify,
    acquire,
    unsubscribe,
    snapshot,
    push: (value = batch()) => onBatch?.(value),
    batch,
    device: (value: DeviceManagerSnapshot) => onDevice(value),
  };
}

afterEach(() => vi.useRealTimers());

it("uses exactly the current trial's six-channel samples and marks simulation", async () => {
  const h = setup();
  await h.request("connect", "1");
  expect(h.replies.at(-1)).toMatchObject({ ok: true, simulated: true });
  h.push(); // Before begin: ignored.
  await h.request("begin", "2", "2");
  h.push(h.batch(1100));
  await h.request("classify", "3", "2", 4);
  expect(h.classify).toHaveBeenCalledOnce();
  expect(h.classify.mock.calls[0][0][0]).toHaveLength(1000);
  expect(h.replies.at(-1)).toMatchObject({ id: "3", ok: true, direction: "UP" });
  h.bridge.dispose();
  expect(h.release).toHaveBeenCalledOnce();
});

it("discards a classifier response after cancellation", async () => {
  const h = setup();
  let finish!: (value: SsvepClassification) => void;
  h.classify.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await h.request("connect", "1");
  await h.request("begin", "2", "2");
  h.push();
  const pending = h.request("classify", "3", "2", 4);
  await h.request("cancel");
  finish(result);
  await pending;
  expect(h.replies.some((reply) => reply.id === "3")).toBe(false);
  h.bridge.dispose();
});

it("invalidates a trial immediately on device disconnection", async () => {
  const h = setup();
  await h.request("connect", "1");
  await h.request("begin", "2", "2");
  h.device({ ...h.snapshot, activeStatus: { state: "disconnected", updatedAt: 1 } });
  expect(h.replies.at(-1)).toMatchObject({ type: "lost" });
  h.push();
  await h.request("classify", "3", "2", 4);
  expect(h.classify).not.toHaveBeenCalled();
  expect(h.release).toHaveBeenCalledOnce();
  h.bridge.dispose();
});

it("rejects gaps and non-finite samples", async () => {
  const h = setup();
  await h.request("connect", "1");
  await h.request("begin", "2", "2");
  h.push(h.batch(100));
  h.push(h.batch(100, 110));
  expect(h.replies.at(-1)).toMatchObject({ type: "lost" });
  await h.request("connect", "3");
  await h.request("begin", "4", "4");
  const invalid = h.batch();
  (invalid.values[0] as number[])[0] = NaN;
  h.push(invalid);
  expect(h.replies.at(-1)).toMatchObject({ type: "lost" });
  expect(h.classify).not.toHaveBeenCalled();
  h.bridge.dispose();
});

it("times out incomplete captures without classifying", async () => {
  vi.useFakeTimers();
  const h = setup();
  await h.request("connect", "1");
  await h.request("begin", "2", "2");
  h.push(h.batch(50));
  const pending = h.request("classify", "3", "2", 4);
  await vi.advanceTimersByTimeAsync(3100);
  await pending;
  expect(h.replies.at(-1)).toMatchObject({ id: "3", ok: false });
  expect(h.classify).not.toHaveBeenCalled();
  h.bridge.dispose();
});

it("releases a stream acquired after module disposal", async () => {
  const h = setup();
  let finish!: () => void;
  const original = h.acquire.getMockImplementation()!;
  h.acquire.mockImplementation(async (request) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return original(request);
  });
  const pending = h.request("connect", "1");
  h.bridge.dispose();
  finish();
  await pending;
  expect(h.release).toHaveBeenCalledOnce();
  expect(h.replies).toEqual([]);
});

it("rejects incompatible stream metadata", async () => {
  const h = setup(200);
  await h.request("connect", "1");
  expect(h.replies.at(-1)).toMatchObject({ id: "1", ok: false });
  expect(h.release).toHaveBeenCalledOnce();
  h.bridge.dispose();
});

it("keeps device acquisition alive when only a trial is cancelled", async () => {
  const h = setup();
  let finish!: () => void;
  const original = h.acquire.getMockImplementation()!;
  h.acquire.mockImplementation(async (request) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return original(request);
  });
  const pending = h.request("connect", "1");
  await h.request("cancel");
  finish();
  await pending;
  expect(h.replies.at(-1)).toMatchObject({ id: "1", ok: true });
  h.bridge.dispose();
  expect(h.release).toHaveBeenCalledOnce();
});

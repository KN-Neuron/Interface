import { describe, expect, it, vi } from "vitest";

import { DeviceManager } from "../devices/deviceManager";
import { DeviceRegistry } from "../devices/deviceRegistry";
import type { EEGStreamService } from "../eeg";
import { FakeLslAdapter } from "../../test/fakeLslAdapter";

import type {
  NeuroStateExitListener,
  SignalCheckBridgeLike,
  SignalCheckEventListener,
} from "./NeuroStateBridge";
import { SignalCheckService } from "./SignalCheckService";
import type { SignalCheckInfo, SignalCheckStatus } from "./models";

class FakeBridge implements SignalCheckBridgeLike {
  check: SignalCheckEventListener | null = null;

  exit: NeuroStateExitListener | null = null;

  readonly start = vi.fn(async () => undefined);

  readonly stop = vi.fn(async () => undefined);

  readonly startCheck = vi.fn(async (_stream: string, _profile: string) => undefined);

  subscribeCheck(listener: SignalCheckEventListener): () => void {
    this.check = listener;
    return () => (this.check = null);
  }

  subscribeExit(listener: NeuroStateExitListener): () => void {
    this.exit = listener;
    return () => (this.exit = null);
  }
}

const INFO: SignalCheckInfo = {
  stream: "KNeuron Fake Cap",
  samplingRateHz: 250,
  labels: ["O1", "Oz", "O2"],
  regions: { frontal: [], parietal: [], occipital: ["O1", "Oz", "O2"] },
  spectrumChannels: ["O1", "Oz", "O2"],
  alphaHz: [8, 13],
  thresholds: { flatUv: 0.5, noisyUv: 50, mainsRatio: 10 },
};

const STATUS: SignalCheckStatus = {
  stream: {
    nominalRateHz: 250,
    receivedRateHz: 249.8,
    gaps: 0,
    missingSamples: 0,
    secondsSinceData: 0.05,
  },
  channels: [{ label: "O1", status: "noisy", rmsUv: 72.1, mainsRatio: 0.3 }],
  regions: { occipital: { good: 2, total: 3 } },
  spectrum: { hz: [1, 2], psd: [10, 5] },
};

function setup() {
  const registry = new DeviceRegistry();
  const adapter = new FakeLslAdapter();
  registry.register(adapter);

  const manager = new DeviceManager(registry);
  const release = vi.fn(async () => undefined);
  const eeg = { acquire: vi.fn(async () => ({ release })) } as unknown as EEGStreamService;

  const bridges: FakeBridge[] = [];
  const service = new SignalCheckService(manager, eeg, () => {
    const bridge = new FakeBridge();
    bridges.push(bridge);
    return bridge;
  });

  return { adapter, manager, eeg, release, bridges, service };
}

/** Lets queued lifecycle work (start, stop) finish. */
async function settle(service: SignalCheckService): Promise<void> {
  await service.start();
}

describe("SignalCheckService", () => {
  it("asks for a cap when none is connected", async () => {
    const { service, bridges } = setup();

    service.acquire({});
    await settle(service);

    expect(service.getState()).toEqual({
      state: "unavailable",
      message: "Connect an EEG cap on the Device page.",
    });
    expect(bridges).toHaveLength(0);
  });

  it("runs neurostate's check on the cap's LSL stream and relays its results", async () => {
    const { service, manager, eeg, bridges } = setup();
    await manager.connect("fake-cap");

    const onInfo = vi.fn();
    const onStatus = vi.fn();
    const onSignals = vi.fn();
    service.acquire({ onInfo, onStatus, onSignals });
    await settle(service);

    expect(eeg.acquire).toHaveBeenCalledWith({ channels: "all" });
    expect(bridges[0]?.startCheck).toHaveBeenCalledWith("KNeuron Fake Cap", "brainaccess-midi");

    const bridge = bridges[0];
    bridge?.check?.({ type: "check-state", state: "running", message: "Checking." });
    bridge?.check?.({ type: "check-info", ...INFO });
    bridge?.check?.({
      type: "check-signals",
      values: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
    });
    bridge?.check?.({ type: "check-status", ...STATUS });

    expect(service.getState()).toEqual({ state: "running", message: "Checking." });
    expect(onInfo).toHaveBeenCalledWith(INFO);
    expect(onSignals).toHaveBeenCalledWith([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(onStatus).toHaveBeenCalledWith(STATUS);
  });

  it("gives a late listener the stream description and latest status", async () => {
    const { service, manager, bridges } = setup();
    await manager.connect("fake-cap");

    service.acquire({});
    await settle(service);
    bridges[0]?.check?.({ type: "check-info", ...INFO });
    bridges[0]?.check?.({ type: "check-status", ...STATUS });

    const onInfo = vi.fn();
    const onStatus = vi.fn();
    service.acquire({ onInfo, onStatus });

    expect(onInfo).toHaveBeenCalledWith(INFO);
    expect(onStatus).toHaveBeenCalledWith(STATUS);
    expect(bridges).toHaveLength(1);
  });

  it("stops when the last listener leaves", async () => {
    const { service, manager, release, bridges } = setup();
    await manager.connect("fake-cap");

    const first = service.acquire({});
    const second = service.acquire({});
    await settle(service);

    first.release();
    expect(bridges[0]?.stop).not.toHaveBeenCalled();

    second.release();
    await service.stop();

    expect(bridges[0]?.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(service.getState().state).toBe("idle");
  });

  it("follows the cap through a disconnect and reconnect", async () => {
    const { service, manager, release, bridges } = setup();
    await manager.connect("fake-cap");

    service.acquire({});
    await settle(service);

    await manager.disconnect();
    await settle(service);

    expect(bridges[0]?.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(service.getState().state).toBe("unavailable");

    await manager.connect("fake-cap");
    await settle(service);

    expect(bridges).toHaveLength(2);
    expect(service.getState().state).toBe("starting");
  });

  it("reports a failed check and cleans up", async () => {
    const { service, manager, release, bridges } = setup();
    await manager.connect("fake-cap");

    service.acquire({});
    await settle(service);

    bridges[0]?.check?.({
      type: "check-state",
      state: "error",
      message: "Signal check failed: stream lost",
    });
    await service.stop().then(() => undefined);

    expect(release).toHaveBeenCalled();
    expect(bridges[0]?.stop).toHaveBeenCalled();
  });

  it("explains why the cap's stream can't be checked", async () => {
    const { service, manager, adapter } = setup();
    adapter.lslStream = null;
    adapter.lslError = "liblsl not found";
    await manager.connect("fake-cap");

    await service.start();

    expect(service.getState()).toEqual({
      state: "error",
      message: "The signal check could not start: liblsl not found",
    });
  });
});

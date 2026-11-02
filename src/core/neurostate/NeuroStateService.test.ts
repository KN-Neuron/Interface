import { describe, expect, it, vi } from "vitest";

import { BrainMetricsService } from "../brainMetrics/BrainMetricsService";
import { DeviceManager } from "../devices/deviceManager";
import { DeviceRegistry } from "../devices/deviceRegistry";
import type { EEGStreamService } from "../eeg";
import { FakeBrainMetricsAdapter } from "../../test/fakeBrainMetricsAdapter";
import { FakeLslAdapter } from "../../test/fakeLslAdapter";

import type {
  NeuroStateBrainStateListener,
  NeuroStateBridgeLike,
  NeuroStateDeviceMetrics,
  NeuroStateExitListener,
  NeuroStateServiceListener,
} from "./NeuroStateBridge";
import { NeuroStateService } from "./NeuroStateService";
import type { NeuroStateValues } from "./models";

class FakeBridge implements NeuroStateBridgeLike {
  service: NeuroStateServiceListener | null = null;

  brainState: NeuroStateBrainStateListener | null = null;

  exit: NeuroStateExitListener | null = null;

  readonly start = vi.fn(async () => undefined);

  readonly stop = vi.fn(async () => undefined);

  readonly startService = vi.fn(async (_stream: string, _profile: string) => undefined);

  readonly startRelay = vi.fn(async () => undefined);

  readonly pushMetrics = vi.fn(async (_metrics: Readonly<NeuroStateDeviceMetrics>) => undefined);

  subscribeService(listener: NeuroStateServiceListener): () => void {
    this.service = listener;
    return () => (this.service = null);
  }

  subscribeBrainState(listener: NeuroStateBrainStateListener): () => void {
    this.brainState = listener;
    return () => (this.brainState = null);
  }

  subscribeExit(listener: NeuroStateExitListener): () => void {
    this.exit = listener;
    return () => (this.exit = null);
  }
}

const VALUES: Omit<NeuroStateValues, "receivedAtMs"> = {
  t: 10,
  attention: 61.6,
  relaxation: 40.4,
  quality: 92.2,
  state: "uncalibrated",
  calibrated: false,
  poorSignalLevel: 0,
};

async function setup() {
  const registry = new DeviceRegistry();
  const adapter = new FakeLslAdapter();
  registry.register(adapter);

  const manager = new DeviceManager(registry);
  const release = vi.fn(async () => undefined);
  const eeg = { acquire: vi.fn(async () => ({ release })) } as unknown as EEGStreamService;

  const bridges: FakeBridge[] = [];
  const service = new NeuroStateService(manager, eeg, () => {
    const bridge = new FakeBridge();
    bridges.push(bridge);
    return bridge;
  });

  return { adapter, manager, eeg, release, bridges, service };
}

function setupRelay() {
  const registry = new DeviceRegistry();
  const adapter = new FakeBrainMetricsAdapter();
  registry.register(adapter);

  const manager = new DeviceManager(registry);
  const eeg = { acquire: vi.fn() } as unknown as EEGStreamService;
  const bridges: FakeBridge[] = [];
  const service = new NeuroStateService(manager, eeg, () => {
    const bridge = new FakeBridge();
    bridges.push(bridge);
    return bridge;
  });

  return { adapter, manager, eeg, bridges, service };
}

const METRICS = {
  attention: 73,
  meditation: 44,
  poorSignalLevel: 0,
  signalQualityPercent: 100,
  eegPower: null,
  blinkStrength: null,
  timestampMs: 1,
};

describe("NeuroStateService", () => {
  it("asks for an EEG cap when no device is connected", async () => {
    const { service, bridges } = await setup();

    service.acquire(vi.fn());
    await service.start();

    expect(service.getStatus()).toMatchObject({
      state: "unavailable",
      message: "Connect an EEG cap on the Device page.",
    });
    expect(bridges).toHaveLength(0);
  });

  it("starts once a cap connects while a module waits for values", async () => {
    const { service, manager, bridges } = await setup();

    service.acquire(vi.fn());
    await service.start();
    expect(service.getStatus().state).toBe("unavailable");

    await manager.connect("fake-cap");
    await service.start();

    expect(bridges).toHaveLength(1);
    expect(service.getStatus()).toMatchObject({ state: "starting", deviceId: "fake-cap" });
  });

  it("runs neurostate on the cap's LSL stream with its profile", async () => {
    const { service, manager, eeg, bridges } = await setup();
    await manager.connect("fake-cap");

    const listener = vi.fn();
    service.acquire(listener);
    await service.start();

    expect(eeg.acquire).toHaveBeenCalledWith({ channels: "all" });
    expect(bridges[0]?.startService).toHaveBeenCalledWith("KNeuron Fake Cap", "brainaccess-midi");
    expect(service.getStatus()).toMatchObject({ state: "starting", deviceId: "fake-cap" });

    bridges[0]?.service?.({
      status: "running",
      message: "Reading.",
      outputs: ["JSON over TCP on 127.0.0.1:13855"],
    });
    bridges[0]?.brainState?.(VALUES);

    expect(service.getStatus()).toMatchObject({
      state: "running",
      outputs: ["JSON over TCP on 127.0.0.1:13855"],
    });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ attention: 61.6 }));
    expect(service.getLatest()?.receivedAtMs).toBeGreaterThan(0);
  });

  it("keeps running after the last handle is released, to keep the baseline", async () => {
    const { service, manager, bridges } = await setup();
    await manager.connect("fake-cap");

    const handle = service.acquire(vi.fn());
    await service.start();
    handle.release();

    expect(bridges[0]?.stop).not.toHaveBeenCalled();

    // A second consumer joins the running service instead of starting another.
    service.acquire(vi.fn());
    await service.start();
    expect(bridges).toHaveLength(1);
  });

  it("stops when the device disconnects", async () => {
    const { service, manager, release, bridges } = await setup();
    await manager.connect("fake-cap");

    service.acquire(vi.fn());
    await service.start();
    await manager.disconnect();
    await service.stop();

    expect(bridges[0]?.stop).toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(service.getStatus().state).toBe("idle");
    expect(service.getLatest()).toBeNull();
  });

  it("reports why the cap's stream can't reach neurostate", async () => {
    const { service, manager, adapter, release } = await setup();
    adapter.lslStream = null;
    adapter.lslError = "liblsl not found";
    await manager.connect("fake-cap");

    await service.start();

    expect(service.getStatus()).toMatchObject({
      state: "error",
      message: "neurostate could not start: liblsl not found",
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("turns a sidecar failure into an error and cleans up", async () => {
    const { service, manager, release, bridges } = await setup();
    await manager.connect("fake-cap");

    service.acquire(vi.fn());
    await service.start();

    bridges[0]?.service?.({
      status: "error",
      message: "Couldn't start the json_tcp output: address in use.",
      outputs: [],
    });
    await service.start();

    expect(release).toHaveBeenCalled();
    expect(bridges[0]?.stop).toHaveBeenCalled();
    // start() after an error tries again with a fresh sidecar.
    expect(bridges).toHaveLength(2);
  });

  it("restarts with a fresh sidecar to measure a new baseline", async () => {
    const { service, manager, bridges } = await setup();
    await manager.connect("fake-cap");

    service.acquire(vi.fn());
    await service.start();
    await service.restart();

    expect(bridges[0]?.stop).toHaveBeenCalled();
    expect(bridges).toHaveLength(2);
  });
});

describe("BrainMetricsService with neurostate", () => {
  it("relays the metrics of a device without raw EEG", async () => {
    const { service, manager, adapter, eeg, bridges } = setupRelay();
    await manager.connect(adapter.info.id);
    adapter.latest = METRICS;

    service.acquire(vi.fn());
    await service.start();

    const bridge = bridges[0];
    expect(bridge?.startRelay).toHaveBeenCalledTimes(1);
    expect(bridge?.startService).not.toHaveBeenCalled();
    expect(eeg.acquire).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({ deviceId: adapter.info.id, relay: true });
    expect(bridge?.pushMetrics).toHaveBeenCalledWith(METRICS);

    adapter.emit({ ...METRICS, attention: 20 });
    expect(bridge?.pushMetrics).toHaveBeenLastCalledWith({ ...METRICS, attention: 20 });

    bridge?.service?.({ status: "running", message: "Relaying.", outputs: [] });
    expect(service.getStatus()).toMatchObject({ state: "running", relay: true });
  });

  it("starts relaying once a metrics device connects while a module waits", async () => {
    const { service, manager, adapter, bridges } = setupRelay();

    service.acquire(vi.fn());
    await service.start();
    expect(service.getStatus().state).toBe("unavailable");

    await manager.connect(adapter.info.id);
    await service.start();

    expect(bridges).toHaveLength(1);
    expect(bridges[0]?.startRelay).toHaveBeenCalledTimes(1);
  });

  it("stops relaying when the device disconnects", async () => {
    const { service, manager, adapter, bridges } = setupRelay();
    await manager.connect(adapter.info.id);
    service.acquire(vi.fn());
    await service.start();

    await manager.disconnect();
    await service.start();

    expect(bridges[0]?.stop).toHaveBeenCalledTimes(1);
    expect(adapter.listenerCount).toBe(0);

    adapter.emit(METRICS);
    expect(bridges[0]?.pushMetrics).not.toHaveBeenCalled();
    expect(service.getStatus().relay).toBeUndefined();
  });

  it("keeps serving device metrics directly to BrainMetricsService", async () => {
    const { service, manager, adapter, bridges } = setupRelay();
    await manager.connect(adapter.info.id);

    const listener = vi.fn();
    new BrainMetricsService(manager, service).acquire(listener);
    adapter.emit(METRICS);

    expect(listener).toHaveBeenCalledWith(METRICS);
    expect(bridges).toHaveLength(0);
  });

  it("serves neurostate values in the ThinkGear-style shape", async () => {
    const { service, manager, bridges } = await setup();
    const metrics = new BrainMetricsService(manager, service);
    await manager.connect("fake-cap");

    const listener = vi.fn();
    const handle = metrics.acquire(listener);
    await service.start();
    bridges[0]?.brainState?.(VALUES);

    expect(handle.deviceId).toBe("fake-cap");
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        attention: 62,
        meditation: 40,
        poorSignalLevel: 0,
        signalQualityPercent: 92,
      }),
    );
    expect(metrics.getLatest()?.attention).toBe(62);
  });
});

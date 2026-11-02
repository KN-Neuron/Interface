import {
  deviceManager,
  type DeviceManager,
  type DeviceManagerSnapshot,
} from "../devices/deviceManager";

import type { DeviceAdapter } from "../devices/contracts/DeviceAdapter";

import { isLslStreamSource } from "../devices/contracts/LslStreamSource";

import {
  isBrainMetricsDeviceAdapter,
  type BrainMetricsDeviceAdapter,
} from "../devices/contracts/BrainMetricsDeviceAdapter";

import { eegStreamService, type EEGStreamHandle, type EEGStreamService } from "../eeg";

import type { BrainMetricsSnapshot } from "../brainMetrics/models";

import { logger } from "../../lib/logger";

import {
  NeuroStateBridge,
  type NeuroStateBridgeLike,
  type NeuroStateServiceEvent,
} from "./NeuroStateBridge";

import { findLslSource, openLslStream } from "./openLslStream";

import type {
  NeuroStateStatus,
  NeuroStateStatusListener,
  NeuroStateValues,
  NeuroStateValuesListener,
} from "./models";

export interface NeuroStateHandle {
  release(): void;
}

const IDLE: NeuroStateStatus = {
  state: "idle",
  message: null,
  deviceId: null,
  outputs: [],
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs neurostate on the connected EEG cap.
 *
 * neurostate turns the cap's raw EEG into attention and relaxation, and
 * publishes them on its usual outputs, where the native games read them
 * (JSON over TCP on 127.0.0.1:13855). KNeuron modules read the same values
 * through this service or BrainMetricsService.
 *
 * Devices without raw EEG that compute metrics themselves (BrainLink) reach the
 * native games through the same outputs: their metrics are relayed unchanged.
 *
 * Lifecycle:
 *
 * - the first acquire() starts neurostate for the active EEG device;
 * - releasing handles keeps it running, so the resting baseline neurostate
 *   measures in its first minute is kept between games;
 * - it stops when that device disconnects or another device becomes active;
 * - restart() starts afresh, which measures a new baseline.
 */
export class NeuroStateService {
  private status: NeuroStateStatus = IDLE;

  private latest: Readonly<NeuroStateValues> | null = null;

  private readonly valueListeners = new Set<NeuroStateValuesListener>();

  private readonly statusListeners = new Set<NeuroStateStatusListener>();

  private bridge: NeuroStateBridgeLike | null = null;

  private bridgeUnsubscribes: (() => void)[] = [];

  private eegHandle: EEGStreamHandle | null = null;

  /**
   * Start, stop and teardown run one at a time, in order.
   */
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly manager: DeviceManager = deviceManager,
    private readonly eeg: EEGStreamService = eegStreamService,
    private readonly createBridge: () => NeuroStateBridgeLike = () => new NeuroStateBridge(),
  ) {
    this.manager.subscribe((snapshot) => {
      this.handleDeviceChange(snapshot);
    });
  }

  /**
   * Whether neurostate can compute brain metrics from this device.
   */
  supports(adapter: DeviceAdapter): boolean {
    return isLslStreamSource(adapter);
  }

  getStatus(): Readonly<NeuroStateStatus> {
    return {
      ...this.status,
    };
  }

  getLatest(): Readonly<NeuroStateValues> | null {
    return this.latest;
  }

  subscribeStatus(listener: NeuroStateStatusListener): () => void {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  /**
   * Receives every update while neurostate runs, starting it if needed.
   */
  acquire(listener: NeuroStateValuesListener): NeuroStateHandle {
    this.valueListeners.add(listener);

    if (this.latest) {
      listener(this.latest);
    }

    if (["idle", "unavailable", "error"].includes(this.status.state)) {
      void this.start();
    }

    let released = false;

    return {
      release: () => {
        if (released) {
          return;
        }

        released = true;
        this.valueListeners.delete(listener);
      },
    };
  }

  start(): Promise<void> {
    return this.runLifecycle(() => this.startUnsafe());
  }

  stop(): Promise<void> {
    return this.runLifecycle(async () => {
      await this.teardownUnsafe();
      this.setStatus(IDLE);
    });
  }

  /**
   * Restarts neurostate, so it measures a new resting baseline.
   */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private async startUnsafe(): Promise<void> {
    if (["starting", "waiting-for-stream", "running"].includes(this.status.state)) {
      return;
    }

    const relayed = this.findRelayedDevice();

    if (relayed) {
      await this.launch(relayed, true, async () => {
        await this.openRelay(relayed);
      });
      return;
    }

    const source = findLslSource(this.manager);

    if ("unavailable" in source) {
      this.setStatus({
        ...IDLE,
        state: "unavailable",
        message: source.unavailable,
      });
      return;
    }

    const { adapter } = source;

    await this.launch(adapter, false, async () => {
      const { stream, handle } = await openLslStream(adapter, this.eeg);

      this.eegHandle = handle;

      const bridge = this.openBridge();

      await bridge.start();
      await bridge.startService(stream.name, stream.neurostateProfile);

      logger.info("NeuroStateService", `neurostate started on "${stream.name}".`);
    });
  }

  /**
   * The connected device whose own metrics are relayed: one without raw EEG for
   * neurostate to read.
   */
  private findRelayedDevice(): BrainMetricsDeviceAdapter | null {
    const adapter = this.manager.getActiveAdapter();

    return adapter &&
      adapter.getStatus().state === "connected" &&
      !this.supports(adapter) &&
      isBrainMetricsDeviceAdapter(adapter)
      ? adapter
      : null;
  }

  private async openRelay(adapter: BrainMetricsDeviceAdapter): Promise<void> {
    const bridge = this.openBridge();

    await bridge.start();
    await bridge.startRelay();

    const push = (metrics: Readonly<BrainMetricsSnapshot>): void => {
      bridge.pushMetrics(metrics).catch((error: unknown) => {
        logger.warning("NeuroStateService", `Relaying metrics failed: ${errorMessage(error)}`);
      });
    };

    this.bridgeUnsubscribes.push(adapter.subscribeBrainMetrics(push));

    const latest = adapter.getLatestBrainMetrics();

    if (latest) {
      push(latest);
    }

    logger.info("NeuroStateService", `neurostate relays metrics from ${adapter.info.name}.`);
  }

  private openBridge(): NeuroStateBridgeLike {
    const bridge = this.createBridge();

    this.bridge = bridge;
    this.bridgeUnsubscribes = [
      bridge.subscribeService((event) => {
        this.handleServiceEvent(event);
      }),
      bridge.subscribeBrainState((values) => {
        this.handleValues({
          ...values,
          receivedAtMs: Date.now(),
        });
      }),
      bridge.subscribeExit((reason) => {
        this.fail(`neurostate stopped unexpectedly: ${reason}`);
      }),
    ];

    return bridge;
  }

  private async launch(
    adapter: DeviceAdapter,
    relay: boolean,
    open: () => Promise<void>,
  ): Promise<void> {
    this.setStatus({
      state: "starting",
      message: `Starting neurostate on ${adapter.info.name}...`,
      deviceId: adapter.info.id,
      outputs: [],
      relay,
    });

    try {
      await open();
    } catch (error) {
      await this.teardownUnsafe();

      this.setStatus({
        ...IDLE,
        state: "error",
        message: `neurostate could not start: ${errorMessage(error)}`,
      });

      logger.error("NeuroStateService", errorMessage(error));
    }
  }

  private async teardownUnsafe(): Promise<void> {
    for (const unsubscribe of this.bridgeUnsubscribes) {
      unsubscribe();
    }

    this.bridgeUnsubscribes = [];

    const bridge = this.bridge;
    this.bridge = null;

    if (bridge) {
      try {
        await bridge.stop();
      } catch (error) {
        logger.warning("NeuroStateService", `Stopping neurostate failed: ${errorMessage(error)}`);
      }
    }

    const handle = this.eegHandle;
    this.eegHandle = null;

    if (handle) {
      await handle.release();
    }

    this.latest = null;
  }

  private handleServiceEvent(event: Readonly<NeuroStateServiceEvent>): void {
    switch (event.status) {
      case "waiting-for-stream":
      case "running":
        this.setStatus({
          ...this.status,
          state: event.status,
          message: event.message,
          outputs: event.outputs,
        });
        return;

      case "error":
        this.fail(event.message);
        return;

      case "stopped":
        // Only expected while stopping, which sets the status itself.
        return;
    }
  }

  private handleValues(values: Readonly<NeuroStateValues>): void {
    this.latest = values;

    for (const listener of this.valueListeners) {
      listener(values);
    }
  }

  private fail(message: string): void {
    logger.error("NeuroStateService", message);

    void this.runLifecycle(async () => {
      await this.teardownUnsafe();

      this.setStatus({
        ...IDLE,
        state: "error",
        message,
      });
    });
  }

  private handleDeviceChange(snapshot: DeviceManagerSnapshot): void {
    const connected = snapshot.activeStatus?.state === "connected";
    const deviceId = this.status.deviceId;

    if (deviceId) {
      if (snapshot.activeDeviceId !== deviceId || !connected) {
        void this.stop();
      }

      return;
    }

    // A cap connected while a module waits for values: start for it. After an
    // error, the user retries instead, so a failing setup can't loop.
    const adapter = this.manager.getActiveAdapter();

    if (
      connected &&
      adapter &&
      (this.supports(adapter) || isBrainMetricsDeviceAdapter(adapter)) &&
      this.valueListeners.size > 0 &&
      ["idle", "unavailable"].includes(this.status.state)
    ) {
      void this.start();
    }
  }

  private runLifecycle(operation: () => Promise<void>): Promise<void> {
    const run = this.lifecycleQueue.then(operation);

    this.lifecycleQueue = run.catch(() => undefined);

    return run;
  }

  private setStatus(status: NeuroStateStatus): void {
    this.status = status;

    const snapshot = {
      ...status,
    };

    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}

export const neuroStateService = new NeuroStateService();

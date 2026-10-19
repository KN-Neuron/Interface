import {
  deviceManager,
  type DeviceManager,
  type DeviceManagerSnapshot,
} from "../devices/deviceManager";

import { eegStreamService, type EEGStreamHandle, type EEGStreamService } from "../eeg";

import { logger } from "../../lib/logger";

import {
  NeuroStateBridge,
  type SignalCheckBridgeLike,
  type SignalCheckEvent,
} from "./NeuroStateBridge";

import { findLslSource, openLslStream } from "./openLslStream";

import type { SignalCheckInfo, SignalCheckStateSnapshot, SignalCheckStatus } from "./models";

export interface SignalCheckListener {
  /**
   * The stream's channels and regions, once per run.
   */
  onInfo?: (info: Readonly<SignalCheckInfo>) => void;

  /**
   * Channel status, stream health and the spectrum, twice a second.
   */
  onStatus?: (status: Readonly<SignalCheckStatus>) => void;

  /**
   * Newly arrived samples, filtered for display: channels x samples, in µV.
   */
  onSignals?: (values: readonly (readonly number[])[]) => void;
}

export type SignalCheckStateListener = (state: Readonly<SignalCheckStateSnapshot>) => void;

export interface SignalCheckHandle {
  release(): void;
}

const IDLE: SignalCheckStateSnapshot = { state: "idle", message: null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs neurostate's signal check on the connected cap, for fitting it.
 *
 * It uses neurostate's own channel assessment (flat, noisy, mains hum) with the
 * cap's profile, in a neurostate sidecar of its own, so it works alongside the
 * neurostate service that feeds the games.
 *
 * The check runs while at least one listener holds a handle, and stops with
 * the last release or when the cap disconnects.
 */
export class SignalCheckService {
  private state: SignalCheckStateSnapshot = IDLE;

  private deviceId: string | null = null;

  private info: Readonly<SignalCheckInfo> | null = null;

  private status: Readonly<SignalCheckStatus> | null = null;

  private readonly listeners = new Set<SignalCheckListener>();

  private readonly stateListeners = new Set<SignalCheckStateListener>();

  private bridge: SignalCheckBridgeLike | null = null;

  private bridgeUnsubscribes: (() => void)[] = [];

  private eegHandle: EEGStreamHandle | null = null;

  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly manager: DeviceManager = deviceManager,
    private readonly eeg: EEGStreamService = eegStreamService,
    private readonly createBridge: () => SignalCheckBridgeLike = () => new NeuroStateBridge(),
  ) {
    this.manager.subscribe((snapshot) => {
      this.handleDeviceChange(snapshot);
    });
  }

  getState(): Readonly<SignalCheckStateSnapshot> {
    return { ...this.state };
  }

  subscribeState(listener: SignalCheckStateListener): () => void {
    this.stateListeners.add(listener);

    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Receives the check's results, starting it if needed.
   */
  acquire(listener: SignalCheckListener): SignalCheckHandle {
    this.listeners.add(listener);

    if (this.info) {
      listener.onInfo?.(this.info);
    }

    if (this.status) {
      listener.onStatus?.(this.status);
    }

    if (["idle", "unavailable", "error"].includes(this.state.state)) {
      void this.start();
    }

    let released = false;

    return {
      release: () => {
        if (released) {
          return;
        }

        released = true;
        this.listeners.delete(listener);

        if (this.listeners.size === 0) {
          void this.stop();
        }
      },
    };
  }

  start(): Promise<void> {
    return this.runLifecycle(() => this.startUnsafe());
  }

  stop(): Promise<void> {
    return this.runLifecycle(async () => {
      await this.teardownUnsafe();
      this.setState(IDLE);
    });
  }

  private async startUnsafe(): Promise<void> {
    if (["starting", "waiting-for-stream", "running"].includes(this.state.state)) {
      return;
    }

    const source = findLslSource(this.manager);

    if ("unavailable" in source) {
      this.setState({ state: "unavailable", message: source.unavailable });
      return;
    }

    const { adapter } = source;

    this.deviceId = adapter.info.id;
    this.setState({
      state: "starting",
      message: `Starting the signal check on ${adapter.info.name}...`,
    });

    try {
      const { stream, handle } = await openLslStream(adapter, this.eeg);

      this.eegHandle = handle;

      const bridge = this.createBridge();

      this.bridge = bridge;
      this.bridgeUnsubscribes = [
        bridge.subscribeCheck((event) => {
          this.handleEvent(event);
        }),
        bridge.subscribeExit((reason) => {
          this.fail(`The signal check stopped unexpectedly: ${reason}`);
        }),
      ];

      await bridge.start();
      await bridge.startCheck(stream.name, stream.neurostateProfile);
    } catch (error) {
      await this.teardownUnsafe();
      this.setState({
        state: "error",
        message: `The signal check could not start: ${errorMessage(error)}`,
      });
      logger.error("SignalCheckService", errorMessage(error));
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
        logger.warning("SignalCheckService", `Stopping the check failed: ${errorMessage(error)}`);
      }
    }

    const handle = this.eegHandle;
    this.eegHandle = null;

    if (handle) {
      await handle.release();
    }

    this.deviceId = null;
    this.info = null;
    this.status = null;
  }

  private handleEvent(event: Readonly<SignalCheckEvent>): void {
    switch (event.type) {
      case "check-state":
        if (event.state === "error") {
          this.fail(event.message);
        } else if (event.state !== "stopped") {
          this.setState({ state: event.state, message: event.message });
        }
        return;

      case "check-info": {
        const { type: _type, ...info } = event;

        this.info = info;

        for (const listener of this.listeners) {
          listener.onInfo?.(info);
        }
        return;
      }

      case "check-status": {
        const { type: _type, ...status } = event;

        this.status = status;

        for (const listener of this.listeners) {
          listener.onStatus?.(status);
        }
        return;
      }

      case "check-signals":
        for (const listener of this.listeners) {
          listener.onSignals?.(event.values);
        }
        return;
    }
  }

  private fail(message: string): void {
    logger.error("SignalCheckService", message);

    void this.runLifecycle(async () => {
      await this.teardownUnsafe();
      this.setState({ state: "error", message });
    });
  }

  private handleDeviceChange(snapshot: DeviceManagerSnapshot): void {
    const connected = snapshot.activeStatus?.state === "connected";

    if (this.deviceId) {
      if (snapshot.activeDeviceId !== this.deviceId || !connected) {
        void this.runLifecycle(async () => {
          await this.teardownUnsafe();
          this.setState(IDLE);
        }).then(() => {
          // Someone is still looking: check the newly connected cap, if any.
          if (this.listeners.size > 0) {
            void this.start();
          }
        });
      }

      return;
    }

    if (
      connected &&
      this.listeners.size > 0 &&
      ["idle", "unavailable"].includes(this.state.state)
    ) {
      void this.start();
    }
  }

  private runLifecycle(operation: () => Promise<void>): Promise<void> {
    const run = this.lifecycleQueue.then(operation);

    this.lifecycleQueue = run.catch(() => undefined);

    return run;
  }

  private setState(state: SignalCheckStateSnapshot): void {
    this.state = state;

    const snapshot = { ...state };

    for (const listener of this.stateListeners) {
      listener(snapshot);
    }
  }
}

export const signalCheckService = new SignalCheckService();

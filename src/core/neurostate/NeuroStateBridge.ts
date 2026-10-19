import { Command, type Child } from "@tauri-apps/plugin-shell";

import { logger } from "../../lib/logger";

import type {
  NeuroStateValues,
  SignalCheckInfo,
  SignalCheckState,
  SignalCheckStatus,
} from "./models";

/**
 * Status reported by the sidecar's neurostate service.
 */
export interface NeuroStateServiceEvent {
  status: "waiting-for-stream" | "running" | "stopped" | "error";
  message: string;
  outputs: string[];
}

export type NeuroStateServiceListener = (event: Readonly<NeuroStateServiceEvent>) => void;

export type NeuroStateBrainStateListener = (
  values: Readonly<Omit<NeuroStateValues, "receivedAtMs">>,
) => void;

export type NeuroStateExitListener = (reason: string) => void;

/**
 * Events of the sidecar's signal check (neurostate's `check`, without its window).
 */
export type SignalCheckEvent =
  | {
      type: "check-state";
      state: Extract<SignalCheckState, "waiting-for-stream" | "running" | "error"> | "stopped";
      message: string;
    }
  | ({ type: "check-info" } & SignalCheckInfo)
  | {
      type: "check-signals";
      /**
       * Newly arrived samples, filtered for display: channels x samples, in µV.
       */
      values: number[][];
    }
  | ({ type: "check-status" } & SignalCheckStatus);

export type SignalCheckEventListener = (event: Readonly<SignalCheckEvent>) => void;

export interface SignalCheckBridgeLike {
  start(): Promise<void>;

  stop(): Promise<void>;

  /**
   * Runs neurostate's signal check on an LSL EEG stream with a cap profile.
   */
  startCheck(stream: string, profile: string): Promise<void>;

  subscribeCheck(listener: SignalCheckEventListener): () => void;

  subscribeExit(listener: NeuroStateExitListener): () => void;
}

export interface NeuroStateBridgeLike {
  start(): Promise<void>;

  stop(): Promise<void>;

  /**
   * Runs neurostate on an LSL EEG stream with a cap profile, e.g. "brainaccess-midi".
   */
  startService(stream: string, profile: string): Promise<void>;

  subscribeService(listener: NeuroStateServiceListener): () => void;

  subscribeBrainState(listener: NeuroStateBrainStateListener): () => void;

  /**
   * Notified when the sidecar process ends without stop() being called.
   */
  subscribeExit(listener: NeuroStateExitListener): () => void;
}

interface BridgeResponse {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface BridgeReadyEvent {
  type: "ready";
  protocolVersion: number;
}

interface BridgeServiceStatusEvent extends NeuroStateServiceEvent {
  type: "service-status";
}

interface BridgeBrainStateEvent {
  type: "brain-state";
  state: Omit<NeuroStateValues, "receivedAtMs">;
}

interface BridgeErrorEvent {
  type: "bridge-error";
  message?: string;
}

type BridgeMessage =
  | BridgeResponse
  | BridgeReadyEvent
  | BridgeServiceStatusEvent
  | BridgeBrainStateEvent
  | SignalCheckEvent
  | BridgeErrorEvent;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Tauri/Python IPC bridge for the neurostate sidecar.
 *
 * Communication uses newline-delimited JSON over the sidecar's stdin/stdout.
 * neurostate's own outputs (TCP, WebSocket, ThinkGear, LSL) are opened by the
 * sidecar for the native games; KNeuron itself only reads stdout.
 */
export class NeuroStateBridge implements NeuroStateBridgeLike, SignalCheckBridgeLike {
  private child: Child | null = null;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly serviceListeners = new Set<NeuroStateServiceListener>();

  private readonly brainStateListeners = new Set<NeuroStateBrainStateListener>();

  private readonly exitListeners = new Set<NeuroStateExitListener>();

  private readonly checkListeners = new Set<SignalCheckEventListener>();

  private requestSequence = 0;

  private stdoutBuffer = "";

  private starting: Promise<void> | null = null;

  private stopping = false;

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = this.spawnSidecar();

    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;

    if (!child) {
      return;
    }

    this.stopping = true;

    try {
      await this.request("shutdown");
    } catch (error) {
      logger.warning(
        "NeuroStateBridge",
        `Graceful shutdown failed: ${this.getErrorMessage(error)}`,
      );
    }

    if (this.child) {
      try {
        await this.child.kill();
      } catch {
        // The process may already have exited after the shutdown command.
      }
    }

    this.handleProcessClosed("neurostate sidecar stopped.");
    this.stopping = false;
  }

  async startService(stream: string, profile: string): Promise<void> {
    await this.request("start", {
      stream,
      profile,
    });
  }

  async startCheck(stream: string, profile: string): Promise<void> {
    await this.request("start_check", {
      stream,
      profile,
    });
  }

  subscribeCheck(listener: SignalCheckEventListener): () => void {
    this.checkListeners.add(listener);

    return () => {
      this.checkListeners.delete(listener);
    };
  }

  subscribeService(listener: NeuroStateServiceListener): () => void {
    this.serviceListeners.add(listener);

    return () => {
      this.serviceListeners.delete(listener);
    };
  }

  subscribeBrainState(listener: NeuroStateBrainStateListener): () => void {
    this.brainStateListeners.add(listener);

    return () => {
      this.brainStateListeners.delete(listener);
    };
  }

  subscribeExit(listener: NeuroStateExitListener): () => void {
    this.exitListeners.add(listener);

    return () => {
      this.exitListeners.delete(listener);
    };
  }

  private async spawnSidecar(): Promise<void> {
    const command = Command.sidecar("binaries/neurostate-bridge");

    command.stdout.on("data", (data) => {
      this.handleStdout(String(data));
    });

    command.stderr.on("data", (data) => {
      const message = String(data).trim();

      if (message) {
        logger.debug("NeuroStateBridge", message);
      }
    });

    command.on("error", (error) => {
      this.handleProcessClosed(`neurostate sidecar error: ${String(error)}`);
    });

    command.on("close", (event) => {
      this.handleProcessClosed(`neurostate sidecar exited with code ${event.code ?? "unknown"}.`);
    });

    this.child = await command.spawn();

    await this.request("ping");

    logger.info("NeuroStateBridge", "neurostate sidecar started.");
  }

  private async request<T = unknown>(
    command: string,
    payload?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.child) {
      await this.start();
    }

    const child = this.child;

    if (!child) {
      throw new Error("neurostate sidecar is not running.");
    }

    const id = `ns-${++this.requestSequence}`;

    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
      });
    });

    try {
      await child.write(
        `${JSON.stringify({
          id,
          command,
          payload: payload ?? {},
        })}\n`,
      );
    } catch (error) {
      this.pending.delete(id);

      throw error;
    }

    return promise;
  }

  private handleStdout(data: string): void {
    this.stdoutBuffer += data;

    const lines = this.stdoutBuffer.split(/\r?\n/u);

    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        continue;
      }

      try {
        const message = JSON.parse(trimmed) as BridgeMessage;

        this.handleMessage(message);
      } catch (error) {
        logger.error("NeuroStateBridge", `Invalid sidecar JSON: ${this.getErrorMessage(error)}`);
      }
    }
  }

  private handleMessage(message: BridgeMessage): void {
    switch (message.type) {
      case "ready":
        logger.debug("NeuroStateBridge", `Protocol ready: v${message.protocolVersion}`);
        return;

      case "response": {
        const pending = this.pending.get(message.id);

        if (!pending) {
          return;
        }

        this.pending.delete(message.id);

        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error ?? "neurostate bridge request failed."));
        }

        return;
      }

      case "service-status":
        for (const listener of this.serviceListeners) {
          listener({
            status: message.status,
            message: message.message,
            outputs: message.outputs,
          });
        }
        return;

      case "brain-state":
        for (const listener of this.brainStateListeners) {
          listener(message.state);
        }
        return;

      case "check-state":
      case "check-info":
      case "check-signals":
      case "check-status":
        for (const listener of this.checkListeners) {
          listener(message);
        }
        return;

      case "bridge-error":
        logger.error("NeuroStateBridge", message.message ?? "Unknown neurostate bridge error.");
        return;
    }
  }

  private handleProcessClosed(reason: string): void {
    if (!this.child && this.pending.size === 0) {
      return;
    }

    this.child = null;
    this.stdoutBuffer = "";

    const error = new Error(reason);

    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();

    logger.warning("NeuroStateBridge", reason);

    if (!this.stopping) {
      for (const listener of this.exitListeners) {
        listener(reason);
      }
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

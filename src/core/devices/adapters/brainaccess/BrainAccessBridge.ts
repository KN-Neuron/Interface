import { Command, type Child } from "@tauri-apps/plugin-shell";

import type { EEGSampleBatch } from "../../../eeg/models";

import { logger } from "../../../../lib/logger";

export interface BrainAccessDiscoveredDevice {
  name: string;
  macAddress: string;
}

export interface BrainAccessConnectionInfo {
  deviceName: string;
  /**
   * Model reported by the SDK, e.g. "MIDI" or "MAXI"; null if it can't tell.
   */
  model?: string | null;
  sampleRateHz: number;
  channelCount: number;
  battery?: number | null;
}

export interface BrainAccessConnectOptions {
  /**
   * Electrodes whose signal drives the bias feedback.
   */
  biasElectrodes?: readonly number[];
}

export interface BrainAccessLslOptions {
  name: string;
  sourceId: string;
  channelLabels: readonly string[];
}

export interface BrainAccessStreamOptions {
  /**
   * Republish the stream on LSL while it runs.
   */
  lsl?: BrainAccessLslOptions;
}

export interface BrainAccessStreamStartResult {
  streaming: boolean;
  /**
   * Whether the stream is republished on LSL.
   */
  lsl: boolean;
  lslError: string | null;
}

export type BrainAccessSampleListener = (batch: Readonly<EEGSampleBatch>) => void;

export type BrainAccessDisconnectListener = (reason: string) => void;

export interface BrainAccessBridgeLike {
  start(): Promise<void>;

  stop(): Promise<void>;

  scan(): Promise<readonly BrainAccessDiscoveredDevice[]>;

  connect(
    deviceName: string,
    options?: BrainAccessConnectOptions,
  ): Promise<BrainAccessConnectionInfo>;

  disconnect(): Promise<void>;

  startStream(options?: BrainAccessStreamOptions): Promise<BrainAccessStreamStartResult>;

  stopStream(): Promise<void>;

  subscribeSamples(listener: BrainAccessSampleListener): () => void;

  subscribeDisconnected(listener: BrainAccessDisconnectListener): () => void;
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

interface BridgeSamplesEvent {
  type: "samples";
  batch: EEGSampleBatch;
}

interface BridgeDisconnectedEvent {
  type: "device-disconnected";
  reason?: string;
}

interface BridgeErrorEvent {
  type: "bridge-error";
  message?: string;
}

type BridgeMessage =
  | BridgeResponse
  | BridgeReadyEvent
  | BridgeSamplesEvent
  | BridgeDisconnectedEvent
  | BridgeErrorEvent;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Tauri/Python IPC bridge for BrainAccess.
 *
 * Communication uses newline-delimited JSON over the sidecar's stdin/stdout.
 * No local HTTP/WebSocket server is required.
 */
export class BrainAccessBridge implements BrainAccessBridgeLike {
  private child: Child | null = null;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly sampleListeners = new Set<BrainAccessSampleListener>();

  private readonly disconnectListeners = new Set<BrainAccessDisconnectListener>();

  private requestSequence = 0;

  private stdoutBuffer = "";

  private starting: Promise<void> | null = null;

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

    try {
      await this.request("shutdown");
    } catch (error) {
      logger.warning(
        "BrainAccessBridge",
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

    this.handleProcessClosed("BrainAccess sidecar stopped.");
  }

  async scan(): Promise<readonly BrainAccessDiscoveredDevice[]> {
    return this.request<BrainAccessDiscoveredDevice[]>("scan");
  }

  async connect(
    deviceName: string,
    options: BrainAccessConnectOptions = {},
  ): Promise<BrainAccessConnectionInfo> {
    return this.request<BrainAccessConnectionInfo>("connect", {
      deviceName,
      biasElectrodes: options.biasElectrodes,
    });
  }

  async disconnect(): Promise<void> {
    await this.request("disconnect");
  }

  async startStream(options: BrainAccessStreamOptions = {}): Promise<BrainAccessStreamStartResult> {
    return this.request<BrainAccessStreamStartResult>("start_stream", {
      lsl: options.lsl,
    });
  }

  async stopStream(): Promise<void> {
    await this.request("stop_stream");
  }

  subscribeSamples(listener: BrainAccessSampleListener): () => void {
    this.sampleListeners.add(listener);

    return () => {
      this.sampleListeners.delete(listener);
    };
  }

  subscribeDisconnected(listener: BrainAccessDisconnectListener): () => void {
    this.disconnectListeners.add(listener);

    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private async spawnSidecar(): Promise<void> {
    const command = Command.sidecar("binaries/brainaccess-bridge");

    command.stdout.on("data", (data) => {
      this.handleStdout(String(data));
    });

    command.stderr.on("data", (data) => {
      const message = String(data).trim();

      if (message) {
        logger.debug("BrainAccessBridge", message);
      }
    });

    command.on("error", (error) => {
      this.handleProcessClosed(`BrainAccess sidecar error: ${String(error)}`);
    });

    command.on("close", (event) => {
      this.handleProcessClosed(`BrainAccess sidecar exited with code ${event.code ?? "unknown"}.`);
    });

    this.child = await command.spawn();

    await this.request("ping");

    logger.info("BrainAccessBridge", "BrainAccess sidecar started.");
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
      throw new Error("BrainAccess sidecar is not running.");
    }

    const id = `ba-${++this.requestSequence}`;

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
        logger.error("BrainAccessBridge", `Invalid sidecar JSON: ${this.getErrorMessage(error)}`);
      }
    }
  }

  private handleMessage(message: BridgeMessage): void {
    switch (message.type) {
      case "ready":
        logger.debug("BrainAccessBridge", `Protocol ready: v${message.protocolVersion}`);
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
          pending.reject(new Error(message.error ?? "BrainAccess bridge request failed."));
        }

        return;
      }

      case "samples":
        for (const listener of this.sampleListeners) {
          listener(message.batch);
        }
        return;

      case "device-disconnected": {
        const reason = message.reason ?? "BrainAccess device disconnected.";

        for (const listener of this.disconnectListeners) {
          listener(reason);
        }
        return;
      }

      case "bridge-error":
        logger.error("BrainAccessBridge", message.message ?? "Unknown BrainAccess bridge error.");
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

    logger.warning("BrainAccessBridge", reason);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

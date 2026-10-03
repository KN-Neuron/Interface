import { Command, type Child } from "@tauri-apps/plugin-shell";

import type { BrainMetricsSnapshot } from "../../../brainMetrics";

import { logger } from "../../../../lib/logger";

export interface BrainLinkPortInfo {
  port: string;
  description: string;
  hwid: string;
  manufacturer?: string | null;
}

export interface BrainLinkConnectionInfo {
  deviceName: string;
  model: string;
  port: string;
  baudRate: number;
}

export type BrainLinkMetricsListener = (metrics: Readonly<BrainMetricsSnapshot>) => void;

export type BrainLinkDisconnectListener = (reason: string) => void;

export interface BrainLinkBridgeLike {
  start(): Promise<void>;
  stop(): Promise<void>;

  scan(): Promise<readonly BrainLinkPortInfo[]>;

  connect(port?: string): Promise<BrainLinkConnectionInfo>;

  disconnect(): Promise<void>;

  getMetrics(): Promise<Readonly<BrainMetricsSnapshot> | null>;

  subscribeMetrics(listener: BrainLinkMetricsListener): () => void;

  subscribeDisconnected(listener: BrainLinkDisconnectListener): () => void;
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

interface BridgeMetricsEvent {
  type: "metrics";
  metrics: BrainMetricsSnapshot & {
    port?: string | null;
  };
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
  | BridgeMetricsEvent
  | BridgeDisconnectedEvent
  | BridgeErrorEvent;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Tauri/Python bridge for BrainLink Lite BL002 V2.0.
 *
 * The Python sidecar reads the Bluetooth serial COM port and parses the
 * ThinkGear binary protocol. Communication with Tauri uses JSONL over
 * stdin/stdout, matching the BrainAccess bridge architecture.
 */
export class BrainLinkBridge implements BrainLinkBridgeLike {
  private child: Child | null = null;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly metricsListeners = new Set<BrainLinkMetricsListener>();

  private readonly disconnectListeners = new Set<BrainLinkDisconnectListener>();

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
      logger.warning("BrainLinkBridge", `Graceful shutdown failed: ${this.getErrorMessage(error)}`);
    }

    if (this.child) {
      try {
        await this.child.kill();
      } catch {
        // Sidecar may already have exited after shutdown.
      }
    }

    this.handleProcessClosed("BrainLink sidecar stopped.");
  }

  async scan(): Promise<readonly BrainLinkPortInfo[]> {
    return this.request<BrainLinkPortInfo[]>("scan");
  }

  async connect(port?: string): Promise<BrainLinkConnectionInfo> {
    return this.request<BrainLinkConnectionInfo>("connect", port ? { port } : {});
  }

  async disconnect(): Promise<void> {
    await this.request("disconnect");
  }

  async getMetrics(): Promise<Readonly<BrainMetricsSnapshot> | null> {
    return this.request<BrainMetricsSnapshot | null>("get_metrics");
  }

  subscribeMetrics(listener: BrainLinkMetricsListener): () => void {
    this.metricsListeners.add(listener);

    return () => {
      this.metricsListeners.delete(listener);
    };
  }

  subscribeDisconnected(listener: BrainLinkDisconnectListener): () => void {
    this.disconnectListeners.add(listener);

    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private async spawnSidecar(): Promise<void> {
    const command = Command.sidecar("binaries/brainlink-bridge");

    command.stdout.on("data", (data) => {
      this.handleStdout(String(data));
    });

    command.stderr.on("data", (data) => {
      const message = String(data).trim();

      if (message) {
        logger.debug("BrainLinkBridge", message);
      }
    });

    command.on("error", (error) => {
      this.handleProcessClosed(`BrainLink sidecar error: ${String(error)}`);
    });

    command.on("close", (event) => {
      this.handleProcessClosed(`BrainLink sidecar exited with code ${event.code ?? "unknown"}.`);
    });

    this.child = await command.spawn();

    await this.request("ping");

    logger.info("BrainLinkBridge", "BrainLink sidecar started.");
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
      throw new Error("BrainLink sidecar is not running.");
    }

    const id = `brainlink-${++this.requestSequence}`;

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
        this.handleMessage(JSON.parse(trimmed) as BridgeMessage);
      } catch (error) {
        logger.error("BrainLinkBridge", `Invalid sidecar JSON: ${this.getErrorMessage(error)}`);
      }
    }
  }

  private handleMessage(message: BridgeMessage): void {
    switch (message.type) {
      case "ready":
        logger.debug("BrainLinkBridge", `Protocol ready: v${message.protocolVersion}`);
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
          pending.reject(new Error(message.error ?? "BrainLink bridge request failed."));
        }

        return;
      }

      case "metrics": {
        const metrics: BrainMetricsSnapshot = {
          attention: message.metrics.attention ?? null,
          meditation: message.metrics.meditation ?? null,
          poorSignalLevel: message.metrics.poorSignalLevel ?? null,
          signalQualityPercent: message.metrics.signalQualityPercent ?? null,
          eegPower: message.metrics.eegPower ?? null,
          blinkStrength: message.metrics.blinkStrength ?? null,
          timestampMs: message.metrics.timestampMs,
        };

        for (const listener of this.metricsListeners) {
          listener(metrics);
        }
        return;
      }

      case "device-disconnected": {
        const reason = message.reason ?? "BrainLink Lite disconnected.";

        for (const listener of this.disconnectListeners) {
          listener(reason);
        }
        return;
      }

      case "bridge-error":
        logger.error("BrainLinkBridge", message.message ?? "Unknown BrainLink bridge error.");
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

    logger.warning("BrainLinkBridge", reason);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

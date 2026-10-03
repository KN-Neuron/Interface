import { Command, type Child } from "@tauri-apps/plugin-shell";

import { logger } from "../../lib/logger";

export interface SsvepClassifierRequest {
  eeg: readonly (readonly number[])[];
  sampleRateHz: number;
  frequencies: readonly number[];
}

export interface SsvepClassifierResponse {
  winnerHz: number;
  scores: Readonly<Record<string, number>>;
  sampleRateHz: number;
  channelCount: number;
  sampleCount: number;
}

interface BridgeResponse {
  type: "response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

interface BridgeReady {
  type: "ready";
  protocolVersion: number;
}

type BridgeMessage = BridgeResponse | BridgeReady;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Hardware-independent Python FBCCA bridge.
 *
 * The sidecar contains SciPy + scikit-learn so the classifier mathematics can
 * stay aligned with the supplied working TaaLON Python implementation.
 */
export class SsvepClassifierBridge {
  private child: Child | null = null;

  private starting: Promise<void> | null = null;

  private requestSequence = 0;

  private stdoutBuffer = "";

  private readonly pending = new Map<string, PendingRequest>();

  async classify(request: SsvepClassifierRequest): Promise<SsvepClassifierResponse> {
    return this.request<SsvepClassifierResponse>("classify", request);
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }

    if (this.starting) {
      await this.starting;
      return;
    }

    this.starting = this.spawn();

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
        "SsvepClassifierBridge",
        `Graceful shutdown failed: ${this.errorMessage(error)}`,
      );
    }

    if (this.child) {
      try {
        await this.child.kill();
      } catch {
        // Sidecar may already have exited after shutdown.
      }
    }

    this.close("SSVEP classifier sidecar stopped.");
  }

  private async spawn(): Promise<void> {
    const command = Command.sidecar("binaries/ssvep-classifier");

    command.stdout.on("data", (data) => {
      this.handleStdout(String(data));
    });

    command.stderr.on("data", (data) => {
      const message = String(data).trim();

      if (message) {
        logger.debug("SsvepClassifierBridge", message);
      }
    });

    command.on("error", (error) => {
      this.close(`SSVEP classifier error: ${String(error)}`);
    });

    command.on("close", (event) => {
      this.close(`SSVEP classifier exited with code ${event.code ?? "unknown"}.`);
    });

    this.child = await command.spawn();

    await this.request("ping");

    logger.info("SsvepClassifierBridge", "SSVEP classifier sidecar started.");
  }

  private async request<T = unknown>(command: string, payload?: unknown): Promise<T> {
    if (!this.child) {
      await this.start();
    }

    const child = this.child;

    if (!child) {
      throw new Error("SSVEP classifier sidecar is not running.");
    }

    const id = `ssvep-${++this.requestSequence}`;

    const result = new Promise<T>((resolve, reject) => {
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

    return result;
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
        logger.error(
          "SsvepClassifierBridge",
          `Invalid classifier JSON: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private handleMessage(message: BridgeMessage): void {
    if (message.type === "ready") {
      logger.debug("SsvepClassifierBridge", `Protocol ready: v${message.protocolVersion}`);
      return;
    }

    const pending = this.pending.get(message.id);

    if (!pending) {
      return;
    }

    this.pending.delete(message.id);

    if (message.ok) {
      pending.resolve(message.result);
      return;
    }

    pending.reject(new Error(message.error ?? "SSVEP classification failed."));
  }

  private close(reason: string): void {
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

    logger.warning("SsvepClassifierBridge", reason);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

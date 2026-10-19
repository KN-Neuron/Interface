import type { DeviceStatus } from "../../models/device";

import type { EEGChannelInfo, EEGDeviceInfo, EEGStreamInfo } from "../../models/eeg";

import type { DeviceStatusListener, DeviceUnsubscribe } from "../../contracts/DeviceAdapter";

import type { LslStreamDescriptor, LslStreamSource } from "../../contracts/LslStreamSource";

import type { EEGSampleBatchListener } from "../../../eeg/models";

import { BrainAccessBridge, type BrainAccessBridgeLike } from "./BrainAccessBridge";

import { BRAINACCESS_MAXI_PROFILE, type BrainAccessProfile } from "./brainAccessProfiles";

function buildChannels(labels: readonly string[], channelCount: number): EEGChannelInfo[] {
  return Array.from({ length: channelCount }, (_, sourceIndex) => {
    const label = labels[sourceIndex] ?? `Ch${String(sourceIndex + 1).padStart(2, "0")}`;

    return {
      index: sourceIndex,
      sourceIndex,
      label,
      type: "eeg",
      // The BrainAccess SDK delivers electrode measurements in microvolts.
      unit: "uV",
    };
  });
}

/**
 * KNeuron adapter for one BrainAccess headset model, described by a profile.
 *
 * BrainAccess-specific behaviour stays inside this adapter/bridge layer.
 *
 * Cortex, SSVEP, Miner and other modules access EEG only through
 * EEGStreamService and do not know which physical headset is connected.
 * While streaming, the EEG is also republished on LSL for neurostate.
 */
export class BrainAccessEEGAdapter implements LslStreamSource {
  readonly info: Readonly<EEGDeviceInfo>;

  private status: DeviceStatus;

  private streamInfo: Readonly<EEGStreamInfo> | null = null;

  private deviceName: string | null = null;

  private streaming = false;

  private lslStream: Readonly<LslStreamDescriptor> | null = null;

  private lslError: string | null = null;

  private readonly statusListeners = new Set<DeviceStatusListener>();

  private readonly sampleListeners = new Set<EEGSampleBatchListener>();

  private readonly bridgeSampleUnsubscribe: () => void;

  private readonly bridgeDisconnectUnsubscribe: () => void;

  constructor(
    private readonly bridge: BrainAccessBridgeLike = new BrainAccessBridge(),
    private readonly profile: BrainAccessProfile = BRAINACCESS_MAXI_PROFILE,
  ) {
    this.info = profile.info;

    this.status = {
      state: "disconnected",
      message: `${this.info.name} is disconnected.`,
      updatedAt: Date.now(),
    };

    this.bridgeSampleUnsubscribe = this.bridge.subscribeSamples((batch) => {
      if (!this.streaming) {
        return;
      }

      for (const listener of this.sampleListeners) {
        listener(batch);
      }
    });

    this.bridgeDisconnectUnsubscribe = this.bridge.subscribeDisconnected((reason) => {
      this.streaming = false;
      this.lslStream = null;

      this.setStatus({
        state: "error",
        error: reason,
        message: "BrainAccess Bluetooth connection was lost.",
        updatedAt: Date.now(),
      });
    });
  }

  getStatus(): Readonly<DeviceStatus> {
    return {
      ...this.status,
    };
  }

  async connect(): Promise<void> {
    if (this.status.state === "connected") {
      return;
    }

    this.setStatus({
      state: "connecting",
      message: `Scanning for ${this.info.name}...`,
      updatedAt: Date.now(),
    });

    try {
      await this.bridge.start();

      const devices = await this.bridge.scan();

      const target = devices.find((device) => this.profile.matches(device.name));

      if (!target) {
        const found = devices.length > 0 ? devices.map((device) => device.name).join(", ") : "none";

        throw new Error(
          `BrainAccess device "${this.profile.target}" was not found. Discovered: ${found}.`,
        );
      }

      this.setStatus({
        state: "connecting",
        message: `Connecting to ${target.name}...`,
        updatedAt: Date.now(),
      });

      const connection = await this.bridge.connect(target.name, {
        biasElectrodes: this.profile.biasElectrodes,
      });

      const labels = this.profile.channelLabels;

      this.deviceName = target.name;

      this.streamInfo = {
        sampleRateHz: connection.sampleRateHz,
        channels: buildChannels(labels, connection.channelCount),
      };

      const mappingMessage =
        connection.channelCount === labels.length
          ? `Configured ${labels.length}-channel cap mapping is active.`
          : `Device reports ${connection.channelCount} EEG channels; unmapped channels will use ChXX labels.`;

      this.setStatus({
        state: "connected",
        message:
          `Connected to ${target.name}. ` +
          `${connection.sampleRateHz} Hz · ` +
          `${connection.channelCount} EEG channels. ` +
          mappingMessage,
        updatedAt: Date.now(),
      });
    } catch (error) {
      this.streamInfo = null;
      this.deviceName = null;
      this.streaming = false;

      try {
        await this.bridge.stop();
      } catch {
        // Preserve the original connection error.
      }

      const message = error instanceof Error ? error.message : String(error);

      this.setStatus({
        state: "error",
        error: message,
        message: "BrainAccess connection failed.",
        updatedAt: Date.now(),
      });

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.status.state === "disconnected") {
      return;
    }

    this.setStatus({
      state: "disconnecting",
      message: `Disconnecting ${this.info.name}...`,
      updatedAt: Date.now(),
    });

    try {
      if (this.streaming) {
        await this.stopStream();
      }

      await this.bridge.disconnect();
      await this.bridge.stop();

      this.streamInfo = null;
      this.deviceName = null;
      this.streaming = false;

      this.setStatus({
        state: "disconnected",
        message: `${this.info.name} is disconnected.`,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.setStatus({
        state: "error",
        error: message,
        message: "BrainAccess disconnection failed.",
        updatedAt: Date.now(),
      });

      throw error;
    }
  }

  async getStreamInfo(): Promise<Readonly<EEGStreamInfo>> {
    if (!this.streamInfo) {
      throw new Error("BrainAccess stream metadata is available after the device connects.");
    }

    return {
      sampleRateHz: this.streamInfo.sampleRateHz,

      channels: this.streamInfo.channels.map((channel) => ({
        ...channel,
      })),
    };
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  getLslStream(): Readonly<LslStreamDescriptor> | null {
    return this.lslStream ? { ...this.lslStream } : null;
  }

  getLslError(): string | null {
    return this.lslError;
  }

  async startStream(): Promise<void> {
    if (this.streaming) {
      return;
    }

    if (this.status.state !== "connected" || !this.streamInfo || !this.deviceName) {
      throw new Error(`${this.info.name} must be connected before streaming can start.`);
    }

    const name = `KNeuron ${this.deviceName}`;

    this.streaming = true;

    try {
      const result = await this.bridge.startStream({
        lsl: {
          name,
          sourceId: `kneuron-${this.deviceName}`,
          channelLabels: this.streamInfo.channels.map((channel) => channel.label),
        },
      });

      this.lslStream = result.lsl
        ? { name, neurostateProfile: this.profile.neurostateProfile }
        : null;
      this.lslError = result.lsl ? null : (result.lslError ?? "LSL republishing is unavailable.");
    } catch (error) {
      this.streaming = false;
      throw error;
    }
  }

  async stopStream(): Promise<void> {
    if (!this.streaming) {
      return;
    }

    try {
      await this.bridge.stopStream();
    } finally {
      this.streaming = false;
      this.lslStream = null;
    }
  }

  subscribeStatus(listener: DeviceStatusListener): DeviceUnsubscribe {
    this.statusListeners.add(listener);

    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribeSamples(listener: EEGSampleBatchListener): DeviceUnsubscribe {
    this.sampleListeners.add(listener);

    return () => {
      this.sampleListeners.delete(listener);
    };
  }

  /**
   * Reserved for future explicit adapter disposal.
   *
   * DeviceAdapter currently has no dispose() contract, so application shutdown
   * relies on disconnect() / the Tauri child-process lifecycle.
   */
  dispose(): void {
    this.bridgeSampleUnsubscribe();
    this.bridgeDisconnectUnsubscribe();
  }

  private setStatus(status: DeviceStatus): void {
    this.status = status;

    const snapshot = {
      ...status,
    };

    for (const listener of this.statusListeners) {
      listener(snapshot);
    }
  }
}

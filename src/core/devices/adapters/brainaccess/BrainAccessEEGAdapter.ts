import type { DeviceStatus } from "../../models/device";

import type { EEGChannelInfo, EEGDeviceInfo, EEGStreamInfo } from "../../models/eeg";

import type { DeviceStatusListener, DeviceUnsubscribe } from "../../contracts/DeviceAdapter";

import type { EEGDeviceAdapter } from "../../contracts/EEGDeviceAdapter";

import type { EEGSampleBatchListener } from "../../../eeg/models";

import { BrainAccessBridge, type BrainAccessBridgeLike } from "./BrainAccessBridge";

const DEVICE_NAME = "BA MAXI 009";

/**
 * BA MAXI 009 cap layout.
 *
 * Physical cap:
 *
 * Fp1 -> REF
 * Fp2 -> BIAS
 *
 * These two positions are not part of the 32 streamed EEG measurement channels.
 *
 * Therefore the 32 EEG channels are:
 *
 *  0 -> AF3
 *  1 -> AFz
 *  2 -> AF4
 *  3 -> F7
 *  4 -> F3
 *  5 -> Fz
 *  6 -> F4
 *  7 -> F8
 *  8 -> FC5
 *  9 -> FC1
 * 10 -> FC2
 * 11 -> FC6
 * 12 -> T7
 * 13 -> C3
 * 14 -> Cz
 * 15 -> C4
 * 16 -> T8
 * 17 -> CP5
 * 18 -> CP1
 * 19 -> CP2
 * 20 -> CP6
 * 21 -> P7
 * 22 -> P3
 * 23 -> Pz
 * 24 -> P4
 * 25 -> P8
 * 26 -> PO3
 * 27 -> POz
 * 28 -> PO4
 * 29 -> O1
 * 30 -> Oz
 * 31 -> O2
 *
 * sourceIndex is zero-based and corresponds to the order of EEG samples
 * delivered by the BrainAccess bridge.
 */
const BRAINACCESS_MAXI_EEG_LABELS = [
  "AF3",
  "AFz",
  "AF4",
  "F7",
  "F3",
  "Fz",
  "F4",
  "F8",
  "FC5",
  "FC1",
  "FC2",
  "FC6",
  "T7",
  "C3",
  "Cz",
  "C4",
  "T8",
  "CP5",
  "CP1",
  "CP2",
  "CP6",
  "P7",
  "P3",
  "Pz",
  "P4",
  "P8",
  "PO3",
  "POz",
  "PO4",
  "O1",
  "Oz",
  "O2",
] as const;

function buildChannels(channelCount: number): EEGChannelInfo[] {
  return Array.from({ length: channelCount }, (_, sourceIndex) => {
    const label =
      BRAINACCESS_MAXI_EEG_LABELS[sourceIndex] ?? `Ch${String(sourceIndex + 1).padStart(2, "0")}`;

    return {
      index: sourceIndex,
      sourceIndex,
      label,
      type: "eeg",
      unit: "unknown",
    };
  });
}

const DEVICE_INFO: EEGDeviceInfo = {
  id: "brainaccess-maxi-009",
  name: "BrainAccess MAXI 009",
  kind: "eeg",
  transport: "bluetooth",
  manufacturer: "BrainAccess",
  model: "MAXI 009",
};

/**
 * KNeuron adapter for BA MAXI 009.
 *
 * BrainAccess-specific behaviour stays inside this adapter/bridge layer.
 *
 * Cortex, SSVEP, Miner and other modules access EEG only through
 * EEGStreamService and do not know which physical headset is connected.
 */
export class BrainAccessEEGAdapter implements EEGDeviceAdapter {
  readonly info: Readonly<EEGDeviceInfo> = DEVICE_INFO;

  private status: DeviceStatus = {
    state: "disconnected",
    message: "BrainAccess MAXI 009 is disconnected.",
    updatedAt: Date.now(),
  };

  private streamInfo: Readonly<EEGStreamInfo> | null = null;

  private streaming = false;

  private readonly statusListeners = new Set<DeviceStatusListener>();

  private readonly sampleListeners = new Set<EEGSampleBatchListener>();

  private readonly bridgeSampleUnsubscribe: () => void;

  private readonly bridgeDisconnectUnsubscribe: () => void;

  constructor(private readonly bridge: BrainAccessBridgeLike = new BrainAccessBridge()) {
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
      message: "Scanning for BrainAccess MAXI 009...",
      updatedAt: Date.now(),
    });

    try {
      await this.bridge.start();

      const devices = await this.bridge.scan();

      const target = devices.find((device) => device.name === DEVICE_NAME);

      if (!target) {
        const found = devices.length > 0 ? devices.map((device) => device.name).join(", ") : "none";

        throw new Error(`BrainAccess device "${DEVICE_NAME}" was not found. Discovered: ${found}.`);
      }

      this.setStatus({
        state: "connecting",
        message: `Connecting to ${target.name}...`,
        updatedAt: Date.now(),
      });

      const connection = await this.bridge.connect(target.name);

      this.streamInfo = {
        sampleRateHz: connection.sampleRateHz,
        channels: buildChannels(connection.channelCount),
      };

      const mappingMessage =
        connection.channelCount === BRAINACCESS_MAXI_EEG_LABELS.length
          ? "Configured 32-channel cap mapping is active."
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
      message: "Disconnecting BrainAccess MAXI 009...",
      updatedAt: Date.now(),
    });

    try {
      if (this.streaming) {
        await this.stopStream();
      }

      await this.bridge.disconnect();
      await this.bridge.stop();

      this.streamInfo = null;
      this.streaming = false;

      this.setStatus({
        state: "disconnected",
        message: "BrainAccess MAXI 009 is disconnected.",
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

  async startStream(): Promise<void> {
    if (this.streaming) {
      return;
    }

    if (this.status.state !== "connected") {
      throw new Error("BrainAccess MAXI 009 must be connected before streaming can start.");
    }

    this.streaming = true;

    try {
      await this.bridge.startStream();
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

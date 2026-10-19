import type { EEGDeviceInfo } from "../../models/eeg";

/**
 * Hardware facts about one BrainAccess headset model.
 *
 * Everything model-specific stays here, so the adapter and bridge work the same
 * for every BrainAccess cap KNeuron supports.
 */
export interface BrainAccessProfile {
  readonly info: Readonly<EEGDeviceInfo>;

  /**
   * The headset the adapter looks for, as shown in user-facing messages.
   */
  readonly target: string;

  /**
   * Whether a Bluetooth device name found by a scan is this headset.
   */
  matches(deviceName: string): boolean;

  /**
   * Electrode label for each EEG channel, in the order the device streams them.
   */
  readonly channelLabels: readonly string[];

  /**
   * Electrodes whose signal drives the bias feedback. Omitted, the bridge uses
   * the last electrode, as in the BrainAccess SDK's minimal example.
   */
  readonly biasElectrodes?: readonly number[];

  /**
   * neurostate profile tuned for this cap: a config bundled with the neurostate
   * sidecar, or "standard" for neurostate's defaults.
   */
  readonly neurostateProfile: string;
}

/**
 * BA MAXI 009 cap layout.
 *
 * Physical cap:
 *
 * Fp1 -> REF
 * Fp2 -> BIAS
 *
 * These two positions are not part of the 32 streamed EEG measurement channels,
 * so the 32 EEG channels are listed below in streaming order. Channel index is
 * zero-based and corresponds to the order of EEG samples delivered by the bridge.
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

/**
 * BrainAccess MIDI cap layout: 16 dry electrodes, as in BrainAccess Board's
 * MIDI template (pins 0-15). The reference is on Fp1, which is not streamed,
 * and Board drives the bias feedback from pin 0 (P8).
 */
const BRAINACCESS_MIDI_EEG_LABELS = [
  "P8",
  "O2",
  "P4",
  "C4",
  "F8",
  "F4",
  "Oz",
  "Cz",
  "Fz",
  "Pz",
  "F3",
  "O1",
  "P7",
  "C3",
  "P3",
  "F7",
] as const;

export const BRAINACCESS_MAXI_PROFILE: BrainAccessProfile = {
  info: {
    id: "brainaccess-maxi-009",
    name: "BrainAccess MAXI 009",
    kind: "eeg",
    transport: "bluetooth",
    manufacturer: "BrainAccess",
    model: "MAXI 009",
    thumbnail: "/devices/brainaccess-maxi.png",
  },
  target: "BA MAXI 009",
  matches: (deviceName) => deviceName === "BA MAXI 009",
  channelLabels: BRAINACCESS_MAXI_EEG_LABELS,
  neurostateProfile: "standard",
};

export const BRAINACCESS_MIDI_PROFILE: BrainAccessProfile = {
  info: {
    id: "brainaccess-midi",
    name: "BrainAccess MIDI",
    kind: "eeg",
    transport: "bluetooth",
    manufacturer: "BrainAccess",
    model: "MIDI",
  },
  target: "BA MIDI",
  // Every MIDI headset advertises itself as "BA MIDI <serial>", e.g. "BA MIDI 026".
  matches: (deviceName) => /^BA MIDI\b/u.test(deviceName),
  channelLabels: BRAINACCESS_MIDI_EEG_LABELS,
  biasElectrodes: [0],
  neurostateProfile: "brainaccess-midi",
};

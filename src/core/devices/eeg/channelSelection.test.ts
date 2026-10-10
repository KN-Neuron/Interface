import { describe, expect, it } from "vitest";

import type { EEGStreamInfo } from "../models/eeg";
import { resolveEEGChannels } from "./channelSelection";

const SSVEP_CHANNELS = ["O1", "O2", "Oz", "PO3", "PO4", "POz"] as const;

const CHANNEL_LABELS = [
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

const STREAM_INFO: EEGStreamInfo = {
  sampleRateHz: 250,

  channels: CHANNEL_LABELS.map((label, index) => ({
    index,
    label,
    type: "eeg",
    unit: "uV",
    sourceIndex: index,
  })),
};

describe("resolveEEGChannels", () => {
  it("resolves six SSVEP channels from a 32-channel device", () => {
    const result = resolveEEGChannels(STREAM_INFO, SSVEP_CHANNELS);

    expect(result.complete).toBe(true);
    expect(result.missingLabels).toEqual([]);
    expect(result.resolved).toHaveLength(6);

    expect(result.resolved.map((entry) => entry.channel.label)).toEqual([
      "O1",
      "O2",
      "Oz",
      "PO3",
      "PO4",
      "POz",
    ]);
  });

  it("reports missing channels", () => {
    const result = resolveEEGChannels(STREAM_INFO, ["O1", "O2", "PO5"]);

    expect(result.complete).toBe(false);
    expect(result.missingLabels).toEqual(["PO5"]);
  });

  it("matches channel labels case-insensitively", () => {
    const result = resolveEEGChannels(STREAM_INFO, ["o1", " oz ", "po3"]);

    expect(result.complete).toBe(true);

    expect(result.resolved.map((entry) => entry.channel.label)).toEqual(["O1", "Oz", "PO3"]);
  });
});

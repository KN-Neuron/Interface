import { createRef } from "react";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SignalCheckInfo, SignalCheckStatus } from "../../../core/neurostate";
import { validateModuleManifest } from "../../../lib/moduleValidation";
import { SignalCheckModule } from "../SignalCheckModule";
import type { SignalCheckSnapshot } from "../hooks/useSignalCheck";
import { signalCheckManifest } from "../signalCheckModuleDefinition";
import { SignalRingBuffer } from "../signalRingBuffer";
import { describeProblems, describeStream, regionTone } from "../summary";

const hook = vi.hoisted(() => ({ useSignalCheck: vi.fn() }));

vi.mock("../hooks/useSignalCheck", () => ({
  SHOWN_SECONDS: 5,
  useSignalCheck: hook.useSignalCheck,
}));

const INFO: SignalCheckInfo = {
  stream: "KNeuron BA MIDI 026",
  samplingRateHz: 250,
  labels: ["Fz", "O1", "Oz", "O2"],
  regions: { frontal: ["Fz"], parietal: [], occipital: ["O1", "Oz", "O2"] },
  spectrumChannels: ["O1", "Oz", "O2"],
  alphaHz: [8, 13],
  thresholds: { flatUv: 0.5, noisyUv: 50, mainsRatio: 10 },
};

const STATUS: SignalCheckStatus = {
  stream: {
    nominalRateHz: 250,
    receivedRateHz: 249.84,
    gaps: 1,
    missingSamples: 12,
    secondsSinceData: 0.04,
  },
  channels: [
    { label: "Fz", status: "ok", rmsUv: 9.81, mainsRatio: 0.2 },
    { label: "O1", status: "noisy", rmsUv: 71.4, mainsRatio: 0.4 },
    { label: "Oz", status: "flat", rmsUv: 0.12, mainsRatio: null },
    { label: "O2", status: "ok", rmsUv: 11.2, mainsRatio: 0.3 },
  ],
  regions: {
    frontal: { good: 1, total: 1 },
    parietal: { good: 0, total: 0 },
    occipital: { good: 1, total: 3 },
  },
  spectrum: { hz: [1, 2, 3], psd: [20, 8, 3] },
};

function snapshot(overrides: Partial<SignalCheckSnapshot>): SignalCheckSnapshot {
  return {
    state: { state: "running", message: null },
    info: null,
    status: null,
    signals: createRef(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe("SignalRingBuffer", () => {
  it("keeps the newest samples per channel, oldest first", () => {
    const buffer = new SignalRingBuffer(2, 4);

    buffer.push([
      [1, 2, 3],
      [10, 20, 30],
    ]);
    buffer.push([
      [4, 5],
      [40, 50],
    ]);

    expect(buffer.length).toBe(4);
    expect([0, 1, 2, 3].map((index) => buffer.read(0, index))).toEqual([2, 3, 4, 5]);
    expect([0, 1, 2, 3].map((index) => buffer.read(1, index))).toEqual([20, 30, 40, 50]);
    expect(buffer.version).toBe(2);
  });
});

describe("signal check summaries", () => {
  it("rates regions like neurostate check", () => {
    expect(regionTone(3, 3)).toBe("good");
    expect(regionTone(1, 3)).toBe("partial");
    expect(regionTone(0, 3)).toBe("bad");
    expect(regionTone(0, 0)).toBe("bad");
  });

  it("lists the channels with problems", () => {
    expect(describeProblems(STATUS.channels)).toBe("O1 noisy, Oz flat");
    expect(describeProblems([STATUS.channels[0]!])).toBeNull();
  });

  it("describes the stream's health", () => {
    expect(describeStream(INFO, STATUS)).toEqual([
      { text: "4 EEG channels", bad: false },
      { text: "250 Hz, 249.8 received", bad: false },
      { text: "1 gap, 12 samples missing", bad: true },
    ]);

    expect(describeStream(INFO, null)).toContainEqual({ text: "waiting for data", bad: true });

    const stalled = { ...STATUS, stream: { ...STATUS.stream, secondsSinceData: 4.2, gaps: 0 } };
    expect(describeStream(INFO, stalled)).toContainEqual({ text: "no data for 4 s", bad: true });
  });
});

describe("SignalCheckModule", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks for a cap when none is connected", () => {
    hook.useSignalCheck.mockReturnValue(
      snapshot({
        state: { state: "unavailable", message: "Connect an EEG cap on the Device page." },
      }),
    );

    render(<SignalCheckModule onRequestClose={vi.fn()} />);

    expect(screen.getByText("NO CAP")).toBeInTheDocument();
    expect(screen.getByText("Connect an EEG cap on the Device page.")).toBeInTheDocument();
  });

  it("offers a retry when the check failed", () => {
    const retry = vi.fn();
    hook.useSignalCheck.mockReturnValue(
      snapshot({ state: { state: "error", message: "Signal check failed: lost" }, retry }),
    );

    render(<SignalCheckModule onRequestClose={vi.fn()} />);
    screen.getByRole("button", { name: "RETRY" }).click();

    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows every channel's status, the regions and the problems", () => {
    hook.useSignalCheck.mockReturnValue(snapshot({ info: INFO, status: STATUS }));

    render(<SignalCheckModule onRequestClose={vi.fn()} />);

    expect(screen.getByText("KNeuron BA MIDI 026")).toBeInTheDocument();
    expect(screen.getByText("Problems: O1 noisy, Oz flat")).toBeInTheDocument();
    expect(screen.getByText("1/3 good")).toBeInTheDocument();
    expect(screen.getByText("71.4 µV")).toBeInTheDocument();
    expect(screen.getAllByText("NOISY")).toHaveLength(1);
    expect(screen.getAllByText("FLAT")).toHaveLength(1);
    expect(screen.getByText("Spectrum · O1, Oz, O2")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Filtered EEG of 4 channels/u })).toBeInTheDocument();
  });

  it("says when every channel is fine", () => {
    const fine = {
      ...STATUS,
      channels: STATUS.channels.map((channel) => ({ ...channel, status: "ok" as const })),
    };
    hook.useSignalCheck.mockReturnValue(snapshot({ info: INFO, status: fine }));

    render(<SignalCheckModule onRequestClose={vi.fn()} />);

    expect(screen.getByText("All channels look fine")).toBeInTheDocument();
  });
});

describe("signal check manifest", () => {
  it("is valid", () => {
    expect(validateModuleManifest(signalCheckManifest)).toEqual({ valid: true, errors: [] });
  });
});

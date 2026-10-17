import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ classify: vi.fn() }));
vi.mock("../../../core/ssvep", async (original) => ({
  ...(await original<typeof import("../../../core/ssvep")>()),
  ssvepClassifierService: mocks,
}));
vi.mock("../hooks/useMinerEEG", () => ({
  useMinerEEG: () => ({
    state: "streaming",
    sampleRateHz: 250,
    channelCount: 6,
    beginCapture: () => {},
    stopCapture: () => {},
    availableCaptureSamples: () => 10000,
    takeLatestCapture: () => [[]],
  }),
}));
vi.mock("../components/SsvepOverlay", () => ({
  SsvepOverlay: ({ onCancel }: { onCancel: () => void }) => (
    <button onClick={onCancel}>Cancel trial</button>
  ),
}));
import { MinerModule } from "../MinerModule";

afterEach(() => vi.restoreAllMocks());

it.each(["resolve", "reject"])(
  "ignores a cancelled classification that later %ss",
  async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    mocks.classify.mockReturnValue(
      new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      }),
    );
    let frame!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    render(<MinerModule onRequestClose={vi.fn()} />);
    fireEvent.click(screen.getByText("SELECT WITH GAZE"));
    act(() => frame(10000));
    act(() => frame(20000));
    expect(mocks.classify).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel trial"));
    fireEvent.click(screen.getByText("SELECT WITH GAZE"));
    await act(async () => {
      if (outcome === "resolve") resolve({ direction: "RIGHT", winnerHz: 14.25, scores: {} });
      else reject(new Error("Late failure"));
    });
    // A stale completion must not close the new trial or replace its status.
    expect(screen.getByText("Cancel trial")).toBeInTheDocument();
    expect(screen.queryByText("SSVEP TRIAL ERROR")).not.toBeInTheDocument();
    expect(screen.queryByText(/FBCCA: RIGHT/)).not.toBeInTheDocument();
  },
);

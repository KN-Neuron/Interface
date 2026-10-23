import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CORTEX_PALETTE, loadCortexPalette } from "../models/palette";

vi.mock("../hooks/useCortexEEG", () => ({
  useCortexEEG: () => ({
    state: "streaming",
    started: true,
    sampleRateHz: 250,
    channelCount: 1,
    lastSequence: 12,
    receivedSamples: 13,
    droppedSamples: 0,
    fastActivityByLabel: { O1: 25 },
    bandActivityByLabel: { alpha: { O1: 10 } },
    signalQualityByLabel: { O1: 1 },
    flatChannels: [],
    stopExperience: vi.fn(),
  }),
}));
vi.mock("../components/CortexViewport", () => ({
  CortexViewport: (props: { palette: unknown; activityByLabel: unknown }) => (
    <div
      data-testid="viewport"
      data-palette={JSON.stringify(props.palette)}
      data-activity={JSON.stringify(props.activityByLabel)}
    />
  ),
}));
import { CortexModule } from "../CortexModule";

beforeEach(() => localStorage.clear());
it("applies, saves, and resets exactly two color choices", () => {
  render(<CortexModule onRequestClose={vi.fn()} />);
  expect(screen.queryByText(/recalibrate/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Medium signal color"), { target: { value: "#112233" } });
  fireEvent.change(screen.getByLabelText("Strong signal color"), { target: { value: "#ff00aa" } });
  expect(loadCortexPalette()).toEqual({ medium: "#112233", strong: "#ff00aa" });
  expect(screen.getByTestId("viewport")).toHaveAttribute(
    "data-palette",
    JSON.stringify(loadCortexPalette()),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset colors" }));
  expect(loadCortexPalette()).toEqual(DEFAULT_CORTEX_PALETTE);
});
it("updates fixed sensitivity without restarting signal processing", () => {
  render(<CortexModule onRequestClose={vi.fn()} />);
  expect(screen.getByTestId("viewport")).toHaveAttribute("data-activity", '{"O1":0.5}');
  fireEvent.change(screen.getByLabelText(/Sensitivity/), { target: { value: "100" } });
  expect(screen.getByTestId("viewport")).toHaveAttribute("data-activity", '{"O1":0.25}');
});

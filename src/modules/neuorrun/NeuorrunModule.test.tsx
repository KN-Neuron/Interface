import { act, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const brain = vi.hoisted(() => ({
  metrics: { attention: 70, meditation: 30, poorSignalLevel: 0 },
  state: "live",
  retry: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./hooks/useBrainMetrics", () => ({ useBrainMetrics: () => brain }));
vi.mock("../../lib/unityRuntime", async (original) => ({
  ...(await original<typeof import("../../lib/unityRuntime")>()),
  loadUnityRuntime: runtime.load,
}));
import { NeuorrunModule } from "./NeuorrunModule";

it("sends metrics received before Unity finishes loading", async () => {
  const send = vi.fn();
  const quit = vi.fn().mockResolvedValue(undefined);
  let ready!: (instance: { SendMessage: typeof send; Quit: typeof quit }) => void;
  runtime.load.mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const { unmount } = render(<NeuorrunModule onRequestClose={vi.fn()} />);
  await waitFor(() => expect(runtime.load).toHaveBeenCalled());
  expect(send).not.toHaveBeenCalled();
  await act(async () => ready({ SendMessage: send, Quit: quit }));
  expect(send).toHaveBeenCalledWith(
    "KNeuronBridge",
    "SetMetricsJson",
    JSON.stringify(brain.metrics),
  );
  unmount();
  expect(quit).toHaveBeenCalledOnce();
});

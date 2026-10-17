import { act, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const brain = vi.hoisted(() => ({
  metrics: { attention: 70, meditation: 30, poorSignalLevel: 0 },
  state: "live",
  retry: vi.fn(),
}));
vi.mock("./hooks/useBrainMetrics", () => ({ useBrainMetrics: () => brain }));
import { NeuorrunModule } from "./NeuorrunModule";

it("sends metrics received before Unity finishes loading", async () => {
  const send = vi.fn();
  const quit = vi.fn().mockResolvedValue(undefined);
  let ready!: (instance: { SendMessage: typeof send; Quit: typeof quit }) => void;
  const create = vi.fn(
    () =>
      new Promise<{ SendMessage: typeof send; Quit: typeof quit }>((resolve) => {
        ready = resolve;
      }),
  );
  window.createUnityInstance = create;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ready: true,
        loader: "loader.js",
        data: "data",
        framework: "framework",
        code: "code",
      }),
    }),
  );
  try {
    const { unmount } = render(<NeuorrunModule onRequestClose={vi.fn()} />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(send).not.toHaveBeenCalled();
    await act(async () => ready({ SendMessage: send, Quit: quit }));
    expect(send).toHaveBeenCalledWith(
      "KNeuronBridge",
      "SetMetricsJson",
      JSON.stringify(brain.metrics),
    );
    unmount();
  } finally {
    delete window.createUnityInstance;
    vi.unstubAllGlobals();
  }
});

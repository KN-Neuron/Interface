import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TalonModule } from "./TalonModule";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  receive: vi.fn(),
  dispose: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("../../lib/unityRuntime", async (original) => ({
  ...(await original<typeof import("../../lib/unityRuntime")>()),
  loadUnityRuntime: mocks.load,
}));
vi.mock("./TalonEegBridge", () => ({
  TalonEegBridge: class {
    receive = mocks.receive;
    dispose = mocks.dispose;
    cancel = mocks.cancel;
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
});

it("embeds the game and tears it down on module exit", async () => {
  const instance = { SendMessage: vi.fn(), Quit: vi.fn().mockResolvedValue(undefined) };
  mocks.load.mockResolvedValue(instance);
  const close = vi.fn();
  const { unmount } = render(<TalonModule onRequestClose={close} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  const session = mocks.load.mock.calls[0][4].kneuronSession;
  act(() =>
    window.dispatchEvent(new CustomEvent("kneuron:talon", { detail: { type: "ready", session } })),
  );
  expect(screen.getByLabelText("TALON game")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "EXIT MODULE" }));
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(instance.Quit).toHaveBeenCalledOnce();
  expect(mocks.dispose).toHaveBeenCalledOnce();
});

it("ignores events from another game session", async () => {
  const instance = { SendMessage: vi.fn(), Quit: vi.fn().mockResolvedValue(undefined) };
  mocks.load.mockResolvedValue(instance);
  const close = vi.fn();
  render(<TalonModule onRequestClose={close} />);
  await waitFor(() => expect(mocks.load).toHaveBeenCalled());
  const session = mocks.load.mock.calls[0][4].kneuronSession;
  act(() =>
    window.dispatchEvent(
      new CustomEvent("kneuron:talon", { detail: { type: "exit", session: "old" } }),
    ),
  );
  expect(close).not.toHaveBeenCalled();
  act(() =>
    window.dispatchEvent(new CustomEvent("kneuron:talon", { detail: { type: "exit", session } })),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("shows loader failures", async () => {
  mocks.load.mockRejectedValue(new Error("WASM download failed"));
  render(<TalonModule onRequestClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("WASM download failed");
});

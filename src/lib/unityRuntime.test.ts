import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type UnityInstance, loadUnityRuntime } from "./unityRuntime";

const manifest = {
  ready: true,
  loader: "Build/game.loader.js",
  data: "Build/game.data",
  framework: "Build/game.framework.js",
  code: "Build/game.wasm",
};
beforeEach(() =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => manifest })),
);
afterEach(() => {
  vi.unstubAllGlobals();
  delete window.createUnityInstance;
});
async function loadScript(factory: NonNullable<Window["createUnityInstance"]>) {
  for (let i = 0; i < 20 && !document.querySelector("script[data-kneuron-unity-loader]"); i++)
    await Promise.resolve();
  const script = document.querySelector("script[data-kneuron-unity-loader]");
  expect(script).not.toBeNull();
  window.createUnityInstance = factory;
  script!.dispatchEvent(new Event("load"));
}

it("loads the correct factory after the previous game finishes quitting", async () => {
  const firstQuit = vi.fn().mockResolvedValue(undefined);
  const first = loadUnityRuntime(
    document.createElement("canvas"),
    "/neuorrun",
    new AbortController().signal,
    vi.fn(),
  );
  await loadScript(vi.fn().mockResolvedValue({ SendMessage: vi.fn(), Quit: firstQuit }));
  const one = await first;
  const secondFactory = vi
    .fn()
    .mockResolvedValue({ SendMessage: vi.fn(), Quit: vi.fn().mockResolvedValue(undefined) });
  const second = loadUnityRuntime(
    document.createElement("canvas"),
    "/talon",
    new AbortController().signal,
    vi.fn(),
  );
  await Promise.resolve();
  expect(secondFactory).not.toHaveBeenCalled();
  await one.Quit();
  await loadScript(secondFactory);
  const two = await second;
  expect(secondFactory.mock.calls[0][0].id).not.toBe("");
  expect(secondFactory.mock.calls[0][1]).toMatchObject({ codeUrl: "/talon/Build/game.wasm" });
  expect(firstQuit).toHaveBeenCalledOnce();
  await two.Quit();
});

it("quits a late-created instance after navigation cancels startup", async () => {
  const controller = new AbortController();
  const quit = vi.fn().mockResolvedValue(undefined);
  let ready!: (value: UnityInstance) => void;
  const factory = vi.fn(
    () =>
      new Promise<UnityInstance>((resolve) => {
        ready = resolve;
      }),
  );
  const loading = loadUnityRuntime(
    document.createElement("canvas"),
    "/talon",
    controller.signal,
    vi.fn(),
  );
  const rejected = expect(loading).rejects.toBeDefined();
  await loadScript(factory);
  for (let i = 0; i < 10 && !factory.mock.calls.length; i++) await Promise.resolve();
  controller.abort();
  ready({ SendMessage: vi.fn(), Quit: quit });
  await rejected;
  expect(quit).toHaveBeenCalledOnce();
});

it("can replace a non-configurable global factory created by a classic Unity script", async () => {
  const fakeWindow = { devicePixelRatio: 1 };
  Object.defineProperty(fakeWindow, "createUnityInstance", {
    value: vi.fn(),
    writable: true,
    configurable: false,
  });
  vi.stubGlobal("window", fakeWindow);
  const loading = loadUnityRuntime(
    document.createElement("canvas"),
    "/talon",
    new AbortController().signal,
    vi.fn(),
  );
  const factory = vi
    .fn()
    .mockResolvedValue({ SendMessage: vi.fn(), Quit: vi.fn().mockResolvedValue(undefined) });
  await loadScript(factory);
  const player = await loading;
  expect(factory).toHaveBeenCalledOnce();
  await player.Quit();
});

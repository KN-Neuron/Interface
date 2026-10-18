import { afterEach, expect, it, vi } from "vitest";
import { deviceRegistry } from "./deviceRegistry";
import { registerBuiltInDevices } from "./registerBuiltInDevices";

afterEach(() => {
  for (const adapter of deviceRegistry.getAll()) deviceRegistry.unregister(adapter.info.id);
  vi.unstubAllEnvs();
});

it("registers physical bridge adapters and simulations in browser builds", () => {
  vi.stubEnv("VITE_RUNTIME", "web");
  registerBuiltInDevices();
  registerBuiltInDevices();
  expect(deviceRegistry.getAll().map((adapter) => adapter.info.id)).toEqual([
    "brainaccess-maxi-009",
    "brainlink-lite",
    "simulation-eeg",
    "simulation-brain-metrics",
  ]);
});

it("keeps physical adapters in desktop builds", () => {
  vi.stubEnv("VITE_RUNTIME", "");
  registerBuiltInDevices();
  expect(deviceRegistry.getAll().map((adapter) => adapter.info.id)).toEqual([
    "brainaccess-maxi-009",
    "brainlink-lite",
  ]);
});

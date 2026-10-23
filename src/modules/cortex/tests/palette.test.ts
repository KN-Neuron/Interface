import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_CORTEX_PALETTE, loadCortexPalette, saveCortexPalette } from "../models/palette";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("restores both chosen colors after saving", () => {
  const palette = { medium: "#112233", strong: "#ff00aa" };
  saveCortexPalette(palette);
  expect(loadCortexPalette()).toEqual(palette);
});
it("uses defaults for malformed saved colors", () => {
  localStorage.setItem("kneuron.cortex.palette.v1", '{"medium":"red","strong":"#ffffff"}');
  expect(loadCortexPalette()).toEqual(DEFAULT_CORTEX_PALETTE);
});
it("allows color controls to work when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => saveCortexPalette(DEFAULT_CORTEX_PALETTE)).not.toThrow();
});

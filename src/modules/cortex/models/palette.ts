export interface CortexPalette {
  medium: string;
  strong: string;
}

export const DEFAULT_CORTEX_PALETTE: CortexPalette = {
  medium: "#8fd9bf",
  strong: "#f76608",
};
const STORAGE_KEY = "kneuron.cortex.palette.v1";

export function loadCortexPalette(): CortexPalette {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      saved &&
      typeof saved === "object" &&
      "medium" in saved &&
      "strong" in saved &&
      typeof saved.medium === "string" &&
      /^#[0-9a-f]{6}$/i.test(saved.medium) &&
      typeof saved.strong === "string" &&
      /^#[0-9a-f]{6}$/i.test(saved.strong)
    ) {
      return { medium: saved.medium, strong: saved.strong };
    }
  } catch {
    /* Use defaults when browser storage is unavailable. */
  }
  return { ...DEFAULT_CORTEX_PALETTE };
}

export function saveCortexPalette(palette: CortexPalette): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palette));
  } catch {
    /* Color controls remain usable without storage. */
  }
}

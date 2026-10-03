import { useCallback, useState } from "react";

export interface PanelSizeOptions {
  /**
   * localStorage key. Each resizable panel keeps its own width per viewer.
   */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
}

export interface PanelSize {
  width: number;
  collapsed: boolean;
  setWidth: (width: number) => void;
  resetWidth: () => void;
  setCollapsed: (collapsed: boolean) => void;
  limits: { min: number; max: number; default: number };
}

interface StoredPanelSize {
  width: number;
  collapsed: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readStored(options: PanelSizeOptions): StoredPanelSize {
  const fallback = { width: options.defaultWidth, collapsed: false };

  try {
    const raw = localStorage.getItem(options.storageKey);

    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<StoredPanelSize>;

    return {
      width:
        typeof parsed.width === "number" && Number.isFinite(parsed.width)
          ? clamp(parsed.width, options.minWidth, options.maxWidth)
          : options.defaultWidth,
      collapsed: parsed.collapsed === true,
    };
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: StoredPanelSize): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the panel
    // still works, it just won't remember its width.
  }
}

/**
 * Width + collapsed state of a side panel, remembered between sessions.
 */
export function usePanelSize(options: PanelSizeOptions): PanelSize {
  const [state, setState] = useState<StoredPanelSize>(() => readStored(options));

  const { storageKey, minWidth, maxWidth, defaultWidth } = options;

  const update = useCallback(
    (next: StoredPanelSize) => {
      setState(next);
      writeStored(storageKey, next);
    },
    [storageKey],
  );

  const setWidth = useCallback(
    (width: number) => {
      update({ width: clamp(width, minWidth, maxWidth), collapsed: false });
    },
    [update, minWidth, maxWidth],
  );

  const resetWidth = useCallback(() => {
    update({ width: defaultWidth, collapsed: false });
  }, [update, defaultWidth]);

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      setState((current) => {
        const next = { ...current, collapsed };
        writeStored(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return {
    width: state.width,
    collapsed: state.collapsed,
    setWidth,
    resetWidth,
    setCollapsed,
    limits: { min: minWidth, max: maxWidth, default: defaultWidth },
  };
}

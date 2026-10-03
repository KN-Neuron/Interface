import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrainLogo } from "./BrainLogo";
import { APP_CONFIG } from "../config/appConfig";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export function TitleBar({ children }: { children?: ReactNode }) {
  const run = async (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    if (action === "minimize") await win.minimize();
    if (action === "maximize") await win.toggleMaximize();
    if (action === "close") await win.close();
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <BrainLogo size={26} />
        <strong data-tauri-drag-region>{APP_CONFIG.name}</strong>
      </div>

      {children}

      <div className="titlebar__spacer" data-tauri-drag-region />

      <div className="window-controls">
        <button aria-label="Minimize" onClick={() => void run("minimize")}>
          <Minus size={16} />
        </button>
        <button aria-label="Maximize" onClick={() => void run("maximize")}>
          <Square size={13} />
        </button>
        <button aria-label="Close" className="close" onClick={() => void run("close")}>
          <X size={16} />
        </button>
      </div>
    </header>
  );
}

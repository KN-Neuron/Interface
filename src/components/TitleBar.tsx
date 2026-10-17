import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BrainLogo } from "./BrainLogo";
import { APP_CONFIG } from "../config/appConfig";

const isTauri = () => "__TAURI_INTERNALS__" in window;

/**
 * Top bar: wordmark and window controls.
 */
export function TitleBar() {
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
        <BrainLogo size={44} />
        <div className="brand__text" data-tauri-drag-region>
          <strong data-tauri-drag-region>{APP_CONFIG.name}</strong>
          <span data-tauri-drag-region>
            {import.meta.env.VITE_RUNTIME === "web"
              ? "Browser demo · simulated devices"
              : "Brain-Computer Interface"}
          </span>
        </div>
      </div>

      <div className="titlebar__drag" data-tauri-drag-region />

      {isTauri() ? (
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
      ) : null}
    </header>
  );
}

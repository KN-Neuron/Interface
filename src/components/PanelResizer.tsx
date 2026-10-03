import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PanelSize } from "../lib/usePanelSize";

const KEYBOARD_STEP = 16;

/**
 * Vertical drag handle placed on the left edge of a right-hand side panel.
 *
 * Drag or use the arrow keys to resize, double-click to restore the default
 * width, and use the button to collapse the panel completely.
 */
export function PanelResizer({ panel, label }: { panel: PanelSize; label: string }) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { width, collapsed, setWidth, resetWidth, setCollapsed, limits } = panel;

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      startX: event.clientX,
      startWidth: collapsed ? limits.min : width,
    };

    document.body.classList.add("is-resizing-panel");
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    // The panel sits to the right of the handle: moving left widens it.
    setWidth(drag.startWidth + (drag.startX - event.clientX));
  }

  function endDrag(event: PointerEvent<HTMLDivElement>): void {
    if (!dragRef.current) {
      return;
    }

    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    document.body.classList.remove("is-resizing-panel");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const current = collapsed ? limits.min : width;

    switch (event.key) {
      case "ArrowLeft":
        setWidth(current + KEYBOARD_STEP);
        break;
      case "ArrowRight":
        setWidth(current - KEYBOARD_STEP);
        break;
      case "Home":
        setWidth(limits.max);
        break;
      case "End":
        setWidth(limits.min);
        break;
      case "Enter":
        setCollapsed(!collapsed);
        break;
      default:
        return;
    }

    event.preventDefault();
  }

  return (
    <div
      className={collapsed ? "panel-resizer is-collapsed" : "panel-resizer"}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuenow={collapsed ? 0 : width}
      tabIndex={0}
      title="Drag to resize, double-click to reset"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest("button")) {
          resetWidth();
        }
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />

      <button
        type="button"
        className="panel-resizer__toggle"
        aria-label={collapsed ? `Show ${label}` : `Hide ${label}`}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  );
}

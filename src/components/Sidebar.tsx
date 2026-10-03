import type { ShellPage } from "../types/navigation";

const items: Array<{ id: ShellPage; label: string }> = [
  { id: "dashboard", label: "Modules" },
  { id: "device", label: "Devices" },
  { id: "settings", label: "Settings" },
];

/**
 * Main navigation, rendered as a mode selector inside the title bar.
 *
 * `page` is null while a module is open, so no mode appears selected.
 */
export function Sidebar({
  page,
  onNavigate,
}: {
  page: ShellPage | null;
  onNavigate: (page: ShellPage) => void;
}) {
  return (
    <nav className="mode-switch" aria-label="Main navigation">
      {items.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={page === id ? "mode-switch__item is-active" : "mode-switch__item"}
          aria-current={page === id ? "page" : undefined}
          onClick={() => onNavigate(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

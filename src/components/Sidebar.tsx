import { LayoutGrid, Monitor, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { APP_CONFIG } from "../config/appConfig";
import type { ShellPage } from "../types/navigation";

const items: Array<{ id: ShellPage; label: string; icon: LucideIcon }> = [
  { id: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { id: "device", label: "Device", icon: Monitor },
  { id: "settings", label: "Settings", icon: Settings },
];

/**
 * Left navigation with the app version at the bottom.
 *
 * `page` is null while a module is open, so no item is marked current.
 */
export function Sidebar({
  page,
  onNavigate,
}: {
  page: ShellPage | null;
  onNavigate: (page: ShellPage) => void;
}) {
  return (
    <aside className="sidebar">
      <nav aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? "nav-item active" : "nav-item"}
            aria-current={page === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon size={24} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <strong>
          {APP_CONFIG.name} v{APP_CONFIG.version}
        </strong>
        <span>Built for Brain-Computer Interface</span>
      </div>
    </aside>
  );
}

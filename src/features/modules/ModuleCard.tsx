import { ArrowRight } from "lucide-react";

import { ModuleThumbnail } from "../../components/ModuleThumbnail";

import type { RegisteredModule } from "../../types/module";

interface ModuleCardProps {
  module: RegisteredModule;

  onOpen: ((moduleId: string) => void) | ((moduleId: string) => Promise<void>);
}

/**
 * Dashboard card: thumbnail, name, version, description, tags and Open.
 *
 * ModuleCard contains no lifecycle implementation.
 */
export function ModuleCard({ module, onOpen }: ModuleCardProps) {
  const { manifest, status } = module;

  const isOpenDisabled = status === "disabled" || status === "starting" || status === "running";

  let buttonLabel = "Open";

  if (status === "starting") {
    buttonLabel = "Starting...";
  }

  if (status === "running") {
    buttonLabel = "Running";
  }

  if (status === "error") {
    buttonLabel = "Retry";
  }

  return (
    <article className="module-card">
      <ModuleThumbnail src={manifest.appearance.thumbnail} name={manifest.name} />

      <div className="module-card__content">
        <header className="module-card__header">
          <h2 className="module-card__title">{manifest.name}</h2>

          <span className="module-card__version">v{manifest.version}</span>
        </header>

        <p className="module-card__description">{manifest.description}</p>

        <div className="module-card__meta">
          <span>{manifest.category}</span>

          {manifest.capabilities.eeg?.required && <span>EEG required</span>}
        </div>

        {status === "error" && module.error && <p className="module-card__error">{module.error}</p>}

        <button
          className="module-card__open"
          type="button"
          disabled={isOpenDisabled}
          aria-label={`${buttonLabel} ${manifest.name}`}
          onClick={() => {
            void onOpen(manifest.id);
          }}
        >
          <span>{buttonLabel}</span>
          <ArrowRight size={18} />
        </button>
      </div>
    </article>
  );
}

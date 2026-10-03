import type { RegisteredModule } from "../../types/module";

import type { ModuleReadiness } from "./moduleReadiness";

interface ModuleCardProps {
  module: RegisteredModule;

  readiness: ModuleReadiness;

  onOpen: ((moduleId: string) => void) | ((moduleId: string) => Promise<void>);
}

/**
 * Presentation component for a single KNeuron module, rendered as a row
 * of the module list.
 *
 * ModuleCard contains no lifecycle implementation.
 */
export function ModuleCard({ module, readiness, onOpen }: ModuleCardProps) {
  const { manifest, status } = module;

  const isOpenDisabled = status === "disabled" || status === "starting" || status === "running";

  let buttonLabel = "Open";

  if (status === "starting") {
    buttonLabel = "Opening…";
  }

  if (status === "running") {
    buttonLabel = "Running";
  }

  if (status === "error") {
    buttonLabel = "Open again";
  }

  return (
    <li className={readiness.ready ? "module-row is-ready" : "module-row"}>
      <div className="module-row__body">
        <h2 className="module-row__title">{manifest.name}</h2>

        <p className="module-row__description">{manifest.description}</p>

        <p className="module-row__requirement">
          <span className="module-row__need">
            <span
              className={readiness.ready ? "led led--on" : "led"}
              role="img"
              aria-label={readiness.ready ? "Ready" : "Not ready"}
            />
            <span>{readiness.requirement}</span>
          </span>
          {readiness.missing && <span className="module-row__missing">{readiness.missing}</span>}
        </p>

        {status === "error" && module.error && <p className="module-row__error">{module.error}</p>}
      </div>

      <button
        className={readiness.ready ? "primary-button" : "secondary-button"}
        type="button"
        disabled={isOpenDisabled}
        aria-label={`${buttonLabel} ${manifest.name}`}
        onClick={() => {
          void onOpen(manifest.id);
        }}
      >
        {buttonLabel}
      </button>
    </li>
  );
}

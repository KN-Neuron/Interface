import { createElement } from "react";

import { moduleComponentRegistry } from "./moduleComponentRegistry";
import { useRegisteredModules } from "./useRegisteredModules";

interface ModuleHostProps {
  moduleId: string;
  onBack: () => void;
}

/**
 * Mount point for active KNeuron modules.
 *
 * ModuleHost resolves:
 * - metadata/runtime state through ModuleRegistry,
 * - React implementation through ModuleComponentRegistry.
 *
 * It must never contain module-specific branches.
 */
export function ModuleHost({ moduleId, onBack }: ModuleHostProps) {
  const modules = useRegisteredModules();

  const registeredModule = modules.find((module) => module.manifest.id === moduleId);

  if (!registeredModule) {
    return (
      <section className="module-host">
        <header className="module-host__toolbar">
          <button type="button" className="secondary-button" onClick={onBack}>
            Back to modules
          </button>
        </header>

        <div className="module-host__fallback">
          <h1>Module unavailable</h1>

          <p>The requested module is not registered.</p>
        </div>
      </section>
    );
  }

  const moduleComponent = moduleComponentRegistry.get(moduleId);

  /**
   * Development manifests created before the component registry
   * may still exist without a React implementation.
   */
  if (!moduleComponent) {
    return (
      <section className="module-host">
        <header className="module-host__toolbar">
          <button type="button" className="secondary-button" onClick={onBack}>
            Back to modules
          </button>
        </header>

        <div className="module-host__fallback">
          <h1>{registeredModule.manifest.name}</h1>

          <p>{registeredModule.manifest.description}</p>

          <div className="architecture-note">
            <strong>Module implementation not registered</strong>

            <span>
              This manifest is registered, but no React module component is currently associated
              with it.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="module-host module-host--active">
      <header className="module-host__toolbar">
        <button type="button" className="secondary-button" onClick={onBack}>
          Back to modules
        </button>

        <div className="module-host__identity">
          <span>{registeredModule.manifest.name}</span>

          <span className="module-host__version">{registeredModule.manifest.version}</span>
        </div>
      </header>

      <div className="module-host__content">
        {createElement(moduleComponent, {
          onRequestClose: onBack,
        })}
      </div>
    </section>
  );
}

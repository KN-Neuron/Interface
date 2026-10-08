import { ModuleCard } from "../modules/ModuleCard";
import { useRegisteredModules } from "../modules/useRegisteredModules";

interface DashboardProps {
  onOpenModule: (moduleId: string) => Promise<void>;
}

/**
 * Main module launcher displayed by the KNeuron Shell.
 *
 * Dashboard knows that modules exist, but deliberately has no knowledge
 * about specific modules such as Cortex, Miner or SSVEP.
 */
export function Dashboard({ onOpenModule }: DashboardProps) {
  const modules = useRegisteredModules();

  return (
    <section className="dashboard">
      <header className="dashboard__header">
        <div>
          <h1 className="dashboard__title">Applications</h1>

          <p className="dashboard__subtitle">Choose a module to start.</p>
        </div>
      </header>

      {modules.length === 0 ? (
        <div className="dashboard-empty">
          <h2>No modules installed</h2>

          <p>Installed KNeuron modules will appear here.</p>
        </div>
      ) : (
        <div className="module-grid">
          {modules.map((module) => (
            <ModuleCard key={module.manifest.id} module={module} onOpen={onOpenModule} />
          ))}
        </div>
      )}
    </section>
  );
}

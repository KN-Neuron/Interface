import { ModuleCard } from "../modules/ModuleCard";
import { getModuleReadiness } from "../modules/moduleReadiness";
import { useRegisteredModules } from "../modules/useRegisteredModules";
import { useDevice } from "../device/useDevice";

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

  const { snapshot, streamInfoByDeviceId } = useDevice();

  const streamInfo = snapshot.activeDeviceId
    ? streamInfoByDeviceId[snapshot.activeDeviceId]
    : undefined;

  return (
    <section className="page">
      <header className="page__header">
        <h1>Modules</h1>
        <p>
          {snapshot.activeDeviceInfo
            ? `Connected to ${snapshot.activeDeviceInfo.name}.`
            : "Connect a device first, then open a module."}
        </p>
      </header>

      {modules.length === 0 ? (
        <div className="empty-state">
          <strong>No modules installed</strong>
          <p>Register a module in registerBuiltInModules.ts and it will appear here.</p>
        </div>
      ) : (
        <ul className="module-list">
          {modules.map((module) => (
            <ModuleCard
              key={module.manifest.id}
              module={module}
              readiness={getModuleReadiness(module.manifest, snapshot, streamInfo)}
              onOpen={onOpenModule}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

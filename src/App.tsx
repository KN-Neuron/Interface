import { useEffect, useState } from "react";

import { APP_CONFIG } from "./config/appConfig";

import { TitleBar } from "./components/TitleBar";

import { Sidebar } from "./components/Sidebar";

import { DevicePanel } from "./components/DevicePanel";
import { PanelResizer } from "./components/PanelResizer";

import { Dashboard } from "./features/dashboard/Dashboard";

import { DevicePage } from "./features/device/DevicePage";

import { SettingsPage } from "./features/settings/SettingsPage";

import { useSettings } from "./features/settings/useSettings";

import { ModuleHost } from "./features/modules/ModuleHost";

import { ModuleErrorBoundary } from "./features/modules/ModuleErrorBoundary";

import { closeModule, launchModule } from "./features/modules/moduleLauncher";

import { NotificationCenter } from "./features/notifications/NotificationCenter";

import { DebugPanel } from "./features/debug/DebugPanel";
import { WelcomeScreen } from "./features/welcome/WelcomeScreen";

import { logger } from "./lib/logger";

import { notificationStore } from "./lib/notificationStore";
import { usePanelSize } from "./lib/usePanelSize";

import type { AppRoute, ShellPage } from "./types/navigation";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Root component of the KNeuron desktop shell.
 */
export default function App() {
  const { settings } = useSettings();

  const [showWelcome, setShowWelcome] = useState(true);

  const readoutPanel = usePanelSize({
    storageKey: "kneuron.panel.readout",
    defaultWidth: 340,
    minWidth: 260,
    maxWidth: 560,
  });

  const [route, setRoute] = useState<AppRoute>({
    kind: "shell",
    page: "dashboard",
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setShowWelcome(false);
    }, 4000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  async function handleOpenModule(moduleId: string): Promise<void> {
    try {
      await launchModule(moduleId);

      setRoute({
        kind: "module",
        moduleId,
      });
    } catch (error) {
      const message = getErrorMessage(error);

      logger.error("Shell", `Failed to launch module "${moduleId}": ${message}`);

      notificationStore.add({
        type: "error",
        title: "Module failed to start",
        message,
        durationMs: 6000,
      });
    }
  }

  function confirmModuleExit(): boolean {
    if (route.kind !== "module" || !settings.confirmBeforeClosingModule) {
      return true;
    }

    return window.confirm("Leave the currently running module?");
  }

  function stopActiveModule(): boolean {
    if (route.kind !== "module") {
      return true;
    }

    try {
      closeModule(route.moduleId);

      return true;
    } catch (error) {
      const message = getErrorMessage(error);

      logger.error("Shell", `Failed to close module "${route.moduleId}": ${message}`);

      notificationStore.add({
        type: "error",
        title: "Module failed to close",
        message,
        durationMs: 6000,
      });

      return false;
    }
  }

  function handleReturnToDashboard(): void {
    if (!confirmModuleExit()) {
      return;
    }

    if (!stopActiveModule()) {
      return;
    }

    setRoute({
      kind: "shell",
      page: "dashboard",
    });
  }

  function handleShellNavigation(page: ShellPage): void {
    if (route.kind === "shell" && route.page === page) {
      return;
    }

    if (!confirmModuleExit()) {
      return;
    }

    if (!stopActiveModule()) {
      return;
    }

    setRoute({
      kind: "shell",
      page,
    });
  }

  function renderContent() {
    if (route.kind === "module") {
      return (
        <ModuleErrorBoundary
          key={route.moduleId}
          moduleId={route.moduleId}
          onReturnToDashboard={handleReturnToDashboard}
        >
          <ModuleHost moduleId={route.moduleId} onBack={handleReturnToDashboard} />
        </ModuleErrorBoundary>
      );
    }

    switch (route.page) {
      case "dashboard":
        return <Dashboard onOpenModule={handleOpenModule} />;

      case "device":
        return <DevicePage />;

      case "settings":
        return <SettingsPage />;

      default: {
        const exhaustiveCheck: never = route.page;

        return exhaustiveCheck;
      }
    }
  }

  const activeSidebarPage: ShellPage | null = route.kind === "shell" ? route.page : null;

  const isModuleOpen = route.kind === "module";

  const shellClassName = [
    "app-shell",
    isModuleOpen && "app-shell--module-open",
    readoutPanel.collapsed && "app-shell--readout-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  if (showWelcome) {
    return <WelcomeScreen />;
  }

  const readoutWidth = readoutPanel.collapsed ? 0 : readoutPanel.width;

  return (
    <div className={shellClassName} style={{ ["--readout-width" as string]: `${readoutWidth}px` }}>
      <TitleBar>
        <Sidebar page={activeSidebarPage} onNavigate={handleShellNavigation} />
      </TitleBar>

      <main className="main-content">{renderContent()}</main>

      {!isModuleOpen && <PanelResizer panel={readoutPanel} label="device readout" />}

      <DevicePanel
        paused={isModuleOpen || readoutPanel.collapsed}
        onOpenDevices={() => handleShellNavigation("device")}
      />

      <NotificationCenter />

      {APP_CONFIG.enableDeveloperTools && settings.showDebugInformation && <DebugPanel />}
    </div>
  );
}

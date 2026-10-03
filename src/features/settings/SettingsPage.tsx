import { APP_CONFIG } from "../../config/appConfig";
import { notificationStore } from "../../lib/notificationStore";

import { SettingToggle } from "./SettingToggle";
import { useSettings } from "./useSettings";

/**
 * Global settings screen for the KNeuron desktop shell.
 *
 * Module-specific configuration must remain inside individual modules.
 */
export function SettingsPage() {
  const { settings, updateSettings, resetSettings } = useSettings();

  function handleReset(): void {
    const confirmed = window.confirm("Reset all KNeuron settings to their default values?");

    if (!confirmed) {
      return;
    }

    resetSettings();

    notificationStore.add({
      type: "success",
      title: "Settings reset",
      message: "Default KNeuron settings have been restored.",
    });
  }

  return (
    <section className="page settings-page">
      <header className="page__header">
        <h1>Settings</h1>

        <p>Apply to the whole application. Each module keeps its own options.</p>
      </header>

      {/* GENERAL */}

      <section className="settings-section">
        <div className="settings-section__heading">
          <h2>General</h2>
        </div>

        <div className="settings-panel">
          <div className="settings-row">
            <div>
              <strong>Confirm module exit</strong>

              <span>Ask before leaving a running module.</span>
            </div>

            <SettingToggle
              checked={settings.confirmBeforeClosingModule}
              ariaLabel="Confirm before leaving a running module"
              onChange={(checked) => {
                updateSettings({
                  confirmBeforeClosingModule: checked,
                });
              }}
            />
          </div>
        </div>
      </section>

      {/* DEVELOPER — development builds only */}

      {APP_CONFIG.enableDeveloperTools && (
        <section className="settings-section">
          <div className="settings-section__heading">
            <h2>Developer</h2>

            <p>Shown only in development builds.</p>
          </div>

          <div className="settings-panel">
            <div className="settings-row">
              <div>
                <strong>Debug information</strong>

                <span>Display additional runtime diagnostic information.</span>
              </div>

              <SettingToggle
                checked={settings.showDebugInformation}
                ariaLabel="Show debug information"
                onChange={(checked) => {
                  updateSettings({
                    showDebugInformation: checked,
                  });
                }}
              />
            </div>
          </div>
        </section>
      )}

      {/* ABOUT */}

      <section className="settings-section">
        <div className="settings-section__heading">
          <h2>About</h2>
        </div>

        <div className="settings-panel">
          <div className="settings-row">
            <div>
              <strong>{APP_CONFIG.name}</strong>

              <span>Desktop shell version</span>
            </div>

            <code>v{APP_CONFIG.version}</code>
          </div>

          <div className="settings-row">
            <div>
              <strong>Environment</strong>

              <span>Build this window is running.</span>
            </div>

            <code>{APP_CONFIG.isDevelopment ? "Development" : "Production"}</code>
          </div>

          <div className="settings-row">
            <div>
              <strong>License</strong>

              <span>Distribution terms.</span>
            </div>

            <code>{APP_CONFIG.license}</code>
          </div>
        </div>
      </section>

      <div className="settings-actions">
        <button type="button" className="secondary-button" onClick={handleReset}>
          Reset settings
        </button>
      </div>
    </section>
  );
}

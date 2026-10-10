/**
 * Global configuration and immutable metadata of the KNeuron desktop shell.
 *
 * Runtime user preferences belong in SettingsStore.
 */
export const APP_CONFIG = {
  name: "KNeuron",

  version: "0.2.7",

  license: "UNLICENSED",

  /**
   * True only while running through the Vite development environment.
   */
  isDevelopment: import.meta.env.DEV,

  /**
   * Temporary test/development modules must never be registered
   * in production builds.
   */
  enableDevelopmentModules: import.meta.env.DEV,

  /**
   * Development-only diagnostics must never be exposed in production UI.
   */
  enableDeveloperTools: import.meta.env.DEV,
} as const;

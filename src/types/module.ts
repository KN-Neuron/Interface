export type ModuleManifestSchemaVersion = 1;

export type ModuleCategory = "BCI" | "VISUALIZATION" | "GAME" | "ANALYSIS" | "UTILITY";

/**
 * Visual metadata used by the KNeuron module launcher.
 */
export interface ModuleAppearance {
  thumbnail?: string;
}

/**
 * EEG requirements declared by a KNeuron module.
 *
 * The module describes what it needs.
 * It must not depend on any particular EEG manufacturer or device.
 */
export interface ModuleEEGCapability {
  /**
   * Whether an EEG device is required at all.
   */
  required: boolean;

  /**
   * Channels without which the module cannot operate correctly.
   *
   * Example for an SSVEP module:
   * O1, O2, Oz, PO3, PO4, POz
   */
  requiredChannels?: string[];

  /**
   * Optional channels that may improve processing but are not mandatory.
   */
  preferredChannels?: string[];
}

/**
 * Capabilities required or optionally used by a module.
 *
 * More capability types may be introduced later without tying modules
 * directly to specific hardware implementations.
 */
export interface ModuleCapabilities {
  eeg?: ModuleEEGCapability;
}

/**
 * Immutable manifest describing a KNeuron module.
 */
export interface KNeuronModuleManifest {
  schemaVersion: ModuleManifestSchemaVersion;

  id: string;

  name: string;

  version: string;

  description: string;

  category: ModuleCategory;

  appearance: ModuleAppearance;

  entryPoint: string;

  capabilities: ModuleCapabilities;
}

/**
 * Runtime state of a registered KNeuron module.
 */
export type ModuleRuntimeStatus = "available" | "starting" | "running" | "error" | "disabled";

/**
 * Runtime representation stored inside ModuleRegistry.
 */
export interface RegisteredModule {
  manifest: KNeuronModuleManifest;

  status: ModuleRuntimeStatus;

  error?: string;
}

import type { KNeuronModuleManifest } from "../../types/module";

export const neuorrunManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "neuorrun",
  name: "Neuorrun",
  version: "1.0.0",
  description: "Original Neuorrun Unity game integrated with BrainLink Lite attention control.",
  category: "GAME",
  appearance: {},
  entryPoint: "/modules/neuorrun",
  capabilities: {
    eeg: {
      required: false,
    },

    brainMetrics: {
      required: true,
    },
  },
};

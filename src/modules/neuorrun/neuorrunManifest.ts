import type { KNeuronModuleManifest } from "../../types/module";

export const neuorrunManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "neuorrun",
  name: "Neuorrun",
  version: "1.0.0",
  description: "Neuorrun Unity game.",
  category: "GAME",
  appearance: {
    thumbnail: "/modules/neuorrun/thumbnail.png",
  },
  entryPoint: "/modules/neuorrun",
  capabilities: {
    eeg: {
      required: false,
    },
  },
};

import type { KNeuronModuleManifest } from "../../types/module";

export const cortexManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "cortex-3d",
  name: "Cortex 3D",
  version: "1.1.0",
  description: "Interactive real-time 3D visualization of EEG activity.",
  category: "VISUALIZATION",
  appearance: {
    thumbnail: "/modules/cortex/thumbnail.webp",
  },
  entryPoint: "/modules/cortex-3d",
  capabilities: {
    eeg: {
      required: true,
    },
  },
};

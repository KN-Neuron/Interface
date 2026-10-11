import type { KNeuronModuleManifest } from "../../types/module";

export const cortexManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "cortex-3d",
  name: "THE BRAIN",
  version: "1.1.0",
  description: "Interactive real-time 3D visualization of EEG activity.",
  category: "VISUALIZATION",
  appearance: {
    thumbnail: "/modules/cortex/thumbnail.png",
  },
  entryPoint: "/modules/cortex-3d",
  capabilities: {
    eeg: {
      required: true,
    },
  },
};

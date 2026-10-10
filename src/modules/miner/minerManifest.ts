import type { KNeuronModuleManifest } from "../../types/module";

export const minerManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "taalon-miner",
  name: "Miner",
  version: "1.0.0",
  description: "SSVEP-controlled mining game.",
  category: "GAME",
  appearance: {
    thumbnail: "/modules/miner/thumbnail.png",
  },
  entryPoint: "/modules/taalon-miner",
  capabilities: {
    eeg: {
      required: true,
      requiredChannels: ["POz", "PO3", "PO4", "Oz", "O1", "O2"],
    },
  },
};

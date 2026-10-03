import type { KNeuronModuleManifest } from "../../types/module";

export const minerManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "taalon-miner",
  name: "TaaLON Miner",
  version: "1.0.0",
  description: "SSVEP-controlled mining game using the TaaLON FBCCA pipeline.",
  category: "GAME",
  appearance: {},
  entryPoint: "/modules/taalon-miner",
  capabilities: {
    eeg: {
      required: true,
      requiredChannels: ["POz", "PO3", "PO4", "Oz", "O1", "O2"],
    },
  },
};

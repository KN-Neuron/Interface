import { createExternalGameModuleDefinition } from "../externalGame/createExternalGameModuleDefinition";

import type { ExternalGame } from "../externalGame/externalGame";

import type { KNeuronModuleManifest } from "../../types/module";

export const neurosniperManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "neurosniper",
  name: "Neurosniper",
  version: "1.1.0",
  description:
    "Sniper game where your attention and relaxation steady your aim. Runs the native build through neurostate.",
  category: "GAME",
  appearance: {
    thumbnail: "/modules/neurosniper/thumbnail.png",
  },
  entryPoint: "/modules/neurosniper",
  capabilities: {
    eeg: {
      required: false,
    },
  },
};

const neurosniperGame: ExternalGame = {
  id: "neurosniper",
  name: "Neurosniper",
  repository: "KN-Neuron/Neurosniper",
  controls: [
    {
      metric: "attention",
      effect: "Keeps your shots accurate: less bullet scatter and a steadier scope.",
    },
    {
      metric: "relaxation",
      effect: "Keeps your hands steady: the scope sways less.",
    },
  ],
};

export const neurosniperModuleDefinition = createExternalGameModuleDefinition(
  neurosniperManifest,
  neurosniperGame,
);

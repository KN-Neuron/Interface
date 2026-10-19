import { createExternalGameModuleDefinition } from "../externalGame/createExternalGameModuleDefinition";

import type { ExternalGame } from "../externalGame/externalGame";

import type { KNeuronModuleManifest } from "../../types/module";

export const neurorunManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "neurorun",
  name: "Neurorun",
  version: "1.0.0",
  description:
    "Platformer where focusing moves the world around you. Runs the native build through neurostate.",
  category: "GAME",
  appearance: {
    thumbnail: "/modules/neurorun/thumbnail.png",
  },
  entryPoint: "/modules/neurorun",
  capabilities: {
    eeg: {
      required: false,
    },
  },
};

const neurorunGame: ExternalGame = {
  id: "neurorun",
  name: "Neurorun",
  repository: "KN-Neuron/Neurorun",
  controls: [
    {
      metric: "attention",
      effect:
        "Above your sensitivity threshold (40 by default, set in the game) you interact with the world, as if holding the interact button.",
    },
  ],
};

export const neurorunModuleDefinition = createExternalGameModuleDefinition(
  neurorunManifest,
  neurorunGame,
);

import type { KNeuronModuleDefinition } from "../../features/modules/moduleDefinition";
import { TalonModule } from "./TalonModule";

export const talonModuleDefinition: KNeuronModuleDefinition = {
  manifest: {
    schemaVersion: 1,
    id: "talon",
    name: "TALON",
    version: "1.0.0",
    description: "Embedded Unity drone flight and SSVEP rooftop training.",
    category: "GAME",
    appearance: {},
    entryPoint: "/modules/talon",
    capabilities: { eeg: { required: false } },
  },
  component: TalonModule,
};

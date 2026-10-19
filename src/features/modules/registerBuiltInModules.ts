import { cortexModuleDefinition } from "../../modules/cortex/cortexModuleDefinition";

import { minerModuleDefinition } from "../../modules/miner/minerModuleDefinition";

import { neuorrunModuleDefinition } from "../../modules/neuorrun/neuorrunModuleDefinition";

import { neurorunModuleDefinition } from "../../modules/neurorun/neurorunModuleDefinition";

import { neurosniperModuleDefinition } from "../../modules/neurosniper/neurosniperModuleDefinition";

import { signalCheckModuleDefinition } from "../../modules/signalCheck/signalCheckModuleDefinition";

import { moduleRegistry } from "../../lib/moduleRegistry";

import { moduleComponentRegistry } from "./moduleComponentRegistry";

import { registerModuleDefinition } from "./registerModuleDefinition";

import type { KNeuronModuleDefinition } from "./moduleDefinition";

function createBuiltInModules(): KNeuronModuleDefinition[] {
  return [
    signalCheckModuleDefinition,
    cortexModuleDefinition,
    minerModuleDefinition,
    neuorrunModuleDefinition,
    neurosniperModuleDefinition,
    neurorunModuleDefinition,
  ];
}

export function registerBuiltInModules(): void {
  const definitions = createBuiltInModules();

  for (const definition of definitions) {
    const moduleId = definition.manifest.id;
    const manifestExists = moduleRegistry.has(moduleId);
    const componentExists = moduleComponentRegistry.has(moduleId);

    if (manifestExists && componentExists) {
      continue;
    }

    if (manifestExists !== componentExists) {
      throw new Error(`Inconsistent module registration state for "${moduleId}".`);
    }

    registerModuleDefinition(definition);
  }
}

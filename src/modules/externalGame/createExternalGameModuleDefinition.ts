import { createElement, lazy, Suspense } from "react";

import type {
  KNeuronModuleDefinition,
  KNeuronModuleProps,
} from "../../features/modules/moduleDefinition";

import type { KNeuronModuleManifest } from "../../types/module";

import type { ExternalGame } from "./externalGame";

const LazyExternalGameModule = lazy(async () => {
  const module = await import("./ExternalGameModule");

  return {
    default: module.ExternalGameModule,
  };
});

/**
 * Binds a native game's manifest to the shared game launcher screen.
 */
export function createExternalGameModuleDefinition(
  manifest: KNeuronModuleManifest,
  game: ExternalGame,
): KNeuronModuleDefinition {
  if (manifest.id !== game.id) {
    throw new Error(`Game "${game.id}" must use a manifest with the same ID.`);
  }

  function ExternalGameModuleLoader(props: KNeuronModuleProps) {
    return createElement(
      Suspense,
      {
        fallback: createElement("div", null, `Loading ${game.name}...`),
      },
      createElement(LazyExternalGameModule, {
        ...props,
        game,
        thumbnail: manifest.appearance.thumbnail,
      }),
    );
  }

  return {
    manifest,
    component: ExternalGameModuleLoader,
  };
}

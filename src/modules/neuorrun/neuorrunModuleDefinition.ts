import { createElement, lazy, Suspense } from "react";

import type {
  KNeuronModuleDefinition,
  KNeuronModuleProps,
} from "../../features/modules/moduleDefinition";

import { neuorrunManifest } from "./neuorrunManifest";

const LazyNeuorrunModule = lazy(async () => {
  const module = await import("./NeuorrunModule");

  return {
    default: module.NeuorrunModule,
  };
});

function NeuorrunModuleLoader(props: KNeuronModuleProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement("div", null, "Loading Neuorrun..."),
    },
    createElement(LazyNeuorrunModule, props),
  );
}

export const neuorrunModuleDefinition: KNeuronModuleDefinition = {
  manifest: neuorrunManifest,
  component: NeuorrunModuleLoader,
};

import { createElement, lazy, Suspense } from "react";

import type {
  KNeuronModuleDefinition,
  KNeuronModuleProps,
} from "../../features/modules/moduleDefinition";

import { cortexManifest } from "./cortexManifest";

const LazyCortexModule = lazy(async () => {
  const module = await import("./CortexModule");

  return {
    default: module.CortexModule,
  };
});

function CortexModuleLoader(props: KNeuronModuleProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement("div", null, "Loading Cortex 3D..."),
    },
    createElement(LazyCortexModule, props),
  );
}

export const cortexModuleDefinition: KNeuronModuleDefinition = {
  manifest: cortexManifest,
  component: CortexModuleLoader,
};

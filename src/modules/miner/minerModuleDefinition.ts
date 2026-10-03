import { createElement, lazy, Suspense } from "react";

import type {
  KNeuronModuleDefinition,
  KNeuronModuleProps,
} from "../../features/modules/moduleDefinition";

import { minerManifest } from "./minerManifest";

const LazyMinerModule = lazy(async () => {
  const module = await import("./MinerModule");

  return {
    default: module.MinerModule,
  };
});

function MinerModuleLoader(props: KNeuronModuleProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement("div", null, "Loading TaaLON Miner..."),
    },
    createElement(LazyMinerModule, props),
  );
}

export const minerModuleDefinition: KNeuronModuleDefinition = {
  manifest: minerManifest,
  component: MinerModuleLoader,
};

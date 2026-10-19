import { createElement, lazy, Suspense } from "react";

import type {
  KNeuronModuleDefinition,
  KNeuronModuleProps,
} from "../../features/modules/moduleDefinition";

import type { KNeuronModuleManifest } from "../../types/module";

export const signalCheckManifest: KNeuronModuleManifest = {
  schemaVersion: 1,
  id: "signal-check",
  name: "Signal Check",
  version: "1.0.0",
  description:
    "Live EEG from your cap with neurostate's channel check: find flat, noisy and mains-polluted electrodes while fitting the cap.",
  category: "UTILITY",
  appearance: {
    thumbnail: "/modules/signal-check/thumbnail.png",
  },
  entryPoint: "/modules/signal-check",
  capabilities: {
    eeg: {
      required: true,
    },
  },
};

const LazySignalCheckModule = lazy(async () => {
  const module = await import("./SignalCheckModule");

  return {
    default: module.SignalCheckModule,
  };
});

function SignalCheckModuleLoader(props: KNeuronModuleProps) {
  return createElement(
    Suspense,
    {
      fallback: createElement("div", null, "Loading Signal Check..."),
    },
    createElement(LazySignalCheckModule, props),
  );
}

export const signalCheckModuleDefinition: KNeuronModuleDefinition = {
  manifest: signalCheckManifest,
  component: SignalCheckModuleLoader,
};

import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { initializeManagedHardwareSession } from "./core/devices/adapters/browser/HardwareBridge";

import { registerBuiltInDevices } from "./core/devices/registerBuiltInDevices";

import { registerBuiltInModules } from "./features/modules/registerBuiltInModules";

import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-semi-condensed/600.css";
import "@fontsource/barlow-semi-condensed/700.css";

import "./styles/app.css";

/**
 * Register device adapters bundled with KNeuron.
 */
registerBuiltInDevices();

/**
 * Register production modules bundled with KNeuron.
 */
registerBuiltInModules();

void (
  import.meta.env.VITE_RUNTIME === "web" ? initializeManagedHardwareSession() : Promise.resolve()
).then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});

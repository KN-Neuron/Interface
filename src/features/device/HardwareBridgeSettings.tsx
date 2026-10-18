import "./hardwareBridge.css";
import { useEffect, useState } from "react";
import {
  isManagedHardwareSession,
  getManagedHardwareError,
  checkHardwareBridge,
  getHardwarePairingCode,
  setHardwarePairingCode,
} from "../../core/devices/adapters/browser/HardwareBridge";

export function HardwareBridgeSettings({ busy }: { busy: boolean }) {
  const [managed, setManaged] = useState(isManagedHardwareSession);
  const [code, setCode] = useState(getHardwarePairingCode);
  const [status, setStatus] = useState(getManagedHardwareError);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const update = () => {
      setManaged(isManagedHardwareSession());
      setStatus(getManagedHardwareError());
    };
    window.addEventListener("kneuron:hardware-status", update);
    return () => window.removeEventListener("kneuron:hardware-status", update);
  }, []);
  if (managed)
    return (
      <section
        className="device-section hardware-bridge-settings"
        aria-label="Bluetooth hardware bridge"
      >
        <h2>Bluetooth headsets</h2>
        <p role="status">Bridge connected automatically. Choose a headset below.</p>
        <p>
          Closing this app window stops its Bluetooth bridge. Pair BrainLink in your operating
          system’s Bluetooth settings first.
        </p>
      </section>
    );
  return (
    <section
      className="device-section hardware-bridge-settings"
      aria-label="Bluetooth hardware bridge"
    >
      <h2>Bluetooth headsets</h2>
      <p>
        Use the managed launcher to start Docker and Bluetooth together, with automatic pairing.
        Close desktop apps using the headset. Pair BrainLink in your operating system’s Bluetooth
        settings first.
      </p>
      <p>
        <a href="/hardware-bridge/KNeuron-windows-x64.zip" download>
          Download Windows launcher
        </a>
        {" · "}
        <a href="/hardware-bridge/KNeuron-linux-x64.tar.gz" download>
          Download Linux launcher
        </a>
      </p>
      <label>
        Pairing code from the bridge window{" "}
        <input
          type="password"
          autoComplete="off"
          value={code}
          disabled={busy || checking}
          onChange={(event) => {
            setCode(event.target.value);
            setStatus("");
          }}
        />
      </label>{" "}
      <button
        type="button"
        className="primary-button"
        disabled={busy || checking || !code.trim()}
        onClick={() => {
          setHardwarePairingCode(code);
          setChecking(true);
          void checkHardwareBridge()
            .then(
              () => setStatus("Bridge ready. Connect a headset below."),
              (error: unknown) => setStatus(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setChecking(false));
        }}
      >
        {checking ? "Checking…" : "Pair bridge"}
      </button>
      <p role="status">{status}</p>
      <p>
        The code stays in this browser tab. Allow Chrome’s local network permission if requested.
        Simulations work without the bridge.
      </p>
    </section>
  );
}

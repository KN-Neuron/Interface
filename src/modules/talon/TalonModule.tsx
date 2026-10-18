import { useEffect, useRef, useState } from "react";
import type { KNeuronModuleProps } from "../../features/modules/moduleDefinition";
import {
  loadUnityRuntime,
  UnityBuildMissingError,
  type UnityInstance,
} from "../../lib/unityRuntime";
import { TalonEegBridge, type TalonRequest } from "./TalonEegBridge";
import "./talon.css";

export function TalonModule({ onRequestClose }: KNeuronModuleProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const closeRef = useRef(onRequestClose);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    closeRef.current = onRequestClose;
  }, [onRequestClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    const session = crypto.randomUUID();
    let instance: UnityInstance | null = null;
    let booted = false;
    let readyTimeout: ReturnType<typeof setTimeout> | undefined;
    const bridge = new TalonEegBridge((reply) => {
      instance?.SendMessage(
        "TalonInterfaceBridge",
        "ReceiveJson",
        JSON.stringify({ ...reply, session }),
      );
    });
    const receive = (event: Event) => {
      const request = (event as CustomEvent<unknown>).detail;
      if (
        !request ||
        typeof request !== "object" ||
        !("session" in request) ||
        request.session !== session ||
        !("type" in request) ||
        typeof request.type !== "string"
      )
        return;
      if (request.type === "ready") {
        booted = true;
        clearTimeout(readyTimeout);
        if (instance) setState("ready");
        return;
      }
      if (request.type === "exit") {
        closeRef.current();
        return;
      }
      void bridge.receive(request as TalonRequest);
    };
    const suspend = () => {
      bridge.cancel();
      instance?.SendMessage("TalonInterfaceBridge", "Suspend");
    };
    const visibility = () => {
      if (document.hidden) suspend();
    };
    window.addEventListener("kneuron:talon", receive);
    window.addEventListener("blur", suspend);
    document.addEventListener("visibilitychange", visibility);
    void loadUnityRuntime(canvas, "/talon", controller.signal, setProgress, {
      kneuronSession: session,
    })
      .then(async (player) => {
        if (controller.signal.aborted) {
          await player.Quit();
          return;
        }
        instance = player;
        setProgress(1);
        if (booted) setState("ready");
        else
          readyTimeout = setTimeout(() => {
            if (controller.signal.aborted || booted) return;
            setState("error");
            setError("TALON did not finish initializing. Exit the module and retry.");
          }, 60000);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setState(reason instanceof UnityBuildMissingError ? "missing" : "error");
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      controller.abort();
      clearTimeout(readyTimeout);
      window.removeEventListener("kneuron:talon", receive);
      window.removeEventListener("blur", suspend);
      document.removeEventListener("visibilitychange", visibility);
      bridge.dispose();
      if (instance) void instance.Quit().catch(() => {});
      instance = null;
    };
  }, []);

  return (
    <section className="talon-module">
      <header className="talon-module__bar">
        <strong>TALON</strong>
        <span>Free flight · Rooftop SSVEP training</span>
        <button type="button" onClick={onRequestClose}>
          EXIT MODULE
        </button>
      </header>
      <div className="talon-module__stage">
        <canvas
          id="talon-unity-canvas"
          ref={canvasRef}
          className="talon-module__canvas"
          tabIndex={0}
          aria-label="TALON game"
          onPointerDown={(event) => event.currentTarget.focus()}
        />
        {state === "loading" ? (
          <div className="talon-module__overlay" role="status">
            <h2>Loading TALON</h2>
            <progress value={progress} max={1} />
            <p>{Math.round(progress * 100)}%</p>
          </div>
        ) : null}
        {state === "missing" || state === "error" ? (
          <div className="talon-module__overlay" role="alert">
            <h2>
              {state === "missing" ? "TALON assets are not installed" : "TALON could not start"}
            </h2>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
      <footer className="talon-module__hint">
        For rooftop EEG training, connect your device in Interface’s Device page, then choose “Użyj
        EEG z Interface” in the game. Docker uses Simulation EEG; click testing needs no device.
      </footer>
    </section>
  );
}

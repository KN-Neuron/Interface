import { deviceManager, type DeviceManagerSnapshot } from "../../../core/devices/deviceManager";

import { useCallback, useEffect, useState } from "react";

import {
  brainMetricsService,
  type BrainMetricsHandle,
  type BrainMetricsSnapshot,
} from "../../../core/brainMetrics";

export type NeuorrunBrainState = "starting" | "live" | "unavailable";

export interface NeuorrunBrainSnapshot {
  state: NeuorrunBrainState;
  metrics: Readonly<BrainMetricsSnapshot> | null;
  message: string | null;
  retry: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useBrainMetrics(): NeuorrunBrainSnapshot {
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<NeuorrunBrainState>("starting");
  const [metrics, setMetrics] = useState<Readonly<BrainMetricsSnapshot> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const retry = useCallback(() => {
    setState("starting");
    setMessage(null);
    setMetrics(null);
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let handle: BrainMetricsHandle | null = null;

    let boundDeviceId: string | null = null;

    function syncDevice(snapshot: DeviceManagerSnapshot): void {
      if (cancelled) return;
      const connected = snapshot.activeStatus?.state === "connected";
      if (connected && handle && boundDeviceId === snapshot.activeDeviceId) return;

      handle?.release();
      handle = null;
      boundDeviceId = null;
      setMetrics(null);

      if (!connected) {
        setState("unavailable");
        setMessage(
          snapshot.activeStatus?.error ??
            snapshot.activeStatus?.message ??
            "Connect a brain-metrics device to continue.",
        );
        return;
      }

      try {
        handle = brainMetricsService.acquire((snapshot) => {
          if (cancelled) return;
          setMetrics(snapshot);
          setState("live");
          setMessage(null);
        });
        boundDeviceId = handle.deviceId;
        setState("live");
        setMessage(null);
      } catch (error) {
        setState("unavailable");
        setMessage(errorMessage(error));
      }
    }

    const unsubscribe = deviceManager.subscribe(syncDevice);
    // Defer the initial state update out of the synchronous effect body.
    void Promise.resolve().then(() => syncDevice(deviceManager.getSnapshot()));

    return () => {
      cancelled = true;
      unsubscribe();
      handle?.release();
      handle = null;
    };
  }, [generation]);

  return {
    state,
    metrics,
    message,
    retry,
  };
}

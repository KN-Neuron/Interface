import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  signalCheckService,
  type SignalCheckInfo,
  type SignalCheckStateSnapshot,
  type SignalCheckStatus,
} from "../../../core/neurostate";

import { SignalRingBuffer } from "../signalRingBuffer";

/**
 * Seconds of signal shown, as in neurostate's check window.
 */
export const SHOWN_SECONDS = 5;

export interface SignalCheckSnapshot {
  state: Readonly<SignalCheckStateSnapshot>;
  info: Readonly<SignalCheckInfo> | null;
  status: Readonly<SignalCheckStatus> | null;
  /**
   * The last few seconds of filtered signal. Updated outside React, so the
   * traces redraw without re-rendering the module.
   */
  signals: RefObject<SignalRingBuffer | null>;
  retry: () => void;
}

/**
 * Runs neurostate's signal check while the module is open.
 */
export function useSignalCheck(): SignalCheckSnapshot {
  const [state, setState] = useState(() => signalCheckService.getState());
  const [info, setInfo] = useState<Readonly<SignalCheckInfo> | null>(null);
  const [status, setStatus] = useState<Readonly<SignalCheckStatus> | null>(null);
  const signals = useRef<SignalRingBuffer | null>(null);

  useEffect(() => {
    const unsubscribe = signalCheckService.subscribeState((next) => {
      setState(next);

      if (next.state !== "running") {
        // A new run, or none: forget the previous stream's channels.
        setInfo(null);
        setStatus(null);
        signals.current = null;
      }
    });

    const handle = signalCheckService.acquire({
      onInfo: (next) => {
        signals.current = new SignalRingBuffer(
          next.labels.length,
          Math.round(next.samplingRateHz * SHOWN_SECONDS),
        );
        setInfo(next);
      },
      onStatus: setStatus,
      onSignals: (values) => {
        signals.current?.push(values);
      },
    });

    return () => {
      unsubscribe();
      handle.release();
    };
  }, []);

  const retry = useCallback(() => {
    void signalCheckService.start();
  }, []);

  return { state, info, status, signals, retry };
}

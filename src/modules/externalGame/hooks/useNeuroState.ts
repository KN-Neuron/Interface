import { useCallback, useEffect, useState } from "react";

import {
  neuroStateService,
  type NeuroStateStatus,
  type NeuroStateValues,
} from "../../../core/neurostate";

export interface NeuroStateSnapshot {
  status: Readonly<NeuroStateStatus>;
  values: Readonly<NeuroStateValues> | null;
  /**
   * Starts neurostate afresh, so it measures a new resting baseline.
   */
  restart: () => void;
}

/**
 * Keeps neurostate running on the connected cap while the module is open, and
 * follows its status and values.
 */
export function useNeuroState(): NeuroStateSnapshot {
  const [status, setStatus] = useState<Readonly<NeuroStateStatus>>(() =>
    neuroStateService.getStatus(),
  );
  const [values, setValues] = useState<Readonly<NeuroStateValues> | null>(() =>
    neuroStateService.getLatest(),
  );

  useEffect(() => {
    const unsubscribe = neuroStateService.subscribeStatus((next) => {
      setStatus(next);

      if (next.state !== "running") {
        setValues(null);
      }
    });

    const handle = neuroStateService.acquire((next) => {
      setValues(next);
    });

    return () => {
      unsubscribe();
      handle.release();
    };
  }, []);

  const restart = useCallback(() => {
    void neuroStateService.restart();
  }, []);

  return {
    status,
    values,
    restart,
  };
}

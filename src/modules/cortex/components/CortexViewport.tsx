import { useEffect, useRef } from "react";

import { CortexRenderer } from "../rendering/CortexRenderer";
import type { CortexElectrode, CortexQuality } from "../models/cortex";

interface CortexViewportProps {
  initialElectrodes: readonly CortexElectrode[];
  activityByLabel: Readonly<Record<string, number>>;
  quality: CortexQuality;
  hotspotRadius: number;
  deformation: number;
  editMode: boolean;
  labelsVisible: boolean;
  onRendererReady: (renderer: CortexRenderer | null) => void;
  onLayoutChange: (electrodes: readonly CortexElectrode[]) => void;
  onSelectionChange: (index: number) => void;
}

export function CortexViewport({
  initialElectrodes,
  activityByLabel,
  quality,
  hotspotRadius,
  deformation,
  editMode,
  labelsVisible,
  onRendererReady,
  onLayoutChange,
  onSelectionChange,
}: CortexViewportProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<CortexRenderer | null>(null);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    const renderer = new CortexRenderer(host, {
      electrodes: initialElectrodes,
      onLayoutChange,
      onSelectionChange,
    });

    rendererRef.current = renderer;
    onRendererReady(renderer);

    return () => {
      onRendererReady(null);
      rendererRef.current = null;
      renderer.dispose();
    };
    // Renderer ownership is intentionally one-time. Runtime values are sent
    // through the dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setActivityByLabel(activityByLabel);
  }, [activityByLabel]);

  useEffect(() => {
    void rendererRef.current?.loadQuality(quality);
  }, [quality]);

  useEffect(() => {
    rendererRef.current?.setHotspotRadius(hotspotRadius);
  }, [hotspotRadius]);

  useEffect(() => {
    rendererRef.current?.setDeformation(deformation);
  }, [deformation]);

  useEffect(() => {
    rendererRef.current?.setEditMode(editMode);
  }, [editMode]);

  useEffect(() => {
    rendererRef.current?.setLabelsVisible(labelsVisible);
  }, [labelsVisible]);

  return <div ref={hostRef} className="cortex-viewport" />;
}

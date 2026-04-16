import { useCallback, useEffect, useRef, useState } from "react";
import type { Trace, Viewport } from "../lib/render-electropherogram.ts";
import { PADDING, renderElectropherogram } from "../lib/render-electropherogram.ts";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 200;
const MAX_X_ZOOM = 10;
const ZOOM_WHEEL_FACTOR = 0.1;

const DYE_COLORS: Record<string, string> = {
  "6-FAM": "#0066ff",
  VIC: "#22aa22",
  NED: "#ddaa00",
  PET: "#cc3333",
  LIZ: "#ff6600",
};

function dyeColor(dyeName: string): string {
  return DYE_COLORS[dyeName] ?? "#333";
}

interface ElectropherogramWidgetProps {
  readonly fileName: string;
  readonly label: string;
  readonly channelData: Int16Array;
  readonly channelDyeName: string;
  readonly standardData: Int16Array | null;
  readonly standardDyeName: string;
  /** Externally controlled X center (e.g., from auto-align). */
  readonly xCenter?: number | undefined;
  /** Externally controlled X zoom (e.g., from auto-align). */
  readonly xZoom?: number | undefined;
  readonly onViewportChange?:
    | ((fileName: string, xCenter: number, xZoom: number) => void)
    | undefined;
}

export function ElectropherogramWidget({
  fileName,
  label,
  channelData,
  channelDyeName,
  standardData,
  standardDyeName,
  xCenter: externalXCenter,
  xZoom: externalXZoom,
  onViewportChange,
}: ElectropherogramWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [yScale, setYScale] = useState(1);
  const [standardYScale, setStandardYScale] = useState(1);

  const dataLength = channelData.length;
  const [localXCenter, setLocalXCenter] = useState(dataLength / 2);
  const [localXZoom, setLocalXZoom] = useState(1);

  // Use external values when provided, fall back to local state
  const xCenter = externalXCenter ?? localXCenter;
  const xZoom = externalXZoom ?? localXZoom;

  // Sync local state when external values change (e.g., auto-align)
  useEffect(() => {
    if (externalXCenter !== undefined) setLocalXCenter(externalXCenter);
  }, [externalXCenter]);
  useEffect(() => {
    if (externalXZoom !== undefined) setLocalXZoom(externalXZoom);
  }, [externalXZoom]);

  const setXCenter = useCallback(
    (value: number | ((prev: number) => number)) => {
      setLocalXCenter((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        onViewportChange?.(fileName, next, localXZoom);
        return next;
      });
    },
    [fileName, localXZoom, onViewportChange],
  );

  const setXZoom = useCallback(
    (value: number | ((prev: number) => number)) => {
      setLocalXZoom((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        onViewportChange?.(fileName, localXCenter, next);
        return next;
      });
    },
    [fileName, localXCenter, onViewportChange],
  );

  const dragRef = useRef<{ startX: number; startCenter: number } | null>(null);

  const computeViewport = useCallback((): Viewport => {
    const visibleScans = dataLength / xZoom;
    const halfVisible = visibleScans / 2;
    let start = xCenter - halfVisible;
    let end = xCenter + halfVisible;

    if (start < 0) {
      end -= start;
      start = 0;
    }
    if (end > dataLength) {
      start -= end - dataLength;
      end = dataLength;
      start = Math.max(0, start);
    }

    return { xStart: start, xEnd: end };
  }, [dataLength, xCenter, xZoom]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const traces: Trace[] = [
      {
        data: channelData,
        yScale,
        color: dyeColor(channelDyeName),
        lineWidth: 1.2,
        alpha: 1,
      },
    ];

    if (standardData) {
      traces.push({
        data: standardData,
        yScale: standardYScale,
        color: dyeColor(standardDyeName),
        lineWidth: 0.8,
        alpha: 0.45,
      });
    }

    renderElectropherogram(ctx, {
      traces,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      viewport: computeViewport(),
      label,
    });
  }, [
    channelData,
    channelDyeName,
    standardData,
    standardDyeName,
    yScale,
    standardYScale,
    computeViewport,
    label,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Reset viewport when data changes
  useEffect(() => {
    setLocalXCenter(dataLength / 2);
    setLocalXZoom(1);
  }, [dataLength]);

  // --- Mouse interaction ---

  const pixelToScan = useCallback(
    (pixelDeltaX: number): number => {
      const plotWidth = CANVAS_WIDTH - PADDING.left - PADDING.right;
      const viewport = computeViewport();
      const visibleScans = viewport.xEnd - viewport.xStart;
      return (pixelDeltaX / plotWidth) * visibleScans;
    },
    [computeViewport],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      dragRef.current = { startX: e.clientX, startCenter: xCenter };
      e.preventDefault();
    },
    [xCenter],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const scanDelta = pixelToScan(dx);
      setXCenter(dragRef.current.startCenter - scanDelta);
    },
    [pixelToScan, setXCenter],
  );

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const direction = e.deltaY > 0 ? -1 : 1;
      setXZoom((prev) =>
        Math.max(1, Math.min(MAX_X_ZOOM, prev * (1 + direction * ZOOM_WHEEL_FACTOR))),
      );
    },
    [setXZoom],
  );

  return (
    <div className="electropherogram-widget">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      />
      <div className="widget-controls">
        <label>
          <span className="control-label" style={{ color: dyeColor(channelDyeName) }}>
            Y {channelDyeName}
          </span>
          <input
            type="range"
            min="1"
            max="50"
            step="0.5"
            value={yScale}
            onChange={(e) => setYScale(Number(e.target.value))}
          />
          <span className="control-value">{yScale.toFixed(1)}x</span>
        </label>
        {standardData && (
          <label>
            <span className="control-label" style={{ color: dyeColor(standardDyeName) }}>
              Y {standardDyeName}
            </span>
            <input
              type="range"
              min="1"
              max="50"
              step="0.5"
              value={standardYScale}
              onChange={(e) => setStandardYScale(Number(e.target.value))}
            />
            <span className="control-value">{standardYScale.toFixed(1)}x</span>
          </label>
        )}
        <label>
          X zoom
          <input
            type="range"
            min="1"
            max={MAX_X_ZOOM}
            step="0.1"
            value={xZoom}
            onChange={(e) => setXZoom(Number(e.target.value))}
          />
          <span className="control-value">{xZoom.toFixed(1)}x</span>
        </label>
      </div>
    </div>
  );
}

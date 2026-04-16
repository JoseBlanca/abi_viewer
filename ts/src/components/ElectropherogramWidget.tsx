import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
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

export interface ViewportCommand {
  readonly version: number;
  readonly xCenter: number;
  readonly xZoom: number;
}

/** Methods exposed to the parent via ref for imperative, synchronous operations. */
export interface WidgetHandle {
  panBy(delta: number): void;
}

interface ElectropherogramWidgetProps {
  readonly label: string;
  readonly channelData: Int16Array;
  readonly channelDyeName: string;
  readonly standardData: Int16Array | null;
  readonly standardDyeName: string;
  readonly viewportCommand?: ViewportCommand | undefined;
  readonly onPanDelta?: ((delta: number) => void) | undefined;
}

export const ElectropherogramWidget = forwardRef<WidgetHandle, ElectropherogramWidgetProps>(
  function ElectropherogramWidget(
    {
      label,
      channelData,
      channelDyeName,
      standardData,
      standardDyeName,
      viewportCommand,
      onPanDelta,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [yScale, setYScale] = useState(1);
    const [standardYScale, setStandardYScale] = useState(1);

    const dataLength = channelData.length;

    // Viewport: refs are the source of truth for drawing. React state mirrors them
    // for slider UI. Helpers below keep both in sync without overwriting ref values
    // set imperatively by panBy() or drag handlers.
    const xCenterRef = useRef(dataLength / 2);
    const xZoomRef = useRef(1);
    const [xCenterState, setXCenterState] = useState(dataLength / 2);
    const [xZoomState, setXZoomState] = useState(1);

    const setXCenter = useCallback((value: number) => {
      xCenterRef.current = value;
      setXCenterState(value);
    }, []);

    const setXZoom = useCallback((value: number) => {
      xZoomRef.current = value;
      setXZoomState(value);
    }, []);

    // --- Imperative drawing (bypasses React) ---

    const drawImmediate = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const xc = xCenterRef.current;
      const xz = xZoomRef.current;
      const visibleScans = dataLength / xz;
      const half = visibleScans / 2;
      let start = xc - half;
      let end = xc + half;
      if (start < 0) {
        end -= start;
        start = 0;
      }
      if (end > dataLength) {
        start -= end - dataLength;
        end = dataLength;
        start = Math.max(0, start);
      }
      const viewport: Viewport = { xStart: start, xEnd: end };

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
        viewport,
        label,
      });
    }, [
      channelData,
      channelDyeName,
      standardData,
      standardDyeName,
      yScale,
      standardYScale,
      dataLength,
      label,
    ]);

    // Redraw when React state changes (channel switch, Y-scale slider, etc.)
    // xCenterState/xZoomState are intentional dependencies: drawImmediate reads from refs
    // (for performance during drag), but we need to trigger a redraw when state changes.
    // biome-ignore lint/correctness/useExhaustiveDependencies: viewport state triggers redraw via refs
    useEffect(() => {
      drawImmediate();
    }, [drawImmediate, xCenterState, xZoomState]);

    // --- Viewport commands (auto-align, global zoom) ---

    const appliedVersionRef = useRef(-1);
    useEffect(() => {
      if (viewportCommand && viewportCommand.version !== appliedVersionRef.current) {
        appliedVersionRef.current = viewportCommand.version;
        setXCenter(viewportCommand.xCenter);
        setXZoom(viewportCommand.xZoom);
      }
    }, [viewportCommand, setXCenter, setXZoom]);

    // Reset when data changes
    useEffect(() => {
      setXCenter(dataLength / 2);
      setXZoom(1);
    }, [dataLength, setXCenter, setXZoom]);

    // --- Imperative handle for lock-pan ---

    useImperativeHandle(
      ref,
      () => ({
        panBy(delta: number) {
          xCenterRef.current += delta;
          setXCenterState(xCenterRef.current);
          drawImmediate();
        },
      }),
      [drawImmediate],
    );

    // --- Mouse interaction (ref-based, no React state during drag) ---

    const dragRef = useRef<{ startX: number; startCenter: number } | null>(null);
    const rafRef = useRef(0);

    const pixelToScan = useCallback(
      (pixelDeltaX: number): number => {
        const plotWidth = CANVAS_WIDTH - PADDING.left - PADDING.right;
        const visibleScans = dataLength / xZoomRef.current;
        return (pixelDeltaX / plotWidth) * visibleScans;
      },
      [dataLength],
    );

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      dragRef.current = { startX: e.clientX, startCenter: xCenterRef.current };
      e.preventDefault();
    }, []);

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!dragRef.current) return;
        const dx = e.clientX - dragRef.current.startX;
        const scanDelta = pixelToScan(dx);
        const newCenter = dragRef.current.startCenter - scanDelta;
        const delta = newCenter - xCenterRef.current;
        xCenterRef.current = newCenter;

        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          drawImmediate();
        });

        onPanDelta?.(delta);
      },
      [pixelToScan, drawImmediate, onPanDelta],
    );

    const handleMouseUp = useCallback(() => {
      if (dragRef.current) {
        dragRef.current = null;
        // Commit ref → state so sliders and effects pick up the final value
        setXCenterState(xCenterRef.current); // sync state to ref (ref is already correct);
      }
    }, []);

    const handleMouseLeave = useCallback(() => {
      if (dragRef.current) {
        dragRef.current = null;
        setXCenterState(xCenterRef.current); // sync state to ref (ref is already correct);
      }
    }, []);

    const handleWheel = useCallback(
      (e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const direction = e.deltaY > 0 ? -1 : 1;
        const newZoom = Math.max(
          1,
          Math.min(MAX_X_ZOOM, xZoomRef.current * (1 + direction * ZOOM_WHEEL_FACTOR)),
        );
        setXZoom(newZoom);
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
          style={{ cursor: "grab" }}
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
              value={xZoomState}
              onChange={(e) => setXZoom(Number(e.target.value))}
            />
            <span className="control-value">{xZoomState.toFixed(1)}x</span>
          </label>
        </div>
      </div>
    );
  },
);

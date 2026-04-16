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
  /** If omitted, the current zoom is preserved. */
  readonly xZoom?: number | undefined;
}

/** Methods exposed to the parent via ref for synchronous locked-widget operations. */
export interface WidgetHandle {
  panBy(delta: number): void;
  setXZoom(value: number): void;
  setYScale(value: number): void;
  setStandardYScale(value: number): void;
}

export interface WidgetChangeEvent {
  readonly type: "pan" | "xZoom" | "yScale" | "standardYScale";
  readonly value: number;
}

interface ElectropherogramWidgetProps {
  readonly label: string;
  readonly channelData: Int16Array;
  readonly channelDyeName: string;
  readonly standardData: Int16Array | null;
  readonly standardDyeName: string;
  readonly viewportCommand?: ViewportCommand | undefined;
  readonly onWidgetChange?: ((event: WidgetChangeEvent) => void) | undefined;
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
      onWidgetChange,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [yScale, setYScaleState] = useState(1);
    const [standardYScale, setStandardYScaleState] = useState(1);
    const yScaleRef = useRef(1);
    const standardYScaleRef = useRef(1);

    const dataLength = channelData.length;

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

    const setYScale = useCallback((value: number) => {
      yScaleRef.current = value;
      setYScaleState(value);
    }, []);

    const setStandardYScale = useCallback((value: number) => {
      standardYScaleRef.current = value;
      setStandardYScaleState(value);
    }, []);

    // --- Imperative drawing ---

    const drawImmediate = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const visibleScans = dataLength / xZoomRef.current;
      const half = visibleScans / 2;
      let start = xCenterRef.current - half;
      let end = xCenterRef.current + half;
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
          yScale: yScaleRef.current,
          color: dyeColor(channelDyeName),
          lineWidth: 1.2,
          alpha: 1,
        },
      ];
      if (standardData) {
        traces.push({
          data: standardData,
          yScale: standardYScaleRef.current,
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
    }, [channelData, channelDyeName, standardData, standardDyeName, dataLength, label]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: state vars trigger redraw; drawImmediate reads refs
    useEffect(() => {
      drawImmediate();
    }, [drawImmediate, xCenterState, xZoomState, yScale, standardYScale]);

    // --- Viewport commands (auto-align, global zoom) ---

    const appliedVersionRef = useRef(-1);
    useEffect(() => {
      if (viewportCommand && viewportCommand.version !== appliedVersionRef.current) {
        appliedVersionRef.current = viewportCommand.version;
        setXCenter(viewportCommand.xCenter);
        if (viewportCommand.xZoom !== undefined) {
          setXZoom(viewportCommand.xZoom);
        }
      }
    }, [viewportCommand, setXCenter, setXZoom]);

    useEffect(() => {
      setXCenter(dataLength / 2);
      setXZoom(1);
    }, [dataLength, setXCenter, setXZoom]);

    // --- Imperative handle for locked widgets ---

    useImperativeHandle(
      ref,
      () => ({
        panBy(delta: number) {
          xCenterRef.current += delta;
          setXCenterState(xCenterRef.current);
          drawImmediate();
        },
        setXZoom(value: number) {
          xZoomRef.current = value;
          setXZoomState(value);
          drawImmediate();
        },
        setYScale(value: number) {
          yScaleRef.current = value;
          setYScaleState(value);
          drawImmediate();
        },
        setStandardYScale(value: number) {
          standardYScaleRef.current = value;
          setStandardYScaleState(value);
          drawImmediate();
        },
      }),
      [drawImmediate],
    );

    // --- Mouse interaction ---

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
        rafRef.current = requestAnimationFrame(() => drawImmediate());

        onWidgetChange?.({ type: "pan", value: delta });
      },
      [pixelToScan, drawImmediate, onWidgetChange],
    );

    const handleMouseUp = useCallback(() => {
      if (dragRef.current) {
        dragRef.current = null;
        setXCenterState(xCenterRef.current);
      }
    }, []);

    const handleMouseLeave = useCallback(() => {
      if (dragRef.current) {
        dragRef.current = null;
        setXCenterState(xCenterRef.current);
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
        onWidgetChange?.({ type: "xZoom", value: newZoom });
      },
      [setXZoom, onWidgetChange],
    );

    const handleYScaleChange = useCallback(
      (value: number) => {
        setYScale(value);
        onWidgetChange?.({ type: "yScale", value });
      },
      [setYScale, onWidgetChange],
    );

    const handleStandardYScaleChange = useCallback(
      (value: number) => {
        setStandardYScale(value);
        onWidgetChange?.({ type: "standardYScale", value });
      },
      [setStandardYScale, onWidgetChange],
    );

    const handleXZoomSliderChange = useCallback(
      (value: number) => {
        setXZoom(value);
        onWidgetChange?.({ type: "xZoom", value });
      },
      [setXZoom, onWidgetChange],
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
              onChange={(e) => handleYScaleChange(Number(e.target.value))}
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
                onChange={(e) => handleStandardYScaleChange(Number(e.target.value))}
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
              onChange={(e) => handleXZoomSliderChange(Number(e.target.value))}
            />
            <span className="control-value">{xZoomState.toFixed(1)}x</span>
          </label>
        </div>
      </div>
    );
  },
);

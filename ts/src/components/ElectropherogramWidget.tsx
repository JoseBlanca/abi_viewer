import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Electropherogram } from "../domain/electropherogram.ts";
import type { SizeCalibration } from "../domain/size-calibration.ts";
import type { Domain, XAxisMode } from "../domain/x-domain.ts";
import type { Trace, Viewport } from "../lib/render-electropherogram.ts";
import { PADDING, renderElectropherogram } from "../lib/render-electropherogram.ts";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 200;
const MAX_X_ZOOM = 10;
const ZOOM_WHEEL_FACTOR = 0.1;

// Plot geometry, derived from the shared PADDING. Used by the hover crosshair to
// map cursor pixels to domain values the same way the renderer maps them back.
const PLOT_LEFT = PADDING.left;
const PLOT_RIGHT = CANVAS_WIDTH - PADDING.right;
const PLOT_TOP = PADDING.top;
const PLOT_BOTTOM = CANVAS_HEIGHT - PADDING.bottom;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;

const CROSSHAIR_COLOR = "#555";
const TOOLTIP_BG = "rgba(255, 255, 255, 0.92)";
const TOOLTIP_BORDER = "#bbb";
const TOOLTIP_TEXT = "#222";
const TOOLTIP_FONT = "11px system-ui, sans-serif";

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

interface CrosshairReadout {
  /** Snapped x position of the sample, in canvas-internal pixels. */
  readonly px: number;
  /** Tooltip text lines (signal, scan, and bp when calibrated). */
  readonly lines: readonly string[];
}

/**
 * Snap a domain value to the nearest whole scan sample and pair it with its bp,
 * honouring the active x-axis mode. Returns null when bp can't be resolved in
 * bp mode (no calibration or value outside the calibrated range).
 */
function snapToScan(
  domainValue: number,
  mode: XAxisMode,
  calibration: SizeCalibration | null,
): { scan: number; bp: number | null } | null {
  if (mode === "bp") {
    if (!calibration) return null;
    const rawScan = calibration.bpToScan(domainValue);
    if (rawScan === null) return null;
    const scan = Math.round(rawScan);
    return { scan, bp: calibration.scanToBp(scan) };
  }
  const scan = Math.round(domainValue);
  return { scan, bp: calibration ? calibration.scanToBp(scan) : null };
}

/**
 * Resolve the hover readout at a cursor pixel: snap to the nearest scan sample,
 * read its signal, and derive bp when a calibration is available. Returns null
 * when the cursor maps outside the trace or bp can't be resolved in bp mode.
 */
function resolveReadout(
  hoverX: number,
  viewport: Viewport,
  mode: XAxisMode,
  primary: Electropherogram,
  calibration: SizeCalibration | null,
): CrosshairReadout | null {
  const { xStart, xEnd } = viewport;
  const xRange = xEnd - xStart;
  if (xRange <= 0) return null;
  const domainValue = xStart + ((hoverX - PLOT_LEFT) / PLOT_WIDTH) * xRange;

  const snapped = snapToScan(domainValue, mode, calibration);
  if (!snapped) return null;
  const { scan, bp } = snapped;
  if (scan < 0 || scan >= primary.scanCount) return null;

  const snappedDomain = mode === "bp" ? (bp ?? domainValue) : scan;
  const px = PLOT_LEFT + ((snappedDomain - xStart) / xRange) * PLOT_WIDTH;

  const lines = [`Signal: ${primary.valueAt(scan)}`, `Scan: ${scan}`];
  if (bp !== null) {
    const approx = calibration && !calibration.isReliable ? "~" : "";
    lines.push(`Size: ${approx}${bp.toFixed(1)} bp`);
  }
  return { px, lines };
}

/** Draw the vertical crosshair line and its readout tooltip onto the overlay. */
function drawCrosshairOverlay(ctx: CanvasRenderingContext2D, readout: CrosshairReadout): void {
  const { px, lines } = readout;

  ctx.save();
  ctx.strokeStyle = CROSSHAIR_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(px, PLOT_TOP);
  ctx.lineTo(px, PLOT_BOTTOM);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = TOOLTIP_FONT;
  const padX = 6;
  const padY = 4;
  const lineH = 14;
  let textW = 0;
  for (const line of lines) textW = Math.max(textW, ctx.measureText(line).width);
  const boxW = textW + padX * 2;
  const boxH = lines.length * lineH + padY * 2;
  // Sit to the right of the line, flipping left near the right edge.
  let boxX = px + 8;
  if (boxX + boxW > PLOT_RIGHT) boxX = px - 8 - boxW;
  boxX = Math.max(PLOT_LEFT, boxX);
  const boxY = PLOT_TOP + 4;

  ctx.fillStyle = TOOLTIP_BG;
  ctx.strokeStyle = TOOLTIP_BORDER;
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = TOOLTIP_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line !== undefined) ctx.fillText(line, boxX + padX, boxY + padY + i * lineH);
  }
  ctx.restore();
}

function buildLabel(base: string, mode: XAxisMode, calibration: SizeCalibration | null): string {
  if (calibration && !calibration.isReliable) return `${base}  ⚠ calibration unreliable`;
  if (mode === "bp") {
    return calibration ? `${base}  ✓ calibrated` : `${base}  ✗ no calibration`;
  }
  return calibration ? `${base}  ✓ calibrated` : base;
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
  readonly primary: Electropherogram;
  readonly standard: Electropherogram | null;
  readonly calibration: SizeCalibration | null;
  readonly xAxisMode: XAxisMode;
  /** Shared x-axis domain so every panel spans the same range and stays aligned. */
  readonly domain: Domain;
  readonly onWidgetChange?: ((event: WidgetChangeEvent) => void) | undefined;
}

export const ElectropherogramWidget = forwardRef<WidgetHandle, ElectropherogramWidgetProps>(
  function ElectropherogramWidget(
    { label, primary, standard, calibration, xAxisMode, domain, onWidgetChange },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);
    // Current visible viewport (in the active mode's units), written by
    // drawImmediate and read by the hover crosshair to map pixels to values.
    const viewportRef = useRef<Viewport>({ xStart: domain.min, xEnd: domain.max });
    // Cursor position over the plot, in canvas-internal pixels; null when the
    // pointer is away or a drag is in progress.
    const hoverXRef = useRef<number | null>(null);
    const [yScale, setYScaleState] = useState(1);
    const [standardYScale, setStandardYScaleState] = useState(1);
    const yScaleRef = useRef(1);
    const standardYScaleRef = useRef(1);

    const domainCenter = (domain.min + domain.max) / 2;
    const domainLength = domain.max - domain.min;

    // Viewport state. Values are in the current mode's units (scans or bp).
    // Refs are the source of truth for drawing; state mirrors them for sliders.
    const xCenterRef = useRef(domainCenter);
    const xZoomRef = useRef(1);
    const [xCenterState, setXCenterState] = useState(domainCenter);
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

    // Reset viewport when the domain changes (data, mode, or calibration).
    useEffect(() => {
      setXCenter(domainCenter);
      setXZoom(1);
    }, [domainCenter, setXCenter, setXZoom]);

    // --- Hover crosshair (drawn on the overlay canvas) ---

    // Draw a vertical line at the cursor plus a readout of signal, scan, and
    // (when calibrated) bp at that point. Reads hoverXRef/viewportRef so it can
    // be called both on mouse move and from drawImmediate (to stay in sync when
    // the viewport changes under a stationary cursor, e.g. on wheel zoom).
    const drawCrosshair = useCallback(() => {
      const ctx = overlayRef.current?.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      const hoverX = hoverXRef.current;
      if (hoverX === null || hoverX < PLOT_LEFT || hoverX > PLOT_RIGHT) return;

      const readout = resolveReadout(hoverX, viewportRef.current, xAxisMode, primary, calibration);
      if (readout) drawCrosshairOverlay(ctx, readout);
    }, [primary, calibration, xAxisMode]);

    // --- Imperative drawing ---

    const drawImmediate = useCallback(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const visible = domainLength / xZoomRef.current;
      const half = visible / 2;
      let start = xCenterRef.current - half;
      let end = xCenterRef.current + half;
      if (start < domain.min) {
        end += domain.min - start;
        start = domain.min;
      }
      if (end > domain.max) {
        start -= end - domain.max;
        end = domain.max;
        start = Math.max(domain.min, start);
      }
      const viewport: Viewport = { xStart: start, xEnd: end };
      viewportRef.current = viewport;

      const traces: Trace[] = [
        {
          data: primary.data,
          yScale: yScaleRef.current,
          color: dyeColor(primary.dyeName),
          lineWidth: 1.2,
          alpha: 1,
          calibration,
        },
      ];
      if (standard) {
        traces.push({
          data: standard.data,
          yScale: standardYScaleRef.current,
          color: dyeColor(standard.dyeName),
          lineWidth: 0.8,
          alpha: 0.45,
          calibration,
        });
      }

      const fullLabel = buildLabel(label, xAxisMode, calibration);
      renderElectropherogram(ctx, {
        traces,
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,
        viewport,
        label: fullLabel,
        xAxisMode,
      });

      // Keep the crosshair aligned when the viewport shifts under a still cursor.
      drawCrosshair();
    }, [
      primary,
      standard,
      domain.min,
      domain.max,
      domainLength,
      label,
      xAxisMode,
      calibration,
      drawCrosshair,
    ]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: state vars trigger redraw; drawImmediate reads refs
    useEffect(() => {
      drawImmediate();
    }, [drawImmediate, xCenterState, xZoomState, yScale, standardYScale]);

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

    const pixelToDomainDelta = useCallback(
      (pixelDeltaX: number): number => {
        const visible = domainLength / xZoomRef.current;
        return (pixelDeltaX / PLOT_WIDTH) * visible;
      },
      [domainLength],
    );

    // Cursor X in canvas-internal pixels. The canvas is CSS-scaled (width: 100%),
    // so map through the element's rendered size rather than trusting raw offsets.
    const canvasXFromEvent = useCallback((e: React.MouseEvent<HTMLCanvasElement>): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return 0;
      return ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    }, []);

    const handleMouseDown = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        dragRef.current = { startX: e.clientX, startCenter: xCenterRef.current };
        // Hide the crosshair while panning.
        hoverXRef.current = null;
        drawCrosshair();
        e.preventDefault();
      },
      [drawCrosshair],
    );

    const handleMouseMove = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (dragRef.current) {
          const dx = e.clientX - dragRef.current.startX;
          const delta = pixelToDomainDelta(dx);
          const newCenter = dragRef.current.startCenter - delta;
          const stepDelta = newCenter - xCenterRef.current;
          xCenterRef.current = newCenter;

          cancelAnimationFrame(rafRef.current);
          rafRef.current = requestAnimationFrame(() => drawImmediate());

          onWidgetChange?.({ type: "pan", value: stepDelta });
          return;
        }

        hoverXRef.current = canvasXFromEvent(e);
        drawCrosshair();
      },
      [pixelToDomainDelta, drawImmediate, onWidgetChange, canvasXFromEvent, drawCrosshair],
    );

    const handleMouseUp = useCallback(
      (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (dragRef.current) {
          dragRef.current = null;
          setXCenterState(xCenterRef.current);
        }
        // Restore the crosshair at the release position.
        hoverXRef.current = canvasXFromEvent(e);
        drawCrosshair();
      },
      [canvasXFromEvent, drawCrosshair],
    );

    const handleMouseLeave = useCallback(() => {
      if (dragRef.current) {
        dragRef.current = null;
        setXCenterState(xCenterRef.current);
      }
      hoverXRef.current = null;
      drawCrosshair();
    }, [drawCrosshair]);

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
        <div className="canvas-stack">
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
          <canvas
            ref={overlayRef}
            className="overlay-canvas"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
        </div>
        <div className="widget-controls">
          <label>
            <span className="control-label" style={{ color: dyeColor(primary.dyeName) }}>
              Y {primary.dyeName}
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
          {standard && (
            <label>
              <span className="control-label" style={{ color: dyeColor(standard.dyeName) }}>
                Y {standard.dyeName}
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

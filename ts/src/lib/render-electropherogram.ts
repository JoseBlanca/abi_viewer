/**
 * Pure canvas rendering functions for electropherogram traces.
 * No React dependency — takes a CanvasRenderingContext2D and data.
 *
 * Supports two X-axis modes:
 * - "scan": viewport and positioning are in scan index units (raw sample time)
 * - "bp":   viewport and positioning are in base pair units. Each trace must
 *           carry a SizeCalibration; the renderer converts each scan index to
 *           its bp position at draw time. This makes different samples align
 *           by molecular weight regardless of their individual run timing.
 */

import type { SizeCalibration } from "../domain/size-calibration.ts";

export interface Trace {
  /** Signal data (fluorescence intensity per scan). */
  readonly data: Int16Array;
  /** Y-axis scale factor (1 = fit to max, >1 = zoom in on peaks). */
  readonly yScale: number;
  /** Stroke color for the trace line. */
  readonly color: string;
  /** Line width. */
  readonly lineWidth: number;
  /** Global alpha (opacity, 0-1). */
  readonly alpha: number;
  /** Calibration used to position scans on the x-axis in bp mode. */
  readonly calibration?: SizeCalibration | null | undefined;
}

export interface Viewport {
  /** First visible x value (scans or bp depending on mode). */
  readonly xStart: number;
  /** Last visible x value (scans or bp). */
  readonly xEnd: number;
}

export type XAxisMode = "scan" | "bp";

export interface RenderOptions {
  readonly traces: readonly Trace[];
  readonly width: number;
  readonly height: number;
  /** Visible range in the current mode's units. */
  readonly viewport: Viewport;
  /** Label shown in the top-left corner. */
  readonly label: string;
  /** X-axis mode. Defaults to "scan". */
  readonly xAxisMode?: XAxisMode | undefined;
}

/** Pixel padding around the plot area. */
export const PADDING = { top: 24, right: 12, bottom: 28, left: 50 } as const;

/**
 * Project a domain value (scan index or bp) to a canvas x pixel within the plot
 * area. Shared by the renderer and the hover crosshair so both use exactly one
 * mapping and cannot silently drift apart.
 */
export function domainToPixel(
  value: number,
  xStart: number,
  xRange: number,
  plotLeft: number,
  plotWidth: number,
): number {
  return plotLeft + ((value - xStart) / xRange) * plotWidth;
}

/** Inverse of {@link domainToPixel}: map a canvas x pixel back to a domain value. */
export function pixelToDomain(
  px: number,
  xStart: number,
  xRange: number,
  plotLeft: number,
  plotWidth: number,
): number {
  return xStart + ((px - plotLeft) / plotWidth) * xRange;
}

const AXIS_COLOR = "#999";
const BACKGROUND = "#fafafa";
const LABEL_FONT = "12px system-ui, sans-serif";
const AXIS_FONT = "10px system-ui, sans-serif";
const GRID_COLOR = "#eee";

export function renderElectropherogram(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { traces, width, height, viewport, label } = opts;
  const mode: XAxisMode = opts.xAxisMode ?? "scan";
  const { xStart, xEnd } = viewport;

  const plotLeft = PADDING.left;
  const plotRight = width - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = height - PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  if (traces.length === 0) {
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText("No data", plotLeft, plotTop + 20);
    return;
  }

  const primaryTrace = traces[0];
  if (!primaryTrace || primaryTrace.data.length === 0) return;

  const xRange = xEnd - xStart;
  if (xRange <= 0) return;

  const primaryYMax = computeYMax(primaryTrace.data, primaryTrace.yScale);
  const primaryYMin = -primaryYMax * 0.05;

  drawYAxis(ctx, plotLeft, plotTop, plotBottom, plotHeight, primaryYMin, primaryYMax);
  drawXAxis(ctx, plotLeft, plotRight, plotBottom, xStart, xEnd, mode);
  drawGrid(ctx, plotLeft, plotRight, plotBottom, plotHeight);

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();
  for (let t = traces.length - 1; t >= 0; t--) {
    const trace = traces[t];
    if (trace)
      drawTrace(ctx, trace, xStart, xEnd, mode, plotLeft, plotBottom, plotWidth, plotHeight);
  }
  ctx.restore();

  ctx.fillStyle = "#333";
  ctx.font = LABEL_FONT;
  ctx.fillText(label, plotLeft + 4, plotTop - 6);
}

function computeYMax(data: Int16Array, yScale: number): number {
  let max = 0;
  for (const v of data) {
    if (v > max) max = v;
  }
  const scaled = max / yScale;
  return Math.max(scaled, 1);
}

function drawTrace(
  ctx: CanvasRenderingContext2D,
  trace: Trace,
  xStart: number,
  xEnd: number,
  mode: XAxisMode,
  plotLeft: number,
  plotBottom: number,
  plotWidth: number,
  plotHeight: number,
): void {
  if (trace.data.length === 0) return;
  if (mode === "bp" && !trace.calibration) return;

  const yMax = computeYMax(trace.data, trace.yScale);
  const yMin = -yMax * 0.05;
  const xRange = xEnd - xStart;

  ctx.save();
  ctx.globalAlpha = trace.alpha;
  ctx.strokeStyle = trace.color;
  ctx.lineWidth = trace.lineWidth;
  ctx.beginPath();

  if (mode === "scan") {
    drawScanTrace(
      ctx,
      trace,
      xStart,
      xEnd,
      xRange,
      yMin,
      yMax,
      plotLeft,
      plotBottom,
      plotWidth,
      plotHeight,
    );
  } else if (trace.calibration) {
    drawBpTrace(
      ctx,
      trace,
      trace.calibration,
      xStart,
      xEnd,
      xRange,
      yMin,
      yMax,
      plotLeft,
      plotBottom,
      plotWidth,
      plotHeight,
    );
  }

  ctx.stroke();
  ctx.restore();
}

function drawScanTrace(
  ctx: CanvasRenderingContext2D,
  trace: Trace,
  xStart: number,
  xEnd: number,
  xRange: number,
  yMin: number,
  yMax: number,
  plotLeft: number,
  plotBottom: number,
  plotWidth: number,
  plotHeight: number,
): void {
  const iStart = Math.max(0, Math.floor(xStart));
  const iEnd = Math.min(trace.data.length, Math.ceil(xEnd) + 1);
  for (let i = iStart; i < iEnd; i++) {
    const x = domainToPixel(i, xStart, xRange, plotLeft, plotWidth);
    const value = trace.data[i] ?? 0;
    const y = plotBottom - ((value - yMin) / (yMax - yMin)) * plotHeight;
    if (i === iStart) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

function drawBpTrace(
  ctx: CanvasRenderingContext2D,
  trace: Trace,
  calibration: SizeCalibration,
  xStart: number,
  xEnd: number,
  xRange: number,
  yMin: number,
  yMax: number,
  plotLeft: number,
  plotBottom: number,
  plotWidth: number,
  plotHeight: number,
): void {
  // Find the scan range corresponding to the visible bp range. Clamp to the
  // calibrated range: scans outside [minScan, maxScan] can't be mapped.
  const scanLoRaw = calibration.bpToScan(Math.max(xStart, calibration.minBp));
  const scanHiRaw = calibration.bpToScan(Math.min(xEnd, calibration.maxBp));
  if (scanLoRaw === null || scanHiRaw === null) return;

  const iStart = Math.max(0, Math.floor(scanLoRaw));
  const iEnd = Math.min(trace.data.length, Math.ceil(scanHiRaw) + 1);

  let started = false;
  for (let i = iStart; i < iEnd; i++) {
    const bp = calibration.scanToBp(i);
    if (bp === null) continue;
    const x = domainToPixel(bp, xStart, xRange, plotLeft, plotWidth);
    const value = trace.data[i] ?? 0;
    const y = plotBottom - ((value - yMin) / (yMax - yMin)) * plotHeight;
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
}

function drawYAxis(
  ctx: CanvasRenderingContext2D,
  plotLeft: number,
  plotTop: number,
  plotBottom: number,
  plotHeight: number,
  yMin: number,
  yMax: number,
): void {
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotTop);
  ctx.lineTo(plotLeft, plotBottom);
  ctx.stroke();

  ctx.fillStyle = AXIS_COLOR;
  ctx.font = AXIS_FONT;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  const yRange = yMax - yMin;
  const tickCount = 4;
  for (let i = 0; i <= tickCount; i++) {
    const value = yMin + (yRange * i) / tickCount;
    const y = plotBottom - (i / tickCount) * plotHeight;
    ctx.fillText(Math.round(value).toString(), plotLeft - 4, y);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawXAxis(
  ctx: CanvasRenderingContext2D,
  plotLeft: number,
  plotRight: number,
  plotBottom: number,
  xStart: number,
  xEnd: number,
  mode: XAxisMode,
): void {
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, plotBottom);
  ctx.lineTo(plotRight, plotBottom);
  ctx.stroke();

  ctx.fillStyle = AXIS_COLOR;
  ctx.font = AXIS_FONT;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const plotWidth = plotRight - plotLeft;
  const xRange = xEnd - xStart;
  const tickCount = 5;
  const suffix = mode === "bp" ? " bp" : "";
  for (let i = 0; i <= tickCount; i++) {
    const value = xStart + (xRange * i) / tickCount;
    const x = plotLeft + (i / tickCount) * plotWidth;
    ctx.fillText(`${Math.round(value)}${suffix}`, x, plotBottom + 4);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  plotLeft: number,
  plotRight: number,
  plotBottom: number,
  plotHeight: number,
): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;

  const tickCount = 4;
  for (let i = 1; i < tickCount; i++) {
    const y = plotBottom - (i / tickCount) * plotHeight;
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
  }
}

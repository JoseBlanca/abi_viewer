/**
 * Pure canvas rendering functions for electropherogram traces.
 * No React dependency — takes a CanvasRenderingContext2D and data.
 */

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
}

export interface Viewport {
  /** First visible scan index. */
  readonly xStart: number;
  /** Last visible scan index (exclusive). */
  readonly xEnd: number;
}

export interface RenderOptions {
  readonly traces: readonly Trace[];
  readonly width: number;
  readonly height: number;
  /** Visible scan range. */
  readonly viewport: Viewport;
  /** Label shown in the top-left corner. */
  readonly label: string;
}

/** Pixel padding around the plot area. */
export const PADDING = { top: 24, right: 12, bottom: 28, left: 50 } as const;

const AXIS_COLOR = "#999";
const BACKGROUND = "#fafafa";
const LABEL_FONT = "12px system-ui, sans-serif";
const AXIS_FONT = "10px system-ui, sans-serif";
const GRID_COLOR = "#eee";

export function renderElectropherogram(ctx: CanvasRenderingContext2D, opts: RenderOptions): void {
  const { traces, width, height, viewport, label } = opts;
  const { xStart, xEnd } = viewport;

  const plotLeft = PADDING.left;
  const plotRight = width - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = height - PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  // Clear
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

  // Y axis uses primary trace scale
  const primaryYMax = computeYMax(primaryTrace.data, primaryTrace.yScale);
  const primaryYMin = -primaryYMax * 0.05;

  drawYAxis(ctx, plotLeft, plotTop, plotBottom, plotHeight, primaryYMin, primaryYMax);
  drawXAxis(ctx, plotLeft, plotRight, plotBottom, xStart, xEnd);
  drawGrid(ctx, plotLeft, plotRight, plotBottom, plotHeight);

  // Clip to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();

  // Draw traces back-to-front (standard first, then primary on top)
  for (let t = traces.length - 1; t >= 0; t--) {
    const trace = traces[t];
    if (!trace || trace.data.length === 0) continue;

    const yMax = computeYMax(trace.data, trace.yScale);
    const yMin = -yMax * 0.05;

    // Only iterate over the visible range (plus 1 sample margin for line continuity)
    const iStart = Math.max(0, Math.floor(xStart));
    const iEnd = Math.min(trace.data.length, Math.ceil(xEnd) + 1);

    ctx.save();
    ctx.globalAlpha = trace.alpha;
    ctx.strokeStyle = trace.color;
    ctx.lineWidth = trace.lineWidth;
    ctx.beginPath();

    let first = true;
    for (let i = iStart; i < iEnd; i++) {
      const x = plotLeft + ((i - xStart) / xRange) * plotWidth;
      const value = trace.data[i] ?? 0;
      const y = plotBottom - ((value - yMin) / (yMax - yMin)) * plotHeight;

      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();

  // Label
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
  for (let i = 0; i <= tickCount; i++) {
    const scanIdx = Math.round(xStart + (xRange * i) / tickCount);
    const x = plotLeft + (i / tickCount) * plotWidth;
    ctx.fillText(scanIdx.toString(), x, plotBottom + 4);
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

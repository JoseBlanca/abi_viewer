/**
 * Pure canvas rendering functions for electropherogram traces.
 * No React dependency — takes a CanvasRenderingContext2D and data.
 */

export interface TraceRenderOptions {
  /** Signal data (fluorescence intensity per scan). */
  readonly data: Int16Array;
  /** Canvas width in pixels. */
  readonly width: number;
  /** Canvas height in pixels. */
  readonly height: number;
  /** Y-axis scale factor (1 = fit to max, >1 = zoom in on peaks). */
  readonly yScale: number;
  /** X-axis offset in scan units (for manual alignment). */
  readonly xOffset: number;
  /** Stroke color for the trace line. */
  readonly color: string;
  /** Label shown in the top-left corner. */
  readonly label: string;
}

const PADDING = { top: 24, right: 12, bottom: 28, left: 50 };
const AXIS_COLOR = "#999";
const BACKGROUND = "#fafafa";
const LABEL_FONT = "12px system-ui, sans-serif";
const AXIS_FONT = "10px system-ui, sans-serif";
const GRID_COLOR = "#eee";

export function renderTrace(ctx: CanvasRenderingContext2D, opts: TraceRenderOptions): void {
  const { data, width, height, yScale, xOffset, color, label } = opts;

  const plotLeft = PADDING.left;
  const plotRight = width - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = height - PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  // Clear
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  if (data.length === 0) {
    ctx.fillStyle = AXIS_COLOR;
    ctx.font = LABEL_FONT;
    ctx.fillText("No data", plotLeft, plotTop + 20);
    return;
  }

  // Compute Y range: scale around the positive range
  const yMax = computeYMax(data, yScale);
  const yMin = -yMax * 0.05; // small negative margin

  // X range accounting for offset
  const xStart = Math.max(0, Math.round(xOffset));
  const xEnd = data.length;
  const xRange = xEnd - xStart;

  // Draw grid and axes
  drawYAxis(ctx, plotLeft, plotTop, plotBottom, plotHeight, yMin, yMax);
  drawXAxis(ctx, plotLeft, plotRight, plotBottom, xStart, xEnd);
  drawGrid(ctx, plotLeft, plotRight, plotTop, plotBottom, plotHeight, yMin, yMax);

  // Clip to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight);
  ctx.clip();

  // Draw trace
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();

  let first = true;
  for (let i = xStart; i < xEnd; i++) {
    const x = plotLeft + ((i - xStart) / xRange) * plotWidth;
    const value = data[i] ?? 0;
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
  // With yScale=1, show the full range. yScale>1 zooms in (lowers yMax).
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

  // Y tick labels
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

  // X tick labels
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
  _plotTop: number,
  plotBottom: number,
  plotHeight: number,
  _yMin: number,
  _yMax: number,
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

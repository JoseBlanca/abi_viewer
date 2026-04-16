import { useCallback, useEffect, useRef, useState } from "react";
import { renderTrace } from "../lib/render-electropherogram.ts";

const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 200;

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
  readonly label: string;
  readonly data: Int16Array;
  readonly dyeName: string;
}

export function ElectropherogramWidget({ label, data, dyeName }: ElectropherogramWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [yScale, setYScale] = useState(1);
  const [xOffset, setXOffset] = useState(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    renderTrace(ctx, {
      data,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      yScale,
      xOffset,
      color: dyeColor(dyeName),
      label,
    });
  }, [data, yScale, xOffset, dyeName, label]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="electropherogram-widget">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
      <div className="widget-controls">
        <label>
          Y scale
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
        <label>
          X offset
          <input
            type="range"
            min={-Math.round(data.length * 0.3)}
            max={Math.round(data.length * 0.3)}
            step="1"
            value={xOffset}
            onChange={(e) => setXOffset(Number(e.target.value))}
          />
          <span className="control-value">{xOffset}</span>
        </label>
      </div>
    </div>
  );
}

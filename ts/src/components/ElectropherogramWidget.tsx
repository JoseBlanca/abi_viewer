import { useCallback, useEffect, useRef, useState } from "react";
import type { Trace } from "../lib/render-electropherogram.ts";
import { renderElectropherogram } from "../lib/render-electropherogram.ts";

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
  readonly channelData: Int16Array;
  readonly channelDyeName: string;
  readonly standardData: Int16Array | null;
  readonly standardDyeName: string;
}

export function ElectropherogramWidget({
  label,
  channelData,
  channelDyeName,
  standardData,
  standardDyeName,
}: ElectropherogramWidgetProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [yScale, setYScale] = useState(1);
  const [standardYScale, setStandardYScale] = useState(1);
  const [xOffset, setXOffset] = useState(0);

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
      xOffset,
      label,
    });
  }, [
    channelData,
    channelDyeName,
    standardData,
    standardDyeName,
    yScale,
    standardYScale,
    xOffset,
    label,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div className="electropherogram-widget">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} />
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
          X offset
          <input
            type="range"
            min={-Math.round(channelData.length * 0.3)}
            max={Math.round(channelData.length * 0.3)}
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

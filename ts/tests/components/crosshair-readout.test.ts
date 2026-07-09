import { describe, expect, it } from "vitest";
import {
  PLOT_LEFT,
  PLOT_WIDTH,
  resolveReadout,
  snapToScan,
} from "../../src/components/ElectropherogramWidget.tsx";
import { Electropherogram } from "../../src/domain/electropherogram.ts";
import { SizeCalibration } from "../../src/domain/size-calibration.ts";
import { GS500_LIZ } from "../../src/domain/size-ladder.ts";
import { domainToPixel } from "../../src/lib/render-electropherogram.ts";

// Linear calibration: bp = scan / 2, valid over scan [100, 500] / bp [50, 250].
// Five evenly-spaced matched peaks → isReliable (>= 5 peaks, constant slope).
const RELIABLE = SizeCalibration.fromMatched(
  [50, 100, 150, 200, 250].map((bp) => ({ scan: bp * 2, bp })),
  GS500_LIZ,
);
// Same slope but only four peaks → below MIN_MATCHED_PEAKS, so isReliable = false.
const UNRELIABLE = SizeCalibration.fromMatched(
  [50, 100, 150, 200].map((bp) => ({ scan: bp * 2, bp })),
  GS500_LIZ,
);

function primaryWith(values: Record<number, number>): Electropherogram {
  const data = new Int16Array(600);
  for (const [scan, value] of Object.entries(values)) data[Number(scan)] = value;
  return new Electropherogram({
    data,
    dyeName: "6-FAM",
    sampleName: "s",
    well: "A01",
    fileName: "f.fsa",
  });
}

/** Pixel that maps to `domain` under the given viewport, per the shared projection. */
function pixelFor(domain: number, xStart: number, xEnd: number): number {
  return domainToPixel(domain, xStart, xEnd - xStart, PLOT_LEFT, PLOT_WIDTH);
}

describe("snapToScan", () => {
  it("rounds to the nearest sample and reads bp in scan mode", () => {
    expect(snapToScan(250.4, "scan", RELIABLE)).toEqual({ scan: 250, bp: 125 });
  });

  it("returns a null bp in scan mode when there is no calibration", () => {
    expect(snapToScan(250.4, "scan", null)).toEqual({ scan: 250, bp: null });
  });

  it("keeps the scan but omits bp outside the calibrated range (scan mode)", () => {
    // Scan 50 is below the calibrated minimum (100): signal is still readable,
    // but there is no bp for it.
    expect(snapToScan(50, "scan", RELIABLE)).toEqual({ scan: 50, bp: null });
  });

  it("round-trips bp -> scan -> bp in bp mode", () => {
    expect(snapToScan(120, "bp", RELIABLE)).toEqual({ scan: 240, bp: 120 });
  });

  it("returns null in bp mode with no calibration", () => {
    expect(snapToScan(120, "bp", null)).toBeNull();
  });

  it("returns null in bp mode outside the calibrated range", () => {
    expect(snapToScan(400, "bp", RELIABLE)).toBeNull();
  });
});

describe("resolveReadout", () => {
  it("reports signal, scan, and bp at a calibrated point (scan mode)", () => {
    const primary = primaryWith({ 250: 1234 });
    const hoverX = pixelFor(250, 0, 600);
    const readout = resolveReadout(hoverX, { xStart: 0, xEnd: 600 }, "scan", primary, RELIABLE);
    expect(readout?.lines).toEqual(["Signal: 1234", "Scan: 250", "Size: 125.0 bp"]);
    // The line snaps back to the sample it reports.
    expect(readout?.px).toBeCloseTo(hoverX, 6);
  });

  it("marks the size approximate when the calibration is unreliable", () => {
    const primary = primaryWith({ 250: 1234 });
    const hoverX = pixelFor(250, 0, 600);
    const readout = resolveReadout(hoverX, { xStart: 0, xEnd: 600 }, "scan", primary, UNRELIABLE);
    expect(readout?.lines).toEqual(["Signal: 1234", "Scan: 250", "Size: ~125.0 bp"]);
  });

  it("omits the size line outside the calibrated range", () => {
    const primary = primaryWith({ 50: 42 });
    const hoverX = pixelFor(50, 0, 600);
    const readout = resolveReadout(hoverX, { xStart: 0, xEnd: 600 }, "scan", primary, RELIABLE);
    expect(readout?.lines).toEqual(["Signal: 42", "Scan: 50"]);
  });

  it("reads the primary signal at a bp-derived scan (bp mode)", () => {
    const primary = primaryWith({ 240: 777 });
    const hoverX = pixelFor(120, 40, 260);
    const readout = resolveReadout(hoverX, { xStart: 40, xEnd: 260 }, "bp", primary, RELIABLE);
    expect(readout?.lines).toEqual(["Signal: 777", "Scan: 240", "Size: 120.0 bp"]);
  });

  it("returns null past the end of the trace", () => {
    const primary = primaryWith({});
    const hoverX = pixelFor(600, 0, 600); // scan 600 == scanCount, out of range
    expect(resolveReadout(hoverX, { xStart: 0, xEnd: 600 }, "scan", primary, RELIABLE)).toBeNull();
  });

  it("returns null for a degenerate viewport", () => {
    const primary = primaryWith({ 250: 1234 });
    expect(
      resolveReadout(PLOT_LEFT, { xStart: 100, xEnd: 100 }, "scan", primary, RELIABLE),
    ).toBeNull();
  });
});

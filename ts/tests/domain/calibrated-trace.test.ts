import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { CalibratedTrace } from "../../src/domain/calibrated-trace.ts";
import { Electropherogram } from "../../src/domain/electropherogram.ts";
import { SizeCalibration } from "../../src/domain/size-calibration.ts";
import { GS500_LIZ } from "../../src/domain/size-ladder.ts";

function makeSyntheticTrace(scanLength: number, peakScans: number[]): Electropherogram {
  const data = new Int16Array(scanLength);
  // Put a clear spike at each peak scan so detectPeaks finds them
  for (const scan of peakScans) {
    for (let d = -5; d <= 5; d++) {
      const idx = scan + d;
      if (idx >= 0 && idx < scanLength) {
        const v = 5000 - Math.abs(d) * 500;
        const existing = data[idx] ?? 0;
        if (v > existing) data[idx] = v;
      }
    }
  }
  return new Electropherogram({
    data,
    dyeName: "test",
    sampleName: "test",
    well: "A01",
    fileName: "test.fsa",
  });
}

describe("CalibratedTrace (synthetic)", () => {
  const pairs = [
    { scan: 1000, bp: 100 },
    { scan: 2000, bp: 200 },
    { scan: 3000, bp: 300 },
    { scan: 4000, bp: 400 },
    { scan: 5000, bp: 500 },
  ];
  const ladder = { name: "test", sizes: pairs.map((p) => p.bp) };
  const cal = SizeCalibration.fromMatched(pairs, ladder);
  if (!cal) throw new Error("calibration build failed in test setup");

  const trace = makeSyntheticTrace(
    6000,
    pairs.map((p) => p.scan),
  );

  it("valueAt forwards to the underlying trace", () => {
    const ct = new CalibratedTrace(trace, cal);
    expect(ct.valueAt(1000)).toBe(trace.valueAt(1000));
    expect(ct.scanCount).toBe(trace.scanCount);
  });

  it("valueAtBp returns the signal at the corresponding scan", () => {
    const ct = new CalibratedTrace(trace, cal);
    // bp=200 maps to scan=2000 (exact matched point)
    expect(ct.valueAtBp(200)).toBe(trace.valueAt(2000));
    // bp=150 maps to scan=1500 (midpoint interpolation)
    expect(ct.valueAtBp(150)).toBe(trace.valueAt(1500));
  });

  it("valueAtBp returns null for bp outside the calibrated range", () => {
    const ct = new CalibratedTrace(trace, cal);
    expect(ct.valueAtBp(50)).toBeNull();
    expect(ct.valueAtBp(600)).toBeNull();
  });

  it("peaksInBp annotates peaks with their bp value", () => {
    const ct = new CalibratedTrace(trace, cal);
    const peaks = ct.peaksInBp;
    expect(peaks.length).toBeGreaterThan(0);

    // All detected peaks should be within the calibrated range and have a bp
    for (const peak of peaks) {
      expect(peak.bp).not.toBeNull();
    }

    // Find the peak at scan 3000 (bp=300 in our ladder) and check the bp
    const mid = peaks.find((p) => Math.abs(p.position - 3000) <= 2);
    expect(mid).toBeDefined();
    expect(mid?.bp).toBeCloseTo(300, 0);
  });

  it("peaksInBp caches the result (returns same reference)", () => {
    const ct = new CalibratedTrace(trace, cal);
    const first = ct.peaksInBp;
    const second = ct.peaksInBp;
    expect(second).toBe(first);
  });

  it("sets bp=null for peaks outside the calibrated range", () => {
    const traceWithOutside = makeSyntheticTrace(
      6000,
      [500, 1000, 2000, 3000, 4000, 5000, 5500], // outer peaks at 500 and 5500
    );
    const ct = new CalibratedTrace(traceWithOutside, cal);
    const peaks = ct.peaksInBp;

    const outerLow = peaks.find((p) => p.position === 500);
    const outerHigh = peaks.find((p) => p.position === 5500);
    expect(outerLow?.bp).toBeNull();
    expect(outerHigh?.bp).toBeNull();

    const inner = peaks.find((p) => p.position === 3000);
    expect(inner?.bp).toBeCloseTo(300, 0);
  });
});

// Real-data test: pair a LIZ electropherogram with its own calibration
const fixtureBuffer = readFileSync(resolve(import.meta.dirname, "../fixtures/DANI_NOV_A11.fsa"));
const buffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
);
const abi = new AbifFile(buffer);

describe("CalibratedTrace (real data)", () => {
  it("wraps a LIZ electropherogram with its calibration", () => {
    const data = abi.rawChannels.get(5);
    expect(data).toBeDefined();
    if (!data) return;
    const liz = new Electropherogram({
      data,
      dyeName: "LIZ",
      sampleName: abi.sampleName ?? "",
      well: abi.well ?? "",
      fileName: "DANI_NOV_A11.fsa",
    });
    const cal = SizeCalibration.tryBuild(liz, GS500_LIZ);
    expect(cal).not.toBeNull();
    if (!cal) return;

    const ct = new CalibratedTrace(liz, cal);

    // Querying at a matched bp should return a meaningful signal value
    const value = ct.valueAtBp(cal.matchedPeaks[0]?.bp ?? 0);
    expect(value).not.toBeNull();

    // bp outside the calibrated range returns null
    expect(ct.valueAtBp(10)).toBeNull();
    expect(ct.valueAtBp(1000)).toBeNull();

    // peaksInBp returns one entry per detected peak
    expect(ct.peaksInBp.length).toBe(liz.peaks.length);
  });
});

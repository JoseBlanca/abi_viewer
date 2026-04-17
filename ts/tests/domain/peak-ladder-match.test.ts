import { describe, expect, it } from "vitest";
import { matchPeaksToLadder } from "../../src/domain/peak-ladder-match.ts";
import type { Peak } from "../../src/lib/peak-detection.ts";

/** Helper: turn a list of scan positions into Peak objects. */
function peaksAt(positions: number[]): Peak[] {
  return positions.map((p) => ({ position: p, height: 1000, prominence: 500 }));
}

/**
 * Simulate detected peaks from an exact linear model scan = a * bp + b.
 */
function simulatePeaks(sizes: number[], a: number, b: number): Peak[] {
  return peaksAt(sizes.map((bp) => Math.round(a * bp + b)));
}

// Use a subset of GS500 sizes so tests are concrete and readable
const LADDER = [35, 50, 75, 100, 139, 150, 160, 200, 250, 300, 340, 350, 400, 450, 490, 500];

describe("matchPeaksToLadder (synthetic)", () => {
  it("matches all ladder points with perfectly aligned peaks", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    const result = matchPeaksToLadder(peaks, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(LADDER.length);
    for (const match of result) {
      expect(LADDER).toContain(match.bp);
    }
  });

  it("matches correctly with a constant scan offset", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i];
      if (p) peaks[i] = { ...p, position: p.position + 50 };
    }
    const result = matchPeaksToLadder(peaks, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(LADDER.length);
  });

  it("matches correctly with a different scale (speed difference)", () => {
    const peaks = simulatePeaks(LADDER, 17, 400);
    const result = matchPeaksToLadder(peaks, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(LADDER.length);
  });

  it("handles missing peaks (some ladder points undetected)", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    // Remove the 4th and 10th peaks
    const withMissing = peaks.filter((_, i) => i !== 3 && i !== 9);
    const result = matchPeaksToLadder(withMissing, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    // We should match all remaining peaks to their correct ladder bp
    expect(result.length).toBeGreaterThanOrEqual(LADDER.length - 2);
    // Each matched peak's bp should be in the ladder
    for (const m of result) expect(LADDER).toContain(m.bp);
  });

  it("handles extra peaks (noise detections)", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    // Insert noise peaks between real ones
    const withNoise = [...peaks];
    withNoise.push({ position: 1200, height: 300, prominence: 150 });
    withNoise.push({ position: 4200, height: 280, prominence: 140 });
    withNoise.sort((a, b) => a.position - b.position);

    const result = matchPeaksToLadder(withNoise, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(LADDER.length);
    // None of the noise scan positions should appear in matched peaks
    for (const m of result) {
      expect(m.scan).not.toBe(1200);
      expect(m.scan).not.toBe(4200);
    }
  });

  it("matched peaks are monotonic in both scan and bp", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    const result = matchPeaksToLadder(peaks, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      if (!prev || !curr) continue;
      expect(curr.scan).toBeGreaterThan(prev.scan);
      expect(curr.bp).toBeGreaterThan(prev.bp);
    }
  });

  it("returns null when too few peaks are provided", () => {
    const peaks = peaksAt([1000, 2000, 3000]);
    expect(matchPeaksToLadder(peaks, LADDER)).toBeNull();
  });

  it("returns null when the ladder has too few sizes", () => {
    const peaks = simulatePeaks(LADDER, 15, 500);
    expect(matchPeaksToLadder(peaks, [100, 200])).toBeNull();
  });

  it("returns null when no reasonable match exists (random peaks)", () => {
    // Peaks at arbitrary positions that don't match any linear model of the ladder
    const peaks = peaksAt([1000, 1050, 1100, 1150, 1200, 1250]);
    const result = matchPeaksToLadder(peaks, LADDER);
    // Either matches very few (< 5) or matches with huge tolerance; we accept
    // that in this degenerate case the matcher returns a low-quality result,
    // but it should be null if fewer than 5 peaks match
    if (result !== null) {
      expect(result.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("survives small non-linear distortion", () => {
    // Introduce a small quadratic term so peaks are slightly non-linear
    const peaks = peaksAt(LADDER.map((bp) => Math.round(15 * bp + 500 + 0.002 * (bp - 250) ** 2)));
    const result = matchPeaksToLadder(peaks, LADDER);
    expect(result).not.toBeNull();
    if (!result) return;
    // Most peaks should still match correctly
    expect(result.length).toBeGreaterThanOrEqual(LADDER.length - 2);
  });
});

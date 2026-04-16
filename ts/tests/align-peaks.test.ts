import { describe, expect, it } from "vitest";
import { computeAlignment, transformToViewport } from "../src/lib/align-peaks.ts";
import type { Peak } from "../src/lib/peak-detection.ts";

function makePeaks(positions: number[]): Peak[] {
  return positions.map((p) => ({ position: p, height: 1000, prominence: 500 }));
}

describe("computeAlignment", () => {
  it("returns identity transform for identical peak sets", () => {
    const peaks = makePeaks([100, 300, 500, 700, 900]);
    const result = computeAlignment(peaks, peaks);

    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.transform.scale).toBeCloseTo(1, 4);
    expect(result.transform.offset).toBeCloseTo(0, 4);
    expect(result.matchedPeaks).toBe(5);
  });

  it("detects a pure offset (shift)", () => {
    const ref = makePeaks([100, 300, 500, 700, 900]);
    const sample = makePeaks([120, 320, 520, 720, 920]); // shifted +20

    const result = computeAlignment(ref, sample);
    expect(result).not.toBeNull();
    if (!result) return;
    // ref = scale * sample + offset => scale ≈ 1, offset ≈ -20
    expect(result.transform.scale).toBeCloseTo(1, 2);
    expect(result.transform.offset).toBeCloseTo(-20, 2);
  });

  it("detects a pure scale change", () => {
    const ref = makePeaks([100, 300, 500, 700, 900]);
    const sample = makePeaks([95, 285, 475, 665, 855]); // scaled by 0.95

    const result = computeAlignment(ref, sample);
    expect(result).not.toBeNull();
    if (!result) return;
    // ref ≈ (1/0.95) * sample + offset
    expect(result.transform.scale).toBeCloseTo(1 / 0.95, 1);
  });

  it("detects combined scale and offset", () => {
    const ref = makePeaks([200, 400, 600, 800, 1000]);
    // sample = (ref - 10) / 1.05
    const sample = makePeaks([200, 400, 600, 800, 1000].map((r) => Math.round((r - 10) / 1.05)));

    const result = computeAlignment(ref, sample);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.transform.scale).toBeCloseTo(1.05, 1);
    expect(result.transform.offset).toBeCloseTo(10, 0);
  });

  it("returns null when too few peaks", () => {
    const twoPeaks = makePeaks([100, 500]);
    const fivePeaks = makePeaks([100, 300, 500, 700, 900]);

    expect(computeAlignment(twoPeaks, fivePeaks)).toBeNull();
    expect(computeAlignment(fivePeaks, twoPeaks)).toBeNull();
  });

  it("handles different peak counts by truncating to the shorter list", () => {
    const ref = makePeaks([100, 300, 500, 700, 900]);
    const sample = makePeaks([100, 300, 500]); // only 3 peaks

    const result = computeAlignment(ref, sample);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.matchedPeaks).toBeLessThanOrEqual(3);
  });

  it("rejects outlier pairs during refit", () => {
    const ref = makePeaks([100, 300, 500, 700, 900]);
    // One peak is wildly off (300 → 600), others shifted by +10
    const sample = makePeaks([110, 600, 510, 710, 910]);

    const result = computeAlignment(ref, sample);
    expect(result).not.toBeNull();
    if (!result) return;
    // After rejecting the outlier, fit should approximate scale=1, offset=-10
    expect(result.transform.scale).toBeCloseTo(1, 0);
  });
});

describe("transformToViewport", () => {
  it("returns default viewport for identity transform", () => {
    const vp = transformToViewport({ scale: 1, offset: 0 }, 9000);
    expect(vp.xCenter).toBeCloseTo(4500);
    expect(vp.xZoom).toBe(1);
  });

  it("always returns xZoom=1 (zoom is shared via lock)", () => {
    const vp = transformToViewport({ scale: 1.05, offset: 20 }, 9000);
    expect(vp.xZoom).toBe(1);
  });

  it("shifts xCenter to compensate for offset", () => {
    // offset=20 means sample peaks appear 20 scans earlier than reference.
    // Viewport should shift right to show later scans.
    const vp = transformToViewport({ scale: 1, offset: 20 }, 9000);
    expect(vp.xCenter).toBeCloseTo(4500 + 20);
  });

  it("accounts for scale when computing shift", () => {
    const vp = transformToViewport({ scale: 1.05, offset: 50 }, 9000);
    // shift = offset / scale = 50 / 1.05 ≈ 47.6
    expect(vp.xCenter).toBeCloseTo(4500 + 50 / 1.05, 0);
  });
});

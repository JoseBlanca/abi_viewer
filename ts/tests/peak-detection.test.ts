import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../src/abi-parser.ts";
import { detectPeaks } from "../src/lib/peak-detection.ts";

const fixtureBuffer = readFileSync(resolve(import.meta.dirname, "fixtures/DANI_NOV_A11.fsa"));
const buffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
);

describe("detectPeaks", () => {
  const abi = new AbifFile(buffer);

  it("detects peaks in the LIZ standard channel (channel 5)", () => {
    const standardData = abi.rawChannels.get(5);
    expect(standardData).toBeDefined();
    if (!standardData) return;

    const peaks = detectPeaks(standardData);

    // LIZ standard should have multiple well-separated peaks
    expect(peaks.length).toBeGreaterThanOrEqual(5);
    expect(peaks.length).toBeLessThanOrEqual(30);
  });

  it("returns peaks sorted by position", () => {
    const standardData = abi.rawChannels.get(5);
    if (!standardData) return;

    const peaks = detectPeaks(standardData);
    for (let i = 1; i < peaks.length; i++) {
      const prev = peaks[i - 1];
      const curr = peaks[i];
      if (prev && curr) {
        expect(curr.position).toBeGreaterThan(prev.position);
      }
    }
  });

  it("peak positions are within the data range", () => {
    const standardData = abi.rawChannels.get(5);
    if (!standardData) return;

    const peaks = detectPeaks(standardData);
    for (const peak of peaks) {
      expect(peak.position).toBeGreaterThanOrEqual(0);
      expect(peak.position).toBeLessThan(standardData.length);
    }
  });

  it("all peaks have positive prominence", () => {
    const standardData = abi.rawChannels.get(5);
    if (!standardData) return;

    const peaks = detectPeaks(standardData);
    for (const peak of peaks) {
      expect(peak.prominence).toBeGreaterThan(0);
    }
  });

  it("detects peaks in a non-standard channel (6-FAM)", () => {
    const channelData = abi.rawChannels.get(1);
    if (!channelData) return;

    const peaks = detectPeaks(channelData);
    expect(peaks.length).toBeGreaterThan(0);
  });

  it("returns empty array for empty data", () => {
    const empty = new Int16Array(0);
    expect(detectPeaks(empty)).toEqual([]);
  });

  it("returns empty array for flat signal", () => {
    const flat = new Int16Array(100).fill(50);
    expect(detectPeaks(flat)).toEqual([]);
  });

  it("detects a weak peak alongside a much taller one", () => {
    // A tall peak (8000) and a weak-but-clear peak (200), far apart. The weak
    // peak is well below 3% of the tall one, so a fraction-of-max threshold
    // would drop it; a noise-floor threshold keeps it.
    const data = new Int16Array(2000);
    const addBump = (center: number, height: number, halfWidth: number) => {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        const v = Math.round(height * (1 - Math.abs(d) / halfWidth));
        if (v > (data[center + d] ?? 0)) data[center + d] = v;
      }
    };
    addBump(500, 8000, 20);
    addBump(1500, 200, 20);

    const peaks = detectPeaks(data);
    const near = (pos: number) => peaks.some((p) => Math.abs(p.position - pos) <= 5);
    expect(near(500)).toBe(true);
    expect(near(1500)).toBe(true);
  });
});

// Regression: closely-spaced tall alleles used to be dropped by two separate
// filters — a 5x-median "height outlier" removal that deleted the tallest real
// peaks, and a 30-scan minimum distance that merged alleles ~1 bp apart.
describe("detectPeaks — closely-spaced tall peaks (regression)", () => {
  it("keeps a peak far taller than the median (no height-outlier removal)", () => {
    // Many small peaks and one that is ~10x taller. The tall one is the real
    // allele; it must not be rejected for being an outlier.
    const data = new Int16Array(4000);
    const addBump = (center: number, height: number, halfWidth = 8) => {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        const v = Math.round(height * (1 - Math.abs(d) / (halfWidth + 1)));
        if (v > (data[center + d] ?? 0)) data[center + d] = v;
      }
    };
    for (let i = 0; i < 8; i++) addBump(300 + i * 200, 200);
    addBump(2000, 5000); // the tall allele, well above 5x the median height

    const peaks = detectPeaks(data);
    expect(peaks.some((p) => Math.abs(p.position - 2000) <= 5)).toBe(true);
  });

  it("resolves two peaks ~12 scans apart instead of merging them", () => {
    const data = new Int16Array(4000);
    const addBump = (center: number, height: number, halfWidth = 4) => {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        const v = Math.round(height * (1 - Math.abs(d) / (halfWidth + 1)));
        if (v > (data[center + d] ?? 0)) data[center + d] = v;
      }
    };
    addBump(2000, 1500);
    addBump(2012, 2500);

    const peaks = detectPeaks(data);
    expect(peaks.some((p) => Math.abs(p.position - 2000) <= 3)).toBe(true);
    expect(peaks.some((p) => Math.abs(p.position - 2012) <= 3)).toBe(true);
  });

  it("detects the real 6-FAM allele cluster in the LIZ500 sample", () => {
    // C4_A02 has clear 6-FAM peaks at scans ~2727, ~2743, ~2758 (16 scans / ~1 bp
    // apart). All three were previously missing from detection and the CSV export.
    const lizBuf = readFileSync(
      resolve(import.meta.dirname, "fixtures/LIZ500_analyzed_C4_A02.fsa"),
    );
    const liz = new AbifFile(
      lizBuf.buffer.slice(lizBuf.byteOffset, lizBuf.byteOffset + lizBuf.byteLength),
    );
    const ch1 = liz.rawChannels.get(1);
    expect(ch1).toBeDefined();
    if (!ch1) return;

    const peaks = detectPeaks(ch1);
    const near = (pos: number) => peaks.some((p) => Math.abs(p.position - pos) <= 3);
    expect(near(2727)).toBe(true);
    expect(near(2743)).toBe(true);
    expect(near(2758)).toBe(true);
  });
});

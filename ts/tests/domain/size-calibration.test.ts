import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { Electropherogram } from "../../src/domain/electropherogram.ts";
import { SizeCalibration } from "../../src/domain/size-calibration.ts";
import { GS500_LIZ } from "../../src/domain/size-ladder.ts";

// --- Synthetic tests: isolate math correctness from real-data matching ---

/**
 * A test-only helper to build a calibration from known (scan, bp) pairs,
 * bypassing peak detection. This lets us verify interpolation math without
 * the peak detector or matcher getting in the way.
 */
function buildFromPairs(pairs: { scan: number; bp: number }[]): SizeCalibration {
  // Create a stub electropherogram whose peaks land at the requested scan
  // positions. The stub is just large enough to contain the peaks.
  const maxScan = Math.max(...pairs.map((p) => p.scan)) + 100;
  const data = new Int16Array(maxScan);
  for (const { scan } of pairs) {
    // Triangle shape centered on scan so detectPeaks will find a local maximum
    for (let d = -5; d <= 5; d++) {
      if (scan + d >= 0 && scan + d < maxScan) {
        const v = 5000 - Math.abs(d) * 500;
        const existing = data[scan + d] ?? 0;
        if (v > existing) data[scan + d] = v;
      }
    }
  }
  const ep = new Electropherogram({
    data,
    dyeName: "LIZ",
    sampleName: "test",
    well: "A01",
    fileName: "test.fsa",
  });
  // Build ladder that matches the pair count exactly
  const ladder = { name: "test", sizes: pairs.map((p) => p.bp) };
  const cal = SizeCalibration.tryBuild(ep, ladder);
  if (!cal) throw new Error("Failed to build calibration in test helper");
  return cal;
}

describe("SizeCalibration (synthetic)", () => {
  it("returns exact bp at matched scan positions", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.scanToBp(1000)).toBe(35);
    expect(cal.scanToBp(3000)).toBe(200);
    expect(cal.scanToBp(5000)).toBe(400);
  });

  it("linearly interpolates between matched points", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 100 },
      { scan: 2000, bp: 200 },
      { scan: 3000, bp: 400 },
      { scan: 4000, bp: 500 },
      { scan: 5000, bp: 600 },
    ]);
    // Midpoint of first segment: scan 1500 → bp 150
    expect(cal.scanToBp(1500)).toBe(150);
    // Midpoint of a segment with non-linear bp spacing: scan 2500 → bp 300
    expect(cal.scanToBp(2500)).toBe(300);
  });

  it("bpToScan is the inverse of scanToBp at matched points", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.bpToScan(100)).toBe(2000);
    expect(cal.bpToScan(300)).toBe(4000);
  });

  it("bpToScan interpolates between matched points", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 100 },
      { scan: 2000, bp: 200 },
      { scan: 3000, bp: 400 },
      { scan: 4000, bp: 500 },
      { scan: 5000, bp: 600 },
    ]);
    // bp 300 sits midway between (scan=2000, bp=200) and (scan=3000, bp=400)
    expect(cal.bpToScan(300)).toBe(2500);
  });

  it("returns null for scan values below the calibrated range", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.scanToBp(500)).toBeNull();
    expect(cal.scanToBp(999)).toBeNull();
  });

  it("returns null for scan values above the calibrated range", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.scanToBp(5001)).toBeNull();
    expect(cal.scanToBp(10000)).toBeNull();
  });

  it("returns null for bp values outside the calibrated range", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.bpToScan(20)).toBeNull();
    expect(cal.bpToScan(500)).toBeNull();
  });

  it("scanToBp is monotonic across matched points", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    let prev = cal.scanToBp(1000) ?? 0;
    for (let s = 1100; s <= 5000; s += 100) {
      const curr = cal.scanToBp(s);
      expect(curr).not.toBeNull();
      if (curr === null) return;
      expect(curr).toBeGreaterThanOrEqual(prev);
      prev = curr;
    }
  });

  it("exposes the ladder and matched peaks via fields", () => {
    const pairs = [
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ];
    const cal = buildFromPairs(pairs);
    expect(cal.matchedPeaks.length).toBe(5);
    expect(cal.minBp).toBe(35);
    expect(cal.maxBp).toBe(400);
    expect(cal.minScan).toBe(1000);
    expect(cal.maxScan).toBe(5000);
  });

  it("isReliable is true when at least 5 peaks matched", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 35 },
      { scan: 2000, bp: 100 },
      { scan: 3000, bp: 200 },
      { scan: 4000, bp: 300 },
      { scan: 5000, bp: 400 },
    ]);
    expect(cal.isReliable).toBe(true);
  });
});

// --- Real-data tests: verify behavior on a fixture .fsa file ---

const fixtureBuffer = readFileSync(resolve(import.meta.dirname, "../fixtures/DANI_NOV_A11.fsa"));
const buffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
);
const abi = new AbifFile(buffer);

function makeLizElectropherogram(): Electropherogram {
  const data = abi.rawChannels.get(5);
  if (!data) throw new Error("LIZ channel not found");
  return new Electropherogram({
    data,
    dyeName: "LIZ",
    sampleName: abi.sampleName ?? "",
    well: abi.well ?? "",
    fileName: "DANI_NOV_A11.fsa",
  });
}

describe("SizeCalibration.tryBuild (real data)", () => {
  it("builds a calibration from the LIZ channel of the fixture", () => {
    const liz = makeLizElectropherogram();
    const cal = SizeCalibration.tryBuild(liz, GS500_LIZ);
    expect(cal).not.toBeNull();
  });

  it("produces a monotonic scan-to-bp mapping", () => {
    const liz = makeLizElectropherogram();
    const cal = SizeCalibration.tryBuild(liz, GS500_LIZ);
    expect(cal).not.toBeNull();
    if (!cal) return;

    let prev = cal.minBp;
    const step = Math.max(1, Math.floor((cal.maxScan - cal.minScan) / 100));
    for (let s = cal.minScan + step; s <= cal.maxScan; s += step) {
      const bp = cal.scanToBp(s);
      expect(bp).not.toBeNull();
      if (bp === null) return;
      expect(bp).toBeGreaterThanOrEqual(prev);
      prev = bp;
    }
  });

  it("returns null for a flat signal with no peaks", () => {
    const flat = new Electropherogram({
      data: new Int16Array(9000).fill(0),
      dyeName: "LIZ",
      sampleName: "",
      well: "",
      fileName: "flat.fsa",
    });
    expect(SizeCalibration.tryBuild(flat, GS500_LIZ)).toBeNull();
  });
});

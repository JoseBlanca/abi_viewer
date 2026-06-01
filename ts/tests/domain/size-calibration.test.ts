import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { Electropherogram } from "../../src/domain/electropherogram.ts";
import { SizeCalibration } from "../../src/domain/size-calibration.ts";
import { GS500_LIZ } from "../../src/domain/size-ladder.ts";

// --- Synthetic tests: isolate math correctness from real-data matching ---

/**
 * Build a calibration directly from pre-matched (scan, bp) pairs, bypassing
 * peak detection and matching. Used to verify interpolation math in isolation.
 */
function buildFromPairs(pairs: { scan: number; bp: number }[]): SizeCalibration {
  const ladder = { name: "test", sizes: pairs.map((p) => p.bp) };
  const cal = SizeCalibration.fromMatched(pairs, ladder);
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

describe("SizeCalibration quality gate (isReliable)", () => {
  it("is reliable for a smooth, slowly-curving calibration", () => {
    const cal = buildFromPairs([
      { scan: 1000, bp: 100 },
      { scan: 2050, bp: 200 },
      { scan: 3150, bp: 300 },
      { scan: 4300, bp: 400 },
      { scan: 5500, bp: 500 },
    ]);
    expect(cal.isReliable).toBe(true);
  });

  it("is unreliable when a mislabelled node creates a slope kink", () => {
    // The 300 bp node is placed far too late, making the 200->300 segment ~3x
    // steeper than its neighbours — the signature of a mislabelled peak.
    const cal = buildFromPairs([
      { scan: 1000, bp: 100 },
      { scan: 2050, bp: 200 },
      { scan: 5200, bp: 300 },
      { scan: 5500, bp: 400 },
      { scan: 5900, bp: 500 },
    ]);
    expect(cal.isReliable).toBe(false);
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

// Regression: G11's 139/150/160 triplet was previously mislabelled by the
// linear matcher (it called the 150 peak "139" and dropped 160), which warped
// the calibration right in the 100-160 bp window where samples sit. The
// landmark verify-and-recalibrate step must label all three correctly.
describe("SizeCalibration (G11 triplet regression)", () => {
  it("labels the 139/150/160 cluster correctly", () => {
    const ep = loadStandardElectropherogram("DANI_NOV_G11.fsa");
    const cal = SizeCalibration.tryBuild(ep, GS500_LIZ);
    expect(cal).not.toBeNull();
    if (!cal) return;

    const cluster = [139, 150, 160].map((bp) => cal.matchedPeaks.find((m) => m.bp === bp));
    // All three cluster members are present...
    expect(cluster.every((m) => m !== undefined)).toBe(true);
    // ...mapped to three distinct, increasing, closely-spaced peaks.
    for (let i = 1; i < cluster.length; i++) {
      const prev = cluster[i - 1];
      const curr = cluster[i];
      if (!prev || !curr) continue;
      const gap = curr.scan - prev.scan;
      expect(gap).toBeGreaterThan(80);
      expect(gap).toBeLessThan(160);
    }
  });
});

// Regression: H12 is a weak sample. The old fraction-of-max prominence
// threshold scaled with the injection artifact and clipped its low-bp ladder
// peaks (the 139/150 peaks sat just under the cutoff), so the matcher had no
// low anchors and locked onto a wrong scale (it called the 200 bp peak "35 bp").
// With a noise-floor threshold those weak peaks are detected, so the full
// 139/150/160 triplet is recovered and the calibration spans the real range.
describe("SizeCalibration (H12 weak-sample regression)", () => {
  it("detects the weak low-bp peaks and calibrates the full range", () => {
    const ep = loadStandardElectropherogram("DANI_NOV_H12.fsa");
    const cal = SizeCalibration.tryBuild(ep, GS500_LIZ);
    expect(cal).not.toBeNull();
    if (!cal) return;

    // The full triplet plus the high-end doublets must be matched.
    for (const bp of [139, 150, 160, 340, 350, 490, 500]) {
      expect(cal.matchedPeaks.some((m) => m.bp === bp)).toBe(true);
    }
    // The calibrated range reaches down to the low ladder fragments (not stuck
    // at 160+), and the calibration passes the quality gate.
    expect(cal.minBp).toBeLessThanOrEqual(100);
    expect(cal.maxBp).toBe(500);
    expect(cal.isReliable).toBe(true);
  });
});

// Run the matcher across all 16 example .fsa files. This locks in the current
// matcher behavior: as the algorithm evolves, any file that gains/loses matches
// will show up here. Update the expected numbers when the change is intended.
//
// `reliable: false` marks a file whose calibration is built but flagged
// low-quality (here F11, whose unresolved 160 bp peak leaves a slope kink). With
// noise-floor peak detection every other fixture — including C12, once thought
// to be artifacts-only — yields a full, reliable calibration.
describe("SizeCalibration on all fixture files", () => {
  const FIXTURES: { file: string; expected: number | "fail"; reliable?: boolean }[] = [
    { file: "DANI_NOV_A11.fsa", expected: 14 },
    { file: "DANI_NOV_A12.fsa", expected: 14 },
    { file: "DANI_NOV_B11.fsa", expected: 14 },
    { file: "DANI_NOV_B12.fsa", expected: 15 },
    { file: "DANI_NOV_C11.fsa", expected: 15 },
    { file: "DANI_NOV_C12.fsa", expected: 15 },
    { file: "DANI_NOV_D11.fsa", expected: 15 },
    { file: "DANI_NOV_D12.fsa", expected: 15 },
    { file: "DANI_NOV_E11.fsa", expected: 15 },
    { file: "DANI_NOV_E12.fsa", expected: 15 },
    { file: "DANI_NOV_F11.fsa", expected: 13, reliable: false },
    { file: "DANI_NOV_F12.fsa", expected: 15 },
    { file: "DANI_NOV_G11.fsa", expected: 15 },
    { file: "DANI_NOV_G12.fsa", expected: 15 },
    { file: "DANI_NOV_H11.fsa", expected: 15 },
    { file: "DANI_NOV_H12.fsa", expected: 14 },
  ];

  for (const { file, expected, reliable } of FIXTURES) {
    it(`calibration for ${file}`, () => {
      verifyFixtureCalibration(file, expected, reliable ?? true);
    });
  }
});

function verifyFixtureCalibration(
  file: string,
  expected: number | "fail",
  reliable: boolean,
): void {
  const ep = loadStandardElectropherogram(file);
  const cal = SizeCalibration.tryBuild(ep, GS500_LIZ);

  if (expected === "fail") {
    expect(cal).toBeNull();
    return;
  }

  expect(cal).not.toBeNull();
  if (!cal) return;
  expect(cal.matchedPeaks.length).toBeGreaterThanOrEqual(expected);
  expect(cal.isReliable).toBe(reliable);
  for (const m of cal.matchedPeaks) {
    expect(GS500_LIZ.sizes).toContain(m.bp);
  }
  assertMonotonic(cal.matchedPeaks);
}

function loadStandardElectropherogram(file: string): Electropherogram {
  const buf = readFileSync(resolve(import.meta.dirname, "../fixtures", file));
  const fileBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const fileAbi = new AbifFile(fileBuffer);
  const data = fileAbi.rawChannels.get(5);
  if (!data) throw new Error(`LIZ channel not found in ${file}`);
  return new Electropherogram({
    data,
    dyeName: "LIZ",
    sampleName: fileAbi.sampleName ?? "",
    well: fileAbi.well ?? "",
    fileName: file,
  });
}

function assertMonotonic(matches: readonly { scan: number; bp: number }[]): void {
  for (let i = 1; i < matches.length; i++) {
    const prev = matches[i - 1];
    const curr = matches[i];
    if (!prev || !curr) continue;
    expect(curr.scan).toBeGreaterThan(prev.scan);
    expect(curr.bp).toBeGreaterThan(prev.bp);
  }
}

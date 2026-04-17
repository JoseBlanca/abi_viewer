import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { Electropherogram } from "../../src/domain/electropherogram.ts";
import { detectPeaks } from "../../src/lib/peak-detection.ts";

const fixturePath = resolve(import.meta.dirname, "../fixtures/DANI_NOV_A11.fsa");
const fixtureBuffer = readFileSync(fixturePath);
const buffer = fixtureBuffer.buffer.slice(
  fixtureBuffer.byteOffset,
  fixtureBuffer.byteOffset + fixtureBuffer.byteLength,
);
const abi = new AbifFile(buffer);

function makeElectropherogram(channel: number): Electropherogram {
  const data = abi.rawChannels.get(channel);
  if (!data) throw new Error(`Channel ${channel} not found`);
  return new Electropherogram({
    data,
    dyeName: abi.dyeNames[channel - 1] ?? "",
    sampleName: abi.sampleName ?? "",
    well: abi.well ?? "",
    fileName: "DANI_NOV_A11.fsa",
  });
}

describe("Electropherogram construction", () => {
  it("stores all fields from the params", () => {
    const ep = makeElectropherogram(1);
    expect(ep.dyeName).toBe("6-FAM");
    expect(ep.sampleName).toBe("DANI_NOV");
    expect(ep.well).toBe("A11");
    expect(ep.fileName).toBe("DANI_NOV_A11.fsa");
    expect(ep.data).toBeInstanceOf(Int16Array);
    expect(ep.data.length).toBe(8959);
  });

  it("exposes scanCount matching data length", () => {
    const ep = makeElectropherogram(1);
    expect(ep.scanCount).toBe(ep.data.length);
  });
});

describe("Electropherogram.valueAt", () => {
  const ep = makeElectropherogram(5); // LIZ

  it("returns the signal value at a valid scan position", () => {
    const rawValue = ep.data[1000];
    expect(ep.valueAt(1000)).toBe(rawValue);
  });

  it("rounds non-integer scan positions", () => {
    expect(ep.valueAt(1000.4)).toBe(ep.data[1000]);
    expect(ep.valueAt(1000.6)).toBe(ep.data[1001]);
  });

  it("returns 0 for negative scan positions", () => {
    expect(ep.valueAt(-5)).toBe(0);
  });

  it("returns 0 for out-of-range scan positions", () => {
    expect(ep.valueAt(ep.scanCount + 10)).toBe(0);
  });
});

describe("Electropherogram.peaks (lazy caching)", () => {
  it("matches the output of detectPeaks on the underlying data", () => {
    const ep = makeElectropherogram(5);
    const expected = detectPeaks(ep.data);
    const actual = ep.peaks;

    expect(actual.length).toBe(expected.length);
    for (let i = 0; i < actual.length; i++) {
      expect(actual[i]?.position).toBe(expected[i]?.position);
    }
  });

  it("returns the same array reference on repeated access (caching)", () => {
    const ep = makeElectropherogram(5);
    const first = ep.peaks;
    const second = ep.peaks;
    expect(second).toBe(first);
  });

  it("returns an empty array for a flat signal", () => {
    const ep = new Electropherogram({
      data: new Int16Array(1000).fill(0),
      dyeName: "test",
      sampleName: "test",
      well: "A01",
      fileName: "test.fsa",
    });
    expect(ep.peaks).toEqual([]);
  });
});

describe("Electropherogram.peakNear", () => {
  const ep = makeElectropherogram(5);

  it("finds the closest peak within tolerance", () => {
    const firstPeak = ep.peaks[0];
    expect(firstPeak).toBeDefined();
    if (!firstPeak) return;

    const found = ep.peakNear(firstPeak.position + 5, 20);
    expect(found?.position).toBe(firstPeak.position);
  });

  it("returns null when no peak is within tolerance", () => {
    const firstPeak = ep.peaks[0];
    if (!firstPeak) return;
    // Query far from any peak
    const found = ep.peakNear(firstPeak.position + 10000, 10);
    expect(found).toBeNull();
  });

  it("picks the nearer peak when two are within tolerance", () => {
    // Find two adjacent peaks and query between them (closer to one)
    const p0 = ep.peaks[0];
    const p1 = ep.peaks[1];
    if (!p0 || !p1) return;
    const gap = p1.position - p0.position;
    const queryNearP0 = p0.position + Math.floor(gap * 0.3);
    const found = ep.peakNear(queryNearP0, gap);
    expect(found?.position).toBe(p0.position);
  });
});

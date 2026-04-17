import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AbifFile } from "../../src/abi-parser.ts";
import { findInjectionEnd } from "../../src/domain/injection-detection.ts";

function addTriangle(data: Int16Array, at: number, height: number, halfWidth: number): void {
  for (let d = -halfWidth; d <= halfWidth; d++) {
    const i = at + d;
    if (i < 0 || i >= data.length) continue;
    const v = height * (1 - Math.abs(d) / halfWidth);
    if (v > (data[i] ?? 0)) data[i] = v;
  }
}

/** Build a synthetic signal with controlled shape. */
function makeSignal(
  length: number,
  spec: { injection?: { at: number; height: number }; peaks?: { at: number; height: number }[] },
): Int16Array {
  const data = new Int16Array(length);
  if (spec.injection) addTriangle(data, spec.injection.at, spec.injection.height, 50);
  for (const { at, height } of spec.peaks ?? []) addTriangle(data, at, height, 10);
  return data;
}

describe("findInjectionEnd (synthetic)", () => {
  it("returns 0 when there is no significant injection signal", () => {
    const data = new Int16Array(9000).fill(0);
    expect(findInjectionEnd(data)).toBe(0);
  });

  it("returns a position past the injection peak when the signal drops", () => {
    const data = makeSignal(9000, {
      injection: { at: 1000, height: 8000 },
      peaks: [
        { at: 3000, height: 500 },
        { at: 5000, height: 500 },
      ],
    });
    const end = findInjectionEnd(data);
    // Should be past the injection peak but well before the real peaks
    expect(end).toBeGreaterThan(1050);
    expect(end).toBeLessThan(3000);
  });

  it("does not consume real standard peaks that follow the injection", () => {
    const realPeakAt = 2500;
    const data = makeSignal(9000, {
      injection: { at: 1000, height: 8000 },
      peaks: [
        { at: realPeakAt, height: 500 },
        { at: 4000, height: 500 },
      ],
    });
    const end = findInjectionEnd(data);
    // The end must not reach the real peak
    expect(end).toBeLessThan(realPeakAt);
  });
});

// Real-data: verify the detection boundary on the fixture files.
function loadLizData(file: string): Int16Array {
  const buf = readFileSync(resolve(import.meta.dirname, "../fixtures", file));
  const fileBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const data = new AbifFile(fileBuffer).rawChannels.get(5);
  if (!data) throw new Error(`LIZ channel not found in ${file}`);
  return data;
}

describe("findInjectionEnd (real data)", () => {
  it("detects an injection end before the real peaks on a normal file", () => {
    const data = loadLizData("DANI_NOV_A11.fsa");
    const end = findInjectionEnd(data);
    // Injection peaks are around scans 950-1120, real peaks start around 2380
    expect(end).toBeGreaterThan(1120);
    expect(end).toBeLessThan(2380);
  });

  it("puts all detected peaks past injection end on C12 (no real peaks)", () => {
    const data = loadLizData("DANI_NOV_C12.fsa");
    const end = findInjectionEnd(data);
    // C12 only has injection peaks (up to ~1165) — end should be after them
    expect(end).toBeGreaterThan(1165);
  });
});

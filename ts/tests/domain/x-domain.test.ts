import { describe, expect, it } from "vitest";
import { SizeCalibration } from "../../src/domain/size-calibration.ts";
import { computeSharedDomain } from "../../src/domain/x-domain.ts";

const ladder = { name: "test", sizes: [35, 100, 200, 300, 400] };

/** A calibration spanning the given bp range (scan values are arbitrary). */
function calWithBpRange(minBp: number, maxBp: number): SizeCalibration {
  const cal = SizeCalibration.fromMatched(
    [
      { scan: 1000, bp: minBp },
      { scan: 2000, bp: maxBp },
    ],
    ladder,
  );
  if (!cal) throw new Error("failed to build calibration");
  return cal;
}

describe("computeSharedDomain", () => {
  describe("scan mode", () => {
    it("spans [0, max scanCount] across samples", () => {
      const domain = computeSharedDomain("scan", [
        { scanCount: 4000, calibration: null },
        { scanCount: 5200, calibration: null },
        { scanCount: 4800, calibration: null },
      ]);
      expect(domain).toEqual({ min: 0, max: 5200 });
    });

    it("falls back to a non-empty range when there are no samples", () => {
      const domain = computeSharedDomain("scan", []);
      expect(domain.min).toBe(0);
      expect(domain.max).toBeGreaterThan(0);
    });
  });

  describe("bp mode", () => {
    it("takes the union of all calibrated bp ranges so panels align", () => {
      const domain = computeSharedDomain("bp", [
        { scanCount: 4000, calibration: calWithBpRange(233, 342) },
        { scanCount: 4000, calibration: calWithBpRange(217, 333) },
      ]);
      expect(domain).toEqual({ min: 217, max: 342 });
    });

    it("ignores uncalibrated samples (they don't draw in bp mode)", () => {
      const domain = computeSharedDomain("bp", [
        { scanCount: 4000, calibration: calWithBpRange(50, 480) },
        { scanCount: 4000, calibration: null },
      ]);
      expect(domain).toEqual({ min: 50, max: 480 });
    });

    it("falls back to [0, 500] when nothing is calibrated", () => {
      const domain = computeSharedDomain("bp", [
        { scanCount: 4000, calibration: null },
        { scanCount: 4000, calibration: null },
      ]);
      expect(domain).toEqual({ min: 0, max: 500 });
    });
  });
});

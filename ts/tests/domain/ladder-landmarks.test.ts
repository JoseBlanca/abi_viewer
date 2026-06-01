import { describe, expect, it } from "vitest";
import {
  findLadderLandmarks,
  findPeakLandmarks,
  matchLandmarks,
} from "../../src/domain/ladder-landmarks.ts";
import { GS500_LIZ, GS600_LIZ } from "../../src/domain/size-ladder.ts";
import type { Peak } from "../../src/lib/peak-detection.ts";

function peaksAt(positions: number[]): Peak[] {
  return positions.map((p) => ({ position: p, height: 1000, prominence: 500 }));
}

describe("findLadderLandmarks", () => {
  it("finds GS500's triplet and two doublets, in order", () => {
    const groups = findLadderLandmarks(GS500_LIZ.sizes);
    expect(groups.map((g) => g.bps)).toEqual([
      [139, 150, 160],
      [340, 350],
      [490, 500],
    ]);
  });

  it("does not treat the leading 35/50 fragments as a group (no large gap before)", () => {
    const groups = findLadderLandmarks(GS500_LIZ.sizes);
    expect(groups.some((g) => g.bps.includes(35) || g.bps.includes(50))).toBe(false);
  });

  it("finds tight groups in GS600 LIZ", () => {
    const groups = findLadderLandmarks(GS600_LIZ.sizes);
    // GS600's distinctive doublet around 250.
    expect(groups.some((g) => g.bps.includes(240) && g.bps.includes(250))).toBe(true);
  });
});

describe("findPeakLandmarks", () => {
  it("locates a triplet and doublets by their scale-invariant spacing", () => {
    // ...50(1379) 75(1660) 100(1941) | 139 150 160 | 200 ... 340 350 ... 490 500
    const peaks = peaksAt([
      1379, 1660, 1941, 2403, 2518, 2635, 3123, 3712, 4387, 4882, 5017, 5690, 6311, 6829, 6936,
    ]);
    const groups = findPeakLandmarks(peaks);
    expect(groups).toEqual([
      [2403, 2518, 2635],
      [4882, 5017],
      [6829, 6936],
    ]);
  });

  it("finds only the doublets when the triplet's peaks are missing (weak signal)", () => {
    // H12-like: low end undetected, only the two high doublets present.
    const peaks = peaksAt([2663, 3152, 3738, 4413, 4903, 5038, 5706, 6318, 6829, 6934]);
    const groups = findPeakLandmarks(peaks);
    expect(groups).toEqual([
      [4903, 5038],
      [6829, 6934],
    ]);
  });
});

describe("matchLandmarks", () => {
  const ladder = findLadderLandmarks(GS500_LIZ.sizes);

  it("maps a full constellation to anchors", () => {
    const peakGroups = [
      [2403, 2518, 2635],
      [4882, 5017],
      [6829, 6936],
    ];
    const anchors = matchLandmarks(ladder, peakGroups);
    expect(anchors).toEqual([
      { scan: 2403, bp: 139 },
      { scan: 2518, bp: 150 },
      { scan: 2635, bp: 160 },
      { scan: 4882, bp: 340 },
      { scan: 5017, bp: 350 },
      { scan: 6829, bp: 490 },
      { scan: 6936, bp: 500 },
    ]);
  });

  it("maps two doublets to 340/350 and 490/500 when the triplet is absent (H12)", () => {
    const anchors = matchLandmarks(ladder, [
      [4903, 5038],
      [6829, 6934],
    ]);
    expect(anchors).toEqual([
      { scan: 4903, bp: 340 },
      { scan: 5038, bp: 350 },
      { scan: 6829, bp: 490 },
      { scan: 6934, bp: 500 },
    ]);
  });

  it("returns null for a single doublet (ambiguous: could be 340/350 or 490/500)", () => {
    expect(matchLandmarks(ladder, [[4903, 5038]])).toBeNull();
  });

  it("returns null when there are no peak groups", () => {
    expect(matchLandmarks(ladder, [])).toBeNull();
  });
});

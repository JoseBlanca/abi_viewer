/**
 * Maps between scan positions and base pairs using a size standard ladder.
 *
 * Built from a standard channel's detected peaks matched against a known
 * ladder. Uses piecewise linear interpolation between matched peaks, which
 * is simple and exact at matched points but does not extrapolate beyond
 * the calibrated range.
 */

import type { Electropherogram } from "./electropherogram.ts";
import { matchPeaksToLadder } from "./peak-ladder-match.ts";
import type { SizeLadder } from "./size-ladder.ts";

export interface MatchedPeak {
  readonly scan: number;
  readonly bp: number;
}

const MIN_MATCHED_PEAKS = 5;

export class SizeCalibration {
  readonly matchedPeaks: readonly MatchedPeak[];
  readonly ladder: SizeLadder;
  readonly minBp: number;
  readonly maxBp: number;
  readonly minScan: number;
  readonly maxScan: number;
  readonly isReliable: boolean;

  private constructor(matchedPeaks: readonly MatchedPeak[], ladder: SizeLadder) {
    this.matchedPeaks = matchedPeaks;
    this.ladder = ladder;
    const first = matchedPeaks[0];
    const last = matchedPeaks[matchedPeaks.length - 1];
    if (!first || !last) {
      throw new Error("SizeCalibration requires at least 2 matched peaks");
    }
    this.minScan = first.scan;
    this.maxScan = last.scan;
    this.minBp = first.bp;
    this.maxBp = last.bp;
    this.isReliable = matchedPeaks.length >= MIN_MATCHED_PEAKS;
  }

  /** Convert a scan position to base pairs. Returns null outside the calibrated range. */
  scanToBp(scan: number): number | null {
    if (scan < this.minScan || scan > this.maxScan) return null;
    const i = findSegment(this.matchedPeaks, scan, (p) => p.scan);
    const lo = this.matchedPeaks[i];
    const hi = this.matchedPeaks[i + 1];
    if (!lo || !hi) return null;
    const t = (scan - lo.scan) / (hi.scan - lo.scan);
    return lo.bp + t * (hi.bp - lo.bp);
  }

  /** Convert a base pair value to a scan position. Returns null outside the calibrated range. */
  bpToScan(bp: number): number | null {
    if (bp < this.minBp || bp > this.maxBp) return null;
    const i = findSegment(this.matchedPeaks, bp, (p) => p.bp);
    const lo = this.matchedPeaks[i];
    const hi = this.matchedPeaks[i + 1];
    if (!lo || !hi) return null;
    const t = (bp - lo.bp) / (hi.bp - lo.bp);
    return lo.scan + t * (hi.scan - lo.scan);
  }

  /**
   * Build a calibration from a standard electropherogram and a ladder spec.
   *
   * Uses anchor-based RANSAC matching (see peak-ladder-match.ts) that handles
   * missing and extra peaks robustly.
   *
   * @returns A SizeCalibration, or null if matching failed or too few peaks
   *          were matched.
   */
  static tryBuild(standard: Electropherogram, ladder: SizeLadder): SizeCalibration | null {
    const peaks = standard.peaks;
    const matched = matchPeaksToLadder(peaks, ladder.sizes);
    if (!matched || matched.length < MIN_MATCHED_PEAKS) return null;
    return new SizeCalibration(matched, ladder);
  }

  /**
   * Build a calibration directly from pre-matched (scan, bp) pairs, bypassing
   * the automatic matcher. Useful for tests and for future user-corrected
   * manual calibration.
   *
   * The pairs must be sorted by scan position ascending and strictly monotonic
   * in both scan and bp. Returns null otherwise.
   */
  static fromMatched(matched: readonly MatchedPeak[], ladder: SizeLadder): SizeCalibration | null {
    if (matched.length < 2) return null;
    for (let i = 1; i < matched.length; i++) {
      const prev = matched[i - 1];
      const curr = matched[i];
      if (!prev || !curr) return null;
      if (curr.scan <= prev.scan || curr.bp <= prev.bp) return null;
    }
    return new SizeCalibration(matched, ladder);
  }
}

/**
 * Find the segment index i such that sorted[i].key <= value < sorted[i+1].key.
 * Assumes `sorted` is monotonically ascending in the accessor. Returns
 * Math.max(0, length - 2) as a fallback at the upper boundary so interpolation
 * uses the last segment.
 */
function findSegment<T>(sorted: readonly T[], value: number, key: (item: T) => number): number {
  for (let i = 0; i < sorted.length - 1; i++) {
    const next = sorted[i + 1];
    if (next !== undefined && value < key(next)) return i;
  }
  return Math.max(0, sorted.length - 2);
}

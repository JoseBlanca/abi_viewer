/**
 * Maps between scan positions and base pairs using a size standard ladder.
 *
 * Built from a standard channel's detected peaks matched against a known
 * ladder. Uses piecewise linear interpolation between matched peaks, which
 * is simple and exact at matched points but does not extrapolate beyond
 * the calibrated range.
 */

import type { Peak } from "../lib/peak-detection.ts";
import type { Electropherogram } from "./electropherogram.ts";
import { findInjectionEnd } from "./injection-detection.ts";
import { matchPeaksToLadder } from "./peak-ladder-match.ts";
import type { SizeLadder } from "./size-ladder.ts";

export interface MatchedPeak {
  readonly scan: number;
  readonly bp: number;
}

const MIN_MATCHED_PEAKS = 5;
/**
 * Largest allowed ratio between adjacent calibration segments' slopes
 * (scans per bp). A correct calibration follows a smooth mobility curve, so
 * adjacent slopes are close; a mislabelled peak inserts a too-steep or
 * too-shallow segment that spikes this ratio well past 1. Empirically the real
 * fixtures sit at ~1.2 when correct and jump above 2 when a cluster is
 * mislabelled, so 1.6 cleanly separates the two.
 */
const MAX_SLOPE_RATIO = 1.6;

/**
 * Minimum prominence a standard-channel peak must have, as a fraction of the
 * strongest ladder peak's prominence, to be kept for ladder matching.
 *
 * Unlike sample channels — where a real allele can be arbitrarily weak and
 * height/prominence must NOT gate detection (see peak-detection.ts) — the size
 * standard is a set of engineered fragments injected at comparable amounts, so
 * every genuine ladder peak stands well clear of the baseline. In weak-signal
 * standard traces the noise-relative detector also picks up small baseline
 * bumps (prominence a few % of the real peaks). Left in, these junk peaks
 * inflate the median peak spacing that landmark detection relies on — hiding
 * the ladder's distinctive tight clusters (GS500's 139/150/160 triplet and the
 * 340/350, 490/500 doublets) and inventing false ones — which derails matching
 * and leaves most of the ladder unassigned even though every real peak is
 * present. Empirically the real fixtures separate cleanly: genuine ladder peaks
 * sit above ~20% of the max prominence while the junk sits below ~7%, so 0.1
 * discards the junk with wide margin on both sides.
 */
const MIN_STANDARD_PEAK_PROMINENCE_FRACTION = 0.1;

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
    this.isReliable =
      matchedPeaks.length >= MIN_MATCHED_PEAKS && maxSlopeRatio(matchedPeaks) <= MAX_SLOPE_RATIO;
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
   * Uses signal-based injection detection to discard peaks from the initial
   * artifact region, then anchor-based RANSAC matching on the remaining peaks
   * (see peak-ladder-match.ts).
   *
   * @returns A SizeCalibration, or null if matching failed or too few peaks
   *          were matched.
   */
  static tryBuild(standard: Electropherogram, ladder: SizeLadder): SizeCalibration | null {
    const injectionEnd = findInjectionEnd(standard.data);
    const afterInjection = standard.peaks.filter((p) => p.position >= injectionEnd);
    const peaks = filterWeakStandardPeaks(afterInjection);
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
 * Drop baseline-bump peaks from a standard channel, keeping only those within
 * MIN_STANDARD_PEAK_PROMINENCE_FRACTION of the strongest peak. See the constant
 * for why this is safe (and necessary) for the ladder but not for sample
 * channels. Returns the input unchanged when there are no peaks.
 */
function filterWeakStandardPeaks(peaks: readonly Peak[]): Peak[] {
  let maxProminence = 0;
  for (const p of peaks) if (p.prominence > maxProminence) maxProminence = p.prominence;
  if (maxProminence <= 0) return [...peaks];
  const threshold = maxProminence * MIN_STANDARD_PEAK_PROMINENCE_FRACTION;
  return peaks.filter((p) => p.prominence >= threshold);
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

/**
 * Largest ratio between consecutive calibration segments' slopes (scans per bp).
 * Returns 1 when there are fewer than two segments. Used as a smoothness check:
 * a value well above 1 means a segment is anomalously steep or shallow, which
 * signals a mislabelled matched peak.
 */
function maxSlopeRatio(matched: readonly MatchedPeak[]): number {
  const slopes: number[] = [];
  for (let i = 1; i < matched.length; i++) {
    const prev = matched[i - 1];
    const curr = matched[i];
    if (!prev || !curr) continue;
    const dBp = curr.bp - prev.bp;
    if (dBp <= 0) continue;
    slopes.push((curr.scan - prev.scan) / dBp);
  }

  let maxRatio = 1;
  for (let i = 1; i < slopes.length; i++) {
    const a = slopes[i - 1];
    const b = slopes[i];
    if (a === undefined || b === undefined || a <= 0 || b <= 0) continue;
    maxRatio = Math.max(maxRatio, a / b, b / a);
  }
  return maxRatio;
}

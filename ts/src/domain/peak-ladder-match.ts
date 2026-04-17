/**
 * Robust matching between detected standard peaks and known ladder sizes.
 *
 * Problem: we have N peaks detected in the standard channel and M known fragment
 * sizes in the ladder. Typically N ≈ M, but either list may have missing entries
 * (weak signal, failed peak detection) or extras (noise, dye blobs). Rank-order
 * matching fails as soon as the counts differ.
 *
 * Approach: anchor-based RANSAC. Try pairs of (early peak, early ladder point)
 * and (late peak, late ladder point) as anchors. For each anchor pair, fit a
 * linear model scan(bp), predict where each ladder point lands, and find the
 * nearest detected peak. Count inliers. The best anchor pair wins.
 */

import type { Peak } from "../lib/peak-detection.ts";

export interface MatchedPeak {
  readonly scan: number;
  readonly bp: number;
}

interface Anchor {
  readonly bpLo: number;
  readonly bpHi: number;
  readonly scanLo: number;
  readonly scanHi: number;
}

const MIN_MATCHES = 5;
const HEAD_ANCHORS = 3;
const TAIL_ANCHORS = 3;
const TOLERANCE_FRACTION = 0.3;
const MIN_TOLERANCE = 20;

/**
 * Match detected peaks against a sorted list of ladder sizes.
 *
 * @param peaks - Peaks detected in the standard channel, sorted by scan position.
 * @param sizes - Known fragment sizes in base pairs, sorted ascending.
 * @returns Matched (scan, bp) pairs in ascending scan order, or null if no
 *          reliable matching was found.
 */
export function matchPeaksToLadder(
  peaks: readonly Peak[],
  sizes: readonly number[],
): MatchedPeak[] | null {
  if (peaks.length < MIN_MATCHES || sizes.length < MIN_MATCHES) return null;

  let best: MatchedPeak[] = [];
  for (const anchor of enumerateAnchors(peaks, sizes)) {
    const matches = matchWithAnchor(peaks, sizes, anchor);
    if (matches.length > best.length) best = matches;
  }

  return best.length >= MIN_MATCHES ? best : null;
}

/** Enumerate candidate anchor pairs: (early peak, early ladder) + (late peak, late ladder). */
function* enumerateAnchors(peaks: readonly Peak[], sizes: readonly number[]): Generator<Anchor> {
  const n = peaks.length;
  const m = sizes.length;

  const headPeakRange = Math.min(HEAD_ANCHORS, n);
  const tailPeakStart = Math.max(headPeakRange, n - TAIL_ANCHORS);
  const headLadderRange = Math.min(HEAD_ANCHORS, m);
  const tailLadderStart = Math.max(headLadderRange, m - TAIL_ANCHORS);

  for (let i = 0; i < headPeakRange; i++) {
    for (let j = tailPeakStart; j < n; j++) {
      for (let k = 0; k < headLadderRange; k++) {
        for (let l = tailLadderStart; l < m; l++) {
          const anchor = makeAnchor(peaks[i], peaks[j], sizes[k], sizes[l]);
          if (anchor) yield anchor;
        }
      }
    }
  }
}

function makeAnchor(
  peakLo: Peak | undefined,
  peakHi: Peak | undefined,
  bpLo: number | undefined,
  bpHi: number | undefined,
): Anchor | null {
  if (!peakLo || !peakHi || bpLo === undefined || bpHi === undefined) return null;
  if (bpHi <= bpLo || peakHi.position <= peakLo.position) return null;
  return { bpLo, bpHi, scanLo: peakLo.position, scanHi: peakHi.position };
}

/**
 * Given an anchor (two ladder points mapped to two scan positions), fit a
 * linear model and greedily match all ladder points to peaks within tolerance.
 */
function matchWithAnchor(
  peaks: readonly Peak[],
  sizes: readonly number[],
  anchor: Anchor,
): MatchedPeak[] {
  const a = (anchor.scanHi - anchor.scanLo) / (anchor.bpHi - anchor.bpLo);
  const b = anchor.scanLo - a * anchor.bpLo;

  const typicalSpacing = ((anchor.bpHi - anchor.bpLo) / (sizes.length - 1)) * a;
  const tolerance = Math.max(MIN_TOLERANCE, Math.abs(typicalSpacing) * TOLERANCE_FRACTION);

  const matches: MatchedPeak[] = [];
  let searchFrom = 0;
  for (const bp of sizes) {
    const predicted = a * bp + b;
    const peakIdx = findNearestPeakFrom(peaks, predicted, tolerance, searchFrom);
    if (peakIdx >= 0) {
      const chosen = peaks[peakIdx];
      if (chosen) {
        matches.push({ scan: chosen.position, bp });
        searchFrom = peakIdx + 1;
      }
    }
  }
  return matches;
}

function findNearestPeakFrom(
  peaks: readonly Peak[],
  predicted: number,
  tolerance: number,
  startIdx: number,
): number {
  let bestIdx = -1;
  let bestDist = tolerance;
  for (let pi = startIdx; pi < peaks.length; pi++) {
    const peak = peaks[pi];
    if (!peak) continue;
    const dist = Math.abs(peak.position - predicted);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = pi;
    }
    if (peak.position > predicted + tolerance) break;
  }
  return bestIdx;
}

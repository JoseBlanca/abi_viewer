/**
 * Distinctive-landmark detection used to verify and, if needed, correct a
 * peak-to-ladder match.
 *
 * Some ladders contain runs of closely-spaced fragments that form unique,
 * scale-invariant signatures. GeneScan 500 LIZ has three: the triplet
 * 139/150/160 and the doublets 340/350 and 490/500 — each a run of small,
 * near-equal gaps flanked by clearly larger gaps. These are simultaneously the
 * hardest places for the linear-model matcher to get right (the intra-cluster
 * spacing is comparable to its tolerance) and the easiest to recognise directly
 * from the raw peak spacings, which is what makes them good anchors.
 *
 * This module finds those groups in the ladder definition and in a list of
 * detected peaks, then maps one to the other by their order and member counts.
 * The result is a set of high-confidence (scan, bp) anchors the matcher uses to
 * cross-check and, when the check fails, recalibrate. Mapping is only returned
 * when it is unambiguous, so a partial constellation (e.g. only the two
 * doublets, with the triplet lost to weak signal) still anchors correctly.
 */

import type { Peak } from "../lib/peak-detection.ts";
import type { MatchedPeak } from "./peak-ladder-match.ts";

/** A run of consecutive, closely-spaced ladder fragments (in bp). */
export interface LandmarkGroup {
  readonly bps: readonly number[];
}

/** A gap counts as "small" (intra-group) below this fraction of the median gap. */
const SMALL_GAP_FRACTION = 0.5;
/** Within a group, gaps must agree to within this fraction of the largest one. */
const MAX_INTERNAL_DIFF_FRACTION = 0.5;

/**
 * Find the distinctive landmark groups in a ladder: maximal runs of small,
 * near-equal gaps that are preceded by a clearly larger gap (so the very first
 * fragments, which have no large gap before them, are not treated as a group).
 * Returns the groups in ascending bp order.
 */
export function findLadderLandmarks(sizes: readonly number[]): LandmarkGroup[] {
  return findTightGroups(sizes).map((members) => ({ bps: members }));
}

/**
 * Find the same distinctive groups among detected peaks (sorted by scan).
 * Returns each group as its member scan positions, in ascending scan order.
 */
export function findPeakLandmarks(peaks: readonly Peak[]): number[][] {
  return findTightGroups(peaks.map((p) => p.position));
}

/**
 * Map peak groups to ladder groups by order and member count, and emit the
 * resulting (scan, bp) anchors. Returns null when there is no unique mapping
 * (nothing matched, or more than one order-preserving assignment is possible),
 * so ambiguous evidence never produces wrong anchors.
 */
export function matchLandmarks(
  ladderGroups: readonly LandmarkGroup[],
  peakGroups: readonly number[][],
): MatchedPeak[] | null {
  if (peakGroups.length === 0) return null;

  const ladderSizes = ladderGroups.map((g) => g.bps.length);
  const peakSizes = peakGroups.map((g) => g.length);
  const mappings = orderPreservingMatches(ladderSizes, peakSizes);
  if (mappings.length !== 1) return null;
  const mapping = mappings[0];
  if (!mapping) return null;

  const anchors: MatchedPeak[] = [];
  for (let p = 0; p < peakGroups.length; p++) {
    const ladderGroup = ladderGroups[mapping[p] ?? -1];
    const positions = peakGroups[p];
    if (!ladderGroup || !positions) return null;
    const pairs = zipGroup(ladderGroup.bps, positions);
    if (!pairs) return null;
    anchors.push(...pairs);
  }
  anchors.sort((a, b) => a.scan - b.scan);
  return anchors;
}

/** Pair a ladder group's bps with a peak group's scans (both sorted ascending). */
function zipGroup(bps: readonly number[], positions: readonly number[]): MatchedPeak[] | null {
  if (bps.length !== positions.length) return null;
  const sortedBps = [...bps].sort((a, b) => a - b);
  const sortedScans = [...positions].sort((a, b) => a - b);
  const pairs: MatchedPeak[] = [];
  for (let k = 0; k < sortedScans.length; k++) {
    const scan = sortedScans[k];
    const bp = sortedBps[k];
    if (scan === undefined || bp === undefined) return null;
    pairs.push({ scan, bp });
  }
  return pairs;
}

/**
 * Maximal runs of "small" consecutive gaps that have a larger gap before them.
 * The result lists each run's member values in ascending order. Shared by the
 * ladder and peak detectors so both use an identical notion of a tight group.
 */
function findTightGroups(values: readonly number[]): number[][] {
  if (values.length < 3) return [];

  const gaps: number[] = [];
  for (let i = 1; i < values.length; i++) {
    gaps.push((values[i] ?? 0) - (values[i - 1] ?? 0));
  }
  const smallThreshold = median(gaps) * SMALL_GAP_FRACTION;
  const isSmall = gaps.map((g) => g <= smallThreshold);

  const groups: number[][] = [];
  let i = 0;
  while (i < isSmall.length) {
    if (!isSmall[i]) {
      i++;
      continue;
    }
    // A maximal run of small gaps spans values[i .. end+1].
    let end = i;
    while (end + 1 < isSmall.length && isSmall[end + 1]) end++;

    // i > 0 means a larger gap precedes the run (so leading fragments without a
    // bracket before them are not treated as a group).
    const members = values.slice(i, end + 2);
    if (i > 0 && internalGapsSimilar(members)) groups.push(members);
    i = end + 1;
  }

  return groups;
}

/** Whether every internal gap of a run agrees with the largest to within tolerance. */
function internalGapsSimilar(members: readonly number[]): boolean {
  let maxGap = 0;
  const gaps: number[] = [];
  for (let i = 1; i < members.length; i++) {
    const g = (members[i] ?? 0) - (members[i - 1] ?? 0);
    gaps.push(g);
    if (g > maxGap) maxGap = g;
  }
  return gaps.every((g) => Math.abs(g - maxGap) <= MAX_INTERNAL_DIFF_FRACTION * maxGap);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * All strictly-increasing index sequences into `ladderSizes` whose sizes equal
 * `peakSizes` in order. Used to decide whether the constellation maps to the
 * ladder unambiguously (exactly one sequence) or not.
 */
function orderPreservingMatches(
  ladderSizes: readonly number[],
  peakSizes: readonly number[],
): number[][] {
  const results: number[][] = [];
  collectMatches(ladderSizes, peakSizes, 0, 0, [], results);
  return results;
}

function collectMatches(
  ladderSizes: readonly number[],
  peakSizes: readonly number[],
  peakIdx: number,
  ladderStart: number,
  acc: number[],
  results: number[][],
): void {
  if (peakIdx === peakSizes.length) {
    results.push([...acc]);
    return;
  }
  for (let l = ladderStart; l < ladderSizes.length; l++) {
    if (ladderSizes[l] !== peakSizes[peakIdx]) continue;
    acc.push(l);
    collectMatches(ladderSizes, peakSizes, peakIdx + 1, l + 1, acc, results);
    acc.pop();
  }
}

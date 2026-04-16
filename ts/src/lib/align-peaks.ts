/**
 * Affine alignment of electropherogram peaks across samples.
 *
 * Given peaks detected in a reference standard channel and a sample standard
 * channel, computes the affine transformation (scale + offset) that best aligns
 * the sample peaks to the reference.
 */

import type { Peak } from "./peak-detection.ts";
import { detectPeaks } from "./peak-detection.ts";

export interface AffineTransform {
  /** Scale factor: scan_ref = scale * scan_sample + offset */
  readonly scale: number;
  /** Offset in scan units. */
  readonly offset: number;
}

export interface AlignmentResult {
  readonly transform: AffineTransform;
  /** Number of peak pairs used in the fit. */
  readonly matchedPeaks: number;
}

const MIN_PEAKS_FOR_ALIGNMENT = 3;
const OUTLIER_RESIDUAL_FACTOR = 2.5;

/**
 * Compute the affine transformation that aligns sample peaks to reference peaks.
 *
 * Peaks are matched by nearest-neighbor: for each reference peak, the closest
 * sample peak within a tolerance is matched. This is robust to missing or extra
 * peaks. After the initial fit, outlier pairs are rejected and the model is refit.
 *
 * @returns The alignment result, or null if too few peaks to fit.
 */
export function computeAlignment(refPeaks: Peak[], samplePeaks: Peak[]): AlignmentResult | null {
  if (refPeaks.length < MIN_PEAKS_FOR_ALIGNMENT || samplePeaks.length < MIN_PEAKS_FOR_ALIGNMENT) {
    return null;
  }

  const matched = matchNearestNeighbor(refPeaks, samplePeaks);
  if (matched.length < MIN_PEAKS_FOR_ALIGNMENT) return null;

  const refPositions = matched.map((m) => m.ref);
  const samplePositions = matched.map((m) => m.sample);

  const initialFit = fitAffine(refPositions, samplePositions);
  if (!initialFit) return null;

  // Reject outliers and refit for a more robust estimate
  const refined = refitWithoutOutliers(refPositions, samplePositions, initialFit);

  return {
    transform: refined.transform,
    matchedPeaks: refined.count,
  };
}

function refitWithoutOutliers(
  refPos: number[],
  samplePos: number[],
  fit: AffineTransform,
): { transform: AffineTransform; count: number } {
  const residuals = refPos.map((r, i) => {
    const s = samplePos[i];
    return s !== undefined ? Math.abs(r - (fit.scale * s + fit.offset)) : 0;
  });
  const med = median(residuals);
  if (med <= 0) return { transform: fit, count: refPos.length };

  const threshold = med * OUTLIER_RESIDUAL_FACTOR;
  const inlierRef: number[] = [];
  const inlierSample: number[] = [];
  for (let i = 0; i < residuals.length; i++) {
    const rp = refPos[i];
    const sp = samplePos[i];
    if ((residuals[i] ?? 0) <= threshold && rp !== undefined && sp !== undefined) {
      inlierRef.push(rp);
      inlierSample.push(sp);
    }
  }

  if (inlierRef.length < MIN_PEAKS_FOR_ALIGNMENT) return { transform: fit, count: refPos.length };

  const refit = fitAffine(inlierRef, inlierSample);
  return refit
    ? { transform: refit, count: inlierRef.length }
    : { transform: fit, count: refPos.length };
}

/**
 * Match reference peaks to sample peaks by nearest neighbor.
 *
 * For each reference peak, finds the closest unmatched sample peak.
 * Both lists must be sorted by position. A maximum distance tolerance is
 * applied (10% of the total scan range spanned by the reference peaks).
 */
function findNearestUnused(
  position: number,
  candidates: Peak[],
  used: Set<number>,
  maxDistance: number,
): number {
  let bestIdx = -1;
  let bestDist = maxDistance;
  for (let j = 0; j < candidates.length; j++) {
    if (used.has(j)) continue;
    const cp = candidates[j];
    if (!cp) continue;
    const dist = Math.abs(position - cp.position);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = j;
    }
  }
  return bestIdx;
}

function matchNearestNeighbor(
  refPeaks: Peak[],
  samplePeaks: Peak[],
): { ref: number; sample: number }[] {
  const refFirst = refPeaks[0];
  const refLast = refPeaks[refPeaks.length - 1];
  if (!refFirst || !refLast) return [];

  const refSpan = refLast.position - refFirst.position;
  const maxDistance = Math.max(100, refSpan * 0.1);

  const matched: { ref: number; sample: number }[] = [];
  const usedSample = new Set<number>();

  for (const rp of refPeaks) {
    const bestIdx = findNearestUnused(rp.position, samplePeaks, usedSample, maxDistance);
    const sp = bestIdx >= 0 ? samplePeaks[bestIdx] : undefined;
    if (sp) {
      matched.push({ ref: rp.position, sample: sp.position });
      usedSample.add(bestIdx);
    }
  }

  return matched;
}

/**
 * Fit an affine model: ref = scale * sample + offset
 * via ordinary least squares.
 */
function fitAffine(ref: number[], sample: number[]): AffineTransform | null {
  const n = ref.length;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;

  for (let i = 0; i < n; i++) {
    const x = sample[i] ?? 0;
    const y = ref[i] ?? 0;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) {
    // Degenerate case: all sample positions are the same
    return null;
  }

  const scale = (n * sumXY - sumX * sumY) / denom;
  const offset = (sumY - scale * sumX) / n;

  return { scale, offset };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Filter peaks to exclude the injection artifact region at the start of the run.
 * Size standard peaks are always in the later portion of the electropherogram.
 */
function filterInjectionRegion(peaks: Peak[], dataLength: number): Peak[] {
  const minPosition = Math.round(dataLength * 0.25);
  return peaks.filter((p) => p.position >= minPosition);
}

/**
 * Auto-align multiple samples' standard channels to the first sample.
 *
 * Zooms into the standard peaks region so the alignment is immediately visible,
 * and shifts xCenter per sample to align the peaks.
 *
 * @returns A map from sample name to viewport parameters.
 */
export function autoAlignSamples(
  standardChannels: { name: string; data: Int16Array }[],
): Map<string, { xCenter: number; xZoom: number }> {
  const result = new Map<string, { xCenter: number; xZoom: number }>();

  const ref = standardChannels[0];
  if (!ref) return result;

  const refPeaks = filterInjectionRegion(detectPeaks(ref.data), ref.data.length);
  if (refPeaks.length === 0) return result;

  // Compute zoom to show just the standard peaks region (with 20% margin)
  const firstPeak = refPeaks[0];
  const lastPeak = refPeaks[refPeaks.length - 1];
  if (!firstPeak || !lastPeak) return result;

  const peakSpan = lastPeak.position - firstPeak.position;
  const margin = peakSpan * 0.2;
  const viewSpan = peakSpan + 2 * margin;
  const xZoom = Math.max(1, Math.min(10, ref.data.length / viewSpan));
  const refCenter = (firstPeak.position + lastPeak.position) / 2;

  result.set(ref.name, { xCenter: refCenter, xZoom });

  for (let i = 1; i < standardChannels.length; i++) {
    const sample = standardChannels[i];
    if (!sample) continue;

    const samplePeaks = filterInjectionRegion(detectPeaks(sample.data), sample.data.length);
    const alignment = computeAlignment(refPeaks, samplePeaks);

    if (alignment) {
      // The sample center that corresponds to refCenter in the affine model:
      // scan_ref = scale * scan_sample + offset
      // => scan_sample = (scan_ref - offset) / scale
      const sampleCenter = (refCenter - alignment.transform.offset) / alignment.transform.scale;
      result.set(sample.name, { xCenter: sampleCenter, xZoom });
    } else {
      result.set(sample.name, { xCenter: refCenter, xZoom });
    }
  }

  return result;
}

/**
 * Convert an affine transform to an xCenter shift for alignment.
 *
 * The transform maps: scan_ref = scale * scan_sample + offset
 *
 * When all widgets share the same xZoom (locked), alignment only needs an
 * xCenter offset. The sample peaks are shifted by `offset` scans relative to
 * the reference, so we shift the sample viewport by the same amount to
 * compensate.
 *
 * @returns xCenter and xZoom (zoom is always 1 — zoom is shared via lock).
 */
export function transformToViewport(
  transform: AffineTransform,
  dataLength: number,
): { xCenter: number; xZoom: number } {
  // Reference viewport is centered at dataLength/2.
  // The offset tells us: sample peaks appear `offset` scans earlier (if positive)
  // or later (if negative) than in the reference.
  // To align, shift the sample viewport center by offset/scale.
  const refCenter = dataLength / 2;
  const shift = transform.offset / transform.scale;
  return { xCenter: refCenter + shift, xZoom: 1 };
}

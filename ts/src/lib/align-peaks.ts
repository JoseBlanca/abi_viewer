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
 * Peaks are matched by rank order (both sorted by position). If an outlier pair
 * has a residual > 2.5x the median, it is dropped and the model is refit.
 *
 * @returns The alignment result, or null if too few peaks to fit.
 */
export function computeAlignment(refPeaks: Peak[], samplePeaks: Peak[]): AlignmentResult | null {
  if (refPeaks.length < MIN_PEAKS_FOR_ALIGNMENT || samplePeaks.length < MIN_PEAKS_FOR_ALIGNMENT) {
    return null;
  }

  // Match by rank order (both already sorted by position)
  const n = Math.min(refPeaks.length, samplePeaks.length);
  let refPositions = refPeaks.slice(0, n).map((p) => p.position);
  let samplePositions = samplePeaks.slice(0, n).map((p) => p.position);

  // First fit
  const initialFit = fitAffine(refPositions, samplePositions);
  if (!initialFit) return null;
  let transform = initialFit;

  // Reject outliers and refit
  const residuals = refPositions.map((r, i) => {
    const si = samplePositions[i];
    if (si === undefined) return 0;
    return Math.abs(r - (initialFit.scale * si + initialFit.offset));
  });
  const medianResidual = median(residuals);

  if (medianResidual > 0) {
    const threshold = medianResidual * OUTLIER_RESIDUAL_FACTOR;
    const inlierRef: number[] = [];
    const inlierSample: number[] = [];
    for (let i = 0; i < residuals.length; i++) {
      const res = residuals[i];
      const rp = refPositions[i];
      const sp = samplePositions[i];
      if (res !== undefined && rp !== undefined && sp !== undefined && res <= threshold) {
        inlierRef.push(rp);
        inlierSample.push(sp);
      }
    }

    if (inlierRef.length >= MIN_PEAKS_FOR_ALIGNMENT) {
      refPositions = inlierRef;
      samplePositions = inlierSample;
      const refit = fitAffine(refPositions, samplePositions);
      if (refit) {
        transform = refit;
      }
    }
  }

  return {
    transform,
    matchedPeaks: refPositions.length,
  };
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
 * Auto-align multiple samples' standard channels to the first sample.
 *
 * @returns A map from sample index to viewport parameters (xCenter, xZoom).
 */
export function autoAlignSamples(
  standardChannels: { name: string; data: Int16Array }[],
): Map<string, { xCenter: number; xZoom: number }> {
  const result = new Map<string, { xCenter: number; xZoom: number }>();

  const ref = standardChannels[0];
  if (!ref) return result;

  const refPeaks = detectPeaks(ref.data);
  result.set(ref.name, { xCenter: ref.data.length / 2, xZoom: 1 });

  for (let i = 1; i < standardChannels.length; i++) {
    const sample = standardChannels[i];
    if (!sample) continue;

    const samplePeaks = detectPeaks(sample.data);
    const alignment = computeAlignment(refPeaks, samplePeaks);

    if (alignment) {
      result.set(sample.name, transformToViewport(alignment.transform, sample.data.length));
    } else {
      result.set(sample.name, { xCenter: sample.data.length / 2, xZoom: 1 });
    }
  }

  return result;
}

/**
 * Convert an affine transform to viewport parameters relative to a data length.
 *
 * @returns xCenter and xZoom that, when applied to the viewport, align the sample
 *          to the reference.
 */
export function transformToViewport(
  transform: AffineTransform,
  dataLength: number,
): { xCenter: number; xZoom: number } {
  // The transform maps: scan_ref = scale * scan_sample + offset
  // We want to show sample scans such that they line up with the reference.
  //
  // The visible window in reference space is [0, dataLength].
  // In sample space, this maps to: scan_sample = (scan_ref - offset) / scale
  //
  // So the center of the reference range (dataLength/2) maps to:
  const refCenter = dataLength / 2;
  const sampleCenter = (refCenter - transform.offset) / transform.scale;

  // The zoom: if scale > 1, the sample is more spread out than the reference,
  // so we need to zoom in (compress) to match. xZoom = scale.
  const xZoom = Math.max(1, Math.min(10, transform.scale));

  return { xCenter: sampleCenter, xZoom };
}

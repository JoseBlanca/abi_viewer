/**
 * Prominence-based peak detection for electropherogram signals.
 */

export interface Peak {
  /** Scan index of the peak. */
  readonly position: number;
  /** Signal value at the peak. */
  readonly height: number;
  /** Prominence: how much the peak stands out from its surroundings. */
  readonly prominence: number;
}

/**
 * Minimum prominence as a multiple of the estimated noise floor. A peak must
 * rise this many noise sigmas above the baseline to count as real.
 */
const DEFAULT_NOISE_FACTOR = 8;

/**
 * Detect peaks in a signal using prominence filtering.
 *
 * The prominence threshold is anchored to the signal's noise floor (a robust
 * MAD estimate), not to the tallest peak. This keeps detection sensitive to
 * weak real peaks regardless of how tall the injection artifact or the
 * strongest fragment happens to be — a fraction-of-max threshold would scale
 * with those and silently drop weak ladder peaks in low-signal samples.
 *
 * Peak height is deliberately NOT used to reject peaks: in fragment analysis the
 * real alleles are frequently the tallest peaks in the trace. The start-of-run
 * injection spike is excluded downstream by scan position (injection detection
 * for calibration, the artifact cutoff for the CSV export), not here by height.
 *
 * @param data - Raw signal (fluorescence intensity per scan).
 * @param noiseFactor - Minimum prominence as a multiple of the noise floor.
 * @param minDistance - Minimum distance in scans between peaks. Kept small enough
 *   to resolve alleles ~1 bp apart (~11-14 scans in typical runs); a coarser
 *   value merges adjacent real peaks into one.
 * @returns Peaks sorted by scan position.
 */
export function detectPeaks(
  data: Int16Array,
  noiseFactor = DEFAULT_NOISE_FACTOR,
  minDistance = 10,
): Peak[] {
  if (data.length < 3) return [];

  const smoothed = smooth(data, 7);

  // Find all local maxima
  const maxima: { position: number; height: number }[] = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const prev = smoothed[i - 1];
    const curr = smoothed[i];
    const next = smoothed[i + 1];
    if (
      prev !== undefined &&
      curr !== undefined &&
      next !== undefined &&
      curr > prev &&
      curr > next
    ) {
      maxima.push({ position: i, height: curr });
    }
  }

  if (maxima.length === 0) return [];

  // Compute prominence for each maximum
  const peaks: Peak[] = maxima.map((m) => ({
    ...m,
    prominence: computeProminence(smoothed, m.position),
  }));

  // Filter by prominence relative to the noise floor.
  const prominenceThreshold = noiseFactor * estimateNoise(data, smoothed);
  let filtered = peaks.filter((p) => p.prominence >= prominenceThreshold);

  // Filter by minimum distance (keep the more prominent peak)
  filtered = filterByDistance(filtered, minDistance);

  // Sort by position
  filtered.sort((a, b) => a.position - b.position);

  return filtered;
}

/**
 * Estimate the signal's noise floor as the robust standard deviation of the
 * residual between the raw and smoothed signal. Smoothing removes the
 * high-frequency noise, so the residual *is* that noise; using the median
 * absolute deviation (scaled to a sigma equivalent) makes the estimate robust
 * to peaks and to the injection artifact, which are a minority of samples.
 */
function estimateNoise(data: Int16Array, smoothed: Float64Array): number {
  const residuals = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) residuals[i] = (data[i] ?? 0) - (smoothed[i] ?? 0);
  return 1.4826 * medianAbsoluteDeviation(residuals);
}

/** Median of |x - median(x)|. */
function medianAbsoluteDeviation(values: Float64Array): number {
  const med = medianOf(values);
  const deviations = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) deviations[i] = Math.abs((values[i] ?? 0) - med);
  return medianOf(deviations);
}

function medianOf(values: Float64Array): number {
  if (values.length === 0) return 0;
  const sorted = Float64Array.from(values).sort();
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Smooth a signal with a moving average.
 */
function smooth(data: Int16Array, windowSize: number): Float64Array {
  const halfWindow = Math.floor(windowSize / 2);
  const result = new Float64Array(data.length);

  for (let i = 0; i < data.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      if (j >= 0 && j < data.length) {
        sum += data[j] ?? 0;
        count++;
      }
    }
    result[i] = sum / count;
  }

  return result;
}

/**
 * Compute the prominence of a peak.
 *
 * Walk left and right from the peak until hitting a higher point or the signal
 * edge. The prominence is the peak height minus the highest valley floor found
 * on either side.
 */
function computeProminence(signal: Float64Array, peakIdx: number): number {
  const peakHeight = signal[peakIdx] ?? 0;

  let leftMin = peakHeight;
  for (let i = peakIdx - 1; i >= 0; i--) {
    const v = signal[i] ?? 0;
    if (v > peakHeight) break;
    if (v < leftMin) leftMin = v;
  }

  let rightMin = peakHeight;
  for (let i = peakIdx + 1; i < signal.length; i++) {
    const v = signal[i] ?? 0;
    if (v > peakHeight) break;
    if (v < rightMin) rightMin = v;
  }

  const higherValley = Math.max(leftMin, rightMin);
  return peakHeight - higherValley;
}

/**
 * Filter peaks by minimum distance, keeping the more prominent peak
 * when two are too close.
 */
function filterByDistance(peaks: Peak[], minDistance: number): Peak[] {
  const sorted = [...peaks].sort((a, b) => b.prominence - a.prominence);
  const kept: Peak[] = [];

  for (const peak of sorted) {
    const tooClose = kept.some((k) => Math.abs(k.position - peak.position) < minDistance);
    if (!tooClose) {
      kept.push(peak);
    }
  }

  return kept;
}

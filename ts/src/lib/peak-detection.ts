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
 * Detect peaks in a signal using prominence filtering.
 *
 * @param data - Raw signal (fluorescence intensity per scan).
 * @param minProminenceRatio - Minimum prominence as a fraction of the max prominence found (0-1).
 * @param minDistance - Minimum distance in scans between peaks.
 * @returns Peaks sorted by scan position.
 */
export function detectPeaks(data: Int16Array, minProminenceRatio = 0.15, minDistance = 30): Peak[] {
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

  // Filter by prominence
  const maxProminence = Math.max(...peaks.map((p) => p.prominence));
  const prominenceThreshold = maxProminence * minProminenceRatio;
  let filtered = peaks.filter((p) => p.prominence >= prominenceThreshold);

  // Filter by minimum distance (keep the more prominent peak)
  filtered = filterByDistance(filtered, minDistance);

  // Sort by position
  filtered.sort((a, b) => a.position - b.position);

  return filtered;
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

  // Walk left: find the minimum before hitting a higher peak or the edge
  let leftMin = peakHeight;
  for (let i = peakIdx - 1; i >= 0; i--) {
    const v = signal[i] ?? 0;
    if (v > peakHeight) break;
    if (v < leftMin) leftMin = v;
  }

  // Walk right: same
  let rightMin = peakHeight;
  for (let i = peakIdx + 1; i < signal.length; i++) {
    const v = signal[i] ?? 0;
    if (v > peakHeight) break;
    if (v < rightMin) rightMin = v;
  }

  // Prominence = peak height minus the higher of the two valley floors
  const higherValley = Math.max(leftMin, rightMin);
  return peakHeight - higherValley;
}

/**
 * Filter peaks by minimum distance, keeping the more prominent peak
 * when two are too close.
 */
function filterByDistance(peaks: Peak[], minDistance: number): Peak[] {
  // Sort by prominence descending so we keep the best peaks
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

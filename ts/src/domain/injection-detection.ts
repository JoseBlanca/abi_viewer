/**
 * Detects the end of the injection artifact region in a size-standard signal.
 *
 * In fragment analysis, the first ~5-15% of scans contains tall peaks produced
 * by the injection step itself (primer residuals, dye blobs), not real size
 * standard fragments. These peaks are often 10-100x taller than the real
 * ladder peaks. If they leak into peak-to-ladder matching, the calibration is
 * completely wrong: the algorithm maps injection artifacts to ladder bp
 * positions.
 *
 * Detection strategy: find the tallest value in the first portion of the scan
 * range (the injection peak), then walk forward until the signal drops to a
 * small fraction of that peak. The drop point marks the transition from
 * injection to baseline / real signal.
 */

/** First portion of the scan range considered when searching for the injection peak. */
const INJECTION_SEARCH_FRACTION = 0.3;
/** Signal level (as fraction of the injection peak) considered "back to baseline". */
const DROP_THRESHOLD_FRACTION = 0.05;
/** How many consecutive low-signal scans are required to confirm the drop. */
const QUIET_STREAK = 50;
/** Extra scans added after the detected drop to give a margin. */
const MARGIN = 100;
/** If the injection peak height is below this, we consider there is no meaningful injection. */
const MIN_INJECTION_HEIGHT = 1000;

/**
 * Return the scan index just past the end of the injection artifact region.
 * Returns 0 if no significant injection peak is detected (so no peaks are filtered).
 */
export function findInjectionEnd(data: Int16Array): number {
  const searchEnd = Math.floor(data.length * INJECTION_SEARCH_FRACTION);
  if (searchEnd < 10) return 0;

  let injectionPeak = 0;
  let injectionPeakIdx = 0;
  for (let i = 0; i < searchEnd; i++) {
    const v = data[i] ?? 0;
    if (v > injectionPeak) {
      injectionPeak = v;
      injectionPeakIdx = i;
    }
  }

  if (injectionPeak < MIN_INJECTION_HEIGHT) return 0;

  const dropThreshold = injectionPeak * DROP_THRESHOLD_FRACTION;

  // Walk forward from the injection peak, looking for a sustained low-signal
  // region (quiet streak). The first index where the streak completes is the
  // end of the injection.
  let quietCount = 0;
  for (let i = injectionPeakIdx + 1; i < data.length; i++) {
    const v = data[i] ?? 0;
    if (v < dropThreshold) {
      quietCount++;
      if (quietCount >= QUIET_STREAK) {
        return Math.min(data.length, i + MARGIN);
      }
    } else {
      quietCount = 0;
    }
  }

  // Never found a sustained drop — fall back to injection peak + margin
  return Math.min(data.length, injectionPeakIdx + MARGIN);
}

/**
 * Immutable domain object representing a single channel's electropherogram trace.
 *
 * Holds the raw signal data and metadata from one fluorescence channel of one
 * sample. Derived values like peaks are computed lazily and cached; the object
 * itself is immutable from the outside.
 */

import type { Peak } from "../lib/peak-detection.ts";
import { detectPeaks } from "../lib/peak-detection.ts";

export interface ElectropherogramParams {
  readonly data: Int16Array;
  readonly dyeName: string;
  readonly sampleName: string;
  readonly well: string;
  readonly fileName: string;
}

export class Electropherogram {
  readonly data: Int16Array;
  readonly dyeName: string;
  readonly sampleName: string;
  readonly well: string;
  readonly fileName: string;

  private _peaks: readonly Peak[] | null = null;

  constructor(params: ElectropherogramParams) {
    this.data = params.data;
    this.dyeName = params.dyeName;
    this.sampleName = params.sampleName;
    this.well = params.well;
    this.fileName = params.fileName;
  }

  get scanCount(): number {
    return this.data.length;
  }

  /** Detected peaks, computed lazily on first access and cached. */
  get peaks(): readonly Peak[] {
    if (this._peaks === null) {
      this._peaks = detectPeaks(this.data);
    }
    return this._peaks;
  }

  /** Signal value at a scan index. Returns 0 for out-of-range indices. */
  valueAt(scan: number): number {
    const idx = Math.round(scan);
    if (idx < 0 || idx >= this.data.length) return 0;
    return this.data[idx] ?? 0;
  }

  /**
   * Find the peak closest to the given scan position within a tolerance window.
   * Returns null if no peak falls within tolerance.
   */
  peakNear(scan: number, tolerance: number): Peak | null {
    let best: Peak | null = null;
    let bestDist = tolerance;
    for (const peak of this.peaks) {
      const dist = Math.abs(peak.position - scan);
      if (dist <= bestDist) {
        bestDist = dist;
        best = peak;
      }
    }
    return best;
  }
}

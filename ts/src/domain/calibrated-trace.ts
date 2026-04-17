/**
 * An electropherogram trace paired with a size calibration, enabling base pair
 * queries in addition to scan queries. Both inputs are immutable, so this
 * wrapper is effectively immutable as well.
 */

import type { Peak } from "../lib/peak-detection.ts";
import type { Electropherogram } from "./electropherogram.ts";
import type { SizeCalibration } from "./size-calibration.ts";

/** A peak annotated with its base pair size (null if outside the calibrated range). */
export interface PeakWithBp extends Peak {
  readonly bp: number | null;
}

export class CalibratedTrace {
  readonly trace: Electropherogram;
  readonly calibration: SizeCalibration;

  private _peaksInBp: readonly PeakWithBp[] | null = null;

  constructor(trace: Electropherogram, calibration: SizeCalibration) {
    this.trace = trace;
    this.calibration = calibration;
  }

  get scanCount(): number {
    return this.trace.scanCount;
  }

  /** Forward scan-based query to the underlying trace. */
  valueAt(scan: number): number {
    return this.trace.valueAt(scan);
  }

  /**
   * Signal value at a given base pair position. Returns null if bp falls
   * outside the calibrated range.
   */
  valueAtBp(bp: number): number | null {
    const scan = this.calibration.bpToScan(bp);
    if (scan === null) return null;
    return this.trace.valueAt(scan);
  }

  /**
   * Peaks annotated with base pair size. Peaks outside the calibrated scan
   * range get `bp: null`. Lazily computed and cached.
   */
  get peaksInBp(): readonly PeakWithBp[] {
    if (this._peaksInBp === null) {
      this._peaksInBp = this.trace.peaks.map((peak) => ({
        ...peak,
        bp: this.calibration.scanToBp(peak.position),
      }));
    }
    return this._peaksInBp;
  }
}

/**
 * Shared x-axis domain across all sample panels.
 *
 * Every panel must span the same x-range so the panels line up by default,
 * both when first created and when the x-axis mode is switched. We take the
 * union of the individual sample domains:
 *
 * - scan mode: [0, max scanCount] across all samples
 * - bp mode:   [min minBp, max maxBp] across all *calibrated* samples
 *              (uncalibrated samples don't draw in bp mode, so they don't
 *              contribute to the range); falls back to [0, 500] if nothing
 *              is calibrated.
 */

import type { SizeCalibration } from "./size-calibration.ts";

export type XAxisMode = "scan" | "bp";

export interface Domain {
  readonly min: number;
  readonly max: number;
}

export interface SampleDomainInput {
  readonly scanCount: number;
  readonly calibration: SizeCalibration | null;
}

const BP_FALLBACK: Domain = { min: 0, max: 500 };

function scanDomain(samples: readonly SampleDomainInput[]): Domain {
  let max = 0;
  for (const s of samples) {
    if (s.scanCount > max) max = s.scanCount;
  }
  return { min: 0, max: max > 0 ? max : 1 };
}

function bpDomain(samples: readonly SampleDomainInput[]): Domain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of samples) {
    if (!s.calibration) continue;
    if (s.calibration.minBp < min) min = s.calibration.minBp;
    if (s.calibration.maxBp > max) max = s.calibration.maxBp;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return BP_FALLBACK;
  return { min, max };
}

export function computeSharedDomain(
  mode: XAxisMode,
  samples: readonly SampleDomainInput[],
): Domain {
  return mode === "scan" ? scanDomain(samples) : bpDomain(samples);
}

/**
 * Size ladders used as fragment analysis standards.
 *
 * A ladder is a set of DNA fragments of known lengths (in base pairs) that
 * run in a dedicated fluorescence channel alongside the sample channels.
 * Detecting these peaks and matching them against the known sizes allows
 * calibrating scan positions to molecular weights.
 */

export interface SizeLadder {
  /** Human-readable name shown in the UI. */
  readonly name: string;
  /** Fragment lengths in base pairs, sorted ascending. */
  readonly sizes: readonly number[];
}

/** GeneScan 500 LIZ — 16 fragments from 35 to 500 bp. Most common ladder. */
export const GS500_LIZ: SizeLadder = {
  name: "GeneScan 500 LIZ",
  sizes: [35, 50, 75, 100, 139, 150, 160, 200, 250, 300, 340, 350, 400, 450, 490, 500],
};

/** GeneScan 600 LIZ — 36 fragments from 20 to 600 bp. */
export const GS600_LIZ: SizeLadder = {
  name: "GeneScan 600 LIZ",
  sizes: [
    20, 40, 60, 80, 100, 114, 120, 140, 160, 180, 200, 214, 220, 240, 250, 260, 280, 300, 314, 320,
    340, 360, 380, 400, 414, 420, 440, 460, 480, 500, 514, 520, 540, 560, 580, 600,
  ],
};

/** All available ladders, keyed by a short identifier. */
export const LADDERS: Record<string, SizeLadder> = {
  GS500_LIZ,
  GS600_LIZ,
};

/** Default ladder used when none is specified. */
export const DEFAULT_LADDER = GS500_LIZ;

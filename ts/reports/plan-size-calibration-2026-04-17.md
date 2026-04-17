# Plan: Electropherogram Domain Model + Size Calibration

**Date:** 2026-04-17
**Goal:** Refactor trace handling into a proper domain model (`Electropherogram` class),
add size-standard calibration so signals can be queried in base pairs, and integrate
into the UI. Each phase is independently shippable and tested.

## Guiding principles

- **Immutable domain objects.** Once constructed from raw data, `Electropherogram`
  and `SizeCalibration` never change. All derived values (peaks, bp mappings) are
  lazily computed and cached internally.
- **Separation of concerns.** `Electropherogram` knows only its own trace.
  `SizeCalibration` is a standalone mapping object. A thin wrapper combines them.
- **Tests are the contract.** Algorithms (peak matching, fitting) will be tweaked
  over time as edge cases are discovered. Tests lock in behavior on real fixtures
  so regressions are obvious. Every phase lands with tests against real data.

## Phase 1 — Electropherogram class

**Goal:** Introduce the domain object. No new features; refactor only.

### Deliverables

- `src/domain/electropherogram.ts` with `Electropherogram` class:
  - Constructor: `new Electropherogram({ data, dyeName, sampleName, well, fileName })`
  - All fields `readonly`
  - Lazy `get peaks(): readonly Peak[]` — cached result of `detectPeaks(data)`
  - `get scanCount(): number`
  - `valueAt(scan: number): number` — returns signal value, clamped to bounds
  - `peakNear(scan: number, tolerance: number): Peak | null`
- `src/domain/sample.ts` (optional, can defer): wrapper around `AbifFile` that
  yields `Electropherogram` per channel. If not introduced, `App` constructs
  instances directly.
- Widget signature changes:
  - From: `(channelData, channelDyeName, standardData, standardDyeName, label, ...)`
  - To: `(primary: Electropherogram, standard: Electropherogram | null, ...)`
  - The widget still owns UI state (xCenter, xZoom, sliders).
- `App.tsx` creates instances with `useMemo(keyed on file.name + channel)` so the
  class's internal caches survive across renders.

### Tests (tests/domain/electropherogram.test.ts)

- Constructs from real fixture data, reads fields back
- `peaks` returns the same array reference on repeated calls (caching works)
- `peaks` matches the output of directly calling `detectPeaks(data)`
- `valueAt` returns the correct signal value at known scan positions
- `valueAt` out-of-bounds returns 0 (or throws — decide and test)
- `peakNear` finds the closest peak within tolerance, returns null otherwise

### Acceptance criteria

- `npm run check` passes
- Existing 58 tests still pass
- Widget renders identical output (verify manually against current build)
- Peak detection runs once per `(file, channel)` combination, not per render

---

## Phase 2 — SizeLadder + SizeCalibration

**Goal:** Introduce the size calibration concept with a basic algorithm. Start
with piecewise linear interpolation. No UI changes yet.

### Deliverables

- `src/domain/size-ladder.ts`:
  - `interface SizeLadder { readonly name: string; readonly sizes: readonly number[] }`
  - `LADDERS` constant map with pre-defined ladders:
    - `GS500_LIZ` (default) — 16 sizes: `[35, 50, 75, 100, 139, 150, 160, 200, 250, 300, 340, 350, 400, 450, 490, 500]`
    - `GS600_LIZ` — for later, can stub now
    - `GS500_ROX` — for later
- `src/domain/size-calibration.ts` with `SizeCalibration` class:
  - Constructor is private or internal — users call `SizeCalibration.tryBuild(...)`
  - Fields (readonly):
    - `matchedPeaks: readonly { scan: number; bp: number }[]`
    - `minBp: number`, `maxBp: number` — bounds of reliable interpolation
    - `ladder: SizeLadder`
    - `isReliable: boolean` — true if enough peaks matched and residuals low
  - Methods:
    - `scanToBp(scan: number): number | null` — null outside `[minScan, maxScan]`
    - `bpToScan(bp: number): number | null` — null outside `[minBp, maxBp]`
  - Implementation: **piecewise linear** between matched peaks.
    Simple, exact at matched points, no extrapolation.
- `SizeCalibration.tryBuild(standard: Electropherogram, ladder: SizeLadder): SizeCalibration | null`
  - For Phase 2, use a **simple matcher** that assumes detected peak count ==
    ladder size count (or trim to shorter). This is a placeholder — Phase 3
    introduces the robust matcher.
  - Returns null if too few peaks detected (< 5).

### Tests (tests/domain/size-calibration.test.ts)

- **Synthetic tests** (precise control over peak positions):
  - Build a calibration from known (scan, bp) pairs → verify `scanToBp` at exact
    matched points returns the exact bp
  - Verify `scanToBp` at midpoint between two matched peaks returns the linear
    interpolation
  - `bpToScan` is the inverse of `scanToBp` at matched points
  - Out-of-range queries return `null`
- **Real-data tests** against fixture LIZ channel:
  - Build calibration from `DANI_NOV_A11.fsa` LIZ channel with GS500_LIZ ladder
  - Verify `scanToBp` at the first detected peak ≈ 35 bp (smallest ladder size)
    within tolerance (e.g., ±5 bp)
  - Verify monotonicity: higher scans → higher bp
  - Verify isReliable is true for a normal sample
- **Edge cases:**
  - Electropherogram with no peaks → `tryBuild` returns null
  - Very few peaks (below minimum) → returns null or isReliable=false

### Acceptance criteria

- Piecewise linear interpolation verified against known pairs
- Real LIZ data produces a plausible calibration (manually verify against
  ABI-documented standard positions)
- Clear null-handling for out-of-range queries

---

## Phase 3 — Robust peak-to-ladder matching

**Goal:** Replace the simple Phase 2 matcher with a robust algorithm that handles
missing/extra peaks. This is where we spend most of the algorithmic effort.

### The problem

Detected peaks may:
- Be missing (weak signal at certain fragment sizes)
- Have extras (noise, bleed-through, dye blobs)
- Have wrong order only at the boundaries

Rank-order matching fails (we already saw this with auto-align). We need a matcher
that can skip ladder points and reject extra detections.

### Approach: RANSAC-style fit

1. Enumerate candidate matching pairs: pair the first few detected peaks with
   ladder points, trying different skip combinations (bounded by ladder size)
2. For each candidate seed, fit a linear model `bp = a * scan + b` through the seed
3. Use the model to predict where every ladder point should land in scan space
4. Count inliers: detected peaks within tolerance of a predicted ladder position
5. Pick the candidate with the most inliers
6. Refit using only inliers, now as piecewise linear

Alternative (simpler but less robust): **dynamic programming** alignment between
the two sorted sequences, with a skip penalty. We can prototype both and pick.

### Deliverables

- Updated `SizeCalibration.tryBuild` using the robust matcher
- `src/domain/peak-ladder-match.ts` — the matching algorithm, as a pure function
  that returns matched pairs without building a calibration (easier to test in
  isolation)
- Expose the matcher as a testable unit

### Tests (tests/domain/peak-ladder-match.test.ts)

- **Synthetic perfect data:** ladder sizes + realistic scan positions → all
  matched correctly
- **Missing peaks:** remove 2 detected peaks from synthetic data → matcher
  correctly identifies which ladder positions are missing
- **Extra peaks:** insert noise peaks → matcher rejects them as outliers
- **Slightly shifted:** all peaks shifted by a constant → still matches correctly
- **Non-linear distortion:** apply a slight polynomial distortion → still matches
  because we use inlier counting
- **Real data:** run against all 16 example .fsa files' LIZ channels; for each,
  manually document the expected matched count and assert at least N peaks match

### Acceptance criteria

- At least 80% of the example files produce a reliable calibration
- For the 20% that fail, the reason is reported (e.g., "only 4 peaks detected")
- Matching tolerates ±2 missing/extra peaks in typical cases

---

## Phase 4 — CalibratedTrace wrapper

**Goal:** Convenient API for querying signal by base pairs.

### Deliverables

- `src/domain/calibrated-trace.ts` with `CalibratedTrace` class:
  - Constructor: `new CalibratedTrace(trace: Electropherogram, cal: SizeCalibration)`
  - All fields `readonly`
  - Methods:
    - `valueAtBp(bp: number): number | null`
    - `peaksInBp(): readonly (Peak & { bp: number | null })[]` — peaks annotated with bp (null for peaks outside calibrated range)
  - Forwards `scanCount`, `valueAt(scan)` to underlying trace for convenience

### Tests (tests/domain/calibrated-trace.test.ts)

- `valueAtBp(bp)` at a matched ladder position returns the signal at the
  corresponding scan
- `valueAtBp` outside range returns null
- `peaksInBp()` annotates peaks correctly; peaks outside range have bp=null

### Acceptance criteria

- Wrapper composes cleanly — no duplicated logic
- Tests cover both happy path and out-of-range queries

---

## Phase 5 — UI integration

**Goal:** Expose calibration in the UI so the user can switch axes and change
ladders.

### Deliverables

- **Ladder dropdown** in the toolbar. Default: GS500-LIZ. Options list loaded
  from `LADDERS`.
- **Per-widget calibration status.** Small indicator (e.g., ✓ or ⚠) showing
  whether the sample's calibration succeeded. Tooltip shows detected peak count
  and bp range.
- **X axis toggle** in the toolbar: `Scans | bp`. When bp is selected:
  - Widgets whose calibration is reliable show bp-labeled axis
  - Widgets without reliable calibration show the scan axis + a warning
  - Pan/zoom operates in bp units for calibrated widgets
- `App` computes per-sample calibration once (memoized on file + ladder choice)
  and passes `CalibratedTrace` to widgets when bp mode is active.

### Tests

- Mostly manual UI testing at this phase. Possibly add a test for the axis
  toggle state machine if the logic grows complex.

### Acceptance criteria

- User can switch ladder → all widgets re-calibrate
- User can switch axis → visible change, pan/zoom still works
- Clear visual indication when a sample has no calibration

---

## Testing philosophy

- **Use real fixtures.** Every algorithm phase has tests against the
  `tests/fixtures/DANI_NOV_A11.fsa` file (and we should add more representative
  files from `example_abi_files/` covering poor-quality cases).
- **Lock in expected values.** For real-data tests, record specific scan positions
  of matched peaks and specific bp values returned by the calibration. When the
  algorithm changes, these numbers move — that's the signal to either update the
  tests (if the change is an improvement) or revert.
- **Separate synthetic from real.** Synthetic tests verify math correctness
  (interpolation, linear fits). Real-data tests verify integration with messy
  inputs. Both are needed.
- **No mocking of internal modules.** Consistent with the project's testing
  philosophy. The only mockable boundary is filesystem, and we use the real
  fixture files.

## File layout after all phases

```
src/
  abi-parser.ts
  domain/
    electropherogram.ts
    size-ladder.ts
    size-calibration.ts
    peak-ladder-match.ts
    calibrated-trace.ts
  lib/
    render-electropherogram.ts
    peak-detection.ts
    align-peaks.ts
  components/
    App.tsx
    ElectropherogramWidget.tsx
    LadderSelector.tsx       (new)
    AxisToggle.tsx           (new)
    ...
tests/
  domain/
    electropherogram.test.ts
    size-calibration.test.ts
    peak-ladder-match.test.ts
    calibrated-trace.test.ts
  fixtures/
    DANI_NOV_A11.fsa
    (add 2-3 more representative samples)
```

## Rollout order

Each phase can be committed independently:

1. Phase 1 lands alone — refactor only, no features
2. Phase 2 + Phase 3 can land together (calibration + robust matcher) — the
   Phase 2 "simple matcher" is a stepping stone; skip if we go straight to
   Phase 3
3. Phase 4 is small, bundles with Phase 2/3 if convenient
4. Phase 5 is a separate commit (UI-only)

## What's explicitly out of scope

- Non-linear fitting (polynomial, Local Southern). Can add in a later phase if
  piecewise linear proves insufficient.
- Custom user-defined ladders. Dropdown list only, for now.
- Automatic ladder detection from metadata. Future improvement.
- Confidence scoring beyond a simple boolean `isReliable`.

# Fix Review Report — 2026-07-09

Based on: `reports/code-review-2026-07-09.md`

## Summary

Four findings, all fixed as suggested (1 medium, 3 low). No findings deferred.
One new test file added (`tests/components/crosshair-readout.test.ts`, 12 cases).
`npm run check` passes: 154/154 tests (up from 142), tsc and Biome clean.

## Resolutions

### [MEDIUM] Crosshair re-implements the renderer's pixel projection instead of sharing it

**Resolution:** Fixed as suggested
**What was done:** Exported `domainToPixel` and `pixelToDomain` from
`render-electropherogram.ts`. The renderer's `drawScanTrace` and `drawBpTrace`
now call `domainToPixel` instead of the inline formula, and the widget's
`resolveReadout` uses `pixelToDomain` (cursor → domain) and `domainToPixel`
(snapped sample → pixel). The projection now lives in one place, so the renderer
and crosshair cannot drift apart.
**Files changed:** `src/lib/render-electropherogram.ts`,
`src/components/ElectropherogramWidget.tsx`
**Tests added/updated:** yes — `resolveReadout` cases assert the returned `px`
snaps back onto the reported sample (round-trip through the shared projection).
**Check result:** PASS

### [LOW] Overlay is not clipped to the plot rect, so a snapped line can bleed into the padding

**Resolution:** Fixed as suggested
**What was done:** `drawCrosshairOverlay` now clips to the plot rectangle
(`PLOT_LEFT/PLOT_TOP/PLOT_WIDTH/PLOT_HEIGHT`) before drawing the line and
tooltip, matching how the renderer clips its traces. A boundary-snapped line can
no longer render into the axis padding.
**Files changed:** `src/components/ElectropherogramWidget.tsx`
**Tests added/updated:** no — purely visual clipping, no change to computed
values.
**Check result:** PASS

### [LOW] `ctx.roundRect` is a newer canvas API than the rest of the renderer relies on

**Resolution:** Fixed as suggested
**What was done:** Guarded the tooltip box with
`typeof ctx.roundRect === "function"`, falling back to `ctx.rect` (square box) on
browsers that lack `roundRect`, so the readout degrades gracefully instead of
throwing.
**Files changed:** `src/components/ElectropherogramWidget.tsx`
**Tests added/updated:** no — canvas drawing branch, not unit-testable in the
node environment.
**Check result:** PASS

### [LOW] New readout logic is module-private and untested

**Resolution:** Fixed as suggested
**What was done:** Exported `snapToScan` and `resolveReadout` (plus the
`PLOT_LEFT`/`PLOT_WIDTH` geometry the tests need to build a hover pixel) and
added `tests/components/crosshair-readout.test.ts` covering: scan-mode
nearest-sample snapping, no-calibration bp, out-of-range bp omission in both
axis modes, bp-mode round-trip, the unreliable-calibration `~` prefix, the
primary-signal-at-a-bp-derived-scan path, the end-of-trace null guard, and the
degenerate-viewport null guard.
**Files changed:** `src/components/ElectropherogramWidget.tsx`,
`tests/components/crosshair-readout.test.ts` (new)
**Tests added/updated:** yes — 12 new cases.
**Check result:** PASS

## Final check

- `npm run check`: PASS (tsc clean, Biome clean, 154/154 tests pass).

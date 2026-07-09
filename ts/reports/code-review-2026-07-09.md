# Code Review Report — 2026-07-09

## Summary

Reviewed the new hover-crosshair feature added to
`src/components/ElectropherogramWidget.tsx` (commit d3bb2d2) and the
accompanying `src/style.css` overlay-layer rules. The scope is the diff only:
the new pure helpers (`snapToScan`, `resolveReadout`, `drawCrosshairOverlay`),
the `drawCrosshair` callback, the viewport/hover refs, and the mouse-handler
changes.

Found **0 critical, 0 high, 1 medium, 3 low**. The feature is correct and was
verified end-to-end in a real browser (scan and bp modes, on-peak and
off-calibration hovers, drag/leave suppression, right-edge flip). The scan/bp
math is sound and the two axis modes stay consistent with the renderer's own
projection. The concerns are all about maintainability and boundary polish, not
correctness.

## Findings

### [MEDIUM] Crosshair re-implements the renderer's pixel projection instead of sharing it

**File:** `src/components/ElectropherogramWidget.tsx:82,90` (and `PLOT_*` at 15-19)
**Description:** `resolveReadout` maps a domain value to a pixel with
`PLOT_LEFT + ((v - xStart) / xRange) * PLOT_WIDTH`, and inverts it for the
cursor with `xStart + ((hoverX - PLOT_LEFT) / PLOT_WIDTH) * xRange`. These are
hand-copied inverses of the projection that `render-electropherogram.ts` uses
privately in `drawScanTrace`/`drawBpTrace`
(`plotLeft + ((i - xStart) / xRange) * plotWidth`). The two modules also
independently derive the plot rectangle from `PADDING`. Today they agree — the
verification confirmed the crosshair lands exactly on the trace — but nothing
enforces that.
**Impact:** Any future change to how the renderer lays out the plot (an added
inner margin, a different bp projection, DPR-aware scaling, a y-axis width
tweak) will silently desync the crosshair from the trace it annotates. The bug
would be visual-only and easy to miss without a screenshot test.
**Suggested fix:** Export a small projection helper from
`render-electropherogram.ts` (e.g. `domainToPixel(viewport, plotRect, v)` and
its inverse) and have both the renderer and the crosshair consume it, so the
mapping lives in one place.

### [LOW] Overlay is not clipped to the plot rect, so a snapped line can bleed into the padding

**File:** `src/components/ElectropherogramWidget.tsx:108-111`
**Description:** `drawCrosshair` gates on `hoverX` being within
`[PLOT_LEFT, PLOT_RIGHT]`, but the line is drawn at the *snapped* `px`
(`resolveReadout` line 90), which can round a fraction of a pixel past
`PLOT_RIGHT` when the cursor is at the far right edge and `xEnd` is
non-integer. The overlay canvas has no clip region (unlike the renderer, which
clips traces to the plot rect at `render-electropherogram.ts:95-98`), so the
dashed line can render a pixel or two into the 12px right padding.
**Impact:** Cosmetic only — a barely-visible sliver of crosshair outside the
plot area at the right boundary. No incorrect readout.
**Suggested fix:** Clip the overlay to the plot rect before drawing, or clamp
`px` to `[PLOT_LEFT, PLOT_RIGHT]` in `drawCrosshairOverlay`.

### [LOW] `ctx.roundRect` is a newer canvas API than the rest of the renderer relies on

**File:** `src/components/ElectropherogramWidget.tsx:131`
**Description:** The tooltip box uses `ctx.roundRect`, whereas every other
drawing path in the codebase sticks to long-baseline canvas primitives
(`moveTo`/`lineTo`/`fillRect`/`fillText`). `roundRect` is Baseline-2023
(Chrome 99+, Firefox 112+, Safari 16+), so it is fine for the app's stated
"modern browsers" target, but it is the single newest browser API the app
depends on and there is no fallback.
**Impact:** On a browser older than ~2023 the tooltip throws instead of
drawing; a stale-browser user loses the hover readout (the trace still renders).
**Suggested fix:** Either accept it and note the minimum-browser bump, or guard
with a `ctx.roundRect ? … : ctx.rect(…)` fallback to match the conservative
style of the rest of the renderer.

### [LOW] New readout logic is module-private and untested

**File:** `src/components/ElectropherogramWidget.tsx:51-98`
**Description:** `snapToScan` and `resolveReadout` are pure functions that
encode the feature's real logic — nearest-sample snapping, the bp↔scan
round-trip, the "omit Size outside the calibrated range" rule, and the
out-of-range guard. They are neither exported nor covered by any test
(`grep` across `tests/` finds no reference), so this logic is only exercised
by manual/browser checks.
**Impact:** Regressions in the snapping or bp-omission rules (e.g. an
off-by-one at the calibrated boundary, or the `bp ?? domainValue` fallback)
would pass `npm run check` unnoticed.
**Suggested fix:** Export the two pure helpers (they take plain values, not
React state) and add a small Vitest covering: scan-mode snap, bp-mode
round-trip, a hover below `minScan`/above `maxScan` (Size omitted), and the
unreliable-calibration `~` prefix.

## Files reviewed

- `src/components/ElectropherogramWidget.tsx` — full new-code review. Verified:
  `xRange <= 0` and `rect.width === 0` divide-by-zero guards; the
  `scan < 0 || scan >= primary.scanCount` bounds check correctly suppresses the
  crosshair on the short-sample tail of a shared scan domain; bp-mode
  `scanToBp(round(bpToScan(v)))` stays in range with a null-safe `bp` fallback;
  drag/leave/mousedown all null `hoverXRef` so `drawImmediate`'s trailing
  `drawCrosshair()` clears the overlay; readout maps primary-channel signal at
  a standard-derived scan, which is intended. No correctness defects found.
- `src/style.css` — overlay layer (`.canvas-stack` relative, `.overlay-canvas`
  absolute + `pointer-events: none`) correctly stacks the overlay on the base
  canvas without intercepting drag/zoom events. Both canvases inherit
  `width: 100%; height: auto`, so they scale together and stay registered.
- `tests/` — no coverage of the new logic (see LOW above). Existing 142 tests
  unaffected.

## Checks

- `npm run check`: PASS (tsc + Biome clean, 142/142 tests pass).

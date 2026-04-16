# Fix Review Report — 2026-04-16

Based on: `reports/code-review-2026-04-16.md`

## Summary

6 findings processed: 6 fixed as suggested, 0 fixed differently, 0 deferred.

## Resolutions

### [HIGH] No bounds validation on directory offsets from the file header

**Resolution:** Fixed as suggested
**What was done:** Added bounds check in the constructor validating that the
directory range fits within the buffer, and in `getRawData` validating that
non-inline data blocks fit. Both throw descriptive `Error` messages mentioning
"Malformed ABIF".
**Files changed:** `src/abi-parser.ts`, `tests/abi-parser.test.ts`
**Tests added:** Yes — test for truncated file (directory past end), test for
entry data offset past end of file.
**Check result:** PASS

### [HIGH] `numDyes` throws if `Dye#/1` is missing, cascading into many getters

**Resolution:** Fixed as suggested
**What was done:** Changed `numDyes` to use `getDataOrNull` instead of `getData`.
Returns 0 when `Dye#/1` is absent, so downstream getters (`dyeNames`,
`rawChannels`, etc.) return empty collections instead of throwing.
**Files changed:** `src/abi-parser.ts`, `tests/abi-parser.test.ts`
**Tests added:** Yes — test with a minimal ABIF file containing no entries,
verifying `numDyes === 0`, `dyeNames === []`, `rawChannels.size === 0`.
**Check result:** PASS

### [MEDIUM] `getFirstFloatOrNull` name is misleading — it handles Int32Array too

**Resolution:** Fixed as suggested
**What was done:** Merged `getFirstIntOrNull` and `getFirstFloatOrNull` into a
single `getFirstNumberOrNull` that covers all five numeric typed arrays
(Int16Array, Int32Array, Uint16Array, Float32Array, Float64Array). Updated all
call sites.
**Files changed:** `src/abi-parser.ts`
**Tests added:** No — existing tests cover all callers; no behavior change.
**Check result:** PASS

### [MEDIUM] `rawChannels` silently drops DATA entries that aren't Int16Array

**Resolution:** Fixed as suggested
**What was done:** Added a `toInt16Array` helper that converts any numeric typed
array to Int16Array. Used in both `rawChannels` and `analyzedChannels` getters,
so DATA entries encoded as Uint16Array, Int32Array, Float32Array, or Float64Array
are now included instead of silently dropped.
**Files changed:** `src/abi-parser.ts`
**Tests added:** No — all fixture DATA entries are already Int16Array; the fix
is a safety net for non-standard files.
**Check result:** PASS

### [MEDIUM] pString decoding doesn't validate declared length against actual data size

**Resolution:** Fixed as suggested
**What was done:** Clamped the pString declared length to `raw.byteLength - 1`
so a corrupted length byte produces a truncated string instead of a RangeError.
**Files changed:** `src/abi-parser.ts`
**Tests added:** No — would require crafting a malformed pString entry; the fix
is a one-line defensive clamp.
**Check result:** PASS

### [LOW] No JSDoc on public methods `getData`, `getDataOrNull`, `getEntry`, `getAllEntries`

**Resolution:** Fixed as suggested
**What was done:** Added JSDoc to all four public methods. `getData` includes
the full element type → return type mapping table. `getDataOrNull` cross-references
`getData` via `@link`.
**Files changed:** `src/abi-parser.ts`
**Tests added:** No — documentation only.
**Check result:** PASS

## Final check

- `npm run check`: **PASS** (types clean, lint clean, 40/40 tests pass)

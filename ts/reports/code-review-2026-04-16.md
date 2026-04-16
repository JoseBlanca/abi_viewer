# Code Review Report — 2026-04-16

## Summary

Reviewed `src/abi-parser.ts` (405 lines) and `tests/abi-parser.test.ts` (227 lines).
Found 0 critical issues, 2 high, 3 medium, 1 low. The parser is correct for
well-formed files. The main concerns are around robustness with malformed input
and some naming/type issues in convenience getters.

## Findings

### [HIGH] No bounds validation on directory offsets from the file header

**File:** `src/abi-parser.ts:184-188`
**Description:** The constructor reads `root.dataOffset` and `root.numElems`
from the binary header and uses them directly to index into the buffer without
checking that `root.dataOffset + root.numElems * 28` fits within
`buffer.byteLength`. A malformed file with a corrupted header (e.g., dataOffset
pointing past end of file, or numElems set to a huge value) will throw a
`RangeError` from `DataView` with the message "Offset is outside the bounds of
the DataView" — which gives no indication that the ABIF file is malformed.

The same applies to `getRawData` at line 88: if an entry's `dataOffset + dataSize`
exceeds the buffer length, the DataView constructor throws a generic RangeError.

**Impact:** Users who load a truncated or corrupted .fsa file get an unhelpful
JavaScript runtime error instead of a clear "malformed ABIF file" message.

**Suggested fix:** Validate before reading:
```ts
const dirEnd = root.dataOffset + root.numElems * DIR_ENTRY_SIZE;
if (dirEnd > buffer.byteLength) {
  throw new Error(`Malformed ABIF: directory extends past end of file (offset ${dirEnd}, file size ${buffer.byteLength})`);
}
```
Apply a similar check in `getRawData` for non-inline data.

---

### [HIGH] `numDyes` throws if `Dye#/1` is missing, cascading into many getters

**File:** `src/abi-parser.ts:248-252`
**Description:** `numDyes` calls `this.getData("Dye#", 1)`, which throws if the
entry doesn't exist. Many other getters depend on `numDyes`: `dyeNames`,
`dyeWavelengths`, `rawDataTags`, `rawChannels`, `analyzedChannels`. A file
without a `Dye#` tag (possible with some older or non-standard ABIF producers)
causes a cascade of unhelpful `"Entry not found: Dye#/1"` errors from seemingly
unrelated getters.

**Impact:** Accessing `rawChannels` on a file without `Dye#/1` throws with a
confusing error pointing at the wrong getter.

**Suggested fix:** Use `getDataOrNull` and return 0 (or throw a specific error
explaining the file lacks required dye count metadata):
```ts
get numDyes(): number {
  const value = this.getDataOrNull("Dye#", 1);
  if (value instanceof Int16Array) return value[0] ?? 0;
  return 0;
}
```

---

### [MEDIUM] `getFirstFloatOrNull` name is misleading — it handles Int32Array too

**File:** `src/abi-parser.ts:236-246`
**Description:** The private method is named `getFirstFloatOrNull` but its type
check includes `Int32Array`. It's used for `numScans` (SCAN/1, elem type 5 =
int32), `injectionVoltage` (InVt/1, type 5), and `injectionTime` (InSc/1,
type 5) — none of which are floats. The method works correctly, but the name
suggests it only handles floating-point data.

**Impact:** A developer reading the code will assume SCAN/InVt/InSc are
float-encoded fields, which is wrong — they're integers. This leads to confusion
when maintaining or extending the parser.

**Suggested fix:** Rename to `getFirstNumberOrNull` and include all numeric typed
arrays (Int16Array, Uint16Array, Int32Array, Float32Array, Float64Array).

---

### [MEDIUM] `rawChannels` silently drops DATA entries that aren't Int16Array

**File:** `src/abi-parser.ts:297-310`
**Description:** The getter decodes each DATA tag and checks
`value instanceof Int16Array`. If a file contains raw channel data encoded as a
different type (e.g., type 3 = Uint16Array, type 5 = Int32Array), the channel
is silently omitted from the map. The same issue applies to `analyzedChannels`
at line 313-325.

**Impact:** No error is raised — `rawChannels.size` would simply be less than
`numDyes`, and downstream code (like a gel renderer) would get fewer channels
than expected with no explanation.

**Suggested fix:** Either convert all numeric arrays to a common type (e.g.,
`Float64Array` or plain `number[]`), or throw an error if a DATA entry decodes
to an unexpected type.

---

### [MEDIUM] pString decoding doesn't validate declared length against actual data size

**File:** `src/abi-parser.ts:116-118`
**Description:** `decodeStringEntry` reads `raw.getUint8(0)` as the Pascal
string length, then creates `new Uint8Array(raw.buffer, raw.byteOffset + 1, length)`.
If a corrupted file declares a pString length larger than `raw.byteLength - 1`,
the Uint8Array constructor throws a generic RangeError.

**Impact:** Same as the bounds issue above — an unhelpful error message for
corrupted files.

**Suggested fix:** Clamp the length:
```ts
const length = Math.min(raw.getUint8(0), raw.byteLength - 1);
```

---

### [LOW] No JSDoc on public methods `getData`, `getDataOrNull`, `getEntry`, `getAllEntries`

**File:** `src/abi-parser.ts:191-213`
**Description:** The four public methods of `AbifFile` that form the low-level
API have no documentation. `getData` and `getDataOrNull` return `AbifValue`,
which is a union of 10 types — callers need guidance on which type to expect for
which element type code.

**Impact:** Users of the parser must read the source to understand the return
type mapping. The Python version had a docstring listing all type mappings.

**Suggested fix:** Add a JSDoc comment to `getData` listing the element type →
return type mapping, similar to the Python parser's docstring.

---

## Files reviewed

- `src/abi-parser.ts` — full line-by-line review: types, parsing functions,
  class API, convenience getters, type guards
- `tests/abi-parser.test.ts` — reviewed for coverage gaps. Tests are thorough
  for the happy path (37 tests). No tests for malformed/truncated files beyond
  "too small" and "wrong magic". No tests for zero-element entries or entries
  with unexpected types.

## Checks

- `npm run check`: **PASS** (types clean, lint clean, 37/37 tests pass)

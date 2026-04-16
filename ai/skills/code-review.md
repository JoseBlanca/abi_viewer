# Skill: Code Review

Perform a thorough code review of the TypeScript codebase, looking for real
problems: bugs, edge cases, type safety gaps, and code smells. Write a
severity-rated report to the `reports/` directory.

## What to look for

### Critical — Bugs and data corruption

- **Off-by-one errors** in binary parsing (wrong offsets, wrong byte counts)
- **Endianness mistakes** (DataView defaults to big-endian only when you pass no
  second argument; check every call)
- **Buffer overflows** — reading past the end of an ArrayBuffer or DataView
- **Integer overflow / truncation** — JavaScript numbers lose precision above
  2^53; typed arrays silently truncate
- **Unchecked index access** — accessing array or typed array elements without
  bounds checking (`arr[i]` returns `undefined` with `noUncheckedIndexedAccess`,
  which is correct — but verify callers handle it)
- **Shared ArrayBuffer aliasing** — multiple DataViews or typed arrays pointing
  at the same buffer can cause subtle bugs if one mutates it

### High — Edge cases and robustness

- **Malformed input handling** — what happens with truncated files, zero-length
  data, unexpected element types, corrupted directory entries?
- **Empty collections** — empty arrays, maps with no entries, zero-length strings
- **Boundary values** — maximum/minimum values for typed arrays (Int16: -32768
  to 32767), zero-element entries, single-element entries
- **Null/undefined propagation** — does `getDataOrNull` → downstream getter
  chain handle null at every step?
- **Error messages** — are they specific enough to diagnose the problem?

### Medium — TypeScript code smells

- **Type narrowing gaps** — places where the type system can't prove safety and
  the code uses `!`, `as`, or ignores `undefined`
- **Implicit `any`** — should be caught by strict config, but verify
- **Dead code** — unused exports, unreachable branches
- **Naming inconsistencies** — does naming follow conventions (camelCase functions,
  PascalCase types, kebab-case files)?
- **Missing `readonly`** — mutable fields or parameters that should be immutable
- **Overly broad types** — function parameters typed as `number` when they should
  be a narrower type; return types that are wider than necessary
- **Excessive coupling** — functions that know too much about the internals of
  other modules

### Low — Style and maintainability

- **Magic numbers** — unexplained numeric literals
- **Long functions** — functions that do too many things
- **Missing JSDoc on public API** — exported functions/classes without
  documentation
- **Inconsistent patterns** — doing the same thing differently in different places

## What NOT to flag

- **Stylistic preferences** already handled by Biome (formatting, import order)
- **Missing features** — the review is about what exists, not what's missing
- **Test code quality** — unless a test is actually wrong or misleading
- **Performance** — unless it's a clear algorithmic problem (O(n²) where O(n)
  is trivial), not micro-optimizations

## Review procedure

1. **Read every source file** in `src/` carefully, line by line.
2. **Read every test file** in `tests/` to understand what is and isn't tested.
3. **Cross-reference**: for each edge case you identify in the source, check
   whether the tests cover it.
4. **Check the build**: run `npm run check` and note any failures.
5. **Trace data flows**: follow a binary file from input through parsing to
   the public API. Look for places where data could be wrong.

## Report format

Write the report to `reports/code-review-YYYY-MM-DD.md` using this template:

```markdown
# Code Review Report — YYYY-MM-DD

## Summary

<2-3 sentence overview: what was reviewed, how many issues found by severity>

## Findings

### [CRITICAL] Title of finding

**File:** `src/file.ts:NN`
**Description:** What the problem is, concretely.
**Impact:** What goes wrong if this is not fixed.
**Suggested fix:** How to fix it (brief, not a full implementation).

### [HIGH] Title of finding

(same structure)

### [MEDIUM] Title of finding

(same structure)

### [LOW] Title of finding

(same structure)

## Files reviewed

- `src/file1.ts` — (brief note on what was checked)
- `tests/file1.test.ts` — (coverage gaps noted)

## Checks

- `npm run check`: PASS / FAIL (details if fail)
```

**Rules for the report:**
- One finding per issue — don't bundle unrelated problems.
- Every finding must include a specific file and line number.
- Every finding must explain the **impact**, not just the smell.
- If you find zero critical issues, say so explicitly — don't inflate severity.
- Order findings by severity (critical first), then by file.

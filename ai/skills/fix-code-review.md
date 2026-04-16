# Skill: Fix Code Review Findings

Work through the findings in a code review report, applying fixes one at a time.
For each finding, decide whether to fix as suggested, fix differently, or defer.
Write a resolution report when done.

## Procedure

1. **Read the code review report** from `reports/`.
2. **Read the source files** referenced by the findings.
3. **Process each finding** in severity order (critical first), one at a time:

   For each finding, present the user with:
   ```
   ### [SEVERITY] Title
   File: path:line
   Problem: (one sentence)
   Suggested fix: (brief)

   Options:
   a) Fix as suggested
   b) Fix differently — (describe alternative if you have one)
   c) Defer — needs user input because: (reason)
   ```

   Wait for the user to choose before proceeding. Do NOT batch fixes or
   assume the user wants all suggestions applied.

4. **Apply the chosen fix:**
   - Edit the source file.
   - If the fix changes behavior, add or update tests to cover it.
   - Run `npm run check` after each fix to verify nothing broke.
   - If the check fails, fix the failure before moving to the next finding.

5. **After all findings are processed**, write the resolution report.

## Fix guidelines

- **Minimal diffs.** Fix exactly the finding, don't refactor surrounding code.
- **Preserve the public API.** Don't rename exported types, functions, or
  methods unless the finding specifically calls for it. Internal/private
  renames are fine.
- **Tests for behavior changes.** If a fix changes what happens with malformed
  input (e.g., a new validation check), add a test that triggers the new path.
- **Don't fix what isn't broken.** If the report says "Low" and the user says
  defer, move on. Don't sneak in improvements.

## Resolution report format

Write to `reports/fix-review-YYYY-MM-DD.md`:

```markdown
# Fix Review Report — YYYY-MM-DD

Based on: `reports/code-review-YYYY-MM-DD.md`

## Summary

<How many findings: fixed as suggested, fixed differently, deferred>

## Resolutions

### [SEVERITY] Title of finding

**Resolution:** Fixed as suggested / Fixed differently / Deferred
**What was done:** (1-2 sentences describing the change, or why deferred)
**Files changed:** `src/file.ts`, `tests/file.test.ts`
**Tests added/updated:** (yes/no, brief description)
**Check result:** PASS / FAIL

(repeat for each finding)

## Final check

- `npm run check`: PASS / FAIL
```

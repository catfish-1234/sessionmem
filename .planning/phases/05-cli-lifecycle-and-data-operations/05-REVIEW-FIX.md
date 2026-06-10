---
phase: 05-cli-lifecycle-and-data-operations
fixed_at: 2026-06-09T19:30:00Z
review_path: .planning/phases/05-cli-lifecycle-and-data-operations/05-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-06-09T19:30:00Z
**Source review:** .planning/phases/05-cli-lifecycle-and-data-operations/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: `statsCommand` crashes with `ENOENT`/`EISDIR` for non-regular-file `dbPath`

**Files modified:** `src/cli/commands/stats.ts`
**Commit:** 02d96e0
**Applied fix:** Wrapped `statSync(context.dbPath).size` in a try/catch that defaults `sizeBytes` to `0` when the path is `:memory:` or the file no longer exists, restoring the clean error/no-crash contract used by other commands.

### WR-01: `run.ts` silently swallows all log-write errors, including structural ones

**Files modified:** `src/cli/commands/run.ts`
**Commit:** 36318d7
**Applied fix:** Imported `mkdirSync`, created `~/.sessionmem/logs/` (the actual log directory) with `{ recursive: true }` before the first write, and replaced the unused `catch (err) {}` with a bare `catch {}` carrying an explanatory comment, removing the dead binding while keeping the best-effort logging behavior.

### WR-02: `importCommand` with `--merge` always reports `skipped 0 duplicates`

**Files modified:** `src/cli/commands/import.ts`, `tests/integration/cli/export-import.spec.ts`
**Commit:** fe0661a
**Applied fix:** When `options.merge` is set, the command now prints `Imported (merged) N memories.` instead of the misleading `Imported N, skipped 0 duplicates.` message. Updated the corresponding integration test assertion in `export-import.spec.ts` (the `--merge` round-trip test) to check for the new `"Imported (merged)"` message instead of `"skipped 0 duplicates"`.

### WR-03: `importCommand` casts raw JSON fields with `as` instead of validating per-record

**Files modified:** `src/cli/commands/import.ts`
**Commit:** 18e8b67
**Applied fix:**
- Fixed the duplicate-ID pre-filter (`!options.merge` branch) to safely check `typeof r.id === "string"` before consulting the `existingIds` set, instead of blindly casting `r.id as string` (which previously let records with a missing/non-string `id` slip through as "not a duplicate").
- Extracted the per-record field mapping into a `mapped` array, then validated each mapped record with `importMemoryRecordSchema.safeParse()` in a loop before calling `service.call("importMemories", ...)`. On the first invalid record, prints `Record at index {i} is invalid: {zod message}` and exits with code 1 — giving actionable, index-level feedback instead of an opaque `memories[N].id: Required`-style error surfaced from deep inside the service call.
- Note: this finding involves validation/logic changes (not pure syntax) — flagged as `requires human verification` per the verification strategy's logic-bug guidance, since Tier 1/2 checks confirm structure but not full semantic correctness across all edge cases (e.g., records with extra/unexpected fields, `projectId` defaulting interaction with validation order).

**Status: fixed: requires human verification**

### WR-04: `cliTestContext.ts` leaks temp DB files and open handles — no cleanup

**Files modified:** `tests/helpers/cliTestContext.ts`, `tests/unit/cli/stats.spec.ts`, `tests/unit/cli/error-contract.spec.ts`, `tests/integration/cli/forget.spec.ts`, `tests/integration/cli/search.spec.ts`, `tests/integration/cli/data-commands.spec.ts`, `tests/integration/cli/export-import.spec.ts`
**Commit:** 38ccb73
**Applied fix:**
- `createTestCliContext()` now returns a populated `cleanup()` function that calls `db.close()` and unlinks the temp DB file plus its `-wal`/`-shm` sidecar files (each unlink wrapped in try/catch and ignored on failure).
- In every consuming spec file (7 files, ~20 `it()` blocks across 6 `describe()` blocks), changed `const ctx = await createTestCliContext()` to assign a `describe`-scoped `let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined` variable, and added `ctx?.cleanup?.(); ctx = undefined;` to each existing `afterEach`.
- In `export-import.spec.ts`'s "lossless round-trip" test, also captured the manually-constructed `freshDb` (`openDb()` for the fresh in-memory context) in a `let freshDb` and added `freshDb?.close()` in the `finally` block, since that context is built outside `createTestCliContext` and has no `cleanup` of its own.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-06-09T19:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

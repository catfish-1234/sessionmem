---
phase: 05-cli-lifecycle-and-data-operations
reviewed: 2026-06-09T19:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - scripts/copy-migrations.mjs
  - src/cli/commands/export.ts
  - src/cli/commands/forget.ts
  - src/cli/commands/import.ts
  - src/cli/commands/list.ts
  - src/cli/commands/ping.ts
  - src/cli/commands/run.ts
  - src/cli/commands/search.ts
  - src/cli/commands/show.ts
  - src/cli/commands/stats.ts
  - src/cli/commands/uninstall.ts
  - src/cli/context.ts
  - src/cli/index.ts
  - src/cli/output.ts
  - src/core/api/contracts.ts
  - src/core/embed/deterministicEmbed.ts
  - src/core/injection/formatStartupInjection.ts
  - tests/helpers/cliTestContext.ts
  - tests/integration/cli/data-commands.spec.ts
  - tests/integration/cli/export-import.spec.ts
  - tests/integration/cli/forget.spec.ts
  - tests/integration/cli/install.spec.ts
  - tests/integration/cli/search.spec.ts
  - tests/integration/cli/uninstall.spec.ts
  - tests/unit/cli/context.spec.ts
  - tests/unit/cli/error-contract.spec.ts
  - tests/unit/cli/output.spec.ts
  - tests/unit/cli/stats.spec.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-06-09T19:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

This re-review focuses on (1) verifying the gap-closure plan 05-05 (commits e5bbd2b, 3759cac) correctly fixed the commander ctx-collision BLOCKER from the prior VERIFICATION.md, and (2) confirming whether issues from the prior 05-REVIEW.md (status: issues_found, 2026-06-09T00:00:00Z) remain unresolved.

**Gap-closure verification: PASS.** `src/cli/index.ts` now arrow-wraps all seven previously-affected `.action()` registrations (`search`, `list`, `show`, `forget`, `export`, `import`, `stats`), forwarding only the real positional args/options and dropping commander's injected trailing `Command` object. Each command's `ctx?: CliContext` parameter is therefore left `undefined` in production and correctly falls through to `createCliContext()`. `searchCommand`'s `coerceLimit()` helper now correctly handles commander's string `--limit` value (CR-01 from the prior review is resolved). The `SESSIONMEM_DB_PATH` / `SESSIONMEM_PROJECT_ID` env-override seam added to `context.ts` is scoped correctly (operator-controlled, defaults preserved).

**However, four of the five non-CR-01 items from the prior review (CR-02, WR-01, WR-02, WR-03, WR-04, IN-01, IN-02) were NOT addressed by 05-05** — `git log` confirms `stats.ts`, `run.ts`, `import.ts`, `export.ts`, `ping.ts`, and `tests/helpers/cliTestContext.ts` have not been modified since their original Wave 3/4 commits. These findings are restated below (renumbered) since they remain valid defects in the current codebase. CR-02 (stats.ts crashes on non-file dbPath) is restated as a Critical finding because it is a real, reproducible crash path still present in shipped code.

## Critical Issues

### CR-01: `statsCommand` crashes with `ENOENT`/`EISDIR` for non-regular-file `dbPath` (carried over from prior review CR-02 — NOT FIXED)

**File:** `src/cli/commands/stats.ts:17`

**Issue:** `statSync(context.dbPath)` is called unguarded. If `context.dbPath` is `":memory:"` (used directly in `export-import.spec.ts:72` for the round-trip fresh context, and a legitimate value any caller could pass via `CliContextOverrides`), `statSync` throws `ENOENT`. The error propagates out of `statsCommand` uncaught — it bypasses the `console.error` + `process.exit(1)` contract that every other command in this phase honors (D-03), producing an unhandled rejection / raw stack trace instead of a clean error message.

This is also reachable in production: if the DB file is deleted between `openDb()` and `statsCommand` (e.g., a concurrent `sessionmem uninstall --purge` in another terminal), `stats` crashes uncleanly.

**Fix:**
```typescript
// src/cli/commands/stats.ts
let sizeBytes = 0;
try {
  sizeBytes = statSync(context.dbPath).size;
} catch {
  // dbPath may be ":memory:" or the file may have been removed; report 0
}
```

---

## Warnings

### WR-01: `run.ts` silently swallows all log-write errors, including structural ones (carried over — NOT FIXED)

**File:** `src/cli/commands/run.ts:13-17`

**Issue:** The log path is `~/.sessionmem/logs/mcp.log`, but `~/.sessionmem/logs/` is never created (only `~/.sessionmem/` is created by `createCliContext`, and `runMcpServer` doesn't call `createCliContext` at all). The first `writeFileSync(logPath, logMessage, { flag: "a" })` throws `ENOENT`. The bare `catch (err) { /* Ignore */ }` swallows every error type — including `EACCES`, `EMFILE`, etc. — with no logging of what happened, and the unused `err` binding is dead.

**Fix:**
```typescript
import { mkdirSync, writeFileSync } from "fs";
const logDir = join(homedir(), ".sessionmem", "logs");
mkdirSync(logDir, { recursive: true });
try {
  writeFileSync(logPath, logMessage, { flag: "a" });
} catch {
  // best-effort logging; ignore failures
}
```

---

### WR-02: `importCommand` with `--merge` always reports `skipped 0 duplicates` (carried over — NOT FIXED)

**File:** `src/cli/commands/import.ts:38-46, 74-75`

**Issue:** When `--merge` is passed, the `if (!options.merge)` block (lines 38-46) is skipped entirely, so `skippedCount` stays `0` for the whole run. The final message at line 75 unconditionally reads `Imported N, skipped 0 duplicates.` even when every record in the file already existed and was overwritten via upsert. "Skipped 0 duplicates" is misleading for a merge — nothing was "skipped," but framing it as a duplicate count of zero implies no overlap occurred when in fact N records were overwritten.

The integration test `export-import.spec.ts:142` (`expect(logCalls.some((msg) => msg.includes("skipped 0 duplicates")))`) locks in this misleading message as expected behavior.

**Fix:**
```typescript
if (options.merge) {
  console.log(`Imported (merged) ${importedCount} memories.`);
} else {
  console.log(`Imported ${importedCount}, skipped ${skippedCount} duplicates.`);
}
```
(Updating the fix requires updating the integration test assertion at `export-import.spec.ts:142` accordingly.)

---

### WR-03: `importCommand` casts raw JSON fields with `as` instead of validating per-record (carried over — NOT FIXED)

**File:** `src/cli/commands/import.ts:43, 56-66`

**Issue:** Raw `Record<string, unknown>` entries are cast directly to their expected types (`r.id as string`, `r.importance as number`, etc.) before being sent to `service.call("importMemories", ...)`. Two concrete problems:

1. Line 43: `existingIds.has(r.id as string)` — if a record in the import file is missing `id` entirely, `r.id` is `undefined`, and `(undefined as string)` is still `undefined` at runtime. `Set.has(undefined)` returns `false` (assuming no existing memory has `id === undefined`), so the record is never filtered as a duplicate and is passed through to `importMemories`, where `importMemoryRecordSchema`'s `id: z.string().min(1)` will reject it — but only after the misleading `skippedCount` accounting has already run, and the resulting Zod error message (`memories[N].id: Required`) is not user-friendly (no indication of which JSON record/index failed).
2. Lines 56-66: every field is force-cast (`r.kind as string`, `r.content as string`, `r.importance as number`, etc.) with no pre-validation, so type errors in the source JSON surface as raw Zod path errors rather than actionable per-record messages.

**Fix:** Validate each raw record with `importMemoryRecordSchema.safeParse()` before mapping, and report index-level errors:
```typescript
import { importMemoryRecordSchema } from "../../core/api/contracts.js";

for (let i = 0; i < records.length; i++) {
  const check = importMemoryRecordSchema.safeParse(records[i]);
  if (!check.success) {
    console.error(`Record at index ${i} is invalid: ${check.error.message}`);
    process.exit(1);
  }
}
```

---

### WR-04: `cliTestContext.ts` leaks temp DB files and open handles — no cleanup (carried over — NOT FIXED)

**File:** `tests/helpers/cliTestContext.ts:8-55`

**Issue:** `createTestCliContext()` is called by nearly every test file in this phase (search, list/show, forget, export-import, stats, error-contract, context — at least 8 spec files, each with multiple `it()` blocks). Each call opens a new temp-file SQLite DB at `tmpdir()/sessionmem-test-<uuid>.db` via `better-sqlite3` (synchronous, holds an OS handle for process lifetime) and never closes it or deletes the file. The `TestCliContext.cleanup?` field is declared but never populated — it is always `undefined`.

Running the full suite leaves dozens of orphaned `.db` (and `.db-wal`/`.db-shm` if WAL mode is used) files in the OS temp directory and dozens of unclosed file descriptors per test run.

**Fix:**
```typescript
// cliTestContext.ts
import { unlinkSync } from "fs";
// ...
return {
  db, service, projectId, dbPath,
  cleanup: () => {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(dbPath + suffix); } catch { /* ignore */ }
    }
  },
};
```
And add `afterEach(() => ctx?.cleanup?.())` to each consuming spec file (or a global `afterEach` in the test setup).

---

## Info

### IN-01: `export.ts` has a duplicate import from `"path"` (carried over — NOT FIXED)

**File:** `src/cli/commands/export.ts:2-3`

**Issue:**
```typescript
import { homedir } from "os";
import { join } from "path";
import { resolve } from "path";
```
`join` and `resolve` are imported from `"path"` in two separate statements.

**Fix:**
```typescript
import { join, resolve } from "path";
```

---

### IN-02: `searchCommand`'s internal `DEFAULT_LIMIT = 20` is now effectively dead code for the CLI entry path

**File:** `src/cli/commands/search.ts:10, 12-16` and `src/cli/index.ts:51`

**Issue:** `index.ts` registers `--limit <n>` with a string default of `"10"`, so commander always supplies `options.limit = "10"` (or the user's value) — `options.limit` is never `undefined` when invoked via the real CLI. `coerceLimit`'s `if (value === undefined) return DEFAULT_LIMIT;` branch (returning 20) is therefore unreachable except for direct test-injection callers that pass `{}` (e.g. `searchCommand("query", {}, ctx)` in `search.spec.ts`). This produces a discrepancy: CLI users get a default of 10 results, while programmatic/test callers passing no `limit` get 20. This is not a crash, but it is a confusing inconsistency between two "defaults" for the same option that could mislead future maintainers.

**Fix:** Pick one canonical default and apply it consistently — either change `index.ts`'s default to `"20"` to match `DEFAULT_LIMIT`, or remove `DEFAULT_LIMIT`/the `undefined` branch from `coerceLimit` and document that the CLI default lives solely in `index.ts`.

---

_Reviewed: 2026-06-09T19:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

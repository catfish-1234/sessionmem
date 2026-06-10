---
phase: 05-cli-lifecycle-and-data-operations
reviewed: 2026-06-09T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - scripts/copy-migrations.mjs
  - src/cli/context.ts
  - src/cli/output.ts
  - src/cli/index.ts
  - src/cli/commands/uninstall.ts
  - src/cli/commands/ping.ts
  - src/cli/commands/search.ts
  - src/cli/commands/list.ts
  - src/cli/commands/show.ts
  - src/cli/commands/forget.ts
  - src/cli/commands/export.ts
  - src/cli/commands/import.ts
  - src/cli/commands/stats.ts
  - tests/helpers/cliTestContext.ts
  - tests/unit/cli/context.spec.ts
  - tests/unit/cli/output.spec.ts
  - tests/unit/cli/stats.spec.ts
  - tests/unit/cli/error-contract.spec.ts
  - tests/integration/cli/install.spec.ts
  - tests/integration/cli/uninstall.spec.ts
  - tests/integration/cli/search.spec.ts
  - tests/integration/cli/data-commands.spec.ts
  - tests/integration/cli/forget.spec.ts
  - tests/integration/cli/export-import.spec.ts
  - src/cli/commands/run.ts
  - src/core/embed/deterministicEmbed.ts
  - src/core/api/contracts.ts
  - src/core/injection/formatStartupInjection.ts
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-06-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

This phase implements the CLI lifecycle commands (`install`, `uninstall`, `run`, `ping`) and data-operation commands (`search`, `list`, `show`, `forget`, `export`, `import`, `stats`), plus supporting context and output formatters. The architecture is sound: every command routes through a `CliContext` injection seam, error envelopes are propagated cleanly, and the test coverage covers the major happy and sad paths.

Two blockers were found. The most critical is a type mismatch between Commander's string option values and the Zod number validator in `searchCommand`, which causes every real CLI invocation of `search --limit` (including the implicit default) to fail with a validation error. The second blocker is that `stats` performs a `statSync` call on `context.dbPath` without guarding against in-memory databases or non-existent paths, crashing unceremoniously instead of surfacing a structured error.

Four additional warnings cover: a silently masked log-directory creation failure in `run.ts`; inaccurate `--merge` output messaging in `import.ts`; a type-unsafe cast chain in `import.ts` that bypasses Zod validation for individual record fields; and `cliTestContext.ts` having no cleanup path for its temporary DB files.

---

## Critical Issues

### CR-01: `search --limit` always fails — Commander passes string, Zod expects number

**File:** `src/cli/index.ts:42` / `src/cli/commands/search.ts:14`

**Issue:** Commander's `.option("--limit <n>", "Maximum number of results", "10")` always delivers `options.limit` as a string (e.g., `"10"` or `"5"`) regardless of what the user types — no integer parser is registered. In `searchCommand`, that string reaches `service.call("retrieveMemories", { limit: options.limit ?? 20 })`. The `retrieveMemoriesRequestSchema` validates `limit` as `z.number().int()`, which rejects strings (Zod does not coerce by default). The result is a `VALIDATION` error envelope on every real CLI invocation of `sessionmem search <query>` or `sessionmem search <query> --limit 5`.

The TypeScript type annotation `SearchOptions.limit?: number` creates a false sense of safety here; Commander's `.action()` binding is untyped at runtime and the type mismatch is invisible to the compiler.

**Fix:** Add the `parseInt` coercion parser in `index.ts`:
```typescript
// src/cli/index.ts
program
  .command("search <query>")
  .description("Search memories by semantic query")
  .option("--limit <n>", "Maximum number of results", (v) => parseInt(v, 10), 10)
  .action(searchCommand);
```
Change the default from the string `"10"` to the number `10` (no quotes) so the `?? 20` fallback in `searchCommand` also remains consistent. Alternatively, parse inside `searchCommand`:
```typescript
// src/cli/commands/search.ts
limit: typeof options.limit === "string" ? parseInt(options.limit, 10) : (options.limit ?? 20),
```

---

### CR-02: `statsCommand` crashes with `ENOENT` when `dbPath` is `:memory:`

**File:** `src/cli/commands/stats.ts:17`

**Issue:** `statSync(context.dbPath)` throws `ENOENT` when `context.dbPath` is `":memory:"` (or any non-file path). This is precisely the value used in the export/import round-trip integration test (`freshCtx = { ..., dbPath: ":memory:" }`) and would also occur if a caller constructs a `CliContext` with an in-memory database for any other reason. When it throws, the error propagates out of `statsCommand` without the clean `console.error` + `process.exit(1)` contract every other command honors, producing an uncaught stack trace instead.

Even in production, `statSync` can legitimately throw if the file has been deleted between `openDb` and `statsCommand` (e.g., `--purge` in one terminal, `stats` in another). No error handling wraps the call.

**Fix:**
```typescript
// src/cli/commands/stats.ts
let sizeBytes = 0;
try {
  sizeBytes = statSync(context.dbPath).size;
} catch {
  // dbPath is :memory: or file was removed; report 0
}
```
If strict accuracy is required, surface it as a structured warning:
```typescript
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Warning: could not stat DB file: ${msg}`);
}
```

---

## Warnings

### WR-01: `run.ts` silently swallows all log-write errors, including structural ones

**File:** `src/cli/commands/run.ts:13-17`

**Issue:** The log path is `~/.sessionmem/logs/mcp.log` but the `logs/` subdirectory is never created (only `~/.sessionmem/` is created in `createCliContext`). On first run the `writeFileSync` call will throw `ENOENT`. The bare `catch (err) { // Ignore }` block swallows every error — including unrelated ones like `EMFILE` (too many open files) or permission errors — making the failure completely invisible.

More importantly, the comment `// Ignore if log dir doesn't exist yet` documents intent to ignore one specific case but the implementation ignores all cases. If this is extended later to write meaningful data, silent failure will be very hard to debug.

**Fix:** Either create the directory before writing, or tighten the catch:
```typescript
// Option A: create the directory
import { mkdirSync } from "fs";
const logDir = join(homedir(), ".sessionmem", "logs");
mkdirSync(logDir, { recursive: true });
writeFileSync(logPath, logMessage, { flag: "a" });

// Option B: narrow the swallowed error
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
    // Re-throw unexpected errors
    throw err;
  }
}
```

---

### WR-02: `importCommand` with `--merge` reports misleading `skipped 0 duplicates`

**File:** `src/cli/commands/import.ts:74-75`

**Issue:** When `--merge` is passed, the pre-filter step is skipped entirely and `skippedCount` stays at `0`. The final log line always reads `Imported N, skipped 0 duplicates.` even when all N records already existed and were overwritten. The word "skipped" is semantically wrong for a merge operation; the user has no way to distinguish "nothing existed" from "everything was overwritten."

The integration test at `export-import.spec.ts:142` asserts `msg.includes("skipped 0 duplicates")` — it passes, but it is testing incorrect behavior.

**Fix:**
```typescript
// src/cli/commands/import.ts
if (options.merge) {
  console.log(`Imported (merged) ${importedCount} memories.`);
} else {
  console.log(`Imported ${importedCount}, skipped ${skippedCount} duplicates.`);
}
```

---

### WR-03: `importCommand` casts raw JSON fields with `as` rather than validating them

**File:** `src/cli/commands/import.ts:56-66`

**Issue:** All fields from the raw `Record<string, unknown>` records are cast to their expected types with `as string`, `as number`, etc., before being passed to `service.call("importMemories", ...)`. This means validation by `importMemoryRecordSchema` in the service only runs after the cast — if the JSON file contains, for example, `{ "importance": "high" }`, the cast `r.importance as number` produces the string `"high"` typed as `number`, which then reaches the Zod schema. Zod will reject it and return an error envelope, which is handled, so no crash occurs.

However, `r.id as string` will be `undefined` if `id` is missing, producing `undefined as string` = `undefined`, which Zod rejects with `z.string().min(1)`. The error message will be the internal Zod path (`memories[0].id`) rather than a user-friendly "record at index 0 is missing required field 'id'". This is a poor user experience but not a data-loss risk because the validation does fire.

The deeper concern: the cast `(r.projectId as string) ?? context.projectId` evaluates `r.projectId as string` first — if `r.projectId` is `null` (valid JSON), `null as string` is `null`, and `?? context.projectId` correctly substitutes. But if a future refactor changes the order of operations or the cast, silent wrong-projectId assignment becomes possible.

**Fix:** Validate the raw records with `importMemoryRecordSchema` per-record before mapping, and report index-level errors to the user:
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
This removes the need for all the `as` casts downstream.

---

### WR-04: `cliTestContext.ts` leaks temporary DB files — no cleanup mechanism

**File:** `tests/helpers/cliTestContext.ts:16-55`

**Issue:** `createTestCliContext` creates a temp file at `tmpdir()/sessionmem-test-<uuid>.db` on every call. The returned `TestCliContext` defines a `cleanup?` optional field on the interface but never populates it — the field is always `undefined`. Tests that call `createTestCliContext` do not close `db` or delete the temp file.

On a CI machine running the full test suite, this will accumulate hundreds of open SQLite file handles and orphaned temp files per run. `better-sqlite3` databases are synchronous and hold an OS file lock for the process lifetime. If the test runner spawns workers, the handles multiply.

**Fix:** Populate the cleanup function and call it in `afterEach`:
```typescript
// In cliTestContext.ts
return {
  db,
  service,
  projectId,
  dbPath,
  cleanup: () => {
    db.close();
    try { unlinkSync(dbPath); } catch { /* ignore */ }
  },
};

// In test files
afterEach(() => {
  ctx?.cleanup?.();
});
```

---

## Info

### IN-01: `export.ts` has a duplicate `import { resolve } from "path"` import

**File:** `src/cli/commands/export.ts:2-3`

**Issue:** Both `join` and `resolve` are imported from `"path"` on separate lines. They should be combined into one destructured import.

```typescript
// Current (lines 2-3):
import { join } from "path";
import { resolve } from "path";

// Fix:
import { join, resolve } from "path";
```

---

### IN-02: `ping.ts` outputs success fields before checking status — creates inconsistent exit behavior

**File:** `src/cli/commands/ping.ts:6-10`

**Issue:** The `status`, `version`, and `message` fields are printed unconditionally to `stdout` before the `if (result.status !== "ok")` check. If the ping fails, both the `console.log` output on stdout and the `console.error` message on stderr are emitted, which is confusing for consumers parsing the output. The success fields should not be printed if the command is about to exit with code 1.

This is a minor UX issue; the current `pingTool` always returns `"ok"` so it does not surface in tests.

**Fix:**
```typescript
export async function pingCommand(): Promise<void> {
  const result = await pingTool.execute();

  if (result.status !== "ok") {
    console.error(`sessionmem ping failed: ${result.message}`);
    process.exit(1);
  }

  console.log(`status: ${result.status}`);
  console.log(`version: ${result.version}`);
  console.log(`message: ${result.message}`);
}
```

---

_Reviewed: 2026-06-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

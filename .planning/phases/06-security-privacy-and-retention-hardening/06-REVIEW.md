---
phase: 06-security-privacy-and-retention-hardening
reviewed: 2026-06-10T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - docs/privacy-and-retention.md
  - src/cli/commands/config.ts
  - src/cli/commands/import.ts
  - src/cli/commands/install.ts
  - src/cli/commands/redactScan.ts
  - src/cli/commands/retention.ts
  - src/cli/commands/stats.ts
  - src/cli/context.ts
  - src/cli/index.ts
  - src/core/api/contracts.ts
  - src/core/api/memoryCoreService.ts
  - src/core/api/sessionLifecycleService.ts
  - src/core/config/policyConfig.ts
  - src/core/storage/memoryRepo.ts
  - src/core/summarize/redaction.ts
  - tests/integration/cli/config-command.spec.ts
  - tests/integration/cli/install.spec.ts
  - tests/integration/cli/redact-scan.spec.ts
  - tests/integration/cli/retention-prune.spec.ts
  - tests/integration/core/redact-existing.spec.ts
  - tests/integration/core/redaction-write-paths.spec.ts
  - tests/integration/core/retention-prune.spec.ts
  - tests/integration/core/secret-leakage.spec.ts
  - tests/integration/core/session-end-auto-prune.spec.ts
  - tests/integration/docs/privacy-docs.spec.ts
  - tests/unit/cli/stats.spec.ts
  - tests/unit/core/policy-config.spec.ts
  - tests/unit/core/prune-memories.spec.ts
  - tests/unit/core/redaction-rules.spec.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-06-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

The redaction rule set, retention pruning queries, and policy config read/write
paths are well-engineered: SQL is parameterized, the redaction regexes are
ordered to avoid partial-secret leakage, retention defaults fail safe
(retentionDays<=0 disables pruning, malformed config falls back to defaults),
and the CLI surfaces (`config`, `retention prune`, `redact-scan`) are
dry-run-by-default with good test coverage.

However, two issues undermine the core privacy claim documented in
`docs/privacy-and-retention.md`:

1. The `redactionEnabled` setting in `~/.sessionmem/config.json` is **never
   consulted** by the actual write paths (`storeMemory`, `importMemories`,
   `handleSessionEnd`) — only `stats` reads it for display. `config set
   redactionEnabled false` silently has no effect on redaction behavior,
   directly contradicting the documented guarantee that "[t]he same
   `redactionEnabled` flag governs every path" and that disabling it "turns
   redaction off across all write paths."

2. `importMemories` uses `ON CONFLICT(id) DO UPDATE SET project_id =
   excluded.project_id, ...` against a globally-unique `id` primary key, while
   `import.ts`'s default duplicate-skip only checks IDs within the *current*
   project. An import file containing an `id` that collides with another
   project's memory will silently overwrite and reassign that memory to the
   importing project — a cross-project data-isolation gap.

Additionally, `retentionDays` has no upper-bound validation in `config set`,
so a large value can produce an `Invalid Date` / `RangeError` when computing
the prune cutoff, breaking `retention prune` until the value is reset (the
session-end light prune is unaffected because it swallows the error).

## Critical Issues

### CR-01: `redactionEnabled` policy-config setting is not wired to any write path

**File:** `src/cli/commands/import.ts:84-87`, `src/core/api/memoryCoreService.ts:248-251,400-402`, `src/core/api/sessionLifecycleService.ts:221`

**Issue:**
`docs/privacy-and-retention.md` states (lines 13, 36, 122, 138):
- "The same `redactionEnabled` flag governs every path. It defaults to **on** (`true`)."
- "Setting `redactionEnabled` to `false` turns redaction off across all write paths."
- `sessionmem config set redactionEnabled false` is documented as the way to do this.

In practice:
- `src/core/config/policyConfig.ts` defines `readPolicyConfig()` /
  `resolvePolicySettings()` for `redactionEnabled`, and `config set
  redactionEnabled false` correctly persists `{"redactionEnabled": false}` to
  `~/.sessionmem/config.json`.
- But none of the actual write-path call sites read this file:
  - `import.ts:86` hardcodes `redactionEnabled: true` in the
    `importMemories` request, regardless of `config.json`.
  - `memoryCoreService.storeMemory` (line 248-251) and `importMemories`
    (line 400-402) take `redactionEnabled` straight from the parsed request
    (zod default `true` per `storeMemoryRequestSchema` /
    `importMemoriesRequestSchema`), with no fallback to
    `readPolicyConfig()`.
  - `sessionLifecycleService.handleSessionEnd` takes `redactionEnabled` from
    `request.config.redactionEnabled` (zod default `true` per
    `handleSessionEndConfigSchema`), again never consulting
    `~/.sessionmem/config.json`.
- The only consumer of `policyConfig.redactionEnabled` in the reviewed files
  is `stats.ts`, which merely *displays* "Redaction: enabled/disabled" — a
  cosmetic readout that does not reflect actual write-path behavior.

Net effect: a user who runs `sessionmem config set redactionEnabled false`
(per the documented workflow) will see `stats` report "Redaction: disabled",
but every memory write (manual store via MCP `storeMemory`, `import`,
auto-summarize) will continue to redact secrets — or, if any caller upstream
(MCP tool layer, outside this file set) ever explicitly threads `false`
through unconditionally, the opposite mismatch could occur. Either way,
`config.json`'s `redactionEnabled` is dead configuration for the write paths,
which is a privacy-control correctness bug given this is the central control
documented in this phase.

**Fix:**
Thread `readPolicyConfig(configFilePath()).redactionEnabled` (via
`resolvePolicySettings`, mirroring how `retentionDays` is resolved in
`retention.ts` and `sessionLifecycleService.ts`) into the effective
`redactionEnabled` value used by `storeMemory`, `importMemories`, and
`handleSessionEnd`, with the existing per-request value (if explicitly
supplied) taking precedence per the documented override > config > default
order. For `import.ts` specifically:

```ts
import { configFilePath, readPolicyConfig } from "../../core/config/policyConfig.js";

// ...
const { redactionEnabled } = readPolicyConfig(configFilePath());

const result = await context.service.call("importMemories", {
  projectId: context.projectId,
  redactionEnabled,
  memories: mapped,
});
```

And similarly resolve `redactionEnabled` from policy config inside
`memoryCoreService.storeMemory` / `importMemories` and
`sessionLifecycleService.handleSessionEnd` before calling `applyRedaction`,
unless the request explicitly overrides it.

---

### CR-02: Cross-project memory overwrite via `importMemories` ON CONFLICT(id)

**File:** `src/core/api/memoryCoreService.ts:367-390`, `src/cli/commands/import.ts:43-54`

**Issue:**
The `memories` table's `id` column is a global `PRIMARY KEY` (not scoped by
`project_id`, see `src/core/schema/migrations/001_initial.sql:12`). The
`importMemories` upsert is:

```sql
INSERT INTO memories (id, project_id, ...) VALUES (@id, @project_id, ...)
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  ...
```

`import.ts`'s default (non-`--merge`) duplicate-skip only filters against IDs
that already exist **for the current project**:

```ts
const existingRows = listMemoriesByProject(context.db, context.projectId);
const existingIds = new Set(existingRows.map((r) => r.id));
const filtered = records.filter((r) => {
  const id = typeof r.id === "string" ? r.id : undefined;
  return id === undefined || !existingIds.has(id);
});
```

If an imported record's `id` happens to match a memory belonging to a
*different* project, it is not in `existingIds` (scoped to the current
project) and is therefore not skipped. The subsequent `INSERT ... ON
CONFLICT(id) DO UPDATE` then matches the global PK, overwrites that other
project's row's content/embedding, and reassigns its `project_id` to the
importing project — silently destroying/relocating another project's memory.
This is a data-isolation violation: importing a crafted or coincidentally
colliding JSON file from one project can corrupt another project's memory
store.

**Fix:**
Either:
1. Scope the `ON CONFLICT` upsert by `(project_id, id)` (requires a composite
   unique constraint/index, since `id` alone is currently the PK), or
2. In `importMemories`, check whether an existing row with the same `id`
   belongs to a different `project_id` and reject/skip that record (return a
   warning code) rather than allowing the upsert to reassign ownership:

```ts
const existing = db
  .prepare("SELECT project_id FROM memories WHERE id = ?")
  .get(memory.id) as { project_id: string } | undefined;

if (existing && existing.project_id !== parsed.projectId) {
  // skip / warn instead of overwriting another project's memory
  continue;
}
```

Also tighten `import.ts`'s duplicate-skip to check global ID existence (not
just within the current project) so cross-project collisions are surfaced as
"skipped" rather than silently imported.

## Warnings

### WR-01: `retentionDays` has no upper-bound validation, can break `retention prune`

**File:** `src/cli/commands/config.ts:27-34`, `src/core/config/policyConfig.ts:24-27`, `src/core/api/memoryCoreService.ts:442-446`

**Issue:**
`coerceInt()` in `config.ts` only checks that the value is "a clean integer"
(`/^-?\d+$/`), and `policyConfigSchema` only requires `z.number().int()`. A
user can run `sessionmem config set retentionDays 999999999999` (or any
value whose `retentionDays * 24 * 60 * 60 * 1000` exceeds
`Number.MAX_SAFE_INTEGER` / the `Date` range), and the value is persisted
without error.

When `retentionPruneCommand` (or `pruneMemories` directly) is then invoked,
`memoryCoreService.pruneMemories` computes:

```ts
const cutoffMs = Date.now() - parsed.retentionDays * 24 * 60 * 60 * 1000;
const cutoffIso = new Date(cutoffMs).toISOString(); // throws RangeError: Invalid time value
```

This throw propagates out of the `pruneMemories` method body into
`call()`'s try/catch, which returns an `INTERNAL` error envelope. The CLI
(`retentionPruneCommand`) then prints the error and exits 1 — `retention
prune` is now permanently broken (both dry-run and `--force`) until the user
manually resets `retentionDays` to a sane value via `config set`. (The
session-end light prune in `sessionLifecycleService.runLightPrune` swallows
this same error via its catch-all, so auto-prune is unaffected — but the
manual CLI path is not similarly resilient, and the failure mode is an opaque
"Invalid time value" message rather than a helpful validation error at
`config set` time.)

**Fix:**
Add an upper bound (and reject non-finite/unsafe values) in `coerceInt` for
`retentionDays`, e.g.:

```ts
function coerceRetentionDays(raw: string): number {
  const n = coerceInt(raw);
  // 100 years is far beyond any realistic retention window and keeps
  // cutoffMs well within the safe Date range.
  if (n > 36500) {
    throw new Error(`retentionDays must be <= 36500, got "${raw}"`);
  }
  return n;
}
```

and reference `coerceRetentionDays` for the `retentionDays` /
`retention.days` `CONFIG_KEYS` entries. Defensively, `pruneMemories` and
`runLightPrune` could also clamp `retentionDays` before computing
`cutoffMs` so a bad config value degrades to "prune nothing" rather than
throwing.

---

### WR-02: `retention prune --days` accepts trailing-garbage values that `config set` rejects

**File:** `src/cli/commands/retention.ts:34-39`, `src/cli/commands/config.ts:27-34`

**Issue:**
`config set retention.days "30abc"` is correctly rejected by `coerceInt`
(`/^-?\d+$/` does not match `"30abc"`, throws "expected an integer").
However, `retentionPruneCommand`'s `--days` parsing uses
`Number.parseInt(options.days, 10)` directly:

```ts
if (options.days !== undefined) {
  const parsed = Number.parseInt(options.days, 10);
  if (!Number.isNaN(parsed)) {
    override = { retentionDays: parsed };
  }
}
```

`Number.parseInt("30abc", 10)` returns `30` (not `NaN`), so `--days 30abc`
silently becomes `--days 30` with no warning to the user — an inconsistency
with the stricter validation applied to `config set retention.days`, and a
silent-acceptance-of-garbage-input pattern that could mask a typo'd flag
value.

**Fix:**
Reuse the same strict integer check as `coerceInt`:

```ts
if (options.days !== undefined) {
  if (!/^-?\d+$/.test(options.days.trim())) {
    console.error(`Invalid --days value "${options.days}": expected an integer.`);
    process.exit(1);
  }
  override = { retentionDays: Number.parseInt(options.days.trim(), 10) };
}
```

---

### WR-03: `redactExisting` apply loop aborts mid-batch on a single row error, discarding accumulated previews/counts

**File:** `src/core/api/memoryCoreService.ts:458-506`

**Issue:**
`redactExisting` iterates `listMemoriesByProject(db, parsed.projectId)` and,
when `parsed.apply` is true, calls `updateMemoryContent(db, parsed.projectId,
memory.id, redaction.text, embedding.normalizedText)` for each matching row.
`updateMemoryContent` throws a plain `Error("Memory not found: ...")` if
`result.changes === 0` (e.g., the row was deleted concurrently between the
initial `listMemoriesByProject` snapshot and this update — possible if a
concurrent `forget`/prune runs against the same project, or in any future
concurrent-access scenario).

Since `redactExisting`'s loop has no per-row try/catch, this throw escapes
the entire `methods.redactExisting` function body, is caught by `call()`'s
top-level try/catch, and converts the *entire* operation into an error
envelope — discarding `scanned`, `matched`, `updated`, and all `previews`
accumulated for rows processed so far, even though some rows may have already
been redacted and committed (no transaction wraps the loop, so prior
`updateMemoryContent` calls are NOT rolled back). The CLI (`redactScanCommand`)
then reports a bare error message and exit 1, with no indication that some
rows were already mutated.

**Fix:**
Wrap each row's `updateMemoryContent` call in a try/catch inside the loop so
a single missing/concurrently-deleted row doesn't abort the whole scrub, and
either (a) wrap the whole apply loop in `db.transaction(...)` for
all-or-nothing semantics, or (b) report partial success explicitly (e.g., add
a `skipped` count to `RedactExistingResponse`) so the CLI can communicate
"redacted N of M matched rows; X were skipped (not found)".

## Info

### IN-01: `redactExisting` preview truncation can split a UTF-16 surrogate pair

**File:** `src/core/api/memoryCoreService.ts:482`

**Issue:**
`previews.push(redaction.text.slice(0, REDACT_PREVIEW_MAX_LENGTH))` truncates
on UTF-16 code-unit boundaries via `String.prototype.slice`. If a memory's
redacted content contains a multi-byte character (emoji, non-BMP character)
straddling index 120, the preview can end with an unpaired surrogate, which
prints as a replacement character (`�`) or mangled output. This doesn't leak
secret data (the comment's security claim still holds) but can produce
confusing CLI output.

**Fix:** Use `Array.from(redaction.text).slice(0, N).join("")` or trim to the
nearest code-point boundary before slicing, if exact-length previews matter.

---

### IN-02: `import.ts` hard-fails the entire import on the first invalid record, discarding earlier valid ones

**File:** `src/cli/commands/import.ts:74-80`

**Issue:**
The per-record `importMemoryRecordSchema.safeParse` validation loop calls
`process.exit(1)` on the first invalid record (e.g., a record missing `id`
because `r.id` was `undefined` and passed the duplicate-skip filter at line
49-51 by virtue of `id === undefined`). This means a single malformed record
anywhere in a large import file aborts the whole import with no partial
import and no indication of which records *would* have succeeded. This is
existing import-command behavior (not new to Phase 6) but is adjacent to the
Phase 6 "import respects redaction" wiring and worth flagging since
Phase 6's `docs/privacy-and-retention.md` doesn't document this all-or-nothing
validation behavior for `sessionmem import`.

**Fix:** Consider reporting all invalid record indices/messages before
exiting (rather than stopping at the first), or skip-and-warn on individual
invalid records (consistent with the duplicate-skip UX) — whichever matches
the intended import semantics; document the chosen behavior in
`docs/privacy-and-retention.md` or the import command's own help text.

---

_Reviewed: 2026-06-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

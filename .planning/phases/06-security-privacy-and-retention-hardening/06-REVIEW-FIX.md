---
phase: 06-security-privacy-and-retention-hardening
fixed_at: 2026-06-10T22:02:00Z
review_path: .planning/phases/06-security-privacy-and-retention-hardening/06-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 06: Code Review Fix Report

**Fixed at:** 2026-06-10T22:02:00Z
**Source review:** .planning/phases/06-security-privacy-and-retention-hardening/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

## Fixed Issues

### CR-01: `redactionEnabled` policy-config setting is not wired to any write path

**Files modified:** `src/core/api/contracts.ts`, `src/core/api/memoryCoreService.ts`, `src/core/api/sessionLifecycleService.ts`, `src/cli/commands/import.ts`
**Commit:** 485ebd8
**Applied fix:** Changed `redactionEnabled` on `storeMemoryRequestSchema`,
`importMemoriesRequestSchema`, and `handleSessionEndConfigSchema` from
`.default(true)` to `.optional()`, so omission can be distinguished from an
explicit value. Added a `resolveRedactionEnabled` helper in both
`memoryCoreService` (using a new `policyConfigPath` deps field, mirroring the
existing `policyConfigPath`/`resolveRetentionDays` pattern) and
`sessionLifecycleService` that resolves the effective flag via
`resolvePolicySettings({ override: explicit, config: readPolicyConfig(...) })`
— override > config.json > default (D-11). `storeMemory`, `importMemories`,
and `handleSessionEnd`'s auto-summarize redaction now all consult this
resolved value before calling `applyRedaction`. `import.ts` no longer
hardcodes `redactionEnabled: true`; the service resolves it from
`~/.sessionmem/config.json`. Verified with `tsc --noEmit` (clean) and the
full redaction/policy-config/secret-leakage/stats test suites (46 tests
passing) plus export-import (8 tests passing).

### CR-02: Cross-project memory overwrite via `importMemories` ON CONFLICT(id)

**Files modified:** `src/core/api/contracts.ts`, `src/core/api/memoryCoreService.ts`, `src/core/storage/memoryRepo.ts`, `src/cli/commands/import.ts`
**Commit:** b45f40d
**Applied fix:** `importMemories` now looks up the current owner
(`SELECT project_id FROM memories WHERE id = ?`) for each record before
upserting; if the id already belongs to a *different* project, the record is
skipped (counted in a new `skippedCrossProject` response field) instead of
being upserted via `ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id`,
which previously reassigned ownership. Added a new `listAllMemoryIds(db)`
helper to `memoryRepo.ts` and used it in `import.ts`'s default (non-`--merge`)
duplicate-skip pre-filter, which previously only checked IDs within the
current project (`listMemoriesByProject`) and so missed cross-project id
collisions. `imported` now reflects only records actually upserted (not
`parsed.memories.length`). The CLI reports `skippedCrossProject` in its
summary line. Verified with `tsc --noEmit` (clean) and
export-import/redaction-write-paths/secret-leakage suites (31 tests passing).

### WR-01: `retentionDays` has no upper-bound validation, can break `retention prune`

**Files modified:** `src/cli/commands/config.ts`
**Commit:** 6ec90b0
**Applied fix:** Added `MAX_RETENTION_DAYS = 36500` (100 years, exported for
reuse) and a `coerceRetentionDays` wrapper around `coerceInt` that rejects
values `> 36500`. `CONFIG_KEYS["retention.days"]` and
`CONFIG_KEYS["retentionDays"]` now use `coerceRetentionDays`, so `config set
retentionDays 999999999999` is rejected at write time with a clear error
instead of later producing an `Invalid Date` / `RangeError` in
`pruneMemories`. Verified with `tsc --noEmit` (clean) and
`config-command.spec.ts` (7 tests passing).

### WR-02: `retention prune --days` accepts trailing-garbage values that `config set` rejects

**Files modified:** `src/cli/commands/retention.ts`, `src/cli/commands/config.ts`
**Commit:** e1007df
**Applied fix:** `retentionPruneCommand`'s `--days` parsing now applies the
same `/^-?\d+$/` strict-integer check as `coerceInt` (rejecting e.g.
`"30abc"` instead of silently truncating via `Number.parseInt`), and also
enforces the same `MAX_RETENTION_DAYS` bound as `config set` (exported from
`config.ts`). Both checks `process.exit(1)` with a descriptive error on
failure. Verified with `tsc --noEmit` (clean) and
`retention-prune.spec.ts` (CLI + core, 11 tests passing).

### WR-03: `redactExisting` apply loop aborts mid-batch on a single row error

**Files modified:** `src/core/api/contracts.ts`, `src/core/api/memoryCoreService.ts`, `src/cli/commands/redactScan.ts`
**Commit:** bb4948c
**Applied fix:** Wrapped the per-row `updateMemoryContent` call inside
`redactExisting`'s apply loop in a try/catch; a row that throws (e.g.
`"Memory not found"` because it was deleted concurrently between the initial
scan and the apply step) is now counted in a new `skipped` field instead of
aborting the whole operation and discarding `scanned`/`matched`/`updated`/
`previews` for all rows processed so far. Added `skipped` to
`redactExistingResponseSchema` (default 0). `redact-scan --apply` now reports
the skipped count when non-zero (`"Redacted N memories; M skipped (not
found)."`). Verified with `tsc --noEmit` (clean) and
`redact-scan.spec.ts` / `redact-existing.spec.ts` (12 tests passing).

### IN-01: `redactExisting` preview truncation can split a UTF-16 surrogate pair

**Files modified:** `src/core/api/memoryCoreService.ts`
**Commit:** 0a2ed9f
**Applied fix:** Replaced `redaction.text.slice(0, REDACT_PREVIEW_MAX_LENGTH)`
with `Array.from(redaction.text).slice(0, REDACT_PREVIEW_MAX_LENGTH).join("")`,
which iterates by Unicode code point rather than UTF-16 code unit, so a
multi-byte character (emoji, non-BMP) straddling the 120-char limit is no
longer split into an unpaired surrogate. Verified with `tsc --noEmit` (clean)
and `redact-scan.spec.ts` / `redact-existing.spec.ts` (12 tests passing).

### IN-02: `import.ts` hard-fails the entire import on the first invalid record

**Files modified:** `src/cli/commands/import.ts`
**Commit:** 7df920f
**Applied fix:** The per-record `importMemoryRecordSchema.safeParse`
validation loop no longer calls `process.exit(1)` on the first invalid
record. Each record is validated independently; invalid records are logged
("Record at index N is invalid, skipping: ...") and excluded from the
`importMemories` call, while valid records still import. The summary output
now reports the count of skipped invalid records alongside the existing
duplicate / cross-project skip counts. Verified with `tsc --noEmit` (clean)
and `export-import.spec.ts` (8 tests passing) plus the full suite (233
passing, 1 pre-existing unrelated failure — see note below).

**Note (logic-change flag — requires human verification):** This fix changes
import's previous all-or-nothing validation semantics to skip-and-warn, per
IN-02's stated recommendation ("skip-and-warn on individual invalid records,
consistent with the duplicate-skip UX"). No existing test asserted the old
abort-on-first-invalid-record behavior, and the new behavior is consistent
with the duplicate-skip UX elsewhere in `import.ts`. However, this is a
behavioral/semantic change to the CLI's import contract (not just a
defensive fix), so a human should confirm this matches the intended import
UX and consider documenting it in `docs/privacy-and-retention.md` or the
`import` command's help text, as IN-02 also suggested.

## Skipped Issues

None — all findings were fixed.

## Notes

- A pre-existing test failure (`tests/integration/cli/cli-entrypoint.spec.ts`,
  "Built CLI not found at .../dist/cli/index.js") was observed in the full
  suite run both before and after these fixes; it is caused by the absence of
  a `dist/` build artifact in the isolated worktree (no `npm run build` was
  run) and is unrelated to any of the fixes in this report.
- `tsc --noEmit -p tsconfig.json` was run after each fix and reported zero
  errors across the whole project (after copying `node_modules` into the
  isolated worktree for tooling access).

---

_Fixed: 2026-06-10T22:02:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

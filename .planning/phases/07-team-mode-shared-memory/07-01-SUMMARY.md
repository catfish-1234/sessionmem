---
phase: 07-team-mode-shared-memory
plan: 01
subsystem: database
tags: [sqlite, migration, provenance, author, better-sqlite3, zod]

requires:
  - phase: 05-cli-lifecycle-and-data-operations
    provides: deriveProjectId() shape-template + CliContext seam pattern
  - phase: 06-security-privacy-and-retention-hardening
    provides: importMemories cross-project ownership check + ON CONFLICT(id) upsert
provides:
  - Migration 005 adding author + origin_project_id columns to memories
  - author/origin_project_id threaded through every storage SELECT/INSERT/upsert, search candidate, retrieval candidate, and DTO
  - localUsername() helper + username field on CliContext
  - author stamped on storeMemory / importMemories / session-summary write paths
  - optional author + originProjectId on importMemoryRecordSchema (backward-compat)
affects: [team-cli, conflict-merge, injection-annotation, provenance-display]

tech-stack:
  added: []
  patterns:
    - "Provenance column-threading as an exhaustive checklist (SELECT + INSERT + upsert + types + DTO)"
    - "Username resolved once per service/CLI instance and reused as author stamp"

key-files:
  created:
    - src/core/schema/migrations/005_team_provenance.sql
    - tests/unit/core/author-stamp.spec.ts
  modified:
    - src/core/storage/types.ts
    - src/core/storage/memoryRepo.ts
    - src/core/storage/memorySearchRepo.ts
    - src/core/retrieve/retrieveMemories.ts
    - src/core/api/memoryCoreService.ts
    - src/core/api/sessionLifecycleService.ts
    - src/core/api/contracts.ts
    - src/cli/context.ts
    - tests/integration/storage/schema.spec.ts

key-decisions:
  - "author is NOT NULL DEFAULT '' so pre-005 rows survive without a backfill; '' is the safe sentinel since the local username is unavailable in static SQL (Open Q1)."
  - "origin_project_id is nullable and only set on rows pulled from another project; locally-authored writes set it to null."
  - "Username resolved once per service instance (resolveServiceUsername) and per CLI invocation (localUsername), sanitized to [A-Za-z0-9._-] with a 'user' fallback in the CLI."
  - "importMemories preserves an incoming record.author when present, else stamps the local username — never leaves author empty."
  - "importMemoryRecordSchema author/originProjectId are OPTIONAL for backward-compat with exports predating provenance (A3)."

patterns-established:
  - "Provenance threading checklist: any new column must travel through types.ts, every memoryRepo/searchRepo/service SELECT + INSERT/upsert, retrieval candidate, and both DTO mappers."

requirements-completed: []

duration: 4 min
completed: 2026-06-11
---

# Phase 7 Plan 1: Team Provenance Foundation Summary

**Migration 005 adds `author` (NOT NULL DEFAULT '') + `origin_project_id` (nullable) to `memories`, threaded exhaustively through storage SQL, retrieval candidates, and DTOs, with `author` stamped from the resolved OS username on every write path.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-11T09:37:00Z
- **Completed:** 2026-06-11T09:41:42Z
- **Tasks:** 2
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments
- Migration 005 adds both provenance columns without rewriting the table; pre-005 rows survive with `author=''` / `origin_project_id=NULL`.
- `author` + `origin_project_id` threaded through `MemoryRecord`, `InsertMemoryInput`, every `memoryRepo` SELECT/INSERT/upsert, the search-candidate types + SELECT, `RetrievedMemoryCandidate`, `getMemoryById` SELECT, and both DTO mappers — they can never silently drop to `undefined` (RESEARCH Pitfall 3).
- `localUsername()` added to `CliContext` (sanitized OS username, `"user"` fallback, `SESSIONMEM_USERNAME` test seam); `username` field populated and passed into the core service.
- `author` stamped on `storeMemory`, `importMemories` (preserving an incoming author else local), `summarizeSessionToMemory`, and all three session-end summary paths via the lifecycle service.
- `importMemoryRecordSchema` gains optional `author` + `originProjectId` for backward-compatible imports.

## Task Commits

1. **Task 1: Migration 005 + storage type/SQL threading** - `b2978fe` (feat)
2. **Task 2: Author stamping + DTO threading + username resolution** - `0dfd599` (feat)

_Note: TDD tasks — failing-first behavior captured in schema.spec.ts and author-stamp.spec.ts; implementation committed alongside each task's test extension._

## Files Created/Modified
- `src/core/schema/migrations/005_team_provenance.sql` - ALTER TABLE adding author + origin_project_id
- `src/core/storage/types.ts` - author/origin_project_id on MemoryRecord + InsertMemoryInput
- `src/core/storage/memoryRepo.ts` - INSERT/upsert column lists, params, toParams defaults, listMemoriesByProject SELECT
- `src/core/storage/memorySearchRepo.ts` - search SELECT + MemorySearchRow/MemorySearchCandidate types
- `src/core/retrieve/retrieveMemories.ts` - RetrievedMemoryCandidate + candidate mapper
- `src/core/api/memoryCoreService.ts` - DTO mappers, getMemoryById SELECT, username dep, storeMemory/importMemories stamping
- `src/core/api/sessionLifecycleService.ts` - username dep + author on session-summary writes
- `src/core/api/contracts.ts` - optional author/originProjectId on importMemoryRecordSchema
- `src/cli/context.ts` - localUsername() + username on CliContext
- `tests/integration/storage/schema.spec.ts` - migration-adds-columns + pre-005 row survival
- `tests/unit/core/author-stamp.spec.ts` - author stamping across write paths + username sanitization

## Decisions Made
See `key-decisions` frontmatter. Headline: `author TEXT NOT NULL DEFAULT ''` preserves existing rows (no backfill), username resolved once and reused, import preserves incoming author else stamps local.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. The full-suite run surfaced one pre-existing failure (`tests/integration/cli/cli-entrypoint.spec.ts`) that requires `npm run build` to produce `dist/cli/index.js`; after building, that spec passes (8/8). It is a build-artifact dependency, not a regression from this plan's changes.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema + type foundation for team provenance is complete and is the dependency root for the rest of Phase 7.
- Plan 02 (team CLI), Plan 03 (conflict/merge), and Plan 04 (injection annotation) can now read the `author` column and the DTO `author`/`originProjectId` fields.
- `npx tsc --noEmit` clean; schema.spec.ts (5/5) and author-stamp.spec.ts (5/5) green; full suite 249 passed / 8 skipped (after build).

## Self-Check: PASSED
- `src/core/schema/migrations/005_team_provenance.sql` exists on disk with both ALTER TABLE statements.
- `git log --grep="07-01"` returns 2 feature commits (b2978fe, 0dfd599).
- All task `<acceptance_criteria>` re-verified: migration columns present, author in searchRepo SELECT, RetrievedMemoryCandidate.author declared, CliContext.username present, importMemoryRecordSchema optional author/originProjectId, DTO mappers stamp author, both specs green, tsc clean.
- Plan-level `<verification>`: `npx tsc --noEmit` passes; full suite green (sole non-pass is the build-artifact CLI spec, which passes after `npm run build`).

---
*Phase: 07-team-mode-shared-memory*
*Completed: 2026-06-11*

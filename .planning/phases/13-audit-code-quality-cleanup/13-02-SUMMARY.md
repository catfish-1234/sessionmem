---
phase: 13-audit-code-quality-cleanup
plan: 02
subsystem: core-api
tags: [soft-limit, session, write-cap, warning]
dependency_graph:
  requires: []
  provides: [session-write-soft-limit, countMemoriesBySession]
  affects: [storeMemory-response]
tech_stack:
  added: []
  patterns: [soft-limit-warning-code, pre-insert-count-check]
key_files:
  created:
    - tests/unit/api/session-write-limit.spec.ts
  modified:
    - src/core/config/policyConfig.ts
    - src/core/storage/memoryRepo.ts
    - src/core/api/memoryCoreService.ts
decisions:
  - "Soft limit checks count BEFORE insert so the Nth memory (at the limit) does not trigger a warning, only the (N+1)th and beyond"
  - "countMemoriesBySession counts across all projects for a given session_id, matching session_id scope semantics"
metrics:
  duration: ~3m
  completed: 2026-06-21T04:13:00Z
  tasks_completed: 4
  tasks_total: 4
  files_changed: 4
---

# Phase 13 Plan 02: Per-Session Write Soft Limit Summary

SESSION_WRITE_SOFT_LIMIT=50 constant with pre-insert count check that appends "session_write_limit_warning" to warningCodes without blocking the write.

## Task Completion

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Add SESSION_WRITE_SOFT_LIMIT to policyConfig | b3752f3 | src/core/config/policyConfig.ts |
| 2 | Add countMemoriesBySession to memoryRepo | 13a4ca2 | src/core/storage/memoryRepo.ts |
| 3 | Wire soft limit check into storeMemory | d92d9c7 | src/core/api/memoryCoreService.ts |
| 4 | Add soft limit test | 2cfcfb6 | tests/unit/api/session-write-limit.spec.ts |

## Implementation Details

### SESSION_WRITE_SOFT_LIMIT constant
Added `export const SESSION_WRITE_SOFT_LIMIT = 50` to `policyConfig.ts` with JSDoc explaining the soft-limit behavior.

### countMemoriesBySession function
Added to `memoryRepo.ts` -- counts all memories with a matching `session_id` via `SELECT COUNT(*)`. Scopes by session_id only (not project_id) to match session identity semantics.

### storeMemory integration
In `memoryCoreService.ts`, the `storeMemory` handler now:
1. Builds a mutable `warningCodes` array from the redaction warnings
2. Calls `countMemoriesBySession(db, parsed.sessionId)` before the insert
3. If count >= SESSION_WRITE_SOFT_LIMIT, pushes `"session_write_limit_warning"` into the array
4. Proceeds with the insert regardless (soft limit)
5. Returns the combined warningCodes in the response

### Tests
Three tests in `tests/unit/api/session-write-limit.spec.ts`:
- Below-limit stores produce no warning
- After SESSION_WRITE_SOFT_LIMIT stores in the same session, the next store includes the warning
- Memory still persists when over the soft limit (verifiable via getMemory)

## Verification

All 312 tests pass (11 skipped). The 2 failing suites (`cli-entrypoint.spec.ts`, `stdio-server.spec.ts`) are pre-existing and require `npm run build` -- unrelated to this change.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All 4 files verified present. All 4 commit hashes verified in git log.

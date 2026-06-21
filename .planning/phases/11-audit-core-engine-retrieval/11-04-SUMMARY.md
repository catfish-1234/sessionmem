---
phase: 11-audit-core-engine-retrieval
plan: 04
subsystem: core/storage
tags: [performance, sql, search, candidates]
dependency_graph:
  requires: []
  provides: [MAX_SEMANTIC_CANDIDATES, searchMemoryCandidates-limit]
  affects: [retrieveMemories]
tech_stack:
  added: []
  patterns: [SQL LIMIT with ORDER BY for pre-filtering]
key_files:
  created:
    - tests/integration/retrieve/search-candidates.spec.ts
  modified:
    - src/core/config/policyConfig.ts
    - src/core/storage/memorySearchRepo.ts
decisions:
  - "Default limit of 2000 candidates ordered by importance DESC, updated_at DESC"
  - "LIMIT approach is temporary; Opt 3 will replace with importance/date WHERE clause"
metrics:
  duration: "2m 41s"
  completed: "2026-06-21T04:12:11Z"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase 11 Plan 04: Add MAX_SEMANTIC_CANDIDATES Limit Summary

SQL LIMIT of 2000 on searchMemoryCandidates ordered by importance DESC, updated_at DESC to prevent unbounded memory loads for large projects.

## Changes

### Task 1: Add MAX_SEMANTIC_CANDIDATES to policyConfig
- **Commit:** 706fbbf
- Added `MAX_SEMANTIC_CANDIDATES = 2000` constant to `src/core/config/policyConfig.ts`
- Includes JSDoc and TODO noting Opt 3 will replace LIMIT with WHERE clause

### Task 2: Apply LIMIT to searchMemoryCandidates SQL
- **Commit:** 00cb02d
- Imported `MAX_SEMANTIC_CANDIDATES` from policyConfig
- Added `ORDER BY importance DESC, updated_at DESC LIMIT ?` to the SELECT query
- Passes `MAX_SEMANTIC_CANDIDATES` as the LIMIT bind parameter
- Added inline TODO comment for Opt 3 replacement

### Task 3: Add candidate limit integration tests
- **Commit:** b5d6476
- 3 test cases in `tests/integration/retrieve/search-candidates.spec.ts`:
  - 3000 memories in DB returns at most 2000 (MAX_SEMANTIC_CANDIDATES)
  - Fewer than limit returns all rows unchanged
  - Ordering verified: importance DESC then updated_at DESC

## Verification

All 312 tests pass (11 skipped). 2 pre-existing failures are unrelated (missing dist/ build artifacts in worktree for CLI entrypoint and MCP stdio-server specs).

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

All 3 created/modified files verified on disk. All 3 task commits verified in git log.

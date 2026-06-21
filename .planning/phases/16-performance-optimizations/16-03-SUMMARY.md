---
phase: 16-performance-optimizations
plan: 03
subsystem: core/storage
tags: [performance, sql, pre-filter, search]
dependency_graph:
  requires: [16-01]
  provides: [importance-date-prefilter]
  affects: [retrieve-pipeline]
tech_stack:
  patterns: [sql-where-prefilter, importance-threshold, date-window]
key_files:
  modified:
    - src/core/storage/memorySearchRepo.ts
    - src/core/config/policyConfig.ts
    - tests/integration/retrieve/search-candidates.spec.ts
    - tests/integration/retrieve/retrieve-ranked.spec.ts
  created:
    - tests/integration/retrieve/search-prefilter.spec.ts
decisions:
  - "Importance threshold set to 8 (matches ACCESS_BOOST_AMOUNT=2 ceiling)"
  - "Date window set to 90 days (matches DEFAULT_POLICY_CONFIG.retentionDays)"
  - "Fixed retrieve-ranked test by moving date from 2026-03-01 to 2026-05-01 (within 90-day window) rather than changing importance, preserving test contrast"
metrics:
  duration_seconds: 280
  completed: "2026-06-21T13:29:53Z"
---

# Phase 16 Plan 03: SQL Pre-filter for Search Candidates Summary

Replaced LIMIT-based candidate loading with WHERE clause pre-filter: importance >= 8 OR updated_at within 90 days. Old low-signal memories excluded at SQL level instead of loading all and truncating.

## Completed Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Replace LIMIT with WHERE pre-filter | 8f1d2ac | memorySearchRepo.ts, policyConfig.ts, search-candidates.spec.ts |
| 2 | Add pre-filter integration test | 08d2cb1 | search-prefilter.spec.ts |
| 3 | Fix affected existing tests | a7a0e2c | retrieve-ranked.spec.ts |

## Changes Made

### Task 1: Replace LIMIT with WHERE pre-filter
- Replaced `ORDER BY importance DESC, updated_at DESC LIMIT ?` with `AND (importance >= 8 OR updated_at > datetime('now', '-90 days'))` in the cached prepared statement
- Removed `MAX_SEMANTIC_CANDIDATES` import from memorySearchRepo.ts
- Removed `MAX_SEMANTIC_CANDIDATES` constant and TODO comment from policyConfig.ts
- Updated function call from `.all(projectId, MAX_SEMANTIC_CANDIDATES)` to `.all(projectId)`
- Rewrote search-candidates.spec.ts tests from LIMIT behavior to pre-filter behavior

### Task 2: Add pre-filter integration test
- Created search-prefilter.spec.ts with 4 test cases:
  - High-importance (9) + old date: INCLUDED
  - Low-importance (5) + old date: EXCLUDED
  - Low-importance (5) + recent date: INCLUDED
  - Mixed scenario validating all three rules together

### Task 3: Fix affected existing tests
- Updated retrieve-ranked.spec.ts: changed `updated_at` from "2026-03-01" to "2026-05-01" for the low-importance memory so it passes the 90-day recency pre-filter

## Verification

All 353 tests pass (69 test files). The 2 pre-existing failures (cli-entrypoint.spec.ts, stdio-server.spec.ts) require `npm run build` and are unrelated to this change.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

All 6 files verified present. All 3 commit hashes verified in git log.

---
phase: 13-audit-code-quality-cleanup
plan: 01
subsystem: core/config
tags: [refactor, magic-numbers, constants]
dependency_graph:
  requires: []
  provides: [MIN_IMPORTANCE, MAX_IMPORTANCE, CRITICAL_WARNING_IMPORTANCE_THRESHOLD, DEEP_MODE_RETRIEVAL_CAP]
  affects: [formatStartupInjection, importance, memoryCoreService]
tech_stack:
  added: []
  patterns: [named-constant-extraction]
key_files:
  created: []
  modified:
    - src/core/config/policyConfig.ts
    - src/core/injection/formatStartupInjection.ts
    - src/core/retrieve/importance.ts
    - src/core/api/memoryCoreService.ts
decisions:
  - Extract importance scale bounds and retrieval caps as named exports from policyConfig.ts
metrics:
  duration: 104s
  completed: 2026-06-21T04:11:45Z
  tasks_completed: 4
  tasks_total: 4
  files_modified: 4
---

# Phase 13 Plan 01: Extract Magic Numbers to policyConfig Constants Summary

Named constants for importance scale bounds (MIN_IMPORTANCE=1, MAX_IMPORTANCE=10), critical warning threshold (9), and deep-mode retrieval cap (100) exported from policyConfig.ts and consumed across retrieval/injection pipeline.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add constants to policyConfig.ts | 56b8ec7 | src/core/config/policyConfig.ts |
| 2 | Update formatStartupInjection.ts | 9165cff | src/core/injection/formatStartupInjection.ts |
| 3 | Update importance.ts | 757fd77 | src/core/retrieve/importance.ts |
| 4 | Update memoryCoreService.ts | 662539b | src/core/api/memoryCoreService.ts |

## Deviations from Plan

None - plan executed exactly as written.

## Verification

All 309 tests pass (11 skipped). The 2 pre-existing integration test failures (stdio-server.spec.ts, cli-entrypoint.spec.ts) are unrelated -- they require a `dist/` build artifact that is not present in the worktree. No regressions from this change.

## Known Stubs

None.

## Self-Check: PASSED

- All 4 modified files exist on disk
- All 4 task commits verified in git log (56b8ec7, 9165cff, 757fd77, 662539b)
- All constants properly exported and consumed across 4 files

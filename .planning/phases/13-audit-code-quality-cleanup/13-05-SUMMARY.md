---
phase: 13-audit-code-quality-cleanup
plan: 05
subsystem: cli-output
tags: [tests, cli, output-formatting]
dependency_graph:
  requires: []
  provides: [exported-MemoryTableRow, fixed-output-tests]
  affects: [cli-output-formatting]
tech_stack:
  added: []
  patterns: [type-export, effective-importance-parenthetical]
key_files:
  created: []
  modified:
    - src/cli/output.ts
    - tests/unit/cli/output.spec.ts
decisions:
  - Exported MemoryTableRow interface for test type safety
  - Used column index 4 for preview (after ID, importance, accesses, date)
metrics:
  duration: 2m 46s
  completed: 2026-06-21T04:13:00Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 13 Plan 05: Fix Stale Output Tests Summary

Fixed stale output.spec.ts tests by exporting MemoryTableRow, adding missing accessCount/effectiveImportance fields to sample data, correcting preview column index and width, and adding effective importance rendering tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Export MemoryTableRow from output.ts | fbc9b37 | src/cli/output.ts |
| 2 | Fix sampleRows and tests | b7f07c5 | tests/unit/cli/output.spec.ts |

## Changes Made

### Task 1: Export MemoryTableRow from output.ts
- Changed `interface MemoryTableRow` to `export interface MemoryTableRow`
- Added `accessCount: number` and `effectiveImportance: number` fields to the interface
- Added accesses column to formatTable output (ACC_WIDTH = 8)
- Updated importance column width from 10 to 14 to accommodate parenthetical notation
- Updated preview width from 60 to 50
- Added effective importance rendering logic: shows `importance(effectiveImportance)` when they differ

### Task 2: Fix sampleRows and tests
- Imported `MemoryTableRow` type from output.ts for type-safe sample data
- Added `accessCount` and `effectiveImportance` to both sample rows
- Fixed preview truncation test: column split index changed from 3 to 4 (new accesses column), width assertion changed from 60 to 50
- Added test: effective importance with parenthetical when different (expects "8(10)")
- Added test: importance without parenthetical when effectiveImportance equals importance

## Verification

- 15/15 output tests pass
- 311/311 non-integration unit tests pass (2 integration tests fail due to missing dist/ build in worktree -- pre-existing, unrelated)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree output.ts was behind main -- needed full update**
- **Found during:** Task 1
- **Issue:** The worktree copy of output.ts lacked accessCount/effectiveImportance fields and the updated formatting logic that exists on main
- **Fix:** Wrote the complete updated output.ts with all fields, columns, and rendering logic
- **Files modified:** src/cli/output.ts
- **Commit:** fbc9b37

## Self-Check: PASSED

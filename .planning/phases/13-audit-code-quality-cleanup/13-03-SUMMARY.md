---
phase: 13-audit-code-quality-cleanup
plan: 03
subsystem: core/api
tags: [feedback, forgetMemory, analytics, schema-migration]
dependency_graph:
  requires: []
  provides: [manual_delete-feedback-signal]
  affects: [memoryFeedbackRepo, memoryCoreService, memory_feedback-table]
tech_stack:
  added: []
  patterns: [feedback-on-delete, schema-migration-table-recreation]
key_files:
  created:
    - src/core/schema/migrations/006_feedback_manual_delete.sql
    - tests/unit/api/forget-feedback.spec.ts
  modified:
    - src/core/api/memoryCoreService.ts
    - src/core/storage/memoryFeedbackRepo.ts
    - tests/integration/storage/schema.spec.ts
decisions:
  - Removed FK CASCADE on memory_feedback to preserve feedback rows after memory deletion
  - Added manual_delete to MemoryFeedbackType union and SQL CHECK constraint
  - Changed new_importance CHECK from >= 1 to >= 0 to allow deletion records
metrics:
  duration: 227s
  completed: 2026-06-21T04:14:45Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 13 Plan 03: Record Feedback on forgetMemory Summary

Wire insertMemoryFeedbackEvent into forgetMemory to record manual_delete feedback with previous importance captured before deletion.

## What Was Done

### Task 1: Wire insertMemoryFeedbackEvent into forgetMemory
- Added migration 006_feedback_manual_delete.sql that recreates the memory_feedback table with:
  - `manual_delete` added to the feedback_type CHECK constraint
  - `new_importance` CHECK lowered from `>= 1` to `>= 0` (deletion = importance 0)
  - Foreign key CASCADE removed so feedback rows survive memory deletion
- Updated `MemoryFeedbackType` in memoryFeedbackRepo.ts to include `"manual_delete"`
- Modified forgetMemory handler in memoryCoreService.ts to:
  - Read the memory before deletion to capture its importance
  - Insert a feedback event after successful deletion with feedback_type="manual_delete", previous_importance from the deleted memory, and new_importance=0
- Updated schema.spec.ts to expect 6 migrations instead of 5

### Task 2: Add feedback recording test
- Created tests/unit/api/forget-feedback.spec.ts with 3 test cases:
  - Verifies manual_delete feedback row is inserted when a memory is forgotten
  - Verifies correct previous_importance capture for different importance levels
  - Verifies feedback row survives after the memory itself is deleted (no FK CASCADE)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] SQL CHECK constraint prevented manual_delete feedback_type**
- **Found during:** Task 1
- **Issue:** The memory_feedback table's CHECK constraint only allowed 'auto_use' and 'manual', and new_importance required >= 1. Both blocked the manual_delete use case.
- **Fix:** Created migration 006 to recreate the table with updated constraints.
- **Files modified:** src/core/schema/migrations/006_feedback_manual_delete.sql
- **Commit:** 24295dd

**2. [Rule 3 - Blocking] FK CASCADE would delete feedback rows when memory is deleted**
- **Found during:** Task 1
- **Issue:** The FOREIGN KEY on memory_id had ON DELETE CASCADE, meaning feedback records would be destroyed when the memory they reference is deleted -- defeating the purpose of recording deletion feedback.
- **Fix:** Migration 006 removes the FK CASCADE so feedback rows persist as analytics signals after the referenced memory is deleted.
- **Files modified:** src/core/schema/migrations/006_feedback_manual_delete.sql
- **Commit:** 24295dd

**3. [Rule 3 - Blocking] Schema test expected 5 migrations, now 6**
- **Found during:** Task 1 verification
- **Issue:** tests/integration/storage/schema.spec.ts hardcoded the expected migration count as 5.
- **Fix:** Updated the expected count to 6 and added "006_feedback_manual_delete.sql" to the expected names list.
- **Files modified:** tests/integration/storage/schema.spec.ts
- **Commit:** 24295dd

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 24295dd | feat(13-03): wire insertMemoryFeedbackEvent into forgetMemory |
| 2 | 8edf8c8 | test(13-03): add forget-feedback tests for manual_delete recording |

## Test Results

312 tests passed, 11 skipped, 2 pre-existing failures (require build step not available in worktree).

## Known Stubs

None.

## Threat Flags

None.

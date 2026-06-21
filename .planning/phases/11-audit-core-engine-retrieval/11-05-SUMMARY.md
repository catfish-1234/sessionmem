---
phase: 11-audit-core-engine-retrieval
plan: 05
subsystem: retrieval-pipeline
tags: [decay, importance, scoring, wiring]
dependency_graph:
  requires: [11-03]
  provides: [decay-wired-retrieval]
  affects: [retrieveMemories, scoreMemoryCandidate]
tech_stack:
  patterns: [decay-before-score, optional-field-fallback]
key_files:
  modified:
    - src/core/retrieve/retrieveMemories.ts
    - src/core/retrieve/score.ts
  created:
    - tests/unit/retrieve/decay-wiring.spec.ts
decisions:
  - "Used optional decayedImportance with nullish coalescing fallback to preserve backward compatibility"
  - "Decay applied before embedding dimension resolution to keep pipeline order clean"
metrics:
  duration: 151s
  completed: 2026-06-21T04:22:29Z
  tasks_completed: 4
  tasks_total: 4
---

# Phase 11 Plan 05: Wire decayOldBoosts into Retrieval Pipeline Summary

JWT-free importance decay wiring: decayOldBoosts now runs on all candidates before scoring, reducing stale memories' importance by -1 per 7 days via optional decayedImportance field with backward-compatible fallback.

## What Was Done

### Task 1: Wire decay into retrieval pipeline
- Imported `decayOldBoosts` from `./decay.js` into `retrieveMemories.ts`
- Called `decayOldBoosts(candidates, now)` after loading candidates from `searchMemoryCandidates`
- Passed `decayedImportance` from decayed candidates into `scoreMemoryCandidate` call
- Used `decayedCandidates` in the `.map()` scoring loop instead of raw `candidates`

### Task 2: Update ScoreMemoryCandidateInput interface
- Added `decayedImportance?: number` to `ScoreMemoryCandidateInput` interface
- Updated `scoreMemoryCandidate` to use `candidate.decayedImportance ?? candidate.importance` for effective importance computation
- Backward compatible: existing callers without `decayedImportance` work unchanged

### Task 3: Verify DecayMemoryInput matches MemorySearchRow
- Verified `DecayMemoryInput` fields (`id`, `importance`, `updated_at`) match `MemorySearchCandidate` interface exactly
- No fix needed -- field names and types are consistent

### Task 4: Add decay wiring test
- Created `tests/unit/retrieve/decay-wiring.spec.ts` with 2 tests:
  1. Memory with importance=8 updated 10 days ago scores lower on importance than same memory updated today (decayedImportance becomes 7)
  2. scoreMemoryCandidate falls back to importance when decayedImportance is not provided

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1-4 | 18b85a1 | feat(11-05): wire decayOldBoosts into retrieval pipeline |

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- All unit tests pass (311 passed, 11 skipped)
- 2 pre-existing integration test failures (require `npm run build` -- unrelated to this plan)
- New decay-wiring tests: 2 passed

## Self-Check: PASSED

- All created/modified files exist on disk
- Commit 18b85a1 verified in git log

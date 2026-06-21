---
phase: 11-audit-core-engine-retrieval
plan: 03
subsystem: retrieval-scoring
tags: [recency, exponential-decay, scoring]
dependency_graph:
  requires: []
  provides: [smooth-recency-decay]
  affects: [score.ts, retrieval-ranking]
tech_stack:
  added: []
  patterns: [exponential-decay, half-life-scoring]
key_files:
  created: []
  modified:
    - src/core/retrieve/recencyBands.ts
    - tests/unit/retrieve/scoring-weights.spec.ts
decisions:
  - "14-day half-life chosen for exponential decay (score ~0.5 at day 14)"
  - "Floor of 0.05 ensures old memories are never fully excluded from retrieval"
metrics:
  duration: 133s
  completed: 2026-06-21T04:11:33Z
  tasks_completed: 2
  tasks_total: 2
---

# Phase 11 Plan 03: Smooth Exponential Recency Decay Summary

Replaced 4-band step function in getRecencyBandScore with smooth exponential decay using 14-day half-life and 0.05 floor.

## What Changed

### Task 1: Replace step function with exponential decay
- **Commit:** `87f037e`
- Removed the 4-band step function (day<=1: 1.0, day<=7: 0.75, day<=30: 0.5, else: 0.25)
- Replaced with continuous formula: `Math.max(0.05, Math.exp(-lambda * ageDays))` where `lambda = Math.LN2 / 14`
- Preserves function signature and toDate/DAY_IN_MS helpers

### Task 2: Update tests for smooth curve
- **Commit:** `a09217a`
- Removed old band-boundary assertions that tested discrete bucket scores
- Added assertions for smooth curve behavior:
  - Day 0 score === 1.0
  - Day 14 score ~= 0.5 (half-life, within 0.1 tolerance)
  - Day 29 > Day 31 by small amount (no cliff, difference < 0.05)
  - Day 365 >= 0.05 (floor)
- Fixed scoreMemoryCandidate integration test to use identical timestamps for exact recency 1.0

## Verification

- `npm test`: 309 tests pass, 11 skipped, 0 new failures
- 2 pre-existing CLI integration failures (unrelated -- require `npm run build`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed scoreMemoryCandidate test timestamp mismatch**
- **Found during:** Task 2
- **Issue:** The scoreMemoryCandidate test used `updated_at` 3 hours before `now`, which under the old step function still scored 1.0 (within day-1 band) but under exponential decay scored ~0.994. This caused the `expect(score.raw.recency).toBe(1.0)` assertion to fail.
- **Fix:** Changed `updated_at` from `"2026-05-25T09:00:00.000Z"` to `"2026-05-25T12:00:00.000Z"` (same as `now`) so day-0 recency is exactly 1.0.
- **Files modified:** tests/unit/retrieve/scoring-weights.spec.ts
- **Commit:** a09217a

## Known Stubs

None.

## Self-Check: PASSED

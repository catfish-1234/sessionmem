---
phase: 01-core-memory-engine-foundation
plan: 03
subsystem: api
tags: [retrieval, ranking, deterministic, sqlite, scoring]
requires:
  - phase: 01-01
    provides: storage schema and memory repository primitives
  - phase: 01-02
    provides: deterministic embedding generation
provides:
  - Weighted memory scoring across semantic, recency, and importance signals
  - Deterministic retrieval ranking with stable tie-break ordering
  - Retrieval integration tests covering combined-score behavior and tie stability
affects: [memory-core-service, adapter-contract, retrieval]
tech-stack:
  added: []
  patterns: [weighted-ranking, deterministic-ordering, compatibility-preserving-api]
key-files:
  created:
    - src/core/retrieve/recencyBands.ts
    - src/core/retrieve/importance.ts
    - src/core/retrieve/score.ts
    - src/core/storage/memorySearchRepo.ts
    - src/core/retrieve/retrieveMemories.ts
    - tests/unit/retrieve/scoring-weights.spec.ts
    - tests/integration/retrieve/retrieve-ranked.spec.ts
  modified:
    - src/core/storage/memorySearchRepo.ts
    - src/core/retrieve/retrieveMemories.ts
key-decisions:
  - "Locked retrieval weights to semantic 0.60, recency 0.25, and importance 0.15 with score breakdown output."
  - "Kept retrieval API backward compatible by accepting query/limit aliases while exposing topK/queryText."
patterns-established:
  - "Retrieval ordering is deterministic: score desc, updated_at desc, then id asc."
  - "Repository layer parses stored embedding JSON into typed vectors before ranking."
requirements-completed: [RETR-01, RETR-02]
duration: 4min
completed: 2026-05-25
---

# Phase 01 Plan 03: Core Memory Engine Foundation Summary

**Deterministic retrieval pipeline shipped with weighted semantic/recency/importance scoring and stable tie-break ranking semantics.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-25T21:44:14Z
- **Completed:** 2026-05-25T21:48:40Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Implemented bucketed recency scoring, importance normalization, and weighted score composition.
- Added memory search candidate repository and retrieval orchestrator with deterministic tie-break sorting.
- Added unit and integration coverage validating locked weights, combined-score ranking, and deterministic ordering.

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement scoring primitives with bucketed recency** - `4a4a8de` (feat)
2. **Task 2: Build retrieval orchestrator with deterministic tie-break** - `7fd91d9` (feat)

Additional correctness fix after full-suite verification:

3. **Compatibility stabilization:** `5e5820c` (fix)

## Files Created/Modified
- `src/core/retrieve/recencyBands.ts` - Recency band scoring utility (`today/week/month/older`).
- `src/core/retrieve/importance.ts` - Normalizes 1..10 importance to 0..1.
- `src/core/retrieve/score.ts` - Weighted score + score part breakdown.
- `src/core/storage/memorySearchRepo.ts` - Candidate fetch and embedding JSON parse for retrieval.
- `src/core/retrieve/retrieveMemories.ts` - Query embedding, semantic similarity, ranking, deterministic sort.
- `tests/unit/retrieve/scoring-weights.spec.ts` - Unit verification for weights/bands/normalization/score parts.
- `tests/integration/retrieve/retrieve-ranked.spec.ts` - Integration verification for ranking behavior and tie stability.

## Decisions Made
- Fixed recency to discrete deterministic bands to keep ranking stable and explainable.
- Preserved compatibility for existing service callers (`query`/`limit`) while implementing the plan’s `queryText`/`topK` API.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed retrieval input compatibility regression**
- **Found during:** Final verification after Task 2
- **Issue:** `memoryCoreService` passed `query/limit`, but retrieval accepted only `queryText/topK`, causing runtime failure.
- **Fix:** Added alias support (`query` + `limit`) and preserved full memory field mapping (`created_at`) in retrieval candidates.
- **Files modified:** `src/core/retrieve/retrieveMemories.ts`, `src/core/storage/memorySearchRepo.ts`
- **Verification:** `npx vitest run --reporter=dot` passes with all tests green.
- **Committed in:** `5e5820c`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Fix was required for correctness and compatibility, with no scope creep.

## Issues Encountered
- PowerShell command chaining with `&&` failed; switched to quoted `cmd /c` chaining for verification commands.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Retrieval and scoring foundations are complete and validated for adapter integration paths.
- Deterministic ranking behavior is now test-protected for future phase extensions.

---
*Phase: 01-core-memory-engine-foundation*
*Completed: 2026-05-25*

## Self-Check: PASSED

- FOUND: `.planning/phases/01-core-memory-engine-foundation/01-03-SUMMARY.md`
- FOUND: `4a4a8de`
- FOUND: `7fd91d9`
- FOUND: `5e5820c`

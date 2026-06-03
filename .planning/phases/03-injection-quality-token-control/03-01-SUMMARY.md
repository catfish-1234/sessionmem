---
phase: 03-injection-quality-token-control
plan: 01
subsystem: core-retrieval
tags: [sqlite, retrieval, scoring, feedback, zod, vitest, js-tiktoken]
requires:
  - phase: 01-core-memory-engine-foundation
    provides: core memory schema, retrieval scoring, storage repositories, service contracts
provides:
  - memory feedback persistence with bounded auto-use importance boosts
  - retrieval request mode/depth controls
  - retrieval DTO score and semantic metadata
  - deterministic old-boost decay helper
affects: [retrieval, injection-quality, token-control, cli-search]
tech-stack:
  added: [js-tiktoken]
  patterns: [transactional repository helper for memory feedback, retrieval-specific DTO schema]
key-files:
  created:
    - src/core/schema/migrations/004_memory_feedback.sql
    - src/core/storage/memoryFeedbackRepo.ts
    - src/core/retrieve/decay.ts
    - tests/integration/core/memory-feedback.spec.ts
    - tests/unit/retrieve/importance-decay.spec.ts
    - tests/integration/retrieve/retrieve-on-demand.spec.ts
    - tests/integration/retrieve/retrieve-score-metadata.spec.ts
  modified:
    - package.json
    - package-lock.json
    - src/core/api/contracts.ts
    - src/core/api/memoryCoreService.ts
    - src/core/storage/memoryRepo.ts
    - tests/integration/storage/schema.spec.ts
key-decisions:
  - "Auto-use memory feedback increments importance by 1 and caps at 9 to keep successful retrieval boosts bounded."
  - "Retrieval score metadata uses a dedicated retrieved-memory DTO so list/export memory responses remain backward compatible."
patterns-established:
  - "Repository transactions update memory importance and insert audit feedback in one atomic operation."
  - "Deep retrieval mode widens the effective retrieval limit while preserving the caller-provided default mode contract."
requirements-completed: [RETR-04, RETR-05]
duration: 4min
completed: 2026-06-03
---

# Phase 03 Plan 01: Core Feedback, Migration, & Retrieval Extensions Summary

**Bounded memory feedback boosts with retrieval mode/depth controls and score metadata surfaced through the core service**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-03T23:51:37Z
- **Completed:** 2026-06-03T23:55:59Z
- **Tasks:** 1
- **Files modified:** 13

## Accomplishments

- Added `memory_feedback` migration and repository insertion support.
- Added `recordMemoryUsed` service boundary backed by a transaction that updates importance and writes feedback history.
- Added `mode` and `depth` retrieval request controls; deep mode widens retrieval depth.
- Added retrieval DTO score metadata (`semantic`, `score`) without changing normal memory list/export DTOs.
- Added deterministic `decayOldBoosts` helper and focused unit/integration coverage.

## Task Commits

Each task was committed atomically:

1. **Task 1: Core feedback, migration, and retrieval extensions** - `78bf747` (feat)

## Files Created/Modified

- `src/core/schema/migrations/004_memory_feedback.sql` - Adds memory feedback table and lookup index.
- `src/core/storage/memoryFeedbackRepo.ts` - Inserts memory feedback events.
- `src/core/storage/memoryRepo.ts` - Adds importance update and transactional use-recording helpers.
- `src/core/retrieve/decay.ts` - Provides deterministic old-boost decay output.
- `src/core/api/contracts.ts` - Adds retrieval controls, score DTO schemas, and record-use contracts.
- `src/core/api/memoryCoreService.ts` - Maps retrieved score metadata and exposes `recordMemoryUsed`.
- `package.json` / `package-lock.json` - Adds `js-tiktoken`.
- `tests/integration/core/memory-feedback.spec.ts` - Verifies bounded boost and feedback persistence.
- `tests/unit/retrieve/importance-decay.spec.ts` - Verifies deterministic boost decay.
- `tests/integration/retrieve/retrieve-on-demand.spec.ts` - Verifies deep retrieval mode.
- `tests/integration/retrieve/retrieve-score-metadata.spec.ts` - Verifies score metadata inclusion.
- `tests/integration/storage/schema.spec.ts` - Verifies migration count and feedback table/index.

## Decisions Made

- Auto-use boosts increment by 1 and cap at 9. The plan specified a max bound but not the boost step, so a conservative single-step boost was used.
- Retrieval-only `semantic` and `score` fields were added through `retrieveMemoriesResponseSchema` instead of the base memory schema to avoid forcing list/export callers to provide retrieval metadata.

## Deviations from Plan

None - plan executed as written.

## Issues Encountered

None.

## Verification

- `npx vitest run tests/integration/core/memory-feedback.spec.ts tests/unit/retrieve/importance-decay.spec.ts tests/integration/retrieve/retrieve-on-demand.spec.ts tests/integration/retrieve/retrieve-score-metadata.spec.ts tests/integration/storage/schema.spec.ts --reporter=dot`
- `npm test`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can build token-budgeted startup injection on top of retrieval metadata and the installed `js-tiktoken` dependency. Feedback history and bounded use boosts are ready for adapter or CLI call sites.

## Self-Check: PASSED

- Found summary file.
- Found created migration, repository, decay helper, and focused tests.
- Found task commit `78bf747`.

---
*Phase: 03-injection-quality-token-control*
*Completed: 2026-06-03*

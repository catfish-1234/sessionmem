---
phase: 03-injection-quality-token-control
plan: 02
subsystem: core-injection
tags: [startup-injection, token-budget, retrieval, js-tiktoken, vitest]
requires:
  - phase: 03-injection-quality-token-control
    provides: retrieved-memory score metadata and js-tiktoken dependency
provides:
  - token counting helper backed by js-tiktoken o200k_base
  - deterministic startup injection formatter with grouped memory output
  - token-cap trimming that preserves critical warnings
affects: [injection-quality, token-control, adapters, cli-search]
tech-stack:
  added: []
  patterns: [retrieval DTO formatter, priority-based token trimming]
key-files:
  created:
    - src/core/injection/tokenBudget.ts
    - src/core/injection/formatStartupInjection.ts
    - tests/unit/injection/token-budget.spec.ts
    - tests/unit/injection/format-startup-injection.spec.ts
  modified: []
key-decisions:
  - "Warnings with importance >= 9 are treated as critical and preserved even when the formatted injection exceeds the token cap."
  - "Startup injection trims lower-priority content before dropping non-critical entries, using deterministic kind ordering for stable output."
patterns-established:
  - "Token-budget helpers accept priority/preserve metadata so future injection callers can reuse trimming semantics."
  - "Startup injection formatting consumes retrieved-memory DTOs directly to include score breakdown, source adapter, and update date."
requirements-completed: [RETR-03]
duration: 3min
completed: 2026-06-03
---

# Phase 03 Plan 02: Injection Formatter & Token Budget Summary

**Token-capped startup memory injection with deterministic grouping, score metadata, and critical-warning preservation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-03T23:59:35Z
- **Completed:** 2026-06-04T00:02:36Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- Added `countTokens` using `js-tiktoken` with `o200k_base`.
- Added `trimLowestPriorityContent` for priority-aware content trimming while respecting preserved entries.
- Added `formatStartupInjection` with fixed header, deterministic type grouping, score/source/date metadata, and configurable token cap.
- Added focused unit tests for token counting, trim ordering, deterministic formatter snapshots, and critical-warning preservation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Injection formatter and token budget helpers** - `7ac80c7` (feat)

## Files Created/Modified

- `src/core/injection/tokenBudget.ts` - Counts tokens with `js-tiktoken` and trims low-priority content.
- `src/core/injection/formatStartupInjection.ts` - Formats ranked retrieved memories into capped startup injection text.
- `tests/unit/injection/token-budget.spec.ts` - Verifies token counting and trim ordering.
- `tests/unit/injection/format-startup-injection.spec.ts` - Verifies deterministic formatter output and warning preservation.

## Decisions Made

- Warnings with importance `>= 9` are considered critical. This gives "critical warning" a concrete threshold while keeping non-critical warnings eligible for normal budget handling.
- The formatter trims content before dropping entries, and drops only non-preserved entries in lowest-priority kind order. This satisfies the cap while retaining as much high-priority context as practical.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Verification

- `npx vitest run tests/unit/injection/token-budget.spec.ts tests/unit/injection/format-startup-injection.spec.ts --reporter=dot`
- `npm test`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can build quality harness coverage on top of deterministic startup injection output and the reusable token budget helpers.

## Self-Check: PASSED

- Found summary file.
- Found created token budget helper, startup formatter, and focused unit tests.
- Found task commit `7ac80c7`.

---
*Phase: 03-injection-quality-token-control*
*Completed: 2026-06-03*

---
phase: 01-core-memory-engine-foundation
plan: 04
subsystem: api
tags: [contracts, zod, adapter, local-only, retrieval]
requires:
  - phase: 01-01
    provides: SQLite schema/repositories used by core service facade
  - phase: 01-03
    provides: retrieval ranking pipeline consumed by core API retrieval endpoint
provides:
  - "Strict host-agnostic core lifecycle API contracts and request/response maps"
  - "Stable domain error model with typed error envelopes"
  - "Memory core service facade with lifecycle operations and retrieval delegation"
  - "Local-only policy guard that blocks external providers without explicit opt-in"
affects: [adapters, retrieval, lifecycle, integration-tests]
tech-stack:
  added: []
  patterns: [typed request validation at API boundary, local-only policy gate, uniform error envelope]
key-files:
  created:
    - src/core/api/contracts.ts
    - src/core/api/errors.ts
    - src/core/api/localOnlyPolicy.ts
    - src/core/api/memoryCoreService.ts
    - src/adapters/contract/hostAdapterContract.ts
    - tests/integration/core/memory-core-service.spec.ts
    - tests/integration/core/local-only-policy.spec.ts
  modified:
    - src/core/api/memoryCoreService.ts
key-decisions:
  - "Validated all lifecycle requests with zod schemas at the service boundary."
  - "Kept error handling host-agnostic using `DomainError` + `{ ok:false, error }` envelopes."
  - "Applied local-only as default and required explicit opt-in to allow external providers."
patterns-established:
  - "Adapters call a single typed core API surface through shared request/response maps."
  - "Service operations return typed success payloads or a consistent error envelope."
requirements-completed: [CAPT-01, RETR-01, SECU-03]
duration: 6min
completed: 2026-05-25
---

# Phase 01 Plan 04: Core Memory Engine Foundation Summary

**Strict host-agnostic memory lifecycle API shipped with typed contracts, local-only provider gating, and integration-tested service facade behavior.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-25T21:44:00Z
- **Completed:** 2026-05-25T21:49:49Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Standardized lifecycle contract surface for ingest/summarize/store/retrieve/list/get/forget/export/import/stats.
- Implemented `createMemoryCoreService` with request validation, repository/retrieval delegation, and stable error envelopes.
- Added `assertLocalOnlyPolicy` and integration tests covering blocked external providers and explicit opt-in.

## Task Commits

1. **Task 1: Define strict core contracts and domain error model** - `71e5b25` (feat)
2. **Task 2: Implement memory core service and local-only policy guard** - `8ed8110` (feat)

Additional auto-fix commit during Task 2 verification:
- `2540100` (fix): retrieval query handoff bug fix

## Files Created/Modified

- `src/core/api/contracts.ts` - Typed zod schemas and lifecycle request/response maps.
- `src/core/api/errors.ts` - Domain error codes and envelope conversion.
- `src/adapters/contract/hostAdapterContract.ts` - Adapter contract mapping shared with core API.
- `src/core/api/localOnlyPolicy.ts` - Local-only policy guard with explicit opt-in allowance.
- `src/core/api/memoryCoreService.ts` - Core lifecycle facade and typed method dispatcher.
- `tests/integration/core/memory-core-service.spec.ts` - Contract + service flow integration coverage.
- `tests/integration/core/local-only-policy.spec.ts` - SECU-03 local-only policy integration coverage.

## Decisions Made

- Used a single service facade return shape (`ok: true` success or `ok: false` error envelope) for adapter-facing consistency.
- Enforced local-only guard at service initialization so non-compliant provider configs fail fast.
- Delegated retrieval operation to core retrieval pipeline instead of duplicating ranking logic in API layer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Retrieval pipeline query field mismatch**
- **Found during:** Task 2 verification (`memory-core-service.spec.ts`)
- **Issue:** Service passed `query` to retrieval path that expects explicit `queryText` in active pipeline call path.
- **Fix:** Updated service retrieval invocation to pass `queryText: parsed.query`.
- **Files modified:** `src/core/api/memoryCoreService.ts`
- **Verification:** `npx vitest run tests/integration/core/memory-core-service.spec.ts --reporter=dot`, full `npx vitest run --reporter=dot`
- **Committed in:** `2540100`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required for correctness; no scope creep.

## Issues Encountered

- Existing worktree already had unrelated package file changes; task commits were scoped to plan files only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Adapter and CLI layers can now call stable host-agnostic lifecycle operations.
- Local-only enforcement and typed error contracts are ready for downstream integration.

---
*Phase: 01-core-memory-engine-foundation*
*Completed: 2026-05-25*

## Self-Check: PASSED
- FOUND: `.planning/phases/01-core-memory-engine-foundation/01-04-SUMMARY.md`
- FOUND: `71e5b25`
- FOUND: `8ed8110`
- FOUND: `2540100`

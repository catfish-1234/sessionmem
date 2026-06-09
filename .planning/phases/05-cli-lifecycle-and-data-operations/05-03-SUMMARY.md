---
phase: 05-cli-lifecycle-and-data-operations
plan: "03"
subsystem: cli
tags: [cli, search, list, show, stats, table-output, key-value, token-counting, sqlite]

# Dependency graph
requires:
  - phase: 05-cli-lifecycle-and-data-operations
    plan: "01"
    provides: createCliContext, formatTable, formatKeyValue, cliTestContext helper
provides:
  - searchCommand: retrieveMemories -> ANSI-free table (CLI-03)
  - listCommand: listMemories -> ANSI-free table (CLI-04 read half)
  - showCommand: getMemory -> snake_case key:value lines, NOT_FOUND exits non-zero (CLI-04)
  - statsCommand: count + db_size_bytes + total_content_tokens (CLI-06 gap filled)
affects:
  - 05-04 (index.ts commander registration)
  - any plan that adds CLI read commands

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use service.call() not direct method for envelope-safe error handling in CLI commands"
    - "Injectable CliContext parameter pattern for all command functions (default to createCliContext())"
    - "D-03 envelope unwrap: if (!result.ok) { console.error(result.error.message); process.exit(1); }"
    - "Stats gap-fill: statSync(dbPath).size + listMemoriesByProject().reduce(countTokens)"

key-files:
  created: []
  modified:
    - src/cli/commands/search.ts
    - src/cli/commands/list.ts
    - src/cli/commands/show.ts
    - src/cli/commands/stats.ts
    - tests/integration/cli/search.spec.ts
    - tests/integration/cli/data-commands.spec.ts
    - tests/unit/cli/stats.spec.ts
    - tests/unit/cli/error-contract.spec.ts

key-decisions:
  - "Used service.call() instead of direct method calls to get error envelope (DomainError is thrown, not returned, by direct methods)"
  - "Passed mode='auto' and depth='default' explicitly in retrieveMemories call (TS requires full output type after Zod defaults)"
  - "showCommand uses process.stdout.write for key:value output; search/list use console.log for table"

patterns-established:
  - "CLI commands use service.call() for safe envelope-based error handling"
  - "All read commands accept optional injectable ctx parameter for test isolation"

requirements-completed: [CLI-03, CLI-04, CLI-06]

# Metrics
duration: 4min
completed: 2026-06-09
---

# Phase 5 Plan 03: Read/Query CLI Surface Summary

**search/list/show/stats CLI commands wired to memoryCoreService via service.call() with ANSI-free table/key:value output and CLI-06 stats gap filled (db_size_bytes + total_content_tokens)**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-09T18:54:08Z
- **Completed:** 2026-06-09T18:58:24Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Implemented all four read commands (search, list, show, stats) as thin formatters over existing memoryCoreService methods
- Filled CLI-06 gap in stats: added `db_size_bytes` via `statSync` and `total_content_tokens` via `countTokens` aggregation
- Replaced all `it.todo` placeholders with 14 real assertions across 4 test files
- All commands follow D-03 error contract: print only `error.message` to stderr, exit non-zero on failure

## Task Commits

1. **Task 1: Implement search and list (table output)** - `7582dee` (feat)
2. **Task 2: Implement show and stats (key:value + metrics)** - `909ffe1` (feat)

## Files Created/Modified

- `src/cli/commands/search.ts` - searchCommand: call("retrieveMemories") -> formatTable, injectable ctx
- `src/cli/commands/list.ts` - listCommand: call("listMemories") -> formatTable, injectable ctx
- `src/cli/commands/show.ts` - showCommand: call("getMemory") -> formatKeyValue, NOT_FOUND exits non-zero
- `src/cli/commands/stats.ts` - statsCommand: stats + statSync + countTokens aggregate
- `tests/integration/cli/search.spec.ts` - 4 integration tests (ranked output, limit, empty, error path)
- `tests/integration/cli/data-commands.spec.ts` - 5 integration tests (list: 2, show: 3)
- `tests/unit/cli/stats.spec.ts` - 2 unit tests (normal output, service error path)
- `tests/unit/cli/error-contract.spec.ts` - 3 unit tests verifying D-03 contract

## Decisions Made

- Used `service.call()` instead of direct method calls: direct service methods (e.g., `getMemory`) throw `DomainError` for NOT_FOUND rather than returning an error envelope. Using `service.call()` ensures the envelope `{ ok: false, error: { code, message } }` is always returned, enabling the uniform D-03 error contract.
- Passed `mode: "auto"` and `depth: "default"` explicitly in `retrieveMemories` call: `MemoryCoreRequest<"retrieveMemories">` uses the Zod output type (after `.default()` transforms), requiring these fields even though they have defaults at parse time.
- `showCommand` uses `process.stdout.write` (matching the stats pattern from PATTERNS.md); `search` and `list` use `console.log` (both produce identical output, difference is stylistic alignment with the plan spec).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Direct service methods throw instead of returning error envelope**
- **Found during:** Task 1 (search/list implementation)
- **Issue:** The plan's interface spec shows `getMemory -> { ok, memory }` with `NOT_FOUND -> DomainError envelope`, but the service's direct method throws `DomainError` — only `service.call()` catches and converts to the `{ ok: false, error: {...} }` envelope. Attempting `if (!result.ok)` check after direct method call caused TS type error (`error` not in success type).
- **Fix:** Used `service.call(method, request)` throughout all four commands for uniform envelope handling
- **Files modified:** search.ts, list.ts, show.ts, stats.ts
- **Verification:** All 14 tests pass including NOT_FOUND path via data-commands.spec.ts and error-contract.spec.ts
- **Committed in:** 7582dee, 909ffe1

**2. [Rule 1 - Bug] retrieveMemories requires mode/depth fields in TypeScript**
- **Found during:** Task 1 (build verification)
- **Issue:** `MemoryCoreRequest<"retrieveMemories">` is the Zod output type (post-transform), which requires `mode` and `depth` even though Zod schema has `.default()` values. TypeScript rejected `{ projectId, query, limit }` without them.
- **Fix:** Added `mode: "auto", depth: "default"` explicitly to the call
- **Files modified:** src/cli/commands/search.ts
- **Verification:** `npm run build` exits 0
- **Committed in:** 7582dee

---

**Total deviations:** 2 auto-fixed (both Rule 1 - Bug fixes during build verification)
**Impact on plan:** Both fixes necessary for type safety and correct error handling. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## Known Stubs

None - all commands are fully wired to real service methods and produce real output.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced. All inputs flow through existing Zod schemas at the service boundary (T-05-07 covered). Stats reads DB file metadata and content — within the T-05-09 accepted risk (user reading their own DB, no new exposure).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- search, list, show, stats commands are ready for registration in `src/cli/index.ts` (Plan 04/05)
- All commands accept injectable context for testing
- D-03 error contract is unit-tested and consistently applied

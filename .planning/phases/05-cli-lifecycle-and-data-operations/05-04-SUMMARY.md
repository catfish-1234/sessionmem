---
phase: 05-cli-lifecycle-and-data-operations
plan: 04
subsystem: cli
tags: [cli, forget, export, import, dry-run, json, round-trip]

# Dependency graph
requires:
  - phase: 05-01
    provides: createCliContext, CliContext interface, service.call() envelope wrapper
  - phase: 01-core-memory-engine-foundation
    provides: memoryCoreService (getMemory, forgetMemory, exportMemories, importMemories), listMemoriesByProject

provides:
  - forget command with D-09 dry-run default (--force required to delete)
  - export command writing D-10 JSON array to D-11 ISO-dated default path (V12 path resolution)
  - import command with D-12 skip-duplicate default and --merge upsert override
  - lossless export/import round-trip (CLI-05)
  - tests for all three commands in dedicated spec files

affects: [05-05, 05-06, cli-index-registration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Use service.call() envelope wrapper for error handling in CLI commands (consistent { ok, error } pattern)"
    - "D-09 dry-run gating: getMemory preview without forgetMemory call unless --force"
    - "D-12 pre-filter skip: listMemoriesByProject to build existing-ID Set before importMemories"
    - "V12 path security: resolve() all user-supplied paths before file I/O"

key-files:
  created:
    - src/cli/commands/forget.ts
    - src/cli/commands/export.ts
    - src/cli/commands/import.ts
    - tests/integration/cli/forget.spec.ts
    - tests/integration/cli/export-import.spec.ts
  modified: []

key-decisions:
  - "Used service.call() over direct method calls to get consistent { ok, error } envelope — direct method calls throw DomainError, which bypasses the CLI error-handling pattern"
  - "Skip mode pre-filters at CLI layer before calling importMemories, keeping the service upsert-only and avoiding a parallel SQL path (D-12)"
  - "Export default path computed at call time with new Date() to always reflect the current day"

patterns-established:
  - "service.call(method, request) pattern: CLI commands must use call() not direct method access for error envelope handling"
  - "D-09 dry-run gating: check without mutate (getMemory), then return with preview; only mutate with explicit --force"

requirements-completed: [CLI-04, CLI-05]

# Metrics
duration: 3min
completed: 2026-06-09
---

# Phase 5 Plan 04: Forget, Export, Import CLI Commands Summary

**Destructive/data-transfer CLI surface with safe-by-default gating: forget dry-runs by default (D-09), export writes a lossless JSON array (D-10/D-11), import skips duplicates unless --merge (D-12), round-trip tested (CLI-05).**

## Performance

- **Duration:** 3min
- **Started:** 2026-06-09T18:54:24Z
- **Completed:** 2026-06-09T18:57:00Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Implemented `forgetCommand(id, options, ctx?)` with D-09 dry-run default: calls `getMemory` for a 60-char preview, prints "Would delete: ... Pass --force to confirm.", exits 0 without deleting; `--force` path calls `forgetMemory` and confirms deletion
- Implemented `exportCommand(pathArg, ctx?)` writing a pretty-printed JSON array via `exportMemories`; default path is `~/.sessionmem/export-{ISO-date}.json`; user path resolved with `path.resolve` (V12 security)
- Implemented `importCommand(pathArg, options, ctx?)` with D-12 skip mode (pre-filters existing IDs via `listMemoriesByProject`) and `--merge` mode (passes all records to upsert); malformed/non-array JSON exits non-zero with stderr message (T-05-11 mitigation)
- 12 passing integration tests: forget dry-run non-deletion, force-deletion, not-found exit, forgetMemory not called on dry-run; export file count/path, lossless round-trip, skip duplicate count, merge overwrite, missing file, malformed JSON, non-array JSON

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement forget (dry-run default, --force) with test** - `2c16b1a` (feat)
2. **Task 2: Implement export and import (round-trip, skip vs --merge) with test** - `ab8b1cf` (feat)

## Files Created/Modified

- `src/cli/commands/forget.ts` - forget command: D-09 dry-run default via getMemory preview; --force path via forgetMemory; uses service.call() for error envelope
- `src/cli/commands/export.ts` - export command: exportMemories -> JSON.stringify -> writeFileSync; path.resolve for user paths; ISO-dated default path
- `src/cli/commands/import.ts` - import command: readFileSync + JSON.parse; listMemoriesByProject for existing-ID pre-filter; --merge bypasses filter; importMemories upsert
- `tests/integration/cli/forget.spec.ts` - 4 integration tests: dry-run non-deletion, force-deletion, not-found exit, forgetMemory not called on dry-run
- `tests/integration/cli/export-import.spec.ts` - 8 integration tests: export count/path, lossless round-trip, skip duplicates, merge overwrite, missing file, malformed JSON, non-array JSON

## Threat Mitigations Applied

| Threat ID | Mitigation Applied |
|-----------|--------------------|
| T-05-10 | `path.resolve(pathArg)` in both export and import; write only to the explicit resolved path |
| T-05-11 | `JSON.parse` wrapped in try/catch with stderr message + exit 1; non-array guard with stderr + exit 1; invalid schema records rejected by importMemoriesRequestSchema in service |
| T-05-12 | D-09: bare `forget` calls only `getMemory` for preview; `forgetMemory` only called with explicit `--force` |
| T-05-13 | D-12: default import pre-filters existing IDs; only `--merge` enables overwrite |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used service.call() instead of direct method access**
- **Found during:** Task 1 (test failure on forget not-found path)
- **Issue:** Plan interfaces showed `getMemory({ projectId, memoryId }) -> { ok, memory }` suggesting direct calls return envelopes. In reality, `service.getMemory(...)` is the raw method that throws DomainError — only `service.call("getMemory", ...)` returns the `{ ok, error }` envelope.
- **Fix:** Changed both forget.ts and the import/export commands to use `service.call(method, request)` consistently.
- **Files modified:** `src/cli/commands/forget.ts` (also propagated to export.ts and import.ts)
- **Commit:** 2c16b1a

## Self-Check: PASSED

Files verified present:
- `src/cli/commands/forget.ts` - FOUND
- `src/cli/commands/export.ts` - FOUND
- `src/cli/commands/import.ts` - FOUND
- `tests/integration/cli/forget.spec.ts` - FOUND
- `tests/integration/cli/export-import.spec.ts` - FOUND

Commits verified present:
- `2c16b1a` - FOUND (feat(05-04): implement forget command)
- `ab8b1cf` - FOUND (feat(05-04): implement export and import commands)

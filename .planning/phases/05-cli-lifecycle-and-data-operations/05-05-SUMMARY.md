---
phase: 05-cli-lifecycle-and-data-operations
plan: 05
subsystem: cli
tags: [cli, commander, bugfix, regression-test, gap-closure]
requires:
  - "05-01: CliContext test-injection seam + createCliContext"
  - "05-03: search/list/show commands"
  - "05-04: forget/export/import/stats commands"
provides:
  - "CLI-03: working `sessionmem search` via the real binary"
  - "CLI-04: working `sessionmem list`/`show`/`forget` via the real binary"
  - "CLI-05: lossless `sessionmem export`/`import` round-trip via the real binary"
  - "CLI-06: working `sessionmem stats` via the real binary"
  - "SESSIONMEM_DB_PATH / SESSIONMEM_PROJECT_ID env override seam for spawned-binary tests"
  - "end-to-end commander-dispatch regression spec"
affects:
  - src/cli/index.ts
  - src/cli/commands/search.ts
  - src/cli/context.ts
tech-stack:
  added: []
  patterns:
    - "arrow-wrap commander .action handlers to drop commander's injected trailing Command argument"
    - "env-var injection (SESSIONMEM_DB_PATH/SESSIONMEM_PROJECT_ID) for spawned-process test isolation"
    - "child_process execFile of the built binary as a regression harness"
key-files:
  created:
    - tests/integration/cli/cli-entrypoint.spec.ts
  modified:
    - src/cli/index.ts
    - src/cli/commands/search.ts
    - src/cli/context.ts
decisions:
  - "Fix the ctx-collision at the registration site (arrow-wrappers) rather than changing every command's signature — keeps the test-injection ctx seam intact and the public command surface unchanged."
  - "Inject test DB config via env vars (SESSIONMEM_DB_PATH/SESSIONMEM_PROJECT_ID) instead of a CLI flag, so the spawned binary stays deterministic without expanding the command surface."
  - "Coerce search --limit with Number.parseInt + finite/positive guard, defaulting to 20; service zod schema remains defense-in-depth."
metrics:
  duration: ~10m
  completed: 2026-06-09
  tasks: 2
  files: 4
---

# Phase 5 Plan 5: CLI Commander-Dispatch Gap Closure Summary

Fixed the shared root-cause BLOCKER from 05-VERIFICATION.md: commander's injected trailing `Command` object was landing in each command's `ctx?` slot, making `ctx.service` undefined and crashing search/list/show/forget/export/import/stats with `TypeError: Cannot read properties of undefined (reading 'call')`. Restored all 7 commands via the real binary, fixed the `--limit` string-vs-number defect, and added a spawning regression spec that exercises commander's real dispatch.

## What Was Built

### Task 1: Commander action wiring + --limit coercion
- `src/cli/index.ts`: changed the seven affected `.action(xCommand)` registrations to arrow-wrapped handlers (`.action((query, options) => searchCommand(query, options))`, etc.) that forward only the real positional args/options. Commander's trailing `Command` instance is dropped, so each command's `ctx?` stays `undefined` and production falls through to `createCliContext()`. The run/install/uninstall/ping registrations (no trailing ctx) were left unchanged.
- `src/cli/commands/search.ts`: widened `SearchOptions.limit` to `number | string` (commander supplies strings) and added a `coerceLimit()` helper that parses with `Number.parseInt(..., 10)` and falls back to the default of 20 for absent/NaN/non-positive values. The numeric result is passed to `retrieveMemories`, so the zod `z.number().int()` schema no longer receives a string. (Mitigates threat T-05-14.)
- `src/cli/context.ts`: added a production-safe env override seam — `deriveProjectId()` honors `SESSIONMEM_PROJECT_ID` and `createCliContext()` honors `SESSIONMEM_DB_PATH`, both defaulting to the existing behavior (`~/.sessionmem/memories.db` and cwd-basename). Needed so a spawned binary can target an isolated DB. (Threat T-05-15, disposition: accept — operator-controlled env var, no privilege boundary crossed.)

### Task 2: End-to-end spawning regression spec
- `tests/integration/cli/cli-entrypoint.spec.ts`: spawns `node dist/cli/index.js` via `child_process.execFile` (using `process.execPath`) against isolated temp DBs seeded through the env override seam. One test per command: search, search --limit, list, show (found + missing), stats, forget (dry-run + --force), and an export→import round-trip that re-opens the destination DB and asserts the exported ids landed losslessly. Every assertion checks the absence of `Cannot read properties of undefined` in combined stdout+stderr, so the commander-dispatch class of bug now fails the suite if reintroduced. A top-of-file guard throws a legible message if `dist/cli/index.js` is missing.

## Verification Results

- `npm run build` — exit 0
- `node dist/cli/index.js search "x" --limit 5` — exit 0, prints table header, no TypeError, no zod error
- `npx vitest run tests/integration/cli/search.spec.ts` — 4 passed (existing numeric `{ limit: 1 }` / `{}` callers still work)
- `npx vitest run tests/integration/cli/cli-entrypoint.spec.ts` — 8 passed
- `npm test` (full suite) — 34 files, 143 passed, 0 failures (135 prior + 8 new)

## Deviations from Plan

### Auto-fixed / plan-sanctioned additions

**1. [Rule 3 - Blocking] Added env override seam to src/cli/context.ts**
- **Found during:** Task 2 (planned conditional per the task's "If it does NOT, add a minimal override hook" instruction)
- **Issue:** `createCliContext` had no env-var mechanism to point a spawned process at an isolated DB; spawning the binary against the real `~/.sessionmem` would be non-deterministic and unsafe.
- **Fix:** Added `SESSIONMEM_DB_PATH` / `SESSIONMEM_PROJECT_ID` reads with defaults preserved.
- **Files modified:** src/cli/context.ts (added to files_modified beyond the plan's original list of index.ts/search.ts/spec)
- **Commit:** e5bbd2b

No other deviations — both tasks executed as written.

## Known Stubs

None.

## Threat Flags

None — no new security surface beyond the env-override seam already enumerated in the plan's threat model (T-05-15, accepted).

## Commits

- e5bbd2b: fix(05-05): drop commander Command from ctx slot + coerce search --limit
- 3759cac: test(05-05): spawn dist/cli/index.js end-to-end for all 7 commands

## Self-Check: PASSED
- FOUND: src/cli/index.ts
- FOUND: src/cli/commands/search.ts
- FOUND: src/cli/context.ts
- FOUND: tests/integration/cli/cli-entrypoint.spec.ts
- FOUND: commit e5bbd2b
- FOUND: commit 3759cac

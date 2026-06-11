---
phase: 07-team-mode-shared-memory
plan: 05
subsystem: cli
tags: [cli, search, provenance, author-annotation, gap-closure, vitest]

requires:
  - phase: 07-team-mode-shared-memory
    provides: retrieveMemories response startupInjection field (CR-01, commit 5b5f24e)
  - phase: 07-team-mode-shared-memory
    provides: author-aware formatStartupInjection (Plan 04, D-10)
provides:
  - search CLI output that prints result.startupInjection (author-annotated block)
  - end-to-end integration test proving the author: prefix reaches real search output
affects: [provenance-display, cli-search]

tech-stack:
  added: []
  patterns:
    - "Two-service-over-one-db test pattern: seed via username:alice service, query via a second createMemoryCoreService({ db, username: bob }) so local username differs from stored author"
    - "Combined-output assertion: join logSpy.mock.calls across all console.log calls instead of assuming a single call"

key-files:
  created: []
  modified:
    - src/cli/commands/search.ts
    - tests/integration/cli/search.spec.ts

key-decisions:
  - "Print result.startupInjection as a second console.log after the table — do not re-render formatStartupInjection; the response field is already the rendered string."
  - "Existing table/limit/empty tests now read joined output across all console.log calls; --limit bound scoped to TABLE rows (lines containing ' | ') so the injection block does not inflate the count."

patterns-established:
  - "Surface pre-computed response fields at the CLI boundary rather than recomputing them, keeping the formatter the single source of truth."

requirements-completed: [TEAM-02]

duration: 4 min
completed: 2026-06-11
---

# Phase 7 Plan 5: Surface startupInjection in Search Output (TEAM-02 Gap Closure)

**The `search` command now prints `result.startupInjection` after the result table, making the D-10 `author:` provenance annotation observable in real CLI output and closing the single TEAM-02 verification gap where the annotation was computed but discarded.**

## Performance

- **Duration:** ~4 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `src/cli/commands/search.ts` adds a second `console.log(result.startupInjection)` after the table in the success path (after the `!result.ok` guard). The error path, options coercion, and the `service.call` request shape are untouched. No ANSI color (Phase 5 D-07); no re-render of the formatter.
- New integration test seeds a memory authored by `alice`, constructs a second `createMemoryCoreService({ db, username: "bob" })` over the SAME db, runs `searchCommand` with the bob context, and asserts the printed output contains `alice: ` and `pnpm` — proving the teammate prefix reaches production output.
- New local-author control test seeds a `bob`-authored memory, searches through the same `bob` service, and asserts NO `bob: ` prefix appears.
- The three pre-existing tests (table / --limit / empty) no longer call `toHaveBeenCalledOnce()`; they read combined output across all `console.log` calls via a `printed()` helper. The `--limit` bound is scoped to table rows (lines containing `" | "`) so the injection block does not inflate the count.

## Task Commits

1. **Task 1: Author-prefix integration tests + update existing assertions** - `test(07-05): add author-prefix integration tests for search output (TEAM-02)` (RED: teammate-author test failed as expected)
2. **Task 2: Print result.startupInjection from search command** - `feat(07-05): print result.startupInjection from search command (TEAM-02)` (GREEN: all 6 tests pass)

## Files Created/Modified
- `src/cli/commands/search.ts` - print `result.startupInjection` after the table
- `tests/integration/cli/search.spec.ts` - teammate-author prefix test, local-author no-prefix control, and the three existing tests updated to multi-`console.log` output

## Decisions Made
See `key-decisions` frontmatter. Headline: surface the already-rendered `startupInjection` string at the CLI boundary; do not recompute the formatter. Keep the formatter the single source of truth for the `author:` annotation.

## Deviations from Plan
None. Scope guard honored — no edits to `team.ts`, `sync.ts`, `memoryCoreService.ts`, `contracts.ts`, or `formatStartupInjection.ts`.

## Issues Encountered
- Worktree started with no `node_modules`; ran `npm install` (88 packages) before tests.
- The long-standing `cli-entrypoint.spec.ts` requires a built `dist/`; resolved by `npm run build` (same as prior waves). Not related to this change.

## User Setup Required
None.

## Next Phase Readiness
- TEAM-02 gap closed: the `author:` provenance annotation (D-10) is now reachable from the real `search` CLI command and proven by an end-to-end integration test.
- Locally-authored memories still render without an author prefix.
- This is the gap-closure wave for Phase 7; no downstream plan depends on it.

## Self-Check: PASSED
- `npx vitest run tests/integration/cli/search.spec.ts` → 6 passed.
- `grep` confirms `result.startupInjection` in `src/cli/commands/search.ts`; zero `toHaveBeenCalledOnce()` remain in the spec.
- Full suite green after `npm run build` (270 passed / 8 skipped, plus 8 entrypoint tests after build; 0 failures).
- `tsc` build clean. Each task committed atomically; SUMMARY committed separately.

---
*Phase: 07-team-mode-shared-memory*
*Completed: 2026-06-11*

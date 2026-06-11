---
phase: 07-team-mode-shared-memory
plan: 04
subsystem: injection
tags: [injection, provenance, author-annotation, docs, team-mode, vitest]

requires:
  - phase: 07-team-mode-shared-memory
    provides: RetrievedMemoryCandidate.author (Plan 01)
  - phase: 07-team-mode-shared-memory
    provides: sessionmem sync + team enable/disable/status commands + D-16 summary (Plan 03)
provides:
  - author-aware formatStartupInjection (localUsername option + author prefix on teammate rows)
  - docs/team-mode.md (setup, sync, provenance, conflict, disable/recovery, trust boundary, failure recovery)
  - author-annotation unit spec + team-docs coverage spec
affects: [provenance-display]

tech-stack:
  added: []
  patterns:
    - "Author prefix gated on three conditions (author non-empty AND localUsername set AND differs) so a missing localUsername never mis-attributes"
    - "Doc-coverage smoke test asserting command/topic tokens, modeled on privacy-docs.spec.ts"

key-files:
  created:
    - docs/team-mode.md
    - tests/unit/injection/author-annotation.spec.ts
    - tests/integration/docs/team-docs.spec.ts
  modified:
    - src/core/injection/formatStartupInjection.ts

key-decisions:
  - "localUsername threaded through render -> formatLine via an explicit arg (not a closure) to keep the trim/render loop unchanged."
  - "Author prefix only emitted when author is non-empty, localUsername is set, and they differ (D-10); legacy empty-author rows and local rows render unchanged."
  - "Doc-coverage test asserts a lowercase 'last-write-wins' token; the doc spells the conflict rule both ways so the smoke test stays stable against capitalization."

patterns-established:
  - "Provenance display gating: never annotate when the local identity is unknown, to avoid wrong attribution."

requirements-completed: [TEAM-02]

duration: 3 min
completed: 2026-06-11
---

# Phase 7 Plan 4: Author Annotation + Team Mode Docs Summary

**`formatStartupInjection` now prefixes a retrieved memory's content with `${author}: ` only when the memory's author differs from the local username (D-10), and `docs/team-mode.md` documents setup, sync, provenance, conflict handling, disable/recovery, and the shared-path trust boundary — both guarded by new specs.**

## Performance

- **Duration:** ~3 min
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- `FormatStartupInjectionOptions` gains `localUsername?: string`; threaded through `formatStartupInjection -> render -> formatLine`.
- New `authorPrefix` helper emits `${author}: ` only when `author` is non-empty AND `localUsername` is set AND `author !== localUsername`; otherwise content renders unchanged (local rows, empty-author legacy rows, and the no-localUsername safe default all get no prefix). Sorting, token-budget trimming, and the HEADER are untouched.
- `docs/team-mode.md` documents: setup (`team enable <path>`, per-project/per-user `{sharedPath}/{project_id}/{username}.json` layout, `team status`), sync usage with the exact D-16 summary string, provenance + author annotation, conflict behavior (last-write-wins by id, importance-preserve when locally higher, cross-project skip, re-redaction), disable with/without data loss (`team disable` / `--remove-team-memories`), the trust boundary (author is advisory, OS ACLs are the real boundary, T-07-11), and failure recovery (bad path -> stderr + non-zero exit; corrupt file/record skipped without aborting).
- Two new specs: `author-annotation.spec.ts` (4 behaviors) and `team-docs.spec.ts` (doc existence + command/topic token coverage).

## Task Commits

1. **Task 1: Author annotation in startup injection** - `feat(injection): annotate teammate-authored memories with author prefix`
2. **Task 2: Team mode documentation + doc-coverage test** - `docs(team): document team mode setup, sync, and trust boundary`

## Files Created/Modified
- `src/core/injection/formatStartupInjection.ts` - localUsername option + authorPrefix helper, threaded through render/formatLine
- `docs/team-mode.md` - team mode user documentation (setup through failure recovery)
- `tests/unit/injection/author-annotation.spec.ts` - 4 annotation behaviors (prefix-when-differs, no-prefix-when-equal, no-prefix-empty-author, no-prefix-no-localUsername)
- `tests/integration/docs/team-docs.spec.ts` - doc-coverage smoke test

## Decisions Made
See `key-decisions` frontmatter. Headline: the author prefix is gated on three conditions so a missing local identity never produces a wrong attribution; legacy/local rows render unchanged.

## Deviations from Plan
None of substance. Minor: the doc-coverage test asserts a lowercase `last-write-wins` token, so the conflict bullet in the doc spells the rule both ways ("Last-write-wins by id (last-write-wins)") to keep the smoke test stable against capitalization.

## Issues Encountered
None. Full suite green after `npm run build` (the long-standing `cli-entrypoint.spec.ts` build-artifact dependency, documented in Waves 1-3, resolves the same way).

## User Setup Required
None.

## Next Phase Readiness
- TEAM-02 delivered: teammate-authored memories are visibly attributed in injected context, and users have setup + failure-recovery docs (success criterion 5).
- This is the final wave of Phase 7; no downstream plan depends on it.

## Self-Check: PASSED
- All four files present on disk; both new specs green (4/4 and 4/4).
- `formatStartupInjection.ts` contains the `author`/`localUsername` conditional; `npx tsc --noEmit` clean.
- Full suite: 276 passed / 52 files (after `npm run build`).
- Each task committed atomically (Task 1, Task 2); SUMMARY committed separately.

---
*Phase: 07-team-mode-shared-memory*
*Completed: 2026-06-11*

---
phase: 07-team-mode-shared-memory
plan: 03
subsystem: cli
tags: [team-mode, sync, sqlite, upsert, lww, redaction, zod, commander, provenance]

requires:
  - phase: 07-team-mode-shared-memory
    provides: author/origin_project_id columns + importMemoryRecordSchema optional author/originProjectId + CliContext.username
  - phase: 07-team-mode-shared-memory
    provides: team config section (team.enabled/sharedPath) + readPolicyConfig team + resolveTeamConfig
  - phase: 06-security-privacy-and-retention-hardening
    provides: importMemories ON CONFLICT(id) upsert + ownerStmt cross-project skip + applyRedaction
  - phase: 05-cli-lifecycle-and-data-operations
    provides: export.ts/import.ts CLI structure + CliContext seam + defensive JSON.parse skip-and-warn
provides:
  - pullMemories service method (MAX-importance LWW merge + author/origin stamping + cross-project skip + re-redaction)
  - pullMemoriesRequestSchema / pullMemoriesResponseSchema with pulledNew/pulledUpdated counts
  - sessionmem sync CLI command (atomic push snapshot + multi-file teammate pull) registered in index.ts
  - importMemoryRecordSchema author/originProjectId now nullable (exported-snapshot round-trip)
  - createTeamUserContext + withSharedDir two-user test fixtures
affects: [injection-annotation, provenance-display, team-docs]

tech-stack:
  added: []
  patterns:
    - "Team pull as a structural twin of importMemories with three deltas: MAX-importance, provenance stamping, new-vs-updated counting"
    - "Atomic shared-path write = temp file in same dir + renameSync (network-drive safe)"
    - "Per-file + per-record skip-and-warn on the teammate-JSON trust boundary (one bad file never aborts the pull)"

key-files:
  created:
    - src/cli/commands/sync.ts
    - tests/unit/core/pull-merge.spec.ts
    - tests/integration/cli/sync.spec.ts
  modified:
    - src/core/api/contracts.ts
    - src/core/api/memoryCoreService.ts
    - src/cli/index.ts
    - tests/helpers/cliTestContext.ts

key-decisions:
  - "pullMemories uses importance = MAX(memories.importance, excluded.importance) in DO UPDATE — accepted by better-sqlite3@12's bundled SQLite (A2 confirmed, no JS fallback needed)."
  - "origin_project_id on a pulled row = record.originProjectId ?? record.projectId (its source-machine project_id); local project_id stays the pulling user's projectId so rows are retrievable locally (Open Q4)."
  - "importMemoryRecordSchema.author/originProjectId made .nullable() because exportMemories emits author='' / originProjectId=null for local rows — a team sync round-trips exported snapshots verbatim, so null must validate, not skip-and-warn."
  - "sync push is atomic (temp .json.tmp + renameSync in the project dir) so a teammate never reads a half-written snapshot off a network drive (Pitfall 4 / T-07-12)."
  - "Pull collects valid records across ALL teammate files then makes a SINGLE pullMemories call; new-vs-updated counts come from per-id ownerStmt snapshot for the D-16 summary."

patterns-established:
  - "Trust-boundary hardening for shared-filesystem input: readdirSync enumeration (no path injection), per-file JSON.parse try/catch + Array.isArray guard, per-record safeParse skip-and-warn; write paths built only from local projectId/username via path.join."

requirements-completed: [TEAM-01]

duration: 5 min
completed: 2026-06-11
---

# Phase 7 Plan 3: Core Team Sync (push + pull/merge) Summary

**`sessionmem sync` pushes an atomic full snapshot to `{sharedPath}/{projectId}/{username}.json` and merges every teammate snapshot into the local DB via a new `pullMemories` upsert (MAX-importance LWW + author/origin stamping + cross-project skip + re-redaction), printing the D-16 summary.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-11T02:53:00Z
- **Completed:** 2026-06-11T02:58:00Z
- **Tasks:** 2
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments
- `pullMemories` service method: a structural twin of `importMemories` that changes `importance = MAX(memories.importance, excluded.importance)` (D-11), stamps `author`/`origin_project_id` from incoming provenance (D-06), keeps the `ownerStmt` cross-project id skip (D-09), re-runs `applyRedaction` on every record (D-12), and returns `pulledNew`/`pulledUpdated`/`skippedCrossProject` for the D-16 summary.
- `pullMemoriesRequestSchema` + `pullMemoriesResponseSchema` registered in the method/request/response type maps.
- `sessionmem sync` command (`src/cli/commands/sync.ts`): no-ops when team mode is off (D-13), pushes an atomic snapshot (temp-file + `renameSync`, Pitfall 4), pulls every other `*.json` in the project dir (skip-and-warn on corrupt/non-array files, T-07-03), and prints `Pushed N memories, pulled M new + updated K from teammates.`
- Registered arrow-wrapped `program.command("sync")` in `index.ts`.
- `importMemoryRecordSchema.author/originProjectId` made nullable so exported snapshots (author `""`, originProjectId `null`) round-trip through a team sync without skip-and-warn.
- Two-user test fixtures (`createTeamUserContext`, `withSharedDir`) added to `cliTestContext.ts`.

## Task Commits

1. **Task 1: pullMemories service method + pull request contract** - `fa51fcc` (feat)
2. **Task 2: sync CLI command (push + pull) + two-user test helper** - `bdc4771` (feat)

_Note: both TDD tasks — failing-first behavior captured in pull-merge.spec.ts and sync.spec.ts; implementation committed alongside each task's tests._

## Files Created/Modified
- `src/cli/commands/sync.ts` - syncCommand: team-disabled no-op, atomic push, multi-file teammate pull, D-16 summary
- `src/core/api/memoryCoreService.ts` - pullMemories method (MAX-importance upsert + provenance stamping + cross-project skip + re-redaction)
- `src/core/api/contracts.ts` - pullMemoriesRequest/Response schemas + type-map registration; nullable author/originProjectId on importMemoryRecordSchema
- `src/cli/index.ts` - arrow-wrapped `sync` command registration
- `tests/helpers/cliTestContext.ts` - createTeamUserContext + withSharedDir fixtures
- `tests/unit/core/pull-merge.spec.ts` - LWW + cross-project skip, importance-preserve (both directions), redaction-on-pull, provenance, new-vs-updated counts
- `tests/integration/cli/sync.spec.ts` - team-disabled no-op, atomic push/idempotency, two-user round-trip, exact D-16 string, bad-path non-zero exit, corrupt-file skip

## Decisions Made
See `key-decisions` frontmatter. Headlines: SQLite `MAX(col, excluded.col)` works in `DO UPDATE` on better-sqlite3@12 (no JS fallback); `origin_project_id` falls back to the record's incoming `projectId`; `importMemoryRecordSchema` author/originProjectId made nullable for export-snapshot round-trip; push is temp-file-then-rename atomic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Made importMemoryRecordSchema author/originProjectId nullable**
- **Found during:** Task 2 (two-user round-trip)
- **Issue:** The plan threads exported snapshots through `importMemoryRecordSchema.safeParse` on pull. `exportMemories` (via `toMemoryDto`) emits `originProjectId: null` (and `author: ""`) for locally-authored rows, but the Plan-01 schema declared `author/originProjectId` as `z.string().optional()`, which REJECTS `null`. Every local row failed validation and was skip-and-warned, so no memories ever pulled — the round-trip, summary, and corrupt-file tests all failed because zero valid records reached `pullMemories`.
- **Fix:** Changed both fields to `z.string().nullable().optional()`. The service already coalesces a null/empty author to the local username and `originProjectId ?? projectId`, so nullability is handled downstream without further change.
- **Files modified:** src/core/api/contracts.ts
- **Verification:** sync.spec.ts two-user round-trip + D-16 summary + corrupt-file tests pass; full suite + tsc clean; no regression in export-import.spec.ts or pull-merge.spec.ts.
- **Committed in:** bdc4771 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Necessary for the planned pull path to function at all — the plan explicitly reuses the import schema on export snapshots, which carry nulls. No scope creep; the change is backward-compatible (optional + nullable).

## Issues Encountered
None beyond the pre-existing build-artifact dependency: `tests/integration/cli/cli-entrypoint.spec.ts` requires `npm run build` to produce `dist/cli/index.js`. After `npm run build`, it passes 8/8 (the new `sync` command registers cleanly in the built CLI). This is the same dependency documented in the Wave 1 and Wave 2 summaries, not a regression from this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TEAM-01 is delivered: teammates can share memory through a shared filesystem path via `sessionmem sync`.
- `pullMemories` return counts and the `author`/`origin_project_id` stamping are available for Plan 04 (injection annotation / provenance display).
- `npx tsc --noEmit` clean; pull-merge.spec.ts (5/5) and sync.spec.ts (6/6) green; full suite 260 passed / 8 skipped (sole non-pass is the build-artifact CLI spec, which passes after `npm run build`).

## Self-Check: PASSED
- `src/cli/commands/sync.ts`, `tests/unit/core/pull-merge.spec.ts`, `tests/integration/cli/sync.spec.ts` all exist on disk.
- `git log --grep="07-03"` returns 2 feature commits (fa51fcc, bdc4771).
- Task 1 acceptance: `pullMemories` + `pullMemoriesRequestSchema` present; SET clause contains `MAX(memories.importance, excluded.importance)`; ownerStmt cross-project skip + applyRedaction retained; pull-merge.spec.ts 5/5; tsc clean.
- Task 2 acceptance: sync.ts exports syncCommand; index.ts registers arrow-wrapped `program.command("sync")`; paths built with `path.join`; push uses temp-file + `renameSync`; pull skips own `${username}.json` and try/catches each JSON.parse; sync.spec.ts 6/6 incl. two-user round-trip, exact D-16 string, team-disabled no-op, bad-path non-zero exit; tsc clean.
- Plan-level `<verification>`: full suite green except the build-artifact CLI spec (passes after `npm run build`).

---
*Phase: 07-team-mode-shared-memory*
*Completed: 2026-06-11*

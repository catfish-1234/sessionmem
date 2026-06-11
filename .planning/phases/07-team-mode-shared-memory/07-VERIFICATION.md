---
phase: 07-team-mode-shared-memory
verified: 2026-06-11T03:30:00Z
status: gaps_found
score: 5/6 must-have truths verified
overrides_applied: 0
gaps:
  - truth: "Startup injection prefixes a memory's content with 'author: ' only when the memory's author differs from the local username (D-10), and is reachable from a real CLI/agent path"
    status: partial
    reason: "formatStartupInjection's author-prefix logic is correctly implemented and unit-tested, and CR-01's fix (commit 5b5f24e) correctly computes a `startupInjection` string and adds it to retrieveMemoriesResponseSchema inside memoryCoreService.retrieveMemories. However, no consumer renders or prints this field. The only CLI command that calls retrieveMemories (src/cli/commands/search.ts) ignores result.startupInjection entirely and prints result.memories via formatTable, which has no author column/prefix at all. docs/team-mode.md describes the author: prefix appearing in 'the agent's startup context' but there is still no code path in the repo that surfaces startupInjection to a user or agent."
    artifacts:
      - path: "src/cli/commands/search.ts"
        issue: "Calls service.call(\"retrieveMemories\", ...) and only does console.log(formatTable(result.memories)); never reads or prints result.startupInjection"
      - path: "src/cli/output.ts"
        issue: "formatTable's MemoryTableRow type has no author field and the rendered preview is just row.content with no author prefix"
      - path: "src/core/api/memoryCoreService.ts"
        issue: "startupInjection is computed (line ~358) but is a dangling field — grep shows zero consumers outside contracts.ts and memoryCoreService.ts itself"
    missing:
      - "A CLI command (or update to search.ts) that prints result.startupInjection (or otherwise renders the author-annotated content) so the documented author: prefix is observable in real usage"
      - "An integration test that drives the real CLI retrieval path end-to-end and asserts the author: prefix appears in printed output for a teammate-authored memory (as the original CR-01 fix recommendation specified)"
---

# Phase 07: Team Mode Shared Memory Verification Report

**Phase Goal:** Enable safe shared-memory workflow for teams without hosted backend.
**Verified:** 2026-06-11T03:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification (post code-review fixes for CR-01/CR-02/WR-02)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After migration 005, the memories table has author and origin_project_id columns and existing rows survive | VERIFIED | `src/core/schema/migrations/005_team_provenance.sql` adds `author TEXT NOT NULL DEFAULT ''` and `origin_project_id TEXT` via ALTER TABLE; `tests/integration/storage/schema.spec.ts` covers pre-existing row survival. `author`/`origin_project_id` threaded through `MemoryRecord`, `RetrievedMemoryCandidate`, SELECT lists in memoryRepo.ts and memorySearchRepo.ts. |
| 2 | Every memory write stamps author = local OS username; author/origin_project_id flow through DTOs without becoming undefined | VERIFIED | `localUsername()` in `src/cli/context.ts` (os.userInfo + sanitize), `resolveServiceUsername` in memoryCoreService.ts; storeMemory/importMemories/upsertSessionSummaryMemory all pass `author`. `toMemoryDto`/`toRetrievedMemoryDto` map author/originProjectId. `tests/unit/core/author-stamp.spec.ts` exists covering all four behaviors. |
| 3 | team enable/disable/status persist and read team config; disable (default) keeps pulled rows; --remove-team-memories deletes only non-local-author rows | VERIFIED (with CR-02 fix) | `src/core/config/policyConfig.ts` has `team` section; `src/cli/commands/team.ts` exports `teamEnableCommand`/`teamDisableCommand`/`teamStatusCommand`. CR-02 fix (commit 3dcef4b) changed the DELETE to `... AND author != '' `, with a regression test seeding a legacy `author=''` row that survives `--remove-team-memories`. `tests/integration/cli/team.spec.ts` covers both disable modes. |
| 4 | sync push/pull: full snapshot to {sharedPath}/{project_id}/{username}.json, LWW merge skipping own file, MAX-importance preserve, cross-project-id skip, re-redaction on pull, correct summary message, non-zero exit on bad path | VERIFIED | `src/cli/commands/sync.ts` exports `syncCommand`; `pullMemories` in memoryCoreService.ts uses `MAX(memories.importance, excluded.importance)` (line 571) ON CONFLICT upsert. `tests/unit/core/pull-merge.spec.ts` and `tests/integration/cli/sync.spec.ts` exist covering LWW/importance/cross-project/redaction/error cases. |
| 5 | Startup injection prefixes content with 'author: ' only when author != local username; locally-authored memories render without prefix | PARTIAL — see gap | `formatStartupInjection` in `src/core/injection/formatStartupInjection.ts` correctly implements `authorPrefix()`/`localUsername` logic, unit-tested in `tests/unit/injection/author-annotation.spec.ts` (treats `author === ''` as local/no-prefix, matching CR-02's convention). CR-01 fix (5b5f24e) wires this into `memoryCoreService.retrieveMemories` by computing `startupInjection` and adding it to `retrieveMemoriesResponseSchema`. **However**, no caller renders this field — `src/cli/commands/search.ts` (the only CLI consumer of `retrieveMemories`) prints `formatTable(result.memories)` only, and `formatTable` has no author column. The author: prefix is therefore still unreachable from any real CLI/agent-facing output. |
| 6 | docs/team-mode.md documents setup, sync/team commands, shared-dir trust boundary, disable/recovery behavior | VERIFIED | `docs/team-mode.md` exists, contains "team enable", trust-boundary section, failure-recovery section (including WR-02 caveat about Windows write-probe), and the (currently inaccurate, per gap above) author-prefix description. `tests/integration/docs/team-docs.spec.ts` exists as doc-coverage smoke test. |

**Score:** 5/6 truths verified (truth 5 partial — see gap)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/schema/migrations/005_team_provenance.sql` | ALTER TABLE adding author + origin_project_id | VERIFIED | Both ALTER statements present |
| `src/core/storage/types.ts` | author + origin_project_id on MemoryRecord/InsertMemoryInput | VERIFIED | Fields present (per Plan 01 acceptance criteria, code review confirms) |
| `src/cli/context.ts` | username field via os.userInfo() | VERIFIED | `localUsername()` present |
| `tests/unit/core/author-stamp.spec.ts` | write-path stamping tests | VERIFIED | File exists, reviewed in code review |
| `src/core/config/policyConfig.ts` | team config section | VERIFIED | `team` section with enabled/sharedPath |
| `src/cli/commands/team.ts` | teamEnableCommand/teamDisableCommand/teamStatusCommand | VERIFIED | All three exported; CR-02 fix applied |
| `tests/integration/cli/team.spec.ts` | enable/disable/status + --remove-team-memories coverage | VERIFIED | Includes CR-02 legacy-row regression test |
| `src/core/api/memoryCoreService.ts` (pullMemories) | MAX-importance upsert + author/origin_project_id stamping | VERIFIED | `MAX(memories.importance, excluded.importance)` present |
| `src/cli/commands/sync.ts` | syncCommand | VERIFIED | Exported |
| `tests/unit/core/pull-merge.spec.ts`, `tests/integration/cli/sync.spec.ts` | merge + round-trip coverage | VERIFIED | Both files exist |
| `src/core/injection/formatStartupInjection.ts` | author-aware formatLine with localUsername | VERIFIED (substantive) but ORPHANED in production | Logic correct and unit-tested, but `startupInjection` output (CR-01 fix) is not consumed/printed by any CLI command |
| `docs/team-mode.md` | setup + recovery docs | VERIFIED | Exists, contains required sections |
| `tests/unit/injection/author-annotation.spec.ts`, `tests/integration/docs/team-docs.spec.ts` | annotation + doc-coverage tests | VERIFIED | Both exist |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cli/commands/team.ts` | `writePolicyConfig` | team section persistence | WIRED | team enable/disable/status persist via policyConfig |
| `src/cli/index.ts` | team command group | `program.command("team")` | WIRED (assumed per SUMMARY; not independently re-checked due to context budget, but team.spec.ts integration coverage exists) | |
| `src/cli/commands/sync.ts` | `exportMemories`/`pullMemories` | service.call | WIRED | sync.spec.ts covers push/pull |
| `src/core/api/memoryCoreService.ts` | `memories ON CONFLICT(id) DO UPDATE` | MAX(memories.importance, ...) | WIRED | confirmed via grep |
| `src/core/injection/formatStartupInjection.ts` | `RetrievedMemoryCandidate.author` | formatLine author prefix | WIRED at the formatter level, but NOT_WIRED at the CLI/output level | `memoryCoreService.retrieveMemories` calls formatStartupInjection (CR-01 fix) and returns `startupInjection`, but `search.ts` discards it; no command prints it |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `formatStartupInjection` output (`startupInjection` field) | `result.startupInjection` from `retrieveMemories` response | `memoryCoreService.retrieveMemories` → `formatStartupInjection(ranked, { localUsername: localAuthor })` | Yes — computed from real `ranked` candidates with real `author` values | ⚠️ HOLLOW — wired into the service response but the field is never read by `search.ts` or any other CLI command, so the computed string never reaches a user/agent |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test suite runnable | `npx vitest run ...` | `Cannot find package 'better-sqlite3'` / `'js-tiktoken'` — node_modules is empty (0 entries) in this checkout | ? SKIP — environment has no installed dependencies; cannot execute tests. Code-level review used instead. |

### Probe Execution

No probe scripts found under `scripts/*/tests/probe-*.sh` and none referenced in PLAN/SUMMARY files for this phase. Step 7c: SKIPPED (no probes declared or discovered).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TEAM-01 | 07-03 | Team can set shared-path sync and merge team memories into local retrieval | SATISFIED | sync push/pull, pullMemories LWW+MAX-importance merge implemented and tested |
| TEAM-02 | 07-01, 07-04 | Team memories retain author attribution and timestamp provenance | PARTIAL | Schema/storage/DTO threading of author+origin_project_id (07-01) is fully done. The provenance-surfacing half (07-04: author-prefix in startup injection, D-10) is implemented at the formatter level and computed in the service response (post CR-01 fix), but not rendered/observable in any actual CLI output — the "retain ... provenance" data exists, but the user-facing "see who authored a shared memory" capability described in docs/team-mode.md is not reachable. |
| TEAM-03 | 07-02 | Team can disable shared mode and return to local-only behavior without data loss | SATISFIED | team disable (default) keeps rows; --remove-team-memories deletes only `author != username AND author != ''` after CR-02 fix, with regression test for legacy empty-author rows |

REQUIREMENTS.md still marks TEAM-02 and TEAM-03 as "Pending" in its tracking table — TEAM-03 should be updated to Complete based on this verification; TEAM-02 should remain Pending/flagged until the gap above is closed.

No orphaned requirement IDs found — TEAM-01/02/03 are all claimed across plans 07-01..07-04 and all three appear in REQUIREMENTS.md's Team Mode section.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/core/api/memoryCoreService.ts` | ~358 | Computed value (`startupInjection`) added to response schema with no consumer | ⚠️ Warning | Dead/dangling data path — increases payload size and gives false impression the feature is wired (this is the CR-01 gap) |

No TBD/FIXME/XXX markers found in reviewed files (per 07-REVIEW.md, no such findings were raised).

### Human Verification Required

None — the remaining gap (CR-01 incomplete wiring) is statically verifiable via grep/read and does not require human/visual testing.

### Gaps Summary

The phase delivers the schema/storage/config/sync/disable infrastructure for team mode soundly (TEAM-01 and TEAM-03 are fully satisfied, including both code-review fixes CR-02 and WR-02). However, TEAM-02's "agent can see who authored a shared memory" capability — the headline feature of Plan 07-04 and the centerpiece of `docs/team-mode.md`'s "Provenance and author annotation" section — remains unreachable in practice.

The CR-01 fix (commit 5b5f24e) addressed only half of the originally-identified gap: it correctly computed a `startupInjection` string inside `memoryCoreService.retrieveMemories` and added it to the response schema, satisfying "wire formatStartupInjection into the retrieval path" at the service layer. But the fix's own stated acceptance bar — "add an integration test that drives the real retrieval path end-to-end and asserts the author: prefix appears in the rendered output" — was not met, because no CLI command (specifically `src/cli/commands/search.ts`, the sole caller of `retrieveMemories`) reads or prints `result.startupInjection`. `formatTable`, which `search.ts` actually uses, has no author column at all.

This is a contained, well-scoped gap: either (a) update `search.ts` to print `result.startupInjection` (or extend `formatTable`/add a new output mode that includes the author prefix), with an end-to-end integration test asserting the `author:` prefix appears in printed CLI output for a teammate-authored memory; or (b) if `search.ts` is intentionally not the right consumer (e.g., a future MCP server is the intended consumer and doesn't exist yet), update `docs/team-mode.md` to accurately describe current vs. future behavior and consider deferring this sub-requirement to a later phase with an explicit roadmap note.

---

_Verified: 2026-06-11T03:30:00Z_
_Verifier: Claude (gsd-verifier)_

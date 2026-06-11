---
phase: 07-team-mode-shared-memory
plan: 02
subsystem: cli
tags: [config, zod, commander, sqlite, team-mode, provenance]

requires:
  - phase: 07-team-mode-shared-memory
    provides: author column on memories + CliContext.username + localUsername()
  - phase: 06-security-privacy-and-retention-hardening
    provides: policyConfig.ts (strict-write/strip-read schemas, resolvePolicySettings, writePolicyConfig)
  - phase: 05-cli-lifecycle-and-data-operations
    provides: CliContext seam + configPath test-seam pattern + Phase 5 D-03 error convention
provides:
  - Nested team config section (enabled, sharedPath) with strict-write/strip-read + safe default
  - resolveTeamConfig (object-unit resolution, not via the flat scalar loop)
  - team enable/disable/status CLI command group registered in index.ts
  - --remove-team-memories parameterized author-scoped DELETE (no-data-loss default disable)
affects: [team-sync, conflict-merge, injection-annotation]

tech-stack:
  added: []
  patterns:
    - "Nested config object resolved as a unit (resolveTeamConfig) — separate from the flat scalar resolvePolicySettings loop (RESEARCH Pitfall 5)"
    - "DB-touching CLI command takes an optional CliContext seam (ctx ?? createCliContext()) for temp-DB testing"

key-files:
  created:
    - src/cli/commands/team.ts
    - tests/integration/cli/team.spec.ts
  modified:
    - src/core/config/policyConfig.ts
    - src/cli/index.ts
    - tests/unit/core/policy-config.spec.ts

key-decisions:
  - "team is resolved as a whole object via resolveTeamConfig; resolvePolicySettings narrowed to ScalarPolicySettings so the flat per-key loop never touches the nested team object (RESEARCH Pitfall 5)."
  - "DEFAULT_POLICY_CONFIG.team = { enabled: false }; teamConfigShape is .strict() so unknown keys inside team are rejected on write, .strip()+.default() keeps pre-team configs backward-compatible."
  - "team disable defaults to no data loss (TEAM-03) — only flips enabled false; --remove-team-memories additionally deletes author != local rows for the current project."
  - "The --remove-team-memories DELETE binds (projectId, username) as parameters, never string-concatenated (T-07-08 / T-06-11 precedent)."

patterns-established:
  - "Resolve nested config objects as a unit; keep scalar and object resolution paths separate."

requirements-completed: [TEAM-03]

duration: 6 min
completed: 2026-06-11
---

# Phase 7 Plan 2: Team Config Surface + CLI Command Group Summary

**Nested `team` config section (`{ enabled, sharedPath }`) with strict-write/strip-read discipline plus a `sessionmem team enable/disable/status` command group, where `disable` preserves teammate memories by default and `--remove-team-memories` runs a parameterized author-scoped delete (TEAM-03).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-11T02:45:00Z
- **Completed:** 2026-06-11T02:50:00Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `policyConfig.ts` gained a strict nested `team` section (`teamConfigShape`) added to `policyConfigShape`, `DEFAULT_POLICY_CONFIG.team`, and a dedicated `resolveTeamConfig` that resolves `team` as an object unit. `resolvePolicySettings` was narrowed to `ScalarPolicySettings` so the flat per-key loop still returns only `retentionDays` + `redactionEnabled` (RESEARCH Pitfall 5).
- New `src/cli/commands/team.ts` exports `teamEnableCommand`, `teamDisableCommand`, `teamStatusCommand` using the `{ configPath? }` test seam and an optional `CliContext` seam for the DB-touching disable path.
- `team disable` defaults to no data loss (flips `enabled` false, keeps pulled rows); `--remove-team-memories` runs `DELETE FROM memories WHERE project_id = ? AND author != ?` with bound params (T-07-08).
- `team status` reports enabled/disabled, the shared path, and whether it exists/is writable — no last-sync time (D-08, no synced_at column).
- Registered the `team` group in `index.ts` with arrow-wrapped handlers (drops commander's trailing Command arg).

## Task Commits

1. **Task 1: Extend policyConfig.ts with the team section** - `30b0cbe` (feat)
2. **Task 2: team command group (enable/disable/status) + registration** - `db3a87b` (feat)

_Note: TDD tasks — failing-first behavior captured in policy-config.spec.ts (team section + resolveTeamConfig) and team.spec.ts; implementation committed alongside each task's test extension._

## Files Created/Modified
- `src/core/config/policyConfig.ts` - teamConfigShape, team added to policyConfigShape + DEFAULT_POLICY_CONFIG, resolveTeamConfig, ScalarPolicySettings narrowing
- `src/cli/commands/team.ts` - teamEnableCommand / teamDisableCommand / teamStatusCommand
- `src/cli/index.ts` - team command group registration with arrow-wrapped handlers
- `tests/unit/core/policy-config.spec.ts` - team-section read/write/strict + resolveTeamConfig coverage (existing toEqual assertions updated for the new team default)
- `tests/integration/cli/team.spec.ts` - enable/status/disable + --remove-team-memories coverage over a temp DB seeded with local + teammate-authored rows

## Decisions Made
See `key-decisions` frontmatter. Headline: `team` resolves as an object unit via `resolveTeamConfig` (never through the flat scalar loop); `disable` is no-data-loss by default; `--remove-team-memories` is a parameterized author-scoped delete.

## Deviations from Plan

None - plan executed exactly as written. Pre-existing unit tests in `policy-config.spec.ts` whose `toEqual` assertions pinned the old flat config shape were updated to include the new `team: { enabled: false }` default — this is the expected consequence of the planned schema extension, not unplanned scope.

## Issues Encountered
None from this plan. The full-suite run surfaces one pre-existing failure (`tests/integration/cli/cli-entrypoint.spec.ts`) that requires `npm run build` to produce `dist/cli/index.js`; after `npm run build`, that spec passes (8/8). It is the same build-artifact dependency noted in the Wave 1 summary, not a regression from this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The `team.enabled` / `team.sharedPath` config surface is in place for Plan 03 (`sync`) to read and no-op cleanly when disabled.
- `resolveTeamConfig` is available for consumers that need override > config > default team resolution.
- `npx tsc --noEmit` clean; policy-config.spec.ts and team.spec.ts green; full suite 249 passed / 8 skipped (sole non-pass is the build-artifact CLI spec, which passes after build).

## Self-Check: PASSED
- `src/cli/commands/team.ts` and `tests/integration/cli/team.spec.ts` exist on disk.
- Task 1 acceptance: `teamConfigShape` (enabled + sharedPath) added to `policyConfigShape`; `DEFAULT_POLICY_CONFIG.team = { enabled: false }`; `resolvePolicySettings` scalar loop still returns only retentionDays/redactionEnabled; tsc clean; config-command spec green.
- Task 2 acceptance: team.ts exports all three commands; `index.ts` registers `program.command("team")` with `enable <path>`, `disable` (`--remove-team-memories`), `status`, each arrow-wrapped; DELETE uses bound `author != ?`; team.spec.ts passes all four behaviors (default-disable preserves teammate rows, --remove-team-memories deletes only author != local); tsc clean.
- Plan `<verification>`: team.spec.ts + policy-config.spec.ts green; full suite green except the build-artifact CLI spec (passes after `npm run build`).

---
*Phase: 07-team-mode-shared-memory*
*Completed: 2026-06-11*

---
phase: 06-security-privacy-and-retention-hardening
plan: 05
subsystem: cli
tags: [cli, commander, retention, config, policyConfig, dry-run]

# Dependency graph
requires:
  - phase: 06-security-privacy-and-retention-hardening
    provides: "policyConfig.ts (readPolicyConfig/writePolicyConfig/resolvePolicySettings) from plan 06-01"
  - phase: 06-security-privacy-and-retention-hardening
    provides: "pruneMemories service method (eligible/deleted, dryRun) from plan 06-02"
provides:
  - "sessionmem retention prune [--force] [--days <n>] command (dry-run by default per D-12)"
  - "sessionmem config get/set commands over ~/.sessionmem/config.json (D-13)"
  - "install config-defaults step writing config.json only when absent (D-10)"
  - "CLI flag > config.json > built-in default precedence wired into the operator surface (D-11)"
affects: [redact-scan command, stats retention/redaction lines, adapter policy integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "retention/config command groups mirror Phase 5 forget dry-run + --force + ctx-seam conventions"
    - "config key map (CLI key -> policyConfig field + coercer) for extensible config get/set without per-setting commands"
    - "install seeds policy defaults only when config.json absent (no-clobber)"

key-files:
  created:
    - src/cli/commands/retention.ts
    - src/cli/commands/config.ts
    - tests/integration/cli/retention-prune.spec.ts
    - tests/integration/cli/config-command.spec.ts
  modified:
    - src/cli/index.ts
    - src/cli/commands/install.ts
    - src/cli/context.ts
    - tests/integration/cli/install.spec.ts

key-decisions:
  - "config get/set accepts both dotted operator key (retention.days) and raw policyConfig field (retentionDays) so CLI and policyConfig stay consistent"
  - "config set rejects non-integer retention.days and non-boolean redactionEnabled before any filesystem write (T-06-17)"
  - "install plumbs configPath via CliContextOverrides as the install-only config-write seam (createCliContext itself does not consume it)"

patterns-established:
  - "Config key map pattern: add one CONFIG_KEYS entry (field + coerce) to expose a new setting through config get/set"
  - "Retention prune resolves effective retentionDays via resolvePolicySettings(override=--days, config=readPolicyConfig)"

requirements-completed: [SECU-01, SECU-02]

# Metrics
duration: 9min
completed: 2026-06-10
---

# Phase 6 Plan 5: Retention & Config CLI Surface Summary

**Operator-facing `retention prune` (dry-run by default + --force), generic `config get/set` over policyConfig, and install config-default seeding — all honoring CLI > config.json > default precedence.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-10T15:49:00Z
- **Completed:** 2026-06-10T15:54:00Z
- **Tasks:** 3
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- `retention prune` defaults to dry-run printing the exact D-12 string and deletes nothing; `--force` hard-deletes eligible memories and prints a summary count, with `--days` overriding the effective window.
- `config get <key>` / `config set <key> <value>` read/write `~/.sessionmem/config.json` through policyConfig with key validation and type coercion; unknown keys and invalid values exit 1 with no file write.
- `install` writes a default `config.json` (retentionDays 90, redactionEnabled true) only when absent, preserving an existing config byte-for-byte.

## Task Commits

Each task committed atomically (TDD: failing spec + implementation per task):

1. **Task 1: retention prune command (dry-run default, --force)** - `8e9c1c9` (feat)
2. **Task 2: config get/set command** - `5c979ba` (feat)
3. **Task 3: install writes default config.json when absent** - `197f244` (feat)

## Files Created/Modified
- `src/cli/commands/retention.ts` - retentionPruneCommand: resolves effective retentionDays, calls pruneMemories with dryRun:!force, prints D-12 string or "Deleted N memories."
- `src/cli/commands/config.ts` - configGetCommand/configSetCommand over a CONFIG_KEYS map with integer/boolean coercion and unknown-key rejection
- `src/cli/commands/install.ts` - added config-defaults step after DB init (write-if-absent, preserve-if-present)
- `src/cli/context.ts` - added `configPath?` install-only seam to CliContextOverrides
- `src/cli/index.ts` - registered `retention prune` and `config get`/`config set` command groups (arrow-wrapped per the commander trailing-Command NOTE)
- `tests/integration/cli/retention-prune.spec.ts` - dry-run, --force, --days override, dryRun-flag, service-failure cases
- `tests/integration/cli/config-command.spec.ts` - get default, set/get round-trip, boolean persist, unknown key, invalid value
- `tests/integration/cli/install.spec.ts` - extended with write-when-absent and no-clobber cases (prior assertions retained)

## Decisions Made
- config keys accept both `retention.days` and `retentionDays` aliases so CLI strings and policyConfig fields stay consistent (D-13 discretion on key naming).
- `--days` is parsed to a positive integer; an unparseable value is treated as "no override" so precedence falls through to config.json then default.
- install reuses `CliContextOverrides.configPath` rather than a new parameter, keeping the existing `(options, contextOverrides)` signature stable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] retention-prune test seed required `normalized_content`**
- **Found during:** Task 1 (retention prune spec)
- **Issue:** `insertMemory` requires `normalized_content` (RangeError "Missing named parameter") when seeding an aged memory directly; the plan's seed sketch omitted it.
- **Fix:** Provided `normalized_content` (lowercased content) in the test's aged-memory seed.
- **Files modified:** tests/integration/cli/retention-prune.spec.ts
- **Verification:** retention-prune.spec.ts 5/5 pass.
- **Committed in:** `8e9c1c9` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test-fixture-only fix; no production-code scope change. All three commands match the plan's behavior and acceptance criteria.

## Issues Encountered
- Worktree branched from a stale base (HEAD was a descendant `7b3e904` rather than the prescribed base `54a515fe`); the `<worktree_branch_check>` `git reset --hard 54a515fe` brought the worktree to the correct base containing the Phase 6 plan files. HEAD was on the valid `worktree-agent-*` branch throughout, so the reset was permitted.

## Verification
- `npx vitest run retention-prune.spec.ts config-command.spec.ts install.spec.ts` -> 17 passed
- `npx vitest run cli-entrypoint.spec.ts` (registration sanity, post-build) -> 8 passed
- `npx tsc --noEmit` -> 0 errors
- Real-binary smoke: `retention prune` prints D-12 string, `config get retention.days` -> 90, `config get bogus.key` -> error + exit 1

## Next Phase Readiness
- SECU-01 operator controls (manual prune trigger + config surface) and the SECU-02 redaction config foundation are complete.
- config.json key map is ready for `redact-scan` (D-14) and stats retention/redaction lines (D-15) to consume.

## Self-Check: PASSED

- FOUND: src/cli/commands/retention.ts
- FOUND: src/cli/commands/config.ts
- FOUND: tests/integration/cli/retention-prune.spec.ts
- FOUND: tests/integration/cli/config-command.spec.ts
- FOUND commit: 8e9c1c9
- FOUND commit: 5c979ba
- FOUND commit: 197f244

---
*Phase: 06-security-privacy-and-retention-hardening*
*Completed: 2026-06-10*

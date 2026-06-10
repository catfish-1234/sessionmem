---
phase: 06-security-privacy-and-retention-hardening
plan: 06
subsystem: cli-security
tags: [redaction, retention, cli, security-tests, secrets]
requires:
  - "redactExisting service (Plan 06-03)"
  - "pruneMemories dry-run + policyConfig (Plans 06-01/06-02)"
  - "applyRedaction rule set (Plan 06-01)"
provides:
  - "sessionmem redact-scan [--apply] command"
  - "stats retention + redaction summary lines (D-15)"
  - "secret-leakage security regression suite (ROADMAP criterion 3)"
affects:
  - "src/cli/index.ts (new redact-scan registration)"
  - "src/cli/commands/stats.ts (extended output)"
tech-stack:
  added: []
  patterns:
    - "scan-by-default + --apply mutate (mirrors forget/retention dry-run conventions)"
    - "config-path override seam for deterministic CLI tests"
    - "path-based gitleaks allowlist for intentional secret fixtures"
key-files:
  created:
    - "src/cli/commands/redactScan.ts"
    - "tests/integration/cli/redact-scan.spec.ts"
    - "tests/integration/core/secret-leakage.spec.ts"
  modified:
    - "src/cli/index.ts"
    - "src/cli/commands/stats.ts"
    - "tests/unit/cli/stats.spec.ts"
    - ".gitleaks.toml"
decisions:
  - "redact-scan prints safe (already-redacted, length-bounded) previews from redactExisting, never raw secrets (T-06-20)"
  - "stats reports 'Retention: pruning disabled (retentionDays <= 0)' instead of a misleading eligible count when the window is non-positive"
  - "extended .gitleaks.toml allowlist (path-based) to admit the two new fixture-bearing test files rather than weakening assertions"
metrics:
  duration: ~25m
  completed: 2026-06-10
  tasks: 3
  files_changed: 7
---

# Phase 6 Plan 06: Redaction/Retention CLI Surface and Security Verification Summary

`sessionmem redact-scan [--apply]` one-time scrub over `redactExisting`, `stats` gains D-15 retention/redaction visibility lines, and a dedicated secret-leakage suite proves all 8 D-05 categories are redacted across every write path.

## What Was Built

### Task 1 — `redact-scan` command
`src/cli/commands/redactScan.ts` exports `redactScanCommand(options, ctx?)`:
- Scan (no flags): calls `redactExisting` with `apply:false`, prints exactly `Found ${matched} memories with potential secrets` followed by the truncated, already-redacted previews. Non-destructive.
- `--apply`: calls with `apply:true`, redacts matching rows in place, prints `Redacted ${updated} memories.`
- Service failure: prints `result.error.message` to stderr, `process.exit(1)`.
- Registered in `src/cli/index.ts` as `redact-scan` with `--apply`, arrow-wrapped per the commander NOTE so `ctx` stays undefined in production.

### Task 2 — `stats` retention + redaction lines
`src/cli/commands/stats.ts` extended. After the original three lines (preserved verbatim) it appends:
- `Retention: ${retentionDays} days (${eligible} memories eligible for pruning)` using `readPolicyConfig` + a `pruneMemories` dry-run count; or `Retention: pruning disabled (retentionDays <= 0)` when the window is non-positive.
- `Redaction: enabled|disabled` from effective `redactionEnabled`.
- Added a `configPath` override seam (second optional arg) so tests drive disabled-redaction / `retentionDays=0` deterministically without touching `~/.sessionmem`.

### Task 3 — secret-leakage security suite
`tests/integration/core/secret-leakage.spec.ts` (test-only) exercises all 8 D-05 categories (email, sk-, AWS, GitHub, Bearer, PEM private key, password/secret assignment, JWT):
- manual `storeMemory` for every category — raw secret absent, placeholder present
- `importMemories` for email/sk-/AWS
- auto-summarize via `handleSessionEnd` — stored summary omits the raw secret and a `summary` memory is actually produced
- `redactExisting` apply removes a directly-inserted raw secret
- negative control: `redactionEnabled:false` preserves the raw value (proves the flag governs behavior)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] gitleaks pre-commit hook blocked the new fixture files**
- **Found during:** Task 3 commit
- **Issue:** The `Detect hardcoded secrets` (gitleaks) pre-commit hook flagged the intentional canonical sample secrets (AWS key, GitHub PAT, JWT, PEM block) in `secret-leakage.spec.ts`, blocking the commit. The existing `.gitleaks.toml` allowlist only covered `redaction-rules.spec.ts` and `policy-config.spec.ts`.
- **Fix:** Extended the path-based `[allowlist].paths` in `.gitleaks.toml` to include `tests/integration/core/secret-leakage.spec.ts` and `tests/integration/cli/redact-scan.spec.ts`. These are docs/canonical example values, not real credentials — assertions were NOT weakened.
- **Files modified:** `.gitleaks.toml`
- **Commit:** 8230a58

## Verification

- `npx vitest run tests/integration/cli/redact-scan.spec.ts tests/unit/cli/stats.spec.ts tests/integration/core/secret-leakage.spec.ts` — all pass
- `npx vitest run tests/integration/cli/cli-entrypoint.spec.ts` — passes after `npm run build` (registration sanity, 8 passed)
- `npm test` — full suite green: 45 files, 237 tests passed
- `npx tsc --noEmit` — no type errors

## Commits

- 323c580 test(06-06): add failing test for redact-scan command (RED)
- 024523a feat(06-06): implement redact-scan command (GREEN)
- c90e83c test(06-06): add failing test for stats retention/redaction lines (RED)
- 790e144 feat(06-06): add retention/redaction summary lines to stats (GREEN)
- 8230a58 test(06-06): add secret-leakage security suite across write paths

## TDD Gate Compliance

Tasks 1 and 2 each have a `test(...)` (RED) commit followed by a `feat(...)` (GREEN) commit. Task 3 is a test-only deliverable (no production change), so it has a single `test(...)` commit and the suite passed immediately, confirming the redaction wiring from Plans 01/03 already holds across all paths.

## Known Stubs

None.

## Threat Flags

None — no new security surface beyond the threat model. `redact-scan --apply` rewrites rows (in scope, T-06-22) and `stats` reads policy/DB (in scope, T-06-23); both covered by the plan's threat register.

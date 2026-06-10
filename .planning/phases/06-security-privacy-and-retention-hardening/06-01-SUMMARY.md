---
phase: 06-security-privacy-and-retention-hardening
plan: 01
subsystem: security
tags: [redaction, secrets, config, zod, gitleaks, retention, privacy]

# Dependency graph
requires:
  - phase: 02-session-lifecycle-summarization-pipeline
    provides: applyRedaction/defaultRules redaction primitive and redactionEnabled flag
provides:
  - Expanded defaultRules() covering AWS keys, GitHub tokens, Bearer tokens, PEM private-key blocks, password=/secret= assignments, and JWTs (plus original email/sk-)
  - src/core/config/policyConfig.ts with readPolicyConfig / writePolicyConfig / resolvePolicySettings / configFilePath / DEFAULT_POLICY_CONFIG
  - .gitleaks.toml allowlist for intentional secret-redaction test fixtures
affects: [retention pruning, manual store/import redaction, config get/set CLI, session-end auto-prune, redact-scan CLI]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Filesystem policy config read with safe-default fallback (mirrors localOnlyPolicy.ts)"
    - "Split zod schemas: strict on the write path (reject unknown keys), stripping on the read path (forward-compatible)"
    - "Redaction rules ordered structural-secret-first to avoid partial-overlap corruption"

key-files:
  created:
    - src/core/config/policyConfig.ts
    - tests/unit/core/redaction-rules.spec.ts
    - tests/unit/core/policy-config.spec.ts
    - .gitleaks.toml
  modified:
    - src/core/summarize/redaction.ts

key-decisions:
  - "Flat config key naming (retentionDays, redactionEnabled) rather than dotted keys"
  - "Read path strips unknown keys (forward-compat); write path rejects them (T-06-04)"
  - "Bearer rule preserves the literal 'Bearer ' prefix and redacts only the token portion"

patterns-established:
  - "Pattern 1: Two-schema policy config — strict write schema + stripping read schema sharing one field shape"
  - "Pattern 2: Anchored, bounded-quantifier redaction regexes to stay ReDoS-safe (T-06-03)"

requirements-completed: [SECU-01, SECU-02]

# Metrics
duration: 12min
completed: 2026-06-10
---

# Phase 6 Plan 01: Redaction + Policy Config Foundations Summary

**Expanded secret-redaction rule set (AWS/GitHub/Bearer/PEM/password=/JWT) plus a safe-defaulting `~/.sessionmem/config.json` policy module with override > config > default precedence.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-10T15:39:00Z
- **Completed:** 2026-06-10T15:43:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 5 (1 modified, 4 created)

## Accomplishments
- `defaultRules()` now redacts six new secret categories (AWS access keys, GitHub `gh*_` tokens, Bearer header tokens, PEM private-key blocks, `password=`/`secret=` assignment values, JWTs) while preserving the original email and `sk-` rules byte-for-byte.
- New `src/core/config/policyConfig.ts` reads/writes `~/.sessionmem/config.json` and resolves effective settings, defaulting safely (retentionDays 90, redactionEnabled true) on missing/malformed/invalid files and never throwing on read.
- Rule ordering and anchored/bounded regexes keep false positives and ReDoS risk low; prose-no-op tests guard against over-redaction.
- Added `.gitleaks.toml` so intentional test fixtures (sample secrets) pass the repo's gitleaks pre-commit hook without weakening real-secret detection elsewhere.

## Task Commits

Each task was committed atomically (TDD: test → feat):

1. **Task 1 RED: failing redaction tests** - `80f0bed` (test) — also adds `.gitleaks.toml`
2. **Task 1 GREEN: expand defaultRules()** - `190162c` (feat)
3. **Task 2 RED: failing policyConfig tests** - `d7e21df` (test)
4. **Task 2 GREEN: policyConfig module** - `1b7c274` (feat)

_No refactor commits were needed; both implementations were clean on first GREEN._

## Files Created/Modified
- `src/core/summarize/redaction.ts` - Extended `defaultRules()` with six new secret-pattern rules, ordered PEM/JWT before narrower token rules.
- `src/core/config/policyConfig.ts` - `DEFAULT_POLICY_CONFIG`, strict + stripping zod schemas, `readPolicyConfig`, `writePolicyConfig`, `resolvePolicySettings`, `configFilePath`.
- `tests/unit/core/redaction-rules.spec.ts` - 13 behavior tests for all secret categories, prose no-op, and disabled-flag bypass.
- `tests/unit/core/policy-config.spec.ts` - 14 tests for read/write/resolve, fallback, unknown-key handling, and precedence.
- `.gitleaks.toml` - Allowlist for the two test-fixture spec files.

## Decisions Made
- **Flat config keys** (`retentionDays`, `redactionEnabled`) over dotted keys — Plan 05's `config get/set` will map dotted user input onto these; CONTEXT D-13 left this to Claude's discretion.
- **Two-schema design:** the write path validates with a `.strict()` schema (rejects unknown keys, threat T-06-04), while reads use a `.strip()` schema so a newer binary's extra keys don't nuke known-good values — type-invalid known fields still trigger the safe-default fallback (T-06-02).
- **Bearer rule** preserves the literal `Bearer ` token and replaces only the credential, matching the plan's "key kept, value redacted" intent for header values.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `.gitleaks.toml` to allowlist test fixtures**
- **Found during:** Task 1 (RED commit)
- **Issue:** The repo's gitleaks pre-commit hook scanned the redaction test file, detected the intentional sample secrets (e.g. JWT), and blocked the commit. The plan explicitly anticipated test fixtures must be allowlisted/expected by the suite.
- **Fix:** Created `.gitleaks.toml` extending the default ruleset with an allowlist scoped to the two redaction/policy spec files only. Real-secret detection elsewhere is unaffected.
- **Files modified:** `.gitleaks.toml`
- **Verification:** Gitleaks hook reports "Passed" on all four subsequent commits.
- **Committed in:** `80f0bed` (Task 1 RED commit)

**2. [Rule 1 - Bug] Read path stripped unknown keys instead of rejecting them**
- **Found during:** Task 2 (GREEN)
- **Issue:** First implementation used the strict schema for `readPolicyConfig`, so a config file with one unknown key fell back to full defaults, discarding valid known values (failing the "ignores unknown keys" test).
- **Fix:** Introduced a separate stripping read schema (`policyConfigReadSchema`) sharing the field shape; reads strip unknown keys while writes stay strict.
- **Files modified:** `src/core/config/policyConfig.ts`
- **Verification:** All 14 policy-config tests pass; unknown-key file now yields `{ retentionDays: 15, redactionEnabled: true }`.
- **Committed in:** `1b7c274` (Task 2 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both necessary for correctness/committability. No scope creep — the gitleaks allowlist is exactly what the plan's NOTE called for, and the schema split satisfies the plan's stated unknown-key behavior.

## Issues Encountered
- **Worktree had no `node_modules`:** the parallel worktree was a fresh checkout without dependencies. Resolved by creating a directory junction (`mklink /J node_modules` → main checkout's `node_modules`) so vitest/tsc resolve. The junction is gitignored and was not committed.

## Threat Surface
All four threats in the plan's STRIDE register are addressed by tests:
- T-06-01 (info disclosure): per-category redaction behavior tests assert raw secret absent.
- T-06-02 (tampering): malformed/invalid config falls back to defaults without throwing.
- T-06-03 (ReDoS): anchored prefixes + bounded quantifiers; prose-no-op tests guard.
- T-06-04 (unknown keys): strict write schema rejects them; read schema strips them.

No new threat surface beyond the plan's register was introduced.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Downstream plans can now import `applyRedaction` (with expanded rules) into manual store/import paths (Plan 03) and `policyConfig` helpers into session-end auto-prune (Plan 04) and the `config`/`retention`/`redact-scan` CLI commands (Plans 05/06).
- No blockers.

## Self-Check: PASSED
- FOUND: src/core/config/policyConfig.ts
- FOUND: src/core/summarize/redaction.ts
- FOUND: tests/unit/core/redaction-rules.spec.ts
- FOUND: tests/unit/core/policy-config.spec.ts
- FOUND: .gitleaks.toml
- FOUND commits: 80f0bed, 190162c, d7e21df, 1b7c274

---
*Phase: 06-security-privacy-and-retention-hardening*
*Completed: 2026-06-10*

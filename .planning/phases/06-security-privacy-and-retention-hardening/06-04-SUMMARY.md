---
phase: 06-security-privacy-and-retention-hardening
plan: 04
subsystem: core-api
tags: [retention, session-lifecycle, prune, security]
requires:
  - "memoryRepo.deleteMemoriesOlderThan (Plan 06-02)"
  - "policyConfig.readPolicyConfig / DEFAULT_POLICY_CONFIG (Plan 06-01)"
provides:
  - "Automatic light retention prune at session-end (SECU-01 automatic trigger)"
affects:
  - "src/core/api/sessionLifecycleService.ts"
  - "src/core/api/memoryCoreService.ts"
tech-stack:
  added: []
  patterns:
    - "Best-effort try/catch prune that never blocks the primary flow"
    - "Optional dependency-injection seams (now/override/delete fn) for deterministic tests"
key-files:
  created:
    - "tests/integration/core/session-end-auto-prune.spec.ts"
  modified:
    - "src/core/api/sessionLifecycleService.ts"
    - "src/core/api/memoryCoreService.ts"
decisions:
  - "Prune invoked on stored + skipped (disabled/threshold) return paths; failed paths intentionally do not prune to avoid pruning when summarization itself errored"
  - "retentionDays resolved via policyConfig with 90-day safe default; explicit override is a test-only seam, production always reads config"
  - "No changes to handleSessionEndConfigSchema/contracts.ts to keep Wave 2 parallel-safe with Plan 03"
metrics:
  duration: "~10m"
  completed: 2026-06-10
requirements: [SECU-01]
---

# Phase 6 Plan 4: Session-End Auto Retention Prune Summary

Wired an automatic, light, non-blocking retention prune into `handleSessionEnd` (D-02): after summarization stores or is skipped, memories older than the effective `retentionDays` are hard-deleted for the project, gated so `retentionDays<=0` disables it and any prune failure is swallowed so summarization is never blocked or altered.

## What Was Built

- **`runLightPrune(projectId)`** in `sessionLifecycleService.ts`: resolves effective `retentionDays` (explicit override seam, else `readPolicyConfig(configFilePath()).retentionDays`, else the 90-day `DEFAULT_POLICY_CONFIG`), returns early when `retentionDays<=0`, computes a `cutoffIso` (now − retentionDays days, ISO-8601 UTC matching the stored `created_at` format), and calls `deleteMemoriesOlderThan` inside a `try/catch` that swallows errors.
- **Invocation** before each `stored` return path (local, cloud, cloud→local fallback) and each `skipped` return path (`skipped_disabled`, `skipped_threshold`). Runs once per session-end (light, no loop).
- **Injection seams** on `SessionLifecycleServiceDeps` and `CreateMemoryCoreServiceDeps`: `policyConfigPath`, `retentionDaysOverride`, `now`, `deleteOldMemories` — plumbed through `createMemoryCoreService` so the integration test can deterministically age memories, drive `retentionDays`, and force a prune throw. Production behavior reads the policy config.
- **`tests/integration/core/session-end-auto-prune.spec.ts`** (4 cases): aged-row deletion with summary preserved; `retentionDays=0` skip; summarization-outcome invariance with/without an old memory; swallowed prune failure still returns `ok:true` / `stored`.

## How It Works

`createMemoryCoreService` → `createSessionLifecycleService` passes the new optional seams. On session-end, after the summary is stored (or the path is skipped), `runLightPrune` runs. It is purely additive to the response — `status`, `usedMode`, and `memoryId` are untouched. `contracts.ts` / `handleSessionEndConfigSchema` were intentionally left unmodified to avoid overlap with Plan 03 in the same wave.

## Threat Model Coverage

- **T-06-13** (deleting wrong/too many rows): reuses Plan 02's project+`created_at`-scoped, parameterized `deleteMemoriesOlderThan`; `retentionDays<=0` disables; test proves only the aged row is deleted and the summary persists.
- **T-06-14** (prune failure blocking summarization): prune wrapped in try/catch; test forces `deleteOldMemories` to throw and asserts `handleSessionEnd` still returns `ok:true` / `stored`.
- **T-06-15** (config-driven cutoff): `retentionDays` sourced from the zod-validated `policyConfig`, which falls back to the 90-day default on any malformed config — never to a delete-everything cutoff.

## Deviations from Plan

None — plan executed as written. The optional `now`/override/`deleteOldMemories` seams were the plan-sanctioned test-injection mechanism (allowed under the task's "Optionally allow a deps.now seam or accept a test injection" guidance).

## Verification

- `npx vitest run tests/integration/core/session-end-auto-prune.spec.ts --reporter=dot` — 4/4 pass
- `npx vitest run tests/integration/core/session-lifecycle-summary.spec.ts tests/integration/core/summarization-retry-failure.spec.ts --reporter=dot` — 4/4 pass (no regression)
- `npx tsc --noEmit` — clean
- Full suite: 177 passed, 8 skipped. One pre-existing failure (`tests/integration/cli/cli-entrypoint.spec.ts`) requires a built `dist/` (`npm run build`) and is unrelated to these changes — logged to `deferred-items.md`.

## Deferred Issues

- `tests/integration/cli/cli-entrypoint.spec.ts` fails in this worktree because `dist/cli/index.js` is not built. Out of scope (build-artifact dependency, not caused by this plan).

## Known Stubs

None.

## Self-Check: PASSED

- `src/core/api/sessionLifecycleService.ts` — FOUND
- `src/core/api/memoryCoreService.ts` — FOUND
- `tests/integration/core/session-end-auto-prune.spec.ts` — FOUND
- Commit `81ffd80` — FOUND

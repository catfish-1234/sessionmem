---
phase: 02-session-lifecycle-summarization-pipeline
plan: 02
subsystem: lifecycle-orchestration
tags: [summarization, cloud-fallback, retry, idempotency]
requires:
  - phase: 02-01
    provides: Lifecycle contracts, failure table, wave-0 tests
provides:
  - "Session-end orchestration service with threshold gating and status responses"
  - "Local/cloud mode selector with explicit opt-in and retry fallback flow"
  - "Integration coverage for CAPT-02/CAPT-04 lifecycle statuses and failure records"
affects: [core-api, summarize, storage, integration-tests]
tech-stack:
  added: []
  patterns: [mode resolution, cloud retry plus local fallback, deterministic summary sections]
key-files:
  created:
    - src/core/api/sessionLifecycleService.ts
    - src/core/summarize/summaryShape.ts
    - src/core/summarize/redaction.ts
    - src/core/summarize/localSummarizer.ts
    - src/core/summarize/cloudSummarizer.ts
    - src/core/summarize/strategySelector.ts
  modified:
    - src/core/api/memoryCoreService.ts
    - tests/integration/core/session-lifecycle-summary.spec.ts
    - tests/integration/core/summarization-retry-failure.spec.ts
key-decisions:
  - "Delegated `handleSessionEnd` from core facade to dedicated `sessionLifecycleService`."
  - "Cloud path retries exactly 2 times before local fallback."
  - "Persisted exhausted failures with `attempt_count` for manual retry tooling."
patterns-established:
  - "Session lifecycle returns explicit statuses: stored / skipped_threshold / skipped_disabled / failed."
requirements-completed: [CAPT-02, CAPT-04]
duration: 16min
completed: 2026-05-25
---

# Phase 02 Plan 02: Session Lifecycle + Summarization Pipeline Summary

**Lifecycle orchestration implemented: session-end trigger, policy-gated cloud/local mode, retry fallback, durable failure records, and passing integration coverage.**

## Task Commits

1. **Task 1: Local summary shaping/redaction/token cap pipeline** - `c3740ee`
2. **Task 2: Orchestrator + strategy + fallback wiring** - `e33aa76`
3. **Task 3: CAPT-02/CAPT-04 integration assertions** - `e6eb222`

## Verification

- `npx vitest run tests/integration/core/session-lifecycle-summary.spec.ts --reporter=dot`
- `npx vitest run tests/integration/core/summarization-retry-failure.spec.ts --reporter=dot`
- `npx vitest run tests/integration/core/manual-summary-when-auto-off.spec.ts --reporter=dot`
- `npx vitest run --reporter=dot`

## Self-Check: PASSED

- FOUND: `.planning/phases/02-session-lifecycle-summarization-pipeline/02-02-SUMMARY.md`
- FOUND: `c3740ee`
- FOUND: `e33aa76`
- FOUND: `e6eb222`

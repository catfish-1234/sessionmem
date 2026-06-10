---
phase: 06-security-privacy-and-retention-hardening
plan: 02
subsystem: core-retention
tags: [retention, pruning, security, sqlite, zod]
requires:
  - src/core/storage/memoryRepo.ts (insertMemory, listMemoriesByProject, created_at column)
  - src/core/api/memoryCoreService.ts (methods map, parseRequest, call dispatcher)
  - src/core/api/contracts.ts (request/response zod maps)
provides:
  - countMemoriesOlderThan / deleteMemoriesOlderThan repo functions
  - pruneMemories service method (dry-run + apply) on MemoryCoreService
  - pruneMemoriesRequest/Response contracts registered in core maps
affects:
  - 06-04 (session-end auto-prune wiring consumes pruneMemories)
  - 06-05 (retention prune CLI command consumes pruneMemories)
tech-stack:
  added: []
  patterns:
    - lexicographic ISO-8601 comparison against created_at for age-based pruning
    - dry-run-by-default destructive operation (D-12)
key-files:
  created:
    - tests/unit/core/prune-memories.spec.ts
    - tests/integration/core/retention-prune.spec.ts
  modified:
    - src/core/storage/memoryRepo.ts
    - src/core/api/contracts.ts
    - src/core/api/memoryCoreService.ts
decisions:
  - "Cutoff computed in JS as Date.now() - retentionDays days, formatted via toISOString() to match the stored strftime('%Y-%m-%dT%H:%M:%fZ') created_at format for valid lexicographic comparison."
  - "retentionDays <= 0 short-circuits before any cutoff computation, guaranteeing a non-positive window can never delete rows (T-06-07)."
metrics:
  duration: ~6min
  completed: 2026-06-10
requirements: [SECU-01]
---

# Phase 06 Plan 02: Retention Prune Core Summary

Age-based retention pruning engine: `created_at`-keyed count/delete repo functions plus a `pruneMemories` MemoryCoreService method with dry-run (count-only) and apply (hard-delete) modes, fully parameterized and scoped to the `memories` table only.

## What Was Built

- **Repo layer (`memoryRepo.ts`):** `countMemoriesOlderThan(db, projectId, cutoffIso)` returns the number of memories with `created_at < cutoffIso` for a project; `deleteMemoriesOlderThan(db, projectId, cutoffIso)` hard-deletes those rows and returns `result.changes`. Both use prepared statements with bound `project_id` and `cutoff` parameters — no string interpolation (T-06-05). Neither touches `session_events` or `memory_feedback` (D-01).
- **Contracts (`contracts.ts`):** `pruneMemoriesRequestSchema` (`projectId: string.min(1)`, `retentionDays: number.int()`, `dryRun: boolean.default(true)`) and `pruneMemoriesResponseSchema` (`ok`, `deleted`, `eligible`); `PruneMemoriesRequest`/`PruneMemoriesResponse` types; registered `pruneMemories` in `MemoryCoreRequestMap` and `MemoryCoreResponseMap`.
- **Service (`memoryCoreService.ts`):** `pruneMemories` method in the methods map — validates via `parseRequest`, short-circuits to `{deleted:0, eligible:0}` when `retentionDays <= 0` (D-03), otherwise computes the ISO cutoff, counts eligible rows, and either returns the dry-run count or delegates to `deleteMemoriesOlderThan` for hard-delete (D-04). Routes through the existing `call` dispatcher so errors become envelopes via `toErrorResponse`.

## Tasks

| Task | Name | RED | GREEN | Files |
| ---- | ---- | --- | ----- | ----- |
| 1 | count/delete-older-than repo functions | e4d297b | 7dae414 | memoryRepo.ts, prune-memories.spec.ts |
| 2 | pruneMemories contract + service method | 621c5ed | 129121d | contracts.ts, memoryCoreService.ts, retention-prune.spec.ts |

## Verification

- `npx vitest run tests/unit/core/prune-memories.spec.ts tests/integration/core/retention-prune.spec.ts --reporter=dot` → 11 passed.
- `npx tsc --noEmit` → exit 0, no type errors.
- Grep confirms no `DELETE FROM session_events`/`memory_feedback` in `src/core` changes (memories-only).
- Full suite: 146 passed, 8 skipped. One unrelated pre-existing failure (`tests/integration/cli/cli-entrypoint.spec.ts`) — see Deferred Issues.

## Threat Model Compliance

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-06-05 | mitigate | `project_id` + `cutoff` bound as parameters; unit test asserts no `${...}` interpolation in source |
| T-06-06 | mitigate | `dryRun` defaults true; cutoff scoped by `project_id AND created_at`; integration test proves only intended rows deleted and survivors/session_events retained |
| T-06-07 | mitigate | `retentionDays <= 0` returns early with 0 before any cutoff is computed |
| T-06-08 | accept | Errors route through existing `toErrorEnvelope`; no new sensitive data exposed |

## Deviations from Plan

None — plan executed exactly as written.

## Deferred Issues

- `tests/integration/cli/cli-entrypoint.spec.ts` fails with "Built CLI not found at .../dist/cli/index.js" — a pre-existing build-artifact/environment issue (no `dist/` in fresh worktree), unrelated to this plan's core changes. Logged in `deferred-items.md`. Out of scope per SCOPE BOUNDARY (failure in unrelated build path, not caused by this task).

## Known Stubs

None — both functions and the service method are fully wired and exercised by tests.

## Self-Check: PASSED

All 5 created/modified source+test files exist on disk; all 4 per-task commits (e4d297b, 7dae414, 621c5ed, 129121d) present in git history.

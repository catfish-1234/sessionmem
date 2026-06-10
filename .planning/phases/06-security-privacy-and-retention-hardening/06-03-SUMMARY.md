---
phase: 06-security-privacy-and-retention-hardening
plan: 03
subsystem: core-api-redaction
tags: [redaction, security, privacy, write-paths, scrub]
requires:
  - "src/core/summarize/redaction.applyRedaction (Plan 06-01)"
  - "src/core/api/memoryCoreService storeMemory/importMemories (existing)"
  - "src/core/storage/memoryRepo.listMemoriesByProject"
provides:
  - "Redaction on storeMemory + importMemories write paths (default on)"
  - "redactExisting core operation (dry-run scan + idempotent in-place scrub)"
  - "updateMemoryContent repo function (parameterized in-place content UPDATE)"
  - "warningCodes envelope on store/import responses (redaction_partial_failure)"
affects:
  - "src/core/api/contracts.ts"
  - "src/core/api/memoryCoreService.ts"
  - "src/core/storage/memoryRepo.ts"
  - "src/cli/commands/import.ts"
tech-stack:
  added: []
  patterns:
    - "applyRedaction before deterministicEmbed on every write path (D-06)"
    - "warningCodes/redaction_partial_failure reuse across paths (D-08)"
    - "dry-run-by-default one-time scrub with --apply (D-07/D-14)"
key-files:
  created:
    - "tests/integration/core/redaction-write-paths.spec.ts"
    - "tests/integration/core/redact-existing.spec.ts"
  modified:
    - "src/core/api/contracts.ts"
    - "src/core/api/memoryCoreService.ts"
    - "src/core/storage/memoryRepo.ts"
    - "src/cli/commands/import.ts"
decisions:
  - "Introduced dedicated storeMemoryResponseSchema (warningCodes) so getMemory's singleMemoryResponseSchema shape stays unchanged"
  - "Import warningCodes de-duplicated via Set so the envelope stays compact across many records"
  - "redactExisting previews built from REDACTED text and truncated to 120 chars — never echo raw secret"
  - "updateMemoryContent uses COALESCE on normalized_content so callers may update content alone"
metrics:
  duration: "~5 min"
  completed: "2026-06-10"
  tasks: 2
  files_changed: 6
requirements: [SECU-02]
---

# Phase 06 Plan 03: Manual/Import Redaction + redactExisting Summary

JWT/API-key/email redaction now runs on every memory-write path (manual `storeMemory` and `importMemories`, joining the existing auto-summarize path) under one `redactionEnabled` flag (default on), and a new `redactExisting` core operation provides a non-destructive scan plus an idempotent in-place scrub for pre-existing rows.

## What Was Built

### Task 1 — Redaction on store/import write paths (D-06, D-08)
- `storeMemoryRequestSchema` and `importMemoriesRequestSchema` gained `redactionEnabled: z.boolean().default(true)`.
- `storeMemory` now calls `applyRedaction(content, { redactionEnabled })` before `deterministicEmbed` + `insertMemory`, persists the redacted text, and returns `warningCodes`.
- `importMemories` redacts each record before embed/upsert and aggregates (de-duplicated) `warningCodes` across all records.
- Added a dedicated `storeMemoryResponseSchema` (`memory` + `warningCodes`) so `getMemory` (which shares `singleMemoryResponseSchema`) keeps its exact shape — no `warningCodes` leaks into `getMemory`.
- Reuses the existing `redaction_partial_failure` code emitted by `applyRedaction` (no new code invented).

### Task 2 — redactExisting scan-and-scrub (D-07, D-14)
- Added `updateMemoryContent(db, projectId, memoryId, newContent, newNormalized?)` to `memoryRepo.ts`, mirroring `updateMemoryImportance`: fully parameterized UPDATE, `COALESCE` on `normalized_content`, throws on zero rows.
- Added `redactExistingRequestSchema` (`projectId`, `apply` default false) and `redactExistingResponseSchema` (`scanned`/`matched`/`updated`/`previews`), registered in the request/response maps.
- Added the `redactExisting` service method: enumerates rows via `listMemoriesByProject`, counts a "match" when redacted text differs from stored content, builds length-bounded previews (120 chars max) from the **redacted** text, and on `apply=true` rewrites matching rows in place (recomputing the embedding-normalized text). Dry-run (default) writes nothing; re-apply is idempotent (matched:0).

## How It Was Verified
- `npx vitest run tests/integration/core/redaction-write-paths.spec.ts tests/integration/core/redact-existing.spec.ts --reporter=dot` — 15 passing.
- `npx vitest run tests/integration/core/session-lifecycle-summary.spec.ts` — existing summarization redaction path still passes (2).
- Full core suite `npx vitest run tests/integration/core` — 36 passing, no regressions.
- `npx tsc --noEmit` — clean.

## TDD Gate Compliance
Both tasks followed RED -> GREEN. Gate commits present:
- Task 1: `test(06-03)` e793990 (RED) -> `feat(06-03)` 1a51b61 (GREEN)
- Task 2: `test(06-03)` ac60bcd (RED) -> `feat(06-03)` 8ab06dc (GREEN)
No REFACTOR commits needed; implementation was clean on first green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] import CLI caller missing redactionEnabled**
- **Found during:** Task 1 (tsc verification)
- **Issue:** Adding `redactionEnabled` (defaulted) to `importMemoriesRequestSchema` made it required in the inferred request-map input type, so `src/cli/commands/import.ts` failed to typecheck.
- **Fix:** Pass `redactionEnabled: true` explicitly at the import CLI call site (consistent with D-06 default-on policy — imported files are scrubbed before persistence).
- **Files modified:** src/cli/commands/import.ts
- **Commit:** 1a51b61

## Threat Model Coverage
- T-06-09 (manual/import bypass): closed — both paths route through `applyRedaction`; tests assert raw secrets absent from stored content.
- T-06-10 (preview echoing secrets): mitigated — previews built from redacted text, truncated to 120 chars; test asserts bound and absence of raw secret.
- T-06-11 (updateMemoryContent SQL): mitigated — parameterized binding mirrors `updateMemoryImportance`, no interpolation.
- T-06-12 (silent redaction failure): mitigated — `redaction_partial_failure` surfaced in store/import response envelopes.

No new security surface introduced beyond the planned threat model. No new package installs.

## Known Stubs
None.

## Self-Check: PASSED
- Files exist: redaction-write-paths.spec.ts, redact-existing.spec.ts, contracts.ts, memoryCoreService.ts, memoryRepo.ts, import.ts — all present.
- Commits exist: e793990, 1a51b61, ac60bcd, 8ab06dc — all in git log.

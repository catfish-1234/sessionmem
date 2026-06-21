---
phase: 16-performance-optimizations
plan: 04
subsystem: retrieval
tags: [fts5, search, performance, sqlite]
dependency_graph:
  requires: [16-01]
  provides: [fts5-candidate-prefilter]
  affects: [retrieval-pipeline]
tech_stack:
  added: [fts5]
  patterns: [external-content-fts, trigger-sync, fallback-on-sparse-results]
key_files:
  created:
    - src/core/schema/migrations/008_fts5_search.sql
    - tests/integration/retrieve/fts-search.spec.ts
  modified:
    - src/core/storage/memorySearchRepo.ts
    - src/core/retrieve/retrieveMemories.ts
    - tests/integration/storage/schema.spec.ts
decisions:
  - "Used FTS5 external content mode to avoid data duplication"
  - "Set FTS candidate limit at 50, fallback threshold at 5"
  - "Sanitize FTS query by quoting each token to handle special characters"
  - "Catch FTS MATCH errors and fall back to full scan for robustness"
metrics:
  duration: "4m 10s"
  completed: "2026-06-21T13:29:45Z"
  tasks_completed: 3
  tasks_total: 3
  tests_added: 6
---

# Phase 16 Plan 04: FTS5 Candidate Pre-filtering Summary

FTS5 full-text search pre-filters memory candidates to ~50 before cosine similarity, using external-content virtual table with trigger-based sync and automatic fallback to full scan on sparse results.

## Task Completion

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Implement searchMemoryCandidatesFTS | 61de7c6 | 008_fts5_search.sql, memorySearchRepo.ts |
| 2 | Wire FTS into retrieveMemories | 436a439 | retrieveMemories.ts |
| 3 | Add FTS search integration test | 7364ba8 | fts-search.spec.ts, schema.spec.ts |

## Implementation Details

### Migration 008: FTS5 Virtual Table
- Created `memories_fts` FTS5 virtual table using external content mode (`content='memories'`)
- Added INSERT, DELETE, and UPDATE triggers to keep FTS index in sync with memories table
- Populates index from existing rows on migration

### searchMemoryCandidatesFTS Function
- Joins `memories_fts` with `memories` table to get full row data
- Returns top-50 results ordered by FTS rank
- Falls back to `searchMemoryCandidates` (full scan) when FTS returns < 5 results
- Sanitizes query tokens by double-quoting each word for safe FTS5 MATCH syntax
- Catches FTS MATCH exceptions and falls back to full scan

### retrieveMemories Wiring
- When `queryText` is present, uses `searchMemoryCandidatesFTS` as candidate source
- When no query text, falls through to regular `searchMemoryCandidates`
- Cosine similarity now computed on ~50 candidates instead of up to 2000

## Tests Added

6 integration tests in `tests/integration/retrieve/fts-search.spec.ts`:
1. Keyword matching returns correct memories
2. Fallback triggers when FTS returns < 5 results
3. Return shape matches searchMemoryCandidates
4. 50-candidate limit is enforced
5. Empty query falls back to full search
6. Results scoped to correct project_id

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated schema migration count test**
- **Found during:** Task 3
- **Issue:** Adding migration 008 broke existing schema test that expected exactly 7 migrations
- **Fix:** Updated expected count from 7 to 8 and added "008_fts5_search.sql" to migration name list
- **Files modified:** tests/integration/storage/schema.spec.ts
- **Commit:** 7364ba8

## Verification

- `npx vitest run` -- 355 tests pass across 69 test files
- 2 pre-existing test file failures excluded (cli-entrypoint.spec.ts, stdio-server.spec.ts -- require `npm run build`)

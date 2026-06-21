---
plan: 11-06
status: complete
---

## Summary

**Objective:** Add embedding version mismatch awareness to search and retrieval.

**What was done:**
1. Added version check in `searchMemoryCandidates` — stale `embedding_version` rows get `embedding: null`
2. Updated `retrieveMemories.ts` — null embeddings get neutral semantic score 0.5 (not 0)
3. Added `sessionmem re-embed` CLI command for bulk-updating stale embeddings
4. Added test verifying stale embeddings get 0.5 score

**Files modified:**
- `src/core/storage/memorySearchRepo.ts`
- `src/core/retrieve/retrieveMemories.ts`
- `src/cli/commands/reEmbed.ts`
- `tests/unit/retrieve/embedding-version.spec.ts`

# Phase 3: Injection Quality + Token Control - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement startup memory injection quality controls: deterministic injection formatting, hard token-budget enforcement, on-demand deeper retrieval, explicit importance feedback, and quality harness/reporting for relevance and budget compliance. Platform-specific adapter UX belongs to Phase 4; broad CLI command UX belongs to Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Startup Injection Format
- Use compact bullets grouped by memory kind, not an ungrouped flat list.
- Include memory content, score breakdown, source adapter, and date for each injected memory.
- Include a short `Relevant prior context` header.
- When budget is tight, trim lower-priority memory content first before trimming higher-priority memories.

### Token Budget Controls
- Default startup injection cap is `450` tokens.
- Enforce a hard cap, except critical warnings may be preserved.
- Use an exact tokenizer dependency now rather than a rough word/character heuristic.
- When too many strong memories compete for budget, prefer fewer but fuller memories over many heavily compressed entries.

### On-Demand Deeper Fetch
- Extend `retrieveMemories` with mode/depth options rather than creating a separate method.
- Keep auto injection small; allow on-demand retrieval to fetch more memories.
- On-demand retrieval response should include memory DTO data plus score metadata.
- On-demand retrieval by itself must not mutate importance.

### Importance Feedback
- Boost importance only from an explicit adapter/core `memory used` signal.
- Increase importance by `+1` per confirmed use.
- Auto boosts should cap below `10`; manual boost paths may reach `10`.
- Old auto boosts should decay over time.
- Update `importance` and `updated_at`, and also keep lightweight feedback history for auditability.

### Quality Harness
- Build benchmark-style quality reporting in this phase, not minimal unit coverage only.
- Use both realistic coding-session memory fixtures and synthetic edge-case fixtures.
- Pass criteria must verify expected top memories appear, output stays under cap, and exact output snapshots remain stable.
- Identical ranking inputs must produce exact same injection text.
- Relevance quality should be as strong as possible within Phase 3 scope, not merely token-cap compliant.

### Claude's Discretion
- Exact grouped section labels and text punctuation.
- Exact score metadata field names, as long as semantic/recency/importance details remain visible.
- Exact critical-warning representation, provided the hard cap behavior remains deterministic.
- Exact feedback history schema shape, provided auditability and decay support remain possible.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Success Criteria
- `.planning/ROADMAP.md` - Phase 3 goal, RETR-03/04/05 mapping, and five success criteria.

### Requirement Definitions
- `.planning/REQUIREMENTS.md` - RETR-03 startup injection cap, RETR-04 on-demand memories, and RETR-05 bounded importance boost requirements.

### Project Constraints
- `.planning/PROJECT.md` - Local-first, cross-platform, security/privacy, and default token-budget target under 400-500 tokens.

### Prior Locked Decisions
- `.planning/phases/01-core-memory-engine-foundation/01-CONTEXT.md` - Importance `1..10`, retrieval scoring weights, deterministic tie-breaks, local-only defaults, typed contracts.
- `.planning/phases/02-session-lifecycle-summarization-pipeline/02-CONTEXT.md` - Summary shape, token-limit precedent, cloud opt-in visibility, service-boundary validation.
- `.planning/STATE.md` - Current phase status and recorded decisions from prior plans.

### Existing Implementation Surfaces
- `src/core/api/contracts.ts` - Existing zod schemas and adapter-facing method contracts, including `retrieveMemories`.
- `src/core/api/memoryCoreService.ts` - Core service orchestration and current retrieval response mapping.
- `src/core/retrieve/retrieveMemories.ts` - Ranking pipeline, `queryText`/`query`, `topK`/`limit`, deterministic ordering, score calculation.
- `src/core/retrieve/score.ts` - Locked semantic/recency/importance weights and score breakdown shape.
- `src/core/storage/memoryRepo.ts` - Memory insert/upsert primitives and importance bounds.
- `src/core/storage/memorySearchRepo.ts` - Candidate loading and embedding parsing for retrieval.
- `src/core/schema/migrations/001_initial.sql` - Current memory table fields and `importance` check constraint.
- `tests/integration/retrieve/retrieve-ranked.spec.ts` - Existing retrieval ranking and deterministic tie-break coverage.
- `tests/unit/retrieve/scoring-weights.spec.ts` - Existing scoring weight and importance normalization coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `retrieveMemories` in `src/core/retrieve/retrieveMemories.ts`: existing scoring/ranking path should be extended for injection and deeper fetch behavior.
- `ScoreBreakdown` in `src/core/retrieve/score.ts`: usable as the score metadata exposed for injection/on-demand responses.
- `retrieveMemoriesRequestSchema` in `src/core/api/contracts.ts`: likely contract surface for adding mode/depth/token-budget options.
- `createMemoryCoreService` in `src/core/api/memoryCoreService.ts`: service boundary for validating new retrieval/injection requests and returning adapter-safe responses.
- `insertMemory` / `upsertSessionSummaryMemory` in `src/core/storage/memoryRepo.ts`: current importance guard path; feedback updates will need compatible storage helpers.

### Established Patterns
- Request boundaries are zod-validated at the service layer.
- Adapter-facing failures use `DomainError` and `{ ok: false, error }` envelopes.
- Retrieval ranking is deterministic and already combines semantic, recency, and importance.
- Existing retrieval accepts backward-compatible aliases (`query`/`limit` and `queryText`/`topK` internally).
- Tests already cover scoring weights, normalized importance, and deterministic ranking order.

### Integration Points
- Startup injection formatter should consume ranked retrieval results and emit deterministic text within the configured token cap.
- On-demand fetch should extend the retrieval contract while preserving existing `retrieveMemories` behavior for callers.
- Importance feedback should connect to core service/storage APIs so Phase 4 adapters can call it after confirmed memory use.
- Quality harness should reuse deterministic fixtures and the existing retrieval test style, then add benchmark-style reporting for relevance and token-budget compliance.

</code_context>

<specifics>
## Specific Ideas

- Header text should be `Relevant prior context`.
- Startup injection should favor quality and readability over squeezing in the maximum number of memories.
- Token counting should use an exact tokenizer dependency from this phase forward.
- Quality harness should be strong enough to guide product quality, not only satisfy low-level tests.

</specifics>

<deferred>
## Deferred Ideas

- Platform-specific adapter presentation and host UX for startup injection belong to Phase 4.
- CLI-specific controls for search/list/show/forget/stats belong to Phase 5.
- Broader privacy retention/redaction hardening belongs to Phase 6.

</deferred>

---

*Phase: 03-injection-quality-token-control*
*Context gathered: 2026-06-03*

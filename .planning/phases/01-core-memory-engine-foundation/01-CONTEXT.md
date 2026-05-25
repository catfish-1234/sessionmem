# Phase 1: Core Memory Engine Foundation - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the host-agnostic local memory core: schema and migration baseline for memories and session events, deterministic local embedding primitives, retrieval ranking primitives, and strict adapter-facing core contracts. This phase does not add cloud-first behavior or downstream platform-specific UX.

</domain>

<decisions>
## Implementation Decisions

### Memory Record Shape
- Use a hybrid memory model: one session summary record plus optional atomic fact records.
- Use importance as a `1-10` integer scale.
- Include provenance fields on memory records: `project_id`, `session_id`, `source_adapter`, and timestamps.
- Store normalized raw-ish session events in phase 1 with event type, sequence/index, and timestamp.

### Deterministic Embedding Strategy
- Use a local deterministic hash-based embedding baseline in phase 1.
- Keep embedding dimension fixed by config constant and persist dimension per record.
- Re-embed only when source text changes or `embedding_version` changes.
- Normalize input text before embedding with trim, whitespace collapse, unicode normalization, and lowercase conversion.

### Retrieval Ranking Policy
- Use weighted sum scoring across semantic similarity, recency, and importance.
- Default weights: semantic `0.60`, recency `0.25`, importance `0.15`.
- Use bucketed recency bands (`today`, `week`, `month`, `older`) for recency contribution.
- Enforce deterministic tie-break ordering: `score desc -> updated_at desc -> id asc`.

### Core API + Adapter Contract
- Include full lifecycle API surface in phase 1 (not minimal-only), including CRUD/retrieval/session ingestion/summarization and lifecycle operations expected by core consumers.
- Enforce strict typed request/response contracts for adapter integration.
- Use stable domain error classes: `VALIDATION`, `NOT_FOUND`, `CONFLICT`, `INTERNAL`.
- Enforce local-only default behavior; any external/cloud dependency requires explicit opt-in flags.

### Claude's Discretion
- Exact schema field names beyond required semantics above.
- Concrete hash-to-vector implementation details for deterministic local embeddings.
- Exact retrieval bucket boundaries (for example, precise day cutoffs) so long as they remain deterministic and documented.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Success Criteria
- `.planning/ROADMAP.md` - Phase 1 goal, requirement mapping, and success criteria.

### Requirement Definitions
- `.planning/REQUIREMENTS.md` - CAPT-01, CAPT-03, RETR-01, RETR-02, SECU-03 requirement definitions and constraints.

### Project Constraints
- `.planning/PROJECT.md` - Local-first, cross-platform, and token/security constraints that govern phase decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- No implementation code exists yet in this repository; no reusable runtime assets were identified.

### Established Patterns
- No established application patterns exist yet; phase 1 should define baseline conventions for schema, contracts, and retrieval behavior.

### Integration Points
- Core outputs from this phase become the integration foundation for later adapter rollout (Phase 4) and CLI operations (Phase 5).

</code_context>

<specifics>
## Specific Ideas

No external product-style references were requested; decisions are captured as direct implementation preferences for the foundation layer.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 01-core-memory-engine-foundation*
*Context gathered: 2026-05-25*

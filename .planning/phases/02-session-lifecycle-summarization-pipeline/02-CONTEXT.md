# Phase 2: Session Lifecycle + Summarization Pipeline - Context

**Gathered:** 2026-05-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement session lifecycle ingestion-to-summary pipeline: detect session end, run summarization, persist durable memory, support local/cloud summarizer strategy with explicit cloud opt-in, and preserve manual memory path when auto-summarize is disabled.

</domain>

<decisions>
## Implementation Decisions

### Session End Triggering
- Session end trigger comes from explicit adapter `session_end` event.
- Summarization runs immediately on trigger.
- Summary persistence is idempotent per `project_id + session_id` via upsert semantics.
- Minimum event threshold is user-configurable.
- Default threshold is `3` events.
- Threshold bounds are `1..100`.

### Summary Shape + Limits
- Summary format is structured sections: `goals / actions / decisions / blockers / outcomes`.
- Summary cap default is `300` tokens.
- Redaction pass is configurable and defaults to `on`.
- If redaction partially fails, continue with partial redaction and emit warning.
- Fact extraction mode is configurable.
- Default fact mode is `summary + facts`.
- Exposed fact modes: `summary-only | facts-only | summary+facts`.

### Summarizer Mode Policy
- Fresh install default uses local summarizer.
- Cloud summarization requires explicit `allowCloudSummarization=true` and provider key present.
- If cloud summarizer fails, fallback automatically to local summarizer.
- When cloud path is active, show startup warning, config status visibility, and documentation note.

### Failure + User Controls
- On summarization failure, retry 2 times with short backoff.
- If retries exhaust, persist failure record with reason for manual retry.
- When auto-summarize is disabled, manual summarization remains available via manual `summarizeSessionToMemory` trigger.
- Failure signals should emit warning event plus CLI/adapter notice.

### Claude's Discretion
- Exact backoff timings and retry jitter strategy.
- Exact token counting algorithm used to enforce `300` token cap.
- Exact redaction rule set and warning payload shape, as long as defaults and failure behavior remain as decided.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Scope and Success Criteria
- `.planning/ROADMAP.md` - Phase 2 goal and success criteria for lifecycle + summarization pipeline.

### Requirement Definitions
- `.planning/REQUIREMENTS.md` - CAPT-02, CAPT-04, and SECU-04 requirement definitions.

### Project Constraints and Policies
- `.planning/PROJECT.md` - Local-first constraints, security/privacy expectations, and launch direction.
- `.planning/phases/01-core-memory-engine-foundation/01-CONTEXT.md` - Locked Phase 1 decisions carried into Phase 2 (local-only default, strict contracts).

### Existing Implementation Surfaces
- `src/core/api/contracts.ts` - Existing request/response contracts including ingest/summarize/store/retrieve.
- `src/core/api/memoryCoreService.ts` - Current service orchestration and local-only guard integration.
- `src/core/storage/sessionEventsRepo.ts` - Session event persistence and ordering behavior.
- `src/core/storage/memoryRepo.ts` - Memory insert/upsert primitives used by summary persistence.
- `src/core/api/localOnlyPolicy.ts` - Explicit external-provider opt-in guard behavior.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/api/contracts.ts`: Existing typed API schemas for ingest, summarize, store, retrieve, and lifecycle calls.
- `src/core/api/memoryCoreService.ts`: Existing orchestration entrypoint and retrieval/memory integration.
- `src/core/storage/sessionEventsRepo.ts`: Event ingestion/listing helpers with deterministic `event_index` ordering.
- `src/core/storage/memoryRepo.ts`: Upsert helper for session summary memory and generic memory insertion.
- `src/core/api/localOnlyPolicy.ts`: Reusable local-only enforcement for cloud provider gating.

### Established Patterns
- Zod-validated request boundaries at service layer.
- DomainError + `{ ok: false, error }` envelopes for adapter-safe failures.
- Deterministic ordering and local-first defaults as baseline behavior.

### Integration Points
- Session end signal arrives via adapters and should call core service summarize path.
- Summarization pipeline should persist through memory repo upsert semantics.
- Cloud-policy checks should integrate with existing local-only guard before provider usage.

</code_context>

<specifics>
## Specific Ideas

- Keep user controls explicit: cloud summarization requires deliberate opt-in and visible status.
- Keep pipeline resilient: retry + fallback + failure record instead of silent drop.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 02-session-lifecycle-summarization-pipeline*
*Context gathered: 2026-05-25*
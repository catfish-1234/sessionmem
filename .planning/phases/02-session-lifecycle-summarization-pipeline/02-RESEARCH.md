# Phase 2: Session Lifecycle + Summarization Pipeline - Research

**Researched:** 2026-05-25  
**Domain:** Session-end summarization orchestration (local-first with explicit cloud opt-in)  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CAPT-02 | User session end triggers summary generation with configurable local/cloud summarizer. | Session-end orchestration pattern, local/cloud strategy selector, retry + fallback policy, explicit cloud gate design. |
| CAPT-04 | User can disable auto-summarize and still store manual memories. | Config split between `autoSummarize` and manual `summarizeSessionToMemory` path, manual trigger kept callable and tested independently. |
| SECU-04 | User is warned/documented when cloud summarization path is enabled. | Cloud status surfacing pattern: startup warning, config visibility surface, and required docs section for cloud data flow. |
</phase_requirements>

## Summary

Phase 2 should be planned as an orchestration layer on top of existing Phase 1 primitives, not a storage rewrite. The repository already has deterministic event ordering (`session_events.event_index`), summary idempotency support (`upsertSessionSummaryMemory` with unique summary key), typed service contracts, and local-only policy enforcement. The highest-leverage plan is to add a dedicated session lifecycle pipeline that composes these existing pieces.

The required behavior is a two-path summarizer strategy with strict default-local behavior and explicit cloud opt-in. Cloud is never implicit: it must require both a user opt-in flag and provider key presence; failures in cloud path should degrade to local summarizer automatically. This aligns directly with CAPT-02 and SECU-04 while preserving local-first policy.

Reliability and operator clarity are part of scope, not polish. Plan tasks must include retry/backoff behavior, durable failure records for manual retry, and explicit user-visible cloud status messaging in runtime output and docs. CAPT-04 should be handled by keeping manual summarize API callable even when auto summarization is off.

**Primary recommendation:** Implement a `SessionLifecycleOrchestrator` that handles `session_end` events, policy-gated summarizer selection, bounded summary generation/redaction, memory upsert, and failure recording as one deterministic flow.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.10.0 | Durable local session/memory persistence | Already integrated in core; sync writes match local agent lifecycle needs. |
| zod | 4.4.3 | Runtime config/payload validation | Existing contract boundary standard in this repo. |
| @anthropic-ai/sdk | 0.98.0 | Optional cloud summarization path | Official TS SDK; current release supports `messages.create` and token counting method. |
| p-retry | 8.0.0 | Bounded retries with backoff/jitter controls | Standard async retry utility; avoids hand-rolled retry bugs. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.7 | Integration/unit validation for lifecycle pipeline | Use for CAPT-02/CAPT-04/SECU-04 coverage and deterministic regression checks. |
| typescript | 5.9.3 (project-pinned) | Typed orchestration and config contracts | Keep project-pinned version during this phase unless explicit upgrade task is added. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `p-retry` | Custom retry loop | Custom logic is error-prone for jitter/abort semantics and harder to test. |
| Cloud SDK path | Local-only summarization | Simpler but cannot satisfy configurable cloud path requirement in CAPT-02. |
| Single-pass summarize+store | Multi-stage pipeline with failure records | Single-pass is simpler but loses recoverability and observability on failures. |

**Installation:**
```bash
npm install @anthropic-ai/sdk p-retry
```

**Version verification (npm registry, checked 2026-05-25):**
- `better-sqlite3` `12.10.0` (published `2026-05-12T09:58:59.557Z`)
- `zod` `4.4.3` (published `2026-05-04T07:06:40.819Z`)
- `vitest` `4.1.7` (published `2026-05-20T07:19:42.142Z`)
- `@anthropic-ai/sdk` `0.98.0` (published `2026-05-21T20:03:09.461Z`)
- `p-retry` `8.0.0` (published `2026-03-26T16:08:04.940Z`)

## Architecture Patterns

### Recommended Project Structure
```text
src/
|- core/
|  |- api/
|  |  |- contracts.ts                  # existing typed method contracts
|  |  |- memoryCoreService.ts          # existing service facade
|  |  `- sessionLifecycleService.ts    # NEW: session-end orchestration entrypoint
|  |- summarize/
|  |  |- strategySelector.ts           # NEW: local/cloud selection + policy checks
|  |  |- localSummarizer.ts            # NEW: default local path
|  |  |- cloudSummarizer.ts            # NEW: optional cloud path
|  |  |- redaction.ts                  # NEW: redaction pass + partial-failure warning
|  |  `- summaryShape.ts               # NEW: goals/actions/decisions/blockers/outcomes
|  `- storage/
|     |- sessionEventsRepo.ts          # existing ordered event reads
|     |- memoryRepo.ts                 # existing summary upsert
|     `- summarizationFailuresRepo.ts  # NEW: durable failure record persistence
`- adapters/
   `- contract/
      `- hostAdapterContract.ts        # existing adapter call boundary
```

### Pattern 1: Event-Driven Orchestrator
**What:** Dedicated handler for adapter `session_end` event that runs threshold check, summarization, and persistence immediately.  
**When to use:** Every ended session with `autoSummarize=true`.  
**Example:**
```typescript
// Source: local code pattern from src/core/api/memoryCoreService.ts
if (event.type === "session_end") {
  await lifecycle.runSessionEnd({
    projectId,
    sessionId,
    sourceAdapter,
  });
}
```

### Pattern 2: Policy-Gated Strategy Selection
**What:** Resolve summarizer path as `local` or `cloud` only after explicit cloud opt-in and key checks.  
**When to use:** Before any external call path.  
**Example:**
```typescript
// Source: local policy pattern from src/core/api/localOnlyPolicy.ts
const useCloud =
  config.allowCloudSummarization === true &&
  Boolean(config.providers?.anthropic?.apiKey);
const strategy = useCloud ? "cloud" : "local";
```

### Pattern 3: Retry + Fallback + Durable Failure Record
**What:** Retry cloud summarization twice with short backoff; fallback to local; if all fail, persist failure record for manual retry.  
**When to use:** All summarization attempts.  
**Example:**
```typescript
// Source: https://github.com/sindresorhus/p-retry
const summary = await pRetry(runPrimarySummarizer, { retries: 2 });
```

### Anti-Patterns to Avoid
- **Implicit cloud activation:** Never infer cloud mode from provider key alone; require explicit `allowCloudSummarization=true`.
- **Non-durable failure handling:** Do not log-and-drop summarization failures; persist recoverable failure records.
- **Bypassing summary upsert key:** Do not write summary memories via generic insert path; keep idempotent upsert on `project_id + session_id + kind='summary'`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry/backoff orchestration | Custom retry loops | `p-retry` | Handles retry count/backoff/error context consistently. |
| Summary idempotency | Manual pre-check then insert/update branch | Existing `upsertSessionSummaryMemory` + SQLite `ON CONFLICT` | Reduces race/duplication bugs and preserves single-source semantics. |
| Token budgeting heuristics | Approximate by character count only | Model/API token counting for cloud path + deterministic local estimator | Better alignment with 300-token cap behavior across providers. |
| Policy guarding | Inline `if` checks across call sites | Centralized policy gate (`localOnlyPolicy` + summarizer mode guard) | Prevents policy drift and hidden cloud paths. |

**Key insight:** Phase 2 risk is orchestration drift, not algorithm novelty. Reuse proven primitives and centralize decisions in one lifecycle service.

## Common Pitfalls

### Pitfall 1: Cloud Mode Accidentally Enabled
**What goes wrong:** Summarizer uses cloud when user only set provider key.  
**Why it happens:** Missing explicit opt-in flag check.  
**How to avoid:** Require both `allowCloudSummarization=true` and valid provider key before cloud path activation.  
**Warning signs:** Startup indicates local-only but outbound cloud request still occurs.

### Pitfall 2: Summary Size Drift Beyond 300 Tokens
**What goes wrong:** Persisted summaries exceed cap and bloat downstream retrieval/injection.  
**Why it happens:** Cap enforced pre-redaction but not post-redaction/fact extraction.  
**How to avoid:** Enforce token cap at final persisted payload boundary.  
**Warning signs:** Integration tests show cap breaches after fallback path.

### Pitfall 3: Partial Redaction Treated as Hard Failure
**What goes wrong:** Useful summary is dropped due to one redaction rule error.  
**Why it happens:** Pipeline aborts instead of partial-continue policy.  
**How to avoid:** Continue with partial redaction and emit structured warning payload (as locked decision requires).  
**Warning signs:** High failure rate when redaction is enabled.

### Pitfall 4: CAPT-04 Regression (Manual Path Broken)
**What goes wrong:** Turning off auto-summarize disables manual summarize flow too.  
**Why it happens:** Shared gate incorrectly blocks all summarize operations.  
**How to avoid:** Separate `autoSummarize` trigger gate from manual `summarizeSessionToMemory` command path.  
**Warning signs:** Manual command returns disabled-state errors when auto mode is off.

## Code Examples

Verified patterns from official and repository sources:

### Idempotent Session Summary Upsert
```typescript
// Source: /src/core/storage/memoryRepo.ts
upsertSessionSummaryMemory(db, {
  id: memoryId,
  project_id: projectId,
  session_id: sessionId,
  source_adapter: sourceAdapter,
  kind: "summary",
  content: summaryText,
  normalized_content: normalized,
  importance: 7,
  embedding: vectorJson,
  embedding_dim: 32,
  embedding_version: "v1",
});
```

### Cloud Summarization Call Shape
```typescript
// Source: https://github.com/anthropics/anthropic-sdk-typescript
const message = await client.messages.create({
  model: "claude-sonnet-4-20250514",
  max_tokens: 512,
  messages: [{ role: "user", content: prompt }],
});
```

### Token Counting Before Final Persist (Cloud Path)
```typescript
// Source: https://platform.claude.com/docs/en/api/messages/count_tokens
const tokenCount = await client.messages.countTokens({
  model: "claude-sonnet-4-20250514",
  messages: [{ role: "user", content: summaryText }],
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc summary insertion per session | Idempotent upsert keyed by unique summary constraint | Existing in this repo (Phase 1, 2026-05-25) | Prevents duplicate summaries and supports retries safely. |
| Monolithic one-shot summarize operation | Strategy-based summarize (cloud/local) with retry + fallback | Current best practice in SDK-era agent systems (2025-2026) | Improves reliability under provider errors and local-first policy constraints. |
| Character-count budget estimation | Token-count-aware capping (provider endpoint when cloud) | Available in current Anthropic API docs | More accurate enforcement of hard token caps. |

**Deprecated/outdated:**
- Hidden cloud fallback defaults: conflicts with explicit local-first and SECU-04 warning requirements.
- Dropping failures to logs only: not acceptable for recoverable summarization workflows.

## Open Questions

1. **Where should durable summarization failure records live?**
   - What we know: Locked decision requires persistence with reason for manual retry.
   - What's unclear: New table (`summarization_failures`) vs memory-kind row for failures.
   - Recommendation: Add a dedicated table for failure metadata and retry attempts.

2. **What local summarizer baseline should be used first?**
   - What we know: Fresh install must default local; cloud optional.
   - What's unclear: Rule-based extractive summary vs local model-based summarizer in this phase.
   - Recommendation: Start with deterministic extractive baseline now; keep interface pluggable.

3. **How should threshold filtering interact with manual summarize?**
   - What we know: Threshold is configurable and defaults to 3.
   - What's unclear: Whether manual command should bypass threshold gate.
   - Recommendation: Manual command bypasses threshold; threshold applies only to auto path.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.7 |
| Config file | none - see Wave 0 |
| Quick run command | `npm run test` |
| Full suite command | `npm run test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAPT-02 | `session_end` triggers summarize pipeline with local/cloud strategy and cloud->local fallback | integration | `npx vitest run tests/integration/core/session-lifecycle-summary.spec.ts --reporter=dot` | NO (Wave 0) |
| CAPT-02 | Retries cloud summarization twice, then records failure when exhausted | integration | `npx vitest run tests/integration/core/summarization-retry-failure.spec.ts --reporter=dot` | NO (Wave 0) |
| CAPT-04 | `autoSummarize=false` disables auto trigger but manual `summarizeSessionToMemory` still succeeds | integration | `npx vitest run tests/integration/core/manual-summary-when-auto-off.spec.ts --reporter=dot` | NO (Wave 0) |
| SECU-04 | Cloud mode emits startup/config warning and docs-visible status flag | unit + integration | `npx vitest run tests/unit/core/cloud-status-warning.spec.ts tests/integration/core/cloud-optin-policy.spec.ts --reporter=dot` | NO (Wave 0) |

### Sampling Rate
- **Per task commit:** `npm run test`
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/core/session-lifecycle-summary.spec.ts` - CAPT-02 end-to-end session-end pipeline
- [ ] `tests/integration/core/summarization-retry-failure.spec.ts` - CAPT-02 retry/failure record behavior
- [ ] `tests/integration/core/manual-summary-when-auto-off.spec.ts` - CAPT-04 manual path with auto disabled
- [ ] `tests/unit/core/cloud-status-warning.spec.ts` - SECU-04 warning/config status behavior
- [ ] `tests/integration/core/cloud-optin-policy.spec.ts` - SECU-04 explicit opt-in enforcement
- [ ] Optional config hardening: add `vitest.config.ts` if per-file retry/timeouts become necessary

## Sources

### Primary (HIGH confidence)
- Phase context and locked decisions: `.planning/phases/02-session-lifecycle-summarization-pipeline/02-CONTEXT.md`
- Requirement definitions: `.planning/REQUIREMENTS.md`
- Existing orchestration and contracts:
  - `src/core/api/contracts.ts`
  - `src/core/api/memoryCoreService.ts`
  - `src/core/api/localOnlyPolicy.ts`
  - `src/core/storage/sessionEventsRepo.ts`
  - `src/core/storage/memoryRepo.ts`
  - `src/core/schema/migrations/002_indexes.sql`
- Official package/API docs:
  - https://github.com/sindresorhus/p-retry
  - https://github.com/anthropics/anthropic-sdk-typescript
  - https://platform.claude.com/docs/en/api/messages/count_tokens
  - https://docs.anthropic.com/en/api/rate-limits
  - https://www.sqlite.org/lang_upsert.html
  - https://vitest.dev/config/retry.html

### Secondary (MEDIUM confidence)
- Prior project-wide architecture/stack research:
  - `.planning/research/STACK.md`
  - `.planning/research/ARCHITECTURE.md`
  - `.planning/research/PITFALLS.md`

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified versions from npm registry and official package docs.
- Architecture: HIGH - directly grounded in existing repository patterns and constraints.
- Pitfalls: HIGH - derived from locked decisions, known failure modes, and official retry/rate-limit guidance.

**Research date:** 2026-05-25  
**Valid until:** 2026-06-01

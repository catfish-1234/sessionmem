# Phase 1: Core Memory Engine Foundation - Research

**Researched:** 2026-05-25
**Domain:** Local-first memory core (schema, embeddings, retrieval, host-agnostic APIs)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Hybrid memory model: one session summary plus optional atomic fact records.
- Importance score uses integer `1-10`.
- Memory provenance includes `project_id`, `session_id`, `source_adapter`, timestamps.
- Session events persist as normalized raw-ish events with event type, sequence/index, timestamp.
- Embeddings are local deterministic hash-based baseline in phase 1.
- Embedding dimensions are fixed by config and stored per record.
- Re-embed only when text changes or `embedding_version` changes.
- Pre-embedding normalization: trim, collapse whitespace, unicode normalize, lowercase.
- Retrieval ranking is weighted sum of semantic + recency + importance.
- Default weights: semantic `0.60`, recency `0.25`, importance `0.15`.
- Recency model uses bucket bands (`today`, `week`, `month`, `older`).
- Deterministic tie-break: `score desc -> updated_at desc -> id asc`.
- Core API in phase 1 includes full lifecycle surface.
- Adapter contract is strict typed request/response with stable domain errors.
- Local-only default; any external path requires explicit opt-in flags.

### Claude's Discretion
- Exact field names in schema/API as long as locked semantics stay.
- Exact deterministic hash-to-vector implementation.
- Exact recency bucket cutoffs.

### Deferred Ideas (OUT OF SCOPE)
- None.
</user_constraints>

<research_summary>
## Summary

Phase 1 should establish one strict core contract and one strict local data model before adapter rollout. Best fit is Node.js + TypeScript with SQLite as source of truth, vector data co-located in same DB, and pure local deterministic embedding baseline to satisfy SECU-03 and deterministic behavior goals.

Use ports-and-adapters architecture now: adapters only translate host/runtime events, core owns all storage/retrieval/ranking decisions. This prevents host drift, keeps retrieval behavior consistent, and lets later phases add adapters and CLI features without rewriting internals.

Primary recommendation: implement phase in four vertical chunks: schema+migrations, deterministic embedding module, retrieval ranking service, then strict host-agnostic core API/contract on top.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22 LTS | Runtime | Cross-platform tool/runtime baseline |
| TypeScript | 5.x | Typed contracts | Stable adapter/core interfaces |
| better-sqlite3 | 12.x | Local durable storage | Fast sync access for local agent workflows |
| sqlite-vec | 0.1.x | Vector similarity | Keep vectors in same local DB |
| zod | 4.x | Runtime validation | Strict typed request/response boundaries |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | 1.x | MCP protocol wiring | Used by adapter/server layers that call core |
| vitest | 4.x | Unit/integration tests | Validate deterministic ranking, schema, and API contracts |
| pino | 9.x | Structured logs | Debug ingestion/retrieval and contract failures |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sqlite-vec | Pure JS cosine on arrays | Simpler startup, but weaker retrieval scaling |
| hash embeddings | Local transformer embeddings | Better semantics later, heavier runtime now |
| strict schemas | loose JSON payloads | Faster prototype, high long-term drift risk |
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── core/
│   ├── schema/
│   ├── storage/
│   ├── embed/
│   ├── retrieve/
│   └── api/
├── adapters/
│   └── contract/
└── config/
```

### Pattern 1: Event-First Storage + Derived Memories
**What:** Keep session events + derived memory records.
**When to use:** Always for CAPT-01 and CAPT-03 traceability.
**Example:**
```typescript
type SessionEventRow = {
  id: string;
  project_id: string;
  session_id: string;
  event_index: number;
  event_type: string;
  payload_json: string;
  created_at: string;
};
```

### Pattern 2: Versioned Deterministic Embedding
**What:** Embed using deterministic pipeline with `embedding_version` stored per row.
**When to use:** All memory writes and re-embed checks.
**Example:**
```typescript
const shouldReembed =
  previous.embedding_version !== currentVersion ||
  previous.normalized_text !== normalizedText;
```

### Pattern 3: Deterministic Ranking Pipeline
**What:** Single scoring function + stable tie-break sequence.
**When to use:** Every retrieval query, including adapter-triggered startup recall.
**Example:**
```typescript
const score =
  semantic * 0.60 +
  recencyBandScore * 0.25 +
  importanceNormalized * 0.15;
```

### Anti-Patterns to Avoid
- Adapter code reading DB directly (breaks parity/ownership boundaries).
- Re-embedding unchanged text on every read (wasteful, non-deterministic latency).
- Hidden cloud fallback defaults (violates SECU-03 local-only default).
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration lifecycle | Ad-hoc SQL scattered in code | Versioned migration runner | Safe schema evolution and rollback |
| Runtime validation | Manual if/else payload checks | zod schema validation | Consistent domain errors |
| Vector search sort only in app | Full table scans with JS sort | sqlite-vec indexed lookup + app rerank | Better scale with deterministic core behavior |

Key insight: phase 1 needs boring, explicit primitives. Clever shortcuts now create adapter and retrieval drift later.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Contract Drift Between Adapters
**What goes wrong:** Each adapter sends different payload shape.
**Why it happens:** No shared validation schemas.
**How to avoid:** Central `zod` contracts + shared error enum.
**Warning signs:** Adapter-specific parsing logic appears in core API.

### Pitfall 2: Weak Determinism in Retrieval
**What goes wrong:** Same query returns different order run-to-run.
**Why it happens:** Floating tie behavior and unstable sort keys.
**How to avoid:** Stable tie-break with explicit key order.
**Warning signs:** Snapshot tests flaky for retrieval output.

### Pitfall 3: Local-Only Policy Regression
**What goes wrong:** External calls occur without explicit opt-in.
**Why it happens:** Convenience fallback path merged into core.
**How to avoid:** Feature flags default off + hard policy check in API boundary.
**Warning signs:** Network call attempt during local-only test harness.
</common_pitfalls>

## Validation Architecture

Use fast feedback for each plan task and full checks per wave.

- Per-task quick run: `cmd /c npx vitest run --reporter=dot`
- Per-wave full run: `cmd /c npx vitest run --coverage`
- Determinism checks: retrieval ordering snapshot tests and embedding stability fixtures
- Policy checks: local-only mode test ensures zero external provider invocation

Validation coverage must map to CAPT-01, CAPT-03, RETR-01, RETR-02, SECU-03 before phase marked complete.

<code_examples>
## Code Examples

### Recency Band Scoring
```typescript
function recencyBandScore(ageDays: number): number {
  if (ageDays <= 1) return 1.0;      // today
  if (ageDays <= 7) return 0.75;     // week
  if (ageDays <= 30) return 0.5;     // month
  return 0.25;                       // older
}
```

### Domain Error Mapping
```typescript
type DomainErrorCode = "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "INTERNAL";

class DomainError extends Error {
  constructor(public code: DomainErrorCode, message: string) {
    super(message);
  }
}
```

### Local-Only Policy Guard
```typescript
function assertLocalOnly(config: Config): void {
  if (config.localOnly && config.externalProvider?.enabled) {
    throw new DomainError("VALIDATION", "External provider blocked in localOnly mode");
  }
}
```
</code_examples>

<open_questions>
## Open Questions

1. Exact file/module layout under `src/` is not yet fixed.
   - What we know: phase goal requires host-agnostic core boundary.
   - Recommendation: planner should lock structure in first schema/core plan.

2. Recency band boundaries need final numeric definition.
   - What we know: user selected bucket model today/week/month/older.
   - Recommendation: planner should define exact day cutoffs and test them.
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- `.planning/phases/01-core-memory-engine-foundation/01-CONTEXT.md` - locked implementation decisions.
- `.planning/ROADMAP.md` - phase scope and success criteria.
- `.planning/REQUIREMENTS.md` - CAPT-01, CAPT-03, RETR-01, RETR-02, SECU-03 definitions.
- `.planning/research/STACK.md` - baseline package/runtime direction.
- `.planning/research/ARCHITECTURE.md` - ports-and-adapters baseline.
- `.planning/research/PITFALLS.md` - failure modes and guardrails.

### Secondary (MEDIUM confidence)
- https://modelcontextprotocol.io/specification/draft/basic/transports - local transport/security framing.
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: local SQLite + vector retrieval
- Deterministic behavior: embedding and ranking
- Contract stability: adapter-facing API and errors
- Policy controls: local-only enforcement

**Confidence breakdown:**
- Standard stack: HIGH
- Architecture: HIGH
- Pitfalls: HIGH
- Code examples: MEDIUM-HIGH

**Research date:** 2026-05-25
**Valid until:** 2026-06-24
</metadata>

---

*Phase: 01-core-memory-engine-foundation*
*Research completed: 2026-05-25*
*Ready for planning: yes*

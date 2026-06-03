# Phase 3: Injection Quality + Token Control - Research

**Researched:** 2026-06-03  
**Domain:** Retrieval injection formatting, exact token budgeting, deterministic quality harness, and bounded importance feedback  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
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

### Deferred Ideas (OUT OF SCOPE)
- Platform-specific adapter presentation and host UX for startup injection belong to Phase 4.
- CLI-specific controls for search/list/show/forget/stats belong to Phase 5.
- Broader privacy retention/redaction hardening belongs to Phase 6.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| RETR-03 | User startup memory injection is capped by configurable token budget. | Use `js-tiktoken` exact BPE token counting, deterministic injection formatter, hard cap tests, and default `450` token cap. |
| RETR-04 | User can request additional memories on demand beyond auto-injection. | Extend existing `retrieveMemories` contract with `mode`/`depth`, keep auto results small, and expose score metadata on returned memory DTOs. |
| RETR-05 | User memory importance is boosted after successful retrieval (bounded). | Add explicit `recordMemoryUsed` feedback method, transactional importance update capped at `9` for auto use, feedback history table, and decay support. |
</phase_requirements>

## Summary

Phase 3 should be planned as a focused extension of the existing retrieval and service facade, not a new retrieval subsystem. The repo already has deterministic ranking (`score desc -> updated_at desc -> id asc`), score breakdowns, zod service validation, `DomainError` envelopes, SQLite migrations, and Vitest coverage. Reuse those surfaces and add three bounded capabilities: injection formatting with exact token enforcement, richer retrieval modes/responses, and explicit feedback mutation.

The highest-risk area is accidentally coupling retrieval with mutation. On-demand fetch and startup injection must never change importance by themselves. Importance changes should happen only through an explicit adapter/core signal after the host confirms a memory was actually used. This preserves deterministic retrieval tests and prevents background startup calls from inflating scores.

**Primary recommendation:** Add a `core/injection` formatter/token-budget module, extend `retrieveMemories` with `mode` and `depth` plus score metadata, and add a separate `recordMemoryUsed` service method backed by a feedback-history migration.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| js-tiktoken | 1.0.21 | Exact BPE token counting for injection text | Pure JS port of tiktoken; avoids WASM/native friction and supports deterministic local token accounting. |
| better-sqlite3 | 12.10.0 installed / 12.10.0 latest | Local memory and feedback persistence | Already integrated; official API supports prepared statements and sync transactions suited to local lifecycle updates. |
| zod | 4.4.3 | Runtime request/response validation | Existing adapter-facing contract standard; Zod 4 defaults and object extension fit additive contract changes. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.7 installed / 4.1.8 latest | Unit, integration, snapshot, and quality harness verification | Keep existing test framework; use inline/file snapshots for exact injection output stability. |
| typescript | 5.9.3 installed / 6.0.3 latest | Static types for contract and formatter changes | Keep current installed version unless a separate upgrade task is created. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `js-tiktoken` | `tiktoken` / `@dqbd/tiktoken` WASM bindings | WASM can be faster but adds runtime/bundling complexity for cross-platform adapters; pure JS is safer for v1 local-first portability. |
| Local token library | Anthropic `count_tokens` API | Exact for Claude API messages, but requires cloud/API access and conflicts with local-first startup injection as the default path. |
| Vitest snapshots | Custom golden-file diff runner | Vitest already supports snapshots and is installed; a custom runner would add maintenance without improving determinism. |

**Installation:**
```bash
npm install js-tiktoken
```

**Version verification (npm registry, checked 2026-06-03):**
- `js-tiktoken` `1.0.21`, published `2025-08-09T01:00:31.350Z`
- `better-sqlite3` `12.10.0`, published `2026-05-12T09:58:59.557Z`
- `zod` `4.4.3`, published `2026-05-04T07:06:40.819Z`
- `vitest` latest `4.1.8`, published `2026-06-01T08:14:50.474Z`; repo currently runs `4.1.7`
- `typescript` latest `6.0.3`, modified `2026-04-16T23:38:28.092Z`; repo currently uses `5.9.3`

## Architecture Patterns

### Recommended Project Structure
```text
src/
|- core/
|  |- api/
|  |  |- contracts.ts             # extend retrieve response, add feedback request/response
|  |  `- memoryCoreService.ts     # validate requests, call retrieval/injection/feedback services
|  |- injection/
|  |  |- tokenBudget.ts           # js-tiktoken wrapper, count/truncate helpers
|  |  `- formatStartupInjection.ts # deterministic grouped injection formatter
|  |- retrieve/
|  |  |- retrieveMemories.ts      # mode/depth defaults, score metadata, stable ranking
|  |  `- score.ts                 # existing score breakdown, unchanged weights
|  |- storage/
|  |  |- memoryRepo.ts            # add transactional importance helpers
|  |  `- memoryFeedbackRepo.ts    # new feedback history write/query helpers
|  `- schema/migrations/
|     `- 004_memory_feedback.sql  # feedback event audit table
tests/
|- unit/injection/
|- integration/retrieve/
`- quality/injection/
```

### Pattern 1: Deterministic Injection Formatting
**What:** Format ranked retrieval results into compact grouped bullets with fixed headers, fixed numeric precision, stable section ordering, and exact token checks after every trimming step.  
**When to use:** Startup auto-injection and quality harness fixtures.  
**Example:**
```typescript
// Source: local Phase 3 recommended pattern, backed by js-tiktoken docs
const result = formatStartupInjection(ranked, {
  tokenCap: 450,
  tokenizer: "o200k_base",
  header: "Relevant prior context",
});

expect(countTokens(result.text)).toBeLessThanOrEqual(450);
```

**Planning detail:** Select candidate memories by ranking first, then render grouped by memory kind. Within each group preserve ranking order. Use a fixed group order such as `warning`, `decision`, `fact`, `summary`, `preference`, then unknown kinds sorted lexicographically.

### Pattern 2: Token-Aware Trim Loop
**What:** Render full entries, count exact tokens, trim content from lowest-priority included memory first, then remove lowest-priority entries only if still over cap.  
**When to use:** Any injection text generation under a cap.  
**Example:**
```typescript
// Source: local Phase 3 recommended pattern
while (countTokens(rendered) > tokenCap && canTrimLowestPriority(included)) {
  included = trimLowestPriorityContent(included, { minContentTokens: 16 });
  rendered = renderGroupedInjection(included);
}
```

**Planning detail:** The hard cap must be verified on the final rendered string, not on per-memory content. Critical warnings should reserve budget first and force lower-ranked entries out; default behavior should still produce `tokenCount <= tokenCap`.

### Pattern 3: Additive Retrieval Contract
**What:** Extend `retrieveMemories` with `mode` and `depth` while preserving existing `{ projectId, query, limit }` callers. Response memories should become a structural superset of existing DTOs by adding `semantic` and `score`.  
**When to use:** RETR-04 on-demand fetch and startup auto-injection.  
**Example:**
```typescript
// Source: local contract pattern from src/core/api/contracts.ts
export const retrieveMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  mode: z.enum(["auto", "on-demand"]).default("auto"),
  depth: z.enum(["default", "deep"]).default("default"),
  tokenCap: z.number().int().min(1).max(2000).default(450),
});
```

### Pattern 4: Explicit Feedback Mutation
**What:** Keep retrieval pure; add an explicit service method like `recordMemoryUsed` that updates importance and inserts feedback history in one SQLite transaction.  
**When to use:** After Phase 4+ adapters confirm a specific injected/retrieved memory materially helped the response.  
**Example:**
```typescript
// Source: local Phase 3 recommended pattern using better-sqlite3 transaction semantics
const recordUse = db.transaction((input: RecordMemoryUsedInput) => {
  const current = getMemoryForUpdate(input.projectId, input.memoryId);
  const nextImportance = Math.min(current.importance + 1, 9);
  updateMemoryImportance(input.projectId, input.memoryId, nextImportance, input.usedAt);
  insertMemoryFeedbackEvent({ ...input, previousImportance: current.importance, newImportance: nextImportance });
});
```

### Anti-Patterns to Avoid
- **Mutating during `retrieveMemories`:** Retrieval, startup injection, and on-demand fetch must not boost importance implicitly.
- **Word/character token estimates:** Phase 3 explicitly requires an exact tokenizer dependency for startup injection.
- **Many ultra-compressed entries:** Locked decision prefers fewer fuller memories; avoid squeezing every candidate into tiny fragments.
- **Floating timestamps in snapshots:** Injection output must use candidate dates from rows, not `Date.now()` or current process time.
- **Manual SQL update without audit row:** Importance changes need feedback history for auditability and decay support.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token counting | Whitespace or character heuristics | `js-tiktoken` with a fixed encoding, default `o200k_base` | Exact and deterministic for the selected BPE encoding; avoids repeated budget regressions. |
| Snapshot/golden output verification | Custom file diff runner | Vitest `toMatchInlineSnapshot` / `toMatchFileSnapshot` | Official Vitest snapshot support is already in the test stack. |
| SQLite atomic updates | Multi-statement writes without transaction | `better-sqlite3` `db.transaction()` | Ensures importance update and feedback event are committed or rolled back together. |
| Retrieval reranking | A second ad-hoc sort in formatter | Existing `retrieveMemories` score and deterministic tie-break | Prevents injection output from disagreeing with retrieval ranking. |
| Importance bounds | Caller-side max checks only | Repository/service guard plus SQL `CHECK` | Defense in depth; existing schema already enforces `1..10`. |

**Key insight:** The formatter can be custom because output shape is product-specific. Tokenization, snapshots, DB transactions, validation, and score computation should not be custom reinventions.

## Common Pitfalls

### Pitfall 1: Token Cap Checked Before Final Formatting
**What goes wrong:** Bullets fit individually, but headers, score metadata, dates, separators, or grouped labels push final output over 450 tokens.  
**Why it happens:** Budget is calculated before full render.  
**How to avoid:** Count the final string after every render/trim operation with `js-tiktoken`; tests must assert final output token count.  
**Warning signs:** Unit tests pass for `truncateContent()`, but quality snapshots exceed cap.

### Pitfall 2: Retrieval Mutates Importance
**What goes wrong:** Startup or on-demand fetch inflates frequently retrieved memories even when the user never used them.  
**Why it happens:** RETR-05 is interpreted as "after retrieval" rather than "after confirmed successful use."  
**How to avoid:** Implement `recordMemoryUsed` separately and document that `retrieveMemories` is read-only.  
**Warning signs:** A test that calls `retrieveMemories` twice observes changed `importance` or `updated_at`.

### Pitfall 3: Non-Deterministic Group Ordering
**What goes wrong:** Identical ranking inputs produce different injection text across runs or Node versions.  
**Why it happens:** Group ordering follows insertion/object key behavior or unsorted unknown kinds.  
**How to avoid:** Use explicit group order and lexicographic unknown-kind fallback; format scores with fixed precision.  
**Warning signs:** Snapshot changes without fixture changes.

### Pitfall 4: Score Metadata Lost at Service Boundary
**What goes wrong:** Core retrieval computes score details, but adapter-facing response returns plain memory DTOs only.  
**Why it happens:** `memoryCoreService` maps `ranked.map(toMemoryDto)` and drops `semantic`/`score`.  
**How to avoid:** Add a `toRetrievedMemoryDto` mapper and response schema with score breakdown.  
**Warning signs:** On-demand tests cannot assert why a memory ranked highly.

### Pitfall 5: Auto Boost Can Reach Manual Maximum
**What goes wrong:** Automatic memory-use feedback pushes importance to `10`, leaving no distinction from manual priority.  
**Why it happens:** Update uses existing `importance <= 10` DB bound as the only cap.  
**How to avoid:** Auto use path caps at `9`; manual boost path, if added later, may reach `10`.  
**Warning signs:** `recordMemoryUsed` on importance `9` returns `10`.

## Code Examples

Verified patterns from official and repository sources:

### Exact Token Counting
```typescript
// Source: https://www.npmjs.com/package/js-tiktoken
import { getEncoding } from "js-tiktoken";

const enc = getEncoding("o200k_base");
const tokenCount = enc.encode("Relevant prior context").length;
```

### Stable Snapshot for Injection Text
```typescript
// Source: https://main.vitest.dev/guide/learn/snapshots
it("formats deterministic startup injection", () => {
  const output = formatStartupInjection(fixtures.rankedMemories, { tokenCap: 450 });

  expect(output.text).toMatchInlineSnapshot();
  expect(output.tokenCount).toBeLessThanOrEqual(450);
});
```

### Transactional Feedback Update
```typescript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const applyFeedback = db.transaction((input: RecordMemoryUsedInput) => {
  const memory = getMemoryById(db, input.projectId, input.memoryId);
  if (!memory) throw new DomainError("NOT_FOUND", `Memory not found: ${input.memoryId}`);

  const nextImportance = Math.min(memory.importance + 1, 9);
  updateMemoryImportance(db, input.projectId, input.memoryId, nextImportance, input.usedAt);
  insertMemoryFeedbackEvent(db, {
    memoryId: input.memoryId,
    feedbackType: "auto_use",
    previousImportance: memory.importance,
    newImportance: nextImportance,
  });
});
```

### Score Metadata DTO
```typescript
// Source: local existing src/core/retrieve/score.ts and src/core/api/memoryCoreService.ts
function toRetrievedMemoryDto(record: RetrievedMemoryCandidate) {
  return {
    ...toMemoryDto(record),
    semantic: record.semantic,
    score: record.score,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Character/word token estimates | Exact tokenizer dependency for the selected encoding | Locked for Phase 3, 2026-06-03 | Startup injection can enforce a real hard cap instead of approximate compliance. |
| Retrieval response with plain DTO only | DTO plus semantic and score breakdown metadata | Phase 3 requirement | On-demand fetch can explain relevance and support adapter UX later. |
| Retrieval side-effects | Explicit feedback signal after confirmed use | Phase 3 locked decision | Prevents runaway importance inflation from passive retrieval. |
| Minimal unit-only quality checks | Benchmark-style fixture harness with snapshots and relevance expectations | Phase 3 locked decision | Quality can regress visibly before launch benchmark phase. |

**Deprecated/outdated:**
- `src/core/summarize/localSummarizer.ts` whitespace token counter is acceptable Phase 2 legacy behavior but should not be reused for startup injection.
- Returning only `memorySchema` from retrieval is insufficient for RETR-04 on-demand score visibility.
- Treating `importance <= 10` as the auto-boost cap is too loose; auto boosts must cap below `10`.

## Open Questions

1. **Critical warning overflow semantics**
   - What we know: Locked decisions say hard cap, except critical warnings may be preserved.
   - What's unclear: Whether preservation may exceed `450` tokens.
   - Recommendation: Planner should preserve critical warnings by reserving budget and dropping lower-priority entries, not by exceeding cap. Add an explicit metadata flag if any warning content had to be minimized.

2. **Decay cadence**
   - What we know: Old auto boosts should decay and feedback history must support auditability.
   - What's unclear: Exact age threshold and scheduler surface are not defined.
   - Recommendation: Implement a deterministic helper with injectable `now` and a conservative default threshold, but do not run decay inside retrieval. Wire broader scheduling later if needed.

3. **Tokenizer model alignment across hosts**
   - What we know: `js-tiktoken` is exact for supported OpenAI/tiktoken encodings; Claude exact counting requires Anthropic API.
   - What's unclear: Phase 4 adapter-specific tokenizer mapping.
   - Recommendation: Use configurable local tokenizer with default `o200k_base` now. Do not call cloud token-count APIs in baseline startup injection.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 installed (`npm test` reports v4.1.7); npm latest checked as 4.1.8 |
| Config file | none |
| Quick run command | `npx vitest run tests/unit/injection tests/unit/retrieve tests/integration/retrieve --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-03 | Startup injection formatter returns deterministic grouped text under default `450` token cap | unit + snapshot | `npx vitest run tests/unit/injection/format-startup-injection.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-03 | Tight cap trims lower-priority content first and preserves higher-priority fuller memories | unit | `npx vitest run tests/unit/injection/token-budget.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-04 | `retrieveMemories` supports `mode: "on-demand"` / `depth: "deep"` and returns more memories than auto mode | integration | `npx vitest run tests/integration/retrieve/retrieve-on-demand.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-04 | Retrieval response includes semantic and score breakdown metadata without mutating importance | integration | `npx vitest run tests/integration/retrieve/retrieve-score-metadata.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-05 | Explicit `recordMemoryUsed` boosts importance by `+1`, caps auto path at `9`, updates `updated_at`, and writes feedback history | integration | `npx vitest run tests/integration/core/memory-feedback.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-05 | Decay helper lowers old auto boosts deterministically without running during retrieval | unit + integration | `npx vitest run tests/unit/retrieve/importance-decay.spec.ts tests/integration/core/memory-feedback.spec.ts --reporter=dot` | NO - Wave 0 |
| RETR-03/04 | Quality harness verifies expected top memories, budget compliance, and exact stable output for realistic + synthetic fixtures | quality | `npx vitest run tests/quality/injection/injection-quality-harness.spec.ts --reporter=dot` | NO - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <changed-test-file> --reporter=dot`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green plus quality harness green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/injection/format-startup-injection.spec.ts` - RETR-03 deterministic grouped output and inline snapshots
- [ ] `tests/unit/injection/token-budget.spec.ts` - RETR-03 exact token cap and lower-priority trimming
- [ ] `tests/integration/retrieve/retrieve-on-demand.spec.ts` - RETR-04 mode/depth behavior
- [ ] `tests/integration/retrieve/retrieve-score-metadata.spec.ts` - RETR-04 score metadata and no mutation
- [ ] `tests/integration/core/memory-feedback.spec.ts` - RETR-05 bounded boost and history persistence
- [ ] `tests/unit/retrieve/importance-decay.spec.ts` - RETR-05 deterministic old-auto-boost decay helper
- [ ] `tests/quality/injection/injection-quality-harness.spec.ts` - quality report for realistic/synthetic fixtures
- [ ] `src/core/schema/migrations/004_memory_feedback.sql` - feedback event audit table

Current baseline check: `npm test` passed on 2026-06-03 with 11 files and 29 tests.

## Sources

### Primary (HIGH confidence)
- `.planning/phases/03-injection-quality-token-control/03-CONTEXT.md` - locked Phase 3 implementation decisions.
- `.planning/REQUIREMENTS.md` - RETR-03, RETR-04, RETR-05 definitions.
- `.planning/ROADMAP.md` - Phase 3 goal and success criteria.
- `.planning/STATE.md` - prior project decisions and current phase status.
- Existing implementation:
  - `src/core/api/contracts.ts`
  - `src/core/api/memoryCoreService.ts`
  - `src/core/retrieve/retrieveMemories.ts`
  - `src/core/retrieve/score.ts`
  - `src/core/storage/memoryRepo.ts`
  - `src/core/storage/memorySearchRepo.ts`
  - `src/core/schema/migrations/001_initial.sql`
  - `src/core/schema/migrations/002_indexes.sql`
  - `tests/integration/retrieve/retrieve-ranked.spec.ts`
  - `tests/unit/retrieve/scoring-weights.spec.ts`
- Official/package docs:
  - https://www.npmjs.com/package/js-tiktoken
  - https://github.com/openai/tiktoken/blob/main/README.md
  - https://main.vitest.dev/guide/learn/snapshots
  - https://zod.dev/api
  - https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md

### Secondary (MEDIUM confidence)
- npm registry version checks via `npm view` for `js-tiktoken`, `better-sqlite3`, `zod`, `vitest`, and `typescript`.
- Anthropic token counting docs/search results: exact Claude counting exists through API, but local-first startup injection should not depend on it in this phase.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package versions verified through npm registry and official docs; only new dependency is `js-tiktoken`.
- Architecture: HIGH - directly grounded in existing repo surfaces and locked phase decisions.
- Pitfalls: HIGH - derived from current code behavior, phase decisions, and official docs for tokenizer/snapshots/transactions.

**Research date:** 2026-06-03  
**Valid until:** 2026-07-03

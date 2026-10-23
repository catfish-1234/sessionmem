# Compact retrieval and optional ranking

## Search, inspect nearby context, then fetch details

The MCP server exposes these tools alongside the existing tools. Project scope
comes from the server, so callers do not supply `projectId` over MCP.

| Tool | Input | Output |
| --- | --- | --- |
| `searchMemoryIndex` | `query`, optional `limit`, `includeHistory`, `tags` | IDs, one-line summaries, kind, capture date, numeric score, `hasMore` |
| `memoryTimeline` | `memoryId`, or both `fromDate` and `toDate`; optional `limit`, `includeHistory` | Compact rows in capture order; scores are null |
| `getMemory` | `memoryId` | One complete stored memory, including content and metadata |

Start with `searchMemoryIndex({"query":"database migration","limit":5})`.
Inspect the surrounding records with
`memoryTimeline({"memoryId":"selected-id","limit":5})` when chronology matters.
Fetch only the records needed with `getMemory({"memoryId":"selected-id"})`.
The existing get-by-ID tool already returns full bodies, so no duplicate tool is
needed. Existing `retrieveMemories` remains available.

Index and timeline limits default to 10 and accept integers from 1 to 50. Summaries
are extractive previews of stored text, with whitespace collapsed and at most 160
characters. They can omit qualifiers from longer memories; read the full body
before relying on a fact. No summaries or inference are generated for these tools.
Search scores are rounded to four decimal places. Search uses the same ranker as
`retrieveMemories`, without its startup formatting or access-counter updates.

Index `hasMore` describes the bounded retrieval candidate pool, not an exhaustive
store count. Timeline `hasMore` means more visible records exist outside the
returned window. Around an ID, it balances earlier and later records and fills
remaining slots from the available side. Timestamp ties use ID ordering. Ranges
are inclusive UTC ISO timestamps, for example:

```json
{"fromDate":"2026-01-01T00:00:00Z","toDate":"2026-01-31T23:59:59.999Z","limit":10}
```

Timeline dates are **capture dates**, not dates mentioned inside prose. Timeline
includes superseded records by default so it can explain changes; set
`includeHistory:false` for current records only. Index excludes fully superseded
records by default. All three tools enforce project scope and expiry. Compact
search and timeline do not update access counters. Optional local semantic search
can still backfill its derived vector index, as with ordinary retrieval.

## Optional temporal retrieval

`temporalRetrieval` defaults off. It did not improve the pinned-clock LoCoMo run.
Enable it for stores with meaningful observation times:

```bash
sessionmem config set temporalRetrieval true
```

A deterministic English cue detector recognizes current state (`current`,
`currently`, `now`, `latest`, `today`, `at present`) and historical questions
(`before`, `previously`, `formerly`, `prior`, `used to`, `no longer`, `when did`,
`when was`, `when were`, `in the past`, `historical`, `history`). Dated clauses take
precedence over current-state cues. With no recognized cue, the previous retrieval
behavior and scores stay unchanged, even when enabled.

Supported ranges are `YYYY-MM-DD`, `YYYY-MM`, `in YYYY`, `during YYYY`, `yesterday`,
`last/previous week/month/year`, and numeric day/week offsets such as `2 days ago`.
Relative dates use the injected retrieval clock in UTC; weeks start on Monday and
months are calendar months. The detector does not interpret arbitrary natural
language dates, future plans, locale-specific dates or conversational reference
times. An invalid date supplies no date signal.

Historical intent includes superseded candidates automatically unless the caller
explicitly sets `includeHistory:false`. That decision applies to both lexical and
optional semantic candidates. Explicit `true` also works for current-state queries.
Existing supersession rules still determine which facts have changed; no new
contradiction inference is added.

Within relevance, temporal scoring uses a fixed 90% existing relevance and 10%
time signal. Current-state signals average the non-superseded claim fraction and
freshness, `1 / (1 + ageDays / 30)`. Historical ranges use the distance from the
range with the same 30-day scale. `before` and similar previous-state cues favor
the superseded fraction. Undated historical questions have a neutral time signal.
The time is the latest extracted claim observation timestamp, falling back to
original capture time. Editing a row does not invent a new event date.

Past queries neutralize ordinary recency and inactivity-based importance decay,
so age alone does not suppress historical evidence. Stored importance and access
boosts still apply. Dates rerank candidates; they are not hard date filters and do
not guarantee that a relevant memory outside the candidate pool will be found.
For exact capture-date browsing, use `memoryTimeline`.

## Bounded entity boost

`entityBoost` defaults off. Enable it with:

```bash
sessionmem config set entityBoost true
```

This adds a positive boost to the current ranker's relevance score using captured
entities. Matching is case-insensitive and uses normalized literal name spans and
the same explicit aliases listed below. A chunk's matched entity weight is divided
by the total linked weight, then multiplied by 0.10 and added to relevance, capped
at 1. The outer relevance weight of 0.60 bounds the final score increase to 0.06.
Repeated names, aliases and multiple matches cannot stack beyond that bound.
Experimental additive rankers retain their existing hub-damped entity signal.
Optional temporal fusion follows this step, so its time signal and the existing
recency and importance scores still apply. A recent unmatched chunk can still win.

The boost reuses the entity candidate channel and its limit of 50 admitted IDs.
Project, expiry and history filters apply before matching and admission. Queries
with no known entity retain the prior candidates and scores. The compact index
uses the shared ranker; timeline order, full details by ID and token limits stay
unchanged. Matching and scoring use local SQLite data without network calls.

This setting is independent of the existing `entityLinkBoost` coverage/fusion
experiment. Existing defaults stay intact when `entityBoost` is absent or false.
On LoCoMo, enabling the boost raises hit rate @5 from 64.44% to 64.51%, but lowers
precision and recall, failing the existing three-metric gate. It therefore remains
opt-in. See [results and limits](../benchmarks/entity-boost.md).

## Existing entity-link coverage and fusion

Entity coverage is enabled by default when retrieval uses BM25, including when
optional inference is unavailable. It improves all three primary LoCoMo metrics
in that mode. With active MiniLM it defaults off because hit rate and recall
regressed. An explicit `entityLinkBoost` value overrides that mode-specific
choice. To enable it explicitly:

```bash
sessionmem config set entityLinkBoost true
```

The query links literal normalized name spans against the existing
`memory_entities` tables. Explicit aliases cover `postgres`/`postgresql`,
`node`/`node.js` and `k8s`/`kubernetes`. There is no fuzzy name matching, pronoun
resolution, entity embedding, or graph traversal. Extraction rules stay unchanged.
Project, expiry and requested history visibility apply before link scoring.

Each linked `(kind, name)` receives weight
`1 + log((visibleMemoryCount + 1) / (matchingMemoryCount + 1))`. A memory's entity
score is its matched weight divided by the total linked weight. Up to 50 highest
entity-score IDs are admitted to the candidate union, with ID tie breaks. This
channel can admit rows that were absent from the BM25 or semantic pool.

The fixed fusion is 80% base relevance and 20% linked-entity score. With semantic
search enabled, base relevance retains the existing 2:1 BM25/positive-cosine blend.
When no entity is linked, the prior scoring path is retained. The existing 10%
entity-overlap signal remains in use when coverage is off. Temporal
fusion, when enabled too, follows entity fusion. Outer relevance, recency and
importance weights remain 60%, 25% and 15%.

Disable coverage with `sessionmem config set entityLinkBoost false` and temporal
retrieval with `sessionmem config set temporalRetrieval false`.

## Source-informed fusion alternatives

The optional `retrievalRanking` setting accepts `legacy`, `adaptive-bm25`,
`hub-additive` and `adaptive-hub-additive`. `legacy` means the existing BM25/dense
fusion, with the mode-specific entity-coverage default above. Other modes default
to their stated experiment without coverage, unless explicitly overridden.

`adaptive-bm25` uses a query-length adaptive sigmoid on raw positive FTS5 BM25.
The additive modes use a hub-damped maximum entity boost from at most eight names,
plus lexical and optional dense signals, divided by the maximum score of active
channels. A 0.2 semantic gate applies before additive fusion. The adaptive additive
variant also enables the sigmoid. These hypotheses did not pass the three-metric
regression gate and remain opt-in. See the
[source notes](../benchmarks/retrieval-source-notes.md) for exact parameters,
algorithm differences and licensing scope. No competitor source or prompt was
adapted. The current defaults select entity coverage for BM25 and the existing
fusion for MiniLM; there are no per-query-label or per-category exceptions.

The temporal and entity settings work alongside the existing `semanticSearch`
setting. Results,
per-category losses and token measurements are in the
[retrieval evaluation](../benchmarks/retrieval-gaps.md). They do not establish
accuracy for generated answers or gains on coding workloads.

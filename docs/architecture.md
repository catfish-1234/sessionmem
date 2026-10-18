# Architecture

`sessionmem` connects a coding agent's MCP host to a local SQLite memory database. This overview covers its four subsystems and the retrieval and injection flows. It runs locally by default, with settings in `~/.sessionmem/config.json`.

## Subsystems

```
        ┌──────────────────────────────────────────────┐
        │                  MCP host                     │
        │   (Claude Code, Cursor, Codex, Cline, ...)    │
        └───────────────────────┬──────────────────────┘
                                │ MCP / hooks
                    ┌───────────▼───────────┐        ┌──────────────┐
                    │       adapters        │        │     CLI      │
                    │ (host-specific glue)  │        │ (sessionmem) │
                    └───────────┬───────────┘        └──────┬───────┘
                                │                           │
                                ▼                           ▼
                    ┌──────────────────────────────────────────────┐
                    │                 core engine                   │
                    │   capture · summarize · retrieval · injection │
                    └───────────────────────┬──────────────────────┘
                                            │
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │             SQLite storage (local)            │
                    │     memories · session events · feedback      │
                    └──────────────────────────────────────────────┘
```

### Core engine

The core engine captures session events, summarizes them into stored memories at session end, ranks those memories, and selects which to inject. It uses the adapter layer for all communication with specific tools. Retrieval combines BM25 lexical relevance, entity overlap, recency, and importance into a relevance score.

### Adapters

Adapters translate between each MCP host's hooks or runtime and the core engine's API. There are adapters for Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts. They connect host lifecycle events to the engine's capture, summarize, and inject calls. A new platform needs an adapter; the core engine stays the same.

### CLI

The CLI (`sessionmem`) registers the server with a host and runs the MCP server. It also has commands to search, list, show, forget, export, import, prune, and configure memories. These commands call the same core engine as the adapters.

### SQLite storage

SQLite stores memories, embeddings for vector search, raw session events, extracted entities and relations, and feedback history in one local file. Database access uses `better-sqlite3`, with forward-only [migrations](migration.md). No hosted database is required.

## Entity and relation extraction

Capture, batch writes, imports, team pulls, and content rewrites derive a graph locally. Session-end summarization (including scan/watch) reads the same event text as the existing summarizer before summary line/token caps. Extraction always applies the built-in redaction rules, including when indexing legacy text. It never invokes a model or an external API.

The rules recognize labeled speakers, explicit `person`, `project`, `tool`, `service`, and `file` names, common tools/services, and file paths with supported extensions. Short affirmative clauses such as `Alice works on project Atlas`, `Alice uses SQLite`, `Alice decided to use SQLite`, `Alice prefers Python`, and `Project Atlas is blocked by GitHub` yield `works_on`, `uses`, `decided`, `prefers`, and `blocked_by` edges. Decision clauses become decision entities. `Ran:` tool events yield `uses` for recognized executables; git commits also yield decisions, matching the existing local summarizer. Unlabeled first-person/imperative clauses use `user` (or `team` for `we`); labeled speakers resolve `I`. Questions, negation, hypothetical clauses, and unresolved third-person pronouns are skipped. These conservative rules are not general natural-language understanding and can miss or misclassify unfamiliar phrasing.

Names use NFKC, lowercase, stripped quotes/possessives, and collapsed whitespace. This also folds file-path case. `memory_entities` stores unique `(memory_id, kind, name)` rows; `memory_relations` references both endpoints in the same memory. Updates replace derived rows atomically, and foreign keys cascade memory deletion and summary ID changes. Migration 014 backfills existing memories, using full events for summaries when available. Expired memories are excluded from graph reads and ranking. Export/import request and response formats are unchanged; graphs are rebuilt from imported content, so event-only details absent from an exported summary do not round-trip.

`sessionmem entities --project <id>` lists entities and relations with source memory IDs; `--json` provides structured output. Omitting `--project` selects the current project.

## Contradiction and supersession

Migration 015 adds `memory_claims` and `memory_supersessions`. Claims use migration 014's canonical entity and typed-relation extractor, with a small grammar for `does not`, `no longer`, `stopped using`, `switched to/from`, and `replaced ... with`. A comparison requires the same entity and relation. Opposite polarity on the same value is a contradiction. Different positive values supersede one another when their lexical purpose overlaps (at least two words and Jaccard overlap 0.6, or an exact purpose), their tool category matches (editor, language, database, package manager, test runner), or a replacement explicitly names the old value. `now works on` also replaces a prior project. Different purposes, entities, or relation types remain independent. Questions, hypothetical statements, reported quotations, and unresolved pronouns are skipped. Rules are conservative heuristics and do not resolve arbitrary language or coreference.

Each link records the old memory in `supersedes`, the replacement in `superseded_by`, both claim keys, the reason, the replacement assertion's `superseded_at`, and the wall-clock `detected_at`. Memory bodies, IDs, and importance are preserved. A derived `superseded_memories` view marks a memory fully superseded only when every extracted claim has a replacement. Independent claims in a mixed summary keep it searchable; its content can still contain stale claims, so inspect partial supersessions in history when auditing such summaries. No old memory is deleted by supersession; explicit deletion and retention keep their existing behavior.

Writes reconcile only affected entity/relation groups within the same project, atomically with memory and graph updates. Assertions are ordered by their stored timestamp, then memory insertion rowid for equal timestamps. This gives pinned-clock captures a deterministic arrival order. The earliest later contradictory assertion supplies each link, permitting chains and later reaffirmations without cycles. Identical replay preserves links and detection timestamps; imports, content rewrites, summary ID changes, and deletion reconnect affected chains. Migration 015 backfills existing memories once, using full session events for summaries. Scan preserves valid original transcript timestamps, so filename order does not determine freshness. Without original timestamps, stored capture order is the fallback. An unrelated appended event does not change an earlier assertion's time.

Recall filters fully superseded memories before the FTS candidate limit and fallback scan, giving current facts priority. The optional `includeHistory: true` request field, exposed as `sessionmem search --include-history`, restores normal relevance ranking across current and superseded memories. Existing requests and response shapes remain compatible. `getMemory`, list and export still expose earlier memories. `sessionmem history [--project <id>] [--json]` lists links with old/new values, timestamps, reasons, source IDs, and partial/full status. Export formats remain unchanged: importing rebuilds links from exported bodies and timestamps; event-only claims absent from a summary cannot round-trip.

## Retrieval flow

When an agent or `sessionmem search` submits a query, the core engine searches the SQLite FTS5 index over stored memory content, including summaries. It removes common English question words and matches any remaining term. SQLite's built-in Porter tokenizer matches English inflections such as “hike” and “hiking”. BM25 accounts for term rarity, frequency, and memory length; at most 50 lexical candidates are returned, ordered by BM25 and then ID.

The ranker divides each positive BM25 score by the best score for that query. If the query contains known entity names in this project, relevance is `0.90 * base relevance + 0.10 * entity overlap`. Overlap is the fraction of distinct matched query names linked to the candidate memory; names are matched as literal token sequences (up to eight tokens), including lowercase questions. With no known query entities, relevance is unchanged. This reranks the existing candidates; it does not expand the FTS candidate pool or traverse relations. The outer relevance, recency, and importance weights stay 0.60, 0.25, and 0.15. Sparse lexical matches retain the recency/importance fallback union. If there are no lexical matches, base relevance uses the previous hash-vector ranking. Project scope and expiry checks apply to both paths. Automatic migrations preserve memory bodies and IDs.

Existing public request fields and all response fields are unchanged; `includeHistory` is an optional addition. The `semantic` field still reports hash cosine similarity. The legacy `score.raw.semantic` and `score.weighted.semantic` fields carry the relevance component used for ranking, including entity overlap when query entities match. Scores are relative to the current query's candidates, not calibrated probabilities. Retrieval needs no API keys, downloaded models, or new dependencies.

## Injection flow

At session start, the engine retrieves relevant memories and trims them to a token budget, a few hundred tokens by default. It keeps critical warnings and high-importance decisions first, dropping lower-priority content as needed. The adapter adds the result to the host's context. Claude Code's installed SessionStart hook does this automatically. Other hosts need an agent or lifecycle integration to call the corresponding MCP tools; MCP registration alone does not install hooks in those hosts.

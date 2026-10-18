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

The core engine captures session events, summarizes them into stored memories at session end, ranks those memories, and selects which to inject. It uses the adapter layer for all communication with specific tools. Retrieval combines BM25 lexical relevance, recency, and importance into a relevance score.

### Adapters

Adapters translate between each MCP host's hooks or runtime and the core engine's API. There are adapters for Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts. They connect host lifecycle events to the engine's capture, summarize, and inject calls. A new platform needs an adapter; the core engine stays the same.

### CLI

The CLI (`sessionmem`) registers the server with a host and runs the MCP server. It also has commands to search, list, show, forget, export, import, prune, and configure memories. These commands call the same core engine as the adapters.

### SQLite storage

SQLite stores memories, embeddings for vector search, raw session events, and feedback history in one local file. Database access uses `better-sqlite3`, with forward-only [migrations](migration.md). No hosted database is required.

## Retrieval flow

When an agent or `sessionmem search` submits a query, the core engine searches the SQLite FTS5 index over stored memory content, including summaries. It removes common English question words and matches any remaining term. SQLite's built-in Porter tokenizer matches English inflections such as “hike” and “hiking”. BM25 accounts for term rarity, frequency, and memory length; at most 50 lexical candidates are returned, ordered by BM25 and then ID.

The ranker divides each positive BM25 score by the best score for that query and combines it with the existing recency and importance signals (weights 0.60, 0.25, and 0.15). Sparse lexical matches retain the recency/importance fallback union. If there are no lexical matches, the previous hash-vector ranking applies. Project scope and expiry checks apply to both paths. An automatic migration rebuilds existing FTS indexes without changing memory bodies or IDs.

Public request and response fields are unchanged. The `semantic` field still reports hash cosine similarity. The legacy `score.raw.semantic` and `score.weighted.semantic` fields carry the relevance component used for ranking: normalized BM25 when lexical matches exist, otherwise the previous cosine value. Scores are relative to the current query's candidates, not calibrated probabilities. Retrieval needs no API keys, downloaded models, or new dependencies.

## Injection flow

At session start, the engine retrieves relevant memories and trims them to a token budget, a few hundred tokens by default. It keeps critical warnings and high-importance decisions first, dropping lower-priority content as needed. The adapter adds the result to the host's context. Claude Code's installed SessionStart hook does this automatically. Other hosts need an agent or lifecycle integration to call the corresponding MCP tools; MCP registration alone does not install hooks in those hosts.

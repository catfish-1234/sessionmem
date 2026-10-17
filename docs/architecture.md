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

The core engine captures session events, summarizes them into stored memories at session end, ranks those memories, and selects which to inject. It uses the adapter layer for all communication with specific tools. Retrieval combines semantic similarity, recency, and importance into a relevance score.

### Adapters

Adapters translate between each MCP host's hooks or runtime and the core engine's API. There are adapters for Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts. They connect host lifecycle events to the engine's capture, summarize, and inject calls. A new platform needs an adapter; the core engine stays the same.

### CLI

The CLI (`sessionmem`) registers the server with a host and runs the MCP server. It also has commands to search, list, show, forget, export, import, prune, and configure memories. These commands call the same core engine as the adapters.

### SQLite storage

SQLite stores memories, embeddings for vector search, raw session events, and feedback history in one local file. Database access uses `better-sqlite3`, with forward-only [migrations](migration.md). No hosted database is required.

## Retrieval flow

When an agent or `sessionmem search` submits a query, the core engine embeds it and runs a vector search over the `memories` table. It ranks candidates by semantic similarity, recency, and importance, then returns the memories with their scores.

## Injection flow

At session start, the engine retrieves relevant memories and trims them to a token budget, a few hundred tokens by default. It keeps critical warnings and high-importance decisions first, dropping lower-priority content as needed. The adapter adds the result to the host's context. Claude Code's installed SessionStart hook does this automatically. Other hosts need an agent or lifecycle integration to call the corresponding MCP tools; MCP registration alone does not install hooks in those hosts.

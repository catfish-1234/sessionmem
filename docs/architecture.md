# Architecture

`sessionmem` is a local-first memory layer that sits between a coding agent's MCP host and a local SQLite database. This document is a high-level conceptual map of the four subsystems and the two flows that connect them — it is intentionally not a module-by-module reference. Everything runs on your machine and is governed by `~/.sessionmem/config.json`.

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

The **core engine** is the heart of the system. It owns the memory lifecycle: capturing session events, summarizing them into durable memory records at session end, ranking stored memories, and selecting which to inject. It is host-agnostic — it never talks to a specific tool directly; everything tool-specific is pushed out to the adapter layer. Retrieval scoring blends semantic similarity, recency, and importance into a single relevance score.

### Adapters

The **adapter** layer translates between each MCP host's hooks/runtime and the core engine's host-agnostic API. Each supported platform (Claude Code, Cursor, Codex, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts) has its own adapter that maps host lifecycle events onto the engine's capture/summarize/inject calls. Adding a new platform means adding an adapter, not changing the engine.

### CLI

The **CLI** (`sessionmem`) is the operator-facing surface. It installs the server into a host, runs the MCP server, and exposes commands to search, list, show, forget, export/import, prune, and configure memories. The CLI and the adapters are two front doors into the same core engine.

### SQLite storage

The **SQLite** storage subsystem persists everything locally: the `memories` table (with embeddings for vector search), raw session events, and feedback history. It uses `better-sqlite3` and a forward-only migration system (see [migration](migration.md)). There is no hosted database — the store is a single local file.

## Retrieval flow

Retrieval answers the question "which stored memories are relevant right now?" When the agent (or `sessionmem search`) issues a query, the core engine embeds the query, runs a vector search over the `memories` table, and ranks candidates by the blended relevance score (semantic similarity, recency, and importance). The retrieval step returns a ranked, scored set of candidate memories.

## Injection flow

Injection is the retrieval flow applied automatically at session start. The engine retrieves the most relevant memories, then trims them to fit a small token budget (a few hundred tokens by default) — preserving critical warnings and high-importance decisions first, dropping lower-priority content as needed — and hands the compact result to the adapter for injection into the host's context. This is what lets the agent "remember" without the user re-explaining anything.

# Architecture Research

**Domain:** Cross-platform MCP memory service for coding agents
**Researched:** 2026-05-24
**Confidence:** MEDIUM-HIGH

## Standard Architecture

### System Overview

```
+-------------------------------------------------------------+
¦                    Host Adapter Layer                      ¦
+-------------------------------------------------------------¦
¦ Claude ¦ Codex ¦ Cursor ¦ Cline ¦ Windsurf ¦ Antigravity   ¦
¦ QCoder ¦ Generic MCP Host Adapter                          ¦
+-------------------------------------------------------------+
               ¦
+--------------?----------------------------------------------+
¦                     Core Memory Service                      ¦
+--------------------------------------------------------------¦
¦ Retrieval Engine ¦ Summarizer ¦ Embedding Engine ¦ Formatter ¦
¦ Importance/Recency Scorer ¦ Policy Guard (token/privacy)    ¦
+-------------------------------------------------------------+
               ¦
+--------------?----------------------------------------------+
¦                   Storage + Index Layer                      ¦
+--------------------------------------------------------------¦
¦ SQLite (events/memories/config) ¦ sqlite-vec index          ¦
¦ Optional shared-path sync files ¦ export/import snapshots    ¦
+--------------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Host Adapters | Translate host lifecycle into core operations | Small per-host modules + adapter capability map. |
| Retrieval Engine | Rank and select relevant memories | Weighted score (semantic/recency/importance) + filters. |
| Summarizer | Turn session events into durable memory text | Cloud summarizer (optional) with local fallback strategy. |
| Embedding Engine | Convert text to vectors locally | `@xenova/transformers` pipeline + model cache. |
| Storage Layer | Persist memories/events/indexes | SQLite + `sqlite-vec`; retention + migration support. |
| Injection Formatter | Produce compact context block | Deterministic token-budgeted formatting and truncation. |

## Recommended Project Structure

```
src/
+-- core/                 # host-agnostic memory logic
¦   +-- retrieve/         # ranking, filters, scoring
¦   +-- summarize/        # summarization strategies
¦   +-- embed/            # local embedding pipeline
¦   +-- format/           # injection formatting
+-- adapters/             # host-specific adapters
¦   +-- claude-code/
¦   +-- codex/
¦   +-- cursor/
¦   +-- cline/
¦   +-- windsurf/
¦   +-- antigravity/
¦   +-- qcoder/
¦   +-- generic-mcp/
+-- mcp/                  # MCP server tool definitions
+-- cli/                  # install/search/list/forget/etc.
+-- storage/              # sqlite schema, migrations, repositories
+-- sync/                 # team mode file sync
+-- security/             # redaction, policy guards, audit helpers
```

### Structure Rationale

- **`core/`:** protects behavioral consistency across all hosts.
- **`adapters/`:** isolates host drift and keeps blast radius small.
- **`storage/` + `sync/`:** clear boundary between local durability and optional team sharing.

## Architectural Patterns

### Pattern 1: Ports and Adapters

**What:** Core memory behavior behind stable interfaces; hosts implement adapter ports.  
**When to use:** Always for cross-platform parity.  
**Trade-offs:** More upfront abstraction; far lower long-term maintenance risk.

### Pattern 2: Dual Summarization Strategy

**What:** Cloud summarization path + local summarization fallback.  
**When to use:** Required because privacy/cost/availability preferences vary.  
**Trade-offs:** More code paths and test permutations.

### Pattern 3: Deterministic Budgeted Injection

**What:** Ranking + strict token budget + stable truncation ordering.  
**When to use:** Any auto-injection flow.  
**Trade-offs:** Might drop useful long-tail context; can be recovered via on-demand search.

## Data Flow

### Request Flow

```
Session start signal
    ?
Host Adapter ? Retrieve(query/context) ? Rank+Filter ? Format block
    ?
Inject memory block into host context
```

### State Management

```
Event log append
    ?
Session end trigger
    ?
Summarize ? Embed ? Persist memory row + vector + tags
```

### Key Data Flows

1. **Startup Injection Flow:** adapter -> retrieve -> formatter -> host injection.
2. **Session Capture Flow:** events -> summary -> embedding -> sqlite persistence.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-1k memories/project | Single local DB, synchronous writes acceptable. |
| 1k-100k memories/project | Add background compaction, batched embedding, indexed metadata filters. |
| 100k+ memories/project | Consider segmented stores, sharded project partitions, optional remote index. |

### Scaling Priorities

1. **First bottleneck:** embedding throughput and summarization latency.
2. **Second bottleneck:** retrieval latency if index health/compaction ignored.

## Anti-Patterns

### Anti-Pattern 1: Host-Coupled Core

**What people do:** put retrieval/store logic directly in each host integration.  
**Why it's wrong:** impossible parity, duplicate bugs, slow upgrades.  
**Do this instead:** shared core + thin adapters.

### Anti-Pattern 2: No Policy Guardrail

**What people do:** inject whatever top-k returns without budget/privacy checks.  
**Why it's wrong:** token blowups, accidental secret leakage.  
**Do this instead:** policy gate before injection (token cap + redaction).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Claude API (optional) | Summarization API call | Must be explicitly configurable and disable-able. |
| MCP hosts | Standard MCP tools/transports | Transport capability differs by host; adapter must detect/support fallback. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Adapter ? Core | typed interface calls | No direct DB access from adapters. |
| Core ? Storage | repository interfaces | Keeps testing and migrations simpler. |

## Sources

- MCP transport spec: https://modelcontextprotocol.io/specification/draft/basic/transports
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- Cline MCP docs: https://docs.cline.bot/mcp/mcp-overview
- Windsurf MCP docs: https://docs.windsurf.com/windsurf/cascade/mcp
- OpenAI Docs MCP (Codex/Cursor integration examples): https://developers.openai.com/learn/docs-mcp

---
*Architecture research for: cross-platform MCP memory system*
*Researched: 2026-05-24*

# sessionmem

## What This Is

sessionmem is local-first MCP memory layer for coding agents across Claude Code, Codex, Cursor, Cline, Windsurf, Antigravity, QCoder, and other MCP-compatible platforms. It captures session context, summarizes key outcomes, stores semantic memory embeddings locally, and retrieves only relevant context for current task. Goal is persistent cross-session memory with low token overhead and no hosted memory dependency.

## Core Value

Agent should remember right past decisions at right time, across sessions and platforms, without user re-explaining context.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Provide cross-platform MCP-compatible memory server with adapter layer for Claude Code, Codex, Cursor, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts.
- [ ] Capture session events and auto-summarize sessions into durable memory records.
- [ ] Store and retrieve semantic memory locally (SQLite + vector search) with relevance ranking (semantic + recency + importance).
- [ ] Auto-inject compact relevant memories at session start with token cap defaults.
- [ ] Ship robust CLI (`install`, `uninstall`, `search`, `list`, `show`, `forget`, `stats`, `export`, `import`).
- [ ] Ship launch-ready quality bar: CI green, unit/integration coverage, docs/privacy/security docs, benchmark report, and plugin hub submissions.

### Out of Scope

- Hosted cloud memory sync service — v1 is local-first and optional shared-path team sync only.
- Replacing CLAUDE.md entirely — sessionmem complements existing project context files.
- Model training/fine-tuning on user memories — not required for retrieval-based memory.
- Non-text memory modalities (image/audio/video) — defer beyond v1.

## Context

PRD identifies blank-slate session problem: repeated context explanation, static CLAUDE.md bloat, architecture drift, and lost team knowledge. Product direction is one-command install, local persistence, automatic summarization, and semantic query-time retrieval. Memory layer should remain provider-agnostic via MCP while handling tool-specific hook/runtime differences through adapters. Team mode should support shared filesystem workflows without central server dependency.

## Constraints

- **Platform Coverage**: Must support multiple coding platforms from v1 — core requirement from project owner.
- **Local-First**: Storage/retrieval memory layer must run locally — no hosted DB/service dependency.
- **Token Budget**: Default injection target under 400-500 tokens per session start.
- **Security/Privacy**: Must document summarization data flow, secret handling risk, and local-only fallback.
- **Launch Readiness**: v1 scope includes publish/install reliability, tests+CI, docs, benchmark, and submissions.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build for cross-platform parity in v1 instead of single-tool-first | User requires support across major coding platforms, not phased expansion | — Pending |
| Keep one master PRD with tool adaptation matrix | Preserve single source of truth while encoding per-tool differences | — Pending |
| Scope initial project through launch-ready v1.0 | User explicitly wants full launch bar (`a,b,c,d,e`) in initial scope | — Pending |
| Use local-first memory storage with optional team sync path | Align with privacy goal and avoid hosted infra in v1 | — Pending |

---
*Last updated: 2026-05-24 after initialization*

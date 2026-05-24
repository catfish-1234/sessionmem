# Stack Research

**Domain:** Cross-platform MCP memory infrastructure for coding agents
**Researched:** 2026-05-24
**Confidence:** MEDIUM-HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS | Runtime for CLI, hooks, MCP server | Stable cross-platform runtime for agent tooling and native addons. |
| TypeScript | 5.9.3 | Type-safe implementation | Strong fit for MCP SDK ecosystem and maintainable API contracts. |
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server/client protocol layer | Official SDK; aligns with current transport/lifecycle semantics. |
| SQLite (`better-sqlite3`) | 12.10.0 | Local durable storage | Fast local-first persistence with predictable operational profile. |
| `sqlite-vec` | 0.1.9 | Vector similarity in SQLite | Keeps semantic retrieval inside same local DB, no separate vector infra. |
| `@xenova/transformers` | 2.17.2 | Local embedding generation | API-keyless local embeddings for privacy-first memory layer. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | 0.98.0 | Optional cloud summarization | Use for higher-quality summary mode; allow local fallback mode. |
| `zod` | 4.4.3 | Runtime schema validation | Validate MCP tool payloads, config, and adapter contracts. |
| `commander` | 14.0.3 | CLI command framework | Build install/search/list/forget/stats/export/import UX. |
| `pino` | 9.x | Structured logs | Debug hooks/adapters/retrieval pipeline with log levels. |
| `vitest` | 4.1.7 | Unit/integration tests | Fast TS test runner for launch-ready CI bar. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsup` 8.5.1 | Bundle/build CLI + server | Produce portable build artifacts for npm global install. |
| GitHub Actions | CI pipeline | Required for launch gate (`lint`, `typecheck`, `test`, smoke install). |
| `eslint` 10.4.0 | Static quality checks | Enforce adapter/hook safety conventions. |

## Installation

```bash
# Core
npm install @modelcontextprotocol/sdk better-sqlite3 sqlite-vec @xenova/transformers zod commander

# Optional summarization cloud path
npm install @anthropic-ai/sdk

# Dev dependencies
npm install -D typescript vitest tsup eslint @types/node
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| SQLite + `sqlite-vec` | Dedicated vector DB (Qdrant/Pinecone) | Use only if remote multi-tenant memory or >10M vectors becomes hard requirement. |
| `@xenova/transformers` local embeddings | Hosted embeddings API | Use if user prefers quality/speed over local-only/privacy constraints. |
| Single TS monorepo package | Polyglot microservices | Use only if org needs strict process isolation per platform adapter. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Platform-specific memory logic mixed with core retrieval | Becomes unmaintainable across 6+ clients | Isolate host adapters behind shared interface contract. |
| Unbounded raw transcript persistence | Storage bloat + privacy risk | Summarize/compress + retention policies + explicit export/forget controls. |
| Auto-injecting large memory blocks | Token burn can exceed value | Hard token cap and relevance threshold with deterministic truncation. |

## Stack Patterns by Variant

**If host supports MCP directly (Claude Code/Codex/Cursor/Cline/Windsurf/Qoder-class tools):**
- Use pure MCP server integration + optional startup hinting.
- Because standard transport/tool contract minimizes per-host divergence.

**If host has weak/no MCP ergonomics:**
- Use hook/CLI bridge adapter that still calls same core memory engine.
- Because behavior parity comes from shared memory core, not host UX.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@modelcontextprotocol/sdk@1.29.0` | MCP draft transport model (`stdio`, Streamable HTTP) | Validate against host-specific transport support before enabling remote mode by default. |
| `better-sqlite3@12.10.0` | Node.js 22 LTS | Native addon build path; test install on macOS/Linux/Windows in CI. |
| `sqlite-vec@0.1.9` | SQLite local DB files | Add startup health check + fallback search mode when extension load fails. |

## Sources

- MCP transports spec: https://modelcontextprotocol.io/specification/draft/basic/transports
- Claude Code MCP docs: https://code.claude.com/docs/en/mcp
- OpenAI Docs MCP (Codex examples): https://developers.openai.com/learn/docs-mcp
- Cline MCP docs: https://docs.cline.bot/mcp/mcp-overview
- Windsurf MCP docs: https://docs.windsurf.com/windsurf/cascade/mcp
- NPM registry version checks on 2026-05-24 (`npm view ... version`)

---
*Stack research for: cross-platform MCP memory tooling*
*Researched: 2026-05-24*

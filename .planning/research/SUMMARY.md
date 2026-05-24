# Project Research Summary

**Project:** sessionmem
**Domain:** Local-first cross-platform MCP memory system for coding agents
**Researched:** 2026-05-24
**Confidence:** MEDIUM-HIGH

## Executive Summary

sessionmem should be built as a host-agnostic memory core with thin per-platform adapters. Research confirms MCP is mature enough for a common protocol baseline (`stdio` + Streamable HTTP), while host UX and config paths differ and must be handled by adapter/installer logic. The best risk-adjusted path is a strong core (storage, retrieval, summarization, formatting, policy guards) with a strict adapter contract matrix for Claude Code, Codex, Cursor, Cline, Windsurf, Antigravity, QCoder, and generic MCP hosts.

Launch readiness requires more than feature completeness: install reliability, retrieval precision, privacy controls, security hardening, CI quality gates, benchmark publication, and distribution submissions. Biggest practical risks are adapter drift, token over-injection, and secret leakage in summaries; all are preventable with early architectural boundaries and testable policy guardrails.

## Key Findings

### Recommended Stack

Use Node.js + TypeScript with official MCP SDK, local SQLite + `sqlite-vec`, local embeddings via `@xenova/transformers`, and optional cloud summarization path via `@anthropic-ai/sdk` with local fallback option.

**Core technologies:**
- `@modelcontextprotocol/sdk`: MCP protocol integration baseline.
- `better-sqlite3` + `sqlite-vec`: local-first durable + vector retrieval.
- `@xenova/transformers`: local embedding without external embedding API.

### Expected Features

**Must have (table stakes):**
- One-command install + setup verification.
- Session-end capture/summarize/store + startup semantic injection.
- Multi-host adapter support with parity guarantees.
- Full memory controls (`search`, `list`, `show`, `forget`, `export/import`, retention).

**Should have (competitive):**
- Cross-tool portability of memory behavior.
- Importance boosting from retrieval frequency.
- Team shared-memory mode with author provenance.

**Defer (v2+):**
- Encryption-at-rest key management UX.
- Hosted sync service.
- Non-text modalities.

### Architecture Approach

Adopt ports-and-adapters architecture: host adapters emit normalized events and requests into one core memory service; core handles ranking/summarization/embedding/formatting/policy; storage layer persists events and memories with vector index.

**Major components:**
1. Host adapter layer — platform normalization.
2. Core memory service — retrieval, summarization, scoring, formatting.
3. Storage/index layer — SQLite + vector + retention/export.

### Critical Pitfalls

1. **Adapter drift** — prevent via shared core + adapter contract tests.
2. **Token blowup** — prevent via strict budget, thresholds, dedupe.
3. **Secret leakage** — prevent via redaction and policy scanning before store/inject.
4. **Installer fragility** — prevent via host-specific preflight + rollback.
5. **Native vector dependency failures** — prevent via health checks + fallback search.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Core Engine + Adapter Contracts
**Rationale:** Cross-platform parity depends on stable core and strict interfaces first.  
**Delivers:** schema, retrieval pipeline, summarize/embed/store loop, adapter contract suite.  
**Addresses:** multi-host parity foundation + privacy/policy baseline.  
**Avoids:** adapter drift, data model lock-in.

### Phase 2: Retrieval Quality + Injection Control
**Rationale:** Core value is relevance at startup with low token overhead.  
**Delivers:** weighted ranking, budgeted formatter, importance feedback loop, quality eval harness.  
**Uses:** vector index + scoring engine.  
**Implements:** deterministic injection policy.

### Phase 3: CLI + Installer + Host Integrations Hardening
**Rationale:** Adoption depends on smooth setup and lifecycle commands.  
**Delivers:** full CLI, install/uninstall flows, host config writers/validators, fallback paths.

### Phase 4: Team Mode + Governance
**Rationale:** Shared team memory extends value after individual workflows stable.  
**Delivers:** shared-path sync, author tagging, conflict handling, admin/privacy controls.

### Phase 5: Launch Readiness + Distribution
**Rationale:** v1 definition includes quality/docs/benchmarks/submissions.  
**Delivers:** CI/test matrix, docs suite (privacy/security/migration), benchmark report, npm publish, plugin hub submissions.

### Phase Ordering Rationale

- Cross-host behavior needs core-first architecture, not UI-first adapters.
- Retrieval quality must precede broad rollout to avoid trust erosion.
- Installer hardening should follow stable internals to reduce churn.
- Team mode and launch packaging are safer after core reliability proven.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** host capability matrix details (Antigravity/QCoder docs maturity).
- **Phase 4:** shared-path sync conflict semantics and enterprise controls.
- **Phase 5:** submission requirements vary by ecosystem marketplace.

Phases with standard patterns (skip deep research-phase):
- **Phase 2:** ranking/injection techniques are well-established.
- **Phase 3:** CLI/install/test harness patterns are standard Node ecosystem work.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Strong official docs + current package version checks. |
| Features | MEDIUM-HIGH | Strong PRD alignment; some host-specific nuances pending. |
| Architecture | HIGH | Cross-platform adapter pattern is clear and defensible. |
| Pitfalls | MEDIUM | Good pattern confidence, but host-specific failure rates vary. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- Antigravity and QCoder official MCP operational details need validation during Phase 1 planning.
- Exact submission criteria/timelines for each plugin hub/marketplace should be captured in Phase 5 plan.
- Decide default local summarizer path if cloud summarization disabled.

## Sources

### Primary (HIGH confidence)
- https://modelcontextprotocol.io/specification/draft/basic/transports — transport/security requirements.
- https://code.claude.com/docs/en/mcp — Claude Code MCP integration model.
- https://developers.openai.com/learn/docs-mcp — Codex/Cursor/Claude Code MCP usage examples.
- https://docs.cline.bot/mcp/mcp-overview — Cline MCP config/transport patterns.
- https://docs.windsurf.com/windsurf/cascade/mcp — Windsurf MCP registry/deeplink model.

### Secondary (MEDIUM confidence)
- PRD source: `C:\Users\kavis\Downloads\sessionmem-PRD.md`
- Public docs snippets for QCoder/Qoder ecosystem references.

### Tertiary (LOW confidence)
- Antigravity MCP docs availability appears sparse in fetched index; treat support specifics as provisional.

---
*Research completed: 2026-05-24*
*Ready for roadmap: yes*

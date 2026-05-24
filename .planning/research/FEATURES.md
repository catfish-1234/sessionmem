# Feature Research

**Domain:** Cross-platform session memory for coding agents
**Researched:** 2026-05-24
**Confidence:** MEDIUM

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| One-command setup (`install`) | Tooling adoption fails without fast onboarding | MEDIUM | Must configure MCP and host adapters with safe defaults. |
| Session-end memory capture | Core promise is no more blank-slate sessions | MEDIUM | Must tolerate short/failed sessions gracefully. |
| Semantic memory retrieval | Static notes are not enough | HIGH | Need weighted ranking + token-capped output. |
| Memory injection on session start | Users expect "it just remembers" behavior | MEDIUM | Injection must stay under token budget and be relevance-filtered. |
| Privacy controls (`forget`, retention, export/import) | Memory product without control is unacceptable | MEDIUM | Mandatory for trust and enterprise readiness. |
| Multi-host support via MCP + adapters | Your stated core goal is all major coding platforms | HIGH | Requires host compatibility matrix + adapter contract tests. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cross-tool memory portability | Decisions follow developer across tools | HIGH | Canonical memory schema independent of host metadata. |
| Importance boosting from real usage | Frequently-needed memory rises naturally | MEDIUM | Needs feedback loop and cap logic to prevent runaway scoring. |
| Team shared memory mode | Project memory survives individual sessions/users | HIGH | Requires merge/conflict strategy and author attribution. |
| Launch benchmark vs baseline context files | Quantifies token savings and relevance quality | MEDIUM | Supports go-to-market credibility. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full raw transcript replay at startup | "Never miss anything" instinct | Massive token cost + noisy context | Keep compact summaries + on-demand deep recall. |
| Mandatory cloud sync | "Easy team sharing" | Breaks local-first/privacy goal | Optional shared-path team mode; cloud later by explicit opt-in. |
| Aggressive auto-store every event | "Maximum memory" | Low signal, high storage/noise | Store session summary + explicit high-importance manual memories. |

## Feature Dependencies

```
Adapter framework
    +--requires--> Core memory engine
                       +--requires--> Storage + embeddings

Session-start injection --requires--> Retrieval ranking + formatter

Team mode --enhances--> Core memory engine

Remote sync defaults --conflicts--> Local-first privacy stance
```

### Dependency Notes

- **Adapter framework requires core engine:** host integrations must stay thin and delegate logic.
- **Injection requires ranking + formatter:** without score+budget control, retrieval creates token waste.
- **Team mode enhances core engine:** same schema, additional sync/author metadata.
- **Remote sync defaults conflict with privacy-first:** keep opt-in only.

## MVP Definition

### Launch With (v1)

- [ ] Cross-platform adapter coverage for Tier 1 hosts + generic MCP host support.
- [ ] Session-end summarize/embed/store pipeline with local-first default.
- [ ] Session-start relevant memory injection under strict token cap.
- [ ] CLI lifecycle commands (`install`, `uninstall`, `search`, `list`, `show`, `forget`, `stats`, `export`, `import`).
- [ ] Reliability and quality bars (tests, CI, docs, benchmark report, security/privacy docs).

### Add After Validation (v1.x)

- [ ] Advanced reranking strategies and user-tunable weighting.
- [ ] Smarter summarization triggers by workload/session shape.

### Future Consideration (v2+)

- [ ] Encryption-at-rest with key management UX.
- [ ] Hosted sync tier.
- [ ] Non-text memory modalities.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Multi-host adapters | HIGH | HIGH | P1 |
| Semantic retrieval + token-capped injection | HIGH | HIGH | P1 |
| CLI lifecycle + memory controls | HIGH | MEDIUM | P1 |
| Team mode shared path | MEDIUM | HIGH | P2 |
| Advanced reranking and analytics | MEDIUM | MEDIUM | P2 |
| Encryption-at-rest | HIGH | MEDIUM | P2 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Existing Pattern | Existing Pattern | Our Approach |
|---------|------------------|------------------|--------------|
| Persistent context | Static project memory files | Tool-specific memory add-ons | Semantic, cross-tool memory core with adapter layer. |
| Setup UX | Per-tool manual MCP setup | Server-by-server setup churn | One installer that writes per-host adapter config. |
| Privacy mode | Cloud-first in many memory products | Partial local support | Local-first default; cloud optional for summarization only. |

## Sources

- PROJECT + PRD context (`sessionmem-PRD.md`)
- Official MCP/client docs referenced in STACK research
- OpenAI Docs MCP page for Codex/Cursor/Claude Code install patterns

---
*Feature research for: cross-platform coding-agent memory platform*
*Researched: 2026-05-24*

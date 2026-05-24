# Pitfalls Research

**Domain:** Cross-platform coding-agent memory infrastructure
**Researched:** 2026-05-24
**Confidence:** MEDIUM

## Critical Pitfalls

### Pitfall 1: Adapter Drift Across Hosts

**What goes wrong:**
Behavior differs by platform; memory quality/reliability inconsistent.

**Why it happens:**
Host-specific code paths accumulate business logic.

**How to avoid:**
Enforce strict adapter contract tests and keep logic centralized in core.

**Warning signs:**
Same query returns materially different memory relevance across hosts.

**Phase to address:**
Phase 1 (core + adapter contract foundation)

---

### Pitfall 2: Token Blowup from Injection

**What goes wrong:**
Injected memories consume more context than they save.

**Why it happens:**
No deterministic budget and weak truncation/filtering.

**How to avoid:**
Hard token budget + score threshold + dedupe + fallback "retrieve more" tool path.

**Warning signs:**
Startup token use spikes; users disable feature.

**Phase to address:**
Phase 2 (retrieval + formatter quality)

---

### Pitfall 3: Secret Leakage in Summaries

**What goes wrong:**
Credentials or sensitive values end up in memory summaries.

**Why it happens:**
Raw logs summarized without redaction/policy scanning.

**How to avoid:**
Pre-summary redaction filters + configurable deny patterns + audit tests.

**Warning signs:**
Memory entries containing token-like strings, secrets, or private URLs.

**Phase to address:**
Phase 1 and Phase 3 (security hardening)

---

### Pitfall 4: Fragile Install Experience

**What goes wrong:**
Global install/config fails on one or more platforms; adoption stalls.

**Why it happens:**
Assuming single filesystem layout/hook path/permission model.

**How to avoid:**
Host-specific installers, preflight checks, rollback on partial failure.

**Warning signs:**
Frequent user reports: "installed but server not visible".

**Phase to address:**
Phase 3 (CLI/install polish)

---

### Pitfall 5: sqlite-vec Runtime Failures

**What goes wrong:**
Vector extension fails to load on target OS/architecture.

**Why it happens:**
Native dependency mismatch and packaging gaps.

**How to avoid:**
Install-time health check + fallback pure JS cosine search for small datasets.

**Warning signs:**
Startup errors around extension load; retrieval disabled.

**Phase to address:**
Phase 1 (core persistence reliability)

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip migration layer | Faster initial coding | DB schema lock-in and unsafe upgrades | Only for throwaway prototypes, not v1 launch. |
| Hardcode hook paths | Quick install scripts | Breaks cross-platform compatibility | Never for cross-platform v1. |
| No adapter test matrix | Faster early delivery | Regressions per host updates | Never for parity objective. |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code | Assume env vars auto-expand in all scopes | Follow documented scope/command patterns and verify via `claude mcp list`. |
| Codex | Config written but not validated | Write config then run explicit `codex mcp list` verification step. |
| Cline/Cursor/Windsurf | Mixing transport config assumptions | Keep transport abstraction in adapter and validate per host capability. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embed on every small event | High latency and CPU churn | Batch by session-end/default trigger | >200 events/session |
| No pruning/retention | DB growth and slower queries | Retention policy + archival/export strategy | Months of daily use |
| Unbounded top-k retrieval | Irrelevant context blocks | weighted scoring + cap + threshold | Immediately under noisy history |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Accept arbitrary remote MCP endpoints by default | Supply-chain/command execution risk | Explicit trust model + allow-list + docs warnings. |
| Persist full raw command streams | Sensitive artifact leakage | Summary-first storage and redaction policy. |
| No team-mode author metadata | Weak auditability | Include `author`, source, timestamp for shared memories. |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No explainability on why memory injected | Users distrust retrieval | Show short reason/score metadata optionally. |
| Too many setup choices at install | Drop-off before first success | Guided defaults + advanced flags optional. |
| Deletion UX unclear | Fear of lock-in/privacy issues | Simple `forget`, scoped deletes, and export before delete prompt. |

## "Looks Done But Isn't" Checklist

- [ ] **Install:** Works on macOS/Linux/Windows with rollback on failure.
- [ ] **Retrieval:** Relevance quality validated, not just non-empty results.
- [ ] **Security:** Redaction tests catch common secret patterns.
- [ ] **Cross-platform:** Contract tests pass on all Tier 1 host adapters.
- [ ] **Team Mode:** Merge/conflict behavior documented and tested.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Bad injection relevance | MEDIUM | tune scoring weights, rebuild embeddings, add eval fixtures. |
| Corrupt/oversized DB | MEDIUM | export valid rows, reindex/rebuild DB, restore from backup. |
| Host adapter breakage | LOW-MEDIUM | disable affected adapter, keep core service running, ship patch. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Adapter drift | Phase 1 | Cross-host contract test matrix green. |
| Token blowup | Phase 2 | Startup injection median < configured token cap. |
| Secret leakage | Phase 1/3 | Redaction/security tests pass, manual spot checks clean. |
| Install fragility | Phase 3 | Installer smoke tests pass on all OS targets. |
| sqlite-vec failures | Phase 1 | Health checks + fallback retrieval path validated. |

## Sources

- MCP spec security guidance (Origin/auth/local bind): modelcontextprotocol.io transport spec
- Host setup docs: Claude Code / Cline / Windsurf / OpenAI Docs MCP
- Project PRD risk section (`sessionmem-PRD.md`)

---
*Pitfalls research for: cross-platform session memory platform*
*Researched: 2026-05-24*

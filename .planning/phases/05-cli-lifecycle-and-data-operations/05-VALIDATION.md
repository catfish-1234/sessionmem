---
phase: 5
slug: cli-lifecycle-and-data-operations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.8 |
| **Config file** | none detected — vitest runs with defaults; tests live under `tests/` |
| **Quick run command** | `npx vitest run <path> --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/<area> --reporter=dot`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 5-??-01 | install | 1 | CLI-01 | — | N/A | integration | `npx vitest run tests/integration/cli/install.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-02 | uninstall | 1 | CLI-02 | — | N/A | integration | `npx vitest run tests/integration/cli/uninstall.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-03 | search | 2 | CLI-03 | — | N/A | integration | `npx vitest run tests/integration/cli/search.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-04 | data-commands | 2 | CLI-04 | — | N/A | integration | `npx vitest run tests/integration/cli/data-commands.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-05 | export-import | 2 | CLI-05 | V12 | Resolve user-supplied paths; avoid path traversal | integration | `npx vitest run tests/integration/cli/export-import.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-06 | stats | 2 | CLI-06 | — | N/A | unit | `npx vitest run tests/unit/cli/stats.spec.ts -x` | ❌ W0 | ⬜ pending |
| 5-??-07 | error-contract | 1 | D-03 | — | Failures → stderr + exit(1); no secrets in messages | unit | `npx vitest run tests/unit/cli/error-contract.spec.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/cli/install.spec.ts` — CLI-01 stub
- [ ] `tests/integration/cli/uninstall.spec.ts` — CLI-02 stub
- [ ] `tests/integration/cli/search.spec.ts` — CLI-03 stub
- [ ] `tests/integration/cli/data-commands.spec.ts` — CLI-04 stub (list, show, forget)
- [ ] `tests/integration/cli/export-import.spec.ts` — CLI-05 stub
- [ ] `tests/unit/cli/stats.spec.ts` — CLI-06 stub
- [ ] `tests/unit/cli/error-contract.spec.ts` — D-03 stub
- [ ] Shared test helper: `MemoryCoreService` over temp-file DB seeded with memories (mirror `memory-core-service.spec.ts` setup)
- [ ] Command actions must accept injectable context (temp DB path instead of `~/.sessionmem`)
- [ ] `npm install commander` — install dependency before CLI tests can import the program

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Install produces correct checklist output in real terminal | CLI-01 | TTY formatting hard to test headlessly | Run `sessionmem install` in shell; verify ✓/✗ lines |
| Uninstall removes IDE config entries without DB deletion | CLI-02 | Requires real adapter integration | Run install then uninstall; confirm DB still exists |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

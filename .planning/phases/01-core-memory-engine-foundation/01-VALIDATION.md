---
phase: 01
slug: core-memory-engine-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 01 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (or Wave 0 creates baseline config) |
| **Quick run command** | `cmd /c npx vitest run --reporter=dot` |
| **Full suite command** | `cmd /c npx vitest run --coverage` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cmd /c npx vitest run --reporter=dot`
- **After every plan wave:** Run `cmd /c npx vitest run --coverage`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CAPT-01 | integration | `cmd /c npx vitest run tests/integration/storage/schema.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | CAPT-03 | integration | `cmd /c npx vitest run tests/integration/storage/events-to-memory.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | CAPT-03 | unit | `cmd /c npx vitest run tests/unit/embed/deterministic-embed.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | RETR-01 | integration | `cmd /c npx vitest run tests/integration/retrieve/retrieve-ranked.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 2 | RETR-02 | unit | `cmd /c npx vitest run tests/unit/retrieve/scoring-weights.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |
| 01-04-01 | 04 | 2 | SECU-03 | integration | `cmd /c npx vitest run tests/integration/core/local-only-policy.spec.ts --reporter=dot` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` - baseline config and test include patterns
- [ ] `tests/setup.ts` - shared fixtures + deterministic time helper
- [ ] `tests/integration/storage/schema.spec.ts` - CAPT-01 schema and indexes checks
- [ ] `tests/unit/embed/deterministic-embed.spec.ts` - deterministic embedding behavior
- [ ] `tests/unit/retrieve/scoring-weights.spec.ts` - RETR-02 weighting and tie-break behavior
- [ ] `tests/integration/core/local-only-policy.spec.ts` - SECU-03 policy enforcement

---

## Manual-Only Verifications

All phase 1 behaviors have automated verification targets. No manual-only checks required.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

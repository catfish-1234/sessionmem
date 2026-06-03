---
phase: 03
slug: injection-quality-token-control
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-03
---

# Phase 03 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7 |
| **Config file** | none |
| **Quick run command** | `npx vitest run tests/unit/injection tests/unit/retrieve tests/integration/retrieve --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run the focused command for the changed test file.
- **After every plan wave:** Run `npm test`.
- **Before `$gsd-verify-work`:** Full suite and quality harness must be green.
- **Max feedback latency:** 10 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | RETR-03 | unit + snapshot | `npx vitest run tests/unit/injection/format-startup-injection.spec.ts --reporter=dot` | W0 | pending |
| 03-01-02 | 01 | 1 | RETR-03 | unit | `npx vitest run tests/unit/injection/token-budget.spec.ts --reporter=dot` | W0 | pending |
| 03-02-01 | 02 | 1 | RETR-04 | integration | `npx vitest run tests/integration/retrieve/retrieve-on-demand.spec.ts --reporter=dot` | W0 | pending |
| 03-02-02 | 02 | 1 | RETR-04 | integration | `npx vitest run tests/integration/retrieve/retrieve-score-metadata.spec.ts --reporter=dot` | W0 | pending |
| 03-03-01 | 03 | 2 | RETR-05 | integration | `npx vitest run tests/integration/core/memory-feedback.spec.ts --reporter=dot` | W0 | pending |
| 03-03-02 | 03 | 2 | RETR-05 | unit + integration | `npx vitest run tests/unit/retrieve/importance-decay.spec.ts tests/integration/core/memory-feedback.spec.ts --reporter=dot` | W0 | pending |
| 03-04-01 | 04 | 3 | RETR-03/RETR-04 | quality | `npx vitest run tests/quality/injection/injection-quality-harness.spec.ts --reporter=dot` | W0 | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/injection/format-startup-injection.spec.ts` - RETR-03 deterministic grouped output and snapshots.
- [ ] `tests/unit/injection/token-budget.spec.ts` - RETR-03 exact token cap and lower-priority trimming.
- [ ] `tests/integration/retrieve/retrieve-on-demand.spec.ts` - RETR-04 mode/depth behavior.
- [ ] `tests/integration/retrieve/retrieve-score-metadata.spec.ts` - RETR-04 score metadata and read-only retrieval.
- [ ] `tests/integration/core/memory-feedback.spec.ts` - RETR-05 bounded boost and history persistence.
- [ ] `tests/unit/retrieve/importance-decay.spec.ts` - RETR-05 deterministic old auto-boost decay helper.
- [ ] `tests/quality/injection/injection-quality-harness.spec.ts` - realistic and synthetic quality harness.
- [ ] `src/core/schema/migrations/004_memory_feedback.sql` - feedback event audit table.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency < 10s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-03

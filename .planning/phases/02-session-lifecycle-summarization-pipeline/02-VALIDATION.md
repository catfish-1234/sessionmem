---
phase: 02
slug: session-lifecycle-summarization-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-25
---

# Phase 02 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.7 |
| **Config file** | none - Wave 0 installs if needed |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test`
- **After every plan wave:** Run `npm run test`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | CAPT-02 | integration | `npx vitest run tests/integration/core/session-lifecycle-summary.spec.ts --reporter=dot` | ? W0 | ? pending |
| 02-01-02 | 01 | 0 | CAPT-02 | integration | `npx vitest run tests/integration/core/summarization-retry-failure.spec.ts --reporter=dot` | ? W0 | ? pending |
| 02-01-03 | 01 | 0 | CAPT-04 | integration | `npx vitest run tests/integration/core/manual-summary-when-auto-off.spec.ts --reporter=dot` | ? W0 | ? pending |
| 02-01-04 | 01 | 0 | SECU-04 | unit | `npx vitest run tests/unit/core/cloud-status-warning.spec.ts --reporter=dot` | ? W0 | ? pending |
| 02-01-05 | 01 | 0 | SECU-04 | integration | `npx vitest run tests/integration/core/cloud-optin-policy.spec.ts --reporter=dot` | ? W0 | ? pending |

*Status: ? pending · ? green · ? red · ?? flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/core/session-lifecycle-summary.spec.ts` - stubs for CAPT-02
- [ ] `tests/integration/core/summarization-retry-failure.spec.ts` - retry/failure coverage
- [ ] `tests/integration/core/manual-summary-when-auto-off.spec.ts` - CAPT-04 manual path
- [ ] `tests/unit/core/cloud-status-warning.spec.ts` - SECU-04 warning signal
- [ ] `tests/integration/core/cloud-optin-policy.spec.ts` - explicit cloud opt-in enforcement
- [ ] `vitest.config.ts` (optional) - retries/timeouts only if needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Adapter startup cloud warning visibility | SECU-04 | host adapter UX depends on runtime integration | Enable cloud mode, launch adapter, confirm warning appears in startup surface |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
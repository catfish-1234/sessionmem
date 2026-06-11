---
phase: 7
slug: team-mode-shared-memory
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-11
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.8 |
| **Config file** | none detected — vitest runs with defaults; tests live under `tests/` |
| **Quick run command** | `npx vitest run <path> --reporter=dot` |
| **Full suite command** | `npm test` (`vitest run --reporter=dot`) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched-area> --reporter=dot`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-xx | TBD | 1 | TEAM-02 | T-07-04 | `005_*` migration adds `author`/`origin_project_id`; existing rows survive | integration | `npx vitest run tests/integration/storage/schema.spec.ts -x` | ⚠️ exists — extend | ⬜ pending |
| 07-01-xx | TBD | 1 | TEAM-02 | — | every write stamps `author` = local username (D-07) | unit | `npx vitest run tests/unit/core/author-stamp.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-02-xx | TBD | 2 | — | — | `team enable <path>` persists `team` section; `team status` reads it back (D-14) | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-02-xx | TBD | 2 | TEAM-03 | — | `team disable` (default) keeps pulled rows; sync no-ops after | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-02-xx | TBD | 2 | TEAM-03 | — | `team disable --remove-team-memories` deletes `author != local` rows | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | TEAM-01 | T-07-03 | `sync push` writes full snapshot to `{sharedPath}/{project_id}/{username}.json` | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | TEAM-01 | — | `sync pull` merges teammate files into local DB; rows retrievable | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | TEAM-01 | T-07-06 | last-write-wins on id conflict; cross-project id skipped (D-09) | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | TEAM-01 | — | importance preserved when local > incoming (D-11) | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | TEAM-01 | T-07-02 | redaction re-applied on pull (D-12) even if teammate redaction off | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | D-16 | — | `sync` prints `Pushed N..., pulled M new + updated K...` summary | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-03-xx | TBD | 3 | D-03 | — | sync against missing/unwritable shared path → stderr + exit 1 | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 | ⬜ pending |
| 07-04-xx | TBD | 4 | TEAM-02 | T-07-05 | D-10 annotation: teammate-authored memory shows `author:` prefix in injection when `author != local` | unit | `npx vitest run tests/unit/injection/author-annotation.spec.ts -x` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/integration/cli/sync.spec.ts` — push/pull round-trip, summary output, error-on-bad-path (TEAM-01, D-16, D-03). Use a temp dir as `sharedPath`, two `SESSIONMEM_PROJECT_ID`/`SESSIONMEM_DB_PATH` "users" writing into the same shared dir.
- [ ] `tests/integration/cli/team.spec.ts` — enable/disable/status, `--remove-team-memories` (TEAM-03, D-14).
- [ ] `tests/unit/core/pull-merge.spec.ts` — LWW, importance-preserve (D-11), cross-project skip (D-09), redaction-on-pull (D-12).
- [ ] `tests/unit/injection/author-annotation.spec.ts` — D-10 prefix when `author != local`, no prefix when equal.
- [ ] `tests/unit/core/author-stamp.spec.ts` — D-07 every write path stamps author.
- [ ] Extend existing `tests/integration/storage/schema.spec.ts` for the `005` columns (TEAM-02).
- [ ] Shared test fixture: a `withSharedDir`/two-user helper (temp `sharedPath` + two contexts via env seams) — likely a new `tests/helpers` util.

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

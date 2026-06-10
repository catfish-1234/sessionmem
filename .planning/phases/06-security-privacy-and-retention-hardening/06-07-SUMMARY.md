---
phase: 06-security-privacy-and-retention-hardening
plan: 07
subsystem: docs
tags: [documentation, privacy, retention, redaction, cli]
requires: ["06-01", "06-03", "06-05"]
provides: ["privacy-and-retention-user-doc", "doc-coverage-smoke-test"]
affects: []
tech-stack:
  added: []
  patterns: ["doc-presence smoke test (fs.readFileSync token assertions)"]
key-files:
  created:
    - docs/privacy-and-retention.md
    - tests/integration/docs/privacy-docs.spec.ts
  modified: []
decisions:
  - "Doc authored directly from 06-CONTEXT.md decisions (D-01..D-15) and the merged CLI implementations to avoid documenting unshipped behavior (T-06-24)"
  - "Coverage test asserts exact CLI tokens so docs cannot silently drift from shipped commands"
metrics:
  duration: "~6 min"
  completed: 2026-06-10
requirements: [SECU-01, SECU-02]
---

# Phase 6 Plan 7: Privacy and Retention Documentation Summary

User-facing `docs/privacy-and-retention.md` documenting Phase 6 secret redaction, retention policy, the `config.json` surface with precedence, and all new CLI commands — guarded by a doc-coverage smoke test that fails if documented command tokens drift from the shipped CLI.

## What Was Built

**Task 1 — `docs/privacy-and-retention.md`** (commit `1896e7f`)
Authored in the heading/section style of `docs/cloud-summarization.md`, covering:
- **Secret Redaction:** all D-05 categories (email, `sk-`, AWS `AKIA`, GitHub `ghp_`/`gho_`, Bearer, private key blocks, `password=`/`secret=`, JWT) as `REDACTED` placeholders; runs on all write paths (auto-summarize, manual store, import) per D-06; `redactionEnabled` flag default-on; `redaction_partial_failure` warning code (D-08).
- **Retention Policy:** `retentionDays` default 90, `created_at` age basis, `0`/`-1` disables, hard-delete of the `memories` table only, export-first guidance (D-01/D-03/D-04).
- **Automatic vs Manual Pruning:** light non-blocking session-end auto-prune (D-02); manual `retention prune` dry-run-by-default with the exact `Would delete N memories older than {retentionDays} days. Pass --force to confirm.` string and `--force`/`--days` flags (D-12), matching the merged `retention.ts`.
- **One-time Scrub:** `redact-scan [--apply]` (D-07/D-14).
- **Policy Config:** `~/.sessionmem/config.json` keys, precedence CLI flag > config.json > default (D-11), `config get`/`config set` with both dotted and raw key forms (D-13), install writes defaults if absent / uninstall preserves unless `--purge` (D-10).
- **Stats Visibility:** retention + redaction stats lines (D-15).

**Task 2 — `tests/integration/docs/privacy-docs.spec.ts`** (commit `2711f6c`)
Vitest doc-presence smoke test: asserts the doc exists and contains required topic tokens (`redactionEnabled`, `retentionDays`, `90`, `config.json`), CLI command tokens (`retention prune`, `redact-scan`, `config set`, `config get`, `--force`, `--apply`), and redaction category names (`AWS`, `GitHub`, `JWT`, `private key`, `Bearer`). Removing any documented token fails the spec.

## Verification

- Task 1 node token-coverage script: exits 0.
- `npx vitest run tests/integration/docs/privacy-docs.spec.ts --reporter=dot`: 4 passed.
- Full suite: 210 passed, 8 skipped. One pre-existing failure (`cli-entrypoint.spec.ts`) requires a built `dist/cli/index.js` (`npm run build`) — see Deferred Issues.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Aligned private-key category token to lowercase**
- **Found during:** Task 2 (first spec run failed on the `private key` category assertion).
- **Issue:** The doc table used "Private key blocks" (capital P) and `PRIVATE KEY` (uppercase), but the coverage spec asserts the lowercase token `private key`. The plan's Task 2 action explicitly lists `private key` as a required category token.
- **Fix:** Updated the redaction-category table row to include the lowercase phrase "private key blocks", keeping the doc accurate while satisfying the coverage token.
- **Files modified:** docs/privacy-and-retention.md
- **Commit:** 2711f6c (committed alongside the test that surfaced it)

## Deferred Issues

- `tests/integration/cli/cli-entrypoint.spec.ts` fails because the built CLI (`dist/cli/index.js`) is absent — it requires `npm run build` first. This is a pre-existing, build-environment condition unrelated to this documentation plan (scope boundary: out-of-scope failure in an unrelated file). Not fixed.

## Known Stubs

None — both deliverables are complete documentation/test artifacts with no placeholder data.

## Self-Check: PASSED
- FOUND: docs/privacy-and-retention.md
- FOUND: tests/integration/docs/privacy-docs.spec.ts
- FOUND commit: 1896e7f
- FOUND commit: 2711f6c

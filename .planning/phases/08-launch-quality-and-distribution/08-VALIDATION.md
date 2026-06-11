---
phase: 08
slug: launch-quality-and-distribution
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-11
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.8 |
| **Config file** | none — vitest runs with defaults; no `vitest.config.*` present, no coverage thresholds configured |
| **Quick run command** | `npx vitest run <path> --reporter=dot` |
| **Full suite command** | `npm test` (= `vitest run --reporter=dot`) |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched-spec> --reporter=dot` and `npx eslint <touched-files>` (once eslint config exists)
- **After every plan wave:** Run `npm test` + `npx eslint .` + `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite green + lint clean + `npm pack --dry-run` reviewed. Install-smoke validated via the new `ci.yml` (the CI job IS the validation harness for D-02).
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-W0-eslint | TBD | 0 | QLTY-02 | — | N/A | lint | `npx eslint .` | ❌ W0 | ⬜ pending |
| 08-W0-readme-spec | TBD | 0 | QLTY-03 | — | N/A | integration | `npx vitest run tests/integration/docs/readme-docs.spec.ts -x` | ❌ W0 | ⬜ pending |
| 08-W0-architecture-spec | TBD | 0 | QLTY-03 | — | N/A | integration | `npx vitest run tests/integration/docs/architecture-docs.spec.ts -x` | ❌ W0 | ⬜ pending |
| 08-W0-troubleshooting-spec | TBD | 0 | QLTY-03 | — | N/A | integration | `npx vitest run tests/integration/docs/troubleshooting-docs.spec.ts -x` | ❌ W0 | ⬜ pending |
| 08-W0-migration-spec | TBD | 0 | QLTY-03 | — | N/A | integration | `npx vitest run tests/integration/docs/migration-docs.spec.ts -x` | ❌ W0 | ⬜ pending |
| 08-W0-benchmark-script | TBD | 0 | QLTY-04 | — | N/A | script + manual review | `npm run benchmark` then inspect `docs/benchmark.md` | ❌ W0 | ⬜ pending |
| 08-W0-ci-workflow | TBD | 0 | QLTY-02 | — | N/A | smoke (CI) | `npm pack && npm i -g ./*.tgz && sessionmem --version && sessionmem install` | ❌ W0 | ⬜ pending |
| 08-W0-mcp-server | TBD | 0 | QLTY-01 / QLTY-05 | T-08-01 | Real stdio MCP server responds to client handshake | integration | `npx vitest run tests/integration/mcp/*.spec.ts -x` | ❌ W0 | ⬜ pending |
| 08-W0-adapter-install-parity | TBD | 0 | QLTY-01 | — | N/A | integration | `npm test` | ❌ W0 | ⬜ pending |
| 08-W0-package-publishable | TBD | 0 | QLTY-05 | T-08-02 | `package.json` not private, `files` allow-list correct | unit | `npm pack --dry-run` | ❌ W0 | ⬜ pending |
| 08-W0-release-workflow | TBD | 0 | QLTY-05 | T-08-03 | `release.yml` scoped `id-token: write` to publish job only, OIDC trusted publisher | manual/CI | tag push → `release.yml` (validated only at real release) | ❌ W0 | ⬜ pending |
| 08-W0-typecheck | TBD | 0 | QLTY-02 | — | N/A | typecheck | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 08-W0-tests | TBD | 0 | QLTY-01 / QLTY-02 | — | N/A | unit+integration | `npm test` | ✅ (52 specs) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## In-Phase Prerequisites (delivered within this phase's own waves)

> NOTE: These are NOT an external "Wave 0" prerequisite blocking this phase. Each item is a deliverable of this phase's own Wave 1–3 plans and is created before any later wave that consumes it. The dependency ordering is encoded in plan `wave`/`depends_on` frontmatter (e.g., `ci.yml` from Wave 3's 08-05 is reused by Wave 4's 08-06). Listed here for traceability of the artifact → requirement mapping.

- [x] `eslint.config.mjs` — Wave 2 / 08-02 — covers QLTY-02 (D-03)
- [x] `tests/integration/docs/readme-docs.spec.ts` — Wave 1 / 08-03 — covers QLTY-03 (D-05/D-09)
- [x] `tests/integration/docs/architecture-docs.spec.ts` — Wave 1 / 08-03 — covers QLTY-03 (D-06/D-09)
- [x] `tests/integration/docs/troubleshooting-docs.spec.ts` — Wave 1 / 08-03 — covers QLTY-03 (D-07/D-09)
- [x] `tests/integration/docs/migration-docs.spec.ts` — Wave 1 / 08-03 — covers QLTY-03 (D-08/D-09)
- [x] `scripts/benchmark.mjs` + `npm run benchmark` script — Wave 2 / 08-04 — covers QLTY-04 (D-12)
- [x] `.github/workflows/ci.yml` — Wave 3 / 08-05 — covers QLTY-02 (the validation harness itself, D-01..D-04)
- [x] MCP stdio server implementation + integration test (D-17) — Wave 1 / 08-01 — covers QLTY-01/QLTY-05 gap
- [x] Adapter `install()` parity tests (≥1 IDE + ≥1 global) — Wave 2 / 08-02 — covers QLTY-01 gap

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| npm publish via `release.yml` (OIDC trusted publishing) | QLTY-05 | Requires real npm trusted-publisher config + tag push to a real registry; cannot be simulated in CI dry-run | Configure trusted publisher on npmjs.com for `kavishdua/sessionmem`, push a `v1.0.0` tag, confirm package appears on npm with provenance |
| MCP Registry / Claude Code marketplace submission | QLTY-05 | External submission process to third-party registries, outside repo CI | Submit `server.json` via `mcp-publisher`; submit `.claude-plugin/marketplace.json` per Claude Code plugin docs |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or in-phase prerequisites (every automated task carries an `<automated>` command)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] In-phase prerequisites cover all MISSING references (no external Wave 0 needed)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** 2026-06-11

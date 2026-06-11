---
phase: 08-launch-quality-and-distribution
plan: 06
subsystem: distribution
status: paused-at-checkpoint
tags: [release, npm, oidc, mcp-registry, claude-plugin, distribution]
requires:
  - "package.json mcpName io.github.kavishdua/sessionmem + version 1.0.0 (Plan 01)"
  - "working `sessionmem run` stdio MCP server (Plan 01, stdio-server.spec)"
  - "ci.yml gate steps reused by release.yml (Plan 05)"
provides:
  - ".github/workflows/release.yml — tag-triggered npm publish (OIDC, NPM_TOKEN fallback)"
  - "server.json — official MCP Registry metadata"
  - ".claude-plugin/marketplace.json + plugin.json — Claude Code marketplace listing"
  - ".mcp.json — plugin MCP server wiring (sessionmem run)"
affects:
  - "Release/distribution layer only; no runtime/source code changed"
tech-stack:
  added:
    - "GitHub Actions OIDC trusted publishing (id-token: write, automatic Sigstore provenance)"
  patterns:
    - "RESEARCH Pattern 6 (OIDC publish), but id-token scoped to publish JOB per V4/T-08-13"
key-files:
  created:
    - ".github/workflows/release.yml"
    - "server.json"
    - ".claude-plugin/marketplace.json"
    - ".claude-plugin/plugin.json"
    - ".mcp.json"
  modified: []
decisions:
  - "id-token: write scoped to the publish job (not workflow-level) per plan acceptance + V4/T-08-13, deviating from RESEARCH Pattern 6's workflow-level grant"
  - "NPM_TOKEN/NODE_AUTH_TOKEN fallback left commented (D-18); OIDC trusted publishing is the primary path"
  - "Verified MCP Registry schema URL 2025-12-11/server.schema.json still returns 200 (A5) before hardcoding"
metrics:
  duration: "~10m"
  completed: "2026-06-11"
  tasks_completed: 2
  tasks_total: 3
requirements: [QLTY-05]
---

# Phase 08 Plan 06: Distribution Layer Summary

Authored the distribution layer for QLTY-05 — a tag-triggered npm release workflow (OIDC trusted publishing with a documented NPM_TOKEN fallback) plus internally consistent registry/marketplace metadata (server.json, .claude-plugin/marketplace.json + plugin.json, .mcp.json) all under owner `kavishdua`, version `1.0.0`, and the `sessionmem run` invocation. Execution **paused at the blocking human checkpoint** before any irreversible npm publish / registry / marketplace submission.

## Status

PAUSED at Task 3 (`checkpoint:human-verify`, `gate="blocking-human"`). Both author tasks (1 and 2) are complete, verified, and committed. The irreversible publish/submission steps require human confirmation of identity/name/auth and that the advertised server actually works (T-08-12). The orchestrator must surface this checkpoint to the user; a fresh agent will continue after "approved".

## What Was Built

### Task 1 — release.yml (committed `a405f61`)
- Triggers only on `push` of `v*` tags.
- Workflow-level `permissions: contents: read` only; `id-token: write` scoped to the `publish` job (least privilege — V4 / T-08-13).
- Publish job: `actions/checkout@v6`, `actions/setup-node@v5` (node 22, `registry-url: https://registry.npmjs.org`), then `npm ci` / `npm test` / `npm run build` / `npm publish --access public`.
- OIDC trusted publishing auto-detected; provenance automatic (no redundant `--provenance`).
- Commented `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` fallback block with explanation (D-18). No token value committed (Gitleaks pre-commit gate passed).

### Task 2 — distribution metadata (committed `5f971d6`)
- `server.json`: `$schema` 2025-12-11 server.schema.json (URL re-verified 200), `name` `io.github.kavishdua/sessionmem` (exactly equals `package.json` `mcpName`), `repository.source: github`, `version` 1.0.0, npm package `identifier: sessionmem`, `transport.type: stdio`.
- `.claude-plugin/marketplace.json`: `name: sessionmem`, `owner.name: kavishdua`, `plugins[]` with `name` + `source: ./`.
- `.claude-plugin/plugin.json`: `name: sessionmem`, `version: 1.0.0`.
- `.mcp.json`: `mcpServers.sessionmem` → `command: sessionmem`, `args: ["run"]` — identical to the installer's `MANUAL_CONFIG_BLOCK` (`src/cli/commands/install.ts`) and `claudeCode.ts` args `["run"]`.
- Verified all four share owner (kavishdua), version (1.0.0), and the `sessionmem run` invocation.

## Verification

- Task 1 plan verify script: PASSED (tags, id-token: write, npm ci, npm run build, npm publish present).
- Structural YAML check: top-level permissions = `contents: read` only; `id-token: write` present only under the publish job. PASSED.
- Task 2 plan verify script: PASSED (server.json name == package.json mcpName; .mcp.json command/args; all JSON valid).
- Extended consistency check: owner/version/invocation consistent across all four files. PASSED.
- `npm pack --dry-run` (informational, for checkpoint context): tarball = 71 files, 41.4 kB, only `dist/` + LICENSE + README + package.json. NO `.planning/`, `tests/`, `src/`, or the new metadata files leak (T-08-02 / Pitfall 4 clean — `files: ["dist"]` works as intended).
- Post-commit deletion check: no deletions in either commit. No untracked files left.

## Deviations from Plan

**1. [Plan-directed] id-token scoping** — RESEARCH Pattern 6 places `id-token: write` at the workflow level, but the plan's acceptance criteria and threat register (V4 / T-08-13) require it scoped to the publish job only. Followed the plan: workflow-level is `contents: read`, the publish job grants `id-token: write`. Not an auto-fix — the plan explicitly specified this.

No Rule 1/2/3 auto-fixes were needed; both tasks executed as written.

## Manual-Only Verifications (deferred to checkpoint / release time)

These are inherently human/CI-at-release actions and are intentionally NOT performed here:
- Real `npm publish` of `sessionmem@1.0.0` (irreversible).
- `npm view sessionmem version` availability re-check.
- npm trusted-publisher (OIDC) UI setup OR adding the `NPM_TOKEN` secret + uncommenting the fallback.
- MCP Registry submission via `mcp-publisher login github` + `publish`.
- Claude Code marketplace listing submission.
- Human confirmation that `sessionmem run` is a real working server (Plan 01 stdio-server.spec) so distribution does not advertise a dead server (T-08-12).

## Checkpoint Reached

Type: `human-verify` (`gate="blocking-human"`). Awaiting "approved" (or change requests) confirming identity/name/auth and a verified-working server before the irreversible publish/submission steps. See the structured checkpoint return for the exact verification steps.

## Self-Check: PASSED

- Files: release.yml, server.json, .claude-plugin/marketplace.json, .claude-plugin/plugin.json, .mcp.json, 08-06-SUMMARY.md all FOUND.
- Commits: a405f61 (Task 1), 5f971d6 (Task 2) both FOUND in git log.

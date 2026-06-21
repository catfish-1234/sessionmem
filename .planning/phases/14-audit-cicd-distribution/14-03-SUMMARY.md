---
phase: 14-audit-cicd-distribution
plan: "03"
subsystem: ci-cd
tags: [workflow, npm-publish, dedup]
dependency_graph:
  requires: [14-01]
  provides: [single-publish-workflow]
  affects: [.github/workflows]
tech_stack:
  added: []
  patterns: [single-source-of-truth-workflow]
key_files:
  created: []
  modified: []
  deleted:
    - .github/workflows/publish.yml
decisions:
  - "Confirmed release.yml has all required behaviors (OIDC, NPM_TOKEN fallback, --access public, npm test) before deleting publish.yml"
metrics:
  duration: "46s"
  completed: "2026-06-21T04:21:00Z"
  tasks_completed: 1
  tasks_total: 1
---

# Phase 14 Plan 03: Delete Duplicate Publish Workflow Summary

Deleted the older publish.yml workflow that raced with release.yml on version tag pushes, causing one to always fail during npm publish.

## What Was Done

### Task 1: Delete publish.yml

Confirmed `release.yml` covers all publishing needs:
- OIDC trusted publishing with `id-token: write` (job-scoped)
- Documented `NPM_TOKEN` fallback for when OIDC UI setup is not configured
- `--access public` flag on `npm publish`
- `npm test` step before publish
- Least-privilege permissions at workflow level

Then deleted `.github/workflows/publish.yml`, which was the older duplicate:
- Triggered on `v*.*.*` (subset of release.yml's `v*` pattern)
- Used `npm publish` without `--access public`
- No OIDC support, no test step
- Direct `NPM_TOKEN` secret dependency with no fallback documentation

**Commit:** `07c8b0c`

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Verification

Remaining workflows after deletion:
- `ci.yml` - CI pipeline
- `release.yml` - npm publishing on version tags (OIDC + NPM_TOKEN fallback)
- `security.yml` - security checks

No duplicate publish workflow exists. Only `release.yml` handles npm publishing on version tags.

## Self-Check: PASSED

- publish.yml confirmed deleted
- release.yml confirmed present
- 14-03-SUMMARY.md confirmed present
- Commit 07c8b0c confirmed in git log

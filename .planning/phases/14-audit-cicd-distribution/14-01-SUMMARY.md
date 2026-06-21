---
phase: 14-audit-cicd-distribution
plan: 01
subsystem: ci-cd
tags: [github-actions, workflow-fix, action-versions]
dependency_graph:
  requires: []
  provides: [working-ci-workflows]
  affects: [ci.yml, release.yml, security.yml]
tech_stack:
  added: []
  patterns: [github-actions-v4-checkout, github-actions-v5-setup-node]
key_files:
  modified:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - .github/workflows/security.yml
decisions:
  - "Used actions/checkout@v4 and actions/setup-node@v5 to match publish.yml reference"
metrics:
  duration: 63s
  completed: 2026-06-21T04:11:38Z
  tasks_completed: 3
  tasks_total: 3
---

# Phase 14 Plan 01: Fix GitHub Actions Non-Existent Action Versions Summary

Replaced all non-existent actions/checkout@v6 and actions/setup-node@v6 references with correct v4/v5 versions across three workflow files, matching the already-correct publish.yml.

## Tasks Completed

| Task | Name | Commit | Files Modified |
|------|------|--------|----------------|
| 1 | Fix ci.yml action versions | 6368a31 | .github/workflows/ci.yml |
| 2 | Fix release.yml action versions | 6368a31 | .github/workflows/release.yml |
| 3 | Fix security.yml action versions | 6368a31 | .github/workflows/security.yml |

## Changes Made

### ci.yml
- Replaced 2 occurrences of `actions/checkout@v6` with `actions/checkout@v4` (lines 20, 55)
- Confirmed `actions/setup-node@v5` was already correct (no change needed)

### release.yml
- Replaced `actions/checkout@v6` with `actions/checkout@v4` (line 26)
- Replaced `actions/setup-node@v6` with `actions/setup-node@v5` (line 28)

### security.yml
- Replaced `actions/checkout@v6` with `actions/checkout@v4` (line 12)

## Verification

- Ran `grep @v6` across all workflow files: zero matches (PASSED)
- All checkout references now use `@v4`, all setup-node references now use `@v5`
- Matches publish.yml reference versions exactly

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

1. All three tasks committed together in a single commit since they are a cohesive fix addressing the same issue (non-existent action versions).

## Self-Check: PASSED

---
phase: 05-cli-lifecycle-and-data-operations
plan: "02"
subsystem: cli
tags: [cli, install, uninstall, ping, lifecycle, d-04, d-05, d-06, d-13, d-14, d-15]
dependency_graph:
  requires: ["05-01"]
  provides: ["install-lifecycle", "uninstall-lifecycle", "ping-command"]
  affects: ["src/cli/commands/install.ts", "src/cli/commands/run.ts", "src/cli/commands/uninstall.ts", "src/cli/commands/ping.ts"]
tech_stack:
  added: []
  patterns: ["step-checklist-ux", "adapter-optional-method-guard", "dbpath-injectable-testing"]
key_files:
  created:
    - src/cli/commands/uninstall.ts
    - src/cli/commands/ping.ts
  modified:
    - src/cli/commands/install.ts
    - tests/integration/cli/install.spec.ts
    - tests/integration/cli/uninstall.spec.ts
decisions:
  - "Exported MANUAL_CONFIG_BLOCK from install.ts (was previously unexported) to satisfy D-14 and enable test assertions"
  - "--purge deletes only memories.db, never logs or the ~/.sessionmem directory (Open Q3 / T-05-04)"
  - "uninstallCommand accepts dbPath override in options for test injection, avoiding home-directory writes in CI"
metrics:
  duration: "3min"
  completed: "2026-06-09"
  tasks: 2
  files_modified: 5
---

# Phase 5 Plan 02: CLI Lifecycle — Install/Uninstall/Ping Summary

**One-liner:** Install lifecycle with DB-init validation, ✓/✗ step checklist, and uninstall with --purge DB-scoped deletion.

## What Was Built

### Task 1: Refactor install.ts (D-04 + D-05) and run.ts (D-02)

Refactored `installCommand()` to execute a two-step validation sequence:

1. **DB init (D-04 item 1):** Calls `createCliContext(overrides?)` which opens `~/.sessionmem/memories.db` and runs migrations. On failure: prints `✗ DB init failed` with error message and actionable hint, exits non-zero.
2. **Adapter config (D-04 item 2):** `AdapterFactory.detectAdapter()`, guards optional `install?` method (no method → `printManualFallback` + exit 1), calls `adapter.install()`, guards boolean return (false → `printManualFallback` + exit 1).
3. **Success path (D-05):** Prints three-line checklist: `✓ DB initialized (path)`, `✓ {adapter} config updated`, `✓ sessionmem ready`.

`MANUAL_CONFIG_BLOCK` and `printManualFallback` are preserved and now exported (D-14). `installCommand` accepts an optional `contextOverrides` parameter for test injection.

`run.ts` was confirmed to have no `process.argv[2]` exec guard already — D-02 already satisfied by Plan 01.

### Task 2: Add uninstall.ts and ping.ts with real integration tests

**uninstall.ts** (`uninstallCommand(options)`):
- Detects adapter via `AdapterFactory.detectAdapter()`
- Guards `adapter.uninstall?` (absent → stderr + exit 1)
- `await adapter.uninstall()` → false → `✗ config removal failed` + exit 1; true → `✓ {adapter} config removed`
- Default (no `--purge`): prints `Memory DB preserved at {dbPath}`, leaves file intact (D-06 / T-05-05)
- `--purge`: `rmSync(dbPath, { force: true })` on `memories.db` only — no logs or directory deletion (T-05-04)
- `dbPath` injectable via options for test isolation

**ping.ts** (`pingCommand()`):
- Calls `pingTool.execute()` directly
- Prints `status`, `version`, `message` to stdout
- Exits 0 on `status === "ok"`, exits 1 on any other status (D-13)

**install.spec.ts** (replaced 3 `it.todo` with 3 real assertions):
- Success path: verifies checklist strings `✓ DB initialized`, `config updated`, `✓ sessionmem ready`
- No-install capability: verifies `printManualFallback` output (`mcpServers` in log) + exit 1
- install returns false: verifies `printManualFallback` + `failed` in stderr + exit 1

**uninstall.spec.ts** (replaced 4 `it.todo` with 4 real assertions):
- Adapter success: verifies `config removed` in log
- Default (no purge): creates dummy file at temp dbPath, confirms file still exists after uninstall
- Purge: creates dummy file, confirms file deleted after `--purge`
- No uninstall capability: confirms exit 1 + error message containing adapter name

## Verification Results

```
Test Files  2 passed (2)
Tests       7 passed (7)
Build       tsc exits 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Export] MANUAL_CONFIG_BLOCK promoted to export**
- **Found during:** Task 2 (test assertions need to verify the block was printed)
- **Issue:** `MANUAL_CONFIG_BLOCK` was an unexported `const` — tests could not assert it was printed to `console.log`
- **Fix:** Added `export` keyword to `MANUAL_CONFIG_BLOCK`; D-14 still satisfied (block defined and printed on fallback path)
- **Files modified:** `src/cli/commands/install.ts`
- **Commit:** 10e1997

**2. [Rule 2 - Missing Testability Seam] dbPath injectable in uninstallCommand options**
- **Found during:** Task 2 (uninstall tests must not write to `~/.sessionmem` in CI)
- **Issue:** Plan described a `dbPath` resolution via `homedir()` but tests need to inject a temp path
- **Fix:** Added `dbPath?: string` to `UninstallOptions`; if provided, overrides the default home-relative path
- **Files modified:** `src/cli/commands/uninstall.ts`
- **Commit:** f5ed904

## Threat Model Verification

| Threat ID | Mitigation Applied |
|-----------|-------------------|
| T-05-04 | --purge scoped to memories.db only; rmSync with force:true; logs directory untouched |
| T-05-05 | Default uninstall path never touches DB file; confirmed by test |
| T-05-06 | ✗ step + actionable message + non-zero exit on every partial failure |

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 10e1997 | feat(05-02): refactor install with D-04 validation and D-05 step checklist |
| 2 | f5ed904 | feat(05-02): add uninstall and ping commands with passing integration tests |

## Self-Check: PASSED

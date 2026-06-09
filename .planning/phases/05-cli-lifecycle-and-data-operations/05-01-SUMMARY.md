---
phase: 05-cli-lifecycle-and-data-operations
plan: "01"
subsystem: cli
tags: [cli, build-pipeline, commander, context, output, test-scaffolds]
dependency_graph:
  requires: []
  provides: [CLI-build-pipeline, createCliContext, formatTable, formatKeyValue, commander-program, wave0-test-scaffolds]
  affects: [05-02, 05-03, 05-04]
tech_stack:
  added: [commander@^15.0.0]
  patterns: [NodeNext module resolution, import.meta.url migrations resolution, commander parseAsync, formatTable padEnd]
key_files:
  created:
    - tsconfig.json
    - scripts/copy-migrations.mjs
    - src/cli/context.ts
    - src/cli/output.ts
    - src/cli/index.ts
    - src/cli/commands/uninstall.ts
    - src/cli/commands/ping.ts
    - src/cli/commands/search.ts
    - src/cli/commands/list.ts
    - src/cli/commands/show.ts
    - src/cli/commands/forget.ts
    - src/cli/commands/export.ts
    - src/cli/commands/import.ts
    - src/cli/commands/stats.ts
    - tests/helpers/cliTestContext.ts
    - tests/unit/cli/context.spec.ts
    - tests/unit/cli/output.spec.ts
    - tests/unit/cli/stats.spec.ts
    - tests/unit/cli/error-contract.spec.ts
    - tests/integration/cli/install.spec.ts
    - tests/integration/cli/uninstall.spec.ts
    - tests/integration/cli/search.spec.ts
    - tests/integration/cli/data-commands.spec.ts
    - tests/integration/cli/forget.spec.ts
    - tests/integration/cli/export-import.spec.ts
  modified:
    - package.json
    - src/cli/commands/run.ts
    - src/core/embed/deterministicEmbed.ts
    - src/core/api/contracts.ts
    - src/core/injection/formatStartupInjection.ts
decisions:
  - "Resolved deriveProjectId() as basename of process.cwd() — aligns with how Phase 1/2 session captures set project_id from the directory name (Open Q1)"
  - "Used import.meta.url + dirname to resolve migrationsDir package-relative — avoids loading attacker-controlled migrations from invocation directory (T-05-01)"
  - "Placeholder command stubs throw 'not implemented' to allow build/type-checking without blocking Plans 02/03/04"
metrics:
  duration: 15min
  completed: "2026-06-09"
  tasks: 3
  files: 28
---

# Phase 5 Plan 1: CLI Build Pipeline and Foundation Summary

**One-liner:** Commander program, NodeNext build pipeline with migration copy, shared createCliContext() using package-relative migrationsDir, ANSI-free formatTable/formatKeyValue, and Wave 0 test scaffolds across 28 files.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add build/bin pipeline | 6841ef4 | tsconfig.json, scripts/copy-migrations.mjs, package.json (+3 bug fixes) |
| 2 | Create shared CLI context and output formatters | 0086a1d | src/cli/context.ts, src/cli/output.ts, 2 test files |
| 3 | Create commander program shell and Wave 0 test scaffolds | cccb956 | src/cli/index.ts, 9 command stubs, test helper, 8 placeholder spec files |

## Verification Results

- `npm run build` exits 0; dist/cli/index.js has `#!/usr/bin/env node` shebang
- `dist/core/schema/migrations/` contains 4 .sql files after build
- `npm test` exits 0: 102 passed, 29 todo, 0 failures (full suite)
- `src/cli/context.ts` resolves migrationsDir via `import.meta.url`, not `process.cwd()`
- `src/cli/output.ts` contains no ANSI escape codes
- commander registers: run, install, uninstall, ping, search, list, show, forget, export, import, stats

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed missing .js extensions in deterministicEmbed.ts**
- **Found during:** Task 1 (first npm run build attempt)
- **Issue:** TypeScript 6 with NodeNext module resolution requires explicit .js extensions on relative imports; deterministicEmbed.ts imported without extensions
- **Fix:** Added .js extensions to embeddingVersion and textNormalize imports
- **Files modified:** src/core/embed/deterministicEmbed.ts
- **Commit:** 6841ef4

**2. [Rule 1 - Bug] Fixed Zod v4 .default({}) type error in contracts.ts**
- **Found during:** Task 1 (first npm run build attempt)
- **Issue:** TypeScript 6 stricter type checking rejected `.default({})` on handleSessionEndConfigSchema — {} does not satisfy the required output shape
- **Fix:** Changed to `.default(() => handleSessionEndConfigSchema.parse({}))` using function factory form
- **Files modified:** src/core/api/contracts.ts
- **Commit:** 6841ef4

**3. [Rule 1 - Bug] Fixed Map.get() type error in formatStartupInjection.ts**
- **Found during:** Task 1 (first npm run build attempt)
- **Issue:** TypeScript 6 infers KIND_RANK Map key type as literal union; passing a `string` argument to `.get()` fails strict checking
- **Fix:** Added `as (typeof KIND_ORDER)[number]` cast to the kind argument
- **Files modified:** src/core/injection/formatStartupInjection.ts
- **Commit:** 6841ef4

## Known Stubs

The following placeholder files contain `throw new Error("not implemented")` stubs — these are intentional per plan design. Plans 02/03/04 replace each stub body with real implementation:

| File | Stub Function | Implementing Plan |
|------|--------------|-------------------|
| src/cli/commands/uninstall.ts | uninstallCommand | Plan 02 |
| src/cli/commands/ping.ts | pingCommand | Plan 02 |
| src/cli/commands/search.ts | searchCommand | Plan 03 |
| src/cli/commands/list.ts | listCommand | Plan 03 |
| src/cli/commands/show.ts | showCommand | Plan 03 |
| src/cli/commands/forget.ts | forgetCommand | Plan 03 |
| src/cli/commands/export.ts | exportCommand | Plan 04 |
| src/cli/commands/import.ts | importCommand | Plan 04 |
| src/cli/commands/stats.ts | statsCommand | Plan 04 |

These stubs do not affect test suite (green) because the Wave 0 test files use `it.todo()` placeholders that don't invoke the stub actions.

## Threat Flags

None — no new network endpoints or trust boundaries introduced. T-05-01 (migrationsDir resolution) mitigated as planned via import.meta.url. T-05-03 (copy-migrations.mjs) operates only on package-internal paths.

## Self-Check: PASSED

- tsconfig.json: FOUND
- scripts/copy-migrations.mjs: FOUND
- src/cli/context.ts: FOUND
- src/cli/output.ts: FOUND
- src/cli/index.ts: FOUND
- tests/helpers/cliTestContext.ts: FOUND
- All test files: FOUND (10 spec files across tests/unit/cli/ and tests/integration/cli/)
- Commits 6841ef4, 0086a1d, cccb956: FOUND in git log

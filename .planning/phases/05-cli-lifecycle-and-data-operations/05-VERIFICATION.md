---
phase: 05-cli-lifecycle-and-data-operations
verified: 2026-06-09T18:00:00Z
status: gaps_found
score: 4/9 must-haves verified
overrides_applied: 0
gaps:
  - truth: "`sessionmem search \"<query>\"` prints ranked memories as a plain-text table with no ANSI (D-07)"
    status: failed
    reason: "Running the actual built CLI (node dist/cli/index.js search \"x\") throws 'TypeError: Cannot read properties of undefined (reading call)'. Commander passes (query, options, command) to .action(); searchCommand's third parameter `ctx?: CliContext` receives the commander Command object instead of undefined, so `ctx ?? createCliContext()` resolves to the Command object, whose `.service` is undefined."
    artifacts:
      - path: "src/cli/commands/search.ts"
        issue: "ctx parameter collides with commander's injected Command argument; context.service is undefined at runtime"
      - path: "src/cli/index.ts"
        issue: "registers .action(searchCommand) without adapting/stripping the extra commander Command argument"
    missing:
      - "Wrap each command registration in index.ts with an adapter that does NOT forward commander's Command object as ctx, e.g. .action((query, options) => searchCommand(query, options)) or .action((query, options) => searchCommand(query, options, undefined))"
      - "Apply the same fix to list, show, forget, export, import, stats (all commands with an injectable ctx as the last parameter)"
  - truth: "`sessionmem list` prints all project memories as a plain-text table"
    status: failed
    reason: "Same root cause as search — node dist/cli/index.js list throws 'Cannot read properties of undefined (reading call)'"
    artifacts:
      - path: "src/cli/commands/list.ts"
        issue: "ctx parameter receives commander Command object"
    missing:
      - "Same fix as search.ts"
  - truth: "`sessionmem show <id>` prints all fields as plain key: value lines / `sessionmem show <missing-id>` prints error to stderr and exits non-zero (D-03)"
    status: failed
    reason: "node dist/cli/index.js show <id> throws 'Cannot read properties of undefined (reading call)' before reaching the getMemory call or error-handling path"
    artifacts:
      - path: "src/cli/commands/show.ts"
        issue: "ctx parameter receives commander Command object"
    missing:
      - "Same fix as search.ts"
  - truth: "`sessionmem stats` prints memory count, db_size_bytes, and total_content_tokens (CLI-06)"
    status: failed
    reason: "node dist/cli/index.js stats throws 'Cannot read properties of undefined (reading call)'"
    artifacts:
      - path: "src/cli/commands/stats.ts"
        issue: "ctx parameter receives commander Command object"
    missing:
      - "Same fix as search.ts"
  - truth: "`sessionmem forget <id>` dry-run / `--force` deletion (D-09)"
    status: failed
    reason: "node dist/cli/index.js forget <id> throws 'Cannot read properties of undefined (reading call)' at the getMemory preview step, before the dry-run/force branch is reached"
    artifacts:
      - path: "src/cli/commands/forget.ts"
        issue: "ctx parameter (3rd positional) receives commander Command object instead of undefined"
    missing:
      - "Same fix as search.ts — index.ts registration must not pass commander's Command as ctx"
  - truth: "`sessionmem export [path]` writes a JSON array to D-11 default path (D-10/D-11)"
    status: failed
    reason: "node dist/cli/index.js export throws 'Cannot read properties of undefined (reading call)'"
    artifacts:
      - path: "src/cli/commands/export.ts"
        issue: "ctx parameter (2nd positional, since export takes [path]) receives commander Command object"
    missing:
      - "Same fix as search.ts"
---

# Phase 5: CLI Lifecycle and Data Operations Verification Report

**Phase Goal:** Build the CLI lifecycle and data operations layer (CLI-01 through CLI-06): build/bin pipeline, shared CLI context, output formatters, commander program shell with all subcommands, install/uninstall/ping lifecycle commands, read/query commands (search/list/show/stats), and destructive/data-transfer commands (forget/export/import) with safe-by-default gating.
**Verified:** 2026-06-09T18:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npm run build` produces dist/cli/index.js with shebang; migrations copied | VERIFIED | `npm run build` exits 0; `dist/cli/index.js` first line is `#!/usr/bin/env node`; `dist/core/schema/migrations/` contains all 4 .sql files |
| 2 | createCliContext() opens ~/.sessionmem/memories.db, runs migrations via package-relative dir, returns {db, service, projectId, dbPath}, accepts overrides | VERIFIED | `src/cli/context.ts` implements exactly this; `import.meta.url`-derived migrationsDir; overrides object for dbPath/migrationsDir/projectId/db/service; unit test passes |
| 3 | formatTable / formatKeyValue produce ANSI-free plain text | VERIFIED | `src/cli/output.ts` — no `\x1b[` sequences; padEnd-based table with `" | "` separators; ordered snake_case key:value lines |
| 4 | commander program registers run/install/uninstall/ping/search/list/show/forget/export/import/stats; commander dependency present | VERIFIED | `src/cli/index.ts` registers all 11 subcommands via `.command(...)`; `package.json` has `commander: ^15.0.0`, `bin.sessionmem`, `node_modules/commander` present |
| 5 | `sessionmem install` runs DB-init + adapter config, prints ✓/✗ checklist, exits non-zero on failure (D-04/D-05) | VERIFIED | `src/cli/commands/install.ts` implements the 3-step checklist; manually running `node dist/cli/index.js install` prints `✓ DB initialized (...)`, then on adapter-detection failure prints `✗ Generic MCP config update failed` + manual fallback block + exits 1 — checklist/error-path code is correct (no ctx-injection bug here, install does not pass a 3rd-positional ctx) |
| 6 | `sessionmem uninstall` / `--purge` (D-06) | UNCERTAIN (not runtime-tested) | Code in `src/cli/commands/uninstall.ts` is substantive and correctly scoped (purge deletes only memories.db); not affected by the ctx-collision bug since uninstallCommand takes only `(options)`. Integration tests pass. Did not execute against a live adapter to avoid mutating this machine's MCP config. |
| 7 | `sessionmem ping` reports status, exits 0/non-zero (D-13) | VERIFIED | `node dist/cli/index.js ping` → prints status/version/message, exits 0 |
| 8 | `sessionmem search "<query>"` prints ranked table, no ANSI (D-07) | FAILED | `node dist/cli/index.js search "test"` throws `TypeError: Cannot read properties of undefined (reading 'call')` — commander passes the Command instance as the 3rd arg (`ctx`), so `ctx ?? createCliContext()` picks the Command object whose `.service` is undefined |
| 9 | `sessionmem list` prints table (CLI-04 read half) | FAILED | `node dist/cli/index.js list` throws the same TypeError — same root cause (2nd positional `ctx` receives the Command object) |
| 10 | `sessionmem show <id>` / `show <missing-id>` (D-03/D-08) | FAILED | `node dist/cli/index.js show abc` throws the same TypeError before reaching getMemory |
| 11 | `sessionmem stats` prints memories/db_size_bytes/total_content_tokens (CLI-06) | FAILED | `node dist/cli/index.js stats` throws the same TypeError |
| 12 | `sessionmem forget <id>` dry-run default / `--force` (D-09) | FAILED | `node dist/cli/index.js forget abc` throws the same TypeError before the dry-run preview |
| 13 | `sessionmem export [path]` writes JSON array (D-10/D-11) | FAILED | `node dist/cli/index.js export` throws the same TypeError |
| 14 | `sessionmem import <path> [--merge]` skip/merge (D-12), round-trip lossless (CLI-05) | UNCERTAIN | `import.ts` takes `(pathArg, options, ctx?)` — same collision pattern exists (3rd positional `ctx` would receive the Command object), but `node dist/cli/index.js import x.json` failed earlier at `readFileSync` (file not found) before reaching `context.service.call`, so the downstream ctx-collision was not directly observed for import in this run. Given the identical signature pattern as forget/export, this is very likely affected too once a valid file is supplied. |
| 15 | Top-level errors print error.message to stderr and exit non-zero (D-03) | PARTIAL | The catch-all in `index.ts` (`program.parseAsync(...).catch(...)`) does correctly print `err.message` and `process.exit(1)` — this is what surfaces the TypeError message above. The mechanism works for the top-level catch, but the underlying commands never reach their own D-03 envelope-unwrap error paths because they crash earlier on the ctx bug. |

**Score:** 4/9 core must-haves (from PLAN frontmatter, deduplicated against roadmap CLI-01..06) — search/list/show/stats/forget/export all FAILED at runtime; install/ping/build/context/output VERIFIED; uninstall/import UNCERTAIN.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tsconfig.json` | outDir/rootDir, excludes tests | VERIFIED | Present, build succeeds |
| `scripts/copy-migrations.mjs` | copies 4 .sql files to dist | VERIFIED | `npm run build` output: "Copied 4 migration file(s)" |
| `src/cli/context.ts` | createCliContext, package-relative migrations | VERIFIED | Implements exactly per spec |
| `src/cli/output.ts` | formatTable/formatKeyValue, ANSI-free | VERIFIED | Confirmed no `\x1b[`, correct format |
| `src/cli/index.ts` | commander program, all 11 subcommands | VERIFIED (existence) / FAILED (wiring) | All commands registered, but action wiring is broken for 6 of 11 commands due to the extra Command-object argument |
| `tests/helpers/cliTestContext.ts` | createTestCliContext | VERIFIED | Exists, exported, used by all integration tests |
| `src/cli/commands/install.ts` | installCommand, MANUAL_CONFIG_BLOCK, printManualFallback | VERIFIED | All present and exported |
| `src/cli/commands/uninstall.ts` | uninstallCommand, --purge | VERIFIED | Present, scoped to memories.db only |
| `src/cli/commands/ping.ts` | pingCommand | VERIFIED | Runs correctly end-to-end |
| `src/cli/commands/search.ts` | searchCommand | STUB-LIKE AT RUNTIME | Code substantive, but unreachable via CLI due to ctx collision |
| `src/cli/commands/list.ts` | listCommand | STUB-LIKE AT RUNTIME | Same |
| `src/cli/commands/show.ts` | showCommand | STUB-LIKE AT RUNTIME | Same |
| `src/cli/commands/stats.ts` | statsCommand | STUB-LIKE AT RUNTIME | Same |
| `src/cli/commands/forget.ts` | forgetCommand | STUB-LIKE AT RUNTIME | Same |
| `src/cli/commands/export.ts` | exportCommand | STUB-LIKE AT RUNTIME | Same |
| `src/cli/commands/import.ts` | importCommand | LIKELY AFFECTED | Same signature pattern; not conclusively reproduced in this run |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| src/cli/context.ts | src/core/storage/db.ts | openDb({ dbPath, migrationsDir }) | WIRED | Confirmed in code and via direct context test |
| src/cli/context.ts | src/core/api/memoryCoreService.ts | createMemoryCoreService({ db }) | WIRED | Confirmed |
| package.json | dist/cli/index.js | bin field | WIRED | `"sessionmem": "./dist/cli/index.js"` present |
| src/cli/index.ts | src/cli/commands/search.ts (and list/show/forget/export/import/stats) | .action(xCommand) | NOT_WIRED (runtime) | Imports are correct (modules load, build passes), but the **call signature mismatch** between commander's `.action()` callback `(arg1, arg2, command)` and each command function's `(arg1, arg2, ctx?)` means `ctx` is always populated with commander's internal `Command` object instead of `undefined`/a real `CliContext` — so `context.service` is `undefined` and every call throws |
| src/cli/commands/stats.ts | src/core/injection/tokenBudget.ts | countTokens | WIRED (in code, unreachable at runtime via CLI) | — |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| search/list/show/stats/forget/export | `result` from `context.service.call(...)` | `createCliContext().service` | N/A | DISCONNECTED — `context` is the commander `Command` object at runtime, not a `CliContext`; `.service` is `undefined`, so `.call` throws before any data is fetched |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build produces dist + migrations | `npm run build` | exit 0, shebang present, 4 .sql files copied | PASS |
| Full test suite green | `npm test` | 33 files / 135 tests passed, 0 failed, 0 todo | PASS |
| `ping` reports status | `node dist/cli/index.js ping` | `status: ok` / exit 0 | PASS |
| `install` runs checklist | `node dist/cli/index.js install` | `✓ DB initialized (...)`, then `✗ Generic MCP config update failed` + manual fallback (no MCP host on this machine — expected env limitation, not a phase bug) | PASS (checklist logic correct) |
| `search "test"` | `node dist/cli/index.js search "test"` | `TypeError: Cannot read properties of undefined (reading 'call')`, exit 1 | FAIL |
| `list` | `node dist/cli/index.js list` | same TypeError, exit 1 | FAIL |
| `stats` | `node dist/cli/index.js stats` | same TypeError, exit 1 | FAIL |
| `show abc` | `node dist/cli/index.js show abc` | same TypeError, exit 1 | FAIL |
| `forget abc` | `node dist/cli/index.js forget abc` | same TypeError, exit 1 | FAIL |
| `export` | `node dist/cli/index.js export` | same TypeError, exit 1 | FAIL |
| `import x.json` | `node dist/cli/index.js import x.json` | `Failed to read or parse import file: ENOENT...` (fails before reaching ctx bug; not conclusively tested for the same defect) | INCONCLUSIVE |

### Probe Execution

No `scripts/*/tests/probe-*.sh` found in this repo; PLAN/SUMMARY do not declare probes. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CLI-01 | 05-01, 05-02 | install configures local components | SATISFIED | `installCommand` runs DB-init + adapter config + checklist; runtime test confirms checklist path executes correctly |
| CLI-02 | 05-02 | uninstall removes config without deleting DB by default | SATISFIED (code-level); not runtime-executed against a real adapter | `uninstallCommand` correctly gates `--purge`; tests pass; not affected by ctx-collision bug |
| CLI-03 | 05-03 | search returns ranked results | BLOCKED | `searchCommand` throws at runtime via the actual CLI entrypoint due to ctx-collision bug |
| CLI-04 | 05-03, 05-04 | list/show/forget operations | BLOCKED | All three throw at runtime via the actual CLI entrypoint |
| CLI-05 | 05-04 | export/import lossless round-trip | BLOCKED (export confirmed broken; import same signature pattern, not conclusively confirmed) | `exportCommand` throws at runtime |
| CLI-06 | 05-03 | stats: memory count, DB size, token usage | BLOCKED | `statsCommand` throws at runtime |

All 6 requirement IDs (CLI-01 through CLI-06) declared in PLAN frontmatter are accounted for. CLI-01/CLI-02 are satisfied; CLI-03/04/05/06 are blocked by a single shared root-cause bug (commander action-argument / ctx-parameter collision in `src/cli/index.ts`).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/cli/index.ts | 38-90 (all `.action(xCommand)` registrations for search/list/show/forget/export/import/stats) | Action callback signature mismatch — commander always appends its `Command` instance as the final argument, but each command function declares an optional `ctx?: CliContext` as its final parameter, so commander's Command object is misinterpreted as `ctx` | BLOCKER | Renders 6 of 11 subcommands (the entire read/query and destructive/data-transfer surface — CLI-03, CLI-04, CLI-05, CLI-06) non-functional when run as an actual CLI binary, despite passing all unit/integration tests (which call the functions directly with explicit injected contexts, never through commander) |

### Human Verification Required

None — the blocking issue is deterministically reproducible via `node dist/cli/index.js <command>` and does not require human judgment.

### Gaps Summary

All 33 test files / 135 tests pass, `npm run build` succeeds, and the static code for every command (search, list, show, stats, forget, export, import) is substantive and correctly implements the documented D-03/D-07/D-08/D-09/D-10/D-11/D-12 behaviors when called directly with an injected `CliContext`.

However, the phase goal requires a **working CLI**, and `src/cli/index.ts` wires each of these commands to commander's `.action()` using the bare function reference (e.g., `.action(searchCommand)`). Commander invokes action handlers as `(arg1, [arg2, ...], command: Command)` — always appending its own `Command` instance as the final argument. Each command function's signature ends with an optional `ctx?: CliContext` parameter intended for test injection (`ctx ?? createCliContext()`). Because commander always passes a truthy `Command` object in that slot, `ctx ?? createCliContext()` evaluates to the `Command` object — which has no `.service` property — so every one of these commands crashes immediately with `TypeError: Cannot read properties of undefined (reading 'call')` when run as `sessionmem search`, `sessionmem list`, `sessionmem show`, `sessionmem stats`, `sessionmem forget`, and `sessionmem export` (and very likely `sessionmem import` once it gets past file-reading).

This is a single shared root cause across CLI-03, CLI-04, CLI-05, and CLI-06 — the entire read/query and data-transfer command surface that Plans 03 and 04 were responsible for. The fix is localized to `src/cli/index.ts`'s `.action(...)` registrations: wrap each call so commander's injected `Command` argument is not forwarded as `ctx`, e.g.:

```typescript
program.command("search <query>")
  .option("--limit <n>", "Maximum number of results", "10")
  .action((query, options) => searchCommand(query, options));
```

(applied to list, show, forget, export, import, stats as well — each dropping or ignoring the trailing commander-injected argument).

Separately, note (not a blocker, but worth flagging for a future pass): the `--limit <n>` option is defined with a string default `"10"` and commander always returns option values as strings unless a custom parser is supplied; `searchCommand`'s `options.limit ?? 20` would pass that string straight into `retrieveMemories`, whose zod schema requires `z.number().int()`. Once the ctx-collision bug above is fixed, `--limit` may still fail validation because of the string-vs-number mismatch. This should be checked as part of the gap-closure plan.

Install/uninstall/ping/run (CLI-01, CLI-02, plus the `run` MCP-server command) are unaffected because their action signatures do not declare a trailing optional `ctx` parameter that collides with commander's injected `Command` object.

---

_Verified: 2026-06-09T18:00:00Z_
_Verifier: Claude (gsd-verifier)_

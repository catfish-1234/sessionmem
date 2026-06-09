# Phase 5: CLI Lifecycle and Data Operations - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the CLI surface for sessionmem: wire up commander-based subcommand routing, implement install/uninstall lifecycle with health validation, and add all data operation commands (search, list, show, forget, export, import, stats). Every command must have actionable errors and non-zero exit codes on failure.

</domain>

<decisions>
## Implementation Decisions

### CLI Framework
- **D-01:** Use **commander** as the CLI framework. Add it as a dependency.
- **D-02:** Entry point: `src/cli/index.ts` — registered as the `bin` target in `package.json`. All subcommands registered here. Existing `src/cli/commands/run.ts` and `install.ts` refactored to plug into this entry.
- **D-03:** Errors surface as: human-readable message to **stderr** + **non-zero exit code** (`process.exit(1)`). No JSON error objects. Consistent with Unix CLI contract and existing `install.ts` error pattern.

### Install / Uninstall Lifecycle
- **D-04:** `sessionmem install` validates two things after writing adapter configs: (1) DB migrations ran successfully, (2) adapter config file was written. No MCP ping — too fragile.
- **D-05:** Install output format: **step-by-step checklist** with checkmarks per step, e.g.:
  ```
  ✓ DB initialized (~/.sessionmem/memories.db)
  ✓ Claude Code config updated
  ✓ sessionmem ready
  ```
  On partial failure: print `✗ [step that failed]` with actionable instructions.
- **D-06:** `sessionmem uninstall` removes IDE config entries/hooks and leaves the memory DB intact by default. Add `--purge` flag to also delete the DB. Mirrors the `--force` / `--purge` pattern used elsewhere.

### Data Command Output Format
- **D-07:** `sessionmem list` and `sessionmem search "<query>"` output **plain text table**, no ANSI color codes. Columns: `ID | importance | date | preview (first 60 chars)`. Pipeable, grep-friendly.
- **D-08:** `sessionmem show <id>` outputs **all fields as plain text key: value** lines — `id`, `content`, `importance`, `created_at`, `session_id`, `project_id`, `source_adapter`. No JSON, no color.
- **D-09:** `sessionmem forget <id>` is a **dry-run by default**: prints `Would delete: [preview]. Pass --force to confirm.` and exits 0. With `--force` it deletes and confirms. Prevents accidental deletion.

### Export / Import
- **D-10:** Export format: **JSON array** — `[{ id, content, importance, created_at, session_id, project_id, source_adapter, ... }, ...]`. Human-readable, diffable, lossless round-trip.
- **D-11:** Default export filename: `~/.sessionmem/export-{ISO-date}.json`. User may pass an optional path arg to override: `sessionmem export [path]`.
- **D-12:** Import default behavior: **skip duplicate IDs** silently. With `--merge` flag: overwrite existing records with imported data. Print summary on completion: `Imported 42, skipped 3 duplicates.`

### Carried Forward from Phase 4
- **D-13:** `sessionmem ping` command to test manual MCP config (decided in Phase 4 context).
- **D-14:** Auto-config failure prints exact copy-paste JSON block to stdout for manual setup.
- **D-15:** MCP server logs to `~/.sessionmem/logs/mcp.log`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §CLI-01 through CLI-06 — exact CLI requirements this phase delivers
- `.planning/ROADMAP.md` §Phase 5 — success criteria and phase boundary

### Prior Phase Context
- `.planning/phases/4-CONTEXT.md` — Phase 4 install/uninstall decisions that carry forward (D-13, D-14, D-15)

### Existing CLI Code
- `src/cli/commands/run.ts` — existing `sessionmem run` command; refactor to use commander
- `src/cli/commands/install.ts` — existing install command; refactor to use commander + add health check steps
- `src/adapters/factory.ts` — adapter detection factory used by install/uninstall
- `src/adapters/contract/hostAdapterContract.ts` — adapter interface (install/uninstall methods)

### Core Service (data commands wire into these)
- `src/core/api/memoryCoreService.ts` — central service facade for all memory operations
- `src/core/api/contracts.ts` — request/response schemas for core service calls
- `src/core/api/errors.ts` — DomainError + error envelope pattern

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/api/memoryCoreService.ts`: Exposes `list`, `search`, `get`, `delete`, `export`, `import` (or equivalent) operations — data commands wire directly into this service.
- `src/adapters/factory.ts`: `AdapterFactory.detectAdapter()` already used by install.ts — reuse for uninstall and ping commands.
- `src/cli/commands/install.ts`: Has `printManualFallback()` and install logic — refactor, don't rewrite.

### Established Patterns
- **Error handling:** `DomainError` + `{ ok: false, error: { code, message } }` envelope — CLI commands catch these and print to stderr with exit(1).
- **No barrel files:** Direct imports from specific files using `.js` extensions.
- **Logging:** `console.log` for normal output, `console.error` for errors — maintain this pattern.
- **Dependency injection:** Services created via `create*` factories — CLI commands will need to instantiate via factory.

### Integration Points
- New CLI commands call `MemoryCoreService` methods for data operations.
- Install/uninstall delegate to `adapter.install()` / `adapter.uninstall()` on the detected adapter.
- `package.json` needs `bin` field added: `{ "sessionmem": "./dist/cli/index.js" }` (or equivalent compiled output path).

</code_context>

<specifics>
## Specific Ideas

- `sessionmem install` step checklist output mirrors common tool install UX (e.g., Homebrew, npm package post-install).
- `sessionmem forget` dry-run pattern mirrors `--dry-run` convention from tools like `rsync`, `make`.
- Export default path `~/.sessionmem/export-{date}.json` keeps exports co-located with DB for discoverability.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-CLI Lifecycle and Data Operations*
*Context gathered: 2026-06-09*

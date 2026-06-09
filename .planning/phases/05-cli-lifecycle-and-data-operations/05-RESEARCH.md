# Phase 5: CLI Lifecycle and Data Operations - Research

**Researched:** 2026-06-09
**Domain:** Node.js CLI engineering (commander) + SQLite data operations on an existing TypeScript core service
**Confidence:** HIGH (codebase verified, commander API verified, blocking build gap identified)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CLI Framework**
- **D-01:** Use **commander** as the CLI framework. Add it as a dependency.
- **D-02:** Entry point: `src/cli/index.ts` — registered as the `bin` target in `package.json`. All subcommands registered here. Existing `src/cli/commands/run.ts` and `install.ts` refactored to plug into this entry.
- **D-03:** Errors surface as: human-readable message to **stderr** + **non-zero exit code** (`process.exit(1)`). No JSON error objects. Consistent with Unix CLI contract and existing `install.ts` error pattern.

**Install / Uninstall Lifecycle**
- **D-04:** `sessionmem install` validates two things after writing adapter configs: (1) DB migrations ran successfully, (2) adapter config file was written. No MCP ping — too fragile.
- **D-05:** Install output format: **step-by-step checklist** with checkmarks per step:
  ```
  ✓ DB initialized (~/.sessionmem/memories.db)
  ✓ Claude Code config updated
  ✓ sessionmem ready
  ```
  On partial failure: print `✗ [step that failed]` with actionable instructions.
- **D-06:** `sessionmem uninstall` removes IDE config entries/hooks and leaves the memory DB intact by default. Add `--purge` flag to also delete the DB. Mirrors the `--force` / `--purge` pattern used elsewhere.

**Data Command Output Format**
- **D-07:** `sessionmem list` and `sessionmem search "<query>"` output **plain text table**, no ANSI color codes. Columns: `ID | importance | date | preview (first 60 chars)`. Pipeable, grep-friendly.
- **D-08:** `sessionmem show <id>` outputs **all fields as plain text key: value** lines — `id`, `content`, `importance`, `created_at`, `session_id`, `project_id`, `source_adapter`. No JSON, no color.
- **D-09:** `sessionmem forget <id>` is a **dry-run by default**: prints `Would delete: [preview]. Pass --force to confirm.` and exits 0. With `--force` it deletes and confirms. Prevents accidental deletion.

**Export / Import**
- **D-10:** Export format: **JSON array** — `[{ id, content, importance, created_at, session_id, project_id, source_adapter, ... }, ...]`. Human-readable, diffable, lossless round-trip.
- **D-11:** Default export filename: `~/.sessionmem/export-{ISO-date}.json`. User may pass an optional path arg: `sessionmem export [path]`.
- **D-12:** Import default behavior: **skip duplicate IDs** silently. With `--merge` flag: overwrite existing records. Print summary: `Imported 42, skipped 3 duplicates.`

**Carried Forward from Phase 4**
- **D-13:** `sessionmem ping` command to test manual MCP config.
- **D-14:** Auto-config failure prints exact copy-paste JSON block to stdout for manual setup.
- **D-15:** MCP server logs to `~/.sessionmem/logs/mcp.log`.

### Claude's Discretion
None explicitly granted in CONTEXT.md beyond implementation details consistent with the locked decisions above. Areas requiring a decision but not locked (build pipeline, projectId derivation, DB path resolution) are surfaced in **Open Questions** and **Assumptions Log** for planner/user confirmation.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | User can run `sessionmem install` to configure local components | Refactor `src/cli/commands/install.ts` (has `printManualFallback`, delegates to `adapter.install()`). Add DB-init + config-written validation (D-04) and checklist output (D-05). Requires new shared DB-path resolver + migration runner (see Open Questions Q1). |
| CLI-02 | User can run `sessionmem uninstall` to remove config/hooks without deleting DB by default | `adapter.uninstall()` already exists on every adapter (`IDEInstaller.removeMcpConfig`). New `uninstall` command wraps it; `--purge` flag deletes `~/.sessionmem/memories.db`. |
| CLI-03 | User can run `sessionmem search "<query>"` and get ranked results | `memoryCoreService.retrieveMemories({ projectId, query, limit })` already returns ranked `RetrievedMemoryDto[]`. Command formats plain-text table (D-07). |
| CLI-04 | User can run `list`, `show <id>`, `forget` | `listMemories`, `getMemory`, `forgetMemory` all exist on the core service. Command layer adds table (D-07), key:value (D-08), and dry-run gating (D-09). |
| CLI-05 | User can export and import losslessly | `exportMemories` + `importMemories` exist. `importMemories` already uses `ON CONFLICT(id) DO UPDATE` (upsert) — needs `--merge` gating logic (D-12): default = skip existing IDs, `--merge` = overwrite. |
| CLI-06 | User can run `sessionmem stats` | `stats` returns `totalMemories` + `totalSessionEvents`. **Gap:** does NOT return DB size or token metrics. Command must add `fs.statSync(dbPath).size` and `countTokens()` (from `tokenBudget.ts`) aggregation. |
</phase_requirements>

## Summary

The good news dominates: **the entire data layer this phase needs already exists and is tested.** `src/core/api/memoryCoreService.ts` exposes `listMemories`, `retrieveMemories` (ranked search), `getMemory`, `forgetMemory`, `exportMemories`, `importMemories`, and `stats` — each zod-validated, each returning the established `{ ok, ... }` / `{ ok: false, error }` envelope. Every adapter already implements `install()` / `uninstall()` via `IDEInstaller`. This phase is overwhelmingly a **CLI presentation and wiring layer**, not new business logic. Be prescriptive: wire commander subcommands to existing service methods and format output per D-07 through D-12.

Three real gaps must be planned around. **(1) There is no build pipeline.** No `tsconfig.json`, no `dist/`, no build script, and `commander`/`tsx` are not installed. CONTEXT.md's `bin: ./dist/cli/index.js` presumes a compile step that does not exist. Tests run `.ts` directly via vitest, so this gap has been invisible until now. **(2) There is no production DB wiring.** `openDb()` defaults to `:memory:` and `runMigrations` resolves the migrations dir from `process.cwd()` — neither works for a globally-installed CLI that must open `~/.sessionmem/memories.db`. **(3) There is no `projectId` derivation anywhere in the codebase.** Every core method requires `projectId`, but nothing computes it; CLI commands need a deterministic project identity (almost certainly derived from `process.cwd()`).

**Primary recommendation:** Plan three foundational tasks first — (a) build/bin pipeline (`tsconfig.json` + build script + shebang, or a `tsx`-based bin), (b) a shared `src/cli/context.ts` that resolves the DB path (`~/.sessionmem/memories.db`), runs migrations against an absolute migrations dir, derives `projectId` from cwd, and constructs a `MemoryCoreService` — then build the seven commander subcommands on top, each a thin formatter over an existing service call. Do NOT hand-roll arg parsing, table layout edge cases, or a second data layer.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Subcommand routing / arg parsing | CLI (commander) | — | commander owns parsing, help, exit codes (D-01) |
| Install/uninstall config writes | Adapter | CLI | `adapter.install()`/`uninstall()` own file I/O; CLI orchestrates + reports (D-04/D-05) |
| DB path + migration execution | Core/Storage | CLI | `openDb`/`runMigrations` own schema; CLI must pass the real path (currently a gap) |
| projectId derivation | CLI | — | Project identity is a runtime/invocation concern; no host context in a bare CLI |
| Data ops (list/search/show/forget/export/import/stats) | Core/Service | CLI | `memoryCoreService` owns all logic; CLI is a formatter only |
| Output formatting (tables, key:value, JSON) | CLI | — | Presentation is strictly a CLI concern (D-07/D-08/D-10) |
| Token metrics for stats | Core (tokenBudget) | CLI | `countTokens()` exists; CLI aggregates over content (CLI-06 gap) |
| DB file size for stats | CLI | — | `fs.statSync(dbPath).size` — pure filesystem read at CLI tier |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^15.0.0 | CLI framework: subcommands, options, args, help, exit codes | Locked by D-01; the de-facto Node CLI router. `[VERIFIED: npm registry]` latest 15.0.0, published 2026-05-29 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.4.1 (already installed) | Synchronous SQLite access | Already the storage engine; reused via `openDb()` |
| js-tiktoken | ^1.0.21 (already installed) | Token counting for stats | `countTokens()` in `src/core/injection/tokenBudget.ts` — reuse for CLI-06 |
| zod | ^4.4.3 (already installed) | Request validation at service boundary | Already validates every core method; CLI passes plain objects in |
| tsx | ^4.22.4 | Run TypeScript directly as a bin (build-pipeline option B) | Only if the planner chooses the no-compile bin path — see Open Questions Q2 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| commander | yargs / cac / clipanion | Locked by D-01; do not explore. |
| Hand-rolled table | `cli-table3` | D-07 forbids ANSI/color and wants grep-friendly plain text — a fixed-width `padEnd` join is simpler and dependency-free. Do NOT add a table lib. |
| tsc build to `dist/` | `tsx` shebang bin (no compile) | tsc matches CONTEXT.md's `./dist/cli/index.js` literally; tsx avoids a build step but ships TS at runtime. Planner must pick one (Q2). |

**Installation:**
```bash
npm install commander
# If choosing the no-compile bin path (Open Questions Q2):
npm install --save-dev tsx
```

**Version verification:** `npm view commander version` → `15.0.0` (modified 2026-05-29) `[VERIFIED: npm registry]`. `npm view tsx version` → `4.22.4` `[VERIFIED: npm registry]`.

## Package Legitimacy Audit

> slopcheck 0.6.1 installed and run successfully at research time.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| commander | npm | mature (15.x, 28k+ stars) | very high | github.com/tj/commander.js | [OK] | Approved |
| tsx | npm | mature (4.x) | very high | github.com/privatenumber/tsx | [OK] | Approved (only if Q2 chooses no-compile path) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Postinstall check: `npm view commander scripts.postinstall` and `npm view tsx scripts.postinstall` both empty — no postinstall scripts. `[VERIFIED: npm registry]`

## Architecture Patterns

### System Architecture Diagram

```
                         $ sessionmem <subcommand> [args] [--flags]
                                        │
                                        ▼
                         ┌──────────────────────────────┐
                         │  src/cli/index.ts (bin)       │
                         │  commander program            │
                         │  - registers subcommands      │
                         │  - exitOverride / process.exit│
                         └──────────────┬───────────────┘
                                        │ dispatch to action handler
            ┌───────────────────────────┼────────────────────────────────┐
            │                           │                                 │
            ▼                           ▼                                 ▼
   ┌─────────────────┐      ┌────────────────────────┐        ┌────────────────────┐
   │ install/        │      │ data commands:         │        │ ping (D-13)        │
   │ uninstall       │      │ search/list/show/      │        │ run (existing)     │
   │ (CLI-01/02)     │      │ forget/export/import/  │        └────────────────────┘
   └────────┬────────┘      │ stats (CLI-03..06)     │
            │               └───────────┬────────────┘
            │                           │ build once per invocation
            │                           ▼
            │            ┌──────────────────────────────────┐
            │            │ src/cli/context.ts  (NEW)         │
            │            │ - resolve ~/.sessionmem/          │
            │            │ - openDb(memories.db, migDir)     │
            │            │ - derive projectId from cwd       │
            │            │ - createMemoryCoreService({db})   │
            │            └───────────────┬──────────────────┘
            │                            │
            ▼                            ▼
   ┌─────────────────┐      ┌──────────────────────────────────┐
   │ AdapterFactory  │      │ memoryCoreService                │
   │ .detectAdapter()│      │ list/retrieve/get/forget/        │
   │ → adapter       │      │ export/import/stats              │
   │ .install()/     │      │ → { ok, ... } | { ok:false,error}│
   │ .uninstall()    │      └───────────────┬──────────────────┘
   └────────┬────────┘                      │
            ▼                               ▼
   ┌─────────────────┐          ┌──────────────────────────┐
   │ IDEInstaller    │          │ better-sqlite3           │
   │ writes IDE      │          │ ~/.sessionmem/memories.db│
   │ MCP config JSON │          └──────────────────────────┘
   └─────────────────┘
```

### Recommended Project Structure
```
src/cli/
├── index.ts              # NEW: commander program, bin entry, shebang, registers all subcommands
├── context.ts            # NEW: DB path resolve + migrate + projectId + service factory (shared by all data cmds)
├── output.ts             # NEW: plain-text table + key:value formatters (D-07/D-08), no ANSI
└── commands/
    ├── run.ts            # EXISTING: refactor — remove ad-hoc `if (process.argv[2] === "run")` block; export action only
    ├── install.ts        # EXISTING: refactor — add D-04 validation + D-05 checklist, keep printManualFallback
    ├── uninstall.ts      # NEW: adapter.uninstall() + --purge (D-06)
    ├── search.ts         # NEW: retrieveMemories → table (CLI-03)
    ├── list.ts           # NEW: listMemories → table (CLI-04)
    ├── show.ts           # NEW: getMemory → key:value (CLI-04)
    ├── forget.ts         # NEW: dry-run default, --force (CLI-04, D-09)
    ├── export.ts         # NEW: exportMemories → JSON file (CLI-05, D-10/D-11)
    ├── import.ts         # NEW: read JSON → importMemories, --merge (CLI-05, D-12)
    ├── stats.ts          # NEW: stats + DB size + token metrics (CLI-06)
    └── ping.ts           # NEW: pingTool wrapper (D-13)
```

### Pattern 1: commander program with shebang bin + async actions + explicit exit codes
**What:** Single program in `src/cli/index.ts`, each subcommand wired to a thin async action that calls a service method and formats output.
**When to use:** All subcommands.
**Example:**
```typescript
#!/usr/bin/env node
// Source: https://github.com/tj/commander.js (v15) — VERIFIED via WebFetch 2026-06-09
import { Command } from "commander";

const program = new Command();
program.name("sessionmem").version("0.1.0");

program
  .command("show")
  .argument("<id>", "memory id")
  .description("show all fields of one memory")
  .action(async (id: string) => {
    // build context, call service, format — see Pattern 2
  });

// D-03: human-readable error to stderr + non-zero exit. Async actions need parseAsync.
program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

### Pattern 2: Envelope unwrap → format → exit (the universal data-command shape)
**What:** Every data command follows: build context → call service → branch on `result.ok` → format to stdout OR print error to stderr + `process.exit(1)`.
**Example:**
```typescript
// Maps the existing { ok } | { ok:false, error } envelope to the Unix CLI contract (D-03).
const ctx = createCliContext();            // NEW src/cli/context.ts
const result = await ctx.service.getMemory({ projectId: ctx.projectId, memoryId: id });
if (!result.ok) {
  console.error(result.error.message);     // stderr, human-readable, no JSON (D-03/D-08)
  process.exit(1);
}
process.stdout.write(formatKeyValue(result.memory));  // D-08 plain key:value
```

### Pattern 3: Plain-text table without ANSI (D-07)
**What:** Fixed-width columns via `String.padEnd`, joined with ` | `, no color libs.
**Example:**
```typescript
// D-07: ID | importance | date | preview(60). Pipeable, grep-friendly, no ANSI.
function formatRow(m: { id: string; importance: number; createdAt: string; content: string }) {
  const preview = m.content.replace(/\s+/g, " ").slice(0, 60);
  return [m.id.padEnd(20), String(m.importance).padEnd(3), m.createdAt.slice(0, 10), preview].join(" | ");
}
```

### Anti-Patterns to Avoid
- **Per-command DB open without shared context:** Opening the DB and re-deriving projectId in each command file duplicates the `~/.sessionmem` + migration logic and will drift. Centralize in `src/cli/context.ts`.
- **Color/ANSI output:** D-07/D-08 explicitly forbid it. Do not add `chalk`, `cli-table3`, or `picocolors`.
- **JSON error objects to the user:** D-03 forbids. The `{ ok:false, error }` envelope is internal; print only `error.message` to stderr.
- **Re-implementing import dedup logic:** `importMemories` already upserts via `ON CONFLICT(id) DO UPDATE`. For default "skip duplicates" (D-12), filter out existing IDs before calling, or split into insert-only vs merge paths — do not write a parallel SQL path.
- **Leaving `openDb()` at `:memory:`:** Data commands MUST pass the real `~/.sessionmem/memories.db` path or they operate on an empty throwaway DB.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Arg/subcommand/flag parsing | Custom `process.argv` switch | commander (D-01) | Help text, `--flag` parsing, exit codes, variadic args all handled |
| Memory data operations | New SQL queries in CLI | `memoryCoreService.*` | All 7 ops exist, zod-validated, tested |
| Import upsert/dedup | New insert SQL | `importMemories` (has `ON CONFLICT DO UPDATE`) | Lossless round-trip already proven; just gate skip vs merge |
| Token counting | Custom tokenizer | `countTokens()` (tokenBudget.ts) | Already uses js-tiktoken `o200k_base` |
| IDE config file editing | New JSON writer | `IDEInstaller` + `adapter.install()/uninstall()` | JSONC-aware, per-host paths already implemented |
| Migration execution | Inline `CREATE TABLE` | `runMigrations()` | Idempotent, tracked in `_migrations` table |

**Key insight:** This phase has almost no new domain logic. The risk is NOT in the data layer (which is solid and tested) but in the **glue**: DB path resolution, projectId derivation, and the missing build pipeline. Spend planning effort there.

## Runtime State Inventory

> This is a feature-addition phase (new CLI surface), not a rename/migration. Included for completeness because it touches install/uninstall lifecycle and the on-disk DB.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.sessionmem/memories.db` (SQLite) — created/migrated by install (CLI-01); preserved by uninstall unless `--purge` (D-06). | install: ensure exists + migrated. uninstall: leave intact (default) / delete (`--purge`). |
| Live service config | Per-host IDE MCP config files written by adapters: `~/.claude.json`, `~/.codex/config.json`, `~/.cursor/...`, `~/.windsurf/...`, `~/.cline/config.json`, `~/.qcoder/config.json`, `~/.antigravity/config.json`. NOT in git — live in user home. | uninstall removes the `sessionmem` MCP block via `IDEInstaller.removeMcpConfig`. Already implemented per adapter. |
| OS-registered state | None — sessionmem registers no OS-level tasks/services. Verified: no Task Scheduler/launchd/systemd references in `src/`. | None. |
| Secrets/env vars | Adapter detection reads env vars (`CLAUDE_CODE_SESSION`, `CURSOR_APP_VERSION`, etc.) but stores none. No secrets written by CLI commands. | None. |
| Build artifacts | **No `dist/` exists and no build produces one** — yet CONTEXT.md `bin` points at `./dist/cli/index.js`. The bin target will not exist until a build pipeline is added (Open Questions Q2). | Add build step OR retarget bin to a `tsx` runner. Blocking for `sessionmem` being runnable as an installed binary. |

**Log file:** `~/.sessionmem/logs/mcp.log` (D-15) — written by `run.ts`. Not deleted by uninstall (no decision says to); leave as-is unless `--purge` (planner may clarify, see Q3).

## Common Pitfalls

### Pitfall 1: Data commands silently operate on an empty in-memory DB
**What goes wrong:** `openDb()` defaults to `:memory:`. A CLI command that calls it without a path gets a fresh empty DB every run — `list`/`search`/`stats` return zero results, `import` writes to nothing.
**Why it happens:** The DB layer was built for tests (in-memory) and for an MCP server context that hasn't wired a real path yet.
**How to avoid:** `src/cli/context.ts` must call `openDb({ dbPath: join(homedir(), ".sessionmem", "memories.db"), migrationsDir: <absolute path> })`. Ensure `~/.sessionmem/` exists first (`mkdirSync(..., { recursive: true })`).
**Warning signs:** `sessionmem list` returns nothing on a machine that has memories; `stats` shows 0.

### Pitfall 2: Migrations dir resolves from `process.cwd()` and fails for installed binary
**What goes wrong:** `runMigrations` defaults `migrationsDir` to `path.resolve(process.cwd(), "src/core/schema/migrations")`. When `sessionmem` runs from an arbitrary directory (or installed globally), `cwd()` is the user's project, not the package — migrations are not found, tables never created.
**Why it happens:** cwd-relative path assumes you always run from the repo root (true in tests, false for an installed CLI).
**How to avoid:** Resolve the migrations dir relative to the module location (`import.meta.url` → `fileURLToPath` → package-relative path), and pass it explicitly. If using a `dist/` build, migrations `.sql` files must be copied into `dist/` (tsc does NOT copy non-TS assets) or the path must point back at `src/core/schema/migrations`.
**Warning signs:** Fresh install shows "no such table: memories"; `install` reports DB-init success but queries fail.

### Pitfall 3: No projectId means commands can't scope queries
**What goes wrong:** Every core method requires `projectId: string` (zod `.min(1)`). Nothing in the codebase computes it. A command that passes an empty/placeholder string either throws VALIDATION or queries the wrong project's rows.
**Why it happens:** projectId was always supplied by an upstream caller (session capture) that this phase doesn't go through.
**How to avoid:** Decide and centralize a derivation in `context.ts`. Most likely: a stable hash or basename of `process.cwd()` (matches how session capture would identify "this project"). Confirm with the planner/user how Phase 1/2 capture sets `project_id` so CLI scoping matches stored data (Q1).
**Warning signs:** `list` is empty even though memories exist for the project; CLI and MCP server disagree on which memories belong to a project.

### Pitfall 4: `bin` target doesn't exist (no build)
**What goes wrong:** `package.json` `bin: { "sessionmem": "./dist/cli/index.js" }` references a file no build produces. `npm link` / global install yields a broken `sessionmem` command.
**Why it happens:** Project has run entirely through vitest (which executes `.ts`); a runnable binary has never been built.
**How to avoid:** Add a build pipeline (tsc → `dist/` with shebang + chmod) OR retarget bin to a tsx-based runner. See Q2. This must land before any "smoke test the CLI" verification can pass.
**Warning signs:** `command not found` or "Cannot find module dist/cli/index.js" after install.

### Pitfall 5: `forget` dry-run vs `--force` and `import` skip vs `--merge` inverted
**What goes wrong:** Defaulting to destructive behavior. D-09 requires `forget` to be dry-run unless `--force`; D-12 requires `import` to skip duplicates unless `--merge`.
**Why it happens:** The underlying service methods are unconditional (`forgetMemory` always deletes; `importMemories` always upserts). The safe-by-default gating lives in the CLI layer.
**How to avoid:** In `forget`: without `--force`, fetch the memory, print `Would delete: [preview]. Pass --force to confirm.`, exit 0; do NOT call `forgetMemory`. In `import`: without `--merge`, pre-filter imported records whose IDs already exist (query existing IDs) so the upsert can't overwrite; report `Imported N, skipped M duplicates.`
**Warning signs:** Bare `forget <id>` actually deletes; bare `import` overwrites existing records.

## Code Examples

### CLI context (the missing glue — referenced by every data command)
```typescript
// Source: composed from existing src/core/storage/db.ts + memoryCoreService.ts (VERIFIED in codebase)
import { homedir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import { openDb } from "../core/storage/db.js";
import { createMemoryCoreService } from "../core/api/memoryCoreService.js";

export function createCliContext() {
  const dir = join(homedir(), ".sessionmem");
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "memories.db");
  // package-relative migrations dir (NOT cwd-relative) — fixes Pitfall 2
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "core", "schema", "migrations");
  const db = openDb({ dbPath, migrationsDir });
  const service = createMemoryCoreService({ db });
  const projectId = deriveProjectId(); // Open Question Q1 — confirm derivation rule
  return { db, service, projectId, dbPath };
}
```

### stats: count + DB size + token metrics (CLI-06 gap fill)
```typescript
// Source: stats() exists but lacks size/tokens — VERIFIED memoryCoreService.ts:382
import { statSync } from "fs";
import { countTokens } from "../core/injection/tokenBudget.js"; // VERIFIED tokenBudget.ts:19
import { listMemoriesByProject } from "../core/storage/memoryRepo.js"; // VERIFIED memoryRepo.ts:75

const stats = await ctx.service.stats({ projectId: ctx.projectId });
if (!stats.ok) { console.error(stats.error.message); process.exit(1); }
const sizeBytes = statSync(ctx.dbPath).size;
const totalTokens = listMemoriesByProject(ctx.db, ctx.projectId)
  .reduce((sum, m) => sum + countTokens(m.content), 0);
process.stdout.write(
  `memories: ${stats.totalMemories}\n` +
  `db_size_bytes: ${sizeBytes}\n` +
  `total_content_tokens: ${totalTokens}\n`,
);
```

### export to default ISO-dated path (D-10/D-11)
```typescript
// Source: exportMemories() VERIFIED memoryCoreService.ts:319
import { writeFileSync } from "fs";
const res = await ctx.service.exportMemories({ projectId: ctx.projectId });
if (!res.ok) { console.error(res.error.message); process.exit(1); }
const outPath = pathArg ?? join(homedir(), ".sessionmem", `export-${new Date().toISOString().slice(0,10)}.json`);
writeFileSync(outPath, JSON.stringify(res.memories, null, 2), "utf8"); // JSON array, diffable
console.log(`Exported ${res.memories.length} memories to ${outPath}`);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad-hoc `if (process.argv[2] === "run")` in `run.ts` | Single commander program in `index.ts` | This phase (D-02) | Remove the inline block from `run.ts`; export an action the program registers |
| commander callback `.action((cmd) => ...)` legacy signature | `(arg, options, command)` positional signature + `parseAsync` for async | commander v7+ (stable in v15) | Use `await program.parseAsync()` since all data actions are async |

**Deprecated/outdated:**
- The inline execution guard at the bottom of `run.ts` (`if (process.argv[2] === "run")`) — superseded by commander routing (D-02). Refactor, keep the `runMcpServer` body.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `projectId` should be derived from `process.cwd()` (hash or basename) to match how session capture identifies a project | Pitfalls P3, Open Q1 | HIGH — if derivation differs from Phase 1/2's `project_id`, CLI sees zero/ wrong memories. Must confirm against capture code before locking. |
| A2 | Build pipeline = `tsc` → `dist/` (matching CONTEXT.md `./dist/cli/index.js`), with shebang + asset copy of `.sql` migrations | Stack, Open Q2, Pitfall 4 | MEDIUM — alternative is a `tsx` bin (no compile). Either works; picking wrong one wastes rework. User/planner should choose. |
| A3 | `--purge` deletes `memories.db` but leaves `~/.sessionmem/logs/mcp.log` | Runtime State, Open Q3 | LOW — log retention on purge is unspecified; minor UX detail. |
| A4 | Default `import` "skip duplicates" is implemented by pre-filtering existing IDs (not by a new SQL path) | Pitfall 5, Don't Hand-Roll | LOW — behavior is locked (D-12); only the implementation tactic is assumed. |
| A5 | `search` limit defaults to the service default (20) unless a `--limit` flag is added | CLI-03 | LOW — D-07 doesn't mention a limit flag; planner may add `--limit` for parity with `retrieveMemories` schema. |

## Open Questions

1. **How is `project_id` set by session capture (Phase 1/2), so the CLI derives a matching `projectId`?**
   - What we know: every core method requires `projectId`; CLI must scope to "the current project"; capture writes `project_id` into the `memories` table.
   - What's unclear: the exact derivation rule capture uses (cwd basename? git remote? hash?). Nothing in `src/` computes it — it's supplied by upstream callers not in this phase's scope.
   - Recommendation: Before locking, grep how `project_id` flows into `ingestSessionEvents`/`storeMemory` callers (likely an MCP-host-supplied value). If hosts supply it from their workspace path, the CLI should derive the same from `process.cwd()`. Surface to user if ambiguous. Consider an optional `--project <id>` override flag as a safety valve.

2. **Build pipeline: compile to `dist/` (tsc) or run TS directly (tsx bin)?**
   - What we know: no `tsconfig.json`, no build script, no `dist/`; `bin` in CONTEXT.md = `./dist/cli/index.js`; tests run `.ts` via vitest.
   - What's unclear: whether the project wants a compiled artifact (npm-publish-ready, QLTY-05) or a zero-build dev bin now.
   - Recommendation: Given QLTY-05 (publish npm package) is a later phase, a `tsc` build to `dist/` aligns better long-term and matches the literal `bin` path. If chosen, add a step to copy `src/core/schema/migrations/*.sql` into `dist/` (tsc ignores non-TS files) and add a shebang + executable bit. Flag this as a foundational task that must precede CLI smoke tests.

3. **Does `--purge` also delete the log file and the `~/.sessionmem` dir?**
   - What we know: D-06 says `--purge` deletes the DB. D-15 puts logs at `~/.sessionmem/logs/mcp.log`.
   - What's unclear: whether purge means "delete DB only" or "remove the whole `~/.sessionmem` footprint."
   - Recommendation: Default to deleting only `memories.db` (least surprising, matches D-06 wording). Confirm with user if full-footprint removal is desired.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | ✓ (runtime present) | — | — |
| npm | Installing commander/tsx | ✓ | — | — |
| better-sqlite3 | DB ops | ✓ (installed) | 12.4.1 | — |
| js-tiktoken | stats tokens | ✓ (installed) | 1.0.21 | — |
| zod | validation | ✓ (installed) | 4.4.3 | — |
| commander | CLI (D-01) | ✗ (not installed) | — | none — must `npm install commander` |
| tsx | no-compile bin (Q2 option) | ✗ (not installed) | — | tsc build to dist/ instead |
| tsc | compile build (Q2 option) | ✓ (in node_modules/.bin) | (typescript ^6.0.3) | tsx instead |

**Missing dependencies with no fallback:**
- `commander` — required by D-01; install before any CLI task.

**Missing dependencies with fallback:**
- `tsx` — only needed if Q2 chooses the no-compile bin path; otherwise use the already-present `tsc`.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.8 |
| Config file | none detected — vitest runs with defaults; tests live under `tests/` |
| Quick run command | `npx vitest run <path> --reporter=dot` |
| Full suite command | `npm test` (`vitest run --reporter=dot`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | install runs migrations + writes config + checklist; partial-failure shows ✗ | integration | `npx vitest run tests/integration/cli/install.spec.ts -x` | ❌ Wave 0 |
| CLI-02 | uninstall removes config; DB intact by default; `--purge` deletes DB | integration | `npx vitest run tests/integration/cli/uninstall.spec.ts -x` | ❌ Wave 0 |
| CLI-03 | search returns ranked rows in plain table (no ANSI) | integration | `npx vitest run tests/integration/cli/search.spec.ts -x` | ❌ Wave 0 |
| CLI-04 | list table, show key:value, forget dry-run vs --force | integration | `npx vitest run tests/integration/cli/data-commands.spec.ts -x` | ❌ Wave 0 |
| CLI-05 | export→file then import round-trips losslessly; --merge vs skip | integration | `npx vitest run tests/integration/cli/export-import.spec.ts -x` | ❌ Wave 0 |
| CLI-06 | stats reports count + db_size_bytes + token total | unit | `npx vitest run tests/unit/cli/stats.spec.ts -x` | ❌ Wave 0 |
| D-03 | failures print message to stderr + exit code 1 | unit | `npx vitest run tests/unit/cli/error-contract.spec.ts -x` | ❌ Wave 0 |

**Test tactic note:** Prefer testing command action functions directly (export each action from its command module and call it with a temp `:memory:` or temp-file DB + injected context) over spawning the bin — faster, no build dependency, mirrors existing `run-command.spec.ts` style. Reserve one install/smoke test that exercises the real DB-path + migration wiring.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/<area> --reporter=dot`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/cli/` directory + per-command specs (install, uninstall, search, data-commands, export-import)
- [ ] `tests/unit/cli/stats.spec.ts`, `tests/unit/cli/error-contract.spec.ts`
- [ ] Shared test helper: build a `MemoryCoreService` over a temp-file DB seeded with memories (mirror `memory-core-service.spec.ts` setup)
- [ ] Decide testability seam: command actions must accept an injectable context (so tests pass a temp DB instead of `~/.sessionmem`)
- [ ] Dependency install: `npm install commander` before CLI tests can import the program

## Security Domain

> security_enforcement not set to false in config → included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local single-user CLI; no auth surface |
| V3 Session Management | no | No sessions in CLI context |
| V4 Access Control | partial | OS filesystem perms on `~/.sessionmem/`; CLI runs as invoking user only |
| V5 Input Validation | yes | zod schemas at the service boundary already validate every request; `import` JSON validated via `importMemoryRecordSchema` |
| V6 Cryptography | no | No crypto in this phase (encryption-at-rest is v2 SECU-05) |
| V12 Files & Resources | yes | export/import read/write user-supplied paths; resolve and avoid path traversal surprises |

### Known Threat Patterns for {Node CLI + SQLite}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection | Tampering | Already mitigated — all queries use better-sqlite3 prepared statements with bound params (verified in memoryRepo/memoryCoreService). Maintain this; never string-concat SQL. |
| Malicious import JSON (oversized/malformed) | Tampering/DoS | Validate every record through `importMemoryRecordSchema` (already in `importMemories`); reject the file with a clear stderr message + exit 1 on parse failure. |
| Path traversal via `export [path]` / `import <path>` | Tampering | Resolve user paths with `path.resolve`; write/read only what the user explicitly passes; do not interpolate into shell. |
| Accidental destructive ops | Tampering | D-09 dry-run-by-default for `forget`; D-06 DB-preserving uninstall — both are security-relevant safe defaults. |
| Secret leakage in exports | Info Disclosure | Export is plaintext JSON of stored content. Note for docs (QLTY-03): exported memories may contain whatever was summarized. Redaction is SECU-02 (Phase 6), out of scope here. |

## Sources

### Primary (HIGH confidence)
- Codebase (verified by direct Read): `src/core/api/memoryCoreService.ts`, `contracts.ts`, `errors.ts`, `src/core/storage/db.ts`, `runMigrations.ts`, `memoryRepo.ts`, `src/adapters/factory.ts`, `contract/hostAdapterContract.ts`, `ide/installer.ts`, `global/claudeCode.ts`, `cli/commands/install.ts`, `cli/commands/run.ts`, `tokenBudget.ts`, `package.json`, migrations `001`–`004`.
- commander.js v15 Readme (WebFetch 2026-06-09): https://github.com/tj/commander.js — API for `Command`, `.command/.argument/.option/.requiredOption`, action signature, `parseAsync`, `program.error`, `exitOverride`, shebang bin.
- npm registry (`npm view`): commander 15.0.0 (2026-05-29), tsx 4.22.4.

### Secondary (MEDIUM confidence)
- slopcheck 0.6.1 scan: commander [OK], tsx [OK]; no postinstall scripts.

### Tertiary (LOW confidence)
- None — no unverified web claims relied upon.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — commander locked + version verified; all data libs already installed and in use.
- Architecture: HIGH — all data methods exist and are tested; CLI is a thin formatter layer.
- Pitfalls: HIGH — the DB-path, migrations-dir, projectId, and build gaps were all confirmed by reading the actual source, not inferred.
- Open questions: MEDIUM — projectId derivation and build-pipeline choice need a planner/user decision before execution.

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 (stable stack; commander API mature)

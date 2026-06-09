# Phase 5: CLI Lifecycle and Data Operations - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 16 (3 new infra + 7 new data commands + uninstall + ping + install/run refactor + 1 config + tests)
**Analogs found:** 13 / 16 (2 no-analog new files, 1 config file)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/index.ts` (NEW) | route | request-response | `src/cli/commands/run.ts` (exec guard) | role-match |
| `src/cli/context.ts` (NEW) | provider/config | transform | `src/core/storage/db.ts` + `memoryCoreService.ts` ctor | role-match |
| `src/cli/output.ts` (NEW) | utility | transform | none (pure formatter) | no analog |
| `src/cli/commands/install.ts` (MODIFY) | command | request-response | itself (`installCommand`) | exact (refactor) |
| `src/cli/commands/run.ts` (MODIFY) | command | event-driven | itself (`runMcpServer`) | exact (refactor) |
| `src/cli/commands/uninstall.ts` (NEW) | command | request-response | `src/cli/commands/install.ts` | exact |
| `src/cli/commands/search.ts` (NEW) | command | request-response (CRUD-read) | `memoryCoreService.retrieveMemories` caller | role-match |
| `src/cli/commands/list.ts` (NEW) | command | CRUD-read | `memoryCoreService.listMemories` caller | role-match |
| `src/cli/commands/show.ts` (NEW) | command | CRUD-read | `memoryCoreService.getMemory` caller | role-match |
| `src/cli/commands/forget.ts` (NEW) | command | CRUD-delete | `memoryCoreService.forgetMemory` caller | role-match |
| `src/cli/commands/export.ts` (NEW) | command | file-I/O | `memoryCoreService.exportMemories` caller | role-match |
| `src/cli/commands/import.ts` (NEW) | command | file-I/O | `memoryCoreService.importMemories` caller | role-match |
| `src/cli/commands/stats.ts` (NEW) | command | CRUD-read + transform | `memoryCoreService.stats` caller | role-match |
| `src/cli/commands/ping.ts` (NEW) | command | request-response | `src/adapters/tools/ping.ts` | role-match |
| `package.json` (MODIFY) | config | — | itself | exact |
| `tests/integration/cli/*.spec.ts` + `tests/unit/cli/*.spec.ts` (NEW) | test | — | `tests/integration/core/memory-core-service.spec.ts`, `tests/unit/adapters/run-command.spec.ts` | role-match |

## Pattern Assignments

### `src/cli/index.ts` (route, commander program)

**Analog:** `src/cli/commands/run.ts` (the existing `if (process.argv[2] === "run")` exec guard to be removed)

**No existing commander program exists** — this file is built from RESEARCH.md Pattern 1, but it must follow project conventions verified in the codebase:
- `.js` import extensions (no barrel files) — confirmed in every file read.
- `console.error` to stderr + `process.exit(1)` on failure — confirmed in `run.ts:22-24` and `install.ts:17`.

**Existing exec-guard pattern to REPLACE** (`src/cli/commands/run.ts:29-34`):
```typescript
// Simple execution block for the CLI entry point
if (process.argv[2] === "run") {
  runMcpServer().catch((err) => {
    console.error("Fatal error running MCP server:", err);
    process.exit(1);
  });
}
```

**Target shape** (commander program; shebang + `parseAsync` + top-level error→stderr→exit(1) per D-03):
```typescript
#!/usr/bin/env node
import { Command } from "commander";
import { runMcpServer } from "./commands/run.js";
import { installCommand } from "./commands/install.js";
// ...register each subcommand's exported action

const program = new Command();
program.name("sessionmem").version("0.1.0");
// program.command("run").action(runMcpServer); etc.

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

---

### `src/cli/context.ts` (provider, transform — the shared glue)

**Analog:** `src/core/storage/db.ts` (DB open) + `src/core/api/memoryCoreService.ts:150-158` (service construction)

**DB open pattern to reuse** (`src/core/storage/db.ts:10-15`) — note it defaults to `:memory:` and migrationsDir to cwd, so context MUST pass both explicitly (Pitfall 1 & 2):
```typescript
export function openDb(options: OpenDbOptions = {}): Database {
  const db = new BetterSqlite3(options.dbPath ?? ":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, options.migrationsDir);
  return db;
}
```

**Service factory signature to call** (`src/core/api/memoryCoreService.ts:63-67, 150`):
```typescript
export interface CreateMemoryCoreServiceDeps {
  db: Database;
  embeddingDimension?: number;
  policyConfig?: LocalOnlyPolicyConfig;
}
export function createMemoryCoreService(deps: CreateMemoryCoreServiceDeps) { ... }
```

**Target shape** (from RESEARCH.md, composed from the above — package-relative migrationsDir via `import.meta.url` fixes Pitfall 2; `mkdirSync(dir, {recursive:true})` fixes Pitfall 1; `deriveProjectId()` is Open Q1):
```typescript
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
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(here, "..", "core", "schema", "migrations");
  const db = openDb({ dbPath, migrationsDir });
  const service = createMemoryCoreService({ db });
  const projectId = deriveProjectId(); // Open Q1 — confirm rule
  return { db, service, projectId, dbPath };
}
```
**Testability seam (from RESEARCH Wave 0):** command actions must accept an injectable context so tests can pass a temp/`:memory:` DB instead of `~/.sessionmem`.

---

### `src/cli/output.ts` (utility, transform — NO ANALOG)

No formatter exists in the codebase. Build from RESEARCH.md Pattern 3. Constraints enforced by D-07/D-08: fixed-width `padEnd` columns joined with ` | `, no ANSI/color libs. See "No Analog Found" section.

---

### `src/cli/commands/install.ts` (command, request-response — REFACTOR)

**Analog:** itself — keep `printManualFallback`, add D-04 validation + D-05 checklist.

**Existing structure to preserve** (`src/cli/commands/install.ts:16-37`):
```typescript
function printManualFallback(adapterName: string): void {
  console.error(
    `Auto-config for ${adapterName} failed. Add this block to your MCP config manually:`,
  );
  console.log(MANUAL_CONFIG_BLOCK);
}

export async function installCommand(): Promise<void> {
  const adapter = AdapterFactory.detectAdapter();
  if (!adapter.install) {
    printManualFallback(adapter.name);
    return;
  }
  const success = await adapter.install();
  if (!success) {
    printManualFallback(adapter.name);
  } else {
    console.log(`sessionmem installed for ${adapter.name}.`);
  }
}
```
**Changes:** add (1) DB-init/migration validation + (2) config-written check (D-04); replace the single success log with a step checklist (D-05) — `✓`/`✗` per step. Keep `MANUAL_CONFIG_BLOCK` (D-14) and `AdapterFactory.detectAdapter()`.

---

### `src/cli/commands/run.ts` (command, event-driven — REFACTOR)

**Analog:** itself — keep the `runMcpServer` body, remove the inline exec guard (moves to `index.ts`).

**Body to KEEP** (`src/cli/commands/run.ts:6-26`): `AdapterFactory.detectAdapter()`, log-append to `~/.sessionmem/logs/mcp.log` (D-15), `adapter.startMcpServer()`, and the `process.exit(1)` on missing capability.
**Lines to DELETE** (`src/cli/commands/run.ts:29-34`): the `if (process.argv[2] === "run")` block — superseded by commander routing.

---

### `src/cli/commands/uninstall.ts` (command, request-response — NEW)

**Analog:** `src/cli/commands/install.ts` (mirror structure) + `src/adapters/global/claudeCode.ts:22-25` (uninstall delegate)

**Adapter uninstall delegate to call** (`src/adapters/global/claudeCode.ts:22-25`, identical shape across all adapters):
```typescript
async uninstall(): Promise<boolean> {
  const configPath = join(homedir(), ".claude.json");
  return IDEInstaller.removeMcpConfig(configPath, "sessionmem");
}
```

**Target shape:** mirror `installCommand` — `AdapterFactory.detectAdapter()`, guard `if (!adapter.uninstall)`, call `await adapter.uninstall()`. Add `--purge` flag (D-06): if set, also delete `~/.sessionmem/memories.db` via `rmSync`/`unlinkSync`. Default leaves DB intact. Per Open Q3, delete only `memories.db`, not logs.

---

### `src/cli/commands/search.ts` (command, request-response — NEW)

**Analog:** `memoryCoreService.retrieveMemories` (`src/core/api/memoryCoreService.ts:244-260`)

**Service method to call** (returns ranked `RetrievedMemoryDto[]`):
```typescript
async retrieveMemories(request) {
  const parsed = parseRequest(retrieveMemoriesRequestSchema, request);
  // ...
  return { ok: true, memories: ranked.map(toRetrievedMemoryDto), total: ranked.length };
}
```
**Request schema** (`contracts.ts:77-83`): `{ projectId, query, limit=20, mode, depth }`. CLI passes `{ projectId: ctx.projectId, query, limit }`. Per A5, `--limit` flag is optional.
**Flow:** unwrap envelope → `formatTable(result.memories)` from `output.ts` (D-07). Use the universal envelope-unwrap pattern (Shared Patterns below).

---

### `src/cli/commands/list.ts` (command, CRUD-read — NEW)

**Analog:** `memoryCoreService.listMemories` (`src/core/api/memoryCoreService.ts:279-288`)
```typescript
async listMemories(request) {
  const parsed = parseRequest(listMemoriesRequestSchema, request);
  const memories = listMemoriesByProject(db, parsed.projectId);
  return { ok: true, memories: memories.map(toMemoryDto), total: memories.length };
}
```
**Request schema** (`contracts.ts:92-94`): `{ projectId }`. **Flow:** unwrap → `formatTable` (D-07: `ID | importance | date | preview(60)`).

---

### `src/cli/commands/show.ts` (command, CRUD-read — NEW)

**Analog:** `memoryCoreService.getMemory` (`src/core/api/memoryCoreService.ts:290-302`)
```typescript
async getMemory(request) {
  const parsed = parseRequest(getMemoryRequestSchema, request);
  const memory = getMemoryById(db, parsed.projectId, parsed.memoryId);
  if (!memory) {
    throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
  }
  return { ok: true, memory: toMemoryDto(memory) };
}
```
**Request schema** (`contracts.ts:96-99`): `{ projectId, memoryId }`. **Flow:** unwrap (NOT_FOUND → `error.message` to stderr + exit 1) → `formatKeyValue(result.memory)` (D-08: `id`, `content`, `importance`, `created_at`, `session_id`, `project_id`, `source_adapter` as `key: value` lines). MemoryDto field names (camelCase) are in `memoryCoreService.ts:73-89` — map to snake_case labels per D-08.

---

### `src/cli/commands/forget.ts` (command, CRUD-delete — NEW)

**Analog:** `memoryCoreService.forgetMemory` (`src/core/api/memoryCoreService.ts:304-317`) + `getMemory` (for dry-run preview)
```typescript
async forgetMemory(request) {
  const parsed = parseRequest(forgetMemoryRequestSchema, request);
  const result = db.prepare("DELETE FROM memories WHERE project_id = ? AND id = ?")
    .run(parsed.projectId, parsed.memoryId);
  if (result.changes === 0) {
    throw new DomainError("NOT_FOUND", `Memory not found: ${parsed.memoryId}`);
  }
  return { ok: true };
}
```
**D-09 dry-run gating (CLI layer, Pitfall 5):** WITHOUT `--force`, call `getMemory` to fetch, print `Would delete: [preview]. Pass --force to confirm.`, exit 0 — do NOT call `forgetMemory`. WITH `--force`, call `forgetMemory`, confirm deletion.

---

### `src/cli/commands/export.ts` (command, file-I/O — NEW)

**Analog:** `memoryCoreService.exportMemories` (`src/core/api/memoryCoreService.ts:319-327`)
```typescript
async exportMemories(request) {
  const parsed = parseRequest(exportMemoriesRequestSchema, request);
  const memories = listMemoriesByProject(db, parsed.projectId);
  return { ok: true, memories: memories.map(toMemoryDto) };
}
```
**Target shape** (RESEARCH.md; D-10 JSON array, D-11 default ISO-dated path):
```typescript
import { writeFileSync } from "fs";
const res = await ctx.service.exportMemories({ projectId: ctx.projectId });
if (!res.ok) { console.error(res.error.message); process.exit(1); }
const outPath = pathArg ?? join(homedir(), ".sessionmem", `export-${new Date().toISOString().slice(0,10)}.json`);
writeFileSync(outPath, JSON.stringify(res.memories, null, 2), "utf8");
console.log(`Exported ${res.memories.length} memories to ${outPath}`);
```
**Security (V12):** resolve `pathArg` via `path.resolve`; write only the explicit user path.

---

### `src/cli/commands/import.ts` (command, file-I/O — NEW)

**Analog:** `memoryCoreService.importMemories` (`src/core/api/memoryCoreService.ts:329-380`) — already upserts via `ON CONFLICT(id) DO UPDATE`.

**Import record schema** (`contracts.ts:110-125`) — the shape the JSON file must match:
```typescript
export const importMemoryRecordSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  sourceAdapter: z.string().min(1),
  kind: z.string().min(1),
  content: z.string().min(1),
  importance: z.number().int().min(1).max(10),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
});
export const importMemoriesRequestSchema = z.object({
  projectId: z.string().min(1),
  memories: z.array(importMemoryRecordSchema),
});
```
**D-12 gating (CLI layer, Pitfall 5):** read+parse JSON → DEFAULT (no `--merge`): pre-filter records whose IDs already exist (query existing IDs) so the upsert can't overwrite → call `importMemories` with the filtered set. WITH `--merge`: pass all (upsert overwrites). Print `Imported N, skipped M duplicates.` Do NOT write a parallel SQL path. On parse/validation failure → `error.message` to stderr + exit 1 (Security: malicious import JSON).

---

### `src/cli/commands/stats.ts` (command, CRUD-read + transform — NEW)

**Analog:** `memoryCoreService.stats` (`src/core/api/memoryCoreService.ts:382-396`) — returns count only; CLI-06 adds size + tokens.
```typescript
async stats(request) {
  const parsed = parseRequest(statsRequestSchema, request);
  // ... COUNT(*) memories + session_events
  return { ok: true, totalMemories: memoryCount.count, totalSessionEvents: sessionEventCount.count };
}
```
**Gap-fill** (RESEARCH.md; CLI-06): add `fs.statSync(ctx.dbPath).size` and token aggregation via `countTokens` (`src/core/injection/tokenBudget.ts:19`):
```typescript
import { statSync } from "fs";
import { countTokens } from "../core/injection/tokenBudget.js";
import { listMemoriesByProject } from "../core/storage/memoryRepo.js";

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

---

### `src/cli/commands/ping.ts` (command, request-response — NEW)

**Analog:** `src/adapters/tools/ping.ts:1-15`
```typescript
export const pingTool = {
  name: "sessionmem_ping",
  // ...
  execute: async () => ({ status: "ok", version: "0.1.0", message: "sessionmem MCP server is operational." }),
};
```
**Target (D-13):** thin command wrapping `pingTool.execute()` (or testing manual MCP config). Print result; exit 0 on ok, exit 1 on failure.

---

### `package.json` (config — MODIFY)

**Current** (`package.json:10-14`): deps are `better-sqlite3`, `js-tiktoken`, `zod`. **Changes:** add `"commander": "^15.0.0"` to dependencies; add `"bin": { "sessionmem": "./dist/cli/index.js" }` (or tsx-based target per Open Q2); add a `build` script if the `tsc → dist/` path is chosen (must also copy `src/core/schema/migrations/*.sql` into `dist/` — tsc ignores non-TS assets, Pitfall 2/4).

---

### `tests/integration/cli/*.spec.ts` + `tests/unit/cli/*.spec.ts` (test — NEW)

**Analogs:**
- DB-seeded service setup → `tests/integration/core/memory-core-service.spec.ts:36-65` (`openDb()` + `createMemoryCoreService({ db })` + `storeMemory` to seed).
- Command/error-contract style → `tests/unit/adapters/run-command.spec.ts:16-21, 39-49` (`vi.spyOn(console, ...)`, asserting `{ ok: false, error: { code } }`).

**Seeding pattern** (`memory-core-service.spec.ts:37-65`):
```typescript
const db = openDb();
const service = createMemoryCoreService({ db });
await service.storeMemory({ memoryId: "mem-1", projectId: "project-1", sessionId: "session-1",
  sourceAdapter: "codex", kind: "fact", content: "...", importance: 8 });
```
**Console-spy + envelope assertion** (`run-command.spec.ts:16-21, 45-48`):
```typescript
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
// ...
expect(result).toHaveProperty("ok", false);
expect((result as { ok: false; error: { code: string } }).error.code).toBe("INTERNAL");
```
**Test tactic (RESEARCH):** call exported command actions directly with an injected temp-DB context; reserve one install smoke test for real DB-path + migration wiring. Run with `npx vitest run tests/<area> --reporter=dot`. `vi.restoreAllMocks()` in `afterEach` (run-command.spec.ts:7-9).

---

## Shared Patterns

### Error Contract (D-03) — Envelope Unwrap → stderr → exit(1)
**Source:** `src/core/api/errors.ts:13-45` (DomainError + envelope) + `src/cli/commands/install.ts:17` (`console.error`) + `src/cli/commands/run.ts:22-24` (`process.exit(1)`)
**Apply to:** EVERY data command (search, list, show, forget, export, import, stats, ping)
```typescript
const result = await ctx.service.someMethod({ projectId: ctx.projectId, ... });
if (!result.ok) {
  console.error(result.error.message); // human-readable, NO JSON (D-03)
  process.exit(1);
}
// format result.* to stdout
```
The `{ ok: false, error: { code, message } }` envelope is INTERNAL — print only `error.message`, never the JSON object.

### Adapter Detection
**Source:** `src/adapters/factory.ts:17` — `AdapterFactory.detectAdapter()`
**Apply to:** `install.ts`, `uninstall.ts`, `run.ts`, `ping.ts`
Returns a `HostAdapterContract` with optional `install?()`, `uninstall?()`, `startMcpServer?()` (`hostAdapterContract.ts:18-28`). Always guard the optional method before calling.

### Import Conventions
**Source:** every file read — relative imports with explicit `.js` extension, NO barrel files.
**Apply to:** all new CLI files. Example: `import { openDb } from "../core/storage/db.js";`

### Output Conventions
**Source:** `run.ts` / `install.ts` — `console.log` for normal output, `console.error` for errors.
**Apply to:** all commands. D-07/D-08 forbid ANSI/color — do NOT add `chalk`/`cli-table3`/`picocolors`.

### Shared CLI Context
**Source:** NEW `src/cli/context.ts` (see Pattern Assignment above)
**Apply to:** all data commands — build context once per invocation; never re-open the DB or re-derive projectId per command (Anti-Pattern in RESEARCH).

## No Analog Found

Files with no close codebase match (planner uses RESEARCH.md patterns):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/output.ts` | utility | transform | No plain-text table/key:value formatter exists. Build from RESEARCH Pattern 3 (`padEnd` columns + ` | ` join, no ANSI). |
| `src/cli/index.ts` (commander program) | route | request-response | No commander program exists yet (commander not installed). Closest is the exec-guard in `run.ts:29-34` being replaced. Build from RESEARCH Pattern 1. |
| `src/cli/context.ts` (as a whole) | provider | transform | New glue. Composed from existing `openDb` + `createMemoryCoreService`, but the `deriveProjectId()` rule has NO source (Open Q1 — must be decided; matches how Phase 1/2 capture sets `project_id`). |

## Metadata

**Analog search scope:** `src/cli/`, `src/core/api/`, `src/core/storage/`, `src/core/injection/`, `src/adapters/`, `tests/`
**Files scanned:** ~14 read in full or targeted ranges
**Pattern extraction date:** 2026-06-09

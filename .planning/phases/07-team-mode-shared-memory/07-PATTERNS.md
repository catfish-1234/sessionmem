# Phase 7: Team Mode Shared Memory - Pattern Map

**Mapped:** 2026-06-11
**Files analyzed:** 13 (5 new, 8 modified)
**Analogs found:** 13 / 13 (every new/modified file has a direct in-repo template)

> Phase 7 is ~80% wiring existing, hardened primitives together. The risk is not building anything novel — it is *missing a thread point* (a SELECT, the importance preserve, a redaction call). Treat the column-threading wave as a checklist of every `FROM memories` / INSERT / DTO site (see Shared Pattern: Column Threading).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/core/schema/migrations/005_team_provenance.sql` (NEW) | migration | transform (DDL) | `src/core/schema/migrations/004_memory_feedback.sql` | role-match (ALTER vs CREATE) |
| `src/core/config/policyConfig.ts` (MODIFY) | config | transform | self (extend existing) | exact |
| `src/cli/commands/team.ts` (NEW) | route/command | request-response | `src/cli/commands/config.ts` + `uninstall.ts` | exact (config group) / exact (--purge) |
| `src/cli/commands/sync.ts` (NEW) | route/command | file-I/O + CRUD | `src/cli/commands/export.ts` (push) + `import.ts` (pull) | exact (both halves) |
| `src/cli/index.ts` (MODIFY) | config/registration | request-response | self (`retention`/`config` group registration) | exact |
| `src/core/api/memoryCoreService.ts` — add `pullMemories` (MODIFY) | service | CRUD (upsert) | `importMemories` (same file, line 384) | exact |
| `src/core/api/contracts.ts` (MODIFY) | model/schema | transform | `importMemoryRecordSchema` (same file, line 117) | exact |
| `src/core/storage/types.ts` (MODIFY) | model | — | `MemoryRecord` (same file, line 11) | exact |
| `src/core/storage/memoryRepo.ts` (MODIFY) | storage | CRUD | `listMemoriesByProject` / `insertMemory` (same file) | exact |
| `src/core/storage/memorySearchRepo.ts` (MODIFY) | storage | CRUD (read) | existing SELECT column list | exact |
| `src/core/retrieve/retrieveMemories.ts` (MODIFY) | service | transform | `RetrievedMemoryCandidate` (same file, line 25) | exact |
| `src/core/injection/formatStartupInjection.ts` (MODIFY) | component | transform | `formatLine` (same file, line 59) | exact |
| `src/cli/context.ts` — add `username` resolution (MODIFY) | utility | — | `deriveProjectId()` (same file, line 30) | exact |

---

## Pattern Assignments

### `src/core/schema/migrations/005_team_provenance.sql` (migration, DDL transform)

**Analog:** `src/core/schema/migrations/004_memory_feedback.sql`

`runMigrations.ts` applies `*.sql` files sorted by `localeCompare`, tracked in `_migrations` by filename, each wrapped in a transaction. `004` is the latest, so `005_*` auto-applies on next `openDb`. The analog is a `CREATE TABLE`; this migration is `ALTER TABLE ADD COLUMN` instead. The DEFAULT-clause and `strftime` timestamp conventions carry over from `001_initial.sql`.

**Pattern to copy — column types/defaults (D-06 discretion; CRITICAL: NOT NULL needs DEFAULT, Pitfall 1):**
```sql
-- SQLite cannot back-fill NULL into a NOT NULL column without a DEFAULT.
ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN origin_project_id TEXT;  -- nullable: only set on synced rows
-- Optional backfill (migration runs in THIS user's context, Open Q1 / D-07):
-- UPDATE memories SET author = '<local-username>' WHERE author = '';
--   (note: local username must be injected at runtime, not hardcoded in SQL)
```

---

### `src/core/config/policyConfig.ts` (config — extend in place, D-14)

**Analog:** self — `policyConfigShape` / `policyConfigSchema` / `resolvePolicySettings` (lines 24-120).

Extend the existing strict-write / strip-read / safe-default pattern with a nested `team` object. **CAUTION (Pitfall 5):** `resolvePolicySettings`'s per-key loop (lines 108-119) assumes flat scalar keys; `team` is an object — resolve it as a unit, do not feed it through the scalar `resolve<K>()` loop.

**Existing shape to extend (lines 24-42):**
```ts
const policyConfigShape = {
  retentionDays: z.number().int().default(DEFAULT_POLICY_CONFIG.retentionDays),
  redactionEnabled: z.boolean().default(DEFAULT_POLICY_CONFIG.redactionEnabled),
};
export const policyConfigSchema = z.object(policyConfigShape).strict();   // write: reject unknown (T-06-04)
const policyConfigReadSchema = z.object(policyConfigShape).strip();       // read: drop unknown (T-06-02)
```

**Team section to add (D-14, Research Pattern 6):**
```ts
const teamConfigShape = z.object({
  enabled: z.boolean().default(false),
  sharedPath: z.string().optional(),
}).strict();
// add to policyConfigShape:  team: teamConfigShape.default({ enabled: false }),
```

**`writePolicyConfig` partial-merge to reuse as-is (lines 80-94)** — `team enable`/`disable` call this with `{ team: {...} }`. Backward compat: old config.json lacking `team` is handled by `.strip()` read + `.default({enabled:false})`. Resolve `team` as a unit (object override > config > default), per Open Q3.

---

### `src/cli/commands/team.ts` (command group — enable/disable/status, D-13)

**Analog (config persistence):** `src/cli/commands/config.ts`. **Analog (disable --remove-team-memories):** `src/cli/commands/uninstall.ts` `--purge`.

**Config-write + test-seam pattern (from `config.ts` lines 8-11, 66-68, 120-124):**
```ts
interface TeamCommandOptions {
  configPath?: string;  // test seam: temp config.json instead of ~/.sessionmem/config.json
}
function resolvePath(options?: TeamCommandOptions): string {
  return options?.configPath ?? configFilePath();
}
// team enable <path>:
writePolicyConfig(resolvePath(options), { team: { enabled: true, sharedPath } });
console.log(`Set team.sharedPath = ${sharedPath}`);
```

**Disable-without-data-loss pattern (D-15, from `uninstall.ts` lines 33-42):**
```ts
// Default: stop sync, KEEP pulled rows (TEAM-03 default = no data loss).
writePolicyConfig(resolvePath(options), { team: { enabled: false } });
console.log("Team mode disabled. Teammate memories preserved.");
// --remove-team-memories: full local-only revert (mirrors --purge gating).
//   DELETE FROM memories WHERE project_id = ? AND author != ?  (local username)
```

**Error convention (Phase 5 D-03, seen across all commands):** `console.error(...)` to stderr + `process.exit(1)`. `team status` and `sync` against a missing/unwritable shared path follow this (Open Q5).

---

### `src/cli/commands/sync.ts` (command — push + pull in one, D-02/D-16)

**Analog (push half):** `src/cli/commands/export.ts`. **Analog (pull half):** `src/cli/commands/import.ts`.

**No-op guard if team mode off (D-13):**
```ts
const cfg = readPolicyConfig(configFilePath());
if (!cfg.team?.enabled) { console.log("Team mode is not enabled. Run `sessionmem team enable <path>`."); return; }
```

**PUSH — snapshot write (model `export.ts` lines 13-33; differs: fixed per-user path + atomic write, Pitfall 2/4):**
```ts
const res = await context.service.call("exportMemories", { projectId: context.projectId });
if (!res.ok) { console.error(res.error.message); process.exit(1); }
// path.join ONLY (Windows/UNC correctness — never string-concat, Pitfall 2)
const dir = join(sharedPath, context.projectId);
mkdirSync(dir, { recursive: true });
const file = join(dir, `${username}.json`);
const tmp = join(dir, `${username}.json.tmp`);          // temp in SAME dir for atomic rename
writeFileSync(tmp, JSON.stringify(res.memories, null, 2), "utf8");
renameSync(tmp, file);                                   // atomic replace (Pitfall 4)
```

**PULL — defensive per-file parse (model `import.ts` lines 22-36, 81-91; one corrupt file must not abort):**
```ts
const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== `${username}.json`);
for (const f of files) {
  let records: unknown;
  try { records = JSON.parse(readFileSync(join(dir, f), "utf8")); }
  catch { console.error(`Skipping unreadable teammate file: ${f}`); continue; }
  if (!Array.isArray(records)) { console.error(`Skipping non-array file: ${f}`); continue; }
  // per-record importMemoryRecordSchema.safeParse skip-and-warn (import.ts:83-91), then collect
}
// one merge call -> service.call("pullMemories", { projectId, memories: validMemories })
```

**Summary output (D-16, mirrors `import.ts` count-summary convention):**
```ts
console.log(`Pushed ${pushed} memories, pulled ${newCount} new + updated ${updatedCount} from teammates.`);
```

---

### `src/core/api/memoryCoreService.ts` — add `pullMemories` (service, CRUD upsert)

**Analog:** `importMemories` in the same file, **lines 384-478** (read in full).

Add a dedicated `pullMemories` (do NOT reuse `importMemories` unchanged — it would clobber importance boosts, Anti-Pattern + Open Q2). Copy the structure verbatim and change three things: (1) importance preserve, (2) thread `author`/`origin_project_id`, (3) keep the cross-project skip.

**KEEP — cross-project ownership skip (lines 418-442, D-09 / Phase 6 decision 17):**
```ts
const ownerStmt = db.prepare("SELECT project_id FROM memories WHERE id = ?");
// ...
const owner = ownerStmt.get(memory.id) as { project_id: string } | undefined;
if (owner && owner.project_id !== parsed.projectId) { skippedCrossProject += 1; continue; }
```

**KEEP — redaction-on-write (lines 426-453, D-12 4th write path):**
```ts
const effectiveRedactionEnabled = resolveRedactionEnabled(parsed.redactionEnabled);
const redaction = applyRedaction(memory.content, { redactionEnabled: effectiveRedactionEnabled });
const embedding = deterministicEmbed(redaction.text, dimension);  // re-embed redacted text
```

**CHANGE — importance preserve on conflict (D-11). Current upsert (lines 397-409) does `importance = excluded.importance`; replace with MAX (Pattern 4, verify against better-sqlite3@12 SQLite, A2):**
```sql
ON CONFLICT(id) DO UPDATE SET
  project_id = excluded.project_id,
  ... ,
  importance = MAX(memories.importance, excluded.importance),  -- D-11: keep higher local boost
  author = excluded.author,                                    -- D-06: carry provenance
  origin_project_id = excluded.origin_project_id,
  ...
```

**ADD — `author` / `origin_project_id` to the INSERT column list (lines 388-396) and `stmt.run({...})` params (lines 454-468).** Return shape extends `{ ok, imported, skippedCrossProject, warningCodes }` — distinguish new vs updated for the D-16 summary (e.g. via `ownerStmt`/`listAllMemoryIds` pre-check, see `import.ts:49`).

---

### `src/core/api/contracts.ts` — extend `importMemoryRecordSchema` (model/schema)

**Analog:** `importMemoryRecordSchema` (lines 117-127, read in full).

Add `author` + `originProjectId` as **OPTIONAL** so old exports lacking them still round-trip (A3, same backward-compat class as Phase 6 06-03):
```ts
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
  author: z.string().optional(),            // NEW (D-06)
  originProjectId: z.string().optional(),   // NEW (D-06)
});
```
Add a `pullMemoriesRequestSchema` mirroring `importMemoriesRequestSchema` (lines 129-136) — `projectId` + optional `redactionEnabled` + `memories: z.array(importMemoryRecordSchema)`.

---

### Storage / DTO / retrieval column-threading sites (MODIFY — see Shared Pattern below)

| File | Site | Line(s) | Change |
|------|------|---------|--------|
| `src/core/storage/types.ts` | `MemoryRecord` | 11-25 | add `author: string;` + `origin_project_id: string \| null;` |
| `src/core/storage/types.ts` | `InsertMemoryInput` | 37-51 | add `author` + `origin_project_id?` |
| `src/core/storage/memoryRepo.ts` | `insertMemory` INSERT cols | 30-33 | add `author, origin_project_id` to column + `@`-param lists |
| `src/core/storage/memoryRepo.ts` | `upsertSessionSummaryMemory` | 51-62 | add author cols + `author = excluded.author` in DO UPDATE |
| `src/core/storage/memoryRepo.ts` | `listMemoriesByProject` SELECT | 80-81 | add `author, origin_project_id` to SELECT list |
| `src/core/storage/memorySearchRepo.ts` | search SELECT column list | (FROM memories) | add `author` to SELECT |
| `src/core/api/memoryCoreService.ts` | `MemoryDto` + `toMemoryDto` | 58-117 | add `author` (map `record.source_adapter` sibling, line 106) |
| `src/core/api/memoryCoreService.ts` | `RetrievedMemoryDto` + `toRetrievedMemoryDto` | 74-127 | add `author` |
| `src/core/api/memoryCoreService.ts` | store/storeMemory INSERT | 148, 388-396 | add `author = local username` (D-07) + `origin_project_id` |
| `src/core/retrieve/retrieveMemories.ts` | `RetrievedMemoryCandidate` | 25-40 | add `author: string;` (D-10 needs this threaded) |

---

### `src/core/injection/formatStartupInjection.ts` — D-10 author annotation (component, transform)

**Analog:** self — `formatLine` (lines 59-67, read in full). This is the single render site for D-10.

**Current render (line 64):**
```ts
return [
  `- [${memory.kind}] ${entry.content}`,
  `(score total=...; source=${memory.source_adapter}; date=${memory.updated_at})`,
].join(" ");
```

**D-10 change — prefix content with `author:` only when author differs from local user** (requires `author` threaded into `RetrievedMemoryCandidate`, and the local username passed in):
```ts
// e.g. "- [decision] alice: decided to use X (...)"  when memory.author !== localUsername
const body = memory.author && memory.author !== localUsername
  ? `${memory.author}: ${entry.content}`
  : entry.content;
return [`- [${memory.kind}] ${body}`, `(...)`].join(" ");
```
Note: `formatStartupInjection` currently takes no local-username arg — thread it via `FormatStartupInjectionOptions` (line 9).

---

### `src/cli/context.ts` — add `username` resolution (utility, D-05)

**Analog:** `deriveProjectId()` (lines 30-41, read in full). Resolve OS username once per invocation, same shape, sanitized for filename use (D-03).

```ts
import { userInfo } from "node:os";
function localUsername(): string {
  const raw = userInfo().username;
  return raw.replace(/[^A-Za-z0-9._-]/g, "_") || "user";   // sanitize for filename component (D-03)
}
// add `username: string` to CliContext (line 9) alongside projectId, set in createCliContext (line 62).
```

---

### `src/cli/index.ts` — register `team` group + `sync` command (MODIFY)

**Analog:** `retention` group (lines 99-108) + `config` group (lines 113-125) registration in the same file.

```ts
// CRITICAL: arrow-wrap every handler to drop commander's trailing Command arg
// (explicit NOTE at index.ts:42-50). A bare fn ref lands Command in the ctx slot.
const team = program.command("team").description("Team shared-memory mode");
team.command("enable <path>").description("Enable team mode with a shared path")
  .action((path) => teamEnableCommand(path));
team.command("disable").option("--remove-team-memories", "Delete teammate-authored memories")
  .action((options) => teamDisableCommand(options));
team.command("status").description("Show team mode status").action(() => teamStatusCommand());

program.command("sync").description("Push local + pull teammate memories")
  .action(() => syncCommand());
```

---

## Shared Patterns

### Column Threading (the dominant cross-cutting concern — Pitfall 3)
**Source checklist:** every `FROM memories` SELECT, every INSERT/upsert column list, every DTO/candidate mapper.
**Apply to:** all storage + service + retrieve + injection files above.
After the `005` migration adds `author`/`origin_project_id`, grep `FROM memories`, `source_adapter`, and `toMemoryDto` and add the new columns at every hit. Miss one SELECT and `author` silently becomes `undefined`, breaking D-10. `source_adapter` is the reliable "sibling" marker — wherever it appears, `author` must follow.

### Error Handling (Phase 5 D-03)
**Source:** every CLI command (`export.ts:17-20`, `import.ts:26-30`, `config.ts:79-85`).
**Apply to:** `sync.ts`, `team.ts`.
```ts
console.error(message);   // stderr, no ANSI color (Phase 5 D-07)
process.exit(1);
// Service envelope: if (!res.ok) { console.error(res.error.message); process.exit(1); }
```

### Config Read/Write/Precedence (Phase 6 D-11)
**Source:** `policyConfig.ts` — `readPolicyConfig` (62-70, safe-default), `writePolicyConfig` (80-94, strict partial-merge), `resolvePolicySettings` (107-119, override > config > default).
**Apply to:** `team.ts`, `sync.ts`, the new `team` config section.

### Redaction-on-Write (Phase 6 D-05/D-06, extended by D-12)
**Source:** `memoryCoreService.ts:446-453` — `applyRedaction(content, { redactionEnabled })` + `deterministicEmbed(redaction.text)`.
**Apply to:** the new `pullMemories` (4th write path beyond auto-summarize, manual store, import).

### Test Seam (configPath / env override)
**Source:** `config.ts:8-11` (`configPath`), `context.ts:30-50` (`SESSIONMEM_PROJECT_ID`/`SESSIONMEM_DB_PATH` env seams).
**Apply to:** `team.ts` (configPath), `sync.ts` integration tests (temp dir as `sharedPath`, two env-seam "users").

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/core/sync/teamSync.ts` (OPTIONAL helper) | utility | file-I/O | RESEARCH proposes an optional shared-path resolution/enumeration helper. No existing dedicated fs-enumeration module — but the constituent calls (`readdirSync`/`path.join`/atomic write) all have in-repo precedent (`context.ts`, `policyConfig.ts`, `uninstall.ts`). Planner may inline into `sync.ts` instead of creating a new module. |

All other files have direct, exact-or-near analogs.

---

## Metadata

**Analog search scope:** `src/cli/commands/`, `src/cli/`, `src/core/config/`, `src/core/api/`, `src/core/storage/`, `src/core/schema/migrations/`, `src/core/retrieve/`, `src/core/injection/`
**Files scanned (read in full or targeted):** `export.ts`, `import.ts`, `config.ts`, `retention.ts`, `uninstall.ts`, `policyConfig.ts`, `004_memory_feedback.sql`, `memoryCoreService.ts` (370-478 + grep map), `formatStartupInjection.ts`, `index.ts` (40-130), `contracts.ts` (100-159), `types.ts`, `context.ts`, `retrieveMemories.ts` (20-44), `memoryRepo.ts` (grep map)
**Pattern extraction date:** 2026-06-11

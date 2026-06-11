# Phase 7: Team Mode Shared Memory - Research

**Researched:** 2026-06-11
**Domain:** Local-first shared-filesystem sync, SQLite schema migration, CLI command groups (Node.js + TypeScript + commander + better-sqlite3)
**Confidence:** HIGH (current-state code verified by direct read; new pieces grounded in existing in-repo patterns)

## Summary

Phase 7 adds team mode to an already-complete, well-factored local-first memory engine. The good news for planning: **almost every new piece has a direct in-repo template.** Sync push/pull reuses the Phase 5 export JSON shape and the Phase 6 `importMemories` upsert verbatim; the `team` config section is a near-copy of the `policyConfig.ts` strict/strip/precedence pattern; the `team` and `sync` CLI commands mirror the existing `config`/`retention` command groups and `export`/`import` commands; and redaction-on-pull is the same `applyRedaction` call already wired into three other write paths. The genuinely new work is a `005_*` migration adding two columns (`author`, `origin_project_id`), threading those columns through ~6 SELECT/INSERT/DTO sites, and the file-layout/sync-orchestration logic.

All canonical references in CONTEXT.md were verified to exist exactly as described. Latest migration is `004_memory_feedback.sql`, so the new migration is `005_*` (confirmed — see Migration Numbering below). `importMemories` is at `memoryCoreService.ts:384` with the exact `ON CONFLICT(id) DO UPDATE` column set documented in CONTEXT.md. `policyConfig.ts` exposes exactly the schema/precedence shape D-14 wants to extend. The one non-trivial gotcha is that **the new columns must be threaded through every SELECT statement that builds a `MemoryRecord`/`RetrievedMemoryCandidate`** — there are several, and missing one will silently drop `author` from retrieval/injection (breaking D-10).

**Primary recommendation:** Plan in four waves: (1) migration `005` + thread `author`/`origin_project_id` through storage types, all SELECTs, DTOs, and `INSERT`/upsert; (2) `team` config section in `policyConfig.ts` + `team` CLI command group; (3) new `pushMemories`/`pullMemories` service methods + `sync` CLI command (reusing import upsert + redaction + importance-preservation); (4) D-10 author annotation in `formatStartupInjection.ts` + docs. Build the column-threading wave first — everything else depends on it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared-file read/write (snapshot push/pull) | CLI command (`sync.ts`) | Storage (fs) | File I/O against `{sharedPath}` is an invoker-trust operation; mirrors `export.ts`/`import.ts` which own fs in the CLI layer, not the service |
| Merge/upsert of pulled memories | API/Service (`MemoryCoreService`) | Storage (memoryRepo) | Business logic (conflict, importance-preservation, redaction, cross-project skip) belongs at the zod-validated service boundary alongside `importMemories` |
| `author`/`origin_project_id` persistence | Storage (migrations + memoryRepo) | — | Schema + SQL owns columns; every SELECT/INSERT touching `memories` must carry them |
| OS-username identity resolution | CLI/context | — | `os.userInfo().username` resolved once per invocation, like `deriveProjectId()` in `context.ts` |
| `team` config (enabled/sharedPath) | Config (`policyConfig.ts`) | CLI (`team.ts`) | Persisted to `~/.sessionmem/config.json` via existing read/write/resolve precedence |
| Redaction-on-pull (D-12) | API/Service (pull path) | `summarize/redaction.ts` | 4th write path; same `applyRedaction` call as the existing three |
| Author annotation in injection (D-10) | Injection (`formatStartupInjection.ts`) | Retrieval | Annotation is a formatting concern at the injection render site; needs `author` threaded into `RetrievedMemoryCandidate` |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sync Mechanism & Trigger**
- **D-01:** Shared export/import-style JSON files, one per teammate per project — NOT a shared SQLite file or append-only log. Reuses Phase 5 export format (D-10) and `importMemories` upsert (Phase 6 decision 17) almost as-is. No file-locking (each user owns their own file).
- **D-02:** Sync is manual via `sessionmem sync` (push + pull in one command). No auto-sync on session-end.
- **D-03:** Shared file layout: `{sharedPath}/{project_id}/{username}.json` — per-project subdir, per-user file.
- **D-04:** Push scope is a full snapshot: each push overwrites the user's own shared file with their complete current local memory set for the current project. Idempotent, no delta tracking.

**Author / Provenance Fields**
- **D-05:** Author identity = OS username (`os.userInfo().username`). Zero config; same value for filename (D-03) and `author` row field.
- **D-06:** New migration (`005_*`) adds `author` and `origin_project_id` columns to `memories`. `source_adapter` unchanged.
- **D-07:** Every memory (not just synced) gets `author` set to local OS username at write time.
- **D-08:** Timestamp provenance reuses existing `created_at` (preserved through export/import per Phase 5 D-10). No new `synced_at` column.

**Conflict & Duplicate Handling**
- **D-09:** Pull duplicate detection is ID-based with last-write-wins on conflict — same `ON CONFLICT(id) DO UPDATE` as `importMemories` (Phase 6 decision 17, cross-project-id-collision skip preserved). No content/embedding dedup.
- **D-10:** Pulled teammate memories annotated with `author` in retrieval/injection output when author differs from local user (e.g., "alice: decided to use X").
- **D-11:** On last-write-wins conflict, incoming overwrites local row EXCEPT `importance` — if local `importance` > incoming, keep the higher local value (preserves feedback boosts, decision 9).
- **D-12:** Pull runs `applyRedaction` again on incoming content (Phase 6 D-05/D-06 rules) as a 4th write path — defense-in-depth.

**Enable/Disable Team Mode & Config**
- **D-13:** New `sessionmem team` command group: `team enable <path>`, `team disable [--remove-team-memories]`, `team status`. `sessionmem sync` no-ops with clear message if team mode not enabled.
- **D-14:** `team enable <path>` persists into a `team` section of existing `~/.sessionmem/config.json` (`{ team: { enabled: true, sharedPath: <path> } }`), extending `policyConfig.ts` schema/precedence — not a separate config file.
- **D-15:** `team disable` supports optional `--remove-team-memories` to delete rows where `author != local username`. Without flag (default), pulled teammate memories stay in local DB and sync just stops — satisfies TEAM-03 "without data loss" (mirrors Phase 5 `--purge`).
- **D-16:** `sessionmem sync` runs directly (no dry-run), prints summary: `Pushed N memories, pulled M new + updated K from teammates.` Non-destructive to user's own data, so dry-run convention doesn't apply.

### Claude's Discretion
- Exact `team` config section schema additions (D-14), as long as `team enable/disable/status` work consistently with `config get`/`config set` (Phase 6 D-13).
- Migration file numbering/naming for `005_*` (D-06) and exact column types/defaults for `author`/`origin_project_id`.
- Exact wording/format of `sync` and `team status` CLI output, as long as summary-count (D-16) and step-checklist precedent (Phase 5 D-05) are followed.
- How `origin_project_id` is populated/used when project_id matches vs. genuinely differs — as long as cross-project collision skip (D-09) still holds.
- Whether `team status` reports last sync time / shared-path health, and how `sync` behaves on missing/unwritable shared path (Phase 5 D-03: stderr + non-zero exit).

### Deferred Ideas (OUT OF SCOPE)
- None new. Hosted sync backend (SYNC-01) is explicitly v2/out-of-scope per PROJECT.md and REQUIREMENTS.md.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEAM-01 | Team can set shared-path sync and merge team memories into local retrieval | `sync` CLI command writes/reads `{sharedPath}/{project_id}/{username}.json`; pull merges via `importMemories`-style upsert; merged rows flow into existing retrieval (`searchMemoryCandidates`/`retrieveMemories`) unchanged once same-project. See Standard Stack, Pattern 1-3. |
| TEAM-02 | Team memories retain author attribution and timestamp provenance | `005_*` migration adds `author` + `origin_project_id`; `author` set at every write (D-07); `created_at` preserved lossless through export/import (D-08). D-10 surfaces `author` in injection. See Migration + Provenance sections. |
| TEAM-03 | Team can disable shared mode and return to local-only without data loss | `team disable` (default) stops sync, keeps pulled rows; `--remove-team-memories` deletes `author != local` rows. Mirrors Phase 5 `--purge`. See Pattern 5. |

## Standard Stack

No new third-party dependencies required. Phase 7 is built entirely from Node.js built-ins plus libraries already in `package.json`.

### Core (already installed — verified in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | ^15.0.0 | CLI command/subcommand registration for `team` + `sync` | Already the entry point in `src/cli/index.ts`; `config`/`retention` command groups are the template |
| `better-sqlite3` | ^12.4.1 | Synchronous SQLite for migration + upsert | Already the DB layer; `ON CONFLICT` upsert pattern already in use |
| `zod` | (in repo) | Validate `team` config section + sync request boundary | Every service boundary + config schema already zod-validated |
| `vitest` | ^4.1.8 | Unit + integration tests | Project's only test runner (`npm test` = `vitest run --reporter=dot`) |

### Supporting (Node.js built-ins — no install)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `node:os` `userInfo().username` | OS username for `author` + filename (D-05) | Resolve once per invocation, like `deriveProjectId()` |
| `node:fs` `mkdirSync`/`writeFileSync`/`readFileSync`/`readdirSync`/`existsSync` | Shared-dir snapshot push/pull, per-user file enumeration | `mkdirSync(dir, { recursive: true })` already used in `context.ts`/`policyConfig.ts` |
| `node:path` `join`/`resolve`/`basename` | Cross-platform path building for `{sharedPath}/{project_id}/{username}.json` | Use `path.join`, never string concat, for Windows/UNC support |

### Alternatives Considered
| Instead of | Could Use | Tradeoff (and why rejected by locked decisions) |
|------------|-----------|------|
| Per-user JSON snapshot files (D-01) | Shared SQLite file | Locking/corruption risk on network drives; rejected by D-01 |
| Full snapshot push (D-04) | Append-only delta log | Complexity, compaction, ordering; rejected by D-04 |
| `proper-lockfile` / atomic-write libs | — | Each user owns their own file (D-01) → no contention → no lock library needed. Atomic write-to-temp-then-rename is a built-in `fs` pattern (see Pitfall 4). |

**Installation:** None. All dependencies present.

```bash
# verification (already satisfied)
npm ls commander better-sqlite3 zod vitest
```

## Package Legitimacy Audit

> Phase 7 installs **no new external packages**. All functionality uses Node.js built-ins (`os`, `fs`, `path`) plus already-installed, already-vetted dependencies (`commander`, `better-sqlite3`, `zod`, `vitest`).

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No new packages — audit not applicable |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No slopcheck run needed — zero new install surface.

## Current-State Verification (existing surfaces confirmed)

Every CONTEXT.md canonical reference was read and confirmed. Exact current shapes the planner needs:

### `memories` table (`001_initial.sql`) — CURRENT
```sql
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  normalized_content TEXT NOT NULL,
  importance INTEGER NOT NULL CHECK (importance >= 1 AND importance <= 10),
  embedding TEXT,
  embedding_dim INTEGER,
  embedding_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```
**No `author` / `origin_project_id` columns exist yet** (verified: zero `author` matches anywhere in `src/core`).

### Migration numbering — CONFIRMED
Existing: `001_initial.sql`, `002_indexes.sql`, `003_summarization_failures.sql`, `004_memory_feedback.sql`. **Next is `005_*`** (D-06 correct). `runMigrations.ts` applies `*.sql` files sorted by `localeCompare`, tracked in a `_migrations` table by filename, each wrapped in a `db.transaction`. So `005_team_provenance.sql` (or similar) with `ALTER TABLE memories ADD COLUMN ...` will auto-apply on next `openDb`. **SQLite `ALTER TABLE ADD COLUMN` requires a DEFAULT for `NOT NULL` columns** (see Pitfall 1).

### `importMemories` upsert (`memoryCoreService.ts:384-478`) — CURRENT
- INSERT/upsert column set: `id, project_id, session_id, source_adapter, kind, content, normalized_content, importance, embedding, embedding_dim, embedding_version, created_at, updated_at`.
- `ON CONFLICT(id) DO UPDATE SET` overwrites all of the above from `excluded.*` (**this is exactly where D-11 importance-preservation must change** — see Pattern 4).
- Pre-loop ownership check (`ownerStmt`) skips cross-project id collisions → `skippedCrossProject` (Phase 6 decision 17). **Preserve this for pull (D-09).**
- Already calls `applyRedaction(memory.content, { redactionEnabled })` per record with `resolveRedactionEnabled(parsed.redactionEnabled)` (D-12 reuses this exact call).
- Re-embeds redacted text via `deterministicEmbed`.
- Returns `{ ok, imported, skippedCrossProject, warningCodes }`.

### `importMemoryRecordSchema` (`contracts.ts:117-127`) — CURRENT
```ts
{ id, projectId, sessionId, sourceAdapter, kind, content,
  importance: z.number().int().min(1).max(10),
  createdAt?: string, updatedAt?: string }
```
**No `author` / `originProjectId` fields.** To round-trip provenance through the shared JSON, add these (likely optional, since old exports lack them — see Open Questions).

### `policyConfig.ts` — CURRENT shape to extend (D-14)
- `DEFAULT_POLICY_CONFIG = { retentionDays: 90, redactionEnabled: true }`.
- `policyConfigShape` (zod fields with `.default()`), `policyConfigSchema` = `.strict()` (write, rejects unknown keys — threat T-06-04), `policyConfigReadSchema` = `.strip()` (read, drops unknown keys, defaults on any failure — T-06-02).
- `readPolicyConfig`/`writePolicyConfig` (partial-merge, `.strict()` validated)/`resolvePolicySettings` (override > config > default).
- `configFilePath()` = `~/.sessionmem/config.json`.
- **Nesting note:** `team` is an object (`{ enabled, sharedPath }`), unlike the current flat scalar fields. The `resolvePolicySettings` per-key resolve loop assumes flat keys — extending it to a nested `team` object needs care (see Pattern 6 + Open Questions).

### `config` CLI key map (`config.ts`) — CURRENT
`CONFIG_KEYS` maps dotted operator keys (`retention.days`) and raw field names to `{ field, coerce }`. D-13 wants dedicated `team enable/disable/status` subcommands (not just `config set team...`), so the `team` command group is the primary surface; whether `config get team.sharedPath` also works is discretion (D-14 says "consistently with config get/set").

### `export.ts` / `import.ts` CLI — templates for `sync`
- `export.ts`: calls `exportMemories({ projectId })`, `writeFileSync(outPath, JSON.stringify(res.memories, null, 2))`, prints `Exported N memories to {path}`. **This is the push half.**
- `import.ts`: `resolve(path)`, `readFileSync`+`JSON.parse` (try/catch → stderr + exit 1), array guard, per-record `importMemoryRecordSchema.safeParse` (skip-and-warn on invalid), then `importMemories`. **This is the pull half.**

### `formatStartupInjection.ts` — D-10 annotation site
`formatLine` (line 59-67) renders `- [${kind}] ${content} (score...; source=${source_adapter}; date=${updated_at})`. **This is where D-10 author annotation hooks in.** Requires `author` threaded into `RetrievedMemoryCandidate` (retrieve path) — currently `RetrievedMemoryCandidate` (`retrieveMemories.ts:25-40`) has NO `author` field.

## Architecture Patterns

### System Architecture Diagram

```
                    sessionmem team enable <path>
                              │
                              ▼
              ~/.sessionmem/config.json  { team: { enabled, sharedPath } }
                              │ (read via resolvePolicySettings)
                              │
        ┌─────────────────────┴─────────────────────┐
        │           sessionmem sync                  │
        │     (no-op + message if !team.enabled)     │
        └─────────────────────┬─────────────────────┘
                              │
            ┌─────────────────┴──────────────────┐
            ▼ PUSH                                ▼ PULL
   exportMemories({projectId})          readdir {sharedPath}/{project_id}/*.json
            │                                     │  (skip own {username}.json)
   write full snapshot to                JSON.parse each teammate file
   {sharedPath}/{project_id}/                     │
       {username}.json                  for each record:
   (atomic temp+rename)                    applyRedaction (D-12)
            │                              importance-preserve merge (D-11)
            ▼                              ON CONFLICT(id) upsert (D-09)
   "Pushed N memories"                     cross-project-id skip
                                                  │
                                                  ▼
                              memories table (author, origin_project_id)
                                                  │
                                                  ▼  (existing path, unchanged)
                              retrieveMemories → formatStartupInjection
                                                  │
                                                  ▼
                              "- [decision] alice: decided to use X ..."  (D-10)

   sessionmem team disable                sessionmem team disable --remove-team-memories
            │                                     │
   stop sync; keep pulled rows           DELETE FROM memories WHERE author != <local>
   (TEAM-03 default, no data loss)        (full local-only revert)
```

### Recommended Project Structure (additions only)
```
src/
├── core/schema/migrations/
│   └── 005_team_provenance.sql      # ALTER TABLE memories ADD author, origin_project_id
├── core/config/
│   └── policyConfig.ts              # EXTEND: team section (enabled, sharedPath)
├── core/api/
│   ├── contracts.ts                 # EXTEND: importMemoryRecordSchema + push/pull request schemas
│   └── memoryCoreService.ts         # ADD: pushMemories/pullMemories (or extend export/import)
├── core/sync/                       # NEW (optional): shared-file path resolution + enumeration helpers
│   └── teamSync.ts
├── cli/commands/
│   ├── sync.ts                      # NEW: push + pull orchestration (model on export.ts + import.ts)
│   └── team.ts                      # NEW: enable / disable / status (model on config.ts)
└── cli/index.ts                     # REGISTER: sync command + team command group
```

### Pattern 1: New CLI command group (model on `retention`/`config` in index.ts)
```ts
// Source: src/cli/index.ts:99-125 (retention/config groups) — VERIFIED in repo
const team = program.command("team").description("Team shared-memory mode");
team.command("enable <path>").description("Enable team mode with a shared path")
  .action((path) => teamEnableCommand(path));
team.command("disable").option("--remove-team-memories", "Delete teammate-authored memories")
  .action((options) => teamDisableCommand(options));
team.command("status").description("Show team mode status").action(() => teamStatusCommand());

program.command("sync").description("Push local + pull teammate memories")
  .action(() => syncCommand());
```
**Arrow-wrap every handler** (drop commander's trailing Command arg — see the explicit NOTE at `index.ts:42-50`).

### Pattern 2: Snapshot push (model on `export.ts`)
```ts
// Source: src/cli/commands/export.ts — VERIFIED. Differs: fixed per-user path, atomic write.
const res = await ctx.service.call("exportMemories", { projectId: ctx.projectId });
// build {sharedPath}/{project_id}/{username}.json with path.join (cross-platform)
const dir = join(sharedPath, ctx.projectId);
mkdirSync(dir, { recursive: true });
const file = join(dir, `${username}.json`);
// atomic: write temp in same dir, then rename (see Pitfall 4)
writeFileSync(tmp, JSON.stringify(res.memories, null, 2), "utf8");
renameSync(tmp, file);
```

### Pattern 3: Pull merge (model on `import.ts` + `importMemories`)
```ts
// Read every teammate file, skip own username.json, parse defensively (try/catch → stderr+exit per file or aggregate).
const files = readdirSync(dir).filter(f => f.endsWith(".json") && f !== `${username}.json`);
// For each file: JSON.parse (guard), validate each record, collect, then one merge call.
// Reuse importMemories upsert + redaction + cross-project skip, plus D-11 importance-preservation.
```

### Pattern 4: Importance-preservation on conflict (D-11) — the key upsert change
The current `ON CONFLICT(id) DO UPDATE SET importance = excluded.importance` must become a `MAX`-style preserve:
```sql
-- In the pull/merge upsert (NOT the plain importMemories — see Open Q2 on whether to fork):
ON CONFLICT(id) DO UPDATE SET
  ...,
  importance = MAX(memories.importance, excluded.importance),  -- D-11: keep higher local boost
  ...
```
SQLite supports `MAX()` referencing both `memories.col` (existing) and `excluded.col` (incoming) inside `DO UPDATE`. This is cleaner than a read-then-compare in JS and is atomic.

### Pattern 5: Disable without data loss (D-15, model on uninstall `--purge`)
```ts
// Source: src/cli/commands/uninstall.ts — VERIFIED --purge precedent.
// Default: writePolicyConfig({ team: { enabled: false } }); print "team mode disabled, memories preserved".
// --remove-team-memories: DELETE FROM memories WHERE project_id = ? AND author != ?  (local username)
```

### Pattern 6: `team` config section (D-14, extend policyConfig.ts)
```ts
// EXTEND policyConfigShape with a nested object:
const teamConfigShape = z.object({
  enabled: z.boolean().default(false),
  sharedPath: z.string().optional(),
}).strict();   // matches the existing .strict() write discipline
// Add `team: teamConfigShape.default({ enabled: false })` to policyConfigShape.
// CAUTION: resolvePolicySettings' per-key loop assumes flat scalars — resolve `team` as a unit,
// or add a dedicated resolveTeamConfig. See Open Q3.
```

### Anti-Patterns to Avoid
- **Forgetting to thread `author` through a SELECT.** There are multiple SELECTs building `MemoryRecord`/candidate rows (`getMemoryById`, `listMemoriesByProject`, `searchMemoryCandidates`, retrieve mapping, the import/upsert column list). Miss one and `author` silently becomes `undefined` → D-10 annotation breaks. Grep for every `FROM memories` after adding columns.
- **Reusing the unchanged `importMemories` upsert for pull** without the D-11 importance-preservation — it would clobber feedback boosts. Either fork a pull-specific upsert or parameterize importance handling (Open Q2).
- **String-concatenating shared paths.** Always `path.join` for Windows/UNC correctness (Pitfall 2).
- **Non-atomic snapshot writes** on a network drive (Pitfall 4).
- **Treating `team` as a flat config key** in `resolvePolicySettings` — its per-key loop iterates `keyof PolicyConfig` and `team` is an object, not a scalar.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Upsert / last-write-wins merge | Custom read-then-write loop | `ON CONFLICT(id) DO UPDATE` (already in `importMemories`) | Atomic, already battle-tested incl. cross-project skip |
| Importance "keep higher" | JS read-compare-write | SQLite `MAX(memories.importance, excluded.importance)` in `DO UPDATE` | Atomic, no race, one statement |
| Secret redaction on pull | New regex set | `applyRedaction()` + `defaultRules()` (`summarize/redaction.ts`) | Phase 6 ReDoS-hardened rule set; D-12 explicitly reuses it |
| Config read/write/precedence | New `team.json` + parser | Extend `policyConfig.ts` (D-14) | Strict/strip/safe-default + override>config>default already solved |
| CLI subcommand wiring | Manual argv parsing | commander `.command()` groups (`retention`/`config` precedent) | Already the entry point; arrow-wrap caveat documented |
| OS username | Parse env/whoami | `os.userInfo().username` | Cross-platform, zero-config (D-05) |
| File enumeration | Glob library | `fs.readdirSync` + `.endsWith(".json")` | Per-project dir is flat; no new dep |

**Key insight:** Phase 7 is ~80% wiring existing, hardened primitives together. The risk is not *building* anything novel — it's *missing a thread point* (a SELECT, the importance preserve, a redaction call) where the new behavior must be inserted. Treat the migration + column-threading wave as a checklist of every `FROM memories` and every INSERT/DTO site.

## Runtime State Inventory

> Phase 7 is primarily code/schema, but it introduces a new external state surface (the shared filesystem) and a schema change. Inventory below.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `memories` table in `~/.sessionmem/memories.db`. Existing rows have **no `author`** — after `005_*` migration they get the column DEFAULT (e.g. `''` or a sentinel). D-07 says every memory gets local username at *write* time, but pre-existing rows pre-date that. | Migration must set a sensible DEFAULT; optionally a one-time backfill `UPDATE memories SET author = <local username> WHERE author = '' OR author IS NULL` — but local username at migration time may not be "correct" for historical rows. See Open Q4. |
| Live service config | `~/.sessionmem/config.json` gains a `team` section. Written by `team enable`, read by `sync`/`team status`. Not in git (user home dir). | `team enable`/`disable` write it via `writePolicyConfig`. Backward-compat: old config.json lacks `team` → `.strip()` read + `.default({enabled:false})` handles it. |
| Live service config (shared) | NEW: `{sharedPath}/{project_id}/{username}.json` files on a shared drive — teammate-authored, NOT in this repo's git, NOT in `~/.sessionmem`. | `sync push` writes own file; `sync pull` reads teammates'. Handle missing/unwritable path per Phase 5 D-03 (stderr + exit 1). |
| OS-registered state | None. No Task Scheduler / launchd / pm2 registration changes (sync is manual, D-02). | None — verified: D-02 is manual-only, no scheduled job. |
| Secrets/env vars | No new secret keys. `SESSIONMEM_PROJECT_ID`/`SESSIONMEM_DB_PATH` env seams unchanged. Username comes from OS, not env (D-05). | None. |
| Build artifacts | `005_*.sql` ships in `src/core/schema/migrations/` and is resolved package-relative via `import.meta.url` in `context.ts` (decision 15) — confirm the new migration is included in any future `dist/` build (Phase 8 concern, not 7). | None for Phase 7; flag for Phase 8 packaging. |

## Common Pitfalls

### Pitfall 1: SQLite `ALTER TABLE ADD COLUMN NOT NULL` requires a DEFAULT
**What goes wrong:** `ALTER TABLE memories ADD COLUMN author TEXT NOT NULL;` fails on a non-empty table because existing rows would violate NOT NULL.
**Why it happens:** SQLite cannot back-fill NULLs into a NOT NULL column without a default.
**How to avoid:** Either `ADD COLUMN author TEXT NOT NULL DEFAULT ''` (or a sentinel), or make the column nullable. Given D-07 (every *new* write sets author), a `DEFAULT ''` + handling empty author in display is one option; nullable `author TEXT` is simpler. Decide column type/default (D-06 discretion). `origin_project_id` is naturally nullable (only set on synced rows).
**Warning signs:** Migration transaction throws on first `openDb` against an existing DB; `_migrations` row for `005` never inserted.

### Pitfall 2: Windows path separators and UNC shared paths
**What goes wrong:** Building `{sharedPath}/{project_id}/{username}.json` with string concat or hardcoded `/` breaks on Windows drive-letter paths (`Z:\team`) and UNC paths (`\\server\share\team`).
**Why it happens:** This is a Windows project (`win32`); `deriveProjectId()` already normalizes `\\` → `/` for the *project id*, but the *shared path* is user-supplied and may be a UNC/drive path.
**How to avoid:** Use `path.join(sharedPath, projectId, \`${username}.json\`)` exclusively. `path.join` handles separators per-platform and preserves UNC prefixes. Do NOT `path.resolve` the shared path against cwd in a way that mangles UNC (validate it's absolute; surface a clear error if not writable per Phase 5 D-03).
**Warning signs:** Files written to wrong location; "ENOENT" on a path that visibly exists; double-separator paths in error messages.

### Pitfall 3: `author` dropped silently from retrieval/injection
**What goes wrong:** D-10 annotation shows `undefined: ...` or no author because a SELECT in the retrieve path doesn't list the new column.
**Why it happens:** `RetrievedMemoryCandidate` (`retrieveMemories.ts:25-40`) and `searchMemoryCandidates` SELECT an explicit column list; new columns are not auto-included.
**How to avoid:** After migration, add `author` to: `MemoryRecord` (`types.ts:11`), every explicit `SELECT ... FROM memories` (`getMemoryById`, `listMemoriesByProject`, `searchMemoryCandidates`, plus the import/export column lists), `RetrievedMemoryCandidate` + its mapper, `MemoryDto` + `toMemoryDto`/`toRetrievedMemoryDto`. Grep `FROM memories` and `toMemoryDto`/`source_adapter` as the checklist.
**Warning signs:** `author` present in DB (verify with a manual query) but missing in `show`/injection output.

### Pitfall 4: Non-atomic snapshot write on a network drive
**What goes wrong:** A teammate pulls a half-written `username.json` mid-push (truncated JSON → `JSON.parse` throws), especially over a laggy network share.
**Why it happens:** `writeFileSync` is not atomic; a reader can observe a partial file. Network drives amplify the window.
**How to avoid:** Write to a temp file in the **same directory** (so `rename` stays on one filesystem), then `renameSync(tmp, finalPath)`. `rename` is atomic on POSIX; on Windows it is effectively atomic for same-volume replace via `MoveFileEx`-style semantics. Per the Node.js docs and community best practice, write-temp-then-rename is the standard atomic-write pattern. Pull side: wrap each file's `JSON.parse` in try/catch and skip-and-warn (mirrors `import.ts` defensive parse) so one corrupt file doesn't abort the whole pull.
**Warning signs:** Intermittent "Unexpected end of JSON input" during pull; flaky CI on slow filesystems.

### Pitfall 5: `resolvePolicySettings` flat-key assumption vs. nested `team`
**What goes wrong:** Extending `resolvePolicySettings` naively to include `team` breaks because its `resolve<K>(key)` loop returns a scalar per `keyof PolicyConfig`, but `team` is an object.
**Why it happens:** The function was designed for flat scalar policy fields (`retentionDays`, `redactionEnabled`).
**How to avoid:** Resolve `team` as a unit (object-level override > config > default), or add a dedicated `resolveTeamConfig`. Keep the existing flat resolution for scalar fields untouched.
**Warning signs:** Type errors in `resolvePolicySettings`; `team.sharedPath` resolving to `undefined` when set in config.

### Pitfall 6: Re-redacting/re-embedding already-clean teammate content (cost, not correctness)
**What goes wrong:** D-12 re-runs `applyRedaction` and (per `importMemories`) re-embeds on every pull — for a full-snapshot pull (D-04) of unchanged memories, this re-does work each sync.
**Why it happens:** Full snapshot + upsert means every pull touches every teammate row.
**How to avoid:** Acceptable for v1 (deterministic embed is cheap, redaction is bounded-regex). If sync feels slow, the `ON CONFLICT` can skip re-embed when content is unchanged — but that's an optimization, not required. Flag as known tradeoff, not a blocker.
**Warning signs:** Sync latency grows with teammate count × memory count. Not a correctness issue.

## Code Examples

### Resolve OS username once (D-05)
```ts
// Source: node:os — VERIFIED standard API
import { userInfo } from "node:os";
function localUsername(): string {
  // Sanitize for use as a filename component (D-03). Usernames are usually safe,
  // but defend against path separators / dots in exotic environments.
  const raw = userInfo().username;
  return raw.replace(/[^A-Za-z0-9._-]/g, "_") || "user";
}
```

### Migration 005 (one viable shape — column types are D-06 discretion)
```sql
-- Source: pattern from 004_memory_feedback.sql + SQLite ALTER TABLE docs
ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN origin_project_id TEXT;
-- nullable origin_project_id: only set on synced rows (D-06 discretion).
```

### Defensive per-file pull parse (model on import.ts:22-36)
```ts
// Source: src/cli/commands/import.ts — VERIFIED defensive-parse precedent
let records: unknown;
try {
  records = JSON.parse(readFileSync(file, "utf8"));
} catch {
  console.error(`Skipping unreadable teammate file: ${file}`);
  continue; // one corrupt file must not abort the whole pull
}
if (!Array.isArray(records)) { console.error(`Skipping non-array file: ${file}`); continue; }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| (n/a — greenfield feature) | — | — | — |

No deprecated APIs in play. `commander@15`, `better-sqlite3@12`, `vitest@4` are all current major lines and already pinned. `os.userInfo()`, `fs.renameSync`, `path.join` are stable Node.js built-ins.

**Deprecated/outdated:** None relevant to this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `renameSync` is effectively atomic for same-volume replace on Windows network drives | Pitfall 4 | If a network share is mid-replace non-atomic, a reader could still see a partial state; mitigation (same-dir temp + skip-and-warn on parse) makes this low-impact regardless. `[ASSUMED]` from training + general fs best practice; not verified against a specific Windows UNC config. |
| A2 | SQLite `MAX(memories.importance, excluded.importance)` is valid inside `ON CONFLICT DO UPDATE` referencing both old and excluded values | Pattern 4 | If unsupported in the pinned SQLite build, fall back to JS read-compare-write. High confidence it works (standard SQLite), but `[ASSUMED]` — confirm against `better-sqlite3@12`'s bundled SQLite at implementation time. |
| A3 | Old exports / config files lacking `team`/`author` fields are handled by `.strip()` read + optional schema fields | Current-State Verification | If schemas make new fields required, backward-compat breaks (same class of bug fixed in Phase 6, summary 06-03). `[ASSUMED]` — planner should make new contract/config fields optional with defaults. |

**Note:** Items A1-A3 are low-risk and each has a documented fallback. None block planning.

## Open Questions

1. **`author` column nullability + backfill for pre-existing rows.**
   - What we know: D-07 sets author at *new* write time; existing rows pre-date this. Migration needs a DEFAULT (Pitfall 1).
   - What's unclear: Whether to backfill historical rows with the local username (they were authored locally) or leave a sentinel/empty.
   - Recommendation: `author TEXT NOT NULL DEFAULT ''` + optionally backfill `UPDATE ... WHERE author = ''` with local username during migration's first run (the migration runs in *this* user's context, so backfilling to local username is defensible for pre-team rows). Treat as D-06 discretion; surface in plan.

2. **Fork pull-upsert or parameterize `importMemories`.**
   - What we know: D-11 importance-preservation differs from plain import (which overwrites importance).
   - What's unclear: Whether to add a `pullMemories` method with its own MAX-importance upsert, or add a flag to `importMemories`.
   - Recommendation: Add a dedicated `pullMemories` (or `mergeTeamMemories`) service method that shares helpers but uses the MAX-importance upsert and stamps `origin_project_id`/preserves `author`. Keeps `importMemories` (CLI `import`) semantics unchanged. Planner's call.

3. **Nested `team` config resolution in `resolvePolicySettings`.**
   - What we know: current resolve loop is flat-scalar (Pitfall 5).
   - Recommendation: object-level resolve for `team`, or a separate `resolveTeamConfig`. Discretion under D-14.

4. **`origin_project_id` population semantics.**
   - What we know: D-06 says it's the project_id from the source machine; D-09 cross-project skip must still hold. CONTEXT.md D-44 marks the same-vs-differs behavior as discretion.
   - Recommendation: On pull, stamp `origin_project_id` = the `projectId` carried in the teammate's JSON record (their machine's project_id). Local `project_id` becomes the *pulling* user's project_id (since merged rows must be same-project to be retrievable). Cross-project-id-collision skip stays on `id` ownership as today. Surface in plan as the concrete rule.

5. **Shared-path health in `team status` + sync error behavior on missing/unwritable path.**
   - Recommendation (discretion): `team status` prints `enabled`, `sharedPath`, and whether the path exists/is writable; `sync` against a missing/unwritable path prints to stderr + exits 1 (Phase 5 D-03). Optionally a "last sync" marker — but no `synced_at` column exists (D-08), so any last-sync display would need a config field or be omitted. Recommend omitting last-sync time for v1 to honor D-08.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (built-ins `os`/`fs`/`path`) | Username, file I/O, paths | ✓ | (project runtime) | — |
| better-sqlite3 | Migration + upsert | ✓ | ^12.4.1 (package.json) | — |
| commander | CLI groups | ✓ | ^15.0.0 | — |
| zod | Schemas | ✓ | (in repo) | — |
| vitest | Tests | ✓ | ^4.1.8 | — |
| A shared filesystem path | Actual team sync at runtime | ✗ (user-provided) | — | Tests use a temp dir as the "shared path"; no real network drive needed for CI |

**Missing dependencies with no fallback:** None — Phase 7 needs no new tooling.
**Missing dependencies with fallback:** Real shared/network drive is a *runtime user* concern; tests substitute a local temp directory as `sharedPath`.

## Validation Architecture

> nyquist_validation is enabled (no `workflow.nyquist_validation: false` in config). Format follows Phase 5 RESEARCH.

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
| TEAM-02 | `005_*` migration adds `author`/`origin_project_id`; existing rows survive | integration | `npx vitest run tests/integration/storage/schema.spec.ts -x` | ⚠️ exists (schema spec) — extend |
| TEAM-02 | every write stamps `author` = local username (D-07) | unit | `npx vitest run tests/unit/core/author-stamp.spec.ts -x` | ❌ Wave 0 |
| TEAM-01 | `sync push` writes full snapshot to `{sharedPath}/{project_id}/{username}.json` | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 |
| TEAM-01 | `sync pull` merges teammate files into local DB; rows retrievable | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 |
| TEAM-01 | last-write-wins on id conflict; cross-project id skipped (D-09) | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 |
| TEAM-01 | importance preserved when local > incoming (D-11) | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 |
| TEAM-01 | redaction re-applied on pull (D-12) even if teammate redaction off | unit | `npx vitest run tests/unit/core/pull-merge.spec.ts -x` | ❌ Wave 0 |
| TEAM-02 | D-10 annotation: teammate-authored memory shows `author:` prefix in injection | unit | `npx vitest run tests/unit/injection/author-annotation.spec.ts -x` | ❌ Wave 0 |
| TEAM-03 | `team disable` (default) keeps pulled rows; sync no-ops after | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 |
| TEAM-03 | `team disable --remove-team-memories` deletes `author != local` rows | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 |
| D-14 | `team enable <path>` persists `team` section; `team status` reads it back | integration | `npx vitest run tests/integration/cli/team.spec.ts -x` | ❌ Wave 0 |
| D-16 | `sync` prints `Pushed N..., pulled M new + updated K...` summary | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 |
| D-03 | sync against missing/unwritable shared path → stderr + exit 1 | integration | `npx vitest run tests/integration/cli/sync.spec.ts -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/<area> --reporter=dot` (the touched area)
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/integration/cli/sync.spec.ts` — push/pull round-trip, summary output, error-on-bad-path (TEAM-01, D-16, D-03). Use a temp dir as `sharedPath`, two `SESSIONMEM_PROJECT_ID`/`SESSIONMEM_DB_PATH` "users" writing into the same shared dir.
- [ ] `tests/integration/cli/team.spec.ts` — enable/disable/status, `--remove-team-memories` (TEAM-03, D-14).
- [ ] `tests/unit/core/pull-merge.spec.ts` — LWW, importance-preserve (D-11), cross-project skip (D-09), redaction-on-pull (D-12).
- [ ] `tests/unit/injection/author-annotation.spec.ts` — D-10 prefix when `author != local`, no prefix when equal.
- [ ] `tests/unit/core/author-stamp.spec.ts` — D-07 every write path stamps author.
- [ ] Extend existing `tests/integration/storage/schema.spec.ts` for the `005` columns (TEAM-02).
- [ ] Shared test fixture: a `withSharedDir`/two-user helper (temp `sharedPath` + two contexts via env seams) — likely a new `tests/helpers` util.

*(Existing `tests/integration/cli/data-commands.spec.ts` and `export-import.spec.ts` are good models for CLI integration test structure.)*

## Security Domain

> `security_enforcement` not set to `false` → included. Phase 6 already hardened the codebase; Phase 7 adds a new ingestion surface (teammate files) and a new fs write surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth; local-first, OS-user identity only (advisory, not a trust boundary — see threats) |
| V3 Session Management | no | n/a |
| V4 Access Control | partial | Filesystem permissions on `{sharedPath}` are the access boundary (OS-managed, out of app scope). App stays read/write within the project subdir. |
| V5 Input Validation | yes | Every teammate record validated via `importMemoryRecordSchema` (extended); `JSON.parse` wrapped in try/catch (model: `import.ts`); array guard |
| V6 Cryptography | no | No crypto in v1 (at-rest encryption is SECU-05/v2). Never hand-roll. |
| V12/V5 File handling | yes | `path.join`/`resolve` for shared paths; no path-traversal from teammate filenames (enumerate via `readdirSync`, don't trust embedded paths); username sanitized for filename use |

### Known Threat Patterns for {Node.js + shared filesystem + SQLite}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious/oversized teammate JSON (DoS, malformed) | Tampering / DoS | Per-record `importMemoryRecordSchema.safeParse` skip-and-warn; per-file `JSON.parse` try/catch skip-and-warn; one corrupt file never aborts the pull (reuse Phase 5/06 import hardening) |
| Secret leakage via teammate with redaction disabled | Information Disclosure | D-12: re-run `applyRedaction` on every pulled record (4th write path) regardless of source's `redactionEnabled` |
| `author` spoofing (teammate sets arbitrary `author` in their JSON) | Spoofing | **Accept as known limitation** — author is advisory provenance, not a security control. The filename (`{username}.json`) is the OS-username of the *writer*; the in-record `author` is informational. Document that team mode assumes a trusted shared dir (filesystem ACLs are the trust boundary). |
| ReDoS via crafted content hitting redaction rules | DoS | Phase 6 rules already bounded-quantifier / anchored (T-06-03) — unchanged, inherited |
| Path traversal via teammate filename or embedded projectId | Tampering | Enumerate files with `readdirSync` (no path injection); build write paths from local `projectId`/sanitized `username` via `path.join`; never use a path string from inside a teammate file |
| Cross-project id collision overwrite | Tampering | Preserve existing `ownerStmt` skip from `importMemories` (Phase 6 decision 17) in the pull path (D-09) |

**Key security framing for the planner:** team mode's trust boundary is the **shared filesystem's OS-level permissions**, not the app. The app defends against malformed/secret-bearing input (validation + redaction) but treats anyone with write access to `{sharedPath}` as a trusted teammate. This should be stated in the D-13/setup docs (success criterion 5: failure-recovery + setup guidance).

## Sources

### Primary (HIGH confidence — verified by direct file read)
- `src/core/api/memoryCoreService.ts` (importMemories:384-478, toMemoryDto, DTOs, getMemoryById)
- `src/core/schema/migrations/{001,004}*.sql`, `src/core/schema/runMigrations.ts`
- `src/core/config/policyConfig.ts`, `src/cli/commands/config.ts`
- `src/cli/index.ts`, `src/cli/commands/{export,import,uninstall}.ts`, `src/cli/context.ts`
- `src/core/summarize/redaction.ts`, `src/core/storage/{memoryRepo,types}.ts`
- `src/core/retrieve/retrieveMemories.ts`, `src/core/injection/formatStartupInjection.ts`
- `src/core/api/contracts.ts` (import/export schemas)
- `package.json` (dependency versions)
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/07-.../07-CONTEXT.md`, `.planning/phases/05-.../05-RESEARCH.md` (validation format)

### Secondary (MEDIUM confidence)
- Node.js fs docs — UNC/file-URL path behavior on Windows, atomic write-temp-then-rename pattern: https://nodejs.org/api/fs.html

### Tertiary (LOW confidence — flagged in Assumptions Log)
- WebSearch: atomic write reliability on network drives (A1) — general best-practice, not a Windows-UNC-specific verification.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; all libraries present and version-verified in package.json.
- Architecture / current-state surfaces: HIGH — every CONTEXT.md reference read and confirmed; exact signatures captured.
- Pitfalls: HIGH for in-repo gotchas (column threading, config nesting, ALTER constraints); MEDIUM for cross-platform atomic-write specifics (A1).
- Security: HIGH — inherits Phase 6 hardening; new surfaces (teammate input, fs writes) mapped to existing mitigations.

**Research date:** 2026-06-11
**Valid until:** ~2026-07-11 (stable — internal-code-focused; only risk is dependency major bumps, none expected mid-milestone)

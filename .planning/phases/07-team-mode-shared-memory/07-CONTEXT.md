# Phase 7: Team Mode Shared Memory - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable safe shared-memory workflow for teams without a hosted backend (TEAM-01/02/03). Add a `sessionmem sync` command that pushes a snapshot of local project memories to a shared-filesystem path (per-project, per-user JSON files) and pulls/merges teammates' memories into the local DB with author/timestamp provenance. Add a `sessionmem team` command group to enable/disable team mode and configure the shared path. Conflict handling, redaction-on-pull, and clean disable-without-data-loss are in scope. Hosted sync backends (SYNC-01, v2) and CI/test/docs work (Phase 8) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Sync Mechanism & Trigger
- **D-01:** Sync uses **shared export/import-style JSON files**, one per teammate per project — not a single shared SQLite file or shared append-only log. Reuses Phase 5 export format (D-10) and `importMemories` upsert logic (Phase 6 decision 17) almost as-is. No file-locking concerns since each user owns their own file.
- **D-02:** Sync is **manual** via `sessionmem sync` (push + pull in one command). No automatic sync on session-end — predictable, no surprise filesystem writes.
- **D-03:** Shared file layout: `{sharedPath}/{project_id}/{username}.json` — per-project subdirectory, per-user file. Mirrors the existing `project_id` scoping convention (decision 14) and avoids cross-project collisions.
- **D-04:** Sync push scope is a **full snapshot**: each `sessionmem sync push` overwrites the user's own shared file with their complete current local memory set for the current project. Idempotent, simple to reason about — no incremental/delta tracking.

### Author / Provenance Fields
- **D-05:** Author identity = **OS username** (`os.userInfo().username`). Zero config; same value used for the per-user filename (D-03) and the `author` field on memory rows. No git-config or configurable-display-name dependency.
- **D-06:** Add new columns to `memories` table via a new migration (`005_*`): **`author`** (teammate identity) and **`origin_project_id`** (project_id from the source machine, distinct from local `project_id` if they ever diverge). `source_adapter` is unchanged — it still represents which tool produced the memory.
- **D-07:** **Every memory** (not just synced ones) gets `author` set to the local OS username at write time. Consistent attribution everywhere — `list`/`show`/retrieval can always display "by {author}", and sync just carries the existing value through.
- **D-08:** Timestamp provenance reuses the existing **`created_at`** column (preserved through export/import per Phase 5 D-10 lossless round-trip). No new `synced_at` column.

### Conflict & Duplicate Handling
- **D-09:** Sync pull duplicate detection is **ID-based with last-write-wins on conflict** — same `ON CONFLICT(id) DO UPDATE` upsert pattern as `importMemories` (Phase 6 decision 17, with cross-project-id-collision skip preserved). No content-similarity/embedding-based dedup.
- **D-10:** Pulled teammate memories are **annotated with `author` in retrieval/injection output** when the author differs from the local user (e.g., "alice: decided to use X") — surfaces provenance to the agent in-context, not just in `show`/`export`.
- **D-11:** On last-write-wins conflict: incoming content/metadata overwrites the local row, **except `importance`** — if local `importance` > incoming `importance`, keep the higher local value. Preserves feedback-driven importance boosts (decision 9) from being clobbered by a sync pull.
- **D-12:** Sync pull runs **`applyRedaction` again on incoming content** (Phase 6 D-05/D-06 rule set) as a 4th write path beyond the three from Phase 6 (auto-summarize, manual store, import) — defense-in-depth in case a teammate has `redactionEnabled=false` locally.

### Enable/Disable Team Mode & Config
- **D-13:** New **`sessionmem team`** command group: `team enable <path>`, `team disable [--remove-team-memories]`, `team status`. `sessionmem sync` no-ops with a clear message if team mode is not enabled.
- **D-14:** `team enable <path>` persists settings into a **`team` section of the existing `~/.sessionmem/config.json`** (`{ team: { enabled: true, sharedPath: <path> } }`), extending the `policyConfig.ts` schema/precedence pattern from Phase 6 (D-09/D-11/D-13) rather than a separate config file.
- **D-15:** `team disable` supports an optional `--remove-team-memories` flag to delete rows where `author != local username` for a full revert to local-only content. Without the flag (default), already-pulled teammate memories **stay in local DB** and sync simply stops — satisfies TEAM-03 "without data loss" as the default behavior, mirroring the Phase 5 uninstall `--purge` pattern (D-06).
- **D-16:** `sessionmem sync` runs directly (no dry-run) and prints a summary: `Pushed N memories, pulled M new + updated K from teammates.` Sync is non-destructive to the user's own data (push only overwrites the user's own shared file; pull is upsert per D-09/D-11), so the dry-run convention from `forget`/`redact-scan`/`prune` doesn't apply here.

### Claude's Discretion
- Exact `team.json`/`config.json` schema additions for the `team` section (D-14), as long as `team enable/disable/status` (D-13) work consistently with existing `config get`/`config set` (Phase 6 D-13).
- Migration file numbering/naming for `005_*` (D-06) and exact column types/defaults for `author`/`origin_project_id`.
- Exact wording/format of `sync` and `team status` CLI output, as long as the summary-count convention (D-16) and step-checklist precedent (Phase 5 D-05) are followed.
- How `origin_project_id` is populated/used when project_id matches across machines (D-06) vs. genuinely differs — as long as cross-project collision skip (D-09) still holds.
- Whether `team status` reports last sync time / shared-path health, and how `sync` behaves on missing/unwritable shared path (error message conventions per D-03 of Phase 5: stderr + non-zero exit).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Phase Scope
- `.planning/REQUIREMENTS.md` §TEAM-01, §TEAM-02, §TEAM-03 — team mode requirements this phase delivers
- `.planning/ROADMAP.md` §Phase 7 — goal and five success criteria

### Project Constraints
- `.planning/PROJECT.md` — local-first constraint, "shared-path team sync only" out-of-scope note for hosted sync

### Prior Phase Context
- `.planning/phases/05-cli-lifecycle-and-data-operations/05-CONTEXT.md` — D-10 export JSON format, D-11 default export path convention, D-12 import skip-duplicates/`--merge` pattern, D-03 stderr+exit-code error convention, D-06 `--purge` pattern (model for `--remove-team-memories`)
- `.planning/phases/06-security-privacy-and-retention-hardening/06-CONTEXT.md` — D-05/D-06 redaction rule set and all-write-paths coverage (extend for sync pull, D-12), D-09/D-11/D-13 config.json schema/precedence pattern (extend for `team` section, D-14), D-12/D-14 dry-run/`--apply` CLI conventions
- `.planning/STATE.md` decision 14 (project_id = basename of cwd convention, relevant to D-03/D-06 origin_project_id), decision 17 (importMemories cross-project id collision skip, basis for D-09), decision 9 (importance boost cap, relevant to D-11)

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — layer overview, error envelope pattern
- `.planning/codebase/STRUCTURE.md` — file layout conventions for new CLI commands and migrations

### Existing Implementation Surfaces
- `src/core/api/memoryCoreService.ts:384` — `importMemories` upsert (`ON CONFLICT(id) DO UPDATE`) — base pattern for sync pull merge (D-01, D-09, D-11)
- `src/core/schema/migrations/001_initial.sql` — `memories` table definition — add `author`/`origin_project_id` columns here via new `005_*` migration (D-06)
- `src/core/schema/migrations/` — migration directory; `runMigrations.ts` applies them in order
- `src/core/config/policyConfig.ts` — `policyConfigSchema`, `readPolicyConfig`/`writePolicyConfig`/`resolvePolicySettings` — extend with `team` section (D-14)
- `src/core/summarize/redaction.ts` — `applyRedaction`/`defaultRules()` — call on sync pull (D-12)
- `src/cli/index.ts` — commander entry point — register `sync` and `team` command groups here
- `src/cli/commands/` — existing command implementations (`export.ts`/`import.ts` if present) — model `sync` push/pull on these

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `importMemories` (`src/core/api/memoryCoreService.ts:384`): `ON CONFLICT(id) DO UPDATE` upsert over `id, project_id, session_id, source_adapter, kind, content, normalized_content, importance, embedding, embedding_dim, embedding_version, created_at, updated_at` — extend with `author`/`origin_project_id` columns and importance-preservation logic (D-11) for sync pull.
- Phase 5 export format (JSON array of memory rows, D-10) — sync push writes this same shape to `{sharedPath}/{project_id}/{username}.json` (D-01/D-03/D-04).
- `policyConfig.ts` precedence/schema pattern (`.strict()` write schema, `.strip()` read schema, safe-default fallback) — direct template for the new `team` config section (D-14).
- `applyRedaction()`/`defaultRules()` (`src/core/summarize/redaction.ts`) — call during sync pull (D-12), same as the three Phase 6 write paths.

### Established Patterns
- Error handling: `DomainError` + `{ ok: false, error: { code, message } }` envelope; CLI commands print to stderr, `exit(1)` (Phase 5 D-03).
- Zod-validated request boundaries at the service layer (`contracts.ts`).
- No barrel files; direct imports with `.js` extensions.
- `console.log`/`console.error` for CLI output, no ANSI color (Phase 5 D-07).
- Config precedence: explicit override > config.json > built-in default (Phase 6 D-11) — applies to `team.sharedPath`/`team.enabled` too.

### Integration Points
- New `pushMemories`/`pullMemories` (or equivalent) operations belong in `MemoryCoreService` alongside `exportMemories`/`importMemories`, callable from both CLI and adapters.
- `sessionmem sync` and `sessionmem team *` commands register in `src/cli/index.ts` alongside Phase 5/6 commands (`export`, `import`, `retention`, `config`, `redact-scan`).
- Retrieval/injection layer (Phase 3 startup injection) needs to read the new `author` column to produce D-10's annotation when `author != local username`.

</code_context>

<specifics>
## Specific Ideas

- Shared file path example: `{sharedPath}/{project_id}/{username}.json`, full snapshot per push (D-03/D-04).
- `sessionmem sync` output: `Pushed N memories, pulled M new + updated K from teammates.` (D-16).
- Retrieval annotation example: `alice: decided to use X` for teammate-authored memories surfaced in context (D-10).
- `sessionmem team enable <path>`, `sessionmem team disable [--remove-team-memories]`, `sessionmem team status` (D-13).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Hosted sync backend (SYNC-01) is explicitly v2/out-of-scope per PROJECT.md and REQUIREMENTS.md, not a new deferral from this discussion.)

</deferred>

---

*Phase: 07-team-mode-shared-memory*
*Context gathered: 2026-06-11*

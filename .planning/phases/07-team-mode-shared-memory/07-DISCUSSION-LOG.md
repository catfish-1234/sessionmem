# Phase 7: Team Mode Shared Memory - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 07-team-mode-shared-memory
**Areas discussed:** Sync mechanism & trigger, Author/provenance fields, Conflict & duplicate handling, Enable/disable team mode & config

---

## Sync mechanism & trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Shared export/import files | Per-user files in shared dir, reuse Phase 5 export format + importMemories upsert | ✓ |
| Single shared SQLite file | One DB on shared filesystem; risky locking/corruption on network FS | |
| Shared append-only log | One JSONL file all clients append/tail; needs append-safety | |

**User's choice:** Shared export/import files

| Option | Description | Selected |
|--------|-------------|----------|
| Manual `sessionmem sync` command | Explicit push/pull, predictable, no surprise FS writes | ✓ |
| Automatic on session-end | Piggyback on session-end lifecycle | |
| Both: auto-push, manual pull | Auto-push new memories, manual pull for teammates' | |

**User's choice:** Manual `sessionmem sync` command

| Option | Description | Selected |
|--------|-------------|----------|
| Per-project subdir, per-user file | `{sharedPath}/{project_id}/{username}.json` | ✓ |
| Flat per-user file across all projects | `{sharedPath}/{username}.json`, mixes projects | |
| Per-project, per-user, per-session files | Most granular, many small files | |

**User's choice:** Per-project subdir, per-user file

| Option | Description | Selected |
|--------|-------------|----------|
| All local memories for current project | Full snapshot overwrite each push, idempotent | ✓ |
| Only memories above importance threshold | Filter noise, adds config knob | |
| Incremental: only new/changed since last push | Smaller files, needs push-state tracking | |

**User's choice:** All local memories for current project

**Notes:** None

---

## Author/provenance fields

| Option | Description | Selected |
|--------|-------------|----------|
| OS username | `os.userInfo().username`, zero config | ✓ |
| Git user.name/email | Requires git repo + config | |
| Configurable display name in config.json | Most flexible, extra setup step | |

**User's choice:** OS username

| Option | Description | Selected |
|--------|-------------|----------|
| New `author` + `origin_project_id` columns | New migration, full provenance | ✓ |
| Reuse `source_adapter` field for author too | Conflates two concepts | |
| Store author only in shared export file, not local DB | Loses provenance after pull | |

**User's choice:** New `author` + `origin_project_id` columns

| Option | Description | Selected |
|--------|-------------|----------|
| Always set author = local username | Consistent attribution everywhere | ✓ |
| Author null until synced | Distinguishes mine vs teammate's, but inconsistent | |

**User's choice:** Always set author = local username

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `created_at` only | Already preserved through export/import round-trip | ✓ |
| Add `synced_at` column too | Extra migration field, update-on-conflict logic | |

**User's choice:** Reuse `created_at` only

**Notes:** None

---

## Conflict & duplicate handling

| Option | Description | Selected |
|--------|-------------|----------|
| ID-based skip, last-write-wins on conflict | Same upsert pattern as importMemories | ✓ |
| ID-based skip only, never overwrite | Like Phase 5 import default | |
| Content-similarity dedup across authors | Higher quality but adds embedding-comparison cost | |

**User's choice:** ID-based skip, last-write-wins on conflict

| Option | Description | Selected |
|--------|-------------|----------|
| Annotate with author in retrieval output | Shows `[author: ...]` when differs from local user | ✓ |
| Treated identically, no annotation | Provenance invisible to agent | |

**User's choice:** Annotate with author in retrieval output

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite content/metadata, preserve local importance | Avoids clobbering feedback-driven boosts | ✓ |
| Full overwrite including importance | Simplest, resets local boosts on pull | |

**User's choice:** Overwrite content/metadata, preserve local importance

| Option | Description | Selected |
|--------|-------------|----------|
| No extra pass — trust source-side redaction | Avoids double-processing | |
| Re-run redaction on pull as defense-in-depth | New 4th write path beyond Phase 6's three | ✓ |

**User's choice:** Re-run redaction on pull as defense-in-depth

**Notes:** None

---

## Enable/disable team mode & config

| Option | Description | Selected |
|--------|-------------|----------|
| config.json fields: team.enabled + team.sharedPath | Extends policyConfig.ts directly | |
| Dedicated `sessionmem team` command group | team enable/disable/status, more discoverable | ✓ |

**User's choice:** Dedicated `sessionmem team` command group

| Option | Description | Selected |
|--------|-------------|----------|
| Pulled memories stay in local DB, sync just stops | No data deleted, mirrors uninstall (no --purge) | |
| Offer to remove teammate-authored memories on disable | `--remove-team-memories` flag, destructive opt-in | ✓ |

**User's choice:** Offer to remove teammate-authored memories on disable (as opt-in flag; default still preserves data)

| Option | Description | Selected |
|--------|-------------|----------|
| team section in `~/.sessionmem/config.json` | Extends Phase 6 policyConfig pattern | ✓ |
| Separate `~/.sessionmem/team.json` file | Two config files to manage | |

**User's choice:** team section in config.json

| Option | Description | Selected |
|--------|-------------|----------|
| Sync runs directly (no dry-run), prints summary | Push/pull non-destructive to own data | ✓ |
| Dry-run by default like prune/redact-scan | Adds friction to routine operation | |

**User's choice:** Sync runs directly, prints summary

**Notes:** `team disable` default behavior keeps teammate-authored memories (no data loss per TEAM-03); `--remove-team-memories` is an explicit opt-in for users who want a full revert.

---

## Claude's Discretion

- Exact `team` section schema additions to `config.json`, as long as `team enable/disable/status` work with `config get`/`config set`.
- Migration numbering/naming for the new `005_*` migration and column types/defaults for `author`/`origin_project_id`.
- Exact wording/format of `sync` and `team status` CLI output (summary-count convention, step-checklist precedent).
- How `origin_project_id` is populated/used when project_id matches vs. differs across machines.
- `team status` reporting (last sync time, shared-path health) and error handling for missing/unwritable shared path.

## Deferred Ideas

None — discussion stayed within phase scope.

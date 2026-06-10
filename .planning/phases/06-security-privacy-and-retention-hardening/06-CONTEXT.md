# Phase 6: Security, Privacy, and Retention Hardening - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Make privacy controls and secret protections production-ready: add a configurable retention policy that prunes old memories, expand secret redaction coverage and apply it across all memory-write paths (auto-summarize, manual store, import), add a `~/.sessionmem/config.json` policy config surface, and ship CLI commands for retention pruning, config management, and a one-time redaction scrub of existing data. Team-mode sync (Phase 7) and broader CI/test/docs work (Phase 8) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Retention Policy
- **D-01:** Retention pruning covers the `memories` table only (not `session_events` or feedback history). SECU-01 is scoped to memory pruning.
- **D-02:** Pruning is dual-triggered: an automatic light prune check runs as part of session-end lifecycle (alongside summarization), and a manual CLI command provides on-demand/dry-run control.
- **D-03:** Default retention window is `90` days, age basis is `created_at`. `retentionDays` is configurable; `0`/`-1` (or similar) disables pruning.
- **D-04:** Pruned memories are hard-deleted from SQLite. No archive/soft-delete. Users who want to retain data should `export` first (Phase 5 CLI).

### Secret Redaction Coverage
- **D-05:** Expand `defaultRules()` in `src/core/summarize/redaction.ts` (currently only email + `sk-` API keys) to a broad common-secret pattern set: AWS access keys (`AKIA...`), generic Bearer tokens, GitHub tokens (`ghp_`/`gho_`/etc.), private key blocks (`-----BEGIN ... PRIVATE KEY-----`), `password=`/`secret=`-style connection-string assignments, and JWTs. Roughly aligned with what gitleaks already scans for in CI.
- **D-06:** Redaction (`applyRedaction`) runs on **all** memory-write paths going forward: auto-summarize (existing), manual memory store/`remember`, and import. CAPT-04 manual memories currently bypass redaction entirely — this closes that gap. Same `redactionEnabled` flag governs all paths, default `on`.
- **D-07:** Redaction is NOT applied retroactively as part of normal operation. Instead, ship a one-time scrub path (`sessionmem redact-scan [--apply]`) that scans existing stored memories against the new rule set and, with `--apply`, redacts and updates rows in place.
- **D-08:** Redaction warnings on manual/import paths reuse the existing `warningCodes` / `redaction_partial_failure` mechanism from Phase 2 (`sessionLifecycleService`) — returned in the response envelope, consistent across all paths.

### Policy Config Surface
- **D-09:** New `~/.sessionmem/config.json` holds policy settings (`retentionDays`, `redactionEnabled`, future security/privacy settings). Closes the "No Configuration Management" gap noted in CONCERNS.md.
- **D-10:** `sessionmem install` writes `config.json` with defaults (`retentionDays: 90`, `redactionEnabled: true`) if it doesn't already exist. `sessionmem uninstall` leaves `config.json` in place (like the DB) unless `--purge` (Phase 5 D-06 pattern).
- **D-11:** Precedence for resolving effective settings: explicit CLI flag > `config.json` value > built-in default. Standard CLI convention.

### CLI / Adapter Integration
- **D-12:** New `sessionmem retention prune [--dry-run]` command (new `retention` command group, room for future subcommands). Default is dry-run: prints `Would delete N memories older than {retentionDays} days. Pass --force to confirm.` — mirrors Phase 5 `forget` dry-run pattern (D-09).
- **D-13:** New generic `sessionmem config get` / `sessionmem config set <key> <value>` commands for reading/writing `config.json` (e.g. `sessionmem config set retention.days 30`). Extensible for future settings without new per-setting commands.
- **D-14:** New `sessionmem redact-scan [--apply]` command (see D-07): dry-run by default, scans existing memories for secret-pattern matches and prints `Found N memories with potential secrets` with previews; `--apply` redacts in place and prints a summary count.
- **D-15:** `sessionmem stats` (Phase 5 CLI-06) gains retention + redaction summary lines, e.g. `Retention: 90 days (12 memories eligible for pruning)` and `Redaction: enabled` — gives users policy visibility without a separate command.

### Claude's Discretion
- Exact regex patterns for each redaction rule category (AWS keys, GitHub tokens, JWTs, etc.), as long as the categories in D-05 are covered and false-positive rate stays reasonable.
- Exact `config.json` schema/shape and key naming (e.g. `retention.days` vs `retentionDays`), as long as `config get`/`config set` (D-13) and install defaults (D-10) work consistently.
- Exact wording/format of CLI output for `retention prune`, `redact-scan`, and `stats` additions, as long as dry-run-by-default and summary-count conventions (D-04, D-12, D-14, D-15) hold.
- Automatic prune check frequency/threshold within session-end lifecycle (D-02) — e.g. every session-end vs. throttled — as long as it stays "light" and doesn't block summarization.

</decisions>

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and Phase Scope
- `.planning/REQUIREMENTS.md` §SECU-01, §SECU-02 — retention policy and secret redaction requirements this phase delivers
- `.planning/ROADMAP.md` §Phase 6 — goal and five success criteria

### Project Constraints
- `.planning/PROJECT.md` — local-first constraint, security/privacy documentation requirement

### Prior Phase Context
- `.planning/phases/02-session-lifecycle-summarization-pipeline/02-CONTEXT.md` — existing redaction defaults (`redactionEnabled` default `on`, partial-failure warning behavior) that this phase extends
- `.planning/phases/05-cli-lifecycle-and-data-operations/05-CONTEXT.md` — D-09 dry-run-by-default pattern (`forget`), D-06 `--purge` pattern (`uninstall`), CLI error/exit-code conventions, commander entry point structure

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — layer overview, error envelope pattern, CI security gates (Semgrep/Gitleaks/Trivy)
- `.planning/codebase/CONCERNS.md` §"No Environment Configuration", §"Hardcoded Secrets Risk" — gaps this phase addresses

### Existing Implementation Surfaces
- `src/core/summarize/redaction.ts` — `applyRedaction`, `defaultRules()`, `RedactionOptions`/`RedactionResult` — extend rule set here (D-05)
- `src/core/summarize/localSummarizer.ts` — current sole call site of `applyRedaction` (D-06: add to manual store/import paths too)
- `src/core/api/sessionLifecycleService.ts` — `redactionEnabled` wiring and `redaction_partial_failure` warning code (D-08)
- `src/core/api/contracts.ts` — `handleSessionEndConfigSchema` (`redactionEnabled: z.boolean().default(true)`) — pattern for new config schema additions
- `src/core/storage/memoryRepo.ts` — memory insert/upsert; `created_at` field used for retention age basis (D-03)
- `src/core/schema/migrations/` — migration directory for any schema changes needed for retention queries
- `src/cli/index.ts` — commander entry point; new `retention`, `config`, `redact-scan` commands register here
- `src/cli/commands/install.ts` — install lifecycle; add `config.json` default-write step (D-10)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `applyRedaction()` / `defaultRules()` in `src/core/summarize/redaction.ts`: extend in place rather than replacing — `RedactionRule` is a simple `(input: string) => string` function type, easy to add more rules to the array.
- `handleSessionEndConfigSchema` in `src/core/api/contracts.ts`: existing zod pattern (`z.boolean().default(true)`) for config fields with defaults — model new `retentionDays`/`redactionEnabled` config schema on this.
- Phase 5 CLI commands (`forget`, `import`, `stats`) in `src/cli/commands/`: dry-run, `--force`, and summary-count output conventions to mirror for `retention prune` and `redact-scan`.
- `MemoryCoreService` (`src/core/api/memoryCoreService.ts`): central facade — new `pruneMemories`/`redactExisting` operations should be exposed here for both CLI and adapter access.

### Established Patterns
- Error handling: `DomainError` + `{ ok: false, error: { code, message } }` envelope; CLI commands catch and print to stderr with `exit(1)`.
- Zod-validated request boundaries at the service layer (`contracts.ts`).
- Local-only-by-default policy enforcement via `localOnlyPolicy.ts` precedent — new config-file reads should similarly default safely if file missing/invalid.
- No barrel files; direct imports with `.js` extensions.
- `console.log`/`console.error` for CLI output, no ANSI color (Phase 5 D-07).

### Integration Points
- Session-end lifecycle (`sessionLifecycleService.ts`) is the integration point for the automatic prune check (D-02).
- `install.ts` is the integration point for writing default `config.json` (D-10).
- New `pruneMemories`/`redactExisting`/config read-write functions need to be callable from both CLI commands and `MemoryCoreService` so adapters can use them too (success criterion 5: "policy controls integrate with core and adapter flows consistently").

</code_context>

<specifics>
## Specific Ideas

- `sessionmem retention prune --dry-run` output format: `Would delete N memories older than {retentionDays} days. Pass --force to confirm.` — directly modeled on Phase 5 `forget` (D-09).
- `sessionmem redact-scan` output format: `Found N memories with potential secrets` with previews; `--apply` redacts in place and prints a summary count — same dry-run/`--apply` shape as `import --merge` (D-12 in Phase 5).
- `stats` additions: `Retention: 90 days (12 memories eligible for pruning)` and `Redaction: enabled`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (Configurable custom redaction rule packs, soft-delete/archive-on-prune, and pruning `session_events`/feedback history were considered and explicitly decided against for this phase, not deferred as future work — revisit only if a future phase's requirements demand it.)

</deferred>

---

*Phase: 06-security-privacy-and-retention-hardening*
*Context gathered: 2026-06-10*

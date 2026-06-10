# Phase 6: Security, Privacy, and Retention Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 06-security-privacy-and-retention-hardening
**Areas discussed:** Retention policy mechanism, Secret redaction coverage, Policy config surface, CLI/adapter integration & visibility

---

## Retention policy mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Memories only | Prune rows in memories table by age | ✓ |
| Memories + session_events | Also prune raw session event logs by age | |
| Memories + session_events + feedback history | Full sweep including importance-feedback audit trail | |

**User's choice:** Memories only

| Option | Description | Selected |
|--------|-------------|----------|
| Manual CLI command only | New `sessionmem retention prune [--dry-run]`, mirrors Phase 5 forget dry-run | |
| Automatic on session-end | Pruning runs as part of session lifecycle | |
| Both — automatic check + manual override | Automatic light prune on session-end, plus CLI for on-demand/dry-run | ✓ |

**User's choice:** Both — automatic check + manual override

| Option | Description | Selected |
|--------|-------------|----------|
| Off by default, user sets days | retentionDays unset = no pruning | |
| 90-day default, age = created_at | Sensible default, user can override or disable | ✓ |
| 30-day default, age = updated_at | More aggressive default, uses updated_at | |

**User's choice:** 90-day default, age = created_at

| Option | Description | Selected |
|--------|-------------|----------|
| Hard delete | Pruned rows removed from SQLite directly | ✓ |
| Archive to export file then delete | Auto-write pruned records to export file before deleting | |
| Soft delete (deleted_at flag) | Mark rows deleted but keep in DB | |

**User's choice:** Hard delete

---

## Secret redaction coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Broad common-secret set | AWS keys, Bearer tokens, GitHub tokens, private keys, password=, JWTs | ✓ |
| Minimal extension | Just AWS keys + private key blocks + password= patterns | |
| Configurable rule pack | Default broad set + user-defined custom regex rules | |

**User's choice:** Broad common-secret set

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — apply everywhere | Run applyRedaction on all memory content (auto-summary AND manual store/import) | ✓ |
| Auto-summarize only (current behavior) | Keep redaction scoped to summarization pipeline | |
| Apply to import too, but not manual single-memory store | Redact bulk import only | |

**User's choice:** Yes — apply everywhere

| Option | Description | Selected |
|--------|-------------|----------|
| No — forward-only | New rules apply to new content going forward only | |
| Yes — add a one-time migration/CLI scrub | Add `sessionmem redact-existing [--dry-run]` to scan/redact existing data | ✓ |
| Report-only on existing data | CLI/stats check flags existing memories matching secret patterns | |

**User's choice:** Yes — add a one-time migration/CLI scrub

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing warning-code pattern | Same redaction_partial_failure / warningCodes mechanism from Phase 2 | ✓ |
| Silent redaction, no warning | Just redact and store, no extra signal | |
| Explicit count in CLI output | CLI commands print "Redacted N secret(s) before storing" | |

**User's choice:** Reuse existing warning-code pattern

---

## Policy config surface

| Option | Description | Selected |
|--------|-------------|----------|
| New ~/.sessionmem/config.json | Single JSON config file alongside memories.db and logs/ | ✓ |
| Env vars only | SESSIONMEM_RETENTION_DAYS, SESSIONMEM_REDACTION_ENABLED etc. | |
| Extend per-call config schemas only | No persistent config file, settings passed per invocation | |

**User's choice:** New ~/.sessionmem/config.json

| Option | Description | Selected |
|--------|-------------|----------|
| Created with defaults on install, untouched by uninstall | install writes config.json with defaults if absent; uninstall leaves it unless --purge | ✓ |
| Lazy-created on first config write | Not touched during install, only created on first `config set` | |
| Bundle into existing DB (settings table) | Store config as key-value rows in SQLite instead of JSON file | |

**User's choice:** Created with defaults on install, untouched by uninstall

| Option | Description | Selected |
|--------|-------------|----------|
| CLI flag > config.json > built-in default | Standard CLI precedence convention | ✓ |
| config.json > CLI flag | Config file is source of truth | |
| You decide | Claude picks during planning | |

**User's choice:** CLI flag > config.json > built-in default

---

## CLI/adapter integration & visibility

| Option | Description | Selected |
|--------|-------------|----------|
| sessionmem retention prune [--dry-run] | New `retention` command group, mirrors Phase 5 forget dry-run pattern | ✓ |
| Fold into existing forget command | e.g. `sessionmem forget --older-than 90d --force` | |
| config-driven only, no dedicated prune command | Pruning only via automatic + config set | |

**User's choice:** sessionmem retention prune [--dry-run]

| Option | Description | Selected |
|--------|-------------|----------|
| sessionmem config get / config set <key> <value> | Generic config command group | ✓ |
| Dedicated flags on existing commands | e.g. `sessionmem install --retention-days 30` | |
| Edit config.json directly only | No CLI for config | |

**User's choice:** sessionmem config get / config set <key> <value>

| Option | Description | Selected |
|--------|-------------|----------|
| sessionmem redact-scan [--apply] | Default dry-run scans, --apply redacts and updates rows in place | ✓ |
| Folded into stats command | `sessionmem stats --check-secrets` adds secret count to stats output | |
| One-time automatic migration on next install/upgrade | Runs silently as part of DB migration | |

**User's choice:** sessionmem redact-scan [--apply]

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — add retention + redaction summary lines | e.g. "Retention: 90 days (12 memories eligible for pruning)" | ✓ |
| No — keep stats focused on count/size/tokens | Leave Phase 5 stats output unchanged | |

**User's choice:** Yes — add retention + redaction summary lines

---

## Claude's Discretion

- Exact regex patterns for each redaction rule category (AWS keys, GitHub tokens, JWTs, etc.)
- Exact `config.json` schema/shape and key naming
- Exact wording/format of CLI output for `retention prune`, `redact-scan`, and `stats` additions
- Automatic prune check frequency/threshold within session-end lifecycle

## Deferred Ideas

None — discussion stayed within phase scope. Configurable custom redaction rule packs, soft-delete/archive-on-prune, and pruning session_events/feedback history were considered and explicitly decided against for this phase (not deferred as future work).

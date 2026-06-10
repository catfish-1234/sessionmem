# Privacy and Retention

`sessionmem` stores memories locally and applies two privacy controls automatically: **secret redaction** on every memory-write path, and a configurable **retention policy** that prunes old memories. Both are governed by `~/.sessionmem/config.json` and surfaced through CLI commands.

## Secret Redaction

Redaction scrubs common secret patterns from memory content before it is stored, replacing each match with a `REDACTED` placeholder. It runs on **all** memory-write paths:

- auto-summarization at session end,
- manual memory store (`remember`),
- import.

The same `redactionEnabled` flag governs every path. It defaults to **on** (`true`).

### Redacted categories

| Category | Examples |
|----------|----------|
| Email addresses | `user@example.com` |
| `sk-` API keys | OpenAI-style `sk-...` keys |
| AWS access keys | `AKIA...` |
| GitHub tokens | `ghp_...`, `gho_...`, and related prefixes |
| Bearer tokens | `Authorization: Bearer ...` |
| Private key blocks | `-----BEGIN ... PRIVATE KEY-----` private key blocks |
| Connection-string assignments | `password=...`, `secret=...` |
| JWTs | three-part `xxxxx.yyyyy.zzzzz` tokens |

These categories are roughly aligned with what the project's CI secret scanning already looks for.

### Partial-failure warnings

If redaction cannot be applied cleanly on a write path, the response envelope carries a `redaction_partial_failure` warning code (the same warning mechanism used elsewhere in the lifecycle). The write still completes; the warning tells you to review the affected memory.

### Disabling redaction

Setting `redactionEnabled` to `false` turns redaction off across all write paths. This is not recommended — leaving it on is the safe default.

## Retention Policy

Retention pruning deletes memories older than a configurable window so the local store does not grow unbounded.

- **Scope:** the `memories` table only. Session events and feedback history are never touched.
- **Age basis:** a memory's `created_at` timestamp.
- **Default window:** `90` days (`retentionDays`).
- **Disabling:** set `retentionDays` to `0` or `-1` to disable pruning entirely.
- **Hard delete:** pruned memories are permanently deleted from SQLite. There is no archive or soft-delete.

> **Retain data before pruning.** Pruning is irreversible. Run `sessionmem export` first if you want to keep a copy of memories that would be deleted.

## Automatic vs Manual Pruning

**Automatic (session-end):** a light, non-blocking prune check runs as part of the session-end lifecycle, alongside summarization. It never blocks or delays summarization.

**Manual:** run the prune command on demand. It is **dry-run by default** — nothing is deleted unless you pass `--force`:

```bash
sessionmem retention prune
```

Dry-run output:

```
Would delete N memories older than {retentionDays} days. Pass --force to confirm.
```

To actually delete eligible memories:

```bash
sessionmem retention prune --force
```

You can override the effective window for a single run with `--days <n>` (this takes precedence over `config.json` and the built-in default):

```bash
sessionmem retention prune --days 30
```

## One-time Redaction Scrub

Redaction is **not** applied retroactively during normal operation. To scrub secrets out of memories that were stored before redaction coverage was expanded, use `redact-scan`. It is dry-run by default:

```bash
sessionmem redact-scan
```

Dry-run reports how many stored memories match the secret patterns (with previews). To redact and update those rows in place:

```bash
sessionmem redact-scan --apply
```

`--apply` rewrites matching memories with `REDACTED` placeholders and prints a summary count.

## Policy Config

Policy settings live in `~/.sessionmem/config.json`:

```json
{
  "retentionDays": 90,
  "redactionEnabled": true
}
```

### Precedence

Effective settings are resolved in this order, highest first:

1. **CLI flag** (e.g. `retention prune --days 30`)
2. **`config.json`** value
3. **built-in default**

So a CLI flag always wins for that invocation, `config.json` overrides the built-in default, and a missing/invalid `config.json` falls back safely to the defaults.

### Reading and writing config

Use `config get` / `config set` to inspect and change settings without editing the file by hand:

```bash
sessionmem config get retentionDays
sessionmem config set retention.days 30
sessionmem config set redactionEnabled false
```

Both the dotted operator key (`retention.days`) and the raw field name (`retentionDays`) are accepted. Invalid values (a non-integer for `retentionDays`, or anything other than `true`/`false` for `redactionEnabled`) are rejected with an error and the file is left unchanged.

### Install and uninstall behavior

- `sessionmem install` writes `config.json` with defaults (`retentionDays: 90`, `redactionEnabled: true`) **only if the file does not already exist**. An existing config is preserved byte-for-byte.
- `sessionmem uninstall` leaves `config.json` in place (like the database) **unless** you pass `--purge`.

## Stats Visibility

`sessionmem stats` includes retention and redaction summary lines so you can see the effective policy at a glance without running a separate command, for example:

```
Retention: 90 days (12 memories eligible for pruning)
Redaction: enabled
```

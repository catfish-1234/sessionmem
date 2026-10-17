# Privacy and Retention

`sessionmem` stores memories locally, redacts secrets before saving, and prunes old memories according to a retention policy. Configure both in `~/.sessionmem/config.json` or with the CLI commands below.

## Secret Redaction

Redaction replaces common secret patterns with `REDACTED` before saving memory content. It runs during:

- automatic summarization at session end,
- manual memory storage (`storeMemory` or `batchStoreMemory`),
- import.

The `redactionEnabled` flag controls all of these operations and defaults to `true`.

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

The project's CI secret scanning checks for similar categories.

### Partial-failure warnings

If redaction partly fails, the response includes a `redaction_partial_failure` warning through the usual lifecycle warning mechanism. The write still completes. Review the affected memory when you see this warning.

### Disabling redaction

Setting `redactionEnabled` to `false` disables redaction for all memory writes. Leave it enabled to keep these checks.

## Retention Policy

Retention pruning limits growth of the local store by deleting memories older than a configured age.

- **Scope:** the `memories` table only. Session events and feedback history are never touched.
- **Age basis:** a memory's `created_at` timestamp.
- **Default window:** `90` days (`retentionDays`).
- **Disabling:** set `retentionDays` to `0` to disable pruning. Negative values are rejected by the config schema.
- **Hard delete:** pruned memories are permanently deleted from SQLite. There is no archive or soft-delete.

> Pruning is permanent. Run `sessionmem export` first if you want to keep a copy of the memories.

## Automatic vs Manual Pruning

**Automatic (session-end):** a lightweight prune check runs alongside summarization without blocking or delaying it.

**Manual:** the prune command previews deletions by default. It only deletes memories when you pass `--force`:

```bash
sessionmem retention prune
```

Dry-run output:

```
Would delete N memories older than {retentionDays} days. Pass --force to confirm.
```

To delete eligible memories:

```bash
sessionmem retention prune --force
```

Use `--days <n>` to set the retention window for one run, overriding `config.json` and the built-in default:

```bash
sessionmem retention prune --days 30
```

## One-time Redaction Scrub

Normal memory writes do not recheck older memories. To check memories saved before redaction coverage was expanded, run `redact-scan`. It previews changes by default:

```bash
sessionmem redact-scan
```

The preview shows matching memories and a count. To redact and update them in place:

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

Settings take precedence in this order, highest first:

1. **CLI flag** (e.g. `retention prune --days 30`)
2. **`config.json`** value
3. **built-in default**

If `config.json` is missing or invalid, sessionmem uses the built-in defaults unless a CLI flag overrides them.

### Reading and writing config

Use `config get` and `config set` to read and change settings:

```bash
sessionmem config get retentionDays
sessionmem config set retention.days 30
sessionmem config set redactionEnabled false
```

You can use either the dotted key `retention.days` or the field name `retentionDays`. Invalid values, such as a non-integer for `retentionDays` or a value other than `true`/`false` for `redactionEnabled`, produce an error without changing the file.

### Install and uninstall behavior

- `sessionmem install` creates `config.json` with defaults (`retentionDays: 90`, `redactionEnabled: true`) if the file is missing. It leaves an existing file unchanged.
- `sessionmem uninstall` keeps `config.json` and the database unless you pass `--purge`.

## Stats Visibility

`sessionmem stats` shows the current retention and redaction settings, for example:

```
Retention: 90 days (12 memories eligible for pruning)
Redaction: enabled
```

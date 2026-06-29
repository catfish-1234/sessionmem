# Migration and Upgrade Policy

This document covers two related things: (a) how the SQLite **migration** system works for contributors and operators, and (b) the **version-upgrade** policy users should expect. Configuration and the local database both live under `~/.sessionmem/`.

## Migration system

`sessionmem` evolves its SQLite schema with forward-only migrations. Each migration is a plain `.sql` file under `src/core/schema/migrations/`, named with a zero-padded ordinal prefix so they apply in a deterministic order:

```
src/core/schema/migrations/
  001_initial.sql
  002_indexes.sql
  003_summarization_failures.sql
  004_memory_feedback.sql
  005_team_provenance.sql
```

### How migrations run

At startup the migration runner ensures a `_migrations` bookkeeping table exists, lists every `.sql` file in the migrations directory in sorted order, and applies (inside a transaction) only the ones not already recorded in `_migrations`. Migrations are therefore **idempotent across runs**: applying them again is a no-op, and the schema converges forward only (there are no down-migrations).

### Build-time copy: `copy-migrations`

The migration `.sql` files are source assets, not TypeScript, so the TypeScript build does not emit them. The `scripts/copy-migrations.mjs` build step (`copy-migrations`) copies every `.sql` file from `src/core/schema/migrations/` into `dist/core/schema/migrations/` so the published package ships its migrations alongside the compiled code.

At runtime the migrations directory is resolved **package-relative** (relative to the installed module, not the process working directory). This is deliberate: resolving package-relative means the published `dist` copy is used and an attacker cannot slip a malicious migration in by running the CLI from a directory that happens to contain a `migrations/` folder (Phase 5 Decision #15). If you add or edit a migration, the build must re-run `copy-migrations` for the change to reach `dist`.

### Adding a migration (contributors)

1. Add a new `NNN_description.sql` file with the next ordinal in `src/core/schema/migrations/`.
2. Keep it forward-only and idempotent where practical.
3. Re-run the build so `copy-migrations` copies it into `dist/core/schema/migrations/`.

## Version-upgrade policy

`sessionmem` follows **semantic versioning** (semver): `MAJOR.MINOR.PATCH`.

- **Patch / minor upgrades** are safe in place. Schema changes ship as additive, forward-only migrations that run automatically the first time the upgraded version opens your existing database. No manual step is required and your stored memories are preserved.
- **Major-version upgrades** may introduce breaking changes; any required manual migration step or behavior change will be called out in the release notes for that major version.
- **No down-migrations.** Because migrations are forward-only, downgrading to an older `sessionmem` version after a newer one has migrated your database is not supported. Before a major upgrade, run `sessionmem export` to keep a portable JSON copy of your memories you can re-import if needed.

This is the v1 policy. Because v1 is the first released version there is no prior schema to upgrade *from*; the policy above is the contract for upgrades **after** v1 ships.

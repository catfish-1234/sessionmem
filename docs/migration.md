# Migration and Upgrade Policy

This guide explains SQLite migrations and what to expect when upgrading sessionmem. Configuration and the default database live under `~/.sessionmem/`.

## Migration system

`sessionmem` updates its SQLite schema with forward-only migrations. Each migration is a `.sql` file under `src/core/schema/migrations/`. Zero-padded numeric prefixes determine the order:

```
src/core/schema/migrations/
  001_initial.sql
  002_indexes.sql
  003_summarization_failures.sql
  004_memory_feedback.sql
  005_team_provenance.sql
```

### How migrations run

At startup, the runner creates the `_migrations` tracking table if needed and sorts the `.sql` files by name. It applies each migration in its own transaction, skipping any already recorded in `_migrations`. Starting sessionmem again does not reapply completed migrations. There are no down-migrations.

### Build-time copy: `copy-migrations`

The TypeScript compiler does not copy `.sql` files. The build step `copy-migrations` runs `scripts/copy-migrations.mjs` to copy them from `src/core/schema/migrations/` to `dist/core/schema/migrations/`. This includes the migrations in the published package alongside the compiled code.

At runtime, sessionmem loads migrations relative to the installed module, using the packaged `dist` copy. It does not search the working directory, where an attacker could place a malicious `migrations/` folder (Phase 5 Decision #15). After adding or editing a migration, re-run the build so `copy-migrations` updates `dist`.

### Adding a migration (contributors)

1. Add a new `NNN_description.sql` file with the next ordinal in `src/core/schema/migrations/`.
2. Keep it forward-only and idempotent where practical.
3. Re-run the build so `copy-migrations` copies it into `dist/core/schema/migrations/`.

## Version-upgrade policy

`sessionmem` follows **semantic versioning** (semver): `MAJOR.MINOR.PATCH`.

- **Patch / minor upgrades** work with your existing database. Additive, forward-only migrations run automatically when the upgraded version first opens it. Stored memories are preserved and no manual migration is needed.
- **Major-version upgrades** may introduce breaking changes. The release notes will describe behavior changes and any manual migration steps.
- **Downgrades after migration are unsupported.** Before a major upgrade, run `sessionmem export` to keep a portable JSON copy of your memories that you can re-import if needed.

This policy applies to upgrades between published v1 releases. Each release opens existing databases through the same forward-only migration runner.

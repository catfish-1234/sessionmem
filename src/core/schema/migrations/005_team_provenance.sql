-- Team-mode provenance: record who authored each memory and, for
-- synced/shared rows, which project they originated in. Both columns are added
-- to the existing `memories` table without rewriting it so pre-existing rows
-- survive. `author` is NOT NULL with a DEFAULT '' sentinel because a
-- NOT NULL ADD COLUMN requires a default and the local OS username is not
-- available inside static SQL. `origin_project_id` is nullable and
-- only set on rows pulled in from another project's store.
--
-- Idempotency: SQLite has no `ADD COLUMN IF NOT EXISTS`. Re-running this
-- migration (only possible if the _migrations record was lost) throws
-- "duplicate column name", which runMigrations catches and treats as
-- already-applied. See src/core/schema/runMigrations.ts.
ALTER TABLE memories ADD COLUMN author TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN origin_project_id TEXT;

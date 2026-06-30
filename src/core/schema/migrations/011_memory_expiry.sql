-- Memory expiry: optional UTC ISO timestamp after which a memory is considered
-- expired and excluded from retrieval/listing. Added to the existing `memories`
-- table without rewriting it so pre-existing rows survive (NULL = never expires).
--
-- Idempotency: SQLite has no `ADD COLUMN IF NOT EXISTS`. Re-running this
-- migration (only possible if the _migrations record was lost) throws
-- "duplicate column name", which runMigrations catches and treats as
-- already-applied. See src/core/schema/runMigrations.ts.
ALTER TABLE memories ADD COLUMN expires_at TEXT;

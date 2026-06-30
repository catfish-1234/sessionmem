-- Memory tags: optional JSON-encoded string array for categorizing memories so
-- they can be filtered at retrieval time. Added to the existing `memories` table
-- without rewriting it so pre-existing rows survive (they get NULL tags).
--
-- Idempotency: SQLite has no `ADD COLUMN IF NOT EXISTS`. Re-running this
-- migration (only possible if the _migrations record was lost) throws
-- "duplicate column name", which runMigrations catches and treats as
-- already-applied. See src/core/schema/runMigrations.ts.
ALTER TABLE memories ADD COLUMN tags TEXT;

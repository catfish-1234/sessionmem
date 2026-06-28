-- Access-pattern boosting: track how often each memory is included in
-- retrieval output. access_count drives a read-time effective_importance
-- boost without mutating the stored importance score.
--
-- Idempotency: SQLite has no `ADD COLUMN IF NOT EXISTS`. Re-running this
-- migration (only possible if the _migrations record was lost) throws
-- "duplicate column name", which runMigrations catches and treats as
-- already-applied. See src/core/schema/runMigrations.ts.
ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed TEXT;

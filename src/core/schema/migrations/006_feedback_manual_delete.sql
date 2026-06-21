-- Allow 'manual_delete' feedback_type and new_importance = 0 for deletion records.
-- Remove FOREIGN KEY CASCADE so feedback rows survive when a memory is deleted.
-- SQLite requires table recreation to alter CHECK constraints and FK behavior.

CREATE TABLE IF NOT EXISTS memory_feedback_new (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('auto_use', 'manual', 'manual_delete')),
  previous_importance INTEGER NOT NULL CHECK (previous_importance >= 0 AND previous_importance <= 10),
  new_importance INTEGER NOT NULL CHECK (new_importance >= 0 AND new_importance <= 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO memory_feedback_new (id, memory_id, feedback_type, previous_importance, new_importance, created_at)
  SELECT id, memory_id, feedback_type, previous_importance, new_importance, created_at
  FROM memory_feedback;

DROP TABLE memory_feedback;

ALTER TABLE memory_feedback_new RENAME TO memory_feedback;

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory_created
ON memory_feedback(memory_id, created_at DESC);

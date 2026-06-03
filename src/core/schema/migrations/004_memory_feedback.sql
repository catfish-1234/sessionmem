CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('auto_use', 'manual')),
  previous_importance INTEGER NOT NULL CHECK (previous_importance >= 1 AND previous_importance <= 10),
  new_importance INTEGER NOT NULL CHECK (new_importance >= 1 AND new_importance <= 10),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory_created
ON memory_feedback(memory_id, created_at DESC);

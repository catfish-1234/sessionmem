CREATE TABLE IF NOT EXISTS summarization_failures (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  reason TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  last_error_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sum_fail_project_session
ON summarization_failures(project_id, session_id, updated_at DESC);

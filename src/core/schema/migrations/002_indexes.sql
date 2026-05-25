CREATE INDEX IF NOT EXISTS idx_memories_project_updated
  ON memories(project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memories_project_session
  ON memories(project_id, session_id);

CREATE INDEX IF NOT EXISTS idx_memories_project_importance
  ON memories(project_id, importance DESC);

CREATE INDEX IF NOT EXISTS idx_memories_project_created
  ON memories(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_events_project_session_event_index
  ON session_events(project_id, session_id, event_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_project_session_summary
  ON memories(project_id, session_id, kind)
  WHERE kind = 'summary';

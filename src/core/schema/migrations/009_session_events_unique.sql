-- Deduplicate session events by their logical key.
--
-- `ingestSessionEvents` is now reachable from agents (MCP tool) and CLI, so it
-- can be called more than once for the same session. The original index on
-- (project_id, session_id, event_index) was NOT unique, so re-ingesting the
-- same logical event with a fresh `id` silently created duplicate rows — which
-- then inflated session-event counts and the local-summarizer input.
--
-- Replace it with a UNIQUE index so `INSERT OR IGNORE` makes re-ingestion a
-- no-op. session_events has no production writer before this migration, so there
-- are no pre-existing duplicates to reconcile.
DROP INDEX IF EXISTS idx_session_events_project_session_event_index;

-- Remove duplicate rows before adding unique constraint.
-- Keep the row with the smallest rowid for each logical key.
DELETE FROM session_events
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM session_events
  GROUP BY project_id, session_id, event_index
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_project_session_event_index
  ON session_events(project_id, session_id, event_index);

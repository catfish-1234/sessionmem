import type { Database } from "better-sqlite3";
import type {
  InsertSessionEventInput,
  SessionEventRecord,
} from "./types.js";

export function insertSessionEvent(
  db: Database,
  input: InsertSessionEventInput,
): void {
  const stmt = db.prepare(`
    INSERT INTO session_events (
      id, project_id, session_id, event_index, event_type, payload_json, created_at
    ) VALUES (
      @id, @project_id, @session_id, @event_index, @event_type, @payload_json,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  stmt.run(input);
}

export function listSessionEventsBySession(
  db: Database,
  projectId: string,
  sessionId: string,
): SessionEventRecord[] {
  const stmt = db.prepare(`
    SELECT id, project_id, session_id, event_index, event_type, payload_json, created_at
    FROM session_events
    WHERE project_id = ? AND session_id = ?
    ORDER BY event_index ASC
  `);

  return stmt.all(projectId, sessionId) as SessionEventRecord[];
}

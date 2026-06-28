import type { Database, Statement } from "better-sqlite3";
import type {
  InsertSessionEventInput,
  SessionEventRecord,
} from "./types.js";

interface SessionEventsRepoStatements {
  insertEvent: Statement;
  listBySession: Statement;
  countAll: Statement;
}

const sessionEventsStmtCache = new WeakMap<Database, SessionEventsRepoStatements>();

function getSessionEventsStatements(db: Database): SessionEventsRepoStatements {
  let stmts = sessionEventsStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    // INSERT OR IGNORE so re-ingesting an event with the same logical key
    // (project_id, session_id, event_index) — now a UNIQUE index, migration 009
    // — is a no-op rather than a duplicate row or a PK error.
    insertEvent: db.prepare(`
    INSERT OR IGNORE INTO session_events (
      id, project_id, session_id, event_index, event_type, payload_json, created_at
    ) VALUES (
      @id, @project_id, @session_id, @event_index, @event_type, @payload_json,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `),
    listBySession: db.prepare(`
    SELECT id, project_id, session_id, event_index, event_type, payload_json, created_at
    FROM session_events
    WHERE project_id = ? AND session_id = ?
    ORDER BY event_index ASC
  `),
    countAll: db.prepare("SELECT COUNT(*) AS count FROM session_events WHERE project_id = ?"),
  };

  sessionEventsStmtCache.set(db, stmts);
  return stmts;
}

/**
 * Insert a session event. Returns the number of rows written (1, or 0 when the
 * (project_id, session_id, event_index) key already exists and the insert was
 * ignored).
 */
export function insertSessionEvent(
  db: Database,
  input: InsertSessionEventInput,
): number {
  return getSessionEventsStatements(db).insertEvent.run(input).changes;
}

export function countAllSessionEvents(db: Database, projectId: string): number {
  const row = getSessionEventsStatements(db).countAll.get(projectId) as { count: number };
  return row.count;
}

export function listSessionEventsBySession(
  db: Database,
  projectId: string,
  sessionId: string,
): SessionEventRecord[] {
  return getSessionEventsStatements(db).listBySession.all(projectId, sessionId) as SessionEventRecord[];
}

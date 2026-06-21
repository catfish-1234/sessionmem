import type { Database, Statement } from "better-sqlite3";
import type {
  InsertSessionEventInput,
  SessionEventRecord,
} from "./types.js";

interface SessionEventsRepoStatements {
  insertEvent: Statement;
  listBySession: Statement;
}

const sessionEventsStmtCache = new WeakMap<Database, SessionEventsRepoStatements>();

function getSessionEventsStatements(db: Database): SessionEventsRepoStatements {
  let stmts = sessionEventsStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    insertEvent: db.prepare(`
    INSERT INTO session_events (
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
  };

  sessionEventsStmtCache.set(db, stmts);
  return stmts;
}

export function insertSessionEvent(
  db: Database,
  input: InsertSessionEventInput,
): void {
  getSessionEventsStatements(db).insertEvent.run(input);
}

export function listSessionEventsBySession(
  db: Database,
  projectId: string,
  sessionId: string,
): SessionEventRecord[] {
  return getSessionEventsStatements(db).listBySession.all(projectId, sessionId) as SessionEventRecord[];
}

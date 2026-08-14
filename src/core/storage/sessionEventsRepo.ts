import type { Database, Statement } from "better-sqlite3";
import type {
  InsertSessionEventInput,
  SessionEventRecord,
} from "./types.js";

interface SessionEventsRepoStatements {
  insertEvent: Statement;
  listBySession: Statement;
  countAll: Statement;
  nextEventIndex: Statement;
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
    nextEventIndex: db.prepare(`
    SELECT COALESCE(MAX(event_index), -1) + 1 AS next
    FROM session_events
    WHERE project_id = ? AND session_id = ?
  `),
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

/**
 * Next free `event_index` for a session (max + 1, or 0 when the session has no
 * events yet).
 *
 * Callers that have no natural ordering key of their own (the PostToolUse hook
 * fires once per tool use, in separate processes) use this instead of inventing
 * one. A wall-clock index collides whenever two tool uses land in the same
 * millisecond — which parallel tool calls routinely do — and the UNIQUE index
 * on (project_id, session_id, event_index) then makes `INSERT OR IGNORE` drop
 * the loser silently. Must be called inside the same immediate transaction as
 * the insert so concurrent writers cannot read the same value.
 */
export function nextSessionEventIndex(
  db: Database,
  projectId: string,
  sessionId: string,
): number {
  const row = getSessionEventsStatements(db).nextEventIndex.get(
    projectId,
    sessionId,
  ) as { next: number };
  return row.next;
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

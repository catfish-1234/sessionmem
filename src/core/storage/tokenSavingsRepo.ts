import type { Database, Statement } from "better-sqlite3";

interface TokenSavingsRepoStatements {
  countDistinctSessions: Statement;
  listPayloads: Statement;
}

const tokenSavingsStmtCache = new WeakMap<Database, TokenSavingsRepoStatements>();

function getTokenSavingsStatements(db: Database): TokenSavingsRepoStatements {
  let stmts = tokenSavingsStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    countDistinctSessions: db.prepare(
      "SELECT COUNT(DISTINCT session_id) AS count FROM session_events WHERE project_id = ?"
    ),
    listPayloads: db.prepare(
      "SELECT payload_json FROM session_events WHERE project_id = ?"
    ),
  };

  tokenSavingsStmtCache.set(db, stmts);
  return stmts;
}

export function countDistinctSessions(db: Database, projectId: string): number {
  const row = getTokenSavingsStatements(db).countDistinctSessions.get(projectId) as { count: number };
  return row.count;
}

export function listEventPayloads(db: Database, projectId: string): string[] {
  const rows = getTokenSavingsStatements(db).listPayloads.all(projectId) as Array<{ payload_json: string }>;
  return rows.map(r => r.payload_json);
}

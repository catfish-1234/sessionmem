import type { Database } from "better-sqlite3";

export function countDistinctSessions(db: Database, projectId: string): number {
  const row = db.prepare(
    "SELECT COUNT(DISTINCT session_id) AS count FROM session_events WHERE project_id = ?"
  ).get(projectId) as { count: number };
  return row.count;
}

export function listEventPayloads(db: Database, projectId: string): string[] {
  const rows = db.prepare(
    "SELECT payload_json FROM session_events WHERE project_id = ?"
  ).all(projectId) as Array<{ payload_json: string }>;
  return rows.map(r => r.payload_json);
}

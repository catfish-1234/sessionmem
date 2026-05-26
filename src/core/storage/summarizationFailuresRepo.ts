import type { Database } from "better-sqlite3";
import type {
  InsertSummarizationFailureInput,
  SummarizationFailureRecord,
} from "./types.js";

function toParams(input: InsertSummarizationFailureInput) {
  return {
    ...input,
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
  };
}

export function insertSummarizationFailure(
  db: Database,
  input: InsertSummarizationFailureInput,
): void {
  const stmt = db.prepare(`
    INSERT INTO summarization_failures (
      id, project_id, session_id, source_adapter, reason, attempt_count, last_error_json, created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, @reason, @attempt_count, @last_error_json,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  stmt.run(toParams(input));
}

export function listSummarizationFailures(
  db: Database,
  projectId: string,
  sessionId?: string,
): SummarizationFailureRecord[] {
  if (sessionId) {
    const stmt = db.prepare(`
      SELECT
        id, project_id, session_id, source_adapter, reason, attempt_count, last_error_json, created_at, updated_at
      FROM summarization_failures
      WHERE project_id = ? AND session_id = ?
      ORDER BY updated_at DESC
    `);
    return stmt.all(projectId, sessionId) as SummarizationFailureRecord[];
  }

  const stmt = db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, reason, attempt_count, last_error_json, created_at, updated_at
    FROM summarization_failures
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `);

  return stmt.all(projectId) as SummarizationFailureRecord[];
}

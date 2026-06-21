import { randomUUID } from "node:crypto";
import type { Database, Statement } from "better-sqlite3";

export type MemoryFeedbackType = "auto_use" | "manual";

export interface InsertMemoryFeedbackEventInput {
  id?: string;
  memory_id: string;
  feedback_type: MemoryFeedbackType;
  previous_importance: number;
  new_importance: number;
  created_at?: string;
}

interface MemoryFeedbackRepoStatements {
  insertFeedback: Statement;
}

const feedbackStmtCache = new WeakMap<Database, MemoryFeedbackRepoStatements>();

function getFeedbackStatements(db: Database): MemoryFeedbackRepoStatements {
  let stmts = feedbackStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    insertFeedback: db.prepare(`
    INSERT INTO memory_feedback (
      id, memory_id, feedback_type, previous_importance, new_importance, created_at
    ) VALUES (
      @id, @memory_id, @feedback_type, @previous_importance, @new_importance,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `),
  };

  feedbackStmtCache.set(db, stmts);
  return stmts;
}

export function insertMemoryFeedbackEvent(
  db: Database,
  event: InsertMemoryFeedbackEventInput,
): void {
  getFeedbackStatements(db).insertFeedback.run({
    ...event,
    id: event.id ?? randomUUID(),
    created_at: event.created_at ?? null,
  });
}

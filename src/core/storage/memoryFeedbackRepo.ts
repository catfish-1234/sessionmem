import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";

export type MemoryFeedbackType = "auto_use" | "manual" | "manual_delete";

export interface InsertMemoryFeedbackEventInput {
  id?: string;
  memory_id: string;
  feedback_type: MemoryFeedbackType;
  previous_importance: number;
  new_importance: number;
  created_at?: string;
}

export function insertMemoryFeedbackEvent(
  db: Database,
  event: InsertMemoryFeedbackEventInput,
): void {
  const stmt = db.prepare(`
    INSERT INTO memory_feedback (
      id, memory_id, feedback_type, previous_importance, new_importance, created_at
    ) VALUES (
      @id, @memory_id, @feedback_type, @previous_importance, @new_importance,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  stmt.run({
    ...event,
    id: event.id ?? randomUUID(),
    created_at: event.created_at ?? null,
  });
}

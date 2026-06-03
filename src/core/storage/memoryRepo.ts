import type { Database } from "better-sqlite3";
import {
  insertMemoryFeedbackEvent,
  type MemoryFeedbackType,
} from "./memoryFeedbackRepo.js";
import type { InsertMemoryInput, MemoryRecord } from "./types.js";

function assertImportance(importance: number): void {
  if (importance < 1 || importance > 10) {
    throw new Error("importance must be between 1 and 10");
  }
}

function toParams(input: InsertMemoryInput) {
  return {
    ...input,
    embedding: input.embedding ?? null,
    embedding_dim: input.embedding_dim ?? null,
    embedding_version: input.embedding_version ?? null,
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
  };
}

export function insertMemory(db: Database, input: InsertMemoryInput): void {
  assertImportance(input.importance);

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  stmt.run(toParams(input));
}

export function upsertSessionSummaryMemory(
  db: Database,
  input: InsertMemoryInput,
): void {
  assertImportance(input.importance);

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, 'summary', @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
    ON CONFLICT(project_id, session_id, kind) WHERE kind = 'summary'
    DO UPDATE SET
      id = excluded.id,
      source_adapter = excluded.source_adapter,
      content = excluded.content,
      normalized_content = excluded.normalized_content,
      importance = excluded.importance,
      embedding = excluded.embedding,
      embedding_dim = excluded.embedding_dim,
      embedding_version = excluded.embedding_version,
      updated_at = COALESCE(excluded.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `);

  stmt.run(toParams({ ...input, kind: "summary" }));
}

export function listMemoriesByProject(
  db: Database,
  projectId: string,
): MemoryRecord[] {
  const stmt = db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, created_at, updated_at
    FROM memories
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `);

  return stmt.all(projectId) as MemoryRecord[];
}

export function updateMemoryImportance(
  db: Database,
  projectId: string,
  memoryId: string,
  nextImportance: number,
  usedAt?: string,
): void {
  assertImportance(nextImportance);

  const result = db
    .prepare(
      `
      UPDATE memories
      SET
        importance = ?,
        updated_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE project_id = ? AND id = ?
    `,
    )
    .run(nextImportance, usedAt ?? null, projectId, memoryId);

  if (result.changes === 0) {
    throw new Error(`Memory not found: ${memoryId}`);
  }
}

export interface RecordMemoryUseInput {
  project_id: string;
  memory_id: string;
  feedback_type?: MemoryFeedbackType;
  next_importance?: number;
  used_at?: string;
  feedback_id?: string;
}

export interface RecordMemoryUseResult {
  memory_id: string;
  previous_importance: number;
  new_importance: number;
}

export function recordUse(
  db: Database,
  input: RecordMemoryUseInput,
): RecordMemoryUseResult {
  const transaction = db.transaction((txInput: RecordMemoryUseInput) => {
    const memory = db
      .prepare(
        `
        SELECT id, importance
        FROM memories
        WHERE project_id = ? AND id = ?
        LIMIT 1
      `,
      )
      .get(txInput.project_id, txInput.memory_id) as
      | { id: string; importance: number }
      | undefined;

    if (!memory) {
      throw new Error(`Memory not found: ${txInput.memory_id}`);
    }

    const feedbackType = txInput.feedback_type ?? "auto_use";
    const nextImportance =
      txInput.next_importance ??
      (feedbackType === "auto_use"
        ? Math.min(memory.importance + 1, 9)
        : memory.importance);

    updateMemoryImportance(
      db,
      txInput.project_id,
      txInput.memory_id,
      nextImportance,
      txInput.used_at,
    );

    insertMemoryFeedbackEvent(db, {
      id: txInput.feedback_id,
      memory_id: txInput.memory_id,
      feedback_type: feedbackType,
      previous_importance: memory.importance,
      new_importance: nextImportance,
      created_at: txInput.used_at,
    });

    return {
      memory_id: txInput.memory_id,
      previous_importance: memory.importance,
      new_importance: nextImportance,
    };
  });

  return transaction(input);
}

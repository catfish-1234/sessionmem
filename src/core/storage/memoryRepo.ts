import type { Database } from "better-sqlite3";
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
    author: input.author ?? "",
    origin_project_id: input.origin_project_id ?? null,
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
  };
}

export function insertMemory(db: Database, input: InsertMemoryInput): void {
  assertImportance(input.importance);

  const stmt = db.prepare(`
    INSERT INTO memories (
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
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
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, 'summary', @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
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
      author = excluded.author,
      origin_project_id = excluded.origin_project_id,
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
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      access_count, last_accessed, created_at, updated_at
    FROM memories
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `);

  return stmt.all(projectId) as MemoryRecord[];
}

/**
 * All memory ids across every project. `id` is a globally-unique
 * PRIMARY KEY, so duplicate-skip checks in `import` must consider every
 * project's ids, not just the current project's, to surface cross-project id
 * collisions as "skipped" rather than silently importing them.
 */
export function listAllMemoryIds(db: Database): Set<string> {
  const rows = db.prepare("SELECT id FROM memories").all() as Array<{
    id: string;
  }>;
  return new Set(rows.map((r) => r.id));
}

export function countMemoriesOlderThan(
  db: Database,
  projectId: string,
  cutoffIso: string,
): number {
  // created_at is stored as strftime('%Y-%m-%dT%H:%M:%fZ') text; lexicographic
  // comparison against an ISO-8601 UTC cutoff is correct for this fixed format.
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM memories
      WHERE project_id = ? AND created_at < ?
    `,
    )
    .get(projectId, cutoffIso) as { count: number };

  return row.count;
}

export function deleteMemoriesOlderThan(
  db: Database,
  projectId: string,
  cutoffIso: string,
): number {
  // Hard-delete scoped to the memories table only; never touches
  // session_events or memory_feedback. project_id and cutoff are bound, never
  // string-concatenated, to prevent SQL injection.
  const result = db
    .prepare(
      `
      DELETE FROM memories
      WHERE project_id = ? AND created_at < ?
    `,
    )
    .run(projectId, cutoffIso);

  return result.changes;
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

/**
 * Count the number of memories stored under a given session_id across all
 * projects. Used to enforce per-session write soft limits — the count is
 * checked before each storeMemory call and a warning is surfaced when the
 * threshold is reached.
 */
export function countMemoriesBySession(
  db: Database,
  sessionId: string,
): number {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM memories
      WHERE session_id = ?
    `,
    )
    .get(sessionId) as { count: number };

  return row.count;
}


export function updateMemoryContent(
  db: Database,
  projectId: string,
  memoryId: string,
  newContent: string,
  newNormalizedContent?: string,
): void {
  // All values are bound parameters to prevent SQL injection.
  // normalized_content is only overwritten when a new value is supplied.
  const result = db
    .prepare(
      `
      UPDATE memories
      SET
        content = ?,
        normalized_content = COALESCE(?, normalized_content),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?
    `,
    )
    .run(newContent, newNormalizedContent ?? null, projectId, memoryId);

  if (result.changes === 0) {
    throw new Error(`Memory not found: ${memoryId}`);
  }
}

export function incrementAccessCounts(
  db: Database,
  projectId: string,
  memoryIds: string[],
  accessedAt?: string,
): void {
  if (memoryIds.length === 0) return;

  const stmt = db.prepare(`
    UPDATE memories
    SET
      access_count = access_count + 1,
      last_accessed = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    WHERE project_id = ? AND id = ?
  `);

  const run = db.transaction(() => {
    for (const id of memoryIds) {
      stmt.run(accessedAt ?? null, projectId, id);
    }
  });

  run();
}

export function resetAccessCounts(
  db: Database,
  projectId: string,
): number {
  const result = db
    .prepare(
      `
      UPDATE memories
      SET access_count = 0, last_accessed = NULL
      WHERE project_id = ?
    `,
    )
    .run(projectId);

  return result.changes;
}


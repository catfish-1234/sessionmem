import type { Database, Statement } from "better-sqlite3";
import type { InsertMemoryInput, MemoryRecord } from "./types.js";

interface MemoryRepoStatements {
  insertMemory: Statement;
  upsertSessionSummary: Statement;
  listByProject: Statement;
  listAllIds: Statement;
  countOlderThan: Statement;
  deleteOlderThan: Statement;
  updateImportance: Statement;
  updateContent: Statement;
  selectForRecordUse: Statement;
}

const stmtCache = new WeakMap<Database, MemoryRepoStatements>();

function getStatements(db: Database): MemoryRepoStatements {
  let stmts = stmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    insertMemory: db.prepare(`
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
  `),
    upsertSessionSummary: db.prepare(`
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
  `),
    listByProject: db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      access_count, last_accessed, created_at, updated_at
    FROM memories
    WHERE project_id = ?
    ORDER BY updated_at DESC
  `),
    listAllIds: db.prepare("SELECT id FROM memories"),
    countOlderThan: db.prepare(`
      SELECT COUNT(*) AS count
      FROM memories
      WHERE project_id = ? AND created_at < ?
    `),
    deleteOlderThan: db.prepare(`
      DELETE FROM memories
      WHERE project_id = ? AND created_at < ?
    `),
    updateImportance: db.prepare(`
      UPDATE memories
      SET
        importance = ?,
        updated_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE project_id = ? AND id = ?
    `),
    updateContent: db.prepare(`
      UPDATE memories
      SET
        content = ?,
        normalized_content = COALESCE(?, normalized_content),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?
    `),
    selectForRecordUse: db.prepare(`
        SELECT id, importance
        FROM memories
        WHERE project_id = ? AND id = ?
        LIMIT 1
      `),
  };

  stmtCache.set(db, stmts);
  return stmts;
}

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
  getStatements(db).insertMemory.run(toParams(input));
}

export function upsertSessionSummaryMemory(
  db: Database,
  input: InsertMemoryInput,
): void {
  assertImportance(input.importance);
  getStatements(db).upsertSessionSummary.run(toParams({ ...input, kind: "summary" }));
}

export function listMemoriesByProject(
  db: Database,
  projectId: string,
): MemoryRecord[] {
  return getStatements(db).listByProject.all(projectId) as MemoryRecord[];
}

/**
 * All memory ids across every project. `id` is a globally-unique
 * PRIMARY KEY, so duplicate-skip checks in `import` must consider every
 * project's ids, not just the current project's, to surface cross-project id
 * collisions as "skipped" rather than silently importing them.
 */
export function listAllMemoryIds(db: Database): Set<string> {
  const rows = getStatements(db).listAllIds.all() as Array<{
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
  const row = getStatements(db).countOlderThan.get(projectId, cutoffIso) as { count: number };
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
  const result = getStatements(db).deleteOlderThan.run(projectId, cutoffIso);
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

  const result = getStatements(db).updateImportance.run(
    nextImportance,
    usedAt ?? null,
    projectId,
    memoryId,
  );

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
<<<<<<< HEAD
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
=======
  // In-place content rewrite for the one-time redaction scrub. All
  // values are bound parameters — projectId, memoryId, and content are never
  // string-concatenated — mirroring updateMemoryImportance to prevent SQL
  // injection. normalized_content is only overwritten when a new
  // value is supplied so embeddings stay consistent with the redacted text.
  const result = getStatements(db).updateContent.run(
    newContent,
    newNormalizedContent ?? null,
    projectId,
    memoryId,
  );
>>>>>>> worktree-agent-ac22372c2a068f977

  if (result.changes === 0) {
    throw new Error(`Memory not found: ${memoryId}`);
  }
}

export function incrementAccessCounts(
  db: Database,
<<<<<<< HEAD
  projectId: string,
  memoryIds: string[],
  accessedAt?: string,
): void {
  if (memoryIds.length === 0) return;
=======
  input: RecordMemoryUseInput,
): RecordMemoryUseResult {
  const transaction = db.transaction((txInput: RecordMemoryUseInput) => {
    const stmts = getStatements(db);
    const memory = stmts.selectForRecordUse.get(txInput.project_id, txInput.memory_id) as
      | { id: string; importance: number }
      | undefined;
>>>>>>> worktree-agent-ac22372c2a068f977

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


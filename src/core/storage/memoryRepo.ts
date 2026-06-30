import type { Database, Statement } from "better-sqlite3";
import type { InsertMemoryInput, MemoryRecord } from "./types.js";

interface MemoryRepoStatements {
  insertMemory: Statement;
  upsertSessionSummary: Statement;
  importUpsert: Statement;
  pullUpsert: Statement;
  listByProject: Statement;
  listContentByProject: Statement;
  listAllIds: Statement;
  selectById: Statement;
  selectOwner: Statement;
  deleteById: Statement;
  countOlderThan: Statement;
  deleteOlderThan: Statement;
  updateImportance: Statement;
  updateContent: Statement;
  selectForRecordUse: Statement;
  incrementAccess: Statement;
  resetAccess: Statement;
  countBySession: Statement;
  countAll: Statement;
  countStaleEmbeddings: Statement;
}

// Shared INSERT ... ON CONFLICT(id) upsert column lists. The import and team-pull
// paths differ only in how they resolve `importance` on conflict (import takes the
// incoming value; pull preserves MAX(local, incoming)), so the surrounding SQL is
// factored out to keep the two prepared statements byte-for-byte aligned.
const UPSERT_INSERT_HEAD = `
  INSERT INTO memories (
    id, project_id, session_id, source_adapter, kind, content, normalized_content,
    importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
    tags, expires_at,
    created_at, updated_at
  ) VALUES (
    @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
    @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
    @tags, @expires_at,
    COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )
  ON CONFLICT(id) DO UPDATE SET
    project_id = excluded.project_id,
    session_id = excluded.session_id,
    source_adapter = excluded.source_adapter,
    kind = excluded.kind,
    content = excluded.content,
    normalized_content = excluded.normalized_content,`;

const UPSERT_INSERT_TAIL = `
    embedding = excluded.embedding,
    embedding_dim = excluded.embedding_dim,
    embedding_version = excluded.embedding_version,
    author = excluded.author,
    origin_project_id = excluded.origin_project_id,
    tags = excluded.tags,
    expires_at = excluded.expires_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at
`;

const stmtCache = new WeakMap<Database, MemoryRepoStatements>();

function getStatements(db: Database): MemoryRepoStatements {
  let stmts = stmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    insertMemory: db.prepare(`
    INSERT INTO memories (
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      tags, expires_at,
      created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, @kind, @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
      @tags, @expires_at,
      COALESCE(@created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      COALESCE(@updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `),
    upsertSessionSummary: db.prepare(`
    INSERT INTO memories (
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      tags, expires_at,
      created_at, updated_at
    ) VALUES (
      @id, @project_id, @session_id, @source_adapter, 'summary', @content, @normalized_content,
      @importance, @embedding, @embedding_dim, @embedding_version, @author, @origin_project_id,
      @tags, @expires_at,
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
      tags = excluded.tags,
      expires_at = excluded.expires_at,
      updated_at = COALESCE(excluded.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id)
    DO UPDATE SET
      project_id = excluded.project_id,
      session_id = excluded.session_id,
      source_adapter = excluded.source_adapter,
      content = excluded.content,
      normalized_content = excluded.normalized_content,
      importance = excluded.importance,
      embedding = excluded.embedding,
      embedding_dim = excluded.embedding_dim,
      embedding_version = excluded.embedding_version,
      author = excluded.author,
      origin_project_id = excluded.origin_project_id,
      tags = excluded.tags,
      expires_at = excluded.expires_at,
      updated_at = COALESCE(excluded.updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `),
    listByProject: db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
      tags, expires_at,
      access_count, last_accessed, created_at, updated_at
    FROM memories
    WHERE project_id = ?
      AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ORDER BY updated_at DESC
  `),
    // Lightweight projection for token-savings accounting: only `content` is
    // needed to count tokens, so we deliberately avoid pulling the (potentially
    // multi-KB) embedding JSON and normalized_content for every row. Matters for
    // large projects where `savings` would otherwise load the whole table.
    listContentByProject: db.prepare(
      "SELECT content FROM memories WHERE project_id = ?",
    ),
    importUpsert: db.prepare(
      `${UPSERT_INSERT_HEAD}\n    importance = excluded.importance,${UPSERT_INSERT_TAIL}`,
    ),
    // Importance-preserving merge for team pulls: a teammate can never lower a
    // locally-boosted importance. better-sqlite3@12 bundles a SQLite that accepts
    // the two-arg scalar MAX() inside DO UPDATE.
    pullUpsert: db.prepare(
      `${UPSERT_INSERT_HEAD}\n    importance = MAX(memories.importance, excluded.importance),${UPSERT_INSERT_TAIL}`,
    ),
    listAllIds: db.prepare("SELECT id FROM memories"),
    selectById: db.prepare(`
      SELECT
        id, project_id, session_id, source_adapter, kind, content, normalized_content,
        importance, embedding, embedding_dim, embedding_version, author, origin_project_id,
        tags, expires_at,
        access_count, last_accessed, created_at, updated_at
      FROM memories
      WHERE project_id = ? AND id = ?
      LIMIT 1
    `),
    selectOwner: db.prepare("SELECT project_id FROM memories WHERE id = ?"),
    deleteById: db.prepare("DELETE FROM memories WHERE project_id = ? AND id = ?"),
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
        embedding = COALESCE(?, embedding),
        embedding_dim = COALESCE(?, embedding_dim),
        embedding_version = COALESCE(?, embedding_version),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE project_id = ? AND id = ?
    `),
    selectForRecordUse: db.prepare(`
        SELECT id, importance
        FROM memories
        WHERE project_id = ? AND id = ?
        LIMIT 1
      `),
    incrementAccess: db.prepare(`
      UPDATE memories
      SET
        access_count = access_count + 1,
        last_accessed = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      WHERE project_id = ? AND id = ?
    `),
    resetAccess: db.prepare(`
      UPDATE memories
      SET access_count = 0, last_accessed = NULL
      WHERE project_id = ?
    `),
    countBySession: db.prepare(`
      SELECT COUNT(*) AS count
      FROM memories
      WHERE session_id = ? AND project_id = ?
    `),
    countAll: db.prepare("SELECT COUNT(*) AS count FROM memories WHERE project_id = ?"),
    // Memories whose stored embedding does not match the supplied current
    // embedding version (NULL counts as stale). Used to surface a re-embed
    // hint; the actual re-embed is the `sessionmem re-embed` command.
    countStaleEmbeddings: db.prepare(`
      SELECT COUNT(*) AS count
      FROM memories
      WHERE project_id = ?
        AND (embedding_version IS NULL OR embedding_version != ?)
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
    tags: input.tags ?? null,
    expires_at: input.expires_at ?? null,
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

/**
 * Upsert a memory imported from an external export. On `id` conflict the incoming
 * record wins on every column (including importance). Cross-project ownership
 * collisions are filtered by the caller via {@link getMemoryOwnerProjectId} before
 * this runs, so this never reassigns another project's row.
 */
export function upsertImportedMemory(db: Database, input: InsertMemoryInput): void {
  assertImportance(input.importance);
  getStatements(db).importUpsert.run(toParams(input));
}

/**
 * Upsert a memory pulled from a teammate. Identical to {@link upsertImportedMemory}
 * except importance is merged as MAX(local, incoming) so a pull can never lower a
 * locally-boosted importance.
 */
export function upsertPulledMemory(db: Database, input: InsertMemoryInput): void {
  assertImportance(input.importance);
  getStatements(db).pullUpsert.run(toParams(input));
}

export function listMemoriesByProject(
  db: Database,
  projectId: string,
): MemoryRecord[] {
  return getStatements(db).listByProject.all(projectId) as MemoryRecord[];
}

/**
 * Return just the `content` of every memory in a project. Used by the
 * token-savings command, which only needs `content` to count tokens and must
 * not pay to load embedding JSON / normalized_content for the whole table.
 */
export function listMemoryContentsByProject(
  db: Database,
  projectId: string,
): string[] {
  const rows = getStatements(db).listContentByProject.all(projectId) as Array<{
    content: string;
  }>;
  return rows.map((r) => r.content);
}

/**
 * Fetch a single memory row scoped to a project. Returns undefined when no row
 * matches (caller maps that to NOT_FOUND). Uses a WeakMap-cached prepared
 * statement — this is a high-frequency path (every store/get/forget and each
 * batch item re-reads the inserted row).
 */
export function getMemoryRecordById(
  db: Database,
  projectId: string,
  memoryId: string,
): MemoryRecord | undefined {
  return getStatements(db).selectById.get(projectId, memoryId) as
    | MemoryRecord
    | undefined;
}

/**
 * Resolve the project that currently owns a globally-unique memory `id`, or
 * undefined when the id is unused. Import/pull use this to skip (never overwrite)
 * an id already owned by a different project.
 */
export function getMemoryOwnerProjectId(
  db: Database,
  memoryId: string,
): string | undefined {
  const row = getStatements(db).selectOwner.get(memoryId) as
    | { project_id: string }
    | undefined;
  return row?.project_id;
}

/**
 * Hard-delete a single memory scoped to a project. Returns the number of rows
 * removed (0 when the id does not exist in this project).
 */
export function deleteMemoryById(
  db: Database,
  projectId: string,
  memoryId: string,
): number {
  return getStatements(db).deleteById.run(projectId, memoryId).changes;
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

// NOTE: no MCP tool, CLI command, or service method currently calls this. It is
// retained as intentional repository API surface (the importance-update
// counterpart to updateMemoryContent) for a future importance-adjustment tool,
// not forgotten code. The `updateImportance` prepared statement above is wired
// solely for this function. Keep or remove deliberately — do not delete on a
// "looks unused" pass.
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
 * Count all memories stored in a project. Used to enforce per-session write
 * soft limits — the count is
 * checked before each storeMemory call and a warning is surfaced when the
 * threshold is reached.
 */
export function countAllMemoriesByProject(db: Database, projectId: string): number {
  const row = getStatements(db).countAll.get(projectId) as { count: number };
  return row.count;
}

export function countMemoriesBySession(
  db: Database,
  sessionId: string,
  projectId: string,
): number {
  const row = getStatements(db).countBySession.get(sessionId, projectId) as { count: number };
  return row.count;
}

/**
 * Count memories in a project whose embedding version differs from
 * `currentVersion` (NULL counts as stale). Drives the startup re-embed hint;
 * the fix is the `sessionmem re-embed` command.
 */
export function countStaleEmbeddings(
  db: Database,
  projectId: string,
  currentVersion: string,
): number {
  const row = getStatements(db).countStaleEmbeddings.get(
    projectId,
    currentVersion,
  ) as { count: number };
  return row.count;
}


export function updateMemoryContent(
  db: Database,
  projectId: string,
  memoryId: string,
  newContent: string,
  newNormalizedContent?: string,
  // Optional re-embedding: when content is rewritten (e.g. a redactExisting
  // scrub) the stored embedding vector — computed from the PRE-edit text —
  // becomes stale and inconsistent with the new normalized_content. Pass the
  // recomputed embedding so the vector tracks the redacted text; omit to leave
  // the existing embedding untouched (COALESCE keeps the prior value on null).
  newEmbedding?: { vector: number[]; dimension: number; embeddingVersion: string },
): void {
  const result = getStatements(db).updateContent.run(
    newContent,
    newNormalizedContent ?? null,
    newEmbedding ? JSON.stringify(newEmbedding.vector) : null,
    newEmbedding?.dimension ?? null,
    newEmbedding?.embeddingVersion ?? null,
    projectId,
    memoryId,
  );

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

  const stmt = getStatements(db).incrementAccess;

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
  const result = getStatements(db).resetAccess.run(projectId);
  return result.changes;
}


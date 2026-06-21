import type { Database, Statement } from "better-sqlite3";

import { MAX_SEMANTIC_CANDIDATES } from "../config/policyConfig.js";
import { EMBEDDING_VERSION } from "../embed/embeddingVersion.js";

export interface MemorySearchCandidate {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  kind: string;
  content: string;
  normalized_content: string;
  importance: number;
  author: string;
  origin_project_id: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
  embedding: number[] | null;
  embedding_dim: number | null;
  embedding_version: string | null;
}

interface MemorySearchRow {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  kind: string;
  content: string;
  normalized_content: string;
  importance: number;
  author: string;
  origin_project_id: string | null;
  access_count: number;
  created_at: string;
  updated_at: string;
  embedding: string | null;
  embedding_dim: number | null;
  embedding_version: string | null;
}

const FTS_CANDIDATE_LIMIT = 50;
const FTS_FALLBACK_THRESHOLD = 5;

interface SearchRepoStatements {
  searchCandidates: Statement;
  searchCandidatesFTS: Statement;
}

const searchStmtCache = new WeakMap<Database, SearchRepoStatements>();

function getSearchStatements(db: Database): SearchRepoStatements {
  let stmts = searchStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    // TODO: Opt 3 will replace this LIMIT with importance/date WHERE clause
    searchCandidates: db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, author, origin_project_id, access_count, created_at, updated_at,
      embedding, embedding_dim, embedding_version
    FROM memories
    WHERE project_id = ?
    ORDER BY importance DESC, updated_at DESC
    LIMIT ?
  `),
    searchCandidatesFTS: db.prepare(`
    SELECT
      m.id, m.project_id, m.session_id, m.source_adapter, m.kind, m.content,
      m.normalized_content, m.importance, m.author, m.origin_project_id,
      m.access_count, m.created_at, m.updated_at,
      m.embedding, m.embedding_dim, m.embedding_version
    FROM memories_fts
    JOIN memories m ON m.rowid = memories_fts.rowid
    WHERE memories_fts MATCH ?
      AND m.project_id = ?
    ORDER BY rank
    LIMIT ?
  `),
  };

  searchStmtCache.set(db, stmts);
  return stmts;
}

function parseEmbedding(value: string | null): number[] | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed) || !parsed.every((item) => Number.isFinite(item))) {
      return null;
    }

    return parsed as number[];
  } catch {
    return null;
  }
}

function mapRows(rows: MemorySearchRow[]): MemorySearchCandidate[] {
  return rows.map((row) => {
    const parsed = parseEmbedding(row.embedding);
    // Nullify embedding when the stored version doesn't match the current
    // model version — stale embeddings produce meaningless cosine similarity.
    const versionMatch = row.embedding_version === EMBEDDING_VERSION;
    return {
      ...row,
      embedding: versionMatch ? parsed : null,
    };
  });
}

export function searchMemoryCandidates(
  db: Database,
  projectId: string,
): MemorySearchCandidate[] {
  const rows = getSearchStatements(db).searchCandidates.all(projectId, MAX_SEMANTIC_CANDIDATES) as MemorySearchRow[];
  return mapRows(rows);
}

/**
 * Sanitize query text for FTS5 MATCH syntax.
 * Wraps each non-empty token in double quotes so special characters
 * (colons, hyphens, parentheses, etc.) are treated as literals.
 * Tokens are joined with implicit AND.
 */
function sanitizeFtsQuery(queryText: string): string {
  return queryText
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" ");
}

/**
 * Pre-filter candidates using FTS5 full-text search before cosine similarity.
 * Returns top-50 candidates by FTS rank. Falls back to full
 * searchMemoryCandidates when FTS returns fewer than 5 results
 * (poor keyword overlap).
 */
export function searchMemoryCandidatesFTS(
  db: Database,
  projectId: string,
  queryText: string,
): MemorySearchCandidate[] {
  const sanitized = sanitizeFtsQuery(queryText);
  if (!sanitized) {
    return searchMemoryCandidates(db, projectId);
  }

  let rows: MemorySearchRow[];
  try {
    rows = getSearchStatements(db).searchCandidatesFTS.all(
      sanitized,
      projectId,
      FTS_CANDIDATE_LIMIT,
    ) as MemorySearchRow[];
  } catch {
    // FTS5 MATCH can throw on malformed queries — fall back to full scan
    return searchMemoryCandidates(db, projectId);
  }

  if (rows.length < FTS_FALLBACK_THRESHOLD) {
    return searchMemoryCandidates(db, projectId);
  }

  return mapRows(rows);
}

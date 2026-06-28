import type { Database, Statement } from "better-sqlite3";

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
    searchCandidates: db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, author, origin_project_id, access_count, created_at, updated_at,
      embedding, embedding_dim, embedding_version
    FROM memories
    WHERE project_id = ?
      AND (
        importance >= 8
        OR updated_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')
      )
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

function dedupById(candidates: MemorySearchCandidate[]): MemorySearchCandidate[] {
  // Defensive — FTS should not emit duplicates, but this guards backfill
  // corruption (e.g. a double-run 008 migration) from inflating results.
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function mapRows(rows: MemorySearchRow[]): MemorySearchCandidate[] {
  return rows.map((row) => {
    const parsed = parseEmbedding(row.embedding);
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
  const rows = getSearchStatements(db).searchCandidates.all(projectId) as MemorySearchRow[];
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
 * Returns up to FTS_CANDIDATE_LIMIT candidates.
 *
 * FTS keyword overlap can be sparse, so the fallback recency/importance scan is
 * UNIONed with (never substituted for) the FTS hits:
 *  - >= FTS_FALLBACK_THRESHOLD FTS hits: use the FTS hits as-is (well-matched).
 *  - 0 FTS hits: use the fallback scan only.
 *  - 1..threshold-1 FTS hits: UNION the FTS hits with the fallback scan,
 *    deduplicated by id (FTS hits first), capped at FTS_CANDIDATE_LIMIT.
 *
 * The previous behavior REPLACED a small FTS hit set with the fallback scan,
 * which silently dropped genuine matches that were old (>90d) and low-importance
 * (<8) — exactly the rows the fallback's filter excludes — returning zero
 * candidates for a query that matched only such rows.
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

  if (rows.length >= FTS_FALLBACK_THRESHOLD) {
    return dedupById(mapRows(rows));
  }

  const fallback = searchMemoryCandidates(db, projectId);
  if (rows.length === 0) {
    return fallback;
  }

  // UNION FTS hits (first) with the fallback scan, deduplicated by id and
  // capped at the same total limit FTS would have returned.
  const ftsHits = mapRows(rows);
  const seen = new Set<string>(ftsHits.map((candidate) => candidate.id));
  const merged = [...ftsHits];
  for (const candidate of fallback) {
    if (merged.length >= FTS_CANDIDATE_LIMIT) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    merged.push(candidate);
  }
  return merged;
}

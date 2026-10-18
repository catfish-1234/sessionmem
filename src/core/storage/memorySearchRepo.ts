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
  /** Positive BM25 relevance; zero for rows from the fallback scan. */
  lexical_score: number;
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
  lexical_score?: number;
  embedding: string | null;
  embedding_dim: number | null;
  embedding_version: string | null;
}

const FTS_CANDIDATE_LIMIT = 50;
const FTS_FALLBACK_THRESHOLD = 5;

/** Recency window for the fallback candidate scan. */
const FALLBACK_RECENCY_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Storage timestamp format: ISO-8601 UTC with millisecond precision. */
function toStorageTimestamp(date: Date): string {
  return date.toISOString();
}

interface SearchRepoStatements {
  searchCandidates: Statement;
  searchCandidatesFTS: Statement;
}

const searchStmtCache = new WeakMap<Database, SearchRepoStatements>();

function getSearchStatements(db: Database): SearchRepoStatements {
  let stmts = searchStmtCache.get(db);
  if (stmts) return stmts;

  stmts = {
    // `now` and the recency cutoff are bound parameters rather than
    // strftime('now') so the caller's clock drives both filters. With SQL's own
    // clock, a caller that passes an explicit `now` (retrieveMemories, and every
    // test that pins a date) silently got a different window than it asked for,
    // and fixed-date fixtures aged out of the 90-day band over real calendar
    // time — turning deterministic tests into time bombs.
    searchCandidates: db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, author, origin_project_id, access_count, created_at, updated_at,
      embedding, embedding_dim, embedding_version
    FROM memories
    WHERE project_id = @projectId
      AND (expires_at IS NULL OR expires_at > @now)
      AND (
        importance >= 8
        OR updated_at > @recencyCutoff
      )
  `),
    searchCandidatesFTS: db.prepare(`
    SELECT
      m.id, m.project_id, m.session_id, m.source_adapter, m.kind, m.content,
      m.normalized_content, m.importance, m.author, m.origin_project_id,
      m.access_count, m.created_at, m.updated_at,
      m.embedding, m.embedding_dim, m.embedding_version,
      -bm25(memories_fts) AS lexical_score
    FROM memories_fts
    JOIN memories m ON m.rowid = memories_fts.rowid
    WHERE memories_fts MATCH @match
      AND m.project_id = @projectId
      AND (m.expires_at IS NULL OR m.expires_at > @now)
    ORDER BY rank, m.id
    LIMIT @limit
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
      lexical_score: row.lexical_score ?? 0,
      embedding: versionMatch ? parsed : null,
    };
  });
}

export function searchMemoryCandidates(
  db: Database,
  projectId: string,
  now: Date = new Date(),
): MemorySearchCandidate[] {
  const rows = getSearchStatements(db).searchCandidates.all({
    projectId,
    now: toStorageTimestamp(now),
    recencyCutoff: toStorageTimestamp(
      new Date(now.getTime() - FALLBACK_RECENCY_DAYS * MS_PER_DAY),
    ),
  }) as MemorySearchRow[];
  return mapRows(rows);
}

const QUERY_STOP_WORDS = new Set(
  ("a an and are as at be been being but by can could did do does doing for from " +
    "had has have he her hers herself him himself his how i if in into is it its itself " +
    "me my myself of on or our ours ourselves she should so than that the their theirs " +
    "them themselves then there these they this those to too us was we were what when " +
    "where which who whom why will with would you your yours yourself yourselves " +
    "s t don doesn didn isn wasn weren won wouldn couldn shouldn").split(" "),
);

/** Match any meaningful query term; question grammar must not exclude evidence. */
function sanitizeFtsQuery(queryText: string): string {
  const tokens = [...new Set(
    queryText.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  )];
  const terms = tokens.filter((token) => !QUERY_STOP_WORDS.has(token));
  // Preserve literal searches consisting entirely of stop words. Tokens contain
  // only letters/numbers, so FTS operators and punctuation cannot become syntax.
  return (terms.length ? terms : tokens)
    .slice(0, 64)
    .map((token) => `"${token}"`)
    .join(" OR ");
}

/**
 * Retrieve BM25-ranked lexical candidates, including stored summaries.
 * Returns up to FTS_CANDIDATE_LIMIT matches with deterministic ID tie breaks.
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
  now: Date = new Date(),
): MemorySearchCandidate[] {
  const sanitized = sanitizeFtsQuery(queryText);
  if (!sanitized) {
    return searchMemoryCandidates(db, projectId, now);
  }

  let rows: MemorySearchRow[];
  try {
    rows = getSearchStatements(db).searchCandidatesFTS.all({
      match: sanitized,
      projectId,
      now: toStorageTimestamp(now),
      limit: FTS_CANDIDATE_LIMIT,
    }) as MemorySearchRow[];
  } catch {
    // FTS5 MATCH can throw on malformed queries — fall back to full scan
    return searchMemoryCandidates(db, projectId, now);
  }

  if (rows.length >= FTS_FALLBACK_THRESHOLD) {
    return dedupById(mapRows(rows));
  }

  const fallback = searchMemoryCandidates(db, projectId, now);
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

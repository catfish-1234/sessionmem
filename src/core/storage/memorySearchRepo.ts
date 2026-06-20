import type { Database } from "better-sqlite3";

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

export function searchMemoryCandidates(
  db: Database,
  projectId: string,
): MemorySearchCandidate[] {
  const stmt = db.prepare(`
    SELECT
      id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, author, origin_project_id, access_count, created_at, updated_at,
      embedding, embedding_dim, embedding_version
    FROM memories
    WHERE project_id = ?
  `);

  const rows = stmt.all(projectId) as MemorySearchRow[];

  return rows.map((row) => ({
    ...row,
    embedding: parseEmbedding(row.embedding),
  }));
}

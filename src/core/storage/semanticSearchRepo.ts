import type { Database } from "better-sqlite3";
import type { ScopeFilter } from "../scopes.js";
import type { LocalSemanticEmbedder } from "../embed/localSemanticEmbedder.js";
import { searchMemoryCandidatesByIds, type MemorySearchCandidate } from "./memorySearchRepo.js";

export interface SemanticCandidate {
  candidate: MemorySearchCandidate;
  similarity: number;
}

function normalize(vector: number[], dimension: number): number[] {
  if (vector.length !== dimension || !vector.every(Number.isFinite)) throw new Error("Invalid local embedding");
  const norm = Math.hypot(...vector);
  if (!norm) throw new Error("Empty local embedding");
  return vector.map(v => v / norm);
}

/** Backfill from stored text after normal capture policy; never raw capture input. */
export async function indexSemanticMemories(db: Database, projectId: string, embedder: LocalSemanticEmbedder, memoryId?: string, filter?: ScopeFilter): Promise<void> {
  const rows = db.prepare(`SELECT m.id, m.content FROM memories m
    WHERE m.project_id = ? AND (? IS NULL OR m.id = ?) AND NOT EXISTS (SELECT 1 FROM semantic_embeddings s
      WHERE s.memory_id = m.id AND s.model = ? AND s.dimension = ?)
      ${filter ? "AND m.scope IS ?" : ""}`)
    .all(projectId, memoryId ?? null, memoryId ?? null, embedder.id, embedder.dimension, ...(filter ? [filter.scope] : [])) as Array<{ id: string; content: string }>;
  const insert = db.prepare(`INSERT OR REPLACE INTO semantic_embeddings(memory_id, model, dimension, vector)
    SELECT id, @model, @dimension, @vector FROM memories
    WHERE id = @id AND project_id = @project AND content = @content`);
  for (const row of rows) {
    const vector = normalize(await embedder.embed(row.content), embedder.dimension);
    const bytes = Buffer.alloc(vector.length * 4);
    vector.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
    // A concurrent edit/delete during inference must not install stale vectors.
    insert.run({ ...row, model: embedder.id, dimension: embedder.dimension, vector: bytes, project: projectId });
  }
}

/** Exact local cosine scan. Appropriate to small project stores; no ANN service. */
export async function searchSemanticMemories(db: Database, projectId: string, query: string,
  now: Date, includeHistory: boolean, embedder: LocalSemanticEmbedder, filter?: ScopeFilter): Promise<SemanticCandidate[]> {
  await indexSemanticMemories(db, projectId, embedder, undefined, filter);
  const vector = normalize(await embedder.embed(query), embedder.dimension);
  const rows = db.prepare(`SELECT s.memory_id, s.vector FROM semantic_embeddings s JOIN memories m ON m.id = s.memory_id
    WHERE m.project_id = @project AND s.model = @model AND s.dimension = @dimension
      AND (m.expires_at IS NULL OR m.expires_at > @now)
      AND (@history = 1 OR m.id NOT IN (SELECT memory_id FROM superseded_memories))
      ${filter ? "AND m.scope IS @scope" : ""}`)
    .all({ project: projectId, model: embedder.id, dimension: embedder.dimension, now: now.toISOString(), history: Number(includeHistory), scope: filter?.scope ?? null }) as Array<{ memory_id: string; vector: Buffer }>;
  const scored = [];
  for (const row of rows) {
    if (row.vector.length !== vector.length * 4) continue;
    let similarity = 0, norm = 0;
    for (let i = 0; i < vector.length; i++) {
      const value = row.vector.readFloatLE(i * 4);
      similarity += value * vector[i]; norm += value * value;
    }
    if (Number.isFinite(similarity) && norm > 0) scored.push({ id: row.memory_id, similarity: Math.max(-1, Math.min(1, similarity / Math.sqrt(norm))) });
  }
  scored.sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id));
  const top = scored.slice(0, 50);
  const candidates = new Map(searchMemoryCandidatesByIds(db, projectId, top.map(r => r.id), now, includeHistory, filter).map(c => [c.id, c]));
  return top.flatMap(row => {
    const candidate = candidates.get(row.id);
    return candidate ? [{ candidate, similarity: row.similarity }] : [];
  });
}

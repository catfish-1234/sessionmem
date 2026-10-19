import type { Database } from "better-sqlite3";

export interface TemporalMetadata { timestamp: string; supersededFraction: number }

/** Use claim observation times when available, otherwise the original capture time. */
export function memoryTemporalMetadata(db: Database, projectId: string, ids: string[]): Map<string, TemporalMetadata> {
  const rows = db.prepare(`SELECT m.id, m.created_at, MAX(c.observed_at) AS observed_at,
    COUNT(c.claim_key) AS claims, COUNT(s.claim_key) AS superseded
    FROM memories m LEFT JOIN memory_claims c ON c.memory_id = m.id
    LEFT JOIN memory_supersessions s ON s.supersedes = c.memory_id AND s.claim_key = c.claim_key
    WHERE m.project_id = ? AND m.id IN (SELECT value FROM json_each(?)) GROUP BY m.id`)
    .all(projectId, JSON.stringify(ids)) as Array<{ id: string; created_at: string; observed_at: string | null; claims: number; superseded: number }>;
  return new Map(rows.map(row => [row.id, {
    timestamp: row.observed_at ?? row.created_at,
    supersededFraction: row.claims ? row.superseded / row.claims : 0,
  }]));
}

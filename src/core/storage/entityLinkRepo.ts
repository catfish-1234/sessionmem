import type { Database } from "better-sqlite3";
import { queryEntityNames } from "../extract/knowledge.js";

// Explicit spelling aliases only. No fuzzy matching or inferred coreference.
const ALIASES = [["postgres", "postgresql"], ["node", "node.js"], ["k8s", "kubernetes"]];

/** Link literal query names to existing entities, then weight rare names more. */
export function linkedEntityScores(db: Database, projectId: string, query: string, now: Date, includeHistory: boolean, hubDamping = false): Map<string, number> {
  const names = new Set(queryEntityNames(query));
  for (const group of ALIASES) if (group.some(name => names.has(name))) for (const name of group) names.add(name);
  const rows = db.prepare(`SELECT DISTINCT e.memory_id, e.kind, e.name FROM memory_entities e
    JOIN memories m ON m.id = e.memory_id
    WHERE m.project_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
      AND (? = 1 OR m.id NOT IN (SELECT memory_id FROM superseded_memories))
      AND e.name IN (SELECT value FROM json_each(?)) ORDER BY e.kind, e.name, e.memory_id`)
    .all(projectId, now.toISOString(), Number(includeHistory), JSON.stringify([...names])) as Array<{ memory_id: string; kind: string; name: string }>;
  const frequencies = new Map<string, number>();
  const key = (row: typeof rows[number]) => `${row.kind}:${row.name}`;
  for (const row of rows) frequencies.set(key(row), (frequencies.get(key(row)) ?? 0) + 1);
  if (hubDamping) {
    // Match at most eight stored names, preferring specific spans. Exact and
    // explicit alias matches have similarity 1; no entity model is implied.
    const selected = new Set([...new Set(rows.map(row => row.name))]
      .sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 8));
    const boosts = new Map<string, number>();
    for (const row of rows) {
      if (!selected.has(row.name)) continue;
      const degree = frequencies.get(key(row))!;
      const boost = 0.5 / (1 + 0.001 * (degree - 1) ** 2);
      boosts.set(row.memory_id, Math.max(boosts.get(row.memory_id) ?? 0, boost));
    }
    return new Map([...boosts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  }
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE project_id = ?
    AND (expires_at IS NULL OR expires_at > ?)
    AND (? = 1 OR id NOT IN (SELECT memory_id FROM superseded_memories))`)
    .get(projectId, now.toISOString(), Number(includeHistory)) as { n: number }).n;
  const weights = new Map([...frequencies].map(([name, count]) => [name, 1 + Math.log((total + 1) / (count + 1))]));
  const denominator = [...weights.values()].reduce((a, b) => a + b, 0);
  const scores = new Map<string, number>();
  for (const row of rows) scores.set(row.memory_id, (scores.get(row.memory_id) ?? 0) + weights.get(key(row))! / denominator);
  // Keep scores for all existing lexical/dense candidates. Only admission is capped.
  return new Map([...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

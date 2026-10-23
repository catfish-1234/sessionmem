import { createCliContext, type CliContext } from "../context.js";

/** List local labels without retrieving memory bodies. */
export function scopesCommand(options: { json?: boolean } = {}, ctx?: CliContext): void {
  const context = ctx ?? createCliContext();
  try {
    const counts = new Map<string | null, { scope: string | null; memories: number; entities: number; sessions: number }>();
    const queries = {
      memories: "SELECT scope, COUNT(*) AS n FROM memories WHERE project_id = ? GROUP BY scope",
      sessions: "SELECT scope, COUNT(*) AS n FROM sessions WHERE project_id = ? GROUP BY scope",
      entities: "SELECT e.scope, COUNT(*) AS n FROM memory_entities e JOIN memories m ON m.id = e.memory_id WHERE m.project_id = ? GROUP BY e.scope",
    };
    for (const [kind, sql] of Object.entries(queries)) {
      for (const row of context.db.prepare(sql).all(context.projectId) as { scope: string | null; n: number }[]) {
        const count = counts.get(row.scope) ?? { scope: row.scope, memories: 0, entities: 0, sessions: 0 };
        count[kind as "memories" | "entities" | "sessions"] = row.n;
        counts.set(row.scope, count);
      }
    }
    const scopes = [...counts.values()].sort((a, b) => (a.scope ?? "").localeCompare(b.scope ?? ""));
    if (options.json) console.log(JSON.stringify({ projectId: context.projectId, scopes }, null, 2));
    else for (const row of scopes) console.log(`${row.scope ?? "(unscoped)"}: ${row.memories} memories, ${row.entities} entities, ${row.sessions} sessions`);
  } finally { if (!ctx) context.db.close(); }
}

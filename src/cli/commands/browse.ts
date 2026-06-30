import { createCliContext, type CliContext } from "../context.js";

interface ProjectRow {
  project_id: string;
  memory_count: number;
  newest: string;
}

export async function browseCommand(options: { project?: string } = {}, ctx?: CliContext): Promise<void> {
  const context = ctx ?? createCliContext();
  const db = context.db;

  if (options.project) {
    // Show memories for a specific project
    const memories = db.prepare(
      "SELECT id, kind, importance, content, created_at FROM memories WHERE project_id = ? ORDER BY updated_at DESC LIMIT 50"
    ).all(options.project) as Array<{ id: string; kind: string; importance: number; content: string; created_at: string }>;

    if (memories.length === 0) {
      process.stdout.write(`No memories found for project: ${options.project}\n`);
      return;
    }

    process.stdout.write(`Memories for project: ${options.project} (${memories.length} shown)\n\n`);
    for (const m of memories) {
      const preview = m.content.slice(0, 120).replace(/\n/g, " ");
      process.stdout.write(`[${m.kind}] imp=${m.importance} id=${m.id.slice(0, 8)}…\n  ${preview}${m.content.length > 120 ? "…" : ""}\n\n`);
    }
    return;
  }

  // List all projects
  const projects = db.prepare(
    "SELECT project_id, COUNT(*) as memory_count, MAX(updated_at) as newest FROM memories GROUP BY project_id ORDER BY newest DESC"
  ).all() as ProjectRow[];

  if (projects.length === 0) {
    process.stdout.write("No projects with memories yet.\n");
    process.stdout.write(`Current project: ${context.projectId}\n`);
    return;
  }

  process.stdout.write(`Projects with memories (${projects.length} total):\n\n`);
  for (const p of projects) {
    const marker = p.project_id === context.projectId ? " ← current" : "";
    process.stdout.write(`${p.project_id}${marker}\n`);
    process.stdout.write(`  memories: ${p.memory_count}  last_updated: ${p.newest}\n\n`);
  }
  process.stdout.write(`Use --project <id> to list memories for a specific project.\n`);
}

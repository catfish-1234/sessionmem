import { listProjectKnowledge } from "../../core/storage/knowledgeRepo.js";
import { createCliContext, type CliContext } from "../context.js";

export function entitiesCommand(options: { project?: string; json?: boolean } = {}, ctx?: CliContext): void {
  const context = ctx ?? createCliContext();
  try {
    const projectId = options.project ?? context.projectId;
    const knowledge = listProjectKnowledge(context.db, projectId);
    if (options.json) {
      console.log(JSON.stringify({ projectId, ...knowledge }, null, 2));
      return;
    }
    console.log(`Entities for ${projectId}:`);
    for (const entity of knowledge.entities) {
      console.log(`  [${entity.kind}] ${entity.name} (memories: ${entity.memoryIds.join(", ")})`);
    }
    console.log("Relations:");
    for (const edge of knowledge.relations) {
      console.log(`  [${edge.sourceKind}] ${edge.sourceName} --${edge.relation}--> [${edge.targetKind}] ${edge.targetName} (memories: ${edge.memoryIds.join(", ")})`);
    }
    if (!knowledge.entities.length) console.log("  No entities captured.");
  } finally {
    if (!ctx) context.db.close();
  }
}

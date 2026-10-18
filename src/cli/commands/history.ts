import { listSupersessions } from "../../core/storage/supersessionRepo.js";
import { createCliContext, type CliContext } from "../context.js";

export function historyCommand(options: { project?: string; json?: boolean } = {}, ctx?: CliContext): void {
  const context = ctx ?? createCliContext();
  try {
    const projectId = options.project ?? context.projectId;
    const links = listSupersessions(context.db, projectId);
    if (options.json) {
      console.log(JSON.stringify({ projectId, links }, null, 2));
      return;
    }
    console.log(`Supersession links for ${projectId}:`);
    for (const link of links) {
      console.log(`  ${link.supersedes} -> ${link.supersededBy} at ${link.supersededAt} (${link.entity} ${link.relation}: ${link.oldValue} -> ${link.newValue}; ${link.reason}; ${link.fullySuperseded ? "superseded" : "partially superseded"})`);
    }
    if (!links.length) console.log("  No supersessions captured.");
  } finally {
    if (!ctx) context.db.close();
  }
}

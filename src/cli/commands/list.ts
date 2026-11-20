import { createCliContext, type CliContext } from "../context.js";
import { formatTable } from "../output.js";

export interface ListOptions {
  json?: boolean;
}

// `ctx` stays the first parameter: it is the test-injection seam existing callers pass.
export async function listCommand(ctx?: CliContext, options: ListOptions = {}): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("listMemories", {
    projectId: context.projectId,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ total: result.total, memories: result.memories }, null, 2));
    return;
  }

  console.log(formatTable(result.memories));
  if (result.total > result.memories.length) {
    console.error(`Showing ${result.memories.length} of ${result.total} memories. Use \`sessionmem export\` for the full project.`);
  }
}

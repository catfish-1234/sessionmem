import { createCliContext, type CliContext } from "../context.js";
import { formatTable } from "../output.js";

export interface SearchOptions {
  limit?: number;
}

export async function searchCommand(
  query: string,
  options: SearchOptions = {},
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("retrieveMemories", {
    projectId: context.projectId,
    query,
    limit: options.limit ?? 20,
    mode: "auto",
    depth: "default",
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  console.log(formatTable(result.memories));
}

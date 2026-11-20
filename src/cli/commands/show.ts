import { createCliContext, type CliContext } from "../context.js";
import { formatKeyValue } from "../output.js";

export interface ShowOptions {
  json?: boolean;
}

// `ctx` stays the second parameter: it is the test-injection seam existing callers pass.
export async function showCommand(id: string, ctx?: CliContext, options: ShowOptions = {}): Promise<void> {
  const context = ctx ?? createCliContext();

  // Use call() to get the envelope (catches DomainError for NOT_FOUND)
  const result = await context.service.call("getMemory", {
    projectId: context.projectId,
    memoryId: id,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({ memory: result.memory }, null, 2));
    return;
  }
  process.stdout.write(formatKeyValue(result.memory) + "\n");
}

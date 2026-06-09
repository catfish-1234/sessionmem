import { createCliContext, type CliContext } from "../context.js";
import { formatKeyValue } from "../output.js";

export async function showCommand(id: string, ctx?: CliContext): Promise<void> {
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

  process.stdout.write(formatKeyValue(result.memory) + "\n");
}

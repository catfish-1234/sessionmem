import { createCliContext, type CliContext } from "../context.js";
import { formatTable } from "../output.js";

export async function listCommand(ctx?: CliContext): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("listMemories", {
    projectId: context.projectId,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  console.log(formatTable(result.memories));
}

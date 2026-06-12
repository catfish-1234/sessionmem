import { createCliContext, type CliContext } from "../context.js";

export async function forgetCommand(
  id: string,
  options: { force?: boolean },
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  const getResult = await context.service.call("getMemory", {
    projectId: context.projectId,
    memoryId: id,
  });

  if (!getResult.ok) {
    console.error(getResult.error.message);
    process.exit(1);
  }

  if (!options.force) {
    // Dry-run: preview and exit 0 without deleting
    const preview = getResult.memory.content.replace(/\s+/g, " ").slice(0, 60);
    console.log(`Would delete: ${preview}. Pass --force to confirm.`);
    return;
  }

  // --force path: actually delete
  const deleteResult = await context.service.call("forgetMemory", {
    projectId: context.projectId,
    memoryId: id,
  });

  if (!deleteResult.ok) {
    console.error(deleteResult.error.message);
    process.exit(1);
  }

  console.log(`Deleted ${id}.`);
}

import { statSync } from "fs";
import { createCliContext, type CliContext } from "../context.js";
import { countTokens } from "../../core/injection/tokenBudget.js";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";

export async function statsCommand(ctx?: CliContext): Promise<void> {
  const context = ctx ?? createCliContext();
  const result = await context.service.call("stats", {
    projectId: context.projectId,
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  let sizeBytes = 0;
  try {
    sizeBytes = statSync(context.dbPath).size;
  } catch {
    // dbPath may be ":memory:" or the file may have been removed; report 0
  }
  const totalTokens = listMemoriesByProject(context.db, context.projectId).reduce(
    (sum, m) => sum + countTokens(m.content),
    0,
  );

  process.stdout.write(
    `memories: ${result.totalMemories}\n` +
      `db_size_bytes: ${sizeBytes}\n` +
      `total_content_tokens: ${totalTokens}\n`,
  );
}

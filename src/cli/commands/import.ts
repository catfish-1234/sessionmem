import { resolve } from "path";
import { readFileSync } from "fs";
import { listMemoriesByProject } from "../../core/storage/memoryRepo.js";
import { createCliContext, type CliContext } from "../context.js";

export async function importCommand(
  pathArg: string,
  options: { merge?: boolean },
  ctx?: CliContext,
): Promise<void> {
  const context = ctx ?? createCliContext();

  // V12: resolve user-supplied path
  const inPath = resolve(pathArg);

  // Read and parse the JSON file
  let parsed: unknown;
  try {
    const raw = readFileSync(inPath, "utf8");
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Failed to read or parse import file: ${message}`);
    process.exit(1);
  }

  // Must be an array
  if (!Array.isArray(parsed)) {
    console.error("Import file must be a JSON array of memory records.");
    process.exit(1);
  }

  const records = parsed as Array<Record<string, unknown>>;

  let toImport = records;
  let skippedCount = 0;

  if (!options.merge) {
    // D-12 default: skip existing IDs (pre-filter)
    const existingRows = listMemoriesByProject(context.db, context.projectId);
    const existingIds = new Set(existingRows.map((r) => r.id));

    const filtered = records.filter((r) => !existingIds.has(r.id as string));
    skippedCount = records.length - filtered.length;
    toImport = filtered;
  }

  if (toImport.length === 0 && skippedCount > 0) {
    console.log(`Imported 0, skipped ${skippedCount} duplicates.`);
    return;
  }

  // Call importMemories — validation via importMemoryRecordSchema happens in the service
  const result = await context.service.call("importMemories", {
    projectId: context.projectId,
    memories: toImport.map((r) => ({
      id: r.id as string,
      projectId: (r.projectId as string) ?? context.projectId,
      sessionId: r.sessionId as string,
      sourceAdapter: r.sourceAdapter as string,
      kind: r.kind as string,
      content: r.content as string,
      importance: r.importance as number,
      createdAt: r.createdAt as string | undefined,
      updatedAt: r.updatedAt as string | undefined,
    })),
  });

  if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
  }

  const importedCount = result.imported;
  if (options.merge) {
    console.log(`Imported (merged) ${importedCount} memories.`);
  } else {
    console.log(`Imported ${importedCount}, skipped ${skippedCount} duplicates.`);
  }
}
